//! The Text tab's spacing, gradient fill, outlines, glow and Effects style (lib/types.ts
//! `TextClipProps`; docs/plan/app-engine-integration.md, "Text styles and captions") to and
//! from the model.
//!
//! - **Spacing** is in CapCut's panel units, for the app's own text and CapCut's alike: one
//!   step of its Character or Line field is 1/20 em (its panel divides by 20). CapCut's text
//!   has 0.02 em between lines at Line 0, the app's own text none (its lines are Konva's 1-em
//!   boxes).
//! - **Gradient fill** (`fillGradient`): `{ colors: ["#rrggbb" | "#rrggbbaa", …], stops?: [0–1],
//!   angle (degrees, counter-clockwise from +x, +y up), span?: "character" | "line" | "text" }`.
//! - **More outlines** (`moreStrokes`): `[{ color, width (px, as `strokeWidth`), opacity? }]`,
//!   outside the stroke, each drawn under the ones before it.
//! - **Glow**: `glowEnabled`; `glowColor` ("#rrggbb", or empty for the text's own colours);
//!   `glowIntensity` and `glowRange` (0–100, CapCut's 30 and 20 by default); `glowOffsetX` and
//!   `glowOffsetY` (−100…100, the light moved right and down).
//! - **Effects style** (`textEffect`, lib/text-styles.ts): `{ id, name, fill?, strokes?,
//!   shadows?, glow? }` with sizes as fractions of the font size; each paint is `{ color,
//!   opacity? }`, `{ gradient, opacity? }` or `{ textColor: true, opacity? }` (the clip's own
//!   colour). It becomes a text style material on the segment, drawn as CapCut's library styles
//!   are but with sharp edges. A CapCut clip's library style shows as `{ id: "", name }` and
//!   stays until replaced.

use openrip_model::*;
use serde_json::{json, Map, Value};

use crate::{b, f, s};

/// One step of CapCut's Character and Line fields, in em.
pub(crate) const SPACING_STEP: f32 = 0.05;
/// What CapCut's text has between lines at Line 0, in em: every new text in its drafts.
pub(crate) const CAPCUT_LINE_SPACING: f32 = 0.02;
/// What the app's own text styles are called in the model (`builtin`).
const STYLE_PREFIX: &str = "openrip:";

/// The clip's letter spacing in em.
pub(crate) fn letter_spacing(clip: &Value) -> f32 {
    f(clip, "letterSpacing", 0.0) as f32 * SPACING_STEP
}

/// The clip's line spacing in em, for CapCut's text (`capcut`) or the app's own.
pub(crate) fn line_spacing(clip: &Value, capcut: bool) -> f32 {
    let base = if capcut { CAPCUT_LINE_SPACING } else { 0.0 };
    base + f(clip, "lineSpacing", 0.0) as f32 * SPACING_STEP
}

fn colour(v: &Value) -> Option<Rgba> {
    v.as_str().and_then(Rgba::from_hex)
}

fn hex(c: Rgba) -> String {
    let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    if c.a < 1.0 {
        format!("#{:02x}{:02x}{:02x}{:02x}", b(c.r), b(c.g), b(c.b), b(c.a))
    } else {
        format!("#{:02x}{:02x}{:02x}", b(c.r), b(c.g), b(c.b))
    }
}

fn num(v: f64) -> Value {
    json!((v * 1000.0).round() / 1000.0)
}

/// The clip's glow, if it's on.
pub(crate) fn glow(clip: &Value) -> Option<TextGlow> {
    b(clip, "glowEnabled").then(|| TextGlow {
        color: clip.get("glowColor").and_then(colour),
        strength: (f(clip, "glowIntensity", 30.0) / 100.0).clamp(0.0, 1.0) as f32,
        range: (f(clip, "glowRange", 20.0) / 100.0).clamp(0.0, 1.0) as f32,
        direction: [0.5 + (f(clip, "glowOffsetX", 0.0).clamp(-100.0, 100.0) / 200.0) as f32, 0.5 + (f(clip, "glowOffsetY", 0.0).clamp(-100.0, 100.0) / 200.0) as f32],
        style: None,
    })
}

