//! OpenRip's own video effects on the GPU: one shader pass over the canvas (or a clip's group)
//! with the effect's strength and parameters over time (`effects.wgsl`). The catalog of effects
//! is `openrip_model::fx`; what a pass takes is just numbers, so the model and the renderer
//! stay apart.

use std::borrow::Cow;

use crate::{Compositor, Matte, Params, RgbaImage, CANVAS};

/// Where all of an effect bar's masks cover: the one mask as it is, several multiplied (the
/// red channels; masks of another size than the first are left out). Masks that keep the
/// bar's own pixels both inside and outside change nothing and are left out too. `None`
/// without any, so the effect is everywhere.
fn combined_coverage<'a>(mattes: &'a [Matte]) -> Option<Cow<'a, RgbaImage>> {
    let mut masks = mattes.iter().filter(|m| m.inside.is_some() || m.outside.is_some()).map(|m| m.mask);
    let first = masks.next()?;
    let rest: Vec<&RgbaImage> = masks.filter(|m| (m.width, m.height) == (first.width, first.height)).collect();
    if rest.is_empty() {
        return Some(Cow::Borrowed(first));
    }
    let mut out = first.clone();
    for m in rest {
        for (o, v) in out.data.chunks_exact_mut(4).zip(m.data.chunks_exact(4)) {
            o[0] = ((o[0] as u32 * v[0] as u32 + 127) / 255) as u8;
        }
    }
    Some(Cow::Owned(out))
}

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
    /// With `mattes` (an effect bar's masks), only inside where they all cover.
    pub(crate) fn effect_canvas(&self, enc: &mut wgpu::CommandEncoder, canvas: &wgpu::Texture, place_pipeline: &wgpu::RenderPipeline, pass: &EffectPass, opaque: bool, mattes: &[Matte], scratch: &mut Vec<wgpu::Texture>) {
        if pass.intensity <= 0.0 {
            return;
        }
        let (w, h) = (canvas.width(), canvas.height());
        let tmp = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
        let [a, b, c] = pass.params;
        let coverage = combined_coverage(mattes);
        let mask = coverage.as_deref().map(|m| self.upload(enc, m, None, scratch));
        let values = [pass.kind as f32, pass.intensity.clamp(0.0, 1.0), a, b, c, pass.time, pass.progress, pass.seed, w as f32, h as f32, if opaque { 1.0 } else { 0.0 }, mask.is_some() as u8 as f32];
        self.canvas_pass(enc, &self.fx, canvas, mask.as_ref().unwrap_or(canvas), &tmp, &values);
        scratch.extend(mask);
        let back = Params { src_size: [w as f32, h as f32], dst_size: [w as f32, h as f32], inv0: [1.0, 0.0, 0.0, 0.0], inv1: [0.0, 1.0, 0.0, 0.0], misc: [1.0, 0.0, 0.0, 0.0] };
        self.pass(enc, place_pipeline, &tmp, canvas, back, Some(wgpu::Color::TRANSPARENT));
        scratch.push(tmp);
    }
}

/// A made-up picture for showing what an effect does where there's no clip to show it on (the
/// Effects tab's tiles): a warm sky with a low sun, hills, a chequered floor and a figure in
/// front, so there are colours, soft gradients, hard edges and bright parts to work on.
pub fn sample_scene(w: u32, h: u32) -> crate::RgbaImage {
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    let (wf, hf) = (w as f32, h as f32);
    let mix = |a: [f32; 3], b: [f32; 3], t: f32| [0, 1, 2].map(|i| a[i] + (b[i] - a[i]) * t.clamp(0.0, 1.0));
    for y in 0..h {
        for x in 0..w {
            let (u, v) = (x as f32 / wf, y as f32 / hf);
            // Sky: deep blue at the top to orange at the horizon.
            let mut c = mix([0.12, 0.2, 0.5], [1.0, 0.62, 0.3], v / 0.62);
            // The sun.
            let (dx, dy) = ((u - 0.68) * wf / hf, v - 0.5);
            let sun = (dx * dx + dy * dy).sqrt();
            c = mix(c, [1.0, 0.97, 0.8], 1.0 - (sun / 0.09).powi(4));
            c = mix(c, [1.0, 0.8, 0.5], (0.5 - sun).max(0.0) * 0.5);
            // Two ranges of hills.
            let far = 0.6 + 0.05 * (u * 9.0).sin() + 0.03 * (u * 23.0).sin();
            let near = 0.7 + 0.06 * (u * 5.0 + 1.0).sin();
            if v > far {
                c = [0.35, 0.2, 0.38];
            }
            if v > near {
                c = [0.13, 0.12, 0.2];
            }
            // A chequered floor at the bottom.
            if v > 0.84 {
                let (cx, cy) = (((u - 0.5) * (1.0 + (v - 0.84) * 6.0) * 14.0).floor(), ((v - 0.84) * 20.0).floor());
                c = if (cx + cy) as i32 % 2 == 0 { [0.85, 0.82, 0.78] } else { [0.18, 0.17, 0.2] };
            }
            // A figure: head and body.
            let (hx, hy) = ((u - 0.3) * wf / hf, v - 0.42);
            if hx * hx + hy * hy < 0.0036 || ((u - 0.3).abs() * wf / hf < 0.09 && v > 0.47 && v < 0.84) {
                c = [0.9, 0.25, 0.2];
            }
            data.extend_from_slice(&[(c[0] * 255.0) as u8, (c[1] * 255.0) as u8, (c[2] * 255.0) as u8, 255]);
        }
    }
    crate::RgbaImage { width: w, height: h, data }
}
