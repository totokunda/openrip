//! Corners worth tracking (Shi and Tomasi's "good features to track"): points whose
//! neighbourhood has strong gradients in two directions, so a small window around them can be
//! found again in the next frame.

use crate::image::Gray;

#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Corner {
    pub x: f32,
    pub y: f32,
    /// The smaller eigenvalue of the window's structure tensor (mean per pixel).
    pub score: f32,
}

/// How to pick corners.
#[derive(Copy, Clone, Debug)]
pub struct CornerOptions {
    pub max_corners: usize,
    /// A corner must score at least this fraction of the best one.
    pub quality: f32,
    /// ... and at least this absolute score (mean per pixel, intensities 0–1), so flat or
    /// noise-only areas give none.
    pub min_score: f32,
    /// Corners are at least this many pixels apart.
    pub min_distance: f32,
    /// The structure tensor's window: (2r + 1)² pixels.
    pub radius: usize,
}

impl Default for CornerOptions {
    fn default() -> Self {
        CornerOptions { max_corners: 200, quality: 0.01, min_score: 2e-5, min_distance: 5.0, radius: 2 }
    }
}

/// The best corners of `img` (with its derivatives `gx`, `gy`) inside the box `area`
/// (x0, y0, x1, y1 in pixels) where `keep` also holds, strongest first.
pub fn good_features(img: &Gray, gx: &Gray, gy: &Gray, area: [f32; 4], keep: impl Fn(f32, f32) -> bool, o: &CornerOptions) -> Vec<Corner> {
    let r = o.radius as isize;
    let margin = (r + 2) as f32;
    let x0 = area[0].max(margin).floor() as isize;
    let y0 = area[1].max(margin).floor() as isize;
    let x1 = area[2].min(img.width as f32 - 1.0 - margin).ceil() as isize;
    let y1 = area[3].min(img.height as f32 - 1.0 - margin).ceil() as isize;
    if x1 <= x0 || y1 <= y0 {
        return Vec::new();
    }
    let (w, h) = ((x1 - x0 + 1) as usize, (y1 - y0 + 1) as usize);
    // Minimum eigenvalue at each pixel of the box.
    let n = ((2 * r + 1) * (2 * r + 1)) as f32;
    let mut score = vec![0.0f32; w * h];
    for y in 0..h as isize {
        for x in 0..w as isize {
            let (cx, cy) = (x0 + x, y0 + y);
            let (mut a, mut b, mut c) = (0.0f32, 0.0f32, 0.0f32);
            for dy in -r..=r {
                for dx in -r..=r {
                    let (ix, iy) = (gx.at(cx + dx, cy + dy), gy.at(cx + dx, cy + dy));
                    a += ix * ix;
                    b += ix * iy;
                    c += iy * iy;
                }
            }
            let (a, b, c) = (a / n, b / n, c / n);
            score[y as usize * w + x as usize] = 0.5 * (a + c - ((a - c) * (a - c) + 4.0 * b * b).sqrt());
        }
    }
    let best = score.iter().copied().fold(0.0f32, f32::max);
    let floor = (best * o.quality).max(o.min_score);
    // Local maxima over 3×3 above the floor, strongest first.
    let mut candidates = Vec::new();
    for y in 1..h.saturating_sub(1) {
        for x in 1..w.saturating_sub(1) {
            let s = score[y * w + x];
            if s < floor {
                continue;
            }
            let is_max = (-1isize..=1).all(|dy| (-1isize..=1).all(|dx| (dx == 0 && dy == 0) || score[(y as isize + dy) as usize * w + (x as isize + dx) as usize] <= s));
            let (px, py) = ((x0 + x as isize) as f32, (y0 + y as isize) as f32);
            if is_max && keep(px, py) {
                candidates.push(Corner { x: px, y: py, score: s });
            }
        }
    }
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    // Greedy minimum distance, on a coarse grid of the corners kept.
    let cell = o.min_distance.max(1.0);
    let (gw, gh) = ((w as f32 / cell).ceil() as usize + 1, (h as f32 / cell).ceil() as usize + 1);
    let mut grid: Vec<Vec<(f32, f32)>> = vec![Vec::new(); gw * gh];
    let mut out = Vec::new();
    for c in candidates {
        if out.len() >= o.max_corners {
            break;
        }
        let (gx_, gy_) = (((c.x - x0 as f32) / cell) as isize, ((c.y - y0 as f32) / cell) as isize);
        let near = (-1..=1).any(|dy| {
            (-1..=1).any(|dx| {
                let (cx, cy) = (gx_ + dx, gy_ + dy);
                cx >= 0 && cy >= 0 && (cx as usize) < gw && (cy as usize) < gh && grid[cy as usize * gw + cx as usize].iter().any(|&(x, y)| (x - c.x).powi(2) + (y - c.y).powi(2) < cell * cell)
            })
        });
        if !near {
            grid[gy_ as usize * gw + gx_ as usize].push((c.x, c.y));
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_square_has_four_corners_and_a_flat_image_none() {
        let mut img = Gray::new(64, 64);
        for y in 20..44 {
            for x in 20..44 {
                img.data[y * 64 + x] = 1.0;
            }
        }
        let (gx, gy) = img.gradients();
        let corners = good_features(&img, &gx, &gy, [0.0, 0.0, 64.0, 64.0], |_, _| true, &CornerOptions { max_corners: 10, quality: 0.3, ..Default::default() });
        assert_eq!(corners.len(), 4, "{corners:?}");
        for c in &corners {
            assert!([19.0, 20.0, 43.0, 44.0].iter().any(|v| (c.x - v).abs() <= 1.5) && [19.0, 20.0, 43.0, 44.0].iter().any(|v| (c.y - v).abs() <= 1.5), "{c:?}");
        }
        let flat = Gray::new(64, 64);
        let (fx, fy) = flat.gradients();
        assert!(good_features(&flat, &fx, &fy, [0.0, 0.0, 64.0, 64.0], |_, _| true, &CornerOptions::default()).is_empty());
    }
}
