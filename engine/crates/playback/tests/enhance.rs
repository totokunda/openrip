//! Stabilize, Reduce image noise, Remove flickers and Motion blur through the preview engine,
//! on clips made with the `ffmpeg` CLI (tests skip without it): a shaking camera gets
//! steadier, noise drops, flicker evens out, and the blur is the frames around averaged.

use std::path::{Path, PathBuf};
use std::process::Command;

use openrip_model::{Enhance, FrameRate, Micros, Project, StabilizeLevel};
use openrip_motion::stabilize::CameraTracker;
use openrip_motion::Gray;
use openrip_playback::enhance;
use openrip_playback::PreviewEngine;

const W: u32 = 320;
const H: u32 = 180;
const FRAMES: u32 = 90;

fn ffmpeg(args: &[&str]) -> bool {
    match Command::new("ffmpeg").args(["-v", "error", "-y"]).args(args).output() {
        Ok(out) => {
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
            true
        }
        Err(_) => {
            eprintln!("ffmpeg not found; skipping");
            false
        }
    }
}

/// A texture (blurred noise) the clips are cut from.
fn texture() -> Option<PathBuf> {
    let path = { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d }.join("enhance-texture.png");
    if !path.exists() && !ffmpeg(&["-f", "lavfi", "-i", "nullsrc=s=1400x700:d=1,geq=lum='random(1)*255':cb=128:cr=128,gblur=sigma=2.5,format=gray", "-frames:v", "1", path.to_str().unwrap()]) {
        return None;
    }
    Some(path)
}

/// A clip cut from the texture with the crop window at `x`, `y` (ffmpeg expressions of the
/// frame number `n`), then `filter` (anything after the crop).
fn clip(name: &str, x: &str, y: &str, filter: &str) -> Option<PathBuf> {
    let texture = texture()?;
    let path = { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d }.join(name);
    if !path.exists() {
        let vf = format!("crop={W}:{H}:x='{x}':y='{y}'{filter}");
        let ok = ffmpeg(&[
            "-loop", "1", "-framerate", "30", "-i", texture.to_str().unwrap(), "-vf", &vf, "-frames:v", &FRAMES.to_string(),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "4", "-g", "30", "-pix_fmt", "yuv420p", path.to_str().unwrap(),
        ]);
        if !ok {
            return None;
        }
    }
    Some(path)
}

/// The shaking camera: a slow drift plus a jitter of up to about 8 px.
fn shaky(name: &str) -> Option<PathBuf> {
    clip(name, "400+0.3*n+5*sin(n*2.3)+3*sin(n*5.1+1)", "200+0.15*n+4*sin(n*1.7+2)+2.5*sin(n*4.3)", "")
}

fn project(path: &Path, enhance: Option<Enhance>) -> Project {
    let target = 3_000_000i64;
    let mut p: Project = serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "enhance test", "canvas": { "width": W, "height": H }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [{
            "id": "s", "material": "m", "source": { "start": 0, "duration": target }, "target": { "start": 0, "duration": target },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        }]}],
        "materials": { "media": [{ "id": "m", "kind": "video", "path": path, "width": W, "height": H, "duration": 3000000 }] }
    }))
    .unwrap();
    p.materials.media[0].enhance = enhance;
    p
}

fn gray(img: &openrip_render::RgbaImage) -> Gray {
    Gray::from_rgba(img.width as usize, img.height as usize, &img.data)
}

/// Frame `k` of the project, mid-frame.
fn frame(e: &mut PreviewEngine, k: i64) -> Gray {
    let t = FrameRate::new(30, 1).frame_start(k) + Micros(500);
    gray(&e.render_image(t, W, H).unwrap().0)
}

fn psnr(a: &Gray, b: &Gray) -> f64 {
    let mse: f64 = a.data.iter().zip(&b.data).map(|(x, y)| ((x - y) as f64).powi(2)).sum::<f64>() / a.data.len() as f64;
    10.0 * (1.0 / mse.max(1e-12)).log10()
}

/// How far the picture moves from frame to frame (RMS shift, pixels) over frames `from..to`.
fn shake(e: &mut PreviewEngine, from: i64, to: i64) -> f64 {
    let mut tracker = CameraTracker::new(frame(e, from));
    let mut sum = 0.0;
    for k in from + 1..to {
        let m = tracker.step(frame(e, k)).expect("the picture can be tracked");
        sum += m.tx * m.tx + m.ty * m.ty;
    }
    (sum / (to - from - 1) as f64).sqrt()
}

