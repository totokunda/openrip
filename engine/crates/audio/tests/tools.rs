//! The Audio tab's tools through the mixer, on synthetic sound (no media files): channel fill,
//! keyframed volume followed sample by sample, OpenRip's own voice effects one after another,
//! and loudness normalisation from a measurement.

use std::path::Path;
use std::sync::{Arc, Once};

use openrip_audio::{add_audio_backend, loudness, AudioBackend, AudioError, AudioSource, Mixer, CHANNELS, RATE};
use openrip_model::*;

/// "synth:" files: a 440 Hz tone on the left and a 660 Hz one on the right, at 0.25, for
/// ever.
struct Synth;

struct Tones(u32);

impl AudioSource for Tones {
    fn read(&mut self, at: i64, out: &mut [f32]) -> Result<(), AudioError> {
        for (i, f) in out.chunks_exact_mut(CHANNELS).enumerate() {
            let t = (at + i as i64) as f64 / self.0 as f64;
            f[0] = (0.25 * (2.0 * std::f64::consts::PI * 440.0 * t).sin()) as f32;
            f[1] = (0.25 * (2.0 * std::f64::consts::PI * 660.0 * t).sin()) as f32;
        }
        Ok(())
    }

    fn end(&self) -> Option<i64> {
        None
    }
}

impl AudioBackend for Synth {
    fn open(&self, path: &Path, rate: u32) -> Result<Option<Box<dyn AudioSource>>, AudioError> {
        if path.to_string_lossy().starts_with("synth:") {
            Ok(Some(Box::new(Tones(rate))))
        } else {
            Err(AudioError::Other("not synthetic".into()))
        }
    }
}

fn install() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| add_audio_backend(Arc::new(Synth)));
}

/// One 2 s audio clip at the timeline's start, with `attachments` from `materials`.
fn project(materials: Materials, attachments: Vec<MaterialId>, volume: Animated<f32>) -> Project {
    install();
    let mut p = Project::new("p", "tools", Canvas { width: 16, height: 16 }, FrameRate::new(30, 1));
    p.materials = materials;
    p.materials.media.push(Media { id: "m".into(), kind: MediaKind::Audio, path: "synth:tones".into(), width: 0, height: 0, duration: Micros(60_000_000), has_audio: true, matte: None, reverse_path: None, freeze: None, complement_frame: None, smart_complement_frame: None });
    let seg = Segment {
        id: "s".into(),
        material: "m".into(),
        source: Some(TimeRange::new(Micros(0), Micros(2_000_000))),
        target: TimeRange::new(Micros(0), Micros(2_000_000)),
        speed: 1.0,
        reverse: false,
        change_pitch: false,
        visible: true,
        render_index: 0,
        transform: Transform::default(),
        crop: None,
        opacity: Animated::constant(1.0),
        volume,
        attachments,
        keyframes: vec![],
    };
    p.tracks.push(Track { id: "t".into(), kind: TrackKind::Audio, name: String::new(), segments: vec![seg], muted: false, hidden: false, locked: false });
    p
}

/// The first second of the mix, in blocks of `block` samples.
fn mix(p: Project, block: usize) -> Vec<f32> {
    let mut m = Mixer::new(p);
    let mut out = Vec::new();
    let mut buf = vec![0f32; block * CHANNELS];
    while out.len() < RATE as usize * CHANNELS {
        m.mix((out.len() / CHANNELS) as i64, &mut buf).unwrap();
        out.extend_from_slice(&buf);
    }
    out.truncate(RATE as usize * CHANNELS);
    out
}

fn channel(x: &[f32], c: usize) -> Vec<f32> {
    x.iter().skip(c).step_by(CHANNELS).copied().collect()
}

#[test]
fn channel_fill_copies_one_side_or_mixes_both() {
    let plain = mix(project(Materials::default(), vec![], Animated::constant(1.0)), 1024);
    let (l, r) = (channel(&plain, 0), channel(&plain, 1));
    let fill = |fill: ChannelFill| {
        let mut m = Materials::default();
        m.channels.push(ChannelMap { id: "c".into(), fill });
        mix(project(m, vec!["c".into()], Animated::constant(1.0)), 1024)
    };
    let left = fill(ChannelFill::Left);
    assert_eq!((channel(&left, 0), channel(&left, 1)), (l.clone(), l.clone()));
    let right = fill(ChannelFill::Right);
    assert_eq!((channel(&right, 0), channel(&right, 1)), (r.clone(), r.clone()));
    let mono = fill(ChannelFill::Mono);
    let mean: Vec<f32> = l.iter().zip(&r).map(|(a, b)| 0.5 * (a + b)).collect();
    assert_eq!((channel(&mono, 0), channel(&mono, 1)), (mean.clone(), mean));
    // None changes nothing.
    assert_eq!(fill(ChannelFill::None), plain);
}

