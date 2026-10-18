//! CapCut's keyframes (`common_keyframes` on a segment) into the model
//! (docs/parity/keyframes.md).
//!
//! CapCut keeps one list per property (`property_type`, e.g. `KFTypePositionX`), each key a
//! time, its values, a curve type and two handles:
//! - `time_offset` is in the segment's source time for segments that play media (CapCut ties
//!   keys to the media), counted from the material's start; otherwise from the segment's
//!   start. The model's keys are in the segment's local time.
//! - `curveType` is `Line` or one of CapCut's curves (`CurveIn`, `CurveOut`, `CurveInOut` and
//!   their `Free…` forms made by splitting a curve). A key that isn't `Line` brings its
//!   handles into the spans beside it: `right_control` into the span after it, `left_control`
//!   into the span before, as (µs, value) offsets from the key; a `Line` key brings none
//!   (zero-length handles). A span between two `Line` keys is straight. This is how CapCut's
//!   own evaluator reads them (`lvve::KeyframePropertyHelper`), and its curve is
//!   [`openrip_model::capcut_curve`].
//! - `material_id` names the material a material property belongs to (an Adjust slider, a
//!   mask, …), else it's found among the segment's attachments by kind.

use std::collections::BTreeMap;

use openrip_model::*;
use serde_json::Value;

use crate::{arr, bump, f, s, ImportReport};

/// One CapCut key, with its handles in µs of the keys' own time and the property's units.
struct RawKey {
    at: i64,
    values: Vec<f64>,
    line: bool,
    left: (f64, f64),
    right: (f64, f64),
}

/// A property's keys as CapCut stores them, and the material they're for.
struct Channel {
    material: String,
    keys: Vec<RawKey>,
}

/// CapCut's Adjust keyframe types and the importer's names for the sliders they drive
/// (`ADJUST_TYPES`): `KFTypeHue` is the Tint slider (CapCut's `tone`).
const ADJUST_KEYS: &[(&str, &str)] = &[
    ("KFTypeBrightness", "brightness"),
    ("KFTypeContrast", "contrast"),
    ("KFTypeSaturation", "saturation"),
    ("KFTypeSharpen", "sharpen"),
    ("KFTypeHightLight", "highlights"),
    ("KFTypeShadow", "shadows"),
    ("KFTypeTemperature", "temperature"),
    ("KFTypeHue", "tint"),
    ("KFTypeVignetting", "vignette"),
    ("KFTypeBlack", "blacks"),
    ("KFTypeWhite", "whites"),
    ("KFTypeLightSensatione", "exposure"),
    ("KFTypeFade", "fade"),
    ("KFTypeClear", "clarity"),
];

/// Text keyframe types, the parameters their values drive (one per value) and a factor to
/// the model's units. Assumed to be in the units the text material keeps (no local draft
/// keyframes a text's style to check them against).
const TEXT_KEYS: &[(&str, &[Param], f64)] = &[
    ("KFTypeTextColor", &[Param::TextRed, Param::TextGreen, Param::TextBlue], 1.0),
    ("KFTypeTextAlpha", &[Param::TextAlpha], 1.0),
    ("KFTypeBorderColor", &[Param::StrokeRed, Param::StrokeGreen, Param::StrokeBlue], 1.0),
    ("KFTypeBorderAlpha", &[Param::StrokeAlpha], 1.0),
    ("KFTypeBorderWidth", &[Param::StrokeWidth], 1.0),
    ("KFTypeShadowColor", &[Param::ShadowRed, Param::ShadowGreen, Param::ShadowBlue], 1.0),
    ("KFTypeShadowAlpha", &[Param::ShadowAlpha], 1.0),
    ("KFTypeShadowAngle", &[Param::ShadowAngle], 1.0),
    // In hundredths of the font size, as the material's `shadow_distance`.
    ("KFTypeShadowDistance", &[Param::ShadowDistance], 0.01),
    ("KFTypeShadowSmoothing", &[Param::ShadowSmoothing], 1.0),
    ("KFTypeBackgroundColor", &[Param::BackgroundRed, Param::BackgroundGreen, Param::BackgroundBlue], 1.0),
    ("KFTypeBackgroundAlpha", &[Param::BackgroundAlpha], 1.0),
    ("KFTypeBackgroundRoundRadius", &[Param::BackgroundRadius], 1.0),
    ("KFTypeBackgroundWidth", &[Param::BackgroundWidth], 1.0),
    ("KFTypeBackgroundHeight", &[Param::BackgroundHeight], 1.0),
    ("KFTypeTextCurveAngle", &[Param::TextCurve], 1.0),
];

