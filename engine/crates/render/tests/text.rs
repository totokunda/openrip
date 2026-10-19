//! Text layout: wrapping and per-character opacity (uses a macOS system font; skips
//! without it).

use std::sync::Arc;

use openrip_render::text::{layout, Align, Effect, Font, Glow, Gradient, Paint, Span, TextStyle, TexturePaint};
use openrip_render::RgbaImage;

fn font() -> Option<Font> {
    Font::from_file(std::path::Path::new("/System/Library/Fonts/Supplemental/Arial.ttf")).ok()
}

fn style(font: &Font, max_width: Option<f32>) -> TextStyle<'_> {
    TextStyle { font, size: 40.0, color: [255, 255, 255, 255], align: Align::Left, letter_spacing: 0.0, line_spacing: 0.0, line_height: None, kerning: false, stroke: None, more_strokes: &[], gradient: None, glow: None, background: None, shadow: None, max_width, bold: 0.0, italic: 0.0, effect: None, curve: 0.0, char_colors: None, word_boxes: None, underline: false }
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

/// The middle row of a rendered image, straight RGBA.
fn middle_row(r: &openrip_render::text::RenderedText) -> Vec<[u8; 4]> {
    let y = r.center[1] as usize;
    (0..r.image.width as usize).map(|x| pixel(&r.image, x, y)).collect()
}

#[test]
fn a_gradient_runs_across_its_box() {
    let Some(f) = font() else { return };
    let red_to_blue = |span| Gradient { colors: vec![[1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]], stops: vec![0.0, 1.0], radians: 0.0, span };
    let across = red_to_blue(Span::Text);
    let s = TextStyle { gradient: Some(&across), size: 80.0, ..style(&f, None) };
    let row = middle_row(&layout("IIII", &s).rasterize(&s, [0.0, 0.0]));
    let inked: Vec<&[u8; 4]> = row.iter().filter(|p| p[3] > 250).collect();
    let (first, last) = (inked[0], inked[inked.len() - 1]);
    assert!(first[0] > 200 && first[2] < 60 && last[2] > 200 && last[0] < 60, "{first:?} … {last:?}");
    // Each character's own: every "I" goes from red to blue.
    let each = red_to_blue(Span::Character);
    let s = TextStyle { gradient: Some(&each), ..s };
    let row = middle_row(&layout("IIII", &s).rasterize(&s, [0.0, 0.0]));
    let starts: Vec<[u8; 4]> = (1..row.len()).filter(|&x| row[x][3] > 250 && row[x - 1][3] <= 250).map(|x| row[x]).collect();
    assert_eq!(starts.len(), 4);
    assert!(starts.iter().all(|p| p[0] > p[2]), "{starts:?}");
    // Turned 90°: bottom to top.
    let up = Gradient { radians: std::f32::consts::FRAC_PI_2, ..red_to_blue(Span::Text) };
    assert!(up.at(5.0, 9.0, [0.0, 0.0, 10.0, 10.0])[0] > 0.8 && up.at(5.0, 1.0, [0.0, 0.0, 10.0, 10.0])[2] > 0.8);
}

#[test]
fn more_outlines_reach_further_under_the_first() {
    let Some(f) = font() else { return };
    let more = [([0, 0, 255, 255], 9.0)];
    let s = TextStyle { stroke: Some(([0, 0, 0, 255], 3.0)), more_strokes: &more, size: 80.0, ..style(&f, None) };
    let r = layout("I", &s).rasterize(&s, [0.0, 0.0]);
    let row = middle_row(&r);
    let first = |c: &dyn Fn(&[u8; 4]) -> bool| row.iter().position(|p| c(p)).unwrap();
    let (blue, black, white) = (first(&|p| p[2] > 200 && p[3] > 250), first(&|p| p[3] > 250 && p[0] < 30 && p[2] < 30), first(&|p| p[0] > 230 && p[3] > 250));
    assert!(blue < black && black < white, "blue {blue}, black {black}, white {white}");
    assert!((black - blue) as f32 > 4.0 && (white - black) as f32 > 1.0);
    // Without it the image is no wider than the first outline needs.
    let plain = TextStyle { more_strokes: &[], ..s.clone() };
    assert!(layout("I", &plain).rasterize(&plain, [0.0, 0.0]).image.width <= r.image.width);
}

