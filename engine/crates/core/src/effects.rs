//! OpenRip's own video effects for a client's Effects tab: the catalog (names, categories,
//! parameters) and frames of any effect drawn by the engine's own renderer on a sample picture,
//! so a tile's preview is what the effect looks like in the player and in an export.

use std::sync::Mutex;

use openrip_model::fx::{self, CATEGORIES, FX};
use openrip_render::{sample_scene, Compositor, EffectPass, Layer, RgbaImage, Source};
use serde_json::{json, Value};

use crate::{Error, Result};

/// The catalog as JSON: `{ categories: [...], effects: [{ id, name, category, intensity, params:
/// [{ id, name, default }] }] }`, values on the app's 0–100 scale.
pub fn effect_catalog() -> Value {
    let pct = |v: f32| (v * 100.0).round();
    json!({
        "categories": CATEGORIES,
        "effects": FX.iter().map(|e| json!({
            "id": e.id,
            "name": e.name,
            "category": e.category,
            "intensity": pct(e.intensity),
            "params": e.params.iter().map(|p| json!({ "id": p.id, "name": p.name, "default": pct(p.default) })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    })
}

/// A short code that changes when the engine's drawing of the transition or effect `id` does (its
/// shaders and, for an effect, its catalog entry), for a client that keeps pictures of them.
pub fn preview_revision(id: &str, effect: bool) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |bytes: &[u8]| {
        for b in bytes {
            hash = (hash ^ *b as u64).wrapping_mul(0x0100_0000_01b3);
        }
    };
    for source in openrip_render::shader_sources(id, effect) {
        feed(source.as_bytes());
    }
    if effect {
        if let Some(def) = fx::find(id) {
            feed(format!("{}{}{}{}", def.kind, def.intensity, def.params.len(), def.params.iter().map(|p| p.default.to_string()).collect::<String>()).as_bytes());
        }
    }
    format!("{hash:016x}")
}

/// Draws effect previews. Holds its own compositor, made on first use.
pub struct EffectPreviews {
    compositor: Mutex<Option<Compositor>>,
}

impl Default for EffectPreviews {
    fn default() -> Self {
        Self::new()
    }
}

impl EffectPreviews {
    pub const fn new() -> Self {
        EffectPreviews { compositor: Mutex::new(None) }
    }

    /// Frames of effect `id` on the sample picture, `width` × `height`, at `times` seconds into
    /// an effect `duration` seconds long. `intensity` and `params` are 0…1 (the catalog's
    /// defaults where missing).
    pub fn frames(&self, id: &str, intensity: Option<f64>, params: &[f64], times: &[f64], duration: f64, width: u32, height: u32) -> Result<Vec<RgbaImage>> {
        let def = fx::find(id).ok_or_else(|| Error::Analysis(format!("no effect called {id}")))?;
        let mut guard = self.compositor.lock().unwrap();
        if guard.is_none() {
            *guard = Some(Compositor::new().map_err(|e| Error::Analysis(e.to_string()))?);
        }
        let compositor = guard.as_ref().unwrap();
        let scene = sample_scene(width, height);
        let mut own = [0.0f32; 3];
        for (i, p) in def.params.iter().enumerate() {
            own[i] = params.get(i).map_or(p.default, |v| *v as f32).clamp(0.0, 1.0);
        }
        let duration = duration.max(0.001);
        Ok(times
            .iter()
            .map(|&t| {
                let pass = EffectPass { kind: def.kind, intensity: intensity.map_or(def.intensity, |v| v as f32).clamp(0.0, 1.0), params: own, time: t as f32, progress: (t / duration).clamp(0.0, 1.0) as f32, seed: 0.0 };
                let layers = [Layer::from_model(&scene, [width, height], [0.0, 0.0], [1.0, 1.0], 0.0), Layer::pass(Source::Effect(pass))];
                compositor.render(width, height, [0, 0, 0], &layers)
            })
            .collect())
    }
}
