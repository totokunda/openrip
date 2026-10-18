//! A stream played backward (a reversed clip), decoded ahead in windows.
//!
//! Decoders only go forward: the frame before the one shown may be a whole GOP away (every
//! picture from its keyframe on). Played backward frame by frame, that would decode a GOP per
//! frame. [`ReverseReader`] instead decodes a window of frames below the one asked for, from
//! the keyframe at or before the window's start, keeps them, and serves the frames inside it
//! as the playhead walks down. While it does, a worker decodes the window below, so a GOP
//! boundary costs nothing on the caller's thread.
//!
//! A window holds the frames shown over `[lo, hi)`: the frame shown at `lo` and every frame
//! starting before `hi`. It answers a time inside it with the last frame starting at or
//! before it, as [`VideoSource::frame_at`] does, so a reversed clip shows the same frame for
//! a time however it got there (playing, stepping, seeking). Windows start on a keyframe when
//! one is within reach (nothing decoded is thrown away), else as far down as the memory
//! budget allows: an intra-only stream (ProRes) is read straight through, a long GOP in parts.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use crate::backend::{open_video, DecoderOptions, VideoSource};
use crate::{MediaError, Micros, VideoFrame, VideoInfo};

/// Frames kept per window at most, whatever the budget (a window of tiny frames).
const MAX_WINDOW_FRAMES: i64 = 120;

/// Decoded frames over `[lo, hi)` of the stream, in presentation order.
struct Window {
    lo: Micros,
    hi: Micros,
    frames: Vec<VideoFrame>,
}

impl Window {
    fn covers(&self, t: Micros) -> bool {
        t >= self.lo && t < self.hi
    }

    /// The frame shown at `t` (inside the window).
    fn frame_at(&self, t: Micros) -> Option<&VideoFrame> {
        let i = self.frames.partition_point(|f| f.time <= t);
        // Before the window's first frame (the stream starts after `lo`): show that frame,
        // as a decoder shows the first frame for a time before it.
        self.frames.get(i.saturating_sub(1))
    }
}

/// How a reader has done, for benchmarks and traces.
#[derive(Copy, Clone, Debug, Default)]
pub struct ReverseStats {
    /// Windows the worker decoded.
    pub windows: u64,
    /// Frames kept in windows.
    pub frames: u64,
    /// Times a frame wasn't ready and the caller waited for the worker.
    pub waits: u64,
    /// The longest of those waits.
    pub longest_wait: std::time::Duration,
}

/// Frames of one video stream for a caller moving backward through it.
pub struct ReverseReader {
    /// Windows decoded, highest first.
    windows: VecDeque<Window>,
    jobs: Option<mpsc::Sender<Micros>>,
    done: mpsc::Receiver<Result<Window, MediaError>>,
    /// The tops of the windows the worker has been asked for, in order.
    pending: VecDeque<Micros>,
    worker: Option<openrip_platform::tasks::Task>,
    path: PathBuf,
    info: VideoInfo,
    stats: ReverseStats,
}

impl ReverseReader {
    /// Open the stream at `path` (with `opts`; its cache is unused) to read backward, keeping
    /// about `budget` bytes of decoded frames in each window (two windows are held at once).
    pub fn open(path: &Path, opts: &DecoderOptions, budget: usize) -> Result<ReverseReader, MediaError> {
        let decoder = open_video(path, &DecoderOptions { cache_bytes: 0, ..opts.clone() })?;
        let (job_tx, job_rx) = mpsc::channel::<Micros>();
        let (done_tx, done_rx) = mpsc::channel();
        let info = decoder.info().clone();
        let shrink = if opts.shrink_to > 0 { (info.width.max(info.height) / opts.shrink_to).max(1) } else { 1 };
        let worker = openrip_platform::tasks::spawn("reverse-decode", move || {
            let mut decoder = decoder;
            let keys = decoder.keyframe_times();
            let frames = window_frames(decoder.as_ref(), shrink, budget);
            for hi in job_rx {
                let window = decode_window(decoder.as_mut(), &keys, frames, hi);
                if done_tx.send(window).is_err() {
                    return;
                }
            }
        })
        .map_err(|e| MediaError::Unsupported { path: path.into(), msg: format!("can't start the reverse decoder: {e}") })?;
        Ok(ReverseReader { windows: VecDeque::new(), jobs: Some(job_tx), done: done_rx, pending: VecDeque::new(), worker: Some(worker), path: path.into(), info, stats: ReverseStats::default() })
    }

