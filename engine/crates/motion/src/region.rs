//! Following a region of a video from frame to frame (what an editor's motion tracking does):
//! corners inside the region are tracked with pyramidal Lucas–Kanade, matches that fail a
//! forward–backward check are dropped, and a similarity transform (position, scale and
//! rotation) is fitted to the rest with RANSAC. The region's transform is fitted to where its
//! points started where that fit is consistent (so it doesn't drift), else built up frame by
//! frame (an object that deforms). New corners are found when too few are left, and tracking
//! is reported lost when the points stop agreeing or the region leaves the picture.

use crate::features::{good_features, CornerOptions};
use crate::fit::{fit_similarity, ransac_similarity, Ransac, Similarity};
use crate::image::{Gray, Pyramid};
use crate::klt::Klt;

/// A rotated rectangle in image pixels.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Region {
    pub center: [f64; 2],
    /// Width and height.
    pub size: [f64; 2],
    /// Radians, clockwise on screen (y down).
    pub rotation: f64,
}

impl Region {
    /// Whether `p` lies inside, shrunk by `inset` pixels on each side.
    pub fn contains(&self, p: [f64; 2], inset: f64) -> bool {
        let (s, c) = self.rotation.sin_cos();
        let (dx, dy) = (p[0] - self.center[0], p[1] - self.center[1]);
        let (u, v) = (c * dx + s * dy, -s * dx + c * dy);
        u.abs() <= self.size[0] / 2.0 - inset && v.abs() <= self.size[1] / 2.0 - inset
    }

    /// The axis-aligned box around it: x0, y0, x1, y1.
    pub fn bounds(&self) -> [f64; 4] {
        let (s, c) = self.rotation.sin_cos();
        let (hw, hh) = (self.size[0] / 2.0, self.size[1] / 2.0);
        let ex = (c * hw).abs() + (s * hh).abs();
        let ey = (s * hw).abs() + (c * hh).abs();
        [self.center[0] - ex, self.center[1] - ey, self.center[0] + ex, self.center[1] + ey]
    }

    /// The region moved by `t` (from where it started).
    pub fn moved(&self, t: &Similarity) -> Region {
        Region { center: t.apply(self.center), size: [self.size[0] * t.scale(), self.size[1] * t.scale()], rotation: self.rotation + t.rotation() }
    }
}

/// How to track a region.
#[derive(Copy, Clone, Debug)]
pub struct TrackerOptions {
    pub klt: Klt,
    pub levels: usize,
    pub corners: CornerOptions,
    /// Corners kept tracking; new ones are found when fewer than `refill` × this are left.
    pub max_points: usize,
    pub refill: f64,
    /// A point whose track back from the new frame lands further than this (pixels) from
    /// where it started is dropped.
    pub forward_backward: f64,
    /// RANSAC's inlier distance, pixels (and at least `inlier_fraction` of the region's
    /// smaller side).
    pub inlier_pixels: f64,
    pub inlier_fraction: f64,
    /// Fewer inliers than this, or less than `min_ratio` of the points tracked, is lost.
    pub min_points: usize,
    pub min_ratio: f64,
}

impl Default for TrackerOptions {
    fn default() -> Self {
        TrackerOptions {
            klt: Klt::default(),
            levels: 4,
            corners: CornerOptions { max_corners: 160, min_distance: 4.0, ..Default::default() },
            max_points: 160,
            refill: 0.5,
            forward_backward: 1.0,
            inlier_pixels: 2.0,
            inlier_fraction: 0.02,
            min_points: 5,
            min_ratio: 0.25,
        }
    }
}

/// Where the region is in a frame.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Step {
    /// From the region where it started to here.
    pub transform: Similarity,
    pub region: Region,
    /// Points that agreed with the transform.
    pub inliers: usize,
    /// 0–1: how sure the step is (the share of points that agreed, and how many there were).
    pub confidence: f64,
    /// Tracking was lost: `transform` is the last good one.
    pub lost: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum TrackError {
    /// The region has too little texture to track (a flat area, or too small).
    NoFeatures,
}

impl std::fmt::Display for TrackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TrackError::NoFeatures => write!(f, "the region has no detail to track"),
        }
    }
}

impl std::error::Error for TrackError {}

/// One tracked corner: where it is now, and where it was in the first frame's coordinates
/// (its current position taken back through the region's transform when it was found).
#[derive(Copy, Clone, Debug)]
struct Point {
    now: [f64; 2],
    origin: [f64; 2],
}

/// Follows a region through frames given one at a time (forward or backward in time).
pub struct RegionTracker {
    options: TrackerOptions,
    start: Region,
    points: Vec<Point>,
    previous: Pyramid,
    transform: Similarity,
    /// The last frame-to-frame motion, to predict the next.
    velocity: Similarity,
    lost: bool,
}

impl RegionTracker {
    /// Start on `region` of `first`.
    pub fn new(first: Gray, region: Region, options: TrackerOptions) -> Result<RegionTracker, TrackError> {
        let previous = Pyramid::new(first, options.levels);
        let points = find_points(&previous, &region, &Similarity::IDENTITY, &[], &options);
        if points.len() < options.min_points.max(3) {
            return Err(TrackError::NoFeatures);
        }
        Ok(RegionTracker { options, start: region, points, previous, transform: Similarity::IDENTITY, velocity: Similarity::IDENTITY, lost: false })
    }

