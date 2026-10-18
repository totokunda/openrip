//! The audio decode seam: a file's sound as interleaved stereo `f32` at a chosen rate,
//! addressed by sample, from whichever backend can read it.
//!
//! [`open_audio`] asks the backends a client added with [`add_audio_backend`] first, then
//! the built-in ones. Built in today: FFmpeg ([`crate::AudioDecoder`]). Not written yet:
//! todo: MediaCodec/`AMediaExtractor` on Android, AVFoundation where FFmpeg isn't built on
//! iOS, WebCodecs `AudioDecoder` (or `decodeAudioData`) on the web.

use std::path::Path;
use std::sync::{Arc, RwLock};

use crate::AudioError;

/// One file's audio, decoded on demand.
pub trait AudioSource: Send {
    /// Fill `out` (interleaved stereo) from sample `at`; silence where there is no sound.
    fn read(&mut self, at: i64, out: &mut [f32]) -> Result<(), AudioError>;
    /// The sample the sound ends at, once known.
    fn end(&self) -> Option<i64>;
}

/// Opens audio.
pub trait AudioBackend: Send + Sync {
    /// The audio of the asset at `path` at `rate`: `Ok(None)` if it has none, `Err` if this
    /// backend can't read it (the next one tries).
    fn open(&self, path: &Path, rate: u32) -> Result<Option<Box<dyn AudioSource>>, AudioError>;
}

static ADDED: RwLock<Vec<Arc<dyn AudioBackend>>> = RwLock::new(Vec::new());

/// Try `backend` before the ones tried so far.
pub fn add_audio_backend(backend: Arc<dyn AudioBackend>) {
    ADDED.write().unwrap().insert(0, backend);
}

fn built_in() -> Vec<Arc<dyn AudioBackend>> {
    vec![Arc::new(crate::decode::Ffmpeg)]
}

/// The audio of the asset at `path` as interleaved stereo at `rate`, from the first backend
/// that reads it; `None` if it has no audio stream.
pub fn open_audio(path: &Path, rate: u32) -> Result<Option<Box<dyn AudioSource>>, AudioError> {
    let backends: Vec<_> = ADDED.read().unwrap().iter().cloned().chain(built_in()).collect();
    let mut failed = None;
    for backend in backends {
        match backend.open(path, rate) {
            Ok(found) => return Ok(found),
            Err(e) => failed = failed.or(Some(e)),
        }
    }
    Err(failed.unwrap_or_else(|| AudioError::Other(format!("{}: no audio decoder in this build", path.display()))))
}
