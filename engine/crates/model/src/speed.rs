//! Speed curves: a clip's time remapped by a speed that changes along it (CapCut's curve
//! speed). The maths is CapCut's, read from its engine (docs/parity/speed.md):
//!
//! - A curve is CapCut's `speed_points`: (x, y) with x the progress through the clip's source
//!   range (0 at its in-point, 1 at its out-point) and y the speed there.
//! - The points are placed on the clip as played: point i sits at output progress
//!   s_i = S_i / S_n, where S_i adds up each span's source length over its mean speed,
//!   Δx / ((y_prev + y) / 2). (CapCut works this out in single precision.)
//! - Between two points the speed runs over output time in three straight pieces, an S-shaped
//!   ramp: from the first point's speed to within 10% of the span's change by 20.49% of the
//!   span, through the middle at 80% of the change over the next 59.02%, and on to the second
//!   point's speed. It's symmetric about the span's middle, so each span plays its source in
//!   the time it would at its mean speed: x_i is reached at s_i exactly.
//! - The source shown at an output time is the integral of that speed, rounded to the µs; the
//!   clip's length is its source length over the curve's mean speed, 1 / Σ Δx / mean(y), which
//!   is the `speed` CapCut stores with the curve.

use serde::Serialize;

/// The share of a span's change in speed made in its middle piece (CapCut's 0.8f).
const K1: f64 = 0.800000011920929;
/// Half the middle piece's length, as a share of the span (CapCut's 0.2951f).
const K2: f64 = 0.29510000348091125;

/// CapCut's speed range on a curve.
pub const MIN_CURVE_SPEED: f64 = 0.1;
pub const MAX_CURVE_SPEED: f64 = 10.0;

/// A curve preset of CapCut's Speed ▸ Curve tab: its name and points (from the presets CapCut
/// downloads; "Custom" is the curve a new custom one starts from).
#[derive(Copy, Clone, Debug, PartialEq, Serialize)]
pub struct CurvePreset {
    pub name: &'static str,
    pub points: &'static [(f64, f64)],
}

/// CapCut's curve presets, in the tab's order.
pub const CURVE_PRESETS: &[CurvePreset] = &[
    CurvePreset { name: "Custom", points: &[(0.0, 1.0), (0.25, 1.0), (0.5, 1.0), (0.75, 1.0), (1.0, 1.0)] },
    CurvePreset { name: "Montage", points: &[(0.0, 0.9), (0.1, 0.9), (0.5, 6.8), (0.65, 0.3), (0.8, 1.0), (1.0, 1.0)] },
    CurvePreset { name: "Hero", points: &[(0.0, 1.0), (0.05, 1.0), (0.35, 5.5), (0.45, 0.5), (0.55, 0.5), (0.65, 5.5), (0.95, 1.0), (1.0, 1.0)] },
    CurvePreset { name: "Bullet", points: &[(0.0, 5.2), (0.4, 5.2), (0.46, 0.5), (0.54, 0.5), (0.6, 5.2), (1.0, 5.2)] },
    CurvePreset { name: "Jump Cut", points: &[(0.0, 0.6), (0.43, 0.6), (0.5, 6.0), (0.57, 0.6), (1.0, 0.6)] },
    CurvePreset { name: "Flash In", points: &[(0.0, 5.2), (0.4, 5.2), (0.6, 1.0), (1.0, 1.0)] },
    CurvePreset { name: "Flash Out", points: &[(0.0, 1.0), (0.4, 1.0), (0.6, 5.2), (1.0, 5.2)] },
];

/// A speed curve ready to map time between a clip's output (timeline) and its source.
#[derive(Clone, Debug, PartialEq)]
pub struct Remap {
    /// Speeds at the points, in order of source progress.
    y: Vec<f64>,
    /// Output progress (0..1) of each point.
    s: Vec<f64>,
    /// The speed's integral from the start to each point (source, in output-progress units:
    /// the last is about the mean speed).
    areas: Vec<f64>,
    /// The mean speed: source length over output length.
    average: f64,
}

