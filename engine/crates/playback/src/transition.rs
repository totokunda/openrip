//! Transitions OpenRip draws itself, between a clip and the next one on its track.
//!
//! The behaviour is CapCut's where its scripts are on this machine (they come with each
//! transition it downloads), checked against exports (docs/parity/transitions.md); the
//! classic ones whose bundles aren't here follow the same rules with their own curves. A
//! transition runs from half its duration before the cut to half after it. The outgoing clip
//! plays up to the cut and the incoming one from it. Most transitions work on one clip at a
//! time, or on the canvas over it; the ones that mix the two (a cross-fade, a slide, a wipe)
//! need both at once: CapCut plays the outgoing clip on past its end and the incoming one
//! from before its start, and OpenRip takes those frames from their media.

use openrip_model::{Micros, Project, Segment, Transition};

/// The cut a clip is at: the transition, how far through it (0 to 1, the cut at 0.5), and
/// the two clips it joins.
#[derive(Clone, Copy, Debug)]
pub struct Cut<'a> {
    pub transition: &'a Transition,
    pub progress: f64,
    pub outgoing: &'a Segment,
    pub incoming: &'a Segment,
}

/// The transition a clip is in at `t`. A transition is drawn only where a clip on the same
/// track starts as the one with it ends.
pub fn transition_at<'a>(project: &'a Project, seg: &Segment, t: Micros) -> Option<Cut<'a>> {
    let of = |s: &Segment| s.attachments.iter().find_map(|id| project.materials.transitions.iter().find(|tr| &tr.id == id && tr.builtin.is_some() && tr.duration.0 > 0));
    let progress = |tr: &Transition, cut: i64| (t.0 - (cut - tr.duration.0 / 2)) as f64 / tr.duration.0 as f64;
    let track = project.tracks.iter().find(|tr| tr.segments.iter().any(|s| s.id == seg.id))?;
    let meets = |a: &Segment, b: &Segment| a.id != b.id && (a.target.end().0 - b.target.start.0).abs() <= 1_000;
    let this = track.segments.iter().find(|s| s.id == seg.id)?;
    // Into the cut at the end of this clip.
    if let Some(tr) = of(this) {
        if let Some(next) = track.segments.iter().filter(|s| meets(this, s)).min_by_key(|s| s.target.start) {
            let p = progress(tr, this.target.end().0);
            if (0.0..0.5).contains(&p) {
                return Some(Cut { transition: tr, progress: p, outgoing: this, incoming: next });
            }
        }
    }
    // Out of the cut at its start, from the clip before it on its track.
    let before = track.segments.iter().filter(|s| meets(s, this)).max_by_key(|s| s.target.start)?;
    let tr = of(before)?;
    let p = progress(tr, this.target.start.0);
    (0.5..=1.0).contains(&p).then_some(Cut { transition: tr, progress: p, outgoing: before, incoming: this })
}

/// What a transition adds over the clip at progress `p`.
#[derive(Clone, Debug, PartialEq)]
pub enum Step {
    /// A colour over the whole canvas at this opacity.
    Wash([u8; 4], f32),
    /// The canvas blurred by CapCut's transition blur, taps this many canvas pixels apart
    /// (at the canvas's own width).
    Blur(f32),
    /// A frame of the transition's own image sequence, cover-fitted to the canvas.
    Frame(String),
    /// The clips drawn each on a canvas of its own and put together, in place of the clip
    /// drawn as usual.
    Mix(Mix),
    /// The clips drawn each on a canvas of its own and given to a shader transition
    /// (openrip_render::glt) as its two pictures.
    Gl(openrip_render::glt::GlFx),
}

/// The two clips put together: each moved and faded, the incoming one over the outgoing one
/// inside `mask`. A clip that's `None` isn't drawn.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mix {
    pub outgoing: Option<Shot>,
    pub incoming: Option<Shot>,
    pub mask: Mask,
}

/// A clip's whole canvas in a transition: moved by `offset` (canvas widths and heights, +y
/// down), scaled and turned (degrees clockwise) about the canvas centre, at `alpha`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shot {
    pub offset: [f32; 2],
    pub scale: f32,
    pub rotation: f32,
    pub alpha: f32,
    /// CapCut's zoom blur (Pull in): 21 taps along the line from the canvas centre, tap i at
    /// `i · 10/720 · 2 · zoom_blur` of the way from the centre, in the canvas's own units.
    pub zoom_blur: f32,
    /// Outside the canvas: mirrored copies of it (Pull in) rather than nothing.
    pub mirror: bool,
}

