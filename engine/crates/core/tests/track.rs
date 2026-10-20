//! Motion tracking end to end: a textured square moving over a textured background in a real
//! (encoded) video is followed forward and back from a frame in the middle, and a running track
//! can be cancelled. The clip is made with the `ffmpeg` CLI (the test skips without it).

use std::path::PathBuf;
use std::process::Command;

use openrip_core::{track_region, Micros, TrackControl, TrackDirection, TrackRequest};

const W: f64 = 320.0;
const H: f64 = 240.0;

/// 48 frames at 30 fps: an 80 px textured square at (20 + 4n, 30 + 2n) (its top-left) over a
/// different texture. (Even steps: FFmpeg's overlay puts a YUV 4:2:0 picture on even pixels.)
fn clip() -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("ffmpeg not found; skipping");
        return None;
    }
    let dir = { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d };
    let path = dir.join("track-square-2.mp4");
    if !path.exists() {
        let texture = dir.join("track-texture.png");
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "nullsrc=s=1000x600:d=1,geq=lum='random(1)*255':cb=128:cr=128,gblur=sigma=1.5,format=gray", "-frames:v", "1"])
            .arg(&texture)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-loop", "1", "-framerate", "30", "-i"])
            .arg(&texture)
            .args(["-filter_complex", "[0]split[a][b];[a]crop=320:240:0:0[bg];[b]crop=80:80:600:300[fg];[bg][fg]overlay=x='20+4*n':y='30+2*n'"])
            .args(["-frames:v", "48", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-g", "15", "-pix_fmt", "yuv420p"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    Some(path)
}

/// The square's centre at frame `n`, in fractions of the picture.
fn centre(n: f64) -> [f64; 2] {
    [(60.0 + 4.0 * n) / W, (70.0 + 2.0 * n) / H]
}

#[test]
fn follows_a_moving_square_both_ways_from_the_middle() {
    let Some(path) = clip() else { return };
    let frame = |n: i64| Micros(n * 1_000_000 / 30);
    // Drawn on frame 24, a little inside the square.
    let request = TrackRequest {
        path: path.to_string_lossy().into_owned(),
        at: Micros(frame(24).0 + 1000),
        from: Micros::ZERO,
        to: frame(48),
        center: centre(24.0),
        size: [64.0 / W, 64.0 / H],
        rotation: 0.0,
        direction: TrackDirection::Both,
    };
    let control = TrackControl::new();
    let result = track_region(&request, &control).unwrap();
    assert_eq!((result.lost_forward, result.lost_backward), (None, None));
    assert_eq!(result.samples.len(), 48, "every frame");
    assert_eq!(control.progress().0, control.progress().1);
    let mut worst = 0.0f64;
    for s in &result.samples {
        let n = (s.time.0 as f64 * 30.0 / 1e6).round();
        let c = centre(n);
        let err = ((s.center[0] - c[0]) * W).hypot((s.center[1] - c[1]) * H);
        worst = worst.max(err);
        assert!((s.scale - 1.0).abs() < 0.02 && s.rotation.abs() < 1.0, "{s:?}");
    }
    eprintln!("worst position error over 48 frames: {worst:.2} px");
    assert!(worst < 0.25, "worst {worst:.2} px");

    // Forward only: from frame 24 on.
    let forward = track_region(&TrackRequest { direction: TrackDirection::Forward, ..request.clone() }, &control).unwrap();
    assert_eq!(forward.samples.first().map(|s| (s.time.0 as f64 * 30.0 / 1e6).round()), Some(24.0));
    assert_eq!(forward.samples.len(), 24);

    // Cancelled from another thread as soon as it starts: it stops with "cancelled".
    let control = std::sync::Arc::new(TrackControl::new());
    let watcher = {
        let control = control.clone();
        std::thread::spawn(move || {
            while control.progress().0 == 0 {
                std::thread::yield_now();
            }
            control.cancel();
        })
    };
    let err = track_region(&request, &control).unwrap_err();
    watcher.join().unwrap();
    assert_eq!(err.to_string(), "cancelled");
}
