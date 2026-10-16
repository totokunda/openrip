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
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use napi::bindgen_prelude::{AsyncTask, Buffer};
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
