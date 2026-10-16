//! Text rasterisation (CPU, swash: OpenType shaping with kerning and ligatures, unhinted
//! outlines) into an RGBA image that the compositor places like any other layer.
//!
//! Layout follows CapCut (docs/parity/calibration.md): the block of line boxes (ascent +
//! descent per line) is centred on the transform position, and each line is aligned inside
//! the block.

use std::path::Path;
use std::sync::Arc;

use swash::scale::{Render, ScaleContext, Source as GlyphSource};
use swash::shape::ShapeContext;
use swash::zeno::{Angle, Cap, Format, Join, Stroke, Transform, Vector};

use crate::RgbaImage;

/// A font file loaded in memory.
#[derive(Clone)]
pub struct Font {
    data: Arc<Vec<u8>>,
    offset: u32,
    key: swash::CacheKey,
}

impl Font {
    pub fn from_file(path: &Path) -> std::io::Result<Font> {
        Font::from_bytes(std::fs::read(path)?).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "not a font"))
    }

    pub fn from_bytes(data: Vec<u8>) -> Option<Font> {
        let font = swash::FontRef::from_index(&data, 0)?;
        let (offset, key) = (font.offset, font.key);
        Some(Font { data: Arc::new(data), offset, key })
    }

    fn as_ref(&self) -> swash::FontRef<'_> {
        swash::FontRef { data: &self.data, offset: self.offset, key: self.key }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Align {
    Left,
    Center,
    Right,
}

/// What to draw.
#[derive(Clone)]
pub struct TextStyle<'a> {
    pub font: &'a Font,
    /// Em size in output pixels.
    pub size: f32,
    /// Straight-alpha fill colour.
    pub color: [u8; 4],
    pub align: Align,
    /// Extra space between characters, as a fraction of the em size.
    pub letter_spacing: f32,
    /// Extra space between lines, as a fraction of the em size.
    pub line_spacing: f32,
    /// Outline drawn under the fill: colour and how far it reaches outside the glyphs (px).
    pub stroke: Option<([u8; 4], f32)>,
    /// Box behind the text: colour, padding around the block of line boxes (px, x and y),
    /// corner radius (px).
    pub background: Option<([u8; 4], [f32; 2], f32)>,
    /// Wrap lines wider than this (px) between words, or between any two characters of
    /// CJK text; a word wider than the whole line breaks between characters.
    pub max_width: Option<f32>,
    /// Synthetic bold: how far each glyph edge moves outward (px); 0 for none.
    pub bold: f32,
    /// Synthetic italic: shear of the glyphs (degrees, tops to the right); 0 for none.
    pub italic: f32,
    /// A layered style that replaces `color` and `stroke`.
    pub effect: Option<&'a Effect>,
}

/// A layered text style (CapCut's library text styles): shadows at the back, then strokes
/// (the last at the back), then the fill. Sizes are in pixels.
#[derive(Clone, Debug, Default)]
pub struct Effect {
    pub fill: Option<Paint>,
    /// Width (how far it reaches outside the glyphs) and paint.
    pub strokes: Vec<(f32, Paint)>,
    pub shadows: Vec<Shadow>,
}

#[derive(Clone, Debug)]
pub struct Shadow {
    pub paint: Paint,
    /// Offset in image pixels (+y down).
    pub offset: [f32; 2],
    /// Blur radius of the shadow itself (not its strokes).
    pub blur: f32,
    pub strokes: Vec<(f32, Paint)>,
}

#[derive(Clone, Debug)]
pub enum Paint {
    /// Straight-alpha colour with the layer's opacity folded in.
    Solid([f32; 4]),
    Texture(TexturePaint),
}

