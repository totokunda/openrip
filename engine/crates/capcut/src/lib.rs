//! Import CapCut Desktop drafts (`draft_info.json`) into the OpenRip model.
//!
//! The reader is deliberately tolerant: CapCut's schema changes between releases,
//! so every field is optional with a sensible default, unknown tables are kept as
//! `Foreign` materials, and everything that couldn't be mapped is counted in the
//! [`ImportReport`]. Nothing is ever written back to CapCut's data folder.

use std::collections::BTreeMap;
use std::path::Path;

use openrip_model::*;
use serde::Serialize;
use serde_json::Value;

const APP: &str = "capcut";

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
    import_draft_json(&doc, &name_hint)
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

    for t in arr(doc, "tracks") {
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
        bump(&mut report.track_attributes, i(t, "attribute"));
        let mut track = Track {
            id: s(t, "id"),
            kind,
            name: s(t, "name"),
            segments: Vec::new(),
            // TODO: decode `attribute` (mute/hide/lock bits) once verified against CapCut.
            muted: false,
            hidden: false,
            locked: false,
        };
        for seg in arr(t, "segments") {
            if let Some(segment) = import_segment(seg, &mut report) {
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
                "audio_fades" => {
                    out.audio_fades.push(AudioFade {
                        id,
                        fade_in: Micros(i(m, "fade_in_duration")),
                        fade_out: Micros(i(m, "fade_out_duration")),
                    });
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
                        builtin: None,
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
                        resource: None,
                        library,
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
                if matches!(table.as_str(), "stickers" | "text_templates" | "material_animations") {
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
    let background = (i(m, "background_style") != 0 || f(m, "background_alpha", 0.0) > 0.0).then(|| {
        let mut color = Rgba::from_hex(&s(m, "background_color")).unwrap_or(Rgba::BLACK);
        color.a = f(m, "background_alpha", 1.0) as f32;
        TextBackground { color, corner_radius: f(m, "background_round_radius", 0.0) as f32 }
    });
    let shadow = b(m, "has_shadow", false).then(|| {
        let mut color = Rgba::from_hex(&s(m, "shadow_color")).unwrap_or(Rgba::BLACK);
        color.a = f(m, "shadow_alpha", 1.0) as f32;
        TextShadow {
            color,
            distance: f(m, "shadow_distance", 0.0) as f32,
            angle_deg: f(m, "shadow_angle", 0.0) as f32,
            smoothing: f(m, "shadow_smoothing", 0.0) as f32,
        }
    });
    Text {
        id,
        text,
        runs,
        layout: TextLayout {
            alignment: i(m, "alignment") as u8,
            letter_spacing: f(m, "letter_spacing", 0.0) as f32,
            line_spacing: f(m, "line_spacing", 0.0) as f32,
            background,
            shadow,
        },
    }
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
    fn project_round_trips_through_json() {
        let Imported { project, .. } = import_draft_json(&sample_draft(), "hint").unwrap();
        let json = serde_json::to_string(&project).unwrap();
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(project, back);
    }

    #[test]
    fn rejects_non_drafts() {
        assert!(matches!(import_draft_json(&json!({"hello": 1}), "x"), Err(ImportError::NotADraft(_))));
    }
}
