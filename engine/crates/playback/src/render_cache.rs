//! Pre-rendered chunks of the timeline (CapCut's Render menu).
//!
//! The picture of a timeline range is composited once into short files in the app's cache
//! folder; preview playback and seeking then decode those files (a fast intermediate: ProRes
//! where the platform encoder has it, else high-bitrate H.264) instead of compositing the
//! clips, effects and text again.
//!
//! The timeline is cut into chunks of [`CHUNK_SECONDS`] seconds, counted in whole frames from
//! 0. A chunk is stored under a content key: a hash of everything that decides its frames (the
//! canvas, the frame rate, the render size, and every visible segment whose influence reaches
//! the chunk, with its materials and the files they read). An edit changes the keys of the
//! chunks it touches and no others, so the others stay rendered; the old files of the changed
//! ones are never asked for again and go with the cache's size limit. Nothing needs telling
//! that a chunk went stale.
//!
//! The index (key, file, size per chunk) is kept beside the files and read again at the next
//! start, so a chunk still valid after a restart is reused. A file the index lists but the
//! disk lacks (the cache was cleared or trimmed from outside) is dropped when it is looked up.
//!
//! Export never reads these files: it composites from the sources, so an export is not
//! affected by the intermediate's compression.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use openrip_model::{FrameRate, MaterialRef, Micros, Project, Segment, Track, TrackKind};
use serde::{Deserialize, Serialize};

/// Length of a chunk, in seconds (rounded to whole frames).
pub const CHUNK_SECONDS: f64 = 2.0;

/// Bumped when the compositor's output changes in a way the project does not show (a shader
/// fix, a different colour path), so chunks drawn before it are not shown.
pub const RENDER_VERSION: u32 = 1;

/// The longest side a chunk is rendered at; the preview is never shown larger than this.
const MAX_LONG_SIDE: u32 = 1920;

/// The size a canvas is pre-rendered at: its aspect, at most [`MAX_LONG_SIDE`] on the long
/// side, both sides even (the encoder wants it).
pub fn render_size(canvas_w: u32, canvas_h: u32) -> (u32, u32) {
    let (w, h) = (canvas_w.max(2) as f64, canvas_h.max(2) as f64);
    let scale = (MAX_LONG_SIDE as f64 / w.max(h)).min(1.0);
    let even = |v: f64| ((v * scale).round() as u32).max(2) & !1;
    (even(w), even(h))
}

/// Frames in a chunk at `fps`.
pub fn chunk_frames(fps: FrameRate) -> i64 {
    ((fps.as_f64() * CHUNK_SECONDS).round() as i64).max(1)
}

/// One chunk of the timeline.
#[derive(Clone, Debug, PartialEq)]
pub struct ChunkSpec {
    pub index: i64,
    /// First frame of the timeline in it, and how many (the last chunk may be short).
    pub first: i64,
    pub frames: i64,
    /// Time of its first frame, and of the end of its last.
    pub start: Micros,
    pub end: Micros,
    /// What its frames depend on; `None` when nothing is drawn in it (there is nothing to
    /// render).
    pub key: Option<u64>,
}

/// The timeline cut into chunks, with each chunk's key (see the module docs).
#[derive(Clone, Debug)]
pub struct Plan {
    pub fps: FrameRate,
    pub size: (u32, u32),
    pub per_chunk: i64,
    pub chunks: Vec<ChunkSpec>,
}

impl Plan {
    /// The chunk the frame at `t` is in.
    pub fn chunk_at(&self, t: Micros) -> Option<&ChunkSpec> {
        let n = self.fps.frame_of(t);
        if n < 0 {
            return None;
        }
        self.chunks.get((n / self.per_chunk) as usize)
    }
}

/// A 64-bit FNV-1a hash with a final mix: stable across runs and toolchains (the index is kept
/// on disk), which `std`'s hashers do not promise.
struct Hasher(u64);

