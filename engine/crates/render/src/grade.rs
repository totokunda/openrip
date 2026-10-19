//! CapCut's colour features around its Adjust pass, each a pass of its own that runs only
//! when a clip uses it: HSL and curves before the Adjust sliders (grade.wgsl), clarity and
//! the vignette after Sharpen (finish.wgsl). (Fade is part of the Adjust pass, adjust.wgsl.)
//!
//! The behaviour comes from the colour bundle CapCut downloads (its shaders and the scripts
//! that feed them), read locally and reimplemented here; see docs/parity/colour.md.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::Compositor;

/// One curve anchor with its bezier handles, all in 0..1 (x = input level, y = output level).
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct CurvePoint {
    pub anchor: [f32; 2],
    pub left: [f32; 2],
    pub right: [f32; 2],
}

/// CapCut's tone curves: luma, red, green and blue, each a list of anchors (empty is the
/// diagonal). CapCut draws each curve into a 1024-entry table and looks levels up in it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Curves {
    pub luma: Vec<CurvePoint>,
    pub red: Vec<CurvePoint>,
    pub green: Vec<CurvePoint>,
    pub blue: Vec<CurvePoint>,
}

/// Entries in a curve's table (CapCut's 1024×1 render target, read without filtering).
pub const CURVE_TABLE: usize = 1024;

impl Curves {
    /// Whether every channel is the diagonal (no anchors, or anchors and handles on it).
    pub fn is_identity(&self) -> bool {
        [&self.luma, &self.red, &self.green, &self.blue].iter().all(|c| c.iter().all(|p| [p.anchor, p.left, p.right].iter().all(|[x, y]| (x - y).abs() < 1e-6)))
    }

    /// The four tables (luma, red, green, blue), one after another.
    pub fn tables(&self) -> Vec<f32> {
        [&self.luma, &self.red, &self.green, &self.blue].iter().flat_map(|c| curve_table(c)).collect()
    }

    /// Identifies the curves for the GPU's table cache.
    pub(crate) fn key(&self) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        "curves".hash(&mut h);
        for c in [&self.luma, &self.red, &self.green, &self.blue] {
            c.len().hash(&mut h);
            for p in c {
                for v in [p.anchor, p.left, p.right].iter().flatten() {
                    v.to_bits().hash(&mut h);
                }
            }
        }
        h.finish()
    }
}

/// A curve's table as CapCut's curve shader draws it: entry k is the curve at the texel
/// centre (k + ½) / 1024. Between anchors, a cubic bezier through each anchor's right handle
/// and the next one's left handle, solved for x by bisection; before the first anchor and
/// after the last, the straight line through the end anchor and its handle. An empty curve
/// is the diagonal (CapCut's default control points lie on it).
pub fn curve_table(points: &[CurvePoint]) -> Vec<f32> {
    // CapCut's control-point list: a0, r0, l1, a1, r1, l2, a2, …
    let mut cp: Vec<[f32; 2]> = Vec::with_capacity(points.len() * 3);
    for (i, p) in points.iter().enumerate() {
        if i > 0 {
            cp.push(p.left);
        }
        cp.push(p.anchor);
        if i + 1 < points.len() {
            cp.push(p.right);
        }
    }
    let n = points.len();
    (0..CURVE_TABLE)
        .map(|k| {
            let x = (k as f32 + 0.5) / CURVE_TABLE as f32;
            if n < 2 {
                return if n == 1 { points[0].anchor[1] } else { x };
            }
            curve_at(&cp, n, x)
        })
        .collect()
}