/// An image mapped onto each character as CapCut's text-style shader maps it: split into
/// `columns` vertical strips, the character with index i takes the square around the middle
/// of strip i mod `columns`, laid over a square around the glyph (`stretch`: 0 fit, 1 fill,
/// 2 stretch), turned by `radians` and magnified by `scale`, repeating beyond its edges.
#[derive(Clone, Debug)]
pub struct TexturePaint {
    /// Premultiplied pixels.
    pub image: Arc<RgbaImage>,
    pub columns: u32,
    pub radians: f32,
    pub scale: f32,
    pub stretch: u8,
    /// The texture's and the layer's opacity together.
    pub alpha: f32,
}

impl Paint {
    /// Premultiplied colour at `(x, y)` inside a character's box `rect` (x, y, w, h).
    fn at(&self, x: f32, y: f32, rect: [f32; 4], index: usize) -> [f32; 4] {
        match self {
            Paint::Solid(c) => [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]],
            Paint::Texture(t) => {
                let img = &t.image;
                let (rw, rh) = (rect[2].max(1e-3), rect[3].max(1e-3));
                let (tw, th) = (img.width as f32, img.height as f32);
                let (rect_ar, tex_ar) = (rw / rh, tw / th);
                let mut s = [1.0f32, 1.0];
                if t.stretch != 2 {
                    let wider = rw / tw > rh / th;
                    if (t.stretch == 0) == wider {
                        s[0] = rect_ar / tex_ar;
                    } else {
                        s[1] = tex_ar / rect_ar;
                    }
                }
                // CapCut's shader divides by its scale uniform; matched against CapCut's
                // exports, the style's `scale` magnifies the image, so that uniform is 1/scale.
                let (s0, s1) = (s[0] * t.scale, s[1] * t.scale);
                let (mut u, mut v) = ((x - rect[0]) / rw - 0.5, (y - rect[1]) / rh - 0.5);
                let square = t.stretch != 2;
                if square {
                    if rect_ar > 1.0 { u *= rect_ar } else { v /= rect_ar }
                }
                let (sin, cos) = t.radians.sin_cos();
                (u, v) = (cos * u - sin * v, sin * u + cos * v);
                if square {
                    if rect_ar > 1.0 { u /= rect_ar } else { v *= rect_ar }
                }
                let n = t.columns.max(1) as f32;
                let u = u * s0 / n + (0.5 + (index % t.columns.max(1) as usize) as f32) / n;
                let v = v * s1 / n + 0.5;
                let c = sample_repeat(img, u * tw - 0.5, v * th - 0.5);
                [c[0] * t.alpha, c[1] * t.alpha, c[2] * t.alpha, c[3] * t.alpha]
            }
        }
    }
}

/// Bilinear sample of premultiplied pixels at pixel coordinates, wrapping around.
fn sample_repeat(img: &RgbaImage, x: f32, y: f32) -> [f32; 4] {
    let (w, h) = (img.width as i64, img.height as i64);
    let (x0, y0) = (x.floor(), y.floor());
    let (fx, fy) = (x - x0, y - y0);
    let px = |xi: i64, yi: i64| {
        let i = ((yi.rem_euclid(h) * w + xi.rem_euclid(w)) * 4) as usize;
        let d = &img.data[i..i + 4];
        [d[0] as f32 / 255.0, d[1] as f32 / 255.0, d[2] as f32 / 255.0, d[3] as f32 / 255.0]
    };
    let (x0, y0) = (x0 as i64, y0 as i64);
    let (a, b, c, d) = (px(x0, y0), px(x0 + 1, y0), px(x0, y0 + 1), px(x0 + 1, y0 + 1));
    std::array::from_fn(|k| (a[k] * (1.0 - fx) + b[k] * fx) * (1.0 - fy) + (c[k] * (1.0 - fx) + d[k] * fx) * fy)
}

struct Placed {
    glyph: u16,
    x: f32,
    baseline: f32,
    /// Index of the glyph's (first) character in the text, counting every character
    /// including line breaks.
    char_index: usize,
}

/// Laid-out text, ready to rasterise.
pub struct TextLayout {
    glyphs: Vec<Placed>,
    /// Size of the block of line boxes, in pixels.
    pub width: f32,
    pub height: f32,
    size: f32,
}

