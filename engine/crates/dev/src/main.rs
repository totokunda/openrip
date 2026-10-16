//! Developer CLI.
//!
//!   openrip-dev capcut-import <draft-dir> [--out project.json]
//!       Import one CapCut draft folder and print a summary + import report.
//!   openrip-dev capcut-scan <projects-root>
//!       Import every draft under a CapCut projects folder and print aggregate
//!       statistics only (no project names, paths or text content).
//!   openrip-dev v1-import <project-N.json> [--out project.json]
//!   openrip-dev v1-scan <projects-json-dir>
//!       Same, for projects saved by the TypeScript app (format v1).
//!   openrip-dev probe <media-file>
//!       Print what the decoder sees in a media file (JSON).
//!   openrip-dev decode-bench <media-file> [--sw | --ffmpeg-hw]
//!       Measure sequential decode speed, random-seek latency and scrubbing (default: native
//!       VideoToolbox where possible; --ffmpeg-hw uses FFmpeg's hwaccel, --sw software).
//!   openrip-dev scrub-bench <media-file>
//!       Simulate dragging the playhead (120 Hz input) at several speeds, in scrub mode and
//!       accurate-only mode: frames shown per second, how far behind the playhead they are,
//!       and how long the exact frame takes to settle after release.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use openrip_capcut::{import_draft_dir, ImportError, Imported};
use openrip_model::Project;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("capcut-import") if args.len() >= 2 => capcut_import(Path::new(&args[1]), flag(&args, "--out")).map_err(|e| e.to_string()),
        Some("capcut-scan") if args.len() >= 2 => capcut_scan(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("v1-import") if args.len() >= 2 => v1_import(Path::new(&args[1]), flag(&args, "--out")).map_err(|e| e.to_string()),
        Some("v1-scan") if args.len() >= 2 => v1_scan(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("probe") if args.len() >= 2 => probe(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("scrub-bench") if args.len() >= 2 => scrub_bench(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("decode-bench") if args.len() >= 2 => decode_bench(Path::new(&args[1]), args.iter().any(|a| a == "--sw"), args.iter().any(|a| a == "--ffmpeg-hw")).map_err(|e| e.to_string()),
        _ => {
            eprintln!("usage:\n  openrip-dev capcut-import <draft-dir> [--out project.json]\n  openrip-dev capcut-scan <projects-root>\n  openrip-dev v1-import <project-N.json> [--out project.json]\n  openrip-dev v1-scan <projects-json-dir>\n  openrip-dev probe <media-file>\n  openrip-dev decode-bench <media-file> [--sw]");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn flag(args: &[String], name: &str) -> Option<PathBuf> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(PathBuf::from)
}

fn capcut_import(dir: &Path, out: Option<PathBuf>) -> Result<(), ImportError> {
    let t0 = Instant::now();
    let Imported { project, report } = import_draft_dir(dir)?;
    let elapsed = t0.elapsed();
    print_summary(&project);
    println!("imported in {:.1} ms", elapsed.as_secs_f64() * 1000.0);
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(out) = out {
        std::fs::write(&out, serde_json::to_string_pretty(&project).unwrap())
            .map_err(|source| ImportError::Io { path: out.display().to_string(), source })?;
        println!("wrote {}", out.display());
    }
    Ok(())
}

fn print_summary(p: &Project) {
    println!(
        "project: {}x{} @ {:.3} fps, {:.1}s, {} tracks, {} segments, {} materials",
        p.canvas.width,
        p.canvas.height,
        p.fps.as_f64(),
        p.duration().as_secs_f64(),
        p.tracks.len(),
        p.segment_count(),
        p.materials.len()
    );
}

#[derive(Default)]
struct Totals {
    drafts: usize,
    imported: usize,
    errors: BTreeMap<String, usize>,
    tracks: usize,
    segments: usize,
    materials: usize,
    total_ms: f64,
    max_ms: f64,
    round_trip_failures: usize,
    with_problems: usize,
    problem_kinds: BTreeMap<String, usize>,
    missing_media: usize,
    media: usize,
    versions: BTreeMap<String, usize>,
    mapped: BTreeMap<String, usize>,
    foreign: BTreeMap<String, usize>,
    library_items: BTreeMap<String, usize>,
    unmapped_keyframes: BTreeMap<String, usize>,
    curve_types: BTreeMap<String, usize>,
    track_attributes: BTreeMap<i64, usize>,
    warnings: BTreeMap<String, usize>,
}

fn merge<K: Ord + Clone>(into: &mut BTreeMap<K, usize>, from: &BTreeMap<K, usize>) {
    for (k, v) in from {
        *into.entry(k.clone()).or_insert(0) += v;
    }
}

/// Strip ids/quoted values so problem and warning messages aggregate by kind.
fn kind_of(msg: &str) -> String {
    msg.split_whitespace()
        .map(|w| if w.chars().any(|c| c.is_ascii_digit()) || w.contains('-') || w.starts_with('"') { "…" } else { w })
        .collect::<Vec<_>>()
        .join(" ")
}

fn capcut_scan(root: &Path) -> Result<(), ImportError> {
    let entries = std::fs::read_dir(root).map_err(|source| ImportError::Io { path: root.display().to_string(), source })?;
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.join("draft_info.json").exists() || p.join("draft_content.json").exists())
        .collect();
    dirs.sort();

    let mut t = Totals::default();
    for dir in &dirs {
        t.drafts += 1;
        let t0 = Instant::now();
        match import_draft_dir(dir) {
            Ok(Imported { project, report }) => {
                let ms = t0.elapsed().as_secs_f64() * 1000.0;
                t.total_ms += ms;
                t.max_ms = t.max_ms.max(ms);
                t.imported += 1;
                t.tracks += report.tracks;
                t.segments += report.segments;
                t.materials += project.materials.len();
                t.media += project.materials.media.len();
                t.missing_media += report.missing_media.len();
                *t.versions.entry(report.capcut_version.clone()).or_insert(0) += 1;
                merge(&mut t.mapped, &report.mapped);
                merge(&mut t.foreign, &report.foreign);
                merge(&mut t.library_items, &report.library_items);
                merge(&mut t.unmapped_keyframes, &report.unmapped_keyframes);
                merge(&mut t.curve_types, &report.curve_types);
                merge(&mut t.track_attributes, &report.track_attributes);
                for w in &report.warnings {
                    *t.warnings.entry(kind_of(w)).or_insert(0) += 1;
                }
                if !report.problems.is_empty() {
                    t.with_problems += 1;
                    for p in &report.problems {
                        *t.problem_kinds.entry(kind_of(p)).or_insert(0) += 1;
                    }
                }
                let json = serde_json::to_string(&project).unwrap();
                match serde_json::from_str::<Project>(&json) {
                    Ok(back) if back == project => {}
                    _ => t.round_trip_failures += 1,
                }
            }
            Err(e) => {
                let kind = match e {
                    ImportError::Io { .. } => "io",
                    ImportError::Json { .. } => "json (encrypted or corrupt)",
                    ImportError::NotADraft(_) => "not a draft",
                };
                *t.errors.entry(kind.into()).or_insert(0) += 1;
            }
        }
    }

    println!("drafts found:        {}", t.drafts);
    println!("imported:            {} ({} failed: {:?})", t.imported, t.drafts - t.imported, t.errors);
    println!("tracks / segments:   {} / {}", t.tracks, t.segments);
    println!("materials:           {} ({} media files, {} missing on disk)", t.materials, t.media, t.missing_media);
    println!(
        "import time:         {:.1} ms avg, {:.1} ms max",
        if t.imported > 0 { t.total_ms / t.imported as f64 } else { 0.0 },
        t.max_ms
    );
    println!("JSON round-trip:     {} failures", t.round_trip_failures);
    println!("drafts w/ problems:  {} {:?}", t.with_problems, t.problem_kinds);
    println!("capcut versions:     {:?}", t.versions);
    println!("mapped tables:       {:?}", t.mapped);
    println!("kept as foreign:     {:?}", t.foreign);
    println!("library items:       {:?}", t.library_items);
    println!("unmapped keyframes:  {:?}", t.unmapped_keyframes);
    println!("curve types:         {:?}", t.curve_types);
    println!("track attributes:    {:?}", t.track_attributes);
    println!("warnings:            {:?}", t.warnings);
    Ok(())
}

fn v1_import(file: &Path, out: Option<PathBuf>) -> Result<(), openrip_v1::ImportError> {
    let t0 = Instant::now();
    let openrip_v1::Imported { project, report } = openrip_v1::import_v1_file(file)?;
    let elapsed = t0.elapsed();
    print_summary(&project);
    println!("imported in {:.1} ms", elapsed.as_secs_f64() * 1000.0);
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(out) = out {
        std::fs::write(&out, serde_json::to_string_pretty(&project).unwrap())
            .map_err(|source| openrip_v1::ImportError::Io { path: out.display().to_string(), source })?;
        println!("wrote {}", out.display());
    }
    Ok(())
}

fn v1_scan(dir: &Path) -> Result<(), openrip_v1::ImportError> {
    let entries = std::fs::read_dir(dir).map_err(|source| openrip_v1::ImportError::Io { path: dir.display().to_string(), source })?;
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("project-") && n.ends_with(".json")))
        .collect();
    files.sort();
    let (mut ok, mut failed, mut segments, mut tracks, mut moved, mut problems, mut missing) = (0, 0, 0, 0, 0, 0, 0);
    let (mut dropped, mut foreign, mut warnings) = (BTreeMap::new(), BTreeMap::new(), BTreeMap::new());
    for file in &files {
        match openrip_v1::import_v1_file(file) {
            Ok(openrip_v1::Imported { project, report }) => {
                ok += 1;
                segments += report.segments;
                tracks += report.tracks;
                moved += report.moved_to_new_track;
                problems += report.problems.len();
                missing += report.missing_media.len();
                merge(&mut dropped, &report.dropped);
                merge(&mut foreign, &report.kept_foreign);
                for w in &report.warnings {
                    *warnings.entry(kind_of(w)).or_insert(0) += 1;
                }
                let json = serde_json::to_string(&project).unwrap();
                if serde_json::from_str::<Project>(&json).ok().as_ref() != Some(&project) {
                    println!("round-trip mismatch in one project");
                }
            }
            Err(_) => failed += 1,
        }
    }
    println!("projects:           {} ({} imported, {} failed)", files.len(), ok, failed);
    println!("tracks / segments:  {} / {}", tracks, segments);
    println!("overlaps moved:     {}", moved);
    println!("problems:           {}", problems);
    println!("missing media:      {}", missing);
    println!("dropped:            {:?}", dropped);
    println!("kept as foreign:    {:?}", foreign);
    println!("warnings:           {:?}", warnings);
    Ok(())
}

fn probe(file: &Path) -> Result<(), openrip_media::MediaError> {
    let info = openrip_media::probe(file)?;
    println!("{}", serde_json::to_string_pretty(&info).unwrap());
    Ok(())
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

fn summary(label: &str, mut ms: Vec<f64>) {
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "{label:<34} p50 {:6.1} ms   p95 {:6.1} ms   max {:6.1} ms   (n={})",
        percentile(&ms, 0.5),
        percentile(&ms, 0.95),
        ms[ms.len() - 1],
        ms.len()
    );
}

fn decode_bench(file: &Path, software: bool, ffmpeg_hw: bool) -> Result<(), openrip_media::MediaError> {
    use openrip_media::{DecoderOptions, HardwareMode, Micros, VideoDecoder};
    let opts = DecoderOptions { hardware: if software { HardwareMode::Off } else { HardwareMode::Auto }, native_videotoolbox: !ffmpeg_hw, ..Default::default() };
    println!("{}", openrip_media::ffmpeg_versions());
    let t0 = Instant::now();
    openrip_media::warm_up().join().ok();
    println!("hardware warm-up (once per process): {:.1} ms", t0.elapsed().as_secs_f64() * 1000.0);
    let t0 = Instant::now();
    let mut d = VideoDecoder::open(file, &opts)?;
    let open_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let info = d.info().clone();
    let fps = info.frame_rate.map(|r| r.as_f64()).unwrap_or(30.0);
    let step = Micros((1_000_000.0 / fps).round() as i64);
    println!(
        "{} {}x{} {}-bit @ {:.3} fps, {:.1} s; decoder: {}; open {:.1} ms",
        info.codec,
        info.width,
        info.height,
        info.bit_depth,
        fps,
        info.duration.as_secs_f64(),
        if d.native_videotoolbox() { "native VideoToolbox" } else if d.hardware() { "VideoToolbox via FFmpeg" } else { "software" },
        open_ms
    );

    // First frame (cold start).
    let t0 = Instant::now();
    let first = d.next_frame()?.expect("no frames");
    println!("first frame                        {:6.1} ms ({:?}, hardware: {})", t0.elapsed().as_secs_f64() * 1000.0, first.pixel_format(), first.is_hardware());
    drop(first);

    // Sequential decode, up to 10 s of media.
    let t0 = Instant::now();
    let mut n = 0u64;
    let limit = Micros(10_000_000);
    while let Some(f) = d.next_frame()? {
        n += 1;
        if f.time >= limit {
            break;
        }
    }
    let secs = t0.elapsed().as_secs_f64();
    println!("sequential decode                  {:6.1} fps ({:.2} ms/frame, {:.1}x real time)", n as f64 / secs, secs * 1000.0 / n as f64, n as f64 / secs / fps);

    // Random access: deterministic pseudo-random times across the whole stream.
    let dur = info.duration.0.max(1);
    let mut x: u64 = 0x9E3779B97F4A7C15;
    let mut seeks = Vec::new();
    let before = d.stats();
    for _ in 0..60 {
        x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let t = Micros(((x >> 11) % dur as u64) as i64);
        let t0 = Instant::now();
        d.frame_at(t)?;
        seeks.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    let after = d.stats();
    summary("random seek (frame-accurate)", seeks);
    println!("  frames decoded per seek: {:.1}", (after.frames_decoded - before.frames_decoded) as f64 / 60.0);
    let before = d.stats();

    // Scrubbing forward and backward by one frame from mid-stream.
    let mid = Micros(dur / 2);
    d.frame_at(mid)?;
    let mut fwd = Vec::new();
    for i in 1..=60 {
        let t0 = Instant::now();
        d.frame_at(Micros(mid.0 + i * step.0))?;
        fwd.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    summary("step forward 1 frame", fwd);
    let mut back = Vec::new();
    for i in 1..=30 {
        let t0 = Instant::now();
        d.frame_at(Micros(mid.0 - i * step.0))?;
        back.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    summary("step backward 1 frame", back);
    println!("  answered from the frame cache: {} of 90 steps", d.stats().cache_hits - before.cache_hits);
    Ok(())
}

/// A delivered frame in scrub-bench: request id, media time, exact?, request-to-delivery.
type Shown = (u64, i64, bool, std::time::Duration);

fn scrub_bench(file: &Path) -> Result<(), openrip_media::MediaError> {
    use openrip_media::{DecoderOptions, Micros};
    use openrip_playback::{FrameServer, Quality, SeekMode};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    openrip_media::warm_up().join().ok();
    let info = openrip_media::probe(file)?.video.expect("no video");
    let duration = info.duration.0;
    let frame = info.frame_rate.map(|r| r.frame_duration().0).unwrap_or(33_333);
    println!("{} {}x{}, {:.1} s; 2 s drags with 120 Hz input", info.codec, info.width, info.height, info.duration.as_secs_f64());
    println!("{:<10} {:<9} {:>8} {:>16} {:>10} {:>14}", "speed", "mode", "shown/s", "lag p50/p95 ms*", "exact %", "settle ms");
    for speed in [1.0, 4.0, 16.0] {
        for scrub in [true, false] {
            // (request id, media time) of every request, and what was delivered when.
            let requests: Arc<Mutex<Vec<(u64, i64)>>> = Arc::default();
            let shown: Arc<Mutex<Vec<Shown>>> = Arc::default();
            let server = {
                let shown = shown.clone();
                FrameServer::open(file, &DecoderOptions::default(), move |d| {
                    if let Ok((f, q)) = &d.result {
                        shown.lock().unwrap().push((d.request, f.time.0, *q == Quality::Exact, d.latency));
                    }
                })?
            };
            let start = (duration / 4) as f64;
            let t0 = Instant::now();
            let tick = Duration::from_micros(8_333);
            let mut i = 0;
            while t0.elapsed() < Duration::from_secs(2) {
                let t = (start + speed * t0.elapsed().as_secs_f64() * 1e6) as i64 % duration.max(1);
                // CapCut-style tolerance: wider when dragging faster (here: 50 ms of drag).
                let mode = if scrub { SeekMode::Scrub { tolerance: Micros(((speed * 50_000.0) as i64).max(frame)) } } else { SeekMode::Accurate };
                let id = server.request(Micros(t), mode);
                requests.lock().unwrap().push((id, t));
                i += 1;
                std::thread::sleep((tick * i).saturating_sub(t0.elapsed()));
            }
            // Release: one accurate request; measure until it is delivered.
            let last_t = requests.lock().unwrap().last().unwrap().1;
            let release = Instant::now();
            let id = server.request(Micros(last_t), SeekMode::Accurate);
            server.wait_idle();
            let settle = release.elapsed().as_secs_f64() * 1000.0;
            let shown = shown.lock().unwrap();
            let during: Vec<_> = shown.iter().filter(|s| s.0 < id).collect();
            // Lag: how far (in wall time) the shown frame trails the playhead when it appears,
            // approximated by delivery latency.
            let mut lag: Vec<f64> = during.iter().map(|s| s.3.as_secs_f64() * 1000.0).collect();
            lag.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let exact = during.iter().filter(|s| s.2).count();
            println!(
                "{:<10} {:<9} {:>8.1} {:>7.1} / {:<7.1} {:>9.0}% {:>14.1}",
                format!("{speed}x"),
                if scrub { "scrub" } else { "accurate" },
                during.len() as f64 / 2.0,
                lag.get(lag.len() / 2).copied().unwrap_or(f64::NAN),
                lag.get(lag.len() * 95 / 100).copied().unwrap_or(f64::NAN),
                100.0 * exact as f64 / during.len().max(1) as f64,
                settle
            );
            drop(server);
        }
    }
    println!("* lag = time from the request to its frame being ready");
    Ok(())
}
