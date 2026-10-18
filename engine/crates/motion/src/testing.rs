//! Synthetic pictures for the tests: smooth random textures, and a textured square placed
//! over a background at any position, size and rotation (with the motion known exactly).

use crate::image::Gray;

pub use crate::fit::Rng;

/// Random noise blurred by `sigma` pixels and stretched to fill 0–1: texture with corners at
/// about that scale everywhere.
pub fn texture(rng: &mut Rng, width: usize, height: usize, sigma: f32) -> Gray {
    let mut g = Gray::new(width, height);
    g.data.iter_mut().for_each(|v| *v = rng.unit() as f32);
    let mut g = g.blur(sigma);
    let (lo, hi) = g.data.iter().fold((f32::MAX, f32::MIN), |(lo, hi), &v| (lo.min(v), hi.max(v)));
    g.data.iter_mut().for_each(|v| *v = (*v - lo) / (hi - lo).max(1e-6));
    g
}

/// `background` (stretched to `w`×`h`) with `object` drawn on a square of side `side` pixels
/// centred at `center` and turned by `rotation` radians (clockwise on screen), with
/// anti-aliased edges (4×4 supersampling).
pub fn render_square(background: &Gray, object: &Gray, w: usize, h: usize, center: [f64; 2], side: f64, rotation: f64) -> Gray {
    let mut out = Gray::new(w, h);
    let (s, c) = rotation.sin_cos();
    let (bx, by) = (background.width as f64 / w as f64, background.height as f64 / h as f64);
    for y in 0..h {
        for x in 0..w {
            let mut acc = 0.0f64;
            for sy in 0..4 {
                for sx in 0..4 {
                    let (px, py) = (x as f64 + (sx as f64 + 0.5) / 4.0 - 0.5, y as f64 + (sy as f64 + 0.5) / 4.0 - 0.5);
                    let (dx, dy) = (px - center[0], py - center[1]);
                    // Into the square's own axes.
                    let (u, v) = (c * dx + s * dy, -s * dx + c * dy);
                    acc += if u.abs() <= side / 2.0 && v.abs() <= side / 2.0 {
                        let (ox, oy) = ((u / side + 0.5) * object.width as f64 - 0.5, (v / side + 0.5) * object.height as f64 - 0.5);
                        object.sample(ox as f32, oy as f32) as f64
                    } else {
                        background.sample((px * bx) as f32, (py * by) as f32) as f64
                    };
                }
            }
            out.data[y * w + x] = (acc / 16.0) as f32;
        }
    }
    out
}

/// Peak signal-to-noise ratio (dB) between two pictures of 0–1 values.
pub fn psnr(a: &[f32], b: &[f32]) -> f64 {
    let mse: f64 = a.iter().zip(b).map(|(x, y)| ((x - y) as f64).powi(2)).sum::<f64>() / a.len().max(1) as f64;
    if mse <= 0.0 {
        return f64::INFINITY;
    }
    10.0 * (1.0 / mse).log10()
}
