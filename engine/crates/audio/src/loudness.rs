//! Loudness as EBU R128 measures it (ITU-R BS.1770-4): a clip's integrated loudness in LUFS
//! and its sample peak, for loudness normalisation (CapCut's "Normalize loudness", which
//! takes a clip to −23 LUFS from what it measured over the clip's range;
//! docs/parity/loudness.md).
//!
//! The sound is K-weighted (a high shelf for the head's effect, then a high-pass), its mean
//! square taken over 400 ms blocks every 100 ms, and blocks below −70 LUFS, then those more
//! than 10 LU below the rest's mean, left out. As CapCut measures, the blocks start at the
//! clip's start, each over the 400 ms before it, silence before the clip included: on a
//! short clip the first, partly silent blocks count (on the 24 ranges CapCut measured in the
//! local drafts this gives its values within 0.05 LU; starting with the first full block reads
//! up to 1.3 LU louder on a one-second clip). What's measured is the sound the mixer plays
//! (the decoder's stereo, a mono file spread over both channels), so the gain it gives takes
//! the clip as heard to the target.

use std::f64::consts::PI;
use std::path::Path;

use crate::{open_audio, AudioError, AudioSource, CHANNELS};

/// Below this a block counts as silence (the absolute gate).
const ABSOLUTE_GATE: f64 = -70.0;
/// Blocks this far below the mean of the louder ones are left out (the relative gate).
const RELATIVE_GATE: f64 = -10.0;

/// What [`measure`] found.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Loudness {
    /// Integrated loudness, LUFS; `None` for silence (nothing above the absolute gate).
    pub integrated: Option<f32>,
    /// The largest sample, dBFS (−∞ for silence).
    pub peak: f32,
}

/// One biquad of the K-weighting, per channel, in f64 (the high-pass sits at 38 Hz, where
/// f32 loses the low end).
#[derive(Clone, Copy)]
struct Stage {
    b: [f64; 3],
    a: [f64; 2],
    z: [[f64; 2]; CHANNELS],
}

impl Stage {
    fn tick(&mut self, c: usize, x: f64) -> f64 {
        let z = &mut self.z[c];
        let y = self.b[0] * x + z[0];
        z[0] = self.b[1] * x - self.a[0] * y + z[1];
        z[1] = self.b[2] * x - self.a[1] * y;
        y
    }
}