/// The curve through `cp` (CapCut's list for `n` anchors) at `x`.
fn curve_at(cp: &[[f32; 2]], n: usize, x: f32) -> f32 {
    // A line through two points, flat beyond its end when it has no width.
    let linear = |[x1, y1]: [f32; 2], [x2, y2]: [f32; 2], x: f32| {
        if x2 <= x1 {
            return if x > x2 { y2 } else { y1 };
        }
        (x - x1) * (y2 - y1) / (x2 - x1) + y1
    };
    if x < cp[0][0] {
        return linear(cp[0], cp[1], x);
    }
    let last = (n - 1) * 3;
    if x > cp[last][0] {
        return linear(cp[last - 1], cp[last], x);
    }
    // The first anchor past x ends the segment.
    let i = (1..n).find(|&j| x < cp[j * 3][0]).unwrap_or(n - 1);
    let (p0, p1, p2, p3) = (cp[(i - 1) * 3], cp[(i - 1) * 3 + 1], cp[(i - 1) * 3 + 2], cp[i * 3]);
    let bezier = |a: f32, b: f32, c: f32, d: f32, t: f32| {
        let u = 1.0 - t;
        u * u * u * a + 3.0 * u * u * t * b + 3.0 * u * t * t * c + t * t * t * d
    };
    // t for x by bisection, as CapCut does it (20 halvings, done within 0.00005).
    const EPS: f32 = 0.00005;
    let t = if (p0[0] - x).abs() < EPS {
        0.0
    } else if (p3[0] - x).abs() < EPS {
        1.0
    } else {
        let (mut lo, mut hi, mut t) = (0.0f32, 1.0f32, 0.5f32);
        let mut at = bezier(p0[0], p1[0], p2[0], p3[0], t);
        for _ in 0..20 {
            if (at - x).abs() < EPS {
                break;
            }
            if at < x {
                lo = t;
            } else {
                hi = t;
            }
            t = (lo + hi) / 2.0;
            at = bezier(p0[0], p1[0], p2[0], p3[0], t);
        }
        t
    };
    bezier(p0[1], p1[1], p2[1], p3[1], t)
}

/// CapCut's HSL panel: hue, saturation and lightness moved within colour ranges, each
/// -100..100 (CapCut's sliders). Within a range's inner hues a pixel takes the whole shift,
/// fading to none at its outer hues; shifts of overlapping ranges add up.
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct Hsl {
    /// CapCut's eight named ranges, in its order: red, orange, yellow, green, cyan, blue,
    /// purple, magenta.
    pub ranges: [[f32; 3]; 8],
    /// Colours picked with the eyedropper (RGB 0..1, up to ten), each with its shift.
    pub picked: [([f32; 3], [f32; 3]); 10],
}

/// The named ranges' hues (outer left, inner left, inner right, outer right, in degrees) and
/// how CapCut's shader scales their hue, saturation and lightness sliders.
const NAMED: [([f32; 4], [f32; 3]); 8] = [
    ([315.0, 330.0, 5.0, 20.0], [0.25, 1.0, 1.0 / 2.7]),
    ([350.0, 20.0, 40.0, 60.0], [0.15, 1.0, 1.0 / 2.7]),
    ([25.0, 50.0, 70.0, 90.0], [0.3, 1.0, 1.0 / 2.7]),
    ([50.0, 70.0, 160.0, 190.0], [0.3, 1.1, 1.0 / 2.7]),
    ([135.0, 165.0, 195.0, 225.0], [0.4, 1.0, 1.0 / 2.2]),
    ([145.0, 180.0, 235.0, 275.0], [0.4, 1.2, 1.0 / 2.0]),
    ([235.0, 255.0, 315.0, 335.0], [0.4, 1.0, 1.0 / 2.7]),
    ([255.0, 285.0, 335.0, 5.0], [0.4, 1.0, 1.0 / 2.7]),
];

/// How far a picked colour's range reaches to the left and right of its hue (CapCut's table
/// for a colour difference of 20, by hue), linear in between.
const PICKED_LEFT: [[f32; 2]; 20] = [
    [0.0, 24.0], [18.0, 38.0], [24.0, 38.0], [34.0, 18.0], [42.0, 14.0], [54.0, 14.0], [92.0, 34.0], [150.0, 80.0], [160.0, 80.0], [170.0, 32.0],
    [188.0, 14.0], [222.0, 14.0], [284.0, 66.0], [288.0, 36.0], [298.0, 26.0], [316.0, 38.0], [326.0, 38.0], [336.0, 26.0], [350.0, 20.0], [360.0, 24.0],
];
const PICKED_RIGHT: [[f32; 2]; 20] = [
    [0.0, 30.0], [26.0, 14.0], [42.0, 14.0], [60.0, 36.0], [70.0, 80.0], [82.0, 80.0], [142.0, 30.0], [174.0, 14.0], [208.0, 14.0], [214.0, 20.0],
    [218.0, 66.0], [246.0, 42.0], [272.0, 26.0], [280.0, 38.0], [290.0, 38.0], [320.0, 22.0], [334.0, 22.0], [342.0, 38.0], [348.0, 38.0], [360.0, 30.0],
];

