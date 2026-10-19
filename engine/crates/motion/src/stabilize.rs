//! Video stabilisation and deflicker, classic and offline: the camera's motion between
//! consecutive frames is tracked once, its path is smoothed, and each frame gets the move, turn
//! and zoom that puts it on the smoothed path.
//!
//! - **Motion**: [`CameraTracker`] finds corners over the whole picture, follows them into the
//!   next frame with pyramidal Lucas–Kanade (checked by tracking back), and fits a similarity
//!   (shift, turn and uniform scale) to them with RANSAC, so people and cars moving in front of
//!   a still scene don't pull the estimate. Motions are about the picture's centre.
//! - **Path**: the motions are chained into the camera's path (shift, angle and log scale per
//!   frame) and each is smoothed with a Gaussian window whose width is the [`Level`]'s, with
//!   the ends reflected through their end points so a steady pan isn't pulled back at the start
//!   and finish.
//! - **Correction**: [`corrections`] is, for each frame, the shift and turn that takes where
//!   the frame's content is on the real path to where it is on the smoothed one (its scale is
//!   left alone, so a hand moving forward doesn't make the picture breathe), and the zoom that
//!   hides the borders that exposes. The zoom follows what each moment needs (the largest need
//!   within a second, smoothed) rather than the worst of the whole clip, and the Level's cap on
//!   it limits the correction (large ones squeezed smoothly towards what the cap pays for):
//!   Minimal cut crops least, Most stable corrects most.
//! - **Flicker**: [`deflicker_gains`] is each frame's brightness gain to its neighbours' moving
//!   average.

use crate::features::{good_features, CornerOptions};
use crate::fit::{ransac_similarity, Ransac, Similarity};
use crate::image::{Gray, Pyramid};
use crate::klt::Klt;

/// How far Stabilize smooths the path, and so how much it may crop.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Level {
    MinimalCut,
    Recommended,
    MostStable,
}

impl Level {
    /// The Gaussian window's standard deviation, seconds.
    pub fn sigma_seconds(self) -> f64 {
        match self {
            Level::MinimalCut => 0.35,
            Level::Recommended => 0.8,
            Level::MostStable => 1.6,
        }
    }

    /// The most the picture is zoomed to hide borders (1.1 is a tenth of each side's length
    /// cropped, at most).
    pub fn max_zoom(self) -> f64 {
        match self {
            Level::MinimalCut => 1.06,
            Level::Recommended => 1.14,
            Level::MostStable => 1.28,
        }
    }
}

/// A frame as the tracker sees it: its brightness and contrast evened out (a flickering
/// picture changes brightness between frames, which breaks the tracker's brightness constancy)
/// and a little blur so sensor noise isn't mistaken for texture.
fn prepared(g: &Gray) -> Gray {
    let n = g.data.len().max(1) as f32;
    let mean = g.data.iter().sum::<f32>() / n;
    let sd = (g.data.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / n).sqrt().max(0.02);
    let mut out = Gray { width: g.width, height: g.height, data: g.data.iter().map(|v| 0.5 + (v - mean) / sd * 0.2).collect() };
    out = out.blur(0.9);
    out
}

/// Follows the camera from frame to frame.
pub struct CameraTracker {
    previous: Pyramid,
    klt: Klt,
    corners: CornerOptions,
}

impl CameraTracker {
    /// Starts on the first frame.
    pub fn new(first: Gray) -> CameraTracker {
        CameraTracker {
            previous: Pyramid::new(prepared(&first), 4),
            klt: Klt { radius: 6, iterations: 20, ..Klt::default() },
            corners: CornerOptions { max_corners: 260, ..Default::default() },
        }
    }

    /// The motion from the previous frame into `next`, about the picture's centre (the point
    /// the previous frame has at p is at `motion(p)` in `next`), or `None` when the matches
    /// don't agree (a blank or blurred frame, a cut).
    pub fn step(&mut self, next: Gray) -> Option<Similarity> {
        let (w, h) = (next.width as f64, next.height as f64);
        let next = Pyramid::new(prepared(&next), 4);
        // Strict first; if the matches don't agree (noise, blur), once more with more slack.
        let result = self.motion_to(&next, w, h, 1.0, 1.5, 3).or_else(|| self.motion_to(&next, w, h, 2.5, 3.0, 6));
        self.previous = next;
        result
    }

