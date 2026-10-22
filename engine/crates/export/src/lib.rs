//! Export: render a project frame by frame and encode it to a video file.
//!
//! The render loop is the same everywhere; what takes the frames is an [`Encoder`], the
//! encode seam. It hands out the picture each frame is drawn into, so frames can go to a
//! hardware encoder without a copy. Built in (the `ffmpeg` feature), each a [`Backend`]:
//! - Apple platforms: VideoToolbox's H.264/HEVC/ProRes encoders through FFmpeg, fed NV12
//!   (BT.709, limited range) IOSurfaces the compositor renders into (`videotoolbox.rs`).
//!   CapCut exports BT.709 limited range too (calibration session 1).
//! - Windows: Media Foundation's H.264/HEVC encoders through FFmpeg, on the GPU or Microsoft's
//!   software ones (`software.rs`; built and tested on Windows only).
//! - Software, everywhere: H.264 through Cisco's OpenH264, downloaded by the app the first
//!   time it's needed (`openh264.rs`), and ProRes through FFmpeg's `prores_ks` (`software.rs`).
//!   They take frames read back from the GPU ([`Picture::Rgba`]).
//!
//! Every file is muxed by FFmpeg (MP4/MOV, `mux.rs`). Which backend writes an export:
//! [`candidates`], tried in order; one that fails part way is dropped and the export starts
//! again with the next. [`encoders`] says what each can do on this machine (found by trying).
//!
//! Not written yet: MediaCodec with an input surface on Android, WebCodecs `VideoEncoder` on
//! the web, the GPU vendors' encoders on Windows and Linux (docs/plan/cross-platform-encoding.md).
//!
//! Also written here: audio-only files (WAV, FLAC, MP3, AAC: `audio_file.rs`) and GIFs
//! (`gif.rs`), from the same mix and renderer.
//!
//! Audio is mixed at CapCut's export rate (44.1 kHz stereo) in step with the video and
//! encoded as AAC-LC.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use openrip_model::{FrameRate, Micros, Project};
use openrip_playback::{FrameReport, PreviewEngine, PreviewError};
use openrip_render::RgbaImage;

#[cfg(feature = "ffmpeg")]
mod aac_file;
mod audio_file;
mod gif;
#[cfg(feature = "ffmpeg")]
mod mux;
#[cfg(feature = "ffmpeg")]
pub mod openh264;
mod prerender;
#[cfg(feature = "ffmpeg")]
mod software;
#[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
mod videotoolbox;

pub use audio_file::{export_audio, AudioFormat};
pub use prerender::{available as prerender_available, cache_codec, prerender, PrerenderStats};
pub use gif::{export_gif, gif_size, GifOptions};

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("{op} failed ({code})")]
    Ffmpeg { op: &'static str, code: i32 },
    #[error(transparent)]
    Render(#[from] PreviewError),
    #[error("{0}")]
    Other(String),
    #[error("cancelled")]
    Cancelled,
    /// H.264 in software needs Cisco's OpenH264, which isn't downloaded yet (or is turned off):
    /// the app fetches it ([`openh264::install`]) and tries again.
    #[error("needs-openh264")]
    NeedsOpenH264,
}

/// A ProRes profile (the 422 family, and 4444).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ProRes {
    Lt,
    Standard,
    Hq,
    FourFourFourFour,
}

