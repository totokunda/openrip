//! Text layout: wrapping and per-character opacity (uses a macOS system font; skips
//! without it).

use std::sync::Arc;

use openrip_render::text::{layout, Align, Effect, Font, Paint, TextStyle, TexturePaint};
use openrip_render::RgbaImage;

fn font() -> Option<Font> {
    Font::from_file(std::path::Path::new("/System/Library/Fonts/Supplemental/Arial.ttf")).ok()
}

fn style(font: &Font, max_width: Option<f32>) -> TextStyle<'_> {
    TextStyle { font, size: 40.0, color: [255, 255, 255, 255], align: Align::Left, letter_spacing: 0.0, line_spacing: 0.0, line_height: None, kerning: false, stroke: None, background: None, shadow: None, max_width, bold: 0.0, italic: 0.0, effect: None, curve: 0.0, char_colors: None }
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
    // With room for it, the first line keeps the space it broke at, in its width.
    let with_space = layout("alpha beta ", &style(&f, None)).width;
    let roomy = layout("alpha beta gamma", &style(&f, Some(with_space + 1.0)));
    assert!((roomy.width - with_space).abs() < 0.01 && roomy.height > one.height * 1.5, "{}", roomy.width);
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
fn a_continuation_line_counts_the_space_it_broke_at() {
    let Some(f) = font() else { return };
    // Room for two words. The second line, measured with the space it broke at in front,
    // then has no room for two (CapCut's breaking, calibration session 5).
    let max = layout("xxx xxx", &style(&f, None)).width + 1.0;
    let one = layout("xxx", &style(&f, None)).height;
    let lines = layout("xxx xxx xxx xxx", &style(&f, Some(max))).height / one;
    assert!((lines - 3.0).abs() < 0.5, "{lines} lines");
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

#[test]
fn a_sharp_outline_reaches_equally_far_on_both_sides() {
    let Some(f) = font() else { return };
    for (grow, x) in [(4.0, 0.0), (4.0, 0.3), (4.5, 0.7)] {
        let effect = Effect { fill: Some(Paint::Solid([1.0, 0.0, 0.0, 1.0])), strokes: vec![(grow, Paint::Solid([0.0, 0.0, 1.0, 1.0]))], shadows: vec![], edge_fade: 0.0 };
        let s = TextStyle { effect: Some(&effect), size: 60.0, ..style(&f, None) };
        let r = layout("I", &s).rasterize(&s, [x, 0.0]);
        let y = r.center[1] as usize;
        // Ink (any alpha) and fill along the middle row, as fractional extents: a partly
        // covered end pixel counts for its coverage.
        let alpha: Vec<f32> = (0..r.image.width as usize).map(|c| pixel(&r.image, c, y)[3] as f32 / 255.0).collect();
        let red: Vec<f32> = (0..r.image.width as usize).map(|c| { let p = pixel(&r.image, c, y); p[0] as f32 / 255.0 * p[3] as f32 / 255.0 }).collect();
        let edges = |v: &[f32]| {
            let (first, last) = (v.iter().position(|&a| a > 0.0).unwrap(), v.iter().rposition(|&a| a > 0.0).unwrap());
            (first as f32 + (1.0 - v[first]), last as f32 + v[last])
        };
        let ((a0, a1), (r0, r1)) = (edges(&alpha), edges(&red));
        let (left, right) = (r0 - a0, a1 - r1);
        assert!((left - right).abs() < 0.35 && (left - grow).abs() < 0.5, "grow {grow} at x {x}: left {left}, right {right}");
    }
}

/// Ink centroid height (y down) of the leftmost and middle tenth of the image's columns.
fn end_and_middle(img: &openrip_render::RgbaImage) -> (f32, f32) {
    let w = img.width as usize;
    let centroid = |x0: usize, x1: usize| {
        let (mut sum, mut n) = (0.0, 0.0);
        for y in 0..img.height as usize {
            for x in x0..x1 {
                let a = img.data[(y * w + x) * 4 + 3] as f32;
                sum += a * y as f32;
                n += a;
            }
        }
        sum / n.max(1.0)
    };
    let ink: Vec<usize> = (0..w).filter(|&x| (0..img.height as usize).any(|y| img.data[(y * w + x) * 4 + 3] > 0)).collect();
    let (a, b) = (ink[0], ink[ink.len() - 1]);
    let tenth = ((b - a) / 10).max(1);
    let mid = (a + b) / 2;
    (centroid(a, a + tenth), centroid(mid - tenth / 2, mid + tenth / 2))
}

#[test]
fn curved_text_arches_or_sags_by_the_sign_of_its_angle() {
    let Some(f) = font() else { return };
    let text = "HHHHHHHHHH";
    let straight = layout(text, &style(&f, None)).rasterize(&style(&f, None), [0.0, 0.0]);
    let (end, mid) = end_and_middle(&straight.image);
    assert!((end - mid).abs() < 1.0);
    let arch = TextStyle { curve: 90.0, ..style(&f, None) };
    let (end, mid) = end_and_middle(&layout(text, &arch).rasterize(&arch, [0.0, 0.0]).image);
    assert!(end > mid + 10.0, "arch: ends {end} should sit below the middle {mid}");
    let sag = TextStyle { curve: -90.0, ..style(&f, None) };
    let (end, mid) = end_and_middle(&layout(text, &sag).rasterize(&sag, [0.0, 0.0]).image);
    assert!(end < mid - 10.0, "sag: ends {end} should sit above the middle {mid}");
}

#[test]
fn konva_lines_use_chromiums_font_box() {
    // As Chromium measures them on macOS (fontBoundingBoxAscent/Descent at 1000 px).
    for (path, ascent, descent) in [("/System/Library/Fonts/Supplemental/Arial.ttf", 0.905, 0.212), ("/System/Library/Fonts/Helvetica.ttc", 0.920, 0.230), ("/System/Library/Fonts/Supplemental/Verdana.ttf", 1.005, 0.210)] {
        let Ok(f) = Font::from_file(std::path::Path::new(path)) else { continue };
        let (a, d) = f.canvas_font_box_em();
        assert!((a - ascent).abs() < 0.001 && (d - descent).abs() < 0.001, "{path}: {a} {d}");
    }
    let Some(f) = font() else { return };
    // Lines of 1 em at 100 px; an H sits on the baseline, 50 + (0.905 − 0.212)/2 · 100 below
    // the block's top.
    let s = TextStyle { size: 100.0, line_height: Some(1.0), ..style(&f, None) };
    assert!((layout("one\ntwo", &s).height - 200.0).abs() < 0.01);
    let r = layout("H", &s).rasterize(&s, [0.0, 0.0]);
    let img = &r.image;
    let bottom = (0..img.height).rev().find(|&y| (0..img.width).any(|x| img.data[((y * img.width + x) * 4 + 3) as usize] > 128)).unwrap();
    let baseline = (bottom + 1) as f64 - (r.center[1] - 50.0);
    assert!((baseline - 84.65).abs() < 1.0, "{baseline}");
}

#[test]
fn kerning_is_optional() {
    let Some(f) = font() else { return };
    // Arial kerns "AV" tighter; without kerning the pair keeps its full advances.
    let plain = layout("AV", &style(&f, None)).width;
    let kerned = layout("AV", &TextStyle { kerning: true, ..style(&f, None) }).width;
    assert!(kerned < plain - 1.0, "{kerned} vs {plain}");
}