/// BS.1770's two K-weighting stages at `rate`: its pre-filter (a +4 dB shelf above about
/// 1.7 kHz) and its RLB high-pass, from their analogue prototypes (the published 48 kHz
/// coefficients come out of these at 48 kHz).
fn k_weighting(rate: u32) -> [Stage; 2] {
    let fs = rate as f64;
    let (f0, gain_db, q) = (1681.974450955533, 3.999843853973347, 0.7071752369554196);
    let k = (PI * f0 / fs).tan();
    let vh = 10f64.powf(gain_db / 20.0);
    let vb = vh.powf(0.4996667741545416);
    let a0 = 1.0 + k / q + k * k;
    let shelf = Stage {
        b: [(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0],
        a: [2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0],
        z: [[0.0; 2]; CHANNELS],
    };
    let (f0, q) = (38.13547087602444, 0.5003270373238773);
    let k = (PI * f0 / fs).tan();
    let a0 = 1.0 + k / q + k * k;
    let highpass = Stage { b: [1.0, -2.0, 1.0], a: [2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0], z: [[0.0; 2]; CHANNELS] };
    [shelf, highpass]
}

/// A running measurement: push interleaved stereo, then read [`Meter::finish`].
pub struct Meter {
    stages: [Stage; 2],
    /// Samples per 100 ms step; a block is four steps.
    step: usize,
    /// Mean squares (summed over channels) of the steps so far, and of the step filling.
    steps: Vec<f64>,
    filling: f64,
    filled: usize,
    peak: f32,
}

impl Meter {
    pub fn new(rate: u32) -> Meter {
        // The silence before the start: the first blocks reach back into it.
        Meter { stages: k_weighting(rate), step: (rate / 10).max(1) as usize, steps: vec![0.0; 3], filling: 0.0, filled: 0, peak: 0.0 }
    }

    pub fn push(&mut self, samples: &[f32]) {
        for frame in samples.chunks_exact(CHANNELS) {
            let mut sum = 0.0;
            for (c, &x) in frame.iter().enumerate() {
                self.peak = self.peak.max(x.abs());
                let shelved = self.stages[0].tick(c, x as f64);
                let y = self.stages[1].tick(c, shelved);
                sum += y * y;
            }
            self.filling += sum;
            self.filled += 1;
            if self.filled == self.step {
                self.steps.push(self.filling / self.step as f64);
                self.filling = 0.0;
                self.filled = 0;
            }
        }
    }

    pub fn finish(&self) -> Loudness {
        // 400 ms blocks, overlapping by three quarters: four consecutive steps each.
        let blocks: Vec<f64> = self.steps.windows(4).map(|w| w.iter().sum::<f64>() / 4.0).collect();
        let lufs = |z: f64| -0.691 + 10.0 * z.log10();
        let mean = |zs: &[f64]| zs.iter().sum::<f64>() / zs.len() as f64;
        let loud: Vec<f64> = blocks.iter().copied().filter(|&z| z > 0.0 && lufs(z) > ABSOLUTE_GATE).collect();
        let integrated = (!loud.is_empty()).then(|| {
            let gate = lufs(mean(&loud)) + RELATIVE_GATE;
            let kept: Vec<f64> = loud.iter().copied().filter(|&z| lufs(z) > gate).collect();
            lufs(mean(&kept)) as f32
        });
        Loudness { integrated, peak: 20.0 * self.peak.log10() }
    }
}

/// The loudness of `n` samples of `source` from sample `start`, at `rate`.
pub fn measure(source: &mut dyn AudioSource, rate: u32, start: i64, n: i64) -> Result<Loudness, AudioError> {
    let mut meter = Meter::new(rate);
    let mut block = vec![0f32; rate as usize * CHANNELS];
    let mut at = start;
    let end = match source.end() {
        Some(e) => (start + n).min(e),
        None => start + n,
    };
    while at < end {
        let len = ((end - at) as usize).min(rate as usize);
        source.read(at, &mut block[..len * CHANNELS])?;
        meter.push(&block[..len * CHANNELS]);
        at += len as i64;
        // The source's end may only be known once read.
        if source.end().is_some_and(|e| at >= e) {
            break;
        }
    }
    Ok(meter.finish())
}

/// The loudness of the file at `path` over `duration` µs from `start` µs of its media (all of
/// it for `None`); `None` if it has no audio. Decodes at 48 kHz, as the mixer plays it.
pub fn measure_file(path: &Path, start: openrip_model::Micros, duration: Option<openrip_model::Micros>) -> Result<Option<Loudness>, AudioError> {
    let rate = crate::RATE;
    let Some(mut source) = open_audio(path, rate)? else { return Ok(None) };
    let from = crate::sample_at(start, rate);
    let n = duration.map_or(i64::MAX / 4, |d| crate::sample_at(d, rate));
    measure(source.as_mut(), rate, from, n).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(f: f64, amp: f64, secs: f64, rate: u32) -> Vec<f32> {
        (0..(secs * rate as f64) as usize)
            .flat_map(|i| {
                let x = (amp * (2.0 * PI * f * i as f64 / rate as f64).sin()) as f32;
                [x, x]
            })
            .collect()
    }

    #[test]
    fn a_tone_reads_as_bs1770_says() {
        // A 997 Hz tone at −20 dBFS in both channels reads −20 LUFS (BS.1770's calibration:
        // 0 dBFS in one channel is −3.01), at either rate: here −20.07, the three blocks
        // reaching back before its start counting a quarter, half and three quarters of it.
        for rate in [44_100, 48_000] {
            let mut m = Meter::new(rate);
            m.push(&tone(997.0, 0.1, 10.0, rate));
            let l = m.finish();
            assert!((l.integrated.unwrap() + 20.066).abs() < 0.02, "{rate}: {:?}", l);
            assert!((l.peak + 20.0).abs() < 0.01);
        }
    }

    #[test]
    fn quiet_stretches_are_gated_out() {
        // 5 s at −20 dBFS, then 5 s at −50: the second stretch is 30 LU down, past the
        // relative gate, so the reading stays near the louder one's (the partly loud blocks at
        // its start and across the change pass, and take it to −20.25).
        let rate = 48_000;
        let mut m = Meter::new(rate);
        m.push(&tone(997.0, 0.1, 5.0, rate));
        m.push(&tone(997.0, 0.00316, 5.0, rate));
        assert!((m.finish().integrated.unwrap() + 20.25).abs() < 0.03);
        // Silence measures nothing.
        let mut m = Meter::new(rate);
        m.push(&vec![0.0; rate as usize * 2 * 3]);
        assert_eq!(m.finish().integrated, None);
    }

    #[test]
    fn low_rumble_is_weighted_down() {
        // The high-pass: a 20 Hz tone reads well below a 1 kHz one at the same level.
        let rate = 48_000;
        let read = |f: f64| {
            let mut m = Meter::new(rate);
            m.push(&tone(f, 0.1, 5.0, rate));
            m.finish().integrated.unwrap()
        };
        assert!(read(20.0) < read(1000.0) - 10.0);
        // And the shelf lifts the highs: +4 dB at 8 kHz against +0.7 at 1 kHz.
        let lift = read(8000.0) - read(1000.0);
        assert!((lift - 3.3).abs() < 0.3, "{lift}");
    }
}