impl ProRes {
    /// The profile's name for FFmpeg's ProRes encoders (`prores_videotoolbox`, `prores_ks`).
    pub fn profile_name(self) -> &'static str {
        match self {
            ProRes::Lt => "lt",
            ProRes::Standard => "standard",
            ProRes::Hq => "hq",
            ProRes::FourFourFourFour => "4444",
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Codec {
    H264,
    Hevc,
    /// HEVC with an alpha channel: where nothing is drawn the picture is transparent.
    HevcAlpha,
    ProRes(ProRes),
}

impl Codec {
    /// Every codec, in the order a menu lists them.
    pub const ALL: [Codec; 7] = [Codec::H264, Codec::Hevc, Codec::HevcAlpha, Codec::ProRes(ProRes::Lt), Codec::ProRes(ProRes::Standard), Codec::ProRes(ProRes::Hq), Codec::ProRes(ProRes::FourFourFourFour)];

    /// The name the API knows it by.
    pub fn name(self) -> &'static str {
        match self {
            Codec::H264 => "h264",
            Codec::Hevc => "hevc",
            Codec::HevcAlpha => "hevc-alpha",
            Codec::ProRes(ProRes::Lt) => "prores-lt",
            Codec::ProRes(ProRes::Standard) => "prores-422",
            Codec::ProRes(ProRes::Hq) => "prores-hq",
            Codec::ProRes(ProRes::FourFourFourFour) => "prores-4444",
        }
    }

    /// The codec named `name` (as [`Codec::name`] writes it; "h265" is HEVC).
    pub fn named(name: &str) -> Option<Codec> {
        let name = name.to_ascii_lowercase();
        if name == "h265" {
            return Some(Codec::Hevc);
        }
        Codec::ALL.into_iter().find(|c| c.name() == name)
    }

    /// Whether the picture carries an alpha channel (frames are drawn on a transparent
    /// canvas, not over the project's background colour).
    pub fn has_alpha(self) -> bool {
        matches!(self, Codec::HevcAlpha | Codec::ProRes(ProRes::FourFourFourFour))
    }
}

/// What encodes an export's video.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Backend {
    /// Apple's encoders (the media engine): H.264, HEVC, HEVC with alpha, ProRes.
    VideoToolbox,
    /// Windows' H.264/HEVC encoders: the GPU's (`hardware`), or Microsoft's software ones.
    MediaFoundation { hardware: bool },
    /// Cisco's OpenH264, downloaded the first time it's needed: H.264 in software.
    OpenH264,
    /// FFmpeg's ProRes encoder: ProRes in software, 4444 with alpha too.
    ProResKs,
}

impl Backend {
    pub fn name(self) -> &'static str {
        match self {
            Backend::VideoToolbox => "videotoolbox",
            Backend::MediaFoundation { hardware: true } => "mediafoundation",
            Backend::MediaFoundation { hardware: false } => "mediafoundation-software",
            Backend::OpenH264 => "openh264",
            Backend::ProResKs => "prores_ks",
        }
    }

    /// Whether it runs on the GPU (what Settings' "Hardware encoding" turns off).
    pub fn hardware(self) -> bool {
        matches!(self, Backend::VideoToolbox | Backend::MediaFoundation { hardware: true })
    }
}

/// The backends to try for `codec` on `os` (`std::env::consts::OS`), best first. With
/// hardware encoding on: the platform's hardware encoder, then software; off: software only.
/// Windows' own encoders come before OpenH264 either way (Microsoft's software encoder is
/// part of Windows).
pub fn candidates(os: &str, codec: Codec, hardware: bool) -> Vec<Backend> {
    let mut out = Vec::new();
    match os {
        "macos" | "ios" if hardware => out.push(Backend::VideoToolbox),
        "windows" if matches!(codec, Codec::H264 | Codec::Hevc) => {
            if hardware {
                out.push(Backend::MediaFoundation { hardware: true });
            }
            out.push(Backend::MediaFoundation { hardware: false });
        }
        _ => {}
    }
    match codec {
        Codec::H264 => out.push(Backend::OpenH264),
        Codec::ProRes(_) => out.push(Backend::ProResKs),
        Codec::Hevc | Codec::HevcAlpha => {}
    }
    out
}

/// Encode on the GPU where the machine can (on, the default), or always in software (off).
/// Exports and pre-renders started from then on follow it.
pub fn set_hardware_encoding(on: bool) {
    HARDWARE.store(on, Ordering::Relaxed);
}

/// Whether exports use the hardware encoders ([`set_hardware_encoding`]).
pub fn hardware_encoding() -> bool {
    HARDWARE.load(Ordering::Relaxed)
}