/// Mask keyframe types (in the units of the mask's `config`).
const MASK_KEYS: &[(&str, Param)] = &[
    ("KFTypeCommonMaskPositionX", Param::MaskCenterX),
    ("KFTypeCommonMaskPositionY", Param::MaskCenterY),
    ("KFTypeCommonMaskSizeWidth", Param::MaskWidth),
    ("KFTypeCommonMaskSizeHeight", Param::MaskHeight),
    ("KFTypeCommonMaskRotation", Param::MaskRotation),
    ("KFTypeCommonMaskFeather", Param::MaskFeather),
    ("KFTypeCommonMaskRoundCorner", Param::MaskRoundCorner),
];

/// Map a segment's keyframes onto it: the transform, opacity and volume on the segment, the
/// rest as its materials' parameter keyframes. Keyframes of properties the engine doesn't
/// draw (or on tracks it doesn't draw) go in the report. Call once the segment's own material
/// is final (a subtitle template's segment draws its text).
pub(crate) fn apply(seg_json: &Value, seg: &mut Segment, kind: TrackKind, materials: &mut Materials, report: &mut ImportReport) {
    let mut channels: BTreeMap<String, Channel> = BTreeMap::new();
    for prop in arr(seg_json, "common_keyframes") {
        let ty = s(prop, "property_type");
        let mut keys = Vec::new();
        for k in arr(prop, "keyframe_list") {
            let curve = s(k, "curveType");
            bump(&mut report.curve_types, if curve.is_empty() { "(none)".into() } else { curve.clone() });
            if !s(k, "graphID").is_empty() {
                bump(&mut report.unmapped_keyframes, "keyframe graph (drawn as its keys' own curve)".to_string());
            }
            let point = |name: &str| k.get(name).map_or((0.0, 0.0), |p| (f(p, "x", 0.0), f(p, "y", 0.0)));
            keys.push(RawKey {
                at: crate::i(k, "time_offset"),
                values: arr(k, "values").iter().filter_map(Value::as_f64).collect(),
                line: curve.is_empty() || curve == "Line",
                left: point("left_control"),
                right: point("right_control"),
            });
        }
        keys.sort_by_key(|k| k.at);
        keys.retain(|k| !k.values.is_empty());
        if !keys.is_empty() {
            let material = s(prop, "material_id");
            channels.insert(ty, Channel { material, keys });
        }
    }
    if channels.is_empty() {
        return;
    }
    // Keys on media are in its time; the model's are the segment's own. Through a speed curve
    // CapCut places them by the curve's inverse, snapping to the clip's ends within a
    // millisecond (docs/parity/speed.md).
    let (origin, speed) = match seg.source {
        Some(src) if seg.speed > 0.0 => (src.start.0, seg.speed),
        _ => (0, 1.0),
    };
    let remap = seg.speed_curve(materials).and_then(|s| Remap::new(&s.curve)).filter(|_| seg.source.is_some());
    let length = seg.target.duration.0;
    let local = |at: i64| match &remap {
        Some(r) => {
            let t = r.output_offset(at - origin, length);
            Micros(if t < 1_000 { 0 } else if length - t < 1_000 { length } else { t })
        }
        None => Micros(((at - origin) as f64 / speed).round() as i64),
    };
    let ctx = Ctx { local: &local, speed: if remap.is_some() { seg.speed.max(0.1) } else { speed } };
    let drawn = matches!(kind, TrackKind::Video | TrackKind::Text | TrackKind::Sticker | TrackKind::Filter | TrackKind::Audio);

    let mut take = |name: &str| channels.remove(name);
    // The transform.
    let (px, py) = (take("KFTypePositionX"), take("KFTypePositionY"));
    if px.is_some() || py.is_some() {
        let base = seg.transform.position.value;
        seg.transform.position = vec2(&ctx, px.as_ref(), py.as_ref(), base);
    }
    let (sx, sy, su) = (take("KFTypeScaleX"), take("KFTypeScaleY"), take("KFTypeScale"));
    if sx.is_some() || sy.is_some() || su.is_some() {
        let base = seg.transform.scale.value;
        // CapCut often keyframes uniform scale on X only, or as `KFTypeScale`.
        let x = sx.as_ref().or(su.as_ref());
        let y = sy.as_ref().or(x);
        seg.transform.scale = vec2(&ctx, x, y, base);
    }
    if let Some(c) = take("KFTypeRotation") {
        seg.transform.rotation = Animated { value: seg.transform.rotation.value, keys: scalar(&ctx, &c, 0, 1.0) };
    }
    if let Some(c) = take("KFTypeGlobalAlpha").or_else(|| take("KFTypeAlpha")) {
        seg.opacity = Animated { value: seg.opacity.value, keys: to_f32(scalar(&ctx, &c, 0, 1.0)) };
    }
    if let Some(c) = take("KFTypeVolume") {
        seg.volume = Animated { value: seg.volume.value, keys: to_f32(scalar(&ctx, &c, 0, 1.0)) };
    }

    // The Adjust sliders: the slider's effect, made if the clip has none (CapCut makes one
    // when a slider is first moved; a keyframe can come before).
    for (ty, name) in ADJUST_KEYS {
        let Some(c) = take(ty) else { continue };
        let id = find_effect(seg, materials, &c.material, |e| e.category == EffectCategory::Adjust && e.builtin.as_deref() == Some(name)).unwrap_or_else(|| {
            let id = MaterialId(format!("{}-kf-{name}", seg.id));
            // A colour bundle the clip already uses carries the exposure tables.
            let resource = seg.attachments.iter().filter_map(|a| materials.effects.iter().find(|e| &e.id == a && e.category == EffectCategory::Adjust)).find_map(|e| e.resource.clone());
            let mut params = BTreeMap::new();
            params.insert("intensity".to_string(), 0.0);
            materials.effects.push(Effect { id: id.clone(), category: EffectCategory::Adjust, name: String::new(), params, builtin: Some(name.to_string()), resource, library: None, text_style: None });
            seg.attachments.push(id.clone());
            id
        });
        push(seg, id, Param::Intensity, scalar(&ctx, &c, 0, 1.0));
    }
    // A filter bar's strength.
    if let Some(c) = take("KFTypeFilter") {
        match materials.effects.iter().find(|e| e.id == seg.material && e.category == EffectCategory::Filter) {
            Some(e) => {
                let id = e.id.clone();
                push(seg, id, Param::Intensity, scalar(&ctx, &c, 0, 1.0));
            }
            // A filter on a clip isn't drawn (only filter bars are).
            None => *report.unmapped_keyframes.entry("KFTypeFilter (a filter on a clip)".into()).or_insert(0) += c.keys.len(),
        }
    }
    if let Some(c) = take("KFTypePrimaryColorWheelIntensity") {
        match attachment(seg, &c.material, |id| materials.color_wheels.iter().any(|w| &w.id == id && !w.log)) {
            Some(id) => push(seg, id, Param::WheelIntensity, scalar(&ctx, &c, 0, 1.0)),
            None => *report.unmapped_keyframes.entry("KFTypePrimaryColorWheelIntensity (no colour wheels)".into()).or_insert(0) += c.keys.len(),
        }
    }
    for (ty, param) in [("KFTypeHslHueIntensity", Param::HslHue), ("KFTypeHslSaturationIntensity", Param::HslSaturation), ("KFTypeHslLightnessIntensity", Param::HslLightness)] {
        let Some(c) = take(ty) else { continue };
        match attachment(seg, &c.material, |id| materials.hsl.iter().any(|h| &h.id == id)) {
            Some(id) => push(seg, id, param, scalar(&ctx, &c, 0, 1.0)),
            None => *report.unmapped_keyframes.entry(format!("{ty} (no HSL range)")).or_insert(0) += c.keys.len(),
        }
    }
    // The text's style.
    let text = materials.texts.iter().any(|t| t.id == seg.material).then(|| seg.material.clone());
    for (ty, params, factor) in TEXT_KEYS {
        let Some(c) = take(ty) else { continue };
        let Some(id) = text.clone() else {
            *report.unmapped_keyframes.entry(format!("{ty} (not on a text)")).or_insert(0) += c.keys.len();
            continue;
        };
        for (i, param) in params.iter().enumerate() {
            push(seg, id.clone(), *param, scalar(&ctx, &c, i, *factor));
        }
    }
    // Masks.
    for (ty, param) in MASK_KEYS {
        let Some(c) = take(ty) else { continue };
        match attachment(seg, &c.material, |id| materials.masks.iter().any(|m| &m.id == id)) {
            Some(id) => push(seg, id, *param, scalar(&ctx, &c, 0, 1.0)),
            None => *report.unmapped_keyframes.entry(format!("{ty} (no mask)")).or_insert(0) += c.keys.len(),
        }
    }

    for (name, c) in channels {
        *report.unmapped_keyframes.entry(name).or_insert(0) += c.keys.len();
    }
    if !drawn {
        // Mapped, but on a track the engine doesn't draw yet (adjustment layers, effects).
        let label = format!("keyframes on {} tracks (not drawn)", crate::kind_label(kind));
        let n = seg.keyframes.iter().map(|k| k.keys.len()).sum::<usize>();
        if n > 0 {
            *report.unmapped_keyframes.entry(label).or_insert(0) += n;
        }
    }
}

