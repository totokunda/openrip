//! Scrubbing ahead: while the playhead is dragged, the pictures the next frames will need
//! are got ready on background threads, at about the preview's size.
//!
//! A drag asks for frames far apart. Each new GOP costs a keyframe decode (~20 ms of
//! VideoToolbox time for 4K), and each new still a decode, plus writing the whole picture
//! to the GPU when it's drawn (~12 ms for a 4K PNG). The engine tells [`ScrubAhead`] where
//! each frame of the drag is; from the drag's speed it plans what lies ahead (each video's
//! keyframes, each still) and a few worker threads get them ready as stand-ins: video
//! scaled by VideoToolbox as it decodes, stills box-filtered down. A keyframe's ~20 ms is
//! mostly latency, so sessions on several threads decode in parallel (four get through 4K
//! keyframes at ~7 ms each). Stand-ins are shown only while scrubbing; the exact frame on
//! release draws the full pictures.
//!
//! The same workers also decode an exact frame's stills beside its video
//! ([`ScrubAhead::load_full`]), rather than one after another on the render thread, and
//! write them to the GPU there; stills decoded before but no longer on the GPU are written
//! there too ([`ScrubAhead::upload`]).

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use openrip_media::{DecoderOptions, PixelFormat, VideoDecoder, VideoFrame};
use openrip_model::{MediaKind, Micros, Project, TrackKind};
use openrip_render::{RgbaImage, Uploader};

/// Worker threads (each with its own decoders).
const WORKERS: usize = 3;
/// Decoders a worker keeps open.
const WORKER_DECODERS: usize = 4;
/// How far ahead to get pictures ready, in the drag's own time.
const LOOKAHEAD: Duration = Duration::from_millis(300);
/// The drag's speed is measured over its last moves within this window.
const SPEED_WINDOW: Duration = Duration::from_millis(300);
/// The timeline span planned ahead, whatever the speed.
const MIN_SPAN: i64 = 1_000_000;
const MAX_SPAN: i64 = 12_000_000;
/// Timeline points sampled across the span, and jobs queued at most.
const SAMPLES: i64 = 48;
const MAX_JOBS: usize = 32;
/// Memory for stand-ins.
const KEYFRAME_BUDGET: usize = 96 << 20;
const STILL_BUDGET: usize = 128 << 20;
/// How long the render thread waits for a still a worker is already decoding: it has a
/// head start, and decoding it again would take as much CPU (this only guards against a
/// stuck worker).
const WAIT_STILL: Duration = Duration::from_millis(1000);
/// ... and for a still being written to the GPU, which takes a few milliseconds (after this
/// the render thread writes it itself).
const WAIT_UPLOAD: Duration = Duration::from_millis(100);
/// ... and for a keyframe. Decoding one is mostly waiting on the hardware, which a busy
/// machine slows less than it slows a worker thread, so after this the render thread
/// decodes it itself.
const WAIT_KEYFRAME: Duration = Duration::from_millis(40);

/// Something to get ready.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Job {
    /// Open a video and read its keyframe index (and keep it open for its keyframes).
    Index { path: String, size: u32 },
    /// A video's keyframe at index time `at`, shrunk toward `size` pixels on its long side.
    /// `seek` is a time inside its GOP: index times can be decode times, which come before
    /// the keyframe is shown (B-frames), and seeking to one lands in the GOP before.
    Keyframe { path: String, at: Micros, seek: Micros, size: u32 },
    /// A still, decoded and shrunk toward `size` pixels on its long side.
    Still { path: String, size: u32 },
    /// A still at full size, for an exact frame (decoded beside the frame's other media).
    Full { path: String },
    /// A still decoded before, written to the GPU for an exact frame.
    Upload { path: String, picture: Picture },
}

/// A decoded still in a job; jobs are told apart by path, so it compares by identity.
#[derive(Clone, Debug)]
pub(crate) struct Picture(Arc<RgbaImage>);

impl PartialEq for Picture {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for Picture {}

/// What a job makes, whatever size it was asked at.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum Key {
    Index(String),
    Keyframe(String, Micros),
    Still(String),
    Full(String),
    Upload(String),
}

impl Job {
    fn key(&self) -> Key {
        match self {
            Job::Index { path, .. } => Key::Index(path.clone()),
            Job::Keyframe { path, at, .. } => Key::Keyframe(path.clone(), *at),
            Job::Still { path, .. } => Key::Still(path.clone()),
            Job::Full { path } => Key::Full(path.clone()),
            Job::Upload { path, .. } => Key::Upload(path.clone()),
        }
    }

