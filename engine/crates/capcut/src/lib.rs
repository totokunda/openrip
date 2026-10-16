//! Import CapCut Desktop drafts (`draft_info.json`) into the OpenRip model.
//!
//! The reader is deliberately tolerant: CapCut's schema changes between releases,
//! so every field is optional with a sensible default, unknown tables are kept as
//! `Foreign` materials, and everything that couldn't be mapped is counted in the
//! [`ImportReport`]. Nothing is ever written back to CapCut's data folder.

use std::collections::BTreeMap;
use std::path::Path;

pub mod amg;

use openrip_model::*;
use serde::Serialize;
use serde_json::Value;

const APP: &str = "capcut";

// Track `attribute` bits, from the calibration session (docs/parity/calibration.md).
// Confirmed: 1 = muted, 2 = hidden, 4 = locked.
const ATTR_MUTED: i64 = 1;
const ATTR_HIDDEN: i64 = 2;
const ATTR_LOCKED: i64 = 4;

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("can't read {path}: {source}")]
    Io { path: String, source: std::io::Error },
    #[error("{path} is not valid JSON (CapCut may have encrypted it): {source}")]
    Json { path: String, source: serde_json::Error },
    #[error("not a CapCut draft: {0}")]
    NotADraft(String),
}

pub struct Imported {
    pub project: Project,
    pub report: ImportReport,
}

/// What happened during import: what mapped, what was kept as-is, and what needs a decision.
#[derive(Debug, Default, Serialize)]
pub struct ImportReport {
    pub capcut_version: String,
    pub tracks: usize,
    pub segments: usize,
    /// Material tables mapped to OpenRip types, with counts.
    pub mapped: BTreeMap<String, usize>,
    /// Material tables kept verbatim as `Foreign` (not interpreted yet).
    pub foreign: BTreeMap<String, usize>,
    /// Items from CapCut's online library that OpenRip doesn't ship, by category.
    pub library_items: BTreeMap<String, usize>,
    /// Keyframed properties that aren't mapped yet.
    pub unmapped_keyframes: BTreeMap<String, usize>,
    /// Keyframe curve types seen (to verify easing mapping).
    pub curve_types: BTreeMap<String, usize>,
    /// Raw track `attribute` values seen (meaning not confirmed yet).
    pub track_attributes: BTreeMap<i64, usize>,
    /// Media paths that don't exist on this machine.
    pub missing_media: Vec<String>,
    pub warnings: Vec<String>,
    /// Structural problems found by `Project::validate`.
    pub problems: Vec<String>,
}

fn bump<K: Ord>(map: &mut BTreeMap<K, usize>, key: K) {
    *map.entry(key).or_insert(0) += 1;
}

// ---- tolerant JSON accessors -------------------------------------------------

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}
fn i(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64))).unwrap_or(0)
}
fn f(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(default)
}
fn b(v: &Value, key: &str, default: bool) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(default)
}
fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}
fn time_range(v: &Value) -> Option<TimeRange> {
    let o = v.as_object()?;
    Some(TimeRange::new(
        Micros(o.get("start").and_then(Value::as_i64).unwrap_or(0)),
        Micros(o.get("duration").and_then(Value::as_i64).unwrap_or(0)),
    ))
}
fn rgb_array(v: &Value) -> Option<Rgba> {
    let a = v.as_array()?;
    let c = |k: usize| a.get(k).and_then(Value::as_f64).map(|x| x as f32);
    Some(Rgba { r: c(0)?, g: c(1)?, b: c(2)?, a: c(3).unwrap_or(1.0) })
}

// ---- entry points ------------------------------------------------------------

/// Import a draft folder (containing `draft_info.json`).
pub fn import_draft_dir(dir: &Path) -> Result<Imported, ImportError> {
    let info = ["draft_info.json", "draft_content.json"]
        .iter()
        .map(|n| dir.join(n))
        .find(|p| p.exists())
        .ok_or_else(|| ImportError::NotADraft(format!("{} has no draft_info.json", dir.display())))?;
    let raw = std::fs::read(&info).map_err(|source| ImportError::Io { path: info.display().to_string(), source })?;
    let doc: Value =
        serde_json::from_slice(&raw).map_err(|source| ImportError::Json { path: info.display().to_string(), source })?;
    let name_hint = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let mut imported = import_draft_json(&doc, &name_hint)?;
    // Paths inside the draft folder (stills CapCut made, e.g. freeze frames) start with a
    // placeholder for it.
    for m in &mut imported.project.materials.media {
        if let Some((_, rel)) = m.path.split_once("_##/").filter(|_| m.path.starts_with("##_draftpath_placeholder")) {
            m.path = dir.join(rel).to_string_lossy().into_owned();
        }
    }
    imported.report.missing_media.retain(|p| !p.starts_with("##_draftpath_placeholder") || !p.split_once("_##/").is_some_and(|(_, rel)| dir.join(rel).exists()));
    // A background-removal result is a folder holding a numbered folder with the masks.
    for m in &mut imported.project.materials.media {
        let Some(matte) = &m.matte else { continue };
        let rel = matte.split_once("_##/").map_or(matte.as_str(), |(_, rest)| rest);
        let root = dir.join(rel);
        let found = std::fs::read_dir(&root)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .find(|p| p.join("mask").is_dir())
            .or_else(|| root.join("mask").is_dir().then(|| root.clone()));
        match found {
            Some(p) => m.matte = Some(p.to_string_lossy().into_owned()),
            None => {
                imported.report.warnings.push(format!("background removal of {} not found at {}", m.path, root.display()));
                m.matte = None;
            }
        }
    }
    Ok(imported)
}

