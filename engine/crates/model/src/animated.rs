//! `Animated<T>`: one keyframe system shared by every animatable property
//! (position, scale, rotation, opacity, volume, colour parameters, …).
//!
//! CapCut's curves are evaluated as CapCut evaluates them (docs/parity/keyframes.md): a cubic
//! bezier through the two keys' (time, value) points with handles in absolute units, its
//! parameter found from the time by CapCut's own solver, all in single precision.

use serde::{Deserialize, Serialize};

use crate::time::Micros;

/// A curve handle: offsets from its key, per component of the value (x and y of a position
/// or a scale; r, g, b and a of a colour; the first alone for a number). Time in µs, value
/// in the property's own units.
#[derive(Copy, Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Handle {
    pub t: [f64; 4],
    pub v: [f64; 4],
}

impl Handle {
    pub const ZERO: Handle = Handle { t: [0.0; 4], v: [0.0; 4] };

    /// The same offsets for every component.
    pub const fn uniform(t: f64, v: f64) -> Handle {
        Handle { t: [t; 4], v: [v; 4] }
    }
}

/// How a value travels from one keyframe to the next.
#[derive(Copy, Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Easing {
    /// Keep the current value until the next keyframe.
    Hold,
    #[default]
    Linear,
    /// CSS-style `cubic-bezier(x1, y1, x2, y2)` on normalised time/progress.
    Bezier { x1: f64, y1: f64, x2: f64, y2: f64 },
    /// CapCut's curve (a `curveType` other than `Line`): for each component, the cubic bezier
    /// from this key's (time, value) to the next key's, its inner control points `out` after
    /// this key and `into` before the next (`into.t` ≤ 0). See [`capcut_curve`]. Components
    /// whose bit is set in `straight` go in a straight line instead (a position whose x is
    /// keyed on a line and y on a curve).
    Curve {
        out: Handle,
        into: Handle,
        #[serde(default, skip_serializing_if = "is_zero")]
        straight: u8,
    },
}

fn is_zero(v: &u8) -> bool {
    *v == 0
}

impl Easing {
    /// Map linear progress `u` in [0, 1] to eased progress. A CapCut curve is in absolute
    /// units and depends on its keys, so it's evaluated by [`sample_keys`] instead (here it's
    /// linear).
    pub fn apply(&self, u: f64) -> f64 {
        let u = u.clamp(0.0, 1.0);
        match *self {
            Easing::Hold => 0.0,
            Easing::Linear | Easing::Curve { .. } => u,
            Easing::Bezier { x1, y1, x2, y2 } => cubic_bezier(x1, y1, x2, y2, u),
        }
    }
}

fn cubic_bezier(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    // Bezier with P0 = (0,0), P3 = (1,1); solve x(s) = x for s, return y(s).
    let bez = |a: f64, b: f64, s: f64| {
        let inv = 1.0 - s;
        3.0 * inv * inv * s * a + 3.0 * inv * s * s * b + s * s * s
    };
    let dbez = |a: f64, b: f64, s: f64| {
        let inv = 1.0 - s;
        3.0 * inv * inv * a + 6.0 * inv * s * (b - a) + 3.0 * s * s * (1.0 - b)
    };
    let x1 = x1.clamp(0.0, 1.0);
    let x2 = x2.clamp(0.0, 1.0);
    let mut s = x;
    for _ in 0..8 {
        let err = bez(x1, x2, s) - x;
        if err.abs() < 1e-7 {
            return bez(y1, y2, s);
        }
        let d = dbez(x1, x2, s);
        if d.abs() < 1e-6 {
            break;
        }
        s -= err / d;
    }
    // Newton didn't converge: bisect (x(s) is monotonic for x1, x2 in [0, 1]).
    let (mut lo, mut hi) = (0.0, 1.0);
    s = x;
    for _ in 0..50 {
        let v = bez(x1, x2, s);
        if (v - x).abs() < 1e-7 {
            break;
        }
        if v < x {
            lo = s;
        } else {
            hi = s;
        }
        s = 0.5 * (lo + hi);
    }
    bez(y1, y2, s)
}