    fn path(&self) -> &str {
        match self {
            Job::Index { path, .. } | Job::Keyframe { path, .. } | Job::Still { path, .. } | Job::Full { path } | Job::Upload { path, .. } => path,
        }
    }
}

enum Ready {
    /// A video's keyframe times (`None`: it has no index, or didn't open).
    Index(String, Option<Arc<Vec<Micros>>>),
    /// The job's index time, and the keyframe with the index time of the GOP it's from.
    Keyframe(String, Micros, Option<(Micros, VideoFrame)>),
    /// A still's stand-in.
    Still(String, Option<Arc<RgbaImage>>),
    Full(String, Option<Arc<RgbaImage>>),
    /// A still written to the GPU (or not, on a GPU's limits).
    Uploaded(String),
}

impl Ready {
    fn key(&self) -> Key {
        match self {
            Ready::Index(path, _) => Key::Index(path.clone()),
            Ready::Keyframe(path, at, _) => Key::Keyframe(path.clone(), *at),
            Ready::Still(path, _) => Key::Still(path.clone()),
            Ready::Full(path, _) => Key::Full(path.clone()),
            Ready::Uploaded(path) => Key::Upload(path.clone()),
        }
    }
}

#[derive(Default)]
struct Queue {
    jobs: VecDeque<Job>,
    running: HashSet<Key>,
    quit: bool,
}

#[derive(Default)]
struct Shared {
    queue: Mutex<Queue>,
    cond: Condvar,
}

/// Values up to a memory budget; the least recently used go first.
pub(crate) struct Budgeted<K, V> {
    entries: HashMap<K, (V, usize, u64)>,
    bytes: usize,
    budget: usize,
    tick: u64,
}

impl<K: std::hash::Hash + Eq + Clone, V> Budgeted<K, V> {
    pub(crate) fn new(budget: usize) -> Self {
        Budgeted { entries: HashMap::new(), bytes: 0, budget, tick: 0 }
    }

    pub(crate) fn get(&mut self, key: &K) -> Option<&V> {
        self.tick += 1;
        let tick = self.tick;
        self.entries.get_mut(key).map(|(v, _, last)| {
            *last = tick;
            &*v
        })
    }

    pub(crate) fn contains(&self, key: &K) -> bool {
        self.entries.contains_key(key)
    }

    pub(crate) fn insert(&mut self, key: K, value: V, bytes: usize) {
        self.tick += 1;
        if let Some((_, old, _)) = self.entries.insert(key.clone(), (value, bytes, self.tick)) {
            self.bytes -= old;
        }
        self.bytes += bytes;
        while self.bytes > self.budget && self.entries.len() > 1 {
            let oldest = self.entries.iter().filter(|(k, _)| **k != key).min_by_key(|(_, e)| e.2).map(|(k, _)| k.clone());
            let Some(oldest) = oldest else { break };
            let (_, b, _) = self.entries.remove(&oldest).unwrap();
            self.bytes -= b;
        }
    }
}

/// Bytes a decoded picture holds.
fn frame_bytes(f: &VideoFrame) -> usize {
    let deep = matches!(f.pixel_format(), PixelFormat::P010 | PixelFormat::P210) as usize;
    (f.width() as usize * f.height() as usize * 3 / 2) << deep
}

pub(crate) struct ScrubAhead {
    shared: Arc<Shared>,
    /// Writes full-size stills to the compositor's GPU from the workers.
    uploader: Option<Uploader>,
    /// Started on the first drag (most engines never scrub: export, thumbnails, playback).
    workers: Vec<openrip_platform::tasks::Task>,
    ready_tx: Sender<Ready>,
    ready: Receiver<Ready>,
    /// The drag's recent positions and when they were asked for.
    recent: VecDeque<(Micros, Instant)>,
    /// The drag's last direction (+1 forward, -1 back).
    direction: i64,
    /// Keyframe times by video (`None`: no index, or not decoded by VideoToolbox; its
    /// keyframes aren't planned).
    indexes: HashMap<String, Option<Arc<Vec<Micros>>>>,
    keyframes: Budgeted<(String, Micros), VideoFrame>,
    stills: Budgeted<String, Arc<RgbaImage>>,
    /// Stills that failed to decode, so they aren't planned again.
    failed: HashSet<String>,
    /// Full-size stills the workers decoded for exact frames, for the engine's still cache.
    decoded: Vec<(String, Arc<RgbaImage>)>,
}

