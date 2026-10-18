//! Getting images onto the GPU.
//!
//! Pixels are written as they are, straight alpha, and premultiplied by a pass on the GPU:
//! premultiplying a 4K still on the CPU took the render thread ~15 ms. Writing it still
//! copies the whole picture (~5 ms for a 4K still's 33 MB), so the threads that decode
//! stills ahead of the frames that draw them (playback's prefetch, the scrub workers for
//! exact frames) write and premultiply them there, with an [`Uploader`]; the frame that
//! first draws a still finds its texture ready.
//!
//! Premultiplied stills stay on the GPU while they're drawn at new sizes ([`Uploaded`]):
//! one drawn at a new size frame after frame (a scale being dragged) is resampled without
//! being written again.
//!
//! Nothing here starts a thread: the engine decides where an [`Uploader`] runs.

use std::sync::{Arc, Mutex};

use wgpu::util::DeviceExt;

use crate::{Params, RgbaImage, CANVAS};

/// GPU memory for premultiplied stills (six 4K stills: playback's prefetch has three or four
/// in hand on a draft whose subtitles change twice a second).
const UPLOADED_BUDGET: usize = 192 << 20;
/// A still drawn is kept until the end of the frame after the one that last resampled it:
/// drawn again at the same size, it comes from the compositor's resampled textures instead.
const UPLOADED_FRAMES: u64 = 1;

/// What a texture holds: the key of the image (see `Source::Cached`) and its size.
type Written = (u64, u32, u32);

struct Entry {
    what: Written,
    tex: wgpu::Texture,
    /// The frame it was last used in; `None` if it was written ahead and not drawn yet.
    drawn: Option<u64>,
}

/// Premultiplied full-size stills on the GPU, least recently used first. Beyond the budget
/// the stills drawn least recently go first, and only then those written ahead longest ago:
/// a still written ahead is about to be drawn.
pub(crate) struct Uploaded {
    entries: Vec<Entry>,
    bytes: usize,
    budget: usize,
}

impl Uploaded {
    pub(crate) fn new() -> Self {
        Uploaded::with_budget(UPLOADED_BUDGET)
    }

    fn with_budget(budget: usize) -> Self {
        Uploaded { entries: Vec::new(), bytes: 0, budget }
    }

    /// The texture of the image `key` at `w`×`h`, if it's here, marked as used in `frame`.
    /// It stays here: don't render into it or hand it back to a pool.
    pub(crate) fn get(&mut self, key: u64, w: u32, h: u32, frame: u64) -> Option<wgpu::Texture> {
        let i = self.entries.iter().position(|e| e.what == (key, w, h))?;
        let mut e = self.entries.remove(i);
        e.drawn = Some(frame);
        let tex = e.tex.clone();
        self.entries.push(e);
        Some(tex)
    }

    fn contains(&self, key: u64, w: u32, h: u32) -> bool {
        self.entries.iter().any(|e| e.what == (key, w, h))
    }

    /// Whether the image `key` is here, at any size.
    pub(crate) fn holds(&self, key: u64) -> bool {
        self.entries.iter().any(|e| e.what.0 == key)
    }

    /// Keep `tex`, the image `key` premultiplied: drawn in frame `drawn`, or (`None`)
    /// written ahead.
    pub(crate) fn insert(&mut self, key: u64, tex: wgpu::Texture, drawn: Option<u64>) {
        let what = (key, tex.width(), tex.height());
        if let Some(i) = self.entries.iter().position(|e| e.what == what) {
            self.bytes -= bytes(&self.entries.remove(i).tex);
        }
        self.bytes += bytes(&tex);
        self.entries.push(Entry { what, tex, drawn });
        while self.bytes > self.budget && self.entries.len() > 1 {
            // Never the one just kept.
            let others = &self.entries[..self.entries.len() - 1];
            let i = others.iter().position(|e| e.drawn.is_some()).unwrap_or(0);
            self.bytes -= bytes(&self.entries.remove(i).tex);
        }
    }

    /// Drop the stills drawn but not used for `UPLOADED_FRAMES` frames by `frame`.
    pub(crate) fn expire(&mut self, frame: u64) {
        let bytes = &mut self.bytes;
        self.entries.retain(|e| {
            let keep = e.drawn.is_none_or(|last| frame.saturating_sub(last) < UPLOADED_FRAMES);
            if !keep {
                *bytes -= self::bytes(&e.tex);
            }
            keep
        });
    }
}

