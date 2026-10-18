//! A feedback delay network reverb, for CapCut's StudioReverb and Reverb processors and
//! OpenRip's own room presets.
//!
//! Eight delay lines feed back into each other through an orthogonal (Hadamard) matrix, so
//! the echoes multiply into a dense tail without colouring it. Each line loses, per pass,
//! what makes its band die away in the band's RT60 (Jot's way): the line's signal is split
//! into lows (below the crossover), highs (above the damping frequency) and the mids between,
//! each scaled by its own gain. The input is spread by a short chain of all-passes first, so
//! the tail starts smooth, and arrives after a pre-delay per side. The tail's level is set so
//! its energy matches the input's whatever its length: the wet gain alone sets how loud it is.

use std::f32::consts::PI;

use crate::CHANNELS;

const LINES: usize = 8;
/// The lines' lengths for a hall (ms): mutually prime at any common rate, spread over about
/// an octave.
const HALL_MS: [f32; LINES] = [31.7, 37.1, 41.9, 47.3, 53.9, 59.1, 67.3, 73.1];
/// The input all-passes (ms) and their gain.
const DIFFUSE_MS: [f32; 4] = [4.77, 3.59, 12.73, 9.31];
const DIFFUSE_GAIN: f32 = 0.6;

/// How a reverb sounds; times in seconds, frequencies in Hz.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ReverbParams {
    /// The tail's RT60 below the crossover, between it and the damping frequency, and above.
    pub low_rt60: f32,
    pub mid_rt60: f32,
    pub high_rt60: f32,
    pub crossover: f32,
    pub damping: f32,
    /// Before the tail starts, per side (s).
    pub pre_delay: [f32; 2],
    /// The room's size: 1 for a hall; the lines scale with it.
    pub size: f32,
    /// 0 (mono) to 1 (the tail as wide as it comes).
    pub width: f32,
    /// The tail's share against the dry sound (0–1), and its gain (linear).
    pub mix: f32,
    pub wet_gain: f32,
}

impl Default for ReverbParams {
    fn default() -> Self {
        ReverbParams { low_rt60: 2.0, mid_rt60: 2.0, high_rt60: 1.0, crossover: 200.0, damping: 4000.0, pre_delay: [0.0; 2], size: 1.0, width: 1.0, mix: 0.3, wet_gain: 1.0 }
    }
}

/// A one-pole low-pass coefficient for a corner frequency.
fn one_pole(freq: f32, fs: f32) -> f32 {
    1.0 - (-2.0 * PI * freq.clamp(1.0, fs * 0.45) / fs).exp()
}

/// A delay line read `len` samples back.
#[derive(Clone)]
struct Line {
    buf: Vec<f32>,
    at: usize,
}

impl Line {
    fn new(len: usize) -> Line {
        Line { buf: vec![0.0; len.max(1)], at: 0 }
    }

    /// The sample `len` back, replaced by `x`.
    fn swap(&mut self, x: f32) -> f32 {
        let y = self.buf[self.at];
        self.buf[self.at] = x;
        self.at = (self.at + 1) % self.buf.len();
        y
    }
}

/// A Schroeder all-pass: flat in level, smearing in time.
#[derive(Clone)]
struct AllPass {
    line: Line,
    g: f32,
}

impl AllPass {
    fn tick(&mut self, x: f32) -> f32 {
        let d = self.line.buf[self.line.at];
        let v = x + self.g * d;
        self.line.swap(v);
        d - self.g * v
    }
}

pub(crate) struct Reverb {
    lines: Vec<Line>,
    /// Per line: the band gains per pass (low, mid, high) and its two filter states.
    gains: Vec<[f32; 3]>,
    split: Vec<[f32; 2]>,
    cross: f32,
    damp: f32,
    pre: [Line; 2],
    diffuse: Vec<AllPass>,
    /// Scales the input so the tail's energy matches it.
    norm: f32,
    width: f32,
    mix: f32,
    wet_gain: f32,
}

