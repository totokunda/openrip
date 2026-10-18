//! Timeline thumbnails, waveforms and beats, independent of any open project.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use openrip_model::Micros;
use openrip_playback::{Pass, Thumbnailer};
use openrip_render::RgbaImage;

use crate::Result;

/// A file's waveform: per bucket of `1 / per_second` s, of the mono mix, the largest absolute
/// sample and the RMS (0..1).
pub use openrip_audio::Peaks as Waveform;

/// A file's beats: its tempo, and each beat in media time with whether it starts a bar.
pub use openrip_audio::beats::BeatGrid as Beats;

/// Thumbnails and waveforms, with the folder that keeps them across runs. One thumbnailer
/// per pass, so a long exact pass doesn't hold up a quick one. Usable from any thread.
pub struct Thumbnails {
    quick: Mutex<Option<Thumbnailer>>,
    exact: Mutex<Option<Thumbnailer>>,
    cache_dir: Mutex<Option<PathBuf>>,
}

pub struct Thumbnail {
    /// Index into the requested times.
    pub index: u32,
    pub time: Micros,
    /// False for a stand-in (the keyframe of the GOP the time falls in); ask again with
    /// `exact` for the real frame.
    pub exact: bool,
    pub image: RgbaImage,
}

impl Default for Thumbnails {
    fn default() -> Self {
        Self::new()
    }
}

impl Thumbnails {
    pub const fn new() -> Thumbnails {
        Thumbnails { quick: Mutex::new(None), exact: Mutex::new(None), cache_dir: Mutex::new(None) }
    }

    /// Keep exact thumbnails and waveforms in `dir` across runs (e.g. under the app's cache
    /// folder).
    pub fn set_cache_dir(&self, dir: PathBuf) {
        *self.cache_dir.lock().unwrap() = Some(dir);
        // Rebuilt with the new folder on next use.
        self.quick.lock().unwrap().take();
        self.exact.lock().unwrap().take();
    }

    /// Thumbnails `height` px tall of the video or still at `path`, at source `times`, in
    /// index order. Quick (`exact` false) returns each GOP's keyframe for every time in it, a
    /// few decodes per strip; then ask with `exact` true for the frames themselves. Exact
    /// thumbnails are kept in the cache folder, and either kind of request returns them from
    /// there. Blocks: call it off the UI thread.
    pub fn thumbnails(&self, path: &Path, times: &[Micros], height: u32, exact: bool) -> Result<Vec<Thumbnail>> {
        let slot = if exact { &self.exact } else { &self.quick };
        let mut guard = slot.lock().unwrap();
        if guard.is_none() {
            *guard = Some(Thumbnailer::new(self.cache_dir.lock().unwrap().clone())?);
        }
        let pass = if exact { Pass::Exact } else { Pass::Quick };
        let mut out = Vec::with_capacity(times.len());
        guard.as_mut().unwrap().thumbnails(path, times, height, pass, |th| {
            out.push(Thumbnail { index: th.index as u32, time: th.time, exact: th.exact, image: th.image });
            true
        })?;
        out.sort_by_key(|t| t.index);
        Ok(out)
    }

    /// The waveform of `path`'s audio at `per_second` buckets a second (must divide 48,000;
    /// 100 is one per 10 ms); `None` if it has no audio. Kept in the cache folder, so each
    /// file is decoded once. Blocks: call it off the UI thread.
    pub fn waveform(&self, path: &Path, per_second: u32) -> Result<Option<Waveform>> {
        let dir = self.cache_dir.lock().unwrap().clone();
        Ok(openrip_playback::waveform(path, per_second, dir.as_deref())?)
    }

    /// The beats in `path`'s audio (all of it, for the timeline's automatic beat markers);
    /// `None` if it has no audio. Kept in the cache folder, so each song is listened to once.
    /// Blocks: call it off the UI thread.
    pub fn beats(&self, path: &Path) -> Result<Option<Beats>> {
        let dir = self.cache_dir.lock().unwrap().clone();
        Ok(openrip_playback::beats(path, dir.as_deref())?)
    }
}
