//! Groups and the transition pass: clips drawn each into a group of their own, then put
//! together by a mix. Skipped when no GPU adapter is available.

use openrip_render::{Compositor, Layer, Mix, MixMask, RgbaImage, Shot, Source};

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

/// Where it was drawn, at full opacity.
const STILL: Shot = Shot { inverse: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], alpha: 1.0, zoom_blur: 0.0, mirror: false };

/// `a` and `b` (each a full-canvas image) in groups over black, the ones the mix draws, put
/// together by `mix`.
fn mixed(c: &Compositor, a: &RgbaImage, b: &RgbaImage, mix: Mix) -> RgbaImage {
    let (w, h) = (a.width, a.height);
    let mut layers = Vec::new();
    for (img, drawn) in [(a, mix.outgoing.is_some()), (b, mix.incoming.is_some())] {
        if drawn {
            layers.push(Layer::pass(Source::BeginGroup(Some([0, 0, 0]))));
            layers.push(Layer::from_model(img, [w, h], [0.0, 0.0], [1.0, 1.0], 0.0));
            layers.push(Layer::pass(Source::EndGroup));
        }
    }
    layers.push(Layer::pass(Source::Mix(mix)));
    c.render(w, h, [0, 0, 0], &layers)
}

#[test]
fn a_group_put_back_where_it_was_is_untouched() {
    let Some(c) = gpu() else { return };
    let src = image(64, 32, |x, y| [(x * 4) as u8, (y * 8) as u8, ((x ^ y) * 9) as u8, 255]);
    let layers = [
        Layer::pass(Source::BeginGroup(Some([0, 0, 0]))),
        Layer::from_model(&src, [64, 32], [0.0, 0.0], [1.0, 1.0], 0.0),
        Layer::pass(Source::EndGroup),
        Layer::pass(Source::Mix(Mix { outgoing: Some(STILL), incoming: None, mask: MixMask::All, fx: None })),
    ];
    assert_eq!(c.render(64, 32, [0, 0, 0], &layers).data, src.data);
}

#[test]
fn a_mix_cross_fades() {
    let Some(c) = gpu() else { return };
    let (a, b) = (image(16, 16, |_, _| [200, 100, 0, 255]), image(16, 16, |_, _| [0, 100, 200, 255]));
    let out = mixed(&c, &a, &b, Mix { outgoing: Some(STILL), incoming: Some(Shot { alpha: 0.25, ..STILL }), mask: MixMask::All, fx: None });
    let p = px(&out, 8, 8);
    for (v, want) in p.iter().zip([150, 100, 50, 255]) {
        assert!((*v as i32 - want).abs() <= 1, "{p:?}");
    }
}

#[test]
fn moved_groups_leave_what_is_below() {
    let Some(c) = gpu() else { return };
    let (a, b) = (image(32, 8, |_, _| [255, 0, 0, 255]), image(32, 8, |_, _| [0, 0, 255, 255]));
    // A push halfway to the left: the outgoing clip's right half on the left, the incoming
    // clip's left half on the right.
    let shifted = |dx: f32| Shot { inverse: [[1.0, 0.0, -dx], [0.0, 1.0, 0.0]], ..STILL };
    let out = mixed(&c, &a, &b, Mix { outgoing: Some(shifted(-16.0)), incoming: Some(shifted(16.0)), mask: MixMask::All, fx: None });
    assert_eq!(px(&out, 4, 4), [255, 0, 0, 255]);
    assert_eq!(px(&out, 28, 4), [0, 0, 255, 255]);
    // Moved further, nothing covers the right edge: the black below shows.
    let out = mixed(&c, &a, &b, Mix { outgoing: Some(shifted(-24.0)), incoming: None, mask: MixMask::All, fx: None });
    assert_eq!(px(&out, 4, 4), [255, 0, 0, 255]);
    assert_eq!(px(&out, 28, 4), [0, 0, 0, 255]);
}

#[test]
fn masks_show_the_incoming_clip_past_an_edge_or_in_a_circle() {
    let Some(c) = gpu() else { return };
    let (a, b) = (image(64, 64, |_, _| [255, 0, 0, 255]), image(64, 64, |_, _| [0, 0, 255, 255]));
    // The incoming clip right of the middle.
    let out = mixed(&c, &a, &b, Mix { outgoing: Some(STILL), incoming: Some(STILL), mask: MixMask::Edge { toward: [1.0, 0.0], at: 0.0, feather: 0.01 }, fx: None });
    assert_eq!((px(&out, 10, 32), px(&out, 54, 32)), ([255, 0, 0, 255], [0, 0, 255, 255]));
    // Inside a circle a quarter of the height across.
    let out = mixed(&c, &a, &b, Mix { outgoing: Some(STILL), incoming: Some(STILL), mask: MixMask::Circle { radius: 0.25, feather: 0.01 }, fx: None });
    assert_eq!((px(&out, 32, 32), px(&out, 2, 2), px(&out, 32, 4)), ([0, 0, 255, 255], [255, 0, 0, 255], [255, 0, 0, 255]));
}

