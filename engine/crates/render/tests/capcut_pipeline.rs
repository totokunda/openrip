//! The compositor against values measured from CapCut's own exports
//! (docs/parity/calibration.md, session 2). Skipped when no GPU adapter is available.

use openrip_render::{Compositor, Layer, RgbaImage};

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

fn grey(v: u8) -> [u8; 4] {
    [v, v, v, 255]
}

#[test]
fn one_to_one_is_untouched() {
    let Some(c) = gpu() else { return };
    let src = image(64, 32, |x, y| [(x * 4) as u8, (y * 8) as u8, ((x ^ y) * 9) as u8, 255]);
    let out = c.render(64, 32, [0, 0, 0], &[Layer::from_model(&src, [64, 32], [0.0, 0.0], [1.0, 1.0], 0.0)]);
    assert_eq!(out.data, src.data);
}

#[test]
fn quarter_turn_moves_pixels_exactly() {
    let Some(c) = gpu() else { return };
    let src = image(32, 32, |x, y| grey((x * 7 + y * 3) as u8));
    let out = c.render(32, 32, [0, 0, 0], &[Layer::from_model(&src, [32, 32], [0.0, 0.0], [1.0, 1.0], 90.0)]);
    // Clockwise: source (x, y) lands at (31 - y, x).
    for y in 0..32 {
        for x in 0..32 {
            assert_eq!(px(&out, 31 - y, x), px(&src, x, y), "({x}, {y})");
        }
    }
}

#[test]
fn halving_sharpens_like_capcut() {
    let Some(c) = gpu() else { return };
    // White 1-px vertical lines every 4 px. CapCut at 50%: 165-168 on the line, 0 between
    // (a plain average would give 127.5): area average then the 0.15 sharpen.
    let src = image(64, 64, |x, _| grey(if x % 4 == 0 { 255 } else { 0 }));
    let out = c.render(64, 64, [0, 0, 0], &[Layer::from_model(&src, [64, 64], [0.0, 0.0], [0.5, 0.5], 0.0)]);
    for x in 20..44 {
        let v = px(&out, x, 32)[0] as i32;
        let want = if (x - 16) % 2 == 0 { 166 } else { 0 };
        assert!((v - want).abs() <= 2, "x={x}: {v}, want {want}");
    }
}

#[test]
fn doubling_is_bilinear_like_capcut() {
    let Some(c) = gpu() else { return };
    // 1-px checkerboard enlarged 2x. CapCut's 4K export of a 1080p canvas: 95 / 160.
    let src = image(32, 32, |x, y| grey(if (x + y) % 2 == 0 { 255 } else { 0 }));
    let out = c.render(64, 64, [0, 0, 0], &[Layer::from_model(&src, [64, 64], [0.0, 0.0], [1.0, 1.0], 0.0)]);
    let mut seen = [0usize; 2];
    for y in 8..56 {
        for x in 8..56 {
            let v = px(&out, x, y)[0] as i32;
            if (v - 160).abs() <= 2 {
                seen[1] += 1;
            } else if (v - 95).abs() <= 2 {
                seen[0] += 1;
            } else {
                panic!("({x}, {y}): {v}");
            }
        }
    }
    assert_eq!(seen[0], seen[1]);
}

#[test]
fn opacity_blends_premultiplied_over() {
    let Some(c) = gpu() else { return };
    let src = image(16, 16, |_, _| [255, 255, 255, 255]);
    let mut layer = Layer::from_model(&src, [16, 16], [0.0, 0.0], [1.0, 1.0], 0.0);
    layer.opacity = 0.5;
    let out = c.render(16, 16, [0, 0, 255], &[layer]);
    let [r, g, b, _] = px(&out, 8, 8);
    assert!((r as i32 - 128).abs() <= 1 && (g as i32 - 128).abs() <= 1 && (b as i32 - 255).abs() <= 1, "{r} {g} {b}");
}

#[cfg(target_os = "macos")]
#[test]
fn renders_into_an_iosurface_like_into_memory() {
    use objc2_core_video::*;
    let Some(c) = gpu() else { return };
    let src = image(64, 48, |x, y| [(x * 4) as u8, (y * 5) as u8, 200, 255]);
    let layers = [Layer::from_model(&src, [96, 64], [0.1, -0.2], [0.8, 0.8], 15.0)];
    let mem = c.render(96, 64, [10, 20, 30], &layers);
    let surface = Compositor::output_surface(96, 64).unwrap();
    c.render_to_surface(&surface, [10, 20, 30], &layers).unwrap();
    unsafe {
        assert_eq!(CVPixelBufferLockBaseAddress(&surface, CVPixelBufferLockFlags::ReadOnly), 0);
        let base = CVPixelBufferGetBaseAddress(&surface) as *const u8;
        let stride = CVPixelBufferGetBytesPerRow(&surface);
        for y in 0..64usize {
            for x in 0..96usize {
                let bgra = std::slice::from_raw_parts(base.add(y * stride + x * 4), 4);
                let rgba = &mem.data[(y * 96 + x) * 4..][..4];
                assert_eq!([bgra[2], bgra[1], bgra[0], bgra[3]], rgba, "({x}, {y})");
            }
        }
        CVPixelBufferUnlockBaseAddress(&surface, CVPixelBufferLockFlags::ReadOnly);
    }
}
