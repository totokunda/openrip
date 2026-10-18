//! Dense optical flow and motion-compensated frame interpolation, on the CPU.
//!
//! This is the reference for the GPU version the compositor runs (`openrip-render`'s
//! `flow.wgsl`), pass for pass, and what the tests measure:
//!
//! - **Flow** is pyramidal dense Lucas–Kanade with iterative warping, made robust. At each
//!   level, coarse to fine, every pixel first takes whichever of its own and its neighbours'
//!   vectors makes a small patch match best (so a motion boundary the coarser level blurred
//!   snaps back into place). Then each Gauss–Newton step compares the pixel's 7×7 window, moved
//!   by its vector, with the second picture there, weighting window pixels by a Gaussian and
//!   down as their brightness difference grows: pixels that move otherwise (the background at
//!   an object's edge) hardly pull the estimate. Steps are regularised toward no change where
//!   the window has little texture or only an edge, and clamped to a pixel. A last selection
//!   among immediate neighbours and a 3×3 median clean up before the flow doubles for the next
//!   level.
//! - **Interpolation** at time t between pictures A and B uses the flow both ways. A pixel of
//!   the in-between picture finds the motion through it by fixed-point iteration (the flow at
//!   the point it came from), from each flow; the candidate whose two ends agree better wins.
//!   Each end is weighted by t and by whether the other end can see it (the forward–backward
//!   check there), so a region uncovered between the frames comes from the frame that shows it.

use crate::image::{Gray, Pyramid};

/// The dense flow's settings.
#[derive(Copy, Clone, Debug)]
pub struct FlowOptions {
    pub levels: usize,
    /// Gauss–Newton steps per level.
    pub iterations: usize,
    /// The window's Gaussian standard deviation, pixels at each level.
    pub sigma: f32,
    /// Regularisation of each step: this much (squared intensity per pixel², intensities 0–1)
    /// plus `relative` × the window's gradient energy, added to the structure tensor's
    /// diagonal. The relative part keeps edges (one strong direction) from sliding along
    /// themselves at every level, whatever its contrast.
    pub lambda: f32,
    pub relative: f32,
    /// Intensity difference (0–1) at which a window pixel counts half (0: all count fully).
    pub robust: f32,
    /// Neighbours this many pixels away offer their vectors before each level's refinement
    /// (0: none).
    pub select_radius: usize,
}

impl Default for FlowOptions {
    fn default() -> Self {
        FlowOptions { levels: 6, iterations: 5, sigma: 2.0, lambda: 1e-8, relative: 0.02, robust: 0.05, select_radius: 2 }
    }
}

/// Per pixel of the first picture, where it moved in the second (pixels).
#[derive(Clone, Debug, PartialEq)]
pub struct Flow {
    pub width: usize,
    pub height: usize,
    pub u: Vec<f32>,
    pub v: Vec<f32>,
}

impl Flow {
    pub fn zero(width: usize, height: usize) -> Flow {
        Flow { width, height, u: vec![0.0; width * height], v: vec![0.0; width * height] }
    }

    /// Bilinear read at (x, y), clamped.
    pub fn sample(&self, x: f32, y: f32) -> [f32; 2] {
        let x = x.clamp(0.0, (self.width - 1) as f32);
        let y = y.clamp(0.0, (self.height - 1) as f32);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(self.width - 1), (y0 + 1).min(self.height - 1));
        let (fx, fy) = (x - x0 as f32, y - y0 as f32);
        let read = |c: &[f32]| {
            let top = c[y0 * self.width + x0] * (1.0 - fx) + c[y0 * self.width + x1] * fx;
            let bottom = c[y1 * self.width + x0] * (1.0 - fx) + c[y1 * self.width + x1] * fx;
            top * (1.0 - fy) + bottom * fy
        };
        [read(&self.u), read(&self.v)]
    }

    /// Resampled to `width`×`height`, its vectors scaled with it.
    pub fn resized(&self, width: usize, height: usize) -> Flow {
        let (kx, ky) = (width as f32 / self.width as f32, height as f32 / self.height as f32);
        let mut out = Flow::zero(width, height);
        for y in 0..height {
            for x in 0..width {
                // Pixel centres line up: x' + 0.5 = (x + 0.5)·k.
                let f = self.sample((x as f32 + 0.5) / kx - 0.5, (y as f32 + 0.5) / ky - 0.5);
                out.u[y * width + x] = f[0] * kx;
                out.v[y * width + x] = f[1] * ky;
            }
        }
        out
    }

    /// The next finer pyramid level's flow: its pixel (x, y) sits at (x/2, y/2) here (see
    /// [`Gray::half`]), and the vectors double.
    pub fn upsampled(&self, width: usize, height: usize) -> Flow {
        let mut out = Flow::zero(width, height);
        for y in 0..height {
            for x in 0..width {
                let f = self.sample(x as f32 / 2.0, y as f32 / 2.0);
                out.u[y * width + x] = 2.0 * f[0];
                out.v[y * width + x] = 2.0 * f[1];
            }
        }
        out
    }

    fn median3(&self) -> Flow {
        let mut out = self.clone();
        let (w, h) = (self.width as isize, self.height as isize);
        for y in 0..h {
            for x in 0..w {
                let mut us = [0.0f32; 9];
                let mut vs = [0.0f32; 9];
                let mut n = 0;
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        let i = ((y + dy).clamp(0, h - 1) * w + (x + dx).clamp(0, w - 1)) as usize;
                        us[n] = self.u[i];
                        vs[n] = self.v[i];
                        n += 1;
                    }
                }
                us.sort_by(f32::total_cmp);
                vs.sort_by(f32::total_cmp);
                out.u[(y * w + x) as usize] = us[4];
                out.v[(y * w + x) as usize] = vs[4];
            }
        }
        out
    }
}

