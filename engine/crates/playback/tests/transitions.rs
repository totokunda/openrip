//! Transitions and clip animations in the preview engine's frames: two clips meeting at a cut
//! with a transition, and clips with In, Out and Combo animations over keyframed transforms.
//! Stills are flat colours written as PNGs; the video case uses a barcoded clip (frame
//! number in 64-px blocks) made with the `ffmpeg` CLI (skipped without it).

use std::path::{Path, PathBuf};
use std::process::Command;

use openrip_model::{Animation, AnimationKind, Animations, FrameRate, MaterialId, Micros, Project, Transition};
use openrip_playback::PreviewEngine;

const W: u32 = 64;
const H: u32 = 36;

/// A flat-colour PNG still at the canvas size. Tests run in parallel and share the file, so
/// it's written under a name of its own and renamed into place: a test never reads it half
/// written.
fn still(name: &str, rgb: [u8; 3]) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    let path = dir.join(name);
    let part = dir.join(format!("{name}.{:?}.part", std::thread::current().id()));
    {
        let file = std::fs::File::create(&part).unwrap();
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), W, H);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let data: Vec<u8> = [rgb[0], rgb[1], rgb[2], 255].repeat((W * H) as usize);
        enc.write_header().unwrap().write_image_data(&data).unwrap();
    }
    std::fs::rename(&part, &path).unwrap();
    path
}

/// Red still `a` for 2 s, then blue still `b` for 2 s, on one track; `a` carries `transition`
/// (0.5 s) when given.
fn project(transition: Option<&str>) -> Project {
    let (a, b) = (still("tr-red.png", [255, 0, 0]), still("tr-blue.png", [0, 0, 255]));
    let seg = |id: &str, m: &str, start: i64| {
        serde_json::json!({
            "id": id, "material": m, "source": { "start": 0, "duration": 2000000 }, "target": { "start": start, "duration": 2000000 },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        })
    };
    let mut p: Project = serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "transitions", "canvas": { "width": W, "height": H }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [seg("a", "ma", 0), seg("b", "mb", 2_000_000)] }],
        "materials": { "media": [
            { "id": "ma", "kind": "photo", "path": a, "width": W, "height": H, "duration": 0 },
            { "id": "mb", "kind": "photo", "path": b, "width": W, "height": H, "duration": 0 }
        ] }
    }))
    .unwrap();
    if let Some(builtin) = transition {
        p.materials.transitions.push(Transition { id: MaterialId("tr".into()), name: String::new(), duration: Micros(500_000), overlap: true, builtin: Some(builtin.into()), library: None, resource: None, params: Default::default() });
        p.tracks[0].segments[0].attachments.push(MaterialId("tr".into()));
    }
    p
}

fn px(e: &mut PreviewEngine, t: f64, x: u32, y: u32) -> [u8; 3] {
    let (img, _) = e.render_image(Micros((t * 1e6) as i64), W, H).unwrap();
    let i = ((y * W + x) * 4) as usize;
    [img.data[i], img.data[i + 1], img.data[i + 2]]
}

fn near(a: [u8; 3], b: [u8; 3]) -> bool {
    a.iter().zip(b).all(|(x, y)| (*x as i32 - y as i32).abs() <= 2)
}

#[test]
fn mix_shows_both_clips_around_the_cut() {
    let mut e = PreviewEngine::new(project(Some("mix"))).unwrap();
    // Outside the window: each clip as it is.
    assert!(near(px(&mut e, 1.5, 32, 18), [255, 0, 0]));
    assert!(near(px(&mut e, 2.5, 32, 18), [0, 0, 255]));
    // A fifth of the way in (before the cut) and at three fifths (after it): both clips.
    assert!(near(px(&mut e, 1.85, 32, 18), [204, 0, 51]), "{:?}", px(&mut e, 1.85, 32, 18));
    assert!(near(px(&mut e, 2.05, 32, 18), [102, 0, 153]), "{:?}", px(&mut e, 2.05, 32, 18));
}

#[test]
fn push_moves_both_clips_and_slide_only_the_incoming_one() {
    let mut e = PreviewEngine::new(project(Some("push_left"))).unwrap();
    // At the cut, halfway: the outgoing clip on the left, the incoming one on the right.
    assert!(near(px(&mut e, 2.0, 8, 18), [255, 0, 0]));
    assert!(near(px(&mut e, 2.0, 56, 18), [0, 0, 255]));
    let mut e = PreviewEngine::new(project(Some("slide_right"))).unwrap();
    // Rightwards, the incoming clip covers the left half by the cut.
    assert!(near(px(&mut e, 2.0, 8, 18), [0, 0, 255]));
    assert!(near(px(&mut e, 2.0, 56, 18), [255, 0, 0]));
}

