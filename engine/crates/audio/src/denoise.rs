//! Reduce noise: a classic spectral-gating denoiser (no model, no training).
//!
//! The clip's own sound gives the noise: [`NoiseProfile::estimate`] cuts the range the clip
//! plays into frames and averages the spectrum of the quietest tenth of them, per bin and per
//! channel, smoothed along the frequency axis. [`Denoiser`] then runs a short-time Fourier
//! transform over the clip (1024-sample frames, a hop of 256, square-root-Hann windows so the
//! overlapped frames add back to the input) and, per bin, turns the frame's power against the
//! profile's into a gain with the decision-directed Wiener rule (Ephraim and Malah): the a
//! priori SNR leans on the last frame's own gain, so isolated bins that cross the threshold
//! don't flicker on and off ("musical noise"). The gain mask is floored (how far the noise may
//! be pulled down) and smoothed across neighbouring bins before it's applied.
//!
//! It plays the same in preview and export because the profile comes from the clip's source
//! range, not from what was played before: a seek doesn't change what it hears as noise.

use std::collections::HashMap;
use std::f32::consts::PI;
use std::sync::{Arc, Mutex};

use realfft::num_complex::Complex32;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};

use crate::fx::Processor;
use crate::source::AudioSource;
use crate::{AudioError, CHANNELS};

/// The kind an effect names to be this one (an effect of OpenRip's own, outside the voice presets).
pub const KIND: &str = "denoise";

const SIZE: usize = 1024;
const HOP: usize = SIZE / 4;
const BINS: usize = SIZE / 2 + 1;
/// The profile reads at most this many seconds of the clip (from its start).
const MAX_SECONDS: i64 = 90;
/// The share of frames, quietest first, the noise is taken from.
const QUIET: f32 = 0.1;
/// Weight of the last frame's estimate in the a priori SNR.
const SMOOTHING: f32 = 0.98;
/// The a priori SNR never goes below this (−25 dB): the mask's deepest cut before the floor.
const MIN_SNR: f32 = 0.003_16;

fn window() -> Vec<f32> {
    (0..SIZE).map(|i| (0.5 - 0.5 * (2.0 * PI * i as f32 / SIZE as f32).cos()).sqrt()).collect()
}

/// A clip's noise: its power spectrum per bin, for each channel.
#[derive(Clone, Debug, PartialEq)]
pub struct NoiseProfile {
    power: [Vec<f32>; CHANNELS],
}

impl NoiseProfile {
    /// The noise in `samples` (interleaved stereo): the mean spectrum of its quietest frames.
    /// `None` when there isn't even one frame of sound.
    pub fn estimate(samples: &[f32]) -> Option<NoiseProfile> {
        let frames = samples.len() / CHANNELS / SIZE;
        if frames == 0 {
            return None;
        }
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(SIZE);
        let w = window();
        let mut spec = fft.make_output_vec();
        let mut buf = vec![0f32; SIZE];
        // Per frame, per channel: its power per bin.
        let mut spectra: Vec<[Vec<f32>; CHANNELS]> = Vec::with_capacity(frames);
        for f in 0..frames {
            let one = |c: usize, buf: &mut Vec<f32>, spec: &mut Vec<Complex32>| {
                for (i, b) in buf.iter_mut().enumerate() {
                    *b = samples[(f * SIZE + i) * CHANNELS + c] * w[i];
                }
                let _ = fft.process(buf, spec);
                spec.iter().map(|z| z.norm_sqr()).collect::<Vec<f32>>()
            };
            spectra.push([one(0, &mut buf, &mut spec), one(1, &mut buf, &mut spec)]);
        }
        let mut power: [Vec<f32>; CHANNELS] = [vec![0.0; BINS], vec![0.0; BINS]];
        for c in 0..CHANNELS {
            let mut order: Vec<(f32, usize)> = spectra.iter().enumerate().map(|(i, s)| (s[c].iter().sum::<f32>(), i)).collect();
            order.sort_by(|a, b| a.0.total_cmp(&b.0));
            let keep = ((frames as f32 * QUIET).ceil() as usize).clamp(1, frames);
            for &(_, i) in &order[..keep] {
                for (p, x) in power[c].iter_mut().zip(&spectra[i][c]) {
                    *p += x / keep as f32;
                }
            }
            // Smooth along the frequency axis, so a bin's estimate isn't its few frames' luck.
            let raw = power[c].clone();
            for (k, p) in power[c].iter_mut().enumerate() {
                let (lo, hi) = (k.saturating_sub(3), (k + 3).min(BINS - 1));
                *p = raw[lo..=hi].iter().sum::<f32>() / (hi - lo + 1) as f32;
            }
        }
        Some(NoiseProfile { power })
    }

