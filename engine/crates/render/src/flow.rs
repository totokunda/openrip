//! Frames in between two others (Smooth slow-mo, Optical flow): dense optical flow both ways
//! between the frames on the GPU, then each pixel of the frame at time t read from both along
//! its motion, weighted by t and by which frame can see it (flow.wgsl; the method and its CPU
//! reference are openrip-motion's `flow`). A straight cross-fade ("frame blending") is the
//! other mode.
//!
//! The flow is worked out at a reduced resolution (the long side at most [`WORK_SIDE`]
//! pixels, by whole-pixel blocks) and kept for the pair of frames (by the caller's key), so
//! every frame drawn between the same two source frames reuses it: at 0.25× speed, four.

use openrip_motion::flow::{FlowOptions, MAX_STEP, SEARCH_PENALTY};

use crate::{Compositor, RgbaImage, Source, CANVAS};

/// The working resolution's long side, at most.
pub const WORK_SIDE: u32 = 960;
/// Flow pairs kept, and for how many frames unused.
const KEEP_PAIRS: usize = 4;
const KEEP_FRAMES: u64 = 8;

const FLOAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;

/// How the frame in between is made.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum TweenMode {
    /// The two frames cross-faded (CapCut's "Frame blending").
    Blend,
    /// The two frames moved along their motion and mixed (CapCut's "Optical flow").
    Flow,
}

/// A frame in between two frames of the same video: `t` of the way from `from` to `to` (0–1).
/// `key` identifies the pair (the same two frames give the same key), so the flow between
/// them is worked out once.
#[derive(Copy, Clone, Debug)]
pub struct Tween<'a> {
    pub from: Source<'a>,
    pub to: Source<'a>,
    pub t: f32,
    pub key: u64,
    pub mode: TweenMode,
}

/// The flow between two frames, read back: per working pixel where it moved (in working
/// pixels), and how many full-size pixels a working pixel is across.
#[derive(Clone, Debug)]
pub struct FlowField {
    pub width: u32,
    pub height: u32,
    pub factor: u32,
    pub uv: Vec<[f32; 2]>,
}

/// The flow passes (flow.wgsl).
pub(crate) struct FlowFx {
    layout: wgpu::BindGroupLayout,
    gray: wgpu::RenderPipeline,
    down: wgpu::RenderPipeline,
    grad: wgpu::RenderPipeline,
    upsample: wgpu::RenderPipeline,
    select: wgpu::RenderPipeline,
    lk: wgpu::RenderPipeline,
    median: wgpu::RenderPipeline,
    search: wgpu::RenderPipeline,
    plan: wgpu::RenderPipeline,
    tween: wgpu::RenderPipeline,
    copy: wgpu::RenderPipeline,
    /// A 1×1 texture of zeros, for unused bindings.
    blank: wgpu::Texture,
}

impl FlowFx {
    pub(crate) fn new(device: &wgpu::Device) -> FlowFx {
        let tex = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("flow"),
            entries: &[
                tex(0),
                tex(1),
                tex(2),
                tex(3),
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("flow"), source: wgpu::ShaderSource::Wgsl(include_str!("flow.wgsl").into()) });
        let pipeline = |entry: &str, format: wgpu::TextureFormat| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        FlowFx {
            gray: pipeline("fs_gray", FLOAT),
            down: pipeline("fs_down", FLOAT),
            grad: pipeline("fs_grad", FLOAT),
            upsample: pipeline("fs_upsample", FLOAT),
            select: pipeline("fs_select", FLOAT),
            lk: pipeline("fs_lk", FLOAT),
            median: pipeline("fs_median", FLOAT),
            search: pipeline("fs_search", FLOAT),
            plan: pipeline("fs_tween_plan", FLOAT),
            tween: pipeline("fs_tween", CANVAS),
            copy: pipeline("fs_copy", FLOAT),
            blank: device.create_texture(&wgpu::TextureDescriptor {
                label: Some("flow blank"),
                size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: FLOAT,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            }),
            layout,
        }
    }
}

/// Two frames' flow both ways and their level-0 pictures, at the working resolution.
#[derive(Clone)]
pub(crate) struct FlowPair {
    ab: wgpu::Texture,
    ba: wgpu::Texture,
    a0: wgpu::Texture,
    b0: wgpu::Texture,
    factor: u32,
    /// The frames' size.
    size: (u32, u32),
}

/// Full-size pixels per working pixel for a frame of `w`×`h`.
pub fn work_factor(w: u32, h: u32) -> u32 {
    w.max(h).div_ceil(WORK_SIDE).max(1)
}

/// Pyramid levels for a picture of `w`×`h` (as openrip-motion's `Pyramid` makes them: down to
/// 16 pixels a side).
fn levels_for(w: u32, h: u32, most: usize) -> usize {
    let (mut w, mut h, mut n) = (w, h, 1);
    while n < most && w >= 32 && h >= 32 {
        w = w.div_ceil(2);
        h = h.div_ceil(2);
        n += 1;
    }
    n
}

