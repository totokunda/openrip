//! GPU compositor (wgpu) reproducing CapCut's measured rendering pipeline
//! (docs/parity/calibration.md, session 2):
//!
//! 1. Each image is resampled to its displayed size: area average then a 3×3 Laplacian
//!    sharpen of strength 0.15 when shrinking, bilinear when enlarging, untouched at 1:1.
//!    The result is stored in 8 bits, as CapCut does.
//! 2. That texture is rotated and placed with Catmull-Rom interpolation and composited
//!    (premultiplied "over") onto an 8-bit canvas at the output resolution.
//!
//! Geometry is in output pixels; mapping the project model (half-canvas positions,
//! contain-fit scale) to layers is the caller's job (see [`Layer::from_model`]).
//!
//! Video frames from the hardware decoder are used in place: on Apple platforms their IOSurface
//! planes (NV12 / P010) become GPU textures without a copy and are converted to RGB on the
//! GPU with the frame's own matrix and range. Frames come as `openrip-frame` types: the
//! compositor needs decoded pictures, not the decoder.

pub mod adjust;
pub mod blend;
pub mod exposure;
mod effects;
mod enhance;
mod flow;
pub mod glt;
pub mod fonts;
pub mod grade;
mod interop;
pub mod shape;
pub mod text;
mod upload;

pub use adjust::{Adjust, ExposureLuts, Wheel, Wheels};
pub use blend::BlendMode;
pub use grade::{CurvePoint, Curves, Hsl};
pub use effects::{sample_scene, EffectPass};
pub use enhance::Enhance;
pub use flow::{work_factor, FlowField, Picture, Tween, TweenMode, WORK_SIDE};
pub use interop::Surface;
pub use upload::Uploader;

/// A 3D colour lookup table (CapCut's filters): `size`³ RGB entries, red fastest, then
/// green, then blue; `key` identifies it for the GPU cache.
#[derive(Clone, Debug)]
pub struct Lut3d {
    pub key: u64,
    pub size: u32,
    pub rgb: Vec<f32>,
    /// Entries sit at the cube's corners (a colour c reads entry c × (size − 1), as
    /// ImageMagick reads Hald CLUTs) rather than at texel centres (CapCut's tables).
    pub edge_aligned: bool,
}

impl Lut3d {
    /// Read CapCut's `.vf` table: "VF_V", three u16 sizes, then size³ RGB float32.
    pub fn from_vf(bytes: &[u8], key: u64) -> Option<Lut3d> {
        if bytes.get(..4)? != b"VF_V" {
            return None;
        }
        let dim = |i: usize| u16::from_le_bytes([bytes[4 + 2 * i], bytes[5 + 2 * i]]) as u32;
        let n = dim(0);
        if !(2..=128).contains(&n) || dim(1) != n || dim(2) != n {
            return None;
        }
        let body = bytes.get(10..10 + (n * n * n * 12) as usize)?;
        Some(Lut3d { key, size: n, rgb: body.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect(), edge_aligned: false })
    }

    /// A Hald CLUT image (the app's own filters): a square of side level³ holding level⁶
    /// entries, entry r + n·g + n²·b (n = level²) at that index read row by row, read
    /// edge-aligned with trilinear interpolation, as ImageMagick and the app's preview do.
    pub fn from_hald(img: &RgbaImage, key: u64) -> Option<Lut3d> {
        let side = img.width.min(img.height);
        let level = (2..=16u32).find(|l| l * l * l >= side)?;
        let n = level * level;
        let entries = (n * n * n) as usize;
        if (img.width as usize) * (img.height as usize) < entries {
            return None;
        }
        let w = img.width as usize;
        let rgb = (0..entries)
            .flat_map(|i| {
                let px = &img.data[((i / w) * w + i % w) * 4..][..3];
                [px[0] as f32 / 255.0, px[1] as f32 / 255.0, px[2] as f32 / 255.0]
            })
            .collect();
        Some(Lut3d { key, size: n, rgb, edge_aligned: true })
    }

    /// An Adobe / Resolve `.cube` 3D table (the LUTs editors import, and CapCut's Adjust ›
    /// LUT takes): `LUT_3D_SIZE n`, then n³ lines of RGB, red fastest, entries at the cube's
    /// corners. Its input domain is read as 0–1 (`DOMAIN_MIN`/`DOMAIN_MAX` other than that
    /// are rare in grading tables and aren't applied); a 1D table (`LUT_1D_SIZE`) isn't read.
    pub fn from_cube(text: &str, key: u64) -> Option<Lut3d> {
        let mut size = 0u32;
        let mut rgb = Vec::new();
        for line in text.lines() {
            let line = line.split('#').next().unwrap_or("").trim();
            let mut words = line.split_whitespace();
            let Some(first) = words.next() else { continue };
            match first {
                "LUT_3D_SIZE" => size = words.next()?.parse().ok()?,
                "LUT_1D_SIZE" => return None,
                _ => {
                    // Keywords (TITLE, DOMAIN_MIN, …) aren't numbers.
                    let Ok(r) = first.parse::<f32>() else { continue };
                    let v: Vec<f32> = words.filter_map(|w| w.parse().ok()).collect();
                    if v.len() != 2 {
                        return None;
                    }
                    rgb.extend([r, v[0], v[1]]);
                }
            }
        }
        ((2..=128).contains(&size) && rgb.len() == (size * size * size * 3) as usize).then_some(Lut3d { key, size, rgb, edge_aligned: true })
    }

    /// The table with `size` entries a side, each read from this one by trilinear
    /// interpolation at the colour it stands for (so it keeps its alignment): for a table too
    /// big for the GPU's textures, as a level-12 Hald CLUT's 144 a side is.
    pub fn resampled(&self, size: u32) -> Lut3d {
        let (n, m) = (self.size as usize, size.max(2) as usize);
        // Where entry i of m sits in this table, in entries.
        let at = |i: usize| -> f32 {
            let pos = if self.edge_aligned { i as f32 / (m - 1) as f32 * (n - 1) as f32 } else { (i as f32 + 0.5) / m as f32 * n as f32 - 0.5 };
            pos.clamp(0.0, (n - 1) as f32)
        };
        let axis: Vec<(usize, usize, f32)> = (0..m)
            .map(|i| {
                let p = at(i);
                let lo = p.floor() as usize;
                (lo, (lo + 1).min(n - 1), p - lo as f32)
            })
            .collect();
        let entry = |r: usize, g: usize, b: usize| &self.rgb[(r + n * g + n * n * b) * 3..][..3];
        let mut rgb = Vec::with_capacity(m * m * m * 3);
        for &(b0, b1, fb) in &axis {
            for &(g0, g1, fg) in &axis {
                for &(r0, r1, fr) in &axis {
                    for c in 0..3 {
                        let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;
                        let along_r = |g: usize, b: usize| lerp(entry(r0, g, b)[c], entry(r1, g, b)[c], fr);
                        let along_g = |b: usize| lerp(along_r(g0, b), along_r(g1, b), fg);
                        rgb.push(lerp(along_g(b0), along_g(b1), fb));
                    }
                }
            }
        }
        Lut3d { key: self.key, size: m as u32, rgb, edge_aligned: self.edge_aligned }
    }
}

/// CapCut's chroma key over a layer's own pixels (chroma.wgsl): the picked colour (straight
/// RGB, 0–1) and its intensity, shadow, edge smoothing and spill (0–1, the panel's 0–100).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ChromaKey {
    pub color: [f32; 3],
    pub intensity: f32,
    pub shadow: f32,
    pub edge_smooth: f32,
    pub spill: f32,
}

pub use openrip_frame::RgbaImage;
use openrip_frame::VideoFrame;
use wgpu::util::DeviceExt;

pub const DOWNSCALE_SHARPEN: f32 = 0.15;

#[derive(Debug, thiserror::Error)]
pub enum RenderError {
    #[error("no GPU adapter: {0}")]
    Adapter(String),
    #[error("GPU device: {0}")]
    Device(String),
}

