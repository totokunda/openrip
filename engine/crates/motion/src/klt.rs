//! Pyramidal Lucas–Kanade point tracking (Bouguet's formulation): each point's window in the
//! first frame is found in the second by Gauss–Newton steps on the brightness difference,
//! coarse to fine through the pyramids, so motions much larger than the window are followed.

use crate::image::Pyramid;

/// How to track.
#[derive(Copy, Clone, Debug)]
pub struct Klt {
    /// Window radius in pixels: (2r + 1)² pixels compared.
    pub radius: usize,
    /// Most Gauss–Newton steps per level.
    pub iterations: usize,
    /// Stop a level once a step moves less than this (pixels).
    pub epsilon: f32,
    /// A window whose structure tensor's smaller eigenvalue (mean per pixel) is below this has
    /// no texture to lock on to: the point is lost.
    pub min_eigen: f32,
}

impl Default for Klt {
    fn default() -> Self {
        Klt { radius: 7, iterations: 30, epsilon: 0.01, min_eigen: 1e-6 }
    }
}

/// Where a point went, and the mean absolute brightness difference of its window there.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Tracked {
    pub point: [f32; 2],
    pub error: f32,
}

impl Klt {
    /// Track `points` of `prev` into `next`, starting each from its guess (`guesses`, or where
    /// it was). `None` for a point lost (no texture, or it left the frame).
    pub fn track(&self, prev: &Pyramid, next: &Pyramid, points: &[[f32; 2]], guesses: Option<&[[f32; 2]]>) -> Vec<Option<Tracked>> {
        points.iter().enumerate().map(|(i, p)| self.track_one(prev, next, *p, guesses.map_or(*p, |g| g[i]))).collect()
    }

    fn track_one(&self, prev: &Pyramid, next: &Pyramid, point: [f32; 2], guess: [f32; 2]) -> Option<Tracked> {
        let levels = prev.levels.len().min(next.levels.len());
        let r = self.radius as isize;
        let side = (2 * r + 1) as usize;
        let n = (side * side) as f32;
        let mut tpl = vec![0.0f32; side * side];
        let mut tgx = vec![0.0f32; side * side];
        let mut tgy = vec![0.0f32; side * side];
        // The displacement guessed at the coarsest level, refined level by level.
        let top = (levels - 1) as i32;
        let k = 0.5f32.powi(top);
        let mut g = [(guess[0] - point[0]) * k, (guess[1] - point[1]) * k];
        let mut error = 0.0;
        for level in (0..levels).rev() {
            let (pl, nl) = (&prev.levels[level], &next.levels[level]);
            let s = 0.5f32.powi(level as i32);
            let (px, py) = (point[0] * s, point[1] * s);
            // The template and its gradients, and the structure tensor.
            let (mut a, mut b, mut c) = (0.0f32, 0.0f32, 0.0f32);
            for dy in -r..=r {
                for dx in -r..=r {
                    let i = ((dy + r) as usize) * side + (dx + r) as usize;
                    let (x, y) = (px + dx as f32, py + dy as f32);
                    tpl[i] = pl.image.sample(x, y);
                    let (ix, iy) = (pl.gx.sample(x, y), pl.gy.sample(x, y));
                    tgx[i] = ix;
                    tgy[i] = iy;
                    a += ix * ix;
                    b += ix * iy;
                    c += iy * iy;
                }
            }
            let det = a * c - b * b;
            let min_eig = 0.5 * (a + c - ((a - c) * (a - c) + 4.0 * b * b).sqrt()) / n;
            if min_eig < self.min_eigen || det.abs() < 1e-12 {
                if level == 0 {
                    return None;
                }
                // Too smooth at this level: carry the guess down.
                g = [g[0] * 2.0, g[1] * 2.0];
                continue;
            }
            let mut v = [0.0f32; 2];
            for _ in 0..self.iterations {
                let (qx, qy) = (px + g[0] + v[0], py + g[1] + v[1]);
                if !nl.image.inside(qx, qy, -(r as f32)) {
                    return None;
                }
                let (mut bx, mut by) = (0.0f32, 0.0f32);
                for dy in -r..=r {
                    for dx in -r..=r {
                        let i = ((dy + r) as usize) * side + (dx + r) as usize;
                        let diff = tpl[i] - nl.image.sample(qx + dx as f32, qy + dy as f32);
                        bx += diff * tgx[i];
                        by += diff * tgy[i];
                    }
                }
                let step = [(c * bx - b * by) / det, (a * by - b * bx) / det];
                v[0] += step[0];
                v[1] += step[1];
                if step[0] * step[0] + step[1] * step[1] < self.epsilon * self.epsilon {
                    break;
                }
            }
            if level == 0 {
                let (qx, qy) = (px + g[0] + v[0], py + g[1] + v[1]);
                let mut e = 0.0;
                for dy in -r..=r {
                    for dx in -r..=r {
                        let i = ((dy + r) as usize) * side + (dx + r) as usize;
                        e += (tpl[i] - nl.image.sample(qx + dx as f32, qy + dy as f32)).abs();
                    }
                }
                error = e / n;
                g = [g[0] + v[0], g[1] + v[1]];
            } else {
                g = [2.0 * (g[0] + v[0]), 2.0 * (g[1] + v[1])];
            }
        }
        let out = [point[0] + g[0], point[1] + g[1]];
        let base = next.base();
        (out[0].is_finite() && out[1].is_finite() && base.inside(out[0], out[1], 0.0)).then_some(Tracked { point: out, error })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::Gray;
    use crate::testing::{texture, Rng};

    #[test]
    fn points_of_a_shifted_texture_move_by_the_shift() {
        let mut rng = Rng(7);
        let tex = texture(&mut rng, 160, 120, 3.0);
        // The texture moved by (11.3, −6.6): next(x) = tex(x − d).
        let d = [11.3f32, -6.6];
        let mut moved = Gray::new(160, 120);
        for y in 0..120 {
            for x in 0..160 {
                moved.data[y * 160 + x] = tex.sample(x as f32 - d[0], y as f32 - d[1]);
            }
        }
        let (a, b) = (Pyramid::new(tex, 4), Pyramid::new(moved, 4));
        let pts: Vec<[f32; 2]> = (0..20).map(|i| [40.0 + (i % 5) as f32 * 18.0, 35.0 + (i / 5) as f32 * 15.0]).collect();
        let out = Klt::default().track(&a, &b, &pts, None);
        for (p, t) in pts.iter().zip(&out) {
            let t = t.expect("tracked");
            assert!((t.point[0] - p[0] - d[0]).abs() < 0.1 && (t.point[1] - p[1] - d[1]).abs() < 0.1, "{p:?} -> {t:?}");
        }
    }
}
