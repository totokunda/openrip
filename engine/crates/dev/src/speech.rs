//! `openrip-dev transcribe`: recognize the speech in a media file with a local Whisper model,
//! print the words with their times and the captions they make, and check them against what
//! was said.
//!
//!   openrip-dev transcribe <media> [--model base|small|… | --model-file path.bin]
//!       [--language en] [--start S] [--seconds S] [--max-chars N] [--fillers] [--keywords]
//!       [--ref "the true text"] [--spans spans.json] [--json]
//!
//! Models are looked up in `$OPENRIP_MODELS`, else the app's models folder (the same one the
//! desktop app downloads into), and fetched with `curl` from Hugging Face if missing. `--ref`
//! prints the word error rate; `--spans` (a JSON list of `{"text","start","end"}`, seconds)
//! prints how far the first word's start and the last word's end are from each span's.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Instant;

use openrip_core::{build_captions, models, transcribe, CaptionOptions, Micros, SpeechControl, SpeechInput, Transcript, DEFAULT_MODEL};
use serde_json::{json, Value};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

/// The folder the desktop app keeps speech models in.
pub fn models_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OPENRIP_MODELS") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_default();
    if cfg!(target_os = "macos") {
        home.join("Library/Application Support/OpenRip/speech-models")
    } else {
        home.join(".config/OpenRip/speech-models")
    }
}

fn sha256(path: &Path) -> Result<String> {
    let out = Command::new("shasum").args(["-a", "256"]).arg(path).output()?;
    Ok(String::from_utf8_lossy(&out.stdout).split_whitespace().next().unwrap_or("").to_string())
}

/// The file for `id`, downloaded (and checked) if it isn't there yet.
fn model_file(id: &str) -> Result<PathBuf> {
    let model = models::find(id).ok_or_else(|| format!("no model called {id}; one of: {}", models::MODELS.iter().map(|m| m.id).collect::<Vec<_>>().join(", ")))?;
    let dir = models_dir();
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(model.file);
    if path.metadata().is_ok_and(|m| m.len() == model.size) {
        return Ok(path);
    }
    eprintln!("downloading {} ({} MB) to {}", model.file, model.size / 1_000_000, path.display());
    let part = dir.join(format!("{}.part", model.file));
    let status = Command::new("curl").args(["-L", "--fail", "-s", "-o"]).arg(&part).arg(models::url(model)).status()?;
    if !status.success() {
        return Err("download failed".into());
    }
    if sha256(&part)? != model.sha256 {
        std::fs::remove_file(&part)?;
        return Err("the downloaded model's checksum is wrong".into());
    }
    std::fs::rename(&part, &path)?;
    Ok(path)
}

fn normal(word: &str) -> String {
    word.chars().filter(|c| c.is_alphanumeric() || *c == '\'').flat_map(char::to_lowercase).collect()
}

