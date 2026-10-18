//! Animations OpenRip draws itself: per-character opacity over a text intro's run, and the
//! motion of a clip's In, Out, Combo and Loop animations.
//!
//! The typing timings are CapCut's, read from the scripts it downloads with each animation
//! (docs/parity/text-animations.md). `chars` counts every character of the text, line
//! breaks and spaces included, as CapCut's text component does.
//!
//! The motions follow CapCut's animation template (`Transform.lua`, the script of its Fade
//! Out): each property runs from one value to another on a cubic-bezier curve over part of
//! the run, and the result sits on top of the clip's own transform, keyframes included. The
//! offset adds to its position, the scale and turn apply about its centre after its own,
//! and the opacity multiplies (docs/parity/clip-animations.md).

use openrip_model::{Animation, AnimationKind, Easing, Micros};

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

/// How a clip's animations move it at one moment, on top of its own transform.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Motion {
    /// Added to the clip's position, in half-canvas units with +y up, as the position is.
    pub offset: [f64; 2],
    /// Times the clip's scale, about its centre.
    pub scale: f64,
    /// Degrees clockwise, added to the clip's turn.
    pub rotation: f64,
    /// Times the clip's opacity.
    pub alpha: f32,
}

impl Motion {
    pub const NONE: Motion = Motion { offset: [0.0, 0.0], scale: 1.0, rotation: 0.0, alpha: 1.0 };

    /// Both motions at once (an intro over a combo).
    fn and(self, o: Motion) -> Motion {
        Motion { offset: [self.offset[0] + o.offset[0], self.offset[1] + o.offset[1]], scale: self.scale * o.scale, rotation: self.rotation + o.rotation, alpha: self.alpha * o.alpha }
    }
}

/// The motion of a clip `length` long at clip-local time `t` from its animations, or `None`
/// when none of them moves it (no animation the engine moves, or outside their runs).
///
/// An In animation runs from its start, an Out one up to the clip's end, a Combo once over
/// its run and a Loop over and over, once per its duration. Before an In animation's start
/// (the incoming clip drawn ahead of its start in a transition) it holds its first state,
/// and after an Out one's end its last.
pub fn motion_at<'a>(animations: impl IntoIterator<Item = &'a Animation>, length: Micros, t: Micros) -> Option<Motion> {
    let mut out: Option<Motion> = None;
    for a in animations {
        let Some(builtin) = a.builtin.as_deref() else { continue };
        if a.duration.0 <= 0 {
            continue;
        }
        let d = a.duration.0 as f64;
        let q = match a.kind {
            AnimationKind::In => (t.0 - a.start.0) as f64 / d,
            AnimationKind::Out => (t.0 - (length.0 - a.duration.0)) as f64 / d,
            AnimationKind::Combo => ((t.0 - a.start.0) as f64 / d).clamp(0.0, 1.0),
            AnimationKind::Loop => ((t.0 - a.start.0) as f64 / d).rem_euclid(1.0),
            _ => continue,
        };
        // Done, or not begun: the clip as it is.
        if (a.kind == AnimationKind::In && q >= 1.0) || (a.kind == AnimationKind::Out && q <= 0.0) {
            continue;
        }
        let Some(m) = motion(&a.kind, builtin, q.clamp(0.0, 1.0)) else { continue };
        out = Some(out.map_or(m, |o| o.and(m)));
    }
    out
}

/// Ease out (cubic): fast, then settling.
fn ease_out(q: f64) -> f64 {
    1.0 - (1.0 - q).powi(3)
}

/// Ease in (cubic): slow, then fast.
fn ease_in(q: f64) -> f64 {
    q * q * q
}

/// Overshoot past the end and come back (`easeOutBack`), up to 10% beyond.
fn back_out(q: f64) -> f64 {
    Easing::Bezier { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1.0 }.apply(q)
}