/// CapCut's keyframe curve (`vesdk::VEUtilsImpl::interpolationCubicBezier`, read from its
/// arm64 code): the cubic bezier through `p` (time, value pairs: the two keys and the
/// control points between them) at linear progress `u` from the first key to the last. Its
/// time is normalised to the span, the bezier parameter for `u` found by [`capcut_solve`],
/// and the value taken at that parameter; all in f32, in CapCut's order of operations.
pub fn capcut_curve(p: [[f32; 2]; 4], u: f32) -> f32 {
    let [p0, p1, p2, p3] = p;
    let span = p3[0] - p0[0];
    let a = (p1[0] - p0[0]) / span;
    let b = (p2[0] - p0[0]) / span;
    // x(s) = c3·s³ + c2·s² + c1·s for the normalised time.
    let b3 = b * 3.0;
    let c1 = a * 3.0;
    let c3 = c1 + (1.0 - b3);
    let c2 = b3 + a * -6.0;
    let s = capcut_solve([c3, c2, c1], u);
    let r = 1.0 - s;
    let y = (r * (r * p0[1])).mul_add(r, r * (r * (s * (p1[1] * 3.0))));
    let y = (s * (s * (p2[1] * 3.0))).mul_add(r, y);
    (s * (s * p3[1])).mul_add(s, y)
}

/// The bezier parameter at which the normalised time `c[0]·s³ + c[1]·s² + c[2]·s` reaches
/// `u`, found as CapCut finds it: Newton's method from `s = u` for up to 8 steps (kept in
/// [0, 1]), stopping within 0.001; failing that, bisection, which stops within 0.001 or
/// when its interval closes (then the last Newton estimate stands).
pub fn capcut_solve(c: [f32; 3], u: f32) -> f32 {
    const EPS: f32 = 1e-6;
    const TOLERANCE: f32 = 1e-3;
    let x = |s: f32| s * (c[2] + s * (c[1] + s * c[0]));
    let dx = |s: f32| c[2] + s * ((c[0] * 3.0) * s + (c[1] + c[1]));
    if u < 0.0 || u.abs() < EPS {
        return 0.0;
    }
    if u > 1.0 || (u - 1.0).abs() < EPS {
        return 1.0;
    }
    let mut s = u;
    for _ in 0..8 {
        let at = x(s);
        if (at - u).abs() < TOLERANCE {
            return s;
        }
        let d = dx(s);
        if d.abs() < EPS {
            break;
        }
        s = (s - (at - u) / d).min(1.0).max(0.0);
    }
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    while lo < hi && (hi - lo).abs() > EPS {
        let mid = lo + (hi - lo) * 0.5;
        let at = x(mid);
        if at < u {
            lo = mid;
        } else {
            hi = mid;
        }
        if (at - u).abs() < TOLERANCE {
            return mid;
        }
    }
    s.min(1.0)
}

/// Linear interpolation for animatable value types, and their components for CapCut's
/// curves (each component is its own curve).
pub trait Lerp: Clone {
    /// How many components a curve handle applies to.
    const COMPONENTS: usize = 1;
    fn lerp(a: &Self, b: &Self, t: f64) -> Self;
    fn component(&self, i: usize) -> f64;
    fn with_component(&self, i: usize, v: f64) -> Self;
}

impl Lerp for f32 {
    fn lerp(a: &Self, b: &Self, t: f64) -> Self {
        a + (b - a) * t as f32
    }
    fn component(&self, _: usize) -> f64 {
        *self as f64
    }
    fn with_component(&self, _: usize, v: f64) -> Self {
        v as f32
    }
}

impl Lerp for f64 {
    fn lerp(a: &Self, b: &Self, t: f64) -> Self {
        a + (b - a) * t
    }
    fn component(&self, _: usize) -> f64 {
        *self
    }
    fn with_component(&self, _: usize, v: f64) -> Self {
        v
    }
}

#[derive(Copy, Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const fn new(x: f64, y: f64) -> Self {
        Vec2 { x, y }
    }
}

impl Lerp for Vec2 {
    const COMPONENTS: usize = 2;
    fn lerp(a: &Self, b: &Self, t: f64) -> Self {
        Vec2::new(f64::lerp(&a.x, &b.x, t), f64::lerp(&a.y, &b.y, t))
    }
    fn component(&self, i: usize) -> f64 {
        if i == 0 { self.x } else { self.y }
    }
    fn with_component(&self, i: usize, v: f64) -> Self {
        if i == 0 { Vec2::new(v, self.y) } else { Vec2::new(self.x, v) }
    }
}

