//! Speech recognition end to end: a sentence spoken by macOS's `say`, decoded through the
//! audio seam, recognized by whisper.cpp's tiny model and cut into captions.
//!
//! Needs the `whisper` and `ffmpeg` features, macOS (`say` makes the fixture) and the tiny
//! model: `$OPENRIP_SPEECH_MODEL` (a file), else `ggml-tiny.bin` in `$OPENRIP_MODELS`. With
//! `OPENRIP_TEST_DOWNLOAD=1` it fetches the model into that folder first (78 MB, from
//! Hugging Face, checked against the catalog's SHA-256); without it a missing model skips
//! the test, so `cargo test --workspace` stays offline.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use openrip_core::{build_captions, models, transcribe, CaptionOptions, Micros, SpeechControl, SpeechInput};

fn model() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("OPENRIP_SPEECH_MODEL") {
        return Some(PathBuf::from(p)).filter(|p| p.is_file());
    }
    let dir = PathBuf::from(std::env::var("OPENRIP_MODELS").ok()?);
    let tiny = models::find("tiny").unwrap();
    let path = dir.join(tiny.file);
    if !path.is_file() && std::env::var_os("OPENRIP_TEST_DOWNLOAD").is_some() {
        std::fs::create_dir_all(&dir).ok()?;
        let ok = Command::new("curl").args(["-L", "--fail", "-s", "-o"]).arg(&path).arg(models::url(tiny)).status().ok()?.success();
        let sum = Command::new("shasum").args(["-a", "256"]).arg(&path).output().ok()?;
        if !ok || !String::from_utf8_lossy(&sum.stdout).starts_with(tiny.sha256) {
            let _ = std::fs::remove_file(&path);
            panic!("downloading the tiny model failed or its checksum is wrong");
        }
    }
    path.is_file().then_some(path)
}

fn say(text: &str, to: &Path) -> bool {
    Command::new("say").args(["-v", "Samantha", "-o"]).arg(to).arg(text).status().is_ok_and(|s| s.success())
}

#[test]
fn spoken_sentences_become_timed_captions() {
    let Some(model) = model() else {
        eprintln!("skipped: no tiny model (set OPENRIP_MODELS, and OPENRIP_TEST_DOWNLOAD=1 to fetch it)");
        return;
    };
    let dir = std::env::temp_dir().join(format!("openrip-speech-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("speech.aiff");
    let said = "The quick brown fox jumps over the lazy dog. Please call Stella and ask her to bring these things with her from the store.";
    if !say(said, &file) {
        eprintln!("skipped: no `say` to make the fixture");
        return;
    }
    let control = Arc::new(SpeechControl::new());
    let t = transcribe(SpeechInput::File { path: &file, start: Micros::ZERO, duration: None }, model, Some("en".into()), &control).expect("transcribes");
    assert_eq!(control.percent(), 100);
    assert_eq!(t.language, "en");

    // The words are the ones said (a word or two wrong is allowed of a tiny model).
    let norm = |s: &str| s.split_whitespace().map(|w| w.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()).filter(|w| !w.is_empty()).collect::<Vec<_>>();
    let (want, got) = (norm(said), norm(&t.text()));
    let common = want.iter().filter(|w| got.contains(w)).count();
    assert!(common as f64 >= want.len() as f64 * 0.85, "heard {got:?}");

    // Times run forward, start after the lead-in and stay inside the recording.
    let words: Vec<_> = t.words().collect();
    assert!(words.windows(2).all(|p| p[0].end_us <= p[1].start_us), "{words:?}");
    assert!(words.iter().all(|w| w.end_us > w.start_us));
    assert!(words[0].start_us < 1_000_000);

    // The captions cover every word, in order, with word ranges that spell the caption.
    let captions = build_captions(&t, &CaptionOptions::default());
    assert!(captions.len() >= 2, "{captions:?}");
    for c in &captions {
        let chars: Vec<char> = c.text.chars().collect();
        for w in &c.words {
            assert!(w.range.1 as usize <= chars.len() && w.range.0 < w.range.1);
            assert!(w.start_us >= 0 && w.end_us >= w.start_us);
        }
        assert!(c.end_us > c.start_us);
    }
    assert_eq!(captions.iter().map(|c| c.words.len()).sum::<usize>(), words.len());

    // Cancelling stops it.
    let stop = Arc::new(SpeechControl::new());
    stop.cancel();
    let model = std::env::var("OPENRIP_SPEECH_MODEL").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(std::env::var("OPENRIP_MODELS").unwrap()).join("ggml-tiny.bin"));
    let err = transcribe(SpeechInput::File { path: &file, start: Micros::ZERO, duration: None }, model, None, &stop).unwrap_err();
    assert_eq!(err.to_string(), "cancelled");
    let _ = std::fs::remove_dir_all(&dir);
}
