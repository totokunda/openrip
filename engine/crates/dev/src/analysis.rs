//! The analysis tools from the command line: Split scenes on a file (for
//! bench/scenes/scene-bench.py's precision and recall) and the colour statistics and Auto
//! adjust values of one.

use std::path::Path;
use std::time::Instant;

use openrip_model::Micros;

fn opt(args: &[String], name: &str) -> Option<f64> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok())
}

fn range(args: &[String]) -> (Micros, Option<Micros>) {
    let start = Micros((opt(args, "--start").unwrap_or(0.0) * 1e6) as i64);
    (start, opt(args, "--duration").map(|d| Micros((d * 1e6) as i64)))
}

/// `scene-scan <file> [--start S] [--duration S] [--sensitivity X] [--json]`: the shot changes
/// found, one line each (time in seconds, kind, transition, score), or one JSON object.
pub fn scene_scan(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let path = Path::new(&args[1]);
    let (start, duration) = range(args);
    let sensitivity = opt(args, "--sensitivity").unwrap_or(0.5) as f32;
    let t0 = Instant::now();
    let mut frames = 0;
    let cuts = openrip_playback::scan_scenes(path, start, duration, sensitivity, 0.4, &mut |d, _| {
        frames = d;
        true
    })?;
    let secs = t0.elapsed().as_secs_f64();
    let kind = |k: openrip_analysis::CutKind| format!("{k:?}").to_lowercase();
    if args.iter().any(|a| a == "--json") {
        let list: Vec<serde_json::Value> = cuts.iter().map(|c| serde_json::json!({ "time": c.time as f64 / 1e6, "kind": kind(c.kind), "start": c.start as f64 / 1e6, "end": c.end as f64 / 1e6, "score": c.score })).collect();
        println!("{}", serde_json::json!({ "frames": frames, "seconds": secs, "cuts": list }));
    } else {
        for c in &cuts {
            println!("{:9.3}s  {:8}  {:.3}-{:.3}  {:.2}", c.time as f64 / 1e6, kind(c.kind), c.start as f64 / 1e6, c.end as f64 / 1e6, c.score);
        }
        println!("{} cuts, {frames} frames in {secs:.2} s ({:.0} fps)", cuts.len(), frames as f64 / secs.max(1e-9));
    }
    Ok(())
}

/// `color-scan <file> [--start S] [--duration S]`: the colour statistics and the Auto adjust
/// values (panel scale).
pub fn color_scan(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let path = Path::new(&args[1]);
    let (start, duration) = range(args);
    let sample = openrip_playback::sample_colors(path, start, duration, 12, &mut |_, _| true)?;
    let stats = sample.stats();
    let model = |s: &openrip_analysis::Sliders, rgb: [f32; 3]| {
        openrip_render::Adjust { brightness: s.brightness, contrast: s.contrast, saturation: s.saturation, temperature: s.temperature, tint: s.tint, whites: s.whites, blacks: s.blacks, ..Default::default() }.apply_rgb(rgb)
    };
    let sliders = openrip_analysis::auto_adjust(sample.pixels(), &model);
    println!("{stats:#?}");
    println!("auto adjust: {:?}", sliders.panel());
    Ok(())
}
