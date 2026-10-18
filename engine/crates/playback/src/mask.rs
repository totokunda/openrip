//! Masks over a clip's own picture, as coverage per pixel (0–255) of the upright picture,
//! row 0 at the top, which the compositor then paints inside and outside
//! (docs/parity/masks.md).
//!
//! CapCut's shapes are drawn as their bundles draw them; the app's shapes and lassos as its
//! WebGL masks do (hard-edged, tested at pixel centres), softened by a feather as CapCut
//! softens its own; the app's brush as round-ended strokes.

use openrip_model::{sample_keys, BrushStroke, Easing, Keyframe, Mask, MaskKey, MaskShape, Micros};

/// The shape and place a mask has at `at` (time in the clip's source): between two of its
/// keys of the same shape, travelling from one to the other by the first's easing; else the
/// last key at or before then (the first before it), or its own without keys.
struct Pose {
    shape: MaskShape,
    center: [f64; 2],
    size: [f64; 2],
    rotation: f64,
    /// A key's own feather (the app's masks keyframe it with the place), else the mask's.
    feather: f64,
    /// Likewise its expansion (a fraction of the picture's height).
    expansion: f64,
}

fn pose(m: &Mask, at: Micros) -> Pose {
    let feather_of = |k: &MaskKey| k.feather.unwrap_or(m.feather);
    let expansion_of = |k: &MaskKey| k.expansion.unwrap_or(m.expansion);
    let own = |k: &MaskKey| Pose {
        shape: k.shape.clone(),
        center: k.center.map(f64::from),
        size: k.size.map(f64::from),
        rotation: k.rotation as f64,
        feather: feather_of(k) as f64,
        expansion: expansion_of(k) as f64,
    };
    let keys = &m.keys;
    let Some(first) = keys.first() else {
        return Pose { shape: m.shape.clone(), center: m.center.map(f64::from), size: m.size.map(f64::from), rotation: m.rotation as f64, feather: m.feather as f64, expansion: m.expansion as f64 };
    };
    if at <= first.at {
        return own(first);
    }
    let i = keys.partition_point(|k| k.at <= at);
    if i >= keys.len() {
        return own(&keys[keys.len() - 1]);
    }
    let (a, b) = (&keys[i - 1], &keys[i]);
    // How far along: the first key's easing over 0…1.
    let p = sample_keys(&[Keyframe { at: a.at, value: 0.0, ease: a.ease }, Keyframe { at: b.at, value: 1.0, ease: Easing::Linear }], at).unwrap_or(0.0);
    let mix = |x: f32, y: f32| x as f64 + (y as f64 - x as f64) * p;
    let shape = match (&a.shape, &b.shape) {
        (MaskShape::Polygon { points: pa }, MaskShape::Polygon { points: pb }) if pa.len() == pb.len() => {
            MaskShape::Polygon { points: pa.iter().zip(pb).map(|(q, r)| [mix(q[0], r[0]) as f32, mix(q[1], r[1]) as f32]).collect() }
        }
        (MaskShape::Rectangle { round_corner: ra }, MaskShape::Rectangle { round_corner: rb }) => MaskShape::Rectangle { round_corner: mix(*ra, *rb) as f32 },
        (sa, sb) if std::mem::discriminant(sa) == std::mem::discriminant(sb) && !matches!(sa, MaskShape::Polygon { .. } | MaskShape::Brush { .. } | MaskShape::Picture { .. } | MaskShape::Other { .. }) => sa.clone(),
        _ => return own(a),
    };
    Pose {
        shape,
        center: [mix(a.center[0], b.center[0]), mix(a.center[1], b.center[1])],
        size: [mix(a.size[0], b.size[0]), mix(a.size[1], b.size[1])],
        rotation: mix(a.rotation, b.rotation),
        feather: mix(feather_of(a), feather_of(b)),
        expansion: mix(expansion_of(a), expansion_of(b)),
    }
}

/// A text mask's glyphs, rendered for a picture of the coverage's height: their coverage
/// (0–255, row 0 at the top) and where the centre of the block of line boxes is in it.
pub struct Glyphs {
    pub w: u32,
    pub h: u32,
    pub alpha: Vec<u8>,
    pub center: [f64; 2],
}

/// A shape picture's distance field (CapCut's heart and star bundles), decoded from its red
/// and green channels as the bundle's shader decodes them: 0.5 on the outline.
pub struct Field {
    pub w: u32,
    pub h: u32,
    pub data: Vec<f32>,
}

impl Field {
    /// From RGBA bytes, row 0 at the top.
    pub fn from_rgba(w: u32, h: u32, rgba: &[u8]) -> Field {
        let data = rgba.chunks_exact(4).take((w * h) as usize).map(|p| (p[0] as f32 / 255.0 * 4.0 * 256.0 + p[1] as f32) / 701.0).collect();
        Field { w, h, data }
    }

    /// Bilinear between texel centres, clamped at the edges (as the GPU samples it).
    fn sample(&self, u: f64, v: f64) -> f64 {
        let (x, y) = (u * self.w as f64 - 0.5, v * self.h as f64 - 0.5);
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let at = |i: f64, j: f64| {
            let (i, j) = (i.clamp(0.0, self.w as f64 - 1.0) as u32, j.clamp(0.0, self.h as f64 - 1.0) as u32);
            self.data[(j * self.w + i) as usize] as f64
        };
        let top = at(x0, y0) * (1.0 - fx) + at(x0 + 1.0, y0) * fx;
        let bottom = at(x0, y0 + 1.0) * (1.0 - fx) + at(x0 + 1.0, y0 + 1.0) * fx;
        top * (1.0 - fy) + bottom * fy
    }
}

/// The words and style of a text mask at `at` (its pose's), to render its glyphs by.
pub fn text_at(m: &Mask, at: Micros) -> Option<openrip_model::MaskText> {
    match pose(m, at).shape {
        MaskShape::Text(t) => Some(t),
        _ => None,
    }
}

/// A key for everything that changes the coverage at `at`.
pub fn coverage_key(m: &Mask, at: Micros) -> String {
    let p = pose(m, at);
    format!("{:?}{:?}{:?}{}{}{}{}", p.shape, p.center, p.size, p.rotation, p.feather, p.expansion, m.invert)
}

