//! CapCut's video masks (`common_mask`), drawn as its mask bundles draw them: a coverage
//! value per pixel of the clip's own picture, multiplied into the picture before it's placed
//! (docs/parity/masks.md).

use openrip_model::{Mask, MaskShape};

/// Coverage (0–255) of `mask` over an upright picture of `w`×`h` pixels, row 0 at the top,
/// or `None` for a shape not drawn yet.
pub fn coverage(mask: &Mask, w: u32, h: u32) -> Option<Vec<u8>> {
    match mask.shape {
        MaskShape::Rectangle { round_corner } => Some(rectangle(mask, round_corner as f64, w, h)),
        MaskShape::Other { .. } => None,
    }
}

/// The rectangle bundle (`lumi_rectangle_mask`). In units of the picture's half-height, a
/// pixel's offset from the centre is turned by the rotation; its "gauge" is how far out it
/// is relative to the rounded rectangle's edge along the same ray (1 on the edge). The edge
/// is a smoothstep around 1, widened by the feather (×6) and, when turned, by up to 0.5% for
/// smoothing; at 0° it's a hard step.
fn rectangle(m: &Mask, round: f64, w: u32, h: u32) -> Vec<u8> {
    use std::f64::consts::{FRAC_PI_2, FRAC_PI_4};
    let aspect = w as f64 / h as f64;
    let size = [m.size[0] as f64, m.size[1] as f64];
    let r = if size[0] * aspect >= size[1] { size[1] } else { size[0] * aspect } * round;
    let rt = [size[0] * aspect, size[1]];
    let cc = [rt[0] - r, rt[1] - r];
    // The bundle's angle is 360° plus the rotation.
    let theta = (360.0 + m.rotation as f64).to_radians();
    let (sn, cs) = theta.sin_cos();
    let decay = (1.0 - ((theta.rem_euclid(FRAC_PI_2) / FRAC_PI_4) - 1.0).powi(2)).max(0.0).powf(0.125);
    let diff = m.feather as f64 * 6.0;
    let (e0, e1) = (1.0 - decay * 0.005 - diff, 1.0 + decay * 0.005 + diff);
    let gauge = |p: [f64; 2]| -> f64 {
        if p[1] * cc[0] >= rt[1] * p[0] {
            p[1] / size[1]
        } else if p[1] * rt[0] <= cc[1] * p[0] {
            p[0] / (aspect * size[0])
        } else {
            // The corner: the scale at which the ray meets the corner's circle.
            let a = cc[0] * cc[0] + cc[1] * cc[1] - r * r;
            let b = -2.0 * (p[0] * cc[0] + p[1] * cc[1]);
            let c = p[0] * p[0] + p[1] * p[1];
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
        let py = (v - 0.5) * 2.0 - m.center[1] as f64;
        for x in 0..w {
            let u = (x as f64 + 0.5) / w as f64;
            let px = ((u - 0.5) * 2.0 - m.center[0] as f64) * aspect;
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
            let a = if m.invert { outside } else { 1.0 - outside };
            out[(y * w + x) as usize] = (a * 255.0).round() as u8;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use openrip_model::MaterialId;

    fn rect(center: [f32; 2], size: [f32; 2]) -> Mask {
        Mask { id: MaterialId("m".into()), shape: MaskShape::Rectangle { round_corner: 0.0 }, center, size, rotation: 0.0, feather: 0.0, invert: false, library: None }
    }

    #[test]
    fn a_rectangle_covers_its_share_of_the_picture_above_centre_for_positive_y() {
        // Half the width and a quarter of the height, a quarter of the half-height up.
        let (w, h) = (200, 400);
        let c = coverage(&rect([0.0, 0.25], [0.5, 0.25]), w, h).unwrap();
        let at = |x: u32, y: u32| c[(y * w + x) as usize];
        // Centre row: 400/2 − 0.25·200 = 150; rows 100..200 and columns 50..150 are inside.
        assert_eq!((at(100, 150), at(51, 101), at(148, 198)), (255, 255, 255));
        assert_eq!((at(49, 150), at(100, 98), at(100, 201)), (0, 0, 0));
        assert_eq!(c.iter().filter(|&&v| v == 255).count(), 100 * 100);
    }

    #[test]
    fn inverting_swaps_inside_and_out() {
        let mut m = rect([0.0, 0.0], [0.5, 0.5]);
        let a = coverage(&m, 64, 64).unwrap();
        m.invert = true;
        let b = coverage(&m, 64, 64).unwrap();
        assert!(a.iter().zip(&b).all(|(x, y)| *x as u16 + *y as u16 == 255));
    }
}
