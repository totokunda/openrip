//! Beat detection for the timeline's beat markers (CapCut's "Auto beat"), with classic
//! signal processing (docs/parity/beats.md):
//!
//! 1. **Onsets.** A spectral flux: the sound's spectrum every 11.6 ms in 24 log-spaced
//!    bands, log-compressed, and how much each band rose since the last frame, summed. Peaks
//!    are where notes and drums start.
//! 2. **Tempo.** The flux's autocorrelation over 40–220 BPM, weighted towards 120 BPM (an
//!    octave either side counts half as much), picks the beat period.
//! 3. **Beats.** Dynamic programming (Ellis, 2007) places beats on strong onsets about one
//!    period apart: each frame's score is its onset strength plus the best earlier beat's
//!    score, less a cost for straying from the period.
//! 4. **Bars.** Counting in fours, the phase whose beats carry the most bass onsets starts
//!    the bars (CapCut's "Beat 1" shows those; "Beat 2" every beat).
//!
//! Silence at either end gets no beats.

use std::f32::consts::PI;
use std::path::Path;

use openrip_model::{Beat, Micros};
use realfft::RealFftPlanner;

use crate::{open_audio, AudioError, CHANNELS};

/// The rate it listens at: plenty for rhythm, and a quarter the work of 48 kHz.
pub const DETECT_RATE: u32 = 22_050;
const FRAME: usize = 1024;
const HOP: usize = 256;
const BANDS: usize = 24;
/// Bands below this frequency count as bass for the bars.
const BASS_HZ: f32 = 200.0;
const MIN_BPM: f32 = 40.0;
const MAX_BPM: f32 = 220.0;
/// How strongly beats keep to the period (Ellis' tightness).
const TIGHTNESS: f32 = 100.0;
/// Where in the frame whose flux rises a sound starts, as a share of the frame: a sound
/// shows as soon as it enters the window's tail (the log makes even a little of it count).
/// Clicks start 0.8 of the way in.
const ONSET_AT: f64 = 0.8;

/// What [`detect`] found.
#[derive(Clone, Debug, PartialEq)]
pub struct BeatGrid {
    /// The tempo, beats per minute (0 when there are no beats).
    pub bpm: f32,
    /// The beats, in order, in time from the start of what was given.
    pub beats: Vec<Beat>,
}

/// Per frame: the flux over all bands, and over the bass bands.
struct Onsets {
    all: Vec<f32>,
    bass: Vec<f32>,
    /// Each frame's level (mean log band energy), for finding silence.
    level: Vec<f32>,
}

fn onsets(mono: &[f32], rate: u32) -> Onsets {
    let fft = RealFftPlanner::<f32>::new().plan_fft_forward(FRAME);
    let window: Vec<f32> = (0..FRAME).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / FRAME as f32).cos()).collect();
    // Band edges in bins, log-spaced from 40 Hz to 10 kHz (or Nyquist).
    let bin_hz = rate as f32 / FRAME as f32;
    let top = (rate as f32 * 0.45).min(10_000.0);
    let edges: Vec<usize> = (0..=BANDS).map(|b| ((40.0 * (top / 40.0).powf(b as f32 / BANDS as f32)) / bin_hz).round().max(1.0) as usize).collect();
    let bass_bands = edges.iter().take_while(|&&e| (e as f32) * bin_hz < BASS_HZ).count().max(1);
    let frames = if mono.len() >= FRAME { (mono.len() - FRAME) / HOP + 1 } else { 0 };
    let mut out = Onsets { all: vec![0.0; frames], bass: vec![0.0; frames], level: vec![0.0; frames] };
    let mut buf = vec![0f32; FRAME];
    let mut spec = fft.make_output_vec();
    let mut last = vec![0f32; BANDS];
    for t in 0..frames {
        for (i, b) in buf.iter_mut().enumerate() {
            *b = mono[t * HOP + i] * window[i];
        }
        let _ = fft.process(&mut buf, &mut spec);
        let (mut all, mut bass, mut level) = (0.0, 0.0, 0.0);
        for b in 0..BANDS {
            let (lo, hi) = (edges[b], edges[b + 1].max(edges[b] + 1).min(spec.len()));
            let mag = spec[lo.min(spec.len() - 1)..hi].iter().map(|z| z.norm()).sum::<f32>() / (hi - lo).max(1) as f32;
            let v = (1.0 + 1000.0 * mag).ln();
            let rise = (v - last[b]).max(0.0);
            if t > 0 {
                all += rise;
                if b < bass_bands {
                    bass += rise;
                }
            }
            level += v / BANDS as f32;
            last[b] = v;
        }
        out.all[t] = all;
        out.bass[t] = bass;
        out.level[t] = level;
    }
    out
}