/// The three pieces of the ramp over one span, from output progress `a` to `b`.
struct Span {
    a: f64,
    b: f64,
    y0: f64,
    y1: f64,
    /// Ends of the middle piece.
    b1: f64,
    b2: f64,
    /// Slope of the outer pieces and of the middle one.
    g: f64,
    h: f64,
    /// Source (in output-progress units of speed × time) covered by the first two pieces.
    first: f64,
    middle: f64,
}

impl Span {
    fn new(a: f64, b: f64, y0: f64, y1: f64) -> Span {
        let l = (b - a).max(1e-12);
        let m = (a + b) / 2.0;
        let dy = y1 - y0;
        let (b1, b2) = (m - K2 * l, m + K2 * l);
        let g = (1.0 - K1) * dy / ((1.0 - 2.0 * K2) * l);
        let h = K1 * dy / (2.0 * K2 * l);
        let first = y0 * (b1 - a) + g * (b1 - a).powi(2) / 2.0;
        let middle = 2.0 * K2 * l * (y0 + y1) / 2.0;
        Span { a, b, y0, y1, b1, b2, g, h, first, middle }
    }

    /// Speed at the middle piece's start and end.
    fn v1(&self) -> f64 {
        self.y0 + self.g * (self.b1 - self.a)
    }

    fn v2(&self) -> f64 {
        self.v1() + self.h * (self.b2 - self.b1)
    }

    fn speed(&self, t: f64) -> f64 {
        if t <= self.b1 {
            self.y0 + self.g * (t - self.a)
        } else if t <= self.b2 {
            self.v1() + self.h * (t - self.b1)
        } else {
            self.y1 - self.g * (self.b - t)
        }
    }

    /// The speed's integral from the span's start to `t`.
    fn area(&self, t: f64) -> f64 {
        let piece = |v0: f64, k: f64, w: f64| v0 * w + k * w * w / 2.0;
        if t <= self.b1 {
            piece(self.y0, self.g, t - self.a)
        } else if t <= self.b2 {
            self.first + piece(self.v1(), self.h, t - self.b1)
        } else {
            self.first + self.middle + piece(self.v2(), self.g, t - self.b2)
        }
    }

    /// Where in the span the integral reaches `r`.
    fn time_of(&self, r: f64) -> f64 {
        // The positive root of v0·w + k·w²/2 = r, in a form that holds for k = 0.
        let solve = |v0: f64, k: f64, r: f64| 2.0 * r / (v0 + (v0 * v0 + 2.0 * k * r).max(0.0).sqrt()).max(1e-12);
        if r <= self.first {
            self.a + solve(self.y0, self.g, r)
        } else if r <= self.first + self.middle {
            self.b1 + solve(self.v1(), self.h, r - self.first)
        } else {
            self.b2 + solve(self.v2(), self.g, r - self.first - self.middle)
        }
    }
}

impl Remap {
    /// A curve's remap; `None` without at least two points.
    pub fn new(points: &[(f64, f64)]) -> Option<Remap> {
        if points.len() < 2 {
            return None;
        }
        let mut p: Vec<(f64, f64)> = points.iter().map(|&(x, y)| (x, y.clamp(MIN_CURVE_SPEED, MAX_CURVE_SPEED))).collect();
        p.sort_by(|a, b| a.0.total_cmp(&b.0));
        // Each point's place in output time, in single precision as CapCut works it out.
        let mut acc = 0f32;
        let mut sums = vec![0f32];
        for w in p.windows(2) {
            let mean = (w[0].1 as f32 + w[1].1 as f32) / 2.0;
            acc += (w[1].0 as f32 - w[0].0 as f32) / mean;
            sums.push(acc);
        }
        if !(acc > 0.0) {
            return None;
        }
        let s32: Vec<f32> = sums.iter().map(|v| *v / acc).collect();
        // The mean speed, as CapCut sums it: each span's mean speed times its share of the output.
        let average: f64 = (1..p.len()).map(|i| ((p[i - 1].1 as f32 + p[i].1 as f32) as f64) * 0.5 * ((s32[i] - s32[i - 1]) as f64)).sum();
        let s: Vec<f64> = s32.iter().map(|v| *v as f64).collect();
        let y: Vec<f64> = p.iter().map(|q| q.1).collect();
        let mut r = Remap { y, s, areas: Vec::new(), average };
        // How much source the integral covers by each point.
        let mut reached = vec![0.0];
        for i in 1..r.s.len() {
            let sp = r.span(i);
            reached.push(reached[i - 1] + sp.area(r.s[i]));
        }
        r.areas = reached;
        Some(r)
    }

