//! Masks over a clip's own picture, as coverage per pixel (0–255) of the upright picture,
//! row 0 at the top, which the compositor then paints inside and outside
//! (docs/parity/masks.md).
//!
//! CapCut's rectangle is drawn as its bundle draws it; the app's shapes and lassos as its
//! WebGL masks do: hard-edged, tested at pixel centres.

use openrip_model::{Mask, MaskShape, Micros};

/// The shape and place a mask has at `at` (time in the clip's source): its last key at or
/// before then, else its own.
struct Pose<'a> {
    shape: &'a MaskShape,
    center: [f64; 2],
    size: [f64; 2],
    rotation: f64,
}

fn pose(m: &Mask, at: Micros) -> Pose<'_> {
    let key = m.keys.iter().rev().find(|k| k.at <= at);
    match key {
        Some(k) => Pose { shape: &k.shape, center: k.center.map(f64::from), size: k.size.map(f64::from), rotation: k.rotation as f64 },
        None => Pose { shape: &m.shape, center: m.center.map(f64::from), size: m.size.map(f64::from), rotation: m.rotation as f64 },
    }
}

/// A key for everything that changes the coverage at `at`.
pub fn coverage_key(m: &Mask, at: Micros) -> String {
    let p = pose(m, at);
    format!("{:?}{:?}{:?}{}{}{}", p.shape, p.center, p.size, p.rotation, m.feather, m.invert)
}