impl ScrubAhead {
    pub(crate) fn new(uploader: Option<Uploader>) -> ScrubAhead {
        let (ready_tx, ready) = std::sync::mpsc::channel();
        ScrubAhead {
            shared: Arc::default(),
            uploader,
            workers: Vec::new(),
            ready_tx,
            ready,
            recent: VecDeque::new(),
            direction: 1,
            indexes: HashMap::new(),
            keyframes: Budgeted::new(KEYFRAME_BUDGET),
            stills: Budgeted::new(STILL_BUDGET),
            failed: HashSet::new(),
            decoded: Vec::new(),
        }
    }

    /// The drag is at `t` (frames `size` pixels on their long side): plan what lies ahead,
    /// replacing what was planned before. `missing` are media files known not to load.
    pub(crate) fn moved(&mut self, project: &Project, t: Micros, size: u32, missing: &HashMap<String, String>) {
        let now = Instant::now();
        self.adopt();
        self.recent.push_back((t, now));
        while self.recent.len() > 2 && now - self.recent[0].1 > SPEED_WINDOW {
            self.recent.pop_front();
        }
        let span = self.span();
        let jobs: Vec<Job> = plan(project, t, span, size, &self.indexes)
            .into_iter()
            .filter(|j| !missing.contains_key(j.path()) && !self.failed.contains(j.path()))
            .filter(|j| match j {
                Job::Index { path, .. } => !self.indexes.contains_key(path),
                Job::Keyframe { path, at, .. } => !self.keyframes.contains(&(path.clone(), *at)),
                Job::Still { path, .. } => !self.stills.contains(path),
                Job::Full { .. } | Job::Upload { .. } => true,
            })
            .collect();
        if self.workers.is_empty() {
            self.start();
        }
        let mut q = self.shared.queue.lock().unwrap();
        let running = std::mem::take(&mut q.running);
        q.jobs = jobs.into_iter().filter(|j| !running.contains(&j.key())).collect();
        q.running = running;
        self.shared.cond.notify_all();
    }

    /// The timeline span the drag will cover over the look-ahead (negative: backward).
    fn span(&mut self) -> i64 {
        let (Some(&(t0, w0)), Some(&(t1, w1))) = (self.recent.front(), self.recent.back()) else { return MIN_SPAN };
        let wall = (w1 - w0).as_secs_f64();
        if t1 != t0 {
            self.direction = (t1.0 - t0.0).signum();
        }
        let ahead = if wall > 0.0 { ((t1.0 - t0.0).abs() as f64 / wall * LOOKAHEAD.as_secs_f64()) as i64 } else { 0 };
        self.direction * ahead.clamp(MIN_SPAN, MAX_SPAN)
    }

    /// Files may have been relinked: try stills that failed again.
    pub(crate) fn forget_failures(&mut self) {
        self.failed.clear();
    }

    /// The drag is over: drop what's queued and the speed measured.
    pub(crate) fn stop(&mut self) {
        self.shared.queue.lock().unwrap().jobs.clear();
        self.recent.clear();
    }

    fn start(&mut self) {
        for i in 0..WORKERS {
            let (shared, ready, uploader) = (self.shared.clone(), self.ready_tx.clone(), self.uploader.clone());
            if let Ok(w) = openrip_platform::tasks::spawn(format!("scrub-ahead-{i}"), move || work(&shared, &ready, uploader.as_ref())) {
                self.workers.push(w);
            }
        }
    }

    /// Take in what the workers have finished.
    fn adopt(&mut self) {
        while let Ok(r) = self.ready.try_recv() {
            self.take(r);
        }
    }

    fn take(&mut self, r: Ready) {
        match r {
            Ready::Index(path, keys) => {
                self.indexes.insert(path, keys);
            }
            Ready::Keyframe(path, _, Some((at, f))) => {
                let bytes = frame_bytes(&f);
                self.keyframes.insert((path, at), f, bytes);
            }
            Ready::Keyframe(..) => {}
            Ready::Still(path, Some(small)) => {
                let bytes = small.data.len();
                self.stills.insert(path, small, bytes);
            }
            Ready::Full(path, Some(full)) => self.decoded.push((path, full)),
            Ready::Still(path, None) | Ready::Full(path, None) => {
                self.failed.insert(path);
            }
            Ready::Uploaded(_) => {}
        }
    }