/// A built-in's kind and direction: "slide_left" slides to the left, as a step in
/// half-canvas units (+y up).
fn split_direction(builtin: &str) -> (&str, [f64; 2]) {
    let step = |dir: &str| match dir {
        "left" => Some([-1.0, 0.0]),
        "right" => Some([1.0, 0.0]),
        "up" => Some([0.0, 1.0]),
        "down" => Some([0.0, -1.0]),
        _ => None,
    };
    match builtin.rsplit_once('_').and_then(|(name, dir)| Some((name, step(dir)?))) {
        Some((name, v)) => (name, v),
        None => (builtin, [0.0, 0.0]),
    }
}

/// A built-in animation's motion at `q`, 0 to 1 through its run. Fade Out is CapCut's own
/// (opacity 1 → 0, linear); the rest are the same template's moves with OpenRip's curves
/// until CapCut's bundles for them are on hand (docs/parity/clip-animations.md).
fn motion(kind: &AnimationKind, builtin: &str, q: f64) -> Option<Motion> {
    use std::f64::consts::PI;
    let (name, dir) = split_direction(builtin);
    let m = Motion::NONE;
    Some(match (kind, name) {
        // In: from the first state to the clip as it is, settling at the end.
        (AnimationKind::In, "fade_in") => Motion { alpha: q as f32, ..m },
        // From half its size, fading in over the first half.
        (AnimationKind::In, "zoom_in") => Motion { scale: 0.5 + 0.5 * ease_out(q), alpha: (2.0 * q).min(1.0) as f32, ..m },
        // From half again its size.
        (AnimationKind::In, "zoom_out") => Motion { scale: 1.5 - 0.5 * ease_out(q), alpha: (2.0 * q).min(1.0) as f32, ..m },
        // From a canvas away, moving in the direction.
        (AnimationKind::In, "slide") => {
            let away = 2.0 * (1.0 - ease_out(q));
            Motion { offset: [-dir[0] * away, -dir[1] * away], ..m }
        }
        // Half a turn while fading in.
        (AnimationKind::In, "rotate") => Motion { rotation: -180.0 * (1.0 - ease_out(q)), alpha: q as f32, ..m },
        // A whole turn while growing from nothing.
        (AnimationKind::In, "spin") => Motion { rotation: -360.0 * (1.0 - ease_out(q)), scale: ease_out(q).max(1e-3), ..m },
        // Growing from nothing past its size and back.
        (AnimationKind::In, "bounce") => Motion { scale: back_out(q).max(1e-3), ..m },
        // Side to side, three times, dying away.
        (AnimationKind::In, "shake") => Motion { offset: [0.04 * (6.0 * PI * q).sin() * (1.0 - q), 0.0], ..m },

        // Out: from the clip as it is to the last state.
        (AnimationKind::Out, "fade_out") => Motion { alpha: (1.0 - q) as f32, ..m },
        // Growing to half again its size, fading out over the second half.
        (AnimationKind::Out, "zoom_in") => Motion { scale: 1.0 + 0.5 * ease_in(q), alpha: (2.0 * (1.0 - q)).min(1.0) as f32, ..m },
        // Shrinking to half its size.
        (AnimationKind::Out, "zoom_out") => Motion { scale: 1.0 - 0.5 * ease_in(q), alpha: (2.0 * (1.0 - q)).min(1.0) as f32, ..m },
        // Leaving a canvas away in the direction.
        (AnimationKind::Out, "slide") => {
            let away = 2.0 * ease_in(q);
            Motion { offset: [dir[0] * away, dir[1] * away], ..m }
        }
        (AnimationKind::Out, "rotate") => Motion { rotation: 180.0 * ease_in(q), alpha: (1.0 - q) as f32, ..m },
        (AnimationKind::Out, "spin") => Motion { rotation: 360.0 * ease_in(q), scale: (1.0 - ease_in(q)).max(1e-3), ..m },
        // Swelling a little, then shrinking to nothing.
        (AnimationKind::Out, "bounce") => Motion { scale: back_out(1.0 - q).max(1e-3), ..m },
        (AnimationKind::Out, "shake") => Motion { offset: [0.04 * (6.0 * PI * q).sin() * q, 0.0], ..m },

        // Combo, once over the clip; Loop, once per its duration.
        (AnimationKind::Combo | AnimationKind::Loop, "swing") => {
            let turns = if *kind == AnimationKind::Combo { 2.0 } else { 1.0 };
            Motion { rotation: 8.0 * (2.0 * PI * turns * q).sin(), ..m }
        }
        (AnimationKind::Combo | AnimationKind::Loop, "shake") => {
            let turns = if *kind == AnimationKind::Combo { 8.0 } else { 4.0 };
            Motion { offset: [0.03 * (2.0 * PI * turns * q).sin(), 0.0], ..m }
        }
        (AnimationKind::Combo | AnimationKind::Loop, "pulse") => {
            let beats = if *kind == AnimationKind::Combo { 2.0 } else { 1.0 };
            Motion { scale: 1.0 + 0.1 * (PI * beats * q).sin().powi(2), ..m }
        }
        (AnimationKind::Combo, "spin") => Motion { rotation: 360.0 * ease_in_out(q), ..m },
        (AnimationKind::Loop, "float") => Motion { offset: [0.0, 0.03 * (2.0 * PI * q).sin()], ..m },
        (AnimationKind::Loop, "blink") => Motion { alpha: (0.5 + 0.5 * (2.0 * PI * q).cos()) as f32, ..m },
        _ => return None,
    })
}

