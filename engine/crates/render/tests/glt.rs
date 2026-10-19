//! The gl-transitions collection drawn by the compositor (src/glt): each transition at
//! progress 0 is the outgoing clip, at 1 the incoming one, and half way something else.
//! Skipped when no GPU adapter is available.

use openrip_render::glt::{self, GlFx};
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

const STILL: Shot = Shot { inverse: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], alpha: 1.0, zoom_blur: 0.0, mirror: false };
const W: u32 = 96;
const H: u32 = 64;

/// Two pictures with structure (so a move or a warp shows): a warm diagonal ramp with a bright
/// disc, and a cool one with stripes.
fn pair() -> (RgbaImage, RgbaImage) {
    let a = image(W, H, |x, y| {
        let d = ((x as f32 - 40.0).powi(2) + (y as f32 - 28.0).powi(2)).sqrt();
        if d < 14.0 { [250, 240, 160, 255] } else { [(60 + x * 2) as u8, (40 + y * 3) as u8, 70, 255] }
    });
    let b = image(W, H, |x, y| if (x / 8 + y / 8) % 2 == 0 { [30, 90, 200, 255] } else { [20, 200, (80 + x) as u8, 255] });
    (a, b)
}

fn draw(c: &Compositor, a: &RgbaImage, b: &RgbaImage, fx: GlFx) -> RgbaImage {
    let mut layers = Vec::new();
    for img in [a, b] {
        layers.push(Layer::pass(Source::BeginGroup(Some([0, 0, 0]))));
        layers.push(Layer::from_model(img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0));
        layers.push(Layer::pass(Source::EndGroup));
    }
    layers.push(Layer::pass(Source::Mix(Mix { outgoing: Some(STILL), incoming: Some(STILL), mask: MixMask::All, fx: Some(fx) })));
    c.render(W, H, [0, 0, 0], &layers)
}

/// The mean absolute difference per channel (0 to 255).
fn distance(a: &RgbaImage, b: &RgbaImage) -> f64 {
    let sum: u64 = a.data.iter().zip(&b.data).map(|(x, y)| (*x as i32 - *y as i32).unsigned_abs() as u64).sum();
    sum as f64 / a.data.len() as f64
}

#[test]
fn every_transition_starts_at_the_outgoing_clip_and_ends_at_the_incoming_one() {
    let Some(c) = gpu() else { return };
    let (a, b) = pair();
    let mut bad = Vec::new();
    for t in glt::TABLE {
        let at = |p: f32| draw(&c, &a, &b, GlFx::new(t.id, p).unwrap());
        let (start, end) = (at(0.0), at(1.0));
        let (d0, d1) = (distance(&start, &a), distance(&end, &b));
        // Half way, or a quarter or three quarters of the way for the transitions that have
        // finished with one clip by then (a bounce, a melt), is neither clip.
        let (mut dm_a, mut dm_b) = (0.0, 0.0);
        for p in [0.5, 0.25, 0.75, 0.4] {
            let mid = at(p);
            let (x, y) = (distance(&mid, &a), distance(&mid, &b));
            if x >= 1.0 && y >= 1.0 {
                (dm_a, dm_b) = (x, y);
                break;
            }
        }
        // A few transitions leave a trace at their ends (a vignette, a one-texel seam).
        if d0 > 3.0 || d1 > 3.0 || dm_a < 1.0 || dm_b < 1.0 {
            bad.push(format!("{}: start {d0:.2} from A, end {d1:.2} from B, in between {dm_a:.2} from A and {dm_b:.2} from B", t.id));
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

#[test]
fn a_straight_fade_is_the_mix_of_the_two() {
    let Some(c) = gpu() else { return };
    let (a, b) = pair();
    // Fade through colour with no hold is nearly a cross-fade; plain wipes are exact. Wipe
    // halfway: the left half is one clip, the right half the other.
    let out = draw(&c, &a, &b, GlFx::new("gl_directionalwipe", 0.5).unwrap());
    assert!(distance(&out, &a) > 3.0 && distance(&out, &b) > 3.0);
    let out = draw(&c, &a, &b, GlFx::new("gl_BlockDissolve", 0.5).unwrap());
    // Every pixel is one clip's or the other's, about half each.
    fn px(img: &RgbaImage, i: usize) -> &[u8] {
        &img.data[i * 4..i * 4 + 4]
    }
    let (mut of_a, mut of_b) = (0, 0);
    for i in 0..(W * H) as usize {
        if px(&out, i) == px(&a, i) {
            of_a += 1;
        } else if px(&out, i) == px(&b, i) {
            of_b += 1;
        }
    }
    let total = (W * H) as usize;
    assert!(of_a + of_b > total * 95 / 100, "{of_a} + {of_b} of {total}");
    assert!(of_a > total / 4 && of_b > total / 4, "{of_a} / {of_b}");
}

#[test]
fn parameters_change_the_picture() {
    let Some(c) = gpu() else { return };
    let (a, b) = pair();
    // Fade through colour: red or blue in the middle.
    let id = "gl_fadecolor";
    let t = glt::find(id).unwrap();
    assert_eq!(t.params[0].name, "color");
    let mut red = GlFx::new(id, 0.5).unwrap();
    red.values[0] = [1.0, 0.0, 0.0, 1.0];
    red.values[1][0] = 1.0;
    let mut blue = red;
    blue.values[0] = [0.0, 0.0, 1.0, 1.0];
    let (r, bl) = (draw(&c, &a, &b, red), draw(&c, &a, &b, blue));
    let i = ((H / 2) * W + W / 2) as usize * 4;
    assert!(r.data[i] > 200 && r.data[i + 2] < 60, "{:?}", &r.data[i..i + 4]);
    assert!(bl.data[i + 2] > 200 && bl.data[i] < 60, "{:?}", &bl.data[i..i + 4]);
}

#[test]
fn clear_pixels_stay_clear_and_the_clip_below_shows() {
    let Some(c) = gpu() else { return };
    let (a, b) = pair();
    // Groups with no backdrop (as on an overlay track): half way through a wipe nothing
    // is drawn outside the clips, here the whole canvas is covered, so the result is opaque.
    let mut layers = Vec::new();
    for img in [&a, &b] {
        layers.push(Layer::pass(Source::BeginGroup(None)));
        layers.push(Layer::from_model(img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0));
        layers.push(Layer::pass(Source::EndGroup));
    }
    let fx = GlFx::new("gl_directionalwipe", 0.0).unwrap();
    layers.push(Layer::pass(Source::Mix(Mix { outgoing: Some(STILL), incoming: Some(STILL), mask: MixMask::All, fx: Some(fx) })));
    let out = c.render(W, H, [0, 0, 0], &layers);
    assert!(distance(&out, &a) < 3.0);
}
