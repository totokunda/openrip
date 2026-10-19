//! OpenRip's own video effects from the app (`openrip_model::fx` lists them): an effect bar
//! (a filter-track clip with an `effectId`) and the effects on a video or photo (its `effects`).
//! Each becomes an effect material (`fx:<id>`, category video effect) with its strength and
//! parameters, on the bar's own segment or attached to the clip's; the app's values run 0…100
//! and the model's 0…1. Their keyframes (`intensity` and `fx:<param>` on a bar,
//! `fx:<instance>:<param>` on a clip) are in `keys.rs`.

use std::collections::BTreeMap;

use openrip_model::fx::{self, FxDef};
use openrip_model::*;
use serde_json::Value;

use crate::s;

/// The effect material the app's fields describe: its strength (0…100, or the catalog's
/// default) and its own parameters by name (0…100).
fn material(id: MaterialId, def: &FxDef, intensity: Option<f64>, params: Option<&Value>) -> Effect {
    let mut values = BTreeMap::new();
    values.insert("intensity".to_string(), intensity.map_or(def.intensity as f64, |v| (v / 100.0).clamp(0.0, 1.0)));
    for p in def.params {
        if let Some(v) = params.and_then(|o| o.get(p.id)).and_then(Value::as_f64).filter(|v| v.is_finite()) {
            values.insert(p.id.to_string(), (v / 100.0).clamp(0.0, 1.0));
        }
    }
    Effect { id, category: EffectCategory::VideoEffect, name: def.name.to_string(), params: values, builtin: Some(def.builtin()), resource: None, library: None, text_style: None }
}

/// An effect bar's material, for the clip `id` (a filter-track clip with an `effectId`).
pub(crate) fn bar(id: &str, clip: &Value) -> Option<Effect> {
    let def = fx::find(&s(clip, "effectId"))?;
    Some(material(MaterialId(format!("{id}-fx")), def, clip.get("intensity").and_then(Value::as_f64), clip.get("effectParams")))
}

/// The material of effect instance `inst` on clip `id`.
pub(crate) fn instance_id(id: &str, inst: &str) -> MaterialId {
    MaterialId(format!("{id}-fx-{inst}"))
}

/// Attach the effects on a video or photo (`effects`: `{ id, effectId, intensity?, params? }`).
pub(crate) fn attach(id: &str, clip: &Value, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    for e in clip.get("effects").and_then(Value::as_array).into_iter().flatten() {
        let Some(def) = fx::find(&s(e, "effectId")) else { continue };
        let mid = instance_id(id, &s(e, "id"));
        materials.effects.retain(|m| m.id != mid);
        materials.effects.push(material(mid.clone(), def, e.get("intensity").and_then(Value::as_f64), e.get("params")));
        attachments.push(mid);
    }
}

/// The model parameter that is slot `slot` of an effect (0 is the strength).
fn param_of(slot: usize) -> Option<Param> {
    [Param::Intensity, Param::FxA, Param::FxB, Param::FxC].get(slot).copied()
}

/// The material and model parameter an app keyframe property drives: `intensity` or `fx:<param>`
/// on a bar, `fx:<instance>:<param>` (`intensity` among the params) on a clip's effect.
pub(crate) fn key_target(name: &str, seg: &Segment, materials: &Materials) -> Option<(MaterialId, Param)> {
    let (mid, param) = match name.strip_prefix("fx:") {
        Some(rest) => match rest.split_once(':') {
            Some((inst, p)) => (instance_id(&seg.id, inst), p),
            None => (seg.material.clone(), rest),
        },
        None if name == "intensity" => (seg.material.clone(), "intensity"),
        None => return None,
    };
    let e = materials.effects.iter().find(|e| e.id == mid)?;
    let def = fx::find(e.builtin.as_deref()?.strip_prefix(fx::BUILTIN_PREFIX)?)?;
    Some((mid, param_of(def.slot(param)?)?))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{import_v1_json, Imported};

    fn doc() -> Value {
        json!({
            "version": "1.0.0",
            "settings": {"fps": 24, "aspectRatio": {"width": 16, "height": 9, "id": "16:9"}},
            "assets": {"A": {"id": "A", "type": "video", "path": "file:///nope.mp4", "width": 1920, "height": 1080, "duration": 10.0}},
            "timeline": {
                "tracks": [{"type": "filter", "timelineId": "TF"}, {"type": "media", "timelineId": "TM"}],
                "clips": [
                    {"clipId": "v", "type": "video", "timelineId": "TM", "assetId": "A", "startTick": "0", "endTick": "4000000", "trimStartTick": "0", "trimEndTick": "0",
                     "mediaWidth": 1920, "mediaHeight": 1080, "volume": 0,
                     "transform": {"x": 0, "y": 0, "width": 1066.6666666666667, "height": 600, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 100},
                     "effects": [{"id": "e1", "effectId": "glow", "intensity": 40, "params": {"radius": 80}}],
                     "keyframes": {"fx:e1:intensity": [{"frame": 0, "value": 0}, {"frame": 48, "value": 100}]}},
                    {"clipId": "bar", "type": "filter", "timelineId": "TF", "effectId": "shake", "name": "Shake", "intensity": 60, "effectParams": {"speed": 20},
                     "startTick": "1000000", "endTick": "3000000", "trimStartTick": "0", "trimEndTick": "0",
                     "keyframes": {"intensity": [{"frame": 0, "value": 100}, {"frame": 24, "value": 0}], "fx:speed": [{"frame": 0, "value": 0}, {"frame": 24, "value": 100}]}}
                ]
            }
        })
    }

    #[test]
    fn an_effect_bar_and_an_effect_on_a_clip() {
        let Imported { project, .. } = import_v1_json(&doc()).unwrap();
        // The bar sits on an effect track, as CapCut's do, with the effect as its material.
        let track = project.tracks.iter().find(|t| t.segments.iter().any(|s| s.id == "bar")).unwrap();
        assert_eq!(track.kind, TrackKind::Effect);
        let bar = &track.segments[0];
        let e = project.materials.effects.iter().find(|e| e.id == bar.material).unwrap();
        assert_eq!((e.category, e.builtin.as_deref()), (EffectCategory::VideoEffect, Some("fx:shake")));
        assert_eq!((e.params["intensity"], e.params["speed"]), (0.6, 0.2));
        // Its keys: strength down, speed up, over the bar's second.
        let half = Micros(500_000);
        let now = bar.effect_at(e, half);
        assert!((now.params["intensity"] - 0.5).abs() < 1e-9 && (now.params["speed"] - 0.5).abs() < 1e-9, "{:?}", now.params);
        // The effect on the clip is attached to it, keyed by its instance.
        let (_, v) = openrip_model::edit::find_segment(&project, "v").unwrap();
        let g = project.materials.effects.iter().find(|e| e.builtin.as_deref() == Some("fx:glow") && v.attachments.contains(&e.id)).unwrap();
        assert_eq!(g.params["radius"], 0.8);
        assert!((v.effect_at(g, Micros(1_000_000)).params["intensity"] - 0.5).abs() < 1e-9);
        assert!((v.effect_at(g, Micros(0)).params["intensity"]).abs() < 1e-9);
    }
}