/// Coverage of `mask` at `at` over an upright picture of `w`×`h` pixels, or `None` for a
/// shape not drawn yet (a picture shape without its `field`, a text without its `glyphs`).
pub fn coverage(mask: &Mask, at: Micros, w: u32, h: u32, field: Option<&Field>, glyphs: Option<&Glyphs>) -> Option<Vec<u8>> {
    let p = pose(mask, at);
    let feather = p.feather.max(0.0);
    // The expansion in pixels: brush strokes widen by it, a lasso's or pen's outline moves out.
    let grow = p.expansion * h as f64;
    let mut out = match &p.shape {
        MaskShape::Rectangle { round_corner } => rectangle(&p, *round_corner as f64, feather, w, h),
        MaskShape::Circle => circle(&p, feather, w, h),
        MaskShape::Linear => line(&p, feather, w, h, false),
        MaskShape::Mirror => line(&p, feather, w, h, true),
        MaskShape::Picture { .. } => picture(&p, field?, feather, w, h),
        MaskShape::Brush { strokes } => brush(strokes, feather, grow, w, h),
        MaskShape::Text(_) => text(&p, glyphs?, feather, w, h),
        MaskShape::Other { .. } => return None,
        MaskShape::Polygon { points } => {
            let pts: Vec<[f64; 2]> = points.iter().map(|q| [q[0] as f64 * w as f64, q[1] as f64 * h as f64]).collect();
            if feather > 0.0 || grow != 0.0 {
                soft_polygon(&pts, feather, grow, w, h)
            } else {
                hard_edged(w, h, |x, y| in_polygon(&pts, x, y))
            }
        }
        shape => {
            // The app's shapes, in picture pixels about the box's centre, turned clockwise.
            let (cx, cy) = ((1.0 + p.center[0]) / 2.0 * w as f64, (1.0 - p.center[1]) / 2.0 * h as f64);
            let (hw, hh) = (p.size[0] * w as f64 / 2.0, p.size[1] * h as f64 / 2.0);
            let (sn, cs) = (-p.rotation.to_radians()).sin_cos();
            let local = |x: f64, y: f64| {
                let (dx, dy) = (x - cx, y - cy);
                (cs * dx - sn * dy, sn * dx + cs * dy)
            };
            let ellipse = |x: f64, y: f64| {
                let (lx, ly) = local(x, y);
                (lx / hw.max(1e-4)).powi(2) + (ly / hh.max(1e-4)).powi(2)
            };
            match shape {
                // Softened as CapCut's circle: around 1 on (x/a)² + (y/b)², by 15 × the feather.
                MaskShape::Ellipse if feather > 0.0 => soft(w, h, |x, y| 1.0 - smoothstep(1.0 - 15.0 * feather, 1.0 + 15.0 * feather, ellipse(x, y))),
                MaskShape::Ellipse => hard_edged(w, h, |x, y| ellipse(x, y) <= 1.0),
                MaskShape::Triangle => {
                    let lift = -2.0 * hh / 6.0;
                    let tri = [[0.0, -hh + lift], [-hw, hh + lift], [hw, hh + lift]];
                    if feather > 0.0 {
                        soft_gauge(&tri, local, feather, w, h)
                    } else {
                        hard_edged(w, h, |x, y| {
                            let (lx, ly) = local(x, y);
                            in_triangle([lx, ly], tri)
                        })
                    }
                }
                _ => {
                    let star: Vec<[f64; 2]> = (0..10)
                        .map(|i| {
                            let a = i as f64 * std::f64::consts::PI / 5.0;
                            let k = if i % 2 == 0 { 1.0 } else { 0.5 };
                            [k * hw * a.sin(), -k * hh * a.cos()]
                        })
                        .collect();
                    if feather > 0.0 {
                        soft_gauge(&star, local, feather, w, h)
                    } else {
                        hard_edged(w, h, |x, y| {
                            let (lx, ly) = local(x, y);
                            in_polygon(&star, lx, ly)
                        })
                    }
                }
            }
        }
    };
    if mask.invert {
        out.iter_mut().for_each(|v| *v = 255 - *v);
    }
    Some(out)
}