/// Rasterised text.
pub struct RenderedText {
    /// Straight-alpha pixels with room for glyphs that overhang their boxes.
    pub image: RgbaImage,
    /// Where the centre of the block of line boxes is, in image pixels.
    pub center: [f64; 2],
}

pub fn layout(text: &str, style: &TextStyle) -> TextLayout {
    let font = style.font.as_ref();
    let m = font.metrics(&[]).scale(style.size);
    let line_box = m.ascent + m.descent;
    let advance_y = line_box + style.line_spacing * style.size;
    let spacing = style.letter_spacing * style.size;
    let mut ctx = ShapeContext::new();
    let mut lines = Vec::new();
    let mut line_start = 0; // characters before this line
    for line in text.split('\n') {
        let mut shaper = ctx.builder(font).size(style.size).build();
        shaper.add_str(line);
        let mut clusters = Vec::new();
        shaper.shape_with(|cluster| {
            let at = (cluster.source.start as usize).min(line.len());
            let mut c = Cluster { glyphs: Vec::new(), advance: 0.0, char_index: line_start + line[..at].chars().count(), ch: line[at..].chars().next().unwrap_or(' ') };
            for g in cluster.glyphs {
                c.glyphs.push((g.id, c.advance + g.x));
                c.advance += g.advance + spacing;
            }
            clusters.push(c);
        });
        for row in wrap(&clusters, style.max_width) {
            let mut pen = 0.0f32;
            let mut glyphs = Vec::new();
            for c in row {
                glyphs.extend(c.glyphs.iter().map(|&(id, x)| (id, pen + x, c.char_index)));
                pen += c.advance;
            }
            let width = if glyphs.is_empty() { 0.0 } else { pen - spacing };
            lines.push((glyphs, width));
        }
        line_start += line.chars().count() + 1;
    }
    let width = lines.iter().map(|l| l.1).fold(0.0, f32::max);
    let height = line_box + advance_y * (lines.len().saturating_sub(1)) as f32;
    let mut glyphs = Vec::new();
    for (i, (line, w)) in lines.into_iter().enumerate() {
        let x0 = match style.align {
            Align::Left => 0.0,
            Align::Center => (width - w) / 2.0,
            Align::Right => width - w,
        };
        let baseline = m.ascent + i as f32 * advance_y;
        glyphs.extend(line.into_iter().map(|(glyph, x, char_index)| Placed { glyph, x: x0 + x, baseline, char_index }));
    }
    TextLayout { glyphs, width, height, size: style.size }
}

/// A shaped cluster: its glyphs (id, x from the cluster's start) and advance, letter
/// spacing included.
struct Cluster {
    glyphs: Vec<(u16, f32)>,
    advance: f32,
    char_index: usize,
    ch: char,
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x2E80..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF | 0x20000..=0x2FFFF)
}

/// Greedy line breaking: break before a word (after spaces) or before/after a CJK character
/// when the line would get wider than `max`. Spaces at a break are dropped. A piece wider
/// than a whole line breaks between characters.
fn wrap(clusters: &[Cluster], max: Option<f32>) -> Vec<&[Cluster]> {
    let Some(max) = max.filter(|m| *m > 0.0) else { return vec![clusters] };
    let mut rows = Vec::new();
    let mut start = 0; // first cluster of the row
    let mut i = 0;
    while i < clusters.len() {
        // The next unbreakable piece: a CJK character, or a run up to the next space or CJK
        // character, plus the spaces after it.
        let mut end = i + 1;
        if !is_cjk(clusters[i].ch) {
            while end < clusters.len() && clusters[end].ch != ' ' && !is_cjk(clusters[end].ch) && clusters[i].ch != ' ' {
                end += 1;
            }
        }
        while end < clusters.len() && clusters[end].ch == ' ' {
            end += 1;
        }
        let ink_end = (i..end).rev().find(|&k| clusters[k].ch != ' ').map_or(i, |k| k + 1);
        let width = |from: usize, to: usize| clusters[from..to].iter().map(|c| c.advance).sum::<f32>();
        if ink_end > i && width(start, ink_end) > max {
            if start < i {
                // Break before this piece (dropping the spaces that ended the row).
                let row_end = (start..i).rev().find(|&k| clusters[k].ch != ' ').map_or(start, |k| k + 1);
                rows.push(&clusters[start..row_end]);
                start = i;
                continue;
            }
            // The piece alone is too wide: break it between characters.
            let mut k = i + 1;
            while k < ink_end && width(start, k + 1) <= max {
                k += 1;
            }
            rows.push(&clusters[start..k]);
            start = k;
            i = k;
            continue;
        }
        i = end;
    }
    // The last row keeps its trailing spaces, as an unwrapped line does.
    if start < clusters.len() || rows.is_empty() {
        rows.push(&clusters[start..]);
    }
    rows
}