/// Straight (non-premultiplied) RGBA in 0..=1.
#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rgba {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Rgba {
    pub const BLACK: Rgba = Rgba { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    pub const WHITE: Rgba = Rgba { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };

    /// Parse `#rrggbb` or `#rrggbbaa`.
    pub fn from_hex(hex: &str) -> Option<Rgba> {
        let h = hex.trim().trim_start_matches('#');
        let byte = |i: usize| u8::from_str_radix(h.get(i..i + 2)?, 16).ok().map(|v| v as f32 / 255.0);
        match h.len() {
            6 => Some(Rgba { r: byte(0)?, g: byte(2)?, b: byte(4)?, a: 1.0 }),
            8 => Some(Rgba { r: byte(0)?, g: byte(2)?, b: byte(4)?, a: byte(6)? }),
            _ => None,
        }
    }
}

impl Lerp for Rgba {
    const COMPONENTS: usize = 4;
    fn lerp(a: &Self, b: &Self, t: f64) -> Self {
        Rgba {
            r: f32::lerp(&a.r, &b.r, t),
            g: f32::lerp(&a.g, &b.g, t),
            b: f32::lerp(&a.b, &b.b, t),
            a: f32::lerp(&a.a, &b.a, t),
        }
    }
    fn component(&self, i: usize) -> f64 {
        [self.r, self.g, self.b, self.a][i.min(3)] as f64
    }
    fn with_component(&self, i: usize, v: f64) -> Self {
        let mut c = [self.r, self.g, self.b, self.a];
        c[i.min(3)] = v as f32;
        Rgba { r: c[0], g: c[1], b: c[2], a: c[3] }
    }
}

/// A keyframe at a segment-local time. `ease` shapes the span from this key to the next.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Keyframe<T> {
    pub at: Micros,
    pub value: T,
    #[serde(default)]
    pub ease: Easing,
}

impl<T> Keyframe<T> {
    /// A key that travels linearly to the next.
    pub fn new(at: Micros, value: T) -> Self {
        Keyframe { at, value, ease: Easing::Linear }
    }
}

/// The value keys sorted by time give at `t`: the first key's before it, the last's after
/// it, and between two keys what the first one's easing makes of the span. `None` without
/// keys.
pub fn sample_keys<T: Lerp>(keys: &[Keyframe<T>], t: Micros) -> Option<T> {
    let first = keys.first()?;
    if keys.len() == 1 || t <= first.at {
        return Some(first.value.clone());
    }
    let last = &keys[keys.len() - 1];
    if t >= last.at {
        return Some(last.value.clone());
    }
    // First key strictly after t; the span is [i - 1, i].
    let i = keys.partition_point(|k| k.at <= t);
    let (a, b) = (&keys[i - 1], &keys[i]);
    let span = (b.at.0 - a.at.0) as f64;
    let u = if span > 0.0 { (t.0 - a.at.0) as f64 / span } else { 1.0 };
    Some(match a.ease {
        Easing::Curve { out, into, straight } => {
            // CapCut works in the segment's own time; each component is its own curve.
            let (ta, tb) = (a.at.0 as f64, b.at.0 as f64);
            let mut v = a.value.clone();
            for c in 0..T::COMPONENTS {
                let (va, vb) = (a.value.component(c), b.value.component(c));
                let y = if straight & (1 << c) != 0 {
                    f64::lerp(&va, &vb, u)
                } else {
                    let p = [[ta, va], [ta + out.t[c], va + out.v[c]], [tb + into.t[c], vb + into.v[c]], [tb, vb]].map(|q| q.map(|x| x as f32));
                    capcut_curve(p, u as f32) as f64
                };
                v = v.with_component(c, y);
            }
            v
        }
        ease => T::lerp(&a.value, &b.value, ease.apply(u)),
    })
}