/// Import an already-parsed draft document.
pub fn import_draft_json(doc: &Value, name_hint: &str) -> Result<Imported, ImportError> {
    if doc.get("tracks").is_none() || doc.get("materials").is_none() {
        return Err(ImportError::NotADraft("missing tracks/materials".into()));
    }
    let mut report = ImportReport {
        capcut_version: {
            let v = s(doc, "new_version");
            if v.is_empty() { i(doc, "version").to_string() } else { v }
        },
        ..Default::default()
    };

    let cc = doc.get("canvas_config").cloned().unwrap_or(Value::Null);
    let mut canvas = Canvas { width: i(&cc, "width") as u32, height: i(&cc, "height") as u32 };
    if canvas.width == 0 || canvas.height == 0 {
        report.warnings.push("canvas size missing; assuming 1920x1080".into());
        canvas = Canvas { width: 1920, height: 1080 };
    }
    let fps = FrameRate::from_f64(f(doc, "fps", 30.0));
    let name = {
        let n = s(doc, "name");
        if n.is_empty() { name_hint.to_string() } else { n }
    };
    let mut project = Project::new(s(doc, "id"), name, canvas, fps);
    project.imported_from = Some(ImportSource { app: APP.into(), version: report.capcut_version.clone() });

    import_materials(&doc["materials"], &mut project.materials, &mut report);

    // A subtitle template's segment points at the template, which wraps one text (and the
    // text's caption animation): the segment draws that text.
    let templates: BTreeMap<String, (MaterialId, Vec<MaterialId>)> = arr(&doc["materials"], "text_templates")
        .iter()
        .filter_map(|t| {
            let inner = arr(t, "text_info_resources").first()?;
            let refs = arr(inner, "extra_material_refs").iter().filter_map(Value::as_str).map(MaterialId::from).collect();
            Some((s(t, "id"), (MaterialId(s(inner, "text_material_id")), refs)))
        })
        .collect();

    // In CapCut's default "track mode", stacking follows track order (`track_render_index`),
    // not each segment's `render_index`; only "free layer" mode uses per-segment order.
    let free_layers = b(doc, "free_render_index_mode_on", false);
    for (track_pos, t) in arr(doc, "tracks").iter().enumerate() {
        let kind = match s(t, "type").as_str() {
            "video" => TrackKind::Video,
            "audio" => TrackKind::Audio,
            "text" => TrackKind::Text,
            "sticker" => TrackKind::Sticker,
            "effect" => TrackKind::Effect,
            "filter" => TrackKind::Filter,
            "adjust" => TrackKind::Adjustment,
            other => {
                report.warnings.push(format!("skipped track of unknown type {other:?}"));
                continue;
            }
        };
        let attribute = i(t, "attribute");
        bump(&mut report.track_attributes, attribute);
        let mut track = Track {
            id: s(t, "id"),
            kind,
            name: s(t, "name"),
            segments: Vec::new(),
            muted: attribute & ATTR_MUTED != 0,
            hidden: attribute & ATTR_HIDDEN != 0,
            locked: attribute & ATTR_LOCKED != 0,
        };
        for seg in arr(t, "segments") {
            if let Some(mut segment) = import_segment(seg, &mut report) {
                if let Some((text, refs)) = templates.get(&segment.material.0) {
                    segment.material = text.clone();
                    for r in refs {
                        if !segment.attachments.contains(r) {
                            segment.attachments.push(r.clone());
                        }
                    }
                }
                if !free_layers {
                    segment.render_index = seg
                        .get("track_render_index")
                        .and_then(Value::as_i64)
                        .unwrap_or(track_pos as i64) as i32;
                }
                track.segments.push(segment);
            }
        }
        track.segments.sort_by_key(|s| s.target.start);
        report.segments += track.segments.len();
        project.tracks.push(track);
    }
    report.tracks = project.tracks.len();

    for m in &project.materials.media {
        if !m.path.is_empty() && !Path::new(&m.path).exists() {
            report.missing_media.push(m.path.clone());
        }
    }
    report.problems = project.validate();
    Ok(Imported { project, report })
}

// ---- segments ----------------------------------------------------------------

fn import_segment(seg: &Value, report: &mut ImportReport) -> Option<Segment> {
    let Some(target) = seg.get("target_timerange").and_then(time_range) else {
        report.warnings.push(format!("segment {} has no target_timerange; skipped", s(seg, "id")));
        return None;
    };
    let clip = seg.get("clip").filter(|c| c.is_object());
    let mut transform = Transform::default();
    let mut opacity = Animated::constant(1.0f32);
    if let Some(c) = clip {
        let pos = c.get("transform").cloned().unwrap_or(Value::Null);
        let scale = c.get("scale").cloned().unwrap_or(Value::Null);
        let flip = c.get("flip").cloned().unwrap_or(Value::Null);
        transform.position = Animated::constant(Vec2::new(f(&pos, "x", 0.0), f(&pos, "y", 0.0)));
        transform.scale = Animated::constant(Vec2::new(f(&scale, "x", 1.0), f(&scale, "y", 1.0)));
        transform.rotation = Animated::constant(f(c, "rotation", 0.0));
        transform.flip_h = b(&flip, "horizontal", false);
        transform.flip_v = b(&flip, "vertical", false);
        opacity = Animated::constant(f(c, "alpha", 1.0) as f32);
    }
    let mut volume = Animated::constant(f(seg, "volume", 1.0) as f32);

    apply_keyframes(seg, &mut transform, &mut opacity, &mut volume, report);

    Some(Segment {
        id: s(seg, "id"),
        material: MaterialId(s(seg, "material_id")),
        source: seg.get("source_timerange").and_then(time_range),
        target,
        speed: f(seg, "speed", 1.0),
        reverse: b(seg, "reverse", false),
        change_pitch: b(seg, "is_tone_modify", false),
        visible: b(seg, "visible", true),
        render_index: i(seg, "render_index") as i32,
        transform,
        // TODO: map CapCut's per-material crop (corner points on materials.videos[].crop).
        crop: None,
        opacity,
        volume,
        attachments: arr(seg, "extra_material_refs")
            .iter()
            .filter_map(Value::as_str)
            .map(MaterialId::from)
            .collect(),
    })
}

/// CapCut stores keyframes per property (`KFTypePositionX`, …) with times
/// relative to the segment start and a single value each.
fn apply_keyframes(
    seg: &Value,
    transform: &mut Transform,
    opacity: &mut Animated<f32>,
    volume: &mut Animated<f32>,
    report: &mut ImportReport,
) {
    let mut channels: BTreeMap<String, Vec<Keyframe<f64>>> = BTreeMap::new();
    for prop in arr(seg, "common_keyframes") {
        let ty = s(prop, "property_type");
        for k in arr(prop, "keyframe_list") {
            let curve = s(k, "curveType");
            bump(&mut report.curve_types, if curve.is_empty() { "(none)".into() } else { curve.clone() });
            let value = k.get("values").and_then(|v| v.get(0)).and_then(Value::as_f64).unwrap_or(0.0);
            // TODO: map non-linear curve types to Easing::Bezier once CapCut's
            // left/right control-point space is verified against exports.
            channels.entry(ty.clone()).or_default().push(Keyframe {
                at: Micros(i(k, "time_offset")),
                value,
                ease: Easing::Linear,
            });
        }
    }
    let to_anim = |keys: &[Keyframe<f64>], fallback: f64| {
        let mut a = Animated::constant(fallback);
        for k in keys {
            a.set_key(k.clone());
        }
        a
    };
    let mut take = |name: &str| channels.remove(name);
    let (px, py) = (take("KFTypePositionX"), take("KFTypePositionY"));
    if px.is_some() || py.is_some() {
        let base = transform.position.value;
        let ax = to_anim(px.as_deref().unwrap_or(&[]), base.x);
        let ay = to_anim(py.as_deref().unwrap_or(&[]), base.y);
        transform.position = merge_vec2(&ax, &ay);
    }
    let (sx, sy) = (take("KFTypeScaleX"), take("KFTypeScaleY"));
    if sx.is_some() || sy.is_some() {
        let base = transform.scale.value;
        let ax = to_anim(sx.as_deref().unwrap_or(&[]), base.x);
        // CapCut often keyframes uniform scale on X only.
        let ay = match sy.as_deref() {
            Some(k) => to_anim(k, base.y),
            None => ax.clone(),
        };
        transform.scale = merge_vec2(&ax, &ay);
    }
    if let Some(k) = take("KFTypeRotation") {
        transform.rotation = to_anim(&k, transform.rotation.value);
    }
    if let Some(k) = take("KFTypeGlobalAlpha") {
        *opacity = to_f32(&to_anim(&k, opacity.value as f64));
    }
    if let Some(k) = take("KFTypeVolume") {
        *volume = to_f32(&to_anim(&k, volume.value as f64));
    }
    for (name, keys) in channels {
        *report.unmapped_keyframes.entry(name).or_insert(0) += keys.len();
    }
}

