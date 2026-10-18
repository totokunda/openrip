//! Export: render a project frame by frame and encode it to a video file.
//!
//! The render loop is the same everywhere; what takes the frames is an [`Encoder`], the
//! encode seam. It hands out the picture each frame is drawn into, so frames can go to a
//! hardware encoder without a copy. Built in (the `ffmpeg` feature):
//! - Apple platforms: VideoToolbox's H.264/HEVC encoder through FFmpeg, fed NV12 (BT.709, limited
//!   range) IOSurfaces the compositor renders into, muxed by FFmpeg (MP4/MOV)
//!   (`videotoolbox.rs`). CapCut exports BT.709 limited range too (calibration session 1).
//!
//! Not written yet: todo: an FFmpeg software encoder from read-back pixels
//! ([`Picture::Rgba`]) for other desktops, MediaCodec with an input surface on Android,
//! WebCodecs `VideoEncoder` on the web.
//!
//! Audio is mixed at CapCut's export rate (44.1 kHz stereo) in step with the video and
//! encoded as AAC-LC.

use std::path::Path;
use std::time::Instant;

use openrip_model::{FrameRate, Micros, Project};
use openrip_playback::{FrameReport, PreviewEngine, PreviewError};
use openrip_render::RgbaImage;

#[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
mod videotoolbox;

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("{op} failed ({code})")]
    Ffmpeg { op: &'static str, code: i32 },
    #[error(transparent)]
    Render(#[from] PreviewError),
    #[error("{0}")]
    Other(String),
    #[error("cancelled")]
    Cancelled,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Codec {
    H264,
    Hevc,
}

#[derive(Clone, Debug)]
pub struct ExportOptions {
    pub width: u32,
    pub height: u32,
    pub fps: FrameRate,
    pub codec: Codec,
    /// Bits per second.
    pub bitrate: u64,
    /// Mix and encode the audio (AAC-LC, 44.1 kHz stereo, like CapCut's exports).
    pub audio: bool,
}

/// CapCut exports AAC-LC at 44.1 kHz stereo (calibration sessions 1-2).
pub const AUDIO_RATE: u32 = 44_100;

#[derive(Clone, Debug, Default)]
pub struct ExportStats {
    pub frames: u64,
    pub seconds: f64,
    /// Time spent compositing (decode included) vs waiting on the encoder/muxer.
    pub render_seconds: f64,
    pub encode_seconds: f64,
    /// Layers skipped because their media or font was missing (summed over frames).
    pub skipped_layers: u64,
}

/// The picture an encoder wants a frame drawn into.
pub enum Picture<'a> {
    /// An IOSurface-backed NV12 (BT.709, limited range) pixel buffer the encoder takes as
    /// it is.
    #[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
    Nv12(&'a objc2_core_video::CVPixelBuffer),
    /// RGBA pixels read back from the GPU, sized to the export, for encoders that take
    /// pixels from the CPU.
    Rgba(&'a mut RgbaImage),
}

/// Where an export's frames and sound go: an encoder and muxer writing the file.
pub trait Encoder {
    /// Frame `index`: `draw` renders it into the encoder's next picture, which is then
    /// encoded. Returns what `draw` reported.
    fn video(&mut self, index: i64, draw: &mut dyn FnMut(Picture<'_>) -> Result<FrameReport, PreviewError>) -> Result<FrameReport, ExportError>;
    /// Interleaved stereo samples at [`AUDIO_RATE`]; `flush` sends the rest and drains the
    /// encoder.
    fn audio(&mut self, samples: &[f32], flush: bool) -> Result<(), ExportError>;
    /// Flush the video and close the file.
    fn finish(self: Box<Self>) -> Result<(), ExportError>;
    /// Stop and remove the unfinished file.
    fn cancel(self: Box<Self>);
}

/// The encoder this build has for `o`, writing `path`.
pub fn open_encoder(path: &Path, o: &ExportOptions) -> Result<Box<dyn Encoder>, ExportError> {
    #[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
    return Ok(Box::new(videotoolbox::VtEncoder::open(path, o)?));
    #[cfg(not(all(feature = "ffmpeg", target_vendor = "apple")))]
    {
        let _ = (path, o);
        Err(ExportError::Other("no video encoder in this build (see docs/plan/portability.md)".into()))
    }
}

/// Render `project` to `path`. `progress` gets (frame, total) after each frame and returns
/// whether to go on; stopping removes the unfinished file and returns
/// [`ExportError::Cancelled`].
pub fn export(project: Project, path: &Path, o: &ExportOptions, mut progress: impl FnMut(u64, u64) -> bool) -> Result<ExportStats, ExportError> {
    let t0 = Instant::now();
    let duration = project.duration();
    let total = o.fps.frame_of(Micros(duration.0 - 1)).max(0) as u64 + 1;
    let mut mixer = o.audio.then(|| openrip_audio::Mixer::with_rate(project.clone(), AUDIO_RATE));
    let mut mixed: i64 = 0;
    let mut block = Vec::new();
    let mut engine = PreviewEngine::new(project)?;
    let mut out = open_encoder(path, o)?;
    let mut stats = ExportStats::default();
    for n in 0..total {
        let t = o.fps.frame_start(n as i64);
        let f0 = Instant::now();
        let mut render = 0.0;
        let report = out.video(n as i64, &mut |picture| {
            let r0 = Instant::now();
            let report = match picture {
                #[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
                Picture::Nv12(pb) => engine.render_to_nv12(t, pb),
                Picture::Rgba(img) => engine.render_image(t, img.width, img.height).map(|(frame, report)| {
                    *img = frame;
                    report
                }),
            };
            render = r0.elapsed().as_secs_f64();
            report
        })?;
        stats.skipped_layers += report.missing.len() as u64;
        stats.render_seconds += render;
        // The audio up to the end of this frame.
        if let Some(m) = mixer.as_mut() {
            let until = openrip_audio::sample_at(o.fps.frame_start(n as i64 + 1).min(duration), AUDIO_RATE);
            if until > mixed {
                block.resize((until - mixed) as usize * 2, 0.0);
                m.mix(mixed, &mut block).map_err(|e| ExportError::Other(e.to_string()))?;
                out.audio(&block, false)?;
                mixed = until;
            }
        }
        stats.encode_seconds += f0.elapsed().as_secs_f64() - render;
        stats.frames += 1;
        if !progress(n + 1, total) {
            out.cancel();
            return Err(ExportError::Cancelled);
        }
    }
    let e0 = Instant::now();
    if mixer.is_some() {
        out.audio(&[], true)?;
    }
    out.finish()?;
    stats.encode_seconds += e0.elapsed().as_secs_f64();
    stats.seconds = t0.elapsed().as_secs_f64();
    Ok(stats)
}