    /// If a worker is getting `key`, wait for it (bounded); a queued job for it is dropped,
    /// as the render thread is about to do it itself.
    fn wait_for(&mut self, key: &Key, wait: Duration) {
        let running = {
            let mut q = self.shared.queue.lock().unwrap();
            q.jobs.retain(|j| j.key() != *key);
            q.running.contains(key)
        };
        if !running {
            return;
        }
        let deadline = Instant::now() + wait;
        while let Ok(r) = self.ready.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            let done = r.key() == *key;
            self.take(r);
            if done {
                return;
            }
        }
    }

    /// The stand-in for the keyframe of `path` at index time `at`, if it's ready or being
    /// got ready.
    pub(crate) fn keyframe(&mut self, path: &str, at: Micros) -> Option<VideoFrame> {
        self.adopt();
        let key = (path.to_string(), at);
        if !self.keyframes.contains(&key) {
            self.wait_for(&Key::Keyframe(key.0.clone(), at), WAIT_KEYFRAME);
        }
        self.keyframes.get(&key).and_then(|f| f.try_clone().ok())
    }

    /// The stand-in for the still at `path`, if it's ready or being got ready.
    pub(crate) fn still(&mut self, path: &str) -> Option<Arc<RgbaImage>> {
        self.adopt();
        let key = path.to_string();
        if !self.stills.contains(&key) {
            self.wait_for(&Key::Still(key.clone()), WAIT_STILL);
        }
        self.stills.get(&key).cloned()
    }

    /// Decode these stills at full size on the workers, ahead of anything else queued, and
    /// write them to the GPU: an exact frame's stills then get ready beside its video (and
    /// each other) rather than one after another on the render thread. Collect each with
    /// [`ScrubAhead::full`].
    pub(crate) fn load_full(&mut self, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }
        if self.workers.is_empty() {
            self.start();
        }
        let mut q = self.shared.queue.lock().unwrap();
        for path in paths.into_iter().rev() {
            let job = Job::Full { path };
            if !q.running.contains(&job.key()) && !q.jobs.contains(&job) {
                q.jobs.push_front(job);
            }
        }
        self.shared.cond.notify_all();
    }

    /// Write these stills (decoded already) to the GPU on the workers, ahead of anything else
    /// queued, so they get there beside the frame's video. Without an uploader, nothing.
    pub(crate) fn upload(&mut self, stills: Vec<(String, Arc<RgbaImage>)>) {
        if stills.is_empty() || self.uploader.is_none() {
            return;
        }
        if self.workers.is_empty() {
            self.start();
        }
        let mut q = self.shared.queue.lock().unwrap();
        for (path, img) in stills.into_iter().rev() {
            let job = Job::Upload { path, picture: Picture(img) };
            if !q.running.contains(&job.key()) && !q.jobs.iter().any(|j| j.key() == job.key()) {
                q.jobs.push_front(job);
            }
        }
        self.shared.cond.notify_all();
    }

    /// If a worker is writing the still at `path` to the GPU (see [`ScrubAhead::upload`]),
    /// wait for it (bounded); a queued job for it is dropped, as the compositor will write
    /// it itself.
    pub(crate) fn uploading(&mut self, path: &str) {
        self.adopt();
        self.wait_for(&Key::Upload(path.to_string()), WAIT_UPLOAD);
    }

    /// A still decoded at full size by the workers (see [`ScrubAhead::load_full`]), waiting
    /// for it if it's being decoded; `None` if it isn't (or failed): decode it yourself.
    pub(crate) fn full(&mut self, path: &str) -> Option<Arc<RgbaImage>> {
        self.adopt();
        let find = |decoded: &mut Vec<(String, Arc<RgbaImage>)>| decoded.iter().position(|(p, _)| p == path).map(|i| decoded.swap_remove(i).1);
        if let Some(img) = find(&mut self.decoded) {
            return Some(img);
        }
        self.wait_for(&Key::Full(path.to_string()), WAIT_STILL);
        find(&mut self.decoded)
    }

    /// A stand-in the render thread made itself.
    pub(crate) fn insert_still(&mut self, path: &str, small: Arc<RgbaImage>) {
        let bytes = small.data.len();
        self.stills.insert(path.to_string(), small, bytes);
    }

    /// Note a video's keyframes (see [`stand_in_keys`]), from a decoder the render thread has
    /// open; empty: none are got ready.
    pub(crate) fn learn_index(&mut self, path: &str, keys: impl FnOnce() -> Vec<Micros>) {
        if !self.indexes.contains_key(path) {
            let keys = keys();
            self.indexes.insert(path.to_string(), (!keys.is_empty()).then(|| Arc::new(keys)));
        }
    }

    /// Full-size stills the workers decoded since the last call.
    pub(crate) fn take_decoded(&mut self) -> Vec<(String, Arc<RgbaImage>)> {
        self.adopt();
        std::mem::take(&mut self.decoded)
    }
}

