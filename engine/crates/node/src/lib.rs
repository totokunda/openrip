//! Node/Electron addon: the engine's API ([`openrip_core`]) for the app, as napi functions.
//!
//! ```js
//! const engine = require("./openrip_node.node");
//! const info = engine.openProject(pathToCapCutDraftOrProjectJson);
//! const f = await engine.renderFrame(timeUs, 1280, 720); // on a worker thread
//! // f.ioSurface: IOSurfaceRef bytes for Electron's sharedTexture (BGRA)
//! engine.release(f.id); // when Electron no longer references it
//! ```
//!
//! Only the conversion to and from JavaScript lives here: the logic is in `openrip-core`,
//! which other bindings wrap too. One project is open at a time (the addon's session);
//! frames come from a small pool of IOSurface-backed buffers, reused only after
//! `release(id)`, so the app must release every frame it receives.

use std::path::Path;
use std::sync::{Mutex, OnceLock};

use napi::bindgen_prelude::{AsyncTask, Buffer, Float32Array, Float64Array, Uint8Array};
use napi::{Env, Error, Result, Task};
use napi_derive::napi;
use openrip_core::{ExportControl, Micros, Session, Thumbnails};

fn err(e: impl std::fmt::Display) -> Error {
    Error::from_reason(e.to_string())
}

fn session() -> &'static Mutex<Option<Session>> {
    static S: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

#[napi(object)]
pub struct ProjectInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration_us: i64,
    pub tracks: u32,
    pub segments: u32,
    /// Where the project came from: "capcut", "openrip" or "v1".
    pub source: String,
    /// After `updateProject`: where CapCut texts whose words or style the edit changed are
    /// now laid out, so the app's box around each can follow.
    pub text_blocks: Vec<TextBlock>,
}

/// A text segment's block of lines on the canvas, in canvas pixels, before its rotation.
#[napi(object)]
pub struct TextBlock {
    pub segment: String,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

impl From<openrip_core::ProjectInfo> for ProjectInfo {
    fn from(i: openrip_core::ProjectInfo) -> Self {
        ProjectInfo {
            name: i.name,
            width: i.width,
            height: i.height,
            fps: i.fps,
            duration_us: i.duration_us,
            tracks: i.tracks,
            segments: i.segments,
            source: i.source.as_str().into(),
            text_blocks: i.text_blocks.into_iter().map(|b| TextBlock { segment: b.segment, left: b.left, top: b.top, width: b.width, height: b.height }).collect(),
        }
    }
}

/// The addon's version, so the app can tell which engine it loaded.
#[napi]
pub fn version() -> String {
    openrip_core::version()
}

/// Open a project for preview (replacing any open one): a CapCut draft folder, an OpenRip
/// project JSON, or a v1 project file.
#[napi]
pub fn open_project(path: String) -> Result<ProjectInfo> {
    let (project, source) = openrip_core::load_project(Path::new(&path)).map_err(err)?;
    start_session(project, source)
}

/// Open a project from JSON text: an OpenRip project, a v1 project (the app's own format)
/// or a CapCut draft's `draft_info.json`.
#[napi]
pub fn open_project_json(json: String) -> Result<ProjectInfo> {
    let (project, source) = openrip_core::parse_project_json(&json).map_err(err)?;
    start_session(project, source)
}

/// Replace the open project after an edit (same formats as `openProjectJson`). Decoders,
/// the audio output and the playback state stay as they are, so this is cheap enough to
/// call after every edit; paused, the current frame is rendered again. Opens the project
/// if none is open.
#[napi]
pub fn update_project(json: String) -> Result<ProjectInfo> {
    let (project, source) = openrip_core::parse_project_json(&json).map_err(err)?;
    let mut guard = session().lock().unwrap();
    let Some(s) = guard.as_mut() else {
        drop(guard);
        return start_session(project, source);
    };
    Ok(s.update(project, source).into())
}

fn start_session(project: openrip_core::Project, source: openrip_core::Source) -> Result<ProjectInfo> {
    // Close the old session (and its audio output) before opening the new one.
    session().lock().unwrap().take();
    let (s, info) = Session::open(project, source).map_err(err)?;
    *session().lock().unwrap() = Some(s);
    Ok(info.into())
}

#[napi]
pub fn close() {
    session().lock().unwrap().take();
}

#[napi(object)]
pub struct FrameHandle {
    pub id: u32,
    /// IOSurfaceRef pointer bytes, as Electron's `sharedTexture` expects on macOS (BGRA).
    pub io_surface: Buffer,
    pub width: u32,
    pub height: u32,
    pub time_us: i64,
    pub render_ms: f64,
    /// Layers drawn, and layers skipped because their media or font is missing.
    pub layers: u32,
    pub skipped: u32,
}

pub struct RenderTask {
    time: Micros,
    width: u32,
    height: u32,
    scrub: bool,
}

#[cfg(target_os = "macos")]
impl Task for RenderTask {
    type Output = openrip_core::RenderedFrame;
    type JsValue = FrameHandle;

    fn compute(&mut self) -> Result<Self::Output> {
        let job = session().lock().unwrap().as_mut().ok_or_else(|| err(openrip_core::Error::NoProject))?.frame_job(self.time, self.width, self.height, self.scrub).map_err(err)?;
        job.render().map_err(err)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<FrameHandle> {
        let f = session().lock().unwrap().as_mut().ok_or_else(|| err(openrip_core::Error::Closed))?.hand_out(out).map_err(err)?;
        Ok(FrameHandle { id: f.id, io_surface: Buffer::from(f.io_surface.to_ne_bytes().to_vec()), width: f.width, height: f.height, time_us: f.time_us, render_ms: f.render_ms, layers: f.layers, skipped: f.skipped })
    }
}

/// Render the frame at `timeUs` into a pooled IOSurface (on a worker thread). With `scrub`,
/// video shows a frame that's quick to get while the playhead is dragged.
#[cfg(target_os = "macos")]
#[napi]
pub fn render_frame(time_us: i64, width: u32, height: u32, scrub: Option<bool>) -> AsyncTask<RenderTask> {
    AsyncTask::new(RenderTask { time: Micros(time_us), width, height, scrub: scrub.unwrap_or(false) })
}

/// Let a frame's surface be reused (call when Electron releases it).
#[napi]
pub fn release(id: u32) {
    if let Some(s) = session().lock().unwrap().as_mut() {
        s.release(id);
    }
}

#[napi(object)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    /// Straight-alpha RGBA bytes.
    pub data: Buffer,
}

/// Render the frame at `timeUs` and read it back (tests, thumbnails). Synchronous.
#[napi]
pub fn render_image(time_us: i64, width: u32, height: u32) -> Result<Image> {
    let renderer = session().lock().unwrap().as_ref().map(Session::renderer).ok_or_else(|| err(openrip_core::Error::NoProject))?;
    let img = renderer.render_image(Micros(time_us), width, height).map_err(err)?;
    Ok(Image { width: img.width, height: img.height, data: Buffer::from(img.data) })
}

/// Start playback (audio, and the master clock) at `timeUs`. False without an output device.
#[napi]
pub fn play(time_us: i64) -> bool {
    session().lock().unwrap().as_ref().is_some_and(|s| s.play(Micros(time_us)))
}

#[napi]
pub fn pause() {
    if let Some(s) = session().lock().unwrap().as_ref() {
        s.pause();
    }
}

/// The timeline time being heard now (the clock to pick video frames by), or -1 without
/// audio output.
#[napi]
pub fn position_us() -> i64 {
    session().lock().unwrap().as_ref().and_then(Session::position).map_or(-1, |t| t.0)
}

/// Output gain; 0 mutes (the clock keeps running).
#[napi]
pub fn set_volume(volume: f64) {
    if let Some(s) = session().lock().unwrap().as_ref() {
        s.set_volume(volume as f32);
    }
}

#[napi(object)]
pub struct OutputLevels {
    /// Each channel's peak (0..1) of the mix played since the last call, before the volume.
    pub left: f64,
    pub right: f64,
}

/// The playing mix's level since the last call, for the player's meter; zero while paused,
/// `null` without an audio output (or a project).
#[napi]
pub fn output_levels() -> Option<OutputLevels> {
    let [left, right] = session().lock().unwrap().as_ref()?.output_levels()?;
    Some(OutputLevels { left: left as f64, right: right as f64 })
}

/// Play a short snippet of the mix at `timeUs`, for scrubbing the playhead. False when none
/// started (playback is running, too soon after the last snippet, or no audio output).
#[napi]
pub fn scrub_audio(time_us: i64) -> bool {
    session().lock().unwrap().as_ref().is_some_and(|s| s.scrub_audio(Micros(time_us)))
}

/// Cut a scrub snippet short (the drag ended).
#[napi]
pub fn scrub_audio_stop() {
    if let Some(s) = session().lock().unwrap().as_ref() {
        s.scrub_audio_stop();
    }
}

#[napi(object)]
pub struct ScrubAudioStats {
    /// Snippets started since the project opened.
    pub snippets: f64,
    /// Where the latest one started, microseconds.
    pub last_us: f64,
    /// The latest snippet's left and right peaks (0..1), whether or not the speakers are muted.
    pub left: f64,
    pub right: f64,
}

/// What scrubbing has played, for tests; `null` without an audio output (or a project).
#[napi]
pub fn scrub_audio_stats() -> Option<ScrubAudioStats> {
    let s = session().lock().unwrap().as_ref()?.scrub_stats()?;
    Some(ScrubAudioStats { snippets: s.snippets as f64, last_us: s.last_us as f64, left: s.peaks[0] as f64, right: s.peaks[1] as f64 })
}

#[napi(object)]
pub struct StillFrame {
    pub width: u32,
    pub height: u32,
    /// The file's size in bytes.
    pub bytes: f64,
}

pub struct StillTask {
    time: Micros,
    width: u32,
    height: u32,
    path: String,
}

impl Task for StillTask {
    type Output = StillFrame;
    type JsValue = StillFrame;

