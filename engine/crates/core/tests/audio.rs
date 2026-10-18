//! The Audio tab's engine calls end to end: a voiceover recorded from the stand-in
//! microphone (nothing real is recorded), measured for loudness, and a song's beats found and
//! kept in the cache folder.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use openrip_core::{measure_loudness, set_audio_input, Micros, Recorder, Thumbnails, ToneInput};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("openrip-core-audio-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A 16-bit mono WAV of clicks at 120 BPM for `secs`.
fn clicks(path: &Path, secs: f64) {
    let rate = 44_100u32;
    let n = (secs * rate as f64) as usize;
    let mut x = vec![0i16; n];
    let mut t = 0.5;
    while t < secs - 0.1 {
        let s = (t * rate as f64) as usize;
        for i in 0..1000 {
            let env = (-(i as f64) / 200.0).exp();
            x[s + i] = (12000.0 * env * if i % 2 == 0 { 1.0 } else { -1.0 }) as i16;
        }
        t += 0.5;
    }
    let mut b = Vec::new();
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + n as u32 * 2).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * 2).to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&(n as u32 * 2).to_le_bytes());
    for v in x {
        b.extend_from_slice(&v.to_le_bytes());
    }
    std::fs::write(path, b).unwrap();
}

#[test]
fn a_voiceover_from_the_stand_in_microphone_is_a_file_the_engine_reads() {
    set_audio_input(Arc::new(ToneInput));
    let dir = scratch("voiceover");
    let path = dir.join("Voiceover 1.wav");
    let rec = Recorder::start(&path).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(600));
    let level = rec.level();
    let done = rec.stop().unwrap();
    // About as long as it ran, and as loud as the tone.
    assert!(done.duration_us() > 400_000 && done.duration_us() < 900_000, "{}", done.duration_us());
    assert!((level.peak - 0.25).abs() < 0.01, "{level:?}");
    let l = measure_loudness(&path, Micros(0), None).unwrap().unwrap();
    assert!(l.integrated.is_some_and(|v| v < -10.0 && v > -25.0), "{l:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn beats_are_found_once_and_kept() {
    let dir = scratch("beats");
    let song = dir.join("clicks.wav");
    clicks(&song, 12.0);
    let thumbs = Thumbnails::new();
    thumbs.set_cache_dir(dir.join("cache"));
    let first = thumbs.beats(&song).unwrap().unwrap();
    assert!((first.bpm - 120.0).abs() < 1.5, "{}", first.bpm);
    assert!(first.beats.len() >= 20, "{}", first.beats.len());
    // The second answer comes from the cache folder, the same.
    let cached = std::fs::read_dir(dir.join("cache")).unwrap().count();
    assert_eq!(cached, 1);
    assert_eq!(thumbs.beats(&song).unwrap().unwrap(), first);
    let _ = std::fs::remove_dir_all(&dir);
}
