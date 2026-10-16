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
//!
//! Video frames from the hardware decoder are used in place: on macOS their IOSurface
//! planes (NV12 / P010) become GPU textures without a copy and are converted to RGB on the
//! GPU with the frame's own matrix and range.

pub mod text;

use openrip_media::{Matrix, PixelFormat, VideoFrame};
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

/// Pixels for a layer.
#[derive(Copy, Clone, Debug)]
pub enum Source<'a> {
    Image(&'a RgbaImage),
    Video(&'a VideoFrame),
}

impl Source<'_> {
    pub fn size(&self) -> (u32, u32) {
        match self {
            Source::Image(i) => (i.width, i.height),
            Source::Video(f) => (f.width(), f.height()),
        }
    }
}

impl<'a> From<&'a RgbaImage> for Source<'a> {
    fn from(i: &'a RgbaImage) -> Self {
        Source::Image(i)
    }
}

impl<'a> From<&'a VideoFrame> for Source<'a> {
    fn from(f: &'a VideoFrame) -> Self {
        Source::Video(f)
    }
}

/// One image placed on the canvas.
#[derive(Clone, Debug)]
pub struct Layer<'a> {
    pub source: Source<'a>,
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
    pub fn from_model(source: impl Into<Source<'a>>, canvas: [u32; 2], position: [f64; 2], scale: [f64; 2], rotation: f64) -> Self {
        Self::from_model_oriented(source, canvas, position, scale, rotation, 0)
    }

    /// Like [`Layer::from_model`] for a source stored sideways or upside down (phone video:
    /// `orientation` is the clockwise turn, 0/90/180/270, that displays it upright). Fit,
    /// scale and flips apply to the upright picture.
    pub fn from_model_oriented(source: impl Into<Source<'a>>, canvas: [u32; 2], position: [f64; 2], scale: [f64; 2], rotation: f64, orientation: i32) -> Self {
        let source = source.into();
        let (sw, sh) = source.size();
        let sideways = orientation.rem_euclid(180) == 90;
        let (uw, uh) = if sideways { (sh, sw) } else { (sw, sh) };
        let (w, h) = (canvas[0] as f64, canvas[1] as f64);
        let fit = (w / uw as f64).min(h / uh as f64);
        // The texture's own axes: swapped relative to the screen when sideways.
        let (sx, sy) = if sideways { (scale[1], scale[0]) } else { (scale[0], scale[1]) };
        Layer {
            source,
            center: [w / 2.0 + position[0] * w / 2.0, h / 2.0 - position[1] * h / 2.0],
            size: [sw as f64 * fit * sx.abs(), sh as f64 * fit * sy.abs()],
            rotation: rotation + orientation as f64,
            flip_h: if sideways { sy < 0.0 } else { sx < 0.0 },
            flip_v: if sideways { sx < 0.0 } else { sy < 0.0 },
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
    yuv_layout: wgpu::BindGroupLayout,
    yuv: wgpu::RenderPipeline,
    area: wgpu::RenderPipeline,
    sharpen: wgpu::RenderPipeline,
    bilinear: wgpu::RenderPipeline,
    place: wgpu::RenderPipeline,
    /// The placement pass for BGRA targets (IOSurfaces handed to the app).
    place_bgra: wgpu::RenderPipeline,
}

const CANVAS: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const WIDE: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

impl Compositor {
    /// A headless compositor on the default GPU.
    pub fn new() -> Result<Self, RenderError> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() }))
            .map_err(|e| RenderError::Adapter(e.to_string()))?;
        // 16-bit normalised textures let P010 planes be sampled directly.
        let required_features = adapter.features() & wgpu::Features::TEXTURE_FORMAT_16BIT_NORM;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { label: Some("openrip compositor"), required_features, ..Default::default() }))
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
        let plane = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
            count: None,
        };
        let yuv_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                plane(0),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
                plane(2),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let yuv_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&yuv_layout)], immediate_size: 0 });
        let pipeline = |entry: &str, format: wgpu::TextureFormat, blend: Option<wgpu::BlendState>| {
            let layout = if entry == "fs_yuv" { &yuv_pipeline_layout } else { &pipeline_layout };
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(layout),
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
            yuv: pipeline("fs_yuv", CANVAS, None),
            area: pipeline("fs_area", WIDE, None),
            sharpen: pipeline("fs_sharpen", CANVAS, None),
            bilinear: pipeline("fs_bilinear", CANVAS, None),
            place: pipeline("fs_place", CANVAS, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
            place_bgra: pipeline("fs_place", wgpu::TextureFormat::Bgra8Unorm, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
            device,
            queue,
            layout,
            yuv_layout,
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
        self.pass_with(enc, pipeline, src, None, dst, params, clear)
    }

    #[allow(clippy::too_many_arguments)]
    fn pass_with(
        &self,
        enc: &mut wgpu::CommandEncoder,
        pipeline: &wgpu::RenderPipeline,
        src: &wgpu::Texture,
        chroma: Option<&wgpu::Texture>,
        dst: &wgpu::Texture,
        params: Params,
        clear: Option<wgpu::Color>,
    ) {
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::bytes_of(&params), usage: wgpu::BufferUsages::UNIFORM });
        let src_view = src.create_view(&Default::default());
        let chroma_view = chroma.map(|c| c.create_view(&Default::default()));
        let mut entries = vec![
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src_view) },
            wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() },
        ];
        if let Some(v) = &chroma_view {
            entries.push(wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(v) });
        }
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: if chroma.is_some() { &self.yuv_layout } else { &self.layout }, entries: &entries });
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

    /// Convert a hardware frame's planes to an RGBA texture on the GPU, without copying them
    /// out of their IOSurface. `None` if the frame isn't a hardware NV12/P010 frame.
    #[cfg(target_os = "macos")]
    fn import_video(&self, enc: &mut wgpu::CommandEncoder, frame: &VideoFrame) -> Option<(wgpu::Texture, [wgpu::Texture; 2])> {
        let ten_bit = match frame.pixel_format() {
            PixelFormat::Nv12 => false,
            PixelFormat::P010 if self.device.features().contains(wgpu::Features::TEXTURE_FORMAT_16BIT_NORM) => true,
            _ => return None,
        };
        let pb = frame.pixel_buffer()?;
        let surface = frame.io_surface()?;
        let plane_size = |i| (objc2_core_video::CVPixelBufferGetWidthOfPlane(pb, i) as u32, objc2_core_video::CVPixelBufferGetHeightOfPlane(pb, i) as u32);
        let (luma_fmt, chroma_fmt) = if ten_bit { (wgpu::TextureFormat::R16Unorm, wgpu::TextureFormat::Rg16Unorm) } else { (wgpu::TextureFormat::R8Unorm, wgpu::TextureFormat::Rg8Unorm) };
        let luma = self.wrap_plane(&surface, 0, plane_size(0), luma_fmt)?;
        let chroma = self.wrap_plane(&surface, 1, plane_size(1), chroma_fmt)?;
        let (w, h) = (frame.width(), frame.height());
        let rgba = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
        let (inv0, inv1, k) = yuv_params(frame.matrix(), frame.full_range(), ten_bit);
        let params = Params { src_size: [w as f32, h as f32], dst_size: [w as f32, h as f32], inv0, inv1, misc: [1.0, 0.0, k, 0.0] };
        self.pass_with(enc, &self.yuv, &luma, Some(&chroma), &rgba, params, Some(wgpu::Color::BLACK));
        Some((rgba, [luma, chroma]))
    }

    #[cfg(not(target_os = "macos"))]
    fn import_video(&self, _enc: &mut wgpu::CommandEncoder, _frame: &VideoFrame) -> Option<(wgpu::Texture, [wgpu::Texture; 2])> {
        None
    }

    /// One IOSurface plane as a wgpu texture (no copy).
    #[cfg(target_os = "macos")]
    fn wrap_plane(&self, surface: &objc2_io_surface::IOSurfaceRef, plane: usize, (w, h): (u32, u32), format: wgpu::TextureFormat) -> Option<wgpu::Texture> {
        self.wrap_surface(surface, plane, (w, h), format, false)
    }

    /// An IOSurface plane as a wgpu texture (no copy); `target` makes it renderable.
    #[cfg(target_os = "macos")]
    fn wrap_surface(&self, surface: &objc2_io_surface::IOSurfaceRef, plane: usize, (w, h): (u32, u32), format: wgpu::TextureFormat, target: bool) -> Option<wgpu::Texture> {
        use objc2_metal::{MTLDevice, MTLPixelFormat, MTLTextureDescriptor, MTLTextureType, MTLTextureUsage};
        let mtl_format = match format {
            wgpu::TextureFormat::R8Unorm => MTLPixelFormat::R8Unorm,
            wgpu::TextureFormat::Rg8Unorm => MTLPixelFormat::RG8Unorm,
            wgpu::TextureFormat::R16Unorm => MTLPixelFormat::R16Unorm,
            wgpu::TextureFormat::Rg16Unorm => MTLPixelFormat::RG16Unorm,
            wgpu::TextureFormat::Bgra8Unorm => MTLPixelFormat::BGRA8Unorm,
            _ => return None,
        };
        let raw = unsafe {
            let hal = self.device.as_hal::<wgpu::hal::api::Metal>()?;
            let desc = MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(mtl_format, w as usize, h as usize, false);
            desc.setUsage(if target { MTLTextureUsage::ShaderRead | MTLTextureUsage::RenderTarget } else { MTLTextureUsage::ShaderRead });
            hal.raw_device().newTextureWithDescriptor_iosurface_plane(&desc, surface, plane)?
        };
        let size = wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 };
        let hal_texture = unsafe { wgpu::hal::metal::Device::texture_from_raw(raw, format, MTLTextureType::Type2D, 1, 1, wgpu::hal::CopyExtent { width: w, height: h, depth: 1 }, None) };
        let desc = wgpu::TextureDescriptor {
            label: Some("video plane"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: if target { wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT } else { wgpu::TextureUsages::TEXTURE_BINDING },
            view_formats: &[],
        };
        Some(unsafe { self.device.create_texture_from_hal::<wgpu::hal::api::Metal>(hal_texture, &desc, wgpu::TextureUses::RESOURCE) })
    }

    /// Record the passes that draw `layers` (bottom first) over `background` into `canvas`.
    /// Returns the intermediate textures, which must live until the work is submitted.
    fn encode_frame(&self, enc: &mut wgpu::CommandEncoder, canvas: &wgpu::Texture, background: [u8; 3], layers: &[Layer]) -> Vec<wgpu::Texture> {
        let (width, height) = (canvas.width(), canvas.height());
        let place_pipeline = if canvas.format() == wgpu::TextureFormat::Bgra8Unorm { &self.place_bgra } else { &self.place };
        let bg = wgpu::Color { r: background[0] as f64 / 255.0, g: background[1] as f64 / 255.0, b: background[2] as f64 / 255.0, a: 1.0 };
        // Clear the canvas with an empty placement pass.
        let blank = self.texture(1, 1, CANVAS, wgpu::TextureUsages::empty());
        let mut keep = Vec::new(); // textures must outlive the submission
        let off = Params { src_size: [1.0, 1.0], dst_size: [1.0, 1.0], inv0: [0.0, 0.0, -100.0, 0.0], inv1: [0.0, 0.0, -100.0, 0.0], misc: [0.0; 4] };
        self.pass(enc, place_pipeline, &blank, canvas, off, Some(bg));
        for layer in layers {
            let (sw, sh) = layer.source.size();
            let src = match layer.source {
                Source::Image(img) => self.upload(img),
                Source::Video(frame) => match self.import_video(enc, frame) {
                    Some((rgba, planes)) => {
                        keep.extend(planes);
                        rgba
                    }
                    None => self.upload(&rgb_of(frame)),
                },
            };
            let (dw, dh) = (layer.size[0], layer.size[1]);
            let (tw, th) = ((dw.round() as u32).max(1), (dh.round() as u32).max(1));
            let resize = Params { src_size: [sw as f32, sh as f32], dst_size: [tw as f32, th as f32], inv0: [0.0; 4], inv1: [0.0; 4], misc: [1.0, DOWNSCALE_SHARPEN, 0.0, 0.0] };
            let stage = if (tw, th) == (sw, sh) {
                src
            } else if tw < sw && th < sh {
                let wide = self.texture(tw, th, WIDE, wgpu::TextureUsages::empty());
                self.pass(enc, &self.area, &src, &wide, resize, Some(wgpu::Color::TRANSPARENT));
                let sharp = self.texture(tw, th, CANVAS, wgpu::TextureUsages::empty());
                self.pass(enc, &self.sharpen, &wide, &sharp, resize, Some(wgpu::Color::TRANSPARENT));
                keep.extend([src, wide]);
                sharp
            } else {
                let up = self.texture(tw, th, CANVAS, wgpu::TextureUsages::empty());
                self.pass(enc, &self.bilinear, &src, &up, resize, Some(wgpu::Color::TRANSPARENT));
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
            self.pass(enc, place_pipeline, &stage, canvas, place, None);
            keep.push(stage);
        }
        keep.push(blank);
        keep
    }

    /// A new IOSurface-backed BGRA pixel buffer to render into with
    /// [`Compositor::render_to_surface`] and hand to the app.
    #[cfg(target_os = "macos")]
    pub fn output_surface(width: u32, height: u32) -> Option<objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>> {
        use objc2_core_foundation::{CFBoolean, CFDictionary, CFRetained, CFString, CFType};
        use objc2_core_video::*;
        let props = CFDictionary::<CFString, CFType>::from_slices(&[], &[]);
        let attrs = unsafe { CFDictionary::<CFString, CFType>::from_slices(&[kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferMetalCompatibilityKey], &[props.as_ref(), CFBoolean::new(true).as_ref()]) };
        let mut out: *mut CVPixelBuffer = std::ptr::null_mut();
        let r = unsafe { CVPixelBufferCreate(None, width as usize, height as usize, kCVPixelFormatType_32BGRA, Some(attrs.as_opaque()), std::ptr::NonNull::from(&mut out)) };
        (r == 0 && !out.is_null()).then(|| unsafe { CFRetained::from_raw(std::ptr::NonNull::new_unchecked(out)) })
    }

    /// Render into an IOSurface-backed BGRA pixel buffer (the app's preview hands its
    /// IOSurface to Electron's `sharedTexture`; nothing is copied to the CPU). Returns once
    /// the GPU has finished, so the surface can be presented.
    #[cfg(target_os = "macos")]
    pub fn render_to_surface(&self, target: &objc2_core_video::CVPixelBuffer, background: [u8; 3], layers: &[Layer]) -> Result<(), RenderError> {
        let (w, h) = (objc2_core_video::CVPixelBufferGetWidth(target) as u32, objc2_core_video::CVPixelBufferGetHeight(target) as u32);
        let surface = objc2_core_video::CVPixelBufferGetIOSurface(Some(target)).ok_or_else(|| RenderError::Device("target has no IOSurface".into()))?;
        let canvas = self.wrap_surface(&surface, 0, (w, h), wgpu::TextureFormat::Bgra8Unorm, true).ok_or_else(|| RenderError::Device("can't render into that surface".into()))?;
        let mut enc = self.device.create_command_encoder(&Default::default());
        let keep = self.encode_frame(&mut enc, &canvas, background, layers);
        self.queue.submit([enc.finish()]);
        self.device.poll(wgpu::PollType::wait_indefinitely()).map_err(|e| RenderError::Device(e.to_string()))?;
        drop(keep);
        Ok(())
    }

    /// Render `layers` (bottom first) over an opaque `background` at `width`×`height` and
    /// read the frame back (tests, stills, analysis).
    pub fn render(&self, width: u32, height: u32, background: [u8; 3], layers: &[Layer]) -> RgbaImage {
        let canvas = self.texture(width, height, CANVAS, wgpu::TextureUsages::COPY_SRC);
        let mut enc = self.device.create_command_encoder(&Default::default());
        let keep = self.encode_frame(&mut enc, &canvas, background, layers);
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

/// CPU fallback for frames the GPU can't take directly (software-decoded, unusual formats).
fn rgb_of(frame: &VideoFrame) -> RgbaImage {
    match frame.to_rgb() {
        Ok(rgb) => RgbaImage { width: rgb.width, height: rgb.height, data: rgb.data.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect() },
        Err(_) => RgbaImage { width: frame.width(), height: frame.height(), data: vec![0; (frame.width() * frame.height() * 4) as usize] },
    }
}

/// Code-value offsets/ranges and RGB coefficients for the YUV import shader.
fn yuv_params(matrix: Matrix, full: bool, ten_bit: bool) -> ([f32; 4], [f32; 4], f32) {
    let (kr, kb) = match matrix {
        Matrix::Bt601 => (0.299, 0.114),
        Matrix::Bt709 => (0.2126, 0.0722),
        Matrix::Bt2020 => (0.2627, 0.0593),
    };
    let kg = 1.0 - kr - kb;
    let coeffs = [2.0 * (1.0 - kr), -2.0 * kb * (1.0 - kb) / kg, -2.0 * kr * (1.0 - kr) / kg, 2.0 * (1.0 - kb)];
    let ranges = match (ten_bit, full) {
        (false, false) => [16.0, 219.0, 128.0, 224.0],
        (false, true) => [0.0, 255.0, 128.0, 255.0],
        (true, false) => [64.0, 876.0, 512.0, 896.0],
        (true, true) => [0.0, 1023.0, 512.0, 1023.0],
    };
    // P010 keeps 10-bit samples in the top bits of 16: unit sample = 65535 / 64 code values.
    let k = if ten_bit { 65535.0 / 64.0 } else { 255.0 };
    (ranges, coeffs, k)
}
