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
//!   openrip-dev render-frame <project.json> <seconds> <width> <height> <out.png>
//!       Render one frame of an imported project with the GPU compositor: images, video
//!       frames straight from the hardware decoder, and plain text (fill only so far).
//!   openrip-dev play-bench <video> [<width> <height>]
//!       Decode a video and composite every frame into an IOSurface preview surface (default
//!       1920x1080), as playback will: per-frame decode and composite cost, and CPU use.
//!   openrip-dev preview-scan <projects-root> [--save <dir>]
//!       Import every CapCut draft and render five frames of each with the preview engine:
//!       aggregate counts of layers drawn, media skipped and errors, and frame times (no
//!       names). --save writes the frames as PNGs for a visual check.
//!   openrip-dev export <project.json | draft-dir> <out.mp4> [--size WxH] [--fps N] [--hevc] [--mbps N] [--no-audio]
//!       Render and encode a project (default: canvas size, project fps, H.264, AAC 44.1 kHz).
//!       CapCut drafts are imported on the fly.
//!   openrip-dev mix <project.json | draft-dir> <out.wav> [<start-seconds> <seconds>]
//!       Mix a project's audio (48 kHz stereo float WAV), as export and playback will.
//!   openrip-dev playthrough <project.json | draft-dir> [--seconds N] [--realtime] [--verbose]
//!       Render every frame in order at 540p, as playback does: frame times overall and on
//!       the frames where a clip starts (cuts).
//!   openrip-dev pipeline-bench <project.json | draft-dir> [--seconds N]
//!       Play through the render-ahead preview pipeline by the wall clock with a 60 Hz
//!       display: frames shown on time, dropped, and the longest gap without a new frame.
//!   openrip-dev still-bench <project.json | draft-dir> [--count N]
//!       The compositor on a project's stills (default the first 12 PNGs), each drawn
//!       full-frame into a 540-pixel preview surface and an NV12 export buffer at the canvas
//!       size: as a new still, written ahead by another thread, again from the GPU cache, and
//!       with its scale dragged; then frames drawn while another thread writes stills.
//!   openrip-dev scrub-bench <media-file>
//!       Simulate dragging the playhead (120 Hz input) at several speeds, in scrub mode and
//!       accurate-only mode: frames shown per second, how far behind the playhead they are,
//!       and how long the exact frame takes to settle after release.
//!   openrip-dev cover-parity <projects-root> [--save <dir>]
//!       Compare our render of each draft's first frame with `draft_cover.jpg`, CapCut's own
//!       render of it: PSNR and the share of pixels far off, per draft (numbered, no names)
//!       and overall. Drafts with media missing at the first frame are left out. --save
//!       writes ours | CapCut's | difference x4 for each.
//!   openrip-dev export-parity <draft-dir> <capcut-export.mp4> [--every S] [--from S] [--to S] [--all] [--save <dir>]
//!       Compare our render with CapCut's export of the same draft every S seconds (default
//!       2) at half size, between --from and --to (default the whole draft): PSNR overall
//!       and the worst samples (--all lists every sample; --save writes ours | CapCut's |
//!       difference x4 for the five worst).
//!   openrip-dev wrap-probe <draft-dir> <capcut-export.mp4>
//!       For each text clip, sweep the line-wrap width (fraction of the canvas width, on
//!       screen) and find which widths reproduce CapCut's exported frame: one line per clip
//!       with the clip's CapCut fields, for fitting CapCut's wrapping rule.
//!   openrip-dev app-roundtrip <projects-root> [--audio]
//!       Convert each draft to the app's project and back, and compare four frames of the
//!       two (PSNR); --audio compares their mixes too (the first 20 s).
//!   openrip-dev audio-parity <project.json | draft-dir> <capcut-export> [--from S] [--to S] [--window S] [--all]
//!       Compare our mix with the sound of CapCut's export (an MP4, or the WAV it exports):
//!       the lag that lines them up, correlation, level (ours against CapCut's) and the
//!       per-band distance (the level difference per frame and band, 20 bands 150–8000 Hz,
//!       the overall level difference removed), overall and per window (default 1 s; the five
//!       least alike, or --all).
//!   openrip-dev loudness-scan <projects-root>
//!       Our EBU R128 loudness and peak of every clip range CapCut measured for "Normalize
//!       loudness", against CapCut's values (numbered drafts, no names).
//!   openrip-dev beat-scan <projects-root>
//!       Our beat detection on every library song with CapCut's beats file at hand, against
//!       CapCut's beats: F-measure at 70 ms, tempo, offset and bar starts.
//!   openrip-dev slowmo <video> [--speed 0.25] [--from S] [--frames N] [--size LONG] [--save DIR] [--holdout N]
//!       Play the file slowed through the preview engine with Smooth slow-mo off, blended and
//!       by optical flow: time per frame and repeated frames; --holdout N rebuilds N real
//!       frames from the frames either side of them and scores each method (PSNR).
//!   openrip-dev track <video> --region cx,cy,w,h[,deg] [--at S] [--from S] [--to S] [--direction both|forward|backward] [--save DIR]
//!       Motion-track a region (fractions of the upright picture) as the Tracking tab does:
//!       speed, the path, where it was lost, and the drift of a round trip forward and back.
//!   openrip-dev scene-scan <media-file> [--start S] [--duration S] [--sensitivity X] [--json]
//!       Split scenes on a file: each shot change's time, kind (hard, dissolve, fade), the
//!       transition's span and its score; the speed of the scan.
//!   openrip-dev color-scan <media-file> [--start S] [--duration S]
//!       The colour statistics Color match reads, and Auto adjust's values (panel scale).
//!   openrip-dev thumbs-bench <media-file> [--count N] [--height H]
//!       Timeline thumbnails across the whole file (default 40 at 64 px): the quick pass
//!       (one keyframe per GOP), the exact pass, and the exact pass again from the disk cache.
//!   openrip-dev fonts [<family> [--weight N] [--italic]]
//!       The installed font families the engine draws text in (and how long finding them
//!       took), or the faces it picks for one family at a weight and slant.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use openrip_capcut::{import_draft_dir, ImportError, Imported};
use openrip_model::Project;

