//! `Animated<T>`: one keyframe system shared by every animatable property
//! (position, scale, rotation, opacity, volume, colour parameters, …).

use serde::{Deserialize, Serialize};

use crate::time::Micros;

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
}

impl Easing {
    /// Map linear progress `u` in [0, 1] to eased progress.
    pub fn apply(&self, u: f64) -> f64 {
        let u = u.clamp(0.0, 1.0);
        match *self {
            Easing::Hold => 0.0,
            Easing::Linear => u,
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

/// Linear interpolation for animatable value types.
pub trait Lerp: Clone {
    fn lerp(a: &Self, b: &Self, t: f64) -> Self;
}

impl Lerp for f32 {
    fn lerp(a: &Self, b: &Self, t: f64) -> Self {
        a + (b - a) * t as f32
    }
}

impl Lerp for f64 {
    fn lerp(a: &Self, b: &Self, t: f64) -> Self {
        a + (b - a) * t
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
    fn lerp(a: &Self, b: &Self, t: f64) -> Self {
        Vec2::new(f64::lerp(&a.x, &b.x, t), f64::lerp(&a.y, &b.y, t))
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
    fn lerp(a: &Self, b: &Self, t: f64) -> Self {
        Rgba {
            r: f32::lerp(&a.r, &b.r, t),
            g: f32::lerp(&a.g, &b.g, t),
            b: f32::lerp(&a.b, &b.b, t),
            a: f32::lerp(&a.a, &b.a, t),
        }
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
        let keys = &self.keys;
        match keys.len() {
            0 => self.value.clone(),
            1 => keys[0].value.clone(),
            _ => {
                if t <= keys[0].at {
                    return keys[0].value.clone();
                }
                let last = keys.len() - 1;
                if t >= keys[last].at {
                    return keys[last].value.clone();
                }
                // First key strictly after t; the span is [i - 1, i].
                let i = keys.partition_point(|k| k.at <= t);
                let (a, b) = (&keys[i - 1], &keys[i]);
                let span = (b.at.0 - a.at.0) as f64;
                let u = if span > 0.0 { (t.0 - a.at.0) as f64 / span } else { 1.0 };
                T::lerp(&a.value, &b.value, a.ease.apply(u))
            }
        }
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

    #[test]
    fn colour_hex() {
        assert_eq!(Rgba::from_hex("#ffffff"), Some(Rgba::WHITE));
        assert_eq!(Rgba::from_hex("#00000080").unwrap().a, 128.0 / 255.0);
        assert_eq!(Rgba::from_hex("nope"), None);
    }
}
