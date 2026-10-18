//! The app's keyframes (`keyframes` on a clip; `lib/keyframes.ts`) to and from the model's
//! (docs/plan/app-engine-integration.md, "Keyframes").
//!
//! A clip keeps, per property, keys at clip-local frames (fractional, at the project's
//! rate), each with a value in the clip field's own units and an easing for the span to the
//! next: `linear`, `hold`, CapCut's presets `easeIn`, `easeOut` and `easeInOut` (its default
//! handles, 0.4 of the span and flat, on the start, the end or both), or a curve with explicit
//! handles (`{out: {frames, value}, in: {frames, value}}`, offsets from this key and the next,
//! in frames and the property's units). Values convert to the model's units point by point,
//! and so do the handles' points, so a curve keeps its shape through a change of units.

use openrip_model::*;
use serde_json::{json, Map, Value};

use crate::{f, s, World, WORLD_H};

/// Where a property's keys go in the model.
enum Target {
    Position,
    Scale,
    Rotation,
    Opacity,
    Volume,
    /// One parameter per component.
    Params(MaterialId, Vec<Param>),
}

/// An app property: its model target and its value conversions, component by component.
struct Prop {
    target: Target,
    /// Components of a value (a colour is three).
    n: usize,
    colour: bool,
    to_model: Box<dyn Fn(&[f64]) -> Vec<f64>>,
    to_app: Box<dyn Fn(&[f64]) -> Vec<f64>>,
}

fn linear(k: f64) -> (Box<dyn Fn(&[f64]) -> Vec<f64>>, Box<dyn Fn(&[f64]) -> Vec<f64>>) {
    (Box::new(move |v: &[f64]| v.iter().map(|x| x * k).collect()), Box::new(move |v: &[f64]| v.iter().map(|x| x / k).collect()))
}

fn prop(target: Target, n: usize, k: f64) -> Prop {
    let (to_model, to_app) = linear(k);
    Prop { target, n, colour: false, to_model, to_app }
}

fn colour(material: MaterialId, params: [Param; 3]) -> Prop {
    Prop { colour: true, ..prop(Target::Params(material, params.to_vec()), 3, 1.0) }
}

/// The app's names for the text's style properties, the model's parameters, and whether a
/// size is in pixels (a fraction of the font size in the model).
const TEXT_PROPS: &[(&str, &[Param], bool, f64)] = &[
    ("stroke", &[Param::StrokeRed, Param::StrokeGreen, Param::StrokeBlue], false, 1.0),
    ("strokeWidth", &[Param::StrokeWidth], true, 1.0),
    ("strokeOpacity", &[Param::StrokeAlpha], false, 0.01),
    ("shadowColor", &[Param::ShadowRed, Param::ShadowGreen, Param::ShadowBlue], false, 1.0),
    ("shadowOpacity", &[Param::ShadowAlpha], false, 0.01),
    ("shadowBlur", &[Param::ShadowSmoothing], true, 1.0),
    ("backgroundColor", &[Param::BackgroundRed, Param::BackgroundGreen, Param::BackgroundBlue], false, 1.0),
    ("backgroundOpacity", &[Param::BackgroundAlpha], false, 0.01),
    ("glowColor", &[Param::GlowRed, Param::GlowGreen, Param::GlowBlue], false, 1.0),
    ("glowIntensity", &[Param::GlowStrength], false, 0.01),
    ("glowRange", &[Param::GlowRange], false, 0.01),
];