impl Hsl {
    pub fn is_identity(&self) -> bool {
        self.ranges.iter().chain(self.picked.iter().map(|(_, s)| s)).all(|s| s.iter().all(|v| v.abs() < 1e-5))
    }

    /// Every range's hues and shift as the shader takes them (named ranges first): 18 hue
    /// ranges, then 18 shifts, each four floats.
    fn params(&self) -> Vec<f32> {
        let mut ranges = Vec::with_capacity(18 * 4);
        let mut shifts = Vec::with_capacity(18 * 4);
        for ((hues, scale), s) in NAMED.iter().zip(&self.ranges) {
            ranges.extend(hues);
            shifts.extend([s[0] * scale[0], s[1] * scale[1], s[2] * scale[2], 0.0]);
        }
        // A picked colour's hue and lightness sliders are scaled by 0.3 and 0.37 (CapCut's
        // script).
        for (rgb, s) in &self.picked {
            ranges.extend(picked_range(*rgb));
            shifts.extend([s[0] * 0.3, s[1], s[2] * 0.37, 0.0]);
        }
        ranges.extend(shifts);
        ranges
    }
}

/// A picked colour's range of hues: as far left and right of its hue as CapCut's tables say,
/// its inner hues the middle 30% of that. None (all zero) for a grey.
fn picked_range([r, g, b]: [f32; 3]) -> [f32; 4] {
    let (hi, lo) = (r.max(g).max(b), r.min(g).min(b));
    let d = hi - lo;
    let l = (hi + lo) / 2.0;
    if d <= 1e-6 {
        return [0.0; 4];
    }
    let s = if l <= 0.5 { d / (hi + lo) } else { d / (2.0 - (hi + lo)) };
    let h = if hi == r {
        60.0 * (g - b) / d + if g >= b { 0.0 } else { 360.0 }
    } else if hi == g {
        60.0 * (b - r) / d + 120.0
    } else {
        60.0 * (r - g) / d + 240.0
    };
    if s < 1e-5 {
        return [0.0; 4];
    }
    let reach = |pts: &[[f32; 2]; 20]| {
        let x = h.rem_euclid(360.0);
        pts.windows(2).find(|p| x >= p[0][0] && x < p[1][0]).map_or(20.0, |p| p[0][1] + (x - p[0][0]) * (p[1][1] - p[0][1]) / (p[1][0] - p[0][0]))
    };
    let (left, right) = (reach(&PICKED_LEFT), reach(&PICKED_RIGHT));
    let flat = 1.0 - 0.7;
    [h - left, h - left * flat, h + right * flat, h + right].map(|v| v.rem_euclid(360.0))
}

/// The colour passes' pipelines (grade.wgsl, finish.wgsl) and the curve tables on the GPU.
pub(crate) struct GradeFx {
    colour: wgpu::RenderPipeline,
    clarity_value: wgpu::RenderPipeline,
    clarity_down: wgpu::RenderPipeline,
    clarity_detail: wgpu::RenderPipeline,
    clarity_add: wgpu::RenderPipeline,
    clarity_final: wgpu::RenderPipeline,
    vignette: wgpu::RenderPipeline,
    particles: wgpu::RenderPipeline,
    /// Curve tables by key, with the frame they were last used in.
    tables: Mutex<HashMap<u64, (wgpu::Texture, u64)>>,
}

/// Curve tables not used for this many frames leave the GPU.
const TABLE_FRAMES: u64 = 120;

/// Clarity's pyramid levels: one float each.
const LEVEL: wgpu::TextureFormat = wgpu::TextureFormat::R32Float;

