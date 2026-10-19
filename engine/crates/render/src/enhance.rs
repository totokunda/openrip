//! A clip's clean-up on its own picture (enhance.wgsl): Remove flickers' gain, Reduce image
//! noise and Motion blur, which look at the frames either side of the one shown. Stabilize
//! isn't here: it moves the layer (the caller folds it into the placement).

use wgpu::util::DeviceExt;

use crate::flow::Picture;
use crate::{Compositor, CANVAS};

/// What to do to a video layer's picture, and the neighbouring frames to do it with.
#[derive(Copy, Clone, Debug)]
pub struct Enhance<'a> {
    /// The frame before and the frame after the one shown, when they exist.
    pub prev: Option<Picture<'a>>,
    pub next: Option<Picture<'a>>,
    /// Reduce image noise, 0–1 (0 off).
    pub denoise: f32,
    /// Motion blur, 0–1 (0 off).
    pub blur: f32,
    /// Remove flickers: the brightness gain (1 for none).
    pub gain: f32,
}

impl Enhance<'_> {
    /// Nothing to do.
    pub fn is_identity(&self) -> bool {
        self.denoise <= 0.0 && self.blur <= 0.0 && (self.gain - 1.0).abs() < 1e-3
    }
}

pub(crate) struct EnhanceFx {
    layout: wgpu::BindGroupLayout,
    temporal: wgpu::RenderPipeline,
    spatial: wgpu::RenderPipeline,
}

impl EnhanceFx {
    pub(crate) fn new(device: &wgpu::Device) -> EnhanceFx {
        let tex = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("enhance"),
            entries: &[
                tex(0),
                tex(1),
                tex(2),
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("enhance"), source: wgpu::ShaderSource::Wgsl(include_str!("enhance.wgsl").into()) });
        let pipeline = |entry: &str| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format: CANVAS, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        EnhanceFx { temporal: pipeline("fs_temporal"), spatial: pipeline("fs_spatial"), layout }
    }
}

impl Compositor {
    fn enhance_pass(&self, enc: &mut wgpu::CommandEncoder, pipeline: &wgpu::RenderPipeline, layout: &wgpu::BindGroupLayout, tex: [&wgpu::Texture; 3], dst: &wgpu::Texture, params: [f32; 8]) {
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::cast_slice(&params), usage: wgpu::BufferUsages::UNIFORM });
        let views = tex.map(|t| t.create_view(&Default::default()));
        let dst_view = dst.create_view(&Default::default());
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&views[0]) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&views[1]) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&views[2]) },
                wgpu::BindGroupEntry { binding: 3, resource: buf.as_entire_binding() },
            ],
        });
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &dst_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
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

    /// `src` (premultiplied RGBA) with the clean-up done, as a new texture; `src` goes to
    /// `scratch`.
    pub(crate) fn enhance_texture(&self, enc: &mut wgpu::CommandEncoder, src: wgpu::Texture, e: &Enhance, keep: &mut Vec<wgpu::Texture>, scratch: &mut Vec<wgpu::Texture>) -> wgpu::Texture {
        let fx = self.enhance_fx.get_or_init(|| EnhanceFx::new(&self.device));
        let (w, h) = (src.width(), src.height());
        // The neighbours, if they're the same size (a source that changed size part way isn't
        // one to average).
        let mut neighbour = |p: &Option<Picture>| p.filter(|p| p.size() == (w, h)).map(|p| self.picture_texture(enc, p, keep, scratch));
        let (prev, next) = if e.denoise > 0.0 || e.blur > 0.0 { (neighbour(&e.prev), neighbour(&e.next)) } else { (None, None) };
        let params = |strength: f32| [e.gain, e.blur, strength, prev.is_some() as u32 as f32, next.is_some() as u32 as f32, 0.0, 0.0, 0.0];
        let mut out = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
        self.enhance_pass(enc, &fx.temporal, &fx.layout, [&src, prev.as_ref().unwrap_or(&src), next.as_ref().unwrap_or(&src)], &out, params(e.denoise));
        scratch.push(src);
        if e.denoise > 0.0 {
            let smooth = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
            self.enhance_pass(enc, &fx.spatial, &fx.layout, [&out, &out, &out], &smooth, params(e.denoise));
            scratch.push(std::mem::replace(&mut out, smooth));
        }
        scratch.extend(prev.into_iter().chain(next));
        out
    }
}
