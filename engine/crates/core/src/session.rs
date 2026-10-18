//! One open project for preview: frames on demand, playback by the audio clock, edits
//! swapped in without reopening anything.
//!
//! Frames are rendered into a small pool of IOSurface-backed buffers (macOS). A buffer is
//! reused only after [`Session::release`], so a client must release every frame it's
//! handed.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use openrip_model::{Micros, Project};
use openrip_playback::{Player, PreviewEngine};
#[cfg(target_os = "macos")]
use openrip_playback::PreviewPipeline;

use crate::project::{ProjectInfo, Source, TextBlock};
use crate::{Error, Result};

/// A render target buffer; CoreVideo buffers may be used from any thread.
#[cfg(target_os = "macos")]
struct Surface(objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>);
#[cfg(target_os = "macos")]
unsafe impl Send for Surface {}

/// The IOSurfaceRef behind a pixel buffer, as the pointer value a client hands on (Electron's
/// `sharedTexture` takes its bytes).
#[cfg(target_os = "macos")]
fn io_surface_ptr(pb: &objc2_core_video::CVPixelBuffer) -> Option<u64> {
    objc2_core_video::CVPixelBufferGetIOSurface(Some(pb)).map(|io| objc2_core_foundation::CFRetained::as_ptr(&io).as_ptr() as usize as u64)
}

pub struct Session {
    project: Project,
    engine: Renderer,
    /// Audio output and master clock (absent when there is no output device).
    player: Option<Arc<Player>>,
    /// The render-ahead preview, created on the first `set_preview_size`.
    #[cfg(target_os = "macos")]
    pipeline: Option<PreviewPipeline>,
    /// Frames handed out by `frame_for_display`, until they're released.
    #[cfg(target_os = "macos")]
    shown: HashMap<u32, openrip_playback::pipeline::Surface>,
    #[cfg(target_os = "macos")]
    held: HashMap<u32, Surface>,
    #[cfg(target_os = "macos")]
    free: Vec<Surface>,
    next_id: u32,
}

/// The session's renderer: cheap to clone, and usable from any thread (one frame at a time).
#[derive(Clone)]
pub struct Renderer(Arc<Mutex<PreviewEngine>>);

/// A frame read back from the GPU.
pub struct Image {
    pub width: u32,
    pub height: u32,
    /// Straight-alpha RGBA bytes.
    pub data: Vec<u8>,
}

impl Renderer {
    /// Render the frame at `time` and read it back (tests, thumbnails, stills).
    pub fn render_image(&self, time: Micros, width: u32, height: u32) -> Result<Image> {
        let (img, _) = self.0.lock().unwrap().render_image(time, width, height)?;
        Ok(Image { width: img.width, height: img.height, data: img.data })
    }
}

impl Session {
    /// Open `project` for preview, with an audio output if there is a device.
    pub fn open(project: Project, source: Source) -> Result<(Session, ProjectInfo)> {
        let info = ProjectInfo::of(&project, source);
        let player = Player::new(project.clone()).ok().map(Arc::new);
        let engine = PreviewEngine::new(project.clone())?;
        let session = Session {
            project,
            engine: Renderer(Arc::new(Mutex::new(engine))),
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
        };
        Ok((session, info))
    }

