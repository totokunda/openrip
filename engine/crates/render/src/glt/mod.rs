//! Shader transitions from the gl-transitions collection (https://github.com/gl-transitions/
//! gl-transitions): about a hundred ways to get from one picture to another, each a fragment
//! shader that takes the two clips' frames, the progress and its own parameters.
//!
//! The WGSL files here are the collection's own translations of its GLSL (each keeps its
//! author and licence in its header: MIT, two of them BSD) and `table.rs` lists them with
//! their uniform layouts and defaults; both come from `engine/scripts/gen-gl-transitions.mjs`.
//! The compositor draws one in place of the plain mix pass (`Mix::fx`): the two groups the
//! transition joins are its `from` and `to` pictures. The collection's shaders speak straight
//! (unpremultiplied) colour; the groups hold premultiplied colour, so the wrapper below
//! unpremultiplies what the shader samples and premultiplies what it returns.

mod table;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub use table::TABLE;

/// How many parameters one transition can take (the collection's most is 12).
pub const MAX_PARAMS: usize = 12;

/// A parameter's type in the shader's uniform buffer.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    Float,
    Int,
    /// An `i32`, 0 or 1.
    Bool,
    Vec2,
    Vec3,
    Vec4,
    IVec2,
}

#[derive(Copy, Clone, Debug)]
pub struct GlParam {
    pub name: &'static str,
    pub kind: Kind,
    /// Byte offset in the uniform buffer.
    pub offset: usize,
    /// The default, in the first components.
    pub default: [f32; 4],
}

#[derive(Copy, Clone, Debug)]
pub struct GlTransition {
    /// The id a project keeps: "gl_" and the collection's name.
    pub id: &'static str,
    pub author: &'static str,
    pub license: &'static str,
    /// The uniform buffer's size in bytes.
    pub size: usize,
    pub wgsl: &'static str,
    pub params: &'static [GlParam],
}

/// The collection's transition `id` ("gl_CrossZoom").
pub fn find(id: &str) -> Option<&'static GlTransition> {
    TABLE.iter().find(|t| t.id == id)
}

/// A transition at one moment: its progress (0 the outgoing picture, 1 the incoming one) and
/// its parameters' values, in the order of [`GlTransition::params`].
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct GlFx {
    pub id: &'static str,
    pub progress: f32,
    pub values: [[f32; 4]; MAX_PARAMS],
}

impl GlFx {
    /// A transition with its defaults, or `None` for an id that isn't in the collection.
    pub fn new(id: &str, progress: f32) -> Option<GlFx> {
        let t = find(id)?;
        let mut values = [[0.0; 4]; MAX_PARAMS];
        for (v, p) in values.iter_mut().zip(t.params) {
            *v = p.default;
        }
        Some(GlFx { id: t.id, progress, values })
    }
}

/// The uniform buffer for `fx` at an output of `ratio` (width over height).
pub(crate) fn pack(t: &GlTransition, fx: &GlFx, ratio: f32) -> Vec<u8> {
    let mut out = vec![0u8; t.size.max(16).next_multiple_of(16)];
    let mut put = |at: usize, bytes: [u8; 4]| out[at..at + 4].copy_from_slice(&bytes);
    put(0, fx.progress.to_le_bytes());
    put(4, ratio.to_le_bytes());
    for (p, v) in t.params.iter().zip(fx.values.iter()) {
        let int = |x: f32| (x.round() as i32).to_le_bytes();
        match p.kind {
            Kind::Float => put(p.offset, v[0].to_le_bytes()),
            Kind::Int | Kind::Bool => put(p.offset, int(v[0])),
            Kind::Vec2 | Kind::Vec3 | Kind::Vec4 => {
                let n = match p.kind {
                    Kind::Vec2 => 2,
                    Kind::Vec3 => 3,
                    _ => 4,
                };
                for (i, x) in v.iter().take(n).enumerate() {
                    put(p.offset + 4 * i, x.to_le_bytes());
                }
            }
            Kind::IVec2 => {
                put(p.offset, int(v[0]));
                put(p.offset + 4, int(v[1]));
            }
        }
    }
    out
}