    fn compute(&mut self) -> Result<Self::Output> {
        let renderer = session().lock().unwrap().as_ref().map(Session::renderer).ok_or_else(|| err(openrip_core::Error::NoProject))?;
        let img = renderer.render_image(self.time, self.width, self.height).map_err(err)?;
        let png = img.to_png().map_err(err)?;
        std::fs::write(&self.path, &png).map_err(err)?;
        Ok(StillFrame { width: img.width, height: img.height, bytes: png.len() as f64 })
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<StillFrame> {
        Ok(out)
    }
}

/// Render the open project's frame at `timeUs` at `width`×`height` and save it as a PNG at
/// `path`, on a worker thread (the player's Export still frames).
#[napi]
pub fn export_still(time_us: i64, width: u32, height: u32, path: String) -> AsyncTask<StillTask> {
    AsyncTask::new(StillTask { time: Micros(time_us), width, height, path })
}

// ---- Render-ahead preview (what the app's preview uses) ----

/// Size of the preview surfaces; creates the pipeline on first call.
#[cfg(target_os = "macos")]
#[napi]
pub fn set_preview_size(width: u32, height: u32) -> Result<()> {
    session().lock().unwrap().as_mut().ok_or_else(|| err(openrip_core::Error::NoProject))?.set_preview_size(width, height).map_err(err)
}

/// Play from `fromUs`: sound starts and frames render ahead of the audio clock.
#[cfg(target_os = "macos")]
#[napi]
pub fn start_playback(from_us: i64) -> Result<()> {
    session().lock().unwrap().as_ref().ok_or_else(|| err(openrip_core::Error::NoProject))?.start_playback(Micros(from_us)).map_err(err)
}

/// Stop playing; the picture stays on the frame at the stop time.
#[cfg(target_os = "macos")]
#[napi]
pub fn stop_playback() -> i64 {
    session().lock().unwrap().as_ref().map_or(0, |s| s.stop_playback().0)
}

/// Show the frame at `timeUs` (paused; scrubbing). The newest request wins.
#[cfg(target_os = "macos")]
#[napi]
pub fn seek(time_us: i64) {
    if let Some(s) = session().lock().unwrap().as_ref() {
        s.seek(Micros(time_us));
    }
}

#[napi(object)]
pub struct DisplayFrame {
    pub id: u32,
    /// IOSurfaceRef pointer bytes for `sharedTexture` (BGRA).
    pub io_surface: Buffer,
    pub width: u32,
    pub height: u32,
    pub time_us: i64,
    pub render_ms: f64,
}

/// The frame to show now (the newest one due by the playback clock, or the last seek), or
/// `null` if there is nothing new. Call `release(id)` when Electron is done with it.
#[cfg(target_os = "macos")]
#[napi]
pub fn frame_for_display() -> Option<DisplayFrame> {
    let f = session().lock().unwrap().as_mut()?.frame_for_display()?;
    Some(DisplayFrame { id: f.id, io_surface: Buffer::from(f.io_surface.to_ne_bytes().to_vec()), width: f.width, height: f.height, time_us: f.time_us, render_ms: f.render_ms })
}

// ---- Decoding ----

/// The app's "Speed up hardware decoding": GPU decoding where the platform has it (true), or
/// software only. Media opened from then on follow it.
#[napi]
pub fn set_hardware_decoding(on: bool) {
    openrip_core::set_hardware_decoding(on);
}

#[napi]
pub fn hardware_decoding() -> bool {
    openrip_core::hardware_decoding()
}

// ---- Timeline thumbnails ----

fn thumbnails_service() -> &'static Thumbnails {
    static T: Thumbnails = Thumbnails::new();
    &T
}

/// Keep exact thumbnails in `dir` across runs (e.g. under the app's cache folder).
#[napi]
pub fn set_thumbnail_cache_dir(dir: String) {
    // Tracked motion (Stabilize, Remove flickers) is kept beside them.
    openrip_core::set_motion_cache_dir(dir.clone().into());
    thumbnails_service().set_cache_dir(dir.into());
}

#[napi(object)]
pub struct Thumbnail {
    /// Index into the requested times.
    pub index: u32,
    pub time_us: i64,
    /// False for a stand-in (the keyframe of the GOP the time falls in); ask again with
    /// `exact` for the real frame.
    pub exact: bool,
    pub width: u32,
    pub height: u32,
    /// RGBA, `width * height * 4` bytes.
    pub rgba: Buffer,
}

pub struct ThumbnailTask {
    path: String,
    times: Vec<Micros>,
    height: u32,
    exact: bool,
}

impl Task for ThumbnailTask {
    type Output = Vec<openrip_core::Thumbnail>;
    type JsValue = Vec<Thumbnail>;

    fn compute(&mut self) -> Result<Self::Output> {
        thumbnails_service().thumbnails(Path::new(&self.path), &self.times, self.height, self.exact).map_err(err)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<Vec<Thumbnail>> {
        Ok(out.into_iter().map(|t| Thumbnail { index: t.index, time_us: t.time.0, exact: t.exact, width: t.image.width, height: t.image.height, rgba: Buffer::from(t.image.data) }).collect())
    }
}

/// Thumbnails `height` px tall of the video or still at `path`, at source times `timesUs`,
/// on a worker thread. Quick (`exact` false) returns each GOP's keyframe for every time in
/// it, a few decodes per strip; then ask with `exact` true for the frames themselves.
/// Exact thumbnails are kept in the cache folder, and either kind of request returns them
/// from there.
#[napi]
pub fn thumbnails(path: String, times_us: Vec<i64>, height: u32, exact: bool) -> AsyncTask<ThumbnailTask> {
    AsyncTask::new(ThumbnailTask { path, times: times_us.into_iter().map(Micros).collect(), height, exact })
}

#[napi(object)]
pub struct Waveform {
    /// Buckets per second.
    pub per_second: u32,
    /// Per bucket, of the mono mix: the largest absolute sample, and the RMS (0..1).
    pub peak: Float32Array,
    pub rms: Float32Array,
}

pub struct WaveformTask {
    path: String,
    per_second: u32,
}

impl Task for WaveformTask {
    type Output = Option<openrip_core::Waveform>;
    type JsValue = Option<Waveform>;

