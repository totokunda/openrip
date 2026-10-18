//! OpenRip's own voice effects, for the app's clips: classic DSP that behaves like CapCut's
//! common voice filters without CapCut's bundles (docs/parity/voice-effects.md, "OpenRip's
//! own effects"). The app lists its presets in `lib/audio-effects.ts`; each names one of the
//! kinds here with its parameters, and a clip's effects play one after another, after its
//! speed change and before its volume, as CapCut's do.
//!
//! Every kind takes `strength` (0–100, default 100): the processed sound against the clip's
//! own, CapCut's strength slider. The others, by kind (defaults in brackets):
//!
//! - `pitch`: `semitones` [−4], `formant` semitones [follows `semitones`]: a phase vocoder
//!   moving the partials, and the spectral envelope (the voice's size) separately.
//! - `robot`: `pitch` Hz [120]: every partial on one monotone buzz (the phase vocoder with
//!   its phases dropped, frames at the buzz's period).
//! - `echo`: `delay` ms [250], `feedback` 0–100 [40], `mix` 0–100 [40], `damping` Hz
//!   [5000] (each repeat duller).
//! - `reverb`: `decay` s [1.8], `size` 0–100 [60], `damping` 0–100 [50], `predelay` ms
//!   [20], `mix` 0–100 [30]: the feedback delay network of [`crate::reverb`].
//! - `chorus`: `rate` Hz [1.5], `depth` ms [3], `delay` ms [12], `feedback` 0–100 [0],
//!   `mix` 0–100 [50]; at mix 100 and no feedback it's a vibrato.
//! - `tremolo`: `rate` Hz [6], `depth` 0–100 [60].
//! - `distortion`: `drive` dB [18], `tone` Hz [6000].
//! - `bitcrush`: `bits` [6], `downsample` [6] (samples held).
//! - `lowpass`, `highpass`: `frequency` Hz [1200 / 600], `q` [0.71].
//! - `eq`: `low`, `mid`, `high` dB [0] (shelves at 120 Hz and 6 kHz, a bell at 1.5 kHz).
//! - `telephone`: the 300–3400 Hz band of a phone line, a little overdriven; `drive` dB [8].
//! - `megaphone`: a narrower band with a honk at 2 kHz, hard overdriven; `drive` dB [20].
//!
//! Each ends in a limiter just under full scale, as CapCut's presets do.

use std::collections::BTreeMap;
use std::f32::consts::PI;
use std::sync::Arc;

use realfft::num_complex::Complex32;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};

use crate::fx::{Biquad, Chain, Chorus, Gain, Limiter, PitchShift, Processor, Tremolo};
use crate::reverb::{Reverb, ReverbParams};
use crate::CHANNELS;

/// The kinds of effect, as `lib/audio-effects.ts` names them.
pub const KINDS: [&str; 14] = ["pitch", "robot", "echo", "reverb", "chorus", "tremolo", "distortion", "bitcrush", "lowpass", "highpass", "eq", "telephone", "megaphone", "gain"];