impl Compositor {
    fn flow_fx(&self) -> &FlowFx {
        self.flow_fx.get_or_init(|| FlowFx::new(&self.device))
    }

    /// One flow.wgsl pass: up to four textures in, `dst` out (cleared).
    fn flow_pass(&self, enc: &mut wgpu::CommandEncoder, pipeline: &wgpu::RenderPipeline, inputs: &[&wgpu::Texture], dst: &wgpu::Texture, params: [f32; 8]) {
        let fx = self.flow_fx();
        let buf = wgpu::util::DeviceExt::create_buffer_init(&self.device, &wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::cast_slice(&params), usage: wgpu::BufferUsages::UNIFORM });
        let views: Vec<wgpu::TextureView> = (0..4).map(|i| inputs.get(i).copied().unwrap_or(&fx.blank).create_view(&Default::default())).collect();
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &fx.layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&views[0]) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&views[1]) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&views[2]) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&views[3]) },
                wgpu::BindGroupEntry { binding: 4, resource: buf.as_entire_binding() },
            ],
        });
        let dst_view = dst.create_view(&Default::default());
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

    /// A frame's pyramid at the working resolution, finest first: (intensity, d/dx, d/dy).
    fn flow_pyramid(&self, enc: &mut wgpu::CommandEncoder, frame: &wgpu::Texture, factor: u32, levels: usize, scratch: &mut Vec<wgpu::Texture>) -> Vec<wgpu::Texture> {
        let fx = self.flow_fx();
        let (mut w, mut h) = (frame.width().div_ceil(factor), frame.height().div_ceil(factor));
        let mut out = Vec::with_capacity(levels);
        let mut intensity = self.texture(w, h, FLOAT, wgpu::TextureUsages::empty());
        self.flow_pass(enc, &fx.gray, &[frame], &intensity, [factor as f32, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        for level in 0..levels {
            let full = self.texture(w, h, FLOAT, wgpu::TextureUsages::empty());
            self.flow_pass(enc, &fx.grad, &[&intensity], &full, [0.0; 8]);
            if level + 1 < levels {
                let (nw, nh) = (w.div_ceil(2), h.div_ceil(2));
                let next = self.texture(nw, nh, FLOAT, wgpu::TextureUsages::empty());
                self.flow_pass(enc, &fx.down, &[&intensity], &next, [0.0; 8]);
                scratch.push(std::mem::replace(&mut intensity, next));
                (w, h) = (nw, nh);
            }
            out.push(full);
        }
        scratch.push(intensity);
        out
    }

    /// The flow from the frame of pyramid `pa` to that of `pb`, at their finest level.
    fn flow_between(&self, enc: &mut wgpu::CommandEncoder, pa: &[wgpu::Texture], pb: &[wgpu::Texture], scratch: &mut Vec<wgpu::Texture>) -> wgpu::Texture {
        let fx = self.flow_fx();
        let o = FlowOptions::default();
        let lk = [o.sigma, o.lambda, o.relative, o.robust, MAX_STEP, 0.0, 0.0, 0.0];
        let mut flow: Option<wgpu::Texture> = None;
        for level in (0..pa.len()).rev() {
            let (a, b) = (&pa[level], &pb[level]);
            let (w, h) = (a.width(), a.height());
            let fresh = |c: &Compositor| c.texture(w, h, FLOAT, wgpu::TextureUsages::empty());
            let mut f = fresh(self);
            match flow.take() {
                Some(coarse) => {
                    self.flow_pass(enc, &fx.upsample, &[&coarse], &f, [0.0; 8]);
                    scratch.push(coarse);
                }
                // The coarsest level starts from an exhaustive search.
                None => self.flow_pass(enc, &fx.search, &[&fx.blank, a, b], &f, [o.search_radius as f32, SEARCH_PENALTY, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
            }
            let mut step = |pipeline: &wgpu::RenderPipeline, params: [f32; 8], f: &mut wgpu::Texture| {
                let next = fresh(self);
                self.flow_pass(enc, pipeline, &[f, a, b], &next, params);
                scratch.push(std::mem::replace(f, next));
            };
            if o.select_radius > 0 {
                step(&fx.select, [o.select_radius as f32, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], &mut f);
            }
            for _ in 0..o.iterations {
                step(&fx.lk, lk, &mut f);
            }
            if o.select_radius > 0 {
                step(&fx.select, [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], &mut f);
            }
            step(&fx.median, [0.0; 8], &mut f);
            flow = Some(f);
        }
        flow.expect("at least one level")
    }

    /// The flow both ways between two frames (premultiplied RGBA of the same size), kept by
    /// `key`.
    fn flow_pair(&self, enc: &mut wgpu::CommandEncoder, a: &wgpu::Texture, b: &wgpu::Texture, key: u64, scratch: &mut Vec<wgpu::Texture>) -> FlowPair {
        let frame = self.frame.load(std::sync::atomic::Ordering::Relaxed);
        {
            let mut flows = self.flows.lock().unwrap();
            if let Some((_, pair, last)) = flows.iter_mut().find(|(k, p, _)| *k == key && p.size == (a.width(), a.height())) {
                *last = frame;
                return pair.clone();
            }
        }
        let factor = work_factor(a.width(), a.height());
        let levels = levels_for(a.width().div_ceil(factor), a.height().div_ceil(factor), FlowOptions::default().levels);
        let pa = self.flow_pyramid(enc, a, factor, levels, scratch);
        let pb = self.flow_pyramid(enc, b, factor, levels, scratch);
        let ab = self.flow_between(enc, &pa, &pb, scratch);
        let ba = self.flow_between(enc, &pb, &pa, scratch);
        let mut pa = pa.into_iter();
        let mut pb = pb.into_iter();
        let (a0, b0) = (pa.next().unwrap(), pb.next().unwrap());
        scratch.extend(pa.chain(pb));
        let pair = FlowPair { ab, ba, a0, b0, factor, size: (a.width(), a.height()) };
        let mut flows = self.flows.lock().unwrap();
        flows.retain(|(k, _, last)| *k != key && frame.saturating_sub(*last) < KEEP_FRAMES);
        if flows.len() >= KEEP_PAIRS {
            flows.sort_by_key(|(_, _, last)| std::cmp::Reverse(*last));
            flows.truncate(KEEP_PAIRS - 1);
        }
        flows.push((key, pair.clone(), frame));
        pair
    }

    /// The frame `t` of the way from `a` to `b` (premultiplied RGBA of the same size).
    pub(crate) fn tween_textures(&self, enc: &mut wgpu::CommandEncoder, a: &wgpu::Texture, b: &wgpu::Texture, tween: &Tween, scratch: &mut Vec<wgpu::Texture>) -> wgpu::Texture {
        let fx = self.flow_fx();
        let out = self.texture(a.width(), a.height(), CANVAS, wgpu::TextureUsages::empty());
        let t = tween.t.clamp(0.0, 1.0);
        if tween.mode == TweenMode::Blend || (a.width(), a.height()) != (b.width(), b.height()) {
            self.flow_pass(enc, &fx.tween, &[a, b], &out, [t, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
            return out;
        }
        let pair = self.flow_pair(enc, a, b, tween.key, scratch);
        let plan = self.texture(pair.a0.width(), pair.a0.height(), FLOAT, wgpu::TextureUsages::empty());
        self.flow_pass(enc, &fx.plan, &[&pair.ab, &pair.ba, &pair.a0, &pair.b0], &plan, [t, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        self.flow_pass(enc, &fx.tween, &[a, b, &plan], &out, [t, pair.factor as f32, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        scratch.push(plan);
        out
    }

    /// The flow from `a` to `b` (straight RGBA of the same size) at the working resolution,
    /// read back (tests and diagnostics).
    pub fn optical_flow(&self, a: &RgbaImage, b: &RgbaImage) -> FlowField {
        let mut enc = self.device.create_command_encoder(&Default::default());
        let mut scratch = Vec::new();
        let ta = self.upload(&mut enc, a, None, &mut scratch);
        let tb = self.upload(&mut enc, b, None, &mut scratch);
        let factor = work_factor(a.width, a.height);
        let levels = levels_for(a.width.div_ceil(factor), a.height.div_ceil(factor), FlowOptions::default().levels);
        let pa = self.flow_pyramid(&mut enc, &ta, factor, levels, &mut scratch);
        let pb = self.flow_pyramid(&mut enc, &tb, factor, levels, &mut scratch);
        let ab = self.flow_between(&mut enc, &pa, &pb, &mut scratch);
        let (w, h) = (ab.width(), ab.height());
        let row = (w * 16).div_ceil(256) * 256;
        let buf = self.device.create_buffer(&wgpu::BufferDescriptor { label: None, size: (row * h) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
        // The flow texture needs copying out: render it into one that can be.
        let readable = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("flow readback"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FLOAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        self.flow_pass(&mut enc, &self.flow_fx().copy, &[&ab], &readable, [0.0; 8]);
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: &readable, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer: &buf, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(h) } },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        let done = self.queue.submit([enc.finish()]);
        buf.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("map flow"));
        self.wait_for(done).expect("poll");
        let mapped = buf.slice(..).get_mapped_range().expect("mapped flow");
        let mut uv = Vec::with_capacity((w * h) as usize);
        for y in 0..h as usize {
            let line: &[f32] = bytemuck::cast_slice(&mapped[y * row as usize..y * row as usize + w as usize * 16]);
            uv.extend(line.chunks_exact(4).map(|p| [p[0], p[1]]));
        }
        drop(mapped);
        buf.unmap();
        scratch.extend(pa.into_iter().chain(pb));
        scratch.push(ab);
        self.recycle(scratch);
        FlowField { width: w, height: h, factor, uv }
    }
}