    /// The noise in `n` samples of `source` from sample `start` (at most the first 90 s).
    pub fn of_source(source: &mut dyn AudioSource, rate: u32, start: i64, n: i64) -> Result<Option<NoiseProfile>, AudioError> {
        let end = source.end().map_or(n, |e| (e - start).clamp(0, n)).min(MAX_SECONDS * rate as i64);
        if end <= 0 {
            return Ok(None);
        }
        let mut samples = vec![0f32; end as usize * CHANNELS];
        source.read(start, &mut samples)?;
        Ok(NoiseProfile::estimate(&samples))
    }
}

type Key = (String, u32, i64, i64);

static PROFILES: Mutex<Option<HashMap<Key, Option<Arc<NoiseProfile>>>>> = Mutex::new(None);

/// The noise profile of `n` samples of `source` from `start`, kept by file, rate and range: a
/// project edit or the export's own mixer doesn't read the clip again for it.
pub fn profile_of(path: &str, source: &mut dyn AudioSource, rate: u32, start: i64, n: i64) -> Option<Arc<NoiseProfile>> {
    let key = (path.to_string(), rate, start, n);
    if let Some(found) = PROFILES.lock().ok()?.get_or_insert_with(HashMap::new).get(&key) {
        return found.clone();
    }
    let made = NoiseProfile::of_source(source, rate, start, n).ok().flatten().map(Arc::new);
    PROFILES.lock().ok()?.get_or_insert_with(HashMap::new).insert(key, made.clone());
    made
}

/// One channel's running state.
struct Lane {
    /// The last `SIZE` input samples, oldest at `Denoiser::at`.
    input: Vec<f32>,
    /// The output being built (its first sample is the next to play).
    output: Vec<f32>,
    /// The last frame's post-gain power over the noise (a posteriori SNR times gain squared
    /// per bin), for the decision-directed estimate.
    clean: Vec<f32>,
}

pub struct Denoiser {
    fft: Arc<dyn RealToComplex<f32>>,
    ifft: Arc<dyn ComplexToReal<f32>>,
    window: Vec<f32>,
    profile: Arc<NoiseProfile>,
    /// The lowest gain a bin gets (linear).
    floor: f32,
    /// How many times the profile's power counts as noise.
    over: f32,
    lanes: [Lane; CHANNELS],
    at: usize,
    fill: usize,
}

impl Denoiser {
    /// `strength` 0–1: 0 passes the sound, 1 cuts the noise by up to 30 dB (10 dB at the
    /// least above 0).
    pub fn new(profile: Arc<NoiseProfile>, strength: f32) -> Denoiser {
        let s = strength.clamp(0.0, 1.0);
        let planner = &mut RealFftPlanner::<f32>::new();
        let lane = || Lane { input: vec![0.0; SIZE], output: vec![0.0; SIZE], clean: vec![0.0; BINS] };
        Denoiser {
            fft: planner.plan_fft_forward(SIZE),
            ifft: planner.plan_fft_inverse(SIZE),
            window: window(),
            profile,
            floor: 10f32.powf(-(10.0 + 20.0 * s) / 20.0),
            over: 1.0 + 0.5 * s,
            lanes: [lane(), lane()],
            at: 0,
            fill: 0,
        }
    }

    fn frame(&mut self, c: usize) {
        let lane = &mut self.lanes[c];
        let mut buf: Vec<f32> = lane.input[self.at..].iter().chain(&lane.input[..self.at]).zip(&self.window).map(|(x, w)| x * w).collect();
        let mut spec = self.fft.make_output_vec();
        let _ = self.fft.process(&mut buf, &mut spec);
        let noise = &self.profile.power[c];
        let mut gain = vec![1f32; BINS];
        for k in 0..BINS {
            let n = noise[k] * self.over;
            if n <= 1e-12 {
                lane.clean[k] = 0.0;
                continue;
            }
            let post = spec[k].norm_sqr() / n;
            let prior = (SMOOTHING * lane.clean[k] + (1.0 - SMOOTHING) * (post - 1.0).max(0.0)).max(MIN_SNR);
            gain[k] = prior / (1.0 + prior);
            lane.clean[k] = gain[k] * gain[k] * post;
        }
        // The mask smoothed over three bins, and floored.
        for (k, z) in spec.iter_mut().enumerate() {
            let (a, b) = (gain[k.saturating_sub(1)], gain[(k + 1).min(BINS - 1)]);
            *z *= (0.25 * a + 0.5 * gain[k] + 0.25 * b).max(self.floor);
        }
        let mut time = vec![0f32; SIZE];
        let _ = self.ifft.process(&mut spec, &mut time);
        // The inverse is unnormalised; the squared windows add to 2 at this hop.
        let scale = 1.0 / (SIZE as f32 * 2.0);
        for (i, t) in time.iter().enumerate() {
            lane.output[i] += t * self.window[i] * scale;
        }
    }
}