    fn compute(&mut self) -> Result<Self::Output> {
        thumbnails_service().waveform(Path::new(&self.path), self.per_second).map_err(err)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<Option<Waveform>> {
        Ok(out.map(|p| Waveform { per_second: p.per_second, peak: Float32Array::new(p.peak), rms: Float32Array::new(p.rms) }))
    }
}

/// The waveform of `path`'s audio at `perSecond` buckets a second (must divide 48,000; 100
/// is one per 10 ms), on a worker thread; `null` if it has no audio. Kept in the thumbnail
/// cache folder, so each file is decoded once.
#[napi]
pub fn waveform(path: String, per_second: u32) -> AsyncTask<WaveformTask> {
    AsyncTask::new(WaveformTask { path, per_second })
}

// ---- export -------------------------------------------------------------------

/// The running export's progress, and a request to stop it.
static EXPORT: ExportControl = ExportControl::new();

#[napi(object)]
pub struct ExportOptions {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// "h264", "hevc", "hevc-alpha" or "prores-lt" / "prores-422" / "prores-hq" / "prores-4444" (see `exportCodecs`); the ProRes ones and HEVC with alpha want a .mov.
    pub codec: String,
    /// Bits per second.
    pub bitrate: f64,
    /// Hold the bit rate to the one asked (the dialog's custom bit rate).
    pub exact_bitrate: Option<bool>,
    pub audio: bool,
}

#[napi(object)]
pub struct ExportResult {
    pub frames: f64,
    pub seconds: f64,
    /// Layers skipped because their media or font was missing, summed over frames.
    pub skipped_layers: f64,
    /// What wrote the video ("videotoolbox", "openh264", "prores_ks", ...; "" for sound or a GIF).
    pub encoder: String,
}

#[napi(object)]
pub struct ExportProgress {
    pub done: f64,
    pub total: f64,
}

pub struct ExportTask {
    json: String,
    path: String,
    options: openrip_core::ExportOptions,
}

impl Task for ExportTask {
    type Output = openrip_core::ExportResult;
    type JsValue = ExportResult;

    fn compute(&mut self) -> Result<Self::Output> {
        openrip_core::export_project(&self.json, Path::new(&self.path), &self.options, &EXPORT).map_err(err)
    }

    fn resolve(&mut self, _env: Env, s: Self::Output) -> Result<ExportResult> {
        Ok(ExportResult { frames: s.frames as f64, seconds: s.seconds, skipped_layers: s.skipped_layers as f64, encoder: s.encoder.to_string() })
    }
}

/// Export a project (same JSON formats as `openProjectJson`) to an MP4/MOV file on a worker
/// thread, independent of the open preview. Rejects with "cancelled" after `cancelExport()`.
#[napi]
pub fn export_project(json: String, path: String, options: ExportOptions) -> AsyncTask<ExportTask> {
    let o = options;
    let options = openrip_core::ExportOptions { width: o.width, height: o.height, fps: o.fps, codec: openrip_core::codec_named(&o.codec), bitrate: o.bitrate, exact_bitrate: o.exact_bitrate.unwrap_or(false), audio: o.audio };
    AsyncTask::new(ExportTask { json, path, options })
}

/// What a sound-only or GIF export does.
pub enum SideExport {
    Audio { format: String },
    Gif { short_side: u32, fps: f64 },
}

pub struct SideExportTask {
    json: String,
    path: String,
    what: SideExport,
}

impl Task for SideExportTask {
    type Output = openrip_core::ExportResult;
    type JsValue = ExportResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let path = Path::new(&self.path);
        match &self.what {
            SideExport::Audio { format } => openrip_core::export_audio(&self.json, path, format, &EXPORT),
            SideExport::Gif { short_side, fps } => openrip_core::export_gif(&self.json, path, *short_side, *fps, &EXPORT),
        }
        .map_err(err)
    }

    fn resolve(&mut self, _env: Env, s: Self::Output) -> Result<ExportResult> {
        Ok(ExportResult { frames: s.frames as f64, seconds: s.seconds, skipped_layers: s.skipped_layers as f64, encoder: s.encoder.to_string() })
    }
}

/// Export only the project's sound to `path`: `format` is "wav", "flac", "mp3" or "aac" (an
/// M4A). Progress and `cancelExport()` work as for `exportProject` (the progress is seconds).
#[napi]
pub fn export_audio(json: String, path: String, format: String) -> AsyncTask<SideExportTask> {
    AsyncTask::new(SideExportTask { json, path, what: SideExport::Audio { format } })
}

/// Export the project as a looping GIF, `shortSide` pixels on its shorter side, `fps` frames a
/// second. Progress and `cancelExport()` work as for `exportProject`.
#[napi]
pub fn export_gif(json: String, path: String, short_side: u32, fps: f64) -> AsyncTask<SideExportTask> {
    AsyncTask::new(SideExportTask { json, path, what: SideExport::Gif { short_side, fps } })
}

/// The running (or last) export's progress, in frames.
#[napi]
pub fn export_progress() -> ExportProgress {
    let p = EXPORT.progress();
    ExportProgress { done: p.done as f64, total: p.total as f64 }
}

/// Stop the running export; its promise rejects and the unfinished file is removed.
#[napi]
pub fn cancel_export() {
    EXPORT.cancel();
}

/// The video codecs exports can be written in on this machine with the hardware setting as it
/// is, by the names `exportProject`'s `codec` takes ("h264", "hevc", "hevc-alpha", "prores-lt",
/// "prores-422", "prores-hq", "prores-4444"). H.264 counts where OpenH264 can be downloaded.
#[napi]
pub fn export_codecs() -> Vec<String> {
    openrip_core::available_codecs().into_iter().map(String::from).collect()
}

/// Settings' "Hardware encoding": the GPU's encoders where the machine has them (true, the
/// default), or software only. Exports started from then on follow it.
#[napi]
pub fn set_hardware_encoding(on: bool) {
    openrip_core::set_hardware_encoding(on);
}

#[napi]
pub fn hardware_encoding() -> bool {
    openrip_core::hardware_encoding()
}

/// One of this machine's encoders writing one codec.
#[napi(object)]
pub struct EncoderInfo {
    /// "videotoolbox", "mediafoundation", "mediafoundation-software", "openh264" or "prores_ks".
    pub backend: String,
    pub codec: String,
    pub hardware: bool,
    /// The largest picture, longer side x shorter side.
    pub max_long: u32,
    pub max_short: u32,
    pub ten_bit: bool,
    pub alpha: bool,
    /// OpenH264 not downloaded yet.
    pub needs_download: bool,
}

pub struct EncodersTask;

impl Task for EncodersTask {
    type Output = Vec<openrip_core::EncoderInfo>;
    type JsValue = Vec<EncoderInfo>;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(openrip_core::encoders())
    }

