//! The compositor against values measured from CapCut's own exports
//! (docs/parity/calibration.md, session 2). Skipped when no GPU adapter is available.

use openrip_render::{Compositor, Layer, RgbaImage, Source};

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

/// Images are premultiplied on the GPU, rounded exactly as the CPU did, (c·a + 127) / 255:
/// every colour at every alpha, drawn 1:1 over black, comes out premultiplied.
#[test]
fn uploads_premultiply_like_the_cpu() {
    let Some(c) = gpu() else { return };
    let src = image(256, 256, |x, y| [x as u8, 255 - x as u8, (x * 7 % 256) as u8, y as u8]);
    let out = c.render(256, 256, [0, 0, 0], &[Layer::from_model(&src, [256, 256], [0.0, 0.0], [1.0, 1.0], 0.0)]);
    for y in 0..256 {
        for x in 0..256 {
            let s = px(&src, x, y);
            let want = [0, 1, 2].map(|i| ((s[i] as u32 * s[3] as u32 + 127) / 255) as u8);
            assert_eq!(px(&out, x, y)[..3], want, "colour {:?} at alpha {}", &s[..3], s[3]);
        }
    }
}

/// A still another thread wrote to the GPU ahead of time, or one drawn before at another
/// size, draws exactly as one written by the frame that draws it, shrunk, enlarged or 1:1.
#[test]
fn stills_written_ahead_draw_the_same() {
    let Some(c) = gpu() else { return };
    let src = image(96, 64, |x, y| [(x * 5) as u8, (y * 9) as u8, ((x ^ y) * 3) as u8, ((x * y) % 256) as u8]);
    let uploader = c.uploader();
    let sizes = [(41, 27), (96, 64), (150, 100)];
    let draw = |key: u64, (w, h): (u32, u32)| c.render(w, h, [30, 60, 90], &[Layer::from_model(Source::Cached(key, &src), [w, h], [0.0, 0.0], [1.0, 1.0], 0.0)]);
    for (i, size) in sizes.into_iter().enumerate() {
        let here = draw(10 + i as u64, size);
        std::thread::scope(|s| s.spawn(|| uploader.upload(20 + i as u64, &src)).join()).unwrap();
        assert_eq!(draw(20 + i as u64, size).data, here.data, "{size:?}");
    }
    // One drawn the frame before at another size, resampled from what's kept on the GPU (a
    // scale being dragged).
    let heres: Vec<_> = sizes.iter().enumerate().map(|(i, size)| draw(40 + i as u64, *size)).collect();
    for (size, here) in sizes.into_iter().zip(&heres) {
        assert_eq!(draw(30, size).data, here.data, "{size:?} after another size");
    }
}

#[test]
fn sideways_sources_are_shown_upright() {
    let Some(c) = gpu() else { return };
    // Stored 64x32, meant to be turned 90 degrees clockwise (a phone's portrait video).
    let src = image(64, 32, |x, y| grey((x * 3 + y * 5) as u8));
    let layer = Layer::from_model_oriented(&src, [32, 64], [0.0, 0.0], [1.0, 1.0], 0.0, 90);
    let out = c.render(32, 64, [0, 0, 0], &[layer]);
    for y in 0..32 {
        for x in 0..64 {
            assert_eq!(px(&out, 31 - y, x), px(&src, x, y), "({x}, {y})");
        }
    }
}

/// Layers zoomed past the GPU's texture limit, and images larger than it, still draw
/// (they used to panic in wgpu).
#[test]
fn oversize_layers_and_images_draw() {
    let Ok(c) = Compositor::new() else { return };
    let img = RgbaImage { width: 9000, height: 2000, data: vec![200; 9000 * 2000 * 4] };
    let out = c.render(64, 64, [0, 0, 0], &[Layer::from_model(Source::Image(&img), [64, 64], [0.0, 0.0], [1.0, 1.0], 0.0)]);
    assert!(out.data.chunks_exact(4).any(|p| p[0] > 100));
    let small = RgbaImage { width: 16, height: 16, data: vec![255; 16 * 16 * 4] };
    let out = c.render(64, 64, [0, 0, 0], &[Layer::from_model(Source::Image(&small), [64, 64], [0.0, 0.0], [600.0, 600.0], 0.0)]);
    assert!(out.data.chunks_exact(4).all(|p| p[0] == 255));
}

