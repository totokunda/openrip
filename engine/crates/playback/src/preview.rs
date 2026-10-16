//! Preview rendering: a project at a time → one composited frame.
//!
//! [`PreviewEngine`] keeps decoders, still images and fonts between frames, so playing or
//! scrubbing a project only decodes what changed. Hardware video frames go to the GPU
//! without a copy; text is rasterised by the engine. Media that can't be loaded (missing
//! files are common in CapCut projects copied between machines) is skipped and reported.

use std::collections::HashMap;
use std::path::Path;

use openrip_media::{DecoderOptions, MediaError, VideoDecoder, VideoFrame};
use openrip_model::{Animation, EffectCategory, MediaKind, Micros, PaintKind, Project, Segment, SizeUnit, TextEffect, TextureStretch, TrackKind, CAPCUT_SIZE_UNIT_EM};
use openrip_render::text::{self, Align, Font, TextStyle};
use openrip_render::{Adjust, Compositor, ExposureLuts, Layer, Lut3d, RenderError, RgbaImage, Source};

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
    /// A filter track's lookup table and strength, applied to everything below it.
    Filter(std::sync::Arc<Lut3d>, f32),
    /// A transition's colour over the whole canvas (a 1×1 image), its key and opacity.
    Wash(std::sync::Arc<RgbaImage>, u64, f32),
    /// A transition's image, cover-fitted to the canvas, and its key.
    Cover(std::sync::Arc<RgbaImage>, u64),
    /// A transition's blur of everything below it, taps this many output pixels apart.
    Blur(f32),
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
    /// CapCut's exposure tables by colour-bundle path (`None` if they couldn't be read).
    exposure_luts: HashMap<String, Option<ExposureLuts>>,
    /// Filter lookup tables by bundle path.
    filters: HashMap<String, std::sync::Arc<Lut3d>>,
    /// Styled text in pieces (see `PreparedText`), by everything but per-character opacity.
    prepared: HashMap<u64, (std::sync::Arc<text::PreparedText>, u64)>,
    /// Font files found for family names (see `font_file_for`).
    font_files: HashMap<String, String>,
    /// Text-style textures (premultiplied) by path; `None` if unreadable.
    textures: HashMap<String, Option<std::sync::Arc<RgbaImage>>>,
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
            exposure_luts: HashMap::new(),
            filters: HashMap::new(),
            textures: HashMap::new(),
            font_files: HashMap::new(),
            prepared: HashMap::new(),
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
            .filter(|tr| matches!(tr.kind, TrackKind::Video | TrackKind::Text | TrackKind::Sticker | TrackKind::Filter) && !tr.hidden)
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
            self.load_exposure_luts(&seg);
            let t0 = std::time::Instant::now();
            let got = self.pixels(&seg, t, w, h);
            if trace && t0.elapsed().as_millis() >= 10 {
                eprintln!("[preview] t={:.3}s segment {} took {:.1} ms", t.as_secs_f64(), seg.id, t0.elapsed().as_secs_f64() * 1e3);
            }
            match got {
                Ok(Some(p)) => out.push((seg.clone(), p)),
                Ok(None) => {}
                Err((path, why)) => {
                    self.failed.insert(path.clone(), why.clone());
                    report.missing.push((path, why));
                }
            }
            // A transition at the cut before or after this clip works on the canvas over it.
            if let Some((tr, p)) = crate::transition::transition_at(&self.project, &seg, t).map(|(tr, p)| (tr.clone(), p)) {
                for step in crate::transition::steps(&tr, p) {
                    if let Some(px) = self.step_pixels(step, w) {
                        out.push((seg.clone(), px));
                    }
                }
            }
        }
        report.layers = out.len();
        self.evict_decoders();
        let tick = self.tick;
        self.texts.retain(|_, (_, _, last)| tick - *last < 3);
        self.prepared.retain(|_, (_, last)| tick - *last < 3);
        (out, report)
    }

    fn step_pixels(&mut self, step: crate::transition::Step, w: u32) -> Option<Pixels> {
        use crate::transition::Step;
        Some(match step {
            Step::Wash(c, amount) => Pixels::Wash(std::sync::Arc::new(RgbaImage { width: 4, height: 4, data: c.repeat(16) }), key_of(("wash", c)), amount),
            Step::Blur(px) => Pixels::Blur(px * w as f32 / self.project.canvas.width.max(1) as f32),
            Step::Frame(path) => {
                if self.failed.contains_key(&path) {
                    return None;
                }
                if !self.images.contains_key(&path) {
                    match load_png(Path::new(&path)) {
                        Ok(img) => {
                            self.images.insert(path.clone(), std::sync::Arc::new(img));
                        }
                        Err(e) => {
                            self.failed.insert(path, e.to_string());
                            return None;
                        }
                    }
                }
                Pixels::Cover(self.images[&path].clone(), key_of(&path))
            }
        })
    }

    /// The clip's Adjust sliders (CapCut's colour adjustments), if any.
    fn adjust_of(&self, seg: &Segment) -> Option<(Adjust, Option<&ExposureLuts>)> {
        let mut a = Adjust::default();
        let mut bundle = None;
        for e in seg.attachments.iter().filter_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id && e.category == EffectCategory::Adjust)) {
            let v = e.params.get("intensity").copied().unwrap_or(0.0) as f32;
            let slot = match e.builtin.as_deref() {
                Some("brightness") => &mut a.brightness,
                Some("contrast") => &mut a.contrast,
                Some("saturation") => &mut a.saturation,
                Some("highlights") => &mut a.highlights,
                Some("shadows") => &mut a.shadows,
                Some("whites") => &mut a.whites,
                Some("blacks") => &mut a.blacks,
                Some("temperature") => &mut a.temperature,
                Some("tint") => &mut a.tint,
                Some("exposure") => &mut a.exposure,
                Some("sharpen") => &mut a.sharpen,
                _ => continue,
            };
            *slot = v;
            bundle = bundle.or(e.resource.as_deref());
        }
        // Primary colour wheels (log wheels aren't drawn yet).
        if let Some(w) = seg.attachments.iter().find_map(|id| self.project.materials.color_wheels.iter().find(|w| &w.id == id && !w.log)) {
            let wheel = |v: &openrip_model::WheelValue| openrip_render::Wheel { red: v.red as f32, green: v.green as f32, blue: v.blue as f32, luma: v.luma as f32, saturation: v.saturation as f32 };
            a.wheels = openrip_render::Wheels { lift: wheel(&w.lift), gamma: wheel(&w.gamma), gain: wheel(&w.gain), offset: wheel(&w.offset), intensity: w.intensity as f32 };
        }
        if a.is_identity() {
            return None;
        }
        Some((a, bundle.and_then(|b| self.exposure_luts.get(b)).and_then(Option::as_ref)))
    }

    /// A text style at a font size of `em` pixels. Sizes are fractions of the font size, on
    /// the same provisional scale as a run's stroke.
    fn text_effect(&mut self, fx: &TextEffect, em: f32, text_color: openrip_model::Rgba) -> text::Effect {
        let mut paint = |p: &openrip_model::Paint| -> Option<text::Paint> {
            Some(match &p.kind {
                PaintKind::Solid(c) => text::Paint::Solid([c.r, c.g, c.b, c.a * p.alpha]),
                PaintKind::TextColor { hue, saturation, brightness } => {
                    let [r, g, b] = shift_hsb([text_color.r, text_color.g, text_color.b], *hue, *saturation, *brightness);
                    text::Paint::Solid([r, g, b, text_color.a * p.alpha])
                }
                PaintKind::Texture(t) => {
                    let image = self.textures.entry(t.path.clone()).or_insert_with(|| load_png(Path::new(&t.path)).ok().map(|mut img| {
                        for px in img.data.chunks_exact_mut(4) {
                            let a = px[3] as u32;
                            for c in &mut px[..3] {
                                *c = ((*c as u32 * a + 127) / 255) as u8;
                            }
                        }
                        std::sync::Arc::new(img)
                    }));
                    text::Paint::Texture(text::TexturePaint {
                        image: image.clone()?,
                        columns: t.columns.max(1),
                        radians: t.angle_deg.to_radians(),
                        scale: if t.scale > 0.0 { t.scale } else { 1.0 },
                        stretch: match t.stretch {
                            TextureStretch::Fit => 0,
                            TextureStretch::Fill => 1,
                            TextureStretch::Stretch => 2,
                        },
                        alpha: t.alpha * p.alpha,
                    })
                }
            })
        };
        let strokes = |list: &[openrip_model::EffectStroke], paint: &mut dyn FnMut(&openrip_model::Paint) -> Option<text::Paint>| list.iter().filter_map(|s| Some((s.width * em, paint(&s.paint)?))).collect::<Vec<_>>();
        text::Effect {
            fill: fx.fill.as_ref().and_then(&mut paint),
            strokes: strokes(&fx.strokes, &mut paint),
            shadows: fx
                .shadows
                .iter()
                .filter_map(|sh| {
                    let a = sh.angle_deg.to_radians();
                    Some(text::Shadow {
                        paint: paint(&sh.paint)?,
                        offset: [sh.distance * em * a.cos(), -sh.distance * em * a.sin()],
                        blur: sh.blur * em,
                        strokes: strokes(&sh.strokes, &mut paint),
                    })
                })
                .collect(),
            edge_fade: if fx.sharp_edges { 0.0 } else { text::MESH_EDGE_FADE },
        }
    }

    /// Read the exposure tables from a clip's CapCut colour bundle, once per bundle.
    fn load_exposure_luts(&mut self, seg: &Segment) {
        let bundles: Vec<String> = seg
            .attachments
            .iter()
            .filter_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id && e.builtin.as_deref() == Some("exposure")))
            .filter_map(|e| e.resource.clone())
            .filter(|b| !self.exposure_luts.contains_key(b))
            .collect();
        for b in bundles {
            let dir = Path::new(&b).join("AmazingFeature_adjustColor").join("image");
            let read = |name: &str| load_png(&dir.join(name)).ok().filter(|i| (i.width, i.height) == (289, 17)).map(std::sync::Arc::new);
            let luts = read("lightSensation_min.png").zip(read("lightSensation_max.png")).map(|(darker, brighter)| ExposureLuts { key: key_of(&b) & !1, darker, brighter });
            self.exposure_luts.insert(b, luts);
        }
    }

    fn pixels(&mut self, seg: &Segment, t: Micros, w: u32, h: u32) -> Result<Option<Pixels>, (String, String)> {
        if let Some(text) = self.project.materials.texts.iter().find(|m| m.id == seg.material).cloned() {
            let Some(run) = text.runs.first() else { return Ok(None) };
            let path = if !run.font.path.is_empty() && Path::new(&run.font.path).exists() {
                run.font.path.clone()
            } else {
                let name = run.font.name.clone();
                self.font_files.entry(name.clone()).or_insert_with(|| font_file_for(&name)).clone()
            };
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
                // The size sets the font's line box, not its em (docs/parity/calibration.md).
                SizeUnit::CapCut => run.size * CAPCUT_SIZE_UNIT_EM * w as f32 / self.fonts[&path].line_box_em().max(0.1),
                SizeUnit::CanvasHeight => run.size * h as f32,
            } * scale.x.abs() as f32;
            let to_u8 = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            let rgba = |c: openrip_model::Rgba| [to_u8(c.r), to_u8(c.g), to_u8(c.b), to_u8(c.a)];
            let animations: Vec<Animation> = seg.attachments.iter().filter_map(|id| self.project.materials.animations.iter().find(|m| &m.id == id)).flat_map(|m| m.items.iter().cloned()).collect();
            // Each character's own fill colour, from its run.
            let own: Vec<[u8; 4]> = {
                let mut own = vec![rgba(run.fill); text.text.chars().count()];
                for r in &text.runs[1..] {
                    for c in own.iter_mut().take(r.range.1 as usize).skip(r.range.0 as usize) {
                        *c = rgba(r.fill);
                    }
                }
                own
            };
            // A caption that follows the speech shows a page of its words at a time.
            let (shown, char_colors) = match crate::caption::caption_frame(&animations, &text.text, &text.words, local) {
                Some(None) => return Ok(None),
                Some(Some(f)) => {
                    let (a, b) = (f.page.0 as usize, f.page.1 as usize);
                    let mut colors = own[a..b].to_vec();
                    for (k, w) in f.words.iter().enumerate() {
                        for c in w.0 as usize..w.1 as usize {
                            colors[c - a] = f.style.color(own[c], f.reading == Some(k));
                        }
                    }
                    (text.text.chars().skip(a).take(b - a).collect::<String>(), Some(colors))
                }
                None => (text.text.clone(), own.iter().any(|c| *c != own[0]).then(|| own.clone())),
            };
            // A library text style attached to the clip replaces the run's colour and stroke.
            let styled = seg.attachments.iter().find_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id).and_then(|e| Some((e.id.clone(), e.text_style.clone()?))));
            let effect = styled.as_ref().map(|(_, fx)| self.text_effect(fx, em, run.fill));
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
                // Measured (docs/parity/calibration.md, sessions 3 and 5): the stroke reaches
                // `width` em outside the glyphs; the background pads each line by its
                // width/height in em, with corners of 0.55 em × the clip's scale per unit of
                // radius.
                stroke: run.stroke.filter(|s| s.width > 0.0).map(|s| ([to_u8(s.color.r), to_u8(s.color.g), to_u8(s.color.b), to_u8(s.color.a)], s.width * em)),
                background: text.layout.background.map(|b| {
                    let pad = [b.width * em, b.height * em];
                    let radius = if b.style == 2 { b.corner_radius * 0.55 * em * scale.x.abs() as f32 } else { 0.0 };
                    ([to_u8(b.color.r), to_u8(b.color.g), to_u8(b.color.b), to_u8(b.color.a)], pad, radius)
                }),
                // Distance and blur are fractions of the font size (for CapCut, its line box).
                shadow: text.layout.shadow.filter(|sh| sh.color.a > 0.0).map(|sh| {
                    let size = if run.size_unit == SizeUnit::CapCut { em * self.fonts[&path].line_box_em() } else { em };
                    let a = sh.angle_deg.to_radians();
                    (rgba(sh.color), [sh.distance * size * a.cos(), -sh.distance * size * a.sin()], sh.smoothing * size)
                }),
                // A fraction of the canvas width at the clip's scale 1; it scales with the clip.
                // A text box wraps at its own width.
                max_width: text.layout.max_width.or(text.layout.frame.map(|fr| fr.width)).map(|f| f * w as f32 * scale.x.abs() as f32),
                // CapCut's synthetic styles: bold widens the glyphs by `bold_width` (0.008 in
                // every local draft) in the stroke's unit, italic shears them by
                // `italic_degree` (always 10); both match CapCut (session 5).
                bold: if run.bold { 0.008 * em } else { 0.0 },
                italic: if run.italic { 10.0 } else { 0.0 },
                effect: effect.as_ref(),
                char_colors: char_colors.as_deref(),
            };
            let lay = text::layout(&shown, &style);
            // Library text animations (typing reveals) as per-character opacity.
            let char_alpha = crate::animation::char_alpha(&animations, shown.chars().count(), local);
            // Block centre on the canvas; rasterise so the image sits on the pixel grid. In a text
            // box the block sits at the box's side or middle, by its alignments.
            let (mut cx, mut cy) = (w as f64 / 2.0 + pos.x * w as f64 / 2.0, h as f64 / 2.0 - pos.y * h as f64 / 2.0);
            if let Some(fr) = text.layout.frame {
                let (bw, bh) = (fr.width as f64 * w as f64 * scale.x.abs(), fr.height as f64 * h as f64 * scale.y.abs());
                let (slack_x, slack_y) = ((bw - lay.width as f64) / 2.0, (bh - lay.height as f64) / 2.0);
                cx += match text.layout.alignment {
                    0 => -slack_x,
                    2 => slack_x,
                    _ => 0.0,
                };
                cy += match fr.vertical_align {
                    0 => -slack_y,
                    2 => slack_y,
                    _ => 0.0,
                };
            }
            let (x0, y0) = (cx - lay.width as f64 / 2.0, cy - lay.height as f64 / 2.0);
            let origin = [x0.rem_euclid(1.0) as f32, y0.rem_euclid(1.0) as f32];
            // Everything but the per-character opacity, which animations change every frame.
            let shape_key = key_of((
                &path,
                &shown,
                &char_colors,
                em.to_bits(),
                style.color,
                style.stroke.map(|(c, r)| (c, r.to_bits())),
                (
                    style.background.map(|(c, p, r)| (c, p[0].to_bits(), p[1].to_bits(), r.to_bits())),
                    style.shadow.map(|(c, o, b)| (c, o[0].to_bits(), o[1].to_bits(), b.to_bits())),
                ),
                text.layout.alignment,
                text.layout.letter_spacing.to_bits(),
                text.layout.line_spacing.to_bits(),
                (style.max_width.map(f32::to_bits), origin[0].to_bits(), origin[1].to_bits(), style.bold.to_bits(), style.italic.to_bits()),
                styled.as_ref().map(|(id, _)| id),
            ));
            let key = key_of((shape_key, char_alpha.as_ref().map(|a| a.iter().map(|v| (v * 255.0).round() as u8).collect::<Vec<_>>())));
            let tick = self.tick;
            let (image, center) = match self.texts.get_mut(&key) {
                Some((img, center, last)) => {
                    *last = tick;
                    (img.clone(), *center)
                }
                None => {
                    let r = match style.effect {
                        // Styled text is slow to draw: keep its pieces, so an animation only
                        // puts them together again.
                        Some(fx) => {
                            let prepared = match self.prepared.get_mut(&shape_key) {
                                Some((p, last)) => {
                                    *last = tick;
                                    p.clone()
                                }
                                None => {
                                    let p = std::sync::Arc::new(lay.prepare_effect(&style, fx, origin));
                                    self.prepared.insert(shape_key, (p.clone(), tick));
                                    p
                                }
                            };
                            prepared.composite(char_alpha.as_deref())
                        }
                        None => lay.rasterize_with_alpha(&style, origin, char_alpha.as_deref()),
                    };
                    let img = std::sync::Arc::new(r.image);
                    self.texts.insert(key, (img.clone(), r.center, tick));
                    (img, r.center)
                }
            };
            let at = [cx - (center[0] - image.width as f64 / 2.0), cy - (center[1] - image.height as f64 / 2.0)];
            return Ok(Some(Pixels::Text(image, key, at)));
        }
        // A filter track's segment: CapCut's lookup table from the filter's bundle.
        if let Some(effect) = self.project.materials.effects.iter().find(|e| e.id == seg.material && e.category == EffectCategory::Filter) {
            let strength = effect.params.get("intensity").copied().unwrap_or(1.0) as f32;
            let Some(bundle) = effect.resource.clone() else { return Ok(None) };
            if let Some(why) = self.failed.get(&bundle) {
                return Err((bundle.clone(), why.clone()));
            }
            if !self.filters.contains_key(&bundle) {
                let lut = load_filter(Path::new(&bundle), key_of(&bundle)).map_err(|why| (bundle.clone(), why))?;
                self.filters.insert(bundle.clone(), std::sync::Arc::new(lut));
            }
            return Ok(Some(Pixels::Filter(self.filters[&bundle].clone(), strength)));
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

    fn layers<'a>(&'a self, pixels: &'a [(Segment, Pixels)], t: Micros, w: u32, h: u32) -> Vec<Layer<'a>> {
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
                    Pixels::Filter(lut, strength) => Layer {
                        source: Source::Filter(lut, *strength),
                        center: [0.0, 0.0],
                        size: [1.0, 1.0],
                        rotation: 0.0,
                        flip_h: false,
                        flip_v: false,
                        opacity: 1.0,
                        adjust: None,
                    },
                    // Twice the canvas, so the image's soft edge is off it.
                    Pixels::Wash(img, key, amount) => Layer {
                        source: Source::Cached(*key, img),
                        center: [w as f64 / 2.0, h as f64 / 2.0],
                        size: [2.0 * w as f64, 2.0 * h as f64],
                        rotation: 0.0,
                        flip_h: false,
                        flip_v: false,
                        opacity: *amount,
                        adjust: None,
                    },
                    Pixels::Cover(img, key) => {
                        let fit = (w as f64 / img.width as f64).max(h as f64 / img.height as f64);
                        Layer {
                            source: Source::Cached(*key, img),
                            center: [w as f64 / 2.0, h as f64 / 2.0],
                            size: [img.width as f64 * fit, img.height as f64 * fit],
                            rotation: 0.0,
                            flip_h: false,
                            flip_v: false,
                            opacity: 1.0,
                            adjust: None,
                        }
                    }
                    Pixels::Blur(px) => Layer { source: Source::Blur(*px), center: [0.0, 0.0], size: [1.0, 1.0], rotation: 0.0, flip_h: false, flip_v: false, opacity: 1.0, adjust: None },
                    Pixels::Text(img, key, at) => Layer {
                        source: Source::Cached(*key, img),
                        center: *at,
                        size: [img.width as f64, img.height as f64],
                        rotation: rot,
                        flip_h: tr.flip_h,
                        flip_v: tr.flip_v,
                        opacity: 1.0,
                        adjust: None,
                    },
                };
                if !matches!(p, Pixels::Wash(..) | Pixels::Cover(..) | Pixels::Blur(_)) {
                    layer.opacity *= seg.opacity.sample(local);
                }
                if matches!(p, Pixels::Image(..) | Pixels::Video(..)) {
                    layer.adjust = self.adjust_of(seg);
                }
                layer
            })
            .collect()
    }
}

