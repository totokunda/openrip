//! The mixer against CapCut's rules (calibration session 1): muted and hidden tracks are
//! silent; volume scales; the clip's audio lands sample-exact at its timeline position.

use std::path::PathBuf;
use std::process::Command;

use openrip_audio::{AudioDecoder, Mixer, CHANNELS, RATE};
use openrip_model::Project;

fn noise() -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        return None;
    }
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("mixer-noise.wav");
    if !path.exists() {
        let st = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=3:c=white:r=48000:a=0.3:seed=7", "-ac", "2"])
            .arg(&path)
            .status()
            .unwrap();
        assert!(st.success());
    }
    Some(path)
}

fn project(path: &str, tracks: &[(bool, bool, f32)]) -> Project {
    let tracks: Vec<_> = tracks
        .iter()
        .enumerate()
        .map(|(i, (muted, hidden, volume))| {
            serde_json::json!({ "id": format!("t{i}"), "kind": "audio", "muted": muted, "hidden": hidden, "segments": [{
                "id": format!("s{i}"), "material": "m", "source": { "start": 500000, "duration": 1000000 }, "target": { "start": 1000000, "duration": 1000000 },
                "speed": 1.0, "visible": true, "render_index": 0,
                "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
                "opacity": { "value": 1.0 }, "volume": { "value": volume }
            }]})
        })
        .collect();
    serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "mixer test", "canvas": { "width": 16, "height": 16 }, "fps": { "num": 30, "den": 1 },
        "tracks": tracks,
        "materials": { "media": [{ "id": "m", "kind": "audio", "path": path, "duration": 3000000, "has_audio": true }] }
    }))
    .unwrap()
}

fn mix(p: Project) -> Vec<f32> {
    let mut m = Mixer::new(p);
    let mut out = vec![0f32; 3 * RATE as usize * CHANNELS];
    m.mix(0, &mut out).unwrap();
    out
}

#[test]
fn muted_and_hidden_tracks_are_silent_and_volume_scales() {
    let Some(path) = noise() else { return };
    let path = path.to_str().unwrap();
    let one = mix(project(path, &[(false, false, 1.0)]));
    // Session 1: three identical tracks, one muted, one hidden -> exactly one copy.
    let three = mix(project(path, &[(true, false, 1.0), (false, true, 1.0), (false, false, 1.0)]));
    assert_eq!(one, three);
    let half = mix(project(path, &[(false, false, 0.5)]));
    for (a, b) in one.iter().zip(&half) {
        assert!((a * 0.5 - b).abs() < 1e-6);
    }
}

#[test]
fn clip_audio_lands_sample_exact() {
    let Some(path) = noise() else { return };
    let out = mix(project(path.to_str().unwrap(), &[(false, false, 1.0)]));
    let mut src = vec![0f32; RATE as usize * CHANNELS];
    AudioDecoder::open(&path, RATE).unwrap().unwrap().read(RATE as i64 / 2, &mut src).unwrap();
    let at = RATE as usize * CHANNELS; // timeline 1 s
    assert!(out[..at].iter().all(|v| *v == 0.0), "silence before the clip");
    assert_eq!(&out[at..at + src.len()], &src[..], "source 0.5 s .. 1.5 s at timeline 1 s");
    assert!(out[at + src.len()..].iter().all(|v| *v == 0.0), "silence after the clip");
}

/// A tone's frequency from zero crossings.
fn frequency(x: &[f32], rate: u32) -> f64 {
    let crossings = x.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
    crossings as f64 * rate as f64 / x.len() as f64
}

#[test]
fn speed_keeps_pitch_unless_asked_not_to() {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        return;
    }
    let tone = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("mixer-tone.wav");
    if !tone.exists() {
        let st = Command::new("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=4:r=48000", "-ac", "2"]).arg(&tone).status().unwrap();
        assert!(st.success());
    }
    for (change_pitch, want) in [(false, 440.0), (true, 660.0)] {
        let mut p = project(tone.to_str().unwrap(), &[(false, false, 1.0)]);
        let seg = &mut p.tracks[0].segments[0];
        seg.speed = 1.5;
        seg.change_pitch = change_pitch;
        seg.source = Some(openrip_model::TimeRange::new(openrip_model::Micros(0), openrip_model::Micros(1_500_000)));
        let mut m = Mixer::new(p);
        // Mix in small blocks, as playback does, from timeline 1.2 s for 0.6 s.
        let mut left = Vec::new();
        let mut block = vec![0f32; 1024 * CHANNELS];
        let start = (1.2 * RATE as f64) as i64;
        for i in 0..28 {
            m.mix(start + i * 1024, &mut block).unwrap();
            left.extend(block.iter().step_by(2));
        }
        let f = frequency(&left, RATE);
        assert!((f - want).abs() < want * 0.03, "change_pitch={change_pitch}: {f:.1} Hz, want {want}");
    }
}