fn merge_vec2(x: &Animated<f64>, y: &Animated<f64>) -> Animated<Vec2> {
    let mut times: Vec<Micros> = x.keys.iter().chain(y.keys.iter()).map(|k| k.at).collect();
    times.sort();
    times.dedup();
    let mut out = Animated::constant(Vec2::new(x.value, y.value));
    for t in times {
        out.set_key(Keyframe { at: t, value: Vec2::new(x.sample(t), y.sample(t)), ease: Easing::Linear });
    }
    out
}

fn to_f32(a: &Animated<f64>) -> Animated<f32> {
    Animated {
        value: a.value as f32,
        keys: a.keys.iter().map(|k| Keyframe { at: k.at, value: k.value as f32, ease: k.ease }).collect(),
    }
}

// ---- materials ---------------------------------------------------------------

/// CapCut tables that are AI/cloud features, which OpenRip doesn't support by design.
const AI_TABLES: &[&str] = &[
    "ai_text_effects", "ai_translates", "digital_humans", "digital_human_model_dressing",
    "realtime_denoises", "smart_crops", "smart_relights", "vocal_separations", "vocal_beautifys",
    "video_trackings",
];

/// CapCut "effects" entries that are really its built-in Adjust sliders, with the
/// OpenRip adjustment each maps to. These are standard operations, not library assets.
const ADJUST_TYPES: &[(&str, &str)] = &[
    ("brightness", "brightness"),
    ("contrast", "contrast"),
    ("saturation", "saturation"),
    ("sharpen", "sharpen"),
    ("highlight", "highlights"),
    ("shadow", "shadows"),
    ("temperature", "temperature"),
    ("tone", "tint"),
    ("vignetting", "vignette"),
    ("black", "blacks"),
    ("white", "whites"),
    ("light_sensation", "exposure"),
    ("fade", "fade"),
    ("clear", "clarity"),
];

/// CapCut library animations OpenRip draws itself, by resource id. Their behaviour comes
/// from the scripts CapCut downloads with them (docs/parity/text-animations.md).
const BUILTIN_ANIMATIONS: &[(&str, &str)] = &[
    ("6724920249654710791", "type_1"),
    ("6724920636403094028", "type_2"),
    ("7210980292243231233", "typewriter"),
    // The caption style of CapCut's word-by-word subtitle templates (逐词高亮 and 逐词显色):
    // pages of up to three words, the word being spoken in its colour (yellow if white).
    ("7289356246623195649", "caption_word_color"),
    // The 弹出 ("pop") templates' caption style: one word at a time, nothing else changes.
    ("7135040682032370178", "caption_one_word"),
];

/// CapCut library transitions OpenRip draws itself, by resource id (docs/parity/transitions.md).
const BUILTIN_TRANSITIONS: &[(&str, &str)] = &[("6724845376098013708", "white_flash"), ("6864867302936941064", "blink"), ("7637430135737650452", "white_fade")];

/// Where CapCut wraps a fixed-size text box: this fraction of the canvas width per unit of
/// its `fixed_width`, at the clip's scale 1 (calibration session 5 bounds it to
/// 0.001330–0.001366, draft covers to ≥ 0.001335 and a styled export to < 0.001344).
const CAPCUT_WRAP_PER_UNIT: f32 = 0.00134;

/// A library text style from its bundle's `effectStyle.json` (the declarative kind; see
/// docs/parity/capcut-bundles.md). `None` when the bundle isn't on this machine or is the
/// other kind. Texture paths become absolute paths into the bundle.
fn text_style(bundle: &Path) -> Option<TextEffect> {
    let Some(style) = std::fs::read(bundle.join("effectStyle.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
        return sdf_text_style(bundle);
    };
    let paint = |layer: &Value| -> Option<Paint> {
        let content = layer.get("content")?;
        let kind = match s(content, "render_type").as_str() {
            "texture" => {
                let t = content.get("texture")?;
                let file = s(t, "path");
                if file.is_empty() {
                    return None;
                }
                PaintKind::Texture(TexturePaint {
                    path: bundle.join(file).to_string_lossy().into_owned(),
                    columns: i(t, "range").max(1) as u32,
                    angle_deg: f(t, "angle", 0.0) as f32,
                    scale: f(t, "scale", 1.0) as f32,
                    stretch: match s(t, "stretchMode").as_str() {
                        "fill" => TextureStretch::Fill,
                        "stretch" => TextureStretch::Stretch,
                        _ => TextureStretch::Fit,
                    },
                    alpha: f(t, "alpha", 1.0) as f32,
                })
            }
            // Gradients are drawn with their first colour for now.
            "gradient" => {
                let g = content.get("gradient")?;
                let c = g.get("color")?.get(0)?;
                let ch = |k: usize| c.get(k).and_then(Value::as_f64).unwrap_or(0.0) as f32;
                let a = g.get("alpha").and_then(|a| a.get(0)).and_then(Value::as_f64).unwrap_or(1.0) as f32;
                PaintKind::Solid(Rgba { r: ch(0), g: ch(1), b: ch(2), a })
            }
            _ => {
                let solid = content.get("solid")?;
                let c = solid.get("color")?;
                let ch = |k: usize| c.get(k).and_then(Value::as_f64).unwrap_or(0.0) as f32;
                PaintKind::Solid(Rgba { r: ch(0), g: ch(1), b: ch(2), a: f(solid, "alpha", 1.0) as f32 })
            }
        };
        Some(Paint { alpha: f(layer, "alpha", 1.0) as f32, kind })
    };
    let strokes = |layers: &[Value]| -> Vec<EffectStroke> {
        layers
            .iter()
            .filter(|l| b(l, "enable", true) && f(l, "width", 0.0) > 0.0 && f(l, "alpha", 1.0) > 0.0)
            .filter_map(|l| Some(EffectStroke { width: f(l, "width", 0.0) as f32, paint: paint(l)? }))
            .collect()
    };
    Some(TextEffect {
        fill: style.get("fill").and_then(paint),
        strokes: strokes(arr(&style, "strokes")),
        shadows: arr(&style, "shadows")
            .iter()
            .filter(|sh| b(sh, "enable", true))
            .filter_map(|sh| {
                let strokes = strokes(arr(sh, "strokes"));
                let paint = paint(sh)?;
                (paint.alpha > 0.0 || !strokes.is_empty()).then(|| EffectShadow {
                    paint,
                    distance: f(sh, "distance", 0.0) as f32,
                    angle_deg: f(sh, "angle", 0.0) as f32,
                    blur: f(sh, "diffuse", 0.0) as f32,
                    strokes,
                })
            })
            .collect(),
        sharp_edges: false,
    })
}

/// Names in an SDF text effect's `effect.prefab` (the file stores their hashes).
const SDF_NAMES: &[&str] = &[
    "Prefab", "Entity", "SDFText", "entities", "components", "effectTextParam", "EffectTextParam", "effectLayers", "EffectLayer", "grad",
    "GradientChange", "ColorChange", "color1", "color2", "color3", "percent", "color", "hsbOffset", "alphaOffset", "change", "scale", "angle",
    "smoothing", "offset", "textureLevel", "texture", "innerShadowEnabled",
];

/// An SDF text effect's outline `scale`, in em per unit (fitted against a CapCut export;
/// see docs/parity/capcut-bundles.md).
const SDF_OUTLINE_EM: f32 = 1.5;

/// A library text style of the SDF-effect kind, from the `SDFText` component in its
/// bundle's `effect.prefab`: a stack of layers, the first drawn in front. Each is the
/// glyphs grown by an outline `scale`, in the text's colour shifted in HSB. The first layer
/// becomes the fill, the rest (back to front) shadows. Layer `offset`s and `smoothing` are
/// left out: in CapCut's export they show nothing (no extrusion, no soft shadow or halo
/// past the outlines). Gradients use their first stop; texture overlays and inner shadows
/// are left out (in the measured style they sit under the fill).
fn sdf_text_style(bundle: &Path) -> Option<TextEffect> {
    let roots = amg::decode(&std::fs::read(bundle.join("effect.prefab")).ok()?, SDF_NAMES)?;
    fn find<'a>(v: &'a Value, class: &str) -> Option<&'a Value> {
        match v {
            Value::Object(o) if o.get("@class").and_then(Value::as_str) == Some(class) => Some(v),
            Value::Object(o) => o.values().find_map(|x| find(x, class)),
            Value::Array(a) => a.iter().find_map(|x| find(x, class)),
            _ => None,
        }
    }
    let layers = roots.iter().find_map(|r| find(r, "SDFText"))?.get("effectTextParam")?.get("effectLayers")?.as_array()?;
    let num = |v: &Value, i: usize| v.get(i).and_then(Value::as_f64).unwrap_or(0.0) as f32;
    let paint = |layer: &Value| -> Paint {
        let stop = &layer["grad"]["color1"];
        let hsb = &stop["hsbOffset"];
        let alpha = stop["color"].get(3).and_then(Value::as_f64).unwrap_or(1.0) as f32 + f(stop, "alphaOffset", 0.0) as f32;
        Paint { alpha: alpha.clamp(0.0, 1.0), kind: PaintKind::TextColor { hue: num(hsb, 0), saturation: num(hsb, 1), brightness: num(hsb, 2) } }
    };
    let mut effect = TextEffect { fill: layers.first().map(paint), sharp_edges: true, ..Default::default() };
    for layer in layers.iter().skip(1).rev() {
        let grow = f(&layer["grad"], "scale", 0.0) as f32;
        let paint = paint(layer);
        let hidden = Paint { alpha: 0.0, kind: paint.kind.clone() };
        effect.shadows.push(EffectShadow {
            distance: 0.0,
            angle_deg: 0.0,
            blur: 0.0,
            strokes: if grow > 0.0 { vec![EffectStroke { width: grow * SDF_OUTLINE_EM, paint: paint.clone() }] } else { vec![] },
            paint: if grow > 0.0 { hidden } else { paint },
        });
    }
    Some(effect)
}

