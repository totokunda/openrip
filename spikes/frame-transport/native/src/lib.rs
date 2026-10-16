//! Frame-transport spike: hardware-decode video into IOSurface-backed frames
//! and hand them to Electron, either via `sharedTexture` (path 1) or by
//! presenting them on a native CALayer inside the window (path 2).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Instant;

use napi::bindgen_prelude::Buffer;
use napi::{Error, Result};
use napi_derive::napi;

mod decode;
mod overlay;

/// A decoded frame kept alive (retained) until JS calls `release(id)`.
pub(crate) struct HeldFrame {
    /// Held only to keep the CVPixelBuffer (and its IOSurface) alive until `release`.
    #[allow(dead_code)]
    pub pixel_buffer: decode::PixelBuffer,
    pub io_surface_ptr: usize,
    pub width: u32,
    pub height: u32,
    pub pts_us: i64,
    pub decoded_at: Instant,
}

pub(crate) struct Shared {
    pub ready: Mutex<VecDeque<u32>>,
    pub held: Mutex<HashMap<u32, HeldFrame>>,
    pub space: Condvar,
    pub stop: AtomicBool,
    pub decoded: AtomicU64,
    pub max_outstanding: usize,
}

struct Session {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
    info: StreamInfo,
}

static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

fn session() -> &'static Mutex<Option<Session>> {
    SESSION.get_or_init(|| Mutex::new(None))
}

#[napi(object)]
#[derive(Clone)]
pub struct StreamInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration_sec: f64,
    pub pixel_format: String,
}

#[napi(object)]
pub struct FrameHandle {
    pub id: u32,
    /// IOSurfaceRef pointer bytes, as Electron's `sharedTexture` expects on macOS.
    pub io_surface: Buffer,
    pub width: u32,
    pub height: u32,
    pub pts_us: i64,
    /// Microseconds between decode completion and this `next()` call.
    pub queued_us: i64,
}

#[napi(object)]
pub struct DecodeStats {
    pub decoded: i64,
    pub ready: u32,
    pub outstanding: u32,
}

/// Open a file and start a background hardware-decode loop.
/// `pixel_format`: "nv12" | "p010le" | "bgra". The clip loops until `close()`.
#[napi]
pub fn open(path: String, pixel_format: String, max_outstanding: u32) -> Result<StreamInfo> {
    close();
    let shared = Arc::new(Shared {
        ready: Mutex::new(VecDeque::new()),
        held: Mutex::new(HashMap::new()),
        space: Condvar::new(),
        stop: AtomicBool::new(false),
        decoded: AtomicU64::new(0),
        max_outstanding: max_outstanding.max(2) as usize,
    });
    let info = decode::probe(&path, &pixel_format).map_err(Error::from_reason)?;
    let thread = {
        let shared = shared.clone();
        let path = path.clone();
        let fmt = pixel_format.clone();
        std::thread::Builder::new()
            .name("ft-decode".into())
            .spawn(move || decode::run(&path, &fmt, &shared))
            .map_err(|e| Error::from_reason(e.to_string()))?
    };
    *session().lock().unwrap() = Some(Session {
        shared,
        thread: Some(thread),
        info: info.clone(),
    });
    Ok(info)
}

/// Pop the next decoded frame, or `null` if the decoder hasn't produced one yet.
#[napi]
pub fn next() -> Option<FrameHandle> {
    let guard = session().lock().unwrap();
    let s = guard.as_ref()?;
    let id = s.shared.ready.lock().unwrap().pop_front()?;
    let held = s.shared.held.lock().unwrap();
    let f = held.get(&id)?;
    Some(FrameHandle {
        id,
        io_surface: Buffer::from((f.io_surface_ptr as u64).to_ne_bytes().to_vec()),
        width: f.width,
        height: f.height,
        pts_us: f.pts_us,
        queued_us: f.decoded_at.elapsed().as_micros() as i64,
    })
}

/// Drop our retain on a frame so the decoder can recycle its buffer.
#[napi]
pub fn release(id: u32) {
    let guard = session().lock().unwrap();
    if let Some(s) = guard.as_ref() {
        s.shared.held.lock().unwrap().remove(&id);
        s.shared.space.notify_all();
    }
}

#[napi]
pub fn stats() -> DecodeStats {
    let guard = session().lock().unwrap();
    match guard.as_ref() {
        Some(s) => DecodeStats {
            decoded: s.shared.decoded.load(Ordering::Relaxed) as i64,
            ready: s.shared.ready.lock().unwrap().len() as u32,
            outstanding: s.shared.held.lock().unwrap().len() as u32,
        },
        None => DecodeStats { decoded: 0, ready: 0, outstanding: 0 },
    }
}

#[napi]
pub fn info() -> Option<StreamInfo> {
    session().lock().unwrap().as_ref().map(|s| s.info.clone())
}

#[napi]
pub fn close() {
    let taken = session().lock().unwrap().take();
    if let Some(mut s) = taken {
        s.shared.stop.store(true, Ordering::SeqCst);
        s.shared.space.notify_all();
        if let Some(t) = s.thread.take() {
            let _ = t.join();
        }
    }
}

/// Path 2: attach a layer-backed NSView to the window's content view.
/// `ns_view` is `BrowserWindow.getNativeWindowHandle()`. Coordinates are CSS px
/// from the top-left of the content area.
#[napi]
pub fn overlay_attach(ns_view: Buffer, x: f64, y: f64, w: f64, h: f64, below_web_contents: bool) -> Result<()> {
    overlay::attach(&ns_view, x, y, w, h, below_web_contents).map_err(Error::from_reason)
}

#[napi]
pub fn overlay_set_frame(x: f64, y: f64, w: f64, h: f64) {
    overlay::set_frame(x, y, w, h);
}

/// Present a held frame on the overlay layer (zero-copy: the layer samples the IOSurface).
#[napi]
pub fn overlay_present(id: u32) -> bool {
    let guard = session().lock().unwrap();
    let Some(s) = guard.as_ref() else { return false };
    let held = s.shared.held.lock().unwrap();
    let Some(f) = held.get(&id) else { return false };
    overlay::present(f.io_surface_ptr)
}

#[napi]
pub fn overlay_detach() {
    overlay::detach();
}