mod analysis;
mod audio;
mod motion;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("capcut-import") if args.len() >= 2 => capcut_import(Path::new(&args[1]), flag(&args, "--out")).map_err(|e| e.to_string()),
        Some("capcut-scan") if args.len() >= 2 => capcut_scan(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("v1-import") if args.len() >= 2 => v1_import(Path::new(&args[1]), flag(&args, "--out")).map_err(|e| e.to_string()),
        Some("v1-scan") if args.len() >= 2 => v1_scan(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("probe") if args.len() >= 2 => probe(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("slowmo") if args.len() >= 2 => motion::slowmo(&args).map_err(|e| e.to_string()),
        Some("track") if args.len() >= 2 => motion::track(&args).map_err(|e| e.to_string()),
        Some("render-frame") if args.len() >= 6 => render_frame(&args[1..]).map_err(|e| e.to_string()),
        Some("play-bench") if args.len() >= 2 => play_bench(&args[1..]).map_err(|e| e.to_string()),
        Some("preview-scan") if args.len() >= 2 => preview_scan(Path::new(&args[1]), flag(&args, "--save")).map_err(|e| e.to_string()),
        Some("export") if args.len() >= 3 => export_cmd(&args).map_err(|e| e.to_string()),
        Some("mix") if args.len() >= 3 => mix_cmd(&args).map_err(|e| e.to_string()),
        Some("playthrough") if args.len() >= 2 => playthrough(&args).map_err(|e| e.to_string()),
        Some("pipeline-bench") if args.len() >= 2 => pipeline_bench(&args).map_err(|e| e.to_string()),
        Some("cover-parity") if args.len() >= 2 => cover_parity(Path::new(&args[1]), flag(&args, "--save")).map_err(|e| e.to_string()),
        Some("app-roundtrip") if args.len() >= 2 => app_roundtrip(Path::new(&args[1]), args.iter().any(|a| a == "--audio")).map_err(|e| e.to_string()),
        Some("audio-parity") if args.len() >= 3 => load_project(Path::new(&args[1])).and_then(|p| audio::parity(&args, p)).map_err(|e| e.to_string()),
        Some("loudness-scan") if args.len() >= 2 => audio::loudness_scan(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("beat-scan") if args.len() >= 2 => audio::beat_scan(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("seek-bench") if args.len() >= 2 => seek_bench(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("still-bench") if args.len() >= 2 => still_bench(&args).map_err(|e| e.to_string()),
        Some("export-parity") if args.len() >= 3 => export_parity(&args).map_err(|e| e.to_string()),
        Some("wrap-probe") if args.len() >= 3 => wrap_probe(Path::new(&args[1]), Path::new(&args[2])).map_err(|e| e.to_string()),
        Some("scene-scan") if args.len() >= 2 => analysis::scene_scan(&args).map_err(|e| e.to_string()),
        Some("color-scan") if args.len() >= 2 => analysis::color_scan(&args).map_err(|e| e.to_string()),
        Some("thumbs-bench") if args.len() >= 2 => thumbs_bench(&args).map_err(|e| e.to_string()),
        Some("scrub-bench") if args.len() >= 2 => scrub_bench(Path::new(&args[1])).map_err(|e| e.to_string()),
        Some("fonts") => fonts_cmd(&args),
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

/// `fonts`: the installed families, or one family's faces at a weight and slant.
fn fonts_cmd(args: &[String]) -> Result<(), String> {
    use openrip_render::fonts;
    let t0 = Instant::now();
    let faces = fonts::system_faces().len();
    let scanned = t0.elapsed();
    match args.get(1).filter(|a| !a.starts_with("--")) {
        None => {
            let families = fonts::families();
            for f in &families {
                println!("{}  {:?}{}", f.name, f.weights, if f.italic { " italic" } else { "" });
            }
            println!("{} families, {faces} faces, found in {:.0} ms", families.len(), scanned.as_secs_f64() * 1e3);
        }
        Some(family) => {
            let weight = flag(args, "--weight").and_then(|w| w.to_string_lossy().parse().ok()).unwrap_or(400);
            let italic = args.iter().any(|a| a == "--italic");
            let r = fonts::resolve(family, weight, italic).ok_or_else(|| format!("no font family named {family}"))?;
            for f in &r.faces {
                println!("{} #{}  weight {}{}", f.source, f.index, f.weight, if f.italic { " italic" } else { "" });
            }
            println!("synthetic bold: {}, synthetic italic: {}", r.synthetic_bold, r.synthetic_italic);
        }
    }
    Ok(())
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
    unmapped_library: BTreeMap<String, usize>,
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
                merge(&mut t.unmapped_library, &report.unmapped_library);
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
    println!("not drawn (CapCut's only): {:?}", t.unmapped_library);
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
    if ms.is_empty() {
        println!("{label:<34} none");
        return;
    }
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

fn save_png(path: &Path, img: &openrip_render::RgbaImage) -> Result<(), Box<dyn std::error::Error>> {
    let mut enc = png::Encoder::new(std::io::BufWriter::new(std::fs::File::create(path)?), img.width, img.height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header()?.write_image_data(&img.data)?;
    Ok(())
}

fn render_frame(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let project: Project = serde_json::from_str(&std::fs::read_to_string(&args[0])?)?;
    let t = openrip_model::Micros::from_secs_f64(args[1].parse()?);
    let (w, h): (u32, u32) = (args[2].parse()?, args[3].parse()?);
    let mut engine = openrip_playback::PreviewEngine::new(project)?;
    let t0 = Instant::now();
    let (frame, report) = engine.render_image(t, w, h)?;
    println!("rendered {} layer(s) at {w}x{h} in {:.1} ms", report.layers, t0.elapsed().as_secs_f64() * 1000.0);
    for (path, why) in &report.missing {
        println!("  skipped {path}: {why}");
    }
    save_png(Path::new(&args[4]), &frame)?;
    Ok(())
}

fn cpu_seconds() -> f64 {
    let mut usage = std::mem::MaybeUninit::<libc_rusage>::zeroed();
    unsafe { getrusage(0, usage.as_mut_ptr()) };
    let u = unsafe { usage.assume_init() };
    (u.utime_sec + u.stime_sec) as f64 + (u.utime_usec + u.stime_usec) as f64 / 1e6
}

#[repr(C)]
struct libc_rusage {
    utime_sec: i64,
    utime_usec: i32,
    stime_sec: i64,
    stime_usec: i32,
    rest: [i64; 14],
}

extern "C" {
    fn getrusage(who: i32, usage: *mut libc_rusage) -> i32;
}

#[cfg(target_os = "macos")]
fn play_bench(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use openrip_media::{DecoderOptions, VideoDecoder};
    use openrip_render::{Compositor, Layer, Source};
    let (w, h): (u32, u32) = if args.len() >= 3 { (args[1].parse()?, args[2].parse()?) } else { (1920, 1080) };
    openrip_media::warm_up().join().ok();
    let mut d = VideoDecoder::open(Path::new(&args[0]), &DecoderOptions::default())?;
    let c = Compositor::new()?;
    let surfaces: Vec<_> = (0..3).map(|_| Compositor::output_surface(w, h).expect("surface")).collect();
    let info = d.info().clone();
    println!("{} {}x{} -> {w}x{h} preview, native decode: {}", info.codec, info.width, info.height, d.native_videotoolbox());
    let (mut dec_ms, mut comp_ms) = (Vec::new(), Vec::new());
    let (wall, cpu0) = (Instant::now(), cpu_seconds());
    let mut n = 0;
    loop {
        let t0 = Instant::now();
        let Some(frame) = d.next_frame()? else { break };
        let t1 = Instant::now();
        let layer = Layer::from_model(Source::Video(&frame), [w, h], [0.0, 0.0], [1.0, 1.0], 0.0);
        c.render_to_surface(&surfaces[n % 3], [0, 0, 0], &[layer])?;
        dec_ms.push((t1 - t0).as_secs_f64() * 1e3);
        comp_ms.push(t1.elapsed().as_secs_f64() * 1e3);
        n += 1;
        if frame.time.0 >= 10_000_000 {
            break;
        }
    }
    let secs = wall.elapsed().as_secs_f64();
    let cpu = cpu_seconds() - cpu0;
    summary("decode (per frame)", dec_ms);
    summary("composite into surface (per frame)", comp_ms);
    let fps = info.frame_rate.map(|r| r.as_f64()).unwrap_or(30.0);
    println!("{n} frames in {secs:.2} s = {:.0} fps ({:.1}x real time); CPU {:.0}% of one core while running flat out", n as f64 / secs, n as f64 / secs / fps, 100.0 * cpu / secs);
    println!("at real time ({fps:.0} fps) that is ~{:.0}% of one core", 100.0 * cpu / n as f64 * fps);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn play_bench(_args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    Err("play-bench needs macOS (IOSurface output)".into())
}

fn preview_scan(root: &Path, save: Option<PathBuf>) -> Result<(), Box<dyn std::error::Error>> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(root)?.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.join("draft_info.json").exists()).collect();
    dirs.sort();
    if let Some(dir) = &save {
        std::fs::create_dir_all(dir)?;
    }
    let (mut drafts, mut frames, mut errors, mut layers, mut skipped) = (0, 0, 0, 0, 0);
    let mut missing_files = std::collections::BTreeSet::new();
    let mut times = Vec::new();
    for (i, dir) in dirs.iter().enumerate() {
        let Ok(Imported { project, .. }) = import_draft_dir(dir) else { continue };
        drafts += 1;
        let duration = project.duration();
        let (cw, ch) = (project.canvas.width.max(1) as f64, project.canvas.height.max(1) as f64);
        let (w, h) = if cw >= ch { (960, ((960.0 * ch / cw).round() as u32).max(2)) } else { (((960.0 * cw / ch).round() as u32).max(2), 960) };
        let mut engine = openrip_playback::PreviewEngine::new(project)?;
        for k in 0..5 {
            let t = openrip_model::Micros(duration.0 * (2 * k + 1) / 10);
            let t0 = Instant::now();
            match engine.render_image(t, w, h) {
                Ok((img, report)) => {
                    times.push(t0.elapsed().as_secs_f64() * 1000.0);
                    frames += 1;
                    layers += report.layers;
                    skipped += report.missing.len();
                    missing_files.extend(report.missing.into_iter().map(|m| m.0));
                    if let Some(dir) = &save {
                        save_png(&dir.join(format!("draft{i:02}_{k}.png")), &img)?;
                    }
                }
                Err(e) => {
                    errors += 1;
                    eprintln!("draft #{i} frame {k}: {e}");
                }
            }
        }
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("drafts rendered: {drafts}, frames: {frames}, errors: {errors}");
    println!("layers drawn: {layers}; layers skipped (media/font missing): {skipped} ({} distinct files)", missing_files.len());
    if !times.is_empty() {
        println!("frame time (first frame per draft includes opening decoders): p50 {:.1} ms, p95 {:.1} ms, max {:.1} ms", percentile(&times, 0.5), percentile(&times, 0.95), times[times.len() - 1]);
    }
    Ok(())
}

fn load_project(path: &Path) -> Result<Project, Box<dyn std::error::Error>> {
    if path.is_dir() {
        return Ok(import_draft_dir(path)?.project);
    }
    Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
}

fn export_cmd(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let project = load_project(Path::new(&args[1]))?;
    let opt = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let (w, h) = match opt("--size") {
        Some(s) => {
            let (a, b) = s.split_once('x').ok_or("--size WxH")?;
            (a.parse()?, b.parse()?)
        }
        None => (project.canvas.width, project.canvas.height),
    };
    let fps = match opt("--fps") {
        Some(f) => openrip_model::FrameRate::from_f64(f.parse()?),
        None => project.fps,
    };
    let codec = if args.iter().any(|a| a == "--hevc") { openrip_export::Codec::Hevc } else { openrip_export::Codec::H264 };
    let mbps: f64 = opt("--mbps").map(|m| m.parse()).transpose()?.unwrap_or(10.0);
    let duration = project.duration().as_secs_f64();
    let audio = !args.iter().any(|a| a == "--no-audio");
    let o = openrip_export::ExportOptions { width: w, height: h, fps, codec, bitrate: (mbps * 1e6) as u64, exact_bitrate: false, audio };
    println!("exporting {:.1} s at {w}x{h} {:.3} fps, {codec:?} {mbps} Mbps", duration, fps.as_f64());
    let stats = openrip_export::export(project, Path::new(&args[2]), &o, |n, total| {
        if n % 60 == 0 || n == total {
            eprint!("\r  frame {n}/{total}");
        }
        true
    })?;
    eprintln!();
    println!(
        "{} frames in {:.2} s = {:.1}x real time (render {:.2} s, encode {:.2} s); {} layer-frames skipped for missing media",
        stats.frames,
        stats.seconds,
        duration / stats.seconds,
        stats.render_seconds,
        stats.encode_seconds,
        stats.skipped_layers
    );
    Ok(())
}

fn mix_cmd(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use openrip_audio::{sample_of, Mixer, CHANNELS, RATE};
    let project = load_project(Path::new(&args[1]))?;
    let start: f64 = args.get(3).map(|s| s.parse()).transpose()?.unwrap_or(0.0);
    let secs: f64 = args.get(4).map(|s| s.parse()).transpose()?.unwrap_or(project.duration().as_secs_f64() - start);
    let mut mixer = Mixer::new(project);
    let first = sample_of(openrip_model::Micros::from_secs_f64(start));
    let total = (secs * RATE as f64).round() as usize;
    let t0 = Instant::now();
    let mut pcm = Vec::with_capacity(total * CHANNELS);
    let mut block = vec![0f32; 4096 * CHANNELS];
    let mut done = 0;
    let mut missing = std::collections::BTreeSet::new();
    while done < total {
        let n = (total - done).min(4096);
        let report = mixer.mix(first + done as i64, &mut block[..n * CHANNELS])?;
        missing.extend(report.missing);
        pcm.extend_from_slice(&block[..n * CHANNELS]);
        done += n;
    }
    // 32-bit float WAV.
    let data: Vec<u8> = pcm.iter().flat_map(|v| v.to_le_bytes()).collect();
    let mut wav = Vec::with_capacity(44 + data.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&3u16.to_le_bytes()); // IEEE float
    wav.extend_from_slice(&(CHANNELS as u16).to_le_bytes());
    wav.extend_from_slice(&RATE.to_le_bytes());
    wav.extend_from_slice(&(RATE * CHANNELS as u32 * 4).to_le_bytes());
    wav.extend_from_slice(&(CHANNELS as u16 * 4).to_le_bytes());
    wav.extend_from_slice(&32u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
    wav.extend_from_slice(&data);
    std::fs::write(&args[2], wav)?;
    println!("mixed {secs:.2} s in {:.1} ms ({} missing files)", t0.elapsed().as_secs_f64() * 1000.0, missing.len());
    Ok(())
}

#[cfg(target_os = "macos")]
fn playthrough(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use openrip_model::{Micros, TrackKind};
    let project = load_project(Path::new(&args[1]))?;
    let verbose = args.iter().any(|a| a == "--verbose");
    // Pace frames like real playback (prefetch then has the time it has in the app).
    let realtime = args.iter().any(|a| a == "--realtime");
    let secs: f64 = args.iter().position(|a| a == "--seconds").and_then(|i| args.get(i + 1)).map(|s| s.parse()).transpose()?.unwrap_or(f64::MAX);
    let fps = project.fps;
    let (cw, ch) = (project.canvas.width.max(1) as f64, project.canvas.height.max(1) as f64);
    let (w, h) = if cw >= ch { ((540.0 * cw / ch).round() as u32 / 2 * 2, 540) } else { (540, (540.0 * ch / cw).round() as u32 / 2 * 2) };
    let cuts: std::collections::BTreeSet<i64> = project.tracks.iter().filter(|t| t.kind == TrackKind::Video).flat_map(|t| t.segments.iter().map(|s| fps.frame_of(s.target.start))).collect();
    let end = Micros(project.duration().0.min((secs * 1e6) as i64));
    let mut engine = openrip_playback::PreviewEngine::new(project)?;
    let surface = openrip_render::Compositor::output_surface(w, h).ok_or("surface")?;
    let (mut all, mut at_cuts) = (Vec::new(), Vec::new());
    let mut n = 0;
    let started = Instant::now();
    while fps.frame_start(n) < end {
        if realtime {
            let due = std::time::Duration::from_micros(fps.frame_start(n).0 as u64);
            std::thread::sleep(due.saturating_sub(started.elapsed()));
        }
        let t0 = Instant::now();
        engine.render_to_surface(fps.frame_start(n), &surface)?;
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        if verbose && ms > 1000.0 / fps.as_f64() {
            println!("  slow frame {n} (t = {:.3} s): {ms:.1} ms", fps.frame_start(n).as_secs_f64());
        }
        all.push(ms);
        if cuts.contains(&n) && n > 0 {
            at_cuts.push(ms);
        }
        n += 1;
    }
    let budget = 1000.0 / fps.as_f64();
    println!("{n} frames at {w}x{h}, {} cuts; frame budget {budget:.1} ms", at_cuts.len());
    let over = all.iter().filter(|m| **m > budget).count();
    summary("all frames", all);
    summary("frames where a clip starts", at_cuts);
    println!("frames over budget: {over}");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn playthrough(_args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    Err("playthrough needs macOS".into())
}

#[cfg(target_os = "macos")]
fn pipeline_bench(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use openrip_model::Micros;
    use std::sync::Arc;
    let project = load_project(Path::new(&args[1]))?;
    let secs: f64 = args.iter().position(|a| a == "--seconds").and_then(|i| args.get(i + 1)).map(|s| s.parse()).transpose()?.unwrap_or(20.0);
    let fps = project.fps;
    let (cw, ch) = (project.canvas.width.max(1) as f64, project.canvas.height.max(1) as f64);
    let (w, h) = if cw >= ch { ((540.0 * cw / ch).round() as u32 / 2 * 2, 540) } else { (540, (540.0 * ch / cw).round() as u32 / 2 * 2) };
    let end = project.duration().as_secs_f64().min(secs);
    let pipeline = openrip_playback::PreviewPipeline::new(project, w, h)?;
    // Warm up on the first frame, as the app does when a project opens.
    pipeline.seek(Micros::ZERO);
    while pipeline.frame(Micros::ZERO).is_none() {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let start = Arc::new(Instant::now());
    let clock_start = start.clone();
    pipeline.play(Arc::new(move || Micros((clock_start.elapsed().as_secs_f64() * 1e6) as i64)));
    let tick = std::time::Duration::from_micros(16_667);
    let (mut shown, mut late, mut last_new, mut max_gap) = (0u64, 0u64, Instant::now(), 0f64);
    let budget = fps.frame_duration().0;
    let mut i = 0u32;
    while start.elapsed().as_secs_f64() < end {
        i += 1;
        std::thread::sleep((tick * i).saturating_sub(start.elapsed()));
        let now = Micros((start.elapsed().as_secs_f64() * 1e6) as i64);
        if let Some(f) = pipeline.frame(now) {
            shown += 1;
            if now.0 - f.time.0 > budget {
                late += 1;
            }
            max_gap = max_gap.max(last_new.elapsed().as_secs_f64() * 1e3);
            last_new = Instant::now();
            pipeline.recycle(f.surface);
        }
    }
    let st = pipeline.stats();
    let expected = (end * fps.as_f64()) as u64;
    println!("{end:.1} s at {:.2} fps, {w}x{h}: {shown} frames shown of {expected} ({late} more than a frame late), {} rendered, {} dropped", fps.as_f64(), st.rendered, st.dropped);
    println!("longest time without a new frame: {max_gap:.1} ms (one frame = {:.1} ms)", budget as f64 / 1000.0);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn pipeline_bench(_args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    Err("pipeline-bench needs macOS".into())
}

fn thumbs_bench(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use openrip_playback::{Pass, Thumbnailer};
    let path = Path::new(&args[1]);
    let count: usize = flag(args, "--count").map(|s| s.to_string_lossy().parse()).transpose()?.unwrap_or(40);
    let height: u32 = flag(args, "--height").map(|s| s.to_string_lossy().parse()).transpose()?.unwrap_or(64);
    let duration = openrip_media::probe(path)?.duration;
    let times: Vec<_> = (0..count).map(|i| openrip_model::Micros(duration.0 * i as i64 / count as i64)).collect();
    let cache = std::env::temp_dir().join(format!("openrip-thumbs-bench-{}", std::process::id()));
    let pass = |t: &mut Thumbnailer, p: Pass| -> Result<(f64, f64, usize, usize), Box<dyn std::error::Error>> {
        let t0 = Instant::now();
        let (mut first, mut n, mut exact) = (None, 0, 0);
        t.thumbnails(path, &times, height, p, |th| {
            first.get_or_insert(t0.elapsed().as_secs_f64() * 1e3);
            n += 1;
            exact += th.exact as usize;
            true
        })?;
        Ok((first.unwrap_or(0.0), t0.elapsed().as_secs_f64() * 1e3, n, exact))
    };
    let t0 = Instant::now();
    let mut t = Thumbnailer::new(Some(cache.clone()))?;
    println!("thumbnailer ready in {:.0} ms", t0.elapsed().as_secs_f64() * 1e3);
    for (name, p, fresh) in [("quick", Pass::Quick, false), ("exact", Pass::Exact, false), ("exact (disk cache, new thumbnailer)", Pass::Exact, true)] {
        if fresh {
            t = Thumbnailer::new(Some(cache.clone()))?;
        }
        let (first, total, n, exact) = pass(&mut t, p)?;
        println!("{name:<38} first {first:>6.1} ms  all {n:>3} in {total:>7.1} ms  ({:.1} ms each, {exact} exact)", total / n.max(1) as f64);
    }
    let _ = std::fs::remove_dir_all(&cache);
    Ok(())
}

/// Paused seeks as the app makes them: one engine, frames at 24 scattered times at 540 px
/// wide, then the same times again (warm caches). Set OPENRIP_TRACE for slow segments.
fn seek_bench(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let project = load_project(path)?;
    let end = project.duration().0.max(1);
    let (cw, ch) = (project.canvas.width.max(1), project.canvas.height.max(1));
    let short: u32 = std::env::args().skip_while(|a| a != "--short").nth(1).and_then(|v| v.parse().ok()).unwrap_or(540);
    let (w, h) = if cw <= ch { (short, (short * ch / cw) & !1) } else { ((short * cw / ch) & !1, short) };
    if std::env::args().any(|a| a == "--scrub") {
        // A playhead dragged across the project: 120 steps, quick frames on and off, each
        // on a fresh engine so neither inherits the other's decoded frames.
        for scrub in [true, false] {
            let mut engine = openrip_playback::PreviewEngine::new(project.clone())?;
            engine.set_scrubbing(scrub);
            let mut ms = Vec::new();
            for i in 0..120i64 {
                let t = openrip_model::Micros(i * end / 120);
                let t0 = Instant::now();
                engine.render_image(t, w, h)?;
                ms.push(t0.elapsed().as_secs_f64() * 1e3);
            }
            ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
            println!("drag, quick frames {scrub}: p50 {:.0} ms, p90 {:.0} ms, max {:.0} ms", ms[ms.len() / 2], ms[ms.len() * 9 / 10], ms[ms.len() - 1]);
        }
        // The app's drag: the playhead crosses 80% of the project in 2 s and each frame
        // shows wherever it is when the last one is done (into a preview surface, as the
        // app renders), on a fresh engine.
        #[cfg(target_os = "macos")]
        {
            let mut engine = openrip_playback::PreviewEngine::new(project.clone())?;
            engine.set_scrubbing(true);
            let surface = openrip_render::Compositor::output_surface(w, h).ok_or("no surface")?;
            let (mut ms, t0) = (Vec::new(), Instant::now());
            while t0.elapsed().as_secs_f64() < 2.0 {
                let t = openrip_model::Micros(end / 50 + (t0.elapsed().as_secs_f64() / 2.0 * 0.8 * end as f64) as i64);
                let t1 = Instant::now();
                engine.render_to_surface(t, &surface)?;
                ms.push(t1.elapsed().as_secs_f64() * 1e3);
            }
            let n = ms.len();
            ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
            println!("real-time drag: {n} frames in 2 s ({:.0}/s), frame p50 {:.0} ms, p90 {:.0} ms, max {:.0} ms", n as f64 / 2.0, ms[n / 2], ms[n * 9 / 10], ms[n - 1]);
        }
        return Ok(());
    }
    let mut engine = openrip_playback::PreviewEngine::new(project)?;
    for pass in ["cold", "warm"] {
        let mut ms = Vec::new();
        for i in 0..24i64 {
            let t = openrip_model::Micros((i * 7919 % 24) * end / 24 + end / 48);
            let t0 = Instant::now();
            engine.render_image(t, w, h)?;
            ms.push(t0.elapsed().as_secs_f64() * 1e3);
        }
        let mut s = ms.clone();
        s.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("{pass}: p50 {:.0} ms, p90 {:.0} ms, max {:.0} ms", s[s.len() / 2], s[s.len() * 9 / 10], s[s.len() - 1]);
    }
    Ok(())
}

/// The compositor on a project's stills, as exact frames meet them, into a 540-pixel preview
/// surface and an NV12 export buffer at the canvas size: each drawn full-frame as a new
/// still (decoded already), written ahead by another thread, again from the GPU cache, and
/// at new sizes (a scale being dragged).
#[cfg(target_os = "macos")]
fn still_bench(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use openrip_render::{Compositor, Layer, Source};
    let project = load_project(Path::new(&args[1]))?;
    let count: usize = flag(args, "--count").map(|s| s.to_string_lossy().parse()).transpose()?.unwrap_or(12);
    let mut paths: Vec<&str> = project.materials.media.iter().filter(|m| m.kind == openrip_model::MediaKind::Photo).map(|m| m.path.as_str()).collect();
    paths.dedup();
    let t0 = Instant::now();
    let stills: Vec<_> = paths.iter().filter_map(|p| openrip_playback::preview::load_png(Path::new(p)).ok()).take(count).collect();
    let Some(first) = stills.first() else { return Err("no PNG stills in the project".into()) };
    println!("{} stills ({}x{}) decoded in {:.0} ms", stills.len(), first.width, first.height, t0.elapsed().as_secs_f64() * 1e3);
    let (cw, ch) = (project.canvas.width.max(1), project.canvas.height.max(1));
    let preview = if cw <= ch { (540, (540 * ch / cw) & !1) } else { ((540 * cw / ch) & !1, 540) };
    let compositor = Compositor::new()?;
    let uploader = compositor.uploader();
    for (name, (w, h), nv12) in [("preview", preview, false), ("export", (cw & !1, ch & !1), true)] {
        let target = if nv12 { Compositor::output_surface_nv12(w, h) } else { Compositor::output_surface(w, h) }.ok_or("no surface")?;
        let draw = |key: u64, img: &openrip_render::RgbaImage, scale: f64| -> Result<f64, Box<dyn std::error::Error>> {
            let layer = Layer::from_model(Source::Cached(key, img), [w, h], [0.0, 0.0], [scale, scale], 0.0);
            let t0 = Instant::now();
            if nv12 {
                compositor.render_to_nv12(&target, [0, 0, 0], &[layer])?;
            } else {
                compositor.render_to_surface(&target, [0, 0, 0], &[layer])?;
            }
            Ok(t0.elapsed().as_secs_f64() * 1e3)
        };
        let (mut new, mut ahead, mut cached, mut resized) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for (i, img) in stills.iter().enumerate() {
            let key = (i as u64) << 32 | w as u64;
            new.push(draw(key, img, 1.0)?);
            cached.push(draw(key, img, 1.0)?);
            // A scale being dragged: a frame at one new size, then the next at another.
            draw(key, img, 0.95)?;
            resized.push(draw(key, img, 0.9)?);
            // Written by another thread a moment before, as the engine's workers do while the
            // render thread decodes the frame's video.
            let key = key | 1 << 63;
            std::thread::scope(|s| s.spawn(|| uploader.upload(key, img)).join()).map_err(|_| "upload thread")?;
            std::thread::sleep(std::time::Duration::from_millis(20));
            ahead.push(draw(key, img, 1.0)?);
        }
        println!("{name} {w}x{h}:");
        summary("  new still", new);
        summary("  new still written ahead", ahead);
        summary("  same still again (GPU cache)", cached);
        summary("  same still, scale dragged", resized);
    }
    // One frame over and over while another thread writes stills back to back (far more
    // than playback asks for): what writing ahead costs the frames drawn meanwhile.
    let target = Compositor::output_surface(preview.0, preview.1).ok_or("no surface")?;
    let layer = Layer::from_model(Source::Cached(0, first), [preview.0, preview.1], [0.0, 0.0], [1.0, 1.0], 0.0);
    let frames = |n: usize| -> Result<Vec<f64>, Box<dyn std::error::Error>> {
        (0..n)
            .map(|_| {
                let t0 = Instant::now();
                compositor.render_to_surface(&target, [0, 0, 0], std::slice::from_ref(&layer))?;
                Ok(t0.elapsed().as_secs_f64() * 1e3)
            })
            .collect()
    };
    let quiet = frames(60)?;
    let stop = std::sync::atomic::AtomicBool::new(false);
    let busy = std::thread::scope(|s| {
        s.spawn(|| {
            for (i, img) in stills.iter().cycle().enumerate() {
                if stop.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                uploader.upload(1 << 62 | i as u64, img);
            }
        });
        let busy = frames(60);
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        busy
    })?;
    summary("cached frame", quiet);
    summary("cached frame, stills written beside", busy);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn still_bench(_args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    Err("still-bench needs macOS".into())
}

/// Every draft under `root` converted to the app's project format and back: the round trip
/// must draw the same frames (at 0, ¼, ½ and ¾ of the draft) as the draft itself.
fn app_roundtrip(root: &Path, with_audio: bool) -> Result<(), Box<dyn std::error::Error>> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(root)?.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.join("draft_info.json").exists()).collect();
    dirs.sort();
    let (mut worst, mut compared, mut skipped) = (f64::INFINITY, 0, 0);
    let mut worst_audio = 0f32;
    for (i, dir) in dirs.iter().enumerate() {
        let Ok(Imported { project, .. }) = import_draft_dir(dir) else { continue };
        let mut original = openrip_playback::PreviewEngine::new(project.clone())?;
        let t0 = Instant::now();
        let doc = openrip_v1::to_app_project(&project, &mut |seg| original.text_block(&seg.id));
        let convert_ms = t0.elapsed().as_secs_f64() * 1e3;
        let back = match openrip_v1::import_v1_json(&doc) {
            Ok(b) => b,
            Err(e) => {
                println!("draft #{i:02}: re-import failed: {e}");
                continue;
            }
        };
        let mut again = openrip_playback::PreviewEngine::new(back.project.clone())?;
        let end = project.tracks.iter().flat_map(|t| t.segments.iter()).map(|s| s.target.end().0).max().unwrap_or(0);
        let (w, h) = if project.canvas.width >= project.canvas.height { (480, (480 * project.canvas.height / project.canvas.width.max(1)) & !1) } else { ((480 * project.canvas.width / project.canvas.height.max(1)) & !1, 480) };
        let mut low = f64::INFINITY;
        let mut missing = false;
        for q in 0..4 {
            let t = openrip_model::Micros(end * q / 4);
            let (a, ra) = original.render_image(t, w, h)?;
            let (b, _) = again.render_image(t, w, h)?;
            missing |= !ra.missing.is_empty();
            let rgb: Vec<u8> = b.data.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
            let db = psnr_rgba_rgb(&a, &rgb);
            if db < 100.0 {
                if let Some(dir) = std::env::var_os("OPENRIP_RT_DUMP") {
                    let dir = PathBuf::from(dir);
                    std::fs::create_dir_all(&dir)?;
                    save_png(&dir.join(format!("d{i:02}-q{q}-orig.png")), &a)?;
                    save_png(&dir.join(format!("d{i:02}-q{q}-back.png")), &b)?;
                    std::fs::write(dir.join(format!("d{i:02}-app.json")), serde_json::to_string_pretty(&doc)?)?;
                    std::fs::write(dir.join(format!("d{i:02}-orig.json")), serde_json::to_string_pretty(&project)?)?;
                    std::fs::write(dir.join(format!("d{i:02}-back.json")), serde_json::to_string_pretty(&back.project)?)?;
                }
                println!("  draft #{i:02} at {:.2} s: {db:.1} dB", t.as_secs_f64());
            }
            low = low.min(db);
        }
        if missing {
            skipped += 1;
            continue;
        }
        // The sound too (its first 20 s): the largest difference between the two mixes.
        if with_audio {
            let n = (end.min(20_000_000) as f64 * openrip_audio::RATE as f64 / 1e6) as usize;
            let (a, b) = (audio::mix(project.clone(), 0, n)?, audio::mix(back.project.clone(), 0, n)?);
            let diff = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).fold(0f32, f32::max);
            if diff > 0.0 {
                println!("  draft #{i:02}: mixes differ by up to {diff:.2e}");
                if let Some(dir) = std::env::var_os("OPENRIP_RT_DUMP") {
                    let dir = PathBuf::from(dir);
                    std::fs::create_dir_all(&dir)?;
                    std::fs::write(dir.join(format!("d{i:02}-orig.json")), serde_json::to_string_pretty(&project)?)?;
                    std::fs::write(dir.join(format!("d{i:02}-back.json")), serde_json::to_string_pretty(&back.project)?)?;
                }
            }
            worst_audio = worst_audio.max(diff);
        }
        compared += 1;
        worst = worst.min(low);
        let note = if back.report.warnings.is_empty() && back.report.problems.is_empty() { String::new() } else { format!("  warnings {:?} problems {:?}", back.report.warnings, back.report.problems) };
        println!("draft #{i:02}: {} segments, converted in {convert_ms:.0} ms, worst frame {low:5.1} dB{note}", project.tracks.iter().map(|t| t.segments.len()).sum::<usize>());
    }
    println!("{compared} drafts compared ({skipped} with media missing); worst {worst:.1} dB");
    if with_audio {
        println!("mixes: largest difference {worst_audio:.2e}");
    }
    Ok(())
}

fn cover_parity(root: &Path, save: Option<PathBuf>) -> Result<(), Box<dyn std::error::Error>> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(root)?.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.join("draft_info.json").exists() && p.join("draft_cover.jpg").exists()).collect();
    dirs.sort();
    if let Some(dir) = &save {
        std::fs::create_dir_all(dir)?;
    }
    let (mut psnrs, mut skipped) = (Vec::new(), 0);
    for (i, dir) in dirs.iter().enumerate() {
        let Ok(Imported { project, .. }) = import_draft_dir(dir) else { continue };
        // CapCut's cover, decoded like any still.
        let mut d = openrip_media::VideoDecoder::open(&dir.join("draft_cover.jpg"), &openrip_media::DecoderOptions { hardware: openrip_media::HardwareMode::Off, ..Default::default() })?;
        let Some(cover) = d.next_frame()?.map(|f| f.to_rgb()).transpose()? else { continue };
        let mut engine = openrip_playback::PreviewEngine::new(project)?;
        let (ours, report) = engine.render_image(openrip_model::Micros::ZERO, cover.width, cover.height)?;
        if !report.missing.is_empty() {
            skipped += 1;
            continue;
        }
        let (mut se, mut far) = (0f64, 0usize);
        let n = (cover.width * cover.height) as usize;
        for k in 0..n {
            for c in 0..3 {
                let e = ours.data[k * 4 + c] as f64 - cover.data[k * 3 + c] as f64;
                se += e * e;
            }
            if (0..3).any(|c| (ours.data[k * 4 + c] as i32 - cover.data[k * 3 + c] as i32).abs() > 32) {
                far += 1;
            }
        }
        let psnr = 10.0 * (255.0f64 * 255.0 / (se / (3 * n) as f64).max(1e-9)).log10();
        println!("draft #{i:02}: {:>4} layers  PSNR {psnr:5.1} dB  pixels off by > 32: {:5.2}%", report.layers, 100.0 * far as f64 / n as f64);
        psnrs.push(psnr);
        if let Some(out) = &save {
            let (w, h) = (cover.width, cover.height);
            let mut img = openrip_render::RgbaImage { width: w * 3, height: h, data: vec![255; (w * 3 * h * 4) as usize] };
            for y in 0..h as usize {
                for x in 0..w as usize {
                    let (o, c) = (y * w as usize + x, (y * w as usize * 3 + x) * 4);
                    for ch in 0..3 {
                        let (a, b) = (ours.data[o * 4 + ch], cover.data[o * 3 + ch]);
                        img.data[c + ch] = a;
                        img.data[c + w as usize * 4 + ch] = b;
                        img.data[c + w as usize * 8 + ch] = ((a as i32 - b as i32).unsigned_abs() * 4).min(255) as u8;
                    }
                }
            }
            save_png(&out.join(format!("cover{i:02}.png")), &img)?;
        }
    }
    psnrs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    if !psnrs.is_empty() {
        println!("{} drafts compared ({skipped} left out: media missing at the first frame); PSNR p50 {:.1} dB, worst {:.1} dB", psnrs.len(), percentile(&psnrs, 0.5), psnrs[0]);
    }
    Ok(())
}

fn wrap_probe(draft: &Path, export: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use openrip_model::{Micros, TrackKind};
    let raw: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(draft.join("draft_info.json"))?)?;
    let project = import_draft_dir(draft)?.project;
    let (cw, ch) = (project.canvas.width, project.canvas.height);
    let (w, h) = (cw / 2, ch / 2);
    let mut dec = openrip_media::VideoDecoder::open(export, &Default::default())?;
    let mut engine = openrip_playback::PreviewEngine::new(project.clone())?;
    let raw_text = |id: &str| raw["materials"]["texts"].as_array().and_then(|a| a.iter().find(|m| m["id"] == id)).cloned().unwrap_or_default();
    for (ti, track) in project.tracks.iter().enumerate().filter(|(_, t)| t.kind == TrackKind::Text && !t.hidden) {
        for (si, seg) in track.segments.iter().enumerate() {
            let Some(text) = project.materials.texts.iter().find(|m| m.id == seg.material) else { continue };
            if text.text.chars().count() < 12 || seg.target.duration.0 < 300_000 {
                continue;
            }
            // Late in the clip, so intros have finished.
            let t = Micros(seg.target.start.0 + seg.target.duration.0 * 4 / 5);
            let Some(frame) = dec.frame_at(t)? else { continue };
            let rgb = frame.to_rgb()?;
            // CapCut's frame at our preview size (box filter; exports are 2x here).
            let k = (rgb.width / w).max(1);
            let theirs: Vec<f32> = (0..(w * h) as usize).flat_map(|i| {
                let (x, y) = ((i as u32 % w) * k, (i as u32 / w) * k);
                (0..3).map(move |c| (x, y, c))
            }).map(|(x, y, c)| {
                let mut sum = 0u32;
                for dy in 0..k { for dx in 0..k { sum += rgb.data[(((y + dy) * rgb.width + x + dx) * 3) as usize + c] as u32; } }
                sum as f32 / (k * k) as f32
            }).collect();
            let scale = seg.transform.scale.sample(seg.local_time(t)).x.abs().max(1e-6);
            let mut scores = Vec::new();
            for step in 0..=60 {
                let f = 0.30 + step as f64 * 0.015; // screen fraction of the canvas width
                let mut p = project.clone();
                let tm = p.materials.texts.iter_mut().find(|m| m.id == seg.material).unwrap();
                tm.layout.max_width = Some((f / scale) as f32);
                engine.set_project(p);
                let (ours, _) = engine.render_image(t, w, h)?;
                let se: f64 = (0..(w * h) as usize).flat_map(|i| (0..3).map(move |c| (i, c))).map(|(i, c)| (ours.data[i * 4 + c] as f64 - theirs[i * 3 + c] as f64).powi(2)).sum();
                scores.push((f, 10.0 * (255.0f64.powi(2) / (se / (w * h * 3) as f64)).log10()));
            }
            let best = scores.iter().map(|s| s.1).fold(f64::MIN, f64::max);
            let worst = scores.iter().map(|s| s.1).fold(f64::MAX, f64::min);
            // The widths within 0.05 dB of the best: CapCut's wrap width lies in there.
            let good: Vec<f64> = scores.iter().filter(|s| s.1 >= best - 0.05).map(|s| s.0).collect();
            let rt = raw_text(&text.id.0);
            let size = text.runs.first().map_or(0.0, |r| r.size);
            println!(
                "{{\"track\": {ti}, \"seg\": {si}, \"chars\": {}, \"size\": {size}, \"scale\": {scale:.4}, \"fixed_width\": {}, \"line_max_width\": {}, \"canvas_w\": {cw}, \"lo\": {:.3}, \"hi\": {:.3}, \"spread_db\": {:.2}, \"best_db\": {best:.2}}}",
                text.text.chars().count(), rt["fixed_width"], rt["line_max_width"], good.first().unwrap(), good.last().unwrap(), best - worst
            );
        }
    }
    Ok(())
}

/// A decoded RGB frame resampled to `w`x`h` by area averaging (any size, up or down).
#[allow(clippy::needless_range_loop)]
fn shrink_rgb(rgb: &openrip_media::RgbImage, w: u32, h: u32) -> Vec<u8> {
    let (sx, sy) = (rgb.width as f64 / w as f64, rgb.height as f64 / h as f64);
    let mut out = vec![0u8; (w * h * 3) as usize];
    for y in 0..h {
        let (y0, y1) = (y as f64 * sy, (y + 1) as f64 * sy);
        for x in 0..w {
            let (x0, x1) = (x as f64 * sx, (x + 1) as f64 * sx);
            let mut acc = [0f64; 3];
            let mut wsum = 0.0;
            for yy in y0.floor() as u32..(y1.ceil() as u32).min(rgb.height) {
                let wy = (y1.min(yy as f64 + 1.0) - y0.max(yy as f64)).max(0.0);
                for xx in x0.floor() as u32..(x1.ceil() as u32).min(rgb.width) {
                    let wx = (x1.min(xx as f64 + 1.0) - x0.max(xx as f64)).max(0.0);
                    let i = ((yy * rgb.width + xx) * 3) as usize;
                    for c in 0..3 {
                        acc[c] += rgb.data[i + c] as f64 * wx * wy;
                    }
                    wsum += wx * wy;
                }
            }
            for c in 0..3 {
                out[((y * w + x) * 3) as usize + c] = (acc[c] / wsum.max(1e-9)).round() as u8;
            }
        }
    }
    out
}

fn psnr_rgba_rgb(ours: &openrip_render::RgbaImage, theirs: &[u8]) -> f64 {
    let n = (ours.width * ours.height) as usize;
    let se: f64 = (0..n).map(|i| (0..3).map(|c| (ours.data[i * 4 + c] as f64 - theirs[i * 3 + c] as f64).powi(2)).sum::<f64>()).sum();
    10.0 * (255.0f64.powi(2) / (se / (3 * n) as f64).max(1e-9)).log10()
}

fn export_parity(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let project = load_project(Path::new(&args[1]))?;
    let every: f64 = flag(args, "--every").map(|s| s.to_string_lossy().parse()).transpose()?.unwrap_or(2.0);
    let from: f64 = flag(args, "--from").map(|s| s.to_string_lossy().parse()).transpose()?.unwrap_or(0.0);
    let save = flag(args, "--save");
    let (w, h) = (project.canvas.width / 2, project.canvas.height / 2);
    let duration = project.duration();
    let to: f64 = flag(args, "--to").map(|s| s.to_string_lossy().parse()).transpose()?.unwrap_or(duration.as_secs_f64());
    let mut dec = openrip_media::VideoDecoder::open(Path::new(&args[2]), &Default::default())?;
    let mut engine = openrip_playback::PreviewEngine::new(project)?;
    let mut samples = Vec::new();
    let mut t = from + every / 2.0;
    while t < to.min(duration.as_secs_f64() - 0.05) {
        let at = openrip_model::Micros::from_secs_f64(t);
        if let Some(frame) = dec.frame_at(at)? {
            // Render at the export's size, as CapCut did, then bring both to half the canvas
            // with the same filter.
            let rgb = frame.to_rgb()?;
            let theirs = shrink_rgb(&rgb, w, h);
            // At the export frame's own time, which can be up to a frame before `at`.
            let (full, report) = engine.render_image(frame.time, rgb.width, rgb.height)?;
            let full_rgb = openrip_media::RgbImage { width: full.width, height: full.height, data: full.data.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect() };
            let small = shrink_rgb(&full_rgb, w, h);
            let ours = openrip_render::RgbaImage { width: w, height: h, data: small.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect() };
            samples.push((t, psnr_rgba_rgb(&ours, &theirs), report.missing.len(), ours, theirs));
        }
        t += every;
    }
    let mut ps: Vec<f64> = samples.iter().map(|s| s.1).collect();
    ps.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let missing = samples.iter().filter(|s| s.2 > 0).count();
    println!("{} samples every {every} s ({missing} with media missing): PSNR p50 {:.1} dB, p10 {:.1} dB, worst {:.1} dB", samples.len(), percentile(&ps, 0.5), percentile(&ps, 0.1), ps[0]);
    if args.iter().any(|a| a == "--all") {
        for s in &samples {
            println!("  sample: {:7.2} s  {:5.1} dB{}", s.0, s.1, if s.2 > 0 { "  (media missing)" } else { "" });
        }
    }
    let mut worst: Vec<_> = samples.iter().collect();
    worst.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    for s in worst.iter().take(5) {
        println!("  worst: {:7.2} s  {:5.1} dB{}", s.0, s.1, if s.2 > 0 { "  (media missing)" } else { "" });
    }
    if let Some(dir) = save {
        std::fs::create_dir_all(&dir)?;
        for s in worst.iter().take(5) {
            let mut img = openrip_render::RgbaImage { width: w * 3, height: h, data: vec![255; (w * 3 * h * 4) as usize] };
            for i in 0..(w * h) as usize {
                let (y, x) = (i / w as usize, i % w as usize);
                let o = (y * w as usize * 3 + x) * 4;
                for c in 0..3 {
                    let (a, b) = (s.3.data[i * 4 + c], s.4[i * 3 + c]);
                    img.data[o + c] = a;
                    img.data[o + w as usize * 4 + c] = b;
                    img.data[o + w as usize * 8 + c] = ((a as i32 - b as i32).unsigned_abs() * 4).min(255) as u8;
                }
            }
            save_png(&dir.join(format!("t{:07.2}.png", s.0)), &img)?;
        }
    }
    Ok(())
}
