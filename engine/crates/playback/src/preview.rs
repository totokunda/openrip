//! Preview rendering: a project at a time → one composited frame.
//!
//! [`PreviewEngine`] keeps decoders, still images and fonts between frames, so playing or
//! scrubbing a project only decodes what changed. Hardware video frames go to the GPU
//! without a copy; text is rasterised by the engine. Media that can't be loaded (missing
//! files are common in CapCut projects copied between machines) is skipped and reported.

use std::collections::HashMap;
use std::path::Path;

pub use openrip_media::load_png;
use openrip_media::{open_video, Decoder, DecoderOptions, MediaError, ReverseReader, VideoFrame};
use openrip_model::{Animation, CanvasFillKind, CropRect, EffectCategory, MediaKind, Micros, PaintKind, Project, Segment, SizeUnit, TextEffect, TextureStretch, TrackKind, CAPCUT_SIZE_UNIT_EM};
use openrip_platform::assets;
use openrip_render::fonts;
use openrip_render::text::{self, Align, Font, TextStyle};
use openrip_render::{Adjust, Compositor, ExposureLuts, Layer, Lut3d, Picture, RenderError, RgbaImage, Source, Surface, Tween, TweenMode, Uploader};

/// CapCut's default font, for CapCut's own text whose font isn't found (a draft names it).
/// OpenRip's own text never uses it.
const CAPCUT_FONT: &str = "/Applications/CapCut.app/Contents/Resources/Font/SystemFont/en.ttf";
/// The system fonts OpenRip's own text falls back to, in order: Konva's default family, as the
/// app's own text box shows it, then Helvetica.
const APP_FONTS: [&str; 2] = ["Arial", "Helvetica"];
/// A frame this close to a source frame (as a fraction of the frame's length) shows that
/// frame rather than one made between it and the next.
const TWEEN_EDGE: f64 = 0.02;
/// Decoders kept open; the least recently used is closed beyond this.
const MAX_DECODERS: usize = 12;
/// Decoded-frame cache per preview decoder: room to step back through a 1080p GOP without
/// holding gigabytes across a dozen open clips.
const DECODER_CACHE: usize = 128 << 20;
/// Clips starting this soon get their decoder opened and positioned in the background.
const PREFETCH: Micros = Micros(1_500_000);
/// Memory for decoded stills; the least recently drawn go first beyond it (a 4K still is
/// 33 MB, and drafts can hold hundreds).
const STILLS_BUDGET: usize = 512 << 20;
/// Decoded frames a reversed clip keeps in each window while it plays (two windows are held;
/// see `ReverseReader`): a GOP of 4K pictures at the preview's size, or ten whole ones.
const REVERSE_WINDOW: usize = 256 << 20;

/// Media to get ready off the render thread: a decoder positioned at a clip's in-point, or
/// a still image decoded (and written to the GPU).
struct PrefetchJob {
    segment: String,
    path: String,
    at: Micros,
    still: bool,
    /// Write the still to the GPU too: only while frames follow each other (playback,
    /// export). Seeking and dragging the playhead go elsewhere, and the stills would wait on
    /// the GPU for nothing.
    upload: bool,
}

enum Prefetched {
    /// Segment, media path, decoder.
    Decoder(String, String, Decoder),
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
    worker: Option<openrip_platform::tasks::Task>,
}

