//! A compound clip in the preview engine's frames: its content drawn as one picture at the
//! time the clip reads it, then placed, faded and blended as the clip says. Stills are flat
//! colours written as PNGs.

use std::path::{Path, PathBuf};

use openrip_model::*;
use openrip_playback::PreviewEngine;

const W: u32 = 64;
const H: u32 = 36;

fn grey_png(name: &str) -> PathBuf {
    let path = { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d }.join(name);
    let file = std::fs::File::create(&path).unwrap();
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), W, H);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let data: Vec<u8> = (0..W * H).flat_map(|_| [128, 128, 128, 255]).collect();
    enc.write_header().unwrap().write_image_data(&data).unwrap();
    path
}

fn photo(id: &str, path: &Path) -> Media {
    Media { id: MaterialId(id.into()), kind: MediaKind::Photo, path: path.to_string_lossy().into_owned(), width: W, height: H, duration: Micros(0), has_audio: false, matte: None, freeze: None, reverse_path: None, complement_frame: None, smart_complement_frame: None, enhance: None }
}

fn clip(id: &str, material: &str, start: i64, duration: i64, source_start: i64, scale: f64) -> Segment {
    Segment {
        id: id.into(),
        material: MaterialId(material.into()),
        source: Some(TimeRange::new(Micros(source_start), Micros(duration))),
        target: TimeRange::new(Micros(start), Micros(duration)),
        speed: 1.0,
        reverse: false,
        change_pitch: false,
        visible: true,
        render_index: 0,
        transform: Transform { scale: Animated::constant(Vec2::new(scale, scale)), ..Transform::default() },
        crop: None,
        opacity: Animated::constant(1.0),
        volume: Animated::constant(1.0),
        attachments: Vec::new(),
        keyframes: Vec::new(),
    }
}

fn track(id: &str, segments: Vec<Segment>) -> Track {
    Track { id: id.into(), kind: TrackKind::Video, name: String::new(), segments, muted: false, hidden: false, locked: false }
}