    fn resolve(&mut self, _env: Env, found: Self::Output) -> Result<Vec<EncoderInfo>> {
        Ok(found
            .into_iter()
            .map(|e| EncoderInfo { backend: e.backend.name().into(), codec: e.codec.name().into(), hardware: e.hardware, max_long: e.max_size.0, max_short: e.max_size.1, ten_bit: e.ten_bit, alpha: e.alpha, needs_download: e.needs_download })
            .collect())
    }
}

/// Try each of this machine's encoders with a tiny picture (on a worker thread; once a run,
/// so the app does it at startup) and say what each can write, whatever the hardware setting.
#[napi]
pub fn export_encoders() -> AsyncTask<EncodersTask> {
    AsyncTask::new(EncodersTask)
}

/// Where downloaded codecs are kept (Cisco's OpenH264), in the app's user data.
#[napi]
pub fn set_codec_dir(dir: String) {
    openrip_core::openh264::set_codec_dir(Path::new(&dir));
}

/// Use Cisco's OpenH264 for H.264 in software (true, the default) or not (Settings).
#[napi]
pub fn set_openh264_enabled(on: bool) {
    openrip_core::openh264::set_enabled(on);
}

/// Where Cisco's OpenH264 stands here, and what to download for it.
#[napi(object)]
pub struct OpenH264Info {
    /// Cisco makes a binary for this platform.
    pub supported: bool,
    pub enabled: bool,
    /// Downloaded, checked and loaded.
    pub installed: bool,
    pub version: String,
    /// The binary on Cisco's server (a .bz2), and its SHA-256.
    pub url: Option<String>,
    pub sha256: Option<String>,
    /// Why the file in the codec folder wasn't used.
    pub error: Option<String>,
    /// "OpenH264 Video Codec provided by Cisco Systems, Inc.", to show where it's turned on and off.
    pub attribution: String,
}

#[napi]
pub fn openh264_info() -> OpenH264Info {
    let s = openrip_core::openh264::status();
    OpenH264Info { supported: s.supported, enabled: s.enabled, installed: s.installed, version: s.version.into(), url: s.url, sha256: s.bz2_sha256.map(String::from), error: s.error, attribution: openrip_core::openh264::ATTRIBUTION.into() }
}

pub struct InstallTask(Vec<u8>);

impl Task for InstallTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<()> {
        openrip_core::openh264::install(&self.0).map_err(err)
    }

    fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
        Ok(())
    }
}

/// Keep a download of Cisco's binary (the .bz2 from `openh264Info().url`) in the codec folder:
/// its SHA-256 and the library's are checked against the pinned ones, then it is loaded.
/// Rejects, keeping nothing, when they don't match.
#[napi]
pub fn install_openh264(data: Buffer) -> AsyncTask<InstallTask> {
    AsyncTask::new(InstallTask(data.to_vec()))
}

// ---- motion tracking -------------------------------------------------------------

/// The running track's progress, and a request to stop it.
static TRACK: openrip_core::TrackControl = openrip_core::TrackControl::new();

#[napi(object)]
pub struct TrackRequest {
    pub path: String,
    /// Source time (µs) of the frame the region was drawn on, and the source range to track.
    pub at_us: f64,
    pub from_us: f64,
    pub to_us: f64,
    /// The region on the upright picture: centre and size in fractions of it, degrees
    /// clockwise.
    pub center_x: f64,
    pub center_y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    /// "forward", "backward" or "both".
    pub direction: String,
}

#[napi(object)]
pub struct TrackSample {
    pub time_us: f64,
    pub center_x: f64,
    pub center_y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    pub scale: f64,
    pub confidence: f64,
}

#[napi(object)]
pub struct TrackResult {
    pub samples: Vec<TrackSample>,
    pub lost_forward_us: Option<f64>,
    pub lost_backward_us: Option<f64>,
}

pub struct TrackTask {
    request: openrip_core::TrackRequest,
}

impl Task for TrackTask {
    type Output = openrip_core::TrackResult;
    type JsValue = TrackResult;

    fn compute(&mut self) -> Result<Self::Output> {
        openrip_core::track_region(&self.request, &TRACK).map_err(err)
    }

    fn resolve(&mut self, _env: Env, r: Self::Output) -> Result<TrackResult> {
        Ok(TrackResult {
            samples: r
                .samples
                .iter()
                .map(|s| TrackSample { time_us: s.time.0 as f64, center_x: s.center[0], center_y: s.center[1], width: s.size[0], height: s.size[1], rotation: s.rotation, scale: s.scale, confidence: s.confidence })
                .collect(),
            lost_forward_us: r.lost_forward.map(|t| t.0 as f64),
            lost_backward_us: r.lost_backward.map(|t| t.0 as f64),
        })
    }
}

/// Follow a region of a video through its frames on a worker thread (motion tracking).
/// Rejects with "cancelled" after `cancelTrack()`.
#[napi]
pub fn track_region(request: TrackRequest) -> AsyncTask<TrackTask> {
    let r = request;
    let request = openrip_core::TrackRequest {
        path: r.path,
        at: Micros(r.at_us.round() as i64),
        from: Micros(r.from_us.round() as i64),
        to: Micros(r.to_us.round() as i64),
        center: [r.center_x, r.center_y],
        size: [r.width, r.height],
        rotation: r.rotation,
        direction: openrip_core::TrackDirection::named(&r.direction),
    };
    AsyncTask::new(TrackTask { request })
}

/// The running (or last) track's progress, in frames.
#[napi]
pub fn track_progress() -> ExportProgress {
    let (done, total) = TRACK.progress();
    ExportProgress { done: done as f64, total: total as f64 }
}

/// Stop the running track; its promise rejects with "cancelled".
#[napi]
pub fn cancel_track() {
    TRACK.cancel();
}

// CapCut drafts as app projects.

#[napi(object)]
pub struct AppProjectFromDraft {
    /// The app's project document (JSON), without the app's own `meta`.
    pub json: String,
    /// The draft's name.
    pub name: String,
    /// Media the draft uses that isn't on this Mac.
    pub missing_media: Vec<String>,
    /// What the importer couldn't map, one line each.
    pub notes: Vec<String>,
}

pub struct DraftTask {
    dir: String,
}

impl Task for DraftTask {
    type Output = openrip_core::AppProjectFromDraft;
    type JsValue = AppProjectFromDraft;

    fn compute(&mut self) -> Result<Self::Output> {
        openrip_core::capcut_to_app(Path::new(&self.dir)).map_err(err)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<AppProjectFromDraft> {
        Ok(AppProjectFromDraft { json: out.json, name: out.name, missing_media: out.missing_media, notes: out.notes })
    }
}

/// The CapCut draft in folder `dir` as an app project, on a worker thread: the app's own
/// clips, each carrying its segment so the engine draws it as CapCut did.
#[napi]
pub fn capcut_to_app(dir: String) -> AsyncTask<DraftTask> {
    AsyncTask::new(DraftTask { dir })
}

// ---- the Audio tab: beats, loudness, voiceover -------------------------------

#[napi(object)]
pub struct BeatGrid {
    /// Beats per minute.
    pub bpm: f64,
    /// Each beat's time in the file's media, in seconds.
    pub times: Float64Array,
    /// 1 where the beat starts a bar (in fours), else 0.
    pub downbeats: Uint8Array,
}

pub struct BeatsTask {
    path: String,
}

impl Task for BeatsTask {
    type Output = Option<openrip_core::Beats>;
    type JsValue = Option<BeatGrid>;

    fn compute(&mut self) -> Result<Self::Output> {
        thumbnails_service().beats(Path::new(&self.path)).map_err(err)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<Option<BeatGrid>> {
        Ok(out.map(|g| BeatGrid {
            bpm: g.bpm as f64,
            times: Float64Array::new(g.beats.iter().map(|b| b.at.as_secs_f64()).collect()),
            downbeats: Uint8Array::new(g.beats.iter().map(|b| b.downbeat as u8).collect()),
        }))
    }
}

/// The beats in the audio of the file at `path` (all of it), on a worker thread, for the
/// timeline's automatic beat markers; `null` if it has no audio. Kept in the thumbnail cache
/// folder, so each file is listened to once.
#[napi]
pub fn beats(path: String) -> AsyncTask<BeatsTask> {
    AsyncTask::new(BeatsTask { path })
}

#[napi(object)]
pub struct Loudness {
    /// EBU R128 integrated loudness, LUFS; `null` for silence.
    pub integrated: Option<f64>,
    /// The largest sample, dBFS.
    pub peak: f64,
}

pub struct LoudnessTask {
    path: String,
    start: Micros,
    duration: Option<Micros>,
}

impl Task for LoudnessTask {
    type Output = Option<openrip_core::Loudness>;
    type JsValue = Option<Loudness>;