#[test]
fn wipes_and_fades_through_black() {
    let mut e = PreviewEngine::new(project(Some("wipe_down"))).unwrap();
    // Downwards: by the cut the incoming clip fills the top half.
    assert!(near(px(&mut e, 2.0, 32, 4), [0, 0, 255]));
    assert!(near(px(&mut e, 2.0, 32, 32), [255, 0, 0]));
    let mut e = PreviewEngine::new(project(Some("black_fade"))).unwrap();
    assert!(near(px(&mut e, 2.0, 32, 18), [0, 0, 0]));
    assert!(near(px(&mut e, 1.875, 32, 18), [128, 0, 0]));
}

#[test]
fn pull_in_zooms_the_outgoing_clip_then_the_incoming_one() {
    let mut e = PreviewEngine::new(project(Some("pull_in"))).unwrap();
    // One clip at a time: red before the cut, blue after, each filling the canvas (mirrored
    // edges; flat colours stay flat under the zoom blur).
    assert!(near(px(&mut e, 1.9, 2, 2), [255, 0, 0]));
    assert!(near(px(&mut e, 2.1, 2, 2), [0, 0, 255]));
}

/// Red still for 2 s with `items` as its animations, and a position keyframed from the left
/// to the right of the canvas over the clip.
fn animated(items: Vec<Animation>) -> Project {
    let mut p = project(None);
    p.tracks[0].segments.truncate(1);
    let seg = &mut p.tracks[0].segments[0];
    seg.transform.scale = openrip_model::Animated::constant(openrip_model::Vec2::new(0.25, 0.25));
    seg.transform.position.keys = vec![openrip_model::Keyframe::new(Micros(0), openrip_model::Vec2::new(-0.5, 0.0)), openrip_model::Keyframe::new(Micros(2_000_000), openrip_model::Vec2::new(0.5, 0.0))];
    seg.attachments.push(MaterialId("an".into()));
    p.materials.animations.push(Animations { id: MaterialId("an".into()), items });
    p
}

fn anim(kind: AnimationKind, builtin: &str, duration: f64) -> Animation {
    Animation { kind, start: Micros(0), duration: Micros((duration * 1e6) as i64), builtin: Some(builtin.into()), library: None, resource: None }
}

#[test]
fn animations_sit_on_top_of_keyframed_transforms() {
    // A quarter-size red picture moving left to right; it fades in over its first half second
    // and out over its last.
    let mut e = PreviewEngine::new(animated(vec![anim(AnimationKind::In, "fade_in", 0.5), anim(AnimationKind::Out, "fade_out", 0.5)])).unwrap();
    // At 0.25 s: half faded in, a quarter of the way along (x = −0.375 of the half-canvas).
    let x = |pos: f64| ((pos + 1.0) / 2.0 * W as f64) as u32;
    assert!(near(px(&mut e, 0.25, x(-0.375), 18), [128, 0, 0]), "{:?}", px(&mut e, 0.25, x(-0.375), 18));
    // Mid-clip: as it is, in the middle.
    assert!(near(px(&mut e, 1.0, 32, 18), [255, 0, 0]));
    assert!(near(px(&mut e, 1.0, 4, 18), [0, 0, 0]));
    assert!(near(px(&mut e, 1.875, x(0.4375), 18), [64, 0, 0]), "{:?}", px(&mut e, 1.875, x(0.4375), 18));
    // A slide in from the right adds to the keyed position: at the start it's a canvas to
    // the right, off the canvas.
    let mut e = PreviewEngine::new(animated(vec![anim(AnimationKind::In, "slide_left", 1.0)])).unwrap();
    assert!(near(px(&mut e, 0.0, x(-0.5), 18), [0, 0, 0]));
    assert!(near(px(&mut e, 1.0, 32, 18), [255, 0, 0]));
    // A combo's pulse at its peak (three quarters of the way through, at x = 0.25) makes the
    // picture 10% bigger: past its right edge at rest (pixel 48).
    let mut e = PreviewEngine::new(animated(vec![anim(AnimationKind::Combo, "pulse", 2.0)])).unwrap();
    let mut rest = PreviewEngine::new(animated(Vec::new())).unwrap();
    assert!(near(px(&mut rest, 1.5, 48, 18), [0, 0, 0]));
    assert!(px(&mut e, 1.5, 48, 18)[0] > 128, "{:?}", px(&mut e, 1.5, 48, 18));
}

