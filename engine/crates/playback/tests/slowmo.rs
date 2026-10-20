//! Smooth slow-mo and Optical flow through the preview engine: a clip slowed to 0.25× shows
//! frames made between its source frames (by motion, or blended) instead of holding each, and
//! they match the same motion filmed at four times the frame rate. Uses clips made with the
//! `ffmpeg` CLI (tests skip without it).

use std::path::PathBuf;
use std::process::Command;

use openrip_model::{ComplementFrame, ComplementMode, FrameRate, Micros, Project, SmartComplementFrame};
use openrip_playback::PreviewEngine;

const W: u32 = 320;
const H: u32 = 180;

/// A random texture (blurred noise) panning right `step` pixels a frame and down half that, at
/// `fps`, for `frames` frames.
fn clip(name: &str, fps: u32, step: u32, frames: u32) -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("ffmpeg not found; skipping");
        return None;
    }
    let dir = { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d };
    let texture = dir.join("slowmo-texture.png");
    if !texture.exists() {
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "nullsrc=s=1400x700:d=1,geq=lum='random(1)*255':cb=128:cr=128,gblur=sigma=2,format=gray", "-frames:v", "1"])
            .arg(&texture)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    let path = dir.join(name);
    if !path.exists() {
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-loop", "1", "-framerate", &fps.to_string(), "-i"])
            .arg(&texture)
            .args(["-vf", &format!("crop={W}:{H}:n*{step}:n*{}", step / 2), "-frames:v", &frames.to_string()])
            .args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "6", "-g", "30", "-pix_fmt", "yuv420p"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    Some(path)
}

/// Mean PSNR of the 0.25x clip's output frames 40-79 against the 120 fps truth, and how many
/// repeat the one before.
fn score(slow: &std::path::Path, truth: &std::path::Path, mode: Option<ComplementMode>, flow: bool) -> (f64, u32) {
    let fps = FrameRate::new(30, 1);
    let mut reference = PreviewEngine::new(project(truth, 1.0, None, false)).unwrap();
    let mut e = PreviewEngine::new(project(slow, 0.25, mode, flow)).unwrap();
    let (mut total, mut duplicates, mut n) = (0.0, 0, 0);
    let mut previous: Option<Vec<f32>> = None;
    for k in 40..80 {
        let t = fps.frame_start(k) + Micros(500);
        let (img, _) = e.render_image(t, W, H).unwrap();
        let got = luma(&img);
        let (want, _) = reference.render_image(Micros(t.0 / 4), W, H).unwrap();
        total += psnr(&got, &luma(&want));
        if let Some(p) = &previous {
            duplicates += (mad(p, &got) < 0.002) as u32;
        }
        previous = Some(got);
        n += 1;
    }
    (total / n as f64, duplicates)
}

/// The clip on a 30 fps timeline at `speed`, with Smooth slow-mo in `mode` (or none).
fn project(path: &std::path::Path, speed: f64, mode: Option<ComplementMode>, flow: bool) -> Project {
    let target = 4_000_000i64;
    let mut p: Project = serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "slow-mo test", "canvas": { "width": W, "height": H }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [{
            "id": "s", "material": "m", "source": { "start": 0, "duration": (target as f64 * speed) as i64 }, "target": { "start": 0, "duration": target },
            "speed": speed, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        }]}],
        "materials": { "media": [{ "id": "m", "kind": "video", "path": path, "width": W, "height": H, "duration": 3000000 }] }
    }))
    .unwrap();
    p.materials.media[0].complement_frame = mode.map(|mode| ComplementFrame { mode });
    p.materials.media[0].smart_complement_frame = flow.then_some(SmartComplementFrame { fps: 60, sub_type: 0 });
    p
}

fn luma(img: &openrip_render::RgbaImage) -> Vec<f32> {
    img.data.chunks_exact(4).map(|p| (0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32) / 255.0).collect()
}

fn psnr(a: &[f32], b: &[f32]) -> f64 {
    let mse: f64 = a.iter().zip(b).map(|(x, y)| ((x - y) as f64).powi(2)).sum::<f64>() / a.len() as f64;
    10.0 * (1.0 / mse.max(1e-12)).log10()
}

/// Mean absolute difference between two frames, 0–1.
fn mad(a: &[f32], b: &[f32]) -> f64 {
    a.iter().zip(b).map(|(x, y)| (x - y).abs() as f64).sum::<f64>() / a.len() as f64
}

#[test]
fn slowed_clips_show_frames_made_between_their_own() {
    // 8 px a frame at 30 fps, and the same motion at 120 fps (2 px a frame): the truth for
    // the 0.25× clip's frames.
    let (Some(slow), Some(truth)) = (clip("slowmo3-30.mp4", 30, 8, 90), clip("slowmo3-120.mp4", 120, 2, 360)) else { return };
    let mut results = Vec::new();
    for (name, mode, flow) in [("hold", None, false), ("blend", Some(ComplementMode::FrameBlending), false), ("flow", Some(ComplementMode::OpticalFlow), false), ("optical flow (Basic)", None, true)] {
        let (score, duplicates) = score(&slow, &truth, mode, flow);
        eprintln!("{name}: {score:.2} dB against the 120 fps truth, {duplicates} of 39 frames the same as the one before");
        results.push((name, score, duplicates));
    }
    let (hold, blend, flow, basic) = (results[0], results[1], results[2], results[3]);
    // Held frames repeat three times in four; the made ones never do.
    assert!(hold.2 >= 25, "{hold:?}");
    assert_eq!((blend.2, flow.2, basic.2), (0, 0, 0));
    // Motion beats blending beats holding.
    assert!(flow.1 > blend.1 + 3.0 && blend.1 > hold.1, "{results:?}");
    assert!((basic.1 - flow.1).abs() < 0.5, "{results:?}");
}

#[test]
fn smooth_slow_mo_leaves_clips_at_normal_speed_alone() {
    let Some(slow) = clip("slowmo3-30.mp4", 30, 8, 90) else { return };
    let fps = FrameRate::new(30, 1);
    let mut plain = PreviewEngine::new(project(&slow, 1.0, None, false)).unwrap();
    // At 1× (and offset half a frame) Smooth slow-mo does nothing; Optical flow would.
    let mut smooth = PreviewEngine::new(project(&slow, 1.0, Some(ComplementMode::OpticalFlow), false)).unwrap();
    for k in [5, 6, 7] {
        let t = fps.frame_start(k) + Micros(16_000);
        let (a, _) = plain.render_image(t, W, H).unwrap();
        let (b, _) = smooth.render_image(t, W, H).unwrap();
        assert_eq!(a.data, b.data, "frame {k}");
    }
}
