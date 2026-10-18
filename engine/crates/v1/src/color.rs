//! The Adjust tab's colour tools on the app's own videos and photos (`color` on a clip;
//! `ClipColor` in lib/types.ts), as the materials a CapCut draft gives the engine for the
//! same tools, so both draw through one path (docs/plan/app-engine-integration.md, "Colour
//! and compositing"):
//!
//! - `adjust`: CapCut's Basic sliders on its scale (−50…50; sharpen, clarity, vignette and
//!   fade 0…100), one Adjust effect each, as the draft keeps them (−1…1).
//! - `hsl`: the eight named ranges' hue, saturation and lightness (−100…100), one HSL
//!   material each.
//! - `curves`: points (x, y in 0…1) per channel; the handles are CapCut's (below).
//! - `wheels`: the primary wheels (CapCut's values, −1…1) and their strength in percent.
//! - `lut`: a `.cube` file or a Hald image with its strength in percent, a filter on the clip.
//! - `match`: Color match: the clip's and the reference's Oklab means and spreads
//!   (`source`, `reference`: `{mean: [L, a, b], std: [L, a, b]}`) and `intensity` in percent;
//!   an effect whose table the engine makes (openrip-analysis's transfer). `auto` (Auto
//!   adjust's record of what it set) only changes the sliders, which carry its values.
//!
//! On a converted CapCut clip these go on top of the draft's own (its `draftAdjustments`):
//! a slider or range set in both draws the app's.

use std::collections::BTreeMap;

use openrip_model::*;
use serde_json::{json, Value};

use crate::f;

/// The Basic sliders, by the app's names (the engine's too).
pub(crate) const SLIDERS: [&str; 14] = ["exposure", "brightness", "contrast", "saturation", "temperature", "tint", "highlights", "shadows", "whites", "blacks", "sharpen", "clarity", "vignette", "fade"];

/// CapCut's named HSL ranges, in its order (`hsl_color_type` 1–8).
pub(crate) const HSL_RANGES: [&str; 8] = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta"];

pub(crate) fn slider_id(clip: &str, name: &str) -> MaterialId {
    MaterialId(format!("{clip}-color-{name}"))
}

pub(crate) fn hsl_id(clip: &str, range: &str) -> MaterialId {
    MaterialId(format!("{clip}-hsl-{range}"))
}

pub(crate) fn wheels_id(clip: &str) -> MaterialId {
    MaterialId(format!("{clip}-wheels"))
}

pub(crate) fn lut_id(clip: &str) -> MaterialId {
    MaterialId(format!("{clip}-lut"))
}

fn curves_id(clip: &str) -> MaterialId {
    MaterialId(format!("{clip}-curves"))
}

pub(crate) fn match_id(clip: &str) -> MaterialId {
    MaterialId(format!("{clip}-match"))
}

/// Every material id the colour tools of clip `clip` can have.
fn all_ids(clip: &str) -> Vec<MaterialId> {
    let mut ids: Vec<MaterialId> = SLIDERS.iter().map(|n| slider_id(clip, n)).collect();
    ids.extend(HSL_RANGES.iter().map(|r| hsl_id(clip, r)));
    ids.extend([curves_id(clip), wheels_id(clip), lut_id(clip), match_id(clip)]);
    ids
}

/// An Adjust slider as CapCut's effect: the value on CapCut's scale into the draft's −1…1.
pub(crate) fn slider(clip: &str, name: &str, value: f64) -> Effect {
    let mut params = BTreeMap::new();
    params.insert("intensity".to_string(), (value / crate::app::capcut_scale(name)).clamp(-1.0, 1.0));
    // Exposure and fade read CapCut's tables from its colour bundle: the engine finds the one
    // that ships with CapCut when there's no draft's to point at.
    Effect { id: slider_id(clip, name), category: EffectCategory::Adjust, name: name.into(), params, builtin: Some(name.into()), resource: None, library: None, text_style: None }
}

pub(crate) fn hsl(clip: &str, range: usize, v: &Value) -> HslAdjust {
    let get = |k: &str| f(v, k, 0.0).clamp(-100.0, 100.0) as f32;
    HslAdjust { id: hsl_id(clip, HSL_RANGES[range]), range: range as u8 + 1, custom_color: None, hue: get("hue"), saturation: get("saturation"), lightness: get("lightness") }
}

fn wheel(v: Option<&Value>) -> WheelValue {
    let v = v.unwrap_or(&Value::Null);
    let get = |k: &str| f(v, k, 0.0).clamp(-1.0, 1.0);
    WheelValue { red: get("red"), green: get("green"), blue: get("blue"), luma: get("luma"), saturation: get("saturation") }
}

