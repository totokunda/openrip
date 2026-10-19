//! What Stabilize and Remove flickers know about a video file: its camera motion and the
//! brightness of each frame, tracked once (openrip-core's `enhance`) and kept here, in memory
//! and on disk next to the thumbnails, for every preview, playback and export that draws the
//! file. The per-frame corrections and gains are worked out from it when first asked for, per
//! level.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use openrip_media::{open_video, DecoderOptions};
use openrip_model::{Micros, StabilizeLevel};
use openrip_motion::stabilize::{self, CameraTracker, Correction, Level};
use openrip_motion::{Gray, Similarity};
use openrip_platform::assets;
use openrip_render::{Compositor, Source};
use serde_json::{json, Value};

use crate::scan::ScanError;
use crate::thumbs::{is_still, media_key, shrink};

/// Bumped when the tracker changes, so old answers aren't reused.
const VERSION: u32 = 1;

/// The model's level as the motion crate's.
pub fn level_of(l: StabilizeLevel) -> Level {
    match l {
        StabilizeLevel::MinimalCut => Level::MinimalCut,
        StabilizeLevel::Recommended => Level::Recommended,
        StabilizeLevel::MostStable => Level::MostStable,
    }
}

/// A file's tracked motion over a stretch of it.
pub struct MotionAnalysis {
    /// The size of the pictures tracked (the upright picture, made smaller).
    pub size: (u32, u32),
    /// The frame rate the smoothing counts its window in.
    pub fps: f64,
    /// The source stretch covered, µs.
    pub range: (i64, i64),
    /// Each frame's source time and mean luma (0–1).
    pub times: Vec<i64>,
    pub luma: Vec<f32>,
    /// `motions[i]` takes frame `i` to frame `i + 1`, about the picture's centre, in the
    /// tracked picture's pixels.
    pub motions: Vec<Similarity>,
    corrections: Mutex<HashMap<u8, Arc<Vec<Correction>>>>,
    gains: OnceLock<Vec<f32>>,
}

/// Frames either side of each in the flicker's moving average.
const FLICKER_RADIUS: usize = 6;

impl MotionAnalysis {
    pub fn new(size: (u32, u32), fps: f64, range: (i64, i64), times: Vec<i64>, luma: Vec<f32>, motions: Vec<Similarity>) -> MotionAnalysis {
        MotionAnalysis { size, fps, range, times, luma, motions, corrections: Default::default(), gains: OnceLock::new() }
    }

    /// Whether it covers source times `from`..`to`.
    pub fn covers(&self, from: Micros, to: Micros) -> bool {
        // A frame's length of slack at the ends.
        let slack = (1_000_000.0 / self.fps.max(1.0)) as i64 * 2;
        self.range.0 <= from.0 + slack && self.range.1 + slack >= to.0
    }

    /// The index of the frame shown at source time `t` (the last starting at or before it).
    fn index(&self, t: Micros) -> Option<usize> {
        if self.times.is_empty() {
            return None;
        }
        Some(self.times.partition_point(|&x| x <= t.0 + 1000).saturating_sub(1))
    }

    /// The correction for the frame shown at source time `t`, at `level`; `None` outside the
    /// stretch tracked.
    pub fn correction(&self, level: StabilizeLevel, t: Micros) -> Option<Correction> {
        let i = self.index(t)?;
        if t.0 < self.range.0 - 100_000 || t.0 > self.range.1 + 100_000 {
            return None;
        }
        let key = level as u8;
        let all = {
            let mut cache = self.corrections.lock().unwrap();
            cache.entry(key).or_insert_with(|| Arc::new(stabilize::corrections(&self.motions, self.size.0 as f64, self.size.1 as f64, self.fps, level_of(level)))).clone()
        };
        all.get(i).copied()
    }

    /// The brightness gain Remove flickers gives the frame shown at `t`.
    pub fn gain(&self, t: Micros) -> f32 {
        let gains = self.gains.get_or_init(|| stabilize::deflicker_gains(&self.luma, FLICKER_RADIUS));
        self.index(t).and_then(|i| gains.get(i).copied()).unwrap_or(1.0)
    }

