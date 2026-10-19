//! The editor's analysis tools on a clip's media (openrip-analysis over frames
//! openrip-playback reads): Split scenes, and the colour statistics Auto adjust and Color
//! match work from. Each blocks (call it off the UI thread), reports progress to an
//! [`AnalysisControl`] and stops when asked.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use openrip_model::Micros;
use openrip_playback::ScanError;

use crate::Result;

pub use openrip_analysis::{ColorStats, CutKind, Moments, SceneCut, Sliders};

/// A running analysis's progress (in frames) and a request to stop it; shared between the
/// thread analysing and the ones watching.
pub struct AnalysisControl {
    done: AtomicU64,
    total: AtomicU64,
    cancel: AtomicBool,
}

impl Default for AnalysisControl {
    fn default() -> Self {
        Self::new()
    }
}

impl AnalysisControl {
    pub const fn new() -> AnalysisControl {
        AnalysisControl { done: AtomicU64::new(0), total: AtomicU64::new(0), cancel: AtomicBool::new(false) }
    }

    /// Frames done and the total.
    pub fn progress(&self) -> (u64, u64) {
        (self.done.load(Ordering::Relaxed), self.total.load(Ordering::Relaxed))
    }

    /// Stop the analysis: it returns an error ("cancelled").
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    fn report(&self, done: u64, total: u64) -> bool {
        self.done.store(done, Ordering::Relaxed);
        self.total.store(total, Ordering::Relaxed);
        !self.cancel.load(Ordering::Relaxed)
    }
}

/// How Split scenes reads a clip.
#[derive(Clone, Copy, Debug)]
pub struct SceneOptions {
    /// 0 (only clear changes) to 1 (subtle ones too).
    pub sensitivity: f32,
    /// The shortest scene kept, seconds.
    pub min_scene: f64,
}

impl Default for SceneOptions {
    fn default() -> Self {
        SceneOptions { sensitivity: 0.5, min_scene: 0.4 }
    }
}

/// The shot changes in `path`'s video over `duration` from `start` (media time; to its end
/// for `None`): each cut's time is the media time of the new shot's first frame.
pub fn detect_scenes(path: &Path, start: Micros, duration: Option<Micros>, options: SceneOptions, control: &AnalysisControl) -> Result<Vec<SceneCut>> {
    Ok(openrip_playback::scan_scenes(path, start, duration, options.sensitivity, options.min_scene, &mut |d, t| control.report(d, t))?)
}

/// Track the camera and each frame's brightness in `path`'s video over `duration` from `start`
/// (media time; to its end for `None`), for Stabilize and Remove flickers. The result is kept
/// by the engine (in memory and in its cache folder) for every preview and export to use, so
/// a range already tracked returns at once.
pub fn analyse_motion(path: &Path, start: Micros, duration: Option<Micros>, control: &AnalysisControl) -> Result<()> {
    openrip_playback::enhance::analyse(path, start, duration, &mut |d, t| control.report(d, t))?;
    Ok(())
}

/// Whether the engine has tracked `path` over `duration` from `start` (see [`analyse_motion`]).
pub fn motion_ready(path: &Path, start: Micros, duration: Option<Micros>) -> bool {
    let Some(known) = openrip_playback::enhance::analysis(&path.to_string_lossy()) else { return false };
    let end = duration.map_or(known.range.1, |d| start.0 + d.0);
    known.covers(start, Micros(end))
}

/// Frames sampled across a range for the colour tools.
const COLOR_FRAMES: usize = 12;

/// How a clip looks on top of its media, as far as its statistics follow it: its Color match,
/// then the Adjust sliders the compositor's CPU reference draws (brightness, contrast,
/// saturation, highlights, shadows, whites, blacks, temperature, tint; the rest of the grade
/// isn't followed).
#[derive(Clone, Debug, Default)]
pub struct Look {
    pub matched: Option<MatchOn>,
    pub sliders: openrip_render::Adjust,
}

impl Look {
    fn apply(&self, pixels: &mut [[f32; 3]]) {
        if let Some(m) = self.matched.filter(|m| m.intensity > 0.0) {
            let t = openrip_analysis::Transfer::between(&m.source, &m.reference);
            let k = m.intensity.clamp(0.0, 1.0);
            for p in pixels.iter_mut() {
                let q = t.apply(*p);
                *p = [0, 1, 2].map(|c| p[c] + (q[c] - p[c]) * k);
            }
        }
        if !self.sliders.is_identity() {
            for p in pixels.iter_mut() {
                *p = self.sliders.apply_rgb(*p);
            }
        }
    }
}

/// The colour statistics of `path` over `duration` from `start` (media time; to its end for
/// `None`), from frames spread across it, seen through `look` when given (Color match reads
/// its Oklab moments: a reference's as it looks, the clip's own as its media is).
pub fn color_stats(path: &Path, start: Micros, duration: Option<Micros>, look: Option<&Look>, control: &AnalysisControl) -> Result<ColorStats> {
    let sample = openrip_playback::sample_colors(path, start, duration, COLOR_FRAMES, &mut |d, t| control.report(d, t))?;
    let Some(look) = look else { return Ok(sample.stats()) };
    let mut pixels = sample.pixels().to_vec();
    look.apply(&mut pixels);
    Ok(ColorStats::of(&pixels))
}

/// A Color match already on the clip: what Auto adjust sees through it.
#[derive(Clone, Copy, Debug)]
pub struct MatchOn {
    pub source: Moments,
    pub reference: Moments,
    /// 0–1.
    pub intensity: f32,
}

/// What Auto adjust sets, and the statistics it read.
#[derive(Clone, Debug)]
pub struct AutoAdjust {
    pub sliders: Sliders,
    pub stats: ColorStats,
}

/// Auto adjust's sliders for `path` over `duration` from `start`, solved against the
/// compositor's own slider maths; through the clip's Color match when it has one (the match
/// goes on first).
pub fn auto_adjust(path: &Path, start: Micros, duration: Option<Micros>, matched: Option<MatchOn>, control: &AnalysisControl) -> Result<AutoAdjust> {
    let sample = openrip_playback::sample_colors(path, start, duration, COLOR_FRAMES, &mut |d, t| control.report(d, t))?;
    let stats = sample.stats();
    let mut pixels = sample.pixels().to_vec();
    Look { matched, sliders: Default::default() }.apply(&mut pixels);
    let model = |s: &Sliders, rgb: [f32; 3]| {
        openrip_render::Adjust { brightness: s.brightness, contrast: s.contrast, saturation: s.saturation, temperature: s.temperature, tint: s.tint, whites: s.whites, blacks: s.blacks, ..Default::default() }.apply_rgb(rgb)
    };
    Ok(AutoAdjust { sliders: openrip_analysis::auto_adjust(&pixels, &model), stats })
}

impl From<ScanError> for crate::Error {
    fn from(e: ScanError) -> Self {
        match e {
            ScanError::Preview(p) => crate::Error::Preview(p),
            other => crate::Error::Analysis(other.to_string()),
        }
    }
}