    fn compute(&mut self) -> Result<Self::Output> {
        openrip_core::measure_loudness(Path::new(&self.path), self.start, self.duration).map_err(err)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<Option<Loudness>> {
        Ok(out.map(|l| Loudness { integrated: l.integrated.map(|v| v as f64), peak: l.peak as f64 }))
    }
}

/// The loudness of the file at `path` over `durationUs` from `startUs` of its media (all of it
/// for `null`), as CapCut measures it for "Normalize loudness", on a worker thread; `null` if
/// it has no audio.
#[napi]
pub fn loudness(path: String, start_us: i64, duration_us: Option<i64>) -> AsyncTask<LoudnessTask> {
    AsyncTask::new(LoudnessTask { path, start: Micros(start_us), duration: duration_us.map(Micros) })
}

fn recorder() -> &'static Mutex<Option<openrip_core::Recorder>> {
    static R: OnceLock<Mutex<Option<openrip_core::Recorder>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(None))
}

#[napi(object)]
pub struct RecordingStarted {
    pub rate: u32,
    pub channels: u32,
}

/// Start recording a voiceover from the default microphone into a new WAV file at `path`
/// (one at a time: a recording already running is stopped first and kept). On macOS the
/// system asks for the microphone the first time; the main process asks first.
#[napi]
pub fn start_recording(path: String) -> Result<RecordingStarted> {
    let mut slot = recorder().lock().unwrap();
    if let Some(running) = slot.take() {
        let _ = running.stop();
    }
    let r = openrip_core::Recorder::start(Path::new(&path)).map_err(err)?;
    let started = RecordingStarted { rate: r.rate(), channels: r.channels() as u32 };
    *slot = Some(r);
    Ok(started)
}

#[napi(object)]
pub struct RecordingLevel {
    /// The largest sample and the RMS since the last call, 0..1.
    pub peak: f64,
    pub rms: f64,
}

/// The recording's level since the last call, for a meter; `null` when not recording.
#[napi]
pub fn recording_level() -> Option<RecordingLevel> {
    recorder().lock().unwrap().as_ref().map(|r| {
        let l = r.level();
        RecordingLevel { peak: l.peak as f64, rms: l.rms as f64 }
    })
}

#[napi(object)]
pub struct Recording {
    pub path: String,
    pub duration_us: i64,
    pub rate: u32,
    pub channels: u32,
}

/// Stop recording and finish the file; `null` when not recording.
#[napi]
pub fn stop_recording() -> Result<Option<Recording>> {
    let Some(r) = recorder().lock().unwrap().take() else { return Ok(None) };
    let done = r.stop().map_err(err)?;
    Ok(Some(Recording { path: done.path.to_string_lossy().into_owned(), duration_us: done.duration_us(), rate: done.rate, channels: done.channels as u32 }))
}

/// For automated tests: record from a stand-in microphone that hears a steady tone
/// (`openrip_core::ToneInput`) instead of the real one, so nothing real is recorded.
#[napi]
pub fn use_tone_input() {
    openrip_core::set_audio_input(std::sync::Arc::new(openrip_core::ToneInput));
}

// Fonts for text.

/// A font face for text, as CSS describes it (`@font-face`).
#[napi(object)]
pub struct FontFace {
    pub family: String,
    /// CSS weight (400 regular, 700 bold).
    pub weight: u32,
    pub italic: bool,
    /// The font file (TrueType, OpenType or WOFF2).
    pub path: String,
    /// Its CSS `unicode-range`, for a web font split into one file per script.
    pub unicode_range: Option<String>,
}

/// Draw the app's text in these faces from now on (the app's bundled web fonts), each read
/// when text first uses it.
#[napi]
pub fn register_fonts(faces: Vec<FontFace>) {
    openrip_core::register_fonts(faces.iter().map(|f| openrip_core::font_face(&f.family, f.weight.min(1000) as u16, f.italic, &f.path, f.unicode_range.as_deref())).collect());
}

/// A family text can be drawn in.
#[napi(object)]
pub struct FontFamily {
    pub name: String,
    /// The weights it has faces for, ascending.
    pub weights: Vec<u32>,
    pub italic: bool,
    /// Registered by the app (its bundled fonts) rather than installed on the system.
    pub bundled: bool,
}

/// The families text can be drawn in: the app's registered ones, then the installed ones.
#[napi]
pub fn font_families() -> Vec<FontFamily> {
    openrip_core::font_families()
        .into_iter()
        .map(|f| FontFamily { name: f.name, weights: f.weights.into_iter().map(u32::from).collect(), italic: f.italic, bundled: f.registered })
        .collect()
}

// ---- analysis: Split scenes, Auto adjust, Color match ---------------------------

type Control = std::sync::Arc<openrip_core::AnalysisControl>;

/// Running analyses by the job number the app gave each, for their progress and cancel.
fn analyses() -> &'static Mutex<std::collections::HashMap<u32, Control>> {
    static A: OnceLock<Mutex<std::collections::HashMap<u32, Control>>> = OnceLock::new();
    A.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn start_job(job: u32) -> Control {
    let control = std::sync::Arc::new(openrip_core::AnalysisControl::new());
    analyses().lock().unwrap().insert(job, control.clone());
    control
}

fn end_job(job: u32, control: &Control) {
    let mut jobs = analyses().lock().unwrap();
    if jobs.get(&job).is_some_and(|c| std::sync::Arc::ptr_eq(c, control)) {
        jobs.remove(&job);
    }
}

#[napi(object)]
pub struct AnalysisProgress {
    pub done: f64,
    pub total: f64,
}

/// A running analysis's progress in frames; `null` when job `job` isn't running.
#[napi]
pub fn analysis_progress(job: u32) -> Option<AnalysisProgress> {
    analyses().lock().unwrap().get(&job).map(|c| {
        let (done, total) = c.progress();
        AnalysisProgress { done: done as f64, total: total as f64 }
    })
}

/// Stop analysis `job`: its promise rejects with "cancelled".
#[napi]
pub fn cancel_analysis(job: u32) {
    if let Some(c) = analyses().lock().unwrap().get(&job) {
        c.cancel();
    }
}

#[napi(object)]
pub struct SceneCut {
    /// The media time of the new shot's first frame.
    pub time_us: i64,
    /// "hard", "dissolve" or "fade".
    pub kind: String,
    /// The transition's first and last frames (both `timeUs` for a hard cut).
    pub start_us: i64,
    pub end_us: i64,
    pub score: f64,
}

pub struct ScenesTask {
    job: u32,
    control: Control,
    path: String,
    start: Micros,
    duration: Option<Micros>,
    options: openrip_core::SceneOptions,
}

impl Task for ScenesTask {
    type Output = Vec<openrip_core::SceneCut>;
    type JsValue = Vec<SceneCut>;

    fn compute(&mut self) -> Result<Self::Output> {
        openrip_core::detect_scenes(Path::new(&self.path), self.start, self.duration, self.options, &self.control).map_err(err)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<Vec<SceneCut>> {
        let kind = |k: openrip_core::CutKind| match k {
            openrip_core::CutKind::Hard => "hard",
            openrip_core::CutKind::Dissolve => "dissolve",
            openrip_core::CutKind::Fade => "fade",
        };
        Ok(out.into_iter().map(|c| SceneCut { time_us: c.time, kind: kind(c.kind).into(), start_us: c.start, end_us: c.end, score: c.score as f64 }).collect())
    }

    fn finally(self, _env: Env) -> Result<()> {
        end_job(self.job, &self.control);
        Ok(())
    }
}

/// The shot changes in the video at `path` over `durationUs` from `startUs` of its media (to
/// its end for `null`), on a worker thread (Split scenes). `sensitivity` 0–1 (0.5 when
/// `null`). Progress and cancel by `job`, a number the caller picks.
#[napi]
pub fn detect_scenes(job: u32, path: String, start_us: i64, duration_us: Option<i64>, sensitivity: Option<f64>) -> AsyncTask<ScenesTask> {
    let control = start_job(job);
    let mut options = openrip_core::SceneOptions::default();
    if let Some(s) = sensitivity {
        options.sensitivity = s.clamp(0.0, 1.0) as f32;
    }
    AsyncTask::new(ScenesTask { job, control, path, start: Micros(start_us), duration: duration_us.map(Micros), options })
}

pub struct MotionTask {
    job: u32,
    control: Control,
    path: String,
    start: Micros,
    duration: Option<Micros>,
}

impl Task for MotionTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        openrip_core::analyse_motion(Path::new(&self.path), self.start, self.duration, &self.control).map_err(err)
    }