static HARDWARE: AtomicBool = AtomicBool::new(true);

/// One backend writing one codec on this machine, as [`encoders`] found it.
#[derive(Clone, Debug, PartialEq)]
pub struct EncoderInfo {
    pub backend: Backend,
    pub codec: Codec,
    pub hardware: bool,
    /// The largest picture it takes, longer side x shorter side.
    pub max_size: (u32, u32),
    /// Whether it can write 10 bits (the exports write 8, ProRes 10).
    pub ten_bit: bool,
    pub alpha: bool,
    /// Not on this machine yet (OpenH264): the app downloads it the first time it's needed.
    pub needs_download: bool,
}

/// Whether `backend` can write `codec` here, found by trying it with a tiny picture once a
/// run (OpenH264: whether it's turned on and Cisco makes a binary for this platform, even if
/// it isn't downloaded yet).
fn usable(backend: Backend, codec: Codec) -> bool {
    let _ = codec;
    match backend {
        #[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
        Backend::VideoToolbox => videotoolbox::available().contains(&codec),
        #[cfg(feature = "ffmpeg")]
        Backend::OpenH264 => codec == Codec::H264 && {
            let s = openh264::status();
            s.supported && s.enabled
        },
        #[cfg(feature = "ffmpeg")]
        Backend::ProResKs | Backend::MediaFoundation { .. } => software::probe_cached(backend, codec),
        #[allow(unreachable_patterns)]
        _ => false,
    }
}

/// The largest picture `backend` takes for `codec`, longer side x shorter side.
fn max_size(backend: Backend, codec: Codec) -> (u32, u32) {
    let _ = codec;
    match backend {
        #[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
        Backend::VideoToolbox => videotoolbox::max_size(codec),
        #[cfg(feature = "ffmpeg")]
        Backend::OpenH264 => openh264::MAX_SIZE,
        // Not probed: H.264 level 5.1's largest picture.
        Backend::MediaFoundation { .. } => (4096, 2304),
        _ => (16384, 16384),
    }
}

/// What this machine's encoders can write (each tried; once a run, but OpenH264 again after
/// it's installed or turned on or off), whatever the hardware setting: for each codec in menu
/// order, its backends best first.
pub fn encoders() -> Vec<EncoderInfo> {
    let installed = {
        #[cfg(feature = "ffmpeg")]
        let i = openh264::status().installed;
        #[cfg(not(feature = "ffmpeg"))]
        let i = false;
        i
    };
    let mut out = Vec::new();
    for codec in Codec::ALL {
        for backend in candidates(std::env::consts::OS, codec, true).into_iter().filter(|b| usable(*b, codec)) {
            out.push(EncoderInfo {
                backend,
                codec,
                hardware: backend.hardware(),
                max_size: max_size(backend, codec),
                ten_bit: match backend {
                    Backend::VideoToolbox => codec != Codec::H264,
                    Backend::ProResKs => true,
                    _ => false,
                },
                alpha: codec.has_alpha(),
                needs_download: backend == Backend::OpenH264 && !installed,
            });
        }
    }
    out
}

/// The codecs exports can be written in on this machine with the hardware setting as it is
/// (H.264 through OpenH264 counts before it's downloaded), in menu order. Empty when the
/// build has no video encoder.
pub fn available_codecs() -> Vec<Codec> {
    let hardware = hardware_encoding();
    Codec::ALL.into_iter().filter(|c| candidates(std::env::consts::OS, *c, hardware).into_iter().any(|b| usable(b, *c))).collect()
}

#[derive(Clone, Debug)]
pub struct ExportOptions {
    pub width: u32,
    pub height: u32,
    pub fps: FrameRate,
    pub codec: Codec,
    /// Bits per second.
    pub bitrate: u64,
    /// Hold the bit rate to what was asked (a constant rate: the encoder neither undershoots on
    /// easy pictures nor overshoots on hard ones) instead of its average target. Used for the
    /// dialog's custom bit rate.
    pub exact_bitrate: bool,
    /// Mix and encode the audio (AAC-LC, 44.1 kHz stereo, like CapCut's exports).
    pub audio: bool,
    /// Use the hardware encoders where there are some (see [`candidates`]).
    pub hardware: bool,
}

