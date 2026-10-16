//! Timeline thumbnails on a barcoded clip (frame number in 64-px blocks, a keyframe every 48
//! frames) made with the `ffmpeg` CLI (tests skip without it).

use std::path::PathBuf;
use std::process::Command;

use openrip_model::{FrameRate, Micros};
use openrip_playback::{Pass, Thumbnailer};

fn clip() -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("ffmpeg not found; skipping");
        return None;
    }
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("thumbs-barcode.mp4");
    if !path.exists() {
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
            .arg("color=c=black:s=640x128:r=30,format=gray,geq=lum='255*mod(floor(N/pow(2,floor(X/64))),2)',format=yuv420p")
            .args(["-frames:v", "300", "-c:v", "libx264", "-preset", "veryfast", "-bf", "3", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0", "-pix_fmt", "yuv420p"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    Some(path)
}

fn at(n: i64) -> Micros {
    FrameRate::new(30, 1).frame_start(n) + Micros(1000)
}

/// (index, exact, frame number) per thumbnail, sorted by index.
fn run(t: &mut Thumbnailer, path: &PathBuf, frames: &[i64], pass: Pass) -> Vec<(usize, bool, i64)> {
    let times: Vec<_> = frames.iter().map(|&n| at(n)).collect();
    let mut out = Vec::new();
    t.thumbnails(path, &times, 128, pass, |th| {
        assert_eq!((th.image.width, th.image.height), (640, 128));
        let n = (0..9).map(|bit| ((th.image.data[((64 * th.image.width + bit * 64 + 32) * 4) as usize] > 128) as i64) << bit).sum();
        out.push((th.index, th.exact, n));
        true
    })
    .unwrap();
    out.sort();
    out
}

#[test]
fn quick_pass_shows_each_gops_keyframe_and_exact_pass_the_frame() {
    let Some(path) = clip() else { return };
    let frames = [150, 0, 10, 50, 100, 299];
    let mut t = Thumbnailer::new(None).unwrap();
    assert_eq!(run(&mut t, &path, &frames, Pass::Quick), vec![(0, false, 144), (1, true, 0), (2, false, 0), (3, false, 48), (4, false, 96), (5, false, 288)]);
    let exact: Vec<_> = frames.iter().enumerate().map(|(i, &n)| (i, true, n)).collect();
    assert_eq!(run(&mut t, &path, &frames, Pass::Exact), exact);
}

#[test]
fn exact_thumbnails_come_back_from_the_disk_cache() {
    let Some(path) = clip() else { return };
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("thumb-cache");
    let _ = std::fs::remove_dir_all(&dir);
    let frames = [20, 70];
    run(&mut Thumbnailer::new(Some(dir.clone())).unwrap(), &path, &frames, Pass::Exact);
    // A new thumbnailer's quick pass finds them exact on disk.
    assert_eq!(run(&mut Thumbnailer::new(Some(dir)).unwrap(), &path, &frames, Pass::Quick), vec![(0, true, 20), (1, true, 70)]);
}