impl Prefetcher {
    fn new(uploader: Uploader) -> Prefetcher {
        let (job_tx, job_rx) = std::sync::mpsc::channel::<PrefetchJob>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let worker = openrip_platform::tasks::spawn("decoder-prefetch", move || {
            for job in job_rx {
                // Report failures too: the render thread may be waiting for this job.
                let done = if job.still {
                    match load_still(Path::new(&job.path)) {
                        Ok(img) => {
                            if job.upload {
                                uploader.upload(still_key(&job.path), &img);
                            }
                            Prefetched::Still(job.path, img)
                        }
                        Err(_) => Prefetched::Failed(job.path),
                    }
                } else {
                    let opened = open_video(Path::new(&job.path), &DecoderOptions { cache_bytes: DECODER_CACHE, ..Default::default() });
                    // Decode the first frame now (it stays in the decoder's cache).
                    match opened.map(|mut d| d.frame_at(job.at).is_ok().then_some(d)) {
                        Ok(Some(d)) => Prefetched::Decoder(job.segment, job.path, d),
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
    #[error("can't start the preview worker: {0}")]
    Worker(std::io::Error),
}

/// The glow's softening (standard deviation, px) on a canvas 1080 px across its short side:
/// CapCut's 9-tap blur at 1.25 px a tap, there.
const GLOW_SOFTEN: f32 = 4.6;

/// A model gradient as the text renderer takes it.
fn render_gradient(g: &openrip_model::Gradient) -> text::Gradient {
    text::Gradient {
        colors: g.colors.iter().map(|c| [c.r, c.g, c.b, c.a]).collect(),
        stops: g.stops.clone(),
        radians: g.angle_deg.to_radians(),
        span: match g.span {
            openrip_model::GradientSpan::Character => text::Span::Character,
            openrip_model::GradientSpan::Line => text::Span::Line,
            openrip_model::GradientSpan::Text => text::Span::Text,
        },
    }
}

/// What a frame needed that couldn't be drawn.
#[derive(Clone, Debug, Default)]
pub struct FrameReport {
    pub layers: usize,
    /// Media or font files that failed to load (path and reason), once per frame.
    pub missing: Vec<(String, String)>,
}

/// A mask in the stored picture's axes and what it shows inside and outside (a straight
/// colour, or the clip's own pixels for `None`).
type Painted = (std::sync::Arc<RgbaImage>, Option<[f32; 4]>, Option<[f32; 4]>);

enum Pixels {
    /// A still, its cache key, and its masks.
    Image(std::sync::Arc<RgbaImage>, u64, Vec<Painted>),
    /// A frame, the clockwise turn that displays it upright (phone video), and its masks
    /// (its cut-out first, if its background is removed).
    Video(VideoFrame, i32, Vec<Painted>),
    /// A frame made between two source frames (Smooth slow-mo, Optical flow): the two
    /// frames, how far between them, the pair's key, how it's made, the turn and the masks.
    Tween(Box<(VideoFrame, VideoFrame)>, f32, u64, TweenMode, i32, Vec<Painted>),
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
    /// A rasterised shape's layers (image, cache key, multiplies) and the canvas point their
    /// centres go to.
    Shape(Vec<(std::sync::Arc<RgbaImage>, u64, bool)>, [f64; 2]),
    /// A sticker's picture (the GIF's current frame) and its cache key.
    Sticker(std::sync::Arc<RgbaImage>, u64, [u32; 2]),
    /// A transition's clip begins: what follows draws into a group of its own over this
    /// colour (or clear), up to `End`.
    Begin(Option<[u8; 3]>),
    End,
    /// The transition's groups put together.
    Mix(openrip_render::Mix),
    /// One of OpenRip's own video effects over everything below it (an effect bar), or over
    /// the clip's group (an effect on the clip).
    Effect(openrip_render::EffectPass),
    /// A main-track clip's own picture covering the canvas and blurred (its canvas fill), the
    /// blur's taps this many output pixels apart.
    Backdrop(Backdrop, f32),
}

/// The picture a blurred canvas fill is made of: the clip's frame (and its turn), or its
/// still.
enum Backdrop {
    Video(VideoFrame, i32),
    Image(std::sync::Arc<RgbaImage>, u64),
}

/// How far CapCut's canvas blur reaches at its strongest (`amount` 1): the blur's standard
/// deviation as a fraction of the canvas's shorter side. Provisional: no local draft blurs
/// its canvas, so it's judged from the panel's previews of the four levels, not measured.
const CANVAS_BLUR: f64 = 0.1;

/// The standard deviation of one blur pass (filter.wgsl's `fs_blur` weights), in taps.
const BLUR_SIGMA_TAPS: f64 = 4.03;

/// The media file a segment plays (for a reversed clip, the copy played backward when it has
/// one; see `timing`).
fn media_path(p: &Project, segment: &str) -> Option<String> {
    let s = p.tracks.iter().flat_map(|t| t.segments.iter()).find(|s| s.id == segment)?;
    let m = p.materials.media.iter().find(|m| m.id == s.material)?;
    Some(match m.kind {
        MediaKind::Audio => m.path.clone(),
        _ => crate::timing::picture(p, s, m, s.target.start).path().to_string(),
    })
}

/// A shape's paths as the rasteriser's outlines, in its box of `size` units: each path, then
/// the marks on its open ends (arrows, dots) filled in its stroke's colour.
fn render_paths(paths: &[openrip_model::ShapePath], size: [f32; 2]) -> Vec<openrip_render::shape::ShapePath> {
    use openrip_model::{Geometry, PathBlend, StrokeDash, StrokeEnds, StrokeMarker};
    use openrip_render::shape::{self as sh, Blend, Dash, Ends, Marker};
    let rgba = |c: openrip_model::Rgba| [c.r, c.g, c.b, c.a].map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8);
    let marker = |m: StrokeMarker| match m {
        StrokeMarker::None => Marker::None,
        StrokeMarker::Arrow => Marker::Arrow,
        StrokeMarker::Dot => Marker::Dot,
    };
    let [w, h] = size;
    let mut out = Vec::new();
    for p in paths {
        let commands = match &p.geometry {
            Geometry::Rectangle { corner_radius } => sh::rectangle(w, h, *corner_radius),
            Geometry::Ellipse => sh::ellipse(w, h),
            Geometry::Polygon { sides, radius, corner_radius } => sh::polygon(w, h, *sides, *radius, *corner_radius),
            Geometry::Star { points, inner, outer } => sh::star(w, h, *points, *inner, *outer),
            Geometry::Line { points, tension, closed } => sh::line(points, *tension, *closed),
            Geometry::Vertices { points, corner_radius } => sh::vertices(points, *corner_radius),
            Geometry::Path { nodes, closed } => sh::path(nodes, *closed),
        };
        let blend = match p.blend {
            PathBlend::Normal => Blend::Normal,
            PathBlend::Multiply => Blend::Multiply,
            PathBlend::Erase => Blend::Erase,
        };
        let (commands, marks) = match &p.stroke {
            Some(s) => sh::with_markers(commands, s.width, marker(s.start), marker(s.end)),
            None => (commands, Vec::new()),
        };
        out.push(sh::ShapePath {
            commands,
            fill: p.fill.map(rgba),
            stroke: p.stroke.map(|s| {
                // Dots are round dashes.
                let ends = match (s.dash, s.ends) {
                    (StrokeDash::Dotted, _) | (_, StrokeEnds::Round) => Ends::Round,
                    (_, StrokeEnds::Butt) => Ends::Butt,
                    (_, StrokeEnds::Square) => Ends::Square,
                };
                (rgba(s.color), s.width, ends)
            }),
            dash: p.stroke.map_or(Vec::new(), |s| {
                let style = match s.dash {
                    StrokeDash::Solid => Dash::Solid,
                    StrokeDash::Dashed => Dash::Dashed,
                    StrokeDash::Dotted => Dash::Dotted,
                };
                sh::dashes(style, s.width)
            }),
            opacity: p.opacity,
            blend,
        });
        if let Some(s) = &p.stroke {
            out.extend(marks.into_iter().map(|commands| sh::ShapePath { commands, fill: Some(rgba(s.color)), stroke: None, dash: Vec::new(), opacity: p.opacity, blend }));
        }
    }
    out
}

/// Everything that changes a shape's pixels.
fn shape_key(shape: &openrip_model::Shape, px: f32, scale: [f32; 2], origin: [f32; 2]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    [px, scale[0], scale[1], origin[0], origin[1]].map(f32::to_bits).hash(&mut h);
    // The shape as stored: its box, paths and shadow (its id doesn't change its pixels).
    serde_json::to_vec(&(&shape.size, &shape.scale, &shape.unit, &shape.paths, &shape.shadow)).unwrap_or_default().hash(&mut h);
    let mut out = std::collections::hash_map::DefaultHasher::new();
    ("shape", h.finish()).hash(&mut out);
    out.finish()
}

fn painted(mattes: &[Painted]) -> Vec<openrip_render::Matte<'_>> {
    mattes.iter().map(|(mask, inside, outside)| openrip_render::Matte { mask, inside: *inside, outside: *outside }).collect()
}

/// An 8-bit mask over an upright `w`×`h` picture, turned into the stored picture's axes
/// (undoing the clockwise turn that displays it upright), as an RGBA image.
fn turn_to_stored(upright: &[u8], w: u32, h: u32, orientation: i32) -> RgbaImage {
    let (sw, sh) = if orientation.rem_euclid(180) == 90 { (h, w) } else { (w, h) };
    let mut data = vec![0u8; (sw * sh * 4) as usize];
    for y in 0..sh {
        for x in 0..sw {
            let (ux, uy) = match orientation.rem_euclid(360) {
                90 => (sh - 1 - y, x),
                180 => (sw - 1 - x, sh - 1 - y),
                270 => (y, sw - 1 - x),
                _ => (x, y),
            };
            data[((y * sw + x) * 4) as usize..][..4].fill(upright[(uy * w + ux) as usize]);
        }
    }
    RgbaImage { width: sw, height: sh, data }
}

fn key_of(v: impl std::hash::Hash) -> u64 {
    use std::hash::Hasher;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    v.hash(&mut h);
    h.finish()
}

/// The compositor's key for the still at `path` (the threads that write stills to the GPU
/// ahead of time file them under it).
pub(crate) fn still_key(path: &str) -> u64 {
    key_of(path)
}

/// A reversed clip's backward reader while it plays, with the file it reads.
struct Reverser {
    reader: ReverseReader,
    path: String,
    last_used: u64,
}

struct OpenDecoder {
    decoder: Decoder,
    /// The file it reads (a reversed clip's may be the copy played backward).
    path: String,
    last_used: u64,
}

pub struct PreviewEngine {
    project: Project,
    compositor: Compositor,
    /// One decoder per segment, so two clips of the same file at different times don't
    /// fight over one decoder's position.
    decoders: HashMap<String, OpenDecoder>,
    /// Reversed clips playing, by segment (see `reversed_frame`).
    reversers: HashMap<String, Reverser>,
    /// Decoded stills by path, with the tick last used (see `STILLS_BUDGET`).
    images: HashMap<String, (std::sync::Arc<RgbaImage>, u64)>,
    fonts: HashMap<String, Font>,
    /// Paths that failed to load, so they aren't retried every frame.
    failed: HashMap<String, String>,
    /// Rasterised text by content/style/size/sub-pixel origin, with the tick last used.
    texts: HashMap<u64, (std::sync::Arc<RgbaImage>, [f64; 2], u64)>,
    /// Rasterised shapes' layers and box centres, by everything that draws them.
    shapes: HashMap<u64, (Vec<(std::sync::Arc<RgbaImage>, u64, bool)>, [f64; 2], u64)>,
    /// The block of the text drawn last (left, top, width, height in output pixels).
    last_text_block: Option<[f64; 4]>,
    /// Lay text out without drawing it (`text_block`).
    measure_only: bool,
    /// While the playhead is dragged: video shows a frame that's quick to get (already
    /// decoded, a short decode ahead, or the GOP's keyframe) rather than the exact one, and
    /// pictures are stand-ins at about the frame's size, got ready ahead of the drag.
    scrubbing: bool,
    scrub: crate::scrub::ScrubAhead,
    /// Background-removal masks by file, with the tick they were last used.
    mattes: HashMap<String, (std::sync::Arc<RgbaImage>, u64)>,
    /// Picture masks' distance fields by path (`None` if unreadable).
    mask_fields: HashMap<String, Option<std::sync::Arc<crate::mask::Field>>>,
    /// The frame times each background-removal folder has masks for.
    matte_times: HashMap<String, std::sync::Arc<Vec<i64>>>,
    /// CapCut's exposure tables by colour-bundle path (`None` if they couldn't be read).
    exposure_luts: HashMap<String, Option<ExposureLuts>>,
    /// Filter lookup tables by bundle path.
    filters: HashMap<String, std::sync::Arc<Lut3d>>,
    /// Color match's generated tables, by their parameters.
    matches: HashMap<u64, std::sync::Arc<Lut3d>>,
    /// Styled text in pieces (see `PreparedText`), by everything but per-character opacity.
    prepared: HashMap<u64, (std::sync::Arc<text::PreparedText>, u64)>,
    /// Font files found for family names (see `font_file_for`).
    font_files: HashMap<String, String>,
    /// The font book's faces by family, bold, italic and whether installed fonts count, with
    /// the book's generation they were found in (see `resolve_font`).
    resolved_fonts: HashMap<(String, bool, bool, bool), (u64, Option<fonts::Resolved>)>,
    /// Text-style textures (premultiplied) by path; `None` if unreadable.
    textures: HashMap<String, Option<std::sync::Arc<RgbaImage>>>,
    /// Decoded stickers.
    stickers: crate::sticker::Stickers,
    prefetch: Prefetcher,
    tick: u64,
    /// The time of the last frame gathered.
    last_time: Option<Micros>,
    /// The frame being gathered follows the last one (playing or exporting).
    following: bool,
    /// The frame is for a preview surface (shown at its size), not an export or a still.
    preview_surface: bool,
    /// The canvas colour of the frame gathered last: its main-track clip's canvas fill, if
    /// it's a colour, else black.
    background: [u8; 3],
}

impl PreviewEngine {
    pub fn new(project: Project) -> Result<Self, PreviewError> {
        openrip_media::warm_up();
        let compositor = Compositor::new()?;
        let uploader = compositor.uploader();
        Ok(PreviewEngine {
            project,
            decoders: HashMap::new(),
            reversers: HashMap::new(),
            images: HashMap::new(),
            fonts: HashMap::new(),
            failed: HashMap::new(),
            texts: HashMap::new(),
            shapes: HashMap::new(),
            last_text_block: None,
            scrubbing: false,
            scrub: crate::scrub::ScrubAhead::new(Some(uploader.clone())),
            measure_only: false,
            mattes: HashMap::new(),
            mask_fields: HashMap::new(),
            matte_times: HashMap::new(),
            exposure_luts: HashMap::new(),
            filters: HashMap::new(),
            matches: HashMap::new(),
            textures: HashMap::new(),
            stickers: Default::default(),
            font_files: HashMap::new(),
            resolved_fonts: HashMap::new(),
            prepared: HashMap::new(),
            prefetch: Prefetcher::new(uploader),
            compositor,
            tick: 0,
            last_time: None,
            following: false,
            preview_surface: false,
            background: [0, 0, 0],
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
        self.scrub.forget_failures();
    }

    /// Quick frames for a playhead being dragged (see `scrubbing`); the exact frame again
    /// once it's off.
    pub fn set_scrubbing(&mut self, on: bool) {
        if self.scrubbing && !on {
            self.scrub.stop();
        }
        self.scrubbing = on;
    }

    /// Where a text segment's block of lines sits on the canvas at its start (left, top,
    /// width, height in canvas pixels, before its rotation), as it's drawn.
    pub fn text_block(&mut self, segment: &str) -> Option<[f64; 4]> {
        let seg = self.project.tracks.iter().flat_map(|t| t.segments.iter()).find(|s| s.id == segment)?.clone();
        self.project.materials.texts.iter().find(|m| m.id == seg.material)?;
        let (w, h) = (self.project.canvas.width, self.project.canvas.height);
        self.last_text_block = None;
        self.measure_only = true;
        let r = self.pixels(&seg, seg.target.start, w, h);
        self.measure_only = false;
        r.ok()?;
        self.last_text_block.take()
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
        let t0 = std::time::Instant::now();
        self.preview_surface = false;
        let (pixels, report) = self.gather(t, width, height);
        let t1 = std::time::Instant::now();
        let layers = self.layers(&pixels, t, width, height);
        let t2 = std::time::Instant::now();
        let written = self.compositor.pixels_written();
        let frame = self.compositor.render(width, height, self.background, &layers);
        if std::env::var_os("OPENRIP_TRACE").is_some() && t0.elapsed().as_millis() >= 30 {
            let ms = |a: std::time::Instant, b: std::time::Instant| (b - a).as_secs_f64() * 1e3;
            let mp = (self.compositor.pixels_written() - written) as f64 / 1e6;
            eprintln!("[preview] t={:.3}s {width}x{height}: gather {:.1} ms, layers {:.1} ms, composite and read back {:.1} ms ({} layers, {mp:.1} MP written to the GPU)", t.as_secs_f64(), ms(t0, t1), ms(t1, t2), ms(t2, std::time::Instant::now()), layers.len());
        }
        Ok((frame, report))
    }

    /// Render the frame at `t` into a surface for the platform to present (on Apple an
    /// IOSurface-backed BGRA pixel buffer, see [`Surface`]).
    pub fn render_into(&mut self, t: Micros, target: &mut Surface) -> Result<FrameReport, PreviewError> {
        let (w, h) = (target.width(), target.height());
        let t0 = std::time::Instant::now();
        self.preview_surface = true;
        let (pixels, report) = self.gather(t, w, h);
        let t1 = std::time::Instant::now();
        let layers = self.layers(&pixels, t, w, h);
        let t2 = std::time::Instant::now();
        let written = self.compositor.pixels_written();
        self.compositor.render_into(target, self.background, &layers)?;
        if std::env::var_os("OPENRIP_TRACE").is_some() && t0.elapsed().as_millis() >= 30 {
            let ms = |a: std::time::Instant, b: std::time::Instant| (b - a).as_secs_f64() * 1e3;
            let now = std::time::Instant::now();
            let mp = (self.compositor.pixels_written() - written) as f64 / 1e6;
            eprintln!("[preview] t={:.3}s {w}x{h}: gather {:.1} ms, layers {:.1} ms, composite {:.1} ms ({} layers, {mp:.1} MP written to the GPU)", t.as_secs_f64(), ms(t0, t1), ms(t1, t2), ms(t2, now), layers.len());
        }
        Ok(report)
    }

    /// Render the frame at `t` into an IOSurface-backed BGRA pixel buffer (see
    /// [`Compositor::output_surface`]) for the app to present.
    #[cfg(target_vendor = "apple")]
    pub fn render_to_surface(&mut self, t: Micros, target: &objc2_core_video::CVPixelBuffer) -> Result<FrameReport, PreviewError> {
        // Another retain on the buffer, for the surface's time.
        let buffer = unsafe { objc2_core_foundation::CFRetained::retain(std::ptr::NonNull::from(target)) };
        self.render_into(t, &mut Surface::from_pixel_buffer(buffer))
    }

    /// Render the frame at `t` into an NV12 pixel buffer for the encoder (export).
    #[cfg(target_vendor = "apple")]
    pub fn render_to_nv12(&mut self, t: Micros, target: &objc2_core_video::CVPixelBuffer) -> Result<FrameReport, PreviewError> {
        let (w, h) = (objc2_core_video::CVPixelBufferGetWidth(target) as u32, objc2_core_video::CVPixelBufferGetHeight(target) as u32);
        self.preview_surface = false;
        let (pixels, report) = self.gather(t, w, h);
        let layers = self.layers(&pixels, t, w, h);
        self.compositor.render_to_nv12(target, self.background, &layers)?;
        Ok(report)
    }

    /// The segments visible at `t`, bottom first (CapCut stacks by render index; text sits
    /// at 14000+, above video).
    fn active(&self, t: Micros) -> Vec<Segment> {
        let mut active: Vec<Segment> = self
            .project
            .tracks
            .iter()
            .filter(|tr| matches!(tr.kind, TrackKind::Video | TrackKind::Text | TrackKind::Sticker | TrackKind::Filter | TrackKind::Effect | TrackKind::Graphic) && !tr.hidden)
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
                    self.decoders.entry(segment).or_insert(OpenDecoder { decoder, path, last_used: self.tick });
                }
            }
            Prefetched::Still(path, img) => {
                self.prefetch.pending.remove(&path);
                let tick = self.tick;
                self.images.entry(path).or_insert_with(|| (std::sync::Arc::new(img), tick));
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

    /// Adopt decoders the prefetcher has finished, and queue clips starting soon after `t`
    /// (`upload`: writing their stills to the GPU too).
    fn run_prefetch(&mut self, t: Micros, upload: bool) {
        while let Ok(done) = self.prefetch.ready.try_recv() {
            self.adopt(done);
        }
        let Some(jobs) = &self.prefetch.jobs else { return };
        for track in self.project.tracks.iter().filter(|tr| matches!(tr.kind, TrackKind::Video) && !tr.hidden) {
            for seg in track.segments.iter().filter(|s| s.visible && s.target.start > t && s.target.start.0 <= t.0 + PREFETCH.0) {
                let Some(media) = self.project.materials.media.iter().find(|m| m.id == seg.material && m.kind != MediaKind::Audio) else { continue };
                let (path, at, still) = match crate::timing::picture(&self.project, seg, media, seg.target.start) {
                    crate::timing::Picture::Still(path) => (path, Micros::ZERO, true),
                    crate::timing::Picture::Video { path, at, .. } => (path, at, false),
                };
                // Stills are shared by path; decoders belong to a segment.
                let key = if still { path.clone() } else { seg.id.clone() };
                let ready = if still { self.images.contains_key(&key) } else { self.decoders.contains_key(&key) };
                if ready || self.prefetch.pending.contains(&key) || self.failed.contains_key(&path) {
                    continue;
                }
                let job = PrefetchJob { segment: seg.id.clone(), path, at, still, upload };
                if jobs.send(job).is_ok() {
                    self.prefetch.pending.insert(key);
                }
            }
        }
    }

    fn gather(&mut self, t: Micros, w: u32, h: u32) -> (Vec<(Segment, Pixels)>, FrameReport) {
        self.tick += 1;
        // Frames following each other: playing or exporting.
        let following = self.last_time.is_some_and(|last| t > last && t.0 - last.0 <= 250_000);
        self.following = following;
        self.last_time = Some(t);
        self.run_prefetch(t, following && !self.scrubbing);
        if self.scrubbing {
            self.scrub.moved(&self.project, t, w.max(h), &self.failed);
        }
        let mut report = FrameReport::default();
        let mut out = Vec::new();
        self.background = [0, 0, 0];
        let active = self.active(t);
        if !self.scrubbing && !self.measure_only {
            self.load_stills_beside(&active);
        }
        for seg in active {
            self.load_exposure_luts(&seg);
            self.load_clip_lut(&seg, &mut report);
            // A transition at the cut before or after this clip, and what it draws now.
            let cut = crate::transition::transition_at(&self.project, &seg, t).map(|c| (crate::transition::steps(c.transition, c.progress), c.outgoing.clone(), c.incoming.clone()));
            let (steps, clips) = match cut {
                Some((steps, outgoing, incoming)) => (steps, Some((outgoing, incoming))),
                None => (Vec::new(), None),
            };
            // A shader transition takes both clips whole: a mix with each clip in place.
            let gl = steps.iter().find_map(|s| match s {
                crate::transition::Step::Gl(fx) => Some(*fx),
                _ => None,
            });
            let mix = steps.iter().find_map(|s| match s {
                crate::transition::Step::Mix(m) => Some(*m),
                _ => None,
            });
            let mix = mix.or_else(|| gl.map(|_| crate::transition::Mix { outgoing: Some(crate::transition::Shot::STILL), incoming: Some(crate::transition::Shot::STILL), mask: crate::transition::Mask::All }));
            match (mix, clips) {
                // A transition that mixes the clips draws each into a group of its own, the
                // other one at this time too (on past its end, or ahead of its start). Main-track
                // clips carry their canvas fill, as CapCut's main track carries its canvas; with
                // none, clips with nothing under them carry the canvas's black.
                (Some(m), Some((outgoing, incoming))) => {
                    let nothing_under = out.is_empty();
                    for (clip, drawn) in [(&outgoing, m.outgoing.is_some()), (&incoming, m.incoming.is_some())] {
                        if !drawn {
                            continue;
                        }
                        if clip.id != seg.id {
                            self.load_exposure_luts(clip);
                            self.load_clip_lut(clip, &mut report);
                        }
                        let fill = self.fill_of(clip);
                        let backdrop = match &fill {
                            Some(CanvasFillKind::Color { color }) => Some(rgb8(color)),
                            Some(_) => Some([0, 0, 0]),
                            None => nothing_under.then_some([0u8, 0, 0]),
                        };
                        out.push((clip.clone(), Pixels::Begin(backdrop)));
                        let at = out.len();
                        self.draw_with_effects(clip, t, w, h, &mut out, &mut report);
                        if let Some(fill) = fill {
                            self.insert_fill(clip, &fill, at, w, h, &mut out, &mut report);
                        }
                        out.push((clip.clone(), Pixels::End));
                    }
                    out.push((seg.clone(), Pixels::Mix(mix_pixels(&m, w, h, gl))));
                }
                _ => {
                    self.draw_with_effects(&seg, t, w, h, &mut out, &mut report);
                    // A main-track clip's canvas fill, under everything: a colour is the
                    // frame's background; a blur or an image goes first.
                    match self.fill_of(&seg) {
                        Some(CanvasFillKind::Color { color }) => self.background = rgb8(&color),
                        Some(fill) => self.insert_fill(&seg, &fill, 0, w, h, &mut out, &mut report),
                        None => {}
                    }
                }
            }
            // Any other transition works on the canvas over the clip.
            for step in steps {
                if let Some(px) = self.step_pixels(step, w) {
                    out.push((seg.clone(), px));
                }
            }
        }
        report.layers = out.len();
        // Full stills the scrub workers decoded that no layer collected.
        for (path, img) in self.scrub.take_decoded() {
            let tick = self.tick;
            self.images.entry(path).or_insert((img, tick));
        }
        self.evict_stills();
        self.evict_decoders();
        let tick = self.tick;
        self.texts.retain(|_, (_, _, last)| tick - *last < 3);
        self.shapes.retain(|_, (_, _, last)| tick - *last < 3);
        self.prepared.retain(|_, (_, last)| tick - *last < 3);
        self.mattes.retain(|_, (_, last)| tick - *last < 3);
        (out, report)
    }

    /// Draw a segment at `t` into `out`, noting media that failed to load.
    fn draw(&mut self, seg: &Segment, t: Micros, w: u32, h: u32, out: &mut Vec<(Segment, Pixels)>, report: &mut FrameReport) {
        let t0 = std::time::Instant::now();
        let got = self.pixels(seg, t, w, h);
        if std::env::var_os("OPENRIP_TRACE").is_some() && t0.elapsed().as_millis() >= 10 {
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
    }

    /// OpenRip's effect `effect` on `seg` at clip-local time `local`, with its keyframed values.
    fn effect_pass(seg: &Segment, effect: &openrip_model::Effect, local: Micros) -> Option<openrip_render::EffectPass> {
        let now = seg.effect_at(effect, local);
        let (def, intensity, params) = openrip_model::fx::values(&now)?;
        let duration = seg.target.duration.0.max(1) as f64;
        Some(openrip_render::EffectPass { kind: def.kind, intensity, params, time: (local.0 as f64 / 1e6) as f32, progress: (local.0 as f64 / duration).clamp(0.0, 1.0) as f32, seed: 0.0 })
    }

    /// Draw a clip, with the effects on it (its attachments that are OpenRip's own effects):
    /// the clip drawn into a group of its own, the effects over the group, and the group put
    /// back where it was.
    fn draw_with_effects(&mut self, seg: &Segment, t: Micros, w: u32, h: u32, out: &mut Vec<(Segment, Pixels)>, report: &mut FrameReport) {
        let local = seg.local_time(t);
        let passes: Vec<_> = seg
            .attachments
            .iter()
            .filter_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id && e.builtin.as_deref().is_some_and(|b| b.starts_with(openrip_model::fx::BUILTIN_PREFIX))))
            .filter_map(|e| Self::effect_pass(seg, e, local))
            .filter(|p| p.intensity > 0.0)
            .collect();
        if passes.is_empty() || !matches!(self.project.tracks.iter().find(|tr| tr.segments.iter().any(|s| s.id == seg.id)).map(|tr| tr.kind), Some(TrackKind::Video | TrackKind::Text | TrackKind::Graphic | TrackKind::Sticker)) {
            return self.draw(seg, t, w, h, out, report);
        }
        // The group's own markers carry another id, so a canvas fill still finds the clip.
        let marker = Segment { id: format!("{}#fx", seg.id), ..seg.clone() };
        out.push((marker.clone(), Pixels::Begin(None)));
        self.draw(seg, t, w, h, out, report);
        out.extend(passes.into_iter().map(|p| (marker.clone(), Pixels::Effect(p))));
        out.push((marker.clone(), Pixels::End));
        let still = crate::transition::Shot::STILL;
        out.push((marker, Pixels::Mix(mix_pixels(&crate::transition::Mix { outgoing: Some(still), incoming: None, mask: crate::transition::Mask::All }, w, h, None))));
    }

    /// The canvas fill of a clip on the main track (the lowest video track), unless it's
    /// black; other clips fill nothing, as in CapCut.
    fn fill_of(&self, seg: &Segment) -> Option<CanvasFillKind> {
        let main = self.project.tracks.iter().find(|t| t.kind == TrackKind::Video)?;
        if !main.segments.iter().any(|s| s.id == seg.id) {
            return None;
        }
        let fill = seg.attachments.iter().find_map(|id| self.project.materials.canvas_fills.iter().find(|c| &c.id == id))?;
        (!fill.is_black()).then(|| fill.fill.clone())
    }

    /// Put a main-track clip's blurred picture or image fill into `out` at `at`, under the
    /// clip just drawn from there on.
    #[allow(clippy::too_many_arguments)]
    fn insert_fill(&mut self, seg: &Segment, fill: &CanvasFillKind, at: usize, w: u32, h: u32, out: &mut Vec<(Segment, Pixels)>, report: &mut FrameReport) {
        let px = match fill {
            CanvasFillKind::Color { .. } => return,
            CanvasFillKind::Blur { amount } => {
                let source = out[at..].iter().find(|(s, _)| s.id == seg.id).and_then(|(_, p)| match p {
                    Pixels::Video(f, o, _) => f.try_clone().ok().map(|f| Backdrop::Video(f, *o)),
                    // Blurred, the frame before is as good as the one made in between.
                    Pixels::Tween(frames, _, _, _, o, _) => frames.0.try_clone().ok().map(|f| Backdrop::Video(f, *o)),
                    Pixels::Image(img, key, _) => Some(Backdrop::Image(img.clone(), *key)),
                    _ => None,
                });
                let Some(source) = source else { return };
                // Two rounds of the blur, each with half the variance.
                let sigma = *amount as f64 * CANVAS_BLUR * w.min(h) as f64;
                Pixels::Backdrop(source, (sigma / (BLUR_SIGMA_TAPS * std::f64::consts::SQRT_2)) as f32)
            }
            CanvasFillKind::Image { path } => {
                if self.failed.contains_key(path) {
                    return;
                }
                let img = match self.still(path) {
                    Some(img) => img,
                    None => match load_still(Path::new(path)) {
                        Ok(img) => self.keep_still(path, img),
                        Err(why) => {
                            self.failed.insert(path.clone(), why.clone());
                            report.missing.push((path.clone(), why));
                            return;
                        }
                    },
                };
                Pixels::Cover(img, still_key(path))
            }
        };
        out.insert(at, (seg.clone(), px));
    }

    /// A clip's LUT (a filter attached to a video or photo, as CapCut's Adjust › LUT and the
    /// app's own), read once per file.
    fn load_clip_lut(&mut self, seg: &Segment, report: &mut FrameReport) {
        if !self.project.materials.media.iter().any(|m| m.id == seg.material) {
            return;
        }
        // Color match's table, made from its parameters once.
        if let Some(effect) = crate::colour::color_match_of(&self.project, seg) {
            let key = crate::colour::match_key(effect);
            if !self.matches.contains_key(&key) {
                if self.matches.len() >= 64 {
                    self.matches.clear();
                }
                self.matches.insert(key, std::sync::Arc::new(crate::colour::match_table(effect, key)));
            }
        }
        let Some(effect) = seg.attachments.iter().find_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id && e.category == EffectCategory::Filter)).cloned() else { return };
        if let Err((path, why)) = self.filter_lut(&effect) {
            if !report.missing.iter().any(|(p, _)| p == &path) {
                report.missing.push((path, why));
            }
        }
    }

    /// A filter's lookup table, read once per file: the app's Hald CLUT image (`lut`), a
    /// `.cube` file (`cube`), or CapCut's table in its bundle.
    fn filter_lut(&mut self, effect: &openrip_model::Effect) -> Result<std::sync::Arc<Lut3d>, (String, String)> {
        let Some(bundle) = effect.resource.clone() else { return Err((effect.name.clone(), "the filter has no table".into())) };
        if let Some(why) = self.failed.get(&bundle) {
            return Err((bundle.clone(), why.clone()));
        }
        if !self.filters.contains_key(&bundle) {
            let lut = match effect.builtin.as_deref() {
                Some("lut") => load_still(Path::new(&bundle)).and_then(|img| Lut3d::from_hald(&img, key_of(&bundle)).ok_or_else(|| "not a Hald CLUT image".to_string())),
                Some("cube") => assets::read_to_string(Path::new(&bundle)).map_err(|e| e.to_string()).and_then(|text| Lut3d::from_cube(&text, key_of(&bundle)).ok_or_else(|| "not a 3D .cube table".to_string())),
                _ => load_filter(Path::new(&bundle), key_of(&bundle)),
            };
            match lut {
                Ok(lut) => {
                    self.filters.insert(bundle.clone(), std::sync::Arc::new(lut));
                }
                Err(why) => {
                    self.failed.insert(bundle.clone(), why.clone());
                    return Err((bundle, why));
                }
            }
        }
        Ok(self.filters[&bundle].clone())
    }

    /// The clip's LUT and its strength at local time `local` (with its keyframes), if read.
    fn lut_of(&self, seg: &Segment, local: Micros) -> Option<(&Lut3d, f32)> {
        let effect = seg.attachments.iter().find_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id && e.category == EffectCategory::Filter))?;
        let lut = self.filters.get(effect.resource.as_deref()?)?;
        let strength = seg.effect_at(effect, local).params.get("intensity").copied().unwrap_or(1.0) as f32;
        Some((lut.as_ref(), strength.clamp(0.0, 1.0)))
    }

    /// The clip's Color match table and its intensity, if made.
    fn match_of(&self, seg: &Segment, local: Micros) -> Option<(&Lut3d, f32)> {
        let effect = crate::colour::color_match_of(&self.project, seg)?;
        let lut = self.matches.get(&crate::colour::match_key(effect))?;
        let strength = seg.effect_at(effect, local).params.get("intensity").copied().unwrap_or(1.0) as f32;
        Some((lut.as_ref(), strength.clamp(0.0, 1.0)))
    }

    /// The clip's blend mode (CapCut's `mix_mode`; Normal without one).
    fn blend_of(&self, seg: &Segment) -> openrip_render::BlendMode {
        use openrip_model::BlendMode as M;
        use openrip_render::BlendMode as R;
        let mode = seg.attachments.iter().find_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id).and_then(|e| e.blend_mode()));
        match mode.unwrap_or_default() {
            M::Normal => R::Normal,
            M::Darken => R::Darken,
            M::Screen => R::Screen,
            M::Overlay => R::Overlay,
            M::Multiply => R::Multiply,
            M::Lighten => R::Lighten,
            M::ColorBurn => R::ColorBurn,
            M::ColorDodge => R::ColorDodge,
            M::LinearBurn => R::LinearBurn,
            M::SoftLight => R::SoftLight,
            M::HardLight => R::HardLight,
        }
    }

    /// The clip's chroma key at local time `local` (with its keyframes), if it keys anything.
    fn chroma_of(&self, seg: &Segment, local: Micros) -> Option<openrip_render::ChromaKey> {
        let c = seg.attachments.iter().find_map(|id| self.project.materials.chromas.iter().find(|c| &c.id == id))?;
        let c = seg.chroma_at(c, local);
        (!c.is_off()).then_some(openrip_render::ChromaKey {
            color: [c.color.r, c.color.g, c.color.b],
            intensity: c.intensity.clamp(0.0, 1.0),
            shadow: c.shadow.clamp(0.0, 1.0),
            edge_smooth: c.edge_smooth.clamp(0.0, 1.0),
            spill: c.spill.clamp(0.0, 1.0),
        })
    }

    fn step_pixels(&mut self, step: crate::transition::Step, w: u32) -> Option<Pixels> {
        use crate::transition::Step;
        Some(match step {
            // Drawn with the clips (see `gather`).
            Step::Mix(_) | Step::Gl(_) => return None,
            Step::Wash(c, amount) => Pixels::Wash(std::sync::Arc::new(RgbaImage { width: 4, height: 4, data: c.repeat(16) }), key_of(("wash", c)), amount),
            Step::Blur(px) => Pixels::Blur(px * w as f32 / self.project.canvas.width.max(1) as f32),
            Step::Frame(path) => {
                if self.failed.contains_key(&path) {
                    return None;
                }
                let img = match self.still(&path) {
                    Some(img) => img,
                    None => match load_png(Path::new(&path)) {
                        Ok(img) => self.keep_still(&path, img),
                        Err(e) => {
                            self.failed.insert(path, e.to_string());
                            return None;
                        }
                    },
                };
                Pixels::Cover(img, key_of(&path))
            }
        })
    }

    /// The app's own filters on a clip, its working canvas scaled to a picture `tex_h` pixels
    /// tall shown `fit_h` output pixels tall (before its scale) on a canvas `canvas_h` tall.
    fn app_filters_of(&self, seg: &Segment, tex_h: u32, fit_h: f64, canvas_h: u32, t: Micros) -> Option<openrip_render::AppFilters> {
        let mut f = openrip_render::AppFilters::default();
        // The app's world is 600 units tall (the importer says so on each effect).
        let mut pixel = 1.0 / 600.0;
        let local = seg.local_time(t);
        for e in seg.attachments.iter().filter_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id && e.category == EffectCategory::Adjust)) {
            let e = &seg.effect_at(e, local);
            let Some(name) = e.builtin.as_deref().and_then(|b| b.strip_prefix("v1:")) else { continue };
            let v = e.params.get("value").copied().unwrap_or(0.0) as f32;
            let slot = match name {
                "brightness" => &mut f.brightness,
                "contrast" => &mut f.contrast,
                "hue" => &mut f.hue,
                "saturation" => &mut f.saturation,
                "blur" => &mut f.blur,
                "sharpness" => &mut f.sharpness,
                "noise" => &mut f.noise,
                "vignette" => &mut f.vignette,
                _ => continue,
            };
            *slot = v;
            pixel = e.params.get("pixel").copied().unwrap_or(pixel);
        }
        if f.is_identity() {
            return None;
        }
        // The app's pixel is `pixel` of the canvas height; its working canvas is the clip's
        // fitted picture in those pixels.
        let app_h = fit_h / (pixel.max(1e-9) * canvas_h as f64);
        f.step = (tex_h as f64 / app_h.max(1e-9)) as f32;
        f.seed = (t.0 % 1_000_000_007) as f32 / 1_000_007.0 % 1000.0;
        Some(f)
    }

    /// The clip's Adjust sliders and colour materials at time `t` (with their keyframes).
    fn adjust_of(&self, seg: &Segment, t: Micros) -> Option<(Adjust, Option<&ExposureLuts>)> {
        let mut a = Adjust::default();
        let mut bundle = None;
        let local = seg.local_time(t);
        for e in seg.attachments.iter().filter_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id && e.category == EffectCategory::Adjust)) {
            let v = seg.effect_at(e, local).params.get("intensity").copied().unwrap_or(0.0) as f32;
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
                Some("fade") => &mut a.fade,
                Some("clarity") => &mut a.clarity,
                Some("vignette") => &mut a.vignette,
                _ => continue,
            };
            *slot = v;
            bundle = bundle.or(e.resource.as_deref());
        }

        // Primary colour wheels (log wheels aren't drawn yet).
        if let Some(w) = seg.attachments.iter().find_map(|id| self.project.materials.color_wheels.iter().find(|w| &w.id == id && !w.log)) {
            let w = &seg.wheels_at(w, local);
            let wheel = |v: &openrip_model::WheelValue| openrip_render::Wheel { red: v.red as f32, green: v.green as f32, blue: v.blue as f32, luma: v.luma as f32, saturation: v.saturation as f32 };
            a.wheels = openrip_render::Wheels { lift: wheel(&w.lift), gamma: wheel(&w.gamma), gain: wheel(&w.gain), offset: wheel(&w.offset), intensity: w.intensity as f32 };
        }
        a.hsl = crate::colour::hsl_of(&self.project, seg, local);
        a.curves = crate::colour::curves_of(&self.project, seg);
        if a.is_identity() {
            return None;
        }
        // A draft's sliders read the tables in the colour bundle the draft points at (none if
        // it's missing); sliders without a bundle (the app's own) use OpenRip's own curves.
        let luts = match bundle {
            Some(b) => self.exposure_luts.get(b).and_then(Option::as_ref),
            None => (a.exposure != 0.0 || a.fade != 0.0).then(openrip_render::exposure::fitted),
        };
        Some((a, luts))
    }

    /// A text style at a font size of `em` pixels. Sizes are fractions of the font size, on
    /// the same provisional scale as a run's stroke.
    fn text_effect(&mut self, fx: &TextEffect, em: f32, text_color: openrip_model::Rgba) -> text::Effect {
        let mut paint = |p: &openrip_model::Paint| -> Option<text::Paint> {
            Some(match &p.kind {
                PaintKind::Solid(c) => text::Paint::Solid([c.r, c.g, c.b, c.a * p.alpha]),
                PaintKind::Gradient(g) => {
                    let mut g = render_gradient(g);
                    g.colors.iter_mut().for_each(|c| c[3] *= p.alpha);
                    text::Paint::Gradient(g)
                }
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

    /// The font book's faces for `family` (bold is CSS weight 700): registered ones, then with
    /// `installed` the system's. Found again when fonts have been registered since.
    fn resolve_font(&mut self, family: &str, bold: bool, italic: bool, installed: bool) -> Option<fonts::Resolved> {
        let generation = fonts::generation();
        let key = (family.to_string(), bold, italic, installed);
        match self.resolved_fonts.get(&key) {
            Some((g, r)) if *g == generation => r.clone(),
            _ => {
                let weight = if bold { 700 } else { 400 };
                let r = if installed { fonts::resolve(family, weight, italic) } else { fonts::resolve_registered(family, weight, italic) };
                self.resolved_fonts.insert(key, (generation, r.clone()));
                r
            }
        }
    }

    /// Read the exposure and fade tables from a clip's CapCut colour bundle, once per bundle.
    fn load_exposure_luts(&mut self, seg: &Segment) {
        let bundles: Vec<String> = seg
            .attachments
            .iter()
            .filter_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id && matches!(e.builtin.as_deref(), Some("exposure" | "fade"))))
            .filter_map(|e| e.resource.clone())
            .filter(|b| !self.exposure_luts.contains_key(b))
            .collect();
        for b in bundles {
            let dir = Path::new(&b).join("AmazingFeature_adjustColor").join("image");
            let read = |name: &str| load_png(&dir.join(name)).ok().filter(|i| (i.width, i.height) == (289, 17)).map(std::sync::Arc::new);
            let fade = crate::colour::fade_table(Path::new(&b)).map(std::sync::Arc::new);
            let luts = read("lightSensation_min.png").zip(read("lightSensation_max.png")).map(|(darker, brighter)| ExposureLuts { key: key_of(&b) & !1, darker, brighter, fade });
            self.exposure_luts.insert(b, luts);
        }
    }

    fn pixels(&mut self, seg: &Segment, t: Micros, w: u32, h: u32) -> Result<Option<Pixels>, (String, String)> {
        if let Some(text) = self.project.materials.texts.iter().find(|m| m.id == seg.material) {
            let text = seg.text_at(text, seg.local_time(t));
            let Some(run) = text.runs.first() else { return Ok(None) };
            let capcut = run.size_unit == SizeUnit::CapCut;
            // The run's own font file; else the family's faces from the font book at its weight
            // and slant, bold or italic synthesised only where the family has no such face (for
            // the app's own text the app's bundled fonts, then the installed ones; for CapCut's,
            // a bundled font the app picked for it); else a fallback file. `path` names what's
            // drawn with, for the caches.
            let (path, faces, synthetic_bold, synthetic_italic) = if !run.font.path.is_empty() && assets::exists(Path::new(&run.font.path)) {
                (run.font.path.clone(), None, run.bold, run.italic)
            } else if let Some(r) = self.resolve_font(&run.font.name, run.bold, run.italic, !capcut) {
                (r.key(), Some(r.faces.clone()), run.bold && r.synthetic_bold, run.italic && r.synthetic_italic)
            } else {
                // CapCut's text falls back to CapCut's font, the app's own to a system font.
                let name = run.font.name.clone();
                let key = if capcut { name.clone() } else { format!("app:{name}") };
                (self.font_files.entry(key).or_insert_with(|| font_file_for(&name, capcut)).clone(), None, run.bold, run.italic)
            };
            if let Some(why) = self.failed.get(&path) {
                return Err((path.clone(), why.clone()));
            }
            if !self.fonts.contains_key(&path) {
                let font = match &faces {
                    // The first face draws, the others what it has no glyph for.
                    Some(faces) => {
                        let load = |f: &fonts::FontFace| Font::from_file_at(Path::new(&f.source), f.index);
                        let main = load(&faces[0]).map_err(|e| (faces[0].source.clone(), e.to_string()));
                        main.map(|m| m.with_fallbacks(faces[1..].iter().filter_map(|f| load(f).ok()).collect()))
                    }
                    None => Font::from_file(Path::new(&path)).map_err(|e| (path.clone(), e.to_string())),
                };
                match font {
                    Ok(font) => {
                        self.fonts.insert(path.clone(), font);
                    }
                    Err(e) => {
                        self.failed.insert(path.clone(), e.1.clone());
                        return Err(e);
                    }
                }
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
            // A caption that follows the speech shows a page of its words at a time (or the
            // whole line, for our own styles), its words painted by when they are said.
            let (shown, char_colors, caption_alpha, word_boxes) = match crate::caption::caption_frame(&animations, &text.text, &text.words, local) {
                Some(None) => return Ok(None),
                Some(Some(f)) => {
                    let (a, b) = (f.page.0 as usize, f.page.1 as usize);
                    let paint = f.paint(&own[a..b]);
                    let faded = paint.alpha.iter().any(|v| *v < 1.0).then_some(paint.alpha);
                    let boxed = paint.boxes.iter().any(Option::is_some).then_some(paint.boxes);
                    (text.text.chars().skip(a).take(b - a).collect::<String>(), Some(paint.colors), faded, boxed)
                }
                None => (text.text.clone(), own.iter().any(|c| *c != own[0]).then(|| own.clone()), None, None),
            };
            // A library text style attached to the clip replaces the run's colour and stroke.
            let styled = seg.attachments.iter().find_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id).and_then(|e| Some((e.id.clone(), e.text_style.clone()?))));
            let effect = styled.as_ref().map(|(_, fx)| self.text_effect(fx, em, run.fill));
            // More outlines, a gradient fill and a glow (the text's own, else its style's). The
            // glow softens by CapCut's 9-tap blur at 1.25 px a tap on a 1080-px canvas.
            let more_strokes: Vec<([u8; 4], f32)> = run.more_strokes.iter().filter(|s| s.width > 0.0).map(|s| (rgba(s.color), s.width * em)).collect();
            let gradient = run.gradient.as_ref().map(render_gradient);
            let glow = text.layout.glow.as_ref().or(styled.as_ref().and_then(|(_, fx)| fx.glow.as_ref())).filter(|g| g.strength > 0.0).map(|g| text::Glow {
                color: g.color.map(|c| [c.r, c.g, c.b, c.a]),
                strength: g.strength,
                range: g.range,
                direction: g.direction,
                soften: GLOW_SOFTEN * w.min(h) as f32 / 1080.0,
            });
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
                line_height: text.layout.line_height,
                kerning: text.layout.kerning,
                // Measured (docs/parity/calibration.md, sessions 3 and 5): the stroke reaches
                // `width` em outside the glyphs; the background pads each line by its
                // width/height in em, with corners of 0.55 em × the clip's scale per unit of
                // radius.
                stroke: run.stroke.filter(|s| s.width > 0.0).map(|s| ([to_u8(s.color.r), to_u8(s.color.g), to_u8(s.color.b), to_u8(s.color.a)], s.width * em)),
                more_strokes: &more_strokes,
                gradient: gradient.as_ref(),
                glow,
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
                // `italic_degree` (always 10); both match CapCut (session 5). Not where the
                // font has a bold or italic face of its own.
                bold: if synthetic_bold { 0.008 * em } else { 0.0 },
                italic: if synthetic_italic { 10.0 } else { 0.0 },
                effect: effect.as_ref(),
                curve: text.layout.curve,
                char_colors: char_colors.as_deref(),
                word_boxes: word_boxes.as_deref(),
                underline: run.underline,
            };
            let lay = text::layout(&shown, &style);
            // Library text animations (typing reveals) as per-character opacity.
            let char_alpha = match (crate::animation::char_alpha(&animations, shown.chars().count(), local), caption_alpha) {
                (Some(a), Some(b)) => Some(a.iter().zip(b).map(|(a, b)| a * b).collect()),
                (a, b) => a.or(b),
            };
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
            self.last_text_block = Some([x0, y0, lay.width as f64, lay.height as f64]);
            if self.measure_only {
                return Ok(None);
            }
            let origin = [x0.rem_euclid(1.0) as f32, y0.rem_euclid(1.0) as f32];
            // Everything but the per-character opacity, which animations change every frame.
            let shape_key = key_of((
                &path,
                &shown,
                (&char_colors, &word_boxes),
                em.to_bits(),
                style.color,
                style.stroke.map(|(c, r)| (c, r.to_bits())),
                (
                    style.background.map(|(c, p, r)| (c, p[0].to_bits(), p[1].to_bits(), r.to_bits())),
                    style.shadow.map(|(c, o, b)| (c, o[0].to_bits(), o[1].to_bits(), b.to_bits())),
                ),
                text.layout.alignment,
                text.layout.letter_spacing.to_bits(),
                (text.layout.line_spacing.to_bits(), text.layout.line_height.map(f32::to_bits), text.layout.kerning),
                (style.max_width.map(f32::to_bits), origin[0].to_bits(), origin[1].to_bits(), style.bold.to_bits(), style.italic.to_bits(), style.curve.to_bits(), style.underline),
                (
                    styled.as_ref().map(|(id, _)| id),
                    (!more_strokes.is_empty() || run.gradient.is_some() || glow.is_some()).then(|| format!("{more_strokes:?} {:?} {glow:?}", run.gradient)),
                ),
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
        // A shape or drawing, rasterised at the canvas's scale and cached until it changes.
        if let Some(shape) = self.project.materials.shapes.iter().find(|m| m.id == seg.material) {
            let local = seg.local_time(t);
            let (pos, scale) = (seg.transform.position.sample(local), seg.transform.scale.sample(local));
            let px = shape.unit * h as f32;
            let scale = [shape.scale[0].abs() * scale.x.abs() as f32, shape.scale[1].abs() * scale.y.abs() as f32];
            let (cx, cy) = (w as f64 / 2.0 + pos.x * w as f64 / 2.0, h as f64 / 2.0 - pos.y * h as f64 / 2.0);
            let (x0, y0) = (cx - (shape.size[0] * scale[0] * px) as f64 / 2.0, cy - (shape.size[1] * scale[1] * px) as f64 / 2.0);
            let origin = [x0.rem_euclid(1.0) as f32, y0.rem_euclid(1.0) as f32];
            let key = shape_key(shape, px, scale, origin);
            let tick = self.tick;
            let (layers, center) = match self.shapes.get_mut(&key) {
                Some((layers, center, last)) => {
                    *last = tick;
                    (layers.clone(), *center)
                }
                None => {
                    let rgba = |c: openrip_model::Rgba| [c.r, c.g, c.b, c.a].map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8);
                    let shadow = shape.shadow.map(|s| (rgba(s.color), s.offset));
                    let r = openrip_render::shape::rasterize(shape.size, scale, px, &render_paths(&shape.paths, shape.size), origin, shadow);
                    let layers: Vec<_> = r.layers.into_iter().enumerate().map(|(i, (img, multiply))| (std::sync::Arc::new(img), key_of((key, i)), multiply)).collect();
                    self.shapes.insert(key, (layers.clone(), r.center, tick));
                    (layers, r.center)
                }
            };
            let Some((first, ..)) = layers.first() else { return Ok(None) };
            let at = [cx - (center[0] - first.width as f64 / 2.0), cy - (center[1] - first.height as f64 / 2.0)];
            return Ok(Some(Pixels::Shape(layers, at)));
        }
        // An effect bar: one of OpenRip's own effects over everything below it, for as long as
        // the bar lasts.
        if let Some(effect) = self.project.materials.effects.iter().find(|e| e.id == seg.material && e.builtin.as_deref().is_some_and(|b| b.starts_with(openrip_model::fx::BUILTIN_PREFIX))) {
            let local = seg.local_time(t);
            return Ok(Self::effect_pass(seg, effect, local).map(Pixels::Effect));
        }
        // A filter track's segment: CapCut's lookup table from the filter's bundle.
        if let Some(effect) = self.project.materials.effects.iter().find(|e| e.id == seg.material && e.category == EffectCategory::Filter).cloned() {
            let strength = seg.effect_at(&effect, seg.local_time(t)).params.get("intensity").copied().unwrap_or(1.0) as f32;
            if effect.resource.is_none() {
                return Ok(None);
            }
            // The app's own filters are Hald CLUT images (or .cube files); CapCut's are
            // bundles with a table.
            return Ok(Some(Pixels::Filter(self.filter_lut(&effect)?, strength)));
        }
        // A library sticker: its image, or its GIF's frame now.
        if let Some(sticker) = self.project.materials.stickers.iter().find(|m| m.id == seg.material) {
            let (img, key) = self.stickers.frame(sticker, seg.local_time(t), self.tick).map_err(|why| (sticker.path.clone(), why))?;
            // Drawn at the size the material says (an OpenRip sticker's own, which an SVG's
            // bitmap or a differently sized file keeps), else the picture's.
            let design = if sticker.width > 0 && sticker.height > 0 { [sticker.width, sticker.height] } else { [img.width, img.height] };
            return Ok(Some(Pixels::Sticker(img, key, design)));
        }
        let Some(media) = self.project.materials.media.iter().find(|m| m.id == seg.material).cloned() else { return Ok(None) };
        if media.kind == MediaKind::Audio {
            return Ok(None);
        }
        // The file and time: the media itself, a reversed clip's copy played backward, or a
        // freeze frame's video (see `timing`).
        let picture = crate::timing::picture(&self.project, seg, &media, t);
        let path = picture.path().to_string();
        if let Some(why) = self.failed.get(&path) {
            return Err((path.clone(), why.clone()));
        }
        let fail = |e: &dyn std::fmt::Display| (path.clone(), e.to_string());
        let (at, source, backward) = match picture {
            crate::timing::Picture::Video { at, media, backward, .. } => (at, media, backward),
            crate::timing::Picture::Still(_) => {
                // Dragging the playhead: a stand-in at about the frame's size (uploading a 4K
                // still costs more than the rest of the frame).
                if self.scrubbing {
                    let img = match self.scrub.still(&path) {
                        Some(img) => img,
                        None => {
                            let full = match self.still(&path) {
                                Some(img) => img,
                                None => self.keep_still(&path, load_still(Path::new(&path)).map_err(|e| fail(&e))?),
                            };
                            let k = crate::scrub::shrink_factor(full.width, full.height, w.max(h));
                            let small = if k > 1 { std::sync::Arc::new(crate::scrub::shrink(&full, k)) } else { full };
                            self.scrub.insert_still(&path, small.clone());
                            small
                        }
                    };
                    let mattes = self.masked(seg, (img.width, img.height), 0, seg.local_time(t), seg.local_time(t), None);
                    return Ok(Some(Pixels::Image(img, key_of(("scrub", &path)), mattes)));
                }
                self.await_prefetch(&path);
                let img = match self.still(&path) {
                    Some(img) => {
                        self.scrub.uploading(&path);
                        img
                    }
                    None => match self.scrub.full(&path) {
                        Some(img) => {
                            self.images.insert(path.clone(), (img.clone(), self.tick));
                            img
                        }
                        None => self.keep_still(&path, load_still(Path::new(&path)).map_err(|e| fail(&e))?),
                    },
                };
                let mattes = self.masked(seg, (img.width, img.height), 0, seg.local_time(t), seg.local_time(t), None);
                return Ok(Some(Pixels::Image(img, still_key(&path), mattes)));
            }
        };
        // A reversed clip playing (or exporting) walks down its file: frames come from windows
        // decoded ahead (`ReverseReader`). Paused, seeking or dragging, it's read like any clip:
        // the same frame for the same time.
        if backward && self.following && !self.scrubbing {
            let frame = self.reversed_frame(seg, &path, at, w.max(h)).map_err(|e| fail(&e))?;
            let Some((frame, orientation)) = frame else { return Ok(None) };
            let upright = if orientation.rem_euclid(180) == 90 { (frame.height(), frame.width()) } else { (frame.width(), frame.height()) };
            let cutout = media.matte.as_deref().and_then(|dir| self.matte_at(dir, frame.time, orientation));
            let mattes = self.masked(seg, upright, orientation, source, seg.local_time(t), cutout);
            return Ok(Some(Pixels::Video(frame, orientation, mattes)));
        }
        let key = seg.id.clone();
        self.await_prefetch(&key);
        if self.decoders.get(&key).is_some_and(|d| d.path != path) {
            self.decoders.remove(&key);
        }
        if !self.decoders.contains_key(&key) {
            let decoder = open_video(Path::new(&path), &DecoderOptions { cache_bytes: DECODER_CACHE, ..Default::default() }).map_err(|e| fail(&e))?;
            self.decoders.insert(key.clone(), OpenDecoder { decoder, path: path.clone(), last_used: 0 });
        }
        let d = self.decoders.get_mut(&key).unwrap();
        d.last_used = self.tick;
        let orientation = d.decoder.info().rotation;
        let before = d.decoder.stats();
        let t0 = std::time::Instant::now();
        // Dragging the playhead: the exact frame only if it's at most three pictures ahead of
        // the last one decoded; else a decoded frame within half a second, else the GOP's
        // keyframe (one decode instead of every picture from the keyframe on).
        let (pos, step) = d.decoder.position();
        let near_ahead = pos.is_some_and(|p| at >= p && at.0 - p.0 <= 3 * step.0);
        let frame = if self.scrubbing && !near_ahead && !d.decoder.frame_near(at, Micros::ZERO).is_some_and(|(_, exact)| exact) {
            // The keyframe's stand-in, if the workers got it ready (see `ScrubAhead`).
            self.scrub.learn_index(&path, || crate::scrub::stand_in_keys(d.decoder.as_ref()));
            match d.decoder.frame_near(at, Micros(500_000)) {
                Some((f, _)) => Some(f),
                None => match d.decoder.keyframe_time(at).and_then(|k| self.scrub.keyframe(&path, k)) {
                    Some(f) => Some(f),
                    None => d.decoder.keyframe_at(at).map_err(|e| fail(&e))?,
                },
            }
        } else {
            d.decoder.frame_at(at).map_err(|e| fail(&e))?
        };
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
        let Some(frame) = frame else { return Ok(None) };
        // Smooth slow-mo or Optical flow: between two source frames, a frame made from both
        // (not while the playhead is dragged, which wants a frame quickly).
        let next = match self.tween_mode(seg, &media, t).filter(|_| !self.scrubbing) {
            Some(mode) => {
                let between = |span: i64| (at.0 - frame.time.0) as f64 / span.max(1) as f64;
                // A quarter into the next frame, clear of its start's rounding to the µs.
                let next_at = Micros(frame.time.0 + frame.duration.0 + frame.duration.0 / 4);
                let d = self.decoders.get_mut(&key).unwrap();
                match (frame.duration.0 > 0 && (TWEEN_EDGE..=1.0 - TWEEN_EDGE).contains(&between(frame.duration.0)) && next_at < media.duration).then(|| d.decoder.frame_at(next_at)) {
                    Some(Ok(Some(n))) if n.time > frame.time => Some((between(n.time.0 - frame.time.0).clamp(0.0, 1.0) as f32, n, mode)),
                    _ => None,
                }
                .map(|(b, n, mode)| (n, b, mode))
            }
            None => None,
        };
        // The cut-out's masks are by the media's own frame times.
        let matte_time = if at == source { frame.time } else { source };
        let cutout = media.matte.as_deref().and_then(|dir| self.matte_at(dir, matte_time, orientation));
        let upright = if orientation.rem_euclid(180) == 90 { (frame.height(), frame.width()) } else { (frame.width(), frame.height()) };
        let mattes = self.masked(seg, upright, orientation, source, seg.local_time(t), cutout);
        if let Some((n, between, mode)) = next {
            let pair = key_of(("tween", &path, frame.time.0, n.time.0));
            return Ok(Some(Pixels::Tween(Box::new((frame, n)), between, pair, mode, orientation, mattes)));
        }
        Ok(Some(Pixels::Video(frame, orientation, mattes)))
    }

    /// How a video clip's frame at `t` is made when it falls between two source frames, if
    /// not by holding the earlier one: Optical flow (Video › Basic) always; Smooth slow-mo, in
    /// its mode, while the clip plays slower than its source (CapCut: "only slow-speed videos
    /// are supported"), which a speed curve may do only in places.
    fn tween_mode(&self, seg: &Segment, media: &openrip_model::Media, t: Micros) -> Option<TweenMode> {
        if media.kind != MediaKind::Video {
            return None;
        }
        if media.smart_complement_frame.is_some() {
            return Some(TweenMode::Flow);
        }
        let mode = match media.complement_frame.as_ref()?.mode {
            openrip_model::ComplementMode::FrameBlending => TweenMode::Blend,
            openrip_model::ComplementMode::OpticalFlow => TweenMode::Flow,
        };
        let dt = 10_000;
        let (a, b) = (seg.media_time(&self.project.materials, t)?, seg.media_time(&self.project.materials, Micros(t.0 + dt))?);
        ((b.0 - a.0).abs() < dt * 999 / 1000).then_some(mode)
    }

    /// A reversed clip's frame at `at` in `path`, while it plays: from its [`ReverseReader`]
    /// (opened at the first frame, with windows at about the preview's `size` when it's drawn
    /// into a preview surface), and the turn that shows it upright.
    fn reversed_frame(&mut self, seg: &Segment, path: &str, at: Micros, size: u32) -> Result<Option<(VideoFrame, i32)>, MediaError> {
        if self.reversers.get(&seg.id).is_some_and(|r| r.path != path) {
            self.reversers.remove(&seg.id);
        }
        if !self.reversers.contains_key(&seg.id) {
            // Preview surfaces show frames at about their own size: a 4K GOP held small fits a
            // window (VideoToolbox shrinks it as it decodes). Export and stills read them whole.
            let shrink_to = if self.preview_surface { size } else { 0 };
            let reader = ReverseReader::open(Path::new(path), &DecoderOptions { shrink_to, ..Default::default() }, REVERSE_WINDOW)?;
            self.reversers.insert(seg.id.clone(), Reverser { reader, path: path.to_string(), last_used: self.tick });
        }
        let r = self.reversers.get_mut(&seg.id).unwrap();
        r.last_used = self.tick;
        let orientation = r.reader.info().rotation;
        let t0 = std::time::Instant::now();
        let frame = r.reader.frame_at(at)?;
        if std::env::var_os("OPENRIP_TRACE").is_some() && t0.elapsed().as_millis() >= 10 {
            eprintln!("[preview]   reversed: source {:.3}s waited {:.1} ms ({:?})", at.as_secs_f64(), t0.elapsed().as_secs_f64() * 1e3, r.reader.stats());
        }
        Ok(frame.map(|f| (f, orientation)))
    }

    /// The clip's cut-out (if it has one) and masks at `at` (time in its source; `local` in the
    /// segment, for keyframes) over its upright picture of `size`, in the stored picture's
    /// axes, each with what it shows inside and outside.
    fn masked(&mut self, seg: &Segment, size: (u32, u32), orientation: i32, at: Micros, local: Micros, cutout: Option<std::sync::Arc<RgbaImage>>) -> Vec<Painted> {
        let mut out: Vec<Painted> = cutout.into_iter().map(|c| (c, None, Some([0.0; 4]))).collect();
        // The clip's crop: the picture is clear outside its rectangle.
        if let Some(c) = seg.crop.filter(|c| *c != CropRect::FULL) {
            let k = (2048.0 / size.0.max(size.1).max(1) as f64).min(1.0);
            let (w, h) = (((size.0 as f64 * k).round() as u32).max(1), ((size.1 as f64 * k).round() as u32).max(1));
            let key = format!("crop:{:x}", key_of((c.x.to_bits(), c.y.to_bits(), c.width.to_bits(), c.height.to_bits(), c.rotation.to_bits(), size, w, h, orientation)));
            let tick = self.tick;
            let image = match self.mattes.get_mut(&key) {
                Some((img, last)) => {
                    *last = tick;
                    img.clone()
                }
                None => {
                    let img = std::sync::Arc::new(turn_to_stored(&crate::crop::coverage(&c, size, w, h), w, h, orientation));
                    self.mattes.insert(key, (img.clone(), tick));
                    img
                }
            };
            out.push((image, None, Some([0.0; 4])));
        }
        let masks: Vec<openrip_model::Mask> = self.project.materials.masks.iter().filter(|m| seg.attachments.contains(&m.id)).map(|m| seg.mask_at(m, local)).collect();
        // At the picture's size, up to 2048 pixels on its long side.
        let k = (2048.0 / size.0.max(size.1).max(1) as f64).min(1.0);
        let (w, h) = (((size.0 as f64 * k).round() as u32).max(1), ((size.1 as f64 * k).round() as u32).max(1));
        let paint = |p: openrip_model::MaskPaint| match p {
            openrip_model::MaskPaint::Clip => None,
            openrip_model::MaskPaint::Color(c) => Some([c.r, c.g, c.b, c.a]),
        };
        let tick = self.tick;
        for m in &masks {
            let key = format!("mask:{:x}", key_of((crate::mask::coverage_key(m, at), w, h, orientation)));
            let image = match self.mattes.get_mut(&key) {
                Some((img, last)) => {
                    *last = tick;
                    img.clone()
                }
                // Shapes not drawn yet leave the picture as it is.
                None => {
                    let field = self.mask_field(&m.shape);
                    let glyphs = crate::mask::text_at(m, at).and_then(|t| self.mask_glyphs(&t, h));
                    let Some(c) = crate::mask::coverage(m, at, w, h, field.as_deref(), glyphs.as_ref()) else { continue };
                    let img = std::sync::Arc::new(turn_to_stored(&c, w, h, orientation));
                    self.mattes.insert(key, (img.clone(), tick));
                    img
                }
            };
            out.push((image, paint(m.inside), paint(m.outside)));
        }
        out
    }

    /// A text mask's glyphs for a picture `h` pixels tall: laid out in its font (a system
    /// font by name, else the app's default, as the app's own text falls back) at its em size,
    /// white, with a synthetic bold and italic as the app's text has them, and the text's
    /// underline (at the font's own position).
    fn mask_glyphs(&mut self, t: &openrip_model::MaskText, h: u32) -> Option<crate::mask::Glyphs> {
        let key = format!("app:{}", t.font);
        let path = self.font_files.entry(key).or_insert_with(|| font_file_for(&t.font, false)).clone();
        if !self.fonts.contains_key(&path) {
            let font = Font::from_file(Path::new(&path)).ok()?;
            self.fonts.insert(path.clone(), font);
        }
        let font = &self.fonts[&path];
        let em = (t.size * h as f32).max(1.0);
        let style = TextStyle {
            font,
            size: em,
            color: [255, 255, 255, 255],
            align: match t.align {
                0 => Align::Left,
                2 => Align::Right,
                _ => Align::Center,
            },
            letter_spacing: t.letter_spacing,
            line_spacing: t.line_spacing,
            line_height: None,
            kerning: true,
            stroke: None,
            more_strokes: &[],
            gradient: None,
            glow: None,
            background: None,
            shadow: None,
            max_width: None,
            bold: if t.bold { em * 0.03 } else { 0.0 },
            italic: if t.italic { 12.0 } else { 0.0 },
            effect: None,
            curve: 0.0,
            char_colors: None,
            word_boxes: None,
            underline: t.underline,
        };
        let layout = text::layout(&t.text, &style);
        let r = layout.rasterize(&style, [0.0, 0.0]);
        let (gw, gh) = (r.image.width, r.image.height);
        let alpha: Vec<u8> = r.image.data.chunks_exact(4).map(|p| p[3]).collect();
        Some(crate::mask::Glyphs { w: gw, h: gh, alpha, center: r.center })
    }

    /// A picture mask's distance field (CapCut's heart and star), read from its bundle once.
    fn mask_field(&mut self, shape: &openrip_model::MaskShape) -> Option<std::sync::Arc<crate::mask::Field>> {
        let openrip_model::MaskShape::Picture { path, .. } = shape else { return None };
        self.mask_fields
            .entry(path.clone())
            .or_insert_with(|| load_png(Path::new(path)).ok().map(|img| std::sync::Arc::new(crate::mask::Field::from_rgba(img.width, img.height, &img.data))))
            .clone()
    }

    /// The saved background-removal mask for the source frame at `at` (the last one at or
    /// before it), turned into the stored picture's axes.
    fn matte_at(&mut self, dir: &str, at: Micros, orientation: i32) -> Option<std::sync::Arc<RgbaImage>> {
        let times = self.matte_times.entry(dir.to_string()).or_insert_with(|| {
            let mut t: Vec<i64> = assets::list(&Path::new(dir).join("mask")).into_iter().flatten().filter_map(|p| p.file_name()?.to_str()?.parse().ok()).collect();
            t.sort_unstable();
            std::sync::Arc::new(t)
        });
        let i = times.partition_point(|&x| x <= at.0 + 1_000);
        let t = *times.get(i.checked_sub(1)?).or(times.first())?;
        let key = format!("{dir}/mask/{t}");
        let tick = self.tick;
        if let Some((m, last)) = self.mattes.get_mut(&key) {
            *last = tick;
            return Some(m.clone());
        }
        let info: serde_json::Value = serde_json::from_slice(&assets::read(&Path::new(dir).join("maskinfo").join(t.to_string())).ok()?).ok()?;
        let (w, h) = (info.pointer("/boundingBox/width")?.as_u64()? as u32, info.pointer("/boundingBox/height")?.as_u64()? as u32);
        let raw = assets::read(Path::new(&key)).ok()?;
        if raw.len() < (w * h) as usize {
            return None;
        }
        let m = std::sync::Arc::new(turn_to_stored(&raw[..(w * h) as usize], w, h, orientation));
        self.mattes.insert(key, (m.clone(), tick));
        Some(m)
    }

    /// Start getting the stills a frame needs ready on the scrub workers, so they get ready
    /// beside the frame's video and each other (worth it with more than one thing to do):
    /// decoding those that aren't decoded or on their way, and writing to the GPU those
    /// decoded before that aren't on it any more.
    fn load_stills_beside(&mut self, active: &[Segment]) {
        let (mut stills, mut uploads, mut videos) = (Vec::new(), Vec::new(), 0);
        for seg in active {
            let Some(m) = self.project.materials.media.iter().find(|m| m.id == seg.material && m.kind != MediaKind::Audio) else { continue };
            if m.kind != MediaKind::Photo {
                videos += 1;
            } else if let Some((img, _)) = self.images.get(&m.path) {
                if !self.compositor.holds(still_key(&m.path)) && !uploads.iter().any(|(p, _)| p == &m.path) {
                    uploads.push((m.path.clone(), img.clone()));
                }
            } else if !self.failed.contains_key(&m.path) && !self.prefetch.pending.contains(&m.path) && !stills.contains(&m.path) {
                stills.push(m.path.clone());
            }
        }
        if stills.len() + uploads.len() + videos > 1 {
            self.scrub.load_full(stills);
            self.scrub.upload(uploads);
        }
    }

    /// A decoded still, if it's kept, marked as used.
    fn still(&mut self, path: &str) -> Option<std::sync::Arc<RgbaImage>> {
        let tick = self.tick;
        self.images.get_mut(path).map(|(img, last)| {
            *last = tick;
            img.clone()
        })
    }

    fn keep_still(&mut self, path: &str, img: RgbaImage) -> std::sync::Arc<RgbaImage> {
        let img = std::sync::Arc::new(img);
        self.images.insert(path.to_string(), (img.clone(), self.tick));
        img
    }

    /// Drop the least recently used stills beyond `STILLS_BUDGET` (never one this frame drew).
    fn evict_stills(&mut self) {
        let mut bytes: usize = self.images.values().map(|(img, _)| img.data.len()).sum();
        while bytes > STILLS_BUDGET {
            let Some((path, _)) = self.images.iter().filter(|(_, (_, last))| *last < self.tick).min_by_key(|(_, (_, last))| *last) else { break };
            let path = path.clone();
            bytes -= self.images.remove(&path).map_or(0, |(img, _)| img.data.len());
        }
    }

    fn evict_decoders(&mut self) {
        while self.decoders.len() > MAX_DECODERS {
            let oldest = self.decoders.iter().min_by_key(|(_, d)| d.last_used).map(|(k, _)| k.clone()).unwrap();
            self.decoders.remove(&oldest);
        }
        // A reversed clip's windows go once it stops playing (paused, or off the screen).
        let tick = self.tick;
        self.reversers.retain(|_, r| tick - r.last_used < 3);
    }

    /// How a clip's animations move it at clip-local time `local` (none when it has none).
    fn motion_of(&self, seg: &Segment, local: Micros) -> Option<crate::animation::Motion> {
        let mut items = seg.attachments.iter().filter_map(|id| self.project.materials.animations.iter().find(|m| &m.id == id)).flat_map(|m| m.items.iter()).peekable();
        items.peek()?;
        crate::animation::motion_at(items, seg.target.duration, local)
    }

    fn layers<'a>(&'a self, pixels: &'a [(Segment, Pixels)], t: Micros, w: u32, h: u32) -> Vec<Layer<'a>> {
        pixels
            .iter()
            .flat_map(|(seg, p)| {
                let local = seg.local_time(t);
                let tr = &seg.transform;
                let (mut pos, mut scale, mut rot) = (tr.position.sample(local), tr.scale.sample(local), tr.rotation.sample(local));
                // Its animations on top of the clip's own (keyframed) transform.
                let motion = if matches!(p, Pixels::Image(..) | Pixels::Video(..) | Pixels::Tween(..) | Pixels::Text(..) | Pixels::Sticker(..)) { self.motion_of(seg, local) } else { None };
                if let Some(m) = motion {
                    pos = openrip_model::Vec2::new(pos.x + m.offset[0], pos.y + m.offset[1]);
                    scale = openrip_model::Vec2::new(scale.x * m.scale, scale.y * m.scale);
                    rot += m.rotation;
                }
                // Flips are on screen axes: fold them into the scale signs.
                let scale = [scale.x * if tr.flip_h { -1.0 } else { 1.0 }, scale.y * if tr.flip_v { -1.0 } else { 1.0 }];
                // A cropped clip's whole picture, placed so the crop's rectangle fills its box
                // (the crop itself is cut out in `masked`).
                let crop = seg.crop.filter(|c| *c != CropRect::FULL).filter(|_| matches!(p, Pixels::Image(..) | Pixels::Video(..) | Pixels::Tween(..)));
                let (pos, scale, rot) = match crop {
                    Some(c) => {
                        let ((sw, sh), o) = match p {
                            Pixels::Image(i, ..) => ((i.width, i.height), 0),
                            Pixels::Video(f, o, ..) => (Source::Video(f).size(), *o),
                            Pixels::Tween(frames, _, _, _, o, _) => (Source::Video(&frames.0).size(), *o),
                            _ => unreachable!(),
                        };
                        let up = if o.rem_euclid(180) == 90 { (sh, sw) } else { (sw, sh) };
                        let (at, whole, turn) = crate::crop::place(&c, (up.0 as f64, up.1 as f64), (w as f64, h as f64), [pos.x, pos.y], scale, rot);
                        (openrip_model::Vec2::new(at[0], at[1]), whole, turn)
                    }
                    None => (pos, scale, rot),
                };
                let mut layer = match p {
                    Pixels::Image(i, key, mattes) => Layer { mattes: painted(mattes), ..Layer::from_model(Source::Cached(*key, i), [w, h], [pos.x, pos.y], scale, rot) },
                    Pixels::Video(f, orientation, mattes) => Layer { mattes: painted(mattes), ..Layer::from_model_oriented(Source::Video(f), [w, h], [pos.x, pos.y], scale, rot, *orientation) },
                    Pixels::Tween(frames, between, key, mode, orientation, mattes) => {
                        let tween = Tween { from: Picture::Video(&frames.0), to: Picture::Video(&frames.1), t: *between, key: *key, mode: *mode };
                        Layer { mattes: painted(mattes), ..Layer::from_model_oriented(Source::Tween(tween), [w, h], [pos.x, pos.y], scale, rot, *orientation) }
                    }
                    Pixels::Filter(lut, strength) => Layer::pass(Source::Filter(lut, *strength)),
                    // Twice the canvas, so the image's soft edge is off it.
                    Pixels::Wash(img, key, amount) => Layer { opacity: *amount, ..Layer::placed(Source::Cached(*key, img), [w as f64 / 2.0, h as f64 / 2.0], [2.0 * w as f64, 2.0 * h as f64]) },
                    Pixels::Cover(img, key) => {
                        let fit = (w as f64 / img.width as f64).max(h as f64 / img.height as f64);
                        Layer::placed(Source::Cached(*key, img), [w as f64 / 2.0, h as f64 / 2.0], [img.width as f64 * fit, img.height as f64 * fit])
                    }
                    // The main clip's own picture covering the canvas, then blurred (its canvas
                    // fill): two rounds of the blur, each half the variance.
                    Pixels::Backdrop(source, step) => {
                        let src = match source {
                            Backdrop::Video(f, _) => Source::Video(f),
                            Backdrop::Image(img, key) => Source::Cached(*key, img),
                        };
                        let orientation = match source {
                            Backdrop::Video(_, o) => *o,
                            Backdrop::Image(..) => 0,
                        };
                        let (sw, sh) = src.size();
                        let (uw, uh) = if orientation.rem_euclid(180) == 90 { (sh, sw) } else { (sw, sh) };
                        let cover = (w as f64 / uw as f64).max(h as f64 / uh as f64) / (w as f64 / uw as f64).min(h as f64 / uh as f64);
                        return vec![
                            Layer::from_model_oriented(src, [w, h], [0.0, 0.0], [cover, cover], 0.0, orientation),
                            Layer::pass(Source::Blur(*step)),
                            Layer::pass(Source::Blur(*step)),
                        ];
                    }
                    Pixels::Blur(px) => Layer::pass(Source::Blur(*px)),
                    Pixels::Shape(layers, at) => {
                        let opacity = seg.opacity.sample(local);
                        return layers
                            .iter()
                            .map(|(img, key, multiply)| Layer {
                                rotation: rot,
                                flip_h: tr.flip_h,
                                flip_v: tr.flip_v,
                                opacity,
                                multiply: *multiply,
                                ..Layer::placed(Source::Cached(*key, img), *at, [img.width as f64, img.height as f64])
                            })
                            .collect();
                    }
                    // Centred on its position at its own size (crate::sticker), scaled and
                    // turned with the clip.
                    Pixels::Sticker(img, key, design) => {
                        let [sw, sh] = crate::sticker::size_on_canvas(design[0], design[1], w);
                        Layer {
                            rotation: rot,
                            flip_h: scale[0] < 0.0,
                            flip_v: scale[1] < 0.0,
                            ..Layer::placed(Source::Cached(*key, img), [w as f64 / 2.0 + pos.x * w as f64 / 2.0, h as f64 / 2.0 - pos.y * h as f64 / 2.0], [sw * scale[0].abs(), sh * scale[1].abs()])
                        }
                    }
                    Pixels::Text(img, key, at) => {
                        // An animation moves and scales the text's picture.
                        let (k, shift) = motion.map_or((1.0, [0.0, 0.0]), |m| (m.scale, [m.offset[0] * w as f64 / 2.0, -m.offset[1] * h as f64 / 2.0]));
                        Layer {
                            rotation: rot,
                            flip_h: tr.flip_h,
                            flip_v: tr.flip_v,
                            ..Layer::placed(Source::Cached(*key, img), [at[0] + shift[0], at[1] + shift[1]], [img.width as f64 * k, img.height as f64 * k])
                        }
                    }
                    Pixels::Begin(colour) => Layer::pass(Source::BeginGroup(*colour)),
                    Pixels::End => Layer::pass(Source::EndGroup),
                    Pixels::Mix(m) => Layer::pass(Source::Mix(*m)),
                    Pixels::Effect(e) => Layer::pass(Source::Effect(*e)),
                };
                if !matches!(p, Pixels::Wash(..) | Pixels::Cover(..) | Pixels::Blur(_) | Pixels::Begin(_) | Pixels::End | Pixels::Mix(_) | Pixels::Effect(_)) {
                    layer.opacity *= seg.opacity.sample(local);
                }
                if let Some(m) = motion {
                    layer.opacity *= m.alpha;
                }
                if matches!(p, Pixels::Image(..) | Pixels::Video(..) | Pixels::Tween(..)) {
                    // The scale along the stored picture's vertical axis (sideways video swaps).
                    let sideways = matches!(p, Pixels::Video(_, o, _) | Pixels::Tween(_, _, _, _, o, _) if o.rem_euclid(180) == 90);
                    let tex_scale = if sideways { scale[0] } else { scale[1] };
                    layer.app_filters = self.app_filters_of(seg, layer.source.size().1, layer.size[1] / tex_scale.abs().max(1e-9), h, t);
                    layer.adjust = self.adjust_of(seg, t);
                    layer.chroma = self.chroma_of(seg, local);
                    layer.lut = self.lut_of(seg, local);
                    layer.match_lut = self.match_of(seg, local);
                }
                if matches!(p, Pixels::Image(..) | Pixels::Video(..) | Pixels::Tween(..) | Pixels::Text(..) | Pixels::Sticker(..)) {
                    layer.blend = self.blend_of(seg);
                }
                vec![layer]
            })
            .collect()
    }
}

/// A colour as 8-bit RGB over black (a canvas fill's).
fn rgb8(c: &openrip_model::Rgba) -> [u8; 3] {
    let a = c.a.clamp(0.0, 1.0);
    [c.r, c.g, c.b].map(|v| (v.clamp(0.0, 1.0) * a * 255.0).round() as u8)
}

/// A transition's mix in output pixels: each clip's move, scale and turn about the canvas
/// centre as the map from an output pixel to its group's.
fn mix_pixels(m: &crate::transition::Mix, w: u32, h: u32, fx: Option<openrip_render::glt::GlFx>) -> openrip_render::Mix {
    use crate::transition::Mask;
    let (cx, cy) = (w as f64 / 2.0, h as f64 / 2.0);
    let shot = |s: &crate::transition::Shot| {
        let (sin, cos) = (s.rotation as f64).to_radians().sin_cos();
        let k = 1.0 / (s.scale as f64).max(1e-6);
        let (ox, oy) = (cx + s.offset[0] as f64 * w as f64, cy + s.offset[1] as f64 * h as f64);
        // Undo the move, the turn (clockwise on screen, y down), then the scale.
        let u = [cos * k, sin * k, cx - (cos * ox + sin * oy) * k];
        let v = [-sin * k, cos * k, cy - (-sin * ox + cos * oy) * k];
        openrip_render::Shot { inverse: [u.map(|x| x as f32), v.map(|x| x as f32)], alpha: s.alpha, zoom_blur: s.zoom_blur, mirror: s.mirror }
    };
    openrip_render::Mix {
        outgoing: m.outgoing.as_ref().map(shot),
        incoming: m.incoming.as_ref().map(shot),
        mask: match m.mask {
            Mask::All => openrip_render::MixMask::All,
            Mask::Edge { toward, at, feather } => openrip_render::MixMask::Edge { toward, at, feather },
            Mask::Circle { radius, feather } => openrip_render::MixMask::Circle { radius, feather },
        },
        fx,
    }
}

/// A CapCut filter's lookup table from its bundle: `AmazingFeature/texture/*.vf`. Filters
/// with a skin/background pair use the background table, as CapCut does where it finds no
/// skin.
fn load_filter(bundle: &Path, key: u64) -> Result<Lut3d, String> {
    let dir = bundle.join("AmazingFeature").join("texture");
    let mut tables: Vec<_> = assets::list(&dir).map_err(|e| e.to_string())?.into_iter().filter(|p| p.extension().is_some_and(|x| x == "vf")).collect();
    tables.sort_by_key(|p| !p.file_name().is_some_and(|n| n.to_string_lossy().contains("bg")));
    let file = tables.first().ok_or("no lookup table in the filter bundle")?;
    Lut3d::from_vf(&assets::read(file).map_err(|e| e.to_string())?, key).ok_or_else(|| format!("unreadable lookup table {}", file.display()))
}

/// Decode a still image: PNG directly (keeps alpha), anything else through a still backend.
pub(crate) fn load_still(path: &Path) -> Result<RgbaImage, String> {
    openrip_media::decode_still(path)
}

/// A font file for a family name: an installed font whose file is named after it (e.g.
/// "Arial" → Arial.ttf) in the system and user font folders; otherwise, for CapCut's own text
/// (`capcut`), CapCut's default font if CapCut is installed; otherwise Arial, else Helvetica
/// ([`APP_FONTS`]), so OpenRip's own text never depends on CapCut. Bold and italic stay
/// synthetic.
fn font_file_for(name: &str, capcut: bool) -> String {
    let mut dirs = vec!["/System/Library/Fonts/Supplemental".to_string(), "/System/Library/Fonts".to_string(), "/Library/Fonts".to_string()];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(Path::new(&home).join("Library/Fonts").to_string_lossy().into_owned());
    }
    let find = |name: &str| -> Option<String> {
        let name = name.trim();
        if name.is_empty() {
            return None;
        }
        dirs.iter().flat_map(|dir| ["ttf", "otf", "ttc"].map(|ext| Path::new(dir).join(format!("{name}.{ext}")))).find(|p| assets::exists(p)).map(|p| p.to_string_lossy().into_owned())
    };
    if let Some(p) = find(name) {
        return p;
    }
    if capcut && assets::exists(Path::new(CAPCUT_FONT)) {
        return CAPCUT_FONT.to_string();
    }
    APP_FONTS.iter().find_map(|n| find(n)).unwrap_or_else(|| "/System/Library/Fonts/Helvetica.ttc".to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_apps_own_text_never_falls_back_to_capcuts_font() {
        // A family the system has is found by name, for either.
        if assets::exists(Path::new("/System/Library/Fonts/Supplemental/Georgia.ttf")) {
            assert!(font_file_for("Georgia", false).ends_with("Georgia.ttf"));
            assert!(font_file_for("Georgia", true).ends_with("Georgia.ttf"));
        }
        // One it doesn't: a system font for the app's text, CapCut's for a draft's.
        let app = font_file_for("No Such Family", false);
        assert!(!app.contains("CapCut"), "{app}");
        assert!(app.ends_with("Arial.ttf") || app.ends_with("Helvetica.ttc"), "{app}");
        assert!(!font_file_for("", false).contains("CapCut"));
        if assets::exists(Path::new(CAPCUT_FONT)) {
            assert_eq!(font_file_for("No Such Family", true), CAPCUT_FONT);
        }
    }
}
