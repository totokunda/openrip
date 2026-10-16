//! Text animations OpenRip draws itself: per-character opacity over an animation's run.
//!
//! The timings are CapCut's, read from the scripts it downloads with each animation
//! (docs/parity/text-animations.md). `chars` counts every character of the text, line
//! breaks and spaces included, as CapCut's text component does.

use openrip_model::{Animation, AnimationKind, Micros};

/// Per-character opacity at clip-local time `t` from the clip's animations, or `None` when
/// they leave every character fully shown.
pub fn char_alpha<'a>(animations: impl IntoIterator<Item = &'a Animation>, chars: usize, t: Micros) -> Option<Vec<f32>> {
    let mut out: Option<Vec<f32>> = None;
    for a in animations {
        if a.kind != AnimationKind::In || a.duration.0 <= 0 || chars == 0 {
            continue;
        }
        let (local, d) = ((t.0 - a.start.0) as f64 / 1e6, a.duration.0 as f64 / 1e6);
        if local >= d {
            continue;
        }
        let alpha: Vec<f32> = match a.builtin.as_deref() {
            Some("type_1") => type_1(chars, local, d),
            Some("type_2") => type_2(chars, local, d),
            Some("typewriter") => typewriter(chars, local, d),
            _ => continue,
        };
        match &mut out {
            Some(o) => o.iter_mut().zip(alpha).for_each(|(o, a)| *o *= a),
            None => out = Some(alpha),
        }
    }
    out
}

/// "Type 1": character i (from 1) pops in at `d * i / (n + 1)`.
fn type_1(n: usize, t: f64, d: f64) -> Vec<f32> {
    (1..=n).map(|i| if t >= d * i as f64 / (n + 1) as f64 { 1.0 } else { 0.0 }).collect()
}

/// "Type 2": character i (from 1) fades in with a sine-in ease, starting at
/// `3d/4 * (1 - cos(pi/2 * i/n))` and lasting `d/4 * (1 - (1 - i/n)^5)`: early characters
/// arrive quickly and nearly at once, later ones slower and longer.
fn type_2(n: usize, t: f64, d: f64) -> Vec<f32> {
    let sin_in = |p: f64| 1.0 - (p * std::f64::consts::FRAC_PI_2).cos();
    (1..=n)
        .map(|i| {
            let x = i as f64 / n as f64;
            let start = 0.75 * d * sin_in(x);
            let fade = 0.25 * d * (1.0 - (1.0 - x).powi(5));
            let p = if fade > 0.0 { ((t - start) / fade).clamp(0.0, 1.0) } else { (t >= start) as u8 as f64 };
            sin_in(p) as f32
        })
        .collect()
}

/// CapCut's fixed per-character "typing" rhythm: relative times, repeated every 14
/// characters. The second set (longer pauses at the 4th and 8th) is used when there is
/// under 0.15 s per character.
const TYPEWRITER_SLOW: [f64; 14] = [0.86, 1.35, 0.62, 2.2, 0.25, 0.96, 0.35, 2.55, 0.03, 0.82, 0.2, 1.26, 0.36, 0.1];
const TYPEWRITER_FAST: [f64; 14] = [0.86, 1.35, 0.62, 5.2, 0.25, 0.96, 0.35, 4.55, 0.03, 0.82, 0.2, 1.26, 0.36, 0.1];

/// "Typewriter": each character gets a slot in proportion to the rhythm above, the slots
/// filling the first 1/1.2 of the run; a character appears 90% of the way through its slot.
/// (CapCut also draws a blinking caret; not yet.)
fn typewriter(n: usize, t: f64, d: f64) -> Vec<f32> {
    let table = if d / n as f64 >= 0.15 { &TYPEWRITER_SLOW } else { &TYPEWRITER_FAST };
    let weights: Vec<f64> = (0..n).map(|i| table[i % table.len()]).collect();
    let total: f64 = weights.iter().sum();
    let progress = 1.2 * t / d;
    let mut start = 0.0;
    weights
        .iter()
        .map(|w| {
            let slot = w / total;
            let shown = progress >= start + 0.9 * slot;
            start += slot;
            if shown { 1.0 } else { 0.0 }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anim(builtin: &str, duration_s: f64) -> Animation {
        Animation { kind: AnimationKind::In, start: Micros(0), duration: Micros((duration_s * 1e6) as i64), builtin: Some(builtin.into()), library: None, resource: None }
    }

    fn shown(a: &Animation, n: usize, t: f64) -> usize {
        char_alpha([a], n, Micros((t * 1e6) as i64)).map_or(n, |v| v.iter().filter(|&&x| x >= 1.0).count())
    }

    #[test]
    fn type_1_reveals_one_character_per_equal_step() {
        let a = anim("type_1", 3.0);
        // 5 characters: at 0.5, 1.0, 1.5, 2.0, 2.5 s.
        assert_eq!(shown(&a, 5, 0.0), 0);
        assert_eq!(shown(&a, 5, 0.49), 0);
        assert_eq!(shown(&a, 5, 0.5), 1);
        assert_eq!(shown(&a, 5, 2.49), 4);
        assert_eq!(shown(&a, 5, 2.5), 5);
        assert_eq!(shown(&a, 5, 3.0), 5);
    }

    #[test]
    fn type_2_finishes_with_the_last_character_at_the_end() {
        let a = anim("type_2", 2.0);
        let at = |t: f64| char_alpha([&a], 10, Micros((t * 1e6) as i64));
        assert!(at(0.0).unwrap().iter().all(|&x| x == 0.0));
        // The last character starts at 3/4 of the run and fades over the last quarter.
        let v = at(1.75).unwrap();
        assert!(v[9] > 0.2 && v[9] < 0.4, "{}", v[9]);
        assert_eq!(v[0], 1.0);
        assert!(at(2.0).is_none());
    }

    #[test]
    fn typewriter_finishes_at_five_sixths_of_the_run() {
        let a = anim("typewriter", 1.2);
        assert_eq!(shown(&a, 20, 0.0), 0);
        assert_eq!(shown(&a, 20, 0.999), 20);
        assert!(shown(&a, 20, 0.5) > 0 && shown(&a, 20, 0.5) < 20);
        // Characters appear in order.
        let v = char_alpha([&a], 20, Micros(400_000)).unwrap();
        let k = v.iter().filter(|&&x| x == 1.0).count();
        assert!(v[..k].iter().all(|&x| x == 1.0) && v[k..].iter().all(|&x| x == 0.0));
    }
}