/// An effect of OpenRip's own, ready to process: `kind` with `params` by name (missing ones
/// take their defaults). `Err` for a kind there isn't.
pub fn builtin(kind: &str, params: &BTreeMap<String, f64>, rate: u32) -> Result<Chain, String> {
    let fs = rate as f32;
    let get = |name: &str, default: f64| params.get(name).copied().filter(|v| v.is_finite()).unwrap_or(default) as f32;
    let pct = |name: &str, default: f64| (get(name, default) / 100.0).clamp(0.0, 1.0);
    let mut procs: Vec<Box<dyn Processor>> = Vec::new();
    match kind {
        "pitch" => {
            let semitones = get("semitones", -4.0).clamp(-24.0, 24.0);
            let formant = get("formant", semitones as f64).clamp(-24.0, 24.0);
            if semitones.abs() > 1e-6 || formant.abs() > 1e-6 {
                procs.push(Box::new(PitchShift::new(2f32.powf(semitones / 12.0), 2f32.powf(formant / 12.0))));
            }
        }
        "robot" => procs.push(Box::new(Robot::new(get("pitch", 120.0).clamp(30.0, 1000.0), fs))),
        "echo" => procs.push(Box::new(Echo::new(get("delay", 250.0).clamp(1.0, 2000.0) / 1000.0, pct("feedback", 40.0).min(0.95), pct("mix", 40.0), get("damping", 5000.0), fs))),
        "reverb" => {
            let decay = get("decay", 1.8).clamp(0.1, 20.0);
            let damping = pct("damping", 50.0);
            let pre = get("predelay", 20.0).clamp(0.0, 500.0) / 1000.0;
            procs.push(Box::new(Reverb::new(
                ReverbParams {
                    low_rt60: decay * 1.2,
                    mid_rt60: decay,
                    // Damped, the highs die in as little as a fifth of the time.
                    high_rt60: decay * (1.0 - 0.8 * damping),
                    crossover: 250.0,
                    damping: 6000.0 - 4000.0 * damping,
                    pre_delay: [pre, pre * 1.1],
                    size: 0.25 + 1.25 * pct("size", 60.0),
                    width: 1.0,
                    mix: pct("mix", 30.0),
                    wet_gain: 1.0,
                },
                rate,
            )));
        }
        "chorus" => procs.push(Box::new(Chorus::with(get("delay", 12.0).clamp(0.5, 50.0), get("depth", 3.0).clamp(0.0, 20.0), get("rate", 1.5).clamp(0.01, 20.0), pct("feedback", 0.0).min(0.9), pct("mix", 50.0), PI / 2.0, fs))),
        "tremolo" => {
            // CapCut's tremolo (a swing of ±depth/2 about unity), scaled so its peaks stay at
            // the clip's level.
            let depth = pct("depth", 60.0);
            procs.push(Box::new(Tremolo::with(get("rate", 6.0).clamp(0.1, 40.0), depth, 0.0, fs)));
            procs.push(Box::new(Gain(1.0 / (1.0 + depth * 0.5))));
        }
        "distortion" => procs.push(Box::new(Drive::new(get("drive", 18.0).clamp(0.0, 48.0), get("tone", 6000.0), fs))),
        "bitcrush" => procs.push(Box::new(Crush::new(get("bits", 6.0).clamp(1.0, 16.0), get("downsample", 6.0).clamp(1.0, 64.0)))),
        "lowpass" | "highpass" => {
            let mode = if kind == "lowpass" { "LowPass" } else { "HighPass" };
            let freq = get("frequency", if kind == "lowpass" { 1200.0 } else { 600.0 });
            procs.push(Box::new(Filters(Biquad::new(mode, freq, get("q", 0.71), 0.0, fs).into_iter().collect())));
        }
        "eq" => {
            let filters = [("LowShelf", 120.0, 0.71, get("low", 0.0)), ("Bell", 1500.0, 0.8, get("mid", 0.0)), ("HighShelf", 6000.0, 0.71, get("high", 0.0))];
            procs.push(Box::new(Filters(filters.iter().filter(|f| f.3.abs() > 1e-6).filter_map(|&(m, f, q, g)| Biquad::new(m, f, q, g, fs)).collect())));
        }
        "telephone" => {
            procs.push(Box::new(band(&[("HighPass", 300.0, 0.0), ("HighPass", 300.0, 0.0), ("LowPass", 3400.0, 0.0), ("LowPass", 3400.0, 0.0), ("Bell", 1000.0, 3.0)], fs)));
            procs.push(Box::new(Drive::new(get("drive", 8.0).clamp(0.0, 48.0), 3400.0, fs)));
        }
        "megaphone" => {
            procs.push(Box::new(band(&[("HighPass", 600.0, 0.0), ("HighPass", 600.0, 0.0), ("LowPass", 3800.0, 0.0), ("LowPass", 3800.0, 0.0), ("Bell", 2000.0, 9.0)], fs)));
            procs.push(Box::new(Drive::new(get("drive", 20.0).clamp(0.0, 48.0), 4000.0, fs)));
        }
        "gain" => procs.push(Box::new(Gain(10f32.powf(get("db", 0.0).clamp(-60.0, 24.0) / 20.0)))),
        _ => return Err(format!("no voice effect {kind:?}")),
    }
    procs.push(Box::new(Limiter::new(0.0, -0.3, 500.0, fs)));
    Ok(Chain::series(procs, pct("strength", 100.0), rate))
}