struct Ctx<'a> {
    local: &'a dyn Fn(i64) -> Micros,
    speed: f64,
}

fn push(seg: &mut Segment, material: MaterialId, param: Param, keys: Vec<Keyframe<f64>>) {
    if keys.is_empty() {
        return;
    }
    seg.keyframes.retain(|k| !(k.material == material && k.param == param));
    seg.keyframes.push(ParamKeys { material, param, keys });
}

/// The effect a keyframe is for: by its `material_id` if the segment uses it, else the first
/// attachment `pick` accepts.
fn find_effect(seg: &Segment, materials: &Materials, material: &str, pick: impl Fn(&Effect) -> bool) -> Option<MaterialId> {
    attachment(seg, material, |id| materials.effects.iter().any(|e| &e.id == id && pick(e)))
}

fn attachment(seg: &Segment, material: &str, is: impl Fn(&MaterialId) -> bool) -> Option<MaterialId> {
    let named = MaterialId(material.to_string());
    if !material.is_empty() && (seg.attachments.contains(&named) || seg.material == named) && is(&named) {
        return Some(named);
    }
    seg.attachments.iter().find(|a| is(a)).cloned()
}

/// One value of a channel's keys (`index` into each key's values) as the model's keys, times
/// `factor`: in the segment's local time, each span's easing from the keys beside it.
fn scalar(ctx: &Ctx, c: &Channel, index: usize, factor: f64) -> Vec<Keyframe<f64>> {
    let n = c.keys.len();
    (0..n)
        .map(|k| {
            let key = &c.keys[k];
            let value = key.values.get(index).or(key.values.last()).copied().unwrap_or(0.0) * factor;
            let ease = match c.keys.get(k + 1) {
                Some(next) if !(key.line && next.line) => {
                    let (out, into) = handles(ctx, key, next);
                    Easing::Curve { out: Handle::uniform(out.0, out.1 * factor), into: Handle::uniform(into.0, into.1 * factor), straight: 0 }
                }
                _ => Easing::Linear,
            };
            Keyframe { at: (ctx.local)(key.at), value, ease }
        })
        .collect()
}