    pub fn info(&self) -> &VideoInfo {
        &self.info
    }

    pub fn stats(&self) -> ReverseStats {
        self.stats
    }

    /// The frame shown at `t`: the last frame starting at or before it (the first frame for a
    /// time before the stream, the last for one past it).
    pub fn frame_at(&mut self, t: Micros) -> Result<Option<VideoFrame>, MediaError> {
        let t = Micros(t.0.max(0));
        while let Ok(w) = self.done.try_recv() {
            self.adopt(w)?;
        }
        let mut started: Option<std::time::Instant> = None;
        let found = loop {
            if let Some(i) = self.windows.iter().position(|w| w.covers(t)) {
                break i;
            }
            // Not decoded yet: wait for the window on its way if it covers `t`, else ask for
            // the window just below it.
            if !self.pending.iter().any(|hi| t < *hi) {
                self.request(Micros(t.0 + 1))?;
            }
            started.get_or_insert_with(std::time::Instant::now);
            let w = self.done.recv().map_err(|_| self.worker_gone())?;
            self.adopt(w)?;
        };
        if let Some(s) = started {
            self.stats.waits += 1;
            self.stats.longest_wait = self.stats.longest_wait.max(s.elapsed());
        }
        let frame = self.windows[found].frame_at(t).map(VideoFrame::try_clone).transpose()?;
        // Windows above this one are behind the playhead now.
        self.windows.drain(..found);
        // Serving from the lowest window: get the one below it ready.
        if self.windows.len() == 1 && self.pending.is_empty() && self.windows[0].lo.0 > 0 {
            let below = self.windows[0].lo;
            self.request(below)?;
        }
        Ok(frame)
    }

    fn request(&mut self, hi: Micros) -> Result<(), MediaError> {
        let jobs = self.jobs.as_ref().ok_or_else(|| self.worker_gone())?;
        jobs.send(hi).map_err(|_| self.worker_gone())?;
        self.pending.push_back(hi);
        Ok(())
    }

    fn adopt(&mut self, w: Result<Window, MediaError>) -> Result<(), MediaError> {
        self.pending.pop_front();
        let w = w?;
        self.stats.windows += 1;
        self.stats.frames += w.frames.len() as u64;
        // Keep them highest first; a window asked for after a jump up replaces the rest.
        if self.windows.back().is_some_and(|last| w.hi <= last.lo) {
            self.windows.push_back(w);
        } else {
            self.windows.clear();
            self.windows.push_back(w);
        }
        Ok(())
    }

    fn worker_gone(&self) -> MediaError {
        MediaError::Unsupported { path: self.path.clone(), msg: "the reverse decoder stopped".into() }
    }
}

impl Drop for ReverseReader {
    fn drop(&mut self) {
        self.jobs.take(); // ends the worker's loop
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}

/// How many frames a window holds within `budget` bytes: a decoded picture's size (4:2:0,
/// two bytes a sample above 8 bits, `shrink` times smaller on each side).
fn window_frames(decoder: &dyn VideoSource, shrink: u32, budget: usize) -> i64 {
    let info = decoder.info();
    let side = |v: u32| (v.max(1) as usize).div_ceil(shrink as usize);
    let bytes = (side(info.width) * side(info.height) * 3 / 2) << ((info.bit_depth > 8) as usize);
    ((budget / bytes.max(1)) as i64).clamp(2, MAX_WINDOW_FRAMES)
}

/// The frames shown over the window below `hi`: from the lowest keyframe within `frames`
/// frames of it, or else from `frames` frames down.
fn decode_window(decoder: &mut dyn VideoSource, keys: &[Micros], frames: i64, hi: Micros) -> Result<Window, MediaError> {
    let step = decoder.position().1.0.max(1);
    let floor = Micros((hi.0 - frames * step).max(0));
    let lo = keys.iter().copied().find(|k| *k >= floor && *k < hi).unwrap_or(floor);
    let mut out = Vec::new();
    if let Some(first) = decoder.frame_at(lo)? {
        out.push(first);
        while let Some(f) = decoder.next_frame()? {
            if f.time >= hi {
                break;
            }
            out.push(f);
        }
    }
    Ok(Window { lo, hi, frames: out })
}