impl Reverb {
    pub(crate) fn new(p: ReverbParams, rate: u32) -> Reverb {
        let fs = rate as f32;
        let ms = fs / 1000.0;
        let lens: Vec<usize> = HALL_MS.iter().map(|m| (m * p.size.clamp(0.05, 4.0) * ms).round().max(8.0) as usize).collect();
        // A pass through line i takes len_i samples: the gain that leaves −60 dB after rt60.
        let gain = |len: usize, rt60: f32| 10f32.powf(-3.0 * len as f32 / (rt60.max(0.01) * fs)).min(0.9999);
        let gains: Vec<[f32; 3]> = lens.iter().map(|&n| [gain(n, p.low_rt60), gain(n, p.mid_rt60), gain(n, p.high_rt60)]).collect();
        // Energy of a tail fed once: about 1 / (1 − g²) at the mid band's mean gain.
        let g = gains.iter().map(|g| g[1]).sum::<f32>() / LINES as f32;
        let norm = (1.0 - g * g).max(1e-4).sqrt();
        let diffuse = DIFFUSE_MS.iter().map(|m| AllPass { line: Line::new((m * ms).round() as usize), g: DIFFUSE_GAIN }).collect();
        Reverb {
            lines: lens.iter().map(|&n| Line::new(n)).collect(),
            gains,
            split: vec![[0.0; 2]; LINES],
            cross: one_pole(p.crossover, fs),
            damp: one_pole(p.damping, fs),
            pre: [Line::new((p.pre_delay[0].max(0.0) * fs) as usize + 1), Line::new((p.pre_delay[1].max(0.0) * fs) as usize + 1)],
            diffuse,
            norm,
            width: p.width.clamp(0.0, 1.0),
            mix: p.mix.clamp(0.0, 1.0),
            wet_gain: p.wet_gain,
        }
    }

    /// One stereo frame of tail (before the mix).
    fn tail(&mut self, l: f32, r: f32) -> (f32, f32) {
        let x = 0.5 * (self.pre[0].swap(l) + self.pre[1].swap(r)) * self.norm;
        let x = self.diffuse.iter_mut().fold(x, |x, ap| ap.tick(x));
        let mut out = [0f32; LINES];
        for (i, line) in self.lines.iter_mut().enumerate() {
            out[i] = line.buf[line.at];
        }
        // Each line's loss per pass, band by band (complementary one-pole splits).
        let mut fed = [0f32; LINES];
        for i in 0..LINES {
            let s = out[i];
            let st = &mut self.split[i];
            st[0] += self.cross * (s - st[0]);
            let low = st[0];
            let rest = s - low;
            st[1] += self.damp * (rest - st[1]);
            let mid = st[1];
            let high = rest - mid;
            let g = self.gains[i];
            fed[i] = g[0] * low + g[1] * mid + g[2] * high;
        }
        hadamard(&mut fed);
        for (i, line) in self.lines.iter_mut().enumerate() {
            // Alternate signs spread the input so the lines don't start in step.
            let input = if i % 2 == 0 { x } else { -x };
            line.swap(fed[i] + input);
        }
        // Two orthogonal sums of the lines for the two sides.
        let (mut a, mut b) = (0.0, 0.0);
        for (i, v) in out.iter().enumerate() {
            a += v;
            b += if (i / 2) % 2 == 0 { *v } else { -v };
        }
        let s = 1.0 / (LINES as f32).sqrt();
        let (a, b) = (a * s, b * s);
        let (mid, side) = (0.5 * (a + b), 0.5 * (a - b) * self.width);
        (mid + side, mid - side)
    }
}

/// The 8-point Walsh–Hadamard transform, scaled to keep energy (an orthogonal matrix).
fn hadamard(v: &mut [f32; LINES]) {
    let mut h = 1;
    while h < LINES {
        for i in (0..LINES).step_by(h * 2) {
            for j in i..i + h {
                let (x, y) = (v[j], v[j + h]);
                v[j] = x + y;
                v[j + h] = x - y;
            }
        }
        h *= 2;
    }
    let s = 1.0 / (LINES as f32).sqrt();
    v.iter_mut().for_each(|x| *x *= s);
}

