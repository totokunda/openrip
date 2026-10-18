//! The video decode seam: what the engine asks of a decoder, and the backends that give it.
//!
//! [`VideoSource`] is one stream decoded by time, the way playback, thumbnails and export
//! use it: the exact frame shown at a time, a quick stand-in while scrubbing, keyframes for
//! timeline strips. [`open_video`] asks each backend in turn: those a client added with
//! [`add_video_backend`] first, then the built-in ones. A backend that can't take a file
//! says so with [`MediaError::Unsupported`] and the next one tries.
//!
//! Built in today (the `ffmpeg` feature):
//! - FFmpeg demux and decode (`VideoDecoder`), with VideoToolbox on Apple platforms,
//!   natively for H.264/HEVC in MP4/MOV and through FFmpeg's hwaccel otherwise.
//!
//! Not written yet (each would be a backend added here, demuxing with FFmpeg or the
//! platform's own demuxer):
//! - todo: MediaCodec on Android (an `AImage`/`AHardwareBuffer` per frame, imported as a
//!   Vulkan texture by the compositor's interop).
//! - todo: WebCodecs on the web (`VideoDecoder` producing `VideoFrame`s, imported as
//!   WebGPU external textures).

use std::path::Path;
use std::sync::{Arc, RwLock};

use crate::{MediaError, Micros, VideoFrame, VideoInfo};

/// Whether to decode on the GPU.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum HardwareMode {
    /// Hardware when the platform and codec support it, software otherwise.
    #[default]
    Auto,
    /// Always decode in software.
    Off,
    /// Fail rather than fall back to software.
    Require,
}

#[derive(Clone, Debug)]
pub struct DecoderOptions {
    pub hardware: HardwareMode,
    /// Software decoding threads; 0 picks automatically.
    pub threads: u32,
    /// Drive VideoToolbox directly for H.264/HEVC in MP4/MOV, instead of through FFmpeg's
    /// hwaccel: several frames in flight instead of one, and frames a seek only needs as
    /// references are never output. Several times faster; on by default.
    pub native_videotoolbox: bool,
    /// Memory for recently decoded frames (so stepping backward doesn't re-decode a GOP
    /// per frame). 0 disables the cache.
    pub cache_bytes: usize,
    /// Smaller pictures for stand-ins shown small (scrubbing): when non-zero, pictures are
    /// shrunk by the largest whole factor that keeps their long side at least this many
    /// pixels. VideoToolbox scales them as it decodes; only the native VideoToolbox path
    /// does this, other frames come at the stream's size.
    pub shrink_to: u32,
}

impl Default for DecoderOptions {
    fn default() -> Self {
        DecoderOptions { hardware: HardwareMode::Auto, threads: 0, native_videotoolbox: true, cache_bytes: 384 << 20, shrink_to: 0 }
    }
}

/// Counters for benchmarks and diagnostics.
#[derive(Copy, Clone, Debug, Default)]
pub struct DecodeStats {
    /// Pictures decoded, including ones only needed as references while seeking.
    pub frames_decoded: u64,
    /// Demuxer seeks performed.
    pub seeks: u64,
    /// Packets the decoder rejected (skipped).
    pub decode_errors: u64,
    /// Hardware sessions restarted after seeking to an open-GOP keyframe.
    pub sessions_reset: u64,
    /// Requests answered from the frame cache.
    pub cache_hits: u64,
    /// Pictures nothing references, skipped (not decoded) on the way to a seek target.
    pub skipped_disposable: u64,
}

/// One video stream, decoded by time. Times are from the stream's first frame.
pub trait VideoSource: Send {
    fn info(&self) -> &VideoInfo;
    /// True if the decoder was set up for hardware decoding (individual frames may still
    /// fall back to software).
    fn hardware(&self) -> bool;
    /// Keyframes come quickly and at the requested `shrink_to` size (native VideoToolbox),
    /// so they're worth getting ready ahead of a drag.
    fn quick_keyframes(&self) -> bool;
    fn stats(&self) -> DecodeStats;
    /// The next frame in presentation order, or `None` at the end of the stream.
    fn next_frame(&mut self) -> Result<Option<VideoFrame>, MediaError>;
    /// The frame displayed at time `t`: the last frame starting at or before `t` (the last
    /// frame of the stream if `t` is past its end, the first if `t` is before it).
    fn frame_at(&mut self, t: Micros) -> Result<Option<VideoFrame>, MediaError>;
    /// The exact frame at `t` if it is already decoded, or else the closest decoded frame
    /// starting within `tolerance` of `t`. Never decodes. The flag says whether it is exact.
    fn frame_near(&self, t: Micros, tolerance: Micros) -> Option<(VideoFrame, bool)>;
    /// The keyframe at or before `t`: one GOP start decoded, nothing after it. A cheap
    /// stand-in while scrubbing; a later `frame_at` in the same GOP continues from it.
    fn keyframe_at(&mut self, t: Micros) -> Result<Option<VideoFrame>, MediaError>;
    /// Start of the keyframe at or before `t`, from the container's index; `None` when there
    /// is no index or nothing precedes `t`.
    fn keyframe_time(&self, t: Micros) -> Option<Micros>;
    /// Every keyframe's start in the container's index, in order; empty without an index.
    fn keyframe_times(&self) -> Vec<Micros>;
    /// Time of the last frame decoded, and the nominal time between frames.
    fn position(&self) -> (Option<Micros>, Micros);
    /// Whether the frame at `t` can be reached without a seek.
    fn reachable_without_seek(&self, t: Micros) -> bool;
}

/// An open video stream, from whichever backend took it.
pub type Decoder = Box<dyn VideoSource>;

/// Opens video streams.
pub trait VideoBackend: Send + Sync {
    fn name(&self) -> &'static str;
    /// The video stream of the asset at `path`; [`MediaError::Unsupported`] if this backend
    /// can't take it (the next one tries).
    fn open(&self, path: &Path, opts: &DecoderOptions) -> Result<Decoder, MediaError>;
}

static ADDED: RwLock<Vec<Arc<dyn VideoBackend>>> = RwLock::new(Vec::new());

/// Try `backend` before the ones tried so far (a platform's native decoder, say).
pub fn add_video_backend(backend: Arc<dyn VideoBackend>) {
    ADDED.write().unwrap().insert(0, backend);
}

/// The backends [`open_video`] tries, in order.
pub fn video_backends() -> Vec<Arc<dyn VideoBackend>> {
    let mut out = ADDED.read().unwrap().clone();
    out.extend(built_in());
    out
}

fn built_in() -> Vec<Arc<dyn VideoBackend>> {
    #[cfg(feature = "ffmpeg")]
    return vec![Arc::new(crate::decode::Ffmpeg)];
    #[cfg(not(feature = "ffmpeg"))]
    Vec::new()
}

/// Open the video stream of the asset at `path` with the first backend that takes it.
pub fn open_video(path: &Path, opts: &DecoderOptions) -> Result<Decoder, MediaError> {
    let mut declined = None;
    for backend in video_backends() {
        match backend.open(path, opts) {
            Err(e @ MediaError::Unsupported { .. }) => declined = Some(e),
            done => return done,
        }
    }
    Err(declined.unwrap_or_else(|| MediaError::Unsupported { path: path.into(), msg: "no video decoder in this build (see docs/plan/portability.md)".into() }))
}
