//! Audio playback and the master clock.
//!
//! A mixer thread keeps ~150 ms of the timeline's mix ahead of the output device; the
//! device callback (the audio output seam, `crate::output`) plays it and counts what it played. [`Player::position`] is
//! that count minus the device's output latency: video frames are chosen by it, so picture
//! follows sound, as in CapCut and every NLE. With nothing to play (silence) the same
//! clock still runs, because the mix is silence rather than nothing.
//!
//! The device callback also keeps each channel's peak since the last [`Player::take_levels`]:
//! a level meter's reading of what is being heard, for free (it already touches every
//! sample it plays).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use openrip_audio::{sample_at, Mixer, CHANNELS};
use openrip_model::{Micros, Project};
use openrip_platform::tasks::{self, Task};

use crate::output::{audio_output, AudioOutput, OutputStream};

/// Mixed audio kept ahead of the device.
const AHEAD_MS: i64 = 150;
const BLOCK: usize = 1024;

#[derive(Debug, thiserror::Error)]
pub enum PlayerError {
    #[error("no audio output device")]
    NoDevice,
    #[error("audio output: {0}")]
    Output(String),
    /// No microphone (or no input in this build), for a voiceover.
    #[error("no microphone")]
    NoInput,
    #[error("recording: {0}")]
    Input(String),
}

struct State {
    /// Interleaved stereo samples from timeline sample `ring_start`.
    ring: VecDeque<f32>,
    ring_start: i64,
    /// Where the mixer continues.
    next_mix: i64,
    playing: bool,
    /// Bumped on every play/seek so in-flight mixing for an old position is dropped.
    generation: u64,
    /// An edited project for the mixer to switch to.
    project: Option<Project>,
}

struct Shared {
    state: Mutex<State>,
    cond: Condvar,
    /// Timeline sample of the next sample the device will be given.
    played: AtomicI64,
    /// Output latency (device buffer to speaker), microseconds.
    latency_us: AtomicI64,
    volume: AtomicU32,
    /// Each channel's largest absolute sample played since the last `take_levels` (f32 bits;
    /// for non-negative floats the bits order as the values do, so `fetch_max` keeps the peak).
    peaks: [AtomicU32; 2],
    quit: AtomicBool,
}

impl Shared {
    fn new() -> Shared {
        Shared {
            state: Mutex::new(State { ring: VecDeque::new(), ring_start: 0, next_mix: 0, playing: false, generation: 0, project: None }),
            cond: Condvar::new(),
            played: AtomicI64::new(0),
            latency_us: AtomicI64::new(0),
            volume: AtomicU32::new(1.0f32.to_bits()),
            peaks: [AtomicU32::new(0), AtomicU32::new(0)],
            quit: AtomicBool::new(false),
        }
    }

    fn take_levels(&self) -> [f32; 2] {
        self.peaks.each_ref().map(|p| f32::from_bits(p.swap(0, Ordering::Relaxed)))
    }
}

pub struct Player {
    shared: Arc<Shared>,
    rate: u32,
    /// The device's stream, and the mixer.
    output: Option<OutputStream>,
    mixer: Option<Task>,
}

impl Player {
    /// Open the default output device and start the (paused) mixer for `project`.
    pub fn new(project: Project) -> Result<Player, PlayerError> {
        let output = audio_output().ok_or(PlayerError::NoDevice)?;
        Self::with_output(project, output.as_ref())
    }

    /// Like [`Player::new`], on `output`.
    pub fn with_output(project: Project, output: &dyn AudioOutput) -> Result<Player, PlayerError> {
        let shared = Arc::new(Shared::new());
        let (out, rate) = {
            let shared = shared.clone();
            output.start(Box::new(move |out, channels, latency| fill(&shared, out, channels, latency)))?
        };
        let mix = {
            let shared = shared.clone();
            tasks::spawn("audio-mixer", move || run_mixer(Mixer::with_rate(project, rate), &shared, rate)).map_err(|e| PlayerError::Output(e.to_string()))?
        };
        Ok(Player { shared, rate, output: Some(out), mixer: Some(mix) })
    }

    /// Start (or restart) playback at timeline time `t`.
    pub fn play(&self, t: Micros) {
        let at = sample_at(t, self.rate);
        let mut st = self.shared.state.lock().unwrap();
        st.ring.clear();
        st.ring_start = at;
        st.next_mix = at;
        st.generation += 1;
        st.playing = true;
        self.shared.played.store(at, Ordering::SeqCst);
        self.shared.cond.notify_all();
    }

    pub fn pause(&self) {
        let mut st = self.shared.state.lock().unwrap();
        st.playing = false;
        st.ring.clear();
        st.generation += 1;
        self.shared.cond.notify_all();
    }

    pub fn is_playing(&self) -> bool {
        self.shared.state.lock().unwrap().playing
    }

