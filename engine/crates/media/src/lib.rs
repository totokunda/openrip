//! Demux and decode through FFmpeg, with hardware decode (VideoToolbox on macOS).
//!
//! Time is [`Micros`] measured from the first frame of the stream, the way CapCut's
//! `source_timerange` addresses media. [`VideoDecoder::frame_at`] is frame-accurate: it returns
//! the frame displayed at a time (the last frame starting at or before it), decoding
//! forward from the previous keyframe when it has to, and decoding straight on when the
//! target is just ahead (scrubbing and playback).
//!
//! Hardware frames stay on the GPU: on macOS a decoded frame is a `CVPixelBuffer` backed by
//! an `IOSurface` (NV12 for 8-bit, P010 for 10-bit), ready for zero-copy hand-off.

mod cache;
mod decode;
mod error;
mod frame;
mod info;
mod nal;
mod util;
#[cfg(target_os = "macos")]
mod vt;

pub use decode::{DecodeStats, DecoderOptions, HardwareMode, VideoDecoder};
pub use error::MediaError;
pub use frame::{Matrix, PixelFormat, RgbImage, VideoFrame};
pub use info::{probe, AudioInfo, ColorInfo, MediaInfo, VideoInfo};
pub use openrip_model::{FrameRate, Micros};

/// Start the platform's hardware decoder on a background thread. The first VideoToolbox
/// session in a process costs ~80 ms (later ones ~2 ms), so call this at engine start to keep
/// it off the first clip the user opens.
pub fn warm_up() -> std::thread::JoinHandle<()> {
    std::thread::spawn(|| {
        #[cfg(target_os = "macos")]
        vt::warm_up();
    })
}

/// FFmpeg library versions in use, e.g. for diagnostics.
pub fn ffmpeg_versions() -> String {
    let v = |n: u32| format!("{}.{}.{}", n >> 16, (n >> 8) & 0xff, n & 0xff);
    unsafe {
        format!(
            "avformat {}, avcodec {}, avutil {}",
            v(ffmpeg_sys_next::avformat_version()),
            v(ffmpeg_sys_next::avcodec_version()),
            v(ffmpeg_sys_next::avutil_version())
        )
    }
}
