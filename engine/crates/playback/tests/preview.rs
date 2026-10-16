//! The preview engine across project edits: decoders stay open for clips that still play the
//! same file, and frames follow the edited project. Uses a barcoded clip (frame number in
//! 64-px blocks) made with the `ffmpeg` CLI (tests skip without it).

use std::path::{Path, PathBuf};
use std::process::Command;

use openrip_model::{FrameRate, Micros, Project};
use openrip_playback::PreviewEngine;

fn clip(name: &str) -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("ffmpeg not found; skipping");
        return None;
    }
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    if !path.exists() {
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
            .arg("color=c=black:s=640x128:r=30,format=gray,geq=lum='255*mod(floor(N/pow(2,floor(X/64))),2)',format=yuv420p")
            .args(["-frames:v", "300", "-c:v", "libx264", "-preset", "veryfast", "-g", "48", "-pix_fmt", "yuv420p"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    Some(path)
}

/// One full-canvas clip of `path` from source frame `from`.
fn project(path: &Path, from: i64) -> Project {
    let fps = FrameRate::new(30, 1);
    serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "edit test", "canvas": { "width": 640, "height": 128 }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [{
            "id": "s", "material": "m", "source": { "start": fps.frame_start(from).0, "duration": 5000000 }, "target": { "start": 0, "duration": 5000000 },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        }]}],
        "materials": { "media": [{ "id": "m", "kind": "video", "path": path, "width": 640, "height": 128, "duration": 10000000 }] }
    }))
    .unwrap()
}

fn number_at(e: &mut PreviewEngine, frame: i64) -> i64 {
    let (img, _) = e.render_image(FrameRate::new(30, 1).frame_start(frame) + Micros(1000), 640, 128).unwrap();
    (0..9).map(|bit| ((img.data[((64 * img.width + bit * 64 + 32) * 4) as usize] > 128) as i64) << bit).sum()
}

#[test]
fn edits_keep_decoders_warm_and_take_effect() {
    let (Some(a), Some(b)) = (clip("preview-edit-a.mp4"), clip("preview-edit-b.mp4")) else { return };
    let mut e = PreviewEngine::new(project(&a, 0)).unwrap();
    assert_eq!(number_at(&mut e, 10), 10);
    assert_eq!(e.open_decoders(), 1);
    // Trim the clip's in-point: same file, so the decoder stays open.
    e.set_project(project(&a, 100));
    assert_eq!(e.open_decoders(), 1);
    assert_eq!(number_at(&mut e, 10), 110);
    // Relink to another file: that decoder goes.
    e.set_project(project(&b, 0));
    assert_eq!(e.open_decoders(), 0);
    assert_eq!(number_at(&mut e, 20), 20);
}

#[test]
fn a_missing_file_does_not_stall_the_cut_to_it() {
    let Some(a) = clip("preview-edit-a.mp4") else { return };
    // Clip one (present) until 1 s, then clip two (missing file).
    let mut p = project(&a, 0);
    let mut missing = p.tracks[0].segments[0].clone();
    p.tracks[0].segments[0].target.duration = Micros(1_000_000);
    missing.id = "gone".into();
    missing.material = "gone".into();
    missing.target.start = Micros(1_000_000);
    p.tracks[0].segments.push(missing);
    let mut gone = p.materials.media[0].clone();
    gone.id = "gone".into();
    gone.path = "/nonexistent/clip.mp4".into();
    p.materials.media.push(gone);
    let mut e = PreviewEngine::new(p).unwrap();
    let mut worst = 0f64;
    for n in 0..45 {
        let t0 = std::time::Instant::now();
        let (_, report) = e.render_image(FrameRate::new(30, 1).frame_start(n), 640, 128).unwrap();
        worst = worst.max(t0.elapsed().as_secs_f64() * 1e3);
        assert_eq!(report.missing.is_empty(), n < 30, "frame {n}");
    }
    // The prefetcher's failed open used to leave the render thread waiting 500 ms.
    assert!(worst < 300.0, "worst frame {worst:.0} ms");
}
