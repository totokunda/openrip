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
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use openrip_audio::{sample_at, Mixer, CHANNELS};
use openrip_model::{Micros, Project};
use openrip_platform::tasks::{self, Task};

use crate::output::{audio_output, AudioOutput, OutputStream};

/// Mixed audio kept ahead of the device.
const AHEAD_MS: i64 = 150;
const BLOCK: usize = 1024;
/// A scrub snippet's length, and the fade in and out at its ends (no click at the joins).
const GRAIN_MS: i64 = 70;
const GRAIN_FADE_MS: i64 = 8;
/// Snippets are rate-limited: a request sooner than this after the last one is dropped.
const GRAIN_GAP: Duration = Duration::from_millis(30);

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
    /// The scrub snippet being played, as timeline samples `[start, end)`; while it is set the
    /// mixer stops at `end`, and the device goes quiet when it has played out.
    snippet: Option<(i64, i64)>,
    last_snippet: Option<Instant>,
}

/// What scrubbing has played, for tests (it counts whether or not the speakers are muted).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ScrubStats {
    /// Snippets started since the player opened.
    pub snippets: u64,
    /// The timeline time (microseconds) the latest snippet started at.
    pub last_us: i64,
    /// Each channel's peak of the latest snippet's mix, with its fades.
    pub peaks: [f32; 2],
}

/// The fade envelope of a snippet `[start, end)` at sample `pos`: 0 outside, ramping up over
/// `fade` samples from the start and down to the end.
fn grain_gain(pos: i64, start: i64, end: i64, fade: i64) -> f32 {
    if pos < start || pos >= end {
        return 0.0;
    }
    let edge = (pos - start + 1).min(end - pos);
    (edge as f32 / fade.max(1) as f32).min(1.0)
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
    snippets: AtomicU64,
    snippet_us: AtomicI64,
    snippet_peaks: [AtomicU32; 2],
}

impl Shared {
    fn new() -> Shared {
        Shared {
            state: Mutex::new(State { ring: VecDeque::new(), ring_start: 0, next_mix: 0, playing: false, generation: 0, project: None, snippet: None, last_snippet: None }),
            cond: Condvar::new(),
            played: AtomicI64::new(0),
            latency_us: AtomicI64::new(0),
            volume: AtomicU32::new(1.0f32.to_bits()),
            peaks: [AtomicU32::new(0), AtomicU32::new(0)],
            quit: AtomicBool::new(false),
            snippets: AtomicU64::new(0),
            snippet_us: AtomicI64::new(0),
            snippet_peaks: [AtomicU32::new(0), AtomicU32::new(0)],
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
        st.snippet = None;
        self.shared.played.store(at, Ordering::SeqCst);
        self.shared.cond.notify_all();
    }

    /// Play a short snippet of the mix at `t`, for scrubbing: the newest position replaces one
    /// still playing, and it stops by itself. Dropped when playback is running or when the last
    /// snippet started less than 30 ms ago. Returns whether it started.
    pub fn scrub(&self, t: Micros) -> bool {
        let at = sample_at(t, self.rate);
        let mut st = self.shared.state.lock().unwrap();
        if st.playing && st.snippet.is_none() {
            return false;
        }
        let now = Instant::now();
        if st.last_snippet.is_some_and(|l| now.duration_since(l) < GRAIN_GAP) {
            return false;
        }
        st.last_snippet = Some(now);
        st.ring.clear();
        st.ring_start = at;
        st.next_mix = at;
        st.generation += 1;
        st.playing = true;
        st.snippet = Some((at, at + GRAIN_MS * self.rate as i64 / 1000));
        self.shared.played.store(at, Ordering::SeqCst);
        self.shared.snippets.fetch_add(1, Ordering::Relaxed);
        self.shared.snippet_us.store(t.0, Ordering::Relaxed);
        for p in &self.shared.snippet_peaks {
            p.store(0, Ordering::Relaxed);
        }
        self.shared.cond.notify_all();
        true
    }

    /// Cut a snippet short (scrubbing stopped); does nothing to real playback.
    pub fn scrub_stop(&self) {
        let mut st = self.shared.state.lock().unwrap();
        if st.snippet.take().is_some() {
            st.playing = false;
            st.ring.clear();
            st.generation += 1;
            self.shared.cond.notify_all();
        }
    }

    /// What scrubbing has played so far.
    pub fn scrub_stats(&self) -> ScrubStats {
        let s = &self.shared;
        ScrubStats {
            snippets: s.snippets.load(Ordering::Relaxed),
            last_us: s.snippet_us.load(Ordering::Relaxed),
            peaks: s.snippet_peaks.each_ref().map(|p| f32::from_bits(p.load(Ordering::Relaxed))),
        }
    }

    pub fn pause(&self) {
        let mut st = self.shared.state.lock().unwrap();
        st.playing = false;
        st.snippet = None;
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
    // A snippet that has played out leaves the device quiet.
    if let Some((_, end)) = st.snippet {
        if st.ring.is_empty() && st.next_mix >= end {
            st.snippet = None;
            st.playing = false;
        }
    }
    shared.cond.notify_all();
}

fn run_mixer(mut mixer: Mixer, shared: &Shared, rate: u32) {
    let ahead = AHEAD_MS * rate as i64 / 1000;
    let mut block = vec![0f32; BLOCK * CHANNELS];
    loop {
        let pos = {
            let mut st = shared.state.lock().unwrap();
            loop {
                if shared.quit.load(Ordering::Relaxed) {
                    return;
                }
                if let Some(p) = st.project.take() {
                    mixer.set_project(p);
                }
                let buffered = (st.ring.len() / CHANNELS) as i64;
                let mixed_out = st.snippet.is_some_and(|(_, end)| st.next_mix >= end);
                if st.playing && buffered < ahead && !mixed_out {
                    break;
                }
                st = shared.cond.wait(st).unwrap();
            }
            (st.next_mix, st.generation, st.snippet)
        };
        let (at, generation, snippet) = pos;
        // Mix outside the lock; a missing file just mixes as silence.
        let _ = mixer.mix(at, &mut block);
        if let Some((start, end)) = snippet {
            let fade = GRAIN_FADE_MS * rate as i64 / 1000;
            for (i, frame) in block.chunks_exact_mut(CHANNELS).enumerate() {
                let g = grain_gain(at + i as i64, start, end, fade);
                for (c, v) in frame.iter_mut().enumerate() {
                    *v *= g;
                    if v.is_finite() {
                        shared.snippet_peaks[c % 2].fetch_max(v.abs().to_bits(), Ordering::Relaxed);
                    }
                }
            }
        }
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