/// The flow from `a` to `b` (same size).
pub fn dense_flow(a: &Gray, b: &Gray, o: &FlowOptions) -> Flow {
    let pa = Pyramid::new(a.clone(), o.levels);
    let pb = Pyramid::new(b.clone(), o.levels);
    let levels = pa.levels.len().min(pb.levels.len());
    let mut flow: Option<Flow> = None;
    for level in (0..levels).rev() {
        let (la, lb) = (&pa.levels[level], &pb.levels[level].image);
        let (w, h) = (la.image.width, la.image.height);
        let f = match flow.take() {
            Some(coarse) => coarse.upsampled(w, h),
            None => Flow::zero(w, h),
        };
        // Each pixel takes the neighbour's vector that matches best (so a motion boundary
        // the coarser level blurred snaps back to its place), then Gauss–Newton refines it.
        let mut f = if o.select_radius > 0 { select(&f, &la.image, lb, o.select_radius as isize) } else { f };
        for _ in 0..o.iterations {
            f = lucas_kanade_step(&f, la, lb, o);
        }
        if o.select_radius > 0 {
            f = select(&f, &la.image, lb, 1);
        }
        flow = Some(f.median3());
    }
    flow.unwrap_or_else(|| Flow::zero(a.width, a.height))
}

/// The window: (2·`WINDOW` + 1)² pixels around each pixel, Gaussian-weighted.
pub const WINDOW: isize = 3;

/// One Gauss–Newton step for every pixel's vector: the pixel's window, moved by its vector,
/// compared with the second picture there. Each window pixel is weighted by the Gaussian and
/// down as its brightness difference grows (a robust Lucas–Kanade: pixels moving otherwise,
/// across an edge of the object, count less).
pub fn lucas_kanade_step(f: &Flow, la: &crate::image::Level, lb: &Gray, o: &FlowOptions) -> Flow {
    let (w, h) = (f.width as isize, f.height as isize);
    let gauss: Vec<f32> = (-WINDOW..=WINDOW).map(|d| (-((d * d) as f32) / (2.0 * o.sigma * o.sigma)).exp()).collect();
    let mut out = f.clone();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) as usize;
            let (u, v) = (f.u[i], f.v[i]);
            let mut s = [0.0f32; 5];
            for dy in -WINDOW..=WINDOW {
                for dx in -WINDOW..=WINDOW {
                    let (px, py) = ((x + dx).clamp(0, w - 1), (y + dy).clamp(0, h - 1));
                    let j = (py * w + px) as usize;
                    let it = lb.sample(px as f32 + u, py as f32 + v) - la.image.data[j];
                    let wt = gauss[(dx + WINDOW) as usize] * gauss[(dy + WINDOW) as usize] * robust_weight(it, o.robust);
                    let (gx, gy) = (la.gx.data[j], la.gy.data[j]);
                    s[0] += wt * gx * gx;
                    s[1] += wt * gx * gy;
                    s[2] += wt * gy * gy;
                    s[3] += wt * gx * it;
                    s[4] += wt * gy * it;
                }
            }
            let norm: f32 = gauss.iter().sum::<f32>().powi(2);
            let du = solve_step([s[0] / norm, s[1] / norm, s[2] / norm], [s[3] / norm, s[4] / norm], o);
            out.u[i] = u + du[0];
            out.v[i] = v + du[1];
        }
    }
    out
}