/// Coverage of `mask` at `at` over an upright picture of `w`×`h` pixels, or `None` for a
/// shape not drawn yet.
pub fn coverage(mask: &Mask, at: Micros, w: u32, h: u32) -> Option<Vec<u8>> {
    let p = pose(mask, at);
    let mut out = match p.shape {
        MaskShape::Rectangle { round_corner } => rectangle(&p, *round_corner as f64, mask.feather as f64, w, h),
        MaskShape::Circle => circle(&p, mask.feather as f64, w, h),
        MaskShape::Linear => line(&p, mask.feather as f64, w, h, false),
        MaskShape::Mirror => line(&p, mask.feather as f64, w, h, true),
        MaskShape::Other { .. } => return None,
        MaskShape::Polygon { points } => {
            let pts: Vec<[f64; 2]> = points.iter().map(|q| [q[0] as f64 * w as f64, q[1] as f64 * h as f64]).collect();
            hard_edged(w, h, |x, y| in_polygon(&pts, x, y))
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
            match shape {
                MaskShape::Ellipse => hard_edged(w, h, |x, y| {
                    let (lx, ly) = local(x, y);
                    (lx / hw.max(1e-4)).powi(2) + (ly / hh.max(1e-4)).powi(2) <= 1.0
                }),
                MaskShape::Triangle => {
                    let lift = -2.0 * hh / 6.0;
                    let tri = [[0.0, -hh + lift], [-hw, hh + lift], [hw, hh + lift]];
                    hard_edged(w, h, |x, y| {
                        let (lx, ly) = local(x, y);
                        in_triangle([lx, ly], tri)
                    })
                }
                _ => {
                    let star: Vec<[f64; 2]> = (0..10)
                        .map(|i| {
                            let a = i as f64 * std::f64::consts::PI / 5.0;
                            let k = if i % 2 == 0 { 1.0 } else { 0.5 };
                            [k * hw * a.sin(), -k * hh * a.cos()]
                        })
                        .collect();
                    hard_edged(w, h, |x, y| {
                        let (lx, ly) = local(x, y);
                        in_polygon(&star, lx, ly)
                    })
                }
            }
        }
    };
    if mask.invert {
        out.iter_mut().for_each(|v| *v = 255 - *v);
    }
    Some(out)
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
    use openrip_model::{MaskKey, MaskPaint, MaterialId};

    fn rect(center: [f32; 2], size: [f32; 2]) -> Mask {
        Mask { id: MaterialId("m".into()), shape: MaskShape::Rectangle { round_corner: 0.0 }, center, size, rotation: 0.0, feather: 0.0, invert: false, inside: MaskPaint::Clip, outside: MaskPaint::clear(), keys: Vec::new(), library: None }
    }

    #[test]
    fn a_rectangle_covers_its_share_of_the_picture_above_centre_for_positive_y() {
        // Half the width and a quarter of the height, a quarter of the half-height up.
        let (w, h) = (200, 400);
        let c = coverage(&rect([0.0, 0.25], [0.5, 0.25]), Micros::ZERO, w, h).unwrap();
        let at = |x: u32, y: u32| c[(y * w + x) as usize];
        // Centre row: 400/2 − 0.25·200 = 150; rows 100..200 and columns 50..150 are inside.
        assert_eq!((at(100, 150), at(51, 101), at(148, 198)), (255, 255, 255));
        assert_eq!((at(49, 150), at(100, 98), at(100, 201)), (0, 0, 0));
        assert_eq!(c.iter().filter(|&&v| v == 255).count(), 100 * 100);
    }

    #[test]
    fn inverting_swaps_inside_and_out() {
        let mut m = rect([0.0, 0.0], [0.5, 0.5]);
        let a = coverage(&m, Micros::ZERO, 64, 64).unwrap();
        m.invert = true;
        let b = coverage(&m, Micros::ZERO, 64, 64).unwrap();
        assert!(a.iter().zip(&b).all(|(x, y)| *x as u16 + *y as u16 == 255));
    }

    #[test]
    fn the_apps_shapes_follow_their_keys() {
        // An ellipse filling the picture, then from 1 s a triangle in its top-left quarter.
        let mut m = rect([0.0, 0.0], [1.0, 1.0]);
        m.shape = MaskShape::Ellipse;
        m.keys.push(MaskKey { at: Micros(1_000_000), shape: MaskShape::Triangle, center: [-0.5, 0.5], size: [0.5, 0.5], rotation: 0.0 });
        let (w, h) = (100, 100);
        let e = coverage(&m, Micros(999_999), w, h).unwrap();
        let at = |c: &[u8], x: u32, y: u32| c[(y * w + x) as usize];
        assert_eq!((at(&e, 50, 50), at(&e, 2, 2), at(&e, 50, 1)), (255, 0, 255));
        let t = coverage(&m, Micros(1_000_000), w, h).unwrap();
        // Box 0..50 square; apex at (25, 0 − 50/6), base at y = 50 − 50/6 ≈ 41.7.
        assert_eq!((at(&t, 25, 20), at(&t, 25, 43), at(&t, 75, 75), at(&t, 1, 30)), (255, 0, 0, 0));
    }

    /// CapCut's circle: a 0.5 × 0.5 box on a square picture is the disc of radius a quarter of
    /// the side, hard-edged without feather; feather softens its edge both ways.
    #[test]
    fn capcuts_circle_is_the_ellipse_in_its_box() {
        let mut m = rect([0.0, 0.0], [0.5, 0.5]);
        m.shape = MaskShape::Circle;
        let (w, h) = (100, 100);
        let c = coverage(&m, Micros::ZERO, w, h).unwrap();
        let at = |c: &[u8], x: u32, y: u32| c[(y * w + x) as usize];
        assert_eq!((at(&c, 50, 50), at(&c, 50, 26), at(&c, 50, 23), at(&c, 74, 50), at(&c, 77, 50), at(&c, 65, 65), at(&c, 70, 70)), (255, 255, 0, 255, 0, 255, 0));
        m.feather = 0.02;
        let soft = coverage(&m, Micros::ZERO, w, h).unwrap();
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
        let c = coverage(&m, Micros::ZERO, w, h).unwrap();
        assert_eq!((at(&c, 50, 10), at(&c, 50, 90)), (255, 0));
        // Turned 90° clockwise, "up" points left... or right: the kept side moves sideways.
        m.rotation = 90.0;
        let c = coverage(&m, Micros::ZERO, w, h).unwrap();
        assert_ne!(at(&c, 10, 50), at(&c, 90, 50));
        assert_eq!(at(&c, 10, 50).max(at(&c, 90, 50)), 255);
        m.rotation = 0.0;
        m.shape = MaskShape::Mirror;
        // A band 0.25 half-heights either side: rows 37.5..62.5.
        let c = coverage(&m, Micros::ZERO, w, h).unwrap();
        assert_eq!((at(&c, 50, 50), at(&c, 50, 40), at(&c, 50, 36), at(&c, 50, 64)), (255, 255, 0, 0));
    }

    #[test]
    fn a_lasso_is_its_polygon() {
        let mut m = rect([0.0, 0.0], [1.0, 1.0]);
        m.shape = MaskShape::Polygon { points: vec![[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]] };
        let c = coverage(&m, Micros::ZERO, 10, 10).unwrap();
        assert_eq!((c[2 * 10 + 2], c[8 * 10 + 8]), (255, 0));
    }
}