/// CapCut's Adjust sliders: saturation -1 leaves CapCut's luma weights; brightness +0.5
/// follows y = 1 - (1 - x)^p, p = 1 + 5 * 0.3 * 0.5 (sliders up to 0.7 are scaled by 0.3).
#[test]
fn adjust_sliders_follow_capcuts_formulas() {
    let Ok(c) = Compositor::new() else { return };
    let img = RgbaImage { width: 4, height: 4, data: [200u8, 100, 50, 255].repeat(16) };
    let draw = |a: openrip_render::Adjust| {
        let mut l = Layer::from_model(Source::Image(&img), [4, 4], [0.0, 0.0], [1.0, 1.0], 0.0);
        l.adjust = Some((a, None));
        c.render(4, 4, [0, 0, 0], &[l]).data[..3].to_vec()
    };
    let grey = draw(openrip_render::Adjust { saturation: -1.0, ..Default::default() });
    let luma = (0.208540 * 200.0 + 0.702086 * 100.0 + 0.089374 * 50.0f64).round() as i32;
    for v in grey {
        assert!((v as i32 - luma).abs() <= 1, "{v} vs {luma}");
    }
    let bright = draw(openrip_render::Adjust { brightness: 0.5, ..Default::default() });
    let p = 1.0 + 5.0 * 0.3 * 0.5;
    for (v, x) in bright.iter().zip([200.0, 100.0, 50.0f64]) {
        let want = (255.0 * (1.0 - (1.0 - x / 255.0).powf(p))).round() as i32;
        assert!((*v as i32 - want).abs() <= 1, "{v} vs {want}");
    }
}

/// CapCut's primary wheels: gain g and offset o on every channel and luma make
/// y = x * (1 + 4 g^2) + o (lift 0, gamma 1, saturation untouched).
#[test]
fn colour_wheel_gain_and_offset() {
    let Ok(c) = Compositor::new() else { return };
    let img = RgbaImage { width: 4, height: 4, data: [120u8, 60, 30, 255].repeat(16) };
    let all = |v: f32| openrip_render::Wheel { red: v, green: v, blue: v, luma: v, saturation: 0.0 };
    let wheels = openrip_render::Wheels { gain: all(0.156), offset: all(0.0196), intensity: 1.0, ..Default::default() };
    let mut l = Layer::from_model(Source::Image(&img), [4, 4], [0.0, 0.0], [1.0, 1.0], 0.0);
    l.adjust = Some((openrip_render::Adjust { wheels, ..Default::default() }, None));
    let out = c.render(4, 4, [0, 0, 0], &[l]);
    let k = 1.0 + 4.0 * 0.156f64 * 0.156;
    for (v, x) in out.data[..3].iter().zip([120.0, 60.0, 30.0f64]) {
        let want = ((x / 255.0 * k + 0.0196) * 255.0).round() as i32;
        assert!((*v as i32 - want).abs() <= 1, "{v} vs {want}");
    }
}

/// CapCut's Sharpen: at an edge from 100 to 200, slider 1 moves each side by
/// 0.8 x (2y - left - right): -100 and +100 code values, clamped.
#[test]
fn sharpen_steepens_edges_like_capcut() {
    let Ok(c) = Compositor::new() else { return };
    let mut data = Vec::new();
    for _ in 0..8 {
        for x in 0..8 {
            data.extend(if x < 4 { [100u8, 100, 100, 255] } else { [200, 200, 200, 255] });
        }
    }
    let img = RgbaImage { width: 8, height: 8, data };
    let mut l = Layer::from_model(Source::Image(&img), [8, 8], [0.0, 0.0], [1.0, 1.0], 0.0);
    l.adjust = Some((openrip_render::Adjust { sharpen: 1.0, ..Default::default() }, None));
    let out = c.render(8, 8, [0, 0, 0], &[l]);
    let at = |x: usize| out.data[(4 * 8 + x) * 4] as i32;
    assert!((at(3) - 20).abs() <= 1, "{}", at(3));
    assert_eq!(at(4), 255);
    assert_eq!((at(1), at(6)), (100, 200));
}