/// Pixels of intensity difference (0–1) at which a window pixel counts half.
pub fn robust_weight(diff: f32, scale: f32) -> f32 {
    if scale <= 0.0 {
        return 1.0;
    }
    1.0 / (1.0 + (diff / scale) * (diff / scale))
}

/// The regularised Gauss–Newton step from the window's structure tensor (xx, xy, yy) and its
/// gradient-weighted difference, at most `MAX_STEP` pixels.
pub fn solve_step(g: [f32; 3], b: [f32; 2], o: &FlowOptions) -> [f32; 2] {
    let damp = o.lambda + o.relative * (g[0] + g[2]);
    let (a11, a12, a22) = (g[0] + damp, g[1], g[2] + damp);
    let det = a11 * a22 - a12 * a12;
    if det <= 1e-20 {
        return [0.0, 0.0];
    }
    let du = [-(a22 * b[0] - a12 * b[1]) / det, -(a11 * b[1] - a12 * b[0]) / det];
    let len = du[0].hypot(du[1]);
    if len > MAX_STEP {
        [du[0] * MAX_STEP / len, du[1] * MAX_STEP / len]
    } else {
        du
    }
}

/// The most one Gauss–Newton step moves a vector (pixels at its level): beyond the
/// linearisation's reach, a bigger step is noise, and clamping it keeps pixels whose match
/// left the picture from running away.
pub const MAX_STEP: f32 = 1.0;