impl Hasher {
    fn new() -> Hasher {
        Hasher(0xcbf29ce484222325)
    }
    fn bytes(&mut self, b: &[u8]) {
        for &x in b {
            self.0 ^= x as u64;
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
        // Separate what follows from what came before ("ab","c" differs from "a","bc").
        self.0 ^= 0xff;
        self.0 = self.0.wrapping_mul(0x100000001b3);
    }
    fn u64(&mut self, v: u64) {
        self.bytes(&v.to_le_bytes());
    }
    fn finish(&self) -> u64 {
        let mut h = self.0;
        h ^= h >> 33;
        h = h.wrapping_mul(0xff51afd7ed558ccd);
        h ^= h >> 33;
        h = h.wrapping_mul(0xc4ceb9fe1a85ec53);
        h ^ (h >> 33)
    }
}

/// How the segments' files are looked at: size and modification time, remembered a moment so
/// planning a long project does not stat the same file for every segment.
struct Stats {
    seen: HashMap<String, (Instant, u64)>,
}

impl Stats {
    fn of(&mut self, path: &str) -> u64 {
        if let Some((at, v)) = self.seen.get(path) {
            if at.elapsed() < Duration::from_secs(2) {
                return *v;
            }
        }
        let v = match std::fs::metadata(path) {
            Ok(m) => {
                let mtime = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() as u64);
                let mut h = Hasher::new();
                h.u64(m.len());
                h.u64(mtime);
                h.finish()
            }
            Err(_) => 0,
        };
        self.seen.insert(path.to_string(), (Instant::now(), v));
        v
    }
}

/// Every file a JSON value names (an absolute path) goes into the hash with its size and time,
/// so a changed or replaced file changes the key.
fn feed_files(h: &mut Hasher, stats: &mut Stats, v: &serde_json::Value) {
    match v {
        serde_json::Value::String(s) if s.starts_with('/') || s.get(1..3) == Some(":\\") => h.u64(stats.of(s)),
        serde_json::Value::Array(a) => a.iter().for_each(|x| feed_files(h, stats, x)),
        serde_json::Value::Object(o) => o.values().for_each(|x| feed_files(h, stats, x)),
        _ => {}
    }
}

fn feed_json<T: Serialize>(h: &mut Hasher, stats: &mut Stats, v: &T) {
    let value = serde_json::to_value(v).unwrap_or(serde_json::Value::Null);
    h.bytes(value.to_string().as_bytes());
    feed_files(h, stats, &value);
}

/// A segment with everything it draws from: its materials (a compound's whole content too).
fn feed_segment(h: &mut Hasher, stats: &mut Stats, p: &Project, s: &Segment, depth: u32) {
    feed_json(h, stats, s);
    if depth > 8 {
        return;
    }
    for id in std::iter::once(&s.material).chain(s.attachments.iter()) {
        match p.materials.get(id) {
            Some(MaterialRef::Compound(c)) => {
                feed_json(h, stats, &c.id);
                for t in &c.tracks {
                    h.u64(t.hidden as u64);
                    for inner in &t.segments {
                        feed_segment(h, stats, p, inner, depth + 1);
                    }
                }
            }
            Some(m) => feed_json(h, stats, &m.to_owned_material()),
            None => h.bytes(b"missing"),
        }
    }
}

fn draws(t: &Track) -> bool {
    matches!(t.kind, TrackKind::Video | TrackKind::Text | TrackKind::Sticker | TrackKind::Filter | TrackKind::Effect | TrackKind::Graphic | TrackKind::Adjustment) && !t.hidden
}

/// The part of the timeline a segment can change: its own, and a transition's reach either
/// side of it.
fn influence(p: &Project, s: &Segment) -> (Micros, Micros) {
    let mut reach = 0;
    for id in &s.attachments {
        if let Some(MaterialRef::Transition(t)) = p.materials.get(id) {
            reach = reach.max(t.duration.0);
        }
    }
    (Micros(s.target.start.0 - reach), Micros(s.target.end().0 + reach))
}

/// Cut `project`'s timeline into chunks and key each (see the module docs).
pub fn plan(project: &Project) -> Plan {
    let mut stats = Stats { seen: HashMap::new() };
    plan_with(project, &mut stats)
}

