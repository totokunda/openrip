//! GPU compositor (wgpu) reproducing CapCut's measured rendering pipeline
//! (docs/parity/calibration.md, session 2):
//!
//! 1. Each image is resampled to its displayed size: area average then a 3×3 Laplacian
//!    sharpen of strength 0.15 when shrinking, bilinear when enlarging, untouched at 1:1.
//!    The result is stored in 8 bits, as CapCut does.
//! 2. That texture is rotated and placed with Catmull-Rom interpolation and composited
//!    (premultiplied "over") onto an 8-bit canvas at the output resolution.
//!
//! Geometry is in output pixels; mapping the project model (half-canvas positions,
//! contain-fit scale) to layers is the caller's job (see [`Layer::from_model`]).

use wgpu::util::DeviceExt;

pub const DOWNSCALE_SHARPEN: f32 = 0.15;

#[derive(Debug, thiserror::Error)]
pub enum RenderError {
    #[error("no GPU adapter: {0}")]
    Adapter(String),
    #[error("GPU device: {0}")]
    Device(String),
}

/// Straight-alpha 8-bit RGBA pixels, row-major.
#[derive(Clone, Debug, PartialEq)]
pub struct RgbaImage {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

/// One image placed on the canvas.
#[derive(Clone, Debug)]
pub struct Layer<'a> {
    pub image: &'a RgbaImage,
    /// Centre of the image on the canvas, in output pixels (y down).
    pub center: [f64; 2],
    /// Displayed width and height in output pixels, before rotation.
    pub size: [f64; 2],
    /// Degrees, clockwise on screen.
    pub rotation: f64,
    pub flip_h: bool,
    pub flip_v: bool,
    pub opacity: f32,
}