impl Shot {
    pub const STILL: Shot = Shot { offset: [0.0, 0.0], scale: 1.0, rotation: 0.0, alpha: 1.0, zoom_blur: 0.0, mirror: false };
}

/// Where the incoming clip shows over the outgoing one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mask {
    All,
    /// Past a straight edge: points whose distance along `toward` (a unit direction in
    /// canvas fractions, +y down) from the canvas centre is at least `at` (canvas fractions
    /// along that direction; −0.5 to 0.5 crosses the canvas), softened over `feather`.
    Edge { toward: [f32; 2], at: f32, feather: f32 },
    /// Inside a circle about the canvas centre, `radius` in canvas heights.
    Circle { radius: f32, feather: f32 },
}

/// A transition's direction: the way the incoming clip (or the edge) moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Left,
    Right,
    Up,
    Down,
}

impl Direction {
    pub fn of(name: &str) -> Option<Direction> {
        Some(match name {
            "left" => Direction::Left,
            "right" => Direction::Right,
            "up" => Direction::Up,
            "down" => Direction::Down,
            _ => return None,
        })
    }

    /// The direction as a unit step in canvas fractions (+y down).
    fn vector(self) -> [f32; 2] {
        match self {
            Direction::Left => [-1.0, 0.0],
            Direction::Right => [1.0, 0.0],
            Direction::Up => [0.0, -1.0],
            Direction::Down => [0.0, 1.0],
        }
    }
}

/// A built-in name's kind and direction: "slide_left" is a slide to the left.
fn split_direction(builtin: &str) -> (&str, Option<Direction>) {
    match builtin.rsplit_once('_') {
        Some((kind, dir)) if Direction::of(dir).is_some() => (kind, Direction::of(dir)),
        _ => (builtin, None),
    }
}

/// Ease in and out (cubic): slow at both ends.
fn ease_in_out(p: f64) -> f64 {
    if p < 0.5 {
        4.0 * p * p * p
    } else {
        1.0 - (-2.0 * p + 2.0).powi(3) / 2.0
    }
}

/// Pull in's curve (`VerticalZoomNear.frag`): ease in and out, quintic.
fn ease_in_out_quint(p: f64) -> f64 {
    if p < 0.5 {
        16.0 * p.powi(5)
    } else {
        1.0 + 16.0 * (p - 1.0).powi(5)
    }
}

/// The two halves of a transition: the outgoing clip's (`p` < 0.5) and the incoming one's,
/// each with its own progress from 0 to 1.
fn halves(p: f64) -> (bool, f64) {
    if p < 0.5 {
        (true, p * 2.0)
    } else {
        (false, (p - 0.5) * 2.0)
    }
}

/// A shader transition's parameters from the project's (by name, as the app keeps them: a number,
/// a flag, `[x, y]`, or a colour as "#rrggbb"), the defaults for what's missing.
fn gl_values(tr: &Transition, t: &openrip_render::glt::GlTransition) -> [[f32; 4]; openrip_render::glt::MAX_PARAMS] {
    use openrip_render::glt::Kind;
    use serde_json::Value;
    let mut values = [[0.0; 4]; openrip_render::glt::MAX_PARAMS];
    for (slot, p) in values.iter_mut().zip(t.params) {
        *slot = p.default;
        let Some(v) = tr.params.get(p.name) else { continue };
        let num = |v: &Value| v.as_f64().or_else(|| v.as_bool().map(|b| b as u8 as f64)).map(|x| x as f32);
        match (p.kind, v) {
            (Kind::Float | Kind::Int | Kind::Bool, v) => {
                if let Some(x) = num(v) {
                    slot[0] = x;
                }
            }
            (Kind::Vec2 | Kind::IVec2, Value::Array(a)) => {
                for (s, x) in slot.iter_mut().zip(a.iter().filter_map(num)) {
                    *s = x;
                }
            }
            (Kind::Vec3 | Kind::Vec4, Value::String(hex)) => {
                let h = hex.trim_start_matches('#');
                if h.len() >= 6 {
                    for i in 0..3 {
                        if let Ok(c) = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16) {
                            slot[i] = c as f32 / 255.0;
                        }
                    }
                }
            }
            (Kind::Vec3 | Kind::Vec4, Value::Array(a)) => {
                for (s, x) in slot.iter_mut().zip(a.iter().filter_map(num)) {
                    *s = x;
                }
            }
            _ => {}
        }
    }
    values
}

