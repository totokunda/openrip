//! The preview pipeline: renders ahead of the playhead so a slow frame doesn't reach the
//! screen.
//!
//! A worker thread owns the [`PreviewEngine`]. While playing it renders the frames due over
//! the next few frame times, by the given clock (the audio [`crate::Player`] in the app),
//! into a pool of surfaces (IOSurfaces on Apple platforms, see `openrip_render::Surface`).
//! The display takes [`PreviewPipeline::frame`] for the clock time of each refresh: the
//! newest frame due, with older ones dropped. Paused, it renders the requested time at once
//! (newest request wins).

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;

use openrip_model::{FrameRate, Micros, Project};
use openrip_platform::tasks::{self, Task};
pub use openrip_render::Surface;

use crate::{PreviewEngine, PreviewError};

/// Frames rendered ahead of the clock while playing.
const AHEAD: usize = 4;

pub struct RenderedFrame {
    pub time: Micros,
    pub surface: Surface,
    pub render_ms: f64,
}

/// Where the playhead is.
pub type Clock = Arc<dyn Fn() -> Micros + Send + Sync>;

enum Mode {
    Paused { want: Option<Micros> },
    Playing { clock: Clock },
}

struct State {
    mode: Mode,
    fps: FrameRate,
    size: (u32, u32),
    /// An edited project for the worker to switch to.
    project: Option<Project>,
    /// The last time rendered while paused (re-rendered after an edit).
    last: Option<Micros>,
    ready: VecDeque<RenderedFrame>,
    free: Vec<Surface>,
    /// The next frame index to render while playing.
    next: Option<i64>,
    generation: u64,
    quit: bool,
    stats: PipelineStats,
}

#[derive(Copy, Clone, Debug, Default)]
pub struct PipelineStats {
    pub rendered: u64,
    /// Rendered frames that were never shown (the clock passed them first).
    pub dropped: u64,
    /// Display requests with nothing due yet.
    pub empty: u64,
}

struct Shared {
    state: Mutex<State>,
    cond: Condvar,
}

pub struct PreviewPipeline {
    shared: Arc<Shared>,
    worker: Option<Task>,
}

impl PreviewPipeline {
    pub fn new(project: Project, width: u32, height: u32) -> Result<Self, PreviewError> {
        let fps = project.fps;
        let mut engine = PreviewEngine::new(project)?;
        engine.use_render_cache(true);
        let shared = Arc::new(Shared {
            state: Mutex::new(State { mode: Mode::Paused { want: None }, fps, size: (width, height), project: None, last: None, ready: VecDeque::new(), free: Vec::new(), next: None, generation: 0, quit: false, stats: Default::default() }),
            cond: Condvar::new(),
        });
        let worker = {
            let shared = shared.clone();
            tasks::spawn("preview-render", move || run(&mut engine, &shared)).map_err(PreviewError::Worker)?
        };
        Ok(PreviewPipeline { shared, worker: Some(worker) })
    }

    /// Switch to an edited project. Open decoders stay warm; frames rendered from the old
    /// project are dropped, and while paused the current frame is rendered again.
    pub fn set_project(&self, project: Project) {
        let mut st = self.shared.state.lock().unwrap();
        st.fps = project.fps;
        st.project = Some(project);
        st.generation += 1;
        let drained: Vec<_> = st.ready.drain(..).map(|f| f.surface).collect();
        st.free.extend(drained);
        let (fps, last) = (st.fps, st.last);
        match &mut st.mode {
            Mode::Paused { want } => *want = want.or(last),
            Mode::Playing { clock } => {
                let n = fps.frame_of(clock());
                st.next = Some(n);
            }
        }
        self.shared.cond.notify_all();
    }

    /// Show the frame at `t` (paused): rendered at once, newest request wins.
    pub fn seek(&self, t: Micros) {
        let mut st = self.shared.state.lock().unwrap();
        st.mode = Mode::Paused { want: Some(t) };
        st.generation += 1;
        let drained: Vec<_> = st.ready.drain(..).map(|f| f.surface).collect();
        st.free.extend(drained);
        self.shared.cond.notify_all();
    }