impl TextLayout {
    /// Rasterise with the block's top-left corner at `origin` (fractional pixels) inside a
    /// margin, so a caller can line the image up with the canvas pixel grid.
    pub fn rasterize(&self, style: &TextStyle, origin: [f32; 2]) -> RenderedText {
        self.rasterize_with_alpha(style, origin, None)
    }

    /// [`TextLayout::rasterize`] with an opacity per character (fill and stroke; the
    /// background stays), as text animations reveal text. Characters past the end of
    /// `char_alpha` are opaque.
    pub fn rasterize_with_alpha(&self, style: &TextStyle, origin: [f32; 2], char_alpha: Option<&[f32]>) -> RenderedText {
        if let Some(effect) = style.effect {
            return self.prepare_effect(style, effect, origin).composite(char_alpha);
        }
        let stroke = style.stroke.map_or(0.0, |s| s.1);
        let bg_pad = style.background.map_or([0.0, 0.0], |b| b.1);
        let pad = ((self.size * 0.5).max(stroke).max(bg_pad[0]).max(bg_pad[1]).ceil() as i32) + 2;
        let (w, h) = ((self.width.ceil() as i32 + 2 * pad + 1) as u32, (self.height.ceil() as i32 + 2 * pad + 1) as u32);
        let (left, top) = (pad as f32 + origin[0], pad as f32 + origin[1]);
        let mut fill = vec![0f32; (w * h) as usize];
        let mut outline = style.stroke.map(|_| vec![0f32; (w * h) as usize]);
        let mut ctx = ScaleContext::new();
        let mut scaler = ctx.builder(style.font.as_ref()).size(self.size).hint(false).build();
        let draw = |cov: &mut [f32], img: &swash::scale::image::Image, x: f32, y: f32, alpha: f32| {
            let (gx, gy) = (x.floor() as i32 + img.placement.left, y.floor() as i32 - img.placement.top);
            for row in 0..img.placement.height as i32 {
                for col in 0..img.placement.width as i32 {
                    let (px, py) = (gx + col, gy + row);
                    if px < 0 || py < 0 || px >= w as i32 || py >= h as i32 {
                        continue;
                    }
                    let a = img.data[(row * img.placement.width as i32 + col) as usize] as f32 / 255.0 * alpha;
                    let c = &mut cov[(py * w as i32 + px) as usize];
                    *c = *c + a - *c * a; // union of overlapping glyphs
                }
            }
        };
        let shear = (style.italic != 0.0).then(|| Transform::skew(Angle::from_degrees(style.italic), Angle::ZERO));
        for g in &self.glyphs {
            let alpha = char_alpha.and_then(|a| a.get(g.char_index)).copied().unwrap_or(1.0).clamp(0.0, 1.0);
            if alpha == 0.0 {
                continue;
            }
            let (x, y) = (left + g.x, top + g.baseline);
            let offset = Vector::new(x.fract(), y.fract());
            if let Some(cov) = outline.as_mut() {
                // Centred on the outline, so twice as wide as its reach outside the glyph.
                let mut pen = Stroke::new(2.0 * stroke);
                pen.join(Join::Round).cap(Cap::Round);
                if let Some(img) = Render::new(&[GlyphSource::Outline]).format(Format::Alpha).embolden(style.bold).transform(shear).style(pen).offset(offset).render(&mut scaler, g.glyph) {
                    draw(cov, &img, x, y, alpha);
                }
            }
            if let Some(img) = Render::new(&[GlyphSource::Outline]).format(Format::Alpha).embolden(style.bold).transform(shear).offset(offset).render(&mut scaler, g.glyph) {
                draw(&mut fill, &img, x, y, alpha);
            }
        }
        let background = self.background(style, left, top, w, h);
        // Composite background, then stroke, then fill (premultiplied), back to straight alpha.
        let mut px = vec![[0f32; 4]; (w * h) as usize];
        for (i, px) in px.iter_mut().enumerate() {
            if let Some((c, cov)) = &background {
                *px = premul(*c, cov[i]);
            }
            if let (Some((c, _)), Some(cov)) = (style.stroke, &outline) {
                *px = over(premul(c, cov[i]), *px);
            }
            *px = over(premul(style.color, fill[i]), *px);
        }
        finish(px, w, h, [(left + self.width / 2.0) as f64, (top + self.height / 2.0) as f64])
    }

