//! One open project for preview: frames on demand, playback by the audio clock, edits
//! swapped in without reopening anything.
//!
//! Frames are rendered into a small pool of surfaces ([`Surface`]: IOSurface-backed buffers
//! on Apple platforms, pixels read back elsewhere). A surface is reused only after
//! [`Session::release`], so a client must release every frame it's handed.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use openrip_model::{Micros, Project};
use openrip_playback::{Player, PreviewEngine, PreviewPipeline, ScrubStats};
pub use openrip_render::Surface;

use crate::project::{ProjectInfo, Source, TextBlock};
use crate::{Error, Result};

pub struct Session {
    project: Project,
    engine: Renderer,
    /// Audio output and master clock (absent when there is no output device).
    player: Option<Arc<Player>>,
    /// The render-ahead preview, created on the first `set_preview_size`.
    pipeline: Option<PreviewPipeline>,
    /// Frames handed out by `frame_for_display`, until they're released.
    shown: HashMap<u32, Surface>,
    /// Frames handed out by `hand_out`, until they're released.
    held: HashMap<u32, Surface>,
    /// Released surfaces, for the next frames.
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

    /// Like `render_image`, but from a pre-rendered chunk where one covers the frame (says whether it did).
    pub fn render_image_cached(&self, time: Micros, width: u32, height: u32) -> Result<(Image, bool)> {
        let (img, _, cached) = self.0.lock().unwrap().render_image_cached(time, width, height)?;
        Ok((Image { width: img.width, height: img.height, data: img.data }, cached))
    }
}

impl Image {
    /// The image as a PNG file's bytes (8-bit RGBA): a still frame to save. Pure Rust, so it
    /// works wherever the engine does; writing the file is the client's.
    pub fn to_png(&self) -> Result<Vec<u8>> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, self.width, self.height);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            // fdeflate's fast mode: a 4K frame in a fraction of the time zlib's default takes,
            // for a file a little larger.
            enc.set_compression(png::Compression::Fast);
            enc.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
            let mut w = enc.write_header().map_err(png_error)?;
            w.write_image_data(&self.data).map_err(png_error)?;
        }
        Ok(out)
    }
}

fn png_error(e: png::EncodingError) -> Error {
    Error::Io(std::io::Error::other(e.to_string()))
}

