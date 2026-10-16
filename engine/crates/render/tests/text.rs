//! Text layout: wrapping and per-character opacity (uses a macOS system font; skips
//! without it).

use openrip_render::text::{layout, Align, Font, TextStyle};

fn font() -> Option<Font> {
    Font::from_file(std::path::Path::new("/System/Library/Fonts/Supplemental/Arial.ttf")).ok()
}

fn style(font: &Font, max_width: Option<f32>) -> TextStyle<'_> {
    TextStyle { font, size: 40.0, color: [255, 255, 255, 255], align: Align::Left, letter_spacing: 0.0, line_spacing: 0.0, stroke: None, background: None, max_width }
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
