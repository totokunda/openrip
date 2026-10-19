//! Auto captions: the speech in a clip or in the timeline's mix, recognized by a local model
//! and cut into captions (openrip-speech). The audio comes through the audio decode seam and
//! the mixer at 16 kHz and is folded to mono; the recognizer is whisper.cpp where the build
//! has it (`whisper` feature), else whatever a client added.
//!
//! Each call blocks: run it off the UI thread. Progress and cancel are a [`SpeechControl`].

use std::path::{Path, PathBuf};
use std::sync::Arc;

use openrip_audio::{open_audio, sample_at, Mixer};
use openrip_model::{Micros, Project};
use openrip_speech::SAMPLE_RATE;

use crate::{Error, Result};

pub use openrip_speech::{
    build_captions, models, Caption, CaptionOptions, CaptionWord, Control as SpeechControl, Model, Segment, SpeechError, Transcript, Word, DEFAULT_MODEL, HAS_WHISPER, MODELS,
};

impl From<SpeechError> for Error {
    fn from(e: SpeechError) -> Error {
        match e {
            SpeechError::Cancelled => Error::Analysis("cancelled".into()),
            e => Error::Analysis(e.to_string()),
        }
    }
}

/// A second of audio at a time, so a long file can be stopped between reads.
const CHUNK: usize = SAMPLE_RATE as usize;

fn mono(stereo: &[f32], into: &mut Vec<f32>) {
    into.extend(stereo.chunks_exact(2).map(|f| (f[0] + f[1]) * 0.5));
}

/// The sound of the media file at `path` over `duration` from `start` (to its end for
/// `None`), as 16 kHz mono; `None` if it has no audio.
pub fn decode_speech_audio(path: &Path, start: Micros, duration: Option<Micros>, control: &SpeechControl) -> Result<Option<Vec<f32>>> {
    let Some(mut source) = open_audio(path, SAMPLE_RATE)? else { return Ok(None) };
    let from = sample_at(start, SAMPLE_RATE);
    let wanted = duration.map_or(i64::MAX / 4, |d| sample_at(d, SAMPLE_RATE));
    let mut out = Vec::new();
    let mut buf = vec![0.0f32; CHUNK * 2];
    let mut done = 0i64;
    while done < wanted {
        if control.cancelled() {
            return Err(SpeechError::Cancelled.into());
        }
        let at = from + done;
        let n = (wanted - done).min(CHUNK as i64) as usize;
        source.read(at, &mut buf[..n * 2])?;
        let end = source.end().map(|e| e.min(from + wanted));
        let usable = end.map_or(n, |e| (e - at).clamp(0, n as i64) as usize);
        mono(&buf[..usable * 2], &mut out);
        done += n as i64;
        if usable < n {
            break;
        }
    }
    Ok(Some(out))
}

/// The timeline's mix (every unmuted audible track, with volume, fades and effects) over
/// `duration` from `start` (to the project's end for `None`), as 16 kHz mono.
pub fn mix_speech_audio(project: &Project, start: Micros, duration: Option<Micros>, control: &SpeechControl) -> Result<Vec<f32>> {
    let from = sample_at(start, SAMPLE_RATE);
    let total = sample_at(duration.unwrap_or_else(|| (project.duration() - start).max(Micros::ZERO)), SAMPLE_RATE);
    let mut mixer = Mixer::with_rate(project.clone(), SAMPLE_RATE);
    let mut out = Vec::with_capacity(total.max(0) as usize);
    let mut buf = vec![0.0f32; CHUNK * 2];
    let mut done = 0i64;
    while done < total {
        if control.cancelled() {
            return Err(SpeechError::Cancelled.into());
        }
        let n = (total - done).min(CHUNK as i64) as usize;
        mixer.mix(from + done, &mut buf[..n * 2])?;
        mono(&buf[..n * 2], &mut out);
        done += n as i64;
    }
    Ok(out)
}

/// Recognize the speech in 16 kHz mono `audio` with the model file at `model`. `language` is
/// an ISO 639-1 code, or `None` to detect it.
pub fn transcribe_audio(audio: &[f32], model: PathBuf, language: Option<String>, control: &Arc<SpeechControl>) -> Result<Transcript> {
    if audio.len() < SAMPLE_RATE as usize / 10 {
        return Ok(Transcript { language: language.unwrap_or_else(|| "en".into()), segments: Vec::new() });
    }
    Ok(openrip_speech::transcribe(&openrip_speech::Request { model, audio, language }, control)?)
}

/// What a request transcribes.
pub enum SpeechInput<'a> {
    /// One media file's sound over a range of its media time.
    File { path: &'a Path, start: Micros, duration: Option<Micros> },
    /// The timeline's mix over a range of the timeline.
    Timeline { project: &'a Project, start: Micros, duration: Option<Micros> },
}

/// Decode and recognize `input`. The transcript's times count from the range's start.
pub fn transcribe(input: SpeechInput, model: PathBuf, language: Option<String>, control: &Arc<SpeechControl>) -> Result<Transcript> {
    let audio = match input {
        SpeechInput::File { path, start, duration } => decode_speech_audio(path, start, duration, control)?,
        SpeechInput::Timeline { project, start, duration } => Some(mix_speech_audio(project, start, duration, control)?),
    };
    match audio {
        Some(a) => transcribe_audio(&a, model, language, control),
        None => Ok(Transcript { language: language.unwrap_or_else(|| "en".into()), segments: Vec::new() }),
    }
}