/// A gradient from its app object; `None` without a colour.
pub(crate) fn gradient(v: &Value) -> Option<Gradient> {
    let colors: Vec<Rgba> = v.get("colors")?.as_array()?.iter().filter_map(colour).collect();
    if colors.is_empty() {
        return None;
    }
    let n = colors.len();
    let given = v.get("stops").and_then(Value::as_array);
    let stops = (0..n)
        .map(|k| given.and_then(|g| g.get(k)).and_then(Value::as_f64).map_or(if n > 1 { k as f32 / (n - 1) as f32 } else { 0.0 }, |x| x.clamp(0.0, 1.0) as f32))
        .collect();
    let span = match s(v, "span").as_str() {
        "line" => GradientSpan::Line,
        "text" => GradientSpan::Text,
        _ => GradientSpan::Character,
    };
    Some(Gradient { colors, stops, angle_deg: f(v, "angle", 0.0) as f32, span })
}

fn gradient_value(g: &Gradient) -> Value {
    let span = match g.span {
        GradientSpan::Character => "character",
        GradientSpan::Line => "line",
        GradientSpan::Text => "text",
    };
    json!({ "colors": g.colors.iter().map(|c| hex(*c)).collect::<Vec<_>>(), "stops": g.stops.iter().map(|v| num(*v as f64)).collect::<Vec<_>>(), "angle": num(g.angle_deg as f64), "span": span })
}

/// The clip's outlines outside its stroke, with widths as fractions of its font size.
pub(crate) fn more_strokes(clip: &Value) -> Vec<Stroke> {
    let font_size = f(clip, "fontSize", 48.0).max(1.0);
    clip.get("moreStrokes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let mut color = m.get("color").and_then(colour)?;
            color.a *= (f(m, "opacity", 100.0) / 100.0).clamp(0.0, 1.0) as f32;
            let width = (f(m, "width", 0.0) / font_size) as f32;
            (width > 0.0).then_some(Stroke { color, width })
        })
        .collect()
}

/// A paint of the Effects style: a colour, a gradient or the clip's own colour, with an opacity.
fn paint(v: &Value) -> Option<Paint> {
    let alpha = (f(v, "opacity", 100.0) / 100.0).clamp(0.0, 1.0) as f32;
    let kind = if b(v, "textColor") {
        PaintKind::TextColor { hue: 0.0, saturation: 0.0, brightness: 0.0 }
    } else if let Some(g) = v.get("gradient").and_then(gradient) {
        PaintKind::Gradient(g)
    } else {
        PaintKind::Solid(v.get("color").and_then(colour)?)
    };
    Some(Paint { alpha, kind })
}

fn paint_value(p: &Paint) -> Value {
    let mut v = match &p.kind {
        PaintKind::Solid(c) => json!({ "color": hex(*c) }),
        PaintKind::Gradient(g) => json!({ "gradient": gradient_value(g) }),
        _ => json!({ "textColor": true }),
    };
    v["opacity"] = num(p.alpha as f64 * 100.0);
    v
}

/// The Effects tab's style on the clip (`textEffect`), as the material the segment `id`
/// attaches; `None` for none, or for a CapCut style (an empty `id`), which only CapCut's own
/// material draws.
pub(crate) fn text_effect(id: &str, clip: &Value) -> Option<Effect> {
    let v = clip.get("textEffect").filter(|v| v.is_object())?;
    let style = s(v, "id");
    if style.is_empty() {
        return None;
    }
    let list = |k: &str| v.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    let effect = TextEffect {
        fill: v.get("fill").and_then(paint),
        strokes: list("strokes").iter().filter_map(|st| Some(EffectStroke { width: f(st, "width", 0.0) as f32, paint: paint(st.get("paint")?)? })).filter(|st| st.width > 0.0).collect(),
        shadows: list("shadows")
            .iter()
            .filter_map(|sh| Some(EffectShadow { paint: paint(sh.get("paint")?)?, distance: f(sh, "distance", 0.0) as f32, angle_deg: f(sh, "angle", 0.0) as f32, blur: f(sh, "blur", 0.0) as f32, strokes: Vec::new() }))
            .collect(),
        sharp_edges: true,
        glow: v.get("glow").filter(|g| g.is_object()).map(|g| TextGlow {
            color: g.get("color").and_then(colour),
            strength: (f(g, "intensity", 30.0) / 100.0).clamp(0.0, 1.0) as f32,
            range: (f(g, "range", 20.0) / 100.0).clamp(0.0, 1.0) as f32,
            direction: [0.5, 0.5],
            style: None,
        }),
    };
    Some(Effect {
        id: MaterialId(format!("{id}-style")),
        category: EffectCategory::Other,
        name: s(v, "name"),
        params: Default::default(),
        builtin: Some(format!("{STYLE_PREFIX}{style}")),
        resource: None,
        library: None,
        text_style: Some(Box::new(effect)),
    })
}

/// Whether a material is a text style (CapCut's library style or the app's own).
pub(crate) fn is_text_style(materials: &Materials, id: &MaterialId) -> bool {
    materials.effects.iter().any(|e| &e.id == id && e.text_style.is_some())
}

