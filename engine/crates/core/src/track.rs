//! Motion tracking (the Tracking tab and Track mask): a region of a video followed through its
//! real frames, forward and back from the frame it was drawn on, with progress and cancel.
//!
//! The frames are the source's own, decoded in turn and drawn upright, small and grey by the
//! compositor (as large as the region needs to have detail to track, at most 1920 px on the
//! long side); openrip-motion's region tracker follows the region from frame to frame. Results
//! are in the upright picture's own fractions (0–1 across and down), so the caller places them
//! through whatever puts the video on the canvas at each time.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use openrip_media::{open_video, DecoderOptions};
use openrip_model::Micros;
use openrip_motion::{Gray, Region, RegionTracker, TrackerOptions};
use openrip_render::{Compositor, Layer, Source};

use crate::{Error, Result};

/// Which way to track from the frame the region was drawn on (CapCut's Direction).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum TrackDirection {
    Forward,
    Backward,
    Both,
}

impl TrackDirection {
    /// "forward", "backward", anything else both.
    pub fn named(name: &str) -> TrackDirection {
        match name {
            "forward" => TrackDirection::Forward,
            "backward" => TrackDirection::Backward,
            _ => TrackDirection::Both,
        }
    }
}

/// What to track.
#[derive(Clone, Debug)]
pub struct TrackRequest {
    /// The video.
    pub path: String,
    /// The source time of the frame the region was drawn on.
    pub at: Micros,
    /// The source range to track over (the clip's).
    pub from: Micros,
    pub to: Micros,
    /// The region on the upright picture: centre and size in fractions of its width and
    /// height, and its turn in degrees clockwise.
    pub center: [f64; 2],
    pub size: [f64; 2],
    pub rotation: f64,
    pub direction: TrackDirection,
}

/// Where the region was in one frame.
#[derive(Clone, Debug, PartialEq)]
pub struct TrackSample {
    /// The frame's source time.
    pub time: Micros,
    /// Centre and size, fractions of the upright picture; degrees clockwise.
    pub center: [f64; 2],
    pub size: [f64; 2],
    pub rotation: f64,
    /// Its size against the region's where it was drawn.
    pub scale: f64,
    /// 0–1.
    pub confidence: f64,
}

#[derive(Clone, Debug, Default)]
pub struct TrackResult {
    /// One per frame tracked, in time order (the frame drawn on included).
    pub samples: Vec<TrackSample>,
    /// The source time where tracking was lost going forward, or back, if it was.
    pub lost_forward: Option<Micros>,
    pub lost_backward: Option<Micros>,
    /// The size of the frames tracked (the upright picture, made smaller).
    pub work_size: (u32, u32),
}

/// A running track's frames done and total, and a request to stop it; shared between the
/// thread tracking and the ones watching (as [`crate::ExportControl`]).
pub struct TrackControl {
    done: AtomicU64,
    total: AtomicU64,
    cancel: AtomicBool,
}

impl Default for TrackControl {
    fn default() -> Self {
        Self::new()
    }
}

impl TrackControl {
    pub const fn new() -> TrackControl {
        TrackControl { done: AtomicU64::new(0), total: AtomicU64::new(0), cancel: AtomicBool::new(false) }
    }

    /// Frames tracked so far, of the total.
    pub fn progress(&self) -> (u64, u64) {
        (self.done.load(Ordering::Relaxed), self.total.load(Ordering::Relaxed))
    }

    /// Stop the running track: it returns an error ("cancelled").
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}

/// The working picture's long side: the region's shorter side at about `REGION_DETAIL` pixels,
/// within these bounds.
const WORK_LONG: (u32, u32) = (640, 1920);
const REGION_DETAIL: f64 = 160.0;