fn library_ref(m: &Value) -> LibraryRef {
    let resource = [s(m, "resource_id"), s(m, "effect_id"), s(m, "third_resource_id")]
        .into_iter()
        .find(|x| !x.is_empty())
        .unwrap_or_default();
    LibraryRef { app: APP.into(), resource_id: resource, name: s(m, "name"), category: s(m, "category_name") }
}

fn import_materials(mats: &Value, out: &mut Materials, report: &mut ImportReport) {
    let Some(tables) = mats.as_object() else { return };
    for (table, items) in tables {
        let Some(items) = items.as_array() else { continue };
        for m in items {
            let id = MaterialId(s(m, "id"));
            let mapped = match table.as_str() {
                "videos" => {
                    let kind = if s(m, "type") == "photo" { MediaKind::Photo } else { MediaKind::Video };
                    out.media.push(Media {
                        id,
                        kind,
                        path: s(m, "path"),
                        width: i(m, "width") as u32,
                        height: i(m, "height") as u32,
                        duration: Micros(i(m, "duration")),
                        has_audio: b(m, "has_audio", kind == MediaKind::Video),
                        // Background removal's saved result, in the draft folder
                        // (resolved by `import_draft_dir`).
                        matte: m
                            .get("matting")
                            .filter(|mt| i(mt, "flag") != 0)
                            .map(|mt| s(mt, "path"))
                            .filter(|p| !p.is_empty()),
                    });
                    true
                }
                "audios" => {
                    out.media.push(Media {
                        id,
                        kind: MediaKind::Audio,
                        path: s(m, "path"),
                        width: 0,
                        height: 0,
                        duration: Micros(i(m, "duration")),
                        has_audio: true,
                        matte: None,
                    });
                    true
                }
                "texts" => {
                    out.texts.push(import_text(id, m));
                    true
                }
                "speeds" => {
                    let curve = m
                        .get("curve_speed")
                        .and_then(|c| c.get("speed_points"))
                        .and_then(Value::as_array)
                        .map(|pts| pts.iter().map(|p| (f(p, "x", 0.0), f(p, "y", 1.0))).collect())
                        .unwrap_or_default();
                    out.speeds.push(Speed { id, speed: f(m, "speed", 1.0), curve });
                    true
                }
                "canvases" => {
                    let fill = match s(m, "type").as_str() {
                        "canvas_blur" => CanvasFillKind::Blur { amount: f(m, "blur", 0.0) as f32 },
                        "canvas_image" => CanvasFillKind::Image { path: s(m, "image") },
                        _ => CanvasFillKind::Color { color: Rgba::from_hex(&s(m, "color")).unwrap_or(Rgba::BLACK) },
                    };
                    out.canvas_fills.push(CanvasFill { id, fill });
                    true
                }
                "loudnesses" => {
                    let p = m.get("loudness_param").unwrap_or(&Value::Null);
                    out.loudness.push(Loudness {
                        id,
                        enabled: b(m, "enable", false),
                        target: f(m, "target_loudness", -23.0) as f32,
                        measured: p.get("avg_loudness").and_then(Value::as_f64).map(|v| v as f32),
                        peak: f(p, "peak_loudness", 0.0) as f32,
                    });
                    true
                }
                "audio_fades" => {
                    out.audio_fades.push(AudioFade {
                        id,
                        fade_in: Micros(i(m, "fade_in_duration")),
                        fade_out: Micros(i(m, "fade_out_duration")),
                    });
                    true
                }
                "material_animations" => {
                    let items: Vec<Animation> = arr(m, "animations")
                        .iter()
                        .map(|a| {
                            let library = library_ref(a);
                            Animation {
                                kind: serde_json::from_value(Value::String(s(a, "type"))).unwrap_or(AnimationKind::Other),
                                start: Micros(i(a, "start")),
                                duration: Micros(i(a, "duration")),
                                builtin: BUILTIN_ANIMATIONS.iter().find(|(id, _)| *id == library.resource_id).map(|(_, ours)| ours.to_string()),
                                resource: Some(s(a, "path")).filter(|p| !p.is_empty()),
                                library: Some(library),
                            }
                        })
                        .collect();
                    if !items.is_empty() {
                        bump(&mut report.library_items, "material_animations".to_string());
                    }
                    out.animations.push(Animations { id, items });
                    true
                }
                "transitions" => {
                    let lib = library_ref(m);
                    bump(&mut report.library_items, "transition".to_string());
                    out.transitions.push(Transition {
                        id,
                        name: s(m, "name"),
                        duration: Micros(i(m, "duration")),
                        overlap: b(m, "is_overlap", true),
                        builtin: BUILTIN_TRANSITIONS.iter().find(|(id, _)| *id == lib.resource_id).map(|(_, ours)| ours.to_string()),
                        resource: Some(s(m, "path")).filter(|p| !p.is_empty()),
                        library: Some(lib),
                    });
                    true
                }
                "effects" | "video_effects" => {
                    let ty = s(m, "type");
                    let adjust = ADJUST_TYPES.iter().find(|(capcut, _)| *capcut == ty).map(|(_, ours)| *ours);
                    let category = match (table.as_str(), ty.as_str()) {
                        ("video_effects", _) => EffectCategory::VideoEffect,
                        (_, "filter") => EffectCategory::Filter,
                        _ if adjust.is_some() => EffectCategory::Adjust,
                        _ => EffectCategory::Other,
                    };
                    let mut params = BTreeMap::new();
                    if let Some(v) = m.get("value").and_then(Value::as_f64) {
                        params.insert("intensity".to_string(), v);
                    }
                    for p in arr(m, "adjust_params") {
                        if let Some(v) = p.get("value").and_then(Value::as_f64) {
                            params.insert(s(p, "name"), v);
                        }
                    }
                    let library = (category != EffectCategory::Adjust).then(|| library_ref(m));
                    if library.is_some() {
                        bump(&mut report.library_items, format!("{table}:{ty}"));
                    }
                    out.effects.push(Effect {
                        id,
                        category,
                        name: s(m, "name"),
                        params,
                        builtin: adjust.map(str::to_string),
                        // CapCut's downloaded bundle (for Adjust: its exposure tables).
                        resource: Some(s(m, "path")).filter(|p| !p.is_empty()),
                        library,
                        text_style: (ty == "text_effect").then(|| text_style(Path::new(&s(m, "path")))).flatten().map(Box::new),
                    });
                    true
                }
                "hsl" => {
                    let custom = s(m, "custom_color");
                    out.hsl.push(HslAdjust {
                        id,
                        range: i(m, "hsl_color_type").clamp(0, 255) as u8,
                        custom_color: (!custom.is_empty()).then(|| Rgba::from_hex(&custom)).flatten(),
                        hue: f(m, "hue", 0.0) as f32,
                        saturation: f(m, "saturation", 0.0) as f32,
                        lightness: f(m, "lightness", 0.0) as f32,
                    });
                    true
                }
                "color_curves" => {
                    let channel = |name: &str| -> Vec<CurvePoint> {
                        let pt = |v: Option<&Value>| v.map(|p| (f(p, "x", 0.0), f(p, "y", 0.0))).unwrap_or((0.0, 0.0));
                        arr(m, name)
                            .iter()
                            .map(|c| CurvePoint { anchor: pt(c.get("anchor")), left: pt(c.get("left_control")), right: pt(c.get("right_control")) })
                            .collect()
                    };
                    out.curves.push(ColorCurves {
                        id,
                        luma: channel("luma"),
                        red: channel("red"),
                        green: channel("green"),
                        blue: channel("blue"),
                    });
                    true
                }
                "primary_color_wheels" | "log_color_wheels" => {
                    let wheel = |name: &str| {
                        let w = m.get(name).cloned().unwrap_or(Value::Null);
                        WheelValue {
                            red: f(&w, "red", 0.0),
                            green: f(&w, "green", 0.0),
                            blue: f(&w, "blue", 0.0),
                            luma: f(&w, "luma", 0.0),
                            saturation: f(&w, "saturation", 0.0),
                        }
                    };
                    out.color_wheels.push(ColorWheels {
                        id,
                        log: table == "log_color_wheels",
                        lift: wheel("lift"),
                        gamma: wheel("gamma"),
                        gain: wheel("gain"),
                        offset: wheel("offset"),
                        intensity: f(m, "intensity", 1.0),
                    });
                    true
                }
                _ => false,
            };
            if mapped {
                bump(&mut report.mapped, table.clone());
            } else {
                let label = if AI_TABLES.contains(&table.as_str()) { format!("{table} (AI, unsupported)") } else { table.clone() };
                bump(&mut report.foreign, label);
                if matches!(table.as_str(), "stickers" | "text_templates") {
                    bump(&mut report.library_items, table.clone());
                }
                out.foreign.push(Foreign { id: MaterialId(s(m, "id")), app: APP.into(), kind: table.clone(), raw: m.clone() });
            }
        }
    }
}