/// A 440 Hz tone, 8 s.
fn tone() -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        return None;
    }
    let tone = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("mixer-tone-8s.wav");
    if !tone.exists() {
        // Each test writes its own copy and moves it in (tests run at once).
        let tmp = tone.with_extension(format!("{:?}.wav", std::thread::current().id()).replace(['(', ')', ' '], ""));
        let st = Command::new("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=8:r=48000", "-ac", "2"]).arg(&tmp).status().unwrap();
        assert!(st.success());
        std::fs::rename(tmp, &tone).unwrap();
    }
    Some(tone)
}

/// Mix `p` from timeline `from` for `seconds`, in playback-sized blocks; the left channel.
fn mix_left(p: Project, from: f64, seconds: f64) -> Vec<f32> {
    let mut m = Mixer::new(p);
    let mut left = Vec::new();
    let mut block = vec![0f32; 1024 * CHANNELS];
    let start = (from * RATE as f64) as i64;
    for i in 0..(seconds * RATE as f64 / 1024.0) as i64 {
        m.mix(start + i * 1024, &mut block).unwrap();
        left.extend(block.iter().step_by(2));
    }
    left
}

#[test]
fn a_speed_curve_plays_varispeed_as_capcuts_does() {
    let Some(tone) = tone() else { return };
    // Flash Out: 1× for the first 40% of the source, 5.2× from 60%; 4 s of source.
    let pts = openrip_model::speed::CURVE_PRESETS.iter().find(|c| c.name == "Flash Out").unwrap().points.to_vec();
    let remap = openrip_model::Remap::new(&pts).unwrap();
    for change_pitch in [false, true] {
        let mut p = project(tone.to_str().unwrap(), &[(false, false, 1.0)]);
        p.materials.speeds.push(openrip_model::Speed { id: openrip_model::MaterialId("sp".into()), speed: remap.average(), curve: pts.clone(), preset: None });
        let seg = &mut p.tracks[0].segments[0];
        seg.attachments.push(openrip_model::MaterialId("sp".into()));
        seg.change_pitch = change_pitch;
        seg.source = Some(openrip_model::TimeRange::new(openrip_model::Micros(0), openrip_model::Micros(4_000_000)));
        seg.target.duration = openrip_model::Micros(remap.output_length(4_000_000));
        let length = seg.target.duration.as_secs_f64();
        // The pitch follows the speed either way ("change pitch" doesn't apply to a curve):
        // 440 Hz where it's 1×, 5.2 × 440 Hz at the end.
        let slow = mix_left(p.clone(), 1.05, 0.3);
        assert!((frequency(&slow, RATE) - 440.0).abs() < 440.0 * 0.03, "change_pitch={change_pitch}: start {:.1} Hz", frequency(&slow, RATE));
        let fast = mix_left(p, 1.0 + length - 0.25, 0.2);
        assert!((frequency(&fast, RATE) - 5.2 * 440.0).abs() < 5.2 * 440.0 * 0.03, "change_pitch={change_pitch}: end {:.1} Hz", frequency(&fast, RATE));
    }
}

#[test]
fn a_reversed_clip_with_a_speed_keeps_its_pitch() {
    let Some(tone) = tone() else { return };
    for (change_pitch, want) in [(false, 440.0), (true, 660.0)] {
        let mut p = project(tone.to_str().unwrap(), &[(false, false, 1.0)]);
        let seg = &mut p.tracks[0].segments[0];
        seg.reverse = true;
        seg.speed = 1.5;
        seg.change_pitch = change_pitch;
        seg.source = Some(openrip_model::TimeRange::new(openrip_model::Micros(0), openrip_model::Micros(1_500_000)));
        let f = frequency(&mix_left(p, 1.2, 0.6), RATE);
        assert!((f - want).abs() < want * 0.03, "change_pitch={change_pitch}: {f:.1} Hz, want {want}");
    }
}

