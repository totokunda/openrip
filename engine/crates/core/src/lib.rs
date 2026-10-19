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
//! - [`effect_catalog`] and [`EffectPreviews`]: OpenRip's own video effects and frames of them.
//! - [`Thumbnails`]: timeline thumbnails, waveforms and beats, cached on disk.
//! - [`measure_loudness`] and [`Recorder`]: a clip's loudness for loudness normalisation, and
//!   voiceover recording from the microphone (behind the audio input seam).
//! - [`export_project`]: render and encode a project, with progress and cancel.
//! - [`export_audio`], [`export_gif`]: the sound alone as WAV/FLAC/MP3/AAC, and a looping GIF.
//! - [`capcut_to_app`]: a CapCut draft converted to the app's project document.
//! - [`register_fonts`] / [`font_families`]: the client's fonts (the app's bundled web
//!   fonts) for text, and the families text can be drawn in.
//! - [`track_region`]: a region of a video followed through its frames (motion tracking), with
//!   progress and cancel.
//! - [`detect_scenes`], [`color_stats`] and [`auto_adjust`]: Split scenes, and the colour
//!   statistics Color match and Auto adjust work from, with progress and cancel.

mod analysis;
mod audio;
mod capcut;
mod effects;
mod export;
mod fonts;
mod project;
mod session;
mod speech;
mod thumbs;
mod track;

use openrip_audio::AudioError;
use openrip_export::ExportError;
use openrip_playback::PreviewError;

pub use analysis::{auto_adjust, color_stats, detect_scenes, AnalysisControl, AutoAdjust, ColorStats, CutKind, Look, MatchOn, Moments, SceneCut, SceneOptions, Sliders};
pub use audio::{measure_loudness, set_audio_input, Level, Loudness, Recorder, Recording, ToneInput};
pub use capcut::{capcut_to_app, AppProjectFromDraft};
pub use effects::{effect_catalog, EffectPreviews};
pub use export::{codec_named, export_audio, export_gif, export_project, Codec, ExportControl, ExportOptions, ExportProgress, ExportResult};
pub use fonts::{font_face, font_families, register_fonts, FontFace, FontFamily};
pub use openrip_model::{Micros, Project};
/// The Adjust sliders (the draft's −1…1), for a [`Look`].
pub use openrip_render::Adjust;
pub use project::{load_project, parse_project_json, ProjectInfo, Source, TextBlock};
pub use session::{DisplayFrame, FrameHandle, FrameJob, Image, RenderedFrame, Renderer, Session, Surface};
pub use speech::{build_captions, decode_speech_audio, mix_speech_audio, models, transcribe, transcribe_audio, Caption, CaptionOptions, CaptionWord, Model, Segment, SpeechControl, SpeechError, SpeechInput, Transcript, Word, DEFAULT_MODEL, HAS_WHISPER, MODELS};
pub use thumbs::{Beats, Thumbnail, Thumbnails, Waveform};
pub use track::{track_region, TrackControl, TrackDirection, TrackRequest, TrackResult, TrackSample};

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
    /// Motion tracking couldn't go on ("cancelled" when asked to stop).
    #[error("{0}")]
    Track(String),
    /// An analysis stopped ("cancelled") or couldn't read its media.
    #[error("{0}")]
    Analysis(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// The engine's version, so a client can tell which engine it loaded.
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Decode video on the GPU where the platform can (on, the default) or always in software
/// (off). Media opened from then on follow it; what's open keeps its decoder.
pub fn set_hardware_decoding(on: bool) {
    openrip_media::set_default_hardware(if on { openrip_media::HardwareMode::Auto } else { openrip_media::HardwareMode::Off });
}

/// Whether video is decoded on the GPU where it can be ([`set_hardware_decoding`]).
pub fn hardware_decoding() -> bool {
    openrip_media::default_hardware() != openrip_media::HardwareMode::Off
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