/// CapCut text materials embed the rich text as a JSON string in `content`:
/// `{"text": "...", "styles": [{"range": [s, e], "size", "font": {...}, "fill": {...}, "strokes": [...]}]}`.
fn import_text(id: MaterialId, m: &Value) -> Text {
    let content: Value = m
        .get("content")
        .and_then(Value::as_str)
        .and_then(|c| serde_json::from_str(c).ok())
        .unwrap_or(Value::Null);
    let text = if content.is_null() { s(m, "content") } else { s(&content, "text") };
    let solid = |v: &Value| v.pointer("/content/solid/color").and_then(rgb_array);
    let runs = arr(&content, "styles")
        .iter()
        .map(|st| {
            let range = st.get("range").and_then(Value::as_array);
            let r = |k: usize| range.and_then(|a| a.get(k)).and_then(Value::as_u64).unwrap_or(0) as u32;
            let stroke = arr(st, "strokes").first().map(|sk| Stroke {
                color: solid(sk).unwrap_or(Rgba::BLACK),
                width: f(sk, "width", 0.0) as f32,
            });
            TextRun {
                range: (r(0), r(1)),
                font: FontRef {
                    name: s(m, "font_name"),
                    path: st.pointer("/font/path").and_then(Value::as_str).unwrap_or_default().to_string(),
                },
                size: f(st, "size", f(m, "font_size", 15.0)) as f32,
                size_unit: SizeUnit::CapCut,
                fill: st.get("fill").and_then(solid).unwrap_or(Rgba::WHITE),
                stroke,
                bold: b(st, "bold", false),
                italic: b(st, "italic", false),
                underline: b(st, "underline", false),
            }
        })
        .collect();
    // Style 0 is "no background": CapCut keeps a colour and alpha (black, 1.0) even then. It
    // draws one only when `check_flag` has bit 0x10 too (calibration session 3: a style-2 box
    // without the bit isn't drawn; every real text with a background has it).
    let background = (i(m, "background_style") != 0 && i(m, "check_flag") & 0x10 != 0).then(|| {
        let mut color = Rgba::from_hex(&s(m, "background_color")).unwrap_or(Rgba::BLACK);
        color.a = f(m, "background_alpha", 1.0) as f32;
        TextBackground {
            color,
            corner_radius: f(m, "background_round_radius", 0.0) as f32,
            width: f(m, "background_width", 0.14) as f32,
            height: f(m, "background_height", 0.14) as f32,
            style: i(m, "background_style").clamp(0, 255) as u8,
        }
    });
    // The shadow is in the rich text's styles (newer drafts: `has_shadow` can be false then)
    // or in the `shadow_*` fields. Its distance is in hundredths of the font size (a template
    // stores 6 as an offset of 0.06), its smoothing in font sizes; on a caption export a
    // distance of 6 at size 20 moves it 7.8 px at 1080 wide (0.0624 of the size).
    let shadow = match arr(&content, "styles").first().and_then(|st| arr(st, "shadows").first()) {
        Some(sh) => Some(TextShadow {
            color: Rgba { a: f(sh, "alpha", 1.0) as f32, ..solid(sh).unwrap_or(Rgba::BLACK) },
            distance: f(sh, "distance", 0.0) as f32 / 100.0,
            angle_deg: f(sh, "angle", 0.0) as f32,
            smoothing: f(sh, "feather", 0.0) as f32,
        }),
        None => b(m, "has_shadow", false).then(|| {
            let mut color = Rgba::from_hex(&s(m, "shadow_color")).unwrap_or(Rgba::BLACK);
            color.a = f(m, "shadow_alpha", 1.0) as f32;
            TextShadow {
                color,
                distance: f(m, "shadow_distance", 0.0) as f32 / 100.0,
                angle_deg: f(m, "shadow_angle", 0.0) as f32,
                smoothing: f(m, "shadow_smoothing", 0.0) as f32,
            }
        }),
    };
    let words = spoken_words(&text, m.get("words").unwrap_or(&Value::Null));
    Text {
        id,
        text,
        runs,
        words,
        layout: TextLayout {
            alignment: i(m, "alignment") as u8,
            letter_spacing: f(m, "letter_spacing", 0.0) as f32,
            line_spacing: f(m, "line_spacing", 0.0) as f32,
            background,
            shadow,
            // A box with a fixed width wraps at a width proportional to `fixed_width`, scaled
            // with the clip and independent of the font size; an auto-sized box (`fixed_width`
            // -1) doesn't wrap (calibration session 5; docs/parity/text-wrap.md).
            max_width: Some(f(m, "fixed_width", -1.0) as f32).filter(|w| *w > 0.0).map(|w| w * CAPCUT_WRAP_PER_UNIT),
            frame: None,
        },
    }
}

