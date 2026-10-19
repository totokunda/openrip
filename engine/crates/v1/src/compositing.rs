//! The Basic and Remove BG panels' compositing fields on the app's clips (lib/types.ts), as
//! the materials and transform a CapCut draft gives the engine for the same settings:
//!
//! - `blendMode` (videos, photos, texts): a blend effect (CapCut's `mix_mode`), by the
//!   engine's mode name ("screen", "color_burn", …); "normal" or none adds nothing.
//! - `chroma` (videos, photos): `{color, intensity, shadow, edgeSmooth, spill}`, the colour
//!   as `#rrggbb` and the sliders 0…100, a chroma key (CapCut's `chromas`, 0…1).
//! - `canvas` (videos, photos): `{type: "color" | "blur" | "image" | "pattern", color, blur, image, pattern}`, a
//!   canvas fill (CapCut's `canvases`); the engine draws it for a clip on the main track.
//!   `blur` is CapCut's level: 0.0625, 0.375, 0.75 or 1.
//! - `flip` (videos, photos): `{horizontal, vertical}`, the transform's flips (CapCut's
//!   `clip.flip`).
//!
//! On a converted CapCut clip each field the app changed replaces the draft's own.

use openrip_model::*;
use serde_json::{json, Map, Value};

use crate::{f, s};

pub(crate) fn blend_id(clip: &str) -> MaterialId {
    MaterialId(format!("{clip}-blend"))
}

pub(crate) fn chroma_id(clip: &str) -> MaterialId {
    MaterialId(format!("{clip}-chroma"))
}

fn canvas_id(clip: &str) -> MaterialId {
    MaterialId(format!("{clip}-canvas"))
}

/// Replace the segment's blend mode with the app's.
pub(crate) fn set_blend(clip: &str, value: Option<&Value>, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    attachments.retain(|a| !materials.effects.iter().any(|e| &e.id == a && e.category == EffectCategory::Blend));
    materials.remove(&blend_id(clip));
    let Some(mode) = value.and_then(Value::as_str).and_then(BlendMode::from_name).filter(|m| *m != BlendMode::Normal) else { return };
    materials.effects.push(Effect {
        id: blend_id(clip),
        category: EffectCategory::Blend,
        name: String::new(),
        params: Default::default(),
        builtin: Some(mode.name().into()),
        resource: None,
        library: None,
        text_style: None,
    });
    attachments.push(blend_id(clip));
}

/// The app's chroma key as the model's (sliders 0…100 into 0…1).
pub(crate) fn chroma(clip: &str, v: &Value) -> Chroma {
    let unit = |k: &str| (f(v, k, 0.0) / 100.0).clamp(0.0, 1.0) as f32;
    Chroma {
        id: chroma_id(clip),
        color: Rgba::from_hex(&s(v, "color")).unwrap_or(Rgba { r: 0.0, g: 1.0, b: 0.0, a: 1.0 }),
        intensity: unit("intensity"),
        shadow: unit("shadow"),
        edge_smooth: unit("edgeSmooth"),
        spill: unit("spill"),
    }
}

/// Replace the segment's chroma key with the app's (kept at 0 intensity too, for its keys).
pub(crate) fn set_chroma(clip: &str, value: Option<&Value>, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    attachments.retain(|a| !materials.chromas.iter().any(|c| &c.id == a));
    materials.remove(&chroma_id(clip));
    let Some(v) = value.filter(|v| v.is_object()) else { return };
    materials.chromas.push(chroma(clip, v));
    attachments.push(chroma_id(clip));
}

/// Replace the segment's canvas fill with the app's.
pub(crate) fn set_canvas(clip: &str, value: Option<&Value>, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    attachments.retain(|a| !materials.canvas_fills.iter().any(|c| &c.id == a));
    materials.remove(&canvas_id(clip));
    let Some(v) = value.filter(|v| v.is_object()) else { return };
    let fill = match s(v, "type").as_str() {
        "color" => CanvasFillKind::Color { color: Rgba::from_hex(&s(v, "color")).unwrap_or(Rgba::BLACK) },
        "blur" => CanvasFillKind::Blur { amount: f(v, "blur", 0.375).clamp(0.0, 1.0) as f32 },
        "image" => CanvasFillKind::Image { path: crate::file_url_to_path(&s(v, "image")) },
        "pattern" => CanvasFillKind::Pattern { id: s(v, "pattern") },
        _ => return,
    };
    materials.canvas_fills.push(CanvasFill { id: canvas_id(clip), fill });
    attachments.push(canvas_id(clip));
}