    fn motion_to(&self, next: &Pyramid, w: f64, h: f64, back_check: f64, threshold: f64, ratio: usize) -> Option<Similarity> {
        let base = &self.previous.levels[0];
        let spacing = (w.min(h) / 28.0).max(6.0) as f32;
        let corners = good_features(&base.image, &base.gx, &base.gy, [0.0, 0.0, w as f32, h as f32], |_, _| true, &CornerOptions { min_distance: spacing, ..self.corners });
        if corners.len() < 8 {
            return None;
        }
        let from: Vec<[f32; 2]> = corners.iter().map(|c| [c.x, c.y]).collect();
        let forward = self.klt.track(&self.previous, next, &from, None);
        let found: Vec<[f32; 2]> = forward.iter().zip(&from).map(|(f, p)| f.map_or(*p, |t| t.point)).collect();
        let back = self.klt.track(next, &self.previous, &found, Some(&from));
        let (mut src, mut dst) = (Vec::new(), Vec::new());
        for i in 0..from.len() {
            let (Some(f), Some(b)) = (forward[i], back[i]) else { continue };
            if ((b.point[0] - from[i][0]) as f64).hypot((b.point[1] - from[i][1]) as f64) <= back_check {
                src.push([from[i][0] as f64 - w / 2.0, from[i][1] as f64 - h / 2.0]);
                dst.push([f.point[0] as f64 - w / 2.0, f.point[1] as f64 - h / 2.0]);
            }
        }
        if src.len() < 8 {
            return None;
        }
        let (fit, inliers) = ransac_similarity(&src, &dst, &Ransac { threshold, iterations: 150, ..Ransac::default() })?;
        let n = inliers.iter().filter(|&&b| b).count();
        // Few agreeing matches, or an absurd scale: not a camera move.
        (n >= 8 && n * ratio >= src.len() && (0.8..1.25).contains(&fit.scale())).then_some(fit)
    }
}

/// What one frame needs: the shift (as fractions of the picture's width and height) and turn
/// (radians, clockwise on screen) that move its content onto the smoothed path, and the zoom
/// (about the centre, at least 1) that hides the borders. The picture is turned, shifted and
/// then zoomed, so on screen the shift is `zoom` times `dx`.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Correction {
    pub dx: f64,
    pub dy: f64,
    pub rot: f64,
    pub zoom: f64,
}

impl Correction {
    pub const NONE: Correction = Correction { dx: 0.0, dy: 0.0, rot: 0.0, zoom: 1.0 };
}

/// The camera's path: frame `i`'s point p0 of the first frame is at `path[i](p0)`.
pub fn camera_path(motions: &[Similarity]) -> Vec<Similarity> {
    let mut out = Vec::with_capacity(motions.len() + 1);
    let mut c = Similarity::IDENTITY;
    out.push(c);
    for m in motions {
        c = m.after(&c);
        out.push(c);
    }
    out
}

/// Gaussian smoothing of `x`, its ends reflected through their end points.
fn smooth(x: &[f64], sigma: f64) -> Vec<f64> {
    let n = x.len();
    if n < 3 || sigma < 0.3 {
        return x.to_vec();
    }
    let radius = ((3.0 * sigma).ceil() as isize).max(1);
    let kernel: Vec<f64> = (-radius..=radius).map(|k| (-(k * k) as f64 / (2.0 * sigma * sigma)).exp()).collect();
    let total: f64 = kernel.iter().sum();
    let at = |i: isize| -> f64 {
        let last = n as isize - 1;
        if i < 0 {
            2.0 * x[0] - x[(-i).min(last) as usize]
        } else if i > last {
            2.0 * x[n - 1] - x[(2 * last - i).max(0) as usize]
        } else {
            x[i as usize]
        }
    };
    (0..n as isize).map(|i| kernel.iter().enumerate().map(|(k, w)| w * at(i + k as isize - radius)).sum::<f64>() / total).collect()
}

/// The largest value within `radius` of each index.
fn running_max(x: &[f64], radius: usize) -> Vec<f64> {
    (0..x.len()).map(|i| x[i.saturating_sub(radius)..(i + radius + 1).min(x.len())].iter().cloned().fold(f64::MIN, f64::max)).collect()
}

