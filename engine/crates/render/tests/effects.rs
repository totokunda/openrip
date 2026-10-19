//! OpenRip's own video effects (openrip_model::fx): each leaves the frame as it was at zero
//! strength and changes it at full strength, and a few are checked against what they must
//! draw. Skipped when no GPU adapter is available.

use openrip_model::fx::{self, FxDef, FX};
use openrip_render::{Compositor, EffectPass, Layer, Mix, MixMask, RgbaImage, Shot, Source};

const W: u32 = 192;
const H: u32 = 108;

fn gpu() -> Option<Compositor> {
    match Compositor::new() {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("no GPU ({e}); skipping");
            None
        }
    }
}

/// A picture with colour, gradients, edges and bright parts, so every effect has something to
/// work on.
fn scene() -> RgbaImage {
    let mut data = Vec::with_capacity((W * H * 4) as usize);
    for y in 0..H {
        for x in 0..W {
            let (fx, fy) = (x as f32 / W as f32, y as f32 / H as f32);
            let mut c = [fx * 0.9 + 0.05, 0.25 + 0.5 * fy, 0.8 - 0.6 * fx];
            if ((x / 12) + (y / 12)) % 2 == 0 {
                c = c.map(|v| v * 0.6);
            }
            let (dx, dy) = (x as f32 - 150.0, y as f32 - 34.0);
            if dx * dx + dy * dy < 120.0 {
                c = [1.0, 0.95, 0.8];
            }
            if (60..100).contains(&x) && (30..80).contains(&y) {
                c = [0.9, 0.2, 0.15];
            }
            data.extend_from_slice(&[(c[0] * 255.0) as u8, (c[1] * 255.0) as u8, (c[2] * 255.0) as u8, 255]);
        }
    }
    RgbaImage { width: W, height: H, data }
}

fn pass(def: &FxDef, intensity: f32, params: [f32; 3], time: f32, progress: f32) -> EffectPass {
    EffectPass { kind: def.kind, intensity, params, time, progress, seed: 0.0 }
}

fn defaults(def: &FxDef) -> [f32; 3] {
    let mut p = [0.0; 3];
    for (i, q) in def.params.iter().enumerate() {
        p[i] = q.default;
    }
    p
}

fn render(c: &Compositor, src: &RgbaImage, effect: Option<EffectPass>) -> RgbaImage {
    let mut layers = vec![Layer::from_model(src, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0)];
    layers.extend(effect.map(|e| Layer::pass(Source::Effect(e))));
    c.render(W, H, [0, 0, 0], &layers)
}

fn mean_diff(a: &RgbaImage, b: &RgbaImage) -> f64 {
    a.data.iter().zip(&b.data).map(|(x, y)| (*x as i32 - *y as i32).unsigned_abs() as f64).sum::<f64>() / a.data.len() as f64
}

fn at(img: &RgbaImage, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * img.width + x) * 4) as usize;
    img.data[i..i + 4].try_into().unwrap()
}

#[test]
fn every_effect_is_off_at_zero_and_changes_the_frame_at_full_strength() {
    let Some(c) = gpu() else { return };
    let src = scene();
    let base = render(&c, &src, None);
    for def in FX {
        let p = defaults(def);
        let off = render(&c, &src, Some(pass(def, 0.0, p, 0.3, 0.5)));
        assert_eq!(off.data, base.data, "{} at zero strength", def.id);
        // Nearly zero is nearly nothing.
        let faint = render(&c, &src, Some(pass(def, 0.001, p, 0.3, 0.5)));
        assert!(mean_diff(&faint, &base) < 1.5, "{} at 0.1% changes the frame by {}", def.id, mean_diff(&faint, &base));
        // Full strength, somewhere in its run (a pulse can be between beats at one moment).
        let best = [(0.0, 0.0), (0.13, 0.2), (0.37, 0.5), (0.61, 0.7), (0.9, 0.95)]
            .into_iter()
            .map(|(t, prog)| mean_diff(&render(&c, &src, Some(pass(def, 1.0, p, t, prog))), &base))
            .fold(0.0, f64::max);
        assert!(best > 0.3, "{} changes the frame by only {best}", def.id);
    }
}