/// Coverage from a function of a pixel's centre giving 0…1.
fn soft(w: u32, h: u32, kept: impl Fn(f64, f64) -> f64) -> Vec<u8> {
    let mut out = vec![0u8; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            out[(y * w + x) as usize] = (kept(x as f64 + 0.5, y as f64 + 0.5).clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }
    out
}

/// A shape around its centre (the app's triangle and star, in its own turned units), softened
/// as CapCut softens its rectangle: by a pixel's gauge (how far out it is relative to the
/// outline along the ray from the centre, 1 on it), with a smoothstep 6 × the feather either
/// side of 1.
fn soft_gauge(outline: &[[f64; 2]], local: impl Fn(f64, f64) -> (f64, f64), feather: f64, w: u32, h: u32) -> Vec<u8> {
    let band = 6.0 * feather;
    soft(w, h, |x, y| {
        let (lx, ly) = local(x, y);
        1.0 - smoothstep(1.0 - band, 1.0 + band, gauge(outline, lx, ly))
    })
}

/// How far out a point is relative to a polygon's outline along the ray from its centre (the
/// origin): its distance over the nearest crossing of the outline along that ray.
fn gauge(outline: &[[f64; 2]], x: f64, y: f64) -> f64 {
    let r = x.hypot(y);
    if r < 1e-12 {
        return 0.0;
    }
    let (dx, dy) = (x / r, y / r);
    let mut nearest = f64::INFINITY;
    for i in 0..outline.len() {
        let (a, b) = (outline[i], outline[(i + 1) % outline.len()]);
        let (ex, ey) = (b[0] - a[0], b[1] - a[1]);
        // origin + t·d = a + s·e
        let det = ex * dy - ey * dx;
        if det.abs() < 1e-12 {
            continue;
        }
        let t = (ex * a[1] - ey * a[0]) / det;
        let s = (dx * a[1] - dy * a[0]) / det;
        if t > 0.0 && (-1e-9..=1.0 + 1e-9).contains(&s) {
            nearest = nearest.min(t);
        }
    }
    r / nearest
}

/// A lasso softened by the feather: a smoothstep across the outline, 6 × the feather of half
/// its shorter side either way (CapCut's rectangle's band, in the lasso's own size).
fn soft_polygon(pts: &[[f64; 2]], feather: f64, grow: f64, w: u32, h: u32) -> Vec<u8> {
    if pts.len() < 3 {
        return vec![0u8; (w * h) as usize];
    }
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for p in pts {
        lo = [lo[0].min(p[0]), lo[1].min(p[1])];
        hi = [hi[0].max(p[0]), hi[1].max(p[1])];
    }
    // Unfeathered but expanded: an edge half a pixel soft either side of the moved outline.
    let band = if feather > 0.0 { (6.0 * feather * (hi[0] - lo[0]).min(hi[1] - lo[1]) / 2.0).max(1e-6) } else { 0.5 };
    // A wide soft edge is smooth: sampled every few pixels and filled in between, as a pen
    // or lasso with a feather is otherwise slow to draw (every edge measured at every pixel).
    let step = ((band / 8.0).floor() as u32).clamp(1, 4);
    soft_sampled(w, h, step, |x, y| {
        let d = (0..pts.len()).map(|i| segment_distance(pts[i], pts[(i + 1) % pts.len()], x, y)).fold(f64::INFINITY, f64::min);
        let signed = if in_polygon(pts, x, y) { -d } else { d };
        1.0 - smoothstep(-band, band, signed - grow)
    })
}

/// `soft` measured every `step` pixels each way and interpolated bilinearly between (each
/// pixel's own value when `step` is 1).
fn soft_sampled(w: u32, h: u32, step: u32, kept: impl Fn(f64, f64) -> f64) -> Vec<u8> {
    if step <= 1 {
        return soft(w, h, kept);
    }
    let (gw, gh) = (w.div_ceil(step) + 1, h.div_ceil(step) + 1);
    let mut grid = vec![0.0f64; (gw * gh) as usize];
    for j in 0..gh {
        for i in 0..gw {
            grid[(j * gw + i) as usize] = kept((i * step) as f64 + 0.5, (j * step) as f64 + 0.5).clamp(0.0, 1.0);
        }
    }
    let mut out = vec![0u8; (w * h) as usize];
    for y in 0..h {
        let (j, fy) = (y / step, (y % step) as f64 / step as f64);
        for x in 0..w {
            let (i, fx) = (x / step, (x % step) as f64 / step as f64);
            let g = |i: u32, j: u32| grid[(j * gw + i) as usize];
            let top = g(i, j) * (1.0 - fx) + g(i + 1, j) * fx;
            let bottom = g(i, j + 1) * (1.0 - fx) + g(i + 1, j + 1) * fx;
            out[(y * w + x) as usize] = ((top * (1.0 - fy) + bottom * fy) * 255.0).round() as u8;
        }
    }
    out
}

/// A text mask: its glyphs' coverage, centred on the pose's centre and turned clockwise by
/// its rotation, sampled bilinearly; a feather blurs it over up to a twentieth of the
/// picture's height.
fn text(p: &Pose, g: &Glyphs, feather: f64, w: u32, h: u32) -> Vec<u8> {
    let (cx, cy) = ((1.0 + p.center[0]) / 2.0 * w as f64, (1.0 - p.center[1]) / 2.0 * h as f64);
    let (sn, cs) = (-p.rotation.to_radians()).sin_cos();
    let at = |i: i64, j: i64| -> f64 {
        if i < 0 || j < 0 || i >= g.w as i64 || j >= g.h as i64 {
            return 0.0;
        }
        g.alpha[(j as u32 * g.w + i as u32) as usize] as f64 / 255.0
    };
    let mut out: Vec<f64> = vec![0.0; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            let (dx, dy) = (x as f64 + 0.5 - cx, y as f64 + 0.5 - cy);
            let (u, v) = (cs * dx - sn * dy + g.center[0] - 0.5, sn * dx + cs * dy + g.center[1] - 0.5);
            let (i, j) = (u.floor(), v.floor());
            let (fx, fy) = (u - i, v - j);
            let (i, j) = (i as i64, j as i64);
            let top = at(i, j) * (1.0 - fx) + at(i + 1, j) * fx;
            let bottom = at(i, j + 1) * (1.0 - fx) + at(i + 1, j + 1) * fx;
            out[(y * w + x) as usize] = top * (1.0 - fy) + bottom * fy;
        }
    }
    let r = (feather * 0.05 * h as f64).round() as i64;
    if r > 0 {
        // Two passes of a box blur each way: close to a gaussian.
        for _ in 0..2 {
            out = box_blur(&out, w, h, r, true);
            out = box_blur(&out, w, h, r, false);
        }
    }
    out.into_iter().map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8).collect()
}

/// A box blur of radius `r` along rows (`across`) or columns, edges clamped.
fn box_blur(src: &[f64], w: u32, h: u32, r: i64, across: bool) -> Vec<f64> {
    let (w, h) = (w as i64, h as i64);
    let (len, lines) = if across { (w, h) } else { (h, w) };
    let idx = |line: i64, k: i64| -> usize { if across { (line * w + k) as usize } else { (k * w + line) as usize } };
    let mut out = vec![0.0; src.len()];
    let n = (2 * r + 1) as f64;
    for line in 0..lines {
        let mut sum: f64 = (-r..=r).map(|k| src[idx(line, k.clamp(0, len - 1))]).sum();
        for k in 0..len {
            out[idx(line, k)] = sum / n;
            sum += src[idx(line, (k + r + 1).min(len - 1))] - src[idx(line, (k - r).max(0))];
        }
    }
    out
}

fn segment_distance(a: [f64; 2], b: [f64; 2], x: f64, y: f64) -> f64 {
    let (ex, ey) = (b[0] - a[0], b[1] - a[1]);
    let len2 = ex * ex + ey * ey;
    let t = if len2 > 0.0 { (((x - a[0]) * ex + (y - a[1]) * ey) / len2).clamp(0.0, 1.0) } else { 0.0 };
    (x - a[0] - t * ex).hypot(y - a[1] - t * ey)
}

