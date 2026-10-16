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
use swash::zeno::{Cap, Format, Join, Stroke, Vector};

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
}

struct Placed {
    glyph: u16,
    x: f32,
    baseline: f32,
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
    for line in text.split('\n') {
        let mut shaper = ctx.builder(font).size(style.size).build();
        shaper.add_str(line);
        let mut pen = 0.0f32;
        let mut glyphs = Vec::new();
        shaper.shape_with(|cluster| {
            for g in cluster.glyphs {
                glyphs.push((g.id, pen + g.x));
                pen += g.advance + spacing;
            }
        });
        let width = if glyphs.is_empty() { 0.0 } else { pen - spacing };
        lines.push((glyphs, width));
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
        glyphs.extend(line.into_iter().map(|(glyph, x)| Placed { glyph, x: x0 + x, baseline }));
    }
    TextLayout { glyphs, width, height, size: style.size }
}

impl TextLayout {
    /// Rasterise with the block's top-left corner at `origin` (fractional pixels) inside a
    /// margin, so a caller can line the image up with the canvas pixel grid.
    pub fn rasterize(&self, style: &TextStyle, origin: [f32; 2]) -> RenderedText {
        let stroke = style.stroke.map_or(0.0, |s| s.1);
        let bg_pad = style.background.map_or([0.0, 0.0], |b| b.1);
        let pad = ((self.size * 0.5).max(stroke).max(bg_pad[0]).max(bg_pad[1]).ceil() as i32) + 2;
        let (w, h) = ((self.width.ceil() as i32 + 2 * pad + 1) as u32, (self.height.ceil() as i32 + 2 * pad + 1) as u32);
        let (left, top) = (pad as f32 + origin[0], pad as f32 + origin[1]);
        let mut fill = vec![0f32; (w * h) as usize];
        let mut outline = style.stroke.map(|_| vec![0f32; (w * h) as usize]);
        let mut ctx = ScaleContext::new();
        let mut scaler = ctx.builder(style.font.as_ref()).size(self.size).hint(false).build();
        let draw = |cov: &mut [f32], img: &swash::scale::image::Image, x: f32, y: f32| {
            let (gx, gy) = (x.floor() as i32 + img.placement.left, y.floor() as i32 - img.placement.top);
            for row in 0..img.placement.height as i32 {
                for col in 0..img.placement.width as i32 {
                    let (px, py) = (gx + col, gy + row);
                    if px < 0 || py < 0 || px >= w as i32 || py >= h as i32 {
                        continue;
                    }
                    let a = img.data[(row * img.placement.width as i32 + col) as usize] as f32 / 255.0;
                    let c = &mut cov[(py * w as i32 + px) as usize];
                    *c = *c + a - *c * a; // union of overlapping glyphs
                }
            }
        };
        for g in &self.glyphs {
            let (x, y) = (left + g.x, top + g.baseline);
            let offset = Vector::new(x.fract(), y.fract());
            if let Some(cov) = outline.as_mut() {
                // Centred on the outline, so twice as wide as its reach outside the glyph.
                let mut pen = Stroke::new(2.0 * stroke);
                pen.join(Join::Round).cap(Cap::Round);
                if let Some(img) = Render::new(&[GlyphSource::Outline]).format(Format::Alpha).style(pen).offset(offset).render(&mut scaler, g.glyph) {
                    draw(cov, &img, x, y);
                }
            }
            if let Some(img) = Render::new(&[GlyphSource::Outline]).format(Format::Alpha).offset(offset).render(&mut scaler, g.glyph) {
                draw(&mut fill, &img, x, y);
            }
        }
        // Background box, anti-aliased by distance to its rounded edge.
        let background = style.background.map(|(color, [px, py], radius)| {
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
        });
        // Composite background, then stroke, then fill (premultiplied), back to straight alpha.
        let premul = |c: [u8; 4], cov: f32| {
            let a = cov * c[3] as f32 / 255.0;
            [c[0] as f32 / 255.0 * a, c[1] as f32 / 255.0 * a, c[2] as f32 / 255.0 * a, a]
        };
        let over = |top: [f32; 4], under: [f32; 4]| [top[0] + under[0] * (1.0 - top[3]), top[1] + under[1] * (1.0 - top[3]), top[2] + under[2] * (1.0 - top[3]), top[3] + under[3] * (1.0 - top[3])];
        let mut data = Vec::with_capacity((w * h * 4) as usize);
        for i in 0..(w * h) as usize {
            let mut px = [0f32; 4];
            if let Some((c, cov)) = &background {
                px = premul(*c, cov[i]);
            }
            if let (Some((c, _)), Some(cov)) = (style.stroke, &outline) {
                px = over(premul(c, cov[i]), px);
            }
            px = over(premul(style.color, fill[i]), px);
            let a = px[3];
            let un = |v: f32| if a > 0.0 { (v / a * 255.0).round().clamp(0.0, 255.0) as u8 } else { 0 };
            data.extend_from_slice(&[un(px[0]), un(px[1]), un(px[2]), (a * 255.0).round() as u8]);
        }
        RenderedText {
            image: RgbaImage { width: w, height: h, data },
            center: [(left + self.width / 2.0) as f64, (top + self.height / 2.0) as f64],
        }
    }
}
