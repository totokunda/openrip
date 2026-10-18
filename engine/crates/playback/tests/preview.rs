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

/// The barcode's frame number in a rendered image.
fn number_in(img: &openrip_render::RgbaImage) -> i64 {
    (0..9).map(|bit| ((img.data[((64 * img.width + bit * 64 + 32) * 4) as usize] > 128) as i64) << bit).sum()
}

#[test]
fn a_reversed_clip_plays_the_frames_it_shows_paused() {
    let Some(a) = clip("preview-edit-a.mp4") else { return };
    // Source frames 100..250 (5 s) backward.
    let mut p = project(&a, 100);
    p.tracks[0].segments[0].reverse = true;
    let fps = FrameRate::new(30, 1);
    // Playing: every frame in order (the reverse reader's windows).
    let mut playing = PreviewEngine::new(p.clone()).unwrap();
    let played: Vec<i64> = (0..150).map(|n| number_in(&playing.render_image(fps.frame_start(n) + Micros(1000), 640, 128).unwrap().0)).collect();
    // Paused: each frame on its own, in a scattered order (the decoder's seeks).
    let mut paused = PreviewEngine::new(p).unwrap();
    for n in [149, 3, 77, 76, 140, 0, 31, 100] {
        let t = fps.frame_start(n) + Micros(1000);
        paused.render_image(t + Micros(5_000_000), 640, 128).unwrap(); // seek away first
        assert_eq!(number_in(&paused.render_image(t, 640, 128).unwrap().0), played[n as usize], "frame {n}");
    }
    // Backward from the out-point: the clip's first frame is source frame 249, its last 100.
    assert_eq!(played[0], 249);
    assert_eq!(played[149], 100);
    assert!(played.windows(2).all(|w| w[1] == w[0] - 1), "{played:?}");
}

#[test]
fn a_speed_curve_picks_frames_by_the_remapped_time() {
    let Some(a) = clip("preview-edit-a.mp4") else { return };
    let mut p = project(&a, 0);
    // CapCut's Flash In: fast (5.2×) to start, then 1×.
    let preset = openrip_model::speed::CURVE_PRESETS.iter().find(|c| c.name == "Flash In").unwrap();
    p.materials.speeds.push(openrip_model::Speed { id: "sp".into(), speed: 1.0, curve: preset.points.to_vec(), preset: Some("Flash In".into()) });
    let seg = &mut p.tracks[0].segments[0];
    seg.attachments.push("sp".into());
    let remap = openrip_model::Remap::new(preset.points).unwrap();
    // 8 s of source at the curve's mean speed.
    seg.source = Some(openrip_model::TimeRange::new(Micros(0), Micros(8_000_000)));
    seg.target.duration = Micros(remap.output_length(8_000_000));
    let length = seg.target.duration;
    let mut e = PreviewEngine::new(p).unwrap();
    let fps = FrameRate::new(30, 1);
    for n in [0, 5, 20, 40, (length.0 * 30 / 1_000_000) - 1] {
        let t = fps.frame_start(n) + Micros(1000);
        let want = fps.frame_of(Micros(remap.source_offset(t.0, length.0)));
        assert_eq!(number_in(&e.render_image(t, 640, 128).unwrap().0), want, "timeline frame {n}");
    }
}

#[test]
fn a_freeze_frame_without_its_still_draws_the_video_frame() {
    let Some(a) = clip("preview-edit-a.mp4") else { return };
    let mut p = project(&a, 0);
    let fps = FrameRate::new(30, 1);
    // An OpenRip freeze: no picture, frame 123 of the clip.
    p.materials.media.push(openrip_model::Media {
        id: "fr".into(),
        kind: openrip_model::MediaKind::Photo,
        path: String::new(),
        width: 640,
        height: 128,
        duration: Micros(10_000_000),
        has_audio: false,
        matte: None,
        reverse_path: None,
        freeze: Some(openrip_model::Freeze { video: a.to_string_lossy().into_owned(), at: fps.frame_start(123) + Micros(800) }),
    });
    p.tracks[0].segments[0].material = "fr".into();
    let mut e = PreviewEngine::new(p).unwrap();
    for n in [0, 50, 149] {
        assert_eq!(number_at(&mut e, n), 123, "frame {n}");
    }
}