/// What an app property of `clip` (drawn as `seg`) drives in the model. `None` for a
/// property the model doesn't animate on this clip. An app slider keyed at zero has no effect
/// yet (the importer only makes the ones that aren't): `apply` makes it.
fn resolve(name: &str, clip: &Value, seg: &Segment, materials: &Materials, world: &World, canvas: Canvas) -> Option<Prop> {
    let t = clip.get("transform").cloned().unwrap_or(Value::Null);
    let ty = s(clip, "type");
    Some(match name {
        // The box's centre in world units (y down).
        "position" => {
            let (ww, wh) = (world.w, world.h);
            Prop {
                target: Target::Position,
                n: 2,
                colour: false,
                to_model: Box::new(move |v: &[f64]| vec![v[0] / ww * 2.0 - 1.0, 1.0 - v[1] / wh * 2.0]),
                to_app: Box::new(move |v: &[f64]| vec![(v[0] + 1.0) / 2.0 * ww, (1.0 - v[1]) / 2.0 * wh]),
            }
        }
        // The transform's scaleX and scaleY: relative to the scale the clip's own transform
        // gives it in the model.
        "scale" => {
            let base = seg.transform.scale.value;
            let (bx, by) = (base.x / f(&t, "scaleX", 1.0).abs().max(1e-9), base.y / f(&t, "scaleY", 1.0).abs().max(1e-9));
            Prop {
                target: Target::Scale,
                n: 2,
                colour: false,
                to_model: Box::new(move |v: &[f64]| vec![v[0] * bx, v[1] * by]),
                to_app: Box::new(move |v: &[f64]| vec![v[0] / bx, v[1] / by]),
            }
        }
        "rotation" => prop(Target::Rotation, 1, 1.0),
        "opacity" => prop(Target::Opacity, 1, 0.01),
        // Decibels; the model's gain is linear (as CapCut's volume keys are).
        "volume" => Prop {
            target: Target::Volume,
            n: 1,
            colour: false,
            to_model: Box::new(|v: &[f64]| vec![10f64.powf(v[0] / 20.0)]),
            to_app: Box::new(|v: &[f64]| vec![20.0 * v[0].max(1e-4).log10()]),
        },
        // The app's Adjust sliders, on their own scale.
        n if crate::app::ADJUST_KEYS.contains(&n) && matches!(ty.as_str(), "video" | "image") => prop(Target::Params(MaterialId(format!("{}-adj-{n}", seg.id)), vec![Param::Intensity]), 1, 1.0),
        // The Adjust tab's colour tools (`color`): a slider on CapCut's scale, an HSL range's
        // hue, saturation or lightness (−100…100), the wheels' and a LUT's strength (0–100).
        n if n.starts_with("adjust:") && matches!(ty.as_str(), "video" | "image") => {
            let slider = &n["adjust:".len()..];
            if !crate::color::SLIDERS.contains(&slider) {
                return None;
            }
            prop(Target::Params(crate::color::slider_id(&seg.id, slider), vec![Param::Intensity]), 1, 1.0 / crate::app::capcut_scale(slider))
        }
        n if n.starts_with("hsl:") && matches!(ty.as_str(), "video" | "image") => {
            let (range, part) = n["hsl:".len()..].split_once(':')?;
            if !crate::color::HSL_RANGES.contains(&range) {
                return None;
            }
            let param = match part {
                "hue" => Param::HslHue,
                "saturation" => Param::HslSaturation,
                "lightness" => Param::HslLightness,
                _ => return None,
            };
            prop(Target::Params(crate::color::hsl_id(&seg.id, range), vec![param]), 1, 1.0)
        }
        "wheels:intensity" if matches!(ty.as_str(), "video" | "image") => prop(Target::Params(crate::color::wheels_id(&seg.id), vec![Param::WheelIntensity]), 1, 0.01),
        "lut:intensity" if matches!(ty.as_str(), "video" | "image") => {
            let id = crate::color::lut_id(&seg.id);
            if !materials.contains(&id) && clip.pointer("/color/lut/path").and_then(Value::as_str).is_none_or(str::is_empty) {
                return None;
            }
            prop(Target::Params(id, vec![Param::Intensity]), 1, 0.01)
        }
        // The chroma key's sliders (0–100).
        n if n.starts_with("chroma:") && matches!(ty.as_str(), "video" | "image") => {
            let param = match &n["chroma:".len()..] {
                "intensity" => Param::ChromaIntensity,
                "shadow" => Param::ChromaShadow,
                "edgeSmooth" => Param::ChromaEdgeSmooth,
                "spill" => Param::ChromaSpill,
                _ => return None,
            };
            // The clip's own key, else a converted clip's draft key.
            let own = crate::compositing::chroma_id(&seg.id);
            let id = if materials.contains(&own) { own } else { seg.attachments.iter().find(|a| materials.chromas.iter().any(|c| &c.id == *a)).cloned().unwrap_or(own) };
            prop(Target::Params(id, vec![param]), 1, 0.01)
        }
        // A converted clip's own adjustments, on CapCut's scale (`draftAdjustments`).
        n if n.starts_with("draft:") => {
            let rest = &n["draft:".len()..];
            let (id, part) = rest.split_once(':').map_or((rest, None), |(a, b)| (a, Some(b)));
            // The clip's copy of the material if the app changed it, else the draft's.
            let copy = MaterialId(format!("{}-{id}", seg.id));
            let id = if seg.attachments.contains(&copy) { copy } else { MaterialId(id.to_string()) };
            if !seg.attachments.contains(&id) {
                return None;
            }
            match (materials.get(&id)?, part) {
                (MaterialRef::Effect(e), None) => {
                    let scale = crate::app::capcut_scale(e.builtin.as_deref().unwrap_or_default());
                    prop(Target::Params(id, vec![Param::Intensity]), 1, 1.0 / scale)
                }
                (MaterialRef::ColorWheels(_), None) => prop(Target::Params(id, vec![Param::WheelIntensity]), 1, 0.01),
                (MaterialRef::Hsl(_), Some(p)) => {
                    let param = match p {
                        "hue" => Param::HslHue,
                        "saturation" => Param::HslSaturation,
                        "lightness" => Param::HslLightness,
                        _ => return None,
                    };
                    prop(Target::Params(id, vec![param]), 1, 1.0)
                }
                _ => return None,
            }
        }
        // A filter bar's strength, or a sticker bar's opacity (0–100).
        "intensity" if ty == "filter" => {
            if materials.stickers.iter().any(|st| st.id == seg.material) {
                prop(Target::Opacity, 1, 0.01)
            } else if materials.effects.iter().any(|e| e.id == seg.material && e.category == EffectCategory::Filter) {
                prop(Target::Params(seg.material.clone(), vec![Param::Intensity]), 1, 0.01)
            } else {
                return None;
            }
        }
        "color" if ty == "text" => colour(seg.material.clone(), [Param::TextRed, Param::TextGreen, Param::TextBlue]),
        // Font size in world units: the first run's size in its own unit.
        "fontSize" if ty == "text" => {
            let text = materials.texts.iter().find(|m| m.id == seg.material)?;
            let per = match text.runs.first()?.size_unit {
                SizeUnit::CanvasHeight => 1.0 / WORLD_H,
                // As `to_app_project` gives a CapCut text's size.
                SizeUnit::CapCut => 1.0 / (CAPCUT_SIZE_UNIT_EM as f64 * canvas.width as f64 / 1.2 * seg.transform.scale.value.x.abs().max(1e-9) * WORLD_H / canvas.height.max(1) as f64),
            };
            prop(Target::Params(seg.material.clone(), vec![Param::TextSize]), 1, per)
        }
        n if ty == "text" => {
            let &(_, params, px, k) = TEXT_PROPS.iter().find(|(p, ..)| *p == n)?;
            if params.len() == 3 {
                colour(seg.material.clone(), [params[0], params[1], params[2]])
            } else {
                // Pixels are fractions of the clip's font size in the model.
                let k = if px { 1.0 / f(clip, "fontSize", 48.0).max(1.0) } else { k };
                prop(Target::Params(seg.material.clone(), params.to_vec()), 1, k)
            }
        }
        _ => return None,
    })
}