/// Pixels for a layer.
#[derive(Copy, Clone, Debug)]
pub enum Source<'a> {
    Image(&'a RgbaImage),
    /// An image whose content `key` identifies: the compositor keeps it on the GPU,
    /// already resampled, for as long as it keeps being drawn (stills, text).
    Cached(u64, &'a RgbaImage),
    Video(&'a VideoFrame),
    /// Not an image: a colour lookup table applied to everything drawn below it, mixed in
    /// by the given strength (a filter track).
    Filter(&'a Lut3d, f32),
    /// Not an image: everything drawn below it blurred, horizontally then vertically, by
    /// CapCut's transition blur with its taps this many output pixels apart.
    Blur(f32),
    /// Not an image: the layers after it, up to the matching `EndGroup`, draw into a group
    /// of their own the canvas's size instead, over this colour (opaque) or clear. A
    /// transition draws each of its clips so.
    BeginGroup(Option<[u8; 3]>),
    /// The group begun last is finished, and waits for a `Mix` layer.
    EndGroup,
    /// Not an image: the groups finished last put together over everything below (a
    /// transition): the incoming clip's group the last one finished and the outgoing one's
    /// before it, each only if the mix draws it.
    Mix(Mix),
    /// A frame made in between two frames of a video (Smooth slow-mo, Optical flow).
    Tween(Tween<'a>),
    /// The group begun last, finished and placed as a picture of the canvas's size (`w`×`h`)
    /// with everything else a layer has (placement, opacity, blend, adjustments, masks): a
    /// compound clip's content drawn as one clip.
    Group(u32, u32),
    /// Not an image: one of OpenRip's own video effects (`effects.wgsl`) over everything drawn
    /// so far on the canvas, or in the open group.
    Effect(EffectPass),
    /// Not an image: an adjustment layer. The layer's own `lut`, `match_lut` and `adjust` (the
    /// Adjust tab's colour tools) grade everything drawn so far on the canvas, or in the open
    /// group, and its `mattes` limit the grade to where they show.
    Grade,
}

impl Source<'_> {
    pub fn size(&self) -> (u32, u32) {
        match self {
            Source::Image(i) | Source::Cached(_, i) => (i.width, i.height),
            Source::Video(f) => (f.width(), f.height()),
            Source::Tween(t) => t.from.size(),
            Source::Group(w, h) => (*w, *h),
            Source::Filter(..) | Source::Blur(_) | Source::BeginGroup(_) | Source::EndGroup | Source::Mix(_) | Source::Effect(_) | Source::Grade => (1, 1),
        }
    }
}

/// Two clips' groups put together by a transition (see [`Source::Mix`]): each placed and
/// faded, the incoming one over the outgoing one inside `mask`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mix {
    pub outgoing: Option<Shot>,
    pub incoming: Option<Shot>,
    pub mask: MixMask,
    /// A shader transition (`glt`) drawn in place of the placed, masked mix: the two groups
    /// are its pictures (each `Some` shot says the group is drawn; the rest of the shot is
    /// unused).
    pub fx: Option<glt::GlFx>,
}

/// One clip's group in a [`Mix`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shot {
    /// Output pixel centre (x, y) → the group's texel coordinates: u = `inverse[0]` · (x, y,
    /// 1), v = `inverse[1]` · (x, y, 1).
    pub inverse: [[f32; 3]; 2],
    pub alpha: f32,
    /// CapCut's Pull in blur towards the canvas centre (0 for none; see mix.wgsl).
    pub zoom_blur: f32,
    /// Mirrored copies of the group outside it rather than nothing.
    pub mirror: bool,
}

/// Where the incoming clip of a [`Mix`] shows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MixMask {
    All,
    /// Where the distance from the canvas centre along `toward` (canvas fractions) is at
    /// least `at`, softened over `feather` of the same units.
    Edge { toward: [f32; 2], at: f32, feather: f32 },
    /// Inside a circle about the canvas centre, `radius` and `feather` in canvas heights.
    Circle { radius: f32, feather: f32 },
}

impl<'a> From<&'a RgbaImage> for Source<'a> {
    fn from(i: &'a RgbaImage) -> Self {
        Source::Image(i)
    }
}

impl<'a> From<&'a VideoFrame> for Source<'a> {
    fn from(f: &'a VideoFrame) -> Self {
        Source::Video(f)
    }
}

/// Premultiplied source times the canvas, plus the canvas where the source is clear.
const MULTIPLY: wgpu::BlendState = wgpu::BlendState {
    color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::Dst, dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha, operation: wgpu::BlendOperation::Add },
    alpha: wgpu::BlendComponent::OVER,
};

/// A mask over a layer's own pixels: inside it the layer shows as `inside`, outside as
/// `outside`, each a straight-alpha colour or (`None`) the layer's own pixels.
#[derive(Clone, Copy, Debug)]
pub struct Matte<'a> {
    /// Coverage in the red channel, stretched over the source.
    pub mask: &'a RgbaImage,
    pub inside: Option<[f32; 4]>,
    pub outside: Option<[f32; 4]>,
}

impl<'a> Matte<'a> {
    /// The layer times the mask: clear outside it.
    pub fn cut(mask: &'a RgbaImage) -> Self {
        Matte { mask, inside: None, outside: Some([0.0; 4]) }
    }
}

/// One image placed on the canvas.
#[derive(Clone, Debug)]
pub struct Layer<'a> {
    pub source: Source<'a>,
    /// Centre of the image on the canvas, in output pixels (y down).
    pub center: [f64; 2],
    /// Displayed width and height in output pixels, before rotation.
    pub size: [f64; 2],
    /// Degrees, clockwise on screen.
    pub rotation: f64,
    pub flip_h: bool,
    pub flip_v: bool,
    pub opacity: f32,
    /// CapCut's Adjust sliders for this layer, with its exposure tables if known.
    pub adjust: Option<(Adjust, Option<&'a ExposureLuts>)>,
    /// Masks over the whole source (in the texture's own axes, stretched to it), applied in
    /// order before placement.
    pub mattes: Vec<Matte<'a>>,
    /// Multiplies the canvas under it rather than covering it (a highlighter's strokes).
    pub multiply: bool,
    /// The app's own clip filters, after the mattes.
    pub app_filters: Option<AppFilters>,
    /// How it's put over the layers below it (CapCut's Blend › Mode); `Normal` is "over".
    pub blend: BlendMode,
    /// A chroma key on its own pixels, first of all.
    pub chroma: Option<ChromaKey>,
    /// A lookup table on its own pixels (a LUT on the clip) and its strength, after the
    /// chroma key and before the colour grade, as CapCut orders them.
    pub lut: Option<(&'a Lut3d, f32)>,
    /// Adjust ▸ Color match's table (generated from the clip's and the reference's colours)
    /// and its intensity, on its own pixels after the chroma key and before `lut`, as the
    /// Basic tab lists them.
    pub match_lut: Option<(&'a Lut3d, f32)>,
    /// Reduce image noise, Motion blur and Remove flickers on a video's own pixels, before
    /// anything else (and before it is resized, so a preview and an export clean the same
    /// picture).
    pub enhance: Option<Enhance<'a>>,
}

/// The app's own clip filters (`components/preview/webgl-filters`), on its scales.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AppFilters {
    /// −100 to 100.
    pub brightness: f32,
    pub contrast: f32,
    pub hue: f32,
    pub saturation: f32,
    /// 0 to 100.
    pub blur: f32,
    pub sharpness: f32,
    pub noise: f32,
    pub vignette: f32,
    /// Source pixels per pixel of the app's working canvas (the clip fitted to its world).
    pub step: f32,
    /// Varies the grain from frame to frame.
    pub seed: f32,
}

impl AppFilters {
    pub fn is_identity(&self) -> bool {
        [self.brightness, self.contrast, self.hue, self.saturation, self.blur, self.sharpness, self.noise, self.vignette].iter().all(|v| *v == 0.0)
    }

    /// The passes the app runs, in its order, with their parameters (`a, b, step, seed`).
    fn passes<'p>(&self, fx: &'p AppFx) -> Vec<(&'p wgpu::RenderPipeline, [f32; 4])> {
        let p = |a: f32, b: f32| [a, b, self.step, self.seed];
        let mut out = Vec::new();
        if self.brightness != 0.0 {
            out.push((&fx.brightness, p(self.brightness / 100.0, 0.0)));
        }
        if self.contrast != 0.0 {
            out.push((&fx.contrast, p(self.contrast / 100.0, 0.0)));
        }
        if self.hue != 0.0 || self.saturation != 0.0 {
            out.push((&fx.huesat, p(self.hue * 3.6 / 360.0, self.saturation / 100.0)));
        }
        if self.blur > 0.0 {
            // 0–100 is a radius of 0–10 app pixels.
            let r = self.blur / 100.0 * 10.0;
            out.push((&fx.blur_h, p(r, 0.0)));
            out.push((&fx.blur_v, p(r, 0.0)));
        }
        if self.sharpness > 0.0 {
            out.push((&fx.sharpen, p(self.sharpness / 100.0, 0.0)));
        }
        if self.noise > 0.0 {
            out.push((&fx.noise, p(self.noise / 100.0, 0.0)));
        }
        if self.vignette > 0.0 {
            out.push((&fx.vignette, p(self.vignette / 100.0, 0.0)));
        }
        out
    }
}

/// The app filters' pipelines (appfx.wgsl).
struct AppFx {
    brightness: wgpu::RenderPipeline,
    contrast: wgpu::RenderPipeline,
    huesat: wgpu::RenderPipeline,
    blur_h: wgpu::RenderPipeline,
    blur_v: wgpu::RenderPipeline,
    sharpen: wgpu::RenderPipeline,
    noise: wgpu::RenderPipeline,
    vignette: wgpu::RenderPipeline,
}

impl<'a> Layer<'a> {
    /// A layer that isn't an image placed on the canvas (a filter, a blur, a group's start or
    /// end, a mix), which only its source describes.
    pub fn pass(source: Source<'a>) -> Self {
        Layer {
            source,
            center: [0.0, 0.0],
            size: [1.0, 1.0],
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            opacity: 1.0,
            adjust: None,
            mattes: Vec::new(),
            multiply: false,
            app_filters: None,
            blend: BlendMode::Normal,
            chroma: None,
            lut: None,
            match_lut: None,
            enhance: None,
        }
    }