impl Drop for ScrubAhead {
    fn drop(&mut self) {
        {
            let mut q = self.shared.queue.lock().unwrap();
            q.quit = true;
            q.jobs.clear();
        }
        self.shared.cond.notify_all();
        for w in self.workers.drain(..) {
            let _ = w.join();
        }
    }
}

/// A worker: takes jobs off the queue until told to quit.
fn work(shared: &Shared, ready: &Sender<Ready>, uploader: Option<&Uploader>) {
    // (path, size, decoder), most recently used last.
    let mut decoders: Vec<(String, u32, VideoDecoder)> = Vec::new();
    loop {
        let job = {
            let mut q = shared.queue.lock().unwrap();
            loop {
                if q.quit {
                    return;
                }
                if let Some(job) = q.jobs.pop_front() {
                    q.running.insert(job.key());
                    break job;
                }
                q = shared.cond.wait(q).unwrap();
            }
        };
        let out = match &job {
            Job::Index { path, size } => Ready::Index(path.clone(), decoder(&mut decoders, path, *size).map(|d| stand_in_keys(d)).filter(|k| !k.is_empty()).map(Arc::new)),
            Job::Keyframe { path, at, seek, size } => Ready::Keyframe(
                path.clone(),
                *at,
                decoder(&mut decoders, path, *size).and_then(|d| {
                    let f = d.keyframe_at(*seek).ok().flatten()?;
                    Some((d.keyframe_time(f.time).unwrap_or(*at), f))
                }),
            ),
            Job::Still { path, size } => Ready::Still(
                path.clone(),
                // The full picture isn't kept: the exact frame decodes it again beside its
                // video, and a drag goes through dozens of 33 MB stills a second.
                crate::preview::load_still(Path::new(path)).ok().map(|full| {
                    let k = shrink_factor(full.width, full.height, *size);
                    Arc::new(if k > 1 { shrink(&full, k) } else { full })
                }),
            ),
            Job::Full { path } => Ready::Full(
                path.clone(),
                crate::preview::load_still(Path::new(path)).ok().map(|full| {
                    if let Some(u) = uploader {
                        u.upload(crate::preview::still_key(path), &full);
                    }
                    Arc::new(full)
                }),
            ),
            Job::Upload { path, picture } => {
                if let Some(u) = uploader {
                    u.upload(crate::preview::still_key(path), &picture.0);
                }
                Ready::Uploaded(path.clone())
            }
        };
        // Sent before it stops counting as running, so a render thread that finds it not
        // running has it in the channel (see `wait_for`).
        let _ = ready.send(out);
        shared.queue.lock().unwrap().running.remove(&job.key());
    }
}

/// The keyframes worth getting ready for a video: all of them when VideoToolbox decodes it
/// natively (small, quick stand-ins), none otherwise (software-decoded frames come at full
/// size; ProRes, intra-only, would plan every frame).
pub(crate) fn stand_in_keys(d: &VideoDecoder) -> Vec<Micros> {
    if d.native_videotoolbox() {
        d.keyframe_times()
    } else {
        Vec::new()
    }
}

/// A worker's decoder for `path` at `size`, opened if need be (closing the least recently
/// used beyond `WORKER_DECODERS`).
fn decoder<'a>(decoders: &'a mut Vec<(String, u32, VideoDecoder)>, path: &str, size: u32) -> Option<&'a mut VideoDecoder> {
    match decoders.iter().position(|(p, s, _)| p == path && *s == size) {
        Some(i) => {
            let d = decoders.remove(i);
            decoders.push(d);
        }
        None => {
            let d = VideoDecoder::open(Path::new(path), &DecoderOptions { cache_bytes: 0, shrink_to: size, ..Default::default() }).ok()?;
            if decoders.len() >= WORKER_DECODERS {
                decoders.remove(0);
            }
            decoders.push((path.to_string(), size, d));
        }
    }
    decoders.last_mut().map(|(_, _, d)| d)
}