    fn resolve(&mut self, _env: Env, _out: Self::Output) -> Result<()> {
        Ok(())
    }

    fn finally(self, _env: Env) -> Result<()> {
        end_job(self.job, &self.control);
        Ok(())
    }
}

/// Track the camera and the frames' brightness in the video at `path` over `durationUs` from
/// `startUs` of its media (to its end for `null`), on a worker thread, for Stabilize and
/// Remove flickers. The engine keeps the result for every preview and export; a range already
/// tracked returns at once. Progress and cancel by `job`.
#[napi]
pub fn analyse_motion(job: u32, path: String, start_us: i64, duration_us: Option<i64>) -> AsyncTask<MotionTask> {
    let control = start_job(job);
    AsyncTask::new(MotionTask { job, control, path, start: Micros(start_us), duration: duration_us.map(Micros) })
}

/// Whether the video at `path` has been tracked over `durationUs` from `startUs` (see
/// `analyseMotion`), in this run or an earlier one.
#[napi]
pub fn motion_ready(path: String, start_us: i64, duration_us: Option<i64>) -> bool {
    openrip_core::motion_ready(Path::new(&path), Micros(start_us), duration_us.map(Micros))
}

#[napi(object)]
pub struct ColorStats {
    /// Oklab means and standard deviations (L, a, b).
    pub mean: Vec<f64>,
    pub std: Vec<f64>,
    /// BT.709 luma: mean, standard deviation, and the 0.5th, 5th, 50th, 95th and 99.5th
    /// percentiles.
    pub luma_mean: f64,
    pub luma_std: f64,
    pub luma_percentiles: Vec<f64>,
    /// Mean Oklab chroma.
    pub chroma: f64,
    /// The near-neutral pixels' cast (a, b), or `null`.
    pub neutral: Option<Vec<f64>>,
    pub pixels: u32,
}

impl From<&openrip_core::ColorStats> for ColorStats {
    fn from(s: &openrip_core::ColorStats) -> Self {
        let v = |a: &[f32]| a.iter().map(|&x| x as f64).collect::<Vec<f64>>();
        ColorStats {
            mean: v(&s.lab.mean),
            std: v(&s.lab.std),
            luma_mean: s.luma_mean as f64,
            luma_std: s.luma_std as f64,
            luma_percentiles: v(&s.luma_percentiles),
            chroma: s.chroma as f64,
            neutral: s.neutral.map(|n| v(&n)),
            pixels: s.pixels as u32,
        }
    }
}

pub struct ColorStatsTask {
    job: u32,
    control: Control,
    path: String,
    start: Micros,
    duration: Option<Micros>,
    look: Option<openrip_core::Look>,
}

impl Task for ColorStatsTask {
    type Output = openrip_core::ColorStats;
    type JsValue = ColorStats;

    fn compute(&mut self) -> Result<Self::Output> {
        openrip_core::color_stats(Path::new(&self.path), self.start, self.duration, self.look.as_ref(), &self.control).map_err(err)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<ColorStats> {
        Ok((&out).into())
    }

    fn finally(self, _env: Env) -> Result<()> {
        end_job(self.job, &self.control);
        Ok(())
    }
}

/// A clip's look on top of its media, for its statistics: its Color match, then its Basic
/// sliders on the panel's scale (−50…50; those the statistics can follow).
#[napi(object)]
pub struct Look {
    pub matched: Option<MatchOn>,
    pub brightness: Option<f64>,
    pub contrast: Option<f64>,
    pub saturation: Option<f64>,
    pub highlights: Option<f64>,
    pub shadows: Option<f64>,
    pub whites: Option<f64>,
    pub blacks: Option<f64>,
    pub temperature: Option<f64>,
    pub tint: Option<f64>,
}

fn match_on(m: MatchOn) -> openrip_core::MatchOn {
    openrip_core::MatchOn {
        source: openrip_core::Moments { mean: three(&m.source_mean), std: three(&m.source_std) },
        reference: openrip_core::Moments { mean: three(&m.reference_mean), std: three(&m.reference_std) },
        intensity: m.intensity.clamp(0.0, 1.0) as f32,
    }
}

/// The colour statistics of the video or photo at `path` over `durationUs` from `startUs`
/// of its media (to its end for `null`), from frames spread across it, through `look` when
/// given (a reference clip as it looks), on a worker thread (Color match). Progress and
/// cancel by `job`.
#[napi]
pub fn color_stats(job: u32, path: String, start_us: i64, duration_us: Option<i64>, look: Option<Look>) -> AsyncTask<ColorStatsTask> {
    let control = start_job(job);
    let look = look.map(|l| {
        let s = |v: Option<f64>| (v.unwrap_or(0.0) / 50.0).clamp(-1.0, 1.0) as f32;
        openrip_core::Look {
            matched: l.matched.map(match_on),
            sliders: openrip_core::Adjust {
                brightness: s(l.brightness),
                contrast: s(l.contrast),
                saturation: s(l.saturation),
                highlights: s(l.highlights),
                shadows: s(l.shadows),
                whites: s(l.whites),
                blacks: s(l.blacks),
                temperature: s(l.temperature),
                tint: s(l.tint),
                ..Default::default()
            },
        }
    });
    AsyncTask::new(ColorStatsTask { job, control, path, start: Micros(start_us), duration: duration_us.map(Micros), look })
}

/// A Color match already on a clip, for Auto adjust to see through.
#[napi(object)]
pub struct MatchOn {
    pub source_mean: Vec<f64>,
    pub source_std: Vec<f64>,
    pub reference_mean: Vec<f64>,
    pub reference_std: Vec<f64>,
    /// 0–1.
    pub intensity: f64,
}

#[napi(object)]
pub struct AutoAdjustValues {
    /// The Basic sliders on the panel's scale (−50…50).
    pub brightness: i32,
    pub contrast: i32,
    pub saturation: i32,
    pub temperature: i32,
    pub tint: i32,
    pub whites: i32,
    pub blacks: i32,
    pub stats: ColorStats,
}

pub struct AutoAdjustTask {
    job: u32,
    control: Control,
    path: String,
    start: Micros,
    duration: Option<Micros>,
    matched: Option<openrip_core::MatchOn>,
}

impl Task for AutoAdjustTask {
    type Output = openrip_core::AutoAdjust;
    type JsValue = AutoAdjustValues;