/// An app easing for a span of `span` µs where only the shape of the progress matters (a
/// mask's keys): the presets' handles, a curve's handle times (its values don't apply).
pub(crate) fn progress_ease(e: &Value, span: f64, fps: f64) -> Easing {
    let curve = |out: f64, into: f64| Easing::Curve { out: Handle::uniform(out, 0.0), into: Handle::uniform(into, 0.0), straight: 0 };
    match e {
        Value::String(p) if p == "hold" => Easing::Hold,
        Value::String(p) if p == "easeIn" => curve(0.4 * span, 0.0),
        Value::String(p) if p == "easeOut" => curve(0.0, -0.4 * span),
        Value::String(p) if p == "easeInOut" => curve(0.4 * span, -0.4 * span),
        Value::Object(o) => {
            let frames = |h: Option<&Value>| h.and_then(|h| h.get("frames")).and_then(|v| v.as_f64().or_else(|| v.get(0).and_then(Value::as_f64))).unwrap_or(0.0) / fps * 1e6;
            curve(frames(o.get("out")), frames(o.get("in")))
        }
        _ => Easing::Linear,
    }
}

/// Move every key of `seg` to `to(at)`, its curve handles' times scaled by `scale` (a trim or
/// a new speed of a converted clip).
pub(crate) fn retime(seg: &mut Segment, to: impl Fn(Micros) -> Micros, scale: f64) {
    fn each<T>(keys: &mut [Keyframe<T>], to: &dyn Fn(Micros) -> Micros, scale: f64) {
        for k in keys {
            k.at = to(k.at);
            if let Easing::Curve { out, into, .. } = &mut k.ease {
                out.t.iter_mut().chain(into.t.iter_mut()).for_each(|t| *t *= scale);
            }
        }
    }
    each(&mut seg.transform.position.keys, &to, scale);
    each(&mut seg.transform.scale.keys, &to, scale);
    each(&mut seg.transform.rotation.keys, &to, scale);
    each(&mut seg.opacity.keys, &to, scale);
    each(&mut seg.volume.keys, &to, scale);
    for p in &mut seg.keyframes {
        each(&mut p.keys, &to, scale);
    }
}

/// One app key, its value in components.
struct AppKey {
    frame: f64,
    values: Vec<f64>,
    ease: Value,
}

fn hex_components(v: &str) -> Option<Vec<f64>> {
    let c = Rgba::from_hex(v)?;
    Some(vec![c.r as f64, c.g as f64, c.b as f64])
}

fn components(v: &Value) -> Option<Vec<f64>> {
    match v {
        Value::Number(n) => Some(vec![n.as_f64()?]),
        Value::Array(a) => a.iter().map(Value::as_f64).collect(),
        Value::String(h) => hex_components(h),
        _ => None,
    }
}

fn app_keys(list: &Value, n: usize) -> Vec<AppKey> {
    let mut keys: Vec<AppKey> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|k| {
            let frame = k.get("frame")?.as_f64().filter(|x| x.is_finite())?;
            let values = components(k.get("value")?)?;
            (values.len() >= n).then(|| AppKey { frame, values, ease: k.get("ease").cloned().unwrap_or(Value::Null) })
        })
        .collect();
    keys.sort_by(|a, b| a.frame.total_cmp(&b.frame));
    keys.dedup_by(|b, a| a.frame == b.frame);
    keys
}

/// A handle's offsets (frames, then value per component) from the app's `{frames, value}`.
fn handle(v: Option<&Value>, n: usize) -> (Vec<f64>, Vec<f64>) {
    let per = |x: Option<&Value>| -> Vec<f64> {
        match x {
            Some(Value::Array(a)) => (0..n).map(|i| a.get(i).and_then(Value::as_f64).unwrap_or(0.0)).collect(),
            Some(x) => vec![x.as_f64().unwrap_or(0.0); n],
            None => vec![0.0; n],
        }
    };
    let v = v.unwrap_or(&Value::Null);
    (per(v.get("frames")), per(v.get("value")))
}