    /// An image placed at `center` (output pixels) at `size`, upright and opaque, with nothing
    /// else on it.
    pub fn placed(source: Source<'a>, center: [f64; 2], size: [f64; 2]) -> Self {
        Layer { center, size, ..Layer::pass(source) }
    }

    /// Place an image the way the project model does: `position` in half-canvas units
    /// (+y up), `scale` relative to contain-fit, `rotation` clockwise degrees.
    pub fn from_model(source: impl Into<Source<'a>>, canvas: [u32; 2], position: [f64; 2], scale: [f64; 2], rotation: f64) -> Self {
        Self::from_model_oriented(source, canvas, position, scale, rotation, 0)
    }

    /// Like [`Layer::from_model`] for a source stored sideways or upside down (phone video:
    /// `orientation` is the clockwise turn, 0/90/180/270, that displays it upright). Fit,
    /// scale and flips apply to the upright picture.
    pub fn from_model_oriented(source: impl Into<Source<'a>>, canvas: [u32; 2], position: [f64; 2], scale: [f64; 2], rotation: f64, orientation: i32) -> Self {
        let source = source.into();
        let (sw, sh) = source.size();
        let sideways = orientation.rem_euclid(180) == 90;
        let (uw, uh) = if sideways { (sh, sw) } else { (sw, sh) };
        let (w, h) = (canvas[0] as f64, canvas[1] as f64);
        let fit = (w / uw as f64).min(h / uh as f64);
        // The texture's own axes: swapped relative to the screen when sideways. The flips are
        // the texture's too (the placement mirrors its u and v), so a mirror on screen's x is
        // the texture's v flip when it's on its side.
        let (sx, sy) = if sideways { (scale[1], scale[0]) } else { (scale[0], scale[1]) };
        Layer {
            source,
            center: [w / 2.0 + position[0] * w / 2.0, h / 2.0 - position[1] * h / 2.0],
            size: [sw as f64 * fit * sx.abs(), sh as f64 * fit * sy.abs()],
            rotation: rotation + orientation as f64,
            flip_h: sx < 0.0,
            flip_v: sy < 0.0,
            opacity: 1.0,
            adjust: None,
            mattes: Vec::new(),
            multiply: false,
            app_filters: None,
            blend: BlendMode::Normal,
            chroma: None,
            lut: None,
            match_lut: None,
            enhance: None,
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    src_size: [f32; 2],
    dst_size: [f32; 2],
    inv0: [f32; 4],
    inv1: [f32; 4],
    misc: [f32; 4],
}

pub struct Compositor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    yuv_layout: wgpu::BindGroupLayout,
    /// The shader transitions' pipelines (glt).
    glt: glt::Pipelines,
    /// A hardware frame's YUV planes -> RGBA (only the Apple interop imports planes so far).
    #[cfg_attr(not(target_vendor = "apple"), allow(dead_code))]
    yuv: wgpu::RenderPipeline,
    area: wgpu::RenderPipeline,
    sharpen: wgpu::RenderPipeline,
    bilinear: wgpu::RenderPipeline,
    /// Straight-alpha pixels as written -> premultiplied (see `upload`).
    premultiply: wgpu::RenderPipeline,
    place: wgpu::RenderPipeline,
    /// The placement pass for BGRA targets (IOSurfaces handed to the app).
    place_bgra: wgpu::RenderPipeline,
    /// Placement that multiplies the canvas (opaque, so cs·cb + cb·(1−αs) is exact).
    place_multiply: wgpu::RenderPipeline,
    place_multiply_bgra: wgpu::RenderPipeline,
    /// RGBA canvas -> NV12 planes for the encoder (VideoToolbox's, so far).
    #[cfg_attr(not(target_vendor = "apple"), allow(dead_code))]
    luma: wgpu::RenderPipeline,
    #[cfg_attr(not(target_vendor = "apple"), allow(dead_code))]
    chroma: wgpu::RenderPipeline,
    /// CapCut's Adjust sliders and its Sharpen (adjust.wgsl).
    adjust: wgpu::RenderPipeline,
    sharpen_luma: wgpu::RenderPipeline,
    /// Filter tracks: a 3D lookup table over the canvas (filter.wgsl).
    lut3d: wgpu::RenderPipeline,
    blur: wgpu::RenderPipeline,
    matte: wgpu::RenderPipeline,
    /// Transitions putting two clips' groups together (mix.wgsl), onto RGBA and BGRA targets.
    mix: wgpu::RenderPipeline,
    mix_bgra: wgpu::RenderPipeline,
    /// Placement with a blend mode over a copy of the canvas (blend.wgsl), onto RGBA and BGRA.
    place_blend: wgpu::RenderPipeline,
    place_blend_bgra: wgpu::RenderPipeline,
    /// The chroma key's three passes (chroma.wgsl).
    chroma_key: wgpu::RenderPipeline,
    chroma_x: wgpu::RenderPipeline,
    chroma_y: wgpu::RenderPipeline,
    appfx: AppFx,
    /// OpenRip's own video effects (effects.wgsl).
    fx: wgpu::RenderPipeline,
    /// CapCut's colour features around the Adjust pass (grade.rs).
    grade: grade::GradeFx,
    /// Exposure lookup tables on the GPU, by key, and a stand-in for clips without one.
    luts: std::sync::Mutex<std::collections::HashMap<u64, wgpu::Texture>>,
    no_lut: wgpu::Texture,
    /// Resampled textures of keyed images, with the frame they were last drawn in.
    cache: std::sync::Mutex<std::collections::HashMap<CacheKey, (wgpu::Texture, u64)>>,
    /// Keyed images premultiplied at full size: written ahead by other threads, or by the
    /// frame that first drew them.
    uploaded: std::sync::Arc<std::sync::Mutex<upload::Uploaded>>,
    frame: std::sync::atomic::AtomicU64,
    /// Pixels the frames wrote to the GPU themselves (see `pixels_written`).
    written: std::sync::atomic::AtomicU64,
    /// Intermediate textures from earlier frames, with the frame they were last used in.
    /// Allocating a 4K texture costs milliseconds; the same sizes come back every frame.
    pool: std::sync::Mutex<Vec<(wgpu::Texture, u64)>>,
    /// The last readback buffer, reused when the next readback is the same size.
    readback: std::sync::Mutex<Option<wgpu::Buffer>>,
    /// The optical flow passes, made the first time a frame needs them.
    flow_fx: std::sync::OnceLock<flow::FlowFx>,
    /// The clean-up passes, made the first time a frame needs them.
    enhance_fx: std::sync::OnceLock<enhance::EnhanceFx>,
    /// Flow between pairs of frames, by the pair's key, with the frame last used in.
    flows: std::sync::Mutex<Vec<(u64, flow::FlowPair, u64)>>,
}

/// Textures the GPU still needs for a recorded frame: `keep` must merely live until the work
/// is submitted; `scratch` can go back to the pool afterwards.
struct FrameTextures {
    _keep: Vec<wgpu::Texture>,
    scratch: Vec<wgpu::Texture>,
}

/// A keyed image at a displayed size: (key, width, height).
type CacheKey = (u64, u32, u32);

/// Keyed images not drawn for this many frames leave the GPU cache.
const CACHE_FRAMES: u64 = 3;
/// Pooled textures not reused for this many frames are freed, and the pool never holds more
/// than `POOL_MAX`.
const POOL_FRAMES: u64 = 3;
const POOL_MAX: usize = 32;

const CANVAS: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const WIDE: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

impl Compositor {
    /// A headless compositor on the default GPU.
    pub fn new() -> Result<Self, RenderError> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() }))
            .map_err(|e| RenderError::Adapter(e.to_string()))?;
        // 16-bit normalised textures let P010 planes be sampled directly.
        let required_features = adapter.features() & wgpu::Features::TEXTURE_FORMAT_16BIT_NORM;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { label: Some("openrip compositor"), required_features, ..Default::default() }))
            .map_err(|e| RenderError::Device(e.to_string()))?;
        // A GPU validation error is reported, not raised: wgpu's default handler panics, and a
        // panic inside the app's call into the engine takes the whole app down.
        device.on_uncaptured_error(std::sync::Arc::new(|e| eprintln!("[render] GPU error: {e}")));
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("compositor"), source: wgpu::ShaderSource::Wgsl(include_str!("shaders.wgsl").into()) });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
            ],
        });
        let plane = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
            count: None,
        };
        let yuv_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                plane(0),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
                plane(2),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let yuv_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&yuv_layout)], immediate_size: 0 });
        let pipeline = |entry: &str, format: wgpu::TextureFormat, blend: Option<wgpu::BlendState>| {
            let layout = if entry == "fs_yuv" { &yuv_pipeline_layout } else { &pipeline_layout };
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(layout),
                vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        let adjust_module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("adjust"), source: wgpu::ShaderSource::Wgsl(include_str!("adjust.wgsl").into()) });
        let adjust_pipeline = |entry: &str| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(&yuv_pipeline_layout),
                vertex: wgpu::VertexState { module: &adjust_module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                fragment: Some(wgpu::FragmentState {
                    module: &adjust_module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format: CANVAS, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        Ok(Compositor {
            yuv: pipeline("fs_yuv", CANVAS, None),
            area: pipeline("fs_area", WIDE, None),
            sharpen: pipeline("fs_sharpen", CANVAS, None),
            bilinear: pipeline("fs_bilinear", CANVAS, None),
            premultiply: pipeline("fs_premultiply", CANVAS, None),
            place: pipeline("fs_place", CANVAS, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
            place_bgra: pipeline("fs_place", wgpu::TextureFormat::Bgra8Unorm, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
            place_multiply: pipeline("fs_place", CANVAS, Some(MULTIPLY)),
            place_multiply_bgra: pipeline("fs_place", wgpu::TextureFormat::Bgra8Unorm, Some(MULTIPLY)),
            luma: pipeline("fs_luma", wgpu::TextureFormat::R8Unorm, None),
            chroma: pipeline("fs_chroma", wgpu::TextureFormat::Rg8Unorm, None),
            sharpen_luma: adjust_pipeline("fs_sharpen_luma"),
            lut3d: {
                let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("filter"), source: wgpu::ShaderSource::Wgsl(include_str!("filter.wgsl").into()) });
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("fs_lut3d"),
                    layout: Some(&yuv_pipeline_layout),
                    vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some("fs_lut3d"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState { format: CANVAS, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                    }),
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                })
            },
            blur: {
                let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("blur"), source: wgpu::ShaderSource::Wgsl(include_str!("filter.wgsl").into()) });
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("fs_blur"),
                    layout: Some(&yuv_pipeline_layout),
                    vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some("fs_blur"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState { format: CANVAS, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                    }),
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                })
            },
            appfx: {
                let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("appfx"), source: wgpu::ShaderSource::Wgsl(include_str!("appfx.wgsl").into()) });
                let pipeline = |entry: &str| {
                    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                        label: Some(entry),
                        layout: Some(&yuv_pipeline_layout),
                        vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                        fragment: Some(wgpu::FragmentState {
                            module: &module,
                            entry_point: Some(entry),
                            compilation_options: Default::default(),
                            targets: &[Some(wgpu::ColorTargetState { format: CANVAS, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                        }),
                        primitive: Default::default(),
                        depth_stencil: None,
                        multisample: Default::default(),
                        multiview_mask: None,
                        cache: None,
                    })
                };
                AppFx {
                    brightness: pipeline("fs_brightness"),
                    contrast: pipeline("fs_contrast"),
                    huesat: pipeline("fs_huesat"),
                    blur_h: pipeline("fs_blur_h"),
                    blur_v: pipeline("fs_blur_v"),
                    sharpen: pipeline("fs_sharpen"),
                    noise: pipeline("fs_noise"),
                    vignette: pipeline("fs_vignette"),
                }
            },
            matte: {
                let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("matte"), source: wgpu::ShaderSource::Wgsl(include_str!("matte.wgsl").into()) });
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("fs_matte"),
                    layout: Some(&yuv_pipeline_layout),
                    vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some("fs_matte"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState { format: CANVAS, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                    }),
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                })
            },
            mix: mix_pipeline(&device, &yuv_pipeline_layout, CANVAS),
            mix_bgra: mix_pipeline(&device, &yuv_pipeline_layout, wgpu::TextureFormat::Bgra8Unorm),
            place_blend: pass_pipeline(&device, &yuv_pipeline_layout, include_str!("blend.wgsl"), "fs_place_blend", CANVAS),
            place_blend_bgra: pass_pipeline(&device, &yuv_pipeline_layout, include_str!("blend.wgsl"), "fs_place_blend", wgpu::TextureFormat::Bgra8Unorm),
            chroma_key: pass_pipeline(&device, &yuv_pipeline_layout, include_str!("chroma.wgsl"), "fs_chroma_key", CANVAS),
            chroma_x: pass_pipeline(&device, &yuv_pipeline_layout, include_str!("chroma.wgsl"), "fs_chroma_smooth_x", CANVAS),
            chroma_y: pass_pipeline(&device, &yuv_pipeline_layout, include_str!("chroma.wgsl"), "fs_chroma_smooth_y", CANVAS),
            adjust: adjust_pipeline("fs_adjust"),
            fx: pass_pipeline(&device, &yuv_pipeline_layout, include_str!("effects.wgsl"), "fs", CANVAS),
            grade: grade::GradeFx::new(&device, &yuv_pipeline_layout),
            luts: Default::default(),
            no_lut: device.create_texture(&wgpu::TextureDescriptor {
                label: Some("no lut"),
                size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: CANVAS,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            }),
            glt: glt::Pipelines::new(&device),
            device,
            queue,
            layout,
            yuv_layout,
            cache: Default::default(),
            uploaded: std::sync::Arc::new(std::sync::Mutex::new(upload::Uploaded::new())),
            frame: Default::default(),
            written: Default::default(),
            pool: Default::default(),
            readback: Default::default(),
            flow_fx: Default::default(),
            enhance_fx: Default::default(),
            flows: Default::default(),
        })
    }

    /// A texture to render into: one from the pool if it fits, else a new one. Its contents
    /// are undefined; every caller clears or overwrites it.
    fn texture(&self, w: u32, h: u32, format: wgpu::TextureFormat, extra: wgpu::TextureUsages) -> wgpu::Texture {
        let usage = wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT | extra;
        {
            let mut pool = self.pool.lock().unwrap();
            if let Some(i) = pool.iter().position(|(t, _)| t.width() == w && t.height() == h && t.format() == format && t.usage() == usage) {
                return pool.swap_remove(i).0;
            }
        }
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage,
            view_formats: &[],
        })
    }

    /// Return textures to the pool once their frame is submitted (the queue runs in order,
    /// so the next frame's writes come after this frame's reads).
    fn recycle(&self, textures: Vec<wgpu::Texture>) {
        let frame = self.frame.load(std::sync::atomic::Ordering::Relaxed);
        let mut pool = self.pool.lock().unwrap();
        pool.extend(textures.into_iter().map(|t| (t, frame)));
        pool.retain(|(_, last)| frame - *last < POOL_FRAMES);
        if pool.len() > POOL_MAX {
            pool.sort_by_key(|(_, last)| std::cmp::Reverse(*last));
            pool.truncate(POOL_MAX);
        }
    }

    /// A handle for writing stills to this compositor's GPU from other threads, ahead of the
    /// frames that draw them.
    pub fn uploader(&self) -> Uploader {
        Uploader::new(self.device.clone(), self.queue.clone(), self.layout.clone(), self.premultiply.clone(), self.uploaded.clone())
    }

    /// Whether the image `key` is on the GPU: premultiplied (written ahead, or drawn lately)
    /// or resampled for one of the last frames.
    pub fn holds(&self, key: u64) -> bool {
        self.uploaded.lock().unwrap().holds(key) || self.cache.lock().unwrap().keys().any(|(k, _, _)| *k == key)
    }

    /// Pixels of images the frames wrote to the GPU themselves so far, rather than finding
    /// them there (written ahead, or kept from an earlier frame); for tracing.
    pub fn pixels_written(&self) -> u64 {
        self.written.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// `img` on the GPU, premultiplied (every pass works on premultiplied colour): its
    /// straight pixels written as they are and premultiplied by a pass, the texture they were
    /// written to going in `scratch`. A keyed image (`key`) is kept premultiplied, or found
    /// there already (see [`Uploader`]): don't render into it or recycle it.
    fn upload(&self, enc: &mut wgpu::CommandEncoder, img: &RgbaImage, key: Option<u64>, scratch: &mut Vec<wgpu::Texture>) -> wgpu::Texture {
        let max = self.device.limits().max_texture_dimension_2d;
        if img.width > max || img.height > max {
            // Beyond the GPU's texture limit (panoramas): box-filter it down to fit first.
            let k = img.width.max(img.height).div_ceil(max);
            return self.upload(enc, &box_shrink(img, k), None, scratch);
        }
        let frame = self.frame.load(std::sync::atomic::Ordering::Relaxed);
        if let Some(tex) = key.and_then(|k| self.uploaded.lock().unwrap().get(k, img.width, img.height, frame)) {
            return tex;
        }
        let straight = self.texture(img.width, img.height, CANVAS, wgpu::TextureUsages::COPY_DST);
        upload::write(&self.queue, &straight, img);
        self.written.fetch_add(img.width as u64 * img.height as u64, std::sync::atomic::Ordering::Relaxed);
        let tex = self.texture(img.width, img.height, CANVAS, wgpu::TextureUsages::empty());
        upload::premultiply(&self.device, &self.layout, &self.premultiply, enc, &straight, &tex);
        scratch.push(straight);
        if let Some(k) = key {
            self.uploaded.lock().unwrap().insert(k, tex.clone(), Some(frame));
        }
        tex
    }

    fn pass(&self, enc: &mut wgpu::CommandEncoder, pipeline: &wgpu::RenderPipeline, src: &wgpu::Texture, dst: &wgpu::Texture, params: Params, clear: Option<wgpu::Color>) {
        self.pass_with(enc, pipeline, src, None, dst, params, clear)
    }

    #[allow(clippy::too_many_arguments)]
    fn pass_with(
        &self,
        enc: &mut wgpu::CommandEncoder,
        pipeline: &wgpu::RenderPipeline,
        src: &wgpu::Texture,
        chroma: Option<&wgpu::Texture>,
        dst: &wgpu::Texture,
        params: Params,
        clear: Option<wgpu::Color>,
    ) {
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::bytes_of(&params), usage: wgpu::BufferUsages::UNIFORM });
        let src_view = src.create_view(&Default::default());
        let chroma_view = chroma.map(|c| c.create_view(&Default::default()));
        let mut entries = vec![
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src_view) },
            wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() },
        ];
        if let Some(v) = &chroma_view {
            entries.push(wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(v) });
        }
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: if chroma.is_some() { &self.yuv_layout } else { &self.layout }, entries: &entries });
        let dst_view = dst.create_view(&Default::default());
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &dst_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: clear.map_or(wgpu::LoadOp::Load, wgpu::LoadOp::Clear), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }

    /// Apply a clip's colour grade to `src` in CapCut's order: HSL and curves, the Adjust
    /// pass, Sharpen, clarity, then the vignette, each only when set. Returns the result (a
    /// pooled texture, or `src` itself if nothing changed it) and the intermediates to
    /// recycle.
    fn grade(&self, enc: &mut wgpu::CommandEncoder, src: &wgpu::Texture, adjust: &Adjust, luts: Option<&ExposureLuts>) -> (wgpu::Texture, Vec<wgpu::Texture>) {
        let (w, h) = (src.width(), src.height());
        let mut middle = Vec::new();
        let mut out: Option<wgpu::Texture> = None;
        if !adjust.colour_identity() {
            let next = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
            self.colour_pass(enc, src, &next, adjust.curves.as_deref().filter(|c| !c.is_identity()), &adjust.hsl);
            out = Some(next);
        }
        if !adjust.sliders_identity() {
            let next = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
            self.adjust_pass(enc, &self.adjust, out.as_ref().unwrap_or(src), &next, adjust, luts);
            middle.extend(out.replace(next));
            if adjust.sharpen.abs() > 1e-5 {
                let next = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
                self.adjust_pass(enc, &self.sharpen_luma, out.as_ref().unwrap_or(src), &next, adjust, luts);
                middle.extend(out.replace(next));
            }
        }
        if adjust.clarity.abs() > 1e-5 {
            let next = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
            self.clarity_pass(enc, out.as_ref().unwrap_or(src), &next, adjust.clarity, &mut middle);
            middle.extend(out.replace(next));
        }
        if adjust.vignette.abs() > 1e-5 {
            let next = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
            self.vignette_pass(enc, out.as_ref().unwrap_or(src), &next, adjust.vignette);
            middle.extend(out.replace(next));
        }
        (out.unwrap_or_else(|| src.clone()), middle)
    }

    /// Run one of the grade pipelines from `src` into `dst` (same size).
    fn adjust_pass(&self, enc: &mut wgpu::CommandEncoder, pipeline: &wgpu::RenderPipeline, src: &wgpu::Texture, dst: &wgpu::Texture, adjust: &Adjust, luts: Option<&ExposureLuts>) {
        // The table for the exposure slider's direction, with the fade table below it if the
        // bundle has one, uploaded once per key.
        let lut = luts.filter(|_| adjust.exposure.abs() > 1e-5 || adjust.fade.abs() > 1e-5).map(|l| {
            let key = l.key ^ (adjust.exposure > 0.0) as u64;
            let mut cache = self.luts.lock().unwrap();
            cache
                .entry(key)
                .or_insert_with(|| {
                    let img = if adjust.exposure > 0.0 { &l.brighter } else { &l.darker };
                    let fade = l.fade.as_deref().filter(|f| (f.width, f.height) == (img.width, img.height));
                    let data = match fade {
                        Some(f) => [img.data.as_slice(), f.data.as_slice()].concat(),
                        None => img.data.clone(),
                    };
                    let img = RgbaImage { width: img.width, height: img.height * (1 + fade.is_some() as u32), data };
                    let tex = self.device.create_texture(&wgpu::TextureDescriptor {
                        label: Some("exposure lut"),
                        size: wgpu::Extent3d { width: img.width, height: img.height, depth_or_array_layers: 1 },
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format: CANVAS,
                        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                        view_formats: &[],
                    });
                    self.queue.write_texture(
                        wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                        &img.data,
                        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(img.width * 4), rows_per_image: Some(img.height) },
                        wgpu::Extent3d { width: img.width, height: img.height, depth_or_array_layers: 1 },
                    );
                    tex
                })
                .clone()
        });
        // Tables of the wrong shape are ignored rather than read out of bounds.
        let lut = lut.filter(|t| t.width() == 289 && (t.height() == 17 || t.height() == 34));
        let params = adjust.params(lut.is_some(), lut.as_ref().is_some_and(|t| t.height() == 34));
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::bytes_of(&params), usage: wgpu::BufferUsages::UNIFORM });
        let src_view = src.create_view(&Default::default());
        let lut_view = lut.as_ref().unwrap_or(&self.no_lut).create_view(&Default::default());
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.yuv_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src_view) },
                wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&lut_view) },
            ],
        });
        let dst_view = dst.create_view(&Default::default());
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &dst_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }

    /// Apply a filter track to the canvas so far: look up into a temporary, then draw it
    /// back over the canvas.
    /// One full-texture pass of a filter.wgsl pipeline: `src` and `aux` (bindings 0 and 2)
    /// and four parameters in, `dst` out.
    fn canvas_pass(&self, enc: &mut wgpu::CommandEncoder, pipeline: &wgpu::RenderPipeline, src: &wgpu::Texture, aux: &wgpu::Texture, dst: &wgpu::Texture, params: &[f32]) {
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::cast_slice(params), usage: wgpu::BufferUsages::UNIFORM });
        let (src_view, aux_view, dst_view) = (src.create_view(&Default::default()), aux.create_view(&Default::default()), dst.create_view(&Default::default()));
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.yuv_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src_view) },
                wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&aux_view) },
            ],
        });
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &dst_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }

    /// Blur everything drawn so far: CapCut's transition blur, horizontally then vertically.
    fn blur_canvas(&self, enc: &mut wgpu::CommandEncoder, canvas: &wgpu::Texture, place_pipeline: &wgpu::RenderPipeline, step: f32, scratch: &mut Vec<wgpu::Texture>) {
        let (w, h) = (canvas.width(), canvas.height());
        let no_lut = self.no_lut.create_view(&Default::default());
        let mut src = canvas.clone();
        for dir in [[step, 0.0f32], [0.0, step]] {
            let dst = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
            let params: [f32; 4] = [dir[0], dir[1], 0.0, 0.0];
            let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::cast_slice(&params), usage: wgpu::BufferUsages::UNIFORM });
            let (src_view, dst_view) = (src.create_view(&Default::default()), dst.create_view(&Default::default()));
            let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &self.yuv_layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src_view) },
                    wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&no_lut) },
                ],
            });
            {
                let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &dst_view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                pass.set_pipeline(&self.blur);
                pass.set_bind_group(0, &bind, &[]);
                pass.draw(0..3, 0..1);
            }
            scratch.push(dst.clone());
            src = dst;
        }
        // Back onto the canvas, pixel for pixel (opaque, so "over" replaces).
        let back = Params { src_size: [w as f32, h as f32], dst_size: [w as f32, h as f32], inv0: [1.0, 0.0, 0.0, 0.0], inv1: [0.0, 1.0, 0.0, 0.0], misc: [1.0, 0.0, 0.0, 0.0] };
        self.pass(enc, place_pipeline, &src, canvas, back, None);
    }

    /// Put a transition's two groups together over `target` (see mix.wgsl); a group the mix
    /// doesn't draw is `None`, and `blank` stands in for it.
    fn mix_pass(&self, enc: &mut wgpu::CommandEncoder, mix: &Mix, outgoing: Option<&wgpu::Texture>, incoming: Option<&wgpu::Texture>, blank: &wgpu::Texture, target: &wgpu::Texture) {
        if let Some(fx) = &mix.fx {
            // Where a clip isn't drawn its group is clear (or what's below shows).
            self.glt.draw(&self.device, enc, fx, outgoing.unwrap_or(blank), incoming.unwrap_or(blank), target);
            return;
        }
        let row = |s: Option<&Shot>, r: usize| s.map_or([0.0; 4], |s| [s.inverse[r][0], s.inverse[r][1], s.inverse[r][2], if r == 0 { s.alpha } else { s.zoom_blur }]);
        let (a, b) = (mix.outgoing.as_ref().filter(|_| outgoing.is_some()), mix.incoming.as_ref().filter(|_| incoming.is_some()));
        let on = |s: Option<&Shot>| if s.is_some() { 1.0 } else { 0.0 };
        let mirror = |s: Option<&Shot>| if s.is_some_and(|s| s.mirror) { 1.0 } else { 0.0 };
        let (mask, feather) = match mix.mask {
            MixMask::All => ([0.0; 4], 0.0),
            MixMask::Edge { toward, at, feather } => ([1.0, toward[0], toward[1], at], feather),
            MixMask::Circle { radius, feather } => ([2.0, 0.0, 0.0, radius], feather),
        };
        let params: Vec<f32> = [row(a, 0), row(a, 1), row(b, 0), row(b, 1), [on(a), on(b), mirror(a), mirror(b)], mask, [feather, target.width() as f32, target.height() as f32, 0.0]].concat();
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::cast_slice(&params), usage: wgpu::BufferUsages::UNIFORM });
        let (a_view, b_view, dst_view) = (outgoing.unwrap_or(blank).create_view(&Default::default()), incoming.unwrap_or(blank).create_view(&Default::default()), target.create_view(&Default::default()));
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.yuv_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&a_view) },
                wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&b_view) },
            ],
        });
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &dst_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(if target.format() == wgpu::TextureFormat::Bgra8Unorm { &self.mix_bgra } else { &self.mix });
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }

    fn filter_canvas(&self, enc: &mut wgpu::CommandEncoder, canvas: &wgpu::Texture, place_pipeline: &wgpu::RenderPipeline, lut: &Lut3d, strength: f32, scratch: &mut Vec<wgpu::Texture>) {
        let (w, h) = (canvas.width(), canvas.height());
        let tmp = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
        self.lut_pass(enc, canvas, &tmp, lut, strength);
        // Back onto the canvas, pixel for pixel (opaque, so "over" replaces).
        let back = Params { src_size: [w as f32, h as f32], dst_size: [w as f32, h as f32], inv0: [1.0, 0.0, 0.0, 0.0], inv1: [0.0, 1.0, 0.0, 0.0], misc: [1.0, 0.0, 0.0, 0.0] };
        self.pass(enc, place_pipeline, &tmp, canvas, back, None);
        scratch.push(tmp);
    }

    /// An adjustment layer: the layer's LUTs and colour grade applied to the canvas so far (CapCut's
    /// order: Color match, LUT, then the Adjust tab's tools), limited to the layer's mattes, and
    /// drawn back over it. Nothing set draws nothing.
    fn grade_canvas(&self, enc: &mut wgpu::CommandEncoder, canvas: &wgpu::Texture, place_pipeline: &wgpu::RenderPipeline, layer: &Layer, scratch: &mut Vec<wgpu::Texture>) {
        let (w, h) = (canvas.width(), canvas.height());
        // The graded copy so far; `made` is false while it is still the canvas itself.
        let (mut cur, mut made) = (canvas.clone(), false);
        for (lut, strength) in [layer.match_lut, layer.lut].into_iter().flatten().filter(|(_, s)| *s > 0.0) {
            let out = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
            self.lut_pass(enc, &cur, &out, lut, strength);
            if made {
                scratch.push(cur);
            }
            (cur, made) = (out, true);
        }
        if let Some((a, luts)) = layer.adjust.as_ref().filter(|(a, _)| !a.is_identity()) {
            let (out, middle) = self.grade(enc, &cur, a, *luts);
            scratch.extend(middle);
            if made {
                scratch.push(cur);
            }
            (cur, made) = (out, true);
        }
        if !made {
            return;
        }
        for m in &layer.mattes {
            let mask = self.upload(enc, m.mask, None, scratch);
            let out = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
            let paint = |p: Option<[f32; 4]>| p.map_or([0.0, 0.0, 0.0, -1.0], |c| [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]]);
            let params: Vec<f32> = paint(m.inside).into_iter().chain(paint(m.outside)).collect();
            self.canvas_pass(enc, &self.matte, &cur, &mask, &out, &params);
            scratch.push(cur);
            scratch.push(mask);
            cur = out;
        }
        // Back onto the canvas, pixel for pixel: inside the mattes the graded copy covers it.
        let back = Params { src_size: [w as f32, h as f32], dst_size: [w as f32, h as f32], inv0: [1.0, 0.0, 0.0, 0.0], inv1: [0.0, 1.0, 0.0, 0.0], misc: [1.0, 0.0, 0.0, 0.0] };
        self.pass(enc, place_pipeline, &cur, canvas, back, None);
        scratch.push(cur);
    }

    /// `src` looked up through `lut` and mixed in by `strength`, into `dst` (same size).
    fn lut_pass(&self, enc: &mut wgpu::CommandEncoder, src: &wgpu::Texture, dst: &wgpu::Texture, lut: &Lut3d, strength: f32) {
        let table = {
            let mut cache = self.luts.lock().unwrap();
            cache
                .entry(lut.key | 1 << 63)
                .or_insert_with(|| {
                    // The table is laid out n² wide: one too big for the GPU's textures is
                    // resampled to the largest that fits.
                    let fit = (self.device.limits().max_texture_dimension_2d as f64).sqrt() as u32;
                    let fitted;
                    let lut = if lut.size > fit {
                        fitted = lut.resampled(fit);
                        &fitted
                    } else {
                        lut
                    };
                    let n = lut.size;
                    let tex = self.device.create_texture(&wgpu::TextureDescriptor {
                        label: Some("filter lut"),
                        size: wgpu::Extent3d { width: n * n, height: n, depth_or_array_layers: 1 },
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format: wgpu::TextureFormat::Rgba32Float,
                        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                        view_formats: &[],
                    });
                    // (r + n * b, g) <- entry r + n g + n² b.
                    let mut texels = vec![0f32; (n * n * n * 4) as usize];
                    for b in 0..n {
                        for g in 0..n {
                            for r in 0..n {
                                let src = ((r + n * g + n * n * b) * 3) as usize;
                                let dst = ((g * n * n + r + n * b) * 4) as usize;
                                texels[dst..dst + 3].copy_from_slice(&lut.rgb[src..src + 3]);
                                texels[dst + 3] = 1.0;
                            }
                        }
                    }
                    self.queue.write_texture(
                        wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                        bytemuck::cast_slice(&texels),
                        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(n * n * 16), rows_per_image: Some(n) },
                        wgpu::Extent3d { width: n * n, height: n, depth_or_array_layers: 1 },
                    );
                    tex
                })
                .clone()
        };
        let n = table.height();
        let params: [f32; 4] = [n as f32, strength.clamp(0.0, 1.0), if lut.edge_aligned { 1.0 } else { 0.0 }, 0.0];
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::cast_slice(&params), usage: wgpu::BufferUsages::UNIFORM });
        let (src_view, table_view, dst_view) = (src.create_view(&Default::default()), table.create_view(&Default::default()), dst.create_view(&Default::default()));
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.yuv_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src_view) },
                wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&table_view) },
            ],
        });
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &dst_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.lut3d);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }

    /// CapCut's chroma key on a layer's own pixels (chroma.wgsl): the matte, smoothed across
    /// and then down with the spill taken off. Returns the keyed picture (the intermediates
    /// go in `scratch`).
    fn chroma_pass(&self, enc: &mut wgpu::CommandEncoder, src: &wgpu::Texture, key: &ChromaKey, scratch: &mut Vec<wgpu::Texture>) -> wgpu::Texture {
        let (w, h) = (src.width(), src.height());
        let params = [key.color[0], key.color[1], key.color[2], 1.0, key.intensity, key.shadow, key.edge_smooth, key.spill, w as f32, h as f32, 0.0, 0.0];
        let matte = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
        self.canvas_pass(enc, &self.chroma_key, src, src, &matte, &params);
        let rows = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
        self.canvas_pass(enc, &self.chroma_x, src, &matte, &rows, &params);
        let out = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
        self.canvas_pass(enc, &self.chroma_y, src, &rows, &out, &params);
        scratch.extend([matte, rows]);
        out
    }

    /// A video frame on the GPU as premultiplied RGBA: its planes imported in place where the
    /// platform allows (they go in `keep`), else converted on the CPU and uploaded.
    fn video_texture(&self, enc: &mut wgpu::CommandEncoder, frame: &VideoFrame, keep: &mut Vec<wgpu::Texture>, scratch: &mut Vec<wgpu::Texture>) -> wgpu::Texture {
        match self.import_video(enc, frame) {
            Some((rgba, planes)) => {
                keep.extend(planes);
                rgba
            }
            None => self.upload(enc, &rgb_of(frame), None, scratch),
        }
    }

    /// One frame of a tween on the GPU as premultiplied RGBA.
    fn picture_texture(&self, enc: &mut wgpu::CommandEncoder, src: Picture, keep: &mut Vec<wgpu::Texture>, scratch: &mut Vec<wgpu::Texture>) -> wgpu::Texture {
        match src {
            Picture::Video(frame) => self.video_texture(enc, frame, keep, scratch),
            Picture::Image(img) => self.upload(enc, img, None, scratch),
        }
    }

    /// Whether a frame can go to the GPU without a copy (diagnostics).
    pub fn can_import(&self, frame: &VideoFrame) -> bool {
        let mut enc = self.device.create_command_encoder(&Default::default());
        self.import_video(&mut enc, frame).is_some()
    }

    /// Record the passes that draw `layers` (bottom first) over `background` (none: transparent)
    /// into `canvas`.
    /// Returns the intermediate textures, which must live until the work is submitted.
    fn encode_frame(&self, enc: &mut wgpu::CommandEncoder, canvas: &wgpu::Texture, background: Option<[u8; 3]>, layers: &[Layer]) -> FrameTextures {
        let (width, height) = (canvas.width(), canvas.height());
        let place_pipeline = if canvas.format() == wgpu::TextureFormat::Bgra8Unorm { &self.place_bgra } else { &self.place };
        let bg = background.map_or(wgpu::Color::TRANSPARENT, |b| wgpu::Color { r: b[0] as f64 / 255.0, g: b[1] as f64 / 255.0, b: b[2] as f64 / 255.0, a: 1.0 });
        // Clear the canvas with an empty placement pass.
        let blank = self.texture(1, 1, CANVAS, wgpu::TextureUsages::empty());
        let mut keep = Vec::new(); // textures must outlive the submission
        let mut scratch = Vec::new(); // ... and these can be reused after it
        let off = Params { src_size: [1.0, 1.0], dst_size: [1.0, 1.0], inv0: [0.0, 0.0, -100.0, 0.0], inv1: [0.0, 0.0, -100.0, 0.0], misc: [0.0; 4] };
        self.pass(enc, place_pipeline, &blank, canvas, off, Some(bg));
        let frame = self.frame.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        let max = self.device.limits().max_texture_dimension_2d;
        // Groups being drawn into (the innermost last), and finished ones waiting for a mix.
        let mut open: Vec<wgpu::Texture> = Vec::new();
        let mut finished: Vec<wgpu::Texture> = Vec::new();
        for layer in layers {
            // A finished group placed as a picture leaves the open ones first: it and the layers
            // after it draw one level up.
            let mut group = if matches!(layer.source, Source::Group(..)) { open.pop() } else { None };
            // Layers draw into the group begun last, else the canvas.
            let canvas = open.last().unwrap_or(canvas);
            let place_pipeline = if canvas.format() == wgpu::TextureFormat::Bgra8Unorm { &self.place_bgra } else { &self.place };
            match layer.source {
                Source::BeginGroup(colour) => {
                    let group = self.texture(width, height, CANVAS, wgpu::TextureUsages::empty());
                    let clear = colour.map_or(wgpu::Color::TRANSPARENT, |c| wgpu::Color { r: c[0] as f64 / 255.0, g: c[1] as f64 / 255.0, b: c[2] as f64 / 255.0, a: 1.0 });
                    self.pass(enc, &self.place, &blank, &group, off, Some(clear));
                    open.push(group);
                    continue;
                }
                Source::EndGroup => {
                    finished.extend(open.pop());
                    continue;
                }
                Source::Mix(mix) => {
                    let incoming = mix.incoming.and_then(|_| finished.pop());
                    let outgoing = mix.outgoing.and_then(|_| finished.pop());
                    self.mix_pass(enc, &mix, outgoing.as_ref(), incoming.as_ref(), &blank, canvas);
                    scratch.extend(outgoing.into_iter().chain(incoming));
                    continue;
                }
                _ => {}
            }
            if let Source::Filter(lut, strength) = layer.source {
                self.filter_canvas(enc, canvas, place_pipeline, lut, strength, &mut scratch);
                continue;
            }
            if let Source::Grade = layer.source {
                self.grade_canvas(enc, canvas, place_pipeline, layer, &mut scratch);
                continue;
            }
            if let Source::Effect(pass) = layer.source {
                self.effect_canvas(enc, canvas, place_pipeline, &pass, open.is_empty(), &mut scratch);
                continue;
            }
            if let Source::Blur(step) = layer.source {
                if step > 0.0 {
                    self.blur_canvas(enc, canvas, place_pipeline, step, &mut scratch);
                }
                continue;
            }
            let (dw, dh) = (layer.size[0], layer.size[1]);
            // A layer zoomed past the GPU's texture limit is staged at the limit; the
            // placement pass scales the rest.
            let fit = (max as f64 / dw.max(dh).max(1.0)).min(1.0);
            let (tw, th) = (((dw * fit).round() as u32).clamp(1, max), ((dh * fit).round() as u32).clamp(1, max));
            let cached = match layer.source {
                Source::Cached(key, _) => self.cache.lock().unwrap().get_mut(&(key, tw, th)).map(|(tex, last)| {
                    *last = frame;
                    tex.clone()
                }),
                _ => None,
            };
            let stage = match cached {
                Some(tex) => tex,
                None => {
                    let src = match layer.source {
                        Source::Image(img) => self.upload(enc, img, None, &mut scratch),
                        Source::Cached(key, img) => self.upload(enc, img, Some(key), &mut scratch),
                        Source::Filter(..) | Source::Blur(_) | Source::BeginGroup(_) | Source::EndGroup | Source::Mix(_) | Source::Effect(_) | Source::Grade => unreachable!("canvas passes are drawn above"),
                        Source::Group(..) => group.take().unwrap_or_else(|| self.texture(width, height, CANVAS, wgpu::TextureUsages::empty())),
                        Source::Video(frame) => self.video_texture(enc, frame, &mut keep, &mut scratch),
                        Source::Tween(tween) => {
                            let a = self.picture_texture(enc, tween.from, &mut keep, &mut scratch);
                            let b = self.picture_texture(enc, tween.to, &mut keep, &mut scratch);
                            let out = self.tween_textures(enc, &a, &b, &tween, &mut scratch);
                            scratch.extend([a, b]);
                            out
                        }
                    };
                    // Clean-up of a video's own picture, at the size it was decoded.
                    let src = match layer.enhance.as_ref().filter(|e| !e.is_identity()) {
                        Some(e) => self.enhance_texture(enc, src, e, &mut keep, &mut scratch),
                        None => src,
                    };
                    // The texture's own size (an oversize image is uploaded smaller).
                    let (sw, sh) = (src.width(), src.height());
                    // A keyed image stays on the GPU premultiplied (see `upload`): it mustn't go
                    // back to the pool.
                    let done_with = |src: wgpu::Texture, keep: &mut Vec<wgpu::Texture>, scratch: &mut Vec<wgpu::Texture>| if matches!(layer.source, Source::Cached(..)) { keep.push(src) } else { scratch.push(src) };
                    let resize = Params { src_size: [sw as f32, sh as f32], dst_size: [tw as f32, th as f32], inv0: [0.0; 4], inv1: [0.0; 4], misc: [1.0, DOWNSCALE_SHARPEN, 0.0, 0.0] };
                    let stage = if (tw, th) == (sw, sh) {
                        src
                    } else if tw < sw && th < sh {
                        let wide = self.texture(tw, th, WIDE, wgpu::TextureUsages::empty());
                        self.pass(enc, &self.area, &src, &wide, resize, Some(wgpu::Color::TRANSPARENT));
                        let sharp = self.texture(tw, th, CANVAS, wgpu::TextureUsages::empty());
                        self.pass(enc, &self.sharpen, &wide, &sharp, resize, Some(wgpu::Color::TRANSPARENT));
                        scratch.push(wide);
                        done_with(src, &mut keep, &mut scratch);
                        sharp
                    } else {
                        let up = self.texture(tw, th, CANVAS, wgpu::TextureUsages::empty());
                        self.pass(enc, &self.bilinear, &src, &up, resize, Some(wgpu::Color::TRANSPARENT));
                        done_with(src, &mut keep, &mut scratch);
                        up
                    };
                    if let Source::Cached(key, _) = layer.source {
                        self.cache.lock().unwrap().insert((key, tw, th), (stage.clone(), frame));
                    }
                    stage
                }
            };
            // A keyed image's stage stays in the cache until a pass replaces it: then it must
            // live until the submission, unrecycled.
            let cached = matches!(layer.source, Source::Cached(..));
            // The chroma key, then Color match's table and a LUT on the clip, on its own pixels
            // (CapCut's order).
            let (mut stage, mut adjusted) = (stage, false);
            if let Some(key) = layer.chroma.filter(|k| k.intensity >= 0.001) {
                let out = self.chroma_pass(enc, &stage, &key, &mut scratch);
                if cached && !adjusted {
                    keep.push(stage);
                } else {
                    scratch.push(stage);
                }
                (stage, adjusted) = (out, true);
            }
            for (lut, strength) in [layer.match_lut, layer.lut].into_iter().flatten().filter(|(_, s)| *s > 0.0) {
                let out = self.texture(stage.width(), stage.height(), CANVAS, wgpu::TextureUsages::empty());
                self.lut_pass(enc, &stage, &out, lut, strength);
                if cached && !adjusted {
                    keep.push(stage);
                } else {
                    scratch.push(stage);
                }
                (stage, adjusted) = (out, true);
            }
            // Adjust sliders on the clip's own pixels, before placement.
            let stage = match layer.adjust.as_ref().filter(|(a, _)| !a.is_identity()) {
                Some((a, luts)) => {
                    let (out, middle) = self.grade(enc, &stage, a, *luts);
                    scratch.extend(middle);
                    if cached && !adjusted {
                        keep.push(stage);
                    } else {
                        scratch.push(stage);
                    }
                    out
                }
                None => stage,
            };
            let adjusted = adjusted || layer.adjust.as_ref().is_some_and(|(a, _)| !a.is_identity());
            // Cut-outs and masks, before placement.
            let (mut stage, mut adjusted) = (stage, adjusted);
            for m in &layer.mattes {
                let mask = self.upload(enc, m.mask, None, &mut scratch);
                let out = self.texture(stage.width(), stage.height(), CANVAS, wgpu::TextureUsages::empty());
                let paint = |p: Option<[f32; 4]>| p.map_or([0.0, 0.0, 0.0, -1.0], |c| [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]]);
                let params: Vec<f32> = paint(m.inside).into_iter().chain(paint(m.outside)).collect();
                self.canvas_pass(enc, &self.matte, &stage, &mask, &out, &params);
                if matches!(layer.source, Source::Cached(..)) && !adjusted {
                    keep.push(stage);
                } else {
                    scratch.push(stage);
                }
                scratch.push(mask);
                (stage, adjusted) = (out, true);
            }
            // The app's own filters, after its masks.
            for (pipeline, params) in layer.app_filters.map(|f| f.passes(&self.appfx)).unwrap_or_default() {
                let out = self.texture(stage.width(), stage.height(), CANVAS, wgpu::TextureUsages::empty());
                self.canvas_pass(enc, pipeline, &stage, &stage, &out, &params);
                if matches!(layer.source, Source::Cached(..)) && !adjusted {
                    keep.push(stage);
                } else {
                    scratch.push(stage);
                }
                (stage, adjusted) = (out, true);
            }
            // Canvas pixel centre -> stage texture coordinates.
            let (sx, sy) = (dw / tw as f64, dh / th as f64);
            let (s, c) = layer.rotation.to_radians().sin_cos();
            let [cx, cy] = layer.center;
            let mut a = [c / sx, s / sx, -(c * cx + s * cy) / sx + tw as f64 / 2.0];
            let mut b = [-s / sy, c / sy, -(-s * cx + c * cy) / sy + th as f64 / 2.0];
            if layer.flip_h {
                a = [-a[0], -a[1], tw as f64 - a[2]];
            }
            if layer.flip_v {
                b = [-b[0], -b[1], th as f64 - b[2]];
            }
            let place = Params {
                src_size: [tw as f32, th as f32],
                dst_size: [width as f32, height as f32],
                inv0: [a[0] as f32, a[1] as f32, a[2] as f32, 0.0],
                inv1: [b[0] as f32, b[1] as f32, b[2] as f32, 0.0],
                misc: [layer.opacity, 0.0, 0.0, 0.0],
            };
            let bgra = canvas.format() == wgpu::TextureFormat::Bgra8Unorm;
            if layer.blend != BlendMode::Normal && !layer.multiply {
                // A blend mode reads the composite below: a copy of the canvas (pixel for
                // pixel, see `blur_canvas`), then the layer placed and blended over it.
                let backdrop = self.texture(width, height, CANVAS, wgpu::TextureUsages::empty());
                let copy = Params { src_size: [width as f32, height as f32], dst_size: [width as f32, height as f32], inv0: [1.0, 0.0, 0.0, 0.0], inv1: [0.0, 1.0, 0.0, 0.0], misc: [1.0, 0.0, 0.0, 0.0] };
                self.pass(enc, &self.place, canvas, &backdrop, copy, Some(wgpu::Color::TRANSPARENT));
                let blended = Params { misc: [layer.opacity, layer.blend.index(), 0.0, 0.0], ..place };
                self.pass_with(enc, if bgra { &self.place_blend_bgra } else { &self.place_blend }, &stage, Some(&backdrop), canvas, blended, None);
                scratch.push(backdrop);
            } else {
                let pipeline = match (layer.multiply, bgra) {
                    (false, _) => place_pipeline,
                    (true, false) => &self.place_multiply,
                    (true, true) => &self.place_multiply_bgra,
                };
                self.pass(enc, pipeline, &stage, canvas, place, None);
            }
            // A keyed image's stage lives on in the cache; anything else is scratch.
            if matches!(layer.source, Source::Cached(..)) && !adjusted {
                keep.push(stage);
            } else {
                scratch.push(stage);
            }
        }
        // Groups left over (a frame cut short) are scratch too.
        scratch.extend(open.into_iter().chain(finished));
        scratch.push(blank);
        self.cache.lock().unwrap().retain(|_, (_, last)| frame - *last < CACHE_FRAMES);
        self.uploaded.lock().unwrap().expire(frame);
        FrameTextures { _keep: keep, scratch }
    }

    /// Wait for the GPU to finish a frame's submission (not the uploads other threads may
    /// have submitted since; the queue runs in order, so earlier ones are done too).
    fn wait_for(&self, done: wgpu::SubmissionIndex) -> Result<(), RenderError> {
        self.device.poll(wgpu::PollType::Wait { submission_index: Some(done), timeout: None }).map(drop).map_err(|e| RenderError::Device(e.to_string()))
    }

    /// Render `layers` (bottom first) over an opaque `background` at `width`×`height` and
    /// read the frame back (tests, stills, analysis).
    pub fn render(&self, width: u32, height: u32, background: [u8; 3], layers: &[Layer]) -> RgbaImage {
        self.render_over(width, height, Some(background), layers)
    }

    /// Render `layers` over nothing: where none draws, the frame is clear. The pixels come back
    /// premultiplied (colour already multiplied by alpha), as the canvas holds them.
    pub fn render_transparent(&self, width: u32, height: u32, layers: &[Layer]) -> RgbaImage {
        self.render_over(width, height, None, layers)
    }

    fn render_over(&self, width: u32, height: u32, background: Option<[u8; 3]>, layers: &[Layer]) -> RgbaImage {
        let canvas = self.texture(width, height, CANVAS, wgpu::TextureUsages::COPY_SRC);
        let mut enc = self.device.create_command_encoder(&Default::default());
        let mut textures = self.encode_frame(&mut enc, &canvas, background, layers);
        // Read back (rows padded to 256 bytes).
        let row = (width * 4).div_ceil(256) * 256;
        let size = (row * height) as u64;
        let buf = match self.readback.lock().unwrap().take() {
            Some(b) if b.size() == size => b,
            _ => self.device.create_buffer(&wgpu::BufferDescriptor { label: None, size, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false }),
        };
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: &canvas, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer: &buf, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(height) } },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        let done = self.queue.submit([enc.finish()]);
        buf.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("map canvas"));
        self.wait_for(done).expect("poll");
        let mapped = buf.slice(..).get_mapped_range().expect("mapped canvas");
        let mut data = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height as usize {
            data.extend_from_slice(&mapped[y * row as usize..y * row as usize + width as usize * 4]);
        }
        drop(mapped);
        buf.unmap();
        *self.readback.lock().unwrap() = Some(buf);
        textures.scratch.push(canvas);
        self.recycle(textures.scratch);
        RgbaImage { width, height, data }
    }
}

