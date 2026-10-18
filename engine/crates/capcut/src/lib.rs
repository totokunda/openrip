//! Import CapCut Desktop drafts (`draft_info.json`) into the OpenRip model.
//!
//! The reader is deliberately tolerant: CapCut's schema changes between releases,
//! so every field is optional with a sensible default, unknown tables are kept as
//! `Foreign` materials, and everything that couldn't be mapped is counted in the
//! [`ImportReport`]. Nothing is ever written back to CapCut's data folder.

use std::collections::BTreeMap;
use std::path::Path;

pub mod amg;
mod keyframes;

use openrip_model::*;
use openrip_platform::assets;
use serde::Serialize;
use serde_json::Value;

const APP: &str = "capcut";

// Track `attribute` bits, from the calibration session (docs/parity/calibration.md).
// Confirmed: 1 = muted, 2 = hidden, 4 = locked.
const ATTR_MUTED: i64 = 1;
const ATTR_HIDDEN: i64 = 2;
const ATTR_LOCKED: i64 = 4;

/// How close to a frame's start CapCut's frame lookup snaps to it (its frame-time helper):
/// a time truncated to the µs just before a frame finds that frame.
const FRAME_SNAP: Micros = Micros(800);

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
    /// Transitions and clip animations the engine doesn't draw (only CapCut does), by kind,
    /// name and resource id.
    pub unmapped_library: BTreeMap<String, usize>,
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
        .find(|p| assets::exists(p))
        .ok_or_else(|| ImportError::NotADraft(format!("{} has no draft_info.json", dir.display())))?;
    let raw = assets::read(&info).map_err(|source| ImportError::Io { path: info.display().to_string(), source })?;
    let doc: Value =
        serde_json::from_slice(&raw).map_err(|source| ImportError::Json { path: info.display().to_string(), source })?;
    let name_hint = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let mut imported = import_draft_json(&doc, &name_hint)?;
    // Paths inside the draft folder (stills CapCut made, e.g. freeze frames, and reversed
    // copies) start with a placeholder for it.
    let in_draft = |path: &mut String| {
        if let Some((_, rel)) = path.split_once("_##/").filter(|_| path.starts_with("##_draftpath_placeholder")) {
            *path = dir.join(rel).to_string_lossy().into_owned();
        }
    };
    for m in &mut imported.project.materials.media {
        in_draft(&mut m.path);
        m.reverse_path.iter_mut().for_each(in_draft);
        m.freeze.iter_mut().for_each(|fr| in_draft(&mut fr.video));
    }
    imported.report.missing_media.retain(|p| !p.starts_with("##_draftpath_placeholder") || !p.split_once("_##/").is_some_and(|(_, rel)| assets::exists(&dir.join(rel))));
    // A background-removal result is a folder holding a numbered folder with the masks.
    for m in &mut imported.project.materials.media {
        let Some(matte) = &m.matte else { continue };
        let rel = matte.split_once("_##/").map_or(matte.as_str(), |(_, rest)| rest);
        let root = dir.join(rel);
        let found = assets::list(&root)
            .ok()
            .into_iter()
            .flatten()
            .find(|p| assets::is_dir(&p.join("mask")))
            .or_else(|| assets::is_dir(&root.join("mask")).then(|| root.clone()));
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
                keyframes::apply(seg, &mut segment, kind, &mut project.materials, &mut report);
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
        if !m.path.is_empty() && !assets::exists(Path::new(&m.path)) {
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
    let volume = Animated::constant(f(seg, "volume", 1.0) as f32);

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
        keyframes: Vec::new(),
    })
}

/// A track kind's name, for the report.
fn kind_label(kind: TrackKind) -> &'static str {
    match kind {
        TrackKind::Video => "video",
        TrackKind::Audio => "audio",
        TrackKind::Text => "text",
        TrackKind::Sticker => "sticker",
        TrackKind::Effect => "effect",
        TrackKind::Filter => "filter",
        TrackKind::Adjustment => "adjustment",
        TrackKind::Graphic => "graphic",
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
    // Video Fade Out (its `Transform.lua`: opacity 1 → 0, linear; docs/parity/clip-animations.md).
    ("6798320902548230669", "fade_out"),
];

