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
