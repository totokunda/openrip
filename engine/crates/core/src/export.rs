//! Export: a project rendered and encoded to a file, independent of the open preview.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use crate::project::parse_project_json;
use crate::Result;

pub use openrip_export::{Backend, Codec, EncoderInfo};
/// Cisco's OpenH264 (H.264 in software): where it's kept, whether it's on, its download.
#[cfg(feature = "ffmpeg")]
pub use openrip_export::openh264;

/// The video codec named `name` (see [`Codec::name`]; "h265" is HEVC); anything else H.264.
pub fn codec_named(name: &str) -> Codec {
    Codec::named(name).unwrap_or(Codec::H264)
}

/// The names of the codecs exports can be written in on this machine, with the hardware
/// setting as it is ([`set_hardware_encoding`]), in menu order. H.264 counts where OpenH264
/// can be downloaded for it.
pub fn available_codecs() -> Vec<&'static str> {
    openrip_export::available_codecs().into_iter().map(Codec::name).collect()
}

/// What each of this machine's encoders can write (found by trying each once).
pub fn encoders() -> Vec<EncoderInfo> {
    openrip_export::encoders()
}

/// Settings' "Hardware encoding": the GPU's encoders where the machine has them (on, the
/// default), or software only (off). Exports started from then on follow it.
pub fn set_hardware_encoding(on: bool) {
    openrip_export::set_hardware_encoding(on);
}

pub fn hardware_encoding() -> bool {
    openrip_export::hardware_encoding()
}

#[derive(Clone, Debug)]
pub struct ExportOptions {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: Codec,
    /// Bits per second.
    pub bitrate: f64,
    /// Hold the bit rate to the one asked (a custom bit rate), not the encoder's average.
    pub exact_bitrate: bool,
    pub audio: bool,
}

#[derive(Clone, Debug)]
pub struct ExportResult {
    pub frames: u64,
    pub seconds: f64,
    /// Layers skipped because their media or font was missing, summed over frames.
    pub skipped_layers: u64,
    /// What wrote the video ("videotoolbox", "openh264", "prores_ks", ...; "" for sound alone or a GIF).
    pub encoder: &'static str,
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

    pub(crate) fn reset(&self) {
        self.done.store(0, Ordering::Relaxed);
        self.total.store(0, Ordering::Relaxed);
        self.cancel.store(false, Ordering::Relaxed);
    }

    /// Record progress; whether to go on.
    pub(crate) fn step(&self, done: u64, total: u64) -> bool {
        self.done.store(done, Ordering::Relaxed);
        self.total.store(total, Ordering::Relaxed);
        !self.cancel.load(Ordering::Relaxed)
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
        exact_bitrate: o.exact_bitrate,
        audio: o.audio,
        hardware: openrip_export::hardware_encoding(),
    };
    control.reset();
    let s = openrip_export::export(project, path, &options, |done, total| control.step(done, total))?;
    Ok(ExportResult { frames: s.frames, seconds: s.seconds, skipped_layers: s.skipped_layers, encoder: s.backend.map_or("", |b| b.name()) })
}

/// Export only the project's sound to `path` as `format` ("wav", "flac", "mp3" or "aac", which
/// writes an M4A). Progress is the seconds mixed of the total.
pub fn export_audio(json: &str, path: &Path, format: &str, control: &ExportControl) -> Result<ExportResult> {
    let (project, _) = parse_project_json(json)?;
    let format = openrip_export::AudioFormat::named(format).ok_or_else(|| openrip_export::ExportError::Other(format!("unknown audio format {format:?}")))?;
    control.reset();
    let s = openrip_export::export_audio(project, path, format, |done, total| control.step(done, total))?;
    Ok(ExportResult { frames: s.frames, seconds: s.seconds, skipped_layers: s.skipped_layers, encoder: "" })
}

/// Export the project as a looping GIF whose shorter side is `short_side` pixels, `fps` frames
/// a second.
pub fn export_gif(json: &str, path: &Path, short_side: u32, fps: f64, control: &ExportControl) -> Result<ExportResult> {
    let (project, _) = parse_project_json(json)?;
    control.reset();
    let s = openrip_export::export_gif(project, path, &openrip_export::GifOptions { short_side, fps }, |done, total| control.step(done, total))?;
    Ok(ExportResult { frames: s.frames, seconds: s.seconds, skipped_layers: s.skipped_layers, encoder: "" })
}