/// Word error rate: (substitutions + deletions + insertions) over the reference's words.
pub fn wer(reference: &str, heard: &str) -> (f64, usize, usize) {
    let r: Vec<String> = reference.split_whitespace().map(normal).filter(|w| !w.is_empty()).collect();
    let h: Vec<String> = heard.split_whitespace().map(normal).filter(|w| !w.is_empty()).collect();
    let mut d = vec![vec![0usize; h.len() + 1]; r.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for j in 0..=h.len() {
        d[0][j] = j;
    }
    for i in 1..=r.len() {
        for j in 1..=h.len() {
            let sub = d[i - 1][j - 1] + usize::from(r[i - 1] != h[j - 1]);
            d[i][j] = sub.min(d[i - 1][j] + 1).min(d[i][j - 1] + 1);
        }
    }
    (d[r.len()][h.len()] as f64 / r.len().max(1) as f64, d[r.len()][h.len()], r.len())
}

fn span_errors(t: &Transcript, spans: &Value) {
    let mut starts = Vec::new();
    let mut ends = Vec::new();
    for s in spans.as_array().into_iter().flatten() {
        let (a, b) = (s["start"].as_f64().unwrap_or(0.0), s["end"].as_f64().unwrap_or(0.0));
        let inside: Vec<_> = t.words().filter(|w| {
            let mid = (w.start_us + w.end_us) as f64 / 2e6;
            mid >= a - 0.25 && mid <= b + 0.25
        }).collect();
        let (Some(first), Some(last)) = (inside.first(), inside.last()) else {
            println!("span {:?} [{a:.2}, {b:.2}]: nothing heard", s["text"]);
            continue;
        };
        let (ds, de) = (first.start_us as f64 / 1e6 - a, last.end_us as f64 / 1e6 - b);
        println!("span {:<28} [{a:6.2}, {b:6.2}] heard [{:6.2}, {:6.2}]  start {ds:+.3}  end {de:+.3}", format!("{:?}", s["text"].as_str().unwrap_or("")), first.start_us as f64 / 1e6, last.end_us as f64 / 1e6);
        starts.push(ds.abs());
        ends.push(de.abs());
    }
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
    let max = |v: &[f64]| v.iter().cloned().fold(0.0, f64::max);
    println!("timing over {} spans: start error mean {:.0} ms max {:.0} ms; end error mean {:.0} ms max {:.0} ms", starts.len(), mean(&starts) * 1e3, max(&starts) * 1e3, mean(&ends) * 1e3, max(&ends) * 1e3);
}

pub fn transcribe_cmd(args: &[String]) -> Result<()> {
    let media = Path::new(&args[1]);
    let model = match flag(args, "--model-file") {
        Some(p) => PathBuf::from(p),
        None => model_file(flag(args, "--model").unwrap_or(DEFAULT_MODEL))?,
    };
    let start = Micros::from_secs_f64(flag(args, "--start").and_then(|v| v.parse().ok()).unwrap_or(0.0));
    let duration = flag(args, "--seconds").and_then(|v| v.parse::<f64>().ok()).map(Micros::from_secs_f64);
    let language = flag(args, "--language").map(String::from);
    let control = Arc::new(SpeechControl::new());
    let began = Instant::now();
    let t = transcribe(SpeechInput::File { path: media, start, duration }, model.clone(), language, &control)?;
    let took = began.elapsed().as_secs_f64();
    let audio_secs = t.words().last().map_or(0.0, |w| w.end_us as f64 / 1e6);
    let options = CaptionOptions {
        max_chars: flag(args, "--max-chars").and_then(|v| v.parse().ok()).unwrap_or(32),
        remove_fillers: args.iter().any(|a| a == "--fillers"),
        highlight_keywords: args.iter().any(|a| a == "--keywords"),
        ..Default::default()
    };
    let captions = build_captions(&t, &options);
    if args.iter().any(|a| a == "--json") {
        println!("{}", json!({ "transcript": t, "captions": captions, "seconds": took }));
    } else {
        println!("language {}  ({} words, {} captions)", t.language, t.words().count(), captions.len());
        for c in &captions {
            println!("{:7.2} - {:7.2}  {}", c.start_us as f64 / 1e6, c.end_us as f64 / 1e6, c.text.replace('\n', " / "));
            println!("    {}", c.words.iter().map(|w| format!("{:.2}", (c.start_us + w.start_us) as f64 / 1e6)).collect::<Vec<_>>().join(" "));
        }
    }
    if let Some(reference) = flag(args, "--ref") {
        let (rate, errors, n) = wer(reference, &t.text());
        println!("word error rate {:.1}% ({errors} errors in {n} words)", rate * 100.0);
    }
    if let Some(spans) = flag(args, "--spans") {
        span_errors(&t, &serde_json::from_str(&std::fs::read_to_string(spans)?)?);
    }
    let whole = openrip_media::probe(media).map_or(audio_secs, |i| i.duration.0 as f64 / 1e6);
    let media_secs = duration.map(|d| d.0 as f64 / 1e6).unwrap_or((whole - start.0 as f64 / 1e6).max(0.0));
    println!("{} in {took:.2} s ({:.1}x real time on {:.1} s of speech)", model.file_name().and_then(|f| f.to_str()).unwrap_or(""), media_secs / took.max(1e-3), media_secs);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::wer;

    #[test]
    fn the_word_error_rate_counts_substitutions_deletions_and_insertions() {
        assert_eq!(wer("the cat sat", "the cat sat").1, 0);
        assert_eq!(wer("the cat sat", "The cat, sat.").1, 0);
        assert_eq!(wer("the cat sat", "the hat sat").1, 1);
        assert_eq!(wer("the cat sat", "the sat").1, 1);
        assert_eq!(wer("the cat sat", "the big cat sat").1, 1);
    }
}