/// The flux less its local mean (about half a second around), never below zero, and scaled
/// to unit standard deviation.
fn normalise(flux: &[f32]) -> Vec<f32> {
    let half = (0.25 * DETECT_RATE as f32 / HOP as f32) as usize;
    let mut prefix = vec![0f64; flux.len() + 1];
    for (i, v) in flux.iter().enumerate() {
        prefix[i + 1] = prefix[i] + *v as f64;
    }
    let out: Vec<f32> = (0..flux.len())
        .map(|t| {
            let (a, b) = (t.saturating_sub(half), (t + half + 1).min(flux.len()));
            (flux[t] - ((prefix[b] - prefix[a]) / (b - a) as f64) as f32).max(0.0)
        })
        .collect();
    let mean = out.iter().sum::<f32>() / out.len().max(1) as f32;
    let sd = (out.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / out.len().max(1) as f32).sqrt();
    if sd > 1e-9 {
        out.iter().map(|v| v / sd).collect()
    } else {
        out
    }
}

/// The beat period in frames (fractional), from the onsets' autocorrelation.
fn period(onset: &[f32]) -> Option<f32> {
    let fps = DETECT_RATE as f32 / HOP as f32;
    let (lo, hi) = ((60.0 * fps / MAX_BPM).floor() as usize, (60.0 * fps / MIN_BPM).ceil() as usize);
    if onset.len() < hi * 2 {
        return None;
    }
    // Smoothed a little first (a Gaussian of 1.5 frames), so a period that isn't a whole
    // number of frames still lines its onsets up.
    let kernel: Vec<f32> = (-4i32..=4).map(|i| (-0.5 * (i as f32 / 1.5).powi(2)).exp()).collect();
    let smooth: Vec<f32> = (0..onset.len()).map(|t| kernel.iter().enumerate().map(|(k, w)| w * onset.get((t + k).wrapping_sub(4)).copied().unwrap_or(0.0)).sum()).collect();
    let onset = &smooth;
    let ac = |lag: usize| -> f32 { onset.iter().zip(&onset[lag..]).map(|(a, b)| a * b).sum::<f32>() / (onset.len() - lag) as f32 };
    let acs: Vec<f32> = (0..=hi + 1).map(|l| if l >= lo.saturating_sub(1) { ac(l) } else { 0.0 }).collect();
    let weight = |lag: f32| {
        let octaves = (60.0 * fps / lag / 120.0).log2();
        (-0.5 * octaves * octaves).exp()
    };
    let best = (lo..=hi).max_by(|&a, &b| (weight(a as f32) * acs[a]).total_cmp(&(weight(b as f32) * acs[b])))?;
    if acs[best] <= 0.0 {
        return None;
    }
    // A parabola through the peak and its neighbours for the period between frames.
    let (y0, y1, y2) = (acs[best - 1], acs[best], acs[best + 1]);
    let d = y0 - 2.0 * y1 + y2;
    let shift = if d.abs() > 1e-12 { (0.5 * (y0 - y2) / d).clamp(-0.5, 0.5) } else { 0.0 };
    Some(best as f32 + shift)
}

