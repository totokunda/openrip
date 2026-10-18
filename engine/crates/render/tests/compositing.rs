//! Blend modes, the chroma key, flips and LUTs on a clip, in the compositor's frames. Images
//! are drawn at the canvas's size, so placement leaves their pixels as they are. Skipped
//! when no GPU adapter is available.

use openrip_render::{BlendMode, ChromaKey, Compositor, Layer, Lut3d, RgbaImage, Source};

fn gpu() -> Option<Compositor> {
    match Compositor::new() {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("no GPU ({e}); skipping");
            None
        }
    }
}

fn image(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> RgbaImage {
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            data.extend_from_slice(&f(x, y));
        }
    }
    RgbaImage { width: w, height: h, data }
}

fn px(img: &RgbaImage, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * img.width + x) * 4) as usize;
    img.data[i..i + 4].try_into().unwrap()
}

const W: u32 = 64;
const H: u32 = 32;

/// Every pair of levels in steps of 1/15: the backdrop across, the layer down (and along the
/// diagonal for the third channel).
fn backdrop() -> RgbaImage {
    image(W, H, |x, y| [((x % 16) * 17) as u8, ((y % 16) * 17) as u8, (((x + y) % 16) * 17) as u8, 255])
}

fn layer_image(alpha: u8) -> RgbaImage {
    image(W, H, |x, y| [((y % 16) * 17) as u8, ((x % 16) * 17) as u8, ((15 - (x + 2 * y) % 16) * 17) as u8, alpha])
}

/// Each mode on the GPU against the formula worked on the CPU (blend.rs), from the 8-bit
/// pixels the GPU sees: the layer premultiplied as the upload rounds it, times its opacity.
#[test]
fn every_blend_mode_matches_its_formula() {
    let Some(c) = gpu() else { return };
    let (b_img, s_img) = (backdrop(), layer_image(200));
    for mode in BlendMode::ALL {
        let opacity = 0.75;
        let layers = [
            Layer::from_model(&b_img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0),
            Layer { opacity, blend: mode, ..Layer::from_model(&s_img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0) },
        ];
        let out = c.render(W, H, [0, 0, 0], &layers);
        let mut worst = 0;
        for y in 0..H {
            for x in 0..W {
                let b = px(&b_img, x, y).map(|v| v as f32 / 255.0);
                let s8 = px(&s_img, x, y);
                let a = s8[3] as u32;
                let s = [0, 1, 2].map(|k| ((s8[k] as u32 * a + 127) / 255) as f32 / 255.0 * opacity);
                let want = mode.over(b, [s[0], s[1], s[2], a as f32 / 255.0 * opacity]);
                let got = px(&out, x, y);
                for k in 0..3 {
                    worst = worst.max((got[k] as i32 - (want[k] * 255.0).round() as i32).abs());
                }
            }
        }
        // Color burn and dodge divide by levels near 0 and 1: allow one more code value.
        let tolerance = if matches!(mode, BlendMode::ColorBurn | BlendMode::ColorDodge) { 2 } else { 1 };
        assert!(worst <= tolerance, "{mode:?}: off by {worst}");
    }
}

/// A blend mode blends with whatever's below, on the canvas: Normal draws the same as
/// before, and Multiply by white or Screen by black leaves the backdrop.
#[test]
fn blend_modes_work_on_the_running_composite() {
    let Some(c) = gpu() else { return };
    let b_img = backdrop();
    let white = image(W, H, |_, _| [255, 255, 255, 255]);
    let black = image(W, H, |_, _| [0, 0, 0, 255]);
    let base = c.render(W, H, [0, 0, 0], &[Layer::from_model(&b_img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0)]);
    for (img, mode) in [(&white, BlendMode::Multiply), (&black, BlendMode::Screen), (&white, BlendMode::Darken), (&black, BlendMode::Lighten)] {
        let layers = [Layer::from_model(&b_img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0), Layer { blend: mode, ..Layer::from_model(img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0) }];
        assert_eq!(c.render(W, H, [0, 0, 0], &layers).data, base.data, "{mode:?}");
    }
    // A smaller layer leaves the canvas outside it alone.
    let small = [Layer::from_model(&b_img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0), Layer { blend: BlendMode::Screen, ..Layer::from_model(&white, [W, H], [0.5, 0.0], [0.25, 0.25], 0.0) }];
    let out = c.render(W, H, [0, 0, 0], &small);
    assert_eq!(px(&out, 2, 2), px(&base, 2, 2));
    assert_eq!(px(&out, 48, 16), [255, 255, 255, 255]);
}