pub(crate) fn wheels(clip: &str, v: &Value) -> ColorWheels {
    ColorWheels {
        id: wheels_id(clip),
        log: false,
        lift: wheel(v.get("lift")),
        gamma: wheel(v.get("gamma")),
        gain: wheel(v.get("gain")),
        offset: wheel(v.get("offset")),
        intensity: (f(v, "intensity", 100.0) / 100.0).clamp(0.0, 1.0),
    }
}

/// A curve through the app's points as CapCut draws it: a cubic bezier between neighbouring
/// points, each inner point's handles along the line between its neighbours, a sixth of it
/// either way; an end's handle halfway to its neighbour's near handle; two points alone, a
/// straight line (handles a third of the way along). Read off CapCut's own curves.
pub(crate) fn curve(points: &[[f64; 2]]) -> Vec<CurvePoint> {
    let mut p: Vec<(f64, f64)> = points.iter().map(|q| (q[0].clamp(0.0, 1.0), q[1].clamp(0.0, 1.0))).collect();
    p.sort_by(|a, b| a.0.total_cmp(&b.0));
    p.dedup_by(|b, a| (a.0 - b.0).abs() < 1e-9);
    let n = p.len();
    if n < 2 {
        return Vec::new();
    }
    let (add, sub) = (|a: (f64, f64), d: (f64, f64)| (a.0 + d.0, a.1 + d.1), |a: (f64, f64), b: (f64, f64)| (a.0 - b.0, a.1 - b.1));
    let scale = |a: (f64, f64), k: f64| (a.0 * k, a.1 * k);
    let mut out: Vec<CurvePoint> = p.iter().map(|&a| CurvePoint { anchor: a, left: a, right: a }).collect();
    if n == 2 {
        let d = scale(sub(p[1], p[0]), 1.0 / 3.0);
        out[0].right = add(p[0], d);
        out[1].left = sub(p[1], d);
        return out;
    }
    for i in 1..n - 1 {
        let d = scale(sub(p[i + 1], p[i - 1]), 1.0 / 6.0);
        out[i].left = sub(p[i], d);
        out[i].right = add(p[i], d);
    }
    out[0].right = add(p[0], scale(sub(out[1].left, p[0]), 0.5));
    out[n - 1].left = add(p[n - 1], scale(sub(out[n - 2].right, p[n - 1]), 0.5));
    out
}

/// The app's LUT as a filter on the clip: a `.cube` file, else a Hald CLUT image.
pub(crate) fn lut(clip: &str, v: &Value) -> Option<Effect> {
    let path = crate::file_url_to_path(v.get("path").and_then(Value::as_str).filter(|p| !p.is_empty())?);
    let builtin = if path.to_lowercase().ends_with(".cube") { "cube" } else { "lut" };
    let mut params = BTreeMap::new();
    params.insert("intensity".to_string(), (f(v, "intensity", 100.0) / 100.0).clamp(0.0, 1.0));
    let name = v.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
    Some(Effect { id: lut_id(clip), category: EffectCategory::Filter, name, params, builtin: Some(builtin.into()), resource: Some(path), library: None, text_style: None })
}

/// Color match as the effect the engine draws (`builtin` "color_match", the playback crate's
/// `colour::COLOR_MATCH`): both sides' statistics and the intensity (0–1). `None` without
/// both sides.
pub(crate) fn color_match(clip: &str, v: &Value) -> Option<Effect> {
    let side = |key: &str| -> Option<[f64; 6]> {
        let o = v.get(key)?;
        let three = |k: &str| -> Option<[f64; 3]> {
            let a = o.get(k)?.as_array()?;
            Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?, a.get(2)?.as_f64()?])
        };
        let (m, d) = (three("mean")?, three("std")?);
        Some([m[0], m[1], m[2], d[0], d[1], d[2]])
    };
    let (source, reference) = (side("source")?, side("reference")?);
    let mut params = BTreeMap::new();
    params.insert("intensity".to_string(), (f(v, "intensity", 100.0) / 100.0).clamp(0.0, 1.0));
    for (name, values) in [("source", source), ("reference", reference)] {
        for (k, value) in ["l", "a", "b", "l_std", "a_std", "b_std"].into_iter().zip(values) {
            params.insert(format!("{name}_{k}"), value);
        }
    }
    Some(Effect { id: match_id(clip), category: EffectCategory::Adjust, name: "Color match".into(), params, builtin: Some("color_match".into()), resource: None, library: None, text_style: None })
}

