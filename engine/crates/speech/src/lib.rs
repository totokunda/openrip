//! Speech to captions, on the device.
//!
//! - [`captions`]: the portable part. A [`Transcript`] (words with times) is cut into
//!   [`Caption`]s: lines of a readable length, fillers left out, keywords flagged, each word
//!   with when it's spoken. Pure Rust, no model.
//! - [`models`]: the Whisper models on offer, with sizes and checksums. Clients download them.
//! - [`backend`]: the recognizer seam. [`transcribe`] hands 16 kHz mono audio to the first
//!   [`Recognizer`] that takes it: a client's (added with [`add_recognizer`]), else the
//!   built-in whisper.cpp one (feature `whisper`; Metal on Apple platforms). Without either
//!   the call says there is no recognizer, and everything else here still works.
//!
//! Local models for captions and transcripts are the one place OpenRip uses a model
//! (ROADMAP.md, principles). Nothing leaves the device, and there are no accounts.

pub mod align;
pub mod backend;
pub mod captions;
pub mod models;
pub mod transcript;
#[cfg(feature = "whisper")]
mod whisper;

pub use backend::{add_recognizer, transcribe, Control, Recognizer, Request, SpeechError, SAMPLE_RATE};
pub use captions::{build_captions, is_filler, Caption, CaptionOptions, CaptionWord};
pub use models::{Model, DEFAULT_MODEL, MODELS};
pub use transcript::{Segment, Token, Transcript, Word};

/// Whether this build carries the whisper.cpp recognizer.
pub const HAS_WHISPER: bool = cfg!(feature = "whisper");
