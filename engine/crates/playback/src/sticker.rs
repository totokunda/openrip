//! Stickers (CapCut's info stickers): a library image or looping GIF, read from the bundle the
//! draft points at and drawn centred on the segment's position, turned and scaled with it.
//!
//! Their size at scale 1 is provisional (docs/parity/stickers.md): CapCut's rule isn't in
//! anything readable, and the one export with a sticker shown couldn't be read when this was
//! written. A sticker is drawn at its pixel size on a canvas 1080 pixels wide, scaled with the
//! canvas width, as CapCut sizes text by the canvas width.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use openrip_model::{Micros, Sticker};
use openrip_render::RgbaImage;

/// The canvas width a sticker's pixels are drawn at one to one (provisional).
pub const STICKER_CANVAS_WIDTH: f64 = 1080.0;

/// A sticker's size on an output `canvas_w` pixels wide, at its scale 1, for a frame of
/// `w`×`h` pixels.
pub fn size_on_canvas(w: u32, h: u32, canvas_w: u32) -> [f64; 2] {
    let k = canvas_w as f64 / STICKER_CANVAS_WIDTH;
    [w as f64 * k, h as f64 * k]
}

/// A sticker's frames and when each ends within one loop (µs), and the loop's length.
struct Frames {
    frames: Vec<(Arc<RgbaImage>, i64)>,
    period: i64,
}

impl Frames {
    /// The frame shown `local` into the clip (looping), and its index.
    fn at(&self, local: Micros) -> (usize, &Arc<RgbaImage>) {
        let t = if self.period > 0 { local.0.rem_euclid(self.period) } else { 0 };
        let i = self.frames.iter().position(|(_, end)| t < *end).unwrap_or(self.frames.len() - 1);
        (i, &self.frames[i].0)
    }
}

/// Decoded stickers by file, with the tick each was last drawn in.
#[derive(Default)]
pub struct Stickers {
    loaded: HashMap<String, (Arc<Frames>, u64)>,
}

/// Stickers not drawn for this many frames are let go (a 100-frame GIF is 30 MB decoded).
const KEEP_TICKS: u64 = 300;

impl Stickers {
    /// The sticker's picture `local` into its clip, with a key for the GPU's cache, or why it
    /// can't be drawn (no bundle, unreadable file).
    pub fn frame(&mut self, sticker: &Sticker, local: Micros, tick: u64) -> Result<(Arc<RgbaImage>, u64), String> {
        if sticker.path.is_empty() {
            return Err("the sticker's bundle isn't in CapCut's cache".into());
        }
        self.loaded.retain(|_, (_, last)| tick.saturating_sub(*last) < KEEP_TICKS);
        if !self.loaded.contains_key(&sticker.path) {
            let frames = load(Path::new(&sticker.path), sticker.animated)?;
            self.loaded.insert(sticker.path.clone(), (Arc::new(frames), tick));
        }
        let (frames, last) = self.loaded.get_mut(&sticker.path).unwrap();
        *last = tick;
        let (i, img) = frames.at(local);
        let key = {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            ("sticker", &sticker.path, i).hash(&mut h);
            h.finish()
        };
        Ok((img.clone(), key))
    }
}

fn load(path: &Path, animated: bool) -> Result<Frames, String> {
    if !animated {
        let img = crate::preview::load_png(path).map_err(|e| e.to_string())?;
        return Ok(Frames { frames: vec![(Arc::new(img), 1)], period: 0 });
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let decoded = crate::gif::decode(&bytes).ok_or("not a GIF")?;
    let mut end = 0i64;
    let frames = decoded
        .into_iter()
        .map(|f| {
            end += f.delay_ms as i64 * 1000;
            (Arc::new(f.image), end)
        })
        .collect();
    Ok(Frames { frames, period: end })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gif_frames_loop_by_their_delays() {
        let img = |v: u8| Arc::new(RgbaImage { width: 1, height: 1, data: vec![v, v, v, 255] });
        let f = Frames { frames: vec![(img(1), 100_000), (img(2), 300_000)], period: 300_000 };
        assert_eq!(f.at(Micros(0)).0, 0);
        assert_eq!(f.at(Micros(150_000)).0, 1);
        // The next loop.
        assert_eq!(f.at(Micros(320_000)).0, 0);
        assert_eq!(f.at(Micros(599_999)).0, 1);
    }

    #[test]
    fn size_follows_the_canvas_width() {
        assert_eq!(size_on_canvas(280, 280, 1080), [280.0, 280.0]);
        assert_eq!(size_on_canvas(540, 270, 540), [270.0, 135.0]);
    }

    #[test]
    fn a_sticker_without_its_bundle_is_reported() {
        let mut s = Stickers::default();
        let st = Sticker { id: openrip_model::MaterialId("k".into()), path: String::new(), animated: false, width: 0, height: 0, library: None };
        assert!(s.frame(&st, Micros(0), 1).is_err());
    }
}
