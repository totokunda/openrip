//! Motion tools on real footage: Smooth slow-mo's frames and speed (`slowmo`), and the region
//! tracker (`track`).

use std::path::{Path, PathBuf};
use std::time::Instant;

use openrip_model::{ComplementFrame, ComplementMode, FrameRate, Micros, Project};
use openrip_playback::PreviewEngine;
use openrip_render::{Compositor, Layer, Picture, RgbaImage, Source, Tween, TweenMode};

use crate::{flag, save_png, summary};

fn arg<T: std::str::FromStr>(args: &[String], name: &str, default: T) -> T {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// A project of the whole file on a timeline the file's upright shape, at `speed` from `from`
/// seconds, with Smooth slow-mo in `mode` (or none).
fn slowmo_project(path: &Path, info: &openrip_media::VideoInfo, duration: Micros, speed: f64, from: f64, mode: Option<ComplementMode>) -> Project {
    let (w, h) = if info.rotation.rem_euclid(180) == 90 { (info.height, info.width) } else { (info.width, info.height) };
    // The canvas at 1080 on the short side, as a phone project would be.
    let k = 1080.0 / w.min(h) as f64;
    let (cw, ch) = (((w as f64 * k) as u32) & !1, ((h as f64 * k) as u32) & !1);
    let from = Micros::from_secs_f64(from);
    let source = Micros(duration.0 - from.0);
    let target = Micros((source.0 as f64 / speed) as i64);
    let mut p: Project = serde_json::from_value(serde_json::json!({
        "format": 2, "id": "slowmo", "name": "slowmo", "canvas": { "width": cw, "height": ch }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [{
            "id": "s", "material": "m", "source": { "start": from.0, "duration": source.0 }, "target": { "start": 0, "duration": target.0 },
            "speed": speed, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        }]}],
        "materials": { "media": [{ "id": "m", "kind": "video", "path": path, "width": info.width, "height": info.height, "duration": duration.0 }] }
    }))
    .expect("project");
    p.materials.media[0].complement_frame = mode.map(|mode| ComplementFrame { mode });
    p
}

fn luma(img: &RgbaImage) -> Vec<f32> {
    img.data.chunks_exact(4).map(|p| (0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32) / 255.0).collect()
}

fn psnr(a: &[f32], b: &[f32]) -> f64 {
    let mse: f64 = a.iter().zip(b).map(|(x, y)| ((x - y) as f64).powi(2)).sum::<f64>() / a.len().max(1) as f64;
    10.0 * (1.0 / mse.max(1e-12)).log10()
}

/// `openrip-dev slowmo <video> [--speed 0.25] [--from S] [--frames N] [--size LONG] [--save DIR] [--holdout N]`
///
/// Plays the file at `speed` through the preview engine with Smooth slow-mo off, blended and by
/// optical flow: time per frame at the preview size, and how many frames repeat the one before.
/// With `--holdout N`, N places in the file: the frame between two source frames made from the
/// frames either side of it, against the real one (PSNR, at the preview size).
pub fn slowmo(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let path = PathBuf::from(&args[1]);
    let speed: f64 = arg(args, "--speed", 0.25);
    let from: f64 = arg(args, "--from", 0.0);
    let frames: i64 = arg(args, "--frames", 120);
    let long: u32 = arg(args, "--size", 960);
    let holdout: usize = arg(args, "--holdout", 0);
    let save = flag(args, "--save");
    openrip_media::warm_up().join().ok();
    let media = openrip_media::probe(&path)?;
    let info = media.video.clone().ok_or("no video stream")?;
    let duration = if info.duration.0 > 0 { info.duration } else { media.duration };
    let fps = info.frame_rate.map(|r| r.as_f64()).unwrap_or(30.0);
    println!("{} {}x{} at {fps:.2} fps, {:.2} s, turned {}°; at {speed}× on a 30 fps timeline", info.codec, info.width, info.height, duration.as_secs_f64(), info.rotation);
    let timeline = FrameRate::new(30, 1);
    for (name, mode) in [("held frames", None), ("frame blending", Some(ComplementMode::FrameBlending)), ("optical flow", Some(ComplementMode::OpticalFlow))] {
        let project = slowmo_project(&path, &info, duration, speed, from, mode);
        let (cw, ch) = (project.canvas.width as f64, project.canvas.height as f64);
        let k = long as f64 / cw.max(ch);
        let (w, h) = (((cw * k) as u32) & !1, ((ch * k) as u32) & !1);
        let mut engine = PreviewEngine::new(project)?;
        let mut ms = Vec::new();
        let mut previous: Option<Vec<f32>> = None;
        let mut repeats = 0;
        let started = Instant::now();
        for n in 0..frames {
            let t0 = Instant::now();
            let (img, report) = engine.render_image(timeline.frame_start(n) + Micros(500), w, h)?;
            ms.push(t0.elapsed().as_secs_f64() * 1e3);
            if !report.missing.is_empty() {
                return Err(format!("{:?}", report.missing).into());
            }
            let l = luma(&img);
            if let Some(p) = &previous {
                let mad = p.iter().zip(&l).map(|(a, b)| (a - b).abs() as f64).sum::<f64>() / l.len() as f64;
                repeats += (mad == 0.0) as u32;
            }
            previous = Some(l);
            if let Some(dir) = &save {
                std::fs::create_dir_all(dir)?;
                let tag = name.split(' ').next_back().unwrap_or(name);
                save_png(&dir.join(format!("{tag}-{n:04}.png")), &img)?;
            }
        }
        let secs = started.elapsed().as_secs_f64();
        println!("{name}: {frames} frames at {w}x{h} in {secs:.2} s = {:.1} fps; {repeats} of {} are the frame before again", frames as f64 / secs, frames - 1);
        summary(&format!("  {name} per frame"), ms);
    }
    if holdout > 0 {
        holdout_psnr(&path, &info, duration, long, holdout)?;
    }
    Ok(())
}