/// CapCut animations by their English name and kind, for those whose resource ids aren't
/// known here: the built-in that does the same.
const NAMED_ANIMATIONS: &[(&str, AnimationKind, &str)] = &[("Fade In", AnimationKind::In, "fade_in"), ("Fade Out", AnimationKind::Out, "fade_out")];

/// CapCut library transitions OpenRip draws itself, by resource id (docs/parity/transitions.md).
const BUILTIN_TRANSITIONS: &[(&str, &str)] = &[
    ("6724845376098013708", "white_flash"),
    ("6864867302936941064", "blink"),
    ("7637430135737650452", "white_fade"),
    // Its bundle's VerticalZoomNear shader.
    ("6724226861666144779", "pull_in"),
    // A local draft names it; the bundle isn't on this machine.
    ("6724239388189921806", "black_fade"),
];

/// CapCut transitions by their English name, for those whose resource ids aren't known here.
const NAMED_TRANSITIONS: &[(&str, &str)] = &[("Mix", "mix"), ("Black Fade", "black_fade"), ("Pull in", "pull_in"), ("Pull out", "pull_out")];

/// Where CapCut wraps a fixed-size text box: this fraction of the canvas width per unit of
/// its `fixed_width`, at the clip's scale 1 (calibration session 5 bounds it to
/// 0.001330–0.001366, draft covers to ≥ 0.001335 and a styled export to < 0.001344).
const CAPCUT_WRAP_PER_UNIT: f32 = 0.00134;