/// Give a segment the materials of its clip's `color` (the clip's id `clip`), replacing the
/// ones it had from an earlier `color`. Tools left at their neutral values add nothing.
pub(crate) fn attach(clip: &str, value: &Value, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    let old = all_ids(clip);
    attachments.retain(|a| !old.contains(a));
    for id in &old {
        materials.remove(id);
    }
    let add = |m: AnyMaterial, materials: &mut Materials, attachments: &mut Vec<MaterialId>| {
        attachments.push(m.id().clone());
        materials.insert_at(m, None);
    };
    let Some(c) = value.as_object() else { return };
    // In CapCut's order (its colour bundle's): LUT, HSL, curves, wheels, then the sliders. The
    // engine draws them in that order whatever their order here; this keeps the list tidy.
    if let Some(e) = c.get("match").and_then(|v| color_match(clip, v)) {
        add(AnyMaterial::Effect(e), materials, attachments);
    }
    if let Some(e) = c.get("lut").and_then(|v| lut(clip, v)) {
        add(AnyMaterial::Effect(e), materials, attachments);
    }
    if let Some(ranges) = c.get("hsl").and_then(Value::as_object) {
        for (i, name) in HSL_RANGES.iter().enumerate() {
            let Some(v) = ranges.get(*name) else { continue };
            let h = hsl(clip, i, v);
            if h.hue != 0.0 || h.saturation != 0.0 || h.lightness != 0.0 {
                add(AnyMaterial::Hsl(h), materials, attachments);
            }
        }
    }
    if let Some(curves) = c.get("curves").and_then(Value::as_object) {
        let channel = |name: &str| -> Vec<CurvePoint> {
            let pts: Vec<[f64; 2]> = curves.get(name).and_then(Value::as_array).into_iter().flatten().filter_map(|p| Some([p.get(0)?.as_f64()?, p.get(1)?.as_f64()?])).collect();
            curve(&pts)
        };
        let m = ColorCurves { id: curves_id(clip), luma: channel("luma"), red: channel("red"), green: channel("green"), blue: channel("blue") };
        let straight = |c: &[CurvePoint]| c.iter().all(|p| (p.anchor.0 - p.anchor.1).abs() < 1e-6 && (p.left.0 - p.left.1).abs() < 1e-6 && (p.right.0 - p.right.1).abs() < 1e-6);
        if ![&m.luma, &m.red, &m.green, &m.blue].into_iter().all(|ch| straight(ch)) {
            add(AnyMaterial::Curves(m), materials, attachments);
        }
    }
    if let Some(v) = c.get("wheels").filter(|v| v.is_object()) {
        let w = wheels(clip, v);
        if w != (ColorWheels { id: w.id.clone(), log: false, lift: WheelValue::default(), gamma: WheelValue::default(), gain: WheelValue::default(), offset: WheelValue::default(), intensity: w.intensity }) {
            add(AnyMaterial::ColorWheels(w), materials, attachments);
        }
    }
    if let Some(sliders) = c.get("adjust").and_then(Value::as_object) {
        for name in SLIDERS {
            let v = sliders.get(name).and_then(Value::as_f64).unwrap_or(0.0);
            if v != 0.0 && v.is_finite() {
                add(AnyMaterial::Effect(slider(clip, name, v)), materials, attachments);
            }
        }
    }
}

