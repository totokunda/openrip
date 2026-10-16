//! Waveform peaks of generated tones (made with the `ffmpeg` CLI; tests skip without it).

use std::path::PathBuf;
use std::process::Command;

use openrip_audio::peaks;

fn tone() -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        return None;
    }
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("peaks-sine-stereo.m4a");
    if !path.exists() {
        // 1 kHz at the default amplitude (1/8), 1.25 s, then AAC like a phone recording.
        let st = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=1.25", "-af", "pan=stereo|c0=c0|c1=c0", "-c:a", "aac", "-b:a", "192k"])
            .arg(&path)
            .status()
            .unwrap();
        assert!(st.success());
    }
    Some(path)
}

#[test]
fn a_tone_has_its_peak_and_rms_in_every_bucket() {
    let Some(path) = tone() else { return };
    let p = peaks(&path, 100).unwrap().unwrap();
    // AAC adds priming/padding; the stream is 1.25 s give or take a frame.
    assert!((125..=128).contains(&p.peak.len()), "{} buckets", p.peak.len());
    assert_eq!(p.peak.len(), p.rms.len());
    // Inside the tone (away from the encoder's edges): peak 1/8, RMS 1/8 / sqrt 2.
    for i in 5..120 {
        assert!((p.peak[i] - 0.125).abs() < 0.01, "bucket {i}: peak {}", p.peak[i]);
        assert!((p.rms[i] - 0.125 / 2f32.sqrt()).abs() < 0.005, "bucket {i}: rms {}", p.rms[i]);
    }
}

#[test]
fn buckets_must_divide_the_rate() {
    let Some(path) = tone() else { return };
    assert!(peaks(&path, 7).is_err());
}