#[test]
fn a_glow_lights_around_the_text_from_its_middle() {
    let Some(f) = font() else { return };
    let plain = TextStyle { size: 60.0, ..style(&f, None) };
    let glow = Glow { color: Some([1.0, 0.8, 0.0, 1.0]), strength: 0.3, range: 0.2, direction: [0.5, 0.5], soften: 2.0 };
    let lit = TextStyle { glow: Some(glow), ..plain.clone() };
    let (a, b) = (layout("HI HI", &plain).rasterize(&plain, [0.0, 0.0]), layout("HI HI", &lit).rasterize(&lit, [0.0, 0.0]));
    assert!(b.image.width > a.image.width, "room for the light");
    // Left of the text: yellow light, fading outward.
    let row = middle_row(&b);
    let ink = row.iter().position(|p| p[0] > 200 && p[1] > 200 && p[2] > 200 && p[3] > 250).unwrap();
    let (near, far) = (row[ink - 4], row[ink.saturating_sub(40)]);
    assert!(near[3] > 40 && near[0] > near[2] + 60, "near {near:?}");
    assert!(far[3] < near[3], "far {far:?} near {near:?}");
    // Without a glow, nothing is drawn left of the text but its anti-aliased edge.
    let plain_row = middle_row(&a);
    let plain_ink = plain_row.iter().position(|p| p[3] > 250).unwrap();
    assert!(plain_row[..plain_ink.saturating_sub(2)].iter().all(|p| p[3] == 0));
    // The text itself is 2% darker under a glow.
    let white = row.iter().filter(|p| p[3] == 255).map(|p| p[0]).max().unwrap();
    assert!((248..=251).contains(&white), "{white}");
    // Spread from the right edge, the light goes left more than right.
    let left_lit = TextStyle { glow: Some(Glow { direction: [0.0, 0.5], ..glow }), ..plain.clone() };
    let row = middle_row(&layout("HI HI", &left_lit).rasterize(&left_lit, [0.0, 0.0]));
    let (l, r) = (row.iter().position(|p| p[3] > 250).unwrap(), row.iter().rposition(|p| p[3] > 250).unwrap());
    let light = |range: std::ops::Range<usize>| range.map(|x| row[x][3] as u32).sum::<u32>();
    assert!(light(l.saturating_sub(30)..l) > light(r + 1..(r + 31).min(row.len())), "left of the text should glow more");
}

#[test]
fn an_underline_runs_under_each_line_at_the_fonts_position() {
    let Some(f) = font() else { return };
    let plain = style(&f, None);
    let under = TextStyle { underline: true, ..style(&f, None) };
    let a = layout("HH\nHHHH", &plain).rasterize(&plain, [0.0, 0.0]).image;
    let b = layout("HH\nHHHH", &under).rasterize(&under, [0.0, 0.0]).image;
    // What the underline added, row by row: two bands (one a line), the second line's longer.
    let added: Vec<usize> = (0..b.height as usize).map(|y| (0..b.width as usize).filter(|x| { let i = (y * b.width as usize + x) * 4 + 3; b.data[i] as u16 > a.data[i] as u16 + 100 }).count()).collect();
    let rows: Vec<usize> = (0..added.len()).filter(|&y| added[y] > 0).collect();
    let bands: Vec<&[usize]> = rows.chunk_by(|p, q| q - p == 1).collect();
    assert_eq!(bands.len(), 2, "{rows:?}");
    let width = |band: &[usize]| band.iter().map(|&y| added[y]).max().unwrap();
    assert!(width(bands[1]) as f32 > 1.8 * width(bands[0]) as f32);
    // Arial's underline: 0.106 em below the baseline, 0.073 em thick (its post table), at 40 px.
    assert!(bands[0].len() <= 5, "{} rows thick", bands[0].len());
    // Under the glyphs: none of it above the bottom of the first line's H.
    let h_bottom = (0..a.height as usize).filter(|&y| (0..a.width as usize).any(|x| a.data[(y * a.width as usize + x) * 4 + 3] > 128)).find(|&y| (0..a.width as usize).all(|x| a.data[((y + 1) * a.width as usize + x) * 4 + 3] <= 128)).unwrap();
    assert!(bands[0][0] > h_bottom, "underline at {} above the glyphs' bottom {h_bottom}", bands[0][0]);
}

#[test]
fn spacing_widens_lines_and_spreads_them() {
    let Some(f) = font() else { return };
    let base = layout("HHHH\nHH", &style(&f, None));
    let spaced = layout("HHHH\nHH", &TextStyle { letter_spacing: 0.25, line_spacing: 0.5, ..style(&f, None) });
    // Three gaps on the longest line, a quarter of the 40 px size each; half a size between lines.
    assert!((spaced.width - base.width - 3.0 * 10.0).abs() < 0.01, "{} {}", spaced.width, base.width);
    assert!((spaced.height - base.height - 20.0).abs() < 0.01);
}

#[test]
fn a_box_sits_behind_the_chosen_word_only() {
    let Some(f) = font() else { return };
    let red = [255, 0, 0, 255];
    let boxes: Vec<Option<[u8; 4]>> = "HH HH".chars().enumerate().map(|(i, _)| (i < 2).then_some(red)).collect();
    let s = TextStyle { word_boxes: Some(&boxes), ..style(&f, None) };
    let lay = layout("HH HH", &s);
    let r = lay.rasterize(&s, [0.0, 0.0]);
    let (w, h) = (r.image.width as usize, r.image.height as usize);
    // Red pixels (the box, not the white glyphs): all in the left half, between the words.
    let red_at = |x: usize, y: usize| {
        let p = &r.image.data[(y * w + x) * 4..(y * w + x) * 4 + 4];
        p[3] > 200 && p[0] > 200 && p[1] < 60
    };
    let cols: Vec<usize> = (0..w).filter(|&x| (0..h).any(|y| red_at(x, y))).collect();
    assert!(!cols.is_empty());
    assert!(*cols.last().unwrap() <= r.center[0] as usize + 2, "the box reaches {} of centre {}", cols.last().unwrap(), r.center[0]);
    // The box is taller than the glyphs: red above the cap height of the H's.
    let plain = style(&f, None);
    let bare = layout("HH HH", &plain).rasterize(&plain, [0.0, 0.0]).image;
    let first_ink = |img: &RgbaImage| (0..img.height as usize).find(|&y| (0..img.width as usize).any(|x| img.data[(y * img.width as usize + x) * 4 + 3] > 128)).unwrap();
    assert!(first_ink(&r.image) < first_ink(&bare), "box top {} vs ink top {}", first_ink(&r.image), first_ink(&bare));
}