    /// Background box coverage, anti-aliased by distance to its rounded edge.
    fn background(&self, style: &TextStyle, left: f32, top: f32, w: u32, h: u32) -> Option<([u8; 4], Vec<f32>)> {
        style.background.map(|(color, [px, py], radius)| {
            let (x0, y0, x1, y1) = (left - px, top - py, left + self.width + px, top + self.height + py);
            let r = radius.min((x1 - x0) / 2.0).min((y1 - y0) / 2.0).max(0.0);
            let (cx, cy, hx, hy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (x1 - x0) / 2.0 - r, (y1 - y0) / 2.0 - r);
            let cov: Vec<f32> = (0..(w * h) as usize)
                .map(|i| {
                    // Signed distance to the rounded rectangle, sampled at the pixel centre.
                    let (x, y) = ((i as u32 % w) as f32 + 0.5, (i as u32 / w) as f32 + 0.5);
                    let (dx, dy) = ((x - cx).abs() - hx, (y - cy).abs() - hy);
                    let d = (dx.max(0.0).powi(2) + dy.max(0.0).powi(2)).sqrt() + dx.max(dy).min(0.0) - r;
                    (0.5 - d).clamp(0.0, 1.0)
                })
                .collect();
            (color, cov)
        })
    }

    /// A layered style, drawn into per-character pieces that [`PreparedText::composite`]
    /// puts together with any per-character opacity. Every layer is drawn glyph by glyph in
    /// text order (a later character covers an earlier one), each glyph's paint mapped onto a
    /// square around it, as CapCut's text-style shader does.
    pub fn prepare_effect(&self, style: &TextStyle, effect: &Effect, origin: [f32; 2]) -> PreparedText {
        let reach = |strokes: &[(f32, Paint)]| strokes.iter().map(|s| s.0).fold(0.0, f32::max);
        let shadow_reach = effect.shadows.iter().map(|sh| sh.offset[0].abs().max(sh.offset[1].abs()) + reach(&sh.strokes).max(2.0 * sh.blur)).fold(0.0, f32::max);
        let bg_pad = style.background.map_or([0.0, 0.0], |b| b.1);
        let pad = ((self.size * 0.5).max(reach(&effect.strokes)).max(shadow_reach).max(bg_pad[0]).max(bg_pad[1]).ceil() as i32) + 2;
        let (w, h) = ((self.width.ceil() as i32 + 2 * pad + 1) as u32, (self.height.ceil() as i32 + 2 * pad + 1) as u32);
        let (left, top) = (pad as f32 + origin[0], pad as f32 + origin[1]);
        let mut ctx = ScaleContext::new();
        let mut scaler = ctx.builder(style.font.as_ref()).size(self.size).hint(false).build();
        let shear = (style.italic != 0.0).then(|| Transform::skew(Angle::from_degrees(style.italic), Angle::ZERO));
        let mut base = vec![[0f32; 4]; (w * h) as usize];
        if let Some((c, cov)) = self.background(style, left, top, w, h) {
            for (p, cov) in base.iter_mut().zip(cov) {
                *p = premul(c, cov);
            }
        }
        // One layer: every glyph's shape grown by `grow` (0 = the glyph), moved by `offset`,
        // and softened by `blur`.
        let mut layer = |paint: &Paint, grow: f32, offset: [f32; 2], blur: f32| -> Vec<Patch> {
            let mut out = Vec::new();
            for g in &self.glyphs {
                let (x, y) = (left + g.x + offset[0], top + g.baseline + offset[1]);
                let at = Vector::new(x.fract(), y.fract());
                let render = |scaler: &mut swash::scale::Scaler, pen: Option<Stroke>| {
                    let mut r = Render::new(&[GlyphSource::Outline]);
                    r.format(Format::Alpha).embolden(style.bold).transform(shear).offset(at);
                    if let Some(pen) = pen {
                        r.style(pen);
                    }
                    r.render(scaler, g.glyph)
                };
                let Some(fill) = render(&mut scaler, None) else { continue };
                // Paint is mapped onto a square of 0.6 em centred on the glyph, in every
                // layer: fitted against CapCut's exports (narrow letters get full-size
                // pieces, so it isn't the glyph's box; the box with the outline is too big).
                let fp = fill.placement;
                let (fx, fy) = (x.floor() as i32 + fp.left, y.floor() as i32 - fp.top);
                let side = PAINT_BOX * self.size;
                let (cx, cy) = (fx as f32 + fp.width as f32 / 2.0, fy as f32 + fp.height as f32 / 2.0);
                let rect = [cx - side / 2.0, cy - side / 2.0, side, side];
                // The shape: everything within `grow` of the glyph, fading out over
                // EDGE_FADE beyond that as CapCut's text-style meshes do (their outer fringe
                // vertices sit 2.5 px out with zero alpha). Measured by distance rather than
                // by stroking the outline, which leaves holes in round letters' middles.
                let margin = (grow + EDGE_FADE).ceil() as i32 + 1 + if blur > 0.0 { (2.0 * blur).ceil() as i32 + 1 } else { 0 };
                let (fw, fh) = (fp.width as i32, fp.height as i32);
                let (pw, ph) = (fw + 2 * margin, fh + 2 * margin);
                let at_fill = |c: i32, r: i32| if c >= 0 && r >= 0 && c < fw && r < fh { fill.data[(r * fw + c) as usize] as f32 / 255.0 } else { 0.0 };
                let inside: Vec<bool> = (0..pw * ph).map(|i| at_fill(i % pw - margin, i / pw - margin) >= 0.5).collect();
                let dist = distance_to(&inside, pw as usize, ph as usize);
                let mut px = vec![[0f32; 4]; (pw * ph) as usize];
                for (i, p) in px.iter_mut().enumerate() {
                    let (col, row) = (i as i32 % pw, i as i32 / pw);
                    // Distance from the pixel centre to the glyph's edge (half a pixel short
                    // of the nearest inked pixel's centre).
                    let beyond = (dist[i] - 0.5).max(0.0) - grow;
                    let cov = if inside[i] { 1.0 } else { (1.0 - beyond / EDGE_FADE).clamp(0.0, 1.0).max(at_fill(col - margin, row - margin)) };
                    if cov > 0.0 {
                        let c = paint.at((fx - margin + col) as f32 + 0.5, (fy - margin + row) as f32 + 0.5, rect, g.char_index);
                        *p = c.map(|v| v * cov);
                    }
                }
                if blur > 0.0 {
                    box_blur(&mut px, pw as usize, ph as usize, blur);
                }
                out.push(Patch { x: fx - margin, y: fy - margin, w: pw, h: ph, char_index: g.char_index, px });
            }
            out
        };
        let mut layers = Vec::new();
        for sh in &effect.shadows {
            for (width, paint) in sh.strokes.iter().rev() {
                layers.push(layer(paint, *width, sh.offset, 0.0));
            }
            layers.push(layer(&sh.paint, 0.0, sh.offset, sh.blur));
        }
        for (width, paint) in effect.strokes.iter().rev() {
            layers.push(layer(paint, *width, [0.0, 0.0], 0.0));
        }
        if let Some(paint) = &effect.fill {
            layers.push(layer(paint, 0.0, [0.0, 0.0], 0.0));
        }
        PreparedText { w, h, left, top, width: self.width, height: self.height, base, layers }
    }
}