/// `openrip-dev track <video> --region cx,cy,w,h[,deg] [--at S] [--from S] [--to S] [--direction both|forward|backward] [--save DIR]`
///
/// Tracks the region (fractions of the upright picture) through the file as the Tracking tab
/// does: frames per second, where it went, where tracking was lost, and the drift of a round
/// trip (tracked forward to the end, then back from there to the start frame). `--save`
/// writes every tenth frame with the region drawn.
pub fn track(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use openrip_core::{track_region, TrackControl, TrackDirection, TrackRequest};
    let path = args[1].clone();
    let r: Vec<f64> = args.iter().position(|a| a == "--region").and_then(|i| args.get(i + 1)).ok_or("--region cx,cy,w,h")?.split(',').map(|v| v.parse()).collect::<Result<_, _>>()?;
    let media = openrip_media::probe(Path::new(&path))?;
    let duration = media.video.as_ref().map_or(media.duration, |v| if v.duration.0 > 0 { v.duration } else { media.duration });
    let at = Micros::from_secs_f64(arg(args, "--at", 0.0));
    let from = Micros::from_secs_f64(arg(args, "--from", 0.0));
    let to = Micros::from_secs_f64(arg(args, "--to", duration.as_secs_f64()));
    let direction = TrackDirection::named(&arg(args, "--direction", "both".to_string()));
    let req = TrackRequest { path: path.clone(), at, from, to, center: [r[0], r[1]], size: [r[2], r[3]], rotation: r.get(4).copied().unwrap_or(0.0), direction };
    let control = TrackControl::new();
    let t0 = Instant::now();
    let result = track_region(&req, &control)?;
    let secs = t0.elapsed().as_secs_f64();
    let n = result.samples.len();
    println!("{n} frames tracked at {}x{} in {secs:.2} s = {:.1} fps; lost forward at {:?}, backward at {:?}", result.work_size.0, result.work_size.1, n as f64 / secs, result.lost_forward.map(|t| t.as_secs_f64()), result.lost_backward.map(|t| t.as_secs_f64()));
    for s in result.samples.iter().step_by((n / 12).max(1)) {
        println!("  {:6.3} s: centre ({:.4}, {:.4}) size ({:.4}, {:.4}) {:+.2}° scale {:.3} confidence {:.2}", s.time.as_secs_f64(), s.center[0], s.center[1], s.size[0], s.size[1], s.rotation, s.scale, s.confidence);
    }
    // Round trip: from the last frame tracked forward, back to the start frame.
    let first = result.samples.iter().find(|s| s.time >= at).cloned();
    let last = result.samples.last().cloned();
    if let (Some(first), Some(last)) = (first, last) {
        if last.time > first.time {
            let back = TrackRequest { at: last.time, from: first.time, to: Micros(last.time.0 + 1), center: last.center, size: last.size, rotation: last.rotation, direction: TrackDirection::Backward, ..req.clone() };
            let returned = track_region(&back, &control)?;
            if let Some(home) = returned.samples.first().filter(|s| s.time == first.time) {
                let (w, h) = result.work_size;
                let info = media.video.as_ref().ok_or("no video")?;
                let (uw, uh) = if info.rotation.rem_euclid(180) == 90 { (info.height, info.width) } else { (info.width, info.height) };
                let px = ((home.center[0] - first.center[0]) * uw as f64).hypot((home.center[1] - first.center[1]) * uh as f64);
                println!(
                    "round trip over {:.2} s ({} frames each way): back {px:.1} source px from where it started ({:.2} px at {w}x{h}), scale {:.4}, {:+.2}°",
                    (last.time.0 - first.time.0) as f64 / 1e6,
                    returned.samples.len(),
                    px * w as f64 / uw as f64,
                    home.scale * last.scale,
                    home.rotation - first.rotation
                );
            } else {
                println!("round trip: lost on the way back at {:?}", returned.lost_backward.map(|t| t.as_secs_f64()));
            }
        }
    }
    if let Some(dir) = flag(args, "--save") {
        save_tracked(&path, &result, &dir)?;
    }
    Ok(())
}

