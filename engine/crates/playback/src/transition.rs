//! Transitions OpenRip draws itself, between a clip and the next one on its track.
//!
//! The behaviour is CapCut's, read from the scripts it downloads with each transition and
//! checked against exports (docs/parity/transitions.md). A transition runs from half its
//! duration before the cut to half after it. The outgoing clip plays up to the cut and the
//! incoming one from it, each drawn as usual, and the transition works on the canvas over
//! them. (An overlapping transition also mixes the two clips; the one drawn so far does that
//! under almost full white, and OpenRip switches at the cut instead.)

use openrip_model::{Micros, Project, Segment, Transition};

/// The transition a clip is in at `t`, and how far through it (0 to 1, the cut at 0.5). A
/// transition is drawn only where a clip on the same track starts as the one with it ends.
pub fn transition_at<'a>(project: &'a Project, seg: &Segment, t: Micros) -> Option<(&'a Transition, f64)> {
    let of = |s: &Segment| s.attachments.iter().find_map(|id| project.materials.transitions.iter().find(|tr| &tr.id == id && tr.builtin.is_some() && tr.duration.0 > 0));
    let progress = |tr: &Transition, cut: i64| (t.0 - (cut - tr.duration.0 / 2)) as f64 / tr.duration.0 as f64;
    let track = project.tracks.iter().find(|tr| tr.segments.iter().any(|s| s.id == seg.id))?;
    let meets = |a: &Segment, b: &Segment| a.id != b.id && (a.target.end().0 - b.target.start.0).abs() <= 1_000;
    // Into the cut at the end of this clip.
    if let Some(tr) = of(seg).filter(|_| track.segments.iter().any(|s| meets(seg, s))) {
        let p = progress(tr, seg.target.end().0);
        if (0.0..0.5).contains(&p) {
            return Some((tr, p));
        }
    }
    // Out of the cut at its start, from the clip before it on its track.
    let before = track.segments.iter().filter(|s| meets(s, seg)).max_by_key(|s| s.target.start)?;
    let tr = of(before)?;
    let p = progress(tr, seg.target.start.0);
    (0.5..=1.0).contains(&p).then_some((tr, p))
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
}

pub fn steps(tr: &Transition, p: f64) -> Vec<Step> {
    match tr.builtin.as_deref() {
        // White Flash (SeekModeScript.lua): the frame mixed towards white, linearly to all
        // white at the cut and back.
        Some("white_flash") => {
            let amount = if p < 0.5 { 2.0 * p } else { 2.0 * (1.0 - p) };
            vec![Step::Wash([255, 255, 255, 255], amount.clamp(0.0, 1.0) as f32)]
        }
        // White Fade (scriptScene.js, a 2 s timeline): white rises linearly from 50 to 800 ms,
        // holds to 1200 ms and falls by 1950 ms; the clips cross-fade from 750 to 1250 ms,
        // under at least 93% white.
        Some("white_fade") => {
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
            vec![Step::Wash([255, 255, 255, 255], ((brightness - 1.0) / 1.2).clamp(0.0, 1.0) as f32)]
        }
        // Blink (Set.lua): an eyelid sequence of 120 frames, closing over the outgoing clip
        // and opening over the incoming one, over the clip blurred near the closed eye.
        Some("blink") => {
            let Some(bundle) = &tr.resource else { return Vec::new() };
            let (q, first) = if p <= 0.5 { (p * 2.0, true) } else { ((p - 0.5) * 2.0, false) };
            let frame = if first { ((q * 60.0).floor() as u32 + 1).min(60) } else { ((q * 60.0).floor() as u32 + 61).min(120) };
            let open = if first { q } else { 1.0 - q };
            let blur = if open > 0.6 { 3.0 * (open - 0.6) } else { 0.0 };
            // The shader's taps are 1.25 × the blur size apart, in the input's pixels.
            let mut out = vec![Step::Blur((1.25 * blur) as f32)];
            out.push(Step::Frame(format!("{bundle}/AmazingFeature/seq/1/1_00{frame}.png")));
            out
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
        p.materials.transitions.push(Transition { id: MaterialId("tr".into()), name: String::new(), duration: Micros(500_000), overlap: false, builtin: Some(builtin.into()), library: None, resource: Some("/b".into()) });
        p
    }

    #[test]
    fn a_transition_spans_the_cut() {
        let p = project("white_flash");
        let (a, b) = (&p.tracks[0].segments[0], &p.tracks[0].segments[1]);
        assert!(transition_at(&p, a, Micros(1_700_000)).is_none());
        assert_eq!(transition_at(&p, a, Micros(1_850_000)).map(|x| x.1), Some(0.2));
        assert_eq!(transition_at(&p, b, Micros(2_000_000)).map(|x| x.1), Some(0.5));
        assert_eq!(transition_at(&p, b, Micros(2_150_000)).map(|x| x.1), Some(0.8));
        assert!(transition_at(&p, b, Micros(2_300_000)).is_none());
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
        let p = project("white_flash");
        let tr = &p.materials.transitions[0];
        assert_eq!(steps(tr, 0.25), vec![Step::Wash([255; 4], 0.5)]);
        assert_eq!(steps(tr, 0.5), vec![Step::Wash([255; 4], 1.0)]);
    }

    #[test]
    fn blink_closes_then_opens() {
        let p = project("blink");
        let tr = &p.materials.transitions[0];
        assert_eq!(steps(tr, 0.0)[1], Step::Frame("/b/AmazingFeature/seq/1/1_001.png".into()));
        assert_eq!(steps(tr, 0.5)[1], Step::Frame("/b/AmazingFeature/seq/1/1_0060.png".into()));
        assert_eq!(steps(tr, 0.51)[1], Step::Frame("/b/AmazingFeature/seq/1/1_0062.png".into()));
        assert_eq!(steps(tr, 1.0)[1], Step::Frame("/b/AmazingFeature/seq/1/1_00120.png".into()));
        // Blurred only near the closed eye.
        assert_eq!(steps(tr, 0.1)[0], Step::Blur(0.0));
        assert!(matches!(steps(tr, 0.49)[0], Step::Blur(b) if b > 1.0));
    }
}