/// The app's brush: each stroke a round-ended line `width` across, painting where it passes
/// (an erasing stroke clearing instead), its edge at pixel centres or, feathered, softened over
/// 6 × the feather of the stroke's half-width either side. Only the pixels near each stroke
/// are visited.
fn brush(strokes: &[BrushStroke], feather: f64, grow: f64, w: u32, h: u32) -> Vec<u8> {
    let mut cov = vec![0f32; (w * h) as usize];
    for s in strokes {
        // The expansion widens every stroke (narrows it below 0).
        let r = (s.width.max(0.0) as f64 * h as f64 / 2.0 + grow).max(0.0);
        let band = 6.0 * feather * r;
        let pts: Vec<[f64; 2]> = s.points.iter().map(|p| [p[0] as f64 * w as f64, p[1] as f64 * h as f64]).collect();
        let Some(&first) = pts.first() else { continue };
        let reach = r + band + 1.0;
        let (mut lo, mut hi) = (first, first);
        for p in &pts {
            lo = [lo[0].min(p[0]), lo[1].min(p[1])];
            hi = [hi[0].max(p[0]), hi[1].max(p[1])];
        }
        let (x0, x1) = ((lo[0] - reach).floor().max(0.0) as u32, ((hi[0] + reach).ceil().max(0.0) as u32).min(w));
        let (y0, y1) = ((lo[1] - reach).floor().max(0.0) as u32, ((hi[1] + reach).ceil().max(0.0) as u32).min(h));
        for y in y0..y1 {
            for x in x0..x1 {
                let (cx, cy) = (x as f64 + 0.5, y as f64 + 0.5);
                let d = if pts.len() == 1 { (cx - first[0]).hypot(cy - first[1]) } else { pts.windows(2).map(|q| segment_distance(q[0], q[1], cx, cy)).fold(f64::INFINITY, f64::min) };
                let k = if band > 0.0 {
                    1.0 - smoothstep(r - band, r + band, d)
                } else if d <= r {
                    1.0
                } else {
                    0.0
                };
                let c = &mut cov[(y * w + x) as usize];
                *c = if s.erase { *c * (1.0 - k as f32) } else { c.max(k as f32) };
            }
        }
    }
    cov.into_iter().map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8).collect()
}

/// CapCut's heart and star (`lumi_heart_mask`): the shape picture spans 1.7 times the box
/// (whose width and height are fractions of the picture's), centred on its centre and turned
/// clockwise by the rotation, in units of the picture's half-height; the edge is a smoothstep
/// from 0.49 to 0.51 of the field, widened by half the feather either way.
fn picture(p: &Pose, field: &Field, feather: f64, w: u32, h: u32) -> Vec<u8> {
    const BOUNDARY: f64 = 1.7;
    let aspect = w as f64 / h as f64;
    let (sx, sy) = ((p.size[0] * BOUNDARY * aspect).max(1e-9), (p.size[1] * BOUNDARY).max(1e-9));
    let diff = feather * 0.5;
    // The bundle turns the offset by 360° − rotation in its y-down axes.
    let (sn, cs) = (360.0 - p.rotation).to_radians().sin_cos();
    let mut out = vec![0u8; (w * h) as usize];
    offsets(p, w, h, |i, [px, py]| {
        let yd = -py;
        let (qx, qy) = (cs * px - sn * yd, sn * px + cs * yd);
        let v = field.sample(0.5 + 0.5 * qx / sx, 0.5 + 0.5 * qy / sy);
        out[i] = (smoothstep(0.49 - diff, 0.51 + diff, v).clamp(0.0, 1.0) * 255.0).round() as u8;
    });
    out
}

fn hard_edged(w: u32, h: u32, inside: impl Fn(f64, f64) -> bool) -> Vec<u8> {
    let mut out = vec![0u8; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            if inside(x as f64 + 0.5, y as f64 + 0.5) {
                out[(y * w + x) as usize] = 255;
            }
        }
    }
    out
}

/// Even-odd ray casting, as the app's shaders do it.
fn in_polygon(pts: &[[f64; 2]], x: f64, y: f64) -> bool {
    if pts.len() < 3 {
        return false;
    }
    let mut inside = false;
    let mut prev = pts[pts.len() - 1];
    for &cur in pts {
        if (cur[1] > y) != (prev[1] > y) && x < (prev[0] - cur[0]) * (y - cur[1]) / ((prev[1] - cur[1]) + 1e-6) + cur[0] {
            inside = !inside;
        }
        prev = cur;
    }
    inside
}

/// Barycentric, edges included.
fn in_triangle(p: [f64; 2], [a, b, c]: [[f64; 2]; 3]) -> bool {
    let (v0, v1, v2) = ([c[0] - a[0], c[1] - a[1]], [b[0] - a[0], b[1] - a[1]], [p[0] - a[0], p[1] - a[1]]);
    let dot = |u: [f64; 2], v: [f64; 2]| u[0] * v[0] + u[1] * v[1];
    let (d00, d01, d02, d11, d12) = (dot(v0, v0), dot(v0, v1), dot(v0, v2), dot(v1, v1), dot(v1, v2));
    let denom = d00 * d11 - d01 * d01;
    if denom == 0.0 {
        return false;
    }
    let (u, v) = ((d11 * d02 - d01 * d12) / denom, (d00 * d12 - d01 * d02) / denom);
    u >= 0.0 && v >= 0.0 && u + v <= 1.0
}

/// CapCut's rectangle bundle (`lumi_rectangle_mask`). In units of the picture's
/// half-height, a pixel's offset from the centre is turned by the rotation; its "gauge" is
/// how far out it is relative to the rounded rectangle's edge along the same ray (1 on the
/// edge). The edge is a smoothstep around 1, widened by the feather (×6) and, when turned,
/// by up to 0.5% for smoothing; at 0° it's a hard step.
fn rectangle(p: &Pose, round: f64, feather: f64, w: u32, h: u32) -> Vec<u8> {
    use std::f64::consts::{FRAC_PI_2, FRAC_PI_4};
    let aspect = w as f64 / h as f64;
    let size = p.size;
    let r = if size[0] * aspect >= size[1] { size[1] } else { size[0] * aspect } * round;
    let rt = [size[0] * aspect, size[1]];
    let cc = [rt[0] - r, rt[1] - r];
    // The bundle's angle is 360° plus the rotation.
    let theta = (360.0 + p.rotation).to_radians();
    let (sn, cs) = theta.sin_cos();
    let decay = (1.0 - ((theta.rem_euclid(FRAC_PI_2) / FRAC_PI_4) - 1.0).powi(2)).max(0.0).powf(0.125);
    let diff = feather * 6.0;
    let (e0, e1) = (1.0 - decay * 0.005 - diff, 1.0 + decay * 0.005 + diff);
    let gauge = |q: [f64; 2]| -> f64 {
        if q[1] * cc[0] >= rt[1] * q[0] {
            q[1] / size[1]
        } else if q[1] * rt[0] <= cc[1] * q[0] {
            q[0] / (aspect * size[0])
        } else {
            // The corner: the scale at which the ray meets the corner's circle.
            let a = cc[0] * cc[0] + cc[1] * cc[1] - r * r;
            let b = -2.0 * (q[0] * cc[0] + q[1] * cc[1]);
            let c = q[0] * q[0] + q[1] * q[1];
            if a.abs() < 1e-8 {
                if b.abs() < 1e-8 { 100.0 } else { -c / b }
            } else {
                (-b - (b * b - 4.0 * a * c).max(0.0).sqrt()) / (2.0 * a)
            }
        }
    };
    let mut out = vec![0u8; (w * h) as usize];
    for y in 0..h {
        // Texture v runs up the picture.
        let v = 1.0 - (y as f64 + 0.5) / h as f64;
        let py = (v - 0.5) * 2.0 - p.center[1];
        for x in 0..w {
            let u = (x as f64 + 0.5) / w as f64;
            let px = ((u - 0.5) * 2.0 - p.center[0]) * aspect;
            let q = [(cs * px - sn * py).abs(), (sn * px + cs * py).abs()];
            let g = gauge(q);
            let outside = if e1 > e0 {
                let t = ((g - e0) / (e1 - e0)).clamp(0.0, 1.0);
                t * t * (3.0 - 2.0 * t)
            } else if g > e0 {
                1.0
            } else {
                0.0
            };
            out[(y * w + x) as usize] = ((1.0 - outside) * 255.0).round() as u8;
        }
    }
    out
}