/// Biquads one after another, on both channels.
struct Filters(Vec<Biquad>);

impl Processor for Filters {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            for (c, x) in frame.iter_mut().enumerate() {
                *x = self.0.iter_mut().fold(*x, |y, f| f.tick(c, y));
            }
        }
    }
}

/// A band-limiting chain: (mode, frequency, gain dB) at Q 0.71 (a bell at Q 1).
fn band(spec: &[(&str, f32, f32)], fs: f32) -> Filters {
    Filters(spec.iter().filter_map(|&(mode, freq, db)| Biquad::new(mode, freq, if mode == "Bell" { 1.0 } else { 0.71 }, db, fs)).collect())
}

/// The input `n` samples late, scaled (the dry path beside a processing with latency).
pub(crate) struct Delay {
    line: Vec<f32>,
    at: usize,
    gain: f32,
}

impl Delay {
    pub(crate) fn new(n: usize, gain: f32) -> Delay {
        Delay { line: vec![0.0; n * CHANNELS], at: 0, gain }
    }
}

impl Processor for Delay {
    fn process(&mut self, buf: &mut [f32]) {
        if self.line.is_empty() {
            buf.iter_mut().for_each(|x| *x *= self.gain);
            return;
        }
        for x in buf.iter_mut() {
            let y = self.line[self.at];
            self.line[self.at] = *x;
            self.at = (self.at + 1) % self.line.len();
            *x = y * self.gain;
        }
    }

    fn latency(&self) -> usize {
        self.line.len() / CHANNELS
    }
}

/// Repeats `delay` s apart, each `feedback` of the last and duller (a one-pole low-pass at
/// `damping` Hz in the loop), mixed in at `mix`.
struct Echo {
    line: Vec<[f32; CHANNELS]>,
    at: usize,
    feedback: f32,
    mix: f32,
    damp: f32,
    lp: [f32; CHANNELS],
}

impl Echo {
    fn new(delay: f32, feedback: f32, mix: f32, damping: f32, fs: f32) -> Echo {
        let damp = 1.0 - (-2.0 * PI * damping.clamp(100.0, fs * 0.45) / fs).exp();
        Echo { line: vec![[0.0; CHANNELS]; (delay * fs).round().max(1.0) as usize], at: 0, feedback, mix, damp, lp: [0.0; CHANNELS] }
    }
}

impl Processor for Echo {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            let delayed = self.line[self.at];
            for c in 0..CHANNELS {
                self.lp[c] += self.damp * (delayed[c] - self.lp[c]);
                self.line[self.at][c] = frame[c] + self.feedback * self.lp[c];
                frame[c] = frame[c] * (1.0 - self.mix * 0.5) + delayed[c] * self.mix;
            }
            self.at = (self.at + 1) % self.line.len();
        }
    }
}

/// Soft clipping: the sound driven up by `drive` dB into a tanh curve, the result taken back
/// down by half the drive (so a quiet voice gets louder and grittier, not deafening), and
/// smoothed by a low-pass at `tone` Hz.
struct Drive {
    gain: f32,
    out: f32,
    tone: Biquad,
}

impl Drive {
    fn new(drive_db: f32, tone: f32, fs: f32) -> Drive {
        let gain = 10f32.powf(drive_db / 20.0);
        Drive { gain, out: 1.0 / gain.sqrt(), tone: Biquad::new("LowPass", tone, 0.71, 0.0, fs).unwrap_or_default() }
    }
}

impl Processor for Drive {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            for (c, x) in frame.iter_mut().enumerate() {
                *x = self.tone.tick(c, (*x * self.gain).tanh() * self.out);
            }
        }
    }
}

/// Fewer bits and a lower rate: each sample held for `hold` samples, rounded to `bits`.
struct Crush {
    step: f32,
    hold: f32,
    count: f32,
    held: [f32; CHANNELS],
}

impl Crush {
    fn new(bits: f32, hold: f32) -> Crush {
        Crush { step: 2f32.powf(1.0 - bits), hold, count: hold, held: [0.0; CHANNELS] }
    }
}

