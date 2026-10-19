//! The recognizer seam: audio in, a [`Transcript`] out.
//!
//! Built in today: whisper.cpp (`whisper` feature, Metal on Apple platforms). Todo: the
//! platform's own recognizers on iOS and Android, if a client wants them; they implement
//! [`Recognizer`] and are added with [`add_recognizer`].

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use crate::transcript::Transcript;

/// The rate recognizers take audio at (mono, `f32`).
pub const SAMPLE_RATE: u32 = 16_000;

#[derive(Debug, thiserror::Error)]
pub enum SpeechError {
    #[error("cancelled")]
    Cancelled,
    #[error("no speech recognizer in this build")]
    NoRecognizer,
    #[error("{0}")]
    Model(String),
    #[error("{0}")]
    Failed(String),
}

/// Progress (0–100) and a request to stop, shared between the thread recognizing and the ones
/// watching.
#[derive(Default)]
pub struct Control {
    percent: AtomicU32,
    cancel: AtomicBool,
}

impl Control {
    pub fn new() -> Self {
        Self::default()
    }

    /// How far along, 0–100.
    pub fn percent(&self) -> u32 {
        self.percent.load(Ordering::Relaxed)
    }

    pub fn set_percent(&self, percent: u32) {
        self.percent.store(percent.min(100), Ordering::Relaxed);
    }

    /// Stop: [`transcribe`] returns [`SpeechError::Cancelled`].
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

/// What to recognize.
pub struct Request<'a> {
    /// The model file (a ggml file from [`crate::models`]).
    pub model: PathBuf,
    /// Mono audio at [`SAMPLE_RATE`].
    pub audio: &'a [f32],
    /// ISO 639-1 code, or `None` to detect it.
    pub language: Option<String>,
}

/// Something that recognizes speech.
pub trait Recognizer: Send + Sync {
    /// `Ok(None)` if it doesn't take this request (the next recognizer tries).
    fn transcribe(&self, request: &Request, control: &Arc<Control>) -> Result<Option<Transcript>, SpeechError>;
}

static ADDED: RwLock<Vec<Arc<dyn Recognizer>>> = RwLock::new(Vec::new());

/// Try `recognizer` before the ones tried so far.
pub fn add_recognizer(recognizer: Arc<dyn Recognizer>) {
    ADDED.write().unwrap().insert(0, recognizer);
}

fn built_in() -> Vec<Arc<dyn Recognizer>> {
    #[cfg(feature = "whisper")]
    return vec![Arc::new(crate::whisper::Whisper)];
    #[cfg(not(feature = "whisper"))]
    Vec::new()
}

/// Recognize the speech in `request`'s audio, on this thread. Blocks: call it off the UI
/// thread. `control` reports progress and stops it.
pub fn transcribe(request: &Request, control: &Arc<Control>) -> Result<Transcript, SpeechError> {
    control.set_percent(0);
    let recognizers: Vec<_> = ADDED.read().unwrap().iter().cloned().chain(built_in()).collect();
    for r in recognizers {
        if let Some(mut t) = r.transcribe(request, control)? {
            // Word times against the sound itself (OPENRIP_SPEECH_TIGHTEN=0 leaves them).
            if std::env::var("OPENRIP_SPEECH_TIGHTEN").map_or(true, |v| v != "0") {
                crate::align::tighten(&mut t, request.audio);
            }
            control.set_percent(100);
            return Ok(t);
        }
    }
    Err(SpeechError::NoRecognizer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::{Segment, Word};

    struct Fixed;
    impl Recognizer for Fixed {
        fn transcribe(&self, request: &Request, control: &Arc<Control>) -> Result<Option<Transcript>, SpeechError> {
            control.set_percent(50);
            let n = request.audio.len() as i64;
            let word = Word { text: "hi".into(), start_us: 0, end_us: n };
            Ok(Some(Transcript { language: "en".into(), segments: vec![Segment { start_us: 0, end_us: n, words: vec![word] }] }))
        }
    }

    #[test]
    fn an_added_recognizer_is_asked_first_and_progress_ends_at_100() {
        add_recognizer(Arc::new(Fixed));
        let control = Arc::new(Control::new());
        let t = transcribe(&Request { model: "none".into(), audio: &[0.0; 4], language: None }, &control).unwrap();
        assert_eq!(t.text(), "hi");
        assert_eq!(control.percent(), 100);
    }
}
