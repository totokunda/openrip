//! Preview rendering: a project at a time → one composited frame.
//!
//! [`PreviewEngine`] keeps decoders, still images and fonts between frames, so playing or
//! scrubbing a project only decodes what changed. Hardware video frames go to the GPU
//! without a copy; text is rasterised by the engine. Media that can't be loaded (missing
//! files are common in CapCut projects copied between machines) is skipped and reported.

use std::collections::HashMap;
use std::path::Path;

use openrip_media::{DecoderOptions, MediaError, VideoDecoder, VideoFrame};
use openrip_model::{MediaKind, Micros, Project, Segment, SizeUnit, TrackKind, CAPCUT_SIZE_UNIT_EM};
use openrip_render::text::{self, Align, Font, TextStyle};
use openrip_render::{Compositor, Layer, RenderError, RgbaImage, Source};

/// CapCut's default font, used when a text run names none.
const DEFAULT_FONT: &str = "/Applications/CapCut.app/Contents/Resources/Font/SystemFont/en.ttf";
/// Decoders kept open; the least recently used is closed beyond this.
const MAX_DECODERS: usize = 12;
/// Decoded-frame cache per preview decoder: room to step back through a 1080p GOP without
/// holding gigabytes across a dozen open clips.
const DECODER_CACHE: usize = 128 << 20;
/// Clips starting this soon get their decoder opened and positioned in the background.
const PREFETCH: Micros = Micros(1_500_000);

/// Media to get ready off the render thread: a decoder positioned at a clip's in-point, or
/// a still image decoded.
struct PrefetchJob {
    segment: String,
    path: String,
    at: Micros,
    still: bool,
}

enum Prefetched {
    /// Segment, media path, decoder.
    Decoder(String, String, Box<VideoDecoder>),
    Still(String, RgbaImage),
    /// The job's key (segment or still path): it failed, and the render thread will find out
    /// why itself.
    Failed(String),
}

