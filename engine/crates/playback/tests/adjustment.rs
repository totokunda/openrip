//! Adjustment layers in the preview engine's frames: a bar on an adjustment track grades what
//! is under it, for its duration, and nothing above it. Stills are flat colours written as PNGs.

use std::path::{Path, PathBuf};

use openrip_model::*;
use openrip_playback::PreviewEngine;

const W: u32 = 64;
const H: u32 = 36;

fn still(name: &str, rgb: [u8; 3]) -> PathBuf {
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    let file = std::fs::File::create(&path).unwrap();
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), W, H);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let data: Vec<u8> = (0..W * H).flat_map(|_| [rgb[0], rgb[1], rgb[2], 255]).collect();
    enc.write_header().unwrap().write_image_data(&data).unwrap();
    path
}

fn photo(id: &str, path: &Path) -> Media {
    Media { id: MaterialId(id.into()), kind: MediaKind::Photo, path: path.to_string_lossy().into_owned(), width: W, height: H, duration: Micros(0), has_audio: false, matte: None, freeze: None, reverse_path: None, complement_frame: None, smart_complement_frame: None }
}

/// A segment from `start` for `length` microseconds, at `scale`, with the materials attached.
fn clip(id: &str, material: &str, start: i64, length: i64, scale: f64, attachments: &[&str]) -> Segment {
    Segment {
        id: id.into(),
        material: MaterialId(material.into()),
        source: Some(TimeRange::new(Micros(0), Micros(length))),
        target: TimeRange::new(Micros(start), Micros(length)),
        speed: 1.0,
        reverse: false,
        change_pitch: false,
        visible: true,
        render_index: 0,
        transform: Transform { scale: Animated::constant(Vec2::new(scale, scale)), ..Transform::default() },
        crop: None,
        opacity: Animated::constant(1.0),
        volume: Animated::constant(1.0),
        attachments: attachments.iter().map(|a| MaterialId(a.to_string())).collect(),
        keyframes: Vec::new(),
    }
}

fn track(id: &str, kind: TrackKind, segments: Vec<Segment>) -> Track {
    Track { id: id.into(), kind, name: String::new(), segments, muted: false, hidden: false, locked: false }
}

fn project(tracks: Vec<Track>, materials: Materials) -> Project {
    let mut p = Project::new("p", "adjustment", Canvas { width: W, height: H }, FrameRate::new(30, 1));
    for (i, mut t) in tracks.into_iter().enumerate() {
        t.segments.iter_mut().for_each(|s| s.render_index = i as i32);
        p.tracks.push(t);
    }
    p.materials = materials;
    p
}

fn frame(p: Project, t: f64) -> openrip_render::RgbaImage {
    let mut e = PreviewEngine::new(p).unwrap();
    e.render_image(Micros((t * 1e6) as i64), W, H).unwrap().0
}

fn px(img: &openrip_render::RgbaImage, x: u32, y: u32) -> [u8; 3] {
    let i = ((y * img.width + x) * 4) as usize;
    [img.data[i], img.data[i + 1], img.data[i + 2]]
}

fn near(a: [u8; 3], b: [u8; 3], tolerance: i32) -> bool {
    a.iter().zip(b).all(|(x, y)| (*x as i32 - y as i32).abs() <= tolerance)
}

fn slider(id: &str, name: &str, value: f64) -> Effect {
    let mut params = std::collections::BTreeMap::new();
    params.insert("intensity".to_string(), value);
    Effect { id: MaterialId(id.into()), category: EffectCategory::Adjust, name: name.into(), params, builtin: Some(name.into()), resource: None, library: None, text_style: None }
}

fn bar_material() -> Effect {
    Effect { id: MaterialId("bar".into()), category: EffectCategory::Adjust, name: "Adjustment".into(), params: Default::default(), builtin: Some("adjustment_layer".into()), resource: None, library: None, text_style: None }
}

/// A bar from 1 s to 2 s of a 3 s timeline, brightness +0.5: it brightens the main track's clip
/// inside that time only; a clip on a track above the bar keeps its own colour.
#[test]
fn an_adjustment_layer_grades_what_is_under_it_and_only_within_its_time() {
    let grey = still("adj-grey.png", [100, 100, 100]);
    let red = still("adj-red.png", [200, 0, 0]);
    let main = clip("a", "m", 0, 3_000_000, 1.0, &[]);
    let bar = clip("bar", "bar", 1_000_000, 1_000_000, 1.0, &["br"]);
    // A small clip above the bar, in the middle.
    let above = clip("b", "r", 0, 3_000_000, 0.25, &[]);
    let mats = Materials { media: vec![photo("m", &grey), photo("r", &red)], effects: vec![bar_material(), slider("br", "brightness", 0.5)], ..Default::default() };
    let tracks = || vec![track("main", TrackKind::Video, vec![main.clone()]), track("adj", TrackKind::Adjustment, vec![bar.clone()]), track("over", TrackKind::Video, vec![above.clone()])];
    let at = |t: f64| frame(project(tracks(), mats.clone()), t);
    let (before, during, after) = (at(0.5), at(1.5), at(2.5));
    assert!(near(px(&before, 2, 2), [100, 100, 100], 2), "{:?}", px(&before, 2, 2));
    assert!(near(px(&after, 2, 2), [100, 100, 100], 2), "{:?}", px(&after, 2, 2));
    let lit = px(&during, 2, 2);
    assert!(lit[0] > 115 && lit[1] > 115, "{lit:?}");
    // The clip above the bar is drawn after the grade.
    assert!(near(px(&during, 32, 18), [200, 0, 0], 2), "{:?}", px(&during, 32, 18));
    assert!(near(px(&before, 32, 18), px(&during, 32, 18), 2));
}

/// A bar with nothing set draws nothing.
#[test]
fn an_adjustment_layer_with_nothing_set_changes_nothing() {
    let grey = still("adj-grey2.png", [100, 100, 100]);
    let mats = Materials { media: vec![photo("m", &grey)], effects: vec![bar_material()], ..Default::default() };
    let main = || track("main", TrackKind::Video, vec![clip("a", "m", 0, 3_000_000, 1.0, &[])]);
    let with = frame(project(vec![main(), track("adj", TrackKind::Adjustment, vec![clip("bar", "bar", 0, 3_000_000, 1.0, &[])])], mats.clone()), 1.0);
    let without = frame(project(vec![main()], mats), 1.0);
    assert_eq!(with.data, without.data);
}

/// A hidden adjustment track grades nothing.
#[test]
fn a_hidden_adjustment_track_grades_nothing() {
    let grey = still("adj-grey3.png", [100, 100, 100]);
    let mats = Materials { media: vec![photo("m", &grey)], effects: vec![bar_material(), slider("br", "brightness", 0.5)], ..Default::default() };
    let mut t = track("adj", TrackKind::Adjustment, vec![clip("bar", "bar", 0, 3_000_000, 1.0, &["br"])]);
    t.hidden = true;
    let img = frame(project(vec![track("main", TrackKind::Video, vec![clip("a", "m", 0, 3_000_000, 1.0, &[])]), t], mats), 1.0);
    assert!(near(px(&img, 2, 2), [100, 100, 100], 2));
}
