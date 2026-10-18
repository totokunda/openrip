//! The Audio tab's engine calls besides mixing: a clip's loudness for "Normalize loudness",
//! and voiceover recording from the microphone (beats are with the waveforms, in
//! [`crate::Thumbnails`]).

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use openrip_model::Micros;
use openrip_playback::{AudioInput, InputStream, PlayerError};

use crate::Result;

pub use openrip_audio::loudness::Loudness;
pub use openrip_playback::{set_audio_input, Level, Recorder, Recording};

/// The EBU R128 loudness (LUFS) and peak (dBFS) of `path`'s audio over `duration` from
/// `start` (media time; all of it for `None`), as CapCut measures it for "Normalize
/// loudness"; `None` if it has no audio. Blocks: call it off the UI thread.
pub fn measure_loudness(path: &Path, start: Micros, duration: Option<Micros>) -> Result<Option<Loudness>> {
    Ok(openrip_audio::loudness::measure_file(path, start, duration)?)
}

/// A stand-in microphone for automated tests: it "hears" a 440 Hz tone at a quarter of full
/// scale, mono at 48 kHz, in 10 ms buffers paced by the clock, so a voiceover can be
/// recorded end to end without a real device (or anything real being recorded). Install it
/// with [`set_audio_input`].
pub struct ToneInput;

struct ToneRunning(Arc<AtomicBool>, Option<JoinHandle<()>>);

impl Drop for ToneRunning {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
        if let Some(t) = self.1.take() {
            let _ = t.join();
        }
    }
}

impl AudioInput for ToneInput {
    fn start(&self, mut sink: openrip_playback::input::Sink) -> std::result::Result<(InputStream, u32, u16), PlayerError> {
        const RATE: u32 = 48_000;
        let quit = Arc::new(AtomicBool::new(false));
        let stop = quit.clone();
        let thread = std::thread::Builder::new()
            .name("tone-input".into())
            .spawn(move || {
                let n = (RATE / 100) as usize;
                let started = std::time::Instant::now();
                let mut done = 0usize;
                while !stop.load(Ordering::SeqCst) {
                    let buf: Vec<f32> = (done..done + n).map(|i| 0.25 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / RATE as f32).sin()).collect();
                    sink(&buf);
                    done += n;
                    let due = std::time::Duration::from_secs_f64(done as f64 / RATE as f64);
                    std::thread::sleep(due.saturating_sub(started.elapsed()));
                }
            })
            .map_err(|e| PlayerError::Input(e.to_string()))?;
        Ok((InputStream::new(ToneRunning(quit, Some(thread))), RATE, 1))
    }
}