fn bytes(tex: &wgpu::Texture) -> usize {
    tex.width() as usize * tex.height() as usize * 4
}

/// Copy straight-alpha pixels into `tex` (of their size). The copy reaches the GPU with the
/// queue's next submission, from whichever thread.
pub(crate) fn write(queue: &wgpu::Queue, tex: &wgpu::Texture, img: &RgbaImage) {
    queue.write_texture(
        wgpu::TexelCopyTextureInfo { texture: tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
        &img.data,
        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(img.width * 4), rows_per_image: Some(img.height) },
        wgpu::Extent3d { width: img.width, height: img.height, depth_or_array_layers: 1 },
    );
}

/// `img`'s pixels in a new buffer, rows padded to the GPU's copy alignment, and that row
/// stride. Written while the buffer is mapped: `Queue::write_texture` copies under the
/// queue's lock, which would hold up the render thread's next submission for the whole copy.
fn stage(device: &wgpu::Device, img: &RgbaImage) -> Option<(wgpu::Buffer, u32)> {
    let row = img.width * 4;
    let stride = row.next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let buf = device.create_buffer(&wgpu::BufferDescriptor { label: Some("still written ahead"), size: stride as u64 * img.height as u64, usage: wgpu::BufferUsages::MAP_WRITE | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: true });
    {
        let mut view = buf.get_mapped_range_mut(..).ok()?;
        let (row, stride) = (row as usize, stride as usize);
        for (y, line) in img.data.chunks_exact(row).take(img.height as usize).enumerate() {
            view.slice(y * stride..y * stride + row).copy_from_slice(line);
        }
    }
    buf.unmap();
    Some((buf, stride))
}

/// Record the pass that premultiplies `straight` into `out` (same size), rounding as the
/// CPU did (shaders.wgsl, `fs_premultiply`).
pub(crate) fn premultiply(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, pipeline: &wgpu::RenderPipeline, enc: &mut wgpu::CommandEncoder, straight: &wgpu::Texture, out: &wgpu::Texture) {
    let size = [straight.width() as f32, straight.height() as f32];
    let params = Params { src_size: size, dst_size: size, inv0: [0.0; 4], inv1: [0.0; 4], misc: [0.0; 4] };
    let buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::bytes_of(&params), usage: wgpu::BufferUsages::UNIFORM });
    let (src_view, dst_view) = (straight.create_view(&Default::default()), out.create_view(&Default::default()));
    let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout,
        entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src_view) }, wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() }],
    });
    let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: None,
        color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &dst_view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store } })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    });
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, &bind, &[]);
    pass.draw(0..3, 0..1);
}

/// Writes stills to a compositor's GPU from other threads (see the module docs). Cheap to
/// clone.
#[derive(Clone)]
pub struct Uploader {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    premultiply: wgpu::RenderPipeline,
    uploaded: Arc<Mutex<Uploaded>>,
    /// Held while a still is written: one at a time, as each needs three copies of the
    /// picture until the GPU is done (staging, straight and premultiplied).
    writing: Arc<Mutex<()>>,
}

impl Uploader {
    pub(crate) fn new(device: wgpu::Device, queue: wgpu::Queue, layout: wgpu::BindGroupLayout, premultiply: wgpu::RenderPipeline, uploaded: Arc<Mutex<Uploaded>>) -> Self {
        Uploader { device, queue, layout, premultiply, uploaded, writing: Arc::default() }
    }

