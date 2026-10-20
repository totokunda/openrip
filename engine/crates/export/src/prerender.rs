//! Pre-rendering: the timeline's chunks composited into the render cache (see
//! `openrip_playback::render_cache`).
//!
//! Each chunk is one short file written through the platform's [`Encoder`], from a preview
//! engine that composites the sources (it never reads the cache itself). ProRes where the
//! encoder has it: every frame is a whole picture, so any frame decodes on its own and fast;
//! otherwise high-bitrate H.264 with a keyframe at the chunk's start.

use std::path::Path;

use openrip_model::{Micros, Project};
use openrip_playback::render_cache::{ChunkSpec, Entry, Plan, RenderCache};
use openrip_playback::PreviewEngine;

use crate::{available_codecs, open_encoder, Codec, Encoder, ExportError, ExportOptions, Picture, ProRes};

/// What a pre-render did.
#[derive(Clone, Debug, Default)]
pub struct PrerenderStats {
    /// Chunks rendered now, and chunks of the range that were rendered already.
    pub rendered: u32,
    pub reused: u32,
    pub frames: u64,
    pub seconds: f64,
}

/// The codec the cache's files are written in, or none when the platform has no encoder.
pub fn cache_codec() -> Option<Codec> {
    let have = available_codecs();
    [Codec::ProRes(ProRes::Lt), Codec::H264].into_iter().find(|c| have.contains(c))
}

/// Whether this build can pre-render at all (a video encoder to write the chunks with).
pub fn available() -> bool {
    cache_codec().is_some()
}

/// Render the chunks of `project` that overlap `range` (the whole timeline when `None`) and
/// are not rendered yet. `progress` gets (frames done, frames to do) after each frame and
/// returns whether to go on; a chunk cut short is removed and the ones finished stay.
pub fn prerender(project: Project, cache: &RenderCache, range: Option<(Micros, Micros)>, mut progress: impl FnMut(u64, u64) -> bool) -> Result<PrerenderStats, ExportError> {
    let t0 = std::time::Instant::now();
    let codec = cache_codec().ok_or_else(|| ExportError::Other("this platform has no video encoder to render with".into()))?;
    if !cache.has_dir() {
        return Err(ExportError::Other("no folder for the rendering cache".into()));
    }
    let plan: Plan = cache.plan(&project);
    let mut stats = PrerenderStats::default();
    let mut todo = Vec::new();
    for c in &plan.chunks {
        let Some(key) = c.key else { continue };
        if range.is_some_and(|(a, b)| c.end <= a || c.start >= b) {
            continue;
        }
        if cache.lookup(key).is_some() {
            stats.reused += 1;
        } else {
            todo.push(c.clone());
        }
    }
    let total: u64 = todo.iter().map(|c| c.frames as u64).sum();
    let (w, h) = plan.size;
    let options = ExportOptions { width: w, height: h, fps: plan.fps, codec, bitrate: (w as f64 * h as f64 * plan.fps.as_f64() * 0.8) as u64, exact_bitrate: false, audio: false };
    let mut engine = PreviewEngine::new(project)?;
    let mut done = 0u64;
    progress(0, total);
    for c in todo {
        let key = c.key.unwrap();
        let final_path = cache.path_of(key).unwrap();
        let part = final_path.with_file_name(format!("{key:016x}.part.mov"));
        let mut out: Box<dyn Encoder> = open_encoder(&part, &options)?;
        for k in 0..c.frames {
            let t = plan.fps.frame_start(c.first + k);
            let drawn = out.video(k, &mut |picture| match picture {
                #[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
                Picture::Nv12(pb) => engine.render_to_nv12(t, pb),
                Picture::Rgba(img) => engine.render_image(t, img.width, img.height).map(|(frame, report)| {
                    *img = frame;
                    report
                }),
            });
            if let Err(e) = drawn {
                out.cancel();
                return Err(e);
            }
            done += 1;
            stats.frames += 1;
            if !progress(done, total) {
                out.cancel();
                return Err(ExportError::Cancelled);
            }
        }
        out.finish()?;
        finish_chunk(cache, &part, &final_path, key, &c, &plan)?;
        stats.rendered += 1;
    }
    stats.seconds = t0.elapsed().as_secs_f64();
    Ok(stats)
}

fn finish_chunk(cache: &RenderCache, part: &Path, path: &Path, key: u64, c: &ChunkSpec, plan: &Plan) -> Result<(), ExportError> {
    std::fs::rename(part, path).map_err(|e| ExportError::Other(e.to_string()))?;
    let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let used = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    cache.insert(Entry {
        key,
        file: path.file_name().unwrap().to_string_lossy().into_owned(),
        first: c.first,
        frames: c.frames,
        width: plan.size.0,
        height: plan.size.1,
        fps_num: plan.fps.num,
        fps_den: plan.fps.den,
        bytes,
        used,
    });
    Ok(())
}