/// The handles of the span from `a` to `b` in the model's time: `a`'s right handle and `b`'s
/// left one, each only if its key isn't `Line`.
fn handles(ctx: &Ctx, a: &RawKey, b: &RawKey) -> ((f64, f64), (f64, f64)) {
    let out = if a.line { (0.0, 0.0) } else { (a.right.0 / ctx.speed, a.right.1) };
    let into = if b.line { (0.0, 0.0) } else { (b.left.0 / ctx.speed, b.left.1) };
    (out, into)
}

/// Two channels (x and y) as one `Vec2` animation over `base`. Keys at the same times merge,
/// each component keeping its own handles; a key in one channel only splits the other's span
/// there (`split_keys`), which keeps its motion.
fn vec2(ctx: &Ctx, x: Option<&Channel>, y: Option<&Channel>, base: Vec2) -> Animated<Vec2> {
    let xs = x.map(|c| scalar(ctx, c, 0, 1.0)).unwrap_or_default();
    let ys = y.map(|c| scalar(ctx, c, 0, 1.0)).unwrap_or_default();
    let mut times: Vec<Micros> = xs.iter().chain(&ys).map(|k| k.at).collect();
    times.sort();
    times.dedup();
    // Each channel with a key at every time (a channel without keys holds the base).
    let fill = |mut keys: Vec<Keyframe<f64>>, constant: f64| -> Vec<Keyframe<f64>> {
        if keys.is_empty() {
            return times.iter().map(|&t| Keyframe::new(t, constant)).collect();
        }
        for &t in &times {
            split_keys(&mut keys, t);
        }
        keys
    };
    let (xs, ys) = (fill(xs, base.x), fill(ys, base.y));
    let keys = xs
        .iter()
        .zip(&ys)
        .map(|(kx, ky)| {
            let ease = match (kx.ease, ky.ease) {
                (Easing::Curve { .. }, _) | (_, Easing::Curve { .. }) => {
                    let (ox, ix, lx) = as_curve(kx.ease);
                    let (oy, iy, ly) = as_curve(ky.ease);
                    let pair = |a: Handle, b: Handle| Handle { t: [a.t[0], b.t[0], 0.0, 0.0], v: [a.v[0], b.v[0], 0.0, 0.0] };
                    Easing::Curve { out: pair(ox, oy), into: pair(ix, iy), straight: lx as u8 | (ly as u8) << 1 }
                }
                _ => Easing::Linear,
            };
            Keyframe { at: kx.at, value: Vec2::new(kx.value, ky.value), ease }
        })
        .collect();
    Animated { value: base, keys }
}