/// A filter layer looks the canvas so far up in a 3D table and mixes it in: a table that
/// maps everything to 0.2, at strength 0.5, takes 0.6 to 0.4. Layers above are untouched.
#[test]
fn filter_layers_apply_to_what_is_below() {
    let Ok(c) = Compositor::new() else { return };
    let n = 4u32;
    let mut vf = b"VF_V".to_vec();
    for _ in 0..3 {
        vf.extend((n as u16).to_le_bytes());
    }
    for _ in 0..n * n * n * 3 {
        vf.extend(0.2f32.to_le_bytes());
    }
    let lut = openrip_render::Lut3d::from_vf(&vf, 7).unwrap();
    assert_eq!(lut.size, 4);
    assert!(openrip_render::Lut3d::from_vf(b"nope", 7).is_none());
    let grey = RgbaImage { width: 4, height: 4, data: [153u8, 153, 153, 255].repeat(16) };
    let dot = RgbaImage { width: 2, height: 2, data: [255u8, 0, 0, 255].repeat(4) };
    let below = Layer::from_model(Source::Image(&grey), [4, 4], [0.0, 0.0], [1.0, 1.0], 0.0);
    let filter = Layer { source: Source::Filter(&lut, 0.5), ..below.clone() };
    let above = Layer::from_model(Source::Image(&dot), [4, 4], [0.0, 0.0], [0.5, 0.5], 0.0);
    let out = c.render(4, 4, [0, 0, 0], &[below, filter, above]);
    assert!((out.data[0] as i32 - 102).abs() <= 1, "{}", out.data[0]);
    let centre = |i: usize| ((2 * 4 + 2) * 4) + i;
    assert_eq!((out.data[centre(0)], out.data[centre(1)]), (255, 0));
}

/// CapCut's HSL: the red range's lightness at −100 (scaled by 1/2.7 in CapCut's shader)
/// takes pure red's lightness from 0.5 to 0.5 − 0.5 × 0.37: (161, 0, 0). Other hues stay.
#[test]
fn hsl_moves_only_the_colours_in_range() {
    let Ok(c) = Compositor::new() else { return };
    let img = RgbaImage { width: 4, height: 4, data: [[255u8, 0, 0, 255], [0, 0, 255, 255]].concat().repeat(8) };
    let mut hsl = openrip_render::Hsl::default();
    hsl.ranges[0] = [0.0, 0.0, -100.0];
    let mut l = Layer::from_model(Source::Image(&img), [4, 4], [0.0, 0.0], [1.0, 1.0], 0.0);
    l.adjust = Some((openrip_render::Adjust { hsl, ..Default::default() }, None));
    let out = c.render(4, 4, [0, 0, 0], &[l]);
    assert!((out.data[0] as i32 - 161).abs() <= 1 && out.data[1] == 0 && out.data[2] == 0, "{:?}", &out.data[..4]);
    assert_eq!(&out.data[4..8], &[0, 0, 255, 255]);
}

/// CapCut's vignette at 1 leaves the middle of the clip's picture and blackens its corners
/// (beyond 0.85 × 1.415 half-sizes from the middle).
#[test]
fn vignette_darkens_the_corners_of_the_clip() {
    let Ok(c) = Compositor::new() else { return };
    let img = RgbaImage { width: 64, height: 64, data: [128u8, 128, 128, 255].repeat(64 * 64) };
    let mut l = Layer::from_model(Source::Image(&img), [64, 64], [0.0, 0.0], [1.0, 1.0], 0.0);
    l.adjust = Some((openrip_render::Adjust { vignette: 1.0, ..Default::default() }, None));
    let out = c.render(64, 64, [0, 0, 0], &[l]);
    assert_eq!(px(&out, 32, 32), [128, 128, 128, 255]);
    assert_eq!(px(&out, 0, 0), [0, 0, 0, 255]);
    let edge = px(&out, 0, 32)[0];
    assert!(edge > 0 && edge < 128, "{edge}");
}