    /// The integral over the whole clip: source length over output length as the ramps give it
    /// (the mean speed, to rounding).
    fn total(&self) -> f64 {
        self.areas.last().copied().unwrap_or(1.0).max(1e-12)
    }

    fn span(&self, i: usize) -> Span {
        Span::new(self.s[i - 1], self.s[i], self.y[i - 1], self.y[i])
    }

    /// The span holding output progress `q` (its end's index).
    fn span_at(&self, q: f64) -> usize {
        self.s.partition_point(|s| *s < q).clamp(1, self.s.len() - 1)
    }

    /// The mean speed: source length over output length (CapCut's stored `speed`).
    pub fn average(&self) -> f64 {
        self.average
    }

    /// The speed at output progress `q` (CapCut's: 1 past the last point).
    pub fn speed_at(&self, q: f64) -> f64 {
        if q > 1.0 {
            return 1.0;
        }
        self.span(self.span_at(q.max(0.0))).speed(q.max(0.0))
    }

    /// Source progress (0..1) shown at output progress `q` (0..1).
    pub fn source_at(&self, q: f64) -> f64 {
        let q = q.clamp(0.0, 1.0);
        let i = self.span_at(q);
        ((self.areas[i - 1] + self.span(i).area(q)) / self.total()).clamp(0.0, 1.0)
    }

    /// Output progress (0..1) at which source progress `p` (0..1) is shown.
    pub fn timeline_at(&self, p: f64) -> f64 {
        let p = p.clamp(0.0, 1.0);
        let r = p * self.total();
        let i = self.areas.partition_point(|a| *a < r).clamp(1, self.areas.len() - 1);
        self.span(i).time_of(r - self.areas[i - 1]).clamp(0.0, 1.0)
    }

    /// The source a clip of output length `length` (µs) shows `t` into it, as CapCut maps it:
    /// the speed's integral, rounded to the µs.
    pub fn source_offset(&self, t: i64, length: i64) -> i64 {
        if length <= 0 {
            return 0;
        }
        let q = (t as f64 / length as f64).clamp(0.0, 1.0);
        let i = self.span_at(q);
        ((self.areas[i - 1] + self.span(i).area(q)) * length as f64 + 0.5).floor() as i64
    }

    /// The output time (µs into a clip of output length `length`) that shows `offset` of its
    /// source: the inverse of [`Remap::source_offset`].
    pub fn output_offset(&self, offset: i64, length: i64) -> i64 {
        if length <= 0 {
            return 0;
        }
        let r = offset as f64 / length as f64;
        let i = self.areas.partition_point(|a| *a < r).clamp(1, self.areas.len() - 1);
        let q = self.span(i).time_of(r - self.areas[i - 1]);
        (q.clamp(0.0, 1.0) * length as f64 + 0.5).floor() as i64
    }

    /// A clip's output length for a source length (µs), as CapCut truncates it.
    pub fn output_length(&self, source: i64) -> i64 {
        (source as f64 / self.average) as i64
    }

