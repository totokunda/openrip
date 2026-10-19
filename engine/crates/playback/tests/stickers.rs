//! Stickers in the preview engine's frames: a still drawn at its transform, and an animated
//! one whose frame changes with time. Files are written to a scratch folder (an animated PNG,
//! a still PNG, an SVG), as the app's cached stickers are.

use openrip_model::*;
use openrip_playback::PreviewEngine;

const W: u32 = 160;
const H: u32 = 90;

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("openrip-sticker-tests-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

/// A solid `size`² PNG.
fn solid_png(name: &str, size: u32, rgba: [u8; 4]) -> String {
    let path = scratch(name);
    let mut enc = png::Encoder::new(std::fs::File::create(&path).unwrap(), size, size);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut w = enc.write_header().unwrap();
    w.write_image_data(&rgba.repeat((size * size) as usize)).unwrap();
    drop(w);
    path.to_string_lossy().into()
}

/// An animated PNG of solid frames, each shown for `ms`.
fn animated_png(name: &str, size: u32, colours: &[[u8; 4]], ms: u16) -> String {
    let path = scratch(name);
    let mut enc = png::Encoder::new(std::fs::File::create(&path).unwrap(), size, size);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_animated(colours.len() as u32, 0).unwrap();
    enc.set_frame_delay(ms, 1000).unwrap();
    let mut w = enc.write_header().unwrap();
    for c in colours {
        w.write_image_data(&c.repeat((size * size) as usize)).unwrap();
    }
    drop(w);
    path.to_string_lossy().into()
}

/// One sticker segment (design size `design`, at `position` and `scale`) on a sticker track.
fn project(path: String, design: u32, animated: bool, position: Vec2, scale: f64) -> Project {
    let mut p = Project::new("p", "stickers", Canvas { width: W, height: H }, FrameRate::new(30, 1));
    p.materials.stickers.push(Sticker { id: MaterialId("s".into()), path, animated, width: design, height: design, library: None });
    let mut transform = Transform::default();
    transform.position = Animated::constant(position);
    transform.scale = Animated::constant(Vec2::new(scale, scale));
    p.tracks.push(Track {
        id: "t".into(),
        kind: TrackKind::Sticker,
        name: String::new(),
        segments: vec![Segment {
            id: "a".into(),
            material: MaterialId("s".into()),
            source: None,
            target: TimeRange::new(Micros(0), Micros(2_000_000)),
            speed: 1.0,
            reverse: false,
            change_pitch: false,
            visible: true,
            render_index: 0,
            transform,
            crop: None,
            opacity: Animated::constant(1.0),
            volume: Animated::constant(1.0),
            attachments: Vec::new(),
            keyframes: Vec::new(),
        }],
        muted: false,
        hidden: false,
        locked: false,
    });
    p
}

fn frame_at(p: Project, t: Micros) -> openrip_render::RgbaImage {
    let mut e = PreviewEngine::new(p).unwrap();
    e.render_image(t, W, H).unwrap().0
}

fn px(img: &openrip_render::RgbaImage, x: u32, y: u32) -> [u8; 3] {
    let i = ((y * img.width + x) * 4) as usize;
    [img.data[i], img.data[i + 1], img.data[i + 2]]
}

/// A still sticker is drawn where its transform puts it, at its size on the canvas: the design
/// size is a pixel size on a 1080-wide canvas, so a 1080 design at scale 0.2 is a fifth of the
/// canvas's width, 32 px here, centred a quarter of the way across to the right of the middle.
#[test]
fn a_still_sticker_is_drawn_at_its_transform() {
    let path = solid_png("red.png", 64, [255, 0, 0, 255]);
    let img = frame_at(project(path, 1080, false, Vec2::new(0.5, 0.0), 0.2), Micros(500_000));
    // Centre at x = 80 + 0.5 * 80 = 120, y = 45; half the width is 16.
    assert_eq!(px(&img, 120, 45), [255, 0, 0]);
    assert_eq!(px(&img, 106, 45), [255, 0, 0]);
    assert_eq!(px(&img, 134, 45), [255, 0, 0]);
    assert_eq!(px(&img, 100, 45), [0, 0, 0], "left of it");
    assert_eq!(px(&img, 140, 45), [0, 0, 0], "right of it");
    assert_eq!(px(&img, 120, 20), [0, 0, 0], "above it");
}

/// An animated sticker shows a different frame as time passes, and loops.
#[test]
fn an_animated_sticker_changes_frame_over_time() {
    let path = animated_png("blink.png", 32, &[[255, 0, 0, 255], [0, 0, 255, 255]], 100);
    let at = |ms: i64| px(&frame_at(project(path.clone(), 1080, true, Vec2::new(0.0, 0.0), 0.2), Micros(ms * 1000)), 80, 45);
    assert_eq!(at(20), [255, 0, 0]);
    assert_eq!(at(150), [0, 0, 255]);
    // The loop is 200 ms long.
    assert_eq!(at(230), [255, 0, 0]);
}

/// An SVG is drawn to a bitmap at the sticker's size: a green square on a transparent ground.
#[test]
fn an_svg_sticker_is_drawn_with_its_transparency() {
    let path = scratch("square.svg");
    std::fs::write(&path, r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect x="25" y="25" width="50" height="50" fill="#00ff00"/></svg>"##).unwrap();
    let img = frame_at(project(path.to_string_lossy().into(), 1080, false, Vec2::new(0.0, 0.0), 0.4), Micros(0));
    // 1080 at 0.4 is 64 px wide on this canvas: the square is its middle half, 32 px.
    assert_eq!(px(&img, 80, 45), [0, 255, 0]);
    assert_eq!(px(&img, 70, 45), [0, 255, 0]);
    assert_eq!(px(&img, 60, 45), [0, 0, 0], "the transparent margin shows the canvas");
}