#[test]
fn effects_draw_what_they_say() {
    let Some(c) = gpu() else { return };
    let src = scene();
    let base = render(&c, &src, None);
    let run = |id: &str, k: f32, params: [f32; 3], t: f32, prog: f32| {
        let def = fx::find(id).unwrap();
        render(&c, &src, Some(pass(def, k, params, t, prog)))
    };
    // Inverted colours.
    let inv = run("invert", 1.0, [0.0; 3], 0.0, 0.0);
    for (x, y) in [(10, 10), (70, 40), (150, 34), (180, 100)] {
        let (a, b) = (at(&base, x, y), at(&inv, x, y));
        for i in 0..3 {
            assert!((255 - a[i] as i32 - b[i] as i32).abs() <= 1, "invert at {x},{y}");
        }
    }
    // Black and white has no colour left.
    let mono = run("mono", 1.0, [0.0; 3], 0.0, 0.0);
    for (x, y) in [(10, 10), (70, 40), (180, 100)] {
        let p = at(&mono, x, y);
        assert!((p[0] as i32 - p[1] as i32).abs() <= 1 && (p[1] as i32 - p[2] as i32).abs() <= 1);
    }
    // Faded to black and white by its end, and not yet at its start.
    let black = run("fade_out", 1.0, [0.0; 3], 0.0, 1.0);
    assert!(black.data.chunks(4).all(|p| p[..3] == [0, 0, 0]));
    let white = run("white_out", 1.0, [0.0; 3], 0.0, 1.0);
    assert!(white.data.chunks(4).all(|p| p[..3] == [255, 255, 255]));
    assert_eq!(run("fade_out", 1.0, [0.0; 3], 0.0, 0.0).data, base.data);
    // Letterbox bars: black top and bottom, the picture between.
    let bars = run("letterbox", 1.0, [0.0; 3], 0.0, 0.0);
    assert_eq!(at(&bars, 90, 2)[..3], [0, 0, 0]);
    assert_eq!(at(&bars, 90, H - 3)[..3], [0, 0, 0]);
    assert_eq!(at(&bars, 90, H / 2), at(&base, 90, H / 2));
    // A white border at the corner, the middle untouched.
    let framed = run("border", 1.0, [1.0, 0.0, 0.0], 0.0, 0.0);
    assert_eq!(at(&framed, 1, 1)[..3], [255, 255, 255]);
    assert_eq!(at(&framed, 96, 54), at(&base, 96, 54));
    // Mirrored: the right half is the left's reflection.
    let mir = run("mirror_h", 1.0, [0.0; 3], 0.0, 0.0);
    for (x, y) in [(120, 20), (150, 70), (190, 100)] {
        let (m, l) = (at(&mir, x, y), at(&base, W - 1 - x, y));
        for i in 0..3 {
            assert!((m[i] as i32 - l[i] as i32).abs() <= 24, "mirror at {x},{y}: {m:?} vs {l:?}");
        }
    }
    // Split in two: the picture's left edge repeats at the middle.
    let split = run("split2", 1.0, [0.0; 3], 0.0, 0.0);
    for y in [10, 50, 90] {
        let (a, b) = (at(&split, 2, y), at(&split, W / 2 + 2, y));
        for i in 0..3 {
            assert!((a[i] as i32 - b[i] as i32).abs() <= 12, "split at {y}");
        }
    }
    // Pixelated: neighbours within a block match.
    let mos = run("mosaic", 1.0, [0.0; 3], 0.0, 0.0);
    assert_eq!(at(&mos, 40, 40), at(&mos, 41, 41));
    // A blur softens the red square's edge: a pixel just outside it gains red.
    let blur = run("blur", 1.0, [0.0; 3], 0.0, 0.0);
    assert!(at(&blur, 58, 50)[0] as i32 > at(&base, 58, 50)[0] as i32 + 5 || at(&blur, 58, 50)[1] != at(&base, 58, 50)[1]);
    // Never goes outside the premultiplied range: opaque stays opaque.
    for id in ["fisheye", "rounded", "spin", "crt", "film_strip"] {
        assert!(run(id, 1.0, defaults(fx::find(id).unwrap()), 0.4, 0.5).data.chunks(4).all(|p| p[3] == 255), "{id} on the canvas is opaque");
    }
}

#[test]
fn an_effect_on_one_clip_leaves_what_is_beside_it_alone() {
    let Some(c) = gpu() else { return };
    let src = scene();
    // A clip's group: the clip drawn into it, the effect on it, then put over the canvas.
    let def = fx::find("invert").unwrap();
    let under = RgbaImage { width: W, height: H, data: [10u8, 20, 30, 255].repeat((W * H) as usize) };
    // A small clip: the left half of the canvas, over the picture below.
    let mut half = src.clone();
    for y in 0..H {
        for x in W / 2..W {
            let i = ((y * W + x) * 4) as usize;
            half.data[i..i + 4].copy_from_slice(&[0, 0, 0, 0]);
        }
    }
    let still = Shot { inverse: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], alpha: 1.0, zoom_blur: 0.0, mirror: false };
    let layers = [
        Layer::from_model(&under, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0),
        Layer::pass(Source::BeginGroup(None)),
        Layer::from_model(&half, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0),
        Layer::pass(Source::Effect(pass(def, 1.0, [0.0; 3], 0.0, 0.0))),
        Layer::pass(Source::EndGroup),
        Layer::pass(Source::Mix(Mix { outgoing: Some(still), incoming: None, mask: MixMask::All, fx: None })),
    ];
    let out = c.render(W, H, [0, 0, 0], &layers);
    // Right half: the canvas below, untouched. Left half: the clip, inverted.
    assert_eq!(at(&out, 150, 50), [10, 20, 30, 255]);
    let (o, s) = (at(&out, 20, 50), at(&src, 20, 50));
    for i in 0..3 {
        assert!((255 - s[i] as i32 - o[i] as i32).abs() <= 2);
    }
}

/// Every effect at its defaults on the sample picture, side by side, into the raw RGBA file
/// named by OPENRIP_FX_SHEET (width x height in the file's name's sibling .txt): for looking.
#[test]
#[ignore]
fn contact_sheet() {
    let Some(c) = gpu() else { return };
    let Ok(path) = std::env::var("OPENRIP_FX_SHEET") else { return };
    let time: f32 = std::env::var("OPENRIP_FX_TIME").ok().and_then(|t| t.parse().ok()).unwrap_or(0.4);
    let scene = openrip_render::sample_scene(W, H);
    let cols = 10u32;
    let rows = (FX.len() as u32).div_ceil(cols);
    let mut sheet = vec![0u8; (cols * W * rows * H * 4) as usize];
    for (i, def) in FX.iter().enumerate() {
        let img = render(&c, &scene, Some(pass(def, def.intensity.max(0.8), defaults(def), time, 0.5)));
        let (cx, cy) = (i as u32 % cols, i as u32 / cols);
        for y in 0..H {
            let dst = (((cy * H + y) * cols * W + cx * W) * 4) as usize;
            sheet[dst..dst + (W * 4) as usize].copy_from_slice(&img.data[(y * W * 4) as usize..((y + 1) * W * 4) as usize]);
        }
    }
    std::fs::write(&path, &sheet).unwrap();
    std::fs::write(format!("{path}.txt"), format!("{} {}", cols * W, rows * H)).unwrap();
}