/// The app's flips on the transform.
pub(crate) fn set_flip(transform: &mut Transform, value: Option<&Value>) {
    let v = value.unwrap_or(&Value::Null);
    transform.flip_h = v.get("horizontal").and_then(Value::as_bool).unwrap_or(false);
    transform.flip_v = v.get("vertical").and_then(Value::as_bool).unwrap_or(false);
}

/// A segment's blend mode, chroma key, canvas fill and flips as the app's fields (`media`:
/// a video or photo; a text gets its blend mode alone).
pub(crate) fn emit(project: &Project, seg: &Segment, clip: &mut Map<String, Value>, media: bool) {
    let attached = |id: &MaterialId| seg.attachments.contains(id);
    let mode = project.materials.effects.iter().filter(|e| attached(&e.id)).find_map(|e| e.blend_mode()).unwrap_or_default();
    clip.insert("blendMode".into(), json!(mode.name()));
    if !media {
        return;
    }
    let pct = |v: f32| json!((v as f64 * 10000.0).round() / 100.0);
    let hex = |c: Rgba| {
        let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        format!("#{:02x}{:02x}{:02x}", b(c.r), b(c.g), b(c.b))
    };
    let chroma = project.materials.chromas.iter().find(|c| attached(&c.id) && !c.is_off());
    clip.insert(
        "chroma".into(),
        chroma.map_or(Value::Null, |c| json!({ "color": hex(c.color), "intensity": pct(c.intensity), "shadow": pct(c.shadow), "edgeSmooth": pct(c.edge_smooth), "spill": pct(c.spill) })),
    );
    let fill = project.materials.canvas_fills.iter().find(|c| attached(&c.id) && !c.is_black());
    clip.insert(
        "canvas".into(),
        fill.map_or(Value::Null, |c| match &c.fill {
            CanvasFillKind::Color { color } => json!({ "type": "color", "color": hex(*color) }),
            CanvasFillKind::Blur { amount } => json!({ "type": "blur", "blur": *amount as f64 }),
            CanvasFillKind::Image { path } => json!({ "type": "image", "image": path }),
            CanvasFillKind::Pattern { id } => json!({ "type": "pattern", "pattern": id }),
        }),
    );
    clip.insert("flip".into(), json!({ "horizontal": seg.transform.flip_h, "vertical": seg.transform.flip_v }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_become_materials_and_replace_the_drafts() {
        let mut m = Materials::default();
        // A draft's own blend, chroma and canvas, attached.
        m.effects.push(Effect { id: "draft-blend".into(), category: EffectCategory::Blend, name: "Screen".into(), params: Default::default(), builtin: Some("screen".into()), resource: None, library: None, text_style: None });
        m.chromas.push(Chroma { id: "draft-key".into(), color: Rgba::BLACK, intensity: 0.0, shadow: 0.0, edge_smooth: 0.0, spill: 0.0 });
        m.canvas_fills.push(CanvasFill { id: "draft-canvas".into(), fill: CanvasFillKind::Color { color: Rgba::BLACK } });
        let mut att: Vec<MaterialId> = vec!["draft-blend".into(), "draft-key".into(), "draft-canvas".into(), "other".into()];
        set_blend("c", Some(&json!("multiply")), &mut m, &mut att);
        set_chroma("c", Some(&json!({"color": "#00ff00", "intensity": 40, "shadow": 10, "edgeSmooth": 20, "spill": 30})), &mut m, &mut att);
        set_canvas("c", Some(&json!({"type": "blur", "blur": 0.75})), &mut m, &mut att);
        assert_eq!(att, vec![MaterialId::from("other"), blend_id("c"), chroma_id("c"), canvas_id("c")]);
        assert_eq!(m.effects.iter().find(|e| e.id == blend_id("c")).unwrap().blend_mode(), Some(BlendMode::Multiply));
        let k = m.chromas.iter().find(|c| c.id == chroma_id("c")).unwrap();
        assert_eq!((k.color.g, k.intensity, k.shadow, k.edge_smooth, k.spill), (1.0, 0.4, 0.1, 0.2, 0.3));
        assert_eq!(m.canvas_fills.iter().find(|c| c.id == canvas_id("c")).unwrap().fill, CanvasFillKind::Blur { amount: 0.75 });
        // Normal, no chroma and no canvas take them off.
        set_blend("c", Some(&json!("normal")), &mut m, &mut att);
        set_chroma("c", None, &mut m, &mut att);
        set_canvas("c", Some(&json!({"type": "none"})), &mut m, &mut att);
        assert_eq!(att, vec![MaterialId::from("other")]);
        let mut t = Transform::default();
        set_flip(&mut t, Some(&json!({"horizontal": true})));
        assert!(t.flip_h && !t.flip_v);
        set_flip(&mut t, None);
        assert!(!t.flip_h);
    }
}