/// A library text style from its bundle's `effectStyle.json` (the declarative kind; see
/// docs/parity/capcut-bundles.md). `None` when the bundle isn't on this machine or is the
/// other kind. Texture paths become absolute paths into the bundle.
fn text_style(bundle: &Path) -> Option<TextEffect> {
    let Some(style) = assets::read(&bundle.join("effectStyle.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
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
    let roots = amg::decode(&assets::read(&bundle.join("effect.prefab")).ok()?, SDF_NAMES)?;
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

/// A sticker from its bundle (`artistEffect/<id>/<hash>/`): the GIF its `config.json` names
/// (`"format": "gif"`), else the image its `infoSticker.lua` loads (`singleImage.png`), with
/// one frame's size from `heycanInfo.json`. `None` when the bundle isn't on this machine.
fn sticker_file(bundle: &Path) -> Option<(String, bool, u32, u32)> {
    let read = |name: &str| assets::read(&bundle.join(name)).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    let link = read("config.json").and_then(|c| c.pointer("/effect/Link/0").cloned()).unwrap_or(Value::Null);
    let animated = s(&link, "format") == "gif";
    let file = if animated {
        Some(s(&link, "path")).filter(|p| !p.is_empty()).unwrap_or_else(|| "final.gif".into())
    } else {
        // The script's `source = "…"`.
        assets::read_to_string(&bundle.join("infoSticker.lua"))
            .ok()
            .and_then(|lua| lua.split("source").nth(1).and_then(|rest| rest.split('"').nth(1)).map(str::to_string))
            .unwrap_or_else(|| "singleImage.png".into())
    };
    let path = bundle.join(&file);
    if !assets::is_file(&path) {
        return None;
    }
    let info = read("heycanInfo.json").unwrap_or(Value::Null);
    Some((path.to_string_lossy().into_owned(), animated, i(&info, "singleWidth").max(0) as u32, i(&info, "singleHeight").max(0) as u32))
}

/// The shape picture of a mask bundle that draws one (CapCut's heart and star; the heart's
/// effect is `lumi_heart_mask`): `amazingfeature/image/mask.png`, read by an effect whose
/// mask shader decodes it as a distance field (its `/ 701.0`). `None` when the bundle isn't
/// on this machine or draws its shape otherwise.
fn mask_picture(bundle: &Path) -> Option<String> {
    let feature = bundle.join("amazingfeature");
    let picture = feature.join("image").join("mask.png");
    if !assets::is_file(&picture) {
        return None;
    }
    let decodes = |effect: &Path| assets::read_to_string(&effect.join("xshader").join("mask.frag")).is_ok_and(|frag| frag.contains("701.0"));
    assets::list(&feature.join("effects")).ok()?.iter().any(|e| decodes(e)).then(|| picture.to_string_lossy().into_owned())
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
    // Freeze frames and the video materials they were taken from.
    let mut freeze_sources: Vec<(MaterialId, MaterialId)> = Vec::new();
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
                        // The copy CapCut rendered backward when the clip was reversed (in the
                        // draft folder, resolved by `import_draft_dir`).
                        reverse_path: Some(s(m, "reverse_path")).filter(|p| !p.is_empty()),
                        // A freeze frame's still: what it's a still of (its video's path is
                        // resolved below, once every video is read).
                        // CapCut's `timestamp` is where the clip was split, truncated to the µs;
                        // the still is the frame starting there, which CapCut finds by snapping
                        // to a frame's start within 0.8 ms (its file is named for that start).
                        freeze: m.get("freeze").filter(|fr| fr.is_object()).map(|fr| Freeze { video: s(fr, "source_material_path"), at: Micros(i(fr, "timestamp") + FRAME_SNAP.0) }),
                    });
                    if let Some(source) = m.get("freeze").map(|fr| s(fr, "source_material_id")).filter(|id| !id.is_empty()) {
                        freeze_sources.push((MaterialId(s(m, "id")), MaterialId(source)));
                    }
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
                        reverse_path: None,
                        freeze: None,
                    });
                    true
                }
                "texts" => {
                    out.texts.push(import_text(id, m));
                    true
                }
                "speeds" => {
                    // A curve counts in curve mode (`mode` 1); a normal speed may keep the last
                    // curve it had.
                    let curved = i(m, "mode") == 1;
                    let cs = m.get("curve_speed").filter(|c| c.is_object() && curved);
                    let curve = cs
                        .and_then(|c| c.get("speed_points"))
                        .and_then(Value::as_array)
                        .map(|pts| pts.iter().map(|p| (f(p, "x", 0.0), f(p, "y", 1.0))).collect())
                        .unwrap_or_default();
                    let preset = cs.map(|c| s(c, "name")).filter(|n| !n.is_empty());
                    out.speeds.push(Speed { id, speed: f(m, "speed", 1.0), curve, preset });
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
                            // A video's combo is CapCut's "group".
                            let kind = match s(a, "type").as_str() {
                                "group" => AnimationKind::Combo,
                                ty => serde_json::from_value(Value::String(ty.to_string())).unwrap_or(AnimationKind::Other),
                            };
                            let builtin = BUILTIN_ANIMATIONS
                                .iter()
                                .find(|(id, _)| *id == library.resource_id)
                                .map(|(_, ours)| *ours)
                                .or_else(|| NAMED_ANIMATIONS.iter().find(|(name, k, _)| *name == library.name && *k == kind).map(|(.., ours)| *ours));
                            if builtin.is_none() && kind != AnimationKind::Caption {
                                bump(&mut report.unmapped_library, format!("animation: {} ({})", library.name, library.resource_id));
                            }
                            Animation {
                                kind,
                                start: Micros(i(a, "start")),
                                duration: Micros(i(a, "duration")),
                                builtin: builtin.map(str::to_string),
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
                // Video masks: the shape's centre, size and rotation in the clip's picture.
                "common_mask" => {
                    let c = m.get("config").unwrap_or(&Value::Null);
                    // By its type or name, else by the shape's bundle (the folder in CapCut's
                    // effect cache: …/effect/1068046517/… is the circle).
                    let path = s(m, "path");
                    let bundle = path.split("/effect/").nth(1).and_then(|rest| rest.split('/').next()).unwrap_or_default();
                    let ty = s(m, "resource_type");
                    let name = s(m, "name").to_lowercase();
                    let is = |names: &[&str], id: &str| names.contains(&ty.as_str()) || names.contains(&name.as_str()) || bundle == id;
                    let shape = if is(&["rectangle"], "1068046516") {
                        MaskShape::Rectangle { round_corner: f(c, "roundCorner", 0.0) as f32 }
                    } else if is(&["circle"], "1068046517") {
                        MaskShape::Circle
                    } else if is(&["linear", "line"], "1068046514") {
                        MaskShape::Linear
                    } else if is(&["mirror"], "1068046513") {
                        MaskShape::Mirror
                    } else if let Some(picture) = mask_picture(Path::new(&path)) {
                        // The heart and the star (`pentagram`): a distance field in the bundle.
                        MaskShape::Picture { name: if ty.is_empty() { name.clone() } else { ty.clone() }, path: picture }
                    } else {
                        MaskShape::Other { name: ty }
                    };
                    bump(&mut report.library_items, "mask".to_string());
                    out.masks.push(Mask {
                        id,
                        shape,
                        center: [f(c, "centerX", 0.0) as f32, f(c, "centerY", 0.0) as f32],
                        size: [f(c, "width", 1.0) as f32, f(c, "height", 1.0) as f32],
                        rotation: f(c, "rotation", 0.0) as f32,
                        feather: f(c, "feather", 0.0) as f32,
                        invert: b(c, "invert", false),
                        inside: MaskPaint::Clip,
                        outside: MaskPaint::clear(),
                        keys: Vec::new(),
                        library: Some(library_ref(m)),
                    });
                    true
                }
                "transitions" => {
                    let lib = library_ref(m);
                    bump(&mut report.library_items, "transition".to_string());
                    let builtin = BUILTIN_TRANSITIONS
                        .iter()
                        .find(|(id, _)| *id == lib.resource_id)
                        .or_else(|| NAMED_TRANSITIONS.iter().find(|(name, _)| *name == lib.name))
                        .map(|(_, ours)| ours.to_string());
                    if builtin.is_none() {
                        bump(&mut report.unmapped_library, format!("transition: {} ({})", lib.name, lib.resource_id));
                    }
                    out.transitions.push(Transition {
                        id,
                        name: s(m, "name"),
                        duration: Micros(i(m, "duration")),
                        overlap: b(m, "is_overlap", true),
                        builtin,
                        resource: Some(s(m, "path")).filter(|p| !p.is_empty()),
                        library: Some(lib),
                    });
                    true
                }
                "effects" | "video_effects" | "audio_effects" => {
                    let ty = s(m, "type");
                    let adjust = ADJUST_TYPES.iter().find(|(capcut, _)| *capcut == ty).map(|(_, ours)| *ours);
                    let category = match (table.as_str(), ty.as_str()) {
                        ("video_effects", _) => EffectCategory::VideoEffect,
                        ("audio_effects", _) => EffectCategory::Audio,
                        (_, "filter") => EffectCategory::Filter,
                        _ if adjust.is_some() => EffectCategory::Adjust,
                        _ => EffectCategory::Other,
                    };
                    let mut params = BTreeMap::new();
                    if let Some(v) = m.get("value").and_then(Value::as_f64) {
                        params.insert("intensity".to_string(), v);
                    }
                    // A voice filter's sliders, by name (the bundle maps them onto its processors).
                    for p in arr(m, "adjust_params").iter().chain(arr(m, "audio_adjust_params")) {
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
                // Library stickers: the image or GIF in the bundle the material points at.
                "stickers" => {
                    let (path, animated, width, height) = sticker_file(Path::new(&s(m, "path"))).unwrap_or_default();
                    if path.is_empty() {
                        report.warnings.push(format!("sticker {:?} not found in CapCut's cache", s(m, "name")));
                    }
                    bump(&mut report.library_items, "stickers".to_string());
                    out.stickers.push(Sticker { id, path, animated, width, height, library: Some(library_ref(m)) });
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
                if table == "text_templates" {
                    bump(&mut report.library_items, table.clone());
                }
                out.foreign.push(Foreign { id: MaterialId(s(m, "id")), app: APP.into(), kind: table.clone(), raw: m.clone() });
            }
        }
    }
    // A freeze frame names the video it was taken from by material too: that material's path
    // is the one in use (it may have been relinked since).
    for (still, source) in freeze_sources {
        let Some(path) = out.media.iter().find(|m| m.id == source && m.kind == MediaKind::Video).map(|m| m.path.clone()) else { continue };
        if let Some(fr) = out.media.iter_mut().find(|m| m.id == still).and_then(|m| m.freeze.as_mut()) {
            fr.video = path;
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
            line_height: None,
            kerning: false,
            background,
            shadow,
            // A box with a fixed width wraps at a width proportional to `fixed_width`, scaled
            // with the clip and independent of the font size; an auto-sized box (`fixed_width`
            // -1) doesn't wrap (calibration session 5; docs/parity/text-wrap.md).
            max_width: Some(f(m, "fixed_width", -1.0) as f32).filter(|w| *w > 0.0).map(|w| w * CAPCUT_WRAP_PER_UNIT),
            curve: m.get("text_curve").filter(|c| b(c, "enable", false)).map_or(0.0, |c| f(c, "angle", 0.0) as f32),
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
                    // In source time (the media from 1 s, at 2×).
                    "common_keyframes": [
                        {"property_type": "KFTypeGlobalAlpha", "keyframe_list": [
                            {"time_offset": 1_000_000, "values": [0.0], "curveType": "Line"},
                            {"time_offset": 3_000_000, "values": [1.0], "curveType": "Line"}]},
                        {"property_type": "KFTypePositionX", "keyframe_list": [
                            {"time_offset": 1_000_000, "values": [-1.0], "curveType": "Line"},
                            {"time_offset": 5_000_000, "values": [1.0], "curveType": "Line"}]},
                        {"property_type": "KFTypeChromaIntensity", "keyframe_list": [{"time_offset": 0, "values": [0.3]}]}
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
        assert_eq!(report.unmapped_keyframes.get("KFTypeChromaIntensity"), Some(&1));
        assert_eq!(seg.attachments.len(), 3);

        // Text styling
        let text = &project.materials.texts[0];
        assert_eq!(text.text, "Hello");
        assert_eq!(text.runs[0].range, (0, 5));
        assert_eq!(text.runs[0].fill, Rgba { r: 1.0, g: 0.0, b: 0.0, a: 1.0 });
        assert!(text.runs[0].stroke.is_some());
        assert_eq!(text.layout.shadow.unwrap().color.a, 0.5);
        assert_eq!(project.tracks[1].segments[0].source, None);

        // Unsupported tables are kept and reported; AI tables are labelled. A sticker whose
        // bundle isn't here is kept without a file.
        assert_eq!(report.foreign.get("stickers"), None);
        assert_eq!((project.materials.stickers[0].path.as_str(), report.library_items.get("stickers")), ("", Some(&1)));
        assert!(report.warnings.iter().any(|w| w.contains("sticker")));
        assert_eq!(report.foreign.get("vocal_separations (AI, unsupported)"), Some(&1));
        assert_eq!(report.missing_media, vec!["/nope/a.mp4".to_string()]);

        // Built-in adjust sliders map to OpenRip adjustments; text effects are library items.
        let e1 = project.materials.effects.iter().find(|e| e.id.0 == "E1").unwrap();
        assert_eq!((e1.category, e1.builtin.as_deref(), e1.library.is_none()), (EffectCategory::Adjust, Some("brightness"), true));
        assert_eq!(report.library_items.get("effects:text_effect"), Some(&1));
        assert_eq!(report.library_items.get("effects:brightness"), None);
        assert!(report.problems.is_empty(), "{:?}", report.problems);
    }

    /// CapCut's speed tools as drafts store them: a curve (speed `mode` 1, its mean as
    /// `speed`), a reversed clip with the copy CapCut rendered backward, and a freeze frame (a
    /// photo of the frame, naming the video and where it was split).
    #[test]
    fn imports_speed_curves_reversed_copies_and_freeze_frames() {
        let pts = [(0.0, 5.2), (0.4, 5.2), (0.6, 1.0), (1.0, 1.0)];
        let remap = Remap::new(&pts).unwrap();
        let length = remap.output_length(6_000_000);
        let draft = json!({
            "id": "D", "fps": 30.0, "canvas_config": {"width": 1080, "height": 1920},
            "materials": {
                "videos": [
                    {"id": "V", "type": "video", "path": "/nope/v.mp4", "duration": 20_000_000, "reverse_path": "##_draftpath_placeholder_X_##/rev.mp4"},
                    {"id": "P", "type": "photo", "path": "##_draftpath_placeholder_X_##/still_6666666-sdr709.jpg", "duration": 10_800_000_000_i64, "material_name": "Freeze",
                     "freeze": {"source_material_id": "V", "source_material_path": "/old/place/v.mp4", "reverse_material_path": "", "timestamp": 6_666_666}}
                ],
                "speeds": [
                    {"id": "S1", "type": "speed", "mode": 1, "speed": remap.average(),
                     "curve_speed": {"id": "C", "name": "Flash In", "speed_points": pts.iter().map(|(x, y)| json!({"x": x, "y": y})).collect::<Vec<_>>()}},
                    // A normal speed keeps the last curve it had, unused.
                    {"id": "S2", "type": "speed", "mode": 0, "speed": 1.0, "curve_speed": {"name": "Montage", "speed_points": [{"x": 0.0, "y": 1.0}, {"x": 1.0, "y": 3.0}]}}
                ]
            },
            "tracks": [{"id": "T", "type": "video", "segments": [
                {"id": "A", "material_id": "V", "speed": remap.average(), "source_timerange": {"start": 2_000_000, "duration": 6_000_000}, "target_timerange": {"start": 0, "duration": length},
                 "extra_material_refs": ["S1"],
                 // Keys in source time: at 5 s of the media (3 s into the source range).
                 "common_keyframes": [{"property_type": "KFTypeGlobalAlpha", "keyframe_list": [
                     {"time_offset": 2_000_000, "values": [1.0], "curveType": "Line"}, {"time_offset": 5_000_000, "values": [0.0], "curveType": "Line"}]}]},
                {"id": "B", "material_id": "P", "speed": 1.0, "source_timerange": {"start": 0, "duration": 3_000_000}, "target_timerange": {"start": length, "duration": 3_000_000}, "extra_material_refs": ["S2"]},
                {"id": "C", "material_id": "V", "speed": 1.0, "reverse": true, "source_timerange": {"start": 6_666_666, "duration": 2_000_000}, "target_timerange": {"start": length + 3_000_000, "duration": 2_000_000}, "extra_material_refs": ["S2"]}
            ]}]
        });
        let Imported { project, .. } = import_draft_json(&draft, "").unwrap();
        let p = &project;
        let seg = |id: &str| p.tracks[0].segments.iter().find(|s| s.id == id).unwrap();
        // The curve, with its preset's name; the unused one is no curve.
        let curve = seg("A").speed_curve(&p.materials).unwrap();
        assert_eq!((curve.curve.len(), curve.preset.as_deref()), (4, Some("Flash In")));
        assert!(seg("B").speed_curve(&p.materials).is_none() && seg("C").speed_curve(&p.materials).is_none());
        // Keys placed by the curve's inverse: the fast start reaches 3 s of source sooner than
        // the mean speed would.
        let key = seg("A").opacity.keys[1].at;
        assert_eq!(key, Micros(remap.output_offset(3_000_000, length)));
        assert!(key.0 < (3_000_000.0 / remap.average()) as i64);
        // The reversed copy, and the freeze: the video by its material's path, the frame
        // starting at the split (CapCut snaps 0.8 ms).
        let v = p.materials.media.iter().find(|m| m.id.0 == "V").unwrap();
        assert_eq!(v.reverse_path.as_deref(), Some("##_draftpath_placeholder_X_##/rev.mp4"));
        assert!(seg("C").reverse);
        let still = p.materials.media.iter().find(|m| m.id.0 == "P").unwrap();
        assert_eq!(still.freeze, Some(Freeze { video: "/nope/v.mp4".into(), at: Micros(6_667_466) }));
        assert_eq!(still.kind, MediaKind::Photo);
    }

    /// A sticker bundle names its picture: a PNG through its script, or a GIF in its config.
    #[test]
    fn stickers_take_their_picture_from_the_bundle() {
        let root = std::env::temp_dir().join(format!("openrip-sticker-{}", std::process::id()));
        let (png, gif) = (root.join("png"), root.join("gif"));
        for dir in [&png, &gif] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(png.join("config.json"), r#"{"effect": {"Link": [{"type": "InfoSticker"}]}}"#).unwrap();
        std::fs::write(png.join("infoSticker.lua"), "InfoSticker = { materials = { { id = 0, source = \"singleImage.png\" } } }").unwrap();
        std::fs::write(png.join("singleImage.png"), b"png").unwrap();
        std::fs::write(png.join("heycanInfo.json"), r#"{"type":"png","singleWidth":465,"singleHeight":466,"frameCount":1}"#).unwrap();
        std::fs::write(gif.join("config.json"), r#"{"effect": {"Link": [{"type": "InfoSticker", "format": "gif", "path": "final.gif"}]}}"#).unwrap();
        std::fs::write(gif.join("final.gif"), b"gif").unwrap();
        let (path, animated, w, h) = sticker_file(&png).unwrap();
        assert!(path.ends_with("singleImage.png") && !animated && (w, h) == (465, 466), "{path}");
        let (path, animated, ..) = sticker_file(&gif).unwrap();
        assert!(path.ends_with("final.gif") && animated, "{path}");
        assert!(sticker_file(&root.join("missing")).is_none());
        std::fs::remove_dir_all(&root).ok();
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

    #[test]
    fn maps_transitions_and_clip_animations_to_built_ins() {
        let mut d = sample_draft();
        d["materials"]["transitions"] = json!([
            {"id": "X1", "name": "Pull in", "resource_id": "6724226861666144779", "duration": 400_000, "is_overlap": false},
            {"id": "X2", "name": "Mix", "resource_id": "70000000000000001", "duration": 500_000, "is_overlap": true},
            {"id": "X3", "name": "Flash Split", "resource_id": "7460753045769425409", "duration": 200_000, "is_overlap": true}]);
        d["materials"]["material_animations"] = json!([{"id": "A1", "type": "sticker_animation", "animations": [
            {"type": "out", "name": "Fade Out", "resource_id": "6798320902548230669", "start": 0, "duration": 1_366_666, "material_type": "video"},
            {"type": "in", "name": "Fade In", "resource_id": "70000000000000002", "start": 0, "duration": 500_000, "material_type": "video"},
            {"type": "group", "name": "Swing", "resource_id": "70000000000000003", "start": 0, "duration": 3_000_000, "material_type": "video"},
            {"type": "out", "name": "Blurred Fade-in", "resource_id": "7473710407329255953", "start": 0, "duration": 500_000, "material_type": "video"}]}]);
        let Imported { project, report } = import_draft_json(&d, "hint").unwrap();
        let t: Vec<Option<&str>> = project.materials.transitions.iter().map(|t| t.builtin.as_deref()).collect();
        assert_eq!(t, [Some("pull_in"), Some("mix"), None]);
        let a: Vec<(AnimationKind, Option<&str>)> = project.materials.animations[0].items.iter().map(|a| (a.kind.clone(), a.builtin.as_deref())).collect();
        assert_eq!(a, [(AnimationKind::Out, Some("fade_out")), (AnimationKind::In, Some("fade_in")), (AnimationKind::Combo, None), (AnimationKind::Out, None)]);
        // What only CapCut draws is reported, by name and resource id.
        assert_eq!(report.unmapped_library.get("transition: Flash Split (7460753045769425409)"), Some(&1));
        assert_eq!(report.unmapped_library.get("animation: Swing (70000000000000003)"), Some(&1));
        assert_eq!(report.unmapped_library.get("animation: Blurred Fade-in (7473710407329255953)"), Some(&1));
        assert_eq!(report.unmapped_library.len(), 3);
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
    fn imports_a_video_mask_and_attaches_it() {
        let mut d = sample_draft();
        d["materials"]["common_mask"] = json!([{"id": "M1", "type": "mask", "resource_type": "rectangle", "resource_id": "7374021450748924432", "name": "Rectangle",
            "config": {"centerX": 0.1, "centerY": 0.2, "width": 0.5, "height": 0.28, "rotation": 15.0, "feather": 0.3, "roundCorner": 0.4, "invert": true}}]);
        d["tracks"][0]["segments"][0]["extra_material_refs"] = json!(["M1"]);
        let Imported { project, report } = import_draft_json(&d, "hint").unwrap();
        let m = &project.materials.masks[0];
        assert_eq!(m.shape, MaskShape::Rectangle { round_corner: 0.4 });
        assert_eq!((m.center, m.size, m.rotation, m.feather, m.invert), ([0.1, 0.2], [0.5, 0.28], 15.0, 0.3, true));
        assert!(project.tracks[0].segments[0].attachments.contains(&MaterialId::from("M1")));
        assert_eq!(report.mapped.get("common_mask"), Some(&1));
        // The other shapes CapCut's bundles draw, by type, by name or by their bundle's folder.
        let shapes = [("circle", "", ""), ("", "Linear", ""), ("", "", "/cache/effect/1068046513/abc"), ("heart", "Heart", "/cache/effect/1068046512/abc")];
        for (k, (ty, name, path)) in shapes.iter().enumerate() {
            d["materials"]["common_mask"][0]["resource_type"] = json!(ty);
            d["materials"]["common_mask"][0]["name"] = json!(name);
            d["materials"]["common_mask"][0]["path"] = json!(path);
            let shape = import_draft_json(&d, "hint").unwrap().project.materials.masks[0].shape.clone();
            let want = [MaskShape::Circle, MaskShape::Linear, MaskShape::Mirror, MaskShape::Other { name: "heart".into() }];
            assert_eq!(shape, want[k]);
        }
    }

    /// A heart or star mask draws the picture in its bundle; without the bundle it's kept
    /// undrawn.
    #[test]
    fn a_heart_or_star_mask_takes_its_bundles_picture() {
        let bundle = std::env::temp_dir().join(format!("openrip-heart-{}", std::process::id()));
        std::fs::create_dir_all(bundle.join("amazingfeature/effects/lumi_heart_mask/xshader")).unwrap();
        std::fs::create_dir_all(bundle.join("amazingfeature/image")).unwrap();
        std::fs::write(bundle.join("amazingfeature/effects/lumi_heart_mask/xshader/mask.frag"), "float alpha = (col.r * 4.0 * 256.0 + col.g * 255.0) / 701.0;").unwrap();
        std::fs::write(bundle.join("amazingfeature/image/mask.png"), b"png").unwrap();
        let mut d = sample_draft();
        d["materials"]["common_mask"] = json!([{"id": "M1", "resource_type": "pentagram", "name": "Stars", "path": bundle.to_string_lossy(), "config": {"width": 0.5, "height": 0.5}}]);
        let shape = import_draft_json(&d, "hint").unwrap().project.materials.masks[0].shape.clone();
        assert_eq!(shape, MaskShape::Picture { name: "pentagram".into(), path: bundle.join("amazingfeature/image/mask.png").to_string_lossy().into_owned() });
        d["materials"]["common_mask"][0]["path"] = json!("/nowhere");
        assert_eq!(import_draft_json(&d, "hint").unwrap().project.materials.masks[0].shape, MaskShape::Other { name: "pentagram".into() });
        std::fs::remove_dir_all(&bundle).ok();
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
    fn imports_a_voice_filter_with_its_sliders() {
        let mut d = sample_draft();
        d["materials"]["audio_effects"] = json!([{"id": "AE", "type": "audio_effect", "name": "Deep", "resource_id": "7021052537344102913", "path": "/cache/deep",
            "audio_adjust_params": [{"name": "change_voice_param_pitch", "value": 0.834}, {"name": "change_voice_param_timbre", "value": 1.0}]}]);
        let Imported { project, .. } = import_draft_json(&d, "hint").unwrap();
        let e = project.materials.effects.iter().find(|e| e.id.0 == "AE").unwrap();
        assert_eq!((e.category, e.resource.as_deref(), e.params.get("change_voice_param_pitch").copied()), (EffectCategory::Audio, Some("/cache/deep"), Some(0.834)));
    }

    #[test]
    fn rejects_non_drafts() {
        assert!(matches!(import_draft_json(&json!({"hello": 1}), "x"), Err(ImportError::NotADraft(_))));
    }
}