/// What a drag at `t` will need over the next `span` of the timeline (negative: backward),
/// nearest first: the stills and video keyframes of visible video-track clips, shrunk toward
/// `size` pixels. Videos whose keyframe index isn't known yet get an index job instead.
pub(crate) fn plan(project: &Project, t: Micros, span: i64, size: u32, indexes: &HashMap<String, Option<Arc<Vec<Micros>>>>) -> Vec<Job> {
    let end = project.duration().0;
    let step = if span >= 0 { (span / SAMPLES).max(1) } else { (span / SAMPLES).min(-1) };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for i in 0..=SAMPLES {
        let at = Micros((t.0 + i * step).clamp(0, end.max(0)));
        for track in project.tracks.iter().filter(|tr| tr.kind == TrackKind::Video && !tr.hidden) {
            for seg in track.segments.iter().filter(|s| s.visible && s.target.contains(at)) {
                let Some(media) = project.materials.media.iter().find(|m| m.id == seg.material && m.kind != MediaKind::Audio) else { continue };
                let path = media.path.clone();
                let job = if media.kind == MediaKind::Photo {
                    Job::Still { path, size }
                } else {
                    match indexes.get(&path) {
                        None => Job::Index { path, size },
                        Some(None) => continue,
                        Some(Some(keys)) => {
                            let Some(source) = seg.source_time(at) else { continue };
                            // The keyframe at or before (as the decoder finds it), and the
                            // middle of its GOP to seek to.
                            let i = keys.partition_point(|k| *k <= source);
                            let Some(&key) = keys.get(i.wrapping_sub(1)) else { continue };
                            let seek = Micros((key.0 + keys.get(i).map_or(key.0 + 1_000_000, |k| k.0)) / 2);
                            Job::Keyframe { path, at: key, seek, size }
                        }
                    }
                };
                if seen.insert(job.key()) {
                    out.push(job);
                    if out.len() >= MAX_JOBS {
                        return out;
                    }
                }
            }
        }
    }
    out
}

/// The whole factor to shrink a `w`×`h` picture by so its long side stays at least `size`.
pub(crate) fn shrink_factor(w: u32, h: u32, size: u32) -> u32 {
    if size == 0 {
        1
    } else {
        (w.max(h) / size).max(1)
    }
}

/// The alpha bytes of four RGBA pixels read as one little-endian number.
const ALPHA: u128 = 0xff00_0000_ff00_0000_ff00_0000_ff00_0000;