/// The words of a caption's text with when they're spoken, from the speech-to-text words
/// CapCut keeps with it (`words`: parallel `text`, `start_time`, `end_time` arrays in ms,
/// spaces included as words of their own).
///
/// The text may have been edited since it was transcribed. CapCut then matches the text's
/// words to the transcribed ones; what its exports show:
/// - The same number of words (punctuation, capitals or spelling changed): each takes the
///   time of the transcribed word in its place, punctuation included.
/// - Otherwise (a caption split in two keeps every transcribed word, those of the other part
///   at 0 ms or past the clip's end): words that match one transcribed word (case-sensitive,
///   ignoring punctuation) take its time; between matches, as many words as transcribed ones
///   take theirs in order, and any other number of words isn't spoken (it shows, never
///   highlighted, from where the next word starts).
fn spoken_words(text: &str, words: &Value) -> Vec<SpokenWord> {
    let column = |k: &str| arr(words, k).to_vec();
    let (said, starts, ends) = (column("text"), column("start_time"), column("end_time"));
    let heard: Vec<(String, i64, i64)> = said
        .iter()
        .zip(starts.iter().zip(&ends))
        .filter_map(|(t, (s, e))| {
            let t = t.as_str()?.trim();
            let (s, e) = (s.as_i64()?, e.as_i64()?);
            (!t.is_empty()).then(|| (t.to_string(), s * 1000, e.max(s) * 1000))
        })
        .collect();
    // The text's words: runs of non-space characters, by character index.
    let mut tokens: Vec<(u32, u32)> = Vec::new();
    let mut start: Option<u32> = None;
    let mut count = 0u32;
    for (k, c) in text.chars().enumerate() {
        let k = k as u32;
        match (c.is_whitespace(), start) {
            (false, None) => start = Some(k),
            (true, Some(s)) => {
                tokens.push((s, k));
                start = None;
            }
            _ => {}
        }
        count = k + 1;
    }
    if let Some(s) = start {
        tokens.push((s, count));
    }
    if heard.is_empty() || tokens.is_empty() {
        return Vec::new();
    }
    let word = |r: (u32, u32), (s, e): (i64, i64)| SpokenWord { range: r, start: Micros(s), end: Micros(e) };
    if tokens.len() == heard.len() {
        return tokens.iter().zip(&heard).map(|(&r, h)| word(r, (h.1, h.2))).collect();
    }
    // Longest common subsequence of the words without their punctuation, taking the earliest
    // transcribed word where there's a choice.
    let chars: Vec<char> = text.chars().collect();
    let bare = |w: &str| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string();
    let new: Vec<String> = tokens.iter().map(|&(a, b)| bare(&chars[a as usize..b as usize].iter().collect::<String>())).collect();
    let old: Vec<String> = heard.iter().map(|h| bare(&h.0)).collect();
    let (n, m) = (old.len(), new.len());
    let mut lcs = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if old[i] == new[j] && !old[i].is_empty() { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) };
        }
    }
    let mut pairs = Vec::new(); // (old, new) indices that match
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if old[i] == new[j] && !old[i].is_empty() && lcs[i][j] == lcs[i + 1][j + 1] + 1 {
            pairs.push((i, j));
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    pairs.push((n, m));
    let mut out = Vec::with_capacity(m);
    let (mut oi, mut nj) = (0, 0);
    for &(pi, pj) in &pairs {
        if pi - oi == pj - nj {
            for k in 0..pj - nj {
                out.push(word(tokens[nj + k], (heard[oi + k].1, heard[oi + k].2)));
            }
        } else {
            // Not spoken: from the next matched word's start (or the last one's end).
            let at = heard.get(pi).map(|h| h.1).or_else(|| oi.checked_sub(1).map(|k| heard[k].2)).unwrap_or(0);
            out.extend(tokens[nj..pj].iter().map(|&r| word(r, (at, at))));
        }
        if pi < n {
            out.push(word(tokens[pj], (heard[pi].1, heard[pi].2)));
        }
        (oi, nj) = (pi + 1, pj + 1);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_draft() -> Value {
        json!({
            "id": "D1", "name": "Sample", "fps": 29.97, "new_version": "110.0.0",
            "canvas_config": {"width": 1080, "height": 1920, "ratio": "9:16"},
            "materials": {
                "videos": [{"id": "V1", "type": "video", "path": "/nope/a.mp4", "width": 3840, "height": 2160, "duration": 5_000_000, "has_audio": true}],
                "texts": [{"id": "T1", "font_name": "Inter", "alignment": 1, "has_shadow": true, "shadow_color": "#000000", "shadow_alpha": 0.5,
                    "content": "{\"text\":\"Hello\",\"styles\":[{\"range\":[0,5],\"size\":15,\"fill\":{\"content\":{\"render_type\":\"solid\",\"solid\":{\"color\":[1,0,0]}}},\"strokes\":[{\"content\":{\"solid\":{\"color\":[0,0,0]}},\"width\":0.08}]}]}"}],
                "speeds": [{"id": "S1", "type": "speed", "mode": 0, "speed": 2.0}],
                "effects": [{"id": "E1", "type": "brightness", "value": 0.2}, {"id": "E2", "type": "text_effect", "name": "Glow", "resource_id": "R9"}],
                "canvases": [{"id": "C1", "type": "canvas_color", "color": "#ff0000"}],
                "audio_fades": [{"id": "F1", "fade_in_duration": 500_000, "fade_out_duration": 250_000}],
                "stickers": [{"id": "K1", "name": "star"}],
                "vocal_separations": [{"id": "X1"}]
            },
            "tracks": [
                {"id": "TR1", "type": "video", "attribute": 0, "segments": [{
                    "id": "SEG1", "material_id": "V1", "speed": 2.0, "volume": 0.5, "visible": true, "render_index": 0,
                    "source_timerange": {"start": 1_000_000, "duration": 4_000_000},
                    "target_timerange": {"start": 0, "duration": 2_000_000},
                    "clip": {"alpha": 0.8, "rotation": 15.0, "scale": {"x": 1.2, "y": 1.2}, "transform": {"x": 0.25, "y": -0.5}, "flip": {"horizontal": true, "vertical": false}},
                    "extra_material_refs": ["S1", "C1", "F1"],
                    "common_keyframes": [
                        {"property_type": "KFTypeGlobalAlpha", "keyframe_list": [
                            {"time_offset": 0, "values": [0.0], "curveType": "Line"},
                            {"time_offset": 1_000_000, "values": [1.0], "curveType": "Line"}]},
                        {"property_type": "KFTypePositionX", "keyframe_list": [
                            {"time_offset": 0, "values": [-1.0], "curveType": "Line"},
                            {"time_offset": 2_000_000, "values": [1.0], "curveType": "Line"}]},
                        {"property_type": "KFTypeSaturation", "keyframe_list": [{"time_offset": 0, "values": [0.3]}]}
                    ]
                }]},
                {"id": "TR2", "type": "text", "attribute": 0, "segments": [{
                    "id": "SEG2", "material_id": "T1", "visible": true, "render_index": 1,
                    "source_timerange": null, "target_timerange": {"start": 500_000, "duration": 1_000_000}
                }]}
            ]
        })
    }

    #[test]
    fn imports_structure_transform_and_keyframes() {
        let Imported { project, report } = import_draft_json(&sample_draft(), "hint").unwrap();
        assert_eq!(project.name, "Sample");
        assert_eq!(project.fps, FrameRate::new(30000, 1001));
        assert_eq!(project.canvas, Canvas { width: 1080, height: 1920 });
        assert_eq!(report.tracks, 2);
        assert_eq!(report.segments, 2);

        let seg = &project.tracks[0].segments[0];
        assert_eq!(seg.source, Some(TimeRange::new(Micros(1_000_000), Micros(4_000_000))));
        assert_eq!(seg.speed, 2.0);
        assert_eq!(seg.volume.value, 0.5);
        assert!(seg.transform.flip_h && !seg.transform.flip_v);
        assert_eq!(seg.transform.rotation.value, 15.0);
        // Keyframes override the static values and sample linearly.
        assert_eq!(seg.opacity.sample(Micros(500_000)), 0.5);
        let p = seg.transform.position.sample(Micros(1_000_000));
        assert!((p.x - 0.0).abs() < 1e-9 && (p.y + 0.5).abs() < 1e-9);
        assert_eq!(report.unmapped_keyframes.get("KFTypeSaturation"), Some(&1));
        assert_eq!(seg.attachments.len(), 3);

        // Text styling
        let text = &project.materials.texts[0];
        assert_eq!(text.text, "Hello");
        assert_eq!(text.runs[0].range, (0, 5));
        assert_eq!(text.runs[0].fill, Rgba { r: 1.0, g: 0.0, b: 0.0, a: 1.0 });
        assert!(text.runs[0].stroke.is_some());
        assert_eq!(text.layout.shadow.unwrap().color.a, 0.5);
        assert_eq!(project.tracks[1].segments[0].source, None);

        // Unsupported tables are kept and reported; AI tables are labelled.
        assert_eq!(report.foreign.get("stickers"), Some(&1));
        assert_eq!(report.foreign.get("vocal_separations (AI, unsupported)"), Some(&1));
        assert_eq!(report.missing_media, vec!["/nope/a.mp4".to_string()]);

        // Built-in adjust sliders map to OpenRip adjustments; text effects are library items.
        let e1 = project.materials.effects.iter().find(|e| e.id.0 == "E1").unwrap();
        assert_eq!((e1.category, e1.builtin.as_deref(), e1.library.is_none()), (EffectCategory::Adjust, Some("brightness"), true));
        assert_eq!(report.library_items.get("effects:text_effect"), Some(&1));
        assert_eq!(report.library_items.get("effects:brightness"), None);
        assert!(report.problems.is_empty(), "{:?}", report.problems);
    }

    #[test]
    fn decodes_track_flags_and_track_mode_stacking() {
        let mut d = sample_draft();
        d["render_index_track_mode_on"] = json!(true);
        d["tracks"][0]["attribute"] = json!(2 | 4);
        d["tracks"][0]["segments"][0]["render_index"] = json!(99);
        d["tracks"][0]["segments"][0]["track_render_index"] = json!(0);
        d["tracks"][1]["attribute"] = json!(1);
        let Imported { project, .. } = import_draft_json(&d, "x").unwrap();
        let (a, b) = (&project.tracks[0], &project.tracks[1]);
        assert!(!a.muted && a.hidden && a.locked);
        assert!(b.muted && !b.hidden && !b.locked);
        // Track mode: stacking comes from track order, not the segment's own render_index.
        assert_eq!(a.segments[0].render_index, 0);
        assert_eq!(b.segments[0].render_index, 1);
    }

    #[test]
    fn project_round_trips_through_json() {
        let Imported { project, .. } = import_draft_json(&sample_draft(), "hint").unwrap();
        let json = serde_json::to_string(&project).unwrap();
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(project, back);
    }

    #[test]
    fn reads_a_library_text_style_from_its_bundle() {
        let dir = std::env::temp_dir().join(format!("openrip-style-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let tex = |path: &str, range: u32, scale: f64| json!({"render_type": "texture", "texture": {"path": path, "range": range, "scale": scale, "angle": 90.0, "alpha": 1.0, "stretchMode": "fit"}});
        let style = json!({
            "fill": {"alpha": 1.0, "content": tex("ink.png", 2, 1.0)},
            // Zero-width strokes are placeholders and draw nothing.
            "strokes": [{"alpha": 0.0, "width": 0.0, "content": {"render_type": "solid", "solid": {"color": [0, 0, 0]}}}],
            "shadows": [
                {"enable": true, "alpha": 0.0, "angle": -45.0, "distance": 0.0, "diffuse": 0.0, "content": {"render_type": "solid", "solid": {"color": [1, 0, 0]}}, "strokes": []},
                {"enable": true, "alpha": 0.0, "angle": -45.0, "distance": 0.0, "diffuse": 0.17, "content": {"render_type": "solid", "solid": {"color": [1, 0, 0]}},
                 "strokes": [{"enable": true, "alpha": 1.0, "width": 0.4, "content": tex("paper.png", 4, 0.44)}]}
            ]
        });
        std::fs::write(dir.join("effectStyle.json"), style.to_string()).unwrap();
        let fx = text_style(&dir).unwrap();
        let PaintKind::Texture(fill) = &fx.fill.as_ref().unwrap().kind else { panic!("fill is a texture") };
        assert_eq!((fill.columns, fill.path.clone()), (2, dir.join("ink.png").to_string_lossy().into_owned()));
        assert!(fx.strokes.is_empty());
        // The invisible shadow with no strokes is dropped; the one carrying paper is kept.
        assert_eq!(fx.shadows.len(), 1);
        let paper = &fx.shadows[0].strokes[0];
        assert_eq!(paper.width, 0.4);
        assert!(matches!(&paper.paint.kind, PaintKind::Texture(t) if t.columns == 4 && (t.scale - 0.44).abs() < 1e-6));
        assert!(text_style(&dir.join("missing")).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn imports_text_intros_and_wrap_width() {
        let mut d = sample_draft();
        d["materials"]["texts"][0]["fixed_width"] = json!(600.0);
        d["materials"]["material_animations"] = json!([{"id": "A1", "type": "sticker_animation", "animations": [
            {"type": "in", "name": "Type 2", "resource_id": "6724920636403094028", "start": 0, "duration": 1_333_333, "path": "/cache/x"},
            {"type": "out", "name": "Other", "resource_id": "1", "start": 2_000_000, "duration": 500_000, "path": ""}]}]);
        let Imported { project, .. } = import_draft_json(&d, "hint").unwrap();
        // A 600-wide box wraps at 0.804 of the canvas width (at the clip's scale 1).
        assert!((project.materials.texts[0].layout.max_width.unwrap() - 0.804).abs() < 1e-6);
        let a = &project.materials.animations[0].items;
        assert_eq!((a[0].kind.clone(), a[0].builtin.as_deref(), a[0].duration, a[0].resource.as_deref()), (AnimationKind::In, Some("type_2"), Micros(1_333_333), Some("/cache/x")));
        assert_eq!((a[1].kind.clone(), a[1].builtin.as_deref(), a[1].resource.as_deref()), (AnimationKind::Out, None, None));
        // An auto-sized box doesn't wrap.
        d["materials"]["texts"][0]["fixed_width"] = json!(-1.0);
        assert_eq!(import_draft_json(&d, "hint").unwrap().project.materials.texts[0].layout.max_width, None);
        // A background is drawn only with check_flag bit 0x10.
        d["materials"]["texts"][0]["background_style"] = json!(2);
        d["materials"]["texts"][0]["check_flag"] = json!(7);
        assert!(import_draft_json(&d, "hint").unwrap().project.materials.texts[0].layout.background.is_none());
        d["materials"]["texts"][0]["check_flag"] = json!(23);
        assert!(import_draft_json(&d, "hint").unwrap().project.materials.texts[0].layout.background.is_some());
    }

    /// `words` as CapCut stores them: parallel arrays, spaces as words of their own.
    fn heard(words: &[(&str, i64, i64)]) -> Value {
        let mut out = (Vec::new(), Vec::new(), Vec::new());
        for (k, &(t, s, e)) in words.iter().enumerate() {
            if k > 0 {
                out.0.push(" ");
                out.1.push(s);
                out.2.push(s);
            }
            out.0.push(t);
            out.1.push(s);
            out.2.push(e);
        }
        json!({"text": out.0, "start_time": out.1, "end_time": out.2})
    }

    fn timing(text: &str, words: &[SpokenWord]) -> Vec<(String, i64, i64)> {
        let chars: Vec<char> = text.chars().collect();
        words.iter().map(|w| (chars[w.range.0 as usize..w.range.1 as usize].iter().collect(), w.start.0 / 1000, w.end.0 / 1000)).collect()
    }

    #[test]
    fn edited_captions_keep_the_spoken_timing() {
        let said = heard(&[("red", 0, 300), ("green", 400, 700), ("blu", 700, 900)]);
        // Same number of words: by position, punctuation and all.
        let t = "Red green, blue!";
        assert_eq!(timing(t, &spoken_words(t, &said)), [("Red".into(), 0, 300), ("green,".into(), 400, 700), ("blue!".into(), 700, 900)]);
        // A split caption keeps every word; the other part's are at 0 ms. A word that doesn't
        // match one of the same count isn't spoken: it shows from the next word's start.
        let said = heard(&[("one", 0, 0), ("two", 0, 0), ("three", 300, 600), ("four", 600, 900), ("five", 900, 1200)]);
        let t = "Three four five.";
        assert_eq!(timing(t, &spoken_words(t, &said)), [("Three".into(), 600, 600), ("four".into(), 600, 900), ("five.".into(), 900, 1200)]);
        let said = heard(&[("one", 0, 300), ("two", 300, 600), ("three", 900, 1200), ("four", 1200, 1500)]);
        let t = "One two.";
        assert_eq!(timing(t, &spoken_words(t, &said)), [("One".into(), 0, 300), ("two.".into(), 300, 600)]);
    }

    #[test]
    fn a_subtitle_template_segment_draws_its_text_with_the_caption_style() {
        let mut d = sample_draft();
        d["materials"]["texts"][0]["words"] = heard(&[("hi", 0, 500)]);
        d["materials"]["material_animations"] = json!([{"id": "A1", "animations": [{"type": "caption", "resource_id": "7289356246623195649", "start": 0, "duration": 1_000_000}]}]);
        d["materials"]["text_templates"] = json!([{"id": "TT", "text_info_resources": [{"text_material_id": "T1", "extra_material_refs": ["A1"]}]}]);
        d["tracks"][1]["segments"][0]["material_id"] = json!("TT");
        let Imported { project, .. } = import_draft_json(&d, "hint").unwrap();
        let seg = &project.tracks[1].segments[0];
        assert_eq!((seg.material.0.as_str(), seg.attachments.contains(&MaterialId::from("A1"))), ("T1", true));
        assert_eq!(project.materials.animations[0].items[0].builtin.as_deref(), Some("caption_word_color"));
        assert_eq!(project.materials.texts[0].words.len(), 1);
    }

    #[test]
    fn keeps_a_background_removal_only_when_it_is_on() {
        let mut d = sample_draft();
        d["materials"]["videos"][0]["matting"] = json!({"flag": 3, "path": "##_draftpath_placeholder_X_##/matting/abc"});
        let Imported { project, .. } = import_draft_json(&d, "hint").unwrap();
        assert_eq!(project.materials.media[0].matte.as_deref(), Some("##_draftpath_placeholder_X_##/matting/abc"));
        d["materials"]["videos"][0]["matting"]["flag"] = json!(0);
        assert_eq!(import_draft_json(&d, "hint").unwrap().project.materials.media[0].matte, None);
    }

    #[test]
    fn rejects_non_drafts() {
        assert!(matches!(import_draft_json(&json!({"hello": 1}), "x"), Err(ImportError::NotADraft(_))));
    }
}
