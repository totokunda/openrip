//! Scrub audio: short faded snippets of the mix at the playhead, through a fake output that the
//! test drives by hand. Uses a tone made with the `ffmpeg` CLI (tests skip without it).

use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use openrip_model::{Micros, Project};
use openrip_playback::output::{AudioOutput, Fill, OutputStream};
use openrip_playback::{Player, PlayerError};

const RATE: u32 = 48_000;

/// An output with no device: it keeps the fill callback for the test to call.
struct Fake(Arc<Mutex<Option<Fill>>>);

impl AudioOutput for Fake {
    fn start(&self, fill: Fill) -> Result<(OutputStream, u32), PlayerError> {
        *self.0.lock().unwrap() = Some(fill);
        Ok((OutputStream::new(()), RATE))
    }
}

fn tone() -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("ffmpeg not found; skipping");
        return None;
    }
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("scrub-tone.wav");
    if !path.exists() {
        let st = Command::new("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=4:r=48000", "-ac", "2"]).arg(&path).status().unwrap();
        assert!(st.success());
    }
    Some(path)
}

/// A tone from 0 to 2 s on the timeline, then nothing.
fn project(path: &str) -> Project {
    serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "scrub audio", "canvas": { "width": 16, "height": 16 }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "audio", "segments": [{
            "id": "s", "material": "m", "source": { "start": 0, "duration": 2000000 }, "target": { "start": 0, "duration": 2000000 },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        }]}],
        "materials": { "media": [{ "id": "m", "kind": "audio", "path": path, "duration": 4000000, "has_audio": true }] }
    }))
    .unwrap()
}

/// Pull `frames` frames out of the fake device, waiting for the mixer thread to fill the ring
/// first (as the real device would simply play what is there).
fn play_out(fill: &Arc<Mutex<Option<Fill>>>, frames: usize) -> Vec<f32> {
    std::thread::sleep(Duration::from_millis(250));
    let mut out = vec![0f32; frames * 2];
    for chunk in out.chunks_mut(512 * 2) {
        (fill.lock().unwrap().as_mut().unwrap())(chunk, 2, Duration::ZERO);
    }
    out
}

fn open(path: &str) -> (Player, Arc<Mutex<Option<Fill>>>) {
    let fill = Arc::new(Mutex::new(None));
    let player = Player::with_output(project(path), &Fake(fill.clone())).unwrap();
    (player, fill)
}

fn peak(v: &[f32]) -> f32 {
    v.iter().fold(0f32, |m, x| m.max(x.abs()))
}

#[test]
fn a_snippet_is_the_tone_with_faded_ends_and_then_silence() {
    let Some(path) = tone() else { return };
    let (player, fill) = open(path.to_str().unwrap());
    assert!(player.scrub(Micros(500_000)));
    let out = play_out(&fill, 8192);
    let left: Vec<f32> = out.iter().step_by(2).copied().collect();
    let grain = 70 * RATE as usize / 1000;
    // Full level (the tone is 0.125, less the mixer's pan law) in the middle, nearly nothing at the very ends.
    assert!(peak(&left[grain / 2 - 200..grain / 2 + 200]) > 0.08, "middle {}", peak(&left[grain / 2 - 200..grain / 2 + 200]));
    assert!(left[0].abs() < 0.005 && left[grain - 1].abs() < 0.005, "ends {} {}", left[0], left[grain - 1]);
    // The first 8 ms ramp up, and the last 8 ms ramp down.
    assert!(peak(&left[..48]) < 0.06 && peak(&left[grain - 48..grain]) < 0.06);
    // Then it is over: silence, and the stats saw it.
    assert_eq!(peak(&left[grain + 100..]), 0.0);
    let s = player.scrub_stats();
    assert_eq!(s.snippets, 1);
    assert_eq!(s.last_us, 500_000);
    assert!(s.peaks[0] > 0.08 && s.peaks[1] > 0.08, "{:?}", s.peaks);
    assert!(!player.is_playing(), "the device is left quiet");
}

#[test]
fn a_snippet_where_nothing_sounds_is_silent_and_a_new_one_replaces_it() {
    let Some(path) = tone() else { return };
    let (player, fill) = open(path.to_str().unwrap());
    // 3 s is past the end of the clip.
    assert!(player.scrub(Micros(3_000_000)));
    // Rate limit: one straight after another is dropped; after the gap the newest wins.
    assert!(!player.scrub(Micros(1_000_000)));
    assert_eq!(peak(&play_out(&fill, 4096)), 0.0);
    assert_eq!(player.scrub_stats().peaks, [0.0, 0.0]);
    std::thread::sleep(Duration::from_millis(40));
    assert!(player.scrub(Micros(1_000_000)));
    assert!(peak(&play_out(&fill, 4096)) > 0.08);
    assert_eq!(player.scrub_stats().snippets, 2);
    assert_eq!(player.scrub_stats().last_us, 1_000_000);
}

#[test]
fn stopping_cuts_the_snippet_and_playback_is_left_alone() {
    let Some(path) = tone() else { return };
    let (player, fill) = open(path.to_str().unwrap());
    assert!(player.scrub(Micros(500_000)));
    player.scrub_stop();
    assert_eq!(peak(&play_out(&fill, 4096)), 0.0);
    // Real playback is never replaced by a snippet.
    std::thread::sleep(Duration::from_millis(40));
    player.play(Micros(0));
    assert!(!player.scrub(Micros(800_000)));
    player.scrub_stop();
    assert!(player.is_playing());
    assert_eq!(player.scrub_stats().snippets, 1);
}