/// Every tenth tracked frame with its region drawn, at the working size.
fn save_tracked(path: &str, result: &openrip_core::TrackResult, dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use openrip_media::{DecoderOptions, VideoDecoder};
    std::fs::create_dir_all(dir)?;
    let c = Compositor::new()?;
    let mut d = VideoDecoder::open(Path::new(path), &DecoderOptions::default())?;
    let orientation = d.info().rotation;
    let (w, h) = result.work_size;
    for (i, s) in result.samples.iter().enumerate().step_by(10) {
        let Some(frame) = d.frame_at(Micros(s.time.0 + 1000))? else { continue };
        let mut img = c.render(w, h, [0, 0, 0], &[Layer::from_model_oriented(Source::Video(&frame), [w, h], [0.0, 0.0], [1.0, 1.0], 0.0, orientation)]);
        let (cx, cy) = (s.center[0] * w as f64, s.center[1] * h as f64);
        let (hw, hh) = (s.size[0] * w as f64 / 2.0, s.size[1] * h as f64 / 2.0);
        let (sn, cs) = s.rotation.to_radians().sin_cos();
        for k in 0..2000 {
            let u = k as f64 / 2000.0 * 4.0;
            let (lx, ly) = match u as u32 {
                0 => (-hw + 2.0 * hw * u.fract(), -hh),
                1 => (hw, -hh + 2.0 * hh * u.fract()),
                2 => (hw - 2.0 * hw * u.fract(), hh),
                _ => (-hw, hh - 2.0 * hh * u.fract()),
            };
            for t in -1..=1 {
                let (x, y) = ((cx + cs * lx - sn * ly) as i64 + t, (cy + sn * lx + cs * ly) as i64);
                if x >= 0 && y >= 0 && (x as u32) < w && (y as u32) < h {
                    let p = ((y as u32 * w + x as u32) * 4) as usize;
                    img.data[p..p + 3].copy_from_slice(&[174, 129, 206]);
                }
            }
        }
        save_png(&dir.join(format!("track-{i:04}.png")), &img)?;
    }
    Ok(())
}

/// Frames k and k + 2 of the file, the frame half-way between them made by each method, against
/// frame k + 1 itself, at `holdout` places through the file.
fn holdout_psnr(path: &Path, info: &openrip_media::VideoInfo, duration: Micros, long: u32, places: usize) -> Result<(), Box<dyn std::error::Error>> {
    use openrip_media::{DecoderOptions, VideoDecoder};
    let c = Compositor::new()?;
    let mut d = VideoDecoder::open(path, &DecoderOptions::default())?;
    let (sw, sh) = (info.width as f64, info.height as f64);
    let k = long as f64 / sw.max(sh);
    let (w, h) = (((sw * k) as u32) & !1, ((sh * k) as u32) & !1);
    let draw = |c: &Compositor, src: Source| c.render(w, h, [0, 0, 0], &[Layer::placed(src, [w as f64 / 2.0, h as f64 / 2.0], [w as f64, h as f64])]);
    let (mut hold, mut blend, mut flow) = (Vec::new(), Vec::new(), Vec::new());
    for i in 0..places {
        let at = Micros(duration.0 * (2 * i as i64 + 1) / (2 * places as i64 + 2));
        let Some(f0) = d.frame_at(at)? else { continue };
        let Some(f1) = d.frame_at(Micros(f0.time.0 + f0.duration.0 + f0.duration.0 / 4))? else { continue };
        let Some(f2) = d.frame_at(Micros(f1.time.0 + f1.duration.0 + f1.duration.0 / 4))? else { continue };
        let truth = luma(&draw(&c, Source::Video(&f1)));
        let tween = |mode| Tween { from: Picture::Video(&f0), to: Picture::Video(&f2), t: 0.5, key: f0.time.0 as u64 ^ 0x5eed, mode };
        let t0 = Instant::now();
        let made = luma(&draw(&c, Source::Tween(tween(TweenMode::Flow))));
        let took = t0.elapsed().as_secs_f64() * 1e3;
        let (ph, pb, pf) = (psnr(&luma(&draw(&c, Source::Video(&f0))), &truth), psnr(&luma(&draw(&c, Source::Tween(tween(TweenMode::Blend)))), &truth), psnr(&made, &truth));
        println!("  at {:6.2} s: held {ph:5.2} dB, blended {pb:5.2} dB, optical flow {pf:5.2} dB ({took:.0} ms with the flow)", f0.time.as_secs_f64());
        hold.push(ph);
        blend.push(pb);
        flow.push(pf);
    }
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
    println!("held-out middle frames at {w}x{h} ({} places): held {:.2} dB, blended {:.2} dB, optical flow {:.2} dB", hold.len(), mean(&hold), mean(&blend), mean(&flow));
    Ok(())
}