    fn to_json(&self) -> Value {
        json!({
            "size": [self.size.0, self.size.1],
            "fps": self.fps,
            "range": [self.range.0, self.range.1],
            "times": self.times,
            "luma": self.luma.iter().map(|l| (l * 1e5).round() / 1e5).collect::<Vec<_>>(),
            "motions": self.motions.iter().map(|m| [m.a, m.b, m.tx, m.ty].map(|v| (v * 1e6).round() / 1e6)).collect::<Vec<_>>(),
        })
    }

    fn from_json(doc: &Value) -> Option<MotionAnalysis> {
        let pair = |k: &str| -> Option<(i64, i64)> {
            let a = doc.get(k)?.as_array()?;
            Some((a.first()?.as_i64()?, a.get(1)?.as_i64()?))
        };
        let size = pair("size")?;
        let times: Vec<i64> = doc.get("times")?.as_array()?.iter().map(Value::as_i64).collect::<Option<_>>()?;
        let luma: Vec<f32> = doc.get("luma")?.as_array()?.iter().map(|v| v.as_f64().map(|v| v as f32)).collect::<Option<_>>()?;
        let motions: Vec<Similarity> = doc
            .get("motions")?
            .as_array()?
            .iter()
            .map(|m| {
                let m = m.as_array()?;
                Some(Similarity { a: m.first()?.as_f64()?, b: m.get(1)?.as_f64()?, tx: m.get(2)?.as_f64()?, ty: m.get(3)?.as_f64()? })
            })
            .collect::<Option<_>>()?;
        let (fps, range) = (doc.get("fps")?.as_f64()?, pair("range")?);
        (times.len() == luma.len() && motions.len() + 1 == times.len()).then(|| MotionAnalysis::new((size.0 as u32, size.1 as u32), fps, range, times, luma, motions))
    }
}

#[derive(Default)]
struct Registry {
    dir: Option<PathBuf>,
    /// By the file's key (path, size and modification time). `None`: looked for on disk, not
    /// there.
    files: HashMap<String, Option<Arc<MotionAnalysis>>>,
}

fn registry() -> &'static Mutex<Registry> {
    static R: OnceLock<Mutex<Registry>> = OnceLock::new();
    R.get_or_init(Default::default)
}

/// Where analyses are kept between runs (next to the thumbnails). Without one they're kept in
/// memory only.
pub fn set_cache_dir(dir: PathBuf) {
    let mut r = registry().lock().unwrap();
    r.dir = Some(dir);
    // What was looked for before may be there now.
    r.files.retain(|_, v| v.is_some());
}

fn file_of(dir: &Path, key: &str) -> PathBuf {
    dir.join(key).join(format!("motion-v{VERSION}.json"))
}

/// The analysis of `path`, from memory or disk; `None` if it hasn't been tracked.
pub fn analysis(path: &str) -> Option<Arc<MotionAnalysis>> {
    let key = media_key(Path::new(path))?;
    let mut r = registry().lock().unwrap();
    if let Some(known) = r.files.get(&key) {
        return known.clone();
    }
    let loaded = r.dir.as_ref().and_then(|dir| assets::read(&file_of(dir, &key)).ok()).and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|d| MotionAnalysis::from_json(&d)).map(Arc::new);
    r.files.insert(key, loaded.clone());
    loaded
}

/// Keep a file's finished analysis, in memory and (best effort) on disk.
pub fn store(path: &str, found: MotionAnalysis) -> Option<Arc<MotionAnalysis>> {
    let key = media_key(Path::new(path))?;
    let found = Arc::new(found);
    let mut r = registry().lock().unwrap();
    if let Some(dir) = &r.dir {
        // A full disk only costs the cache.
        let _ = assets::write(&file_of(dir, &key), found.to_json().to_string().as_bytes());
    }
    r.files.insert(key, Some(found.clone()));
    Some(found)
}

/// The height the tracked pictures are shrunk to (upright, area-averaged).
const WORK_HEIGHT: u32 = 400;
/// Decoded pictures may come this small (VideoToolbox scales as it decodes).
const WORK_DECODE: u32 = 960;
/// Source time tracked either side of what a clip plays, so smoothing has its context.
const PAD: i64 = 2_000_000;