/// Track a region of a video (see the module docs). Blocks until done: call it off the UI
/// thread.
pub fn track_region(req: &TrackRequest, control: &TrackControl) -> Result<TrackResult> {
    control.done.store(0, Ordering::Relaxed);
    control.total.store(0, Ordering::Relaxed);
    control.cancel.store(false, Ordering::Relaxed);
    let failed = |e: &dyn std::fmt::Display| Error::Track(e.to_string());
    let mut decoder = open_video(Path::new(&req.path), &DecoderOptions::default()).map_err(|e| failed(&e))?;
    let info = decoder.info().clone();
    let orientation = info.rotation;
    let (uw, uh) = if orientation.rem_euclid(180) == 90 { (info.height, info.width) } else { (info.width, info.height) };
    let region_px = (req.size[0] * uw as f64).min(req.size[1] * uh as f64).max(1.0);
    let long = ((uw.max(uh) as f64 * REGION_DETAIL / region_px).round() as u32).clamp(WORK_LONG.0, WORK_LONG.1.max(WORK_LONG.0)).min(uw.max(uh));
    let k = long as f64 / uw.max(uh) as f64;
    let (w, h) = (((uw as f64 * k).round() as u32).max(16), ((uh as f64 * k).round() as u32).max(16));
    let compositor = Compositor::new().map_err(|e| failed(&e))?;
    let gray = |frame: &openrip_media::VideoFrame| {
        let layer = Layer::from_model_oriented(Source::Video(frame), [w, h], [0.0, 0.0], [1.0, 1.0], 0.0, orientation);
        let img = compositor.render(w, h, [0, 0, 0], &[layer]);
        Gray::from_rgba(w as usize, h as usize, &img.data)
    };
    let frame_length = info.frame_rate.map_or(Micros(33_333), |r| r.frame_duration());
    let (from, to) = (Micros(req.from.0.max(0)), Micros(req.to.0.min(info.duration.0.max(1))));
    let at = Micros(req.at.0.clamp(from.0, (to.0 - 1).max(from.0)));
    let span = |a: Micros, b: Micros| ((b.0 - a.0).max(0) / frame_length.0.max(1)) as u64;
    let total = match req.direction {
        TrackDirection::Forward => span(at, to),
        TrackDirection::Backward => span(from, at),
        TrackDirection::Both => span(from, to),
    } + 1;
    control.total.store(total, Ordering::Relaxed);
    let Some(first) = decoder.frame_at(at).map_err(|e| failed(&e))? else { return Err(Error::Track("no frame at the start".into())) };
    let start_gray = gray(&first);
    let region = Region {
        center: [req.center[0] * w as f64, req.center[1] * h as f64],
        size: [req.size[0] * w as f64, req.size[1] * h as f64],
        rotation: req.rotation.to_radians(),
    };
    let sample = |time: Micros, step: &openrip_motion::Step| TrackSample {
        time,
        center: [step.region.center[0] / w as f64, step.region.center[1] / h as f64],
        size: [step.region.size[0] / w as f64, step.region.size[1] / h as f64],
        rotation: step.region.rotation.to_degrees(),
        scale: step.transform.scale(),
        confidence: step.confidence,
    };
    let start = TrackSample { time: first.time, center: req.center, size: req.size, rotation: req.rotation, scale: 1.0, confidence: 1.0 };
    let mut result = TrackResult { samples: vec![start], work_size: (w, h), ..Default::default() };
    control.done.store(1, Ordering::Relaxed);
    let options = TrackerOptions::default();
    let mut tracked = |forward: bool, result: &mut TrackResult| -> Result<Option<Micros>> {
        let mut tracker = RegionTracker::new(start_gray.clone(), region, options).map_err(|e| failed(&e))?;
        let mut current = first.try_clone().map_err(|e| failed(&e))?;
        loop {
            if control.cancel.load(Ordering::Relaxed) {
                return Err(Error::Track("cancelled".into()));
            }
            // The next frame that way: a quarter into it, clear of rounding at its start.
            let length = if current.duration.0 > 0 { current.duration } else { frame_length };
            let next_at = if forward { Micros(current.time.0 + length.0 + length.0 / 4) } else { Micros(current.time.0 - length.0 * 3 / 4) };
            if (forward && next_at >= to) || (!forward && next_at < from) {
                return Ok(None);
            }
            let Some(next) = decoder.frame_at(next_at).map_err(|e| failed(&e))? else { return Ok(None) };
            if (forward && next.time <= current.time) || (!forward && next.time >= current.time) {
                return Ok(None);
            }
            let step = tracker.step(gray(&next));
            control.done.fetch_add(1, Ordering::Relaxed);
            if step.lost {
                return Ok(Some(next.time));
            }
            result.samples.push(sample(next.time, &step));
            current = next;
        }
    };
    if matches!(req.direction, TrackDirection::Forward | TrackDirection::Both) {
        result.lost_forward = tracked(true, &mut result)?;
    }
    if matches!(req.direction, TrackDirection::Backward | TrackDirection::Both) {
        result.lost_backward = tracked(false, &mut result)?;
    }
    result.samples.sort_by_key(|s| s.time);
    control.done.store(total, Ordering::Relaxed);
    Ok(result)
}
