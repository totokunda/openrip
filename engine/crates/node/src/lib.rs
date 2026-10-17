//! Node/Electron addon: the engine's preview for the app.
//!
//! ```js
//! const engine = require("./openrip_node.node");
//! const info = engine.openProject(pathToCapCutDraftOrProjectJson);
//! const f = await engine.renderFrame(timeUs, 1280, 720); // on a worker thread
//! // f.ioSurface: IOSurfaceRef bytes for Electron's sharedTexture (BGRA)
//! engine.release(f.id); // when Electron no longer references it
//! ```
//!
//! Frames are rendered into a small pool of IOSurface-backed buffers. A buffer is reused
//! only after `release(id)`, so the app must release every frame it receives.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use napi::bindgen_prelude::{AsyncTask, Buffer, Float32Array};
use napi::{Env, Error, Result, Task};
use napi_derive::napi;
use openrip_model::{Micros, Project};
use openrip_playback::{Player, PreviewEngine, PreviewPipeline};

fn err(e: impl std::fmt::Display) -> Error {
    Error::from_reason(e.to_string())
}

/// A render target buffer; CoreVideo buffers may be used from any thread.
#[cfg(target_os = "macos")]
struct Surface(objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>);
#[cfg(target_os = "macos")]
unsafe impl Send for Surface {}

struct Session {
    project: Project,
    engine: Arc<Mutex<PreviewEngine>>,
    /// Audio output and master clock (absent when there is no output device).
    player: Option<Arc<Player>>,
    /// The render-ahead preview, created on the first `setPreviewSize`.
    #[cfg(target_os = "macos")]
    pipeline: Option<PreviewPipeline>,
    /// Frames handed to the app by `frameForDisplay`, until it releases them.
    #[cfg(target_os = "macos")]
    shown: HashMap<u32, openrip_playback::pipeline::Surface>,
    #[cfg(target_os = "macos")]
    held: HashMap<u32, Surface>,
    #[cfg(target_os = "macos")]
    free: Vec<Surface>,
    next_id: u32,
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
}

/// Load a project: a CapCut draft folder, an OpenRip project JSON, or a v1 project file.
fn load(path: &Path) -> Result<(Project, &'static str)> {
    if path.is_dir() {
        return Ok((openrip_capcut::import_draft_dir(path).map_err(err)?.project, "capcut"));
    }
    let text = std::fs::read_to_string(path).map_err(err)?;
    if let Ok(p) = serde_json::from_str::<Project>(&text) {
        return Ok((p, "openrip"));
    }
    Ok((openrip_v1::import_v1_file(path).map_err(err)?.project, "v1"))
}

/// Open a project for preview (replacing any open one).
/// The addon's version, so the app can tell which engine it loaded.
#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[napi]
pub fn open_project(path: String) -> Result<ProjectInfo> {
    let (project, source) = load(Path::new(&path))?;
    start_session(project, source)
}

/// Open a project from JSON text: an OpenRip project, a v1 project (the app's own format)
/// or a CapCut draft's `draft_info.json`.
#[napi]
pub fn open_project_json(json: String) -> Result<ProjectInfo> {
    let (project, source) = parse_json(&json)?;
    start_session(project, source)
}

fn parse_json(json: &str) -> Result<(Project, &'static str)> {
    if let Ok(p) = serde_json::from_str::<Project>(json) {
        return Ok((p, "openrip"));
    }
    let doc: serde_json::Value = serde_json::from_str(json).map_err(err)?;
    if doc.get("tracks").is_some() && doc.get("materials").is_some() {
        return Ok((openrip_capcut::import_draft_json(&doc, "draft").map_err(err)?.project, "capcut"));
    }
    Ok((openrip_v1::import_v1_json(&doc).map_err(err)?.project, "v1"))
}