/// Offsets (in units of the radius) of the candidates [`select`] tries, and of the taps of its
/// matching cost (pixels): the pixel itself and its eight neighbours.
pub const NEIGHBOURS: [[isize; 2]; 9] = [[0, 0], [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/// Each pixel's vector replaced by the one among its own and its neighbours' (`radius` pixels
/// away) under which a small patch around it matches best.
pub fn select(f: &Flow, a: &Gray, b: &Gray, radius: isize) -> Flow {
    let (w, h) = (f.width as isize, f.height as isize);
    let mut out = f.clone();
    for y in 0..h {
        for x in 0..w {
            let mut best = (f32::MAX, 0.0f32, 0.0f32);
            for c in NEIGHBOURS {
                let j = ((y + c[1] * radius).clamp(0, h - 1) * w + (x + c[0] * radius).clamp(0, w - 1)) as usize;
                let (u, v) = (f.u[j], f.v[j]);
                let mut cost = 0.0f32;
                for p in NEIGHBOURS {
                    let (px, py) = ((x + 2 * p[0]) as f32, (y + 2 * p[1]) as f32);
                    cost += (b.sample(px + u, py + v) - a.sample(px, py)).abs();
                }
                if cost < best.0 {
                    best = (cost, u, v);
                }
            }
            let i = (y * w + x) as usize;
            out.u[i] = best.1;
            out.v[i] = best.2;
        }
    }
    out
}

/// The pictures' straight cross-fade at `t` (what "frame blending" shows).
pub fn blend(a: &Gray, b: &Gray, t: f32) -> Gray {
    Gray { width: a.width, height: a.height, data: a.data.iter().zip(&b.data).map(|(x, y)| x + (y - x) * t).collect() }
}

/// Fixed-point iterations finding the motion through a pixel of the in-between picture.
pub const FIXED_POINT_STEPS: usize = 4;
/// Forward–backward disagreement (pixels of the flow) at which an end counts half visible.
pub const OCCLUSION_PIXELS: f32 = 1.0;

/// The picture at `t` (0 = `a`, 1 = `b`) between `a` and `b`, given the flow from `a` to `b`
/// (`ab`) and back (`ba`), at the pictures' size.
pub fn interpolate(a: &Gray, b: &Gray, ab: &Flow, ba: &Flow, t: f32) -> Gray {
    let mut out = Gray::new(a.width, a.height);
    for y in 0..a.height {
        for x in 0..a.width {
            let (px, py) = (x as f32, y as f32);
            let ends = interpolation_ends(ab, ba, px, py, t, |p, q| (a.sample(p[0], p[1]) - b.sample(q[0], q[1])).abs());
            let (pa, pb, wa, wb) = ends;
            out.data[y * a.width + x] = (wa * a.sample(pa[0], pa[1]) + wb * b.sample(pb[0], pb[1])) / (wa + wb);
        }
    }
    out
}

/// For a pixel (x, y) of the picture at `t`: where to read the first and second picture, and
/// the weight of each. `mismatch(p, q)` is how different the pictures are at p in the first
/// and q in the second.
pub fn interpolation_ends(ab: &Flow, ba: &Flow, x: f32, y: f32, t: f32, mismatch: impl Fn([f32; 2], [f32; 2]) -> f32) -> ([f32; 2], [f32; 2], f32, f32) {
    // The motion through (x, y) from a to b, found from the forward flow: m = ab(x − t·m) ...
    let mut m = ab.sample(x, y);
    for _ in 0..FIXED_POINT_STEPS {
        m = ab.sample(x - t * m[0], y - t * m[1]);
    }
    // ... and from the backward flow: the motion from b to a is n = ba(x − (1 − t)·n).
    let mut n = ba.sample(x, y);
    for _ in 0..FIXED_POINT_STEPS {
        n = ba.sample(x - (1.0 - t) * n[0], y - (1.0 - t) * n[1]);
    }
    let candidates = [m, [-n[0], -n[1]]];
    let ends = |m: [f32; 2]| ([x - t * m[0], y - t * m[1]], [x + (1.0 - t) * m[0], y + (1.0 - t) * m[1]]);
    let costs = candidates.map(|c| {
        let (p, q) = ends(c);
        mismatch(p, q)
    });
    let best = if costs[1] < costs[0] { candidates[1] } else { candidates[0] };
    let (p, q) = ends(best);
    // Visibility: the first picture's sample is trusted as far as the second picture's point
    // maps back and forth consistently, and the other way round.
    let disagree = |f: &Flow, g: &Flow, at: [f32; 2]| {
        let d = f.sample(at[0], at[1]);
        let back = g.sample(at[0] + d[0], at[1] + d[1]);
        (d[0] + back[0]).hypot(d[1] + back[1])
    };
    let seen = |e: f32| 1.0 / (1.0 + (e / OCCLUSION_PIXELS).powi(2));
    let (q_seen_in_a, p_seen_in_b) = (seen(disagree(ba, ab, q)), seen(disagree(ab, ba, p)));
    let (mut wa, mut wb) = ((1.0 - t) * q_seen_in_a, t * p_seen_in_b);
    if wa + wb < 1e-3 {
        (wa, wb) = (1.0 - t, t);
    }
    (p, q, wa, wb)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{psnr, render_square, texture, Rng};

    fn scene(k: f64) -> Gray {
        let mut rng = Rng(21);
        let background = texture(&mut rng, 240, 180, 2.5);
        let object = texture(&mut rng, 80, 80, 2.0);
        // 9 px a frame to the right and 4 down, turning 2° a frame, over a still background.
        render_square(&background, &object, 240, 180, [90.0 + 9.0 * k, 80.0 + 4.0 * k], 70.0, (2.0 * k).to_radians())
    }

    #[test]
    fn flow_finds_the_motion_of_a_textured_square() {
        let (a, b) = (scene(0.0), scene(1.0));
        let f = dense_flow(&a, &b, &FlowOptions::default());
        // Inside the square (away from its edges) the flow is the square's motion there; on the
        // background, none.
        let at = |x: usize, y: usize| [f.u[y * 240 + x], f.v[y * 240 + x]];
        let inside = at(90, 80);
        assert!((inside[0] - 9.0).abs() < 0.3 && (inside[1] - 4.0).abs() < 0.3, "{inside:?}");
        let outside = at(200, 150);
        assert!(outside[0].abs() < 0.2 && outside[1].abs() < 0.2, "{outside:?}");
    }

    #[test]
    fn interpolation_beats_blending_on_a_held_out_middle_frame() {
        // Frames 0 and 2; frame 1 held out.
        let (a, mid, b) = (scene(0.0), scene(1.0), scene(2.0));
        let o = FlowOptions::default();
        let (ab, ba) = (dense_flow(&a, &b, &o), dense_flow(&b, &a, &o));
        let tween = interpolate(&a, &b, &ab, &ba, 0.5);
        let blended = blend(&a, &b, 0.5);
        let (pf, pb) = (psnr(&tween.data, &mid.data), psnr(&blended.data, &mid.data));
        eprintln!("held-out middle frame: flow {pf:.2} dB, blend {pb:.2} dB");
        assert!(pf > pb + 5.0 && pf > 30.0, "flow {pf:.2} dB, blend {pb:.2} dB");
    }
}
