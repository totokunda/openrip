//! Compositing in the preview engine's frames, set up through the project model as the
//! importers set it up: canvas fills (colour, blur, image) of main-track clips, also inside a
//! transition, blend modes and chroma keys from their materials, and a LUT on a clip. Stills
//! are flat colours written as PNGs.

use std::path::{Path, PathBuf};

use openrip_model::*;
use openrip_playback::PreviewEngine;

const W: u32 = 64;
const H: u32 = 36;

fn png(name: &str, w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> PathBuf {
    let path = { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d }.join(name);
    let file = std::fs::File::create(&path).unwrap();
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut data = Vec::new();
    for y in 0..h {
        for x in 0..w {
            data.extend_from_slice(&f(x, y));
        }
    }
    enc.write_header().unwrap().write_image_data(&data).unwrap();
    path
}

fn still(name: &str, rgb: [u8; 3]) -> PathBuf {
    png(name, W, H, |_, _| [rgb[0], rgb[1], rgb[2], 255])
}

fn photo(id: &str, path: &Path) -> Media {
    Media { id: MaterialId(id.into()), kind: MediaKind::Photo, path: path.to_string_lossy().into_owned(), width: W, height: H, duration: Micros(0), has_audio: false, matte: None, freeze: None, reverse_path: None, complement_frame: None, smart_complement_frame: None, enhance: None }
}

fn clip(id: &str, material: &str, start: i64, scale: f64, attachments: &[&str]) -> Segment {
    Segment {
        id: id.into(),
        material: MaterialId(material.into()),
        source: Some(TimeRange::new(Micros(0), Micros(2_000_000))),
        target: TimeRange::new(Micros(start), Micros(2_000_000)),
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

fn track(id: &str, segments: Vec<Segment>) -> Track {
    Track { id: id.into(), kind: TrackKind::Video, name: String::new(), segments, muted: false, hidden: false, locked: false }
}

fn project(tracks: Vec<Track>, materials: Materials) -> Project {
    let mut p = Project::new("p", "compositing", Canvas { width: W, height: H }, FrameRate::new(30, 1));
    for (i, t) in tracks.into_iter().enumerate() {
        let mut t = t;
        t.segments.iter_mut().for_each(|s| s.render_index = i as i32);
        p.tracks.push(t);
    }
    p.materials = materials;
    p
}

fn fill(id: &str, fill: CanvasFillKind) -> CanvasFill {
    CanvasFill { id: MaterialId(id.into()), fill }
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

/// A colour fill shows around a main-track clip that doesn't cover the canvas; black, or a
/// fill on another track's clip, changes nothing.
#[test]
fn a_main_track_clip_fills_the_canvas_with_its_colour() {
    let grey = still("cmp-grey.png", [128, 128, 128]);
    let mats = |fills: Vec<CanvasFill>| Materials { media: vec![photo("m", &grey)], canvas_fills: fills, ..Default::default() };
    let red = fill("c", CanvasFillKind::Color { color: Rgba { r: 1.0, g: 0.0, b: 0.0, a: 1.0 } });
    let filled = frame(project(vec![track("main", vec![clip("a", "m", 0, 0.5, &["c"])])], mats(vec![red.clone()])), 1.0);
    assert_eq!(px(&filled, 2, 2), [255, 0, 0]);
    assert_eq!(px(&filled, 32, 18), [128, 128, 128]);
    let plain = frame(project(vec![track("main", vec![clip("a", "m", 0, 0.5, &[])])], mats(vec![])), 1.0);
    assert_eq!(px(&plain, 2, 2), [0, 0, 0]);
    let black = fill("c", CanvasFillKind::Color { color: Rgba::BLACK });
    assert_eq!(frame(project(vec![track("main", vec![clip("a", "m", 0, 0.5, &["c"])])], mats(vec![black])), 1.0).data, plain.data);
    // The fill of a clip above the main track isn't drawn.
    let overlay = project(vec![track("main", vec![clip("a", "m", 0, 0.5, &[])]), track("over", vec![clip("b", "m", 0, 0.25, &["c"])])], mats(vec![red]));
    assert_eq!(px(&frame(overlay, 1.0), 2, 2), [0, 0, 0]);
}

/// A blur fill is the clip's own picture covering the canvas, blurred: a half-white
/// half-black picture gives greys that fall off across the middle.
#[test]
fn a_blur_fill_is_the_clip_blurred_behind_it() {
    let halves = png("cmp-halves.png", W, H, |x, _| if x < W / 2 { [255, 255, 255, 255] } else { [0, 0, 0, 255] });
    let mats = Materials { media: vec![photo("m", &halves)], canvas_fills: vec![fill("c", CanvasFillKind::Blur { amount: 1.0 })], ..Default::default() };
    let img = frame(project(vec![track("main", vec![clip("a", "m", 0, 0.25, &["c"])])], mats), 1.0);
    // Corners far from the middle keep their side's colour; near it they're grey.
    let (left, right, mid_left, mid_right) = (px(&img, 1, 2)[0], px(&img, W - 2, 2)[0], px(&img, W / 2 - 3, 2)[0], px(&img, W / 2 + 2, 2)[0]);
    assert!(left > 200 && right < 55, "{left} {right}");
    assert!(mid_left < left && mid_left > 128 && mid_right > right && mid_right < 128, "{mid_left} {mid_right}");
    // The clip itself is drawn on top, sharp.
    assert_eq!(px(&img, W / 2 - 4, H / 2), [255, 255, 255]);
}

/// An image fill covers the canvas behind the clip.
#[test]
fn an_image_fill_covers_the_canvas() {
    let (grey, blue) = (still("cmp-grey2.png", [128, 128, 128]), still("cmp-blue.png", [0, 0, 255]));
    let mats = Materials { media: vec![photo("m", &grey)], canvas_fills: vec![fill("c", CanvasFillKind::Image { path: blue.to_string_lossy().into_owned() })], ..Default::default() };
    let img = frame(project(vec![track("main", vec![clip("a", "m", 0, 0.5, &["c"])])], mats), 1.0);
    assert_eq!(px(&img, 2, 2), [0, 0, 255]);
    assert_eq!(px(&img, 32, 18), [128, 128, 128]);
}

/// In a transition that mixes two main-track clips, each carries its own fill: a Mix halfway
/// shows both fills mixed around the clips, not black.
#[test]
fn transition_groups_carry_each_clips_fill() {
    let grey = still("cmp-grey3.png", [128, 128, 128]);
    let colour = |r: f32, g: f32| CanvasFillKind::Color { color: Rgba { r, g, b: 0.0, a: 1.0 } };
    let mut mats = Materials { media: vec![photo("m", &grey)], canvas_fills: vec![fill("ca", colour(1.0, 0.0)), fill("cb", colour(0.0, 1.0))], ..Default::default() };
    mats.transitions.push(Transition { id: MaterialId("tr".into()), name: String::new(), duration: Micros(1_000_000), overlap: true, builtin: Some("mix".into()), library: None, resource: None, params: Default::default() });
    let p = project(vec![track("main", vec![clip("a", "m", 0, 0.5, &["ca", "tr"]), clip("b", "m", 2_000_000, 0.5, &["cb"])])], mats);
    assert!(near(px(&frame(p.clone(), 2.0), 2, 2), [128, 128, 0], 3), "{:?}", px(&frame(p.clone(), 2.0), 2, 2));
    assert_eq!(px(&frame(p.clone(), 1.0), 2, 2), [255, 0, 0]);
    assert_eq!(px(&frame(p, 3.0), 2, 2), [0, 255, 0]);
}

/// A blend effect on an overlay blends it with the main track's picture; a chroma key on it
/// takes its green out.
#[test]
fn blend_and_chroma_materials_reach_the_frame() {
    let (grey, half) = (still("cmp-grey4.png", [100, 150, 200]), png("cmp-split.png", W, H, |x, _| if x < W / 2 { [0, 200, 30, 255] } else { [200, 100, 50, 255] }));
    let blend = |mode: BlendMode| Effect { id: MaterialId("blend".into()), category: EffectCategory::Blend, name: String::new(), params: Default::default(), builtin: Some(mode.name().into()), resource: None, library: None, text_style: None };
    let mats = |extra: Vec<Effect>, chromas: Vec<Chroma>| Materials { media: vec![photo("bg", &grey), photo("fg", &half)], effects: extra, chromas, ..Default::default() };
    let tracks = |att: &[&str]| vec![track("main", vec![clip("a", "bg", 0, 1.0, &[])]), track("over", vec![clip("b", "fg", 0, 1.0, att)])];
    let screen = frame(project(tracks(&["blend"]), mats(vec![blend(BlendMode::Screen)], vec![])), 1.0);
    let s = |b: u8, f: u8| (255.0 - (255.0 - b as f32) * (255.0 - f as f32) / 255.0).round() as u8;
    assert!(near(px(&screen, 48, 18), [s(100, 200), s(150, 100), s(200, 50)], 1), "{:?}", px(&screen, 48, 18));
    let multiply = frame(project(tracks(&["blend"]), mats(vec![blend(BlendMode::Multiply)], vec![])), 1.0);
    let m = |b: u8, f: u8| (b as f32 * f as f32 / 255.0).round() as u8;
    assert!(near(px(&multiply, 48, 18), [m(100, 200), m(150, 100), m(200, 50)], 1), "{:?}", px(&multiply, 48, 18));
    // Normal by name draws as without one.
    let plain = frame(project(tracks(&[]), mats(vec![], vec![])), 1.0);
    assert_eq!(frame(project(tracks(&["blend"]), mats(vec![blend(BlendMode::Normal)], vec![])), 1.0).data, plain.data);
    // The green half keyed out shows the main clip; the other half stays.
    let key = Chroma { id: MaterialId("key".into()), color: Rgba { r: 0.0, g: 200.0 / 255.0, b: 30.0 / 255.0, a: 1.0 }, intensity: 0.5, shadow: 0.0, edge_smooth: 0.0, spill: 0.0 };
    let keyed = frame(project(tracks(&["key"]), mats(vec![], vec![key.clone()])), 1.0);
    assert_eq!(px(&keyed, 8, 18), [100, 150, 200]);
    assert_eq!(px(&keyed, 48, 18), [200, 100, 50]);
    // Keyframed down to 0, it keys nothing.
    let mut p = project(tracks(&["key"]), mats(vec![], vec![key]));
    p.tracks[1].segments[0].keyframes.push(ParamKeys { material: MaterialId("key".into()), param: Param::ChromaIntensity, keys: vec![Keyframe::new(Micros(0), 0.0)] });
    assert_eq!(frame(p, 1.0).data, plain.data);
}

/// A `.cube` LUT attached to a clip (the app's Adjust › LUT) is drawn, by its strength.
#[test]
fn a_lut_on_a_clip_is_drawn() {
    let grey = still("cmp-grey5.png", [40, 80, 120]);
    let cube = { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d }.join("cmp-invert.cube");
    let mut text = String::from("LUT_3D_SIZE 2\n");
    for b in 0..2 {
        for g in 0..2 {
            for r in 0..2 {
                text.push_str(&format!("{} {} {}\n", 1 - r, 1 - g, 1 - b));
            }
        }
    }
    std::fs::write(&cube, text).unwrap();
    let lut = |strength: f64| Effect {
        id: MaterialId("lut".into()),
        category: EffectCategory::Filter,
        name: "invert".into(),
        params: [("intensity".to_string(), strength)].into_iter().collect(),
        builtin: Some("cube".into()),
        resource: Some(cube.to_string_lossy().into_owned()),
        library: None,
        text_style: None,
    };
    let p = |strength: f64| project(vec![track("main", vec![clip("a", "m", 0, 1.0, &["lut"])])], Materials { media: vec![photo("m", &grey)], effects: vec![lut(strength)], ..Default::default() });
    assert!(near(px(&frame(p(1.0), 1.0), 10, 10), [215, 175, 135], 1), "{:?}", px(&frame(p(1.0), 1.0), 10, 10));
    assert!(near(px(&frame(p(0.5), 1.0), 10, 10), [128, 128, 128], 1));
}

/// Exposure and fade on a clip without a CapCut colour bundle (the app's own) use OpenRip's
/// curves, so they work with no CapCut on the machine: exposure lightens or darkens a mid grey
/// as CapCut's slider does (within a few levels), fade lifts black. A draft's slider naming a
/// bundle that isn't there is left out, as before.
#[test]
fn exposure_and_fade_work_without_capcuts_bundle() {
    let grey = still("cmp-grey6.png", [128, 128, 128]);
    let black = still("cmp-black.png", [0, 0, 0]);
    let slider = |name: &str, value: f64, resource: Option<&str>| Effect {
        id: MaterialId(format!("adj-{name}")),
        category: EffectCategory::Adjust,
        name: name.into(),
        params: [("intensity".to_string(), value)].into_iter().collect(),
        builtin: Some(name.into()),
        resource: resource.map(String::from),
        library: None,
        text_style: None,
    };
    let p = |media: &PathBuf, effects: Vec<Effect>| {
        let ids: Vec<String> = effects.iter().map(|e| e.id.0.clone()).collect();
        let att: Vec<&str> = ids.iter().map(String::as_str).collect();
        project(vec![track("main", vec![clip("a", "m", 0, 1.0, &att)])], Materials { media: vec![photo("m", media)], effects, ..Default::default() })
    };
    let plain = px(&frame(p(&grey, vec![]), 1.0), 10, 10);
    // CapCut's own tables take a mid grey (128) to about 190 at full brightening and about 118
    // at full darkening; half the slider goes half way.
    let up = px(&frame(p(&grey, vec![slider("exposure", 1.0, None)]), 1.0), 10, 10);
    let half = px(&frame(p(&grey, vec![slider("exposure", 0.5, None)]), 1.0), 10, 10);
    let down = px(&frame(p(&grey, vec![slider("exposure", -1.0, None)]), 1.0), 10, 10);
    assert!(near(up, [190, 190, 190], 4), "{up:?}");
    assert!(near(half, [159, 159, 159], 3), "{half:?}");
    assert!(near(down, [118, 118, 118], 4), "{down:?}");
    // Fade lifts black towards CapCut's 69.
    let faded = px(&frame(p(&black, vec![slider("fade", 1.0, None)]), 1.0), 10, 10);
    assert!(near(faded, [69, 69, 69], 2), "{faded:?}");
    // A draft's slider whose bundle isn't on this machine draws nothing, as before.
    let missing = px(&frame(p(&grey, vec![slider("exposure", 1.0, Some("/nowhere/7501974767453474064/bundle"))]), 1.0), 10, 10);
    assert_eq!(missing, plain);
}