fn plan_with(project: &Project, stats: &mut Stats) -> Plan {
    let fps = project.fps;
    let size = render_size(project.canvas.width, project.canvas.height);
    let per = chunk_frames(fps);
    let duration = project.duration();
    let total = if duration.0 > 0 { fps.frame_of(Micros(duration.0 - 1)).max(0) + 1 } else { 0 };
    // Each visible segment's reach and hash (with its track's place in the stack).
    let mut parts: Vec<(Micros, Micros, u64)> = Vec::new();
    for (ti, t) in project.tracks.iter().enumerate() {
        if !draws(t) {
            continue;
        }
        for s in t.segments.iter().filter(|s| s.visible) {
            let mut h = Hasher::new();
            h.u64(ti as u64);
            h.u64(t.kind as u64);
            feed_segment(&mut h, stats, project, s, 0);
            let (a, b) = influence(project, s);
            parts.push((a, b, h.finish()));
        }
    }
    let mut chunks = Vec::new();
    let mut first = 0;
    while first < total {
        let frames = per.min(total - first);
        let (start, end) = (fps.frame_start(first), fps.frame_start(first + frames));
        let mut h = Hasher::new();
        h.u64(RENDER_VERSION as u64);
        h.u64(project.canvas.width as u64);
        h.u64(project.canvas.height as u64);
        h.u64(fps.num as u64);
        h.u64(fps.den as u64);
        h.u64(size.0 as u64);
        h.u64(size.1 as u64);
        h.u64(first as u64);
        h.u64(frames as u64);
        let mut any = false;
        for (a, b, k) in &parts {
            if *a < end && *b > start {
                h.u64(*k);
                any = true;
            }
        }
        chunks.push(ChunkSpec { index: first / per, first, frames, start, end, key: any.then(|| h.finish()) });
        first += frames;
    }
    Plan { fps, size, per_chunk: per, chunks }
}

/// A pre-rendered chunk.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub key: u64,
    /// File name inside the cache's folder.
    pub file: String,
    pub first: i64,
    pub frames: i64,
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub bytes: u64,
    /// Seconds since the epoch it was last shown.
    pub used: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    version: u32,
    entries: Vec<Entry>,
}

#[derive(Default)]
struct Inner {
    /// The folder the chunks and the index are in; none until the app sets one.
    dir: Option<PathBuf>,
    entries: HashMap<u64, Entry>,
}

/// What the chunk cache has done, for tests and the trace.
#[derive(Copy, Clone, Debug, Default)]
pub struct CacheStats {
    /// Preview frames taken from a chunk, and frames that had to be composited.
    pub hits: u64,
    pub misses: u64,
}

/// The pre-render cache: an index of chunk files in one folder.
pub struct RenderCache {
    inner: Mutex<Inner>,
    /// Preview frames are taken from chunks (on by default; off to see the composited frames).
    enabled: AtomicBool,
    hits: AtomicU64,
    misses: AtomicU64,
    /// Counts every change that can take a chunk's file away (clearing, removing, a new
    /// folder), so a reader holding a file open knows to look again.
    generation: AtomicU64,
    stats: Mutex<Option<Stats>>,
}

impl Default for RenderCache {
    fn default() -> Self {
        RenderCache::new()
    }
}

/// The folder inside the cache's folder the chunks are kept in.
const SUBDIR: &str = "prerender";

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

impl RenderCache {
    pub fn new() -> RenderCache {
        RenderCache { inner: Mutex::new(Inner::default()), enabled: AtomicBool::new(true), hits: AtomicU64::new(0), misses: AtomicU64::new(0), generation: AtomicU64::new(0), stats: Mutex::new(None) }
    }