/// The model's keys (values in model components) for an app property's keys.
fn to_model(prop: &Prop, keys: &[AppKey], fps: f64) -> Vec<Keyframe<Vec<f64>>> {
    let us = |frames: f64| frames / fps * 1e6;
    let at = |k: &AppKey| Micros(us(k.frame).round() as i64);
    let n = prop.n;
    (0..keys.len())
        .map(|i| {
            let k = &keys[i];
            let value = (prop.to_model)(&k.values[..n]);
            let ease = match (keys.get(i + 1), &k.ease) {
                (None, _) => Easing::Linear,
                (Some(_), Value::String(name)) if name == "hold" => Easing::Hold,
                (Some(next), e) => {
                    let span = (at(next).0 - at(k).0) as f64;
                    let next_value = (prop.to_model)(&next.values[..n]);
                    // A point beside a key, in the model's units.
                    let point = |base: &[f64], model: &[f64], dv: &[f64]| -> Vec<f64> {
                        let moved: Vec<f64> = base.iter().zip(dv).map(|(a, d)| a + d).collect();
                        (prop.to_model)(&moved).iter().zip(model).map(|(p, m)| p - m).collect()
                    };
                    let curve = |out: (Vec<f64>, Vec<f64>), into: (Vec<f64>, Vec<f64>), straight: u8| {
                        let mut h = (Handle::ZERO, Handle::ZERO);
                        let (ov, iv) = (point(&k.values[..n], &value, &out.1), point(&next.values[..n], &next_value, &into.1));
                        for c in 0..n.min(4) {
                            h.0.t[c] = out.0[c];
                            h.0.v[c] = ov[c];
                            h.1.t[c] = into.0[c];
                            h.1.v[c] = iv[c];
                        }
                        Easing::Curve { out: h.0, into: h.1, straight }
                    };
                    let flat = |t: f64| (vec![t; n], vec![0.0; n]);
                    match e {
                        Value::String(p) if p == "easeIn" => curve(flat(0.4 * span), flat(0.0), 0),
                        Value::String(p) if p == "easeOut" => curve(flat(0.0), flat(-0.4 * span), 0),
                        Value::String(p) if p == "easeInOut" => curve(flat(0.4 * span), flat(-0.4 * span), 0),
                        Value::Object(o) => {
                            let (of, ov) = handle(o.get("out"), n);
                            let (inf, inv) = handle(o.get("in"), n);
                            let straight = o.get("straight").and_then(Value::as_array).map_or(0, |a| a.iter().enumerate().filter(|(_, b)| b.as_bool() == Some(true)).fold(0u8, |m, (i, _)| m | 1 << i.min(7)));
                            curve((of.iter().map(|x| us(*x)).collect(), ov), (inf.iter().map(|x| us(*x)).collect(), inv), straight)
                        }
                        _ => Easing::Linear,
                    }
                }
            };
            Keyframe { at: at(k), value, ease }
        })
        .collect()
}

/// Component `c` of keys with values in components, as scalar keys.
fn component(keys: &[Keyframe<Vec<f64>>], c: usize) -> Vec<Keyframe<f64>> {
    keys.iter()
        .map(|k| {
            let ease = match k.ease {
                Easing::Curve { straight, .. } if straight & (1 << c) != 0 => Easing::Linear,
                Easing::Curve { out, into, .. } => Easing::Curve { out: Handle::uniform(out.t[c], out.v[c]), into: Handle::uniform(into.t[c], into.v[c]), straight: 0 },
                e => e,
            };
            Keyframe { at: k.at, value: k.value[c], ease }
        })
        .collect()
}

fn vec2(keys: &[Keyframe<Vec<f64>>]) -> Vec<Keyframe<Vec2>> {
    keys.iter().map(|k| Keyframe { at: k.at, value: Vec2::new(k.value[0], k.value[1]), ease: k.ease }).collect()
}

fn set_params(seg: &mut Segment, material: &MaterialId, params: &[Param], keys: Option<&[Keyframe<Vec<f64>>]>) {
    for (c, param) in params.iter().enumerate() {
        seg.keyframes.retain(|k| !(&k.material == material && k.param == *param));
        if let Some(keys) = keys.filter(|k| !k.is_empty()) {
            seg.keyframes.push(ParamKeys { material: material.clone(), param: *param, keys: component(keys, c) });
        }
    }
}

/// Give `seg` the clip's keyframes for `names` (every property it keys, if `None`): a
/// property with keys replaces the segment's, one without clears them.
pub(crate) fn apply(seg: &mut Segment, clip: &Value, names: Option<&[String]>, fps: f64, world: &World, canvas: Canvas, materials: &mut Materials) {
    let all = clip.get("keyframes").and_then(Value::as_object).cloned().unwrap_or_default();
    let names: Vec<String> = match names {
        Some(n) => n.to_vec(),
        None => all.keys().cloned().collect(),
    };
    for name in names {
        let Some(prop) = resolve(&name, clip, seg, materials, world, canvas) else { continue };
        let keys = all.get(&name).map(|l| to_model(&prop, &app_keys(l, prop.n), fps)).unwrap_or_default();
        if let (Target::Params(id, _), false) = (&prop.target, keys.is_empty()) {
            // An app slider keyed at zero: its effect, at zero, for the keys to drive.
            if crate::app::ADJUST_KEYS.contains(&name.as_str()) && !materials.contains(id) {
                let mut params = std::collections::BTreeMap::new();
                params.insert("value".to_string(), 0.0);
                params.insert("pixel".to_string(), 1.0 / WORLD_H);
                materials.effects.push(Effect { id: id.clone(), category: EffectCategory::Adjust, name: name.clone(), params, builtin: Some(format!("v1:{name}")), resource: None, library: None, text_style: None });
            }
            // So with a colour tool or a chroma key the field leaves neutral.
            if !materials.contains(id) {
                let made = crate::color::keyed_material(&seg.id, &name, clip.get("color").unwrap_or(&Value::Null), materials)
                    .or_else(|| name.starts_with("chroma:").then(|| AnyMaterial::Chroma(crate::compositing::chroma(&seg.id, clip.get("chroma").unwrap_or(&Value::Null)))));
                if let Some(m) = made.filter(|m| m.id() == id) {
                    materials.insert_at(m, None);
                }
            }
            if materials.contains(id) && !seg.attachments.contains(id) && *id != seg.material {
                seg.attachments.push(id.clone());
            }
        }
        match &prop.target {
            Target::Position => seg.transform.position.keys = vec2(&keys),
            Target::Scale => seg.transform.scale.keys = vec2(&keys),
            Target::Rotation => seg.transform.rotation.keys = component(&keys, 0),
            Target::Opacity => seg.opacity.keys = component(&keys, 0).into_iter().map(|k| Keyframe { at: k.at, value: k.value as f32, ease: k.ease }).collect(),
            Target::Volume => seg.volume.keys = component(&keys, 0).into_iter().map(|k| Keyframe { at: k.at, value: k.value as f32, ease: k.ease }).collect(),
            Target::Params(material, params) => set_params(seg, material, params, Some(&keys)),
        }
    }
}

