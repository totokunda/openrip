//! Text layout: wrapping and per-character opacity (uses a macOS system font; skips
//! without it).

use std::sync::Arc;

use openrip_render::text::{layout, Align, Effect, Font, Paint, TextStyle, TexturePaint};
use openrip_render::RgbaImage;

fn font() -> Option<Font> {
    Font::from_file(std::path::Path::new("/System/Library/Fonts/Supplemental/Arial.ttf")).ok()
}

fn style(font: &Font, max_width: Option<f32>) -> TextStyle<'_> {
    TextStyle { font, size: 40.0, color: [255, 255, 255, 255], align: Align::Left, letter_spacing: 0.0, line_spacing: 0.0, stroke: None, background: None, max_width, bold: 0.0, italic: 0.0, effect: None }
}

#[test]
fn lines_wrap_between_words_and_long_words_break() {
    let Some(f) = font() else { return };
    let one = layout("alpha beta gamma", &style(&f, None));
    let two_words = layout("alpha beta", &style(&f, None)).width;
    // Room for "alpha beta" but not the third word: two lines.
    let wrapped = layout("alpha beta gamma", &style(&f, Some(two_words + 5.0)));
    assert!((wrapped.height / one.height - 2.0).abs() < 0.3, "{} vs {}", wrapped.height, one.height);
    assert!(wrapped.width <= two_words + 5.0);
    // A width for one word: three lines.
    let narrow = layout("alpha beta gamma", &style(&f, Some(layout("gamma", &style(&f, None)).width + 1.0)));
    assert!((narrow.height / one.height - 3.0).abs() < 0.5, "{}", narrow.height / one.height);
    // One word wider than the line breaks between characters, every line within the width.
    let long = layout("abcdefghijklmnop", &style(&f, Some(100.0)));
    assert!(long.width <= 100.0 && long.height > one.height * 2.0);
    // No limit: one line.
    assert_eq!(layout("alpha beta gamma", &style(&f, Some(10_000.0))).height, one.height);
}

#[test]
fn hidden_characters_leave_no_ink() {
    let Some(f) = font() else { return };
    let s = style(&f, None);
    let lay = layout("HH", &s);
    let ink = |alpha: &[f32]| {
        let r = lay.rasterize_with_alpha(&s, [0.0, 0.0], Some(alpha));
        let (w, mid) = (r.image.width as usize, r.center[0] as usize);
        let column_ink = |x0: usize, x1: usize| r.image.data.chunks_exact(4).enumerate().filter(|(i, px)| (x0..x1).contains(&(i % w)) && px[3] > 0).count();
        (column_ink(0, mid), column_ink(mid, w))
    };
    let (l, r) = ink(&[1.0, 1.0]);
    assert!(l > 0 && r > 0);
    assert_eq!(ink(&[1.0, 0.0]).1, 0);
    assert_eq!(ink(&[0.0, 1.0]).0, 0);
}

/// Pixel (straight RGBA) of a rendered text image.
fn pixel(img: &RgbaImage, x: usize, y: usize) -> [u8; 4] {
    let i = (y * img.width as usize + x) * 4;
    img.data[i..i + 4].try_into().unwrap()
}

#[test]
fn styled_text_draws_its_stroke_under_its_fill() {
    let Some(f) = font() else { return };
    let effect = Effect { fill: Some(Paint::Solid([1.0, 0.0, 0.0, 1.0])), strokes: vec![(6.0, Paint::Solid([0.0, 0.0, 1.0, 1.0]))], shadows: vec![], edge_fade: 0.0 };
    let s = TextStyle { effect: Some(&effect), ..style(&f, None) };
    let r = layout("I", &s).rasterize(&s, [0.0, 0.0]);
    // Along the row through the middle of the "I": blue, then red inside, then blue again.
    let y = r.center[1] as usize;
    let row: Vec<[u8; 4]> = (0..r.image.width as usize).map(|x| pixel(&r.image, x, y)).collect();
    let first = |c: fn(&[u8; 4]) -> bool| row.iter().position(c).unwrap();
    let (blue, red) = (first(|p| p[2] > 200 && p[3] > 200), first(|p| p[0] > 200 && p[3] > 200));
    assert!(blue < red && red - blue >= 4, "stroke at {blue}, fill at {red}");
    assert!(row[red..].iter().any(|p| p[2] > 200 && p[3] > 200), "stroke on the far side");
}

#[test]
fn texture_strips_go_to_characters_in_turn() {
    let Some(f) = font() else { return };
    // Two strips: red on the left half, green on the right.
    let (w, h) = (8u32, 8u32);
    let data = (0..w * h).flat_map(|i| if i % w < w / 2 { [255, 0, 0, 255] } else { [0, 255, 0, 255] }).collect();
    let image = Arc::new(RgbaImage { width: w, height: h, data });
    let paint = Paint::Texture(TexturePaint { image, columns: 2, radians: 0.0, scale: 0.25, stretch: 0, alpha: 1.0 });
    let effect = Effect { fill: Some(paint), strokes: vec![], shadows: vec![], edge_fade: 0.0 };
    let s = TextStyle { effect: Some(&effect), size: 80.0, ..style(&f, None) };
    let r = layout("II", &s).rasterize(&s, [0.0, 0.0]);
    let y = r.center[1] as usize;
    let inked: Vec<[u8; 4]> = (0..r.image.width as usize).map(|x| pixel(&r.image, x, y)).filter(|p| p[3] > 250).collect();
    // A small piece of each character's own strip: the first "I" red, the second green.
    assert!(inked.first().unwrap()[0] > 200 && inked.last().unwrap()[1] > 200, "{:?} … {:?}", inked.first(), inked.last());
}
