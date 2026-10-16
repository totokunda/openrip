//! Developer CLI.
//!
//!   openrip-dev capcut-import <draft-dir> [--out project.json]
//!       Import one CapCut draft folder and print a summary + import report.
//!   openrip-dev capcut-scan <projects-root>
//!       Import every draft under a CapCut projects folder and print aggregate
//!       statistics only (no project names, paths or text content).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use openrip_capcut::{import_draft_dir, ImportError, Imported};
use openrip_model::Project;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("capcut-import") if args.len() >= 2 => capcut_import(Path::new(&args[1]), flag(&args, "--out")),
        Some("capcut-scan") if args.len() >= 2 => capcut_scan(Path::new(&args[1])),
        _ => {
            eprintln!("usage:\n  openrip-dev capcut-import <draft-dir> [--out project.json]\n  openrip-dev capcut-scan <projects-root>");
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