/// Styled text drawn as per-character pieces, ready to put together at any per-character
/// opacity (text animations change only that from frame to frame).
pub struct PreparedText {
    w: u32,
    h: u32,
    left: f32,
    top: f32,
    width: f32,
    height: f32,
    /// The background box, premultiplied.
    base: Vec<[f32; 4]>,
    /// Back to front; each layer's pieces in text order.
    layers: Vec<Vec<Patch>>,
}

/// One character's premultiplied pixels in one layer.
struct Patch {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    char_index: usize,
    px: Vec<[f32; 4]>,
}

impl PreparedText {
    /// Put the pieces together, each character at its opacity in `char_alpha` (past its end,
    /// or with none, opaque).
    pub fn composite(&self, char_alpha: Option<&[f32]>) -> RenderedText {
        let (w, h) = (self.w as i32, self.h as i32);
        let mut px = self.base.clone();
        for patch in self.layers.iter().flatten() {
            let a = char_alpha.and_then(|a| a.get(patch.char_index)).copied().unwrap_or(1.0).clamp(0.0, 1.0);
            if a == 0.0 {
                continue;
            }
            for row in 0..patch.h {
                let y = patch.y + row;
                if y < 0 || y >= h {
                    continue;
                }
                for col in 0..patch.w {
                    let x = patch.x + col;
                    let c = patch.px[(row * patch.w + col) as usize];
                    if x < 0 || x >= w || c[3] <= 0.0 {
                        continue;
                    }
                    let t = &mut px[(y * w + x) as usize];
                    *t = over(c.map(|v| v * a), *t);
                }
            }
        }
        finish(px, self.w, self.h, [(self.left + self.width / 2.0) as f64, (self.top + self.height / 2.0) as f64])
    }
}