impl Processor for Denoiser {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            for (c, x) in frame.iter_mut().enumerate() {
                self.lanes[c].input[self.at] = *x;
                *x = self.lanes[c].output[self.fill];
            }
            self.at = (self.at + 1) % SIZE;
            self.fill += 1;
            if self.fill == HOP {
                self.fill = 0;
                for c in 0..CHANNELS {
                    self.lanes[c].output.drain(..HOP);
                    self.lanes[c].output.resize(SIZE, 0.0);
                    self.frame(c);
                }
            }
        }
    }

    fn latency(&self) -> usize {
        SIZE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 48_000.0;

    /// A small deterministic noise generator (xorshift), uniform in −1..1.
    fn noise(seed: &mut u32) -> f32 {
        *seed ^= *seed << 13;
        *seed ^= *seed >> 17;
        *seed ^= *seed << 5;
        (*seed as f32 / u32::MAX as f32) * 2.0 - 1.0
    }

    fn rms(x: &[f32]) -> f64 {
        (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt()
    }

    /// The mean energy of the left channel of `x` between `lo` and `hi` Hz.
    fn band(x: &[f32], lo: f64, hi: f64) -> f64 {
        let n = x.len() / CHANNELS;
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(SIZE);
        let w = window();
        let mut total = 0.0;
        let mut spec = fft.make_output_vec();
        let mut frames = 0;
        let mut at = 0;
        while at + SIZE <= n {
            let mut buf: Vec<f32> = (0..SIZE).map(|i| x[(at + i) * CHANNELS] * w[i]).collect();
            let _ = fft.process(&mut buf, &mut spec);
            for (k, z) in spec.iter().enumerate() {
                let f = k as f64 * RATE / SIZE as f64;
                if f >= lo && f <= hi {
                    total += z.norm_sqr() as f64;
                }
            }
            frames += 1;
            at += SIZE;
        }
        total / frames as f64
    }

    fn db(a: f64, b: f64) -> f64 {
        10.0 * (a / b).log10()
    }

    /// `secs` of 1 kHz at 0.3 (when `tone`) over white noise of `level`, stereo.
    fn make(secs: f64, tone: bool, level: f32, seed: &mut u32) -> Vec<f32> {
        (0..(secs * RATE) as usize)
            .flat_map(|i| {
                let t = if tone { 0.3 * (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / RATE).sin() as f32 } else { 0.0 };
                [t + level * noise(seed), t + level * noise(seed)]
            })
            .collect()
    }

    fn run(profile_of: &[f32], input: &[f32], strength: f32) -> Vec<f32> {
        let profile = Arc::new(NoiseProfile::estimate(profile_of).unwrap());
        let mut d = Denoiser::new(profile, strength);
        let mut out = input.to_vec();
        // Past its latency, so what's measured lines up.
        d.process(&mut out);
        out
    }

    #[test]
    fn the_tone_survives_and_the_noise_floor_drops() {
        let mut seed = 12345;
        // The clip: a tone, with half a second of only noise in front of it for the profile.
        let mut clip = make(0.5, false, 0.05, &mut seed);
        clip.extend(make(4.0, true, 0.05, &mut seed));
        let out = run(&clip, &clip, 0.7);
        let (a, b) = (clip.len() / 5, clip.len());
        // Away from the first frames (the filter's start-up) and from the tone's skirt.
        let tone_in = band(&clip[a..b], 900.0, 1100.0);
        let tone_out = band(&out[a + SIZE * CHANNELS..b], 900.0, 1100.0);
        assert!(db(tone_out, tone_in).abs() < 0.5, "tone {} dB", db(tone_out, tone_in));
        let floor_in = band(&clip[a..b], 2000.0, 12_000.0);
        let floor_out = band(&out[a + SIZE * CHANNELS..b], 2000.0, 12_000.0);
        let drop = db(floor_in, floor_out);
        assert!(drop > 20.0, "the noise floor dropped {drop} dB");
    }

    #[test]
    fn noise_alone_goes_quiet_and_silence_stays_silence() {
        let mut seed = 99;
        let clip = make(3.0, false, 0.05, &mut seed);
        let out = run(&clip, &clip, 0.7);
        let tail = &out[clip.len() / 2..];
        let drop = 20.0 * (rms(&clip[clip.len() / 2..]) / rms(tail)).log10();
        assert!(drop > 15.0, "{drop} dB");
        let silent = vec![0f32; 48_000 * CHANNELS * 2];
        let profile = NoiseProfile::estimate(&silent).unwrap();
        let mut d = Denoiser::new(Arc::new(profile), 1.0);
        let mut out = silent.clone();
        d.process(&mut out);
        assert!(out.iter().all(|x| *x == 0.0));
    }

    #[test]
    fn strength_zero_cut_is_gentle_and_one_cuts_more() {
        let mut seed = 7;
        let clip = make(3.0, false, 0.05, &mut seed);
        let low = rms(&run(&clip, &clip, 0.1)[clip.len() / 2..]);
        let high = rms(&run(&clip, &clip, 1.0)[clip.len() / 2..]);
        assert!(high < low);
    }
}
