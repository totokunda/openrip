//! The app's shapes in the preview engine's frames, set up through the project model as the
//! app's importer (openrip-v1) sets them up: CapCut's parallelogram as an outline of
//! vertices, a line with an arrow at its end, a pen path with Bézier handles, dashes and a
//! shadow.

use openrip_model::*;
use openrip_playback::PreviewEngine;

const W: u32 = 160;
const H: u32 = 90;

/// A shape filling the canvas's middle `size` (in canvas pixels; one unit is a pixel).
fn shape_project(paths: Vec<ShapePath>, size: [f32; 2], shadow: Option<ShapeShadow>) -> Project {
    let mut p = Project::new("p", "shapes", Canvas { width: W, height: H }, FrameRate::new(30, 1));
    p.materials.shapes.push(Shape { id: MaterialId("s".into()), size, scale: [1.0, 1.0], unit: 1.0 / H as f32, paths, shadow });
    p.tracks.push(Track {
        id: "t".into(),
        kind: TrackKind::Graphic,
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
            transform: Transform::default(),
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

fn frame(p: Project) -> openrip_render::RgbaImage {
    let mut e = PreviewEngine::new(p).unwrap();
    e.render_image(Micros(500_000), W, H).unwrap().0
}

/// The pixel at `(x, y)` from the canvas's middle.
fn px(img: &openrip_render::RgbaImage, x: i32, y: i32) -> [u8; 3] {
    let (x, y) = ((W as i32 / 2 + x) as u32, (H as i32 / 2 + y) as u32);
    let i = ((y * img.width + x) * 4) as usize;
    [img.data[i], img.data[i + 1], img.data[i + 2]]
}

const GREY: Rgba = Rgba { r: 148.0 / 255.0, g: 148.0 / 255.0, b: 148.0 / 255.0, a: 1.0 };
const WHITE: Rgba = Rgba { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };

fn stroke(width: f32) -> ShapeStroke {
    ShapeStroke { color: WHITE, width, ends: StrokeEnds::Butt, dash: StrokeDash::Solid, start: StrokeMarker::None, end: StrokeMarker::None }
}

/// CapCut's parallelogram (the top a third of the box to the right), filled grey.
#[test]
fn a_parallelogram_is_drawn_leaning_right() {
    let pts = vec![[20.0, 0.0], [60.0, 0.0], [40.0, 60.0], [0.0, 60.0]];
    let path = ShapePath { geometry: Geometry::Vertices { points: pts, corner_radius: 0.0 }, fill: Some(GREY), stroke: None, opacity: 1.0, blend: PathBlend::Normal };
    let img = frame(shape_project(vec![path], [60.0, 60.0], None));
    // Near the top the left corner is empty and the right filled; near the bottom, the reverse.
    assert_eq!((px(&img, -25, -27), px(&img, 25, -27)), ([0, 0, 0], [148, 148, 148]));
    assert_eq!((px(&img, -25, 27), px(&img, 25, 27)), ([148, 148, 148], [0, 0, 0]));
}

/// A line with an arrow at its end: the arrow's base is wider than the line just before the
/// end, and nothing is drawn past the end.
#[test]
fn an_arrow_is_wider_than_its_line_at_the_end() {
    let path = ShapePath {
        geometry: Geometry::Path { nodes: vec![[0.0, 10.0, 0.0, 0.0, 0.0, 0.0], [100.0, 10.0, 0.0, 0.0, 0.0, 0.0]], closed: false },
        fill: None,
        stroke: Some(ShapeStroke { end: StrokeMarker::Arrow, ..stroke(4.0) }),
        opacity: 1.0,
        blend: PathBlend::Normal,
    };
    let img = frame(shape_project(vec![path], [100.0, 20.0], None));
    // The line is 4 wide: 4 above its middle is empty along it, but not 4 above the arrow's base.
    assert_eq!(px(&img, -20, -4), [0, 0, 0]);
    assert_eq!(px(&img, -20, 0), [255, 255, 255]);
    assert_eq!(px(&img, 39, -4), [255, 255, 255]);
    assert_eq!(px(&img, 52, 0), [0, 0, 0]);
}

/// A closed pen path bulging down between two points (handles 30 below them), filled; a
/// shadow 6 to the right shows past its right end.
#[test]
fn a_pen_path_curves_by_its_handles_and_casts_its_shadow() {
    let nodes = vec![[0.0, 0.0, 0.0, 0.0, 0.0, 40.0], [80.0, 0.0, 0.0, 40.0, 0.0, 0.0]];
    let path = ShapePath { geometry: Geometry::Path { nodes, closed: true }, fill: Some(GREY), stroke: None, opacity: 1.0, blend: PathBlend::Normal };
    let shadow = ShapeShadow { color: Rgba { r: 1.0, g: 0.0, b: 0.0, a: 1.0 }, offset: [6.0, 0.0] };
    let img = frame(shape_project(vec![path], [80.0, 30.0], Some(shadow)));
    // The curve reaches 3/4 of 40 down at its middle, 15 below the canvas's middle (the box's
    // top is 15 above it): (0, 12) is inside, (0, 18) outside.
    assert_eq!(px(&img, 0, 12), [148, 148, 148]);
    assert_eq!(px(&img, 0, 18), [0, 0, 0]);
    // Just past the right end, the red shadow.
    assert_eq!(px(&img, 42, -13), [255, 0, 0]);
}

/// A dashed stroke leaves gaps; dots are round and spaced two widths apart.
#[test]
fn dashes_leave_gaps() {
    let line = |dash: StrokeDash| ShapePath {
        geometry: Geometry::Path { nodes: vec![[0.0, 5.0, 0.0, 0.0, 0.0, 0.0], [120.0, 5.0, 0.0, 0.0, 0.0, 0.0]], closed: false },
        fill: None,
        stroke: Some(ShapeStroke { dash, ..stroke(4.0) }),
        opacity: 1.0,
        blend: PathBlend::Normal,
    };
    let solid = frame(shape_project(vec![line(StrokeDash::Solid)], [120.0, 10.0], None));
    let dashed = frame(shape_project(vec![line(StrokeDash::Dashed)], [120.0, 10.0], None));
    // Dashes 16 on, 8 off from the line's start (60 left of the middle): 20 in is a gap.
    assert_eq!(px(&solid, -40, 0), [255, 255, 255]);
    assert_eq!(px(&dashed, -40, 0), [0, 0, 0]);
    assert_eq!(px(&dashed, -50, 0), [255, 255, 255]);
}