/// Split the span of `keys` around `t` with a key there, keeping the motion: a curve is cut
/// in two by de Casteljau's construction at the bezier parameter where its time reaches `t`
/// (found in f64, per component), a held or eased span gets the value it has there. A key
/// already at `t`, or a `t` outside the keys, adds a key with the value there and nothing
/// else changes (outside, the new key holds the end value). Returns the new key's index.
pub fn split_keys<T: Lerp>(keys: &mut Vec<Keyframe<T>>, t: Micros) -> Option<usize> {
    let value = sample_keys(keys, t)?;
    match keys.binary_search_by(|k| k.at.cmp(&t)) {
        Ok(i) => return Some(i),
        Err(0) => {
            keys.insert(0, Keyframe::new(t, value));
            return Some(0);
        }
        Err(i) if i == keys.len() => {
            let ease = Easing::Linear;
            keys.push(Keyframe { at: t, value, ease });
            return Some(i);
        }
        Err(i) => {
            let (a, b) = (keys[i - 1].clone(), keys[i].clone());
            let (left, right) = match a.ease {
                Easing::Curve { out, into, straight } => {
                    let (mut lo, mut hi) = (Handle::ZERO, Handle::ZERO);
                    let (mut l2, mut r2) = (Handle::ZERO, Handle::ZERO);
                    let mut v = value.clone();
                    for c in (0..T::COMPONENTS).filter(|c| straight & (1 << c) == 0) {
                        let (ta, tb) = (a.at.0 as f64, b.at.0 as f64);
                        let (va, vb) = (a.value.component(c), b.value.component(c));
                        let p = [[ta, va], [ta + out.t[c], va + out.v[c]], [tb + into.t[c], vb + into.v[c]], [tb, vb]];
                        let s = bezier_param_at(&p, t.0 as f64);
                        let [q0, q1, q2, q3, r1, r2b, r3] = de_casteljau(&p, s);
                        let _ = q0;
                        // The new key's value per component is where the curve passes.
                        v = v.with_component(c, q3[1]);
                        lo.t[c] = q1[0] - ta;
                        lo.v[c] = q1[1] - va;
                        hi.t[c] = q2[0] - q3[0];
                        hi.v[c] = q2[1] - q3[1];
                        l2.t[c] = r1[0] - q3[0];
                        l2.v[c] = r1[1] - q3[1];
                        r2.t[c] = r2b[0] - r3[0];
                        r2.v[c] = r2b[1] - r3[1];
                    }
                    (Easing::Curve { out: lo, into: hi, straight }, (Easing::Curve { out: l2, into: r2, straight }, v))
                }
                ease => (ease, (ease, value)),
            };
            keys[i - 1].ease = left;
            let (ease, value) = right;
            keys.insert(i, Keyframe { at: t, value, ease });
            Some(i)
        }
    }
}