/// Replace the open project after an edit (same formats as `openProjectJson`). Decoders,
/// the audio output and the playback state stay as they are, so this is cheap enough to
/// call after every edit; paused, the current frame is rendered again. Opens the project
/// if none is open.
#[napi]
pub fn update_project(json: String) -> Result<ProjectInfo> {
    let (project, source) = parse_json(&json)?;
    let mut guard = session().lock().unwrap();
    let Some(s) = guard.as_mut() else {
        drop(guard);
        return start_session(project, source);
    };
    let info = project_info(&project, source);
    s.engine.lock().unwrap().set_project(project.clone());
    if let Some(p) = &s.player {
        p.set_project(project.clone());
    }
    #[cfg(target_os = "macos")]
    if let Some(p) = &s.pipeline {
        p.set_project(project.clone());
    }
    s.project = project;
    Ok(info)
}

fn project_info(project: &Project, source: &str) -> ProjectInfo {
    ProjectInfo {
        name: project.name.clone(),
        width: project.canvas.width,
        height: project.canvas.height,
        fps: project.fps.as_f64(),
        duration_us: project.duration().0,
        tracks: project.tracks.len() as u32,
        segments: project.segment_count() as u32,
        source: source.into(),
    }
}

fn start_session(project: Project, source: &str) -> Result<ProjectInfo> {
    let info = project_info(&project, source);
    // Close the old session (and its audio output) before opening the new one.
    session().lock().unwrap().take();
    let player = Player::new(project.clone()).ok().map(Arc::new);
    let engine = PreviewEngine::new(project.clone()).map_err(err)?;
    *session().lock().unwrap() = Some(Session {
        project,
        engine: Arc::new(Mutex::new(engine)),
        player,
        #[cfg(target_os = "macos")]
        pipeline: None,
        #[cfg(target_os = "macos")]
        shown: HashMap::new(),
        #[cfg(target_os = "macos")]
        held: HashMap::new(),
        #[cfg(target_os = "macos")]
        free: Vec::new(),
        next_id: 0,
    });
    Ok(info)
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
}

#[cfg(target_os = "macos")]
pub struct Rendered {
    surface: Surface,
    ms: f64,
    layers: u32,
    skipped: u32,
}

#[cfg(target_os = "macos")]
impl Task for RenderTask {
    type Output = Rendered;
    type JsValue = FrameHandle;

    fn compute(&mut self) -> Result<Rendered> {
        let (engine, surface) = {
            let mut guard = session().lock().unwrap();
            let s = guard.as_mut().ok_or_else(|| err("no project open"))?;
            let (w, h) = (self.width, self.height);
            let reusable = s.free.iter().position(|f| objc2_core_video::CVPixelBufferGetWidth(&f.0) == w as usize && objc2_core_video::CVPixelBufferGetHeight(&f.0) == h as usize);
            let surface = match reusable {
                Some(i) => s.free.swap_remove(i),
                None => Surface(openrip_render::Compositor::output_surface(w, h).ok_or_else(|| err("can't allocate a frame surface"))?),
            };
            (s.engine.clone(), surface)
        };
        let t0 = Instant::now();
        let report = engine.lock().unwrap().render_to_surface(self.time, &surface.0).map_err(err)?;
        Ok(Rendered { surface, ms: t0.elapsed().as_secs_f64() * 1e3, layers: report.layers as u32, skipped: report.missing.len() as u32 })
    }

    fn resolve(&mut self, _env: Env, out: Rendered) -> Result<FrameHandle> {
        let mut guard = session().lock().unwrap();
        let s = guard.as_mut().ok_or_else(|| err("project closed"))?;
        s.next_id = s.next_id.wrapping_add(1);
        let id = s.next_id;
        let ptr = objc2_core_video::CVPixelBufferGetIOSurface(Some(&out.surface.0)).map(|io| objc2_core_foundation::CFRetained::as_ptr(&io).as_ptr() as usize as u64).ok_or_else(|| err("frame has no IOSurface"))?;
        s.held.insert(id, out.surface);
        Ok(FrameHandle {
            id,
            io_surface: Buffer::from(ptr.to_ne_bytes().to_vec()),
            width: self.width,
            height: self.height,
            time_us: self.time.0,
            render_ms: out.ms,
            layers: out.layers,
            skipped: out.skipped,
        })
    }
}

