//! Time is stored as integer microseconds (the unit CapCut uses in its drafts).
//! Frame numbers only exist at the edges, converted with exact rational maths so
//! `frame_of(frame_start(n)) == n` for every frame rate, including 29.97/59.94.

use serde::{Deserialize, Serialize};
use std::ops::{Add, Sub};

pub const MICROS_PER_SECOND: i64 = 1_000_000;

/// A point in time or a duration, in microseconds.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Micros(pub i64);

impl Micros {
    pub const ZERO: Micros = Micros(0);

    pub fn from_secs_f64(secs: f64) -> Self {
        Micros((secs * MICROS_PER_SECOND as f64).round() as i64)
    }

    pub fn as_secs_f64(self) -> f64 {
        self.0 as f64 / MICROS_PER_SECOND as f64
    }
}

impl Add for Micros {
    type Output = Micros;
    fn add(self, rhs: Micros) -> Micros {
        Micros(self.0 + rhs.0)
    }
}

impl Sub for Micros {
    type Output = Micros;
    fn sub(self, rhs: Micros) -> Micros {
        Micros(self.0 - rhs.0)
    }
}

/// A half-open range `[start, start + duration)`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TimeRange {
    pub start: Micros,
    pub duration: Micros,
}

impl TimeRange {
    pub fn new(start: Micros, duration: Micros) -> Self {
        TimeRange { start, duration }
    }

    pub fn end(&self) -> Micros {
        self.start + self.duration
    }

    pub fn contains(&self, t: Micros) -> bool {
        t >= self.start && t < self.end()
    }

    pub fn overlaps(&self, other: &TimeRange) -> bool {
        self.start < other.end() && other.start < self.end()
    }
}

/// An exact frame rate, e.g. `30000/1001` for 29.97 fps.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FrameRate {
    pub num: u32,
    pub den: u32,
}

impl FrameRate {
    pub const fn new(num: u32, den: u32) -> Self {
        FrameRate { num, den }
    }

    /// Map a float rate to the exact rational it stands for (23.976 → 24000/1001, …).
    pub fn from_f64(fps: f64) -> Self {
        for (num, den) in [(24000, 1001), (30000, 1001), (60000, 1001), (120000, 1001)] {
            if (fps - num as f64 / den as f64).abs() < 0.005 {
                return FrameRate::new(num, den);
            }
        }
        if (fps - fps.round()).abs() < 1e-6 && fps > 0.0 {
            return FrameRate::new(fps.round() as u32, 1);
        }
        FrameRate::new((fps * 1000.0).round() as u32, 1000)
    }

    pub fn as_f64(&self) -> f64 {
        self.num as f64 / self.den as f64
    }

    /// Time at which frame `n` starts, rounded to the nearest microsecond.
    pub fn frame_start(&self, n: i64) -> Micros {
        let numer = n as i128 * MICROS_PER_SECOND as i128 * self.den as i128;
        let denom = self.num as i128;
        Micros(div_round(numer, denom) as i64)
    }

    /// Index of the frame displayed at time `t` (the last frame starting at or before `t`).
    pub fn frame_of(&self, t: Micros) -> i64 {
        let numer = t.0 as i128 * self.num as i128;
        let denom = MICROS_PER_SECOND as i128 * self.den as i128;
        let mut n = numer.div_euclid(denom) as i64;
        // `frame_start` rounds, so nudge the estimate to respect it exactly.
        while self.frame_start(n + 1) <= t {
            n += 1;
        }
        while self.frame_start(n) > t {
            n -= 1;
        }
        n
    }

    pub fn frame_duration(&self) -> Micros {
        Micros(div_round(MICROS_PER_SECOND as i128 * self.den as i128, self.num as i128) as i64)
    }
}

fn div_round(numer: i128, denom: i128) -> i128 {
    let q = numer.div_euclid(denom);
    let r = numer.rem_euclid(denom);
    if r * 2 >= denom {
        q + 1
    } else {
        q
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATES: [FrameRate; 9] = [
        FrameRate::new(24000, 1001),
        FrameRate::new(24, 1),
        FrameRate::new(25, 1),
        FrameRate::new(30000, 1001),
        FrameRate::new(30, 1),
        FrameRate::new(50, 1),
        FrameRate::new(60000, 1001),
        FrameRate::new(60, 1),
        FrameRate::new(120, 1),
    ];

    #[test]
    fn frames_round_trip_exactly_at_every_rate() {
        for rate in RATES {
            for n in (-5..20_000).chain([1_000_000, 10_000_000]) {
                let t = rate.frame_start(n);
                assert_eq!(rate.frame_of(t), n, "rate {rate:?} frame {n}");
                // Any time inside the frame maps back to the same frame.
                let next = rate.frame_start(n + 1);
                assert_eq!(rate.frame_of(Micros(next.0 - 1)), n, "rate {rate:?} frame {n} end");
            }
        }
    }

    #[test]
    fn ntsc_rates_are_recognised() {
        assert_eq!(FrameRate::from_f64(29.97), FrameRate::new(30000, 1001));
        assert_eq!(FrameRate::from_f64(59.94), FrameRate::new(60000, 1001));
        assert_eq!(FrameRate::from_f64(30.0), FrameRate::new(30, 1));
        assert_eq!(FrameRate::new(30000, 1001).frame_duration(), Micros(33367));
    }

    #[test]
    fn ranges() {
        let a = TimeRange::new(Micros(0), Micros(100));
        let b = TimeRange::new(Micros(100), Micros(50));
        assert!(!a.overlaps(&b));
        assert!(a.contains(Micros(99)) && !a.contains(Micros(100)));
        assert_eq!(b.end(), Micros(150));
    }
}