impl Processor for Crush {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            self.count += 1.0;
            if self.count >= self.hold {
                self.count -= self.hold;
                for c in 0..CHANNELS {
                    self.held[c] = (frame[c] / self.step).round() * self.step;
                }
            }
            frame.copy_from_slice(&self.held);
        }
    }
}

const ROBOT_SIZE: usize = 1024;

/// The classic robot voice: the sound cut into windowed frames, each frame's spectrum kept
/// in level with every phase set to zero (a click shaped like the frame's spectrum), and the
/// clicks laid down one buzz period apart, so the voice keeps its words on one pitch.
struct Robot {
    fft: Arc<dyn RealToComplex<f32>>,
    ifft: Arc<dyn ComplexToReal<f32>>,
    window: Vec<f32>,
    hop: usize,
    /// Per channel: the last `ROBOT_SIZE` input samples (a ring, oldest at `at`), and the
    /// output being built.
    input: [Vec<f32>; CHANNELS],
    at: usize,
    output: [Vec<f32>; CHANNELS],
    fill: usize,
    scale: f32,
}

impl Robot {
    fn new(pitch: f32, fs: f32) -> Robot {
        let mut planner = RealFftPlanner::<f32>::new();
        let hop = (fs / pitch).round().clamp(16.0, ROBOT_SIZE as f32) as usize;
        let window: Vec<f32> = (0..ROBOT_SIZE).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / ROBOT_SIZE as f32).cos()).collect();
        // Overlapping frames `hop` apart sum the window squared to about 3/8 of the frame per
        // hop.
        let scale = hop as f32 / (0.375 * ROBOT_SIZE as f32) / ROBOT_SIZE as f32;
        let zero = || vec![0f32; ROBOT_SIZE];
        Robot { fft: planner.plan_fft_forward(ROBOT_SIZE), ifft: planner.plan_fft_inverse(ROBOT_SIZE), window, hop, input: [zero(), zero()], at: 0, output: [zero(), zero()], fill: 0, scale }
    }

    fn frame(&mut self, c: usize) {
        let ring = &self.input[c];
        let mut buf: Vec<f32> = ring[self.at..].iter().chain(&ring[..self.at]).zip(&self.window).map(|(x, w)| x * w).collect();
        let mut spec = self.fft.make_output_vec();
        let _ = self.fft.process(&mut buf, &mut spec);
        // Zero phase, centred in the frame (a sign flip on odd bins), so the click sits in
        // the middle of its window.
        for (k, z) in spec.iter_mut().enumerate() {
            let m = z.norm();
            *z = Complex32::new(if k % 2 == 0 { m } else { -m }, 0.0);
        }
        let mut time = vec![0f32; ROBOT_SIZE];
        let _ = self.ifft.process(&mut spec, &mut time);
        for (i, t) in time.iter().enumerate() {
            self.output[c][i] += t * self.window[i] * self.scale;
        }
    }
}