#[test]
fn reversed_clips_play_their_audio_backwards() {
    let Some(path) = noise() else { return };
    let mut p = project(path.to_str().unwrap(), &[(false, false, 1.0)]);
    p.tracks[0].segments[0].reverse = true;
    let mut m = Mixer::new(p);
    // Mix the clip (timeline 1..2 s) in playback-sized blocks.
    let mut out = Vec::new();
    let mut block = vec![0f32; 1024 * CHANNELS];
    let (from, to) = (RATE as i64, 2 * RATE as i64);
    let mut at = from;
    while at < to {
        m.mix(at, &mut block).unwrap();
        out.extend_from_slice(&block);
        at += 1024;
    }
    // Source 0.5..1.5 s, forwards.
    let mut src = vec![0f32; RATE as usize * CHANNELS];
    AudioDecoder::open(&path, RATE).unwrap().unwrap().read(RATE as i64 / 2, &mut src).unwrap();
    let frames = RATE as usize;
    for i in (0..frames).step_by(997) {
        for c in 0..CHANNELS {
            assert_eq!(out[i * CHANNELS + c], src[(frames - 1 - i) * CHANNELS + c], "frame {i}");
        }
    }
}

#[test]
fn loudness_normalisation_turns_the_clip_to_the_target() {
    let Some(path) = noise() else { return };
    let plain = mix(project(path.to_str().unwrap(), &[(false, false, 1.0)]));
    let with = |measured: f32, peak: f32| {
        let mut p = project(path.to_str().unwrap(), &[(false, false, 1.0)]);
        p.materials.loudness.push(openrip_model::Loudness { id: openrip_model::MaterialId("L".into()), enabled: true, target: -23.0, measured: Some(measured), peak });
        p.tracks[0].segments[0].attachments.push(openrip_model::MaterialId("L".into()));
        mix(p)
    };
    let ratio = |a: &[f32], b: &[f32]| {
        let e = |v: &[f32]| v.iter().map(|x| (*x as f64).powi(2)).sum::<f64>();
        (e(a) / e(b)).sqrt()
    };
    // Measured -36 LUFS, peak -18 dBFS: +13 dB.
    assert!((ratio(&with(-36.0, -18.0), &plain) - 10f64.powf(13.0 / 20.0)).abs() < 1e-3);
    // Peak -6 dBFS: held to +6 dB so the peak stays below full scale.
    assert!((ratio(&with(-36.0, -6.0), &plain) - 10f64.powf(6.0 / 20.0)).abs() < 1e-3);
    // Louder than the target: turned down.
    assert!((ratio(&with(-13.0, -1.0), &plain) - 10f64.powf(-10.0 / 20.0)).abs() < 1e-3);
}

/// A compound clip plays its content's sound where the clip reads it, cut to the part the clip
/// shows, at the clip's volume.
#[test]
fn a_compound_plays_its_contents_sound_inside_its_clip() {
    let Some(path) = noise() else { return };
    let plain = mix(project(path.to_str().unwrap(), &[(false, false, 1.0)]));
    let inner = project(path.to_str().unwrap(), &[(false, false, 1.0)]);
    let compound = |source_start: i64, volume: f32| {
        let mut p = inner.clone();
        p.materials.compounds.push(openrip_model::Compound { id: "c".into(), name: String::new(), tracks: std::mem::take(&mut p.tracks) });
        let mut clip = serde_json::json!({ "id": "outer", "material": "c", "source": { "start": source_start, "duration": 2500000 }, "target": { "start": 500000, "duration": 2500000 },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": volume } });
        clip["attachments"] = serde_json::json!([]);
        p.tracks.push(serde_json::from_value(serde_json::json!({ "id": "main", "kind": "video", "segments": [clip] })).unwrap());
        mix(p)
    };
    // Read from the content's 0: it plays half a second later than it is in the content.
    let out = compound(0, 1.0);
    let shift = RATE as usize / 2 * CHANNELS;
    let (start, end) = (RATE as usize * CHANNELS, 2 * RATE as usize * CHANNELS);
    assert_eq!(&out[start + shift..end + shift], &plain[start..end]);
    assert!(out[..start + shift].iter().all(|v| *v == 0.0));
    // Read from 1.25 s: the content's sound, which starts at 1 s, is cut at its head.
    let trimmed = compound(1_250_000, 1.0);
    let head = (RATE as usize / 4) * CHANNELS;
    assert!(trimmed[..RATE as usize / 2 * CHANNELS].iter().all(|v| *v == 0.0));
    assert_eq!(&trimmed[RATE as usize / 2 * CHANNELS..RATE as usize / 2 * CHANNELS + 1000], &plain[start + head..start + head + 1000]);
    // The clip's volume.
    let half = compound(0, 0.5);
    for (a, b) in out.iter().zip(&half) {
        assert!((a * 0.5 - b).abs() < 1e-6);
    }
}
