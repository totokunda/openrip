//! The engine's public API as plain Rust: what every client calls, whatever it's written in.
//!
//! The Electron app reaches it through the Node addon (`openrip-node`), a thin napi wrapper
//! over this crate. A Swift or Kotlin binding (UniFFI or a C ABI) or a wasm-bindgen one for
//! the web wraps the same calls; nothing here knows about JavaScript. Times are
//! microseconds on the timeline unless a name says otherwise.
//!
//! - [`load_project`] / [`parse_project_json`]: a CapCut draft, an OpenRip project or a v1
//!   project (the app's own format) as a [`Project`].
//! - [`Session`]: one open project for preview: render frames into surfaces the platform
//!   shows, play with the audio clock, swap in edits.
//! - [`Thumbnails`]: timeline thumbnails, waveforms and beats, cached on disk.
//! - [`measure_loudness`] and [`Recorder`]: a clip's loudness for loudness normalisation, and
//!   voiceover recording from the microphone (behind the audio input seam).
//! - [`export_project`]: render and encode a project, with progress and cancel.
//! - [`capcut_to_app`]: a CapCut draft converted to the app's project document.

mod audio;
mod capcut;
mod export;
mod project;
mod session;
mod thumbs;

use openrip_audio::AudioError;
use openrip_export::ExportError;
use openrip_playback::PreviewError;

pub use audio::{measure_loudness, set_audio_input, Level, Loudness, Recorder, Recording, ToneInput};
pub use capcut::{capcut_to_app, AppProjectFromDraft};
pub use export::{codec_named, export_project, Codec, ExportControl, ExportOptions, ExportProgress, ExportResult};
pub use openrip_model::{Micros, Project};
pub use project::{load_project, parse_project_json, ProjectInfo, Source, TextBlock};
pub use session::{DisplayFrame, FrameHandle, FrameJob, Image, RenderedFrame, Renderer, Session, Surface};
pub use thumbs::{Beats, Thumbnail, Thumbnails, Waveform};

/// Everything the API can fail with. The messages are what a client shows (the app's
/// promises reject with them), so they stay stable.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no project open")]
    NoProject,
    #[error("project closed")]
    Closed,
    #[error("call setPreviewSize first")]
    NoPreview,
    #[error("can't allocate a frame surface")]
    NoSurface,
    #[error("frame has no IOSurface")]
    NoIoSurface,
    #[error(transparent)]
    CapCut(#[from] openrip_capcut::ImportError),
    #[error(transparent)]
    V1(#[from] openrip_v1::ImportError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Preview(#[from] PreviewError),
    #[error(transparent)]
    Export(#[from] ExportError),
    #[error(transparent)]
    Audio(#[from] AudioError),
    #[error(transparent)]
    Player(#[from] openrip_playback::PlayerError),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// The engine's version, so a client can tell which engine it loaded.
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// What this build of the engine is and has.
#[derive(Clone, Debug)]
pub struct EngineInfo {
    pub version: String,
    /// FFmpeg's library versions; `None` in a build without FFmpeg.
    pub ffmpeg: Option<String>,
}

pub fn info() -> EngineInfo {
    #[cfg(feature = "ffmpeg")]
    let ffmpeg = Some(openrip_media::ffmpeg_versions());
    #[cfg(not(feature = "ffmpeg"))]
    let ffmpeg = None;
    EngineInfo { version: version(), ffmpeg }
}