    fn compute(&mut self) -> Result<Self::Output> {
        openrip_core::auto_adjust(Path::new(&self.path), self.start, self.duration, self.matched, &self.control).map_err(err)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<AutoAdjustValues> {
        let p = |v: f32| (v * 50.0).round() as i32;
        let s = out.sliders;
        Ok(AutoAdjustValues {
            brightness: p(s.brightness),
            contrast: p(s.contrast),
            saturation: p(s.saturation),
            temperature: p(s.temperature),
            tint: p(s.tint),
            whites: p(s.whites),
            blacks: p(s.blacks),
            stats: (&out.stats).into(),
        })
    }

    fn finally(self, _env: Env) -> Result<()> {
        end_job(self.job, &self.control);
        Ok(())
    }
}

fn three(v: &[f64]) -> [f32; 3] {
    [0, 1, 2].map(|i| v.get(i).copied().unwrap_or(0.0) as f32)
}

/// Auto adjust's Basic sliders for the video or photo at `path` over `durationUs` from
/// `startUs` of its media, from its own statistics, on a worker thread; through the clip's
/// Color match (`matched`) when it has one. Progress and cancel by `job`.
#[napi]
pub fn auto_adjust(job: u32, path: String, start_us: i64, duration_us: Option<i64>, matched: Option<MatchOn>) -> AsyncTask<AutoAdjustTask> {
    let control = start_job(job);
    let matched = matched.map(match_on);
    AsyncTask::new(AutoAdjustTask { job, control, path, start: Micros(start_us), duration: duration_us.map(Micros), matched })
}

// ---- Video effects ----

/// OpenRip's own video effects as JSON: `{ categories, effects: [{ id, name, category,
/// intensity, params: [{ id, name, default }] }] }`, values 0–100.
#[napi]
pub fn effect_catalog() -> String {
    openrip_core::effect_catalog().to_string()
}

/// A code that changes when the engine's drawing of the transition or effect `id` does (its
/// shaders and, for an effect, its catalog entry): what a client keeps pictures of them by.
#[napi]
pub fn preview_revision(id: String, effect: bool) -> String {
    openrip_core::preview_revision(&id, effect)
}

fn effect_previews_service() -> &'static openrip_core::EffectPreviews {
    static P: openrip_core::EffectPreviews = openrip_core::EffectPreviews::new();
    &P
}

pub struct EffectPreviewTask {
    id: String,
    intensity: Option<f64>,
    params: Vec<f64>,
    times: Vec<f64>,
    duration: f64,
    width: u32,
    height: u32,
}

impl Task for EffectPreviewTask {
    type Output = Vec<(u32, u32, Vec<u8>)>;
    type JsValue = Vec<Image>;

    fn compute(&mut self) -> Result<Self::Output> {
        let frames = effect_previews_service().frames(&self.id, self.intensity, &self.params, &self.times, self.duration, self.width, self.height).map_err(err)?;
        Ok(frames.into_iter().map(|i| (i.width, i.height, i.data)).collect())
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<Vec<Image>> {
        Ok(out.into_iter().map(|(width, height, data)| Image { width, height, data: Buffer::from(data) }).collect())
    }
}

/// Frames of effect `id` on a sample picture, `width` x `height`, at `times` seconds into an
/// effect `duration` seconds long, drawn by the engine's renderer (so they match the player
/// and an export). `intensity` and `params` are 0-1; the catalog's defaults where missing.
#[napi]
pub fn effect_previews(id: String, intensity: Option<f64>, params: Vec<f64>, times: Vec<f64>, duration: f64, width: u32, height: u32) -> AsyncTask<EffectPreviewTask> {
    AsyncTask::new(EffectPreviewTask { id, intensity, params, times, duration, width, height })
}

// ---- Previews of small projects ----

fn project_previews_service() -> &'static openrip_core::ProjectPreviews {
    static P: openrip_core::ProjectPreviews = openrip_core::ProjectPreviews::new();
    &P
}

pub struct ProjectPreviewTask {
    json: String,
    times: Vec<f64>,
    width: u32,
    height: u32,
    crop: Option<[f64; 4]>,
}

impl Task for ProjectPreviewTask {
    type Output = Vec<(u32, u32, Vec<u8>)>;
    type JsValue = Vec<Image>;

    fn compute(&mut self) -> Result<Self::Output> {
        let frames = project_previews_service().frames(&self.json, &self.times, self.width, self.height, self.crop).map_err(err)?;
        Ok(frames.into_iter().map(|i| (i.width, i.height, i.data)).collect())
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<Vec<Image>> {
        Ok(out.into_iter().map(|(width, height, data)| Image { width, height, data: Buffer::from(data) }).collect())
    }
}

/// Frames of the project in `json` (the formats `openProjectJson` reads) at `times` seconds,
/// each drawn `width` x `height` by the engine's renderer (so they match the player and an
/// export) and cropped to `crop` (`[x, y, width, height]`, fractions of the frame) when given.
/// Independent of the open project.
#[napi]
pub fn project_previews(json: String, times: Vec<f64>, width: u32, height: u32, crop: Option<Vec<f64>>) -> Result<AsyncTask<ProjectPreviewTask>> {
    let crop = match crop {
        Some(c) if c.len() == 4 => Some([c[0], c[1], c[2], c[3]]),
        Some(_) => return Err(Error::from_reason("crop is [x, y, width, height]")),
        None => None,
    };
    Ok(AsyncTask::new(ProjectPreviewTask { json, times, width, height, crop }))
}

// ---- auto captions: local speech recognition ---------------------------------------

#[napi(object)]
pub struct SpeechModel {
    pub id: String,
    pub label: String,
    /// The file name on disk and on Hugging Face.
    pub file: String,
    pub english_only: bool,
    /// Bytes.
    pub size: f64,
    pub sha256: String,
    pub note: String,
    /// Where the file is downloaded from.
    pub url: String,
}

/// The Whisper models on offer, smallest first.
#[napi]
pub fn speech_models() -> Vec<SpeechModel> {
    openrip_core::MODELS
        .iter()
        .map(|m| SpeechModel {
            id: m.id.into(),
            label: m.label.into(),
            file: m.file.into(),
            english_only: m.english_only,
            size: m.size as f64,
            sha256: m.sha256.into(),
            note: m.note.into(),
            url: openrip_core::models::url(m),
        })
        .collect()
}

/// The model the app starts with.
#[napi]
pub fn speech_default_model() -> String {
    openrip_core::DEFAULT_MODEL.into()
}

/// Whether this build recognizes speech (carries whisper.cpp).
#[napi]
pub fn speech_available() -> bool {
    openrip_core::HAS_WHISPER
}

type SpeechJob = std::sync::Arc<openrip_core::SpeechControl>;

fn speech_jobs() -> &'static Mutex<std::collections::HashMap<u32, SpeechJob>> {
    static A: OnceLock<Mutex<std::collections::HashMap<u32, SpeechJob>>> = OnceLock::new();
    A.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

/// A running recognition's progress, 0–100; `null` when job `job` isn't running.
#[napi]
pub fn speech_progress(job: u32) -> Option<f64> {
    speech_jobs().lock().unwrap().get(&job).map(|c| c.percent() as f64)
}

/// Stop recognition `job`: its promise rejects with "cancelled".
#[napi]
pub fn cancel_speech(job: u32) {
    if let Some(c) = speech_jobs().lock().unwrap().get(&job) {
        c.cancel();
    }
}

#[napi(object)]
pub struct SpeechRequest {
    /// The model file (from the models folder).
    pub model_path: String,
    /// ISO 639-1 code; `null` or "auto" to detect.
    pub language: Option<String>,
    /// A media file whose sound to recognize, over `durationUs` from `startUs` of its media.
    pub audio_path: Option<String>,
    /// Or the project (the app's JSON) whose mix to recognize, over `durationUs` from
    /// `startUs` of the timeline.
    pub project_json: Option<String>,
    pub start_us: i64,
    pub duration_us: Option<i64>,
    pub remove_fillers: bool,
    pub highlight_keywords: bool,
    /// Longest line in characters (32 when `null`).
    pub max_chars: Option<u32>,
    /// Lines per caption, 1 or 2 (1 when `null`).
    pub max_lines: Option<u32>,
}

#[napi(object)]
pub struct CaptionWordOut {
    /// Character range into the caption's text.
    pub range_start: u32,
    pub range_end: u32,
    /// Microseconds from the caption's start.
    pub start_us: f64,
    pub end_us: f64,
    pub keyword: bool,
}

#[napi(object)]
pub struct CaptionOut {
    /// Microseconds from the start of the range recognized.
    pub start_us: f64,
    pub end_us: f64,
    pub text: String,
    pub words: Vec<CaptionWordOut>,
}

#[napi(object)]
pub struct SpeechResult {
    /// The language heard or asked for.
    pub language: String,
    pub captions: Vec<CaptionOut>,
    /// How many words were heard (before the fillers came out).
    pub word_count: u32,
}

pub struct SpeechTask {
    job: u32,
    control: SpeechJob,
    request: SpeechRequest,
}

impl Task for SpeechTask {
    type Output = (openrip_core::Transcript, Vec<openrip_core::Caption>);
    type JsValue = SpeechResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let r = &self.request;
        let (start, duration) = (Micros(r.start_us), r.duration_us.map(Micros));
        let language = r.language.clone().filter(|l| !l.is_empty() && l != "auto");
        let transcript = if let Some(json) = &r.project_json {
            let (project, _) = openrip_core::parse_project_json(json).map_err(err)?;
            openrip_core::transcribe(openrip_core::SpeechInput::Timeline { project: &project, start, duration }, r.model_path.clone().into(), language, &self.control).map_err(err)?
        } else if let Some(path) = &r.audio_path {
            openrip_core::transcribe(openrip_core::SpeechInput::File { path: Path::new(path), start, duration }, r.model_path.clone().into(), language, &self.control).map_err(err)?
        } else {
            return Err(err("nothing to recognize: give audioPath or projectJson"));
        };
        let options = openrip_core::CaptionOptions {
            max_chars: r.max_chars.map_or(32, |n| n.max(8) as usize),
            max_lines: r.max_lines.map_or(1, |n| n.clamp(1, 2) as usize),
            remove_fillers: r.remove_fillers,
            highlight_keywords: r.highlight_keywords,
            ..Default::default()
        };
        let captions = openrip_core::build_captions(&transcript, &options);
        Ok((transcript, captions))
    }