/// A material a colour keyframe property of clip `clip` drives, made at its neutral value if
/// the clip doesn't have it (a slider keyed but left at 0 in the field): `None` for a
/// property that isn't a colour tool's.
pub(crate) fn keyed_material(clip: &str, name: &str, color: &Value, materials: &Materials) -> Option<AnyMaterial> {
    if let Some(s) = name.strip_prefix("adjust:").filter(|s| SLIDERS.contains(s)) {
        return Some(AnyMaterial::Effect(slider(clip, s, 0.0)));
    }
    if let Some((range, _)) = name.strip_prefix("hsl:").and_then(|r| r.split_once(':')) {
        let i = HSL_RANGES.iter().position(|r| *r == range)?;
        return Some(AnyMaterial::Hsl(hsl(clip, i, &Value::Null)));
    }
    if name == "wheels:intensity" {
        return Some(AnyMaterial::ColorWheels(wheels(clip, color.get("wheels").unwrap_or(&json!({})))));
    }
    if name == "lut:intensity" {
        return color.get("lut").and_then(|v| lut(clip, v)).filter(|_| !materials.contains(&lut_id(clip))).map(AnyMaterial::Effect);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: (f64, f64), b: (f64, f64)) -> bool {
        (a.0 - b.0).abs() < 1e-9 && (a.1 - b.1).abs() < 1e-9
    }

    /// The handles come out as CapCut's own curves have them (values from a local draft's
    /// red and luma curves).
    #[test]
    fn curve_handles_are_capcuts() {
        let c = curve(&[[0.0, 0.0], [0.39294169372294374, 0.394287109375], [1.0, 1.0]]);
        assert!(close(c[1].left, (0.22627502705627708, 0.22762044270833337)) && close(c[1].right, (0.5596083603896104, 0.5609537760416666)));
        assert!(close(c[0].right, (0.11313751352813851, 0.1138102213541667)) && close(c[2].left, (0.7798041801948052, 0.7804768880208333)));
        assert!(close(c[0].left, (0.0, 0.0)) && close(c[2].right, (1.0, 1.0)));
        let two = curve(&[[1.0, 0.9203157372237568], [0.0, 0.01761589261049723]]);
        assert!(close(two[0].right, (1.0 / 3.0, 0.31851584081491713)) && close(two[1].left, (2.0 / 3.0, 0.619415789019337)));
        assert!(curve(&[[0.5, 0.5]]).is_empty());
    }

    /// Each tool becomes CapCut's material; neutral ones add nothing; a second `color`
    /// replaces the first's materials.
    #[test]
    fn color_becomes_capcuts_materials() {
        let mut m = Materials::default();
        let mut att = vec![MaterialId("other".into())];
        let color = json!({
            "adjust": {"exposure": 20, "contrast": -25, "sharpen": 40, "saturation": 0},
            "hsl": {"red": {"hue": 10, "saturation": 0, "lightness": -20}, "green": {"hue": 0, "saturation": 0, "lightness": 0}},
            "curves": {"luma": [[0, 0.1], [1, 0.9]], "red": [[0, 0], [1, 1]]},
            "wheels": {"gain": {"red": 0.1, "green": 0.0, "blue": -0.1, "luma": 0.05}, "intensity": 80},
            "lut": {"path": "/looks/teal.cube", "intensity": 60}
        });
        attach("c", &color, &mut m, &mut att);
        let e = |id: &str| m.effects.iter().find(|e| e.id.0 == id).unwrap();
        assert_eq!(e("c-color-exposure").params["intensity"], 0.4);
        assert_eq!(e("c-color-contrast").params["intensity"], -0.5);
        assert_eq!(e("c-color-sharpen").params["intensity"], 0.4);
        assert!(!m.contains(&slider_id("c", "saturation")));
        assert_eq!((m.hsl.len(), m.hsl[0].range, m.hsl[0].hue, m.hsl[0].lightness), (1, 1, 10.0, -20.0));
        assert_eq!((m.curves[0].luma.len(), m.curves[0].red.len()), (2, 2));
        assert_eq!((m.color_wheels[0].gain.red, m.color_wheels[0].intensity), (0.1, 0.8));
        let l = e("c-lut");
        assert_eq!((l.category, l.builtin.as_deref(), l.params["intensity"]), (EffectCategory::Filter, Some("cube"), 0.6));
        assert_eq!(att.len(), 1 + 3 + 1 + 1 + 1 + 1);
        // Another colour replaces it all; the clip's other attachments stay.
        attach("c", &json!({"adjust": {"fade": 50}}), &mut m, &mut att);
        assert_eq!(att, vec![MaterialId("other".into()), slider_id("c", "fade")]);
        assert_eq!((m.effects.len(), m.hsl.len(), m.curves.len(), m.color_wheels.len()), (1, 0, 0, 0));
        assert_eq!(m.effects[0].params["intensity"], 0.5);
        attach("c", &Value::Null, &mut m, &mut att);
        assert_eq!(att, vec![MaterialId("other".into())]);
    }

    /// Color match is an effect carrying both sides' statistics; one side missing adds none.
    #[test]
    fn color_match_becomes_its_effect() {
        let mut m = Materials::default();
        let mut att = Vec::new();
        let color = json!({
            "match": {"intensity": 80, "source": {"mean": [0.5, 0.01, -0.02], "std": [0.2, 0.03, 0.04]}, "reference": {"mean": [0.6, 0.0, 0.01], "std": [0.25, 0.02, 0.05]}, "ref": {"clipId": "r"}},
            "auto": {"intensity": 100, "values": {"brightness": 6}},
            "adjust": {"brightness": 6}
        });
        attach("c", &color, &mut m, &mut att);
        let e = m.effects.iter().find(|e| e.id == match_id("c")).unwrap();
        assert_eq!((e.category, e.builtin.as_deref(), e.params["intensity"]), (EffectCategory::Adjust, Some("color_match"), 0.8));
        assert_eq!((e.params["source_l"], e.params["source_b_std"], e.params["reference_a"], e.params["reference_l_std"]), (0.5, 0.04, 0.0, 0.25));
        // Auto adjust draws through the sliders alone.
        assert_eq!(att, vec![match_id("c"), slider_id("c", "brightness")]);
        attach("c", &json!({"match": {"source": {"mean": [0.5, 0.0, 0.0], "std": [0.2, 0.0, 0.0]}}}), &mut m, &mut att);
        assert!(att.is_empty() && m.effects.is_empty());
    }
}