/// Premultiplied pixels to the straight-alpha image; `center` is where the centre of the
/// block of line boxes is.
fn finish(px: Vec<[f32; 4]>, w: u32, h: u32, center: [f64; 2]) -> RenderedText {
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for p in px {
        let a = p[3];
        let un = |v: f32| if a > 0.0 { (v / a * 255.0).round().clamp(0.0, 255.0) as u8 } else { 0 };
        data.extend_from_slice(&[un(p[0]), un(p[1]), un(p[2]), (a * 255.0).round() as u8]);
    }
    RenderedText { image: RgbaImage { width: w, height: h, data }, center }
}

/// How far beyond its shape a text-style layer fades out, in pixels (CapCut's text-style
/// vertex shader pushes the outer fringe vertices 2.5 px out at zero alpha).
const EDGE_FADE: f32 = 2.5;

/// Euclidean distance from each pixel to the nearest `inside` one (0 for those), by the
/// Felzenszwalb–Huttenlocher squared distance transform, columns then rows.
fn distance_to(inside: &[bool], w: usize, h: usize) -> Vec<f32> {
    // Squared distances in f64: an "infinite" start value must still leave room for exact
    // differences of squares.
    let far = ((w + h) * (w + h)) as f64 * 4.0;
    let mut d: Vec<f64> = inside.iter().map(|&i| if i { 0.0 } else { far }).collect();
    let n = w.max(h);
    let (mut f, mut v, mut z, mut out) = (vec![0f64; n], vec![0usize; n], vec![0f64; n + 1], vec![0f64; n]);
    let mut pass = |d: &mut [f64], len: usize, at: &dyn Fn(usize) -> usize| {
        for q in 0..len {
            f[q] = d[at(q)];
        }
        let mut k = 0;
        v[0] = 0;
        z[0] = f64::NEG_INFINITY;
        z[1] = f64::INFINITY;
        for q in 1..len {
            let parabola = |p: usize| ((f[q] + (q * q) as f64) - (f[p] + (p * p) as f64)) / (2.0 * (q as f64 - p as f64));
            let mut s = parabola(v[k]);
            while s <= z[k] {
                k -= 1;
                s = parabola(v[k]);
            }
            k += 1;
            v[k] = q;
            z[k] = s;
            z[k + 1] = f64::INFINITY;
        }
        k = 0;
        for (q, o) in out.iter_mut().enumerate().take(len) {
            while z[k + 1] < q as f64 {
                k += 1;
            }
            *o = (q as f64 - v[k] as f64).powi(2) + f[v[k]];
        }
        for q in 0..len {
            d[at(q)] = out[q];
        }
    };
    for x in 0..w {
        pass(&mut d, h, &|q| q * w + x);
    }
    for y in 0..h {
        pass(&mut d, w, &|q| y * w + q);
    }
    d.into_iter().map(|v| v.sqrt() as f32).collect()
}

