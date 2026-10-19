//! The inspector's later tools in the preview engine's frames: an effect bar limited to its
//! masks, the Log colour wheels, the Particles slider's grain, and a pattern for the canvas.
//! Stills are flat colours written as PNGs.

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
    Media { id: MaterialId(id.into()), kind: MediaKind::Photo, path: path.to_string_lossy().into_owned(), width: W, height: H, duration: Micros(0), has_audio: false, matte: None, freeze: None, reverse_path: None, complement_frame: None, smart_complement_frame: None, enhance: None }
}

fn clip(id: &str, material: &str, length: i64, scale: f64, attachments: &[&str]) -> Segment {
    Segment {
        id: id.into(),
        material: MaterialId(material.into()),
        source: Some(TimeRange::new(Micros(0), Micros(length))),
        target: TimeRange::new(Micros(0), Micros(length)),
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
    let mut p = Project::new("p", "gaps", Canvas { width: W, height: H }, FrameRate::new(30, 1));
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

fn mask(id: &str, center: [f32; 2], size: [f32; 2]) -> Mask {
    Mask { id: MaterialId(id.into()), shape: MaskShape::Rectangle { round_corner: 0.0 }, center, size, rotation: 0.0, feather: 0.0, expansion: 0.0, invert: false, inside: MaskPaint::Clip, outside: MaskPaint::clear(), keys: Vec::new(), library: None }
}

/// An effect bar (Invert colours) with a mask over the left half draws the effect there and
/// leaves the right half as it was; without the mask it inverts everything.
#[test]
fn an_effect_bar_with_a_mask_draws_its_effect_only_inside_it() {
    let grey = still("gap-grey.png", [200, 100, 50]);
    let bar = Effect { id: MaterialId("fx".into()), category: EffectCategory::VideoEffect, name: "Invert colours".into(), params: [("intensity".to_string(), 1.0)].into(), builtin: Some("fx:invert".into()), resource: None, library: None, text_style: None };
    let main = || track("main", TrackKind::Video, vec![clip("a", "m", 3_000_000, 1.0, &[])]);
    let masked = {
        let mats = Materials { media: vec![photo("m", &grey)], effects: vec![bar.clone()], masks: vec![mask("mk", [-0.5, 0.0], [0.5, 1.0])], ..Default::default() };
        frame(project(vec![main(), track("fx", TrackKind::Effect, vec![clip("bar", "fx", 3_000_000, 1.0, &["mk"])])], mats), 1.0)
    };
    assert!(near(px(&masked, 8, 18), [55, 155, 205], 3), "inside {:?}", px(&masked, 8, 18));
    assert!(near(px(&masked, 56, 18), [200, 100, 50], 3), "outside {:?}", px(&masked, 56, 18));
    let whole = {
        let mats = Materials { media: vec![photo("m", &grey)], effects: vec![bar], ..Default::default() };
        frame(project(vec![main(), track("fx", TrackKind::Effect, vec![clip("bar", "fx", 3_000_000, 1.0, &[])])], mats), 1.0)
    };
    assert!(near(px(&whole, 56, 18), [55, 155, 205], 3), "{:?}", px(&whole, 56, 18));
}

fn wheels(f: impl FnOnce(&mut ColorWheels)) -> ColorWheels {
    let mut w = ColorWheels { id: MaterialId("w".into()), log: true, lift: Default::default(), gamma: Default::default(), gain: Default::default(), offset: Default::default(), intensity: 1.0 };
    f(&mut w);
    w
}

fn graded(rgb: [u8; 3], w: ColorWheels, name: &str) -> [u8; 3] {
    let src = still(name, rgb);
    let mats = Materials { media: vec![photo("m", &src)], color_wheels: vec![w], ..Default::default() };
    let img = frame(project(vec![track("main", TrackKind::Video, vec![clip("a", "m", 3_000_000, 1.0, &["w"])])], mats), 1.0);
    px(&img, 32, 18)
}

/// The Log wheels shift values in log space: the Highlight wheel moves a light grey far more than a
/// dark one, the Shadow wheel the other way round, the Offset wheel both, and with the strength at
/// 0 nothing changes.
#[test]
fn log_wheels_shift_their_part_of_the_range() {
    let dark = [25, 25, 25];
    let light = [230, 230, 230];
    let up = |c: [u8; 3], d: [u8; 3]| d[0] as i32 - c[0] as i32;
    let highlight = |c, n: &str| graded(c, wheels(|w| w.gain.luma = 0.5), n);
    let shadow = |c, n: &str| graded(c, wheels(|w| w.lift.luma = 0.5), n);
    let (h_dark, h_light) = (up(dark, highlight(dark, "lw-a.png")), up(light, highlight(light, "lw-b.png")));
    let (s_dark, s_light) = (up(dark, shadow(dark, "lw-c.png")), up(light, shadow(light, "lw-d.png")));
    assert!(h_light > 6 && h_light > 3 * h_dark.max(1), "highlight wheel: dark {h_dark}, light {h_light}");
    assert!(s_dark > 6 && s_dark > 3 * s_light.max(1), "shadow wheel: dark {s_dark}, light {s_light}");
    let offset = graded([128, 128, 128], wheels(|w| w.offset.red = 0.5), "lw-e.png");
    assert!(offset[0] > 150 && near([offset[1], offset[2], 0], [128, 128, 0], 2), "{offset:?}");
    let off = graded([128, 128, 128], wheels(|w| {
        w.offset.red = 0.5;
        w.intensity = 0.0;
    }), "lw-f.png");
    assert!(near(off, [128, 128, 128], 1), "{off:?}");
    // The CPU twin agrees with the picture.
    let cpu = openrip_render::Wheels { offset: openrip_render::Wheel { red: 0.5, ..Default::default() }, intensity: 1.0, log: true, ..Default::default() }.apply_log([128.0 / 255.0; 3]);
    assert!((cpu[0] * 255.0 - offset[0] as f32).abs() < 3.0, "{cpu:?} {offset:?}");
}

/// The Particles slider makes grain: a flat grey picture gets pixels that differ from each other
/// (and from frame to frame), about as bright on average as before; at 0 it stays flat.
#[test]
fn particles_add_grain_that_moves_with_the_frame() {
    let grey = still("gap-grain.png", [128, 128, 128]);
    let at = |amount: f64, t: f64| {
        let mats = Materials { media: vec![photo("m", &grey)], effects: vec![slider("pa", "particles", amount)], ..Default::default() };
        frame(project(vec![track("main", TrackKind::Video, vec![clip("a", "m", 3_000_000, 1.0, &["pa"])])], mats), t)
    };
    let spread = |img: &openrip_render::RgbaImage| {
        let v: Vec<f32> = img.data.chunks(4).map(|p| p[0] as f32).collect();
        let mean = v.iter().sum::<f32>() / v.len() as f32;
        (mean, (v.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / v.len() as f32).sqrt())
    };
    let (flat_mean, flat_sd) = spread(&at(0.0, 1.0));
    let (mean, sd) = spread(&at(0.6, 1.0));
    assert!(flat_sd < 0.5 && (flat_mean - 128.0).abs() < 1.0);
    assert!(sd > 5.0 && (mean - 128.0).abs() < 4.0, "mean {mean} sd {sd}");
    assert_ne!(at(0.6, 1.0).data, at(0.6, 1.5).data);
    assert_eq!(at(0.6, 1.0).data, at(0.6, 1.0).data);
}

/// A pattern as the canvas fill of a main-track clip that doesn't cover the canvas: the canvas
/// around the clip is the pattern's tiles.
#[test]
fn a_pattern_fills_the_canvas_around_the_main_clip() {
    let src = still("gap-pat.png", [255, 0, 0]);
    let fill = CanvasFill { id: MaterialId("cv".into()), fill: CanvasFillKind::Pattern { id: "checks".into() } };
    let mats = Materials { media: vec![photo("m", &src)], canvas_fills: vec![fill], ..Default::default() };
    let img = frame(project(vec![track("main", TrackKind::Video, vec![clip("a", "m", 3_000_000, 0.4, &["cv"])])], mats), 1.0);
    let expected = openrip_playback::pattern::fill("checks", W, H).unwrap();
    // A corner is the pattern's (the clip is in the middle).
    assert!(near(px(&img, 1, 1), [expected.data[(W as usize + 1) * 4], expected.data[(W as usize + 1) * 4 + 1], expected.data[(W as usize + 1) * 4 + 2]], 2), "{:?}", px(&img, 1, 1));
    assert!(near(px(&img, 32, 18), [255, 0, 0], 2));
    // Both of the pattern's colours show round the edge.
    let colours: std::collections::BTreeSet<[u8; 3]> = (0..W).map(|x| px(&img, x, 0)).collect();
    assert!(colours.len() >= 2, "{colours:?}");
    // An unknown pattern draws nothing (black).
    let mats = Materials { media: vec![photo("m", &src)], canvas_fills: vec![CanvasFill { id: MaterialId("cv".into()), fill: CanvasFillKind::Pattern { id: "nope".into() } }], ..Default::default() };
    let img = frame(project(vec![track("main", TrackKind::Video, vec![clip("a", "m", 3_000_000, 0.4, &["cv"])])], mats), 1.0);
    assert!(near(px(&img, 1, 1), [0, 0, 0], 1));
}
