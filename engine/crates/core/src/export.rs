//! Export: a project rendered and encoded to a file, independent of the open preview.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use crate::project::parse_project_json;
use crate::Result;

pub use openrip_export::Codec;

/// The video codec named `name`: "hevc" (or "h265") for HEVC, anything else H.264.
pub fn codec_named(name: &str) -> Codec {
    if name.eq_ignore_ascii_case("hevc") || name.eq_ignore_ascii_case("h265") {
        Codec::Hevc
    } else {
        Codec::H264
    }
}

#[derive(Clone, Debug)]
pub struct ExportOptions {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: Codec,
    /// Bits per second.
    pub bitrate: f64,
    pub audio: bool,
}

#[derive(Clone, Debug)]
pub struct ExportResult {
    pub frames: u64,
    pub seconds: f64,
    /// Layers skipped because their media or font was missing, summed over frames.
    pub skipped_layers: u64,
}

#[derive(Copy, Clone, Debug)]
pub struct ExportProgress {
    pub done: u64,
    pub total: u64,
}

/// A running export's frames done and total, and a request to stop it; shared between the
/// thread exporting and the ones watching.
pub struct ExportControl {
    done: AtomicU64,
    total: AtomicU64,
    cancel: AtomicBool,
}

impl Default for ExportControl {
    fn default() -> Self {
        Self::new()
    }
}

impl ExportControl {
    pub const fn new() -> ExportControl {
        ExportControl { done: AtomicU64::new(0), total: AtomicU64::new(0), cancel: AtomicBool::new(false) }
    }

    /// The running (or last) export's progress, in frames.
    pub fn progress(&self) -> ExportProgress {
        ExportProgress { done: self.done.load(Ordering::Relaxed), total: self.total.load(Ordering::Relaxed) }
    }

    /// Stop the running export: it returns an error ("cancelled") and the unfinished file is
    /// removed.
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}

/// Export a project (JSON in any format [`parse_project_json`] reads) to an MP4/MOV file at
/// `path`, reporting progress to `control`. Blocks until done: call it off the UI thread.
pub fn export_project(json: &str, path: &Path, o: &ExportOptions, control: &ExportControl) -> Result<ExportResult> {
    let (project, _) = parse_project_json(json)?;
    let options = openrip_export::ExportOptions {
        width: o.width & !1,
        height: o.height & !1,
        fps: openrip_model::FrameRate::from_f64(o.fps),
        codec: o.codec,
        bitrate: o.bitrate.max(100_000.0) as u64,
        audio: o.audio,
    };
    control.done.store(0, Ordering::Relaxed);
    control.total.store(0, Ordering::Relaxed);
    control.cancel.store(false, Ordering::Relaxed);
    let s = openrip_export::export(project, path, &options, |done, total| {
        control.done.store(done, Ordering::Relaxed);
        control.total.store(total, Ordering::Relaxed);
        !control.cancel.load(Ordering::Relaxed)
    })?;
    Ok(ExportResult { frames: s.frames, seconds: s.seconds, skipped_layers: s.skipped_layers })
}
