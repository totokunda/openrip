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

// ---- Timeline thumbnails ----

fn thumbnails_service() -> &'static Thumbnails {
    static T: Thumbnails = Thumbnails::new();
    &T
}

/// Keep exact thumbnails in `dir` across runs (e.g. under the app's cache folder).
#[napi]
pub fn set_thumbnail_cache_dir(dir: String) {
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
    /// "h264" or "hevc".
    pub codec: String,
    /// Bits per second.
    pub bitrate: f64,
    pub audio: bool,
}

#[napi(object)]
pub struct ExportResult {
    pub frames: f64,
    pub seconds: f64,
    /// Layers skipped because their media or font was missing, summed over frames.
    pub skipped_layers: f64,
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
        Ok(ExportResult { frames: s.frames as f64, seconds: s.seconds, skipped_layers: s.skipped_layers as f64 })
    }
}

/// Export a project (same JSON formats as `openProjectJson`) to an MP4/MOV file on a worker
/// thread, independent of the open preview. Rejects with "cancelled" after `cancelExport()`.
#[napi]
pub fn export_project(json: String, path: String, options: ExportOptions) -> AsyncTask<ExportTask> {
    let o = options;
    let options = openrip_core::ExportOptions { width: o.width, height: o.height, fps: o.fps, codec: openrip_core::codec_named(&o.codec), bitrate: o.bitrate, audio: o.audio };
    AsyncTask::new(ExportTask { json, path, options })
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