fn analysed(path: &Path) {
    enhance::forget(path.to_str().unwrap());
    let found = enhance::analyse(path, Micros(0), None, &mut |_, _| true).unwrap();
    assert!(found.times.len() as u32 >= FRAMES - 1, "{} frames", found.times.len());
}

#[test]
fn stabilising_a_shaking_camera_leaves_less_shake() {
    let Some(path) = shaky("enhance-shaky2.mp4") else { return };
    enhance::forget(path.to_str().unwrap());
    let stab = |level| Some(Enhance { stabilize: Some(level), ..Default::default() });
    let mut plain = PreviewEngine::new(project(&path, None)).unwrap();
    // Before it has been tracked, Stabilize shows the clip as it is.
    let mut waiting = PreviewEngine::new(project(&path, stab(StabilizeLevel::Recommended))).unwrap();
    assert_eq!(frame(&mut plain, 20).data, frame(&mut waiting, 20).data);
    analysed(&path);
    let before = shake(&mut plain, 15, 75);
    let mut results = Vec::new();
    for level in [StabilizeLevel::MinimalCut, StabilizeLevel::Recommended, StabilizeLevel::MostStable] {
        let mut e = PreviewEngine::new(project(&path, stab(level))).unwrap();
        let after = shake(&mut e, 15, 75);
        eprintln!("{level:?}: {after:.2} px a frame against {before:.2} unstabilised");
        results.push(after);
    }
    // Minimal cut corrects least, Most stable most.
    assert!(results[0] < before * 0.5 && results[1] < before * 0.2 && results[2] < before * 0.2, "{results:?} against {before}");
    assert!(results[2] <= results[1] + 0.1 && results[1] < results[0], "{results:?}");
}

#[test]
fn noise_drops_and_the_picture_stays() {
    let (Some(clean), Some(noisy)) = (clip("enhance-still.mp4", "400", "200", ""), clip("enhance-noisy.mp4", "400", "200", ",noise=alls=22:allf=t")) else { return };
    let mut truth = PreviewEngine::new(project(&clean, None)).unwrap();
    let mut off = PreviewEngine::new(project(&noisy, None)).unwrap();
    let mut on = PreviewEngine::new(project(&noisy, Some(Enhance { denoise: Some(0.6), ..Default::default() }))).unwrap();
    let (mut before, mut after) = (0.0, 0.0);
    for k in [20, 30, 40, 50] {
        let want = frame(&mut truth, k);
        before += psnr(&frame(&mut off, k), &want);
        after += psnr(&frame(&mut on, k), &want);
    }
    eprintln!("noise: {:.1} dB against the clean clip, {:.1} dB reduced", before / 4.0, after / 4.0);
    assert!(after > before + 4.0 * 3.0, "{before} -> {after}");
}

#[test]
fn flicker_evens_out() {
    let Some(path) = clip("enhance-flicker.mp4", "400+0.4*n", "200", ",eq=brightness='0.07*sin(n*2.1)+0.05*sin(n*3.9)':eval=frame") else { return };
    analysed(&path);
    let mut off = PreviewEngine::new(project(&path, None)).unwrap();
    let mut on = PreviewEngine::new(project(&path, Some(Enhance { deflicker: true, ..Default::default() }))).unwrap();
    // The spread of the frame-to-frame change in mean brightness.
    let jump = |e: &mut PreviewEngine| {
        let means: Vec<f32> = (15..75).map(|k| frame(e, k)).map(|g| g.data.iter().sum::<f32>() / g.data.len() as f32).collect();
        (means.windows(2).map(|w| ((w[1] - w[0]) as f64).powi(2)).sum::<f64>() / (means.len() - 1) as f64).sqrt()
    };
    let (before, after) = (jump(&mut off), jump(&mut on));
    eprintln!("flicker: {before:.4} mean-brightness change a frame, {after:.4} after");
    assert!(after < before * 0.35, "{before} -> {after}");
}