/// CapCut exports AAC-LC at 44.1 kHz stereo (calibration sessions 1-2).
pub const AUDIO_RATE: u32 = 44_100;

#[derive(Clone, Debug, Default)]
pub struct ExportStats {
    pub frames: u64,
    pub seconds: f64,
    /// Time spent compositing (decode included) vs waiting on the encoder/muxer.
    pub render_seconds: f64,
    pub encode_seconds: f64,
    /// Layers skipped because their media or font was missing (summed over frames).
    pub skipped_layers: u64,
    /// What wrote the video.
    pub backend: Option<Backend>,
}

/// The picture an encoder wants a frame drawn into.
pub enum Picture<'a> {
    /// An IOSurface-backed NV12 (BT.709, limited range) pixel buffer the encoder takes as
    /// it is.
    #[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
    Nv12(&'a objc2_core_video::CVPixelBuffer),
    /// RGBA pixels read back from the GPU, sized to the export, for encoders that take
    /// pixels from the CPU.
    Rgba(&'a mut RgbaImage),
}

/// Where an export's frames and sound go: an encoder and muxer writing the file.
pub trait Encoder {
    /// Frame `index`: `draw` renders it into the encoder's next picture, which is then
    /// encoded. Returns what `draw` reported.
    fn video(&mut self, index: i64, draw: &mut dyn FnMut(Picture<'_>) -> Result<FrameReport, PreviewError>) -> Result<FrameReport, ExportError>;
    /// Interleaved stereo samples at [`AUDIO_RATE`]; `flush` sends the rest and drains the
    /// encoder.
    fn audio(&mut self, samples: &[f32], flush: bool) -> Result<(), ExportError>;
    /// Flush the video and close the file.
    fn finish(self: Box<Self>) -> Result<(), ExportError>;
    /// Stop and remove the unfinished file.
    fn cancel(self: Box<Self>);
}

/// Open `backend`'s encoder for `o`, writing `path`.
fn open_backend(backend: Backend, path: &Path, o: &ExportOptions) -> Result<Box<dyn Encoder>, ExportError> {
    let _ = (path, o);
    match backend {
        #[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
        Backend::VideoToolbox => Ok(Box::new(videotoolbox::VtEncoder::open(path, o)?)),
        #[cfg(feature = "ffmpeg")]
        Backend::OpenH264 => Ok(Box::new(openh264::H264Encoder::open(path, o)?)),
        #[cfg(feature = "ffmpeg")]
        Backend::ProResKs | Backend::MediaFoundation { .. } => Ok(Box::new(software::SwEncoder::open(backend, path, o)?)),
        #[allow(unreachable_patterns)]
        _ => Err(ExportError::Other(format!("no {} encoder in this build", backend.name()))),
    }
}

/// The first of `o`'s [`candidates`] (but those in `skip`) that opens, writing `path`.
fn open_first(path: &Path, o: &ExportOptions, skip: &[Backend]) -> Result<(Box<dyn Encoder>, Backend), ExportError> {
    let mut first_error = None;
    for b in candidates(std::env::consts::OS, o.codec, o.hardware).into_iter().filter(|b| !skip.contains(b)) {
        match open_backend(b, path, o) {
            Ok(e) => return Ok((e, b)),
            // OpenH264 not downloaded is what the app can act on: it wins over other failures.
            Err(ExportError::NeedsOpenH264) => first_error = Some(ExportError::NeedsOpenH264),
            Err(e) => {
                eprintln!("[export] {} can't write {}: {e}", b.name(), o.codec.name());
                if first_error.is_none() {
                    first_error = Some(e);
                }
            }
        }
    }
    Err(first_error.unwrap_or_else(|| ExportError::Other(format!("no encoder on this machine writes {}{}", o.codec.name(), if o.hardware { "" } else { " in software (turn on hardware encoding in Settings)" }))))
}

/// The encoder for `o` writing `path`: the first of its [`candidates`] that opens.
pub fn open_encoder(path: &Path, o: &ExportOptions) -> Result<Box<dyn Encoder>, ExportError> {
    open_first(path, o, &[]).map(|(e, _)| e)
}

/// Render `project` to `path`. `progress` gets (frame, total) after each frame and returns
/// whether to go on; stopping removes the unfinished file and returns
/// [`ExportError::Cancelled`]. If the encoder fails part way, the export starts again with
/// the next backend that can write the codec (a hardware encoder's failure falls back to
/// software).
pub fn export(project: Project, path: &Path, o: &ExportOptions, progress: impl FnMut(u64, u64) -> bool) -> Result<ExportStats, ExportError> {
    export_through(project, path, o, progress, |skip| open_first(path, o, skip))
}

/// [`export`], with `open` giving the encoder (the first backend not in its list).
fn export_through(project: Project, path: &Path, o: &ExportOptions, mut progress: impl FnMut(u64, u64) -> bool, mut open: impl FnMut(&[Backend]) -> Result<(Box<dyn Encoder>, Backend), ExportError>) -> Result<ExportStats, ExportError> {
    let mut skip = Vec::new();
    loop {
        let (out, backend) = open(&skip)?;
        match export_with(project.clone(), out, o, &mut progress) {
            Ok(mut stats) => {
                stats.backend = Some(backend);
                return Ok(stats);
            }
            Err((e, true)) if candidates(std::env::consts::OS, o.codec, o.hardware).iter().any(|b| *b != backend && !skip.contains(b)) => {
                eprintln!("[export] {} failed part way ({e}); starting again with the next encoder", backend.name());
                let _ = std::fs::remove_file(path);
                skip.push(backend);
            }
            Err((e, _)) => return Err(e),
        }
    }
}

/// One export through `out`; an error says whether the encoder failed (rather than the
/// render, the mix or a cancel).
fn export_with(project: Project, mut out: Box<dyn Encoder>, o: &ExportOptions, progress: &mut impl FnMut(u64, u64) -> bool) -> Result<ExportStats, (ExportError, bool)> {
    let t0 = Instant::now();
    let duration = project.duration();
    let total = o.fps.frame_of(Micros(duration.0 - 1)).max(0) as u64 + 1;
    let mut mixer = o.audio.then(|| openrip_audio::Mixer::with_rate(project.clone(), AUDIO_RATE));
    let mut mixed: i64 = 0;
    let mut block = Vec::new();
    let not_encoder = |e: ExportError| (e, false);
    let encoder = |e: ExportError| {
        let fault = !matches!(e, ExportError::Render(_) | ExportError::Cancelled | ExportError::NeedsOpenH264);
        (e, fault)
    };
    let mut engine = match PreviewEngine::new(project) {
        Ok(e) => e,
        Err(e) => {
            out.cancel();
            return Err(not_encoder(e.into()));
        }
    };
    engine.set_transparent(o.codec.has_alpha());
    let mut stats = ExportStats::default();
    for n in 0..total {
        let t = o.fps.frame_start(n as i64);
        let f0 = Instant::now();
        let mut render = 0.0;
        let report = out.video(n as i64, &mut |picture| {
            let r0 = Instant::now();
            let report = match picture {
                #[cfg(all(feature = "ffmpeg", target_vendor = "apple"))]
                Picture::Nv12(pb) => engine.render_to_nv12(t, pb),
                Picture::Rgba(img) => engine.render_image(t, img.width, img.height).map(|(frame, report)| {
                    *img = frame;
                    report
                }),
            };
            render = r0.elapsed().as_secs_f64();
            report
        });
        let report = match report {
            Ok(r) => r,
            Err(e) => {
                out.cancel();
                return Err(encoder(e));
            }
        };
        stats.skipped_layers += report.missing.len() as u64;
        stats.render_seconds += render;
        // The audio up to the end of this frame.
        if let Some(m) = mixer.as_mut() {
            let until = openrip_audio::sample_at(o.fps.frame_start(n as i64 + 1).min(duration), AUDIO_RATE);
            if until > mixed {
                block.resize((until - mixed) as usize * 2, 0.0);
                if let Err(e) = m.mix(mixed, &mut block) {
                    out.cancel();
                    return Err(not_encoder(ExportError::Other(e.to_string())));
                }
                if let Err(e) = out.audio(&block, false) {
                    out.cancel();
                    return Err(encoder(e));
                }
                mixed = until;
            }
        }
        stats.encode_seconds += f0.elapsed().as_secs_f64() - render;
        stats.frames += 1;
        if !progress(n + 1, total) {
            out.cancel();
            return Err(not_encoder(ExportError::Cancelled));
        }
    }
    let e0 = Instant::now();
    if mixer.is_some() {
        if let Err(e) = out.audio(&[], true) {
            out.cancel();
            return Err(encoder(e));
        }
    }
    out.finish().map_err(encoder)?;
    stats.encode_seconds += e0.elapsed().as_secs_f64();
    stats.seconds = t0.elapsed().as_secs_f64();
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codec_names_round_trip() {
        for c in Codec::ALL {
            assert_eq!(Codec::named(c.name()), Some(c));
        }
        assert_eq!(Codec::named("H265"), Some(Codec::Hevc));
        assert_eq!(Codec::named("vp9"), None);
        assert!(Codec::HevcAlpha.has_alpha() && !Codec::Hevc.has_alpha());
        assert!(Codec::ProRes(ProRes::FourFourFourFour).has_alpha() && !Codec::ProRes(ProRes::Hq).has_alpha());
    }

    #[test]
    fn hardware_first_then_software() {
        use Backend::*;
        let mf = |hardware| MediaFoundation { hardware };
        assert_eq!(candidates("macos", Codec::H264, true), [VideoToolbox, OpenH264]);
        assert_eq!(candidates("macos", Codec::H264, false), [OpenH264]);
        assert_eq!(candidates("macos", Codec::ProRes(ProRes::Hq), true), [VideoToolbox, ProResKs]);
        assert_eq!(candidates("macos", Codec::ProRes(ProRes::Hq), false), [ProResKs]);
        assert_eq!(candidates("macos", Codec::HevcAlpha, true), [VideoToolbox]);
        assert!(candidates("macos", Codec::Hevc, false).is_empty());
        // Windows: Media Foundation first (the GPU's, then Microsoft's software one), OpenH264 last.
        assert_eq!(candidates("windows", Codec::H264, true), [mf(true), mf(false), OpenH264]);
        assert_eq!(candidates("windows", Codec::H264, false), [mf(false), OpenH264]);
        assert_eq!(candidates("windows", Codec::Hevc, true), [mf(true), mf(false)]);
        assert_eq!(candidates("windows", Codec::ProRes(ProRes::FourFourFourFour), true), [ProResKs]);
        assert!(candidates("windows", Codec::HevcAlpha, true).is_empty());
        assert_eq!(candidates("linux", Codec::H264, true), [OpenH264]);
        assert!(candidates("linux", Codec::Hevc, true).is_empty());
        for os in ["macos", "windows", "linux"] {
            for c in Codec::ALL {
                assert!(candidates(os, c, false).iter().all(|b| !b.hardware()), "{os} {c:?}");
            }
        }
    }

    /// An encoder that draws each frame and fails at `fail_at`, saying what happened to it.
    struct Fake {
        fail_at: Option<i64>,
        log: std::rc::Rc<std::cell::RefCell<Vec<String>>>,
    }

    impl Encoder for Fake {
        fn video(&mut self, index: i64, draw: &mut dyn FnMut(Picture<'_>) -> Result<FrameReport, PreviewError>) -> Result<FrameReport, ExportError> {
            if self.fail_at == Some(index) {
                return Err(ExportError::Ffmpeg { op: "avcodec_send_frame", code: -1 });
            }
            draw(Picture::Rgba(&mut RgbaImage { width: 16, height: 16, data: Vec::new() })).map_err(ExportError::from)
        }
        fn audio(&mut self, _: &[f32], _: bool) -> Result<(), ExportError> {
            Ok(())
        }
        fn finish(self: Box<Self>) -> Result<(), ExportError> {
            self.log.borrow_mut().push("finished".into());
            Ok(())
        }
        fn cancel(self: Box<Self>) {
            self.log.borrow_mut().push("cancelled".into());
        }
    }

    #[test]
    fn a_hardware_encoder_failing_part_way_falls_back_to_software() {
        // Three frames of a clip whose file is missing (drawn as nothing).
        let project: Project = serde_json::from_value(serde_json::json!({
            "format": 2, "id": "p", "name": "fallback", "canvas": { "width": 16, "height": 16 }, "fps": { "num": 30, "den": 1 },
            "tracks": [{ "id": "t", "kind": "video", "segments": [{
                "id": "s", "material": "m", "source": { "start": 0, "duration": 100000 }, "target": { "start": 0, "duration": 100000 },
                "speed": 1.0, "visible": true, "render_index": 0,
                "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
                "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
            }]}],
            "materials": { "media": [{ "id": "m", "kind": "photo", "path": "/nonexistent/openrip.png", "duration": 100000 }] }
        }))
        .unwrap();
        let o = ExportOptions { width: 16, height: 16, fps: FrameRate::new(30, 1), codec: Codec::H264, bitrate: 1_000_000, exact_bitrate: false, audio: false, hardware: true };
        let log = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let mut opened = Vec::new();
        let tries = candidates(std::env::consts::OS, Codec::H264, true);
        let stats = export_through(project, Path::new("/nonexistent/out.mp4"), &o, |_, _| true, |skip| {
            let b = *tries.iter().find(|b| !skip.contains(b)).unwrap();
            opened.push(b);
            // The first (the hardware encoder where there is one) fails at frame 1.
            let fail_at = (opened.len() == 1).then_some(1);
            Ok((Box::new(Fake { fail_at, log: log.clone() }) as Box<dyn Encoder>, b))
        });
        if tries.len() < 2 {
            return; // nothing to fall back to on this platform
        }
        let stats = stats.unwrap();
        assert_eq!(opened, tries[..2]);
        assert_eq!(stats.backend, Some(tries[1]));
        assert_eq!(stats.frames, 3);
        assert_eq!(*log.borrow(), ["cancelled", "finished"]);
    }

    #[test]
    fn a_cancel_or_missing_openh264_is_not_retried() {
        let project: Project = serde_json::from_value(serde_json::json!({ "format": 2, "id": "p", "name": "x", "canvas": { "width": 16, "height": 16 }, "fps": { "num": 30, "den": 1 }, "tracks": [], "materials": { "media": [] } })).unwrap();
        let o = ExportOptions { width: 16, height: 16, fps: FrameRate::new(30, 1), codec: Codec::H264, bitrate: 1_000_000, exact_bitrate: false, audio: false, hardware: true };
        let mut opens = 0;
        let r = export_through(project.clone(), Path::new("/nonexistent/out.mp4"), &o, |_, _| false, |_| {
            opens += 1;
            Ok((Box::new(Fake { fail_at: None, log: Default::default() }) as Box<dyn Encoder>, Backend::VideoToolbox))
        });
        assert!(matches!(r, Err(ExportError::Cancelled)) && opens == 1);
        let r = export_through(project, Path::new("/nonexistent/out.mp4"), &o, |_, _| true, |_| Err(ExportError::NeedsOpenH264));
        assert!(matches!(r, Err(ExportError::NeedsOpenH264)));
    }
}
