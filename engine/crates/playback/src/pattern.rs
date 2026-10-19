//! OpenRip's own canvas patterns (the video's Canvas ▸ Style): small tiles drawn in code, laid
//! over the canvas behind a main-track clip that doesn't cover it. Each is a shape on a
//! background in two colours, repeating every sixth of the canvas's short side. The app draws
//! its swatches from the same shapes (`lib/canvas-patterns.ts` keeps the same table), so a
//! swatch is what the canvas gets.

use openrip_render::RgbaImage;

/// A pattern: its id and the background and shape colours (RGB).
pub struct Pattern {
    pub id: &'static str,
    pub back: [u8; 3],
    pub shape: [u8; 3],
}

/// The patterns, in the order the app lists them.
pub const PATTERNS: &[Pattern] = &[
    Pattern { id: "dots", back: [0x1f, 0x2a, 0x44], shape: [0xf5, 0xc5, 0x42] },
    Pattern { id: "stripes", back: [0xf4, 0xe9, 0xd8], shape: [0xe0, 0x5a, 0x47] },
    Pattern { id: "diagonal", back: [0x12, 0x6e, 0x82], shape: [0xf2, 0xf2, 0xf2] },
    Pattern { id: "checks", back: [0x2b, 0x2b, 0x2b], shape: [0xd9, 0xd9, 0xd9] },
    Pattern { id: "grid", back: [0x14, 0x3d, 0x59], shape: [0x5f, 0xb0, 0xe0] },
    Pattern { id: "plus", back: [0xf7, 0xd4, 0xe0], shape: [0x9b, 0x3d, 0x68] },
    Pattern { id: "diamonds", back: [0x2e, 0x1a, 0x47], shape: [0xae, 0x81, 0xce] },
    Pattern { id: "waves", back: [0x0c, 0x4a, 0x6e], shape: [0x7f, 0xd1, 0xd8] },
    Pattern { id: "zigzag", back: [0xff, 0xf1, 0xa8], shape: [0xf7, 0x6b, 0x15] },
    Pattern { id: "triangles", back: [0x1b, 0x4d, 0x3e], shape: [0xa8, 0xe0, 0x8a] },
    Pattern { id: "bricks", back: [0xc4, 0x6a, 0x4e], shape: [0xf1, 0xe4, 0xd3] },
    Pattern { id: "rings", back: [0x3a, 0x3a, 0x4a], shape: [0xe8, 0x8f, 0xb3] },
];

pub fn find(id: &str) -> Option<&'static Pattern> {
    PATTERNS.iter().find(|p| p.id == id)
}

/// Whether the point (u, v) of a tile (0..1 across and down) is on the shape rather than the
/// background.
fn on_shape(id: &str, u: f32, v: f32) -> bool {
    let tri = |x: f32| 1.0 - (2.0 * x - 1.0).abs();
    match id {
        "dots" => (u - 0.5).hypot(v - 0.5) < 0.26,
        "stripes" => u < 0.5,
        "diagonal" => (u + v).fract() < 0.5,
        "checks" => (u < 0.5) != (v < 0.5),
        "grid" => u < 0.08 || v < 0.08,
        "plus" => ((u - 0.5).abs() < 0.09 && (v - 0.5).abs() < 0.3) || ((v - 0.5).abs() < 0.09 && (u - 0.5).abs() < 0.3),
        "diamonds" => (u - 0.5).abs() + (v - 0.5).abs() < 0.36,
        "waves" => (v - 0.5 - 0.22 * (std::f32::consts::TAU * u).sin()).abs() < 0.11,
        "zigzag" => (v - 0.2 - 0.6 * tri(u)).abs() < 0.1,
        "triangles" => v > 1.0 - tri(u) * 0.9 - 0.05 && v < 0.95,
        "bricks" => {
            let row = (v * 2.0).floor();
            let shifted = (u + 0.5 * (row % 2.0)).fract();
            (v * 2.0).fract() < 0.12 || shifted < 0.06
        }
        "rings" => {
            let r = (u - 0.5).hypot(v - 0.5);
            r > 0.2 && r < 0.34
        }
        _ => false,
    }
}

/// One tile, `period` pixels square, with its edges smoothed (4×4 samples a pixel).
pub fn tile(id: &str, period: u32) -> Option<RgbaImage> {
    let p = find(id)?;
    let period = period.max(2);
    let mut data = Vec::with_capacity((period * period * 4) as usize);
    for y in 0..period {
        for x in 0..period {
            let mut hit = 0;
            for sy in 0..4 {
                for sx in 0..4 {
                    let (u, v) = ((x as f32 + (sx as f32 + 0.5) / 4.0) / period as f32, (y as f32 + (sy as f32 + 0.5) / 4.0) / period as f32);
                    hit += on_shape(id, u, v) as u32;
                }
            }
            let k = hit as f32 / 16.0;
            for c in 0..3 {
                data.push((p.back[c] as f32 + (p.shape[c] as f32 - p.back[c] as f32) * k).round() as u8);
            }
            data.push(255);
        }
    }
    Some(RgbaImage { width: period, height: period, data })
}

/// The pattern over a `w` × `h` canvas: its tiles, six across the short side, from the top left.
pub fn fill(id: &str, w: u32, h: u32) -> Option<RgbaImage> {
    let period = (w.min(h) as f32 / 6.0).round().max(2.0) as u32;
    let t = tile(id, period)?;
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        let row = ((y % period) * period * 4) as usize;
        for x in 0..w {
            let i = row + ((x % period) * 4) as usize;
            data.extend_from_slice(&t.data[i..i + 4]);
        }
    }
    Some(RgbaImage { width: w, height: h, data })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_pattern_draws_both_its_colours() {
        for p in PATTERNS {
            let t = tile(p.id, 60).unwrap();
            let at = |i: usize| [t.data[i * 4], t.data[i * 4 + 1], t.data[i * 4 + 2]];
            let (back, shape) = (t.data.chunks(4).any(|c| c[..3] == p.back), t.data.chunks(4).any(|c| c[..3] == p.shape));
            assert!(back && shape, "{} lacks a colour (first pixel {:?})", p.id, at(0));
        }
    }

    #[test]
    fn a_fill_repeats_its_tile_and_unknown_patterns_draw_nothing() {
        let f = fill("checks", 120, 120).unwrap();
        assert_eq!((f.width, f.height), (120, 120));
        // Six tiles across: the period is 20 px.
        let px = |x: u32, y: u32| f.data[((y * 120 + x) * 4) as usize];
        assert_eq!(px(3, 4), px(23, 24));
        assert!(fill("nope", 10, 10).is_none());
    }
}