    /// The region where tracking started.
    pub fn start(&self) -> Region {
        self.start
    }

    /// Corners being tracked.
    pub fn points(&self) -> Vec<[f64; 2]> {
        self.points.iter().map(|p| p.now).collect()
    }

    /// Track into the next frame.
    pub fn step(&mut self, next: Gray) -> Step {
        let o = self.options;
        let next = Pyramid::new(next, o.levels);
        if self.lost {
            self.previous = next;
            return self.report(0, 0.0);
        }
        let region_now = self.start.moved(&self.transform);
        let threshold = o.inlier_pixels.max(o.inlier_fraction * region_now.size[0].min(region_now.size[1]));
        // Forward from the predicted positions, then back to check.
        let from: Vec<[f32; 2]> = self.points.iter().map(|p| [p.now[0] as f32, p.now[1] as f32]).collect();
        let guess: Vec<[f32; 2]> = self.points.iter().map(|p| self.velocity.apply(p.now)).map(|q| [q[0] as f32, q[1] as f32]).collect();
        let forward = o.klt.track(&self.previous, &next, &from, Some(&guess));
        let found: Vec<[f32; 2]> = forward.iter().zip(&from).map(|(f, p)| f.map_or(*p, |t| t.point)).collect();
        let back = o.klt.track(&next, &self.previous, &found, Some(&from));
        let mut kept: Vec<(Point, [f64; 2])> = Vec::new();
        for i in 0..self.points.len() {
            let (Some(f), Some(b)) = (forward[i], back[i]) else { continue };
            let d = ((b.point[0] - from[i][0]) as f64).hypot((b.point[1] - from[i][1]) as f64);
            if d <= o.forward_backward {
                kept.push((self.points[i], [f.point[0] as f64, f.point[1] as f64]));
            }
        }
        let tracked = self.points.len().max(1);
        if kept.len() < o.min_points {
            return self.lose(next);
        }
        // Frame to frame, among the points kept.
        let prev_pts: Vec<[f64; 2]> = kept.iter().map(|(p, _)| p.now).collect();
        let next_pts: Vec<[f64; 2]> = kept.iter().map(|(_, q)| *q).collect();
        let ransac = Ransac { threshold, ..Ransac::default() };
        let Some((step, inl)) = ransac_similarity(&prev_pts, &next_pts, &ransac) else { return self.lose(next) };
        let n_inl = inl.iter().filter(|&&b| b).count();
        if n_inl < o.min_points || (n_inl as f64) < o.min_ratio * tracked as f64 {
            return self.lose(next);
        }
        let incremental = step.after(&self.transform);
        // From where the points started: drift-free while the points keep their shape.
        let origin_pts: Vec<[f64; 2]> = kept.iter().map(|(p, _)| p.origin).collect();
        let absolute = ransac_similarity(&origin_pts, &next_pts, &Ransac { threshold: threshold * 1.5, ..ransac }).filter(|(_, a)| a.iter().filter(|&&b| b).count() as f64 >= 0.8 * n_inl as f64);
        let (transform, inliers) = match absolute {
            Some((t, a)) => (t, a),
            None => (incremental, inl.clone()),
        };
        if !(0.05..=20.0).contains(&transform.scale()) || !transform.tx.is_finite() || !transform.ty.is_finite() {
            return self.lose(next);
        }
        // Keep the inliers; an outlier of the absolute fit that the frame-to-frame one kept has
        // moved relative to the object: give it a new origin rather than drop it.
        let inverse = transform.inverse();
        let mut points: Vec<Point> = Vec::with_capacity(kept.len());
        for (i, (p, q)) in kept.iter().enumerate() {
            if inliers[i] {
                points.push(Point { now: *q, origin: p.origin });
            } else if inl[i] {
                points.push(Point { now: *q, origin: inverse.apply(*q) });
            }
        }
        self.velocity = transform.after(&self.transform.inverse());
        self.transform = transform;
        let region = self.start.moved(&self.transform);
        // Most of the region outside the picture: lost.
        let b = region.bounds();
        let (w, h) = (next.base().width as f64, next.base().height as f64);
        let visible = ((b[2].min(w) - b[0].max(0.0)).max(0.0) * (b[3].min(h) - b[1].max(0.0)).max(0.0)) / ((b[2] - b[0]) * (b[3] - b[1])).max(1e-9);
        if visible < 0.3 {
            return self.lose(next);
        }
        // Points that wandered out of the region are dropped; fill up when few are left.
        points.retain(|p| region.contains(p.now, -0.1 * region.size[0].min(region.size[1])));
        if (points.len() as f64) < o.refill * o.max_points as f64 {
            let fresh = find_points(&next, &region, &self.transform, &points, &o);
            points.extend(fresh);
        }
        self.points = points;
        self.previous = next;
        let n = inliers.iter().filter(|&&b| b).count();
        let confidence = (n as f64 / tracked as f64).min(1.0) * (n as f64 / 20.0).min(1.0);
        self.report(n, confidence)
    }