/// The app's fields for a text's spacing, gradient, outlines, glow and style (`emit` in
/// `to_app_project`). `fs` is the font size the app shows; `capcut` whether the text is
/// CapCut's.
pub(crate) fn emit(clip: &mut Map<String, Value>, t: &Text, style: Option<&Effect>, fs: f64, capcut: bool) {
    let base_line = if capcut { CAPCUT_LINE_SPACING } else { 0.0 };
    clip.insert("letterSpacing".into(), num((t.layout.letter_spacing / SPACING_STEP) as f64));
    clip.insert("lineSpacing".into(), num(((t.layout.line_spacing - base_line) / SPACING_STEP) as f64));
    let run = t.runs.first();
    clip.insert("fillGradient".into(), run.and_then(|r| r.gradient.as_ref()).map_or(Value::Null, gradient_value));
    let more: Vec<Value> = run.map(|r| r.more_strokes.as_slice()).unwrap_or_default().iter().map(|st| json!({ "color": hex(Rgba { a: 1.0, ..st.color }), "width": num(st.width as f64 * fs), "opacity": num(st.color.a as f64 * 100.0) })).collect();
    clip.insert("moreStrokes".into(), Value::Array(more));
    let glow = t.layout.glow.as_ref();
    clip.insert("glowEnabled".into(), json!(glow.is_some()));
    clip.insert("glowColor".into(), json!(glow.and_then(|g| g.color).map_or(String::new(), hex)));
    clip.insert("glowIntensity".into(), num(glow.map_or(30.0, |g| g.strength as f64 * 100.0)));
    clip.insert("glowRange".into(), num(glow.map_or(20.0, |g| g.range as f64 * 100.0)));
    clip.insert("glowOffsetX".into(), num(glow.map_or(0.0, |g| (g.direction[0] as f64 - 0.5) * 200.0)));
    clip.insert("glowOffsetY".into(), num(glow.map_or(0.0, |g| (g.direction[1] as f64 - 0.5) * 200.0)));
    let effect = style.and_then(|e| Some((e, e.text_style.as_ref()?))).map_or(Value::Null, |(e, fx)| match e.builtin.as_deref().and_then(|b| b.strip_prefix(STYLE_PREFIX)) {
        Some(id) => {
            let mut v = json!({ "id": id, "name": e.name });
            if let Some(p) = &fx.fill {
                v["fill"] = paint_value(p);
            }
            v["strokes"] = fx.strokes.iter().map(|st| json!({ "width": num(st.width as f64), "paint": paint_value(&st.paint) })).collect();
            v["shadows"] = fx.shadows.iter().map(|sh| json!({ "paint": paint_value(&sh.paint), "distance": num(sh.distance as f64), "angle": num(sh.angle_deg as f64), "blur": num(sh.blur as f64) })).collect();
            if let Some(g) = &fx.glow {
                v["glow"] = json!({ "color": g.color.map(hex), "intensity": num(g.strength as f64 * 100.0), "range": num(g.range as f64 * 100.0) });
            }
            v
        }
        // CapCut's own: by name, drawn from its bundle until replaced.
        None => json!({ "id": "", "name": e.library.as_ref().map(|l| l.name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| e.name.clone()) }),
    });
    clip.insert("textEffect".into(), effect);
}

/// Apply the app's changes to these fields (`differs` says which changed from `base`) on a
/// copy of a converted text's material.
pub(crate) fn edit(t: &mut Text, clip: &Value, differs: &dyn Fn(&str) -> bool) {
    let capcut = t.layout.line_height.is_none();
    if differs("letterSpacing") {
        t.layout.letter_spacing = letter_spacing(clip);
    }
    if differs("lineSpacing") {
        t.layout.line_spacing = line_spacing(clip, capcut);
    }
    if differs("fillGradient") {
        let g = clip.get("fillGradient").and_then(gradient);
        t.runs.iter_mut().for_each(|r| r.gradient = g.clone());
    }
    if differs("moreStrokes") {
        let more = more_strokes(clip);
        t.runs.iter_mut().for_each(|r| r.more_strokes = more.clone());
    }
    if ["glowEnabled", "glowColor", "glowIntensity", "glowRange", "glowOffsetX", "glowOffsetY"].into_iter().any(differs) {
        // A CapCut glow keeps its style.
        let style = t.layout.glow.as_ref().and_then(|g| g.style.clone());
        t.layout.glow = glow(clip).map(|g| TextGlow { style, ..g });
    }
}