/// The shader as the compositor compiles it: the collection's file with its texture reads
/// unpremultiplied, its `main` turned into a function, and a vertex stage and a fragment
/// entry (`glx_fs`) that premultiplies the result.
fn source(t: &GlTransition) -> String {
    let body = t
        .wgsl
        .replace("textureSampleLevel(_from, _sampler, ", "glx_from(")
        .replace("textureSampleLevel(_to, _sampler, ", "glx_to(")
        .replace("@fragment \nfn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {", "fn gl_main(_uv: vec2<f32>) -> vec4<f32> {");
    format!(
        "{body}
fn glx_straight(c: vec4<f32>) -> vec4<f32> {{
    if (c.a <= 0.0) {{
        return vec4<f32>(0.0);
    }}
    return vec4<f32>(c.rgb / c.a, c.a);
}}
fn glx_from(uv: vec2<f32>, lod: f32) -> vec4<f32> {{
    return glx_straight(textureSampleLevel(_from, _sampler, uv, lod));
}}
fn glx_to(uv: vec2<f32>, lod: f32) -> vec4<f32> {{
    return glx_straight(textureSampleLevel(_to, _sampler, uv, lod));
}}
struct GlxV {{
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
}}
@vertex
fn glx_vs(@builtin(vertex_index) i: u32) -> GlxV {{
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var o: GlxV;
    o.pos = vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
    o.uv = vec2<f32>(p.x, 1.0 - p.y);
    return o;
}}
@fragment
fn glx_fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {{
    let c = clamp(gl_main(uv), vec4<f32>(0.0), vec4<f32>(1.0));
    return vec4<f32>(c.rgb * c.a, c.a);
}}
"
    )
}

/// The compositor's transition pipelines, made when a transition is first drawn.
pub(crate) struct Pipelines {
    layout: wgpu::BindGroupLayout,
    pipeline_layout: wgpu::PipelineLayout,
    sampler: wgpu::Sampler,
    made: Mutex<HashMap<(&'static str, wgpu::TextureFormat), Arc<wgpu::RenderPipeline>>>,
}

impl Pipelines {
    pub(crate) fn new(device: &wgpu::Device) -> Self {
        let texture = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("glt"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
                texture(2),
                texture(3),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("glt"), bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Pipelines { layout, pipeline_layout, sampler, made: Mutex::new(HashMap::new()) }
    }

    fn pipeline(&self, device: &wgpu::Device, t: &'static GlTransition, format: wgpu::TextureFormat) -> Arc<wgpu::RenderPipeline> {
        let mut made = self.made.lock().unwrap();
        made.entry((t.id, format))
            .or_insert_with(|| {
                let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some(t.id), source: wgpu::ShaderSource::Wgsl(source(t).into()) });
                Arc::new(device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(t.id),
                    layout: Some(&self.pipeline_layout),
                    vertex: wgpu::VertexState { module: &module, entry_point: Some("glx_vs"), compilation_options: Default::default(), buffers: &[] },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some("glx_fs"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })],
                    }),
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                }))
            })
            .clone()
    }

    /// Draw the transition between `from` and `to` over `target`.
    pub(crate) fn draw(&self, device: &wgpu::Device, enc: &mut wgpu::CommandEncoder, fx: &GlFx, from: &wgpu::Texture, to: &wgpu::Texture, target: &wgpu::Texture) {
        use wgpu::util::DeviceExt;
        let Some(t) = find(fx.id) else { return };
        let ratio = target.width() as f32 / target.height().max(1) as f32;
        let buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: &pack(t, fx, ratio), usage: wgpu::BufferUsages::UNIFORM });
        let (a, b, dst) = (from.create_view(&Default::default()), to.create_view(&Default::default()), target.create_view(&Default::default()));
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&a) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&b) },
            ],
        });
        let pipeline = self.pipeline(device, t, target.format());
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(t.id),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &dst,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_is_whole() {
        assert!(TABLE.len() >= 100);
        for t in TABLE {
            assert!(t.id.starts_with("gl_") && t.wgsl.contains("fn main("), "{}", t.id);
            assert!(t.wgsl.contains("// License: "), "{} has no licence in its header", t.id);
            assert!(t.wgsl.contains("// Author: "), "{} has no author in its header", t.id);
            assert!(t.params.len() <= MAX_PARAMS, "{}", t.id);
            assert!(source(t).contains("fn gl_main("), "{}", t.id);
        }
    }

    #[test]
    fn parameters_land_where_the_shader_reads_them() {
        let t = find("gl_Bounce").unwrap();
        let mut fx = GlFx::new("gl_Bounce", 0.25).unwrap();
        fx.values[2][0] = 5.0;
        let b = pack(t, &fx, 1.5);
        let f = |at: usize| f32::from_le_bytes(b[at..at + 4].try_into().unwrap());
        assert_eq!((f(0), f(4)), (0.25, 1.5));
        // shadow_colour (vec4 at 16), shadow_height at 32, bounces at 36.
        assert_eq!((f(16 + 12), f(32), f(36)), (0.6, 0.075, 5.0));
    }
}