/// A CapCut filter's lookup table from its bundle: `AmazingFeature/texture/*.vf`. Filters
/// with a skin/background pair use the background table, as CapCut does where it finds no
/// skin.
fn load_filter(bundle: &Path, key: u64) -> Result<Lut3d, String> {
    let dir = bundle.join("AmazingFeature").join("texture");
    let mut tables: Vec<_> = std::fs::read_dir(&dir).map_err(|e| e.to_string())?.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "vf")).collect();
    tables.sort_by_key(|p| !p.file_name().is_some_and(|n| n.to_string_lossy().contains("bg")));
    let file = tables.first().ok_or("no lookup table in the filter bundle")?;
    Lut3d::from_vf(&std::fs::read(file).map_err(|e| e.to_string())?, key).ok_or_else(|| format!("unreadable lookup table {}", file.display()))
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

/// A font file for a family name: an installed font whose file is named after it (e.g.
/// "Arial" → Arial.ttf) in the system and user font folders; otherwise CapCut's default font
/// if CapCut is installed, otherwise Helvetica. Bold and italic stay synthetic.
fn font_file_for(name: &str) -> String {
    let mut dirs = vec!["/System/Library/Fonts/Supplemental".to_string(), "/System/Library/Fonts".to_string(), "/Library/Fonts".to_string()];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(Path::new(&home).join("Library/Fonts").to_string_lossy().into_owned());
    }
    if !name.trim().is_empty() {
        for dir in &dirs {
            for ext in ["ttf", "otf", "ttc"] {
                let p = Path::new(dir).join(format!("{}.{ext}", name.trim()));
                if p.exists() {
                    return p.to_string_lossy().into_owned();
                }
            }
        }
    }
    if Path::new(DEFAULT_FONT).exists() {
        DEFAULT_FONT.to_string()
    } else {
        "/System/Library/Fonts/Helvetica.ttc".to_string()
    }
}

/// An RGB colour (0..1) shifted in HSB: hue by degrees, saturation and brightness by
/// offsets, each kept in range.
fn shift_hsb([r, g, b]: [f32; 3], hue: f32, saturation: f32, brightness: f32) -> [f32; 3] {
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let d = max - min;
    let h = if d == 0.0 {
        0.0
    } else if max == r {
        60.0 * ((g - b) / d).rem_euclid(6.0)
    } else if max == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    let s = if max > 0.0 { d / max } else { 0.0 };
    let (h, s, v) = ((h + hue).rem_euclid(360.0), (s + saturation).clamp(0.0, 1.0), (max + brightness).clamp(0.0, 1.0));
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0).rem_euclid(2.0) - 1.0).abs());
    let (r, g, b) = match (h / 60.0) as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = v - c;
    [r + m, g + m, b + m]
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
