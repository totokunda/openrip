//! A file's beats for the timeline's beat markers, kept on disk next to the thumbnails and
//! waveforms: a song is listened to once, ever.

use std::path::Path;

use openrip_audio::beats::{detect_file, BeatGrid};
use openrip_audio::AudioError;
use openrip_model::{Beat, Micros};
use openrip_platform::assets;
use serde_json::{json, Value};

use crate::thumbs::media_key;

/// Bumped when the detector changes, so old answers aren't reused.
const VERSION: u32 = 1;

/// [`openrip_audio::beats::detect_file`], read from and saved to `cache_dir` when given
/// (keyed by the file's path, size and modification time).
pub fn beats(path: &Path, cache_dir: Option<&Path>) -> Result<Option<BeatGrid>, AudioError> {
    let file = cache_dir.and_then(|dir| media_key(path).map(|k| dir.join(k).join(format!("beats-v{VERSION}.json"))));
    if let Some(grid) = file.as_deref().and_then(load) {
        return Ok(Some(grid));
    }
    let grid = detect_file(path)?;
    if let (Some(f), Some(g)) = (&file, &grid) {
        let doc = json!({ "bpm": g.bpm, "beats": g.beats.iter().map(|b| json!([b.at.0, b.downbeat])).collect::<Vec<_>>() });
        // Best effort: a full disk only costs the cache.
        let _ = assets::write(f, doc.to_string().as_bytes());
    }
    Ok(grid)
}

fn load(file: &Path) -> Option<BeatGrid> {
    let doc: Value = serde_json::from_slice(&assets::read(file).ok()?).ok()?;
    let beats = doc.get("beats")?.as_array()?.iter().map(|b| Some(Beat { at: Micros(b.get(0)?.as_i64()?), downbeat: b.get(1)?.as_bool()? })).collect::<Option<Vec<_>>>()?;
    Some(BeatGrid { bpm: doc.get("bpm")?.as_f64()? as f32, beats })
}
