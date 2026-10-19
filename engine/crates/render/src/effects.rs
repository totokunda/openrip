//! OpenRip's own video effects on the GPU: one shader pass over the canvas (or a clip's group)
//! with the effect's strength and parameters over time (`effects.wgsl`). The catalog of effects
//! is `openrip_model::fx`; what a pass takes is just numbers, so the model and the renderer
//! stay apart.

use crate::{Compositor, Params, CANVAS};

/// One effect pass: which effect, its values now, and where it is in its run.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EffectPass {
    /// The effect's number (`FxDef::kind`).
    pub kind: u32,
    /// Strength, 0…1 (0 leaves the picture as it was).
    pub intensity: f32,
    /// The effect's own parameters, 0…1.
    pub params: [f32; 3],
    /// Seconds since the effect began.
    pub time: f32,
    /// How far through its duration, 0…1.
    pub progress: f32,
    /// Varies the random parts from effect to effect.
    pub seed: f32,
}

impl Compositor {
    /// Apply `pass` to everything drawn so far: into a temporary, then back over the canvas
    /// (cleared first, so a group's transparent parts stay so).
    pub(crate) fn effect_canvas(&self, enc: &mut wgpu::CommandEncoder, canvas: &wgpu::Texture, place_pipeline: &wgpu::RenderPipeline, pass: &EffectPass, opaque: bool, scratch: &mut Vec<wgpu::Texture>) {
        if pass.intensity <= 0.0 {
            return;
        }
        let (w, h) = (canvas.width(), canvas.height());
        let tmp = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
        let [a, b, c] = pass.params;
        let values = [pass.kind as f32, pass.intensity.clamp(0.0, 1.0), a, b, c, pass.time, pass.progress, pass.seed, w as f32, h as f32, if opaque { 1.0 } else { 0.0 }, 0.0];
        self.canvas_pass(enc, &self.fx, canvas, canvas, &tmp, &values);
        let back = Params { src_size: [w as f32, h as f32], dst_size: [w as f32, h as f32], inv0: [1.0, 0.0, 0.0, 0.0], inv1: [0.0, 1.0, 0.0, 0.0], misc: [1.0, 0.0, 0.0, 0.0] };
        self.pass(enc, place_pipeline, &tmp, canvas, back, Some(wgpu::Color::TRANSPARENT));
        scratch.push(tmp);
    }
}