#[test]
fn motion_blur_blends_the_frames_around() {
    let Some(path) = clip("enhance-pan.mp4", "400+9*n", "200", "") else { return };
    let mut off = PreviewEngine::new(project(&path, None)).unwrap();
    let mut on = PreviewEngine::new(project(&path, Some(Enhance { motion_blur: Some(1.0), ..Default::default() }))).unwrap();
    let k = 30;
    let (a, b, c) = (frame(&mut off, k - 1), frame(&mut off, k), frame(&mut off, k + 1));
    let mean = Gray { width: a.width, height: a.height, data: a.data.iter().zip(&b.data).zip(&c.data).map(|((x, y), z)| (x + y + z) / 3.0).collect() };
    let blurred = frame(&mut on, k);
    let (to_mean, to_frame) = (psnr(&blurred, &mean), psnr(&blurred, &b));
    eprintln!("motion blur: {to_mean:.1} dB from the three-frame average, {to_frame:.1} dB from the frame");
    assert!(to_mean > 35.0 && to_mean > to_frame + 8.0);
}

/// Tracking stays right on a noisy, flickering picture: most frame-to-frame motions are within
/// a pixel of the truth.
#[test]
fn tracking_survives_noise_and_flicker() {
    let x = "400+0.3*n+5*sin(n*2.3)+3*sin(n*5.1+1)";
    let y = "200+0.15*n+4*sin(n*1.7+2)+2.5*sin(n*4.3)";
    let Some(path) = clip("enhance-hard.mp4", x, y, ",noise=alls=16:allf=t,eq=brightness='0.06*sin(n*2.1)+0.04*sin(n*3.9)':eval=frame") else { return };
    analysed(&path);
    let a = enhance::analysis(path.to_str().unwrap()).unwrap();
    // ffmpeg's crop window sits on whole pixels.
    let truth = |n: f64| ((400.0 + 0.3 * n + 5.0 * (n * 2.3).sin() + 3.0 * (n * 5.1 + 1.0).sin()).round(), (200.0 + 0.15 * n + 4.0 * (n * 1.7 + 2.0).sin() + 2.5 * (n * 4.3).sin()).round());
    let k = a.size.0 as f64 / W as f64;
    let good = (0..a.motions.len())
        .filter(|&n| {
            let (p, q) = (truth(n as f64), truth(n as f64 + 1.0));
            (a.motions[n].tx - -(q.0 - p.0) * k).abs() < 0.7 && (a.motions[n].ty - -(q.1 - p.1) * k).abs() < 0.7
        })
        .count();
    eprintln!("tracked right: {good} of {}", a.motions.len());
    assert!(good as f64 > 0.9 * a.motions.len() as f64, "{good} of {}", a.motions.len());
}

/// What each setting costs per frame on a real clip, sequentially as playback asks (run by
/// hand: `OPENRIP_COST_CLIP=/path/clip.mov cargo test --release -p openrip-playback --test
/// enhance cost -- --ignored --nocapture`). Frames are drawn at 540x960 into a readback.
#[test]
#[ignore]
fn cost_per_frame() {
    let Some(path) = std::env::var_os("OPENRIP_COST_CLIP").map(PathBuf::from) else { return };
    enhance::forget(path.to_str().unwrap());
    enhance::analyse(&path, Micros(0), None, &mut |_, _| true).unwrap();
    let mut p = project(&path, None);
    p.canvas = openrip_model::Canvas { width: 540, height: 960 };
    let all = |e: Option<Enhance>| {
        let mut q = p.clone();
        q.materials.media[0].enhance = e;
        q
    };
    let cases: Vec<(&str, Option<Enhance>)> = vec![
        ("off", None),
        ("stabilize", Some(Enhance { stabilize: Some(StabilizeLevel::Recommended), ..Default::default() })),
        ("denoise", Some(Enhance { denoise: Some(0.5), ..Default::default() })),
        ("deflicker", Some(Enhance { deflicker: true, ..Default::default() })),
        ("motion blur", Some(Enhance { motion_blur: Some(0.5), ..Default::default() })),
        ("all", Some(Enhance { stabilize: Some(StabilizeLevel::Recommended), denoise: Some(0.5), deflicker: true, motion_blur: Some(0.5) })),
    ];
    for (name, e) in cases {
        let mut engine = PreviewEngine::new(all(e)).unwrap();
        let fps = FrameRate::new(24, 1);
        for k in 0..6 {
            engine.render_image(fps.frame_start(k) + Micros(500), 540, 960).unwrap();
        }
        let t0 = std::time::Instant::now();
        let n = 48;
        for k in 6..6 + n {
            engine.render_image(fps.frame_start(k) + Micros(500), 540, 960).unwrap();
        }
        eprintln!("{name}: {:.1} ms a frame", t0.elapsed().as_secs_f64() * 1000.0 / n as f64);
    }
}