impl crate::fx::Processor for Reverb {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            let (l, r) = self.tail(frame[0], frame[1]);
            let (wet, dry) = (self.mix * self.wet_gain, 1.0 - self.mix);
            frame[0] = frame[0] * dry + l * wet;
            frame[1] = frame[1] * dry + r * wet;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fx::Processor;

    /// The level (dB) of the tail's left channel over each 50 ms after an impulse.
    fn decay(p: ReverbParams, secs: f32) -> Vec<f32> {
        let rate = 48_000;
        let mut r = Reverb::new(ReverbParams { mix: 1.0, ..p }, rate);
        let n = (secs * rate as f32) as usize;
        let mut buf = vec![0f32; n * 2];
        buf[0] = 1.0;
        buf[1] = 1.0;
        r.process(&mut buf);
        buf.chunks(2400 * 2).map(|w| 10.0 * (w.iter().step_by(2).map(|x| x * x).sum::<f32>() / 2400.0).max(1e-20).log10()).collect()
    }

    #[test]
    fn the_tail_dies_away_in_its_rt60() {
        // A flat 1.5 s RT60: 60 dB down 1.5 s after it builds up (fit over 0.2–1.2 s).
        let flat = ReverbParams { low_rt60: 1.5, mid_rt60: 1.5, high_rt60: 1.5, ..Default::default() };
        let levels = decay(flat, 2.0);
        let slope = (levels[24] - levels[4]) / 1.0;
        assert!((slope + 40.0).abs() < 6.0, "{slope:.1} dB/s (want −40)");
        // It never grows.
        assert!(levels[30] < levels[10]);
    }

    #[test]
    fn high_bands_die_faster_when_damped() {
        // The same tail with the highs at a fifth of the RT60 has less energy at the end of a
        // noise burst's tail in the treble: measured by a click's tail through a high-pass.
        let rate = 48_000;
        let run = |high_rt60: f32| {
            let mut r = Reverb::new(ReverbParams { mix: 1.0, low_rt60: 2.0, mid_rt60: 2.0, high_rt60, damping: 2000.0, ..Default::default() }, rate);
            let mut buf = vec![0f32; rate as usize * 2];
            buf[0] = 1.0;
            buf[1] = 1.0;
            r.process(&mut buf);
            // First differences: a crude high-pass.
            let tail = &buf[rate as usize..];
            tail.chunks(2).collect::<Vec<_>>().windows(2).map(|w| (w[1][0] - w[0][0]).powi(2)).sum::<f32>()
        };
        assert!(run(0.4) < run(2.0) * 0.1);
    }

    #[test]
    fn the_tail_keeps_the_inputs_energy_and_mix_zero_is_dry() {
        // Unit wet gain: the impulse's tail carries about as much energy as the impulse.
        let rate = 48_000;
        for rt60 in [0.5, 3.0] {
            let mut r = Reverb::new(ReverbParams { mix: 1.0, low_rt60: rt60, mid_rt60: rt60, high_rt60: rt60, ..Default::default() }, rate);
            let mut buf = vec![0f32; rate as usize * 2 * 8];
            buf[0] = 1.0;
            buf[1] = 1.0;
            r.process(&mut buf);
            let energy = buf.iter().map(|x| x * x).sum::<f32>() / 2.0;
            assert!(energy > 0.4 && energy < 2.5, "rt60 {rt60}: {energy}");
        }
        let mut r = Reverb::new(ReverbParams { mix: 0.0, ..Default::default() }, rate);
        let mut buf: Vec<f32> = (0..2000).map(|i| (i as f32 * 0.01).sin()).collect();
        let want = buf.clone();
        r.process(&mut buf);
        assert_eq!(buf, want);
    }
}
