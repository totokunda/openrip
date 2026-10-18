//! The audio input seam, and voiceover recording through it.
//!
//! An [`AudioInput`] starts the platform's default input (the microphone) and calls back with
//! each buffer it captures. Built in: `Cpal` (the `cpal` feature: CoreAudio on macOS, which
//! asks the user for the microphone the first time; WASAPI and ALSA on desktops). A client
//! with its own capture (an iOS app's AVAudioSession, a web page's getUserMedia) installs its
//! own with [`set_audio_input`], and tests install a fake one. With none, recording can't
//! start.
//!
//! A [`Recorder`] writes what the input captures to a 16-bit WAV file as it comes (a writer
//! thread does the disk work, never the device's thread) and keeps the level since it was
//! last asked, for the voiceover panel's meter (CapCut's Voiceover: docs/plan/capcut-ui-spec.md).

use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, RwLock};
use std::thread::JoinHandle;

use crate::PlayerError;

/// Receives one captured buffer: interleaved samples, the stream's channels per frame. Runs
/// on the device's thread, so it must not block.
pub type Sink = Box<dyn FnMut(&[f32]) + Send>;

/// A running capture: it records until dropped.
pub struct InputStream(#[allow(dead_code)] Box<dyn Send + Sync>);

impl InputStream {
    pub fn new(running: impl Send + Sync + 'static) -> InputStream {
        InputStream(Box::new(running))
    }
}

/// Opens the platform's audio input.
pub trait AudioInput: Send + Sync {
    /// Start the default input device with `sink` receiving what it captures; returns the
    /// stream, its sample rate and its channel count.
    fn start(&self, sink: Sink) -> Result<(InputStream, u32, u16), PlayerError>;
}

static INPUT: RwLock<Option<Arc<dyn AudioInput>>> = RwLock::new(None);

/// Record from `input` from now on (recordings already running keep theirs).
pub fn set_audio_input(input: Arc<dyn AudioInput>) {
    *INPUT.write().unwrap() = Some(input);
}

/// The input in use: the client's, or the built-in one if this build has it.
pub fn audio_input() -> Option<Arc<dyn AudioInput>> {
    if let Some(i) = INPUT.read().unwrap().clone() {
        return Some(i);
    }
    built_in()
}

fn built_in() -> Option<Arc<dyn AudioInput>> {
    #[cfg(feature = "cpal")]
    return Some(Arc::new(Cpal));
    #[cfg(not(feature = "cpal"))]
    None
}

/// The level of what was captured since it was last read: the largest sample and the RMS,
/// both 0..1.
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct Level {
    pub peak: f32,
    pub rms: f32,
}

/// What a finished recording is.
#[derive(Clone, Debug, PartialEq)]
pub struct Recording {
    pub path: PathBuf,
    pub rate: u32,
    pub channels: u16,
    /// Frames written (samples per channel).
    pub frames: u64,
}

impl Recording {
    /// Its length in µs.
    pub fn duration_us(&self) -> i64 {
        (self.frames as i128 * 1_000_000 / self.rate.max(1) as i128) as i64
    }
}

/// The level since the last read, shared with the device's thread: the peak and the sum of
/// squares as f32 bits, and the sample count.
#[derive(Default)]
struct Meter {
    peak: AtomicU32,
    squares: AtomicU32,
    count: AtomicU64,
}

/// A voiceover being recorded to a WAV file.
pub struct Recorder {
    stream: Option<InputStream>,
    writer: Option<JoinHandle<std::io::Result<u64>>>,
    meter: Arc<Meter>,
    path: PathBuf,
    rate: u32,
    channels: u16,
}

impl Recorder {
    /// Start recording from the input in use into a new WAV file at `path` (its folder is
    /// made if need be).
    pub fn start(path: &Path) -> Result<Recorder, PlayerError> {
        let input = audio_input().ok_or(PlayerError::NoInput)?;
        Recorder::start_with(input.as_ref(), path)
    }

    /// [`Recorder::start`] from a given input.
    pub fn start_with(input: &dyn AudioInput, path: &Path) -> Result<Recorder, PlayerError> {
        let io = |e: std::io::Error| PlayerError::Input(format!("{}: {e}", path.display()));
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(io)?;
        }
        let file = File::create(path).map_err(io)?;
        let meter = Arc::new(Meter::default());
        let (tx, rx) = channel::<Vec<f32>>();
        let sink = {
            let meter = meter.clone();
            let tx: Sender<Vec<f32>> = tx;
            Box::new(move |buf: &[f32]| {
                let (mut peak, mut sq) = (0f32, 0f32);
                for x in buf {
                    peak = peak.max(x.abs());
                    sq += x * x;
                }
                let _ = meter.peak.fetch_max(peak.to_bits(), Ordering::Relaxed);
                let _ = meter.squares.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |s| Some((f32::from_bits(s) + sq).to_bits()));
                meter.count.fetch_add(buf.len() as u64, Ordering::Relaxed);
                let _ = tx.send(buf.to_vec());
            }) as Sink
        };
        let (stream, rate, channels) = input.start(sink)?;
        // The header first, its sizes filled in when the recording stops.
        let writer = std::thread::Builder::new()
            .name("voiceover-writer".into())
            .spawn(move || -> std::io::Result<u64> {
                let mut out = BufWriter::new(file);
                write_header(&mut out, rate, channels, 0)?;
                let mut samples = 0u64;
                for buf in rx {
                    for x in &buf {
                        out.write_all(&((x.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes())?;
                    }
                    samples += buf.len() as u64;
                }
                out.seek(SeekFrom::Start(0))?;
                write_header(&mut out, rate, channels, (samples * 2) as u32)?;
                out.flush()?;
                Ok(samples)
            })
            .map_err(io)?;
        Ok(Recorder { stream: Some(stream), writer: Some(writer), meter, path: path.to_path_buf(), rate, channels })
    }

    pub fn rate(&self) -> u32 {
        self.rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    /// The level since the last call.
    pub fn level(&self) -> Level {
        let peak = f32::from_bits(self.meter.peak.swap(0, Ordering::Relaxed));
        let squares = f32::from_bits(self.meter.squares.swap(0, Ordering::Relaxed));
        let n = self.meter.count.swap(0, Ordering::Relaxed);
        Level { peak, rms: if n > 0 { (squares / n as f32).sqrt() } else { 0.0 } }
    }

    /// Stop the input and finish the file.
    pub fn stop(mut self) -> Result<Recording, PlayerError> {
        // Dropping the stream stops the callbacks, which drops the sink and its sender, which
        // ends the writer.
        self.stream.take();
        let samples = self.writer.take().map(|w| w.join()).transpose().map_err(|_| PlayerError::Input("the voiceover writer failed".into()))?.transpose().map_err(|e| PlayerError::Input(e.to_string()))?.unwrap_or(0);
        Ok(Recording { path: self.path.clone(), rate: self.rate, channels: self.channels, frames: samples / self.channels.max(1) as u64 })
    }
}

/// A 16-bit PCM WAV header for `bytes` of samples.
fn write_header(out: &mut impl Write, rate: u32, channels: u16, bytes: u32) -> std::io::Result<()> {
    out.write_all(b"RIFF")?;
    out.write_all(&(36 + bytes).to_le_bytes())?;
    out.write_all(b"WAVEfmt ")?;
    out.write_all(&16u32.to_le_bytes())?;
    out.write_all(&1u16.to_le_bytes())?;
    out.write_all(&channels.to_le_bytes())?;
    out.write_all(&rate.to_le_bytes())?;
    out.write_all(&(rate * channels as u32 * 2).to_le_bytes())?;
    out.write_all(&(channels * 2).to_le_bytes())?;
    out.write_all(&16u16.to_le_bytes())?;
    out.write_all(b"data")?;
    out.write_all(&bytes.to_le_bytes())
}

/// cpal's default input device.
#[cfg(feature = "cpal")]
pub struct Cpal;

#[cfg(feature = "cpal")]
impl AudioInput for Cpal {
    fn start(&self, sink: Sink) -> Result<(InputStream, u32, u16), PlayerError> {
        cpal_input::start(sink)
    }
}

#[cfg(feature = "cpal")]
mod cpal_input {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread::JoinHandle;

    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    use super::{InputStream, Sink};
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

    pub(super) fn start(sink: Sink) -> Result<(InputStream, u32, u16), PlayerError> {
        // As for output: the stream stays on the thread that made it.
        let quit = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let thread = {
            let quit = quit.clone();
            std::thread::Builder::new()
                .name("audio-input".into())
                .spawn(move || match open(sink) {
                    Ok((stream, rate, channels)) => {
                        let _ = ready_tx.send(Ok((rate, channels)));
                        while !quit.load(Ordering::Relaxed) {
                            std::thread::park_timeout(std::time::Duration::from_millis(200));
                        }
                        drop(stream);
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                })
                .map_err(|e| PlayerError::Input(e.to_string()))?
        };
        let running = Running { quit, thread: Some(thread) };
        let (rate, channels) = ready_rx.recv().map_err(|e| PlayerError::Input(e.to_string()))??;
        Ok((InputStream::new(running), rate, channels))
    }

    fn open(mut sink: Sink) -> Result<(cpal::Stream, u32, u16), PlayerError> {
        let host = cpal::default_host();
        let device = host.default_input_device().ok_or(PlayerError::NoInput)?;
        let supported = device.default_input_config().map_err(|e| PlayerError::Input(e.to_string()))?;
        let format = supported.sample_format();
        let config = supported.config();
        let (rate, channels) = (config.sample_rate, config.channels);
        let err = |e| eprintln!("[audio-input] {e}");
        let stream = match format {
            cpal::SampleFormat::F32 => device.build_input_stream(config, move |buf: &[f32], _: &cpal::InputCallbackInfo| sink(buf), err, None),
            cpal::SampleFormat::I16 => {
                let mut tmp = Vec::new();
                device.build_input_stream(
                    config,
                    move |buf: &[i16], _: &cpal::InputCallbackInfo| {
                        tmp.clear();
                        tmp.extend(buf.iter().map(|x| *x as f32 / 32768.0));
                        sink(&tmp);
                    },
                    err,
                    None,
                )
            }
            other => return Err(PlayerError::Input(format!("unsupported input format {other:?}"))),
        }
        .map_err(|e| PlayerError::Input(e.to_string()))?;
        stream.play().map_err(|e| PlayerError::Input(e.to_string()))?;
        Ok((stream, rate, channels))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    /// A microphone that hears a 1 kHz tone at half scale, in 10 ms buffers, from its own
    /// thread, until dropped.
    struct FakeMic {
        rate: u32,
        channels: u16,
        buffers: usize,
    }

    struct FakeRunning(Arc<AtomicBool>, Option<JoinHandle<()>>);

    impl Drop for FakeRunning {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
            if let Some(t) = self.1.take() {
                let _ = t.join();
            }
        }
    }

    impl AudioInput for FakeMic {
        fn start(&self, mut sink: Sink) -> Result<(InputStream, u32, u16), PlayerError> {
            let (rate, channels, buffers) = (self.rate, self.channels, self.buffers);
            let quit = Arc::new(AtomicBool::new(false));
            let q = quit.clone();
            let t = std::thread::spawn(move || {
                let n = (rate / 100) as usize;
                for b in 0..buffers {
                    if q.load(Ordering::SeqCst) {
                        break;
                    }
                    let buf: Vec<f32> = (0..n).flat_map(|i| {
                        let x = 0.5 * (2.0 * std::f32::consts::PI * 1000.0 * (b * n + i) as f32 / rate as f32).sin();
                        std::iter::repeat_n(x, channels as usize)
                    }).collect();
                    sink(&buf);
                }
            });
            Ok((InputStream::new(FakeRunning(quit, Some(t))), rate, channels))
        }
    }

    #[test]
    fn a_recording_is_a_wav_of_what_the_input_heard() {
        let dir = std::env::temp_dir().join(format!("openrip-voiceover-{}", std::process::id()));
        let path = dir.join("take 1.wav");
        // Half a second at 44.1 kHz, mono.
        let rec = Recorder::start_with(&FakeMic { rate: 44_100, channels: 1, buffers: 50 }, &path).unwrap();
        assert_eq!((rec.rate(), rec.channels()), (44_100, 1));
        std::thread::sleep(std::time::Duration::from_millis(200));
        let level = rec.level();
        let done = rec.stop().unwrap();
        assert_eq!(done.frames, 22_050);
        assert_eq!(done.duration_us(), 500_000);
        // The tone's level: peak 0.5, RMS 0.354.
        assert!((level.peak - 0.5).abs() < 0.01 && (level.rms - 0.3536).abs() < 0.01, "{level:?}");
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize, bytes.len() - 8);
        assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()), 1);
        assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 44_100);
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as usize, 22_050 * 2);
        // The quarter-period sample is the tone's crest.
        let s = |i: usize| i16::from_le_bytes(bytes[44 + i * 2..46 + i * 2].try_into().unwrap());
        assert_eq!(s(0), 0);
        assert!((s(11) as i32 - 16_383).abs() < 400, "{}", s(11));
        // Read since: nothing more came in.
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stopping_early_keeps_what_came_in_and_stereo_stays_stereo() {
        let dir = std::env::temp_dir().join(format!("openrip-voiceover-b-{}", std::process::id()));
        let path = dir.join("take.wav");
        let rec = Recorder::start_with(&FakeMic { rate: 48_000, channels: 2, buffers: 10 }, &path).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let done = rec.stop().unwrap();
        assert_eq!((done.channels, done.frames), (2, 4_800));
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes.len(), 44 + 4_800 * 2 * 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