/// Track the camera and the brightness of `path`'s frames over `duration` from `start` (media
/// time; to its end for `None`) and a little either side, keep the result (see [`analysis`]),
/// and return it. Does nothing when what's kept already covers the range. Every frame of the
/// range is decoded in order, small. `progress(done, total)` after each frame, in frames;
/// returning false stops it.
pub fn analyse(path: &Path, start: Micros, duration: Option<Micros>, progress: &mut dyn FnMut(u64, u64) -> bool) -> Result<Arc<MotionAnalysis>, ScanError> {
    let name = path.to_string_lossy().into_owned();
    if is_still(path) {
        return Err(ScanError::Still("a photo has no motion to track".into()));
    }
    let mut d = open_video(path, &DecoderOptions { cache_bytes: 0, shrink_to: WORK_DECODE, ..Default::default() })?;
    let info = d.info().clone();
    let length = if info.duration.0 > 0 { info.duration.0 } else { i64::MAX / 4 };
    let end = match duration {
        Some(d) if d.0 > 0 => (start.0 + d.0).min(length),
        _ => length,
    };
    // This range with its padding, and what was already tracked.
    let mut want = ((start.0 - PAD).max(0), (end + PAD).min(length));
    if let Some(known) = analysis(&name) {
        if known.covers(Micros(start.0), Micros(end)) {
            return Ok(known);
        }
        want = (want.0.min(known.range.0), want.1.max(known.range.1));
    }
    let compositor = Compositor::new()?;
    // Never made larger than the video (that only makes the motions bigger to follow).
    let height = WORK_HEIGHT.min(if info.rotation.rem_euclid(180) == 90 { info.width } else { info.height }).max(16);
    let fps = info.frame_rate.map_or(30.0, |r| r.as_f64()).clamp(1.0, 240.0);
    let total = (((want.1 - want.0).max(0) as f64 / 1e6) * fps).round().max(1.0) as u64;
    let (mut times, mut luma, mut motions) = (Vec::new(), Vec::new(), Vec::new());
    let mut tracker: Option<CameraTracker> = None;
    let mut size = (0, 0);
    let mut next = d.frame_at(Micros(want.0))?;
    while let Some(f) = next {
        if !times.is_empty() && f.time.0 >= want.1 {
            break;
        }
        let img = shrink(&compositor, Source::Video(&f), height, info.rotation);
        size = (img.width, img.height);
        let gray = Gray::from_rgba(img.width as usize, img.height as usize, &img.data);
        luma.push(gray.data.iter().sum::<f32>() / gray.data.len().max(1) as f32);
        times.push(f.time.0);
        match tracker.as_mut() {
            Some(t) => motions.push(t.step(gray).unwrap_or(Similarity::IDENTITY)),
            None => tracker = Some(CameraTracker::new(gray)),
        }
        if !progress((times.len() as u64).min(total), total) {
            return Err(ScanError::Cancelled);
        }
        next = d.next_frame()?;
    }
    if times.len() < 3 {
        return Err(ScanError::Still("the video has too few frames to track".into()));
    }
    progress(total, total);
    let end_seen = times.last().copied().unwrap_or(want.1) + (1e6 / fps) as i64;
    let found = MotionAnalysis::new(size, fps, (times[0], end_seen), times, luma, motions);
    store(&name, found).ok_or_else(|| ScanError::Still("the file is gone".into()))
}

/// Forget what is known of `path` (tests).
pub fn forget(path: &str) {
    if let Some(key) = media_key(Path::new(path)) {
        registry().lock().unwrap().files.remove(&key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyses_survive_the_disk() {
        let a = MotionAnalysis::new((64, 48), 30.0, (0, 200_000), vec![0, 33_333, 66_666], vec![0.4, 0.5, 0.45], vec![Similarity { a: 1.0, b: 0.0, tx: 1.5, ty: -0.5 }, Similarity { a: 0.999, b: 0.01, tx: 0.5, ty: 0.0 }]);
        let b = MotionAnalysis::from_json(&a.to_json()).unwrap();
        assert_eq!((b.size, b.times.len(), b.motions.len()), ((64, 48), 3, 2));
        assert!((b.motions[1].b - 0.01).abs() < 1e-9 && (b.luma[2] - 0.45).abs() < 1e-6);
        assert!(b.covers(Micros(0), Micros(200_000)) && !b.covers(Micros(0), Micros(900_000)));
    }
}
