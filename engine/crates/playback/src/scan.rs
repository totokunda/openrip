//! A file's frames for the analysis tools (openrip-analysis): every frame of a range, for
//! Split scenes, and frames spread across it, for Auto adjust and Color match. Frames are
//! shrunk on the GPU as the timeline's thumbnails are (upright, area-averaged, through the
//! compositor's own colour conversion, so the colours are the preview's). Both report
//! progress and stop when asked.

use std::path::Path;

use openrip_analysis::{ColorSample, SceneCut, SceneDetector, SceneOptions};
use openrip_media::{open_video, DecoderOptions, MediaError, Micros};
use openrip_render::{Compositor, RenderError, Source};

use crate::preview::load_still;
use crate::thumbs::{is_still, shrink};
use crate::PreviewError;

#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    #[error(transparent)]
    Preview(#[from] PreviewError),
    #[error("{0}")]
    Still(String),
    /// Stopped by the progress callback.
    #[error("cancelled")]
    Cancelled,
}

impl From<MediaError> for ScanError {
    fn from(e: MediaError) -> Self {
        ScanError::Preview(e.into())
    }
}

impl From<RenderError> for ScanError {
    fn from(e: RenderError) -> Self {
        ScanError::Preview(e.into())
    }
}

/// Height frames are shrunk to for the scene detector (it shrinks them further itself).
const SCAN_HEIGHT: u32 = 96;
/// Decoded pictures may come this small (VideoToolbox scales as it decodes).
const SCAN_DECODE: u32 = 384;
/// Height of the frames sampled for colour, and the pixels taken from each.
const SAMPLE_HEIGHT: u32 = 128;
const SAMPLE_PIXELS: usize = 4096;

/// The end of a range of a stream `length` long (a length the container doesn't know, 0,
/// leaves the range as asked).
fn range_end(start: Micros, duration: Option<Micros>, length: Micros) -> Micros {
    match duration {
        Some(d) if d.0 > 0 && length.0 > start.0 => Micros((start.0 + d.0).min(length.0)),
        Some(d) if d.0 > 0 => Micros(start.0 + d.0),
        _ => length,
    }
}

/// The shot changes in `path` over `duration` from `start` (media time; to its end for
/// `None`), cut times in media time: every frame of the range decoded in order, shrunk and
/// given to the detector (`sensitivity` 0–1; `min_scene` in seconds). `progress(done,
/// total)` after each frame, in frames; returning false stops the scan. A still has none.
pub fn scan_scenes(path: &Path, start: Micros, duration: Option<Micros>, sensitivity: f32, min_scene: f64, progress: &mut dyn FnMut(u64, u64) -> bool) -> Result<Vec<SceneCut>, ScanError> {
    if is_still(path) {
        return Ok(Vec::new());
    }
    let compositor = Compositor::new()?;
    let mut d = open_video(path, &DecoderOptions { cache_bytes: 0, shrink_to: SCAN_DECODE, ..Default::default() })?;
    let info = d.info().clone();
    let fps = info.frame_rate.map_or(30.0, |r| r.as_f64()).clamp(1.0, 240.0);
    let end = range_end(start, duration, info.duration);
    let total = (((end.0 - start.0).max(0) as f64 / 1e6) * fps).round().max(1.0) as u64;
    let mut detector = SceneDetector::new(SceneOptions { fps, sensitivity, min_scene });
    let mut next = d.frame_at(start)?;
    let mut done = 0u64;
    while let Some(f) = next {
        // The frame shown at the start may begin before it; anything from the end on is out.
        if done > 0 && f.time >= end {
            break;
        }
        let img = shrink(&compositor, Source::Video(&f), SCAN_HEIGHT, info.rotation);
        detector.push(f.time.0, &img.data, img.width as usize, img.height as usize);
        done += 1;
        if !progress(done.min(total), total) {
            return Err(ScanError::Cancelled);
        }
        next = d.next_frame()?;
    }
    progress(total, total);
    Ok(detector.finish())
}

/// Pixels of `frames` frames spread evenly over `duration` from `start` of `path` (media
/// time; to its end for `None`), or of the still. `progress(done, total)` after each frame;
/// returning false stops.
pub fn sample_colors(path: &Path, start: Micros, duration: Option<Micros>, frames: usize, progress: &mut dyn FnMut(u64, u64) -> bool) -> Result<ColorSample, ScanError> {
    let compositor = Compositor::new()?;
    let mut sample = ColorSample::new();
    if is_still(path) {
        let img = load_still(path).map_err(ScanError::Still)?;
        let small = shrink(&compositor, Source::Image(&img), SAMPLE_HEIGHT.min(img.height.max(1)), 0);
        sample.add_rgba(&small.data, small.width, small.height, SAMPLE_PIXELS * 4);
        progress(1, 1);
        return Ok(sample);
    }
    let mut d = open_video(path, &DecoderOptions { cache_bytes: 0, shrink_to: SCAN_DECODE, ..Default::default() })?;
    let info = d.info().clone();
    let end = range_end(start, duration, info.duration);
    let n = frames.max(1);
    let span = (end.0 - start.0).max(0) as f64;
    for i in 0..n {
        let t = Micros(start.0 + (span * (i as f64 + 0.5) / n as f64) as i64);
        if let Some(f) = d.frame_at(t)? {
            let img = shrink(&compositor, Source::Video(&f), SAMPLE_HEIGHT, info.rotation);
            sample.add_rgba(&img.data, img.width, img.height, SAMPLE_PIXELS);
        }
        if !progress(i as u64 + 1, n as u64) {
            return Err(ScanError::Cancelled);
        }
    }
    Ok(sample)
}