/// A grey still at half size from 1 s to 3 s of a compound's own time, which a clip at 5 s
/// of the project plays from its 1 s: the content's 1–3 s at 5–7 s.
fn project(compound: impl Fn(&mut Segment)) -> Project {
    let grey = grey_png("compound-grey.png");
    let mut p = Project::new("p", "compound", Canvas { width: W, height: H }, FrameRate::new(30, 1));
    p.materials.media.push(photo("m", &grey));
    p.materials.compounds.push(Compound { id: "c".into(), name: "Compound 1".into(), tracks: vec![track("inner", vec![clip("in", "m", 1_000_000, 2_000_000, 0, 0.5)])] });
    let mut outer = clip("out", "c", 5_000_000, 2_000_000, 1_000_000, 1.0);
    compound(&mut outer);
    p.tracks.push(track("main", vec![outer]));
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

#[test]
fn a_compound_shows_its_content_at_the_time_its_clip_reads_it() {
    let inside = frame(project(|_| {}), 5.5);
    // The content's own half size, black around it.
    assert!(near(px(&inside, 32, 18), [128, 128, 128], 2));
    assert!(near(px(&inside, 20, 18), [128, 128, 128], 2));
    assert!(near(px(&inside, 4, 18), [0, 0, 0], 2));
    // Before the clip, and past it: nothing.
    assert!(near(px(&frame(project(|_| {}), 4.5), 32, 18), [0, 0, 0], 2));
    assert!(near(px(&frame(project(|_| {}), 7.5), 32, 18), [0, 0, 0], 2));
}

#[test]
fn a_trimmed_compound_reads_its_content_from_the_trim() {
    // Reading from 2.5 s of the content (a trim of the clip's head): the content's still
    // ends at 3 s, so the clip shows it for half a second, then nothing.
    let trimmed = |s: &mut Segment| {
        s.source = Some(TimeRange::new(Micros(2_500_000), Micros(2_000_000)));
        s.target = TimeRange::new(Micros(5_000_000), Micros(2_000_000));
    };
    assert!(near(px(&frame(project(trimmed), 5.25), 32, 18), [128, 128, 128], 2));
    assert!(near(px(&frame(project(trimmed), 5.75), 32, 18), [0, 0, 0], 2));
}

#[test]
fn a_compound_is_placed_faded_and_blended_as_one_clip() {
    // Scaled by half: the content shrinks with it (its half size becomes a quarter).
    let small = frame(project(|s| s.transform.scale = Animated::constant(Vec2::new(0.5, 0.5))), 5.5);
    assert!(near(px(&small, 32, 18), [128, 128, 128], 2));
    assert!(near(px(&small, 20, 18), [0, 0, 0], 2));
    // Moved right: the middle of the canvas is empty and the content sits at the right.
    let moved = frame(project(|s| s.transform.position = Animated::constant(Vec2::new(0.5, 0.0))), 5.5);
    assert!(near(px(&moved, 16, 18), [0, 0, 0], 2));
    assert!(near(px(&moved, 48, 18), [128, 128, 128], 2));
    // Half opaque over black.
    let faded = frame(project(|s| s.opacity = Animated::constant(0.5)), 5.5);
    assert!(near(px(&faded, 32, 18), [64, 64, 64], 2), "{:?}", px(&faded, 32, 18));
}

#[test]
fn a_compound_in_a_compound_draws_both_levels() {
    let mut p = project(|_| {});
    // "d" plays "c" from its 1 s at its own 0 s; the clip plays "d" from 0 at 5 s.
    p.materials.compounds.push(Compound { id: "d".into(), name: "Compound 2".into(), tracks: vec![track("deep", vec![clip("mid", "c", 0, 2_000_000, 1_000_000, 1.0)])] });
    p.tracks[0].segments[0].material = "d".into();
    p.tracks[0].segments[0].source = Some(TimeRange::new(Micros(0), Micros(2_000_000)));
    assert!(near(px(&frame(p.clone(), 5.5), 20, 18), [128, 128, 128], 2));
    assert!(near(px(&frame(p, 4.5), 20, 18), [0, 0, 0], 2));
}

#[test]
fn a_compound_plays_its_content_at_its_speed_and_direction() {
    // At twice the speed the clip's 2 s read 4 s of the content (from its 1 s): the still,
    // which is there from 1 s to 3 s of it, is on screen for the clip's first second only.
    let fast = |s: &mut Segment| {
        s.speed = 2.0;
        s.source = Some(TimeRange::new(Micros(1_000_000), Micros(4_000_000)));
    };
    assert!(near(px(&frame(project(fast), 5.75), 32, 18), [128, 128, 128], 2));
    assert!(near(px(&frame(project(fast), 6.5), 32, 18), [0, 0, 0], 2));
    // Slower than 1 the other way: half speed reads 1 s of content over the 2 s.
    let slow = |s: &mut Segment| {
        s.speed = 0.5;
        s.source = Some(TimeRange::new(Micros(1_000_000), Micros(1_000_000)));
    };
    assert!(near(px(&frame(project(slow), 6.9), 32, 18), [128, 128, 128], 2));
    // Backward at twice the speed: the clip starts at the content's 5 s end of the range
    // (nothing there yet) and reaches the still a second and a quarter in.
    let back = |s: &mut Segment| {
        s.speed = 2.0;
        s.reverse = true;
        s.source = Some(TimeRange::new(Micros(1_000_000), Micros(4_000_000)));
    };
    assert!(near(px(&frame(project(back), 5.25), 32, 18), [0, 0, 0], 2));
    assert!(near(px(&frame(project(back), 6.5), 32, 18), [128, 128, 128], 2));
}

#[test]
fn a_compound_follows_its_speed_curve() {
    // Constant 2x reads the content's 1..5 s over the clip's 2 s: at the clip's 1.1 s it's at
    // 3.2 s, past the still (1..3 s). A curve that starts slow and ends fast (1x to 3x, 2x on
    // average) is only at 2.7 s there: the still is still on screen.
    let by_curve = |curve: Vec<(f64, f64)>| {
        let mut p = project(|s| {
            s.speed = 2.0;
            s.source = Some(TimeRange::new(Micros(1_000_000), Micros(4_000_000)));
        });
        p.materials.speeds.push(Speed { id: "sp".into(), speed: 2.0, curve, preset: None });
        p.tracks[0].segments[0].attachments.push("sp".into());
        p
    };
    assert!(near(px(&frame(by_curve(vec![(0.0, 2.0), (1.0, 2.0)]), 6.1), 32, 18), [0, 0, 0], 2));
    assert!(near(px(&frame(by_curve(vec![(0.0, 1.0), (1.0, 3.0)]), 6.1), 32, 18), [128, 128, 128], 2));
}