    /// Write `img` (straight alpha) to the GPU and premultiply it there, for the image `key`
    /// identifies, unless it's there already: the compositor uses it when it draws a
    /// `Source::Cached` with that key and size. Images beyond the GPU's texture limit are
    /// left to the compositor (it shrinks them first).
    pub fn upload(&self, key: u64, img: &RgbaImage) {
        let max = self.device.limits().max_texture_dimension_2d;
        if img.width == 0 || img.height == 0 || img.width > max || img.height > max || img.data.len() < (img.width * img.height * 4) as usize {
            return;
        }
        let _writing = self.writing.lock().unwrap();
        if self.uploaded.lock().unwrap().contains(key, img.width, img.height) {
            return;
        }
        let texture = |usage: wgpu::TextureUsages| {
            self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("still written ahead"),
                size: wgpu::Extent3d { width: img.width, height: img.height, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: CANVAS,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | usage,
                view_formats: &[],
            })
        };
        let Some((staging, stride)) = stage(&self.device, img) else { return };
        let (straight, out) = (texture(wgpu::TextureUsages::COPY_DST), texture(wgpu::TextureUsages::RENDER_ATTACHMENT));
        let mut enc = self.device.create_command_encoder(&Default::default());
        enc.copy_buffer_to_texture(
            wgpu::TexelCopyBufferInfo { buffer: &staging, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(stride), rows_per_image: Some(img.height) } },
            wgpu::TexelCopyTextureInfo { texture: &straight, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::Extent3d { width: img.width, height: img.height, depth_or_array_layers: 1 },
        );
        premultiply(&self.device, &self.layout, &self.premultiply, &mut enc, &straight, &out);
        let done = self.queue.submit([enc.finish()]);
        // Wait for it here, off the render thread: the staging buffer and the straight copy
        // are freed at once, and a frame drawing the still never waits for its upload.
        let _ = self.device.poll(wgpu::PollType::Wait { submission_index: Some(done), timeout: None });
        self.uploaded.lock().unwrap().insert(key, out, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stills_are_kept_to_a_budget_drawn_ones_out_first() {
        let Ok(c) = crate::Compositor::new() else { return };
        let tex = |w: u32| c.texture(w, 4, CANVAS, wgpu::TextureUsages::empty());
        // Room for three 4x4 textures (64 bytes each).
        let mut u = Uploaded::with_budget(192);
        u.insert(1, tex(4), Some(1));
        u.insert(2, tex(4), None);
        u.insert(3, tex(4), Some(1));
        assert!(u.get(1, 8, 4, 2).is_none(), "another size");
        // Drawing 1 makes 3 the least recently drawn; 2 is still waiting for its frame.
        assert!(u.get(1, 4, 4, 2).is_some());
        u.insert(4, tex(4), None);
        assert!(!u.contains(3, 4, 4) && u.contains(1, 4, 4) && u.contains(2, 4, 4) && u.contains(4, 4, 4));
        // Then 1, the only drawn one left, before anything written ahead.
        u.insert(5, tex(4), None);
        assert!(!u.contains(1, 4, 4) && u.contains(2, 4, 4));
        // With none drawn, the oldest written ahead.
        u.insert(6, tex(4), None);
        assert!(!u.contains(2, 4, 4) && u.contains(4, 4, 4) && u.contains(5, 4, 4) && u.contains(6, 4, 4));
        // The same image again replaces it.
        u.insert(6, tex(4), Some(3));
        assert_eq!((u.entries.len(), u.bytes), (3, 192));
        // One over the budget on its own stays, and stays after use.
        u.insert(7, tex(16), Some(3));
        assert_eq!((u.entries.len(), u.bytes), (1, 256));
        assert!(u.get(7, 16, 4, 4).is_some() && u.get(7, 16, 4, 5).is_some());
    }

    #[test]
    fn drawn_stills_expire_and_those_written_ahead_wait() {
        let Ok(c) = crate::Compositor::new() else { return };
        let tex = || c.texture(4, 4, CANVAS, wgpu::TextureUsages::empty());
        let mut u = Uploaded::with_budget(1 << 20);
        u.insert(1, tex(), Some(10));
        u.insert(2, tex(), None);
        u.insert(3, tex(), Some(10));
        // Used again: kept from then on.
        assert!(u.get(3, 4, 4, 20).is_some());
        u.expire(10 + UPLOADED_FRAMES - 1);
        assert!(u.contains(1, 4, 4));
        u.expire(10 + UPLOADED_FRAMES);
        assert!(!u.contains(1, 4, 4) && u.contains(2, 4, 4) && u.contains(3, 4, 4));
        u.expire(1000);
        assert!(u.contains(2, 4, 4) && !u.contains(3, 4, 4));
        assert_eq!((u.entries.len(), u.bytes), (1, 64));
    }
}