/// The transition pass (mix.wgsl) onto a target of `format`, blending "over" what's there.
fn mix_pipeline(device: &wgpu::Device, layout: &wgpu::PipelineLayout, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("mix"), source: wgpu::ShaderSource::Wgsl(include_str!("mix.wgsl").into()) });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("fs_mix"),
        layout: Some(layout),
        vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some("fs_mix"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })],
        }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    })
}

/// A pass writing `entry` of the WGSL `source` to a target of `format` as it is (no
/// blending), with the three-binding layout (texture, parameters, second texture).
fn pass_pipeline(device: &wgpu::Device, layout: &wgpu::PipelineLayout, source: &str, entry: &str, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some(entry), source: wgpu::ShaderSource::Wgsl(source.into()) });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(entry),
        layout: Some(layout),
        vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some(entry),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState { format, blend: None, write_mask: wgpu::ColorWrites::ALL })],
        }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    })
}

/// Average each `k`x`k` block (edges included as partial blocks).
#[allow(clippy::needless_range_loop)]
fn box_shrink(img: &RgbaImage, k: u32) -> RgbaImage {
    let (w, h) = (img.width.div_ceil(k), img.height.div_ceil(k));
    let mut data = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let mut sum = [0u32; 4];
            let mut n = 0;
            for yy in y * k..((y + 1) * k).min(img.height) {
                for xx in x * k..((x + 1) * k).min(img.width) {
                    let i = ((yy * img.width + xx) * 4) as usize;
                    for c in 0..4 {
                        sum[c] += img.data[i + c] as u32;
                    }
                    n += 1;
                }
            }
            for c in 0..4 {
                data[((y * w + x) * 4) as usize + c] = ((sum[c] + n / 2) / n) as u8;
            }
        }
    }
    RgbaImage { width: w, height: h, data }
}

/// CPU fallback for frames the GPU can't take directly (software-decoded, unusual formats).
fn rgb_of(frame: &VideoFrame) -> RgbaImage {
    match frame.to_rgb() {
        Ok(rgb) => RgbaImage { width: rgb.width, height: rgb.height, data: rgb.data.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect() },
        Err(_) => RgbaImage { width: frame.width(), height: frame.height(), data: vec![0; (frame.width() * frame.height() * 4) as usize] },
    }
}