/// Beat frames by dynamic programming over the onsets with period `p`.
fn track(onset: &[f32], p: f32) -> Vec<usize> {
    let n = onset.len();
    let mut score = vec![0f32; n];
    let mut back: Vec<Option<usize>> = vec![None; n];
    for t in 0..n {
        let (from, to) = ((t as f32 - 2.0 * p).max(0.0) as usize, (t as f32 - p / 2.0).floor());
        let mut best: Option<(f32, usize)> = None;
        if to >= 0.0 {
            for q in from..=(to as usize).min(t.saturating_sub(1)) {
                let gap = (t - q) as f32 / p;
                let s = score[q] - TIGHTNESS * gap.ln().powi(2);
                if best.is_none_or(|(b, _)| s > b) {
                    best = Some((s, q));
                }
            }
        }
        match best {
            Some((s, q)) if s > 0.0 => {
                score[t] = onset[t] + s;
                back[t] = Some(q);
            }
            _ => score[t] = onset[t],
        }
    }
    // From the best-scoring frame in the last period, back to the start.
    let tail = n.saturating_sub(p.ceil() as usize);
    let Some(mut t) = (tail..n).max_by(|&a, &b| score[a].total_cmp(&score[b])) else { return Vec::new() };
    let mut beats = vec![t];
    while let Some(q) = back[t] {
        beats.push(q);
        t = q;
    }
    beats.reverse();
    beats
}

/// Find the beats in `mono` (one channel at `rate`; resampled to [`DETECT_RATE`] first if
/// it's another rate).
pub fn detect(mono: &[f32], rate: u32) -> BeatGrid {
    let resampled;
    let mono = if rate == DETECT_RATE {
        mono
    } else {
        let ratio = rate as f64 / DETECT_RATE as f64;
        let n = (mono.len() as f64 / ratio) as usize;
        resampled = (0..n)
            .map(|i| {
                let x = i as f64 * ratio;
                let (k, f) = (x as usize, (x - x.floor()) as f32);
                let a = mono[k.min(mono.len() - 1)];
                a + (mono[(k + 1).min(mono.len() - 1)] - a) * f
            })
            .collect::<Vec<f32>>();
        &resampled
    };
    let o = onsets(mono, DETECT_RATE);
    let onset = normalise(&o.all);
    let Some(p) = period(&onset) else { return BeatGrid { bpm: 0.0, beats: Vec::new() } };
    let fps = DETECT_RATE as f32 / HOP as f32;
    let mut frames = track(&onset, p);
    // No beats in silence: drop those at either end where the sound is far below its usual
    // level (a fifth of the way from the quietest frame to the median one).
    let mut sorted = o.level.clone();
    sorted.sort_by(f32::total_cmp);
    let (floor, median) = (sorted.first().copied().unwrap_or(0.0), sorted.get(sorted.len() / 2).copied().unwrap_or(0.0));
    let quiet = |t: usize| o.level[t] < floor + 0.2 * (median - floor);
    while frames.first().is_some_and(|&t| quiet(t)) {
        frames.remove(0);
    }
    while frames.last().is_some_and(|&t| quiet(t)) {
        frames.pop();
    }
    // Bars in fours: the phase with the most bass onsets on its beats.
    let bass = normalise(&o.bass);
    let phase = (0..4).max_by(|&a, &b| {
        let sum = |k: usize| frames.iter().enumerate().filter(|(i, _)| i % 4 == k).map(|(_, &t)| bass[t]).sum::<f32>();
        sum(a).total_cmp(&sum(b))
    });
    let at = |t: usize| Micros((((t * HOP) as f64 + FRAME as f64 * ONSET_AT) / DETECT_RATE as f64 * 1e6).round() as i64);
    let beats = frames.iter().enumerate().map(|(i, &t)| Beat { at: at(t), downbeat: Some(i % 4) == phase }).collect();
    BeatGrid { bpm: 60.0 * fps / p, beats }
}