    /// Play by `clock`: frames are rendered ahead of it.
    pub fn play(&self, clock: Clock) {
        let mut st = self.shared.state.lock().unwrap();
        st.next = Some(st.fps.frame_of(clock()));
        st.mode = Mode::Playing { clock };
        st.generation += 1;
        let drained: Vec<_> = st.ready.drain(..).map(|f| f.surface).collect();
        st.free.extend(drained);
        self.shared.cond.notify_all();
    }

    pub fn resize(&self, width: u32, height: u32) {
        let mut st = self.shared.state.lock().unwrap();
        if st.size != (width, height) {
            st.size = (width, height);
            st.free.clear();
            st.ready.clear();
            st.generation += 1;
            self.shared.cond.notify_all();
        }
    }

    /// The frame to show at clock time `now`: the newest rendered frame due by then (older
    /// ones are dropped). `None` if nothing is due yet. Give the surface back with
    /// [`PreviewPipeline::recycle`] once the display is done with it.
    pub fn frame(&self, now: Micros) -> Option<RenderedFrame> {
        let mut st = self.shared.state.lock().unwrap();
        let paused = matches!(st.mode, Mode::Paused { .. });
        let mut out = None;
        while st.ready.front().is_some_and(|f| paused || f.time <= now) {
            if let Some(old) = out.replace(st.ready.pop_front().unwrap()) {
                st.stats.dropped += 1;
                st.free.push(old.surface);
            }
        }
        if out.is_none() {
            st.stats.empty += 1;
        }
        self.shared.cond.notify_all();
        out
    }

    /// The clock's time while playing (what it plays by when there's no audio device to
    /// ask), `None` while paused.
    pub fn clock_time(&self) -> Option<Micros> {
        match &self.shared.state.lock().unwrap().mode {
            Mode::Playing { clock } => Some(clock()),
            Mode::Paused { .. } => None,
        }
    }

    pub fn recycle(&self, surface: Surface) {
        let mut st = self.shared.state.lock().unwrap();
        if st.free.len() < AHEAD + 2 {
            st.free.push(surface);
        }
    }

    pub fn stats(&self) -> PipelineStats {
        self.shared.state.lock().unwrap().stats
    }
}

impl Drop for PreviewPipeline {
    fn drop(&mut self) {
        self.shared.state.lock().unwrap().quit = true;
        self.shared.cond.notify_all();
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}

fn run(engine: &mut PreviewEngine, shared: &Shared) {
    loop {
        // Decide what to render next (or wait).
        let (t, size, generation, mut surface) = {
            let mut st = shared.state.lock().unwrap();
            loop {
                if st.quit {
                    return;
                }
                if let Some(p) = st.project.take() {
                    engine.set_project(p);
                }
                let fps = st.fps;
                let job = match &mut st.mode {
                    Mode::Paused { want } => {
                        let t = want.take();
                        if t.is_some() {
                            st.last = t;
                        }
                        t
                    }
                    Mode::Playing { clock } => {
                        let now = clock();
                        let n = st.next.unwrap_or_else(|| fps.frame_of(now)).max(fps.frame_of(now));
                        let due_soon = fps.frame_start(n).0 <= now.0 + (AHEAD as i64) * fps.frame_duration().0;
                        if st.ready.len() < AHEAD && due_soon {
                            st.next = Some(n + 1);
                            Some(fps.frame_start(n))
                        } else {
                            None
                        }
                    }
                };
                if let Some(t) = job {
                    let size = st.size;
                    let surface = st.free.pop();
                    break (t, size, st.generation, surface);
                }
                let wait = match st.mode {
                    Mode::Playing { .. } => std::time::Duration::from_micros(st.fps.frame_duration().0 as u64 / 2),
                    Mode::Paused { .. } => std::time::Duration::from_millis(250),
                };
                st = shared.cond.wait_timeout(st, wait).unwrap().0;
            }
        };
        let mut surface = match surface.take() {
            Some(s) => s,
            None => match Surface::new(size.0, size.1) {
                Some(s) => s,
                None => continue,
            },
        };
        let t0 = Instant::now();
        let ok = engine.render_into(t, &mut surface).is_ok();
        let render_ms = t0.elapsed().as_secs_f64() * 1e3;
        let mut st = shared.state.lock().unwrap();
        if ok && st.generation == generation {
            st.stats.rendered += 1;
            st.ready.push_back(RenderedFrame { time: t, surface, render_ms });
        } else {
            st.free.push(surface);
        }
        shared.cond.notify_all();
    }
}