#[test]
fn keyframed_volume_follows_its_curve_sample_by_sample() {
    // Silence until 0.5 s, then up to full in 50 ms, and an ease back down to half by 0.9 s.
    let key = |ms: i64, v: f32, ease: Easing| Keyframe { at: Micros(ms * 1000), value: v, ease };
    let curve = Easing::Bezier { x1: 0.42, y1: 0.0, x2: 0.58, y2: 1.0 };
    let volume = Animated { value: 1.0, keys: vec![key(500, 0.0, Easing::Linear), key(550, 1.0, curve), key(900, 0.5, Easing::Linear)] };
    let plain = mix(project(Materials::default(), vec![], Animated::constant(1.0)), 1024);
    // The same whatever the block size, so playback and export agree.
    let blocks: Vec<Vec<f32>> = [4096, 1024, 333].into_iter().map(|b| mix(project(Materials::default(), vec![], volume.clone()), b)).collect();
    assert_eq!(blocks[0], blocks[1]);
    assert_eq!(blocks[1], blocks[2]);
    // Each sample at the curve's value at its own time.
    for i in (0..RATE as usize).step_by(97) {
        let t = Micros((i as i128 * 1_000_000 / RATE as i128) as i64);
        let want = plain[i * CHANNELS] * volume.sample(t);
        assert!((blocks[0][i * CHANNELS] - want).abs() < 1e-6, "sample {i}");
    }
}

#[test]
fn voice_effects_play_one_after_another() {
    let fx = |id: &str, kind: &str, params: &[(&str, f64)]| Effect {
        id: id.into(),
        category: EffectCategory::Audio,
        name: kind.into(),
        params: params.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        builtin: Some(kind.into()),
        resource: None,
        library: None,
        text_style: None,
    };
    let plain = mix(project(Materials::default(), vec![], Animated::constant(1.0)), 1024);
    let rms = |x: &[f32]| (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt();
    // A low-pass under both tones takes them down; a high-pass under them alone doesn't.
    let mut m = Materials::default();
    m.effects.push(fx("lp", "lowpass", &[("frequency", 200.0)]));
    m.effects.push(fx("hp", "highpass", &[("frequency", 100.0)]));
    let low = mix(project(m.clone(), vec!["lp".into()], Animated::constant(1.0)), 1024);
    assert!(rms(&low[RATE as usize..]) < rms(&plain[RATE as usize..]) * 0.5);
    let high = mix(project(m.clone(), vec!["hp".into()], Animated::constant(1.0)), 1024);
    assert!((rms(&high[RATE as usize..]) / rms(&plain[RATE as usize..]) - 1.0).abs() < 0.05);
    // Both, in order: as the low-pass alone (the high-pass passes what's left).
    let both = mix(project(m.clone(), vec!["hp".into(), "lp".into()], Animated::constant(1.0)), 1024);
    assert!((rms(&both[RATE as usize..]) / rms(&low[RATE as usize..]) - 1.0).abs() < 0.1);
    // A kind there isn't: the clip plays dry and the mixer says so.
    m.effects.push(fx("x", "teleport", &[]));
    let mut mixer = Mixer::new(project(m, vec!["x".into()], Animated::constant(1.0)));
    let mut buf = vec![0f32; 1024 * CHANNELS];
    let report = mixer.mix(0, &mut buf).unwrap();
    assert!(report.missing.iter().any(|w| w.contains("teleport")));
    assert_eq!(buf, plain[..1024 * CHANNELS]);
}

#[test]
fn a_pitch_shift_lines_up_with_the_clip() {
    // The phase vocoder runs ahead by its latency: its output starts with the clip, not 43 ms
    // late (the tone is there from the first block on, at close to its level).
    let mut m = Materials::default();
    m.effects.push(Effect { id: "p".into(), category: EffectCategory::Audio, name: String::new(), params: [("semitones".to_string(), -5.0)].into(), builtin: Some("pitch".into()), resource: None, library: None, text_style: None });
    let out = mix(project(m, vec!["p".into()], Animated::constant(1.0)), 1024);
    let rms = |x: &[f32]| (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt();
    assert!(rms(&out[2048 * CHANNELS..4096 * CHANNELS]) > 0.1);
}

#[test]
fn normalising_takes_a_measured_clip_to_the_target() {
    // The loudness of the clip's first second, then a material asking for −23 LUFS: the
    // mix reads −23.
    install();
    let measured = loudness::measure_file(Path::new("synth:tones"), Micros(0), Some(Micros(1_000_000))).unwrap().unwrap();
    let mut m = Materials::default();
    m.loudness.push(Loudness { id: "l".into(), enabled: true, target: -23.0, measured: measured.integrated, peak: measured.peak });
    let out = mix(project(m, vec!["l".into()], Animated::constant(1.0)), 1024);
    let mut meter = loudness::Meter::new(RATE);
    meter.push(&out);
    let got = meter.finish().integrated.unwrap();
    assert!((got + 23.0).abs() < 0.01, "{got} LUFS");
}