impl GradeFx {
    pub(crate) fn new(device: &wgpu::Device, layout: &wgpu::PipelineLayout) -> Self {
        let grade = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("grade"), source: wgpu::ShaderSource::Wgsl(include_str!("grade.wgsl").into()) });
        let finish = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("finish"), source: wgpu::ShaderSource::Wgsl(include_str!("finish.wgsl").into()) });
        let pipeline = |module: &wgpu::ShaderModule, entry: &str, format: wgpu::TextureFormat| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(layout),
                vertex: wgpu::VertexState { module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                fragment: Some(wgpu::FragmentState {
                    module,
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
        };
        GradeFx {
            colour: pipeline(&grade, "fs_colour", crate::CANVAS),
            clarity_value: pipeline(&finish, "fs_clarity_value", LEVEL),
            clarity_down: pipeline(&finish, "fs_clarity_down", LEVEL),
            clarity_detail: pipeline(&finish, "fs_clarity_detail", LEVEL),
            clarity_add: pipeline(&finish, "fs_clarity_add", LEVEL),
            clarity_final: pipeline(&finish, "fs_clarity_final", crate::CANVAS),
            vignette: pipeline(&finish, "fs_vignette", crate::CANVAS),
            particles: pipeline(&finish, "fs_particles", crate::CANVAS),
            tables: Default::default(),
        }
    }
}

/// CapCut's vignette parameter for a slider value: the value eased through its cubic bezier
/// (one curve for darkening, another for lightening), on -1..1.
pub(crate) fn vignette_param(v: f32) -> f32 {
    let [x1, y1, x2, y2] = if v > 0.0 { [0.2, 0.45, 0.63, 0.81] } else { [0.65, 0.2, 0.81, 0.63] };
    let at = |t: f32, a: f32, b: f32| 3.0 * a * (1.0 - t) * (1.0 - t) * t + 3.0 * b * (1.0 - t) * t * t + t * t * t;
    let x = v.clamp(-1.0, 1.0) * 0.5 + 0.5;
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    loop {
        let t = (lo + hi) / 2.0;
        if at(t, x1, x2) > x {
            hi = t;
        } else {
            lo = t;
        }
        if hi - lo < 0.0001 {
            break;
        }
    }
    at((lo + hi) / 2.0, y1, y2) * 2.0 - 1.0
}

impl Compositor {
    /// HSL and curves on `src` into `dst` (same size), as CapCut runs them before its Adjust
    /// sliders.
    pub(crate) fn colour_pass(&self, enc: &mut wgpu::CommandEncoder, src: &wgpu::Texture, dst: &wgpu::Texture, curves: Option<&Curves>, hsl: &Hsl) {
        let table = curves.map(|c| self.curve_tables(c));
        // Each curve's strength (CapCut's material default: 1), the enables, then HSL's ranges.
        let mut params = vec![1.0f32; 4];
        params.extend([!hsl.is_identity() as u8 as f32, table.is_some() as u8 as f32, 0.0, 0.0]);
        params.extend(hsl.params());
        self.canvas_pass(enc, &self.grade.colour, src, table.as_ref().unwrap_or(&self.no_lut), dst, &params);
    }