/// The barcoded clip from tests/preview.rs: frame N's number in 64-px blocks.
fn barcode() -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("ffmpeg not found; skipping");
        return None;
    }
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("transition-barcode.mp4");
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

/// Clip a (source frames 30 on) for 1 s, then clip b (frames 150 on), with a 0.5 s mix.
fn video_project(path: &Path) -> Project {
    let fps = FrameRate::new(30, 1);
    let seg = |id: &str, from: i64, start: i64, attach: &[&str]| {
        serde_json::json!({
            "id": id, "material": "m", "source": { "start": fps.frame_start(from).0, "duration": 1000000 }, "target": { "start": start, "duration": 1000000 },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }, "attachments": attach
        })
    };
    let mut p: Project = serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "mix", "canvas": { "width": 640, "height": 128 }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [seg("a", 30, 0, &["tr"]), seg("b", 150, 1_000_000, &[])] }],
        "materials": { "media": [{ "id": "m", "kind": "video", "path": path, "width": 640, "height": 128, "duration": 10000000 }] }
    }))
    .unwrap();
    p.materials.transitions.push(Transition { id: MaterialId("tr".into()), name: String::new(), duration: Micros(600_000), overlap: true, builtin: Some("mix".into()), library: None, resource: None, params: Default::default() });
    p
}

#[test]
fn the_clips_play_on_from_their_media_across_a_mix() {
    let Some(path) = barcode() else { return };
    let mut e = PreviewEngine::new(video_project(&path)).unwrap();
    let fps = FrameRate::new(30, 1);
    // Six frames before the cut (a sixth of the way through the window): clip a at its frame
    // 30 + 24 = 54, and clip b six frames ahead of its start, at 144, at a sixth.
    let (img, _) = e.render_image(fps.frame_start(24) + Micros(1000), 640, 128).unwrap();
    let block = |bit: u32| img.data[((64 * 640 + bit * 64 + 32) * 4) as usize] as f64;
    for bit in 0..8 {
        let (a, b) = (((54 >> bit) & 1) as f64, ((144 >> bit) & 1) as f64);
        let want = 255.0 * (a * (1.0 - 1.0 / 6.0) + b / 6.0);
        assert!((block(bit) - want).abs() < 12.0, "bit {bit}: {} vs {want}", block(bit));
    }
    // Six frames after it: clip a on past its end at frame 60 + 6 = 66, clip b at 156.
    let (img, _) = e.render_image(fps.frame_start(36) + Micros(1000), 640, 128).unwrap();
    let block = |bit: u32| img.data[((64 * 640 + bit * 64 + 32) * 4) as usize] as f64;
    for bit in 0..8 {
        let (a, b) = (((66 >> bit) & 1) as f64, ((156 >> bit) & 1) as f64);
        let want = 255.0 * (a * (1.0 - 5.0 / 6.0) + b * 5.0 / 6.0);
        assert!((block(bit) - want).abs() < 12.0, "bit {bit}: {} vs {want}", block(bit));
    }
}

#[test]
fn shader_transitions_draw_the_clips_through_the_collection() {
    // Each is red before its window and blue after it, and at the cut (half way) not one clip
    // all over.
    for id in ["gl_directionalwipe", "gl_CrossZoom", "gl_fadecolor", "gl_circleopen", "gl_Swirl"] {
        let mut e = PreviewEngine::new(project(Some(id))).unwrap();
        assert!(near(px(&mut e, 1.5, 32, 18), [255, 0, 0]), "{id} before");
        assert!(near(px(&mut e, 2.5, 32, 18), [0, 0, 255]), "{id} after");
        let (img, _) = e.render_image(Micros(2_000_000), W, H).unwrap();
        let red = img.data.chunks(4).filter(|p| near([p[0], p[1], p[2]], [255, 0, 0])).count();
        let blue = img.data.chunks(4).filter(|p| near([p[0], p[1], p[2]], [0, 0, 255])).count();
        assert!(red + blue < (W * H) as usize || (red > 0 && blue > 0), "{id}: all one clip at the cut");
    }
    // Its parameters go through: fading through green rather than black.
    let mut p = project(Some("gl_fadecolor"));
    p.materials.transitions[0].params.insert("color".into(), serde_json::json!("#00ff00"));
    p.materials.transitions[0].params.insert("colorPhase".into(), serde_json::json!(1.0));
    let mut e = PreviewEngine::new(p).unwrap();
    let at_cut = px(&mut e, 2.0, 32, 18);
    assert!(at_cut[1] > 200 && at_cut[0] < 60 && at_cut[2] < 60, "{at_cut:?}");
}