    /// The source length a clip of output length `length` (µs) plays, as CapCut truncates it.
    pub fn source_length(&self, length: i64) -> i64 {
        (self.average * length as f64) as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flat_curve_is_a_constant_speed() {
        let r = Remap::new(&[(0.0, 2.0), (0.5, 2.0), (1.0, 2.0)]).unwrap();
        assert!((r.average() - 2.0).abs() < 1e-7);
        assert_eq!(r.output_length(4_000_000), 2_000_000);
        for q in [0.0, 0.1, 0.5, 0.77, 1.0] {
            assert!((r.source_at(q) - q).abs() < 1e-7, "{q}");
            assert!((r.timeline_at(q) - q).abs() < 1e-7, "{q}");
        }
        assert_eq!(r.source_offset(500_000, 2_000_000), 1_000_000);
    }

    #[test]
    fn the_mean_speed_is_capcuts() {
        // A cached CapCut draft stores `speed` 0.742763028661908 with this four-point curve,
        // and a 2.7 s clip of it plays 2,005,458 µs of source (docs/parity/speed.md).
        let pts = [(0.0, 1.0), (0.909861572568959, 1.000001072883606), (0.966685242093924, 0.100000001490116), (1.0, 0.100000001490116)];
        let r = Remap::new(&pts).unwrap();
        assert!((r.average() - 0.742763028661908).abs() < 1e-15, "{}", r.average());
        assert!((r.source_length(2_700_000) - 2_005_458).abs() <= 2);
        // Montage: the mean speed is 1 / Σ Δx / mean(y).
        let m = Remap::new(CURVE_PRESETS[1].points).unwrap();
        let sum: f64 = CURVE_PRESETS[1].points.windows(2).map(|w| (w[1].0 - w[0].0) / ((w[0].1 + w[1].1) / 2.0)).sum();
        assert!((m.average() - 1.0 / sum).abs() < 1e-6);
    }

    #[test]
    fn points_are_reached_at_their_place_and_the_ramp_is_continuous() {
        for preset in CURVE_PRESETS {
            let r = Remap::new(preset.points).unwrap();
            for (i, &(x, y)) in preset.points.iter().enumerate() {
                assert!((r.source_at(r.s[i]) - x).abs() < 1e-6, "{} point {i}", preset.name);
                assert!((r.speed_at(r.s[i]) - y).abs() < 1e-6, "{} speed at point {i}", preset.name);
            }
            // No jumps where the pieces meet, and time never runs backward.
            for i in 1..r.s.len() {
                let sp = r.span(i);
                for at in [sp.a, sp.b1, sp.b2, sp.b] {
                    let (before, after) = (sp.speed(at - 1e-9), sp.speed(at + 1e-9));
                    assert!((before - after).abs() < 1e-5, "{} span {i} at {at}: {before} vs {after}", preset.name);
                }
            }
            let mut last = 0.0;
            for k in 1..=4000 {
                let p = r.source_at(k as f64 / 4000.0);
                assert!(p >= last, "{} backward at {k}", preset.name);
                last = p;
            }
        }
    }

    #[test]
    fn the_ramp_is_three_straight_pieces() {
        // From 1× to 3× over the whole clip: 10% of the change by 20.49%, 90% by 79.51%.
        let r = Remap::new(&[(0.0, 1.0), (1.0, 3.0)]).unwrap();
        assert!((r.speed_at(0.2049) - 1.2).abs() < 1e-3);
        assert!((r.speed_at(0.5) - 2.0).abs() < 1e-9);
        assert!((r.speed_at(0.7951) - 2.8).abs() < 1e-3);
        // Mean speed 2: the clip plays its source in half the time.
        assert!((r.average() - 2.0).abs() < 1e-7);
        assert!((r.source_at(0.5) - 0.5 * 1.0 * 0.5 / 2.0 * 2.0).abs() < 0.2);
    }

    #[test]
    fn the_two_directions_agree() {
        for preset in CURVE_PRESETS {
            let r = Remap::new(preset.points).unwrap();
            for i in 0..=200 {
                let q = i as f64 / 200.0;
                assert!((r.timeline_at(r.source_at(q)) - q).abs() < 1e-9, "{} at {q}", preset.name);
            }
            let length = 3_000_000;
            for t in (0..=length).step_by(33_333) {
                let back = r.output_offset(r.source_offset(t, length), length);
                // Each µs of output shows up to 10 µs of source: a round trip is within a few µs.
                assert!((back - t).abs() <= 2, "{} at {t}: {back}", preset.name);
            }
        }
    }
}