/// A pixel's offset from the mask's centre in units of the picture's half-height (v up), as
/// CapCut's mask shaders compute it, for every pixel of a `w`×`h` picture.
fn offsets(p: &Pose, w: u32, h: u32, mut f: impl FnMut(usize, [f64; 2])) {
    let aspect = w as f64 / h as f64;
    for y in 0..h {
        let v = 1.0 - (y as f64 + 0.5) / h as f64;
        for x in 0..w {
            let u = (x as f64 + 0.5) / w as f64;
            f((y * w + x) as usize, [((u - 0.5) * 2.0 - p.center[0]) * aspect, (v - 0.5) * 2.0 - p.center[1]]);
        }
    }
}

/// GLSL's smoothstep, a step at `e0` when the edges meet.
fn smoothstep(e0: f64, e1: f64, x: f64) -> f64 {
    if e1 <= e0 {
        return if x > e0 { 1.0 } else { 0.0 };
    }
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// How much CapCut widens a turned mask's edge for smoothing (0 at 0°, 1 at 45°), from its
/// angle in radians.
fn decay(theta: f64) -> f64 {
    use std::f64::consts::{FRAC_PI_2, FRAC_PI_4};
    (1.0 - ((theta.rem_euclid(FRAC_PI_2) / FRAC_PI_4) - 1.0).powi(2)).max(0.0).powf(0.125)
}

/// CapCut's circle bundle (`lumi_circle_mask`): the offset turned by 360° plus the rotation,
/// then (x/a)² + (y/b)² against 1 for the box's half-sizes a and b, softened by 15 × the
/// feather and, for long thin ellipses, a little more.
fn circle(p: &Pose, feather: f64, w: u32, h: u32) -> Vec<u8> {
    let aspect = w as f64 / h as f64;
    let (a, b) = ((p.size[0] * aspect).max(1e-6), p.size[1].max(1e-6));
    let ratio = if p.size[0] > p.size[1] { p.size[0] / p.size[1].max(1e-6) } else { p.size[1] / p.size[0].max(1e-6) };
    let k = (ratio.clamp(1.0, 11.0) - 1.0) / 10.0;
    let soft = feather * 15.0 + k * k * 0.05;
    let (sn, cs) = (360.0 + p.rotation).to_radians().sin_cos();
    let mut out = vec![0u8; (w * h) as usize];
    offsets(p, w, h, |i, [px, py]| {
        let (qx, qy) = (cs * px - sn * py, sn * px + cs * py);
        let r = qx * qx / (a * a) + qy * qy / (b * b);
        out[i] = ((1.0 - smoothstep(1.0 - soft, 1.0 + soft, r)) * 255.0).round() as u8;
    });
    out
}

/// CapCut's linear and mirror bundles (`lumi_linear_mask`, `lumi_mirror_mask`): the offset's
/// distance along the direction the rotation turns "up" to. The linear mask keeps what's on
/// that side of the line, softened by the feather; the mirror keeps a band of half the box's
/// height (in half-heights) either side of it.
fn line(p: &Pose, feather: f64, w: u32, h: u32, mirror: bool) -> Vec<u8> {
    let theta = -p.rotation.to_radians();
    let (ox, oy) = (-theta.sin(), theta.cos());
    let d = 0.005 * decay(theta);
    let half = p.size[1];
    let mut out = vec![0u8; (w * h) as usize];
    offsets(p, w, h, |i, [px, py]| {
        let along = ox * px + oy * py;
        let kept = if !mirror {
            smoothstep(-d - feather, feather, along)
        } else if half <= 0.0 {
            0.0
        } else {
            1.0 - smoothstep(half - d - feather, half + d + feather, along.abs())
        };
        out[i] = (kept * 255.0).round() as u8;
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use openrip_model::{Handle, MaskPaint, MaterialId};

    fn rect(center: [f32; 2], size: [f32; 2]) -> Mask {
        Mask { id: MaterialId("m".into()), shape: MaskShape::Rectangle { round_corner: 0.0 }, center, size, rotation: 0.0, feather: 0.0, expansion: 0.0, invert: false, inside: MaskPaint::Clip, outside: MaskPaint::clear(), keys: Vec::new(), library: None }
    }

    fn mkey(at: i64, shape: MaskShape, center: [f32; 2], size: [f32; 2], ease: Easing) -> MaskKey {
        MaskKey { at: Micros(at), shape, center, size, rotation: 0.0, feather: None, expansion: None, ease }
    }

    #[test]
    fn a_rectangle_covers_its_share_of_the_picture_above_centre_for_positive_y() {
        // Half the width and a quarter of the height, a quarter of the half-height up.
        let (w, h) = (200, 400);
        let c = coverage(&rect([0.0, 0.25], [0.5, 0.25]), Micros::ZERO, w, h, None, None).unwrap();
        let at = |x: u32, y: u32| c[(y * w + x) as usize];
        // Centre row: 400/2 − 0.25·200 = 150; rows 100..200 and columns 50..150 are inside.
        assert_eq!((at(100, 150), at(51, 101), at(148, 198)), (255, 255, 255));
        assert_eq!((at(49, 150), at(100, 98), at(100, 201)), (0, 0, 0));
        assert_eq!(c.iter().filter(|&&v| v == 255).count(), 100 * 100);
    }

    #[test]
    fn inverting_swaps_inside_and_out() {
        let mut m = rect([0.0, 0.0], [0.5, 0.5]);
        let a = coverage(&m, Micros::ZERO, 64, 64, None, None).unwrap();
        m.invert = true;
        let b = coverage(&m, Micros::ZERO, 64, 64, None, None).unwrap();
        assert!(a.iter().zip(&b).all(|(x, y)| *x as u16 + *y as u16 == 255));
    }

    #[test]
    fn the_apps_shapes_follow_their_keys() {
        // An ellipse filling the picture, then from 1 s a triangle in its top-left quarter:
        // different shapes hold until the next key.
        let mut m = rect([0.0, 0.0], [1.0, 1.0]);
        m.shape = MaskShape::Ellipse;
        m.keys.push(mkey(0, MaskShape::Ellipse, [0.0, 0.0], [1.0, 1.0], Easing::Linear));
        m.keys.push(mkey(1_000_000, MaskShape::Triangle, [-0.5, 0.5], [0.5, 0.5], Easing::Linear));
        let (w, h) = (100, 100);
        let e = coverage(&m, Micros(999_999), w, h, None, None).unwrap();
        let at = |c: &[u8], x: u32, y: u32| c[(y * w + x) as usize];
        assert_eq!((at(&e, 50, 50), at(&e, 2, 2), at(&e, 50, 1)), (255, 0, 255));
        let t = coverage(&m, Micros(1_000_000), w, h, None, None).unwrap();
        // Box 0..50 square; apex at (25, 0 − 50/6), base at y = 50 − 50/6 ≈ 41.7.
        assert_eq!((at(&t, 25, 20), at(&t, 25, 43), at(&t, 75, 75), at(&t, 1, 30)), (255, 0, 0, 0));
    }

    /// Keys of the same shape travel between their poses (linearly by default, or by
    /// CapCut's curve), instead of holding.
    #[test]
    fn keys_of_one_shape_travel() {
        let mut m = rect([0.0, 0.0], [0.2, 0.2]);
        m.keys.push(mkey(0, MaskShape::Rectangle { round_corner: 0.0 }, [-0.5, 0.0], [0.2, 0.2], Easing::Linear));
        m.keys.push(mkey(1_000_000, MaskShape::Rectangle { round_corner: 0.0 }, [0.5, 0.0], [0.2, 0.2], Easing::Linear));
        assert!((pose(&m, Micros(250_000)).center[0] + 0.25).abs() < 1e-6);
        // CapCut's default curve: slow at the start.
        let curve = Easing::Curve { out: Handle::uniform(400_000.0, 0.0), into: Handle::uniform(-400_000.0, 0.0), straight: 0 };
        m.keys[0].ease = curve;
        let c = pose(&m, Micros(250_000)).center[0];
        assert!(c < -0.25 && c > -0.5, "{c}");
        assert!((pose(&m, Micros(500_000)).center[0]).abs() < 1e-6);
        // Lassos with the same number of points move point by point.
        let mut l = rect([0.0, 0.0], [1.0, 1.0]);
        let tri = |dx: f32| MaskShape::Polygon { points: vec![[0.1 + dx, 0.1], [0.4 + dx, 0.1], [0.1 + dx, 0.4]] };
        l.keys.push(mkey(0, tri(0.0), [0.0, 0.0], [1.0, 1.0], Easing::Linear));
        l.keys.push(mkey(1_000_000, tri(0.5), [0.0, 0.0], [1.0, 1.0], Easing::Linear));
        let (MaskShape::Polygon { points: got }, MaskShape::Polygon { points: want }) = (pose(&l, Micros(500_000)).shape, tri(0.25)) else { panic!("a lasso") };
        assert!(got.iter().flatten().zip(want.iter().flatten()).all(|(a, b)| (a - b).abs() < 1e-6), "{got:?}");
    }

    /// The app's feather softens its shapes' edges as CapCut softens its own: zero is the
    /// hard edge as before.
    #[test]
    fn the_apps_feather_softens_its_shapes() {
        let (w, h) = (100, 100);
        for shape in [MaskShape::Ellipse, MaskShape::Triangle, MaskShape::Star, MaskShape::Polygon { points: vec![[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]] }] {
            let mut m = rect([0.0, 0.0], [0.6, 0.6]);
            m.shape = shape.clone();
            let hard = coverage(&m, Micros::ZERO, w, h, None, None).unwrap();
            assert!(hard.iter().all(|&v| v == 0 || v == 255), "{shape:?}");
            m.feather = 0.02;
            let soft = coverage(&m, Micros::ZERO, w, h, None, None).unwrap();
            let partial = soft.iter().filter(|&&v| v > 0 && v < 255).count();
            assert!(partial > 50, "{shape:?}: {partial}");
            // The middle stays, far outside stays clear.
            assert_eq!((soft[50 * 100 + 50], soft[0]), (255, 0), "{shape:?}");
        }
    }

    /// A key's own feather travels with its place; keys without one take the mask's.
    #[test]
    fn a_keyed_feather_travels() {
        let mut m = rect([0.0, 0.0], [0.6, 0.6]);
        m.feather = 0.3;
        let mut a = mkey(0, MaskShape::Ellipse, [0.0, 0.0], [0.6, 0.6], Easing::Linear);
        a.feather = Some(0.0);
        let mut b = mkey(1_000_000, MaskShape::Ellipse, [0.0, 0.0], [0.6, 0.6], Easing::Linear);
        b.feather = Some(0.02);
        m.keys = vec![a, b];
        assert_eq!((pose(&m, Micros::ZERO).feather, pose(&m, Micros(2_000_000)).feather as f32), (0.0, 0.02));
        assert!((pose(&m, Micros(500_000)).feather - 0.01).abs() < 1e-6);
        let hard = coverage(&m, Micros::ZERO, 100, 100, None, None).unwrap();
        assert!(hard.iter().all(|&v| v == 0 || v == 255));
        m.keys[1].feather = None;
        assert!((pose(&m, Micros(1_000_000)).feather - 0.3).abs() < 1e-6);
    }

    /// The brush paints round-ended strokes; an eraser takes away what's under it.
    /// Expansion moves a lasso's outline out (in, below 0) and widens a brush's strokes.
    #[test]
    fn expansion_grows_and_shrinks() {
        let (w, h) = (100, 100);
        let count = |c: &[u8]| c.iter().filter(|&&v| v >= 128).count();
        let mut m = rect([0.0, 0.0], [1.0, 1.0]);
        m.shape = MaskShape::Polygon { points: vec![[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]] };
        let plain = count(&coverage(&m, Micros::ZERO, w, h, None, None).unwrap());
        m.expansion = 0.05;
        let grown = count(&coverage(&m, Micros::ZERO, w, h, None, None).unwrap());
        m.expansion = -0.05;
        let shrunk = count(&coverage(&m, Micros::ZERO, w, h, None, None).unwrap());
        // 40 px square: 50 px out, 30 px in.
        assert!((plain as i64 - 1600).abs() < 60 && (grown as i64 - 2500).abs() < 120 && (shrunk as i64 - 900).abs() < 60, "{plain} {grown} {shrunk}");
        let mut b = rect([0.0, 0.0], [1.0, 1.0]);
        b.shape = MaskShape::Brush { strokes: vec![BrushStroke { points: vec![[0.2, 0.5], [0.8, 0.5]], width: 0.1, erase: false }] };
        let thin = count(&coverage(&b, Micros::ZERO, w, h, None, None).unwrap());
        b.expansion = 0.05;
        let thick = count(&coverage(&b, Micros::ZERO, w, h, None, None).unwrap());
        assert!(thick > thin * 18 / 10, "{thin} → {thick}");
    }

    /// A wide feather on a polygon, sampled every few pixels, is within a level or two of
    /// every pixel measured.
    #[test]
    fn a_feathered_polygon_sampled_matches_every_pixel() {
        let (w, h) = (300, 200);
        let pts: Vec<[f64; 2]> = vec![[60.0, 40.0], [250.0, 70.0], [120.0, 180.0]];
        let band = 6.0 * 0.3 * 70.0;
        let exact = soft(w, h, |x, y| {
            let d = (0..pts.len()).map(|i| segment_distance(pts[i], pts[(i + 1) % pts.len()], x, y)).fold(f64::INFINITY, f64::min);
            let signed = if in_polygon(&pts, x, y) { -d } else { d };
            1.0 - smoothstep(-band, band, signed)
        });
        let sampled = soft_polygon(&pts, 0.3, 0.0, w, h);
        let worst = exact.iter().zip(&sampled).map(|(a, b)| (*a as i32 - *b as i32).abs()).max().unwrap();
        assert!(worst <= 3, "{worst}");
    }

    /// A text mask places its glyphs centred on its centre, turned by its rotation.
    #[test]
    fn a_text_mask_places_its_glyphs() {
        // Glyphs: a 20×10 block, its centre in the middle.
        let g = Glyphs { w: 20, h: 10, alpha: vec![255; 200], center: [10.0, 5.0] };
        let mut m = rect([0.5, 0.0], [0.0, 0.0]);
        m.shape = MaskShape::Text(openrip_model::MaskText { text: "x".into(), font: String::new(), size: 0.1, bold: false, italic: false, underline: false, letter_spacing: 0.0, line_spacing: 0.0, align: 1 });
        let (w, h) = (100, 100);
        assert!(coverage(&m, Micros::ZERO, w, h, None, None).is_none(), "no glyphs, nothing drawn");
        let c = coverage(&m, Micros::ZERO, w, h, None, Some(&g)).unwrap();
        let at = |x: u32, y: u32| c[(y * w + x) as usize];
        // Centred at (75, 50): 20 wide, 10 tall.
        assert_eq!((at(75, 50), at(67, 47), at(83, 52), at(75, 58), at(60, 50)), (255, 255, 255, 0, 0));
        m.rotation = 90.0;
        let t = coverage(&m, Micros::ZERO, w, h, None, Some(&g)).unwrap();
        let at = |x: u32, y: u32| t[(y * w + x) as usize];
        assert_eq!((at(75, 58), at(83, 50)), (255, 0));
    }

    #[test]
    fn the_brush_paints_and_erases() {
        let (w, h) = (100, 100);
        let mut m = rect([0.0, 0.0], [1.0, 1.0]);
        m.shape = MaskShape::Brush {
            strokes: vec![
                BrushStroke { points: vec![[0.1, 0.5], [0.9, 0.5]], width: 0.2, erase: false },
                BrushStroke { points: vec![[0.5, 0.5]], width: 0.1, erase: true },
            ],
        };
        let c = coverage(&m, Micros::ZERO, w, h, None, None).unwrap();
        let at = |x: u32, y: u32| c[(y * w + x) as usize];
        // 10 px either side of the line, ends rounded; a 5 px hole in the middle.
        assert_eq!((at(20, 50), at(20, 41), at(20, 38), at(5, 50), at(50, 50), at(50, 57)), (255, 255, 0, 255, 0, 255));
    }

    /// A picture shape: the field's 0.5 level is the outline, the picture 1.7 times the box.
    /// A field that is a disc of radius 1/1.7 of the picture draws the circle in the box.
    #[test]
    fn a_picture_shape_fills_its_box() {
        let n = 170u32;
        let mut rgba = vec![0u8; (n * n * 4) as usize];
        for y in 0..n {
            for x in 0..n {
                let (dx, dy) = ((x as f64 + 0.5) / n as f64 - 0.5, (y as f64 + 0.5) / n as f64 - 0.5);
                // 0.5 at radius 0.5/1.7 of the picture, rising inward.
                let total = (0.5 + (0.5 / 1.7 - dx.hypot(dy)) * 2.0).clamp(0.0, 1.0) * 701.0;
                // Encoded as the bundle's shader reads it: red·1024/255 + green.
                let r = (total * 255.0 / 1024.0).floor().min(255.0);
                let g = (total - r * 1024.0 / 255.0).round().clamp(0.0, 255.0);
                rgba[((y * n + x) * 4) as usize] = r as u8;
                rgba[((y * n + x) * 4 + 1) as usize] = g as u8;
            }
        }
        let field = Field::from_rgba(n, n, &rgba);
        let mut m = rect([0.0, 0.0], [0.5, 0.5]);
        m.shape = MaskShape::Picture { name: "heart".into(), path: String::new() };
        let (w, h) = (100, 100);
        assert!(coverage(&m, Micros::ZERO, w, h, None, None).is_none());
        let c = coverage(&m, Micros::ZERO, w, h, Some(&field), None).unwrap();
        let at = |x: u32, y: u32| c[(y * w + x) as usize];
        // A disc of radius 25 px about the middle.
        assert_eq!((at(50, 50), at(50, 28), at(50, 21), at(72, 50), at(79, 50)), (255, 255, 0, 255, 0));
    }

    /// CapCut's own heart, from its bundle when it's on this machine (skipped otherwise): two
    /// lobes at the top and a point at the bottom, as wide as its box and a little less tall,
    /// centred in it, upright, and turned clockwise by the rotation.
    #[test]
    fn capcuts_heart_from_its_bundle() {
        let Some(home) = std::env::var_os("HOME") else { return };
        let cache = std::path::Path::new(&home).join("Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Cache/effect/1068046512");
        let Some(png) = std::fs::read_dir(&cache).ok().into_iter().flatten().flatten().map(|e| e.path().join("amazingfeature/image/mask.png")).find(|p| p.is_file()) else {
            eprintln!("no heart bundle here; skipped");
            return;
        };
        let img = openrip_media::load_png(&png).unwrap();
        let field = Field::from_rgba(img.width, img.height, &img.data);
        let mut m = rect([0.0, 0.0], [0.5, 0.5]);
        m.shape = MaskShape::Picture { name: "heart".into(), path: String::new() };
        let (w, h) = (400u32, 400u32);
        let c = coverage(&m, Micros::ZERO, w, h, Some(&field), None).unwrap();
        let rows: Vec<u32> = (0..h).map(|y| (0..w).filter(|&x| c[(y * w + x) as usize] >= 128).count() as u32).collect();
        let cols: Vec<u32> = (0..w).map(|x| (0..h).filter(|&y| c[(y * w + x) as usize] >= 128).count() as u32).collect();
        let span = |v: &[u32]| (v.iter().position(|&n| n > 0).unwrap(), v.iter().rposition(|&n| n > 0).unwrap());
        let ((x0, x1), (y0, y1)) = (span(&cols), span(&rows));
        // The box is 200 px square at the middle: the heart spans its width (1.7 × 603/1024 of
        // it) and 0.9 of its height, centred.
        assert!((x1 - x0 + 1) as i32 - 200 <= 2 && (x1 - x0 + 1) >= 198, "width {}", x1 - x0 + 1);
        assert!(((y1 - y0 + 1) as f64 - 180.0).abs() <= 3.0, "height {}", y1 - y0 + 1);
        assert!(((x0 + x1) as f64 / 2.0 - 199.5).abs() <= 1.0 && ((y0 + y1) as f64 / 2.0 - 199.5).abs() <= 1.0);
        // Upright: wide just under its top (the lobes), a point at its bottom.
        assert!(rows[y0 + 10] > 60 && rows[y1 - 2] < 12, "top {} bottom {}", rows[y0 + 10], rows[y1 - 2]);
        // Turned 90° clockwise, the point is on the left.
        m.rotation = 90.0;
        let c = coverage(&m, Micros::ZERO, w, h, Some(&field), None).unwrap();
        let cols: Vec<u32> = (0..w).map(|x| (0..h).filter(|&y| c[(y * w + x) as usize] >= 128).count() as u32).collect();
        let (x0, x1) = span(&cols);
        assert!(cols[x0 + 2] < 12 && cols[x1 - 10] > 60, "left {} right {}", cols[x0 + 2], cols[x1 - 10]);
    }

    /// CapCut's circle: a 0.5 × 0.5 box on a square picture is the disc of radius a quarter of
    /// the side, hard-edged without feather; feather softens its edge both ways.
    #[test]
    fn capcuts_circle_is_the_ellipse_in_its_box() {
        let mut m = rect([0.0, 0.0], [0.5, 0.5]);
        m.shape = MaskShape::Circle;
        let (w, h) = (100, 100);
        let c = coverage(&m, Micros::ZERO, w, h, None, None).unwrap();
        let at = |c: &[u8], x: u32, y: u32| c[(y * w + x) as usize];
        assert_eq!((at(&c, 50, 50), at(&c, 50, 26), at(&c, 50, 23), at(&c, 74, 50), at(&c, 77, 50), at(&c, 65, 65), at(&c, 70, 70)), (255, 255, 0, 255, 0, 255, 0));
        m.feather = 0.02;
        let soft = coverage(&m, Micros::ZERO, w, h, None, None).unwrap();
        let edge = at(&soft, 75, 50);
        assert!(edge > 40 && edge < 215, "{edge}");
    }

    /// CapCut's linear mask keeps the side the rotation points up to; the mirror a band either
    /// side of the line, as tall as the box.
    #[test]
    fn capcuts_linear_and_mirror_masks() {
        let mut m = rect([0.0, 0.0], [1.0, 0.25]);
        m.shape = MaskShape::Linear;
        let (w, h) = (100, 100);
        let at = |c: &[u8], x: u32, y: u32| c[(y * w + x) as usize];
        let c = coverage(&m, Micros::ZERO, w, h, None, None).unwrap();
        assert_eq!((at(&c, 50, 10), at(&c, 50, 90)), (255, 0));
        // Turned 90° clockwise, "up" points left... or right: the kept side moves sideways.
        m.rotation = 90.0;
        let c = coverage(&m, Micros::ZERO, w, h, None, None).unwrap();
        assert_ne!(at(&c, 10, 50), at(&c, 90, 50));
        assert_eq!(at(&c, 10, 50).max(at(&c, 90, 50)), 255);
        m.rotation = 0.0;
        m.shape = MaskShape::Mirror;
        // A band 0.25 half-heights either side: rows 37.5..62.5.
        let c = coverage(&m, Micros::ZERO, w, h, None, None).unwrap();
        assert_eq!((at(&c, 50, 50), at(&c, 50, 40), at(&c, 50, 36), at(&c, 50, 64)), (255, 255, 0, 0));
    }

    #[test]
    fn a_lasso_is_its_polygon() {
        let mut m = rect([0.0, 0.0], [1.0, 1.0]);
        m.shape = MaskShape::Polygon { points: vec![[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]] };
        let c = coverage(&m, Micros::ZERO, 10, 10, None, None).unwrap();
        assert_eq!((c[2 * 10 + 2], c[8 * 10 + 8]), (255, 0));
    }
}