    /// Replace the project after an edit. Decoders, the audio output and the playback state
    /// stay as they are, so this is cheap enough to call after every edit; paused, the
    /// current frame is rendered again.
    pub fn update(&mut self, project: Project, source: Source) -> ProjectInfo {
        let mut info = ProjectInfo::of(&project, source);
        let relaid = openrip_v1::relaid_texts(&self.project, &project);
        {
            let mut engine = self.engine.0.lock().unwrap();
            engine.set_project(project.clone());
            info.text_blocks = relaid
                .into_iter()
                .filter_map(|segment| {
                    let [left, top, width, height] = engine.text_block(&segment)?;
                    Some(TextBlock { segment, left, top, width, height })
                })
                .collect();
        }
        if let Some(p) = &self.player {
            p.set_project(project.clone());
        }
        #[cfg(target_os = "macos")]
        if let Some(p) = &self.pipeline {
            p.set_project(project.clone());
        }
        self.project = project;
        info
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn renderer(&self) -> Renderer {
        self.engine.clone()
    }

    /// Let a frame's surface be reused (when the client no longer references it).
    pub fn release(&mut self, id: u32) {
        #[cfg(target_os = "macos")]
        {
            if let Some(surface) = self.shown.remove(&id) {
                if let Some(p) = &self.pipeline {
                    p.recycle(surface);
                }
                return;
            }
            if let Some(surface) = self.held.remove(&id) {
                if self.free.len() < 4 {
                    self.free.push(surface);
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = id;
    }

    /// Start playback (audio, and the master clock) at `time`. False without an output device.
    pub fn play(&self, time: Micros) -> bool {
        match &self.player {
            Some(p) => {
                p.play(time);
                true
            }
            None => false,
        }
    }

    pub fn pause(&self) {
        if let Some(p) = &self.player {
            p.pause();
        }
    }

    /// The timeline time being heard now (the clock to pick video frames by); `None`
    /// without audio output.
    pub fn position(&self) -> Option<Micros> {
        self.player.as_ref().map(|p| p.position())
    }

    /// Output gain; 0 mutes (the clock keeps running).
    pub fn set_volume(&self, volume: f32) {
        if let Some(p) = &self.player {
            p.set_volume(volume);
        }
    }
}

// ---- Frames on demand, into pooled surfaces ----

/// A frame to render on a worker thread (see [`Session::frame_job`]).
#[cfg(target_os = "macos")]
pub struct FrameJob {
    renderer: Renderer,
    surface: Surface,
    time: Micros,
    width: u32,
    height: u32,
    scrub: bool,
}

/// A rendered frame, not yet handed to the client (see [`Session::hand_out`]).
#[cfg(target_os = "macos")]
pub struct RenderedFrame {
    surface: Surface,
    time: Micros,
    width: u32,
    height: u32,
    ms: f64,
    layers: u32,
    skipped: u32,
}

/// A frame handed to the client: its surface stays alive until [`Session::release`].
#[cfg(target_os = "macos")]
#[derive(Clone, Debug)]
pub struct FrameHandle {
    pub id: u32,
    /// The IOSurfaceRef pointer (BGRA), for Electron's `sharedTexture`.
    pub io_surface: u64,
    pub width: u32,
    pub height: u32,
    pub time_us: i64,
    pub render_ms: f64,
    /// Layers drawn, and layers skipped because their media or font is missing.
    pub layers: u32,
    pub skipped: u32,
}

#[cfg(target_os = "macos")]
impl Session {
    /// Get a frame at `time` ready to render into a pooled surface: [`FrameJob::render`] on
    /// any thread, then [`Session::hand_out`]. With `scrub`, video shows a frame that's quick
    /// to get while the playhead is dragged.
    pub fn frame_job(&mut self, time: Micros, width: u32, height: u32, scrub: bool) -> Result<FrameJob> {
        let reusable = self.free.iter().position(|f| objc2_core_video::CVPixelBufferGetWidth(&f.0) == width as usize && objc2_core_video::CVPixelBufferGetHeight(&f.0) == height as usize);
        let surface = match reusable {
            Some(i) => self.free.swap_remove(i),
            None => Surface(openrip_render::Compositor::output_surface(width, height).ok_or(Error::NoSurface)?),
        };
        Ok(FrameJob { renderer: self.engine.clone(), surface, time, width, height, scrub })
    }

    /// Give a rendered frame an id and keep its surface until it's released.
    pub fn hand_out(&mut self, frame: RenderedFrame) -> Result<FrameHandle> {
        self.next_id = self.next_id.wrapping_add(1);
        let id = self.next_id;
        let ptr = io_surface_ptr(&frame.surface.0).ok_or(Error::NoIoSurface)?;
        self.held.insert(id, frame.surface);
        Ok(FrameHandle { id, io_surface: ptr, width: frame.width, height: frame.height, time_us: frame.time.0, render_ms: frame.ms, layers: frame.layers, skipped: frame.skipped })
    }
}

#[cfg(target_os = "macos")]
impl FrameJob {
    pub fn render(self) -> Result<RenderedFrame> {
        let t0 = Instant::now();
        let report = {
            let mut e = self.renderer.0.lock().unwrap();
            e.set_scrubbing(self.scrub);
            e.render_to_surface(self.time, &self.surface.0)?
        };
        Ok(RenderedFrame { surface: self.surface, time: self.time, width: self.width, height: self.height, ms: t0.elapsed().as_secs_f64() * 1e3, layers: report.layers as u32, skipped: report.missing.len() as u32 })
    }
}

// ---- Render-ahead preview (what the app's preview uses) ----

/// A frame of the render-ahead preview, handed to the client until it's released.
#[cfg(target_os = "macos")]
#[derive(Clone, Debug)]
pub struct DisplayFrame {
    pub id: u32,
    /// The IOSurfaceRef pointer (BGRA), for Electron's `sharedTexture`.
    pub io_surface: u64,
    pub width: u32,
    pub height: u32,
    pub time_us: i64,
    pub render_ms: f64,
}

#[cfg(target_os = "macos")]
impl Session {
    /// Size of the preview surfaces; creates the pipeline on the first call.
    pub fn set_preview_size(&mut self, width: u32, height: u32) -> Result<()> {
        match &self.pipeline {
            Some(p) => p.resize(width, height),
            None => self.pipeline = Some(PreviewPipeline::new(self.project.clone(), width, height)?),
        }
        Ok(())
    }

    /// Play from `from`: sound starts and frames render ahead of the audio clock.
    pub fn start_playback(&self, from: Micros) -> Result<()> {
        let p = self.pipeline.as_ref().ok_or(Error::NoPreview)?;
        match &self.player {
            Some(player) => {
                player.play(from);
                let player = player.clone();
                p.play(Arc::new(move || player.position()));
            }
            None => {
                // No audio device: run by the wall clock.
                let start = Instant::now();
                p.play(Arc::new(move || Micros(from.0 + start.elapsed().as_micros() as i64)));
            }
        }
        Ok(())
    }

    /// Stop playing; the picture stays on the frame at the stop time, which is returned.
    pub fn stop_playback(&self) -> Micros {
        let at = self.player.as_ref().map_or(Micros::ZERO, |p| {
            let t = p.position();
            p.pause();
            t
        });
        if let Some(p) = &self.pipeline {
            p.seek(at);
        }
        at
    }

    /// Show the frame at `time` (paused; scrubbing). The newest request wins.
    pub fn seek(&self, time: Micros) {
        if let Some(p) = &self.pipeline {
            p.seek(time);
        }
    }

    /// The frame to show now (the newest one due by the playback clock, or the last seek),
    /// or `None` if there is nothing new. [`Session::release`] it when done.
    pub fn frame_for_display(&mut self) -> Option<DisplayFrame> {
        let now = self.player.as_ref().map_or(Micros(i64::MAX), |p| p.position());
        let f = self.pipeline.as_ref()?.frame(now)?;
        let pb = &f.surface.0;
        let ptr = io_surface_ptr(pb)?;
        let (w, h) = (objc2_core_video::CVPixelBufferGetWidth(pb) as u32, objc2_core_video::CVPixelBufferGetHeight(pb) as u32);
        self.next_id = self.next_id.wrapping_add(1);
        let id = self.next_id;
        self.shown.insert(id, f.surface);
        Some(DisplayFrame { id, io_surface: ptr, width: w, height: h, time_us: f.time.0, render_ms: f.render_ms })
    }
}