#[test]
fn mirrored_groups_repeat_their_edges() {
    let Some(c) = gpu() else { return };
    let src = image(32, 32, |x, _| if x < 8 { [255, 255, 255, 255] } else { [0, 0, 0, 255] });
    let layers = |mirror: bool| {
        // Shrunk to half about the middle: u = 2x − 16.
        let shot = Shot { inverse: [[2.0, 0.0, -16.0], [0.0, 2.0, -16.0]], mirror, ..STILL };
        [
            Layer::pass(Source::BeginGroup(Some([0, 0, 0]))),
            Layer::from_model(&src, [32, 32], [0.0, 0.0], [1.0, 1.0], 0.0),
            Layer::pass(Source::EndGroup),
            Layer::pass(Source::Mix(Mix { outgoing: Some(shot), incoming: None, mask: MixMask::All, fx: None })),
        ]
    };
    // Left of the shrunk picture: its white left edge mirrored there, or nothing (black).
    assert_eq!(px(&c.render(32, 32, [0, 0, 0], &layers(true)), 6, 16), [255, 255, 255, 255]);
    assert_eq!(px(&c.render(32, 32, [0, 0, 0], &layers(false)), 6, 16), [0, 0, 0, 255]);
}

/// CapCut's Pull in (`VerticalZoomNear.frag`) worked by hand on the CPU: the picture sampled at
/// 0.5 + (uv − 0.5)·k, 21 taps towards the centre `10/720 · i · (uv − 0.5) · 2 · blur` apart,
/// mirrored at the edges, each tap bilinear with the texture clamped to its edge.
fn zoom_near(src: &RgbaImage, k: f32, blur: f32) -> RgbaImage {
    let (w, h) = (src.width as f32, src.height as f32);
    let texel = |x: i32, y: i32| px(src, x.clamp(0, src.width as i32 - 1) as u32, y.clamp(0, src.height as i32 - 1) as u32).map(|v| v as f32);
    let mix = |a: [f32; 4], b: [f32; 4], t: f32| [0, 1, 2, 3].map(|i| a[i] + (b[i] - a[i]) * t);
    let bilinear = |u: f32, v: f32| {
        let (x, y) = (u * w - 0.5, v * h - 0.5);
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let (x0, y0) = (x0 as i32, y0 as i32);
        mix(mix(texel(x0, y0), texel(x0 + 1, y0), fx), mix(texel(x0, y0 + 1), texel(x0 + 1, y0 + 1), fx), fy)
    };
    let mirror = |c: f32| {
        let c = c.abs();
        if c > 1.0 {
            2.0 - c
        } else {
            c
        }
    };
    image(src.width, src.height, |x, y| {
        let uv = [(x as f32 + 0.5) / w, (y as f32 + 0.5) / h];
        let at = [0.5 + (uv[0] - 0.5) * k, 0.5 + (uv[1] - 0.5) * k];
        let mut sum = [0.0f32; 4];
        for i in -10..=10 {
            let q = [0, 1].map(|c| mirror(at[c] + 10.0 / 720.0 * i as f32 * (at[c] - 0.5) * 2.0 * blur));
            let s = bilinear(q[0], q[1]);
            (0..4).for_each(|c| sum[c] += s[c]);
        }
        sum.map(|v| (v / 21.0).round() as u8)
    })
}

#[test]
fn pull_in_samples_as_capcuts_shader_does() {
    let Some(c) = gpu() else { return };
    let src = image(96, 54, |x, y| [(x * 255 / 95) as u8, (y * 255 / 53) as u8, (((x / 8) ^ (y / 8)) & 1) as u8 * 200, 255]);
    // The incoming clip just after the cut (k = 2 − T for T a little over 0.5: two thirds of
    // its size, mirrored around, blurred towards the centre), the outgoing one zoomed in, and
    // neither.
    for (k, blur) in [(1.45f32, 0.45f32), (0.7, 0.3), (1.0, 0.0)] {
        let (cx, cy) = (48.0, 27.0);
        let shot = Shot { inverse: [[k, 0.0, cx - k * cx], [0.0, k, cy - k * cy]], alpha: 1.0, zoom_blur: blur, mirror: true };
        let layers = [
            Layer::pass(Source::BeginGroup(Some([0, 0, 0]))),
            Layer::from_model(&src, [96, 54], [0.0, 0.0], [1.0, 1.0], 0.0),
            Layer::pass(Source::EndGroup),
            Layer::pass(Source::Mix(Mix { outgoing: Some(shot), incoming: None, mask: MixMask::All, fx: None })),
        ];
        let out = c.render(96, 54, [0, 0, 0], &layers);
        let want = zoom_near(&src, k, blur);
        let worst = out.data.iter().zip(&want.data).map(|(a, b)| (*a as i32 - *b as i32).abs()).max().unwrap();
        assert!(worst <= 2, "k {k}, blur {blur}: off by {worst}");
    }
}