    /// The timeline time being heard now: the master clock.
    pub fn position(&self) -> Micros {
        let played = self.shared.played.load(Ordering::SeqCst);
        let t = played as i128 * 1_000_000 / self.rate as i128;
        let latency = if self.is_playing() { self.shared.latency_us.load(Ordering::Relaxed) } else { 0 };
        Micros((t as i64 - latency).max(0))
    }

    /// Switch to an edited project. While playing, the ~150 ms already mixed plays out
    /// first, so the sound doesn't skip.
    pub fn set_project(&self, project: Project) {
        self.shared.state.lock().unwrap().project = Some(project);
        self.shared.cond.notify_all();
    }

    /// Output gain (0 = silent; the clock keeps running).
    pub fn set_volume(&self, v: f32) {
        self.shared.volume.store(v.max(0.0).to_bits(), Ordering::Relaxed);
    }

    pub fn sample_rate(&self) -> u32 {
        self.rate
    }

    /// The left and right peaks (0..1, larger when the mix clips) of what was played since
    /// the last call, before the output volume: the mix's level, which a meter shows whether
    /// or not the speakers are muted. Zero while paused.
    pub fn take_levels(&self) -> [f32; 2] {
        self.shared.take_levels()
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        self.shared.quit.store(true, Ordering::SeqCst);
        self.shared.cond.notify_all();
        self.output.take();
        if let Some(t) = self.mixer.take() {
            let _ = t.join();
        }
    }
}

/// One device buffer: the next of the ring, or silence while paused.
fn fill(shared: &Shared, out: &mut [f32], channels: usize, latency: Duration) {
    shared.latency_us.store(latency.as_micros() as i64, Ordering::Relaxed);
    let gain = f32::from_bits(shared.volume.load(Ordering::Relaxed));
    let frames = out.len() / channels;
    let mut st = shared.state.lock().unwrap();
    if !st.playing {
        out.fill(0.0);
        return;
    }
    let have = st.ring.len() / CHANNELS;
    let n = have.min(frames);
    let (mut peak_l, mut peak_r) = (0f32, 0f32);
    for f in 0..frames {
        let (l, r) = if f < n { (st.ring[f * 2], st.ring[f * 2 + 1]) } else { (0.0, 0.0) };
        peak_l = peak_l.max(l.abs());
        peak_r = peak_r.max(r.abs());
        for c in 0..channels {
            out[f * channels + c] = gain * if c % 2 == 0 { l } else { r };
        }
    }
    // NaN never reaches a meter as a peak.
    for (p, v) in shared.peaks.iter().zip([peak_l, peak_r]) {
        if v.is_finite() {
            p.fetch_max(v.to_bits(), Ordering::Relaxed);
        }
    }
    st.ring.drain(..n * CHANNELS);
    st.ring_start += n as i64;
    // The clock advances only by what was really played (an underrun stalls it, and the
    // picture waits with it).
    shared.played.store(st.ring_start, Ordering::SeqCst);
    shared.cond.notify_all();
}

fn run_mixer(mut mixer: Mixer, shared: &Shared, rate: u32) {
    let ahead = AHEAD_MS * rate as i64 / 1000;
    let mut block = vec![0f32; BLOCK * CHANNELS];
    loop {
        let (at, generation) = {
            let mut st = shared.state.lock().unwrap();
            loop {
                if shared.quit.load(Ordering::Relaxed) {
                    return;
                }
                if let Some(p) = st.project.take() {
                    mixer.set_project(p);
                }
                let buffered = (st.ring.len() / CHANNELS) as i64;
                if st.playing && buffered < ahead {
                    break;
                }
                st = shared.cond.wait(st).unwrap();
            }
            (st.next_mix, st.generation)
        };
        // Mix outside the lock; a missing file just mixes as silence.
        let _ = mixer.mix(at, &mut block);
        let mut st = shared.state.lock().unwrap();
        if st.generation == generation && st.next_mix == at {
            st.ring.extend(&block);
            st.next_mix += BLOCK as i64;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tap reads each channel's peak of what was played, before the output volume, and
    /// starts again from zero after each read.
    #[test]
    fn levels_are_the_peaks_played_since_the_last_read() {
        let shared = Shared::new();
        shared.volume.store(0f32.to_bits(), Ordering::Relaxed);
        {
            let mut st = shared.state.lock().unwrap();
            st.playing = true;
            // Left 0.5 then -0.8, right 0.25 then 0.1.
            st.ring.extend([0.5, 0.25, -0.8, 0.1]);
        }
        let mut out = [1f32; 8];
        fill(&shared, &mut out, 2, Duration::ZERO);
        assert!(out.iter().all(|&v| v == 0.0), "muted output: {out:?}");
        assert_eq!(shared.take_levels(), [0.8, 0.25]);
        assert_eq!(shared.take_levels(), [0.0, 0.0]);
        // Paused: silence, nothing measured.
        shared.state.lock().unwrap().playing = false;
        fill(&shared, &mut out, 2, Duration::ZERO);
        assert_eq!(shared.take_levels(), [0.0, 0.0]);
    }
}