/// The parameter at which a bezier's time reaches `t` (its time is monotonic for handles
/// inside their span), by bisection in f64.
fn bezier_param_at(p: &[[f64; 2]; 4], t: f64) -> f64 {
    let x = |s: f64| {
        let r = 1.0 - s;
        r * r * r * p[0][0] + 3.0 * r * r * s * p[1][0] + 3.0 * r * s * s * p[2][0] + s * s * s * p[3][0]
    };
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..80 {
        let mid = 0.5 * (lo + hi);
        if x(mid) < t {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

/// De Casteljau's split of a cubic bezier at `s`: the left half's points (q0..q3) and the
/// right half's after its first, which is q3 (r1, r2, r3).
fn de_casteljau(p: &[[f64; 2]; 4], s: f64) -> [[f64; 2]; 7] {
    let mix = |a: [f64; 2], b: [f64; 2]| [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
    let (a, b, c) = (mix(p[0], p[1]), mix(p[1], p[2]), mix(p[2], p[3]));
    let (d, e) = (mix(a, b), mix(b, c));
    let f = mix(d, e);
    [p[0], a, d, f, e, c, p[3]]
}

/// A property value that is either constant (`keys` empty) or keyframed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Animated<T> {
    pub value: T,
    #[serde(default = "Vec::new", skip_serializing_if = "Vec::is_empty")]
    pub keys: Vec<Keyframe<T>>,
}

impl<T> Animated<T> {
    pub fn constant(value: T) -> Self {
        Animated { value, keys: Vec::new() }
    }

    pub fn is_animated(&self) -> bool {
        !self.keys.is_empty()
    }
}

impl<T: Default> Default for Animated<T> {
    fn default() -> Self {
        Animated::constant(T::default())
    }
}

impl<T: Lerp> Animated<T> {
    /// Insert or replace a keyframe, keeping keys sorted by time.
    pub fn set_key(&mut self, key: Keyframe<T>) {
        match self.keys.binary_search_by(|k| k.at.cmp(&key.at)) {
            Ok(i) => self.keys[i] = key,
            Err(i) => self.keys.insert(i, key),
        }
    }

    /// Value at segment-local time `t`.
    pub fn sample(&self, t: Micros) -> T {
        sample_keys(&self.keys, t).unwrap_or_else(|| self.value.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key<T>(at: i64, value: T, ease: Easing) -> Keyframe<T> {
        Keyframe { at: Micros(at), value, ease }
    }

    #[test]
    fn constant_and_clamped() {
        let a = Animated::constant(0.5f32);
        assert_eq!(a.sample(Micros(123)), 0.5);
        let mut b = Animated::constant(0.0f32);
        b.set_key(key(1000, 1.0, Easing::Linear));
        b.set_key(key(0, 0.0, Easing::Linear));
        assert_eq!(b.sample(Micros(-10)), 0.0);
        assert_eq!(b.sample(Micros(500)), 0.5);
        assert_eq!(b.sample(Micros(5000)), 1.0);
    }

    #[test]
    fn hold_and_bezier() {
        let mut a = Animated::constant(0.0f64);
        a.set_key(key(0, 0.0, Easing::Hold));
        a.set_key(key(100, 10.0, Easing::Linear));
        assert_eq!(a.sample(Micros(99)), 0.0);
        assert_eq!(a.sample(Micros(100)), 10.0);

        // ease-in-out is symmetric around the midpoint
        let e = Easing::Bezier { x1: 0.42, y1: 0.0, x2: 0.58, y2: 1.0 };
        assert!((e.apply(0.5) - 0.5).abs() < 1e-6);
        assert!(e.apply(0.1) < 0.1 && e.apply(0.9) > 0.9);
        // linear bezier equals linear
        let lin = Easing::Bezier { x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 };
        for i in 0..=10 {
            let u = i as f64 / 10.0;
            assert!((lin.apply(u) - u).abs() < 1e-6);
        }
    }

    /// CapCut's solver, step by step for one case worked by hand from its code: handles at
    /// 0.4 of the span and flat (CapCut's default curve). Newton from s = u converges within
    /// CapCut's 0.001 of the time.
    #[test]
    fn capcuts_solver_stops_within_its_tolerance() {
        // a = 0.4, b = 0.6: c3 = 1.2 + (1 − 1.8) = 0.4, c2 = 1.8 − 2.4 = −0.6, c1 = 1.2.
        let c = [0.4f32, -0.6, 1.2];
        let x = |s: f32| s * (c[2] + s * (c[1] + s * c[0]));
        for i in 1..20 {
            let u = i as f32 / 20.0;
            let s = capcut_solve(c, u);
            assert!((x(s) - u).abs() < 1e-3, "u {u}: s {s}");
        }
        // Outside the span and at its ends it doesn't iterate.
        assert_eq!((capcut_solve(c, -0.5), capcut_solve(c, 5e-7), capcut_solve(c, 1.5), capcut_solve(c, 1.0 - 5e-7)), (0.0, 0.0, 1.0, 1.0));
        // u = 0.5 is the curve's middle: the first guess is already on it.
        assert_eq!(capcut_solve(c, 0.5), 0.5);
        // The first Newton step from u = 0.25: x(0.25) = 0.25·(1.2 + 0.25·(−0.6 + 0.1)) =
        // 0.26875, x′(0.25) = 1.2 + 0.25·(0.3 − 1.2) = 0.975; s = 0.25 − 0.01875/0.975.
        let s1 = 0.25f32 - (x(0.25) - 0.25) / (c[2] + 0.25 * ((c[0] * 3.0) * 0.25 + (c[1] + c[1])));
        assert!((x(s1) - 0.25).abs() < 1e-3);
        assert_eq!(capcut_solve(c, 0.25), s1);
    }

    /// CapCut's own `interpolationCubicBezier`, called in its library on this machine (a
    /// scratch harness, docs/parity/keyframes.md), gives these bits; so do we. They cover the
    /// default curve, a bulge between equal values, zero-length handles, a handle beyond the
    /// span (the solver bisects) and progress next to the ends.
    #[test]
    fn matches_capcuts_curve_bit_for_bit() {
        let cases: [([f32; 9], u32); 10] = [
            ([0.0, 0.0, 400000.0, 0.0, 600000.0, 1.0, 1000000.0, 1.0, 0.25], 0x3e0a6dc2),
            ([0.0, 0.0, 400000.0, 0.0, 600000.0, 1.0, 1000000.0, 1.0, 0.1], 0x3cae7f88),
            ([1000000.0, 0.5, 1300000.0, 2.5, 1700000.0, 2.5, 2000000.0, 0.5, 0.37], 0x3ff42895),
            ([0.0, -1.0, 0.0, -1.0, 0.0, 2.0, 33333.0, 2.0, 0.6], 0x3fe6c3c5),
            ([15179338.0, 0.047634556889534, 15346005.0, 0.047634556889534, 15429338.0, 1.1719075441360474, 15596005.0, 1.1719075441360474, 0.38176530599594116], 0x3eca2782),
            ([0.0, -1.9977422952651978, 400000.0, -1.9977422952651978, 1000000.0, -1.398311734199524, 1000000.0, -1.398311734199524, 0.35496899485588074], 0xbff1c027),
            ([0.0, 1.0, 0.0, 1.0, 19999.80078125, 1.0, 33333.0, 1.0, 0.8046080470085144], 0x3f800000),
            ([41802224.0, 59.03871154785156, 41802248.0, 11.93923568725586, 41802212.0, 85.05232238769531, 41802240.0, 88.49005889892578, 0.5], 0x423f2360),
            ([9945240.0, 84.83952331542969, 9945240.0, 84.83952331542969, 9945257.0, 9.028807640075684, 9945257.0, 9.028807640075684, 1.9999999949504854e-06], 0x42a9add4),
            ([3607872.0, 28.849140167236328, 3607875.0, 62.191898345947266, 3607874.75, -5.928699493408203, 3607874.0, -0.5163931846618652, 4.999999987376214e-07], 0x41e6cb0a),
        ];
        for (v, bits) in cases {
            let y = capcut_curve([[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[6], v[7]]], v[8]);
            assert_eq!(y.to_bits(), bits, "{v:?}: {y} vs {}", f32::from_bits(bits));
        }
    }

    /// The default curve between 0 and 1 over a second: an ease in and out, its middle at
    /// 0.5, symmetric, and at the keys exactly their values.
    #[test]
    fn capcuts_default_curve_eases_in_and_out() {
        let span = 1_000_000.0;
        let curve = Easing::Curve { out: Handle::uniform(0.4 * span, 0.0), into: Handle::uniform(-0.4 * span, 0.0), straight: 0 };
        let a = Animated { value: 0.0f64, keys: vec![key(0, 0.0, curve), key(1_000_000, 1.0, Easing::Linear)] };
        assert_eq!(a.sample(Micros(0)), 0.0);
        assert_eq!(a.sample(Micros(1_000_000)), 1.0);
        assert!((a.sample(Micros(500_000)) - 0.5).abs() < 1e-6);
        let (q1, q3) = (a.sample(Micros(250_000)), a.sample(Micros(750_000)));
        assert!(q1 < 0.25 && q3 > 0.75 && (q1 + q3 - 1.0).abs() < 2e-3, "{q1} {q3}");
        // Flat handles at both keys: slow at both ends.
        assert!(a.sample(Micros(50_000)) < 0.01);
        // Two zero-length handles are a straight line (to CapCut's tolerance).
        let flat = Easing::Curve { out: Handle::ZERO, into: Handle::ZERO, straight: 0 };
        let b = Animated { value: 0.0f64, keys: vec![key(0, 0.0, flat), key(1_000_000, 1.0, Easing::Linear)] };
        for i in 0..=10 {
            let t = i * 100_000;
            assert!((b.sample(Micros(t)) - t as f64 / 1e6).abs() < 2e-3, "{t}");
        }
    }

    /// A handle with a value offset moves the curve even between equal values (a bump),
    /// which normalised easing couldn't express.
    #[test]
    fn a_curve_between_equal_values_can_bulge() {
        let curve = Easing::Curve { out: Handle::uniform(300_000.0, 2.0), into: Handle::uniform(-300_000.0, 2.0), straight: 0 };
        let a = Animated { value: 1.0f64, keys: vec![key(0, 1.0, curve), key(1_000_000, 1.0, Easing::Linear)] };
        let mid = a.sample(Micros(500_000));
        // At s = 0.5: 1 + 0.75·2 = 2.5.
        assert!((mid - 2.5).abs() < 1e-5, "{mid}");
    }

    /// Each component of a position follows its own handles.
    #[test]
    fn components_are_their_own_curves() {
        let mut out = Handle::uniform(400_000.0, 0.0);
        out.v[1] = 0.5;
        let curve = Easing::Curve { out, into: Handle::uniform(-400_000.0, 0.0), straight: 0 };
        let a = Animated { value: Vec2::default(), keys: vec![key(0, Vec2::new(0.0, 0.0), curve), key(1_000_000, Vec2::new(1.0, 1.0), Easing::Linear)] };
        let p = a.sample(Micros(500_000));
        assert!((p.x - 0.5).abs() < 1e-6 && p.y > 0.6, "{p:?}");
    }

    /// Sampling is a function of the time alone: the same time gives the same bits, in any
    /// order (seeking back and forth).
    #[test]
    fn sampling_is_seek_deterministic() {
        let curve = Easing::Curve { out: Handle::uniform(123_457.0, 0.3), into: Handle::uniform(-345_678.0, -0.2), straight: 0 };
        let a = Animated { value: 0.0f32, keys: vec![key(0, 0.0, curve), key(987_654, 3.0, Easing::Linear)] };
        let times: Vec<i64> = (0..1000).map(|i| (i * 7919) % 1_000_000).collect();
        let forward: Vec<u32> = times.iter().map(|&t| a.sample(Micros(t)).to_bits()).collect();
        let back: Vec<u32> = times.iter().rev().map(|&t| a.sample(Micros(t)).to_bits()).collect();
        assert!(forward.iter().eq(back.iter().rev()));
    }

    /// Splitting a span keeps its motion: a line exactly, a curve to well within CapCut's own
    /// tolerance.
    #[test]
    fn a_split_keeps_the_motion() {
        let curve = Easing::Curve { out: Handle::uniform(400_000.0, 0.0), into: Handle::uniform(-200_000.0, 0.5), straight: 0 };
        let mut a = Animated { value: 0.0f64, keys: vec![key(0, 0.0, curve), key(1_000_000, 2.0, Easing::Linear)] };
        let before: Vec<f64> = (0..=20).map(|i| a.sample(Micros(i * 50_000))).collect();
        assert_eq!(split_keys(&mut a.keys, Micros(300_000)), Some(1));
        assert_eq!(a.keys.len(), 3);
        for (i, want) in before.iter().enumerate() {
            let got = a.sample(Micros(i as i64 * 50_000));
            assert!((got - want).abs() < 5e-3, "{i}: {got} vs {want}");
        }
        let mut b = Animated { value: 0.0f64, keys: vec![key(0, 0.0, Easing::Linear), key(1_000_000, 1.0, Easing::Linear)] };
        split_keys(&mut b.keys, Micros(250_000));
        assert_eq!((b.keys[1].value, b.sample(Micros(600_000))), (0.25, 0.6));
        // Outside the keys: the end value, held.
        split_keys(&mut b.keys, Micros(2_000_000));
        assert_eq!(b.keys.last().map(|k| k.value), Some(1.0));
    }

    #[test]
    fn colour_hex() {
        assert_eq!(Rgba::from_hex("#ffffff"), Some(Rgba::WHITE));
        assert_eq!(Rgba::from_hex("#00000080").unwrap().a, 128.0 / 255.0);
        assert_eq!(Rgba::from_hex("nope"), None);
    }
}