/// The beats of the audio of the file at `path` (all of it), in its media time; `None` if it
/// has no audio.
pub fn detect_file(path: &Path) -> Result<Option<BeatGrid>, AudioError> {
    let Some(mut d) = open_audio(path, DETECT_RATE)? else { return Ok(None) };
    let mut mono = Vec::new();
    let mut block = vec![0f32; DETECT_RATE as usize * CHANNELS];
    let mut at = 0i64;
    loop {
        d.read(at, &mut block)?;
        let valid = d.end().map_or(DETECT_RATE as usize, |end| (end - at).clamp(0, DETECT_RATE as i64) as usize);
        mono.extend(block[..valid * CHANNELS].chunks_exact(CHANNELS).map(|f| 0.5 * (f[0] + f[1])));
        at += DETECT_RATE as i64;
        if d.end().is_some_and(|end| at >= end) || valid == 0 {
            break;
        }
    }
    Ok(Some(detect(&mono, DETECT_RATE)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Clicks (short decaying noise bursts) at `bpm` from `start` s, every fourth one louder
    /// with a low thump, over `secs` s.
    fn clicks(bpm: f32, start: f32, secs: f32) -> Vec<f32> {
        let rate = DETECT_RATE as f32;
        let mut x = vec![0f32; (secs * rate) as usize];
        let mut seed = 1u32;
        let mut noise = || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f32 / (1 << 24) as f32 * 2.0 - 1.0
        };
        let mut k = 0;
        let mut t = start;
        while t < secs - 0.1 {
            let s = (t * rate) as usize;
            let loud = k % 4 == 0;
            for i in 0..(0.03 * rate) as usize {
                let env = (-(i as f32) / (0.005 * rate)).exp();
                let mut v = noise() * env * if loud { 0.6 } else { 0.4 };
                if loud {
                    v += 0.5 * (2.0 * PI * 60.0 * i as f32 / rate).sin() * (-(i as f32) / (0.02 * rate)).exp();
                }
                x[s + i] += v;
            }
            k += 1;
            t += 60.0 / bpm;
        }
        x
    }

    #[test]
    fn clicks_at_a_tempo_are_found_on_time() {
        for bpm in [90.0, 120.0, 150.0] {
            let start = 1.0;
            let grid = detect(&clicks(bpm, start, 20.0), DETECT_RATE);
            assert!((grid.bpm - bpm).abs() < 1.5, "{bpm}: found {} BPM", grid.bpm);
            // Every click has a beat within 25 ms, and there are no extra beats.
            let want: Vec<f64> = (0..).map(|k| start as f64 + k as f64 * 60.0 / bpm as f64).take_while(|t| *t < 19.9).collect();
            let got: Vec<f64> = grid.beats.iter().map(|b| b.at.as_secs_f64()).collect();
            let hits = want.iter().filter(|w| got.iter().any(|g| (g - *w).abs() < 0.025)).count();
            assert!(hits as f64 >= want.len() as f64 * 0.95, "{bpm}: {hits} of {} found: {:?}", want.len(), &got[..got.len().min(12)]);
            assert!(got.len() <= want.len() + 1, "{bpm}: {} beats for {} clicks", got.len(), want.len());
            // The silent second before the first click has none.
            assert!(got.first().is_some_and(|g| *g > start as f64 - 0.05), "{got:?}");
            // The loud clicks start the bars.
            let downbeats: Vec<f64> = grid.beats.iter().filter(|b| b.downbeat).map(|b| b.at.as_secs_f64()).collect();
            let bar = 4.0 * 60.0 / bpm as f64;
            assert!(downbeats.iter().all(|d| (((d - start as f64) / bar) - ((d - start as f64) / bar).round()).abs() < 0.05), "{bpm}: {downbeats:?}");
        }
    }

    #[test]
    fn silence_and_short_sounds_have_no_beats() {
        assert!(detect(&vec![0.0; DETECT_RATE as usize * 10], DETECT_RATE).beats.is_empty());
        assert!(detect(&[0.1; 100], DETECT_RATE).beats.is_empty());
    }
}