/// `img` made `k` times smaller on each side by averaging each k×k block (partial blocks at
/// the edges). Colours are weighted by their alpha, so clear pixels' colours don't bleed in.
pub(crate) fn shrink(img: &RgbaImage, k: u32) -> RgbaImage {
    let k = k.max(1) as usize;
    let (sw, sh) = (img.width as usize, img.height as usize);
    let (w, h) = (sw.div_ceil(k), sh.div_ceil(k));
    let mut data = vec![0u8; w * h * 4];
    let mut sums = vec![[0u32; 4]; w];
    for y in 0..h {
        sums.iter_mut().for_each(|s| *s = [0; 4]);
        let rows = (y * k)..((y + 1) * k).min(sh);
        let n_rows = rows.len();
        let add = |s: &mut [u32; 4], px: &[u8]| {
            let a = px[3] as u32;
            s[0] += px[0] as u32 * a;
            s[1] += px[1] as u32 * a;
            s[2] += px[2] as u32 * a;
            s[3] += a;
        };
        for row in rows {
            let line = &img.data[row * sw * 4..(row + 1) * sw * 4];
            for (s, block) in sums.iter_mut().zip(line.chunks(4 * k)) {
                // Four pixels at a time, skipped when all clear (they add nothing, and
                // stills such as subtitles are mostly clear).
                let mut quads = block.chunks_exact(16);
                for q in &mut quads {
                    if u128::from_le_bytes(q.try_into().unwrap()) & ALPHA == 0 {
                        continue;
                    }
                    q.chunks_exact(4).for_each(|px| add(s, px));
                }
                quads.remainder().chunks_exact(4).for_each(|px| add(s, px));
            }
        }
        for (x, s) in sums.iter().enumerate() {
            let n = (n_rows * (((x + 1) * k).min(sw) - x * k)) as u32;
            let o = (y * w + x) * 4;
            if s[3] > 0 {
                for c in 0..3 {
                    data[o + c] = ((s[c] + s[3] / 2) / s[3]) as u8;
                }
            }
            data[o + 3] = ((s[3] + n / 2) / n) as u8;
        }
    }
    RgbaImage { width: w as u32, height: h as u32, data }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openrip_model::{Animated, Canvas, FrameRate, Media, MaterialId, Segment, TimeRange, Track};

    fn project() -> Project {
        let mut p = Project::new("p", "p", Canvas { width: 1080, height: 1920 }, FrameRate::from_f64(30.0));
        let seg = |id: &str, material: &str, start: i64, len: i64, source: i64| Segment {
            id: id.into(),
            material: MaterialId(material.into()),
            source: Some(TimeRange::new(Micros(source), Micros(len))),
            target: TimeRange::new(Micros(start), Micros(len)),
            speed: 1.0,
            reverse: false,
            change_pitch: false,
            visible: true,
            render_index: 0,
            transform: Default::default(),
            crop: None,
            opacity: Animated::constant(1.0),
            volume: Animated::constant(1.0),
            attachments: Vec::new(),
        };
        // A 20 s video from 10 s into its file, and stills of 1 s each above it.
        p.tracks.push(Track { id: "v".into(), kind: TrackKind::Video, name: String::new(), segments: vec![seg("v1", "video", 0, 20_000_000, 10_000_000)], muted: false, hidden: false, locked: false });
        let stills = (0..20).map(|i| seg(&format!("s{i}"), &format!("photo{i}"), i * 1_000_000, 1_000_000, 0)).collect();
        p.tracks.push(Track { id: "s".into(), kind: TrackKind::Video, name: String::new(), segments: stills, muted: false, hidden: false, locked: false });
        let media = |id: &str, kind: MediaKind| Media { id: MaterialId(id.into()), path: format!("/{id}"), kind, width: 0, height: 0, duration: Micros(60_000_000), has_audio: false, matte: None };
        p.materials.media.push(media("video", MediaKind::Video));
        for i in 0..20 {
            p.materials.media.push(media(&format!("photo{i}"), MediaKind::Photo));
        }
        p
    }

    #[test]
    fn an_unindexed_video_is_opened_first() {
        let jobs = plan(&project(), Micros(2_500_000), 1_000_000, 960, &HashMap::new());
        assert_eq!(jobs[0], Job::Index { path: "/video".into(), size: 960 });
        assert_eq!(jobs[1], Job::Still { path: "/photo2".into(), size: 960 });
    }

    #[test]
    fn the_plan_follows_the_drag_nearest_first() {
        // Keyframes every second of the file.
        let keys: Vec<Micros> = (0..40).map(|s| Micros(s * 1_000_000)).collect();
        let indexes = HashMap::from([("/video".to_string(), Some(Arc::new(keys)))]);
        let p = project();
        let path = |j: &Job| match j {
            Job::Keyframe { at, .. } => format!("key {}", at.0 / 1_000_000),
            Job::Still { path, .. } => path.clone(),
            Job::Index { .. } => "index".into(),
            Job::Full { .. } | Job::Upload { .. } => "full".into(),
        };
        // Forward over 3 s from 2.5 s: timeline 2.5 s is 12.5 s into the file.
        let jobs = plan(&p, Micros(2_500_000), 3_000_000, 960, &indexes);
        let fwd: Vec<String> = jobs.iter().map(path).collect();
        assert_eq!(fwd, ["key 12", "/photo2", "key 13", "/photo3", "key 14", "/photo4", "key 15", "/photo5"]);
        // Each keyframe is sought in the middle of its GOP.
        assert_eq!(jobs[0], Job::Keyframe { path: "/video".into(), at: Micros(12_000_000), seek: Micros(12_500_000), size: 960 });
        // Backward over 2 s.
        let back: Vec<String> = plan(&p, Micros(2_500_000), -2_000_000, 960, &indexes).iter().map(path).collect();
        assert_eq!(back, ["key 12", "/photo2", "key 11", "/photo1", "key 10", "/photo0"]);
    }

    #[test]
    fn hidden_tracks_and_unindexable_videos_plan_nothing() {
        let mut p = project();
        p.tracks[1].hidden = true;
        let indexes = HashMap::from([("/video".to_string(), None)]);
        assert!(plan(&p, Micros(0), 5_000_000, 960, &indexes).is_empty());
    }

    #[test]
    fn the_plan_is_bounded() {
        let mut p = project();
        // Two hundred 0.1 s stills.
        let base = p.tracks[1].segments[0].clone();
        p.tracks[1].segments = (0..200).map(|i| Segment { id: format!("s{i}"), target: TimeRange::new(Micros(i * 100_000), Micros(100_000)), ..base.clone() }).collect();
        assert!(plan(&p, Micros(0), MAX_SPAN, 960, &HashMap::new()).len() <= MAX_JOBS);
    }

    #[test]
    fn the_span_follows_the_drags_speed_and_direction() {
        let mut s = ScrubAhead::new(None);
        let t0 = Instant::now();
        // 2 s of timeline in 100 ms: 6 s over the look-ahead.
        s.recent = VecDeque::from([(Micros(1_000_000), t0), (Micros(3_000_000), t0 + Duration::from_millis(100))]);
        assert_eq!(s.span(), 6_000_000);
        // Slow drags still look a second ahead; backward drags look back.
        s.recent = VecDeque::from([(Micros(3_000_000), t0), (Micros(2_990_000), t0 + Duration::from_millis(100))]);
        assert_eq!(s.span(), -MIN_SPAN);
        // A pause keeps the last direction.
        s.recent = VecDeque::from([(Micros(2_990_000), t0), (Micros(2_990_000), t0 + Duration::from_millis(100))]);
        assert_eq!(s.span(), -MIN_SPAN);
        // Very fast drags are capped.
        s.recent = VecDeque::from([(Micros(0), t0), (Micros(60_000_000), t0 + Duration::from_millis(50))]);
        assert_eq!(s.span(), MAX_SPAN);
    }

    #[test]
    fn shrinking_averages_blocks_by_alpha() {
        // 3×2: an opaque red pixel beside a clear green one, then a half-clear blue pair,
        // and a column left over.
        let px = |c: [u8; 4]| c.to_vec();
        let data = [px([255, 0, 0, 255]), px([0, 255, 0, 0]), px([9, 9, 9, 255]), px([0, 0, 255, 128]), px([0, 0, 255, 128]), px([9, 9, 9, 255])].concat();
        let img = RgbaImage { width: 3, height: 2, data };
        let s = shrink(&img, 2);
        assert_eq!((s.width, s.height), (2, 1));
        // The clear green doesn't tint the block; alpha is the block's average.
        let a = 255 + 128 * 2;
        assert_eq!(&s.data[..4], &[((255 * 255 + a / 2) / a) as u8, 0, ((255 * 256 + a / 2) / a) as u8, ((a + 2) / 4) as u8]);
        // The partial block averages only its own two pixels.
        assert_eq!(&s.data[4..], &[9, 9, 9, 255]);
        // Clear blocks stay clear.
        let clear = shrink(&RgbaImage { width: 2, height: 2, data: vec![7; 16].iter().enumerate().map(|(i, v)| if i % 4 == 3 { 0 } else { *v }).collect() }, 2);
        assert_eq!(clear.data, [0, 0, 0, 0]);
    }

    #[test]
    fn shrink_factor_keeps_at_least_the_size() {
        assert_eq!(shrink_factor(2160, 3840, 900), 4);
        assert_eq!(shrink_factor(1920, 1080, 960), 2);
        assert_eq!(shrink_factor(1920, 1080, 1100), 1);
        assert_eq!(shrink_factor(640, 480, 0), 1);
    }

    #[test]
    fn stills_to_write_to_the_gpu() {
        let a = Arc::new(RgbaImage { width: 1, height: 1, data: vec![0; 4] });
        let b = Arc::new((*a).clone());
        // Jobs hold the decoded still itself, compared by identity rather than by pixels.
        assert_eq!(Picture(a.clone()), Picture(a.clone()));
        assert_ne!(Picture(a.clone()), Picture(b));
        // Without an uploader there's nothing to do, and no workers start for it.
        let mut s = ScrubAhead::new(None);
        s.upload(vec![("/photo0".into(), a)]);
        assert!(s.workers.is_empty() && s.shared.queue.lock().unwrap().jobs.is_empty());
    }

    #[test]
    fn budgeted_drops_the_least_recently_used() {
        let mut b = Budgeted::new(30);
        b.insert("a", 1, 10);
        b.insert("b", 2, 10);
        b.insert("c", 3, 10);
        assert_eq!(b.get(&"a"), Some(&1));
        b.insert("d", 4, 10);
        assert!(!b.contains(&"b"), "b was used least recently");
        assert!(b.contains(&"a") && b.contains(&"c") && b.contains(&"d"));
        // One entry over the budget on its own stays.
        b.insert("big", 5, 100);
        assert_eq!(b.get(&"big"), Some(&5));
        assert_eq!(b.entries.len(), 1);
    }
}
