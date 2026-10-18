//! Demux and decode through FFmpeg, with hardware decode (VideoToolbox on Apple), behind
//! the decode seams (`backend.rs` for video, `still.rs` for stills).
//!
//! FFmpeg is the `ffmpeg` feature (on by default). Without it the crate is the seams, the
//! frame and stream types and PNG decoding: a platform backend added at run time
//! ([`add_video_backend`], [`add_still_backend`]) does the decoding.
//!
//! Time is [`Micros`] measured from the first frame of the stream, the way CapCut's
//! `source_timerange` addresses media. [`VideoDecoder::frame_at`] is frame-accurate: it returns
//! the frame displayed at a time (the last frame starting at or before it), decoding
//! forward from the previous keyframe when it has to, and decoding straight on when the
//! target is just ahead (scrubbing and playback).
//!
//! Hardware frames stay on the GPU: on Apple platforms a decoded frame is a `CVPixelBuffer`
//! backed by an `IOSurface` (NV12 for 8-bit, P010 for 10-bit), ready for zero-copy
//! hand-off. Frames are [`VideoFrame`]s of `openrip-frame`, which the compositor takes
//! without depending on this crate; FFmpeg's and VideoToolbox's buffers are their pixels
//! here.

mod backend;
#[cfg(feature = "ffmpeg")]
mod cache;
#[cfg(feature = "ffmpeg")]
mod decode;
mod error;
#[cfg(feature = "ffmpeg")]
mod frame;
mod info;
#[cfg(feature = "ffmpeg")]
mod nal;
#[cfg(feature = "ffmpeg")]
mod probe;
mod reverse;
mod still;
#[cfg(feature = "ffmpeg")]
mod util;
#[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
mod vt;

pub use backend::{add_video_backend, default_hardware, open_video, set_default_hardware, video_backends, DecodeStats, Decoder, DecoderOptions, HardwareMode, VideoBackend, VideoSource};
#[cfg(feature = "ffmpeg")]
pub use decode::VideoDecoder;
pub use error::MediaError;
pub use info::{AudioInfo, ColorInfo, MediaInfo, VideoInfo};
pub use openrip_frame::{FrameError, FramePixels, Matrix, PixelFormat, RgbImage, RgbaImage, Transfer, VideoFrame};
#[cfg(feature = "ffmpeg")]
pub use probe::probe;
pub use openrip_model::{FrameRate, Micros};
pub use reverse::{ReverseReader, ReverseStats};
pub use still::{add_still_backend, decode_still, load_png, StillBackend};

/// Start the platform's hardware decoder in the background. The first VideoToolbox session
/// in a process costs ~80 ms (later ones ~2 ms), so call this at engine start to keep it off
/// the first clip the user opens.
pub fn warm_up() -> openrip_platform::tasks::Task {
    openrip_platform::tasks::spawn("decoder-warm-up", || {
        #[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
        vt::warm_up();
    })
    .unwrap_or_else(|_| openrip_platform::tasks::Task::done())
}

/// FFmpeg library versions in use, e.g. for diagnostics.
#[cfg(feature = "ffmpeg")]
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