    /// CapCut's Clarity on `src` into `dst` (same size) at `amount` (0..1): its value pyramid,
    /// eight levels deep (fewer for pictures under 128 pixels), each half the size of the one
    /// above it. The pyramid's levels go into `scratch`.
    pub(crate) fn clarity_pass(&self, enc: &mut wgpu::CommandEncoder, src: &wgpu::Texture, dst: &wgpu::Texture, amount: f32, scratch: &mut Vec<wgpu::Texture>) {
        let (w, h) = (src.width(), src.height());
        let levels = (((w.min(h).max(1) as f32).log2().ceil() as u32) + 1).clamp(1, 8);
        let size = |i: u32| ((w >> i).max(1), (h >> i).max(1));
        let params = |(w, h): (u32, u32), k: f32| [w as f32, h as f32, 0.0, 0.0, k, 0.0, 0.0, 0.0];
        let mut level = |pipeline: &wgpu::RenderPipeline, at: (u32, u32), a: &wgpu::Texture, b: &wgpu::Texture| {
            let out = self.texture(at.0, at.1, LEVEL, wgpu::TextureUsages::empty());
            self.canvas_pass(enc, pipeline, a, b, &out, &params(at, 0.0));
            scratch.push(out.clone());
            out
        };
        // The value at full size, then each level from the one above.
        let mut pyramid = vec![level(&self.grade.clarity_value, size(0), src, src)];
        for i in 1..levels {
            let above = pyramid[i as usize - 1].clone();
            pyramid.push(level(&self.grade.clarity_down, size(i), &above, &above));
        }
        // From the smallest level up: each band strengthened and the level below added back.
        let mut rebuilt = pyramid[levels as usize - 1].clone();
        for i in (0..levels - 1).rev() {
            let band = level(&self.grade.clarity_detail, size(i), &pyramid[i as usize], &pyramid[i as usize + 1]);
            rebuilt = level(&self.grade.clarity_add, size(i), &band, &rebuilt);
        }
        self.canvas_pass(enc, &self.grade.clarity_final, src, &rebuilt, dst, &params((w, h), amount.clamp(0.0, 1.0)));
    }

    /// CapCut's Vignette on `src` into `dst` (same size) at `intensity` (-1..1).
    pub(crate) fn vignette_pass(&self, enc: &mut wgpu::CommandEncoder, src: &wgpu::Texture, dst: &wgpu::Texture, intensity: f32) {
        let params = [src.width() as f32, src.height() as f32, 0.0, 0.0, intensity.clamp(-1.0, 1.0), vignette_param(intensity), 0.0, 0.0];
        self.canvas_pass(enc, &self.grade.vignette, src, src, dst, &params);
    }

    /// The Particles slider: film grain on `src` into `dst` (same size), `amount` 0..1, the
    /// pattern from `seed` (a different one each frame). A grain is about a thousandth of the
    /// picture's height across, at least a pixel, so a preview and a full-size export look alike.
    pub(crate) fn particles_pass(&self, enc: &mut wgpu::CommandEncoder, src: &wgpu::Texture, dst: &wgpu::Texture, amount: f32, seed: f32) {
        let cell = (src.height() as f32 / 900.0).max(1.0).round();
        let params = [src.width() as f32, src.height() as f32, 0.0, 0.0, amount.clamp(0.0, 1.0), seed, cell, 0.0];
        self.canvas_pass(enc, &self.grade.particles, src, src, dst, &params);
    }

    /// The curves' tables on the GPU (1024 × 4, R32Float), made the first time they're drawn.
    fn curve_tables(&self, curves: &Curves) -> wgpu::Texture {
        let frame = self.frame.load(std::sync::atomic::Ordering::Relaxed);
        {
            let mut tables = self.grade.tables.lock().unwrap();
            tables.retain(|_, (_, last)| frame.saturating_sub(*last) < TABLE_FRAMES);
            let (tex, last) = tables.entry(curves.key()).or_insert_with(|| {
                let tex = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("curve tables"),
                    size: wgpu::Extent3d { width: CURVE_TABLE as u32, height: 4, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::R32Float,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });
                self.queue.write_texture(
                    wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                    bytemuck::cast_slice(&curves.tables()),
                    wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(CURVE_TABLE as u32 * 4), rows_per_image: Some(4) },
                    wgpu::Extent3d { width: CURVE_TABLE as u32, height: 4, depth_or_array_layers: 1 },
                );
                (tex, frame)
            });
            *last = frame;
            tex.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(x: f32, y: f32, left: [f32; 2], right: [f32; 2]) -> CurvePoint {
        CurvePoint { anchor: [x, y], left, right }
    }