    fn lose(&mut self, next: Pyramid) -> Step {
        self.lost = true;
        self.previous = next;
        self.report(0, 0.0)
    }

    fn report(&self, inliers: usize, confidence: f64) -> Step {
        Step { transform: self.transform, region: self.start.moved(&self.transform), inliers, confidence, lost: self.lost }
    }
}

/// Corners of `pyramid`'s base inside `region` (at `transform` from where it started), away
/// from the points already tracked, with their origins.
fn find_points(pyramid: &Pyramid, region: &Region, transform: &Similarity, have: &[Point], o: &TrackerOptions) -> Vec<Point> {
    let level = &pyramid.levels[0];
    let target = *region;
    let b = target.bounds();
    let inset = (o.klt.radius as f64 * 0.5).min(target.size[0].min(target.size[1]) * 0.1);
    let min_d2 = (o.corners.min_distance as f64).powi(2);
    let corners = good_features(&level.image, &level.gx, &level.gy, [b[0] as f32, b[1] as f32, b[2] as f32, b[3] as f32], |x, y| target.contains([x as f64, y as f64], inset), &o.corners);
    let inverse = transform.inverse();
    let room = o.max_points.saturating_sub(have.len());
    corners
        .into_iter()
        .map(|c| [c.x as f64, c.y as f64])
        .filter(|p| have.iter().all(|h| (h.now[0] - p[0]).powi(2) + (h.now[1] - p[1]).powi(2) >= min_d2))
        .take(room)
        .map(|p| Point { now: p, origin: inverse.apply(p) })
        .collect()
}

/// The least-squares similarity of matched point sets (re-exported for callers fitting their
/// own matches).
pub fn similarity_of(src: &[[f64; 2]], dst: &[[f64; 2]]) -> Option<Similarity> {
    fit_similarity(src, dst, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{render_square, texture, Rng};

    /// A textured square over a different texture, moving, growing and turning each frame;
    /// the tracker must recover the square's pose within tolerance.
    #[test]
    fn follows_a_moving_scaling_turning_square() {
        let mut rng = Rng(11);
        let background = texture(&mut rng, 320, 240, 2.5);
        let object = texture(&mut rng, 96, 96, 2.0);
        let (w, h) = (320, 240);
        let pose = |k: usize| {
            let k = k as f64;
            // Centre, side, rotation (radians).
            ([110.0 + 3.1 * k, 100.0 + 1.7 * k], 80.0 * 1.012f64.powf(k), (1.5f64 * k).to_radians())
        };
        let frame = |k: usize| {
            let (c, side, rot) = pose(k);
            render_square(&background, &object, w, h, c, side, rot)
        };
        let (c0, s0, r0) = pose(0);
        let region = Region { center: c0, size: [s0 * 0.8, s0 * 0.8], rotation: r0 };
        let mut tracker = RegionTracker::new(frame(0), region, TrackerOptions::default()).unwrap();
        let mut worst = (0.0f64, 0.0f64, 0.0f64);
        for k in 1..=30 {
            let step = tracker.step(frame(k));
            assert!(!step.lost, "lost at frame {k}");
            let (c, s, r) = pose(k);
            let pos = (step.region.center[0] - c[0]).hypot(step.region.center[1] - c[1]);
            let scale = (step.transform.scale() - s / s0).abs() / (s / s0);
            let rot = (step.region.rotation - r).to_degrees().abs();
            worst = (worst.0.max(pos), worst.1.max(scale), worst.2.max(rot));
        }
        // Within half a pixel, 1% of scale and half a degree, over 30 frames.
        assert!(worst.0 < 0.5 && worst.1 < 0.01 && worst.2 < 0.5, "worst position {:.3} px, scale {:.4}, rotation {:.3}°", worst.0, worst.1, worst.2);
    }

    #[test]
    fn reports_lost_when_the_region_is_covered() {
        let mut rng = Rng(5);
        let background = texture(&mut rng, 200, 160, 2.5);
        let object = texture(&mut rng, 64, 64, 2.0);
        let frame = |c: [f64; 2]| render_square(&background, &object, 200, 160, c, 60.0, 0.0);
        let mut tracker = RegionTracker::new(frame([80.0, 80.0]), Region { center: [80.0, 80.0], size: [50.0, 50.0], rotation: 0.0 }, TrackerOptions::default()).unwrap();
        assert!(!tracker.step(frame([83.0, 80.0])).lost);
        // Something else entirely (a fresh texture) where the square was.
        let other = texture(&mut Rng(99), 200, 160, 2.5);
        let step = tracker.step(other);
        assert!(step.lost);
        assert!((step.region.center[0] - 83.0).abs() < 0.5, "keeps the last good place: {:?}", step.region);
        // A flat region can't be tracked at all.
        assert_eq!(RegionTracker::new(Gray::new(100, 100), Region { center: [50.0, 50.0], size: [40.0, 40.0], rotation: 0.0 }, TrackerOptions::default()).err(), Some(TrackError::NoFeatures));
    }
}