/// A frame's path point as (shift x, shift y, angle, ln scale), the angle unwrapped against
/// `previous`.
fn params(s: &Similarity, previous: f64) -> [f64; 4] {
    let mut a = s.rotation();
    while a - previous > std::f64::consts::PI {
        a -= 2.0 * std::f64::consts::PI;
    }
    while a - previous < -std::f64::consts::PI {
        a += 2.0 * std::f64::consts::PI;
    }
    [s.tx, s.ty, a, s.scale().ln()]
}

fn from_params(p: [f64; 4]) -> Similarity {
    let s = p[3].exp();
    Similarity { a: s * p[2].cos(), b: s * p[2].sin(), tx: p[0], ty: p[1] }
}

/// The zoom that hides the borders when the picture (`w`×`h`) is moved by `shift`, turned by
/// `rot` and zoomed, all about its centre (a point `u` of the frame goes to `z·(R·u + shift)`):
/// every corner of the original frame must land inside the moved one, which for a corner `c`
/// and an axis (with `a` the corner's and `b` the shift's coordinate along the turned frame's
/// axis, `half` its half-length) is `|a / z - b| <= half`.
fn zoom_needed(shift: [f64; 2], rot: f64, w: f64, h: f64) -> f64 {
    let (hw, hh) = (w / 2.0, h / 2.0);
    let (s, c) = rot.sin_cos();
    // Into the turned frame's axes.
    let back = |x: f64, y: f64| (c * x + s * y, -s * x + c * y);
    let (bx, by) = back(shift[0], shift[1]);
    let mut z: f64 = 1.0;
    for (cx, cy) in [(hw, hh), (hw, -hh), (-hw, hh), (-hw, -hh)] {
        let (ax, ay) = back(cx, cy);
        for (a, b, half) in [(ax, bx, hw), (ay, by, hh)] {
            let room = half - a.signum() * b;
            z = z.max(if room <= 1e-9 { f64::INFINITY } else { a.abs() / room });
        }
    }
    z
}