/// Ease in and out (cubic).
fn ease_in_out(q: f64) -> f64 {
    if q < 0.5 {
        4.0 * q * q * q
    } else {
        1.0 - (-2.0 * q + 2.0).powi(3) / 2.0
    }
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

    fn clip_anim(kind: AnimationKind, builtin: &str, start_s: f64, duration_s: f64) -> Animation {
        Animation { kind, start: Micros((start_s * 1e6) as i64), duration: Micros((duration_s * 1e6) as i64), builtin: Some(builtin.into()), library: None, resource: None }
    }

    /// The motion of one animation on a 4 s clip at `t` seconds.
    fn moved(a: &Animation, t: f64) -> Option<Motion> {
        motion_at([a], Micros(4_000_000), Micros((t * 1e6) as i64))
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-3
    }

    #[test]
    fn fade_out_is_capcuts_linear_fade_at_the_end_of_the_clip() {
        // Transform.lua with Fade Out's values: opacity 1 → 0, linear, over the last second.
        let a = clip_anim(AnimationKind::Out, "fade_out", 0.0, 1.0);
        assert_eq!(moved(&a, 2.0), None);
        assert_eq!(moved(&a, 3.0), None);
        assert_eq!(moved(&a, 3.25).map(|m| m.alpha), Some(0.75));
        assert_eq!(moved(&a, 3.5).map(|m| m.alpha), Some(0.5));
        // Past the end (an outgoing clip drawn on in a transition): gone.
        assert_eq!(moved(&a, 4.2).map(|m| m.alpha), Some(0.0));
        // Only the opacity changes.
        let m = moved(&a, 3.5).unwrap();
        assert_eq!((m.offset, m.scale, m.rotation), ([0.0, 0.0], 1.0, 0.0));
    }

    #[test]
    fn in_animations_settle_on_the_clip() {
        let fade = clip_anim(AnimationKind::In, "fade_in", 0.0, 0.5);
        assert_eq!(moved(&fade, 0.0).map(|m| m.alpha), Some(0.0));
        assert_eq!(moved(&fade, 0.25).map(|m| m.alpha), Some(0.5));
        assert_eq!(moved(&fade, 0.5), None);
        // Before the clip (the incoming clip of a transition): held at the start.
        assert_eq!(moved(&fade, -0.2).map(|m| m.alpha), Some(0.0));
        let zoom = clip_anim(AnimationKind::In, "zoom_in", 0.0, 1.0);
        assert!(close(moved(&zoom, 0.0).unwrap().scale, 0.5));
        assert!(close(moved(&zoom, 0.5).unwrap().scale, 0.5 + 0.5 * 0.875));
        assert!(close(moved(&zoom, 0.999).unwrap().scale, 1.0));
        let out = clip_anim(AnimationKind::In, "zoom_out", 0.0, 1.0);
        assert!(close(moved(&out, 0.0).unwrap().scale, 1.5));
        let spin = clip_anim(AnimationKind::In, "spin", 0.0, 1.0);
        assert!(close(moved(&spin, 0.5).unwrap().rotation, -45.0));
        // Bounce overshoots past full size before settling.
        let bounce = clip_anim(AnimationKind::In, "bounce", 0.0, 1.0);
        let peak = (1..100).map(|i| moved(&bounce, i as f64 / 100.0).unwrap().scale).fold(0.0, f64::max);
        assert!(peak > 1.05 && peak < 1.15, "{peak}");
    }

    #[test]
    fn slides_come_in_and_leave_in_their_direction() {
        // Leftwards: in from a canvas to the right; out to a canvas to the left.
        let a = clip_anim(AnimationKind::In, "slide_left", 0.0, 1.0);
        assert_eq!(moved(&a, 0.0).unwrap().offset, [2.0, 0.0]);
        assert!(close(moved(&a, 0.5).unwrap().offset[0], 2.0 * 0.125));
        let a = clip_anim(AnimationKind::Out, "slide_left", 0.0, 1.0);
        assert!(close(moved(&a, 3.5).unwrap().offset[0], -2.0 * 0.125));
        assert_eq!(moved(&a, 4.0).unwrap().offset, [-2.0, 0.0]);
        // Up is +y, as the position is.
        let a = clip_anim(AnimationKind::Out, "slide_up", 0.0, 1.0);
        assert_eq!(moved(&a, 4.0).unwrap().offset, [0.0, 2.0]);
        let a = clip_anim(AnimationKind::In, "slide_down", 0.0, 1.0);
        assert_eq!(moved(&a, 0.0).unwrap().offset, [0.0, 2.0]);
    }

    #[test]
    fn combos_span_their_run_and_loops_repeat() {
        let swing = clip_anim(AnimationKind::Combo, "swing", 0.0, 4.0);
        // Two swings over the clip: the first peak an eighth of the way in.
        assert!(close(moved(&swing, 0.5).unwrap().rotation, 8.0));
        assert!(close(moved(&swing, 1.0).unwrap().rotation, 0.0));
        assert!(close(moved(&swing, 1.5).unwrap().rotation, -8.0));
        let pulse = clip_anim(AnimationKind::Loop, "pulse", 0.0, 1.0);
        assert!(close(moved(&pulse, 0.5).unwrap().scale, 1.1));
        assert!(close(moved(&pulse, 2.5).unwrap().scale, 1.1));
        assert!(close(moved(&pulse, 3.0).unwrap().scale, 1.0));
        let blink = clip_anim(AnimationKind::Loop, "blink", 0.0, 2.0);
        assert!(close(moved(&blink, 1.0).unwrap().alpha as f64, 0.0));
    }

    #[test]
    fn animations_add_up_and_typing_moves_nothing() {
        let a = clip_anim(AnimationKind::In, "fade_in", 0.0, 1.0);
        let b = clip_anim(AnimationKind::Combo, "pulse", 0.0, 4.0);
        let m = motion_at([&a, &b], Micros(4_000_000), Micros(500_000)).unwrap();
        assert!(close(m.alpha as f64, 0.5) && close(m.scale, 1.0 + 0.1 * (std::f64::consts::PI * 0.25).sin().powi(2)));
        let typing = anim("type_1", 1.0);
        assert_eq!(motion_at([&typing], Micros(4_000_000), Micros(300_000)), None);
        // A CapCut animation the engine doesn't move, and none at all.
        let other = Animation { builtin: None, ..clip_anim(AnimationKind::In, "x", 0.0, 1.0) };
        assert_eq!(motion_at([&other], Micros(4_000_000), Micros(300_000)), None);
        assert_eq!(motion_at([], Micros(4_000_000), Micros(300_000)), None);
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
