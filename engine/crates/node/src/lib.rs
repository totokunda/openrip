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
use openrip_playback::PreviewEngine;

fn err(e: impl std::fmt::Display) -> Error {
    Error::from_reason(e.to_string())
}

/// A render target buffer; CoreVideo buffers may be used from any thread.
#[cfg(target_os = "macos")]
struct Surface(objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>);
#[cfg(target_os = "macos")]
unsafe impl Send for Surface {}

struct Session {
    engine: Arc<Mutex<PreviewEngine>>,
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
    let info = ProjectInfo {
        name: project.name.clone(),
        width: project.canvas.width,
        height: project.canvas.height,
        fps: project.fps.as_f64(),
        duration_us: project.duration().0,
        tracks: project.tracks.len() as u32,
        segments: project.segment_count() as u32,
        source: source.into(),
    };
    let engine = PreviewEngine::new(project).map_err(err)?;
    *session().lock().unwrap() = Some(Session {
        engine: Arc::new(Mutex::new(engine)),
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