/// The correction for each of the `motions.len() + 1` frames: `motions[i]` takes frame `i` to
/// frame `i + 1` (see [`CameraTracker::step`]), the picture is `w`×`h` and the clip's frame
/// rate `fps`.
pub fn corrections(motions: &[Similarity], w: f64, h: f64, fps: f64, level: Level) -> Vec<Correction> {
    let path = camera_path(motions);
    let n = path.len();
    let mut raw: Vec<[f64; 4]> = Vec::with_capacity(n);
    for s in &path {
        let prev = raw.last().map_or(0.0, |p| p[2]);
        raw.push(params(s, prev));
    }
    let sigma = level.sigma_seconds() * fps.max(1.0);
    let smoothed: Vec<Vec<f64>> = (0..4).map(|k| smooth(&raw.iter().map(|p| p[k]).collect::<Vec<_>>(), sigma)).collect();
    // Where each frame's content goes: the smoothed path after the real one's inverse, with
    // its scale left out.
    let moves: Vec<(f64, f64, f64)> = (0..n)
        .map(|i| {
            let want = from_params([smoothed[0][i], smoothed[1][i], smoothed[2][i], smoothed[3][i]]);
            let k = want.after(&path[i].inverse());
            // About the centre: a rotation-scale part and a shift; keep the turn and the shift of
            // the centre point (the scale is dropped).
            (k.tx, k.ty, k.rotation())
        })
        .collect();
    let cap = level.max_zoom();
    // The correction the zoom budget can pay for: shifts and turns beyond it are squeezed
    // smoothly towards it (small ones pass untouched), then any frame still needing more than
    // the cap has its correction scaled down to fit.
    let (limit_x, limit_y, limit_r) = ((1.0 - 1.0 / cap) * w / 2.0 * 0.8, (1.0 - 1.0 / cap) * h / 2.0 * 0.8, (cap - 1.0) * 0.8);
    let soft = |v: f64, limit: f64| limit * (v / limit).tanh();
    let fitted: Vec<(f64, f64, f64)> = moves
        .iter()
        .map(|&(tx, ty, r)| {
            let (tx, ty, r) = (soft(tx, limit_x), soft(ty, limit_y), soft(r, limit_r));
            let fits = |k: f64| zoom_needed([tx * k, ty * k], r * k, w, h) <= cap;
            if fits(1.0) {
                return (tx, ty, r);
            }
            let (mut lo, mut hi) = (0.0, 1.0);
            for _ in 0..16 {
                let mid = (lo + hi) / 2.0;
                if fits(mid) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            (tx * lo, ty * lo, r * lo)
        })
        .collect();
    // The zoom follows what each moment needs: the largest need within a second, smoothed.
    let need: Vec<f64> = fitted.iter().map(|&(tx, ty, r)| zoom_needed([tx, ty], r, w, h)).collect();
    let fps = fps.max(1.0);
    let zoom: Vec<f64> = smooth(&running_max(&need, fps.round() as usize), 0.3 * fps).into_iter().map(|v| v.clamp(1.0, cap)).collect();
    fitted.iter().zip(zoom).map(|(&(tx, ty, r), zoom)| Correction { dx: tx / w, dy: ty / h, rot: r, zoom }).collect()
}

/// Each frame's brightness gain (its mean luma `luma[i]` brought to the mean of the frames
/// within `radius` of it, so a real fade is kept and a flicker isn't), kept within 0.7–1.4.
pub fn deflicker_gains(luma: &[f32], radius: usize) -> Vec<f32> {
    (0..luma.len())
        .map(|i| {
            let window = &luma[i.saturating_sub(radius)..(i + radius + 1).min(luma.len())];
            let mean = window.iter().sum::<f32>() / window.len() as f32;
            if luma[i] > 1e-4 {
                (mean / luma[i]).clamp(0.7, 1.4)
            } else {
                1.0
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fit::Rng;
    use crate::testing::texture;

    /// `base` seen with the camera at `shift` and `turn` (the scene moved by the inverse),
    /// as a `w`×`h` picture.
    fn view(base: &Gray, w: usize, h: usize, shift: [f64; 2], turn: f64) -> Gray {
        let mut out = Gray::new(w, h);
        let (s, c) = turn.sin_cos();
        let (cx, cy) = (w as f64 / 2.0, h as f64 / 2.0);
        let (ox, oy) = (base.width as f64 / 2.0, base.height as f64 / 2.0);
        for y in 0..h {
            for x in 0..w {
                // Output pixel back to the scene.
                let (dx, dy) = (x as f64 - cx - shift[0], y as f64 - cy - shift[1]);
                let (u, v) = (c * dx + s * dy, -s * dx + c * dy);
                out.data[y * w + x] = base.sample((u + ox) as f32, (v + oy) as f32);
            }
        }
        out
    }

    /// A camera shaking about a drifting centre: frames, and the true shake of each.
    fn shaky(frames: usize) -> (Vec<Gray>, Vec<[f64; 2]>) {
        let mut rng = Rng(7);
        let base = texture(&mut rng, 420, 320, 2.0);
        let (mut out, mut truth) = (Vec::new(), Vec::new());
        for i in 0..frames {
            // A slow drift plus jitter.
            let jitter = [(rng.unit() - 0.5) * 8.0, (rng.unit() - 0.5) * 8.0];
            let (x, y) = (0.2 * i as f64 + jitter[0], 0.1 * i as f64 + jitter[1]);
            truth.push([x, y]);
            out.push(view(&base, 320, 240, [x, y], 0.0));
        }
        (out, truth)
    }

    fn track(frames: &[Gray]) -> Vec<Similarity> {
        let mut t = CameraTracker::new(frames[0].clone());
        frames[1..].iter().map(|f| t.step(f.clone()).unwrap_or(Similarity::IDENTITY)).collect()
    }

    #[test]
    fn camera_motion_is_found() {
        let (frames, truth) = shaky(6);
        let motions = track(&frames);
        for (i, m) in motions.iter().enumerate() {
            // The scene moves the way the camera view's shift changes.
            let want = [truth[i + 1][0] - truth[i][0], truth[i + 1][1] - truth[i][1]];
            assert!((m.tx - want[0]).abs() < 0.3 && (m.ty - want[1]).abs() < 0.3, "frame {i}: got ({:.2}, {:.2}), want ({:.2}, {:.2})", m.tx, m.ty, want[0], want[1]);
        }
    }

    /// Frame-to-frame jitter of where the content sits after the corrections (the residual
    /// shake), against before them.
    #[test]
    fn stabilising_leaves_less_shake() {
        let (frames, truth) = shaky(90);
        let motions = track(&frames);
        let fixes = corrections(&motions, 320.0, 240.0, 30.0, Level::Recommended);
        assert_eq!(fixes.len(), frames.len());
        let rms = |p: &[[f64; 2]]| (p.windows(2).map(|w| (w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sum::<f64>() / (p.len() - 1) as f64).sqrt();
        // Where the content sits on screen: the camera's shift is the scene's opposite, and the
        // correction moves the content on top.
        let after: Vec<[f64; 2]> = truth.iter().zip(&fixes).map(|(t, f)| [t[0] + f.dx * 320.0 * f.zoom, t[1] + f.dy * 240.0 * f.zoom]).collect();
        let (before_rms, after_rms) = (rms(&truth), rms(&after));
        assert!(after_rms < before_rms * 0.35, "residual {after_rms:.2} px/frame against {before_rms:.2}");
        assert!(fixes.iter().all(|f| f.zoom >= 1.0 && f.zoom <= Level::Recommended.max_zoom() + 1e-6));
    }

    #[test]
    fn levels_trade_cropping_for_steadiness() {
        let (frames, truth) = shaky(90);
        let motions = track(&frames);
        let rms = |level: Level| {
            let fixes = corrections(&motions, 320.0, 240.0, 30.0, level);
            let p: Vec<[f64; 2]> = truth.iter().zip(&fixes).map(|(t, f)| [t[0] + f.dx * 320.0 * f.zoom, t[1] + f.dy * 240.0 * f.zoom]).collect();
            let zoom = fixes.iter().map(|f| f.zoom).fold(1.0, f64::max);
            ((p.windows(2).map(|w| (w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sum::<f64>() / 89.0).sqrt(), zoom)
        };
        let (min_shake, min_zoom) = rms(Level::MinimalCut);
        let (most_shake, most_zoom) = rms(Level::MostStable);
        assert!(min_zoom <= Level::MinimalCut.max_zoom() + 1e-6 && most_zoom <= Level::MostStable.max_zoom() + 1e-6);
        assert!(min_zoom < most_zoom, "zoom {min_zoom:.3} vs {most_zoom:.3}");
        assert!(most_shake <= min_shake + 0.05, "shake {most_shake:.2} vs {min_shake:.2}");
    }

    #[test]
    fn a_steady_camera_is_left_alone() {
        let fixes = corrections(&vec![Similarity::IDENTITY; 60], 320.0, 240.0, 30.0, Level::MostStable);
        assert!(fixes.iter().all(|f| f.dx.abs() < 1e-9 && f.dy.abs() < 1e-9 && f.rot.abs() < 1e-9 && (f.zoom - 1.0).abs() < 1e-9));
    }

    #[test]
    fn a_steady_pan_is_followed_not_fought() {
        // 1 px per frame to the right: the path is a straight line, so smoothing it changes
        // nothing, even at the ends.
        let pan = Similarity { a: 1.0, b: 0.0, tx: 1.0, ty: 0.0 };
        let fixes = corrections(&vec![pan; 120], 320.0, 240.0, 30.0, Level::MostStable);
        assert!(fixes.iter().all(|f| (f.dx * 320.0).abs() < 0.05 && (f.zoom - 1.0).abs() < 1e-3), "{:?}", fixes.iter().map(|f| f.dx * 320.0).fold(0.0, |a: f64, b| a.max(b.abs())));
    }

    #[test]
    fn flicker_is_pulled_to_the_moving_average() {
        // A steady scene whose every other frame is brighter, then a real fade.
        let luma: Vec<f32> = (0..40).map(|i| if i % 2 == 0 { 0.5 } else { 0.6 }).collect();
        let gains = deflicker_gains(&luma, 4);
        let fixed: Vec<f32> = luma.iter().zip(&gains).map(|(l, g)| l * g).collect();
        let spread = |v: &[f32]| v[6..34].windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f32>() / 27.0;
        assert!(spread(&fixed) < spread(&luma) * 0.25, "{} vs {}", spread(&fixed), spread(&luma));
        let fade: Vec<f32> = (0..40).map(|i| 0.8 - 0.01 * i as f32).collect();
        let kept: Vec<f32> = fade.iter().zip(deflicker_gains(&fade, 4)).map(|(l, g)| l * g).collect();
        assert!(kept[10..30].iter().zip(&fade[10..30]).all(|(a, b)| (a - b).abs() < 0.002));
    }
}
