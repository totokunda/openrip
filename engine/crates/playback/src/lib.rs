//! Frame serving for the preview.
//!
//! A [`FrameServer`] owns one source's decoder on its own thread. Requests carry a time and
//! a [`SeekMode`]; the newest request always wins (a request still waiting when a newer one
//! arrives is dropped, never decoded), so a fast scrub never queues up stale seeks.
//!
//! The two modes follow CapCut (docs/parity/capcut-decode.md):
//! - [`SeekMode::Accurate`] returns the exact frame shown at the time.
//! - [`SeekMode::Scrub`] answers with an already decoded frame if one starts within the
//!   tolerance, and decodes the exact frame when that needs no seek (a slow drag forward).
//!   When a seek is unavoidable it shows the GOP's keyframe if that is within tolerance,
//!   and otherwise goes on to the exact frame.
//!   The UI widens the tolerance with drag speed and sends one accurate request when the
//!   drag ends.

pub mod animation;
pub mod caption;
pub mod colour;
mod gif;
pub mod mask;
pub mod output;
pub mod pipeline;
mod player;
pub mod preview;
mod scrub;
mod server;
pub mod sticker;
pub mod thumbs;
pub mod transition;
mod waveform;

pub use pipeline::{Clock, PipelineStats, PreviewPipeline, RenderedFrame, Surface};
pub use output::{audio_output, set_audio_output, AudioOutput, OutputStream};
pub use player::{Player, PlayerError};
pub use preview::{FrameReport, PreviewEngine, PreviewError};
pub use server::{Delivered, FrameServer, Quality, SeekMode, ServerStats};
pub use thumbs::{Pass, Thumb, Thumbnailer};
pub use waveform::waveform;