/// Render the frame at `timeUs` into a pooled IOSurface (on a worker thread).
#[cfg(target_os = "macos")]
#[napi]
pub fn render_frame(time_us: i64, width: u32, height: u32) -> AsyncTask<RenderTask> {
    AsyncTask::new(RenderTask { time: Micros(time_us), width, height })
}

/// Let a frame's surface be reused (call when Electron releases it).
#[napi]
pub fn release(id: u32) {
    #[cfg(target_os = "macos")]
    if let Some(s) = session().lock().unwrap().as_mut() {
        if let Some(surface) = s.shown.remove(&id) {
            if let Some(p) = &s.pipeline {
                p.recycle(surface);
            }
            return;
        }
        if let Some(surface) = s.held.remove(&id) {
            if s.free.len() < 4 {
                s.free.push(surface);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = id;
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
    let engine = session().lock().unwrap().as_ref().map(|s| s.engine.clone()).ok_or_else(|| err("no project open"))?;
    let (img, _) = engine.lock().unwrap().render_image(Micros(time_us), width, height).map_err(err)?;
    Ok(Image { width: img.width, height: img.height, data: Buffer::from(img.data) })
}

/// Start playback (audio, and the master clock) at `timeUs`. False without an output device.
#[napi]
pub fn play(time_us: i64) -> bool {
    match session().lock().unwrap().as_ref().and_then(|s| s.player.as_ref()) {
        Some(p) => {
            p.play(Micros(time_us));
            true
        }
        None => false,
    }
}

#[napi]
pub fn pause() {
    if let Some(p) = session().lock().unwrap().as_ref().and_then(|s| s.player.as_ref()) {
        p.pause();
    }
}

/// The timeline time being heard now (the clock to pick video frames by), or -1 without
/// audio output.
#[napi]
pub fn position_us() -> i64 {
    session().lock().unwrap().as_ref().and_then(|s| s.player.as_ref()).map_or(-1, |p| p.position().0)
}

/// Output gain; 0 mutes (the clock keeps running).
#[napi]
pub fn set_volume(volume: f64) {
    if let Some(p) = session().lock().unwrap().as_ref().and_then(|s| s.player.as_ref()) {
        p.set_volume(volume as f32);
    }
}

// ---- Render-ahead preview (what the app's preview uses) ----

/// Size of the preview surfaces; creates the pipeline on first call.
#[cfg(target_os = "macos")]
#[napi]
pub fn set_preview_size(width: u32, height: u32) -> Result<()> {
    let mut guard = session().lock().unwrap();
    let s = guard.as_mut().ok_or_else(|| err("no project open"))?;
    match &s.pipeline {
        Some(p) => p.resize(width, height),
        None => s.pipeline = Some(PreviewPipeline::new(s.project.clone(), width, height).map_err(err)?),
    }
    Ok(())
}

/// Play from `fromUs`: sound starts and frames render ahead of the audio clock.
#[cfg(target_os = "macos")]
#[napi]
pub fn start_playback(from_us: i64) -> Result<()> {
    let guard = session().lock().unwrap();
    let s = guard.as_ref().ok_or_else(|| err("no project open"))?;
    let p = s.pipeline.as_ref().ok_or_else(|| err("call setPreviewSize first"))?;
    match &s.player {
        Some(player) => {
            player.play(Micros(from_us));
            let player = player.clone();
            p.play(Arc::new(move || player.position()));
        }
        None => {
            // No audio device: run by the wall clock.
            let start = Instant::now();
            p.play(Arc::new(move || Micros(from_us + start.elapsed().as_micros() as i64)));
        }
    }
    Ok(())
}

/// Stop playing; the picture stays on the frame at the stop time.
#[cfg(target_os = "macos")]
#[napi]
pub fn stop_playback() -> i64 {
    let guard = session().lock().unwrap();
    let Some(s) = guard.as_ref() else { return 0 };
    let at = s.player.as_ref().map_or(Micros::ZERO, |p| {
        let t = p.position();
        p.pause();
        t
    });
    if let Some(p) = &s.pipeline {
        p.seek(at);
    }
    at.0
}

/// Show the frame at `timeUs` (paused; scrubbing). The newest request wins.
#[cfg(target_os = "macos")]
#[napi]
pub fn seek(time_us: i64) {
    if let Some(p) = session().lock().unwrap().as_ref().and_then(|s| s.pipeline.as_ref()) {
        p.seek(Micros(time_us));
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
    let mut guard = session().lock().unwrap();
    let s = guard.as_mut()?;
    let now = s.player.as_ref().map_or(Micros(i64::MAX), |p| p.position());
    let f = s.pipeline.as_ref()?.frame(now)?;
    let pb = &f.surface.0;
    let ptr = objc2_core_video::CVPixelBufferGetIOSurface(Some(pb)).map(|io| objc2_core_foundation::CFRetained::as_ptr(&io).as_ptr() as usize as u64)?;
    let (w, h) = (objc2_core_video::CVPixelBufferGetWidth(pb) as u32, objc2_core_video::CVPixelBufferGetHeight(pb) as u32);
    s.next_id = s.next_id.wrapping_add(1);
    let id = s.next_id;
    s.shown.insert(id, f.surface);
    Some(DisplayFrame { id, io_surface: Buffer::from(ptr.to_ne_bytes().to_vec()), width: w, height: h, time_us: f.time.0, render_ms: f.render_ms })
}

// ---- Timeline thumbnails ----

/// One thumbnailer per pass, so a long exact pass doesn't hold up a quick one.
struct Thumbnailers {
    quick: Mutex<Option<openrip_playback::Thumbnailer>>,
    exact: Mutex<Option<openrip_playback::Thumbnailer>>,
    cache_dir: Mutex<Option<std::path::PathBuf>>,
}

fn thumbnailers() -> &'static Thumbnailers {
    static T: OnceLock<Thumbnailers> = OnceLock::new();
    T.get_or_init(|| Thumbnailers { quick: Mutex::new(None), exact: Mutex::new(None), cache_dir: Mutex::new(None) })
}

/// Keep exact thumbnails in `dir` across runs (e.g. under the app's cache folder).
#[napi]
pub fn set_thumbnail_cache_dir(dir: String) {
    let t = thumbnailers();
    *t.cache_dir.lock().unwrap() = Some(dir.into());
    // Rebuilt with the new folder on next use.
    t.quick.lock().unwrap().take();
    t.exact.lock().unwrap().take();
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

pub struct RawThumb {
    index: u32,
    time: Micros,
    exact: bool,
    image: openrip_render::RgbaImage,
}

impl Task for ThumbnailTask {
    type Output = Vec<RawThumb>;
    type JsValue = Vec<Thumbnail>;

    fn compute(&mut self) -> Result<Vec<RawThumb>> {
        let t = thumbnailers();
        let slot = if self.exact { &t.exact } else { &t.quick };
        let mut guard = slot.lock().unwrap();
        if guard.is_none() {
            *guard = Some(openrip_playback::Thumbnailer::new(t.cache_dir.lock().unwrap().clone()).map_err(err)?);
        }
        let pass = if self.exact { openrip_playback::Pass::Exact } else { openrip_playback::Pass::Quick };
        let mut out = Vec::with_capacity(self.times.len());
        guard.as_mut().unwrap().thumbnails(Path::new(&self.path), &self.times, self.height, pass, |th| {
            out.push(RawThumb { index: th.index as u32, time: th.time, exact: th.exact, image: th.image });
            true
        })
        .map_err(err)?;
        out.sort_by_key(|t| t.index);
        Ok(out)
    }

    fn resolve(&mut self, _env: Env, out: Vec<RawThumb>) -> Result<Vec<Thumbnail>> {
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
    type Output = Option<openrip_audio::Peaks>;
    type JsValue = Option<Waveform>;

    fn compute(&mut self) -> Result<Self::Output> {
        let dir = thumbnailers().cache_dir.lock().unwrap().clone();
        openrip_playback::waveform(Path::new(&self.path), self.per_second, dir.as_deref()).map_err(err)
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

/// The running export's frames done and total, and a request to stop it.
static EXPORT_DONE: AtomicU64 = AtomicU64::new(0);
static EXPORT_TOTAL: AtomicU64 = AtomicU64::new(0);
static EXPORT_CANCEL: AtomicBool = AtomicBool::new(false);

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
    options: ExportOptions,
}

impl Task for ExportTask {
    type Output = openrip_export::ExportStats;
    type JsValue = ExportResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let (project, _) = parse_json(&self.json)?;
        let o = &self.options;
        let options = openrip_export::ExportOptions {
            width: o.width & !1,
            height: o.height & !1,
            fps: openrip_model::FrameRate::from_f64(o.fps),
            codec: if o.codec.eq_ignore_ascii_case("hevc") || o.codec.eq_ignore_ascii_case("h265") { openrip_export::Codec::Hevc } else { openrip_export::Codec::H264 },
            bitrate: o.bitrate.max(100_000.0) as u64,
            audio: o.audio,
        };
        EXPORT_DONE.store(0, Ordering::Relaxed);
        EXPORT_TOTAL.store(0, Ordering::Relaxed);
        EXPORT_CANCEL.store(false, Ordering::Relaxed);
        openrip_export::export(project, Path::new(&self.path), &options, |done, total| {
            EXPORT_DONE.store(done, Ordering::Relaxed);
            EXPORT_TOTAL.store(total, Ordering::Relaxed);
            !EXPORT_CANCEL.load(Ordering::Relaxed)
        })
        .map_err(err)
    }

    fn resolve(&mut self, _env: Env, s: Self::Output) -> Result<ExportResult> {
        Ok(ExportResult { frames: s.frames as f64, seconds: s.seconds, skipped_layers: s.skipped_layers as f64 })
    }
}

/// Export a project (same JSON formats as `openProjectJson`) to an MP4/MOV file on a worker
/// thread, independent of the open preview. Rejects with "cancelled" after `cancelExport()`.
#[napi]
pub fn export_project(json: String, path: String, options: ExportOptions) -> AsyncTask<ExportTask> {
    AsyncTask::new(ExportTask { json, path, options })
}

/// The running (or last) export's progress, in frames.
#[napi]
pub fn export_progress() -> ExportProgress {
    ExportProgress { done: EXPORT_DONE.load(Ordering::Relaxed) as f64, total: EXPORT_TOTAL.load(Ordering::Relaxed) as f64 }
}

/// Stop the running export; its promise rejects and the unfinished file is removed.
#[napi]
pub fn cancel_export() {
    EXPORT_CANCEL.store(true, Ordering::Relaxed);
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
    type Output = AppProjectFromDraft;
    type JsValue = AppProjectFromDraft;

    fn compute(&mut self) -> Result<AppProjectFromDraft> {
        let imported = openrip_capcut::import_draft_dir(Path::new(&self.dir)).map_err(err)?;
        let project = imported.project;
        // The engine lays out each text, so the app's box around it fits.
        let mut engine = PreviewEngine::new(project.clone()).map_err(err)?;
        let doc = openrip_v1::to_app_project(&project, &mut |seg| engine.text_block(&seg.id));
        let r = &imported.report;
        let mut notes: Vec<String> = r.foreign.iter().map(|(k, n)| format!("{k}: {n} kept for the engine, not drawn yet")).collect();
        notes.extend(r.warnings.iter().cloned());
        Ok(AppProjectFromDraft { json: doc.to_string(), name: project.name.clone(), missing_media: r.missing_media.clone(), notes })
    }

    fn resolve(&mut self, _env: Env, out: AppProjectFromDraft) -> Result<AppProjectFromDraft> {
        Ok(out)
    }
}

/// The CapCut draft in folder `dir` as an app project, on a worker thread: the app's own
/// clips, each carrying its segment so the engine draws it as CapCut did.
#[napi]
pub fn capcut_to_app(dir: String) -> AsyncTask<DraftTask> {
    AsyncTask::new(DraftTask { dir })
}
