//! The audio output seam: the device the player's mix plays on.
//!
//! An [`AudioOutput`] starts the platform's default output and calls back for each buffer
//! the device wants. Built in: `Cpal` (the `cpal` feature: CoreAudio on macOS and iOS,
//! AAudio on Android, WASAPI and ALSA on desktops). A client with its own audio session (an iOS app sharing
//! AVAudioEngine, a web page's AudioWorklet) installs its own with [`set_audio_output`].
//! With none, the player can't open and the preview runs by the wall clock instead.

use std::sync::{Arc, RwLock};
use std::time::Duration;

use crate::PlayerError;

/// Fills one device buffer: interleaved samples, `channels` per frame, that will be heard
/// `latency` from now. Runs on the device's thread.
pub type Fill = Box<dyn FnMut(&mut [f32], usize, Duration) + Send>;

/// A running output: it plays until dropped.
pub struct OutputStream(#[allow(dead_code)] Box<dyn Send + Sync>);

impl OutputStream {
    pub fn new(running: impl Send + Sync + 'static) -> OutputStream {
        OutputStream(Box::new(running))
    }
}

/// Opens the platform's audio output.
pub trait AudioOutput: Send + Sync {
    /// Start the default output device with `fill` feeding it; returns the stream and its
    /// sample rate.
    fn start(&self, fill: Fill) -> Result<(OutputStream, u32), PlayerError>;
}

static OUTPUT: RwLock<Option<Arc<dyn AudioOutput>>> = RwLock::new(None);

/// Play through `output` from now on (players already open keep theirs).
pub fn set_audio_output(output: Arc<dyn AudioOutput>) {
    *OUTPUT.write().unwrap() = Some(output);
}

/// The output in use: the client's, or the built-in one if this build has it.
pub fn audio_output() -> Option<Arc<dyn AudioOutput>> {
    if let Some(o) = OUTPUT.read().unwrap().clone() {
        return Some(o);
    }
    built_in()
}

fn built_in() -> Option<Arc<dyn AudioOutput>> {
    #[cfg(feature = "cpal")]
    return Some(Arc::new(Cpal));
    #[cfg(not(feature = "cpal"))]
    None
}

/// cpal's default output device.
#[cfg(feature = "cpal")]
pub struct Cpal;

#[cfg(feature = "cpal")]
impl AudioOutput for Cpal {
    fn start(&self, fill: Fill) -> Result<(OutputStream, u32), PlayerError> {
        cpal_output::start(fill)
    }
}

#[cfg(feature = "cpal")]
#[cfg(feature = "cpal")]
mod cpal_output {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread::JoinHandle;

    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    use super::{Fill, OutputStream};
    use crate::PlayerError;

    /// The thread that owns the stream, until told to quit.
    struct Running {
        quit: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    impl Drop for Running {
        fn drop(&mut self) {
            self.quit.store(true, Ordering::SeqCst);
            if let Some(t) = self.thread.take() {
                t.thread().unpark();
                let _ = t.join();
            }
        }
    }

    pub(super) fn start(fill: Fill) -> Result<(OutputStream, u32), PlayerError> {
        // cpal streams can't move between threads on every platform: the output thread
        // owns it for the player's whole life.
        let quit = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let thread = {
            let quit = quit.clone();
            std::thread::Builder::new()
                .name("audio-output".into())
                .spawn(move || match open(fill) {
                    Ok((stream, rate)) => {
                        let _ = ready_tx.send(Ok(rate));
                        while !quit.load(Ordering::Relaxed) {
                            std::thread::park_timeout(std::time::Duration::from_millis(200));
                        }
                        drop(stream);
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                })
                .map_err(|e| PlayerError::Output(e.to_string()))?
        };
        let running = Running { quit, thread: Some(thread) };
        let rate = ready_rx.recv().map_err(|e| PlayerError::Output(e.to_string()))??;
        Ok((OutputStream::new(running), rate))
    }

    fn open(mut fill: Fill) -> Result<(cpal::Stream, u32), PlayerError> {
        let host = cpal::default_host();
        let device = host.default_output_device().ok_or(PlayerError::NoDevice)?;
        let config = device.default_output_config().map_err(|e| PlayerError::Output(e.to_string()))?.config();
        let (rate, channels) = (config.sample_rate, config.channels as usize);
        let stream = device
            .build_output_stream(
                config,
                move |out: &mut [f32], info: &cpal::OutputCallbackInfo| {
                    let ts = info.timestamp();
                    fill(out, channels, ts.playback.duration_since(ts.callback));
                },
                |e| eprintln!("[audio-output] {e}"),
                None,
            )
            .map_err(|e| PlayerError::Output(e.to_string()))?;
        stream.play().map_err(|e| PlayerError::Output(e.to_string()))?;
        Ok((stream, rate))
    }
}
