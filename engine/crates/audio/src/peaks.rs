//! Waveform peaks: a file's loudness at a fixed time resolution, for drawing it on the
//! timeline without holding its samples.

use std::path::Path;

use crate::{open_audio, AudioError, CHANNELS, RATE};

/// Per bucket of `1 / per_second` s, of the mono mix (the mean of the channels): the largest
/// absolute sample and the RMS, both 0..1 (above 1 if the file clips).
#[derive(Clone, Debug, PartialEq)]
pub struct Peaks {
    pub per_second: u32,
    pub peak: Vec<f32>,
    pub rms: Vec<f32>,
}

/// Decode the whole of `path`'s audio into peaks; `None` if it has no audio. `per_second`
/// must divide 48,000 (e.g. 100: one bucket per 10 ms).
pub fn peaks(path: &Path, per_second: u32) -> Result<Option<Peaks>, AudioError> {
    if per_second == 0 || RATE % per_second != 0 {
        return Err(AudioError::Other(format!("{per_second} buckets per second doesn't divide {RATE}")));
    }
    let Some(mut d) = open_audio(path, RATE)? else { return Ok(None) };
    let bucket = (RATE / per_second) as usize;
    let mut out = Peaks { per_second, peak: Vec::new(), rms: Vec::new() };
    // Read a second at a time.
    let mut block = vec![0f32; RATE as usize * CHANNELS];
    let mut at = 0i64;
    loop {
        d.read(at, &mut block)?;
        let valid = d.end().map_or(block.len() / CHANNELS, |end| (end - at).clamp(0, RATE as i64) as usize);
        for chunk in block[..valid * CHANNELS].chunks(bucket * CHANNELS) {
            let (mut peak, mut sq) = (0f32, 0f64);
            for f in chunk.chunks_exact(CHANNELS) {
                let m = f.iter().sum::<f32>() / CHANNELS as f32;
                peak = peak.max(m.abs());
                sq += (m * m) as f64;
            }
            out.peak.push(peak);
            out.rms.push((sq / (chunk.len() / CHANNELS) as f64).sqrt() as f32);
        }
        at += RATE as i64;
        if d.end().is_some_and(|end| at >= end) {
            break;
        }
    }
    Ok(Some(out))
}