    fn resolve(&mut self, _env: Env, (transcript, captions): Self::Output) -> Result<SpeechResult> {
        Ok(SpeechResult {
            language: transcript.language.clone(),
            word_count: transcript.words().count() as u32,
            captions: captions
                .into_iter()
                .map(|c| CaptionOut {
                    start_us: c.start_us as f64,
                    end_us: c.end_us as f64,
                    text: c.text,
                    words: c
                        .words
                        .into_iter()
                        .map(|w| CaptionWordOut { range_start: w.range.0, range_end: w.range.1, start_us: w.start_us as f64, end_us: w.end_us as f64, keyword: w.keyword })
                        .collect(),
                })
                .collect(),
        })
    }

    fn finally(self, _env: Env) -> Result<()> {
        let mut jobs = speech_jobs().lock().unwrap();
        if jobs.get(&self.job).is_some_and(|c| std::sync::Arc::ptr_eq(c, &self.control)) {
            jobs.remove(&self.job);
        }
        Ok(())
    }
}

/// Recognize speech with a local model and cut it into captions, on a worker thread. The
/// times are from the start of the range asked for. Progress and cancel by `job`, a number
/// the caller picks.
#[napi]
pub fn transcribe_speech(job: u32, request: SpeechRequest) -> AsyncTask<SpeechTask> {
    let control = std::sync::Arc::new(openrip_core::SpeechControl::new());
    speech_jobs().lock().unwrap().insert(job, control.clone());
    AsyncTask::new(SpeechTask { job, control, request })
}

// ---- pre-rendering (the Render menu) ---------------------------------------------

/// The running pre-render's progress (frames), and a request to stop it.
static PRERENDER: ExportControl = ExportControl::new();

/// Keep rendered chunks and their index under `dir` (the app's cache folder); the index an
/// earlier run left there is read, so chunks still valid are reused.
#[napi]
pub fn set_render_cache_dir(dir: String) {
    openrip_core::set_render_cache_dir(Path::new(&dir));
}

/// Whether this platform can pre-render (there is a video encoder, and a cache folder).
#[napi]
pub fn render_cache_available() -> bool {
    openrip_core::render_cache_available()
}

/// Show pre-rendered chunks in the preview (the default) or only composited frames.
#[napi]
pub fn set_render_cache_enabled(on: bool) {
    openrip_core::set_render_cache_enabled(on);
}

#[napi(object)]
pub struct PrerenderResult {
    /// Chunks rendered now, and chunks of the range already rendered.
    pub rendered: u32,
    pub reused: u32,
    pub frames: f64,
    pub seconds: f64,
}

pub struct PrerenderTask {
    project: openrip_core::Project,
    range: Option<(i64, i64)>,
}

impl Task for PrerenderTask {
    type Output = openrip_core::PrerenderResult;
    type JsValue = PrerenderResult;

    fn compute(&mut self) -> Result<Self::Output> {
        openrip_core::prerender_project(self.project.clone(), self.range, &PRERENDER).map_err(err)
    }

    fn resolve(&mut self, _env: Env, r: Self::Output) -> Result<PrerenderResult> {
        Ok(PrerenderResult { rendered: r.rendered, reused: r.reused, frames: r.frames as f64, seconds: r.seconds })
    }
}

/// Render the chunks of the open project that overlap `startUs`..`endUs` (the whole timeline
/// when both are omitted) and are not rendered yet, on a worker thread. Rejects with
/// "cancelled" after `cancelPrerender()`; the chunks finished stay.
#[napi]
pub fn prerender(start_us: Option<i64>, end_us: Option<i64>) -> Result<AsyncTask<PrerenderTask>> {
    let project = session().lock().unwrap().as_ref().map(|s| s.project().clone()).ok_or_else(|| err(openrip_core::Error::NoProject))?;
    let range = match (start_us, end_us) {
        (Some(a), Some(b)) => Some((a, b)),
        _ => None,
    };
    Ok(AsyncTask::new(PrerenderTask { project, range }))
}

#[napi]
pub fn prerender_progress() -> ExportProgress {
    let p = PRERENDER.progress();
    ExportProgress { done: p.done as f64, total: p.total as f64 }
}

#[napi]
pub fn cancel_prerender() {
    PRERENDER.cancel();
}

/// The time ranges of the open project that are rendered and still valid, flattened as
/// start, end, start, end, … (µs).
#[napi]
pub fn rendered_ranges() -> Result<Vec<f64>> {
    let guard = session().lock().unwrap();
    let project = guard.as_ref().ok_or_else(|| err(openrip_core::Error::NoProject))?.project();
    Ok(openrip_core::rendered_ranges(project).into_iter().flat_map(|(a, b)| [a as f64, b as f64]).collect())
}

/// Delete every rendered chunk.
#[napi]
pub fn clear_render_cache() {
    openrip_core::clear_render_cache();
}

/// Bytes the rendered chunks take.
#[napi]
pub fn render_cache_bytes() -> f64 {
    openrip_core::render_cache_bytes() as f64
}

#[napi(object)]
pub struct CachedImage {
    pub width: u32,
    pub height: u32,
    /// Straight-alpha RGBA bytes.
    pub data: Buffer,
    /// The frame came from a rendered chunk (else it was composited).
    pub cached: bool,
}

/// Like `renderImage`, but from a rendered chunk where one covers the frame (tests).
#[napi]
pub fn render_image_cached(time_us: i64, width: u32, height: u32) -> Result<CachedImage> {
    let renderer = session().lock().unwrap().as_ref().map(Session::renderer).ok_or_else(|| err(openrip_core::Error::NoProject))?;
    let (img, cached) = renderer.render_image_cached(Micros(time_us), width, height).map_err(err)?;
    Ok(CachedImage { width: img.width, height: img.height, data: Buffer::from(img.data), cached })
}

#[napi(object)]
pub struct RenderCacheStats {
    /// Preview frames taken from rendered chunks, and composited while the cache held some.
    pub hits: f64,
    pub misses: f64,
}

#[napi]
pub fn render_cache_stats() -> RenderCacheStats {
    let (hits, misses) = openrip_core::render_cache_stats();
    RenderCacheStats { hits: hits as f64, misses: misses as f64 }
}