/// Whether a segment has any keys.
pub(crate) fn has_keys(seg: &Segment) -> bool {
    let t = &seg.transform;
    !(seg.keyframes.is_empty() && t.position.keys.is_empty() && t.scale.keys.is_empty() && t.rotation.keys.is_empty() && seg.opacity.keys.is_empty() && seg.volume.keys.is_empty())
}

/// The app's `keyframes` for a model segment: the properties `resolve` knows whose model keys
/// it can show (a colour only when its three channels share their times).
pub(crate) fn emit(seg: &Segment, clip: &Value, project: &Project, world: &World) -> Map<String, Value> {
    let mut out = Map::new();
    if !has_keys(seg) {
        return out;
    }
    let mut names: Vec<String> = ["position", "scale", "rotation", "opacity", "volume", "intensity", "color", "fontSize"].iter().map(|s| s.to_string()).collect();
    names.extend(TEXT_PROPS.iter().map(|(n, ..)| n.to_string()));
    // The colour tools and the chroma key (the keys of a converted clip's own chroma key).
    names.extend(crate::color::SLIDERS.iter().map(|n| format!("adjust:{n}")));
    names.extend(crate::color::HSL_RANGES.iter().flat_map(|r| ["hue", "saturation", "lightness"].map(|p| format!("hsl:{r}:{p}"))));
    names.extend(["wheels:intensity", "lut:intensity", "chroma:intensity", "chroma:shadow", "chroma:edgeSmooth", "chroma:spill"].map(String::from));
    for a in clip.get("draftAdjustments").and_then(Value::as_array).into_iter().flatten() {
        let id = s(a, "id");
        if a.get("values").is_some() {
            names.extend(["hue", "saturation", "lightness"].map(|p| format!("draft:{id}:{p}")));
        } else {
            names.push(format!("draft:{id}"));
        }
    }
    let fps = project.fps.as_f64();
    for name in names {
        let Some(prop) = resolve(&name, clip, seg, &project.materials, world, project.canvas) else { continue };
        let keys: Vec<Keyframe<Vec<f64>>> = match &prop.target {
            Target::Position => seg.transform.position.keys.iter().map(|k| Keyframe { at: k.at, value: vec![k.value.x, k.value.y], ease: k.ease }).collect(),
            Target::Scale => seg.transform.scale.keys.iter().map(|k| Keyframe { at: k.at, value: vec![k.value.x, k.value.y], ease: k.ease }).collect(),
            Target::Rotation => seg.transform.rotation.keys.iter().map(|k| Keyframe { at: k.at, value: vec![k.value], ease: k.ease }).collect(),
            Target::Opacity => seg.opacity.keys.iter().map(|k| Keyframe { at: k.at, value: vec![k.value as f64], ease: k.ease }).collect(),
            Target::Volume => seg.volume.keys.iter().map(|k| Keyframe { at: k.at, value: vec![k.value as f64], ease: k.ease }).collect(),
            Target::Params(material, params) => {
                let channels: Vec<&ParamKeys> = params.iter().filter_map(|p| seg.keyframes.iter().find(|k| &k.material == material && k.param == *p)).collect();
                if channels.len() != params.len() || channels.iter().any(|c| c.keys.len() != channels[0].keys.len() || c.keys.iter().zip(&channels[0].keys).any(|(a, b)| a.at != b.at)) {
                    continue;
                }
                (0..channels[0].keys.len())
                    .map(|i| {
                        let ease = match channels.iter().map(|c| c.keys[i].ease).collect::<Vec<_>>().as_slice() {
                            [only] => *only,
                            many if many.iter().all(|e| matches!(e, Easing::Linear)) => Easing::Linear,
                            many if many.iter().all(|e| matches!(e, Easing::Hold)) => Easing::Hold,
                            many => {
                                let mut h = (Handle::ZERO, Handle::ZERO, 0u8);
                                for (c, e) in many.iter().enumerate() {
                                    match e {
                                        Easing::Curve { out, into, .. } => {
                                            (h.0.t[c], h.0.v[c], h.1.t[c], h.1.v[c]) = (out.t[0], out.v[0], into.t[0], into.v[0]);
                                        }
                                        _ => h.2 |= 1 << c,
                                    }
                                }
                                Easing::Curve { out: h.0, into: h.1, straight: h.2 }
                            }
                        };
                        Keyframe { at: channels[0].keys[i].at, value: channels.iter().map(|c| c.keys[i].value).collect(), ease }
                    })
                    .collect()
            }
        };
        if !keys.is_empty() {
            out.insert(name, Value::Array(to_app(&prop, &keys, fps)));
        }
    }
    out
}

