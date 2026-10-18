//! Waveform peaks for the timeline, kept on disk next to the thumbnails: a long file is
//! decoded once, ever.

use std::path::Path;

use openrip_audio::{AudioError, Peaks};
use openrip_platform::assets;

use crate::thumbs::media_key;

const MAGIC: &[u8; 4] = b"ORPK";

/// [`openrip_audio::peaks`], read from and saved to `cache_dir` when given (keyed by the
/// file's path, size and modification time).
pub fn waveform(path: &Path, per_second: u32, cache_dir: Option<&Path>) -> Result<Option<Peaks>, AudioError> {
    let file = cache_dir.and_then(|dir| media_key(path).map(|k| dir.join(k).join(format!("peaks-{per_second}.bin"))));
    if let Some(p) = file.as_deref().and_then(|f| load(f, per_second)) {
        return Ok(Some(p));
    }
    let peaks = openrip_audio::peaks(path, per_second)?;
    if let (Some(f), Some(p)) = (&file, &peaks) {
        // Best effort: a full disk only costs the cache.
        let _ = save(f, p);
    }
    Ok(peaks)
}

fn load(file: &Path, per_second: u32) -> Option<Peaks> {
    let b = assets::read(file).ok()?;
    let word = |i: usize| b.get(i..i + 4).map(|w| u32::from_le_bytes(w.try_into().unwrap()));
    if b.get(..4)? != MAGIC || word(4)? != per_second {
        return None;
    }
    let n = word(8)? as usize;
    let floats = |from: usize| -> Option<Vec<f32>> { b.get(from..from + n * 4).map(|s| s.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect()) };
    Some(Peaks { per_second, peak: floats(12)?, rms: floats(12 + n * 4)? })
}

fn save(file: &Path, p: &Peaks) -> std::io::Result<()> {
    let mut b = Vec::with_capacity(12 + p.peak.len() * 8);
    b.extend_from_slice(MAGIC);
    b.extend_from_slice(&p.per_second.to_le_bytes());
    b.extend_from_slice(&(p.peak.len() as u32).to_le_bytes());
    for v in p.peak.iter().chain(&p.rms) {
        b.extend_from_slice(&v.to_le_bytes());
    }
    // Whole or not at all, so a reader never sees half a file.
    assets::write(file, &b)
}