/// Side of the square a text style's paint is mapped onto, in em (see `prepare_effect`).
const PAINT_BOX: f32 = 0.6;

fn premul(c: [u8; 4], cov: f32) -> [f32; 4] {
    let a = cov * c[3] as f32 / 255.0;
    [c[0] as f32 / 255.0 * a, c[1] as f32 / 255.0 * a, c[2] as f32 / 255.0 * a, a]
}

/// Premultiplied `top` over `under`.
fn over(top: [f32; 4], under: [f32; 4]) -> [f32; 4] {
    std::array::from_fn(|k| top[k] + under[k] * (1.0 - top[3]))
}

/// Three box passes, close to a Gaussian of the given radius.
fn box_blur(px: &mut [[f32; 4]], w: usize, h: usize, radius: f32) {
    let r = ((radius / 3.0f32.sqrt()).round() as usize).max(1);
    let mut tmp = vec![[0f32; 4]; px.len()];
    for _ in 0..3 {
        for (len, stride, lines, step) in [(w, 1, h, w), (h, w, w, 1)] {
            for line in 0..lines {
                let base = line * step;
                let mut acc = [0f32; 4];
                let at = |i: isize| -> [f32; 4] { if i < 0 || i >= len as isize { [0.0; 4] } else { px[base + i as usize * stride] } };
                for i in -(r as isize)..=(r as isize) {
                    let v = at(i);
                    acc = std::array::from_fn(|k| acc[k] + v[k]);
                }
                for i in 0..len as isize {
                    tmp[base + i as usize * stride] = acc.map(|v| v / (2 * r + 1) as f32);
                    let (add, sub) = (at(i + r as isize + 1), at(i - r as isize));
                    acc = std::array::from_fn(|k| acc[k] + add[k] - sub[k]);
                }
            }
            px.copy_from_slice(&tmp);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distances_are_euclidean_to_the_nearest_inside_pixel() {
        // One inside pixel at (2, 1) in a 6×4 grid.
        let (w, h) = (6, 4);
        let inside: Vec<bool> = (0..w * h).map(|i| i == w + 2).collect();
        let d = distance_to(&inside, w, h);
        assert_eq!(d[w + 2], 0.0);
        assert!((d[w + 5] - 3.0).abs() < 1e-5);
        assert!((d[3 * w] - (8.0f32).sqrt()).abs() < 1e-5);
        // No inside pixel at all: every distance is large.
        assert!(distance_to(&[false; 4], 2, 2).iter().all(|&v| v > 4.0));
    }
}