impl Session {
    /// Open `project` for preview, with an audio output if there is a device.
    pub fn open(project: Project, source: Source) -> Result<(Session, ProjectInfo)> {
        let info = ProjectInfo::of(&project, source);
        let player = Player::new(project.clone()).ok().map(Arc::new);
        let mut engine = PreviewEngine::new(project.clone())?;
        engine.use_render_cache(true);
        let session = Session {
            project,
            engine: Renderer(Arc::new(Mutex::new(engine))),
            player,
            pipeline: None,
            shown: HashMap::new(),
            held: HashMap::new(),
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

    /// The surface of a frame handed out and not yet released (its pixels, where the
    /// platform has no zero-copy hand-off).
    pub fn surface(&self, id: u32) -> Option<&Surface> {
        self.shown.get(&id).or_else(|| self.held.get(&id))
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

    /// The left and right peaks (0..1) of the mix played since the last call, before the
    /// output gain, for a level meter; zero while paused, `None` without audio output.
    pub fn output_levels(&self) -> Option<[f32; 2]> {
        self.player.as_ref().map(|p| p.take_levels())
    }

    /// Play a short snippet of the mix at `time`, for scrubbing (see [`Player::scrub`]).
    /// False when none started: playback is running, it came too soon after the last, or there
    /// is no audio output.
    pub fn scrub_audio(&self, time: Micros) -> bool {
        self.player.as_ref().is_some_and(|p| p.scrub(time))
    }

    /// Cut a scrub snippet short (the drag ended).
    pub fn scrub_audio_stop(&self) {
        if let Some(p) = &self.player {
            p.scrub_stop();
        }
    }

    /// What scrubbing has played, for tests; `None` without audio output.
    pub fn scrub_stats(&self) -> Option<ScrubStats> {
        self.player.as_ref().map(|p| p.scrub_stats())
    }
}

// ---- Frames on demand, into pooled surfaces ----

/// A frame to render on a worker thread (see [`Session::frame_job`]).
pub struct FrameJob {
    renderer: Renderer,
    surface: Surface,
    time: Micros,
    width: u32,
    height: u32,
    scrub: bool,
}

/// A rendered frame, not yet handed to the client (see [`Session::hand_out`]).
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
#[derive(Clone, Debug)]
pub struct FrameHandle {
    pub id: u32,
    /// The IOSurfaceRef pointer (BGRA), for Electron's `sharedTexture`. Elsewhere the pixels
    /// are [`Session::surface`]'s.
    #[cfg(target_vendor = "apple")]
    pub io_surface: u64,
    pub width: u32,
    pub height: u32,
    pub time_us: i64,
    pub render_ms: f64,
    /// Layers drawn, and layers skipped because their media or font is missing.
    pub layers: u32,
    pub skipped: u32,
}

impl Session {
    /// Get a frame at `time` ready to render into a pooled surface: [`FrameJob::render`] on
    /// any thread, then [`Session::hand_out`]. With `scrub`, video shows a frame that's quick
    /// to get while the playhead is dragged.
    pub fn frame_job(&mut self, time: Micros, width: u32, height: u32, scrub: bool) -> Result<FrameJob> {
        let reusable = self.free.iter().position(|f| f.width() == width && f.height() == height);
        let surface = match reusable {
            Some(i) => self.free.swap_remove(i),
            None => Surface::new(width, height).ok_or(Error::NoSurface)?,
        };
        Ok(FrameJob { renderer: self.engine.clone(), surface, time, width, height, scrub })
    }

    /// Give a rendered frame an id and keep its surface until it's released.
    pub fn hand_out(&mut self, frame: RenderedFrame) -> Result<FrameHandle> {
        self.next_id = self.next_id.wrapping_add(1);
        let id = self.next_id;
        #[cfg(target_vendor = "apple")]
        let io_surface = frame.surface.io_surface_ptr().ok_or(Error::NoIoSurface)?;
        self.held.insert(id, frame.surface);
        Ok(FrameHandle {
            id,
            #[cfg(target_vendor = "apple")]
            io_surface,
            width: frame.width,
            height: frame.height,
            time_us: frame.time.0,
            render_ms: frame.ms,
            layers: frame.layers,
            skipped: frame.skipped,
        })
    }
}

impl FrameJob {
    pub fn render(mut self) -> Result<RenderedFrame> {
        let t0 = Instant::now();
        let report = {
            let mut e = self.renderer.0.lock().unwrap();
            e.set_scrubbing(self.scrub);
            e.render_into(self.time, &mut self.surface)?
        };
        Ok(RenderedFrame { surface: self.surface, time: self.time, width: self.width, height: self.height, ms: t0.elapsed().as_secs_f64() * 1e3, layers: report.layers as u32, skipped: report.missing.len() as u32 })
    }
}

// ---- Render-ahead preview (what the app's preview uses) ----

/// A frame of the render-ahead preview, handed to the client until it's released.
#[derive(Clone, Debug)]
pub struct DisplayFrame {
    pub id: u32,
    /// The IOSurfaceRef pointer (BGRA), for Electron's `sharedTexture`. Elsewhere the pixels
    /// are [`Session::surface`]'s.
    #[cfg(target_vendor = "apple")]
    pub io_surface: u64,
    pub width: u32,
    pub height: u32,
    pub time_us: i64,
    pub render_ms: f64,
}

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
        #[cfg(target_vendor = "apple")]
        let io_surface = f.surface.io_surface_ptr()?;
        let (w, h) = (f.surface.width(), f.surface.height());
        self.next_id = self.next_id.wrapping_add(1);
        let id = self.next_id;
        self.shown.insert(id, f.surface);
        Some(DisplayFrame {
            id,
            #[cfg(target_vendor = "apple")]
            io_surface,
            width: w,
            height: h,
            time_us: f.time.0,
            render_ms: f.render_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::Image;

    /// A still's PNG decodes back to its pixels.
    #[test]
    fn png_round_trip() {
        let (width, height) = (3u32, 2u32);
        let data: Vec<u8> = (0..width * height * 4).map(|i| (i * 37 % 256) as u8).collect();
        let png = Image { width, height, data: data.clone() }.to_png().unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(png)).read_info().unwrap();
        let mut back = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut back).unwrap();
        assert_eq!((info.width, info.height, info.color_type), (width, height, png::ColorType::Rgba));
        assert_eq!(&back[..info.buffer_size()], &data[..]);
    }
}