impl<'a> Layer<'a> {
    /// Place an image the way the project model does: `position` in half-canvas units
    /// (+y up), `scale` relative to contain-fit, `rotation` clockwise degrees.
    pub fn from_model(image: &'a RgbaImage, canvas: [u32; 2], position: [f64; 2], scale: [f64; 2], rotation: f64) -> Self {
        let (w, h) = (canvas[0] as f64, canvas[1] as f64);
        let fit = (w / image.width as f64).min(h / image.height as f64);
        Layer {
            image,
            center: [w / 2.0 + position[0] * w / 2.0, h / 2.0 - position[1] * h / 2.0],
            size: [image.width as f64 * fit * scale[0].abs(), image.height as f64 * fit * scale[1].abs()],
            rotation,
            flip_h: scale[0] < 0.0,
            flip_v: scale[1] < 0.0,
            opacity: 1.0,
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    src_size: [f32; 2],
    dst_size: [f32; 2],
    inv0: [f32; 4],
    inv1: [f32; 4],
    misc: [f32; 4],
}

pub struct Compositor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    area: wgpu::RenderPipeline,
    sharpen: wgpu::RenderPipeline,
    bilinear: wgpu::RenderPipeline,
    place: wgpu::RenderPipeline,
}

const CANVAS: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const WIDE: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

impl Compositor {
    /// A headless compositor on the default GPU.
    pub fn new() -> Result<Self, RenderError> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() }))
            .map_err(|e| RenderError::Adapter(e.to_string()))?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { label: Some("openrip compositor"), ..Default::default() }))
            .map_err(|e| RenderError::Device(e.to_string()))?;
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("compositor"), source: wgpu::ShaderSource::Wgsl(include_str!("shaders.wgsl").into()) });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let pipeline = |entry: &str, format: wgpu::TextureFormat, blend: Option<wgpu::BlendState>| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        Ok(Compositor {
            area: pipeline("fs_area", WIDE, None),
            sharpen: pipeline("fs_sharpen", CANVAS, None),
            bilinear: pipeline("fs_bilinear", CANVAS, None),
            place: pipeline("fs_place", CANVAS, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
            device,
            queue,
            layout,
        })
    }

    fn texture(&self, w: u32, h: u32, format: wgpu::TextureFormat, extra: wgpu::TextureUsages) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT | extra,
            view_formats: &[],
        })
    }

    fn upload(&self, img: &RgbaImage) -> wgpu::Texture {
        // Premultiply on the way in; every pass works on premultiplied colour.
        let mut data = img.data.clone();
        for px in data.chunks_exact_mut(4) {
            let a = px[3] as u32;
            if a != 255 {
                for c in &mut px[..3] {
                    *c = ((*c as u32 * a + 127) / 255) as u8;
                }
            }
        }
        let tex = self.texture(img.width, img.height, CANVAS, wgpu::TextureUsages::COPY_DST);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &data,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(img.width * 4), rows_per_image: Some(img.height) },
            wgpu::Extent3d { width: img.width, height: img.height, depth_or_array_layers: 1 },
        );
        tex
    }

    fn pass(&self, enc: &mut wgpu::CommandEncoder, pipeline: &wgpu::RenderPipeline, src: &wgpu::Texture, dst: &wgpu::Texture, params: Params, clear: Option<wgpu::Color>) {
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::bytes_of(&params), usage: wgpu::BufferUsages::UNIFORM });
        let src_view = src.create_view(&Default::default());
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src_view) },
                wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() },
            ],
        });
        let dst_view = dst.create_view(&Default::default());
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &dst_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: clear.map_or(wgpu::LoadOp::Load, wgpu::LoadOp::Clear), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }

    /// Render `layers` (bottom first) over an opaque `background` at `width`×`height`.
    pub fn render(&self, width: u32, height: u32, background: [u8; 3], layers: &[Layer]) -> RgbaImage {
        let canvas = self.texture(width, height, CANVAS, wgpu::TextureUsages::COPY_SRC);
        let mut enc = self.device.create_command_encoder(&Default::default());
        let bg = wgpu::Color { r: background[0] as f64 / 255.0, g: background[1] as f64 / 255.0, b: background[2] as f64 / 255.0, a: 1.0 };
        // Clear the canvas with an empty placement pass.
        let blank = self.texture(1, 1, CANVAS, wgpu::TextureUsages::empty());
        let off = Params { src_size: [1.0, 1.0], dst_size: [1.0, 1.0], inv0: [0.0, 0.0, -100.0, 0.0], inv1: [0.0, 0.0, -100.0, 0.0], misc: [0.0; 4] };
        self.pass(&mut enc, &self.place, &blank, &canvas, off, Some(bg));
        let mut keep = Vec::new(); // textures must outlive the submission
        for layer in layers {
            let (sw, sh) = (layer.image.width, layer.image.height);
            let src = self.upload(layer.image);
            let (dw, dh) = (layer.size[0], layer.size[1]);
            let (tw, th) = ((dw.round() as u32).max(1), (dh.round() as u32).max(1));
            let resize = Params { src_size: [sw as f32, sh as f32], dst_size: [tw as f32, th as f32], inv0: [0.0; 4], inv1: [0.0; 4], misc: [1.0, DOWNSCALE_SHARPEN, 0.0, 0.0] };
            let stage = if (tw, th) == (sw, sh) {
                src
            } else if tw < sw && th < sh {
                let wide = self.texture(tw, th, WIDE, wgpu::TextureUsages::empty());
                self.pass(&mut enc, &self.area, &src, &wide, resize, Some(wgpu::Color::TRANSPARENT));
                let sharp = self.texture(tw, th, CANVAS, wgpu::TextureUsages::empty());
                self.pass(&mut enc, &self.sharpen, &wide, &sharp, resize, Some(wgpu::Color::TRANSPARENT));
                keep.extend([src, wide]);
                sharp
            } else {
                let up = self.texture(tw, th, CANVAS, wgpu::TextureUsages::empty());
                self.pass(&mut enc, &self.bilinear, &src, &up, resize, Some(wgpu::Color::TRANSPARENT));
                keep.push(src);
                up
            };
            // Canvas pixel centre -> stage texture coordinates.
            let (sx, sy) = (dw / tw as f64, dh / th as f64);
            let (s, c) = layer.rotation.to_radians().sin_cos();
            let [cx, cy] = layer.center;
            let mut a = [c / sx, s / sx, -(c * cx + s * cy) / sx + tw as f64 / 2.0];
            let mut b = [-s / sy, c / sy, -(-s * cx + c * cy) / sy + th as f64 / 2.0];
            if layer.flip_h {
                a = [-a[0], -a[1], tw as f64 - a[2]];
            }
            if layer.flip_v {
                b = [-b[0], -b[1], th as f64 - b[2]];
            }
            let place = Params {
                src_size: [tw as f32, th as f32],
                dst_size: [width as f32, height as f32],
                inv0: [a[0] as f32, a[1] as f32, a[2] as f32, 0.0],
                inv1: [b[0] as f32, b[1] as f32, b[2] as f32, 0.0],
                misc: [layer.opacity, 0.0, 0.0, 0.0],
            };
            self.pass(&mut enc, &self.place, &stage, &canvas, place, None);
            keep.push(stage);
        }
        // Read back (rows padded to 256 bytes).
        let row = (width * 4).div_ceil(256) * 256;
        let buf = self.device.create_buffer(&wgpu::BufferDescriptor { label: None, size: (row * height) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: &canvas, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer: &buf, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(height) } },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        self.queue.submit([enc.finish()]);
        buf.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("map canvas"));
        self.device.poll(wgpu::PollType::wait_indefinitely()).expect("poll");
        let mapped = buf.slice(..).get_mapped_range().expect("mapped canvas");
        let mut data = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height as usize {
            data.extend_from_slice(&mapped[y * row as usize..y * row as usize + width as usize * 4]);
        }
        drop(mapped);
        drop(keep);
        RgbaImage { width, height, data }
    }
}