    /// The process's cache, which the preview engines of an open project read.
    pub fn global() -> &'static RenderCache {
        static CACHE: OnceLock<RenderCache> = OnceLock::new();
        CACHE.get_or_init(RenderCache::new)
    }

    /// Keep chunks under `dir` (in a folder of its own), and read the index a previous run left
    /// there.
    pub fn set_dir(&self, dir: &Path) {
        let dir = dir.join(SUBDIR);
        let _ = std::fs::create_dir_all(&dir);
        let index: Index = std::fs::read(dir.join("index.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let mut inner = self.inner.lock().unwrap();
        inner.entries = if index.version == RENDER_VERSION { index.entries.into_iter().map(|e| (e.key, e)).collect() } else { HashMap::new() };
        inner.dir = Some(dir);
        self.generation.fetch_add(1, Ordering::Relaxed);
    }

    /// Whether there is a folder to keep chunks in.
    pub fn has_dir(&self) -> bool {
        self.inner.lock().unwrap().dir.is_some()
    }

    pub fn set_enabled(&self, on: bool) {
        self.enabled.store(on, Ordering::Relaxed);
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Relaxed)
    }

    /// Whether no chunk is stored (nothing to look up).
    pub fn is_empty(&self) -> bool {
        self.inner.lock().unwrap().entries.is_empty()
    }

    pub fn stats(&self) -> CacheStats {
        CacheStats { hits: self.hits.load(Ordering::Relaxed), misses: self.misses.load(Ordering::Relaxed) }
    }

    pub(crate) fn count(&self, hit: bool) {
        (if hit { &self.hits } else { &self.misses }).fetch_add(1, Ordering::Relaxed);
    }

    /// [`plan`] with the file look-ups remembered between calls.
    pub fn plan(&self, project: &Project) -> Plan {
        let mut guard = self.stats.lock().unwrap();
        let stats = guard.get_or_insert_with(|| Stats { seen: HashMap::new() });
        plan_with(project, stats)
    }

    /// Where a chunk's file is (or would be).
    pub fn path_of(&self, key: u64) -> Option<PathBuf> {
        self.inner.lock().unwrap().dir.as_ref().map(|d| d.join(format!("{key:016x}.mov")))
    }

    /// The chunk stored under `key`, if its file is still there.
    pub fn lookup(&self, key: u64) -> Option<Entry> {
        let mut inner = self.inner.lock().unwrap();
        let dir = inner.dir.clone()?;
        let e = inner.entries.get_mut(&key)?;
        if std::fs::metadata(dir.join(&e.file)).is_ok_and(|m| m.len() > 0) {
            e.used = now_secs();
            Some(e.clone())
        } else {
            inner.entries.remove(&key);
            self.generation.fetch_add(1, Ordering::Relaxed);
            None
        }
    }

    /// Note a finished chunk and write the index.
    pub fn insert(&self, entry: Entry) {
        let mut inner = self.inner.lock().unwrap();
        inner.entries.insert(entry.key, entry);
        Self::save(&inner);
    }

    /// Forget a chunk that could not be read, and delete its file.
    pub fn remove(&self, key: u64) {
        let mut inner = self.inner.lock().unwrap();
        self.generation.fetch_add(1, Ordering::Relaxed);
        if let (Some(e), Some(dir)) = (inner.entries.remove(&key), inner.dir.clone()) {
            let _ = std::fs::remove_file(dir.join(e.file));
            Self::save(&inner);
        }
    }

    /// Delete every chunk file and the index (and forget them).
    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap();
        self.generation.fetch_add(1, Ordering::Relaxed);
        inner.entries.clear();
        if let Some(dir) = &inner.dir {
            if let Ok(rd) = std::fs::read_dir(dir) {
                for f in rd.flatten() {
                    let _ = std::fs::remove_file(f.path());
                }
            }
        }
    }

    /// Bytes the chunk files take.
    pub fn bytes(&self) -> u64 {
        let inner = self.inner.lock().unwrap();
        let Some(dir) = &inner.dir else { return 0 };
        std::fs::read_dir(dir).map_or(0, |rd| rd.flatten().filter_map(|f| f.metadata().ok()).map(|m| m.len()).sum())
    }

    fn save(inner: &Inner) {
        let Some(dir) = &inner.dir else { return };
        let mut entries: Vec<Entry> = inner.entries.values().cloned().collect();
        entries.sort_by_key(|e| e.key);
        let Ok(json) = serde_json::to_vec(&Index { version: RENDER_VERSION, entries }) else { return };
        let tmp = dir.join("index.json.part");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, dir.join("index.json"));
        }
    }

    /// The chunks of `plan` that are rendered and still valid.
    pub fn rendered<'a>(&self, plan: &'a Plan) -> Vec<&'a ChunkSpec> {
        plan.chunks.iter().filter(|c| c.key.is_some_and(|k| self.lookup(k).is_some())).collect()
    }

    /// The time ranges of `project` that are rendered, neighbouring chunks joined.
    pub fn rendered_ranges(&self, project: &Project) -> Vec<(Micros, Micros)> {
        let plan = self.plan(project);
        let mut out: Vec<(Micros, Micros)> = Vec::new();
        for c in self.rendered(&plan) {
            match out.last_mut() {
                Some(last) if last.1 == c.start => last.1 = c.end,
                _ => out.push((c.start, c.end)),
            }
        }
        out
    }
}