/// A span's easing as curve handles, and whether it's a straight line instead.
fn as_curve(e: Easing) -> (Handle, Handle, bool) {
    match e {
        Easing::Curve { out, into, .. } => (out, into, false),
        _ => (Handle::ZERO, Handle::ZERO, true),
    }
}

fn to_f32(keys: Vec<Keyframe<f64>>) -> Vec<Keyframe<f32>> {
    keys.into_iter().map(|k| Keyframe { at: k.at, value: k.value as f32, ease: k.ease }).collect()
}

#[cfg(test)]
mod tests {
    use crate::{import_draft_json, Imported};
    use openrip_model::*;
    use serde_json::{json, Value};

    /// A draft with one video segment 2 s long reading its media from 10 s, keyframed by
    /// `props`, with a brightness slider, an HSL range and a mask attached; and a text.
    fn draft(props: Value, text_props: Value) -> Value {
        json!({
            "id": "D", "fps": 30.0, "canvas_config": {"width": 1080, "height": 1920},
            "materials": {
                "videos": [{"id": "V", "type": "video", "path": "/nope.mp4", "width": 1080, "height": 1920, "duration": 30_000_000}],
                "effects": [{"id": "B", "type": "brightness", "value": 0.2, "path": "/bundle/color"}],
                "hsl": [{"id": "H", "hsl_color_type": 1, "hue": 10.0, "saturation": 0.0, "lightness": 0.0}],
                "common_mask": [{"id": "M", "resource_type": "rectangle", "config": {"centerX": 0.0, "centerY": 0.0, "width": 0.5, "height": 0.5}}],
                "texts": [{"id": "T", "content": "{\"text\":\"hi\",\"styles\":[{\"range\":[0,2],\"size\":15,\"fill\":{\"content\":{\"solid\":{\"color\":[1,1,1]}}}}]}"}]
            },
            "tracks": [
                {"id": "TV", "type": "video", "segments": [{"id": "S", "material_id": "V", "speed": 1.0,
                    "source_timerange": {"start": 10_000_000, "duration": 2_000_000}, "target_timerange": {"start": 5_000_000, "duration": 2_000_000},
                    "clip": {"transform": {"x": 0.1, "y": 0.2}, "scale": {"x": 1.0, "y": 1.0}},
                    "extra_material_refs": ["B", "H", "M"], "common_keyframes": props}]},
                {"id": "TT", "type": "text", "segments": [{"id": "ST", "material_id": "T",
                    "target_timerange": {"start": 0, "duration": 1_000_000}, "common_keyframes": text_props}]}
            ]
        })
    }

