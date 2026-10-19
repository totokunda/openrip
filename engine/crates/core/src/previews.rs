//! Frames of a small project drawn by the engine's own renderer, for a client's libraries (the
//! Text tab's templates): the project is given as JSON (any format [`parse_project_json`]
//! reads), drawn exactly as the player and an export draw it, and each frame can be cropped to
//! the part a tile shows. Holds one preview engine (its fonts, text and shape caches), made on
//! first use and kept between calls.

use std::sync::Mutex;

use openrip_model::Micros;
use openrip_playback::PreviewEngine;

use crate::{parse_project_json, Error, Image, Result};

/// Draws frames of projects given as JSON.
pub struct ProjectPreviews {
    engine: Mutex<Option<PreviewEngine>>,
}

impl Default for ProjectPreviews {
    fn default() -> Self {
        Self::new()
    }
}

impl ProjectPreviews {
    pub const fn new() -> Self {
        ProjectPreviews { engine: Mutex::new(None) }
    }

    /// The frames of the project in `json` at `times` (seconds), each drawn `width` × `height`
    /// and cropped to `crop` (`[x, y, width, height]` as fractions of the frame) when given.
    pub fn frames(&self, json: &str, times: &[f64], width: u32, height: u32, crop: Option<[f64; 4]>) -> Result<Vec<Image>> {
        let (project, _) = parse_project_json(json)?;
        let mut guard = self.engine.lock().unwrap();
        match guard.as_mut() {
            Some(engine) => engine.set_project(project),
            None => *guard = Some(PreviewEngine::new(project)?),
        }
        let engine = guard.as_mut().ok_or(Error::NoProject)?;
        let (width, height) = (width.clamp(8, 4096), height.clamp(8, 4096));
        times
            .iter()
            .map(|&t| {
                let (img, _) = engine.render_image(Micros::from_secs_f64(t.max(0.0)), width, height)?;
                Ok(match crop {
                    Some(c) => cropped(&img.data, img.width, img.height, c),
                    None => Image { width: img.width, height: img.height, data: img.data },
                })
            })
            .collect()
    }
}

/// `rgba` (`width` × `height`, 4 bytes a pixel) cut to `crop` (fractions of the frame, kept
/// inside it).
fn cropped(rgba: &[u8], width: u32, height: u32, crop: [f64; 4]) -> Image {
    let x0 = ((crop[0] * width as f64).round().max(0.0) as u32).min(width.saturating_sub(1));
    let y0 = ((crop[1] * height as f64).round().max(0.0) as u32).min(height.saturating_sub(1));
    let w = ((crop[2] * width as f64).round().max(1.0) as u32).min(width - x0);
    let h = ((crop[3] * height as f64).round().max(1.0) as u32).min(height - y0);
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for row in y0..y0 + h {
        let from = ((row * width + x0) * 4) as usize;
        data.extend_from_slice(&rgba[from..from + (w * 4) as usize]);
    }
    Image { width: w, height: h, data }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_keeps_the_asked_part() {
        // A 4 × 2 frame whose pixel (x, y) is [x, y, 0, 255].
        let mut rgba = Vec::new();
        for y in 0..2u8 {
            for x in 0..4u8 {
                rgba.extend_from_slice(&[x, y, 0, 255]);
            }
        }
        let img = cropped(&rgba, 4, 2, [0.25, 0.5, 0.5, 0.5]);
        assert_eq!((img.width, img.height), (2, 1));
        assert_eq!(&img.data[..4], &[1, 1, 0, 255]);
        assert_eq!(&img.data[4..8], &[2, 1, 0, 255]);
    }

    #[test]
    fn crop_stays_inside_the_frame() {
        let rgba = vec![9u8; 4 * 4 * 4];
        let img = cropped(&rgba, 4, 4, [0.75, 0.75, 1.0, 1.0]);
        assert_eq!((img.width, img.height), (1, 1));
        let img = cropped(&rgba, 4, 4, [-1.0, -1.0, 0.5, 0.5]);
        assert_eq!((img.width, img.height), (2, 2));
    }
}
