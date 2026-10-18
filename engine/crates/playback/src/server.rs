use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use openrip_media::{DecoderOptions, MediaError, Micros, VideoDecoder, VideoFrame};
use openrip_platform::tasks::{self, Task};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum SeekMode {
    /// The exact frame shown at the requested time.
    Accurate,
    /// Any frame starting within `tolerance` of the requested time, if one is cheap to get;
    /// the exact frame otherwise.
    Scrub { tolerance: Micros },
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Quality {
    /// The frame shown at the requested time.
    Exact,
    /// A nearby frame (scrubbing).
    Approximate,
}

/// The answer to a request, handed to the server's callback on its thread.
pub struct Delivered {
    /// The id returned by [`FrameServer::request`].
    pub request: u64,
    /// The requested media time.
    pub time: Micros,
    pub result: Result<(VideoFrame, Quality), MediaError>,
    /// From the request call to delivery.
    pub latency: Duration,
}

#[derive(Copy, Clone, Debug, Default)]
pub struct ServerStats {
    pub requested: u64,
    /// Requests replaced by a newer one before decoding started.
    pub superseded: u64,
    pub delivered_exact: u64,
    pub delivered_approximate: u64,
}

struct Request {
    id: u64,
    time: Micros,
    mode: SeekMode,
    issued: Instant,
}

#[derive(Default)]
struct Slot {
    next: Option<Request>,
    next_id: u64,
    busy: bool,
    quit: bool,
    stats: ServerStats,
}

struct Shared {
    slot: Mutex<Slot>,
    cond: Condvar,
}

/// One source's decoder on a worker thread.
pub struct FrameServer {
    shared: Arc<Shared>,
    worker: Option<Task>,
}

impl FrameServer {
    /// Open `path` (errors are reported here) and start its worker. `deliver` runs on the
    /// worker thread for every request that wasn't superseded.
    pub fn open(path: &Path, opts: &DecoderOptions, deliver: impl Fn(Delivered) + Send + 'static) -> Result<Self, MediaError> {
        let decoder = VideoDecoder::open(path, opts)?;
        let shared = Arc::new(Shared { slot: Mutex::new(Slot::default()), cond: Condvar::new() });
        let worker = {
            let shared = shared.clone();
            let name = format!("frame-server {}", path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default());
            tasks::spawn(name, move || run(decoder, &shared, deliver)).map_err(|e| MediaError::Open { path: path.into(), msg: format!("can't start its frame server: {e}") })?
        };
        Ok(FrameServer { shared, worker: Some(worker) })
    }

    /// Ask for the frame at media time `t`. Replaces any request still waiting.
    pub fn request(&self, t: Micros, mode: SeekMode) -> u64 {
        let mut slot = self.shared.slot.lock().unwrap();
        slot.next_id += 1;
        let id = slot.next_id;
        slot.stats.requested += 1;
        if slot.next.replace(Request { id, time: t, mode, issued: Instant::now() }).is_some() {
            slot.stats.superseded += 1;
        }
        self.shared.cond.notify_all();
        id
    }

    /// Block until every request made so far has been answered or superseded.
    pub fn wait_idle(&self) {
        let mut slot = self.shared.slot.lock().unwrap();
        while slot.next.is_some() || slot.busy {
            slot = self.shared.cond.wait(slot).unwrap();
        }
    }

    pub fn stats(&self) -> ServerStats {
        self.shared.slot.lock().unwrap().stats
    }
}

impl Drop for FrameServer {
    fn drop(&mut self) {
        self.shared.slot.lock().unwrap().quit = true;
        self.shared.cond.notify_all();
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}

fn run(mut decoder: VideoDecoder, shared: &Shared, deliver: impl Fn(Delivered)) {
    loop {
        let req = {
            let mut slot = shared.slot.lock().unwrap();
            slot.busy = false;
            shared.cond.notify_all();
            loop {
                if slot.quit {
                    return;
                }
                if let Some(r) = slot.next.take() {
                    slot.busy = true;
                    break r;
                }
                slot = shared.cond.wait(slot).unwrap();
            }
        };
        let result = serve(&mut decoder, &req);
        {
            let mut slot = shared.slot.lock().unwrap();
            match &result {
                Ok((_, Quality::Exact)) => slot.stats.delivered_exact += 1,
                Ok((_, Quality::Approximate)) => slot.stats.delivered_approximate += 1,
                Err(_) => {}
            }
        }
        deliver(Delivered { request: req.id, time: req.time, result, latency: req.issued.elapsed() });
    }
}

fn serve(decoder: &mut VideoDecoder, req: &Request) -> Result<(VideoFrame, Quality), MediaError> {
    let exact = |d: &mut VideoDecoder| -> Result<(VideoFrame, Quality), MediaError> {
        let f = d.frame_at(req.time)?.ok_or_else(|| MediaError::Ffmpeg { op: "frame_at", code: -1, msg: "stream has no frames".into() })?;
        Ok((f, Quality::Exact))
    };
    match req.mode {
        SeekMode::Accurate => exact(decoder),
        SeekMode::Scrub { tolerance } => {
            if let Some((f, is_exact)) = decoder.frame_near(req.time, tolerance) {
                return Ok((f, if is_exact { Quality::Exact } else { Quality::Approximate }));
            }
            // Decoding on is cheap (a slow drag forward): stay exact and keep the position.
            if decoder.reachable_without_seek(req.time) {
                return exact(decoder);
            }
            // A seek is needed anyway: show the GOP's keyframe if it's close enough.
            match decoder.keyframe_at(req.time)? {
                Some(k) if (req.time.0 - k.time.0).abs() <= tolerance.0 => Ok((k, Quality::Approximate)),
                // The keyframe is too far back: carry on from it to the exact frame.
                _ => exact(decoder),
            }
        }
    }
}