/// A green screen with a red square: the key takes the green out (the white canvas shows
/// through) and keeps the red; at intensity 0 nothing changes; smoothing the edge leaves
/// partly keyed pixels along it; spill takes the green cast off a greenish grey.
#[test]
fn the_chroma_key_takes_out_the_picked_colour() {
    let Some(c) = gpu() else { return };
    // Large enough for edge smoothing to reach 2 pixels (1.4% of the shorter side).
    let (w, h) = (400, 200);
    let green = [0u8, 200, 30];
    let screen = image(w, h, |x, y| if (150..250).contains(&x) && (50..150).contains(&y) { [220, 20, 20, 255] } else if x < 4 { [110, 140, 110, 255] } else { [green[0], green[1], green[2], 255] });
    let key = ChromaKey { color: green.map(|v| v as f32 / 255.0), intensity: 0.5, ..Default::default() };
    let draw = |k: Option<ChromaKey>| c.render(w, h, [255, 255, 255], &[Layer { chroma: k, ..Layer::from_model(&screen, [w, h], [0.0, 0.0], [1.0, 1.0], 0.0) }]);
    let plain = draw(None);
    let keyed = draw(Some(key));
    assert_eq!(px(&keyed, 50, 20), [255, 255, 255, 255], "the green is keyed out");
    assert_eq!(px(&keyed, 200, 100), [220, 20, 20, 255], "the red stays");
    assert_eq!(px(&keyed, 150, 100), [220, 20, 20, 255], "a hard edge without smoothing");
    assert_eq!(draw(Some(ChromaKey { intensity: 0.0, ..key })).data, plain.data);
    // Edge smoothing: the square's edge comes out between the red and the white canvas.
    let smooth = draw(Some(ChromaKey { edge_smooth: 1.0, ..key }));
    let edge = px(&smooth, 150, 100);
    assert!(edge[1] > 40 && edge[1] < 240, "{edge:?}");
    assert_eq!(px(&smooth, 200, 100), [220, 20, 20, 255]);
    // Spill: the greenish grey at the left loses green against its red and blue.
    let grey = |img: &RgbaImage| px(img, 1, 100);
    let (before, after) = (grey(&draw(Some(ChromaKey { intensity: 0.05, ..key }))), grey(&draw(Some(ChromaKey { intensity: 0.05, spill: 1.0, ..key }))));
    assert!((after[1] as i32 - after[0] as i32) < (before[1] as i32 - before[0] as i32), "{before:?} → {after:?}");
}

/// Flips mirror the picture about its middle, on screen, whatever its turn.
#[test]
fn flips_mirror_the_picture() {
    let Some(c) = gpu() else { return };
    let quarters = image(W, H, |x, y| match (x < W / 2, y < H / 2) {
        (true, true) => [255, 0, 0, 255],
        (false, true) => [0, 255, 0, 255],
        (true, false) => [0, 0, 255, 255],
        (false, false) => [255, 255, 0, 255],
    });
    let draw = |h: bool, v: bool| c.render(W, H, [0, 0, 0], &[Layer { flip_h: h, flip_v: v, ..Layer::from_model(&quarters, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0) }]);
    let corners = |img: &RgbaImage| [px(img, 4, 4), px(img, W - 5, 4), px(img, 4, H - 5), px(img, W - 5, H - 5)];
    let [tl, tr, bl, br] = corners(&draw(false, false));
    assert_eq!(corners(&draw(true, false)), [tr, tl, br, bl]);
    assert_eq!(corners(&draw(false, true)), [bl, br, tl, tr]);
    assert_eq!(corners(&draw(true, true)), [br, bl, tr, tl]);
    // Negative scales in the model's terms are flips too.
    let mirrored = c.render(W, H, [0, 0, 0], &[Layer::from_model(&quarters, [W, H], [0.0, 0.0], [-1.0, 1.0], 0.0)]);
    assert_eq!(corners(&mirrored), [tr, tl, br, bl]);
    // A picture stored on its side (phone video, shown upright by a quarter turn) mirrors on
    // screen too: a negative screen-x scale swaps its left and right, not its top and bottom.
    let (sw, sh) = (H, W);
    let stored = image(sw, sh, |x, y| px(&quarters, sh - 1 - y, x));
    let upright = c.render(W, H, [0, 0, 0], &[Layer::from_model_oriented(&stored, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0, 90)]);
    let [tl, tr, bl, br] = corners(&upright);
    assert_eq!([tl, tr, bl, br], corners(&draw(false, false)), "the stored picture shows upright");
    let side = |scale: [f64; 2]| corners(&c.render(W, H, [0, 0, 0], &[Layer::from_model_oriented(&stored, [W, H], [0.0, 0.0], scale, 0.0, 90)]));
    assert_eq!(side([-1.0, 1.0]), [tr, tl, br, bl], "mirrored left to right");
    assert_eq!(side([1.0, -1.0]), [bl, br, tl, tr], "mirrored top to bottom");
}

/// A `.cube` table on a clip: an inverting table at full strength inverts it, at half it
/// mixes halfway; a malformed table isn't read.
#[test]
fn a_cube_lut_on_a_clip() {
    let mut text = String::from("TITLE \"invert\"\n# a comment\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n");
    for b in 0..2 {
        for g in 0..2 {
            for r in 0..2 {
                text.push_str(&format!("{} {} {}\n", 1 - r, 1 - g, 1 - b));
            }
        }
    }
    let lut = Lut3d::from_cube(&text, 7).unwrap();
    assert_eq!((lut.size, lut.rgb.len(), lut.edge_aligned), (2, 24, true));
    assert_eq!(&lut.rgb[..6], &[1.0, 1.0, 1.0, 0.0, 1.0, 1.0]);
    assert!(Lut3d::from_cube("LUT_3D_SIZE 2\n0 0 0\n", 1).is_none());
    assert!(Lut3d::from_cube("LUT_1D_SIZE 2\n0 0 0\n1 1 1\n", 1).is_none());
    let Some(c) = gpu() else { return };
    let img = image(W, H, |x, _| [(x * 4) as u8, 100, 200, 255]);
    let draw = |s: f32| c.render(W, H, [0, 0, 0], &[Layer { lut: Some((&lut, s)), ..Layer::from_model(&img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0) }]);
    let full = draw(1.0);
    let half = draw(0.5);
    for x in [0, 10, 63] {
        let p = px(&img, x, 0);
        let (f, hf) = (px(&full, x, 0), px(&half, x, 0));
        for k in 0..3 {
            assert!((f[k] as i32 - (255 - p[k] as i32)).abs() <= 1, "{x}: {f:?}");
            assert!((hf[k] as i32 - 128).abs() <= 1, "{x}: {hf:?}");
        }
    }
    assert_eq!(draw(0.0).data, c.render(W, H, [0, 0, 0], &[Layer::from_model(&img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0)]).data);
}