/// Model keys (values in model components) as the app's keys for a property.
fn to_app(prop: &Prop, keys: &[Keyframe<Vec<f64>>], fps: f64) -> Vec<Value> {
    let frames = |us: f64| us * fps / 1e6;
    let n = prop.n;
    let value = |v: &[f64]| -> Value {
        if prop.colour {
            let c = Rgba { r: v[0] as f32, g: v[1] as f32, b: v[2] as f32, a: 1.0 };
            let b = |x: f32| (x.clamp(0.0, 1.0) * 255.0).round() as u8;
            json!(format!("#{:02x}{:02x}{:02x}", b(c.r), b(c.g), b(c.b)))
        } else if n == 1 {
            json!(v[0])
        } else {
            json!(v)
        }
    };
    (0..keys.len())
        .map(|i| {
            let k = &keys[i];
            let app = (prop.to_app)(&k.value);
            let mut o = Map::new();
            o.insert("frame".into(), json!(frames(k.at.0 as f64)));
            o.insert("value".into(), value(&app));
            let ease = match (k.ease, keys.get(i + 1)) {
                (Easing::Hold, _) => json!("hold"),
                (Easing::Curve { out, into, straight }, Some(next)) => {
                    let next_app = (prop.to_app)(&next.value);
                    // A handle's point back in the app's units, as an offset from its key.
                    let offset = |model: &[f64], app: &[f64], v: &[f64; 4]| -> Vec<f64> {
                        let moved: Vec<f64> = model.iter().enumerate().map(|(c, m)| m + v[c.min(3)]).collect();
                        (prop.to_app)(&moved).iter().zip(app).map(|(p, a)| p - a).collect()
                    };
                    let one = |v: Vec<f64>| if n == 1 { json!(v[0]) } else { json!(v) };
                    let t = |h: &Handle| one((0..n).map(|c| frames(h.t[c.min(3)])).collect());
                    let mut e = json!({
                        "out": {"frames": t(&out), "value": one(offset(&k.value, &app, &out.v))},
                        "in": {"frames": t(&into), "value": one(offset(&next.value, &next_app, &into.v))},
                    });
                    if straight != 0 {
                        e["straight"] = json!((0..n).map(|c| straight & (1 << c) != 0).collect::<Vec<_>>());
                    }
                    e
                }
                (Easing::Bezier { x1, y1, x2, y2 }, Some(next)) => {
                    // The same curve with handles in the keys' units.
                    let span = (next.at.0 - k.at.0) as f64;
                    let next_app = (prop.to_app)(&next.value);
                    let d: Vec<f64> = next_app.iter().zip(&app).map(|(b, a)| b - a).collect();
                    let one = |v: Vec<f64>| if n == 1 { json!(v[0]) } else { json!(v) };
                    json!({
                        "out": {"frames": frames(x1 * span), "value": one(d.iter().map(|x| x * y1).collect())},
                        "in": {"frames": frames((x2 - 1.0) * span), "value": one(d.iter().map(|x| x * (y2 - 1.0)).collect())},
                    })
                }
                _ => json!("linear"),
            };
            o.insert("ease".into(), ease);
            Value::Object(o)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::{import_v1_json, to_app_project, Imported};
    use openrip_model::*;
    use serde_json::{json, Value};

    /// A 24 fps 16:9 project (world 1066.67×600) with one full-frame video clip (2 s from
    /// 1 s) and a text, keyframed by `video` and `text`.
    fn doc(video: Value, text: Value) -> Value {
        json!({
            "version": "1.0.0",
            "settings": {"fps": 24, "aspectRatio": {"width": 16, "height": 9, "id": "16:9"}},
            "assets": {"A": {"id": "A", "type": "video", "path": "file:///nope.mp4", "width": 1920, "height": 1080, "duration": 10.0}},
            "timeline": {
                "tracks": [{"type": "text", "timelineId": "TT"}, {"type": "media", "timelineId": "TM"}],
                "clips": [
                    {"clipId": "v", "type": "video", "timelineId": "TM", "assetId": "A", "startTick": "1000000", "endTick": "3000000", "trimStartTick": "0", "trimEndTick": "0",
                     "mediaWidth": 1920, "mediaHeight": 1080, "volume": 0,
                     "transform": {"x": 0, "y": 0, "width": 1066.6666666666667, "height": 600, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 100},
                     "keyframes": video},
                    {"clipId": "t", "type": "text", "timelineId": "TT", "text": "hi", "fontSize": 60, "color": "#ffffff", "startTick": "0", "endTick": "1000000", "trimStartTick": "0", "trimEndTick": "0",
                     "transform": {"x": 100, "y": 100, "width": 200, "height": 100, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 100},
                     "keyframes": text}
                ]
            }
        })
    }

    fn seg<'a>(p: &'a Project, id: &str) -> &'a Segment {
        p.tracks.iter().flat_map(|t| &t.segments).find(|s| s.id == id).unwrap()
    }

    /// The app's own clips: keys at clip-local frames in the fields' units become the
    /// segment's, in µs and model units, with CapCut's preset handles.
    #[test]
    fn the_apps_keys_become_the_segments() {
        let video = json!({
            // The box's centre: the canvas's middle, then its right edge.
            "position": [{"frame": 0, "value": [533.3333333333334, 300], "ease": "easeInOut"}, {"frame": 24, "value": [1066.6666666666667, 300]}],
            "opacity": [{"frame": 12, "value": 100, "ease": "hold"}, {"frame": 36, "value": 0}],
            "scale": [{"frame": 0, "value": [1, 1]}, {"frame": 48, "value": [2, 2]}],
            "volume": [{"frame": 0, "value": 0}, {"frame": 24, "value": -6}],
            "brightness": [{"frame": 0, "value": 0}, {"frame": 24, "value": 40}],
        });
        let text = json!({"color": [{"frame": 0, "value": "#ff0000"}, {"frame": 24, "value": "#0000ff"}], "fontSize": [{"frame": 0, "value": 60}, {"frame": 24, "value": 120}]});
        let Imported { project, .. } = import_v1_json(&doc(video, text)).unwrap();
        let v = seg(&project, "v");
        let p = &v.transform.position;
        assert_eq!((p.keys[0].at, p.keys[1].at), (Micros(0), Micros(1_000_000)));
        assert_eq!((p.keys[0].value, p.keys[1].value), (Vec2::new(0.0, 0.0), Vec2::new(1.0, 0.0)));
        assert_eq!(p.keys[0].ease, Easing::Curve { out: Handle { t: [400_000.0, 400_000.0, 0.0, 0.0], v: [0.0; 4] }, into: Handle { t: [-400_000.0, -400_000.0, 0.0, 0.0], v: [0.0; 4] }, straight: 0 });
        assert!((p.sample(Micros(500_000)).x - 0.5).abs() < 1e-6 && p.sample(Micros(250_000)).x < 0.25);
        assert_eq!((v.opacity.sample(Micros(1_000_000)), v.opacity.sample(Micros(1_500_000))), (1.0, 0.0));
        let sc = v.transform.scale.sample(Micros(1_000_000));
        assert!((sc.x - 1.5).abs() < 1e-9 && (sc.y - 1.5).abs() < 1e-9, "{sc:?}");
        assert!((v.volume.sample(Micros(1_000_000)) - 10f32.powf(-6.0 / 20.0)).abs() < 1e-6);
        // A slider at zero but keyed gets its effect.
        let b = project.materials.effects.iter().find(|e| e.id.0 == "v-adj-brightness").unwrap();
        assert!(v.attachments.contains(&b.id));
        assert_eq!(v.effect_at(b, Micros(500_000)).params["value"], 20.0);
        let t = seg(&project, "t");
        let text = project.materials.texts.iter().find(|m| m.id == t.material).unwrap();
        let mid = t.text_at(text, Micros(500_000));
        assert_eq!((mid.runs[0].fill.r, mid.runs[0].fill.b), (0.5, 0.5));
        assert!((mid.runs[0].size - 90.0 / 600.0).abs() < 1e-6);
    }

    /// A custom curve's handles are offsets in frames and the field's units; through
    /// decibels to gain, the handle's point converts like the keys.
    #[test]
    fn custom_handles_convert_point_by_point() {
        let video = json!({"volume": [{"frame": 0, "value": -20, "ease": {"out": {"frames": 6, "value": 10}, "in": {"frames": -12, "value": 0}}}, {"frame": 24, "value": 0}]});
        let Imported { project, .. } = import_v1_json(&doc(video, json!({}))).unwrap();
        let k = &seg(&project, "v").volume.keys[0];
        let Easing::Curve { out, into, .. } = k.ease else { panic!("a curve") };
        assert_eq!((out.t[0], into.t[0]), (250_000.0, -500_000.0));
        // −20 dB → 0.1; the handle at −10 dB → 0.316…: 0.216… above the key.
        assert!((out.v[0] - (10f64.powf(-0.5) - 0.1)).abs() < 1e-9 && into.v[0].abs() < 1e-12, "{out:?}");
    }

    /// A CapCut clip: its keys show in `keyframes` (clip-local frames, the app's units) and
    /// come back exactly when unchanged; a changed property replaces only its own keys.
    #[test]
    fn a_converted_clips_keys_show_and_edits_apply_on_top() {
        let Imported { project: mut p, .. } = import_v1_json(&doc(json!({}), json!({}))).unwrap();
        let v = p.tracks.iter_mut().flat_map(|t| &mut t.segments).find(|s| s.id == "v").unwrap();
        let curve = Easing::Curve { out: Handle::uniform(300_000.0, 0.0), into: Handle::uniform(-300_000.0, 0.1), straight: 0 };
        v.transform.position.keys = vec![Keyframe { at: Micros(0), value: Vec2::new(0.0, 0.0), ease: curve }, Keyframe::new(Micros(1_000_000), Vec2::new(0.5, -0.5))];
        v.opacity.keys = vec![Keyframe::new(Micros(0), 0.0), Keyframe::new(Micros(500_000), 1.0)];
        let mask = MaterialId("m".into());
        v.keyframes.push(ParamKeys { material: mask.clone(), param: Param::MaskCenterX, keys: vec![Keyframe::new(Micros(0), 0.0), Keyframe::new(Micros(1_000_000), 0.5)] });
        let before = v.clone();
        let doc = to_app_project(&p, &mut |_| None);
        let clip = doc["timeline"]["clips"].as_array().unwrap().iter().find(|c| c["clipId"] == "v").unwrap().clone();
        let pos = &clip["keyframes"]["position"];
        assert_eq!((pos[0]["frame"].as_f64(), pos[1]["frame"].as_f64()), (Some(0.0), Some(24.0)));
        assert!((pos[1]["value"][0].as_f64().unwrap() - 0.75 * 1066.6666666666667).abs() < 1e-6 && (pos[1]["value"][1].as_f64().unwrap() - 450.0).abs() < 1e-6, "{pos}");
        assert_eq!(pos[0]["ease"]["out"]["frames"][0].as_f64(), Some(7.2));
        assert_eq!(clip["keyframes"]["opacity"][1]["value"].as_f64(), Some(100.0));
        // Unchanged: exactly as before.
        let back = import_v1_json(&doc).unwrap().project;
        assert_eq!(seg(&back, "v").transform, before.transform);
        assert_eq!((seg(&back, "v").opacity.clone(), seg(&back, "v").keyframes.clone()), (before.opacity.clone(), before.keyframes.clone()));
        // Opacity edited in the app: only its keys change.
        let mut edited = doc.clone();
        let c = edited["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["clipId"] == "v").unwrap();
        c["keyframes"]["opacity"][1]["value"] = json!(50);
        let back = import_v1_json(&edited).unwrap().project;
        assert_eq!(seg(&back, "v").opacity.sample(Micros(500_000)), 0.5);
        assert_eq!(seg(&back, "v").transform.position, before.transform.position);
        // Trimmed from the start by half a second (the app moves the keys it shows): the
        // keys it doesn't show (the mask's) stay on the media.
        let mut trimmed = doc.clone();
        let c = trimmed["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["clipId"] == "v").unwrap();
        c["startTick"] = json!("1500000");
        c["trimStartTick"] = json!("500000");
        let back = import_v1_json(&trimmed).unwrap().project;
        let m = seg(&back, "v").keyframes.iter().find(|k| k.material == mask).unwrap();
        assert_eq!((m.keys[0].at, m.keys[1].at), (Micros(-500_000), Micros(500_000)));
    }

    /// The app's masks: feather and invert apply, keys keep their easing, a brush mask
    /// becomes its strokes.
    #[test]
    fn masks_take_feather_invert_ease_and_brush() {
        let mut d = doc(json!({}), json!({}));
        let clip = &mut d["timeline"]["clips"][0];
        clip["masks"] = json!([
            {"id": "a", "tool": "shape", "featherAmount": 20, "inverted": true,
             "keyframes": {"0": {"shapeBounds": {"x": 0, "y": 0, "width": 100, "height": 100, "shapeType": "ellipse"}, "ease": "easeOut"},
                           "24": {"shapeBounds": {"x": 500, "y": 0, "width": 100, "height": 100, "shapeType": "ellipse"}}}},
            {"id": "b", "tool": "draw", "keyframes": {"0": {"brushStrokes": [{"points": [0, 300, 1066.6666666666667, 300], "size": 60}]}}}
        ]);
        let Imported { project, .. } = import_v1_json(&d).unwrap();
        let (a, b) = (&project.materials.masks[0], &project.materials.masks[1]);
        assert_eq!((a.feather, a.invert, a.keys.len()), (0.2, true, 2));
        assert_eq!(a.keys[0].ease, Easing::Curve { out: Handle::uniform(0.0, 0.0), into: Handle::uniform(-400_000.0, 0.0), straight: 0 });
        let MaskShape::Brush { strokes } = &b.shape else { panic!("a brush") };
        assert_eq!((strokes[0].points.clone(), strokes[0].width), (vec![[0.0, 0.5], [1.0, 0.5]], 0.1));
    }

    /// The app's own clip: its colour tools, blend mode, chroma key, canvas fill and flips
    /// become CapCut's materials, and their keys the materials' (a slider keyed but left at 0
    /// gets its effect).
    #[test]
    fn colour_and_compositing_fields_and_their_keys() {
        let video = json!({
            "adjust:exposure": [{"frame": 0, "value": 0}, {"frame": 24, "value": 50}],
            "hsl:blue:saturation": [{"frame": 0, "value": -100}, {"frame": 24, "value": 100}],
            "chroma:intensity": [{"frame": 0, "value": 20}, {"frame": 24, "value": 80}],
            "lut:intensity": [{"frame": 0, "value": 0}, {"frame": 24, "value": 100}],
        });
        let mut d = doc(video, json!({}));
        let clip = &mut d["timeline"]["clips"][0];
        clip["color"] = json!({"adjust": {"contrast": 20}, "lut": {"path": "/looks/a.cube", "intensity": 50}});
        clip["blendMode"] = json!("soft_light");
        clip["chroma"] = json!({"color": "#00ff00", "intensity": 50, "shadow": 0, "edgeSmooth": 0, "spill": 0});
        clip["canvas"] = json!({"type": "image", "image": "file:///pics/bg%20one.png"});
        clip["flip"] = json!({"horizontal": true, "vertical": false});
        d["timeline"]["clips"][1]["blendMode"] = json!("screen");
        let Imported { project, .. } = import_v1_json(&d).unwrap();
        let v = seg(&project, "v");
        let half = Micros(500_000);
        let effect = |id: &str| project.materials.effects.iter().find(|e| e.id.0 == id && v.attachments.contains(&e.id)).unwrap();
        assert_eq!(effect("v-color-contrast").params["intensity"], 0.4);
        assert!((v.effect_at(effect("v-color-exposure"), half).params["intensity"] - 0.5).abs() < 1e-9);
        assert!((v.effect_at(effect("v-lut"), half).params["intensity"] - 0.5).abs() < 1e-9);
        assert_eq!(effect("v-blend").blend_mode(), Some(BlendMode::SoftLight));
        let blue = project.materials.hsl.iter().find(|h| h.id.0 == "v-hsl-blue" && v.attachments.contains(&h.id)).unwrap();
        assert_eq!((blue.range, v.hsl_at(blue, half).saturation), (6, 0.0));
        let key = project.materials.chromas.iter().find(|k| v.attachments.contains(&k.id)).unwrap();
        assert!((v.chroma_at(key, half).intensity - 0.5).abs() < 1e-6 && key.color.g == 1.0);
        let fill = project.materials.canvas_fills.iter().find(|f| v.attachments.contains(&f.id)).unwrap();
        assert_eq!(fill.fill, CanvasFillKind::Image { path: "/pics/bg one.png".into() });
        assert!(v.transform.flip_h && !v.transform.flip_v);
        // A text takes its blend mode.
        let t = seg(&project, "t");
        assert!(project.materials.effects.iter().any(|e| t.attachments.contains(&e.id) && e.blend_mode() == Some(BlendMode::Screen)));
    }
}