pub fn steps(tr: &Transition, p: f64) -> Vec<Step> {
    let Some(builtin) = tr.builtin.as_deref() else { return Vec::new() };
    if let Some(t) = openrip_render::glt::find(builtin) {
        let values = gl_values(tr, t);
        return vec![Step::Gl(openrip_render::glt::GlFx { id: t.id, progress: p.clamp(0.0, 1.0) as f32, values })];
    }
    let (kind, direction) = split_direction(builtin);
    let dir = direction.unwrap_or(Direction::Left).vector();
    let shot = |alpha: f32| Some(Shot { alpha, ..Shot::STILL });
    match kind {
        // White Flash (SeekModeScript.lua): the frame mixed towards white, linearly to all
        // white at the cut and back.
        "white_flash" => {
            let amount = if p < 0.5 { 2.0 * p } else { 2.0 * (1.0 - p) };
            vec![Step::Wash([255, 255, 255, 255], amount.clamp(0.0, 1.0) as f32)]
        }
        // Black Fade: the same through black.
        "black_fade" => {
            let amount = if p < 0.5 { 2.0 * p } else { 2.0 * (1.0 - p) };
            vec![Step::Wash([0, 0, 0, 255], amount.clamp(0.0, 1.0) as f32)]
        }
        // White Fade (scriptScene.js, a 2 s timeline): white rises linearly from 50 to 800 ms,
        // holds to 1200 ms and falls by 1950 ms; the clips cross-fade from 750 to 1250 ms,
        // under at least 93% white. Its seek starts a tween 10 ms after its delay.
        "white_fade" => {
            let ms = p * 2000.0;
            let brightness = if ms <= 60.0 {
                1.0
            } else if ms < 800.0 {
                1.0 + 1.2 * (ms - 50.0) / 750.0
            } else if ms < 1200.0 {
                2.2
            } else if ms < 1950.0 {
                2.2 - 1.2 * (ms - 1200.0) / 750.0
            } else {
                1.0
            };
            let mix = if ms <= 760.0 { 0.0 } else { ((ms - 750.0) / 500.0).min(1.0) };
            let white = ((brightness - 1.0) / 1.2).clamp(0.0, 1.0);
            let wash = Step::Wash([255, 255, 255, 255], white as f32);
            // Under all white the mix doesn't show: one clip is enough.
            if mix > 0.0 && mix < 1.0 && white < 1.0 {
                vec![Step::Mix(Mix { outgoing: shot(1.0), incoming: shot(mix as f32), mask: Mask::All }), wash]
            } else {
                vec![wash]
            }
        }
        // Blink (Set.lua): an eyelid sequence of 120 frames, closing over the outgoing clip
        // and opening over the incoming one, over the clip blurred near the closed eye.
        "blink" => {
            let Some(bundle) = &tr.resource else { return Vec::new() };
            let (q, first) = if p <= 0.5 { (p * 2.0, true) } else { ((p - 0.5) * 2.0, false) };
            let frame = if first { ((q * 60.0).floor() as u32 + 1).min(60) } else { ((q * 60.0).floor() as u32 + 61).min(120) };
            let open = if first { q } else { 1.0 - q };
            let blur = if open > 0.6 { 3.0 * (open - 0.6) } else { 0.0 };
            // The shader's taps are 1.25 × the blur size apart, in the input's pixels.
            vec![Step::Blur((1.25 * blur) as f32), Step::Frame(format!("{bundle}/AmazingFeature/seq/1/1_00{frame}.png"))]
        }
        // Blur: the outgoing clip blurs up to the cut and the incoming one sharpens after it,
        // CapCut's transition blur at taps up to 6 canvas pixels apart (of 1080).
        "blur" => {
            let k = 1.0 - (2.0 * p - 1.0).abs();
            vec![Step::Blur((6.0 * ease_in_out(k)) as f32)]
        }
        // Mix: a cross-fade, the incoming clip over the outgoing one at `p`.
        "mix" => vec![Step::Mix(Mix { outgoing: shot(1.0), incoming: shot(p as f32), mask: Mask::All })],
        // Slide: the incoming clip slides in over the outgoing one, from the far side.
        "slide" => {
            let left = 1.0 - ease_in_out(p) as f32;
            let incoming = Shot { offset: [-dir[0] * left, -dir[1] * left], ..Shot::STILL };
            vec![Step::Mix(Mix { outgoing: shot(1.0), incoming: Some(incoming), mask: Mask::All })]
        }
        // Push: the incoming clip pushes the outgoing one off the canvas.
        "push" => {
            let gone = ease_in_out(p) as f32;
            let outgoing = Shot { offset: [dir[0] * gone, dir[1] * gone], ..Shot::STILL };
            let incoming = Shot { offset: [-dir[0] * (1.0 - gone), -dir[1] * (1.0 - gone)], ..Shot::STILL };
            vec![Step::Mix(Mix { outgoing: Some(outgoing), incoming: Some(incoming), mask: Mask::All })]
        }
        // Wipe: a straight edge crosses the canvas, the incoming clip behind it. The edge
        // moves in the direction; the incoming clip shows on the side it came from.
        "wipe" => {
            let at = 0.5 - ease_in_out(p) as f32 * 1.04 + 0.02;
            vec![Step::Mix(Mix { outgoing: shot(1.0), incoming: shot(1.0), mask: Mask::Edge { toward: [-dir[0], -dir[1]], at, feather: 0.02 } })]
        }
        // Circle: the incoming clip in a circle growing from the centre past the corners.
        "circle" => {
            let radius = ease_in_out(p) as f32 * 1.2;
            vec![Step::Mix(Mix { outgoing: shot(1.0), incoming: shot(1.0), mask: Mask::Circle { radius, feather: 0.01 } })]
        }
        // Pull in (VerticalZoomNear.frag): on a quintic ease T, the outgoing clip zooms in to
        // twice its size by the cut and the incoming one from two thirds of its size, its
        // edges mirrored, each under a zoom blur at its strongest at the cut.
        "pull_in" => {
            let tt = ease_in_out_quint(p) as f32;
            if tt <= 0.5 {
                vec![Step::Mix(Mix { outgoing: Some(Shot { scale: 1.0 / (1.0 - tt), zoom_blur: tt, mirror: true, ..Shot::STILL }), incoming: None, mask: Mask::All })]
            } else {
                vec![Step::Mix(Mix { outgoing: None, incoming: Some(Shot { scale: 1.0 / (2.0 - tt), zoom_blur: 1.0 - tt, mirror: true, ..Shot::STILL }), mask: Mask::All })]
            }
        }
        // Pull out: Pull in played backwards with the clips swapped, so the outgoing clip
        // shrinks to two thirds and the incoming one settles from twice its size.
        "pull_out" => {
            let tt = ease_in_out_quint(p) as f32;
            if tt <= 0.5 {
                vec![Step::Mix(Mix { outgoing: Some(Shot { scale: 1.0 / (1.0 + tt), zoom_blur: tt, mirror: true, ..Shot::STILL }), incoming: None, mask: Mask::All })]
            } else {
                vec![Step::Mix(Mix { outgoing: None, incoming: Some(Shot { scale: 1.0 / tt, zoom_blur: 1.0 - tt, mirror: true, ..Shot::STILL }), mask: Mask::All })]
            }
        }
        // Spin: the outgoing clip turns half a turn as it shrinks away by the cut, and the
        // incoming one turns in from half a turn as it grows.
        "spin" => {
            let (first, q) = halves(p);
            let e = ease_in_out(q) as f32;
            let s = if first { Shot { scale: 1.0 - e, rotation: 180.0 * e, ..Shot::STILL } } else { Shot { scale: e, rotation: -180.0 * (1.0 - e), ..Shot::STILL } };
            let s = Some(Shot { scale: s.scale.max(1e-3), ..s });
            vec![Step::Mix(if first { Mix { outgoing: s, incoming: None, mask: Mask::All } } else { Mix { outgoing: None, incoming: s, mask: Mask::All } })]
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openrip_model::{Canvas, FrameRate, MaterialId, Track, TrackKind};

    fn project(builtin: &str) -> Project {
        let mut p = Project::new("p", "p", Canvas { width: 1080, height: 1920 }, FrameRate::from_f64(30.0));
        let seg = |id: &str, start: i64, len: i64, attach: &[&str]| Segment {
            id: id.into(),
            material: MaterialId("m".into()),
            source: None,
            target: openrip_model::TimeRange::new(Micros(start), Micros(len)),
            speed: 1.0,
            reverse: false,
            change_pitch: false,
            visible: true,
            render_index: 0,
            transform: Default::default(),
            crop: None,
            opacity: openrip_model::Animated::constant(1.0),
            volume: openrip_model::Animated::constant(1.0),
            attachments: attach.iter().map(|a| MaterialId((*a).into())).collect(),
            keyframes: Vec::new(),
        };
        p.tracks.push(Track { id: "t".into(), kind: TrackKind::Video, name: String::new(), segments: vec![seg("a", 0, 2_000_000, &["tr"]), seg("b", 2_000_000, 2_000_000, &[])], muted: false, hidden: false, locked: false });
        p.materials.transitions.push(Transition { id: MaterialId("tr".into()), name: String::new(), duration: Micros(500_000), overlap: false, builtin: Some(builtin.into()), library: None, resource: Some("/b".into()), params: Default::default() });
        p
    }

    fn tr(builtin: &str) -> Transition {
        project(builtin).materials.transitions.remove(0)
    }

    fn mix(builtin: &str, p: f64) -> Mix {
        match steps(&tr(builtin), p).as_slice() {
            [Step::Mix(m)] => *m,
            other => panic!("{builtin} at {p}: {other:?}"),
        }
    }

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-4
    }

    #[test]
    fn a_transition_spans_the_cut() {
        let p = project("white_flash");
        let (a, b) = (&p.tracks[0].segments[0], &p.tracks[0].segments[1]);
        let at = |s: &Segment, t: i64| transition_at(&p, s, Micros(t)).map(|c| (c.progress, c.outgoing.id.clone(), c.incoming.id.clone()));
        assert!(at(a, 1_700_000).is_none());
        assert_eq!(at(a, 1_850_000), Some((0.2, "a".into(), "b".into())));
        assert_eq!(at(b, 2_000_000), Some((0.5, "a".into(), "b".into())));
        assert_eq!(at(b, 2_150_000), Some((0.8, "a".into(), "b".into())));
        assert!(at(b, 2_300_000).is_none());
    }

    #[test]
    fn nothing_without_a_clip_after() {
        let mut p = project("white_flash");
        p.tracks[0].segments.pop();
        let a = &p.tracks[0].segments[0];
        assert!(transition_at(&p, a, Micros(1_850_000)).is_none());
        // A gap before the next clip is no cut either.
        let mut p = project("white_flash");
        p.tracks[0].segments[1].target.start = Micros(2_500_000);
        let a = &p.tracks[0].segments[0];
        assert!(transition_at(&p, a, Micros(1_850_000)).is_none());
    }

    #[test]
    fn white_flash_peaks_at_the_cut() {
        let tr = tr("white_flash");
        assert_eq!(steps(&tr, 0.25), vec![Step::Wash([255; 4], 0.5)]);
        assert_eq!(steps(&tr, 0.5), vec![Step::Wash([255; 4], 1.0)]);
    }

    #[test]
    fn white_fade_cross_fades_under_the_white() {
        let tr = tr("white_fade");
        // 400 ms of its 2 s timeline: white rising, one clip.
        assert!(matches!(steps(&tr, 0.2).as_slice(), [Step::Wash(_, a)] if (*a - 0.35 / 0.75).abs() < 1e-4));
        // At the cut, half way through the cross-fade, all white: the mix doesn't show.
        assert_eq!(steps(&tr, 0.5), vec![Step::Wash([255; 4], 1.0)]);
        // At 780 ms: 6% of the way, under 96% white.
        match steps(&tr, 0.39).as_slice() {
            [Step::Mix(m), Step::Wash(_, a)] => assert!(m.outgoing == Some(Shot::STILL) && (m.incoming.unwrap().alpha - 0.06).abs() < 1e-4 && *a < 1.0),
            s => panic!("{s:?}"),
        }
        // At 1225 ms: 95% of the way, under 97% white; by 1250 ms the incoming clip alone.
        match steps(&tr, 0.6125).as_slice() {
            [Step::Mix(m), Step::Wash(_, a)] => assert!((m.incoming.unwrap().alpha - 0.95).abs() < 1e-4 && (*a - (1.0 - 1.2 * 25.0 / 750.0 / 1.2)).abs() < 1e-4),
            s => panic!("{s:?}"),
        }
        assert!(matches!(steps(&tr, 0.63).as_slice(), [Step::Wash(..)]));
        // Its tween starts 10 ms after its delay.
        assert!(matches!(steps(&tr, 0.379).as_slice(), [Step::Wash(..)]));
    }

    #[test]
    fn black_fade_goes_through_black() {
        let tr = tr("black_fade");
        assert_eq!(steps(&tr, 0.0), vec![Step::Wash([0, 0, 0, 255], 0.0)]);
        assert_eq!(steps(&tr, 0.25), vec![Step::Wash([0, 0, 0, 255], 0.5)]);
        assert_eq!(steps(&tr, 0.5), vec![Step::Wash([0, 0, 0, 255], 1.0)]);
        assert_eq!(steps(&tr, 0.875), vec![Step::Wash([0, 0, 0, 255], 0.25)]);
    }

    #[test]
    fn blink_closes_then_opens() {
        let tr = tr("blink");
        assert_eq!(steps(&tr, 0.0)[1], Step::Frame("/b/AmazingFeature/seq/1/1_001.png".into()));
        assert_eq!(steps(&tr, 0.5)[1], Step::Frame("/b/AmazingFeature/seq/1/1_0060.png".into()));
        assert_eq!(steps(&tr, 0.51)[1], Step::Frame("/b/AmazingFeature/seq/1/1_0062.png".into()));
        assert_eq!(steps(&tr, 1.0)[1], Step::Frame("/b/AmazingFeature/seq/1/1_00120.png".into()));
        // Blurred only near the closed eye.
        assert_eq!(steps(&tr, 0.1)[0], Step::Blur(0.0));
        assert!(matches!(steps(&tr, 0.49)[0], Step::Blur(b) if b > 1.0));
    }

    #[test]
    fn mix_cross_fades_across_the_window() {
        for p in [0.0, 0.25, 0.5, 0.9] {
            let m = mix("mix", p);
            assert_eq!(m.outgoing, Some(Shot::STILL));
            assert_eq!(m.incoming.map(|s| s.alpha), Some(p as f32));
            assert_eq!(m.mask, Mask::All);
        }
    }

    #[test]
    fn slide_brings_the_incoming_clip_over_the_still_one() {
        // Leftwards: from a canvas width to the right, halfway at the cut, home at the end.
        let x = |p: f64| mix("slide_left", p).incoming.unwrap().offset;
        assert_eq!(x(0.0), [1.0, 0.0]);
        assert_eq!(x(0.5), [0.5, 0.0]);
        assert_eq!(x(1.0), [0.0, 0.0]);
        assert!(x(0.25)[0] > 0.9 && x(0.75)[0] < 0.1, "eased: {:?} {:?}", x(0.25), x(0.75));
        assert_eq!(mix("slide_left", 0.3).outgoing, Some(Shot::STILL));
        // Upwards: from below.
        assert_eq!(mix("slide_up", 0.0).incoming.unwrap().offset, [0.0, 1.0]);
        assert_eq!(mix("slide_down", 0.0).incoming.unwrap().offset, [0.0, -1.0]);
    }

    #[test]
    fn push_moves_both_clips_together() {
        for p in [0.0, 0.3, 0.5, 0.8, 1.0] {
            let m = mix("push_right", p);
            let (a, b) = (m.outgoing.unwrap().offset, m.incoming.unwrap().offset);
            // The incoming clip stays a canvas width behind the outgoing one.
            assert!(close(a[0] - b[0], 1.0) && a[1] == 0.0 && b[1] == 0.0, "{p}: {a:?} {b:?}");
        }
        assert_eq!(mix("push_right", 0.5).outgoing.unwrap().offset, [0.5, 0.0]);
        assert_eq!(mix("push_down", 1.0).outgoing.unwrap().offset, [0.0, 1.0]);
    }

    #[test]
    fn wipe_edge_crosses_the_canvas() {
        let at = |p: f64| match mix("wipe_right", p).mask {
            Mask::Edge { toward, at, .. } => (toward, at),
            m => panic!("{m:?}"),
        };
        // Rightwards: the incoming clip on the left of an edge moving right, past both sides
        // at the ends, at the middle at the cut.
        assert_eq!(at(0.0).0, [-1.0, 0.0]);
        assert!(at(0.0).1 > 0.5 && at(1.0).1 < -0.5);
        assert!(close(at(0.5).1, 0.0));
    }

    #[test]
    fn circle_grows_from_the_centre() {
        let r = |p: f64| match mix("circle", p).mask {
            Mask::Circle { radius, .. } => radius,
            m => panic!("{m:?}"),
        };
        assert_eq!(r(0.0), 0.0);
        assert!(close(r(0.5), 0.6));
        // Past the corner of a 9:16 canvas (0.57 heights from the centre).
        assert!(r(1.0) > 0.58);
    }

    #[test]
    fn pull_in_zooms_through_the_cut() {
        // VerticalZoomNear.frag: the outgoing clip at 1 / (1 − T) until T = 0.5 (twice its
        // size), the incoming one from 1 / (2 − T) (two thirds) back to 1.
        let a = mix("pull_in", 0.25).outgoing.unwrap();
        let t = 16.0 * 0.25f64.powi(5);
        assert!(close(a.scale, (1.0 / (1.0 - t)) as f32) && close(a.zoom_blur, t as f32) && a.mirror);
        assert!(mix("pull_in", 0.25).incoming.is_none());
        let a = mix("pull_in", 0.4999).outgoing.unwrap();
        assert!((a.scale - 2.0).abs() < 1e-2);
        let b = mix("pull_in", 0.5001).incoming.unwrap();
        assert!((b.scale - 2.0 / 3.0).abs() < 1e-2);
        assert!(mix("pull_in", 0.5001).outgoing.is_none());
        let b = mix("pull_in", 1.0).incoming.unwrap();
        assert!(close(b.scale, 1.0) && close(b.zoom_blur, 0.0));
        // The blur is strongest at the cut.
        assert!((mix("pull_in", 0.5001).incoming.unwrap().zoom_blur - 0.5).abs() < 1e-2);
    }

    #[test]
    fn pull_out_is_pull_in_backwards() {
        let a = mix("pull_out", 0.4999).outgoing.unwrap();
        assert!((a.scale - 2.0 / 3.0).abs() < 1e-2);
        let b = mix("pull_out", 0.5001).incoming.unwrap();
        assert!((b.scale - 2.0).abs() < 1e-2);
        assert!(close(mix("pull_out", 1.0).incoming.unwrap().scale, 1.0));
        assert!(close(mix("pull_out", 0.0).outgoing.unwrap().scale, 1.0));
    }

    #[test]
    fn spin_turns_one_clip_out_and_the_other_in() {
        let a = mix("spin", 0.25).outgoing.unwrap();
        assert!(close(a.rotation, 90.0) && close(a.scale, 0.5));
        assert!(mix("spin", 0.25).incoming.is_none());
        let b = mix("spin", 0.75).incoming.unwrap();
        assert!(close(b.rotation, -90.0) && close(b.scale, 0.5));
        assert_eq!(mix("spin", 1.0).incoming.map(|s| (s.rotation, s.scale)), Some((0.0, 1.0)));
    }

    #[test]
    fn blur_peaks_at_the_cut() {
        let b = |p: f64| match steps(&tr("blur"), p).as_slice() {
            [Step::Blur(px)] => *px,
            s => panic!("{s:?}"),
        };
        assert_eq!((b(0.0), b(0.5), b(1.0)), (0.0, 6.0, 0.0));
        assert!(close(b(0.25), 3.0) && close(b(0.75), 3.0));
    }

    #[test]
    fn directions_come_from_the_name() {
        assert_eq!(split_direction("slide_left"), ("slide", Some(Direction::Left)));
        assert_eq!(split_direction("pull_in"), ("pull_in", None));
        assert_eq!(split_direction("white_flash"), ("white_flash", None));
    }
}
