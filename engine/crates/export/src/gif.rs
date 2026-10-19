//! GIF export: the project's frames from the renderer, each quantised to its own 256-colour
//! palette (NeuQuant) and written as an endlessly looping GIF. Pure Rust, so it works
//! wherever the renderer does; sound has no place in a GIF.

use std::borrow::Cow;
use std::path::Path;
use std::time::Instant;

use color_quant::NeuQuant;
use openrip_model::{FrameRate, Micros, Project};
use openrip_playback::PreviewEngine;

use crate::{ExportError, ExportStats};

#[derive(Clone, Debug)]
pub struct GifOptions {
    /// The picture's shorter side in pixels (CapCut's "240P", "320P", "640P"); the longer
    /// follows the project's ratio.
    pub short_side: u32,
    /// Frames a second (a GIF's delays are in hundredths of a second; 15 is the usual).
    pub fps: f64,
}

impl Default for GifOptions {
    fn default() -> Self {
        GifOptions { short_side: 240, fps: 15.0 }
    }
}

/// The size a GIF of `canvas` (width, height) has with the shorter side `short_side`.
pub fn gif_size(canvas: (u32, u32), short_side: u32) -> (u32, u32) {
    let (cw, ch) = (canvas.0.max(1) as f64, canvas.1.max(1) as f64);
    let s = short_side.max(2) as f64;
    let (w, h) = if cw >= ch { (s * cw / ch, s) } else { (s, s * ch / cw) };
    ((w.round() as u32).clamp(2, 65_535), (h.round() as u32).clamp(2, 65_535))
}

/// Render `project` to the GIF at `path`. `progress` gets (frame, total) and returns whether to
/// go on; stopping removes the unfinished file and returns [`ExportError::Cancelled`].
pub fn export_gif(project: Project, path: &Path, o: &GifOptions, mut progress: impl FnMut(u64, u64) -> bool) -> Result<ExportStats, ExportError> {
    let t0 = Instant::now();
    let (w, h) = gif_size((project.canvas.width, project.canvas.height), o.short_side);
    let fps = FrameRate::from_f64(o.fps.clamp(1.0, 50.0));
    let duration = project.duration();
    let total = fps.frame_of(Micros(duration.0 - 1)).max(0) as u64 + 1;
    let mut engine = PreviewEngine::new(project)?;
    let file = std::fs::File::create(path).map_err(|e| ExportError::Other(format!("can't write {}: {e}", path.display())))?;
    let mut writer = std::io::BufWriter::new(file);
    let result = (|| -> Result<ExportStats, ExportError> {
        let gif_err = |e: gif::EncodingError| ExportError::Other(format!("gif: {e}"));
        let mut enc = gif::Encoder::new(&mut writer, w as u16, h as u16, &[]).map_err(gif_err)?;
        enc.set_repeat(gif::Repeat::Infinite).map_err(gif_err)?;
        let mut stats = ExportStats::default();
        let mut shown_cs = 0i64;
        let sample = if w * h > 150_000 { 20 } else { 8 };
        for n in 0..total {
            let r0 = Instant::now();
            let (img, report) = engine.render_image(fps.frame_start(n as i64), w, h)?;
            stats.render_seconds += r0.elapsed().as_secs_f64();
            stats.skipped_layers += report.missing.len() as u64;
            // The delay that puts this frame's end at its time, to the hundredth of a second.
            let end_cs = (fps.frame_start(n as i64 + 1).0.min(duration.0) as f64 / 10_000.0).round() as i64;
            let delay = (end_cs - shown_cs).clamp(1, 65_535);
            shown_cs += delay;
            let q = NeuQuant::new(sample, 256, &img.data);
            let indices: Vec<u8> = img.data.chunks_exact(4).map(|p| q.index_of(p) as u8).collect();
            let frame = gif::Frame {
                width: img.width as u16,
                height: img.height as u16,
                delay: delay as u16,
                dispose: gif::DisposalMethod::Any,
                buffer: Cow::Owned(indices),
                palette: Some(q.color_map_rgb()),
                ..gif::Frame::default()
            };
            enc.write_frame(&frame).map_err(gif_err)?;
            stats.frames += 1;
            if !progress(n + 1, total) {
                return Err(ExportError::Cancelled);
            }
        }
        Ok(stats)
    })();
    drop(writer);
    match result {
        Ok(mut s) => {
            s.seconds = t0.elapsed().as_secs_f64();
            s.encode_seconds = s.seconds - s.render_seconds;
            Ok(s)
        }
        Err(e) => {
            let _ = std::fs::remove_file(path);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_follow_the_ratio() {
        assert_eq!(gif_size((1920, 1080), 240), (427, 240));
        assert_eq!(gif_size((1080, 1920), 240), (240, 427));
        assert_eq!(gif_size((1000, 1000), 320), (320, 320));
    }
}