/// Opens decoders for clips about to start, so a cut doesn't stall the frame.
struct Prefetcher {
    jobs: Option<std::sync::mpsc::Sender<PrefetchJob>>,
    ready: std::sync::mpsc::Receiver<Prefetched>,
    /// Segments (or still paths) with a job in flight.
    pending: std::collections::HashSet<String>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl Prefetcher {
    fn new() -> Prefetcher {
        let (job_tx, job_rx) = std::sync::mpsc::channel::<PrefetchJob>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let worker = std::thread::Builder::new()
            .name("decoder-prefetch".into())
            .spawn(move || {
                for job in job_rx {
                    // Report failures too: the render thread may be waiting for this job.
                    let done = if job.still {
                        match load_still(Path::new(&job.path)) {
                            Ok(img) => Prefetched::Still(job.path, img),
                            Err(_) => Prefetched::Failed(job.path),
                        }
                    } else {
                        let opened = VideoDecoder::open(Path::new(&job.path), &DecoderOptions { cache_bytes: DECODER_CACHE, ..Default::default() });
                        // Decode the first frame now (it stays in the decoder's cache).
                        match opened.map(|mut d| d.frame_at(job.at).is_ok().then_some(d)) {
                            Ok(Some(d)) => Prefetched::Decoder(job.segment, job.path, Box::new(d)),
                            _ => Prefetched::Failed(job.segment),
                        }
                    };
                    if ready_tx.send(done).is_err() {
                        return;
                    }
                }
            })
            .ok();
        Prefetcher { jobs: Some(job_tx), ready: ready_rx, pending: Default::default(), worker }
    }
}

impl Drop for Prefetcher {
    fn drop(&mut self) {
        self.jobs.take(); // ends the worker's loop
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PreviewError {
    #[error(transparent)]
    Render(#[from] RenderError),
    #[error(transparent)]
    Media(#[from] MediaError),
}

/// What a frame needed that couldn't be drawn.
#[derive(Clone, Debug, Default)]
pub struct FrameReport {
    pub layers: usize,
    /// Media or font files that failed to load (path and reason), once per frame.
    pub missing: Vec<(String, String)>,
}

enum Pixels {
    /// A still and its cache key.
    Image(std::sync::Arc<RgbaImage>, u64),
    /// A frame and the clockwise turn that displays it upright (phone video).
    Video(VideoFrame, i32),
    /// Rasterised text, its cache key, and the canvas point its image centre goes to.
    Text(std::sync::Arc<RgbaImage>, u64, [f64; 2]),
}

/// The media file a segment plays.
fn media_path(p: &Project, segment: &str) -> Option<String> {
    let s = p.tracks.iter().flat_map(|t| t.segments.iter()).find(|s| s.id == segment)?;
    p.materials.media.iter().find(|m| m.id == s.material).map(|m| m.path.clone())
}

fn key_of(v: impl std::hash::Hash) -> u64 {
    use std::hash::Hasher;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    v.hash(&mut h);
    h.finish()
}

struct OpenDecoder {
    decoder: VideoDecoder,
    last_used: u64,
}

pub struct PreviewEngine {
    project: Project,
    compositor: Compositor,
    /// One decoder per segment, so two clips of the same file at different times don't
    /// fight over one decoder's position.
    decoders: HashMap<String, OpenDecoder>,
    images: HashMap<String, std::sync::Arc<RgbaImage>>,
    fonts: HashMap<String, Font>,
    /// Paths that failed to load, so they aren't retried every frame.
    failed: HashMap<String, String>,
    /// Rasterised text by content/style/size/sub-pixel origin, with the tick last used.
    texts: HashMap<u64, (std::sync::Arc<RgbaImage>, [f64; 2], u64)>,
    prefetch: Prefetcher,
    tick: u64,
}

impl PreviewEngine {
    pub fn new(project: Project) -> Result<Self, PreviewError> {
        openrip_media::warm_up();
        Ok(PreviewEngine {
            project,
            compositor: Compositor::new()?,
            decoders: HashMap::new(),
            images: HashMap::new(),
            fonts: HashMap::new(),
            failed: HashMap::new(),
            texts: HashMap::new(),
            prefetch: Prefetcher::new(),
            tick: 0,
        })
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    /// Replace the project after an edit, keeping every open decoder whose clip still exists
    /// with the same media (so playback and scrubbing stay warm).
    pub fn set_project(&mut self, project: Project) {
        let old = std::mem::replace(&mut self.project, project);
        let keep: Vec<String> = self.decoders.keys().filter(|id| self.media_path(id).is_some_and(|path| Some(path) == media_path(&old, id))).cloned().collect();
        self.decoders.retain(|id, _| keep.contains(id));
        self.failed.clear(); // files may have been relinked
    }

    /// Video decoders open (one per clip in use).
    pub fn open_decoders(&self) -> usize {
        self.decoders.len()
    }

    fn media_path(&self, segment: &str) -> Option<String> {
        media_path(&self.project, segment)
    }

    /// Render the frame at `t` and read it back.
    pub fn render_image(&mut self, t: Micros, width: u32, height: u32) -> Result<(RgbaImage, FrameReport), PreviewError> {
        let (pixels, report) = self.gather(t, width, height);
        let layers = self.layers(&pixels, t, width, height);
        Ok((self.compositor.render(width, height, [0, 0, 0], &layers), report))
    }

    /// Render the frame at `t` into an IOSurface-backed BGRA pixel buffer (see
    /// [`Compositor::output_surface`]) for the app to present.
    #[cfg(target_os = "macos")]
    pub fn render_to_surface(&mut self, t: Micros, target: &objc2_core_video::CVPixelBuffer) -> Result<FrameReport, PreviewError> {
        let (w, h) = (objc2_core_video::CVPixelBufferGetWidth(target) as u32, objc2_core_video::CVPixelBufferGetHeight(target) as u32);
        let (pixels, report) = self.gather(t, w, h);
        let layers = self.layers(&pixels, t, w, h);
        self.compositor.render_to_surface(target, [0, 0, 0], &layers)?;
        Ok(report)
    }

    /// Render the frame at `t` into an NV12 pixel buffer for the encoder (export).
    #[cfg(target_os = "macos")]
    pub fn render_to_nv12(&mut self, t: Micros, target: &objc2_core_video::CVPixelBuffer) -> Result<FrameReport, PreviewError> {
        let (w, h) = (objc2_core_video::CVPixelBufferGetWidth(target) as u32, objc2_core_video::CVPixelBufferGetHeight(target) as u32);
        let (pixels, report) = self.gather(t, w, h);
        let layers = self.layers(&pixels, t, w, h);
        self.compositor.render_to_nv12(target, [0, 0, 0], &layers)?;
        Ok(report)
    }

    /// The segments visible at `t`, bottom first (CapCut stacks by render index; text sits
    /// at 14000+, above video).
    fn active(&self, t: Micros) -> Vec<Segment> {
        let mut active: Vec<Segment> = self
            .project
            .tracks
            .iter()
            .filter(|tr| matches!(tr.kind, TrackKind::Video | TrackKind::Text | TrackKind::Sticker) && !tr.hidden)
            .flat_map(|tr| tr.segments.iter().filter(|s| s.visible && s.target.contains(t)).cloned())
            .collect();
        active.sort_by_key(|s| s.render_index);
        active
    }

    fn adopt(&mut self, done: Prefetched) {
        match done {
            Prefetched::Decoder(segment, path, decoder) => {
                self.prefetch.pending.remove(&segment);
                // The project may have been edited since: keep it only if the clip still
                // plays that file.
                if self.media_path(&segment).as_deref() == Some(path.as_str()) {
                    self.decoders.entry(segment).or_insert(OpenDecoder { decoder: *decoder, last_used: self.tick });
                }
            }
            Prefetched::Still(path, img) => {
                self.prefetch.pending.remove(&path);
                self.images.entry(path).or_insert_with(|| std::sync::Arc::new(img));
            }
            Prefetched::Failed(key) => {
                self.prefetch.pending.remove(&key);
            }
        }
    }

    /// If the prefetcher is already preparing `key`, wait for it rather than duplicate the
    /// work on the render thread (bounded, in case the job failed).
    fn await_prefetch(&mut self, key: &str) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
        while self.prefetch.pending.contains(key) {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            match self.prefetch.ready.recv_timeout(left) {
                Ok(done) => self.adopt(done),
                Err(_) => {
                    self.prefetch.pending.remove(key);
                    break;
                }
            }
        }
    }

    /// Adopt decoders the prefetcher has finished, and queue clips starting soon after `t`.
    fn run_prefetch(&mut self, t: Micros) {
        while let Ok(done) = self.prefetch.ready.try_recv() {
            self.adopt(done);
        }
        let Some(jobs) = &self.prefetch.jobs else { return };
        for track in self.project.tracks.iter().filter(|tr| matches!(tr.kind, TrackKind::Video) && !tr.hidden) {
            for seg in track.segments.iter().filter(|s| s.visible && s.target.start > t && s.target.start.0 <= t.0 + PREFETCH.0) {
                let Some(media) = self.project.materials.media.iter().find(|m| m.id == seg.material && m.kind != MediaKind::Audio) else { continue };
                let still = media.kind == MediaKind::Photo;
                // Stills are shared by path; decoders belong to a segment.
                let key = if still { media.path.clone() } else { seg.id.clone() };
                let ready = if still { self.images.contains_key(&key) } else { self.decoders.contains_key(&key) };
                if ready || self.prefetch.pending.contains(&key) || self.failed.contains_key(&media.path) {
                    continue;
                }
                let job = PrefetchJob { segment: seg.id.clone(), path: media.path.clone(), at: seg.source_time(seg.target.start).unwrap_or(Micros::ZERO), still };
                if jobs.send(job).is_ok() {
                    self.prefetch.pending.insert(key);
                }
            }
        }
    }

    fn gather(&mut self, t: Micros, w: u32, h: u32) -> (Vec<(Segment, Pixels)>, FrameReport) {
        self.tick += 1;
        self.run_prefetch(t);
        let mut report = FrameReport::default();
        let mut out = Vec::new();
        let trace = std::env::var_os("OPENRIP_TRACE").is_some();
        for seg in self.active(t) {
            let t0 = std::time::Instant::now();
            let got = self.pixels(&seg, t, w, h);
            if trace && t0.elapsed().as_millis() >= 10 {
                eprintln!("[preview] t={:.3}s segment {} took {:.1} ms", t.as_secs_f64(), seg.id, t0.elapsed().as_secs_f64() * 1e3);
            }
            match got {
                Ok(Some(p)) => out.push((seg, p)),
                Ok(None) => {}
                Err((path, why)) => {
                    self.failed.insert(path.clone(), why.clone());
                    report.missing.push((path, why));
                }
            }
        }
        report.layers = out.len();
        self.evict_decoders();
        let tick = self.tick;
        self.texts.retain(|_, (_, _, last)| tick - *last < 3);
        (out, report)
    }

    fn pixels(&mut self, seg: &Segment, t: Micros, w: u32, h: u32) -> Result<Option<Pixels>, (String, String)> {
        if let Some(text) = self.project.materials.texts.iter().find(|m| m.id == seg.material).cloned() {
            let Some(run) = text.runs.first() else { return Ok(None) };
            let path = if run.font.path.is_empty() || !Path::new(&run.font.path).exists() { DEFAULT_FONT.to_string() } else { run.font.path.clone() };
            if let Some(why) = self.failed.get(&path) {
                return Err((path.clone(), why.clone()));
            }
            if !self.fonts.contains_key(&path) {
                let font = Font::from_file(Path::new(&path)).map_err(|e| (path.clone(), e.to_string()))?;
                self.fonts.insert(path.clone(), font);
            }
            let local = seg.local_time(t);
            let (pos, scale) = (seg.transform.position.sample(local), seg.transform.scale.sample(local));
            let em = match run.size_unit {
                SizeUnit::CapCut => run.size * CAPCUT_SIZE_UNIT_EM * w as f32,
                SizeUnit::CanvasHeight => run.size * h as f32,
            } * scale.x.abs() as f32;
            let to_u8 = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            let style = TextStyle {
                font: &self.fonts[&path],
                size: em,
                color: [to_u8(run.fill.r), to_u8(run.fill.g), to_u8(run.fill.b), to_u8(run.fill.a)],
                align: match text.layout.alignment {
                    0 => Align::Left,
                    2 => Align::Right,
                    _ => Align::Center,
                },
                letter_spacing: text.layout.letter_spacing,
                line_spacing: text.layout.line_spacing,
                // Provisional scales until calibration session 3 measures CapCut's: the stroke
                // reaches `width` em outside the glyphs; the background pads by half its
                // width/height in em, with the radius a fraction of half the box height.
                stroke: run.stroke.filter(|s| s.width > 0.0).map(|s| ([to_u8(s.color.r), to_u8(s.color.g), to_u8(s.color.b), to_u8(s.color.a)], s.width * em)),
                background: text.layout.background.map(|b| {
                    let pad = [b.width * em * 0.5, b.height * em * 0.5];
                    let radius = if b.style == 2 { b.corner_radius * (em / 2.0 + pad[1]) } else { 0.0 };
                    ([to_u8(b.color.r), to_u8(b.color.g), to_u8(b.color.b), to_u8(b.color.a)], pad, radius)
                }),
            };
            let lay = text::layout(&text.text, &style);
            // Block centre on the canvas; rasterise so the image sits on the pixel grid.
            let (cx, cy) = (w as f64 / 2.0 + pos.x * w as f64 / 2.0, h as f64 / 2.0 - pos.y * h as f64 / 2.0);
            let (x0, y0) = (cx - lay.width as f64 / 2.0, cy - lay.height as f64 / 2.0);
            let origin = [x0.rem_euclid(1.0) as f32, y0.rem_euclid(1.0) as f32];
            let key = key_of((
                &path,
                &text.text,
                em.to_bits(),
                style.color,
                style.stroke.map(|(c, r)| (c, r.to_bits())),
                style.background.map(|(c, p, r)| (c, p[0].to_bits(), p[1].to_bits(), r.to_bits())),
                text.layout.alignment,
                text.layout.letter_spacing.to_bits(),
                text.layout.line_spacing.to_bits(),
                origin[0].to_bits(),
                origin[1].to_bits(),
            ));
            let tick = self.tick;
            let (image, center) = match self.texts.get_mut(&key) {
                Some((img, center, last)) => {
                    *last = tick;
                    (img.clone(), *center)
                }
                None => {
                    let r = lay.rasterize(&style, origin);
                    let img = std::sync::Arc::new(r.image);
                    self.texts.insert(key, (img.clone(), r.center, tick));
                    (img, r.center)
                }
            };
            let at = [cx - (center[0] - image.width as f64 / 2.0), cy - (center[1] - image.height as f64 / 2.0)];
            return Ok(Some(Pixels::Text(image, key, at)));
        }
        let Some(media) = self.project.materials.media.iter().find(|m| m.id == seg.material).cloned() else { return Ok(None) };
        if media.kind == MediaKind::Audio {
            return Ok(None);
        }
        if let Some(why) = self.failed.get(&media.path) {
            return Err((media.path.clone(), why.clone()));
        }
        let fail = |e: &dyn std::fmt::Display| (media.path.clone(), e.to_string());
        if media.kind == MediaKind::Photo {
            self.await_prefetch(&media.path);
            if !self.images.contains_key(&media.path) {
                let img = load_still(Path::new(&media.path)).map_err(|e| fail(&e))?;
                self.images.insert(media.path.clone(), std::sync::Arc::new(img));
            }
            return Ok(Some(Pixels::Image(self.images[&media.path].clone(), key_of(&media.path))));
        }
        let key = seg.id.clone();
        self.await_prefetch(&key);
        if !self.decoders.contains_key(&key) {
            let decoder = VideoDecoder::open(Path::new(&media.path), &DecoderOptions { cache_bytes: DECODER_CACHE, ..Default::default() }).map_err(|e| fail(&e))?;
            self.decoders.insert(key.clone(), OpenDecoder { decoder, last_used: 0 });
        }
        let d = self.decoders.get_mut(&key).unwrap();
        d.last_used = self.tick;
        let orientation = d.decoder.info().rotation;
        let before = d.decoder.stats();
        let t0 = std::time::Instant::now();
        let at = seg.source_time(t).unwrap_or(Micros::ZERO);
        let frame = d.decoder.frame_at(at).map_err(|e| fail(&e))?;
        if std::env::var_os("OPENRIP_TRACE").is_some() && t0.elapsed().as_millis() >= 10 {
            let after = d.decoder.stats();
            eprintln!(
                "[preview]   decoder: source {:.3}s, {} seeks, {} pictures decoded, {} session resets, {} skipped",
                at.as_secs_f64(),
                after.seeks - before.seeks,
                after.frames_decoded - before.frames_decoded,
                after.sessions_reset - before.sessions_reset,
                after.skipped_disposable - before.skipped_disposable
            );
        }
        Ok(frame.map(|f| Pixels::Video(f, orientation)))
    }

    fn evict_decoders(&mut self) {
        while self.decoders.len() > MAX_DECODERS {
            let oldest = self.decoders.iter().min_by_key(|(_, d)| d.last_used).map(|(k, _)| k.clone()).unwrap();
            self.decoders.remove(&oldest);
        }
    }

    fn layers<'a>(&self, pixels: &'a [(Segment, Pixels)], t: Micros, w: u32, h: u32) -> Vec<Layer<'a>> {
        pixels
            .iter()
            .map(|(seg, p)| {
                let local = seg.local_time(t);
                let tr = &seg.transform;
                let (pos, scale, rot) = (tr.position.sample(local), tr.scale.sample(local), tr.rotation.sample(local));
                // Flips are on screen axes: fold them into the scale signs.
                let scale = [scale.x * if tr.flip_h { -1.0 } else { 1.0 }, scale.y * if tr.flip_v { -1.0 } else { 1.0 }];
                let mut layer = match p {
                    Pixels::Image(i, key) => Layer::from_model(Source::Cached(*key, i), [w, h], [pos.x, pos.y], scale, rot),
                    Pixels::Video(f, orientation) => Layer::from_model_oriented(Source::Video(f), [w, h], [pos.x, pos.y], scale, rot, *orientation),
                    Pixels::Text(img, key, at) => Layer {
                        source: Source::Cached(*key, img),
                        center: *at,
                        size: [img.width as f64, img.height as f64],
                        rotation: rot,
                        flip_h: tr.flip_h,
                        flip_v: tr.flip_v,
                        opacity: 1.0,
                    },
                };
                layer.opacity *= seg.opacity.sample(local);
                layer
            })
            .collect()
    }
}

/// Decode a still image: PNG directly (keeps alpha), anything else through FFmpeg.
pub(crate) fn load_still(path: &Path) -> Result<RgbaImage, String> {
    if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) {
        return load_png(path).map_err(|e| e.to_string());
    }
    let mut d = VideoDecoder::open(path, &DecoderOptions { hardware: openrip_media::HardwareMode::Off, ..Default::default() }).map_err(|e| e.to_string())?;
    let rgb = d.next_frame().map_err(|e| e.to_string())?.ok_or("no picture")?.to_rgb().map_err(|e| e.to_string())?;
    Ok(RgbaImage { width: rgb.width, height: rgb.height, data: rgb.data.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect() })
}

pub fn load_png(path: &Path) -> Result<RgbaImage, Box<dyn std::error::Error>> {
    let mut dec = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(path)?));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info()?;
    let mut buf = vec![0; reader.output_buffer_size().ok_or("png too large")?];
    let info = reader.next_frame(&mut buf)?;
    let px = &buf[..info.buffer_size()];
    let data = match info.color_type {
        png::ColorType::Rgba => px.to_vec(),
        png::ColorType::Rgb => px.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => px.chunks_exact(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
        png::ColorType::Grayscale => px.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("indexed png after EXPAND".into()),
    };
    Ok(RgbaImage { width: info.width, height: info.height, data })
}