    fn key(at: i64, values: Value, curve: &str, left: (f64, f64), right: (f64, f64)) -> Value {
        json!({"time_offset": at, "values": values, "curveType": curve, "left_control": {"x": left.0, "y": left.1}, "right_control": {"x": right.0, "y": right.1}, "graphID": ""})
    }

    fn prop(ty: &str, material: &str, keys: Vec<Value>) -> Value {
        json!({"property_type": ty, "material_id": material, "keyframe_list": keys})
    }

    fn import(props: Value, text_props: Value) -> (Project, crate::ImportReport) {
        let Imported { project, report } = import_draft_json(&draft(props, text_props), "x").unwrap();
        (project, report)
    }

    fn seg<'a>(p: &'a Project, id: &str) -> &'a Segment {
        p.tracks.iter().flat_map(|t| &t.segments).find(|s| s.id == id).unwrap()
    }

    /// Keys on media are in its time: 10.5 s of media is half a second into the segment.
    #[test]
    fn keys_on_media_are_in_its_time() {
        let x = prop("KFTypePositionX", "", vec![key(10_500_000, json!([0.0]), "Line", (0.0, 0.0), (0.0, 0.0)), key(11_500_000, json!([1.0]), "Line", (0.0, 0.0), (0.0, 0.0))]);
        let (p, report) = import(json!([x]), json!([]));
        let s = seg(&p, "S");
        assert_eq!(s.transform.position.keys.iter().map(|k| k.at).collect::<Vec<_>>(), vec![Micros(500_000), Micros(1_500_000)]);
        assert_eq!(s.transform.position.sample(Micros(1_000_000)), Vec2::new(0.5, 0.2));
        assert!(report.unmapped_keyframes.is_empty(), "{:?}", report.unmapped_keyframes);
        // Text keys count from the text's start.
        let a = prop("KFTypeGlobalAlpha", "", vec![key(0, json!([0.0]), "Line", (0.0, 0.0), (0.0, 0.0)), key(500_000, json!([1.0]), "Line", (0.0, 0.0), (0.0, 0.0))]);
        let (p, _) = import(json!([]), json!([a]));
        assert_eq!(seg(&p, "ST").opacity.sample(Micros(250_000)), 0.5);
    }

    /// A curve key brings its right handle into the span after it, and the next key its left
    /// one only if it isn't `Line` itself.
    #[test]
    fn curve_types_choose_the_handles() {
        let r = prop("KFTypeRotation", "", vec![key(10_000_000, json!([0.0]), "CurveOut", (-1.0, 9.0), (400_000.0, 5.0)), key(11_000_000, json!([90.0]), "Line", (-400_000.0, 7.0), (0.0, 0.0))]);
        let (p, _) = import(json!([r]), json!([]));
        let rot = &seg(&p, "S").transform.rotation;
        assert_eq!(rot.keys[0].ease, Easing::Curve { out: Handle::uniform(400_000.0, 5.0), into: Handle::ZERO, straight: 0 });
        assert_eq!(rot.sample(Micros(0)), 0.0);
        assert_eq!(rot.sample(Micros(1_000_000)), 90.0);
        // Two `Line` keys: straight.
        let r = prop("KFTypeRotation", "", vec![key(10_000_000, json!([0.0]), "Line", (0.0, 0.0), (400_000.0, 5.0)), key(11_000_000, json!([90.0]), "Line", (0.0, 0.0), (0.0, 0.0))]);
        let (p, _) = import(json!([r]), json!([]));
        assert_eq!(seg(&p, "S").transform.rotation.keys[0].ease, Easing::Linear);
        assert_eq!(seg(&p, "S").transform.rotation.sample(Micros(500_000)), 45.0);
    }

    /// X and Y keyed at different times merge without changing either's motion.
    #[test]
    fn position_channels_merge_exactly() {
        let x = prop("KFTypePositionX", "", vec![key(10_000_000, json!([0.0]), "Line", (0.0, 0.0), (0.0, 0.0)), key(12_000_000, json!([1.0]), "Line", (0.0, 0.0), (0.0, 0.0))]);
        let y = prop("KFTypePositionY", "", vec![key(11_000_000, json!([-1.0]), "Line", (0.0, 0.0), (0.0, 0.0))]);
        let (p, _) = import(json!([x, y]), json!([]));
        let pos = &seg(&p, "S").transform.position;
        assert_eq!(pos.keys.len(), 3);
        assert_eq!(pos.sample(Micros(500_000)), Vec2::new(0.25, -1.0));
        assert_eq!(pos.sample(Micros(1_500_000)), Vec2::new(0.75, -1.0));
    }

    /// Adjust, HSL and mask keys drive their materials; a slider the clip doesn't have yet
    /// is made; types the engine doesn't draw are reported.
    #[test]
    fn material_keys_find_their_materials() {
        let k2 = |a: f64, b: f64| vec![key(10_000_000, json!([a]), "Line", (0.0, 0.0), (0.0, 0.0)), key(11_000_000, json!([b]), "Line", (0.0, 0.0), (0.0, 0.0))];
        let props = json!([
            prop("KFTypeBrightness", "B", k2(0.0, 0.4)),
            prop("KFTypeContrast", "", k2(0.0, -0.4)),
            prop("KFTypeHslHueIntensity", "H", k2(0.0, 50.0)),
            prop("KFTypeCommonMaskPositionX", "M", k2(-0.5, 0.5)),
            prop("KFTypeChromaIntensity", "", k2(0.0, 1.0)),
        ]);
        let (p, report) = import(props, json!([]));
        let s = seg(&p, "S");
        let half = Micros(500_000);
        let b = p.materials.effects.iter().find(|e| e.id.0 == "B").unwrap();
        assert!((s.effect_at(b, half).params["intensity"] - 0.2).abs() < 1e-9);
        let c = p.materials.effects.iter().find(|e| e.builtin.as_deref() == Some("contrast")).unwrap();
        assert!(s.attachments.contains(&c.id) && c.resource.as_deref() == Some("/bundle/color"));
        assert!((s.effect_at(c, half).params["intensity"] + 0.2).abs() < 1e-9);
        assert_eq!(s.hsl_at(&p.materials.hsl[0], half).hue, 25.0);
        assert_eq!(s.mask_at(&p.materials.masks[0], half).center, [0.0, 0.0]);
        assert_eq!(report.unmapped_keyframes.keys().collect::<Vec<_>>(), vec!["KFTypeChromaIntensity"]);
    }

    #[test]
    fn text_keys_drive_its_style() {
        let k = |a: Value, b: Value| vec![key(0, a, "Line", (0.0, 0.0), (0.0, 0.0)), key(1_000_000, b, "Line", (0.0, 0.0), (0.0, 0.0))];
        let props = json!([prop("KFTypeTextColor", "", k(json!([1.0, 0.0, 0.0]), json!([0.0, 0.0, 1.0]))), prop("KFTypeShadowDistance", "", k(json!([0.0]), json!([10.0])))]);
        let (p, report) = import(json!([]), props);
        let s = seg(&p, "ST");
        let t = s.text_at(&p.materials.texts[0], Micros(500_000));
        assert_eq!((t.runs[0].fill.r, t.runs[0].fill.b), (0.5, 0.5));
        assert!((t.layout.shadow.unwrap().distance - 0.05).abs() < 1e-6);
        assert!(report.unmapped_keyframes.is_empty(), "{:?}", report.unmapped_keyframes);
    }
}