impl Processor for Robot {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            for (c, x) in frame.iter_mut().enumerate() {
                self.input[c][self.at] = *x;
                *x = self.output[c][self.fill];
            }
            self.at = (self.at + 1) % ROBOT_SIZE;
            self.fill += 1;
            if self.fill == self.hop {
                self.fill = 0;
                for c in 0..CHANNELS {
                    self.output[c].drain(..self.hop);
                    self.output[c].resize(ROBOT_SIZE, 0.0);
                    self.frame(c);
                }
            }
        }
    }

    fn latency(&self) -> usize {
        ROBOT_SIZE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FS: u32 = 48_000;

    fn sine(f: f32, secs: f32, amp: f32) -> Vec<f32> {
        (0..(secs * FS as f32) as usize)
            .flat_map(|i| {
                let x = amp * (2.0 * PI * f * i as f32 / FS as f32).sin();
                [x, x]
            })
            .collect()
    }

    fn run(kind: &str, params: &[(&str, f64)], input: &mut [f32]) {
        let p: BTreeMap<String, f64> = params.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        let mut chain = builtin(kind, &p, FS).unwrap();
        for block in input.chunks_mut(1024 * CHANNELS) {
            chain.process(block);
        }
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    /// Strongest frequency of the left channel over the second half (Hz).
    fn peak_hz(x: &[f32]) -> f32 {
        let n = 16384;
        let mut buf: Vec<f32> = x.iter().step_by(2).skip(x.len() / 2 - n).take(n).copied().collect();
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(n);
        let mut out = fft.make_output_vec();
        fft.process(&mut buf, &mut out).unwrap();
        let k = out.iter().enumerate().skip(1).max_by(|a, b| a.1.norm().partial_cmp(&b.1.norm()).unwrap()).unwrap().0;
        k as f32 * FS as f32 / n as f32
    }

    /// The level (dB) of a sine at `f` through `kind` against the sine itself.
    fn response(kind: &str, params: &[(&str, f64)], f: f32) -> f32 {
        let mut x = sine(f, 1.0, 0.1);
        run(kind, params, &mut x);
        20.0 * (rms(&x[x.len() / 2..]) / rms(&sine(f, 0.5, 0.1))).log10()
    }

    #[test]
    fn every_kind_builds_and_unknown_ones_dont() {
        for kind in KINDS {
            let mut x = sine(440.0, 0.5, 0.3);
            run(kind, &[], &mut x);
            assert!(x.iter().all(|v| v.is_finite() && v.abs() <= 1.0), "{kind}");
        }
        assert!(builtin("teleport", &BTreeMap::new(), FS).is_err());
    }

    #[test]
    fn pitch_moves_a_tone() {
        let mut x = sine(220.0, 2.0, 0.3);
        run("pitch", &[("semitones", 7.0), ("formant", 0.0)], &mut x);
        let want = 220.0 * 2f32.powf(7.0 / 12.0);
        assert!((peak_hz(&x) - want).abs() < 4.0, "{} Hz (want {want})", peak_hz(&x));
    }

    #[test]
    fn robot_puts_everything_on_its_pitch() {
        // A 300 Hz tone comes out as harmonics of the 100 Hz buzz: its energy sits at
        // multiples of 100 Hz.
        let mut x = sine(300.0, 2.0, 0.3);
        run("robot", &[("pitch", 100.0)], &mut x);
        let f = peak_hz(&x);
        assert!((f / 100.0 - (f / 100.0).round()).abs() < 0.05, "{f} Hz");
        assert!(rms(&x[x.len() / 2..]) > 0.01);
    }

    #[test]
    fn echo_repeats_an_impulse() {
        let mut x = vec![0f32; FS as usize * CHANNELS];
        x[0] = 0.5;
        x[1] = 0.5;
        run("echo", &[("delay", 100.0), ("feedback", 50.0), ("mix", 100.0), ("damping", 20000.0)], &mut x);
        let at = |ms: usize| x[(ms * FS as usize / 1000) * CHANNELS].abs();
        // The repeats at 100 and 200 ms, the second half the first; nothing between.
        assert!(at(100) > 0.2 && (at(200) / at(100) - 0.5).abs() < 0.1, "{} {}", at(100), at(200));
        assert!(at(150) < 1e-4);
    }

    #[test]
    fn reverb_leaves_a_tail() {
        let mut x = sine(500.0, 0.5, 0.3);
        x.extend(vec![0f32; FS as usize * CHANNELS]);
        run("reverb", &[("decay", 2.0), ("mix", 50.0)], &mut x);
        let tail = &x[(FS as usize / 2 + FS as usize / 4) * CHANNELS..FS as usize * CHANNELS];
        assert!(rms(tail) > 0.002, "{}", rms(tail));
        // Off, it's silent there.
        let mut dry = sine(500.0, 0.5, 0.3);
        dry.extend(vec![0f32; FS as usize * CHANNELS]);
        run("reverb", &[("mix", 0.0)], &mut dry);
        assert!(rms(&dry[(FS as usize / 2 + FS as usize / 4) * CHANNELS..FS as usize * CHANNELS]) < 1e-6);
    }

    #[test]
    fn filters_and_bands_pass_what_they_should() {
        assert!(response("lowpass", &[("frequency", 1000.0)], 200.0).abs() < 0.5);
        assert!(response("lowpass", &[("frequency", 1000.0)], 8000.0) < -30.0);
        assert!(response("highpass", &[("frequency", 1000.0)], 8000.0).abs() < 0.5);
        assert!(response("highpass", &[("frequency", 1000.0)], 100.0) < -30.0);
        // A phone line drops the lows and highs and keeps the voice's middle.
        let (low, mid, high) = (response("telephone", &[], 100.0), response("telephone", &[], 1000.0), response("telephone", &[], 8000.0));
        assert!(low < mid - 20.0 && high < mid - 20.0, "{low} {mid} {high}");
        let (low, mid) = (response("megaphone", &[], 200.0), response("megaphone", &[], 2000.0));
        assert!(low < mid - 20.0, "{low} {mid}");
        // The EQ's shelves.
        assert!((response("eq", &[("low", 9.0)], 40.0) - 9.0).abs() < 1.0);
        assert!(response("eq", &[("low", 9.0)], 5000.0).abs() < 0.5);
    }

    #[test]
    fn distortion_and_bitcrush_add_harmonics() {
        // A pure tone's energy away from its own frequency (a Hann-windowed spectrum, more than
        // 50 Hz from the tone), against its total: what the effect added.
        let added = |kind: &str, params: &[(&str, f64)]| {
            let mut x = sine(500.0, 1.0, 0.5);
            run(kind, params, &mut x);
            let n = 16384;
            let mut buf: Vec<f32> = x.iter().step_by(2).skip(x.len() / 2 - n).take(n).enumerate().map(|(i, v)| v * (0.5 - 0.5 * (2.0 * PI * i as f32 / n as f32).cos())).collect();
            let fft = RealFftPlanner::<f32>::new().plan_fft_forward(n);
            let mut out = fft.make_output_vec();
            fft.process(&mut buf, &mut out).unwrap();
            let hz = |k: usize| k as f32 * FS as f32 / n as f32;
            let total: f32 = out.iter().map(|z| z.norm_sqr()).sum();
            out.iter().enumerate().filter(|(k, _)| (hz(*k) - 500.0).abs() > 50.0).map(|(_, z)| z.norm_sqr()).sum::<f32>() / total
        };
        assert!(added("distortion", &[("drive", 24.0), ("tone", 20000.0)]) > 0.01);
        assert!(added("bitcrush", &[("bits", 3.0), ("downsample", 1.0)]) > 0.01);
        assert!(added("bitcrush", &[("bits", 16.0), ("downsample", 8.0)]) > 0.001);
        assert!(added("lowpass", &[("frequency", 20000.0)]) < 1e-5);
    }

    #[test]
    fn tremolo_and_chorus_move_the_sound() {
        // The tremolo's level swings at its rate: at full depth from a third of the clip's
        // level to all of it (20 ms windows).
        let mut x = sine(1000.0, 1.0, 0.3);
        run("tremolo", &[("rate", 5.0), ("depth", 100.0)], &mut x);
        let levels: Vec<f32> = x.chunks(960 * 2).map(rms).collect();
        let (lo, hi) = levels.iter().fold((f32::MAX, 0f32), |(a, b), &v| (a.min(v), b.max(v)));
        assert!(hi > lo * 2.5 && hi <= rms(&sine(1000.0, 0.5, 0.3)) * 1.01, "{lo} {hi}");
        // A chorus at full wet with no feedback is a vibrato: same level, wobbling pitch.
        let mut x = sine(1000.0, 1.0, 0.3);
        run("chorus", &[("mix", 100.0), ("depth", 5.0)], &mut x);
        assert!((rms(&x[x.len() / 2..]) / rms(&sine(1000.0, 0.5, 0.3)) - 1.0).abs() < 0.1);
    }

    #[test]
    fn strength_mixes_the_clips_own_sound_back_in_step() {
        // At strength 0 a pitch shift gives back the input, only later by its latency.
        let input = sine(330.0, 1.0, 0.3);
        let mut x = input.clone();
        run("pitch", &[("semitones", 5.0), ("strength", 0.0)], &mut x);
        let lat = 2048 * CHANNELS;
        let diff = x[lat..].iter().zip(&input).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(diff < 1e-6, "{diff}");
    }
}