/// CapCut's Clarity at 1 on a flat colour: no detail to strengthen, so the value stays, and the
/// saturation goes up by 1.12: (200, 100, 50) becomes (200, 88, 32). On an edge, the bright
/// side gets brighter.
#[test]
fn clarity_raises_saturation_and_local_contrast() {
    let Ok(c) = Compositor::new() else { return };
    let flat = RgbaImage { width: 32, height: 32, data: [200u8, 100, 50, 255].repeat(32 * 32) };
    let draw = |img: &RgbaImage| {
        let mut l = Layer::from_model(Source::Image(img), [img.width, img.height], [0.0, 0.0], [1.0, 1.0], 0.0);
        l.adjust = Some((openrip_render::Adjust { clarity: 1.0, ..Default::default() }, None));
        c.render(img.width, img.height, [0, 0, 0], &[l])
    };
    let out = draw(&flat);
    for (v, want) in px(&out, 16, 16).iter().zip([200, 88, 32]) {
        assert!((*v as i32 - want).abs() <= 1, "{:?}", px(&out, 16, 16));
    }
    let edge = image(64, 64, |x, _| grey(if x < 32 { 80 } else { 160 }));
    let out = draw(&edge);
    assert!(px(&out, 33, 32)[0] > 162 && px(&out, 30, 32)[0] < 78, "{:?} {:?}", px(&out, 33, 32), px(&out, 30, 32));
    // The coarsest levels span the whole small picture, so its far sides move apart too.
    assert!(px(&out, 63, 32)[0] >= 160 && px(&out, 0, 32)[0] <= 80);
}

/// CapCut's Fade mixes the colour towards its fade table by the slider: a table of 0.5 grey at
/// 0.5 takes 0.2 to 0.35. Without the table, fade is left out.
#[test]
fn fade_mixes_towards_its_table() {
    let Ok(c) = Compositor::new() else { return };
    let table = std::sync::Arc::new(RgbaImage { width: 289, height: 17, data: [128u8, 128, 128, 255].repeat(289 * 17) });
    let luts = openrip_render::ExposureLuts { key: 42, darker: table.clone(), brighter: table.clone(), fade: Some(table) };
    let img = RgbaImage { width: 4, height: 4, data: [51u8, 51, 51, 255].repeat(16) };
    let mut l = Layer::from_model(Source::Image(&img), [4, 4], [0.0, 0.0], [1.0, 1.0], 0.0);
    l.adjust = Some((openrip_render::Adjust { fade: 0.5, ..Default::default() }, Some(&luts)));
    let out = c.render(4, 4, [0, 0, 0], &[l.clone()]);
    assert!((out.data[0] as i32 - 90).abs() <= 1, "{}", out.data[0]);
    l.adjust = Some((openrip_render::Adjust { fade: 0.5, ..Default::default() }, None));
    assert_eq!(c.render(4, 4, [0, 0, 0], &[l]).data[0], 51);
}

/// CapCut's curves: a flat luma curve at 0.5 lifts a 0.2 grey to 0.5 on every channel. A red
/// curve doubling red raises red, and the luma step then takes back from every channel what
/// that added to luma: (0.4, 0.2, 0.2) − 0.0428 = (91, 40, 40).
#[test]
fn curves_follow_capcuts_luma_and_channel_rules() {
    let Ok(c) = Compositor::new() else { return };
    let img = RgbaImage { width: 4, height: 4, data: [51u8, 51, 51, 255].repeat(16) };
    let point = |x: f32, y: f32, left: [f32; 2], right: [f32; 2]| openrip_render::CurvePoint { anchor: [x, y], left, right };
    let draw = |curves: openrip_render::Curves| {
        let mut l = Layer::from_model(Source::Image(&img), [4, 4], [0.0, 0.0], [1.0, 1.0], 0.0);
        l.adjust = Some((openrip_render::Adjust { curves: Some(std::sync::Arc::new(curves)), ..Default::default() }, None));
        c.render(4, 4, [0, 0, 0], &[l]).data[..3].to_vec()
    };
    let flat = vec![point(0.0, 0.5, [0.0, 0.5], [0.33, 0.5]), point(1.0, 0.5, [0.67, 0.5], [1.0, 0.5])];
    for v in draw(openrip_render::Curves { luma: flat, ..Default::default() }) {
        assert!((v as i32 - 128).abs() <= 1, "{v}");
    }
    let double = vec![point(0.0, 0.0, [0.0, 0.0], [0.25, 0.5]), point(0.5, 1.0, [0.25, 0.5], [0.75, 1.0])];
    let out = draw(openrip_render::Curves { red: double, ..Default::default() });
    assert!((out[0] as i32 - 91).abs() <= 1 && (out[1] as i32 - 40).abs() <= 1 && out[1] == out[2], "{out:?}");
}