    #[test]
    fn empty_and_diagonal_curves_are_the_identity() {
        let t = curve_table(&[]);
        assert_eq!(t.len(), CURVE_TABLE);
        assert!((t[0] - 0.5 / 1024.0).abs() < 1e-7 && (t[1023] - 1023.5 / 1024.0).abs() < 1e-7);
        let line = [point(0.0, 0.0, [0.0, 0.0], [1.0 / 3.0, 1.0 / 3.0]), point(1.0, 1.0, [2.0 / 3.0, 2.0 / 3.0], [1.0, 1.0])];
        let curves = Curves { luma: line.to_vec(), ..Default::default() };
        assert!(curves.is_identity());
        for (k, v) in curve_table(&line).iter().enumerate() {
            let x = (k as f32 + 0.5) / 1024.0;
            assert!((v - x).abs() < 1e-4, "{k}: {v}");
        }
    }

    /// The local drafts' curve: luma from (0, 0.0176) to (1, 0.9203), handles a third of the
    /// way along. The ends follow the anchors and the middle stays on the line between them.
    #[test]
    fn a_two_anchor_curve_follows_its_bezier() {
        let c = [point(0.0, 0.0176, [0.0, 0.0176], [1.0 / 3.0, 0.3185]), point(1.0, 0.9203, [2.0 / 3.0, 0.6194], [1.0, 0.9203])];
        let t = curve_table(&c);
        assert!((t[0] - 0.0176).abs() < 0.002 && (t[1023] - 0.9203).abs() < 0.002, "{} {}", t[0], t[1023]);
        let mid = t[512];
        assert!((mid - (0.0176 + 0.9203) / 2.0).abs() < 0.01, "{mid}");
        assert!(!Curves { luma: c.to_vec(), ..Default::default() }.is_identity());
    }

    /// A picked colour's range follows CapCut's reach tables around its hue: #937d49 (a draft's
    /// pick) is at 42.2°, reaching 14° left and 14.2° right, its inner hues the middle 30%.
    #[test]
    fn a_picked_colours_range_follows_capcuts_tables() {
        let r = picked_range([147.0 / 255.0, 125.0 / 255.0, 73.0 / 255.0]);
        let want = [28.16, 37.96, 46.42, 56.39];
        for (got, want) in r.iter().zip(want) {
            assert!((got - want).abs() < 0.05, "{r:?}");
        }
        // Greys have no hue, so no range; a pick just below red wraps past 360.
        assert_eq!(picked_range([0.5, 0.5, 0.5]), [0.0; 4]);
        let red = picked_range([1.0, 0.0, 0.02]);
        assert!(red[0] > 300.0 && red[3] < 40.0, "{red:?}");
        // Ranges with nothing to shift draw nothing.
        assert!(Hsl::default().is_identity());
        assert!(!Hsl { picked: [([1.0, 0.0, 0.0], [0.0, 10.0, 0.0]); 10], ..Default::default() }.is_identity());
    }

    /// The vignette's eased parameter: full strength at ±1, and CapCut's curves in between.
    #[test]
    fn vignette_parameter_follows_capcuts_easing() {
        assert!((vignette_param(1.0) - 1.0).abs() < 1e-3);
        assert!((vignette_param(-1.0) + 1.0).abs() < 1e-3);
        let half = vignette_param(0.5);
        assert!(half > 0.4 && half < 0.8, "{half}");
        // Darkening eases in fast, lightening slowly.
        assert!(vignette_param(0.01) > 0.0 && vignette_param(-0.01) < 0.0);
    }

    /// Before the first anchor and after the last, the curve carries on along the line
    /// through the end anchor and its handle (CapCut doesn't hold it flat).
    #[test]
    fn beyond_the_end_anchors_the_curve_extends_along_the_handles() {
        let c = [point(0.25, 0.25, [0.25, 0.25], [0.5, 0.75]), point(0.75, 0.75, [0.5, 0.25], [0.75, 0.75])];
        let t = curve_table(&c);
        // At x = 0.125: the line through (0.25, 0.25) and (0.5, 0.75) gives 0.0.
        assert!(t[127].abs() < 0.005, "{}", t[127]);
        // At x = 0.875: the line through (0.5, 0.25) and (0.75, 0.75) gives 1.0.
        assert!((t[895] - 1.0).abs() < 0.005, "{}", t[895]);
    }
}
