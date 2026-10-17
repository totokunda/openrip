//! A model project (a CapCut draft, say) as the app's own project JSON, so the app can open
//! and edit it. The app's clips describe only what its editor knows (timing, a box on the
//! canvas, a text, a volume), so each clip also carries the segment it came from and the
//! materials that segment uses, under `engine`, with the clip fields as written (`base`).
//! [`crate::import_v1_json`] puts the segment back and applies on top only what the app
//! changed since: a move, a resize, a turn, a trim, a new text, and the panels' other fields
//! the clip carries (text styles, the draft's own adjustments, a filter's strength, …).
//! Everything else (effects, keyframes, exact timing) is drawn as CapCut drew it.

use serde_json::{json, Map, Value};
#[cfg(test)]
use std::collections::BTreeMap;

use openrip_model::*;

use crate::{WORLD_H, World};

/// The model's track kinds as the app's track types.
fn app_track_type(kind: TrackKind) -> &'static str {
    match kind {
        TrackKind::Video => "media",
        TrackKind::Audio => "audio",
        TrackKind::Text => "text",
        TrackKind::Graphic => "shape",
        // Stickers, effects, filters and adjustment layers: the app's filter track shows them
        // as named bars; the engine draws them.
        TrackKind::Sticker | TrackKind::Effect | TrackKind::Filter | TrackKind::Adjustment => "filter",
    }
}

/// Track height the app gives each type (`getTimelineHeightForClip`).
fn app_track_height(ty: &str) -> f64 {
    match ty {
        "media" => 72.0,
        "audio" => 54.0,
        _ => 36.0,
    }
}

pub(crate) fn kind_name(kind: TrackKind) -> &'static str {
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

pub(crate) fn kind_from_name(name: &str) -> Option<TrackKind> {
    Some(match name {
        "video" => TrackKind::Video,
        "audio" => TrackKind::Audio,
        "text" => TrackKind::Text,
        "sticker" => TrackKind::Sticker,
        "effect" => TrackKind::Effect,
        "filter" => TrackKind::Filter,
        "adjustment" => TrackKind::Adjustment,
        "graphic" => TrackKind::Graphic,
        _ => return None,
    })
}

/// The text panel's style fields (`TextProperties` and its stroke, shadow and background
/// sections) a converted text clip carries; a change to any of them is applied on import.
pub(crate) const TEXT_STYLE_KEYS: [&str; 20] = [
    "fontFamily", "fontWeight", "fontStyle", "textDecoration", "textAlign", "textTransform",
    "strokeEnabled", "stroke", "strokeWidth", "strokeOpacity",
    "shadowEnabled", "shadowColor", "shadowOpacity", "shadowOffsetX", "shadowOffsetY", "shadowBlur",
    "backgroundEnabled", "backgroundColor", "backgroundOpacity", "backgroundCornerRadius",
];

/// The Adjust panel's sliders; the app's scale, applied on top of CapCut's own adjustments.
pub(crate) const ADJUST_KEYS: [&str; 8] = ["brightness", "contrast", "hue", "saturation", "sharpness", "noise", "blur", "vignette"];

/// CapCut's Adjust sliders the engine draws (`PreviewEngine::adjust_of`), by the importer's
/// names for them. The draft's others (clarity, vignette, fade) are kept as CapCut has them.
pub(crate) const DRAWN_ADJUST: [&str; 11] = ["brightness", "contrast", "saturation", "highlights", "shadows", "whites", "blacks", "temperature", "tint", "exposure", "sharpen"];

/// How CapCut shows an Adjust slider's value (−1…1 in the draft): times 50, or times 100 for
/// the one-sided sliders (0…100).
pub(crate) fn capcut_scale(name: &str) -> f64 {
    if matches!(name, "sharpen" | "clarity" | "vignette" | "fade") { 100.0 } else { 50.0 }
}

/// The text animations and transitions the engine draws itself (`playback/src/animation.rs`,
/// `caption.rs`, `transition.rs`), by the names the app's Animation tab uses.
pub(crate) const BUILTIN_IN: [&str; 3] = ["type_1", "type_2", "typewriter"];
pub(crate) const BUILTIN_CAPTION: [&str; 2] = ["caption_word_color", "caption_one_word"];
pub(crate) const BUILTIN_TRANSITION: [&str; 3] = ["white_flash", "white_fade", "blink"];

/// A clip's animations (all its animation materials' items).
fn animations<'a>(project: &'a Project, seg: &Segment) -> Vec<&'a Animation> {
    seg.attachments.iter().filter_map(|id| project.materials.animations.iter().find(|m| &m.id == id)).flat_map(|m| m.items.iter()).collect()
}

/// A built-in name the engine draws, or "" for one only the source app draws.
fn builtin_or_empty(builtin: &Option<String>, known: &[&str]) -> String {
    builtin.clone().filter(|b| known.contains(&b.as_str())).unwrap_or_default()
}

/// A number as the app writes it: rounded to hundredths.
fn num(v: f64) -> Value {
    json!((v * 100.0).round() / 100.0)
}

/// Opacity as the app's 0–100.
fn pct(a: f32) -> Value {
    json!((a.clamp(0.0, 1.0) as f64 * 100.0).round())
}

fn hex(c: Rgba) -> String {
    let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", b(c.r), b(c.g), b(c.b))
}

fn reduce(w: u32, h: u32) -> String {
    fn gcd(a: u32, b: u32) -> u32 {
        if b == 0 { a } else { gcd(b, a % b) }
    }
    let g = gcd(w, h).max(1);
    format!("{}:{}", w / g, h / g)
}

/// The app's ticks: a frame at `round(fps)` frames a second, truncated to µs.
struct Ticks {
    fps: f64,
    tick_fps: i64,
}

impl Ticks {
    fn frame(&self, t: Micros) -> i64 {
        (t.0 as f64 * self.fps / 1e6).round() as i64
    }
    fn tick(&self, frame: i64) -> String {
        (frame.max(0) as i128 * 1_000_000 / self.tick_fps as i128).to_string()
    }
}

/// The box (top-left corner, size, clockwise turn about the corner) the app draws a clip in,
/// in world units, for a centre in the model's half-canvas units and a size in world units.
fn app_box(world: &World, center: Vec2, size: [f64; 2], rotation: f64) -> Map<String, Value> {
    let (cx, cy) = ((center.x + 1.0) / 2.0 * world.w, (1.0 - center.y) / 2.0 * world.h);
    let (sn, cs) = rotation.to_radians().sin_cos();
    let (w, h) = (size[0], size[1]);
    let x = cx - (cs * w / 2.0 - sn * h / 2.0);
    let y = cy - (sn * w / 2.0 + cs * h / 2.0);
    let mut m = Map::new();
    for (k, v) in [("x", x), ("y", y), ("width", w), ("height", h), ("scaleX", 1.0), ("scaleY", 1.0), ("rotation", rotation), ("cornerRadius", 0.0)] {
        m.insert(k.into(), json!(v));
    }
    m
}

/// A video or photo's own adjustments from the draft, for the Adjust tab, in the clip's order:
/// CapCut's Adjust sliders (on CapCut's scale), colour wheels, and the HSL, curves, filters
/// and effects on the clip. The app's sliders (`v1:`) have the Adjust panel's own fields,
/// and HSL and curves that change nothing aren't listed. The ones the engine draws can be
/// changed (`drawn`); any can be removed.
fn draft_adjustments(project: &Project, seg: &Segment) -> Vec<Value> {
    // A curve within a level of the diagonal changes nothing.
    let identity = |c: &[CurvePoint]| c.iter().all(|p| [p.anchor, p.left, p.right].iter().all(|(x, y)| (x - y).abs() < 1.0 / 255.0));
    let mut out = Vec::new();
    for id in &seg.attachments {
        let mut entry = match project.materials.get(id) {
            Some(MaterialRef::Effect(e)) => match (e.category, e.builtin.as_deref()) {
                (EffectCategory::Adjust, Some(name)) if !name.starts_with("v1:") => {
                    let scale = capcut_scale(name);
                    let title = name[..1].to_uppercase() + &name[1..];
                    let value = e.params.get("intensity").copied().unwrap_or(0.0) * scale;
                    json!({ "kind": name, "name": title, "value": num(value), "min": if scale == 100.0 { 0.0 } else { -50.0 }, "max": if scale == 100.0 { 100.0 } else { 50.0 }, "drawn": DRAWN_ADJUST.contains(&name) })
                }
                (EffectCategory::Adjust | EffectCategory::Audio, _) => continue,
                (category, _) => {
                    let name = Some(e.name.clone()).filter(|n| !n.is_empty()).or_else(|| e.library.as_ref().map(|l| l.category.clone()).filter(|c| !c.is_empty()));
                    let (kind, fallback) = if category == EffectCategory::Filter { ("filter", "Filter") } else { ("effect", "Effect") };
                    json!({ "kind": kind, "name": name.unwrap_or_else(|| fallback.into()), "drawn": false })
                }
            },
            Some(MaterialRef::ColorWheels(w)) if w.log => json!({ "kind": "log_wheels", "name": "Log wheels", "drawn": false }),
            // Their strength, as a percentage.
            Some(MaterialRef::ColorWheels(w)) => json!({ "kind": "color_wheels", "name": "Color wheels", "value": num(w.intensity * 100.0), "min": 0.0, "max": 100.0, "drawn": true }),
            Some(MaterialRef::Hsl(h)) if h.hue != 0.0 || h.saturation != 0.0 || h.lightness != 0.0 => json!({ "kind": "hsl", "name": "HSL", "drawn": false }),
            Some(MaterialRef::Curves(c)) if ![&c.luma, &c.red, &c.green, &c.blue].into_iter().all(|ch| identity(ch)) => json!({ "kind": "curves", "name": "Curves", "drawn": false }),
            _ => continue,
        };
        entry["id"] = json!(id.0);
        out.push(entry);
    }
    out
}

/// The text segments of `new` that an edit laid out anew since `old`: CapCut's texts (they
/// have no box of their own; the app's text does) whose words or style changed. The app's
/// box around each follows the engine's new block (the addon's `updateProject`).
pub fn relaid_texts(old: &Project, new: &Project) -> Vec<String> {
    use std::collections::HashMap;
    /// Each text segment's text, by segment id.
    fn texts(p: &Project) -> HashMap<&str, &Text> {
        let by_id: HashMap<&MaterialId, &Text> = p.materials.texts.iter().map(|t| (&t.id, t)).collect();
        p.tracks.iter().flat_map(|t| &t.segments).filter_map(|s| Some((s.id.as_str(), *by_id.get(&s.material)?))).collect()
    }
    let before = texts(old);
    let mut out: Vec<String> = texts(new).into_iter().filter(|(id, now)| now.layout.frame.is_none() && before.get(id).is_some_and(|was| was != now)).map(|(id, _)| id.to_string()).collect();
    out.sort();
    out
}

/// Everything a segment uses: its own material and its attachments.
fn segment_materials(project: &Project, seg: &Segment) -> Vec<Value> {
    std::iter::once(&seg.material)
        .chain(seg.attachments.iter())
        .filter_map(|id| project.materials.get(id))
        .filter_map(|m| serde_json::to_value(m.to_owned_material()).ok())
        .collect()
}

/// `project` as the app's project document, without the app's own `meta` (the app gives it
/// an id and a name when it saves it). Assets point at the media files themselves.
/// `text_box` gives a text segment's block on the canvas in pixels (left, top, width,
/// height, unturned) as the engine lays it out, for the box the app shows around it.
pub fn to_app_project(project: &Project, text_box: &mut dyn FnMut(&Segment) -> Option<[f64; 4]>) -> Value {
    let (cw, ch) = (project.canvas.width.max(1), project.canvas.height.max(1));
    let world = World { w: WORLD_H * cw as f64 / ch as f64, h: WORLD_H };
    let fps = project.fps.as_f64();
    let ticks = Ticks { fps, tick_fps: fps.round().max(1.0) as i64 };
    let to_world = WORLD_H / ch as f64;

    // Assets: one per media material.
    let mut assets = Map::new();
    for m in &project.materials.media {
        let ty = match m.kind {
            MediaKind::Audio => "audio",
            MediaKind::Photo => "image",
            MediaKind::Video => "video",
        };
        let url = url_from_path(&m.path);
        assets.insert(
            m.id.0.clone(),
            json!({ "id": m.id.0, "path": url, "type": ty, "duration": m.duration.as_secs_f64(), "width": m.width, "height": m.height }),
        );
    }

    // Tracks bottom first in stacking order (CapCut stacks by render index), then listed top
    // first as the app lists them.
    // Sound goes below the pictures, as CapCut and the app show it.
    let mut order: Vec<&Track> = project.tracks.iter().filter(|t| !t.segments.is_empty()).collect();
    order.sort_by_key(|t| (t.kind != TrackKind::Audio, t.segments.iter().map(|s| s.render_index).max().unwrap_or(0)));
    order.reverse();

    let mut tracks = Vec::new();
    let mut clips = Vec::new();
    let mut y = 0.0;
    for t in order {
        let ty = app_track_type(t.kind);
        let height = app_track_height(ty);
        tracks.push(json!({
            "timelineId": t.id, "type": ty, "timelineHeight": height, "timelineWidth": 0, "timelineY": y,
            "timelinePadding": 24, "muted": t.muted, "hidden": t.hidden,
        }));
        y += height;
        for seg in &t.segments {
            clips.push(app_clip(project, &world, &ticks, to_world, t, seg, text_box));
        }
    }

    json!({
        "version": "1.0.0",
        "settings": {
            "fps": fps,
            "aspectRatio": { "width": cw, "height": ch, "id": reduce(cw, ch) },
            "defaultClipLength": 5,
            // The canvas exactly (the app's aspect ratio alone would round it).
            "engineCanvas": { "width": cw, "height": ch },
        },
        "editorState": {},
        "assets": assets,
        "timeline": { "tracks": tracks, "clips": clips },
    })
}

fn url_from_path(path: &str) -> String {
    if path.is_empty() || path.starts_with("file://") {
        return path.to_string();
    }
    let mut out = String::from("file://");
    for b in path.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn app_clip(project: &Project, world: &World, ticks: &Ticks, to_world: f64, track: &Track, seg: &Segment, text_box: &mut dyn FnMut(&Segment) -> Option<[f64; 4]>) -> Value {
    let start = ticks.frame(seg.target.start);
    let end = ticks.frame(seg.target.end()).max(start + 1);
    let mut clip = Map::new();
    clip.insert("clipId".into(), json!(seg.id));
    clip.insert("timelineId".into(), json!(track.id));
    clip.insert("clipPadding".into(), json!(24));
    clip.insert("startTick".into(), json!(ticks.tick(start)));
    clip.insert("endTick".into(), json!(ticks.tick(end)));
    clip.insert("trimStartTick".into(), json!("0"));
    clip.insert("trimEndTick".into(), json!("0"));
    let opacity = (seg.opacity.value * 100.0) as f64;
    let rotation = seg.transform.rotation.value;
    let pos = seg.transform.position.value;
    let scale = seg.transform.scale.value;

    let media = project.materials.media.iter().find(|m| m.id == seg.material);
    let text = project.materials.texts.iter().find(|m| m.id == seg.material);
    match (track.kind, media, text) {
        (_, Some(m), _) => {
            let ty = match m.kind {
                MediaKind::Audio => "audio",
                MediaKind::Photo => "image",
                MediaKind::Video => "video",
            };
            clip.insert("type".into(), json!(ty));
            clip.insert("assetId".into(), json!(m.id.0));
            if ty != "image" {
                clip.insert("speed".into(), json!(seg.speed));
                clip.insert("volume".into(), json!(20.0 * (seg.volume.value.max(1e-4) as f64).log10()));
                // Trims in timeline frames before the speed, as the app keeps them.
                let src = seg.source.unwrap_or(TimeRange::new(Micros::ZERO, seg.target.duration));
                let trim_start = ticks.frame(Micros((src.start.0 as f64 / seg.speed.max(1e-6)) as i64));
                let full = ticks.frame(Micros((m.duration.0 as f64 / seg.speed.max(1e-6)) as i64));
                let trim_end = (full - trim_start - (end - start)).max(0);
                clip.insert("trimStartTick".into(), json!(ticks.tick(trim_start)));
                clip.insert("trimEndTick".into(), json!(ticks.tick(trim_end)));
                let fade = seg.attachments.iter().find_map(|id| project.materials.audio_fades.iter().find(|f| &f.id == id));
                clip.insert("fadeIn".into(), num(fade.map_or(0.0, |f| f.fade_in.as_secs_f64())));
                clip.insert("fadeOut".into(), num(fade.map_or(0.0, |f| f.fade_out.as_secs_f64())));
            }
            if ty != "audio" {
                // CapCut's own adjustments stay as they are; the app's sliders start at zero.
                for k in ADJUST_KEYS {
                    clip.insert(k.into(), json!(0));
                }
                // The transition into the next clip on the track.
                let tr = seg.attachments.iter().find_map(|id| project.materials.transitions.iter().find(|t| &t.id == id));
                clip.insert(
                    "transitionOut".into(),
                    tr.map_or(Value::Null, |t| {
                        json!({ "type": builtin_or_empty(&t.builtin, &BUILTIN_TRANSITION), "name": t.name, "duration": num(t.duration.as_secs_f64()), "resource": t.resource })
                    }),
                );
            }
            if ty != "audio" {
                let (mw, mh) = (m.width.max(1) as f64, m.height.max(1) as f64);
                clip.insert("mediaWidth".into(), json!(mw));
                clip.insert("mediaHeight".into(), json!(mh));
                clip.insert("mediaAspectRatio".into(), json!(mw / mh));
                // Contain-fit in the world, times the clip's scale.
                let fit = (world.w / mw).min(world.h / mh);
                let mut b = app_box(world, pos, [mw * fit * scale.x.abs(), mh * fit * scale.y.abs()], rotation);
                b.insert("opacity".into(), json!(opacity));
                let mut original = b.clone();
                original.insert("x".into(), json!(0.0));
                original.insert("y".into(), json!(0.0));
                clip.insert("transform".into(), Value::Object(b));
                clip.insert("originalTransform".into(), Value::Object(original));
                clip.insert("draftAdjustments".into(), Value::Array(draft_adjustments(project, seg)));
            }
        }
        (_, None, Some(t)) => {
            clip.insert("type".into(), json!("text"));
            clip.insert("text".into(), json!(t.text));
            let run = t.runs.first();
            // The engine's block, else a guess from the size; only the app's handles use it.
            let block = text_box(seg);
            let em_px = run.map_or(40.0, |r| match r.size_unit {
                SizeUnit::CapCut => r.size * CAPCUT_SIZE_UNIT_EM * project.canvas.width as f32 / 1.2,
                SizeUnit::CanvasHeight => r.size * project.canvas.height as f32,
            }) as f64 * scale.x.abs();
            clip.insert("fontSize".into(), json!((em_px * to_world).round().max(1.0)));
            clip.insert("fontFamily".into(), json!(run.map(|r| r.font.name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| "Arial".into())));
            clip.insert("fontWeight".into(), json!(if run.is_some_and(|r| r.bold) { 700 } else { 400 }));
            clip.insert("fontStyle".into(), json!(if run.is_some_and(|r| r.italic) { "italic" } else { "normal" }));
            clip.insert("color".into(), json!(run.map_or("#ffffff".into(), |r| hex(r.fill))));
            clip.insert("textAlign".into(), json!(match t.layout.alignment { 0 => "left", 2 => "right", _ => "center" }));
            clip.insert("verticalAlign".into(), json!("middle"));
            clip.insert("textDecoration".into(), json!(if run.is_some_and(|r| r.underline) { "underline" } else { "none" }));
            clip.insert("textTransform".into(), json!("none"));
            // Stroke, shadow and background sizes in the app's units: as the app's own text
            // keeps them, fractions of the font size times its size (`convert_text`).
            let fs = (em_px * to_world).round().max(1.0);
            let stroke = run.and_then(|r| r.stroke).filter(|s| s.width > 0.0);
            clip.insert("strokeEnabled".into(), json!(stroke.is_some()));
            clip.insert("stroke".into(), json!(hex(stroke.map_or(Rgba::BLACK, |s| s.color))));
            clip.insert("strokeWidth".into(), num(stroke.map_or(2.0, |s| s.width as f64 * fs)));
            clip.insert("strokeOpacity".into(), pct(stroke.map_or(1.0, |s| s.color.a)));
            let shadow = t.layout.shadow.filter(|s| s.color.a > 0.0);
            let (dist, angle) = shadow.map_or((2.0f64.hypot(2.0) / fs, -45.0f64), |s| (s.distance as f64, s.angle_deg as f64));
            clip.insert("shadowEnabled".into(), json!(shadow.is_some()));
            clip.insert("shadowColor".into(), json!(hex(shadow.map_or(Rgba::BLACK, |s| s.color))));
            clip.insert("shadowOpacity".into(), pct(shadow.map_or(0.75, |s| s.color.a)));
            // The model's angle has +y up; the app's offsets are y-down.
            clip.insert("shadowOffsetX".into(), num(dist * fs * angle.to_radians().cos()));
            clip.insert("shadowOffsetY".into(), num(-dist * fs * angle.to_radians().sin()));
            clip.insert("shadowBlur".into(), num(shadow.map_or(4.0, |s| s.smoothing as f64 * fs)));
            let bg = t.layout.background.filter(|b| b.color.a > 0.0);
            clip.insert("backgroundEnabled".into(), json!(bg.is_some()));
            clip.insert("backgroundColor".into(), json!(hex(bg.map_or(Rgba::BLACK, |b| b.color))));
            clip.insert("backgroundOpacity".into(), pct(bg.map_or(1.0, |b| b.color.a)));
            clip.insert("backgroundCornerRadius".into(), num(bg.filter(|b| b.style == 2).map_or(0.0, |b| b.corner_radius as f64 * fs)));
            // The Animation tab: the In animation, and for captions that follow the speech,
            // their style.
            let anims = animations(project, seg);
            let anim_in = anims.iter().find(|a| a.kind == AnimationKind::In && a.duration.0 > 0);
            clip.insert(
                "animationIn".into(),
                anim_in.map_or(Value::Null, |a| {
                    json!({ "type": builtin_or_empty(&a.builtin, &BUILTIN_IN), "name": a.library.as_ref().map(|l| l.name.clone()).unwrap_or_default(), "duration": num(a.duration.as_secs_f64()) })
                }),
            );
            let caption = anims.iter().find(|a| a.kind == AnimationKind::Caption);
            clip.insert("captionStyle".into(), json!(caption.map_or("none".to_string(), |a| builtin_or_empty(&a.builtin, &BUILTIN_CAPTION))));
            clip.insert("spokenWords".into(), json!(!t.words.is_empty()));
            let (w, h, c) = match block {
                Some([l, top, w, h]) => {
                    let c = Vec2::new((l + w / 2.0) / project.canvas.width as f64 * 2.0 - 1.0, 1.0 - (top + h / 2.0) / project.canvas.height as f64 * 2.0);
                    (w * to_world, h * to_world, c)
                }
                None => {
                    let lines = t.text.lines().count().max(1) as f64;
                    let longest = t.text.lines().map(|l| l.chars().count()).max().unwrap_or(1) as f64;
                    ((longest * em_px * 0.55 * to_world).min(world.w), lines * em_px * 1.25 * to_world, pos)
                }
            };
            let mut b = app_box(world, c, [w.max(1.0), h.max(1.0)], rotation);
            b.insert("opacity".into(), json!(opacity));
            clip.insert("transform".into(), Value::Object(b));
        }
        _ => {
            // Stickers, effects, filters, adjustment layers: a named bar on a filter track.
            clip.insert("type".into(), json!("filter"));
            let name = match project.materials.get(&seg.material) {
                Some(MaterialRef::Effect(e)) if !e.name.is_empty() => e.name.clone(),
                Some(MaterialRef::Foreign(f)) => f.raw.get("name").and_then(Value::as_str).filter(|n| !n.is_empty()).map(String::from).unwrap_or_else(|| f.kind.clone()),
                _ => kind_name(track.kind).to_string(),
            };
            clip.insert("name".into(), json!(name));
            clip.insert("category".into(), json!("CapCut"));
            // What it is, and whether the engine draws it: filters with their bundle, at their
            // strength; effects, stickers and adjustment layers not yet.
            let filter = project.materials.effects.iter().find(|e| e.id == seg.material && e.category == EffectCategory::Filter);
            clip.insert("draftKind".into(), json!(kind_name(track.kind)));
            clip.insert("drawn".into(), json!(filter.is_some_and(|e| e.resource.is_some()) && track.kind == TrackKind::Filter));
            clip.insert("intensity".into(), num(filter.and_then(|e| e.params.get("intensity").copied()).unwrap_or(1.0) * 100.0));
        }
    }

    // What the engine needs to draw it as it was, and the app's fields as written, so an
    // import can tell what the app changed.
    let base_keys = ["startTick", "endTick", "trimStartTick", "trimEndTick", "speed", "volume", "fadeIn", "fadeOut", "transform", "text", "fontSize", "color", "animationIn", "captionStyle", "transitionOut"];
    let base: Map<String, Value> = base_keys
        .iter()
        .chain(TEXT_STYLE_KEYS.iter())
        .chain(ADJUST_KEYS.iter())
        // The draft's own adjustments, and a filter bar's strength.
        .chain(["draftAdjustments", "intensity"].iter())
        .filter_map(|k| clip.get(*k).map(|v| (k.to_string(), v.clone())))
        .collect();
    clip.insert(
        "engine".into(),
        json!({ "track": kind_name(track.kind), "segment": serde_json::to_value(seg).unwrap_or(Value::Null), "materials": segment_materials(project, seg), "base": base }),
    );
    Value::Object(clip)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{import_v1_json, Imported};

    /// A 1080×1920 project at 30 fps: a 4 s video with a keyframed position and an effect
    /// attached, and a caption above it.
    fn project() -> Project {
        let mut p = Project::new("p", "P", Canvas { width: 1080, height: 1920 }, FrameRate::new(30, 1));
        p.materials.media.push(Media { id: MaterialId("m".into()), kind: MediaKind::Video, path: "/tmp/clip.mov".into(), width: 1080, height: 1920, duration: Micros(10_000_000), has_audio: true, matte: Some("/tmp/matte".into()) });
        let mut fx = BTreeMap::new();
        fx.insert("intensity".to_string(), 0.5);
        p.materials.effects.push(Effect { id: MaterialId("fx".into()), category: EffectCategory::Filter, name: "Film".into(), params: fx, builtin: None, resource: Some("/bundle".into()), library: None, text_style: None });
        let mut position = Animated::constant(Vec2::new(0.1, 0.2));
        position.keys = vec![Keyframe { at: Micros(0), value: Vec2::new(0.1, 0.2), ease: Easing::default() }, Keyframe { at: Micros(1_000_000), value: Vec2::new(0.3, 0.2), ease: Easing::default() }];
        let video = Segment {
            id: "v".into(),
            material: MaterialId("m".into()),
            source: Some(TimeRange::new(Micros(1_000_000), Micros(4_000_000))),
            target: TimeRange::new(Micros(500_000), Micros(4_000_000)),
            speed: 1.0,
            reverse: false,
            change_pitch: false,
            visible: true,
            render_index: 0,
            transform: Transform { position, scale: Animated::constant(Vec2::new(0.5, 0.5)), rotation: Animated::constant(10.0), flip_h: false, flip_v: false },
            crop: None,
            opacity: Animated::constant(1.0),
            volume: Animated::constant(1.0),
            attachments: vec![MaterialId("fx".into())],
        };
        p.materials.texts.push(Text {
            id: MaterialId("t".into()),
            text: "Hello there".into(),
            runs: vec![TextRun { range: (0, 11), font: FontRef { name: "Arial".into(), path: "/fonts/a.ttf".into() }, size: 15.0, size_unit: SizeUnit::CapCut, fill: Rgba::WHITE, stroke: Some(Stroke { color: Rgba::BLACK, width: 0.08 }), bold: false, italic: false, underline: false }],
            layout: TextLayout {
                alignment: 1,
                letter_spacing: 0.0,
                line_spacing: 0.0,
                line_height: None,
                kerning: false,
                background: Some(TextBackground { color: Rgba { r: 1.0, g: 0.0, b: 0.0, a: 0.5 }, corner_radius: 0.4, width: 0.14, height: 0.14, style: 2 }),
                shadow: Some(TextShadow { color: Rgba::BLACK, distance: 0.1, angle_deg: -45.0, smoothing: 0.05 }),
                max_width: None,
                curve: 0.0,
                frame: None,
            },
            words: Vec::new(),
        });
        let text = Segment { id: "c".into(), material: MaterialId("t".into()), source: None, target: TimeRange::new(Micros(0), Micros(2_000_000)), render_index: 14000, transform: Transform::default(), attachments: Vec::new(), ..video.clone() };
        p.tracks.push(Track { id: "tv".into(), kind: TrackKind::Video, name: String::new(), segments: vec![video], muted: false, hidden: false, locked: false });
        p.tracks.push(Track { id: "tt".into(), kind: TrackKind::Text, name: String::new(), segments: vec![text], muted: false, hidden: false, locked: false });
        p
    }

    fn segment<'a>(p: &'a Project, id: &str) -> &'a Segment {
        p.tracks.iter().flat_map(|t| t.segments.iter()).find(|s| s.id == id).unwrap()
    }

    #[test]
    fn an_unedited_project_comes_back_exactly() {
        let p = project();
        let doc = to_app_project(&p, &mut |_| None);
        let Imported { project: back, report } = import_v1_json(&doc).unwrap();
        assert!(report.problems.is_empty() && report.warnings.is_empty(), "{report:?}");
        assert_eq!(back.canvas, p.canvas);
        assert_eq!(segment(&back, "v").transform, segment(&p, "v").transform);
        assert_eq!((segment(&back, "v").target, segment(&back, "v").source), (segment(&p, "v").target, segment(&p, "v").source));
        assert_eq!(segment(&back, "v").attachments, vec![MaterialId("fx".into())]);
        assert!(back.materials.effects.iter().any(|e| e.id.0 == "fx" && e.resource.as_deref() == Some("/bundle")));
        // The draft's cut-out survives on the app's asset.
        assert_eq!(back.materials.media[0].matte.as_deref(), Some("/tmp/matte"));
        // Text above video.
        let (v, t) = (segment(&back, "v").render_index, segment(&back, "c").render_index);
        assert!(t > v);
        // The caption keeps its own material, styles and all.
        assert_eq!(segment(&back, "c").material, MaterialId("t".into()));
        assert_eq!(back.materials.texts.iter().find(|t| t.id.0 == "t"), p.materials.texts.first());
    }

    /// The app writes whole numbers without a fraction; that isn't an edit.
    #[test]
    fn numbers_written_back_as_integers_are_not_edits() {
        let p = project();
        let mut doc = to_app_project(&p, &mut |_| None);
        let text: String = serde_json::to_string(&doc).unwrap().replace(".0,", ",").replace(".0}", "}");
        doc = serde_json::from_str(&text).unwrap();
        let back = import_v1_json(&doc).unwrap().project;
        assert_eq!(segment(&back, "c").material, MaterialId("t".into()));
        assert_eq!(segment(&back, "v").attachments, segment(&p, "v").attachments);
    }

    #[test]
    fn text_panel_edits_apply_to_a_converted_caption() {
        let p = project();
        let mut doc = to_app_project(&p, &mut |_| None);
        let clip = doc["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["clipId"] == "c").unwrap();
        let fs = clip["fontSize"].as_f64().unwrap();
        assert_eq!((clip["strokeEnabled"].as_bool(), clip["shadowEnabled"].as_bool(), clip["backgroundEnabled"].as_bool()), (Some(true), Some(true), Some(true)));
        clip["strokeWidth"] = json!(fs * 0.2);
        clip["stroke"] = json!("#00ff00");
        clip["shadowEnabled"] = json!(false);
        clip["backgroundColor"] = json!("#0000ff");
        clip["fontFamily"] = json!("Georgia");
        clip["fontWeight"] = json!(700);
        clip["textAlign"] = json!("left");
        clip["textTransform"] = json!("uppercase");
        let back = import_v1_json(&doc).unwrap().project;
        let t = back.materials.texts.iter().find(|t| t.id == segment(&back, "c").material).unwrap();
        let run = &t.runs[0];
        let stroke = run.stroke.unwrap();
        assert!((stroke.width - 0.2).abs() < 1e-4 && stroke.color.g == 1.0, "{stroke:?}");
        assert_eq!((run.font.name.as_str(), run.font.path.as_str(), run.bold), ("Georgia", "", true));
        assert_eq!((t.layout.alignment, t.text.as_str()), (0, "HELLO THERE"));
        assert!(t.layout.shadow.is_none());
        // The background takes the new colour and keeps CapCut's padding and rounding.
        let bg = t.layout.background.unwrap();
        assert_eq!((bg.color.b, bg.color.a, bg.width, bg.style), (1.0, 0.5, 0.14, 2));
        assert!((bg.corner_radius - 0.4).abs() < 0.05, "{bg:?}");
    }

    /// The project with a typing animation and a caption style on the caption, and a
    /// transition at the end of the video.
    fn animated() -> Project {
        let mut p = project();
        let lib = |name: &str| Some(LibraryRef { app: "capcut".into(), resource_id: "1".into(), name: name.into(), category: String::new() });
        p.materials.animations.push(Animations {
            id: MaterialId("an".into()),
            items: vec![
                Animation { kind: AnimationKind::In, start: Micros(0), duration: Micros(1_000_000), builtin: Some("type_2".into()), library: lib("Type 2"), resource: Some("/cache/t2".into()) },
                Animation { kind: AnimationKind::Caption, start: Micros(0), duration: Micros(2_000_000), builtin: Some("caption_word_color".into()), library: None, resource: None },
            ],
        });
        p.materials.transitions.push(Transition { id: MaterialId("tr".into()), name: "White Flash".into(), duration: Micros(500_000), overlap: false, builtin: Some("white_flash".into()), library: None, resource: None });
        for t in &mut p.tracks {
            for s in &mut t.segments {
                s.attachments.push(MaterialId(if s.id == "c" { "an" } else { "tr" }.into()));
            }
        }
        p
    }

    #[test]
    fn animations_and_transitions_show_and_survive_unedited() {
        let p = animated();
        let doc = to_app_project(&p, &mut |_| None);
        let clips = doc["timeline"]["clips"].as_array().unwrap();
        let c = clips.iter().find(|c| c["clipId"] == "c").unwrap();
        assert_eq!(c["animationIn"], json!({"type": "type_2", "name": "Type 2", "duration": 1.0}));
        assert_eq!(c["captionStyle"], json!("caption_word_color"));
        let v = clips.iter().find(|c| c["clipId"] == "v").unwrap();
        assert_eq!((v["transitionOut"]["type"].as_str(), v["transitionOut"]["duration"].as_f64()), (Some("white_flash"), Some(0.5)));
        let back = import_v1_json(&doc).unwrap().project;
        assert_eq!(segment(&back, "c").attachments, segment(&p, "c").attachments);
        assert_eq!(segment(&back, "v").attachments, segment(&p, "v").attachments);
    }

    #[test]
    fn animation_tab_edits_replace_the_draft_ones() {
        let p = animated();
        let mut doc = to_app_project(&p, &mut |_| None);
        for clip in doc["timeline"]["clips"].as_array_mut().unwrap() {
            if clip["clipId"] == "c" {
                clip["animationIn"] = json!({"type": "typewriter", "duration": 0.8});
                clip["captionStyle"] = json!("caption_one_word");
            } else if clip["clipId"] == "v" {
                clip["transitionOut"] = Value::Null;
            }
        }
        let back = import_v1_json(&doc).unwrap().project;
        let items: Vec<&Animation> = animations(&back, segment(&back, "c"));
        assert_eq!(items.len(), 2);
        let a_in = items.iter().find(|a| a.kind == AnimationKind::In).unwrap();
        assert_eq!((a_in.builtin.as_deref(), a_in.duration), (Some("typewriter"), Micros(800_000)));
        let cap = items.iter().find(|a| a.kind == AnimationKind::Caption).unwrap();
        assert_eq!((cap.builtin.as_deref(), cap.duration), (Some("caption_one_word"), Micros(2_000_000)));
        assert!(!segment(&back, "v").attachments.iter().any(|id| back.materials.transitions.iter().any(|t| &t.id == id)));
        // The draft's effect stays on the video.
        assert!(segment(&back, "v").attachments.contains(&MaterialId("fx".into())));
    }

    #[test]
    fn the_apps_own_clips_get_animations_and_transitions() {
        let p = project();
        let mut doc = to_app_project(&p, &mut |_| None);
        for clip in doc["timeline"]["clips"].as_array_mut().unwrap() {
            clip.as_object_mut().unwrap().remove("engine");
            if clip["type"] == "text" {
                clip["animationIn"] = json!({"type": "type_1", "duration": 0.6});
            } else {
                clip["transitionOut"] = json!({"type": "white_fade", "duration": 1});
            }
        }
        let back = import_v1_json(&doc).unwrap().project;
        let text = back.tracks.iter().flat_map(|t| &t.segments).find(|s| back.materials.texts.iter().any(|t| t.id == s.material)).unwrap();
        let a = animations(&back, text);
        assert_eq!((a.len(), a[0].builtin.as_deref(), a[0].duration), (1, Some("type_1"), Micros(600_000)));
        let video = back.tracks.iter().flat_map(|t| &t.segments).find(|s| back.materials.media.iter().any(|m| m.id == s.material)).unwrap();
        let tr = back.materials.transitions.iter().find(|t| video.attachments.contains(&t.id)).unwrap();
        assert_eq!((tr.builtin.as_deref(), tr.duration), (Some("white_fade"), Micros(1_000_000)));
    }

    /// `clip` split at `cut` seconds as the app splits it (`splitClip`): the right half gets
    /// `id`, starts at the cut and further into its media, and loses the In animation; the
    /// left half loses the transition; a caption's right half starts that far into its speech.
    fn split(doc: &mut Value, clip: &str, id: &str, cut: f64) {
        let clips = doc["timeline"]["clips"].as_array_mut().unwrap();
        let left = clips.iter_mut().find(|c| c["clipId"] == clip).unwrap();
        let mut right = left.clone();
        let start = left["startTick"].as_str().unwrap().parse::<f64>().unwrap() / 1e6;
        let tick = |s: f64| json!(((s * 1e6) as i64).to_string());
        left["endTick"] = tick(cut);
        left["transitionOut"] = Value::Null;
        right["clipId"] = json!(id);
        right["startTick"] = tick(cut);
        right["trimStartTick"] = tick(right["trimStartTick"].as_str().unwrap().parse::<f64>().unwrap() / 1e6 + cut - start);
        if right["type"] == "text" {
            right["animationIn"] = Value::Null;
            right["spokenFrom"] = json!(cut - start);
        }
        clips.push(right);
    }

    #[test]
    fn a_split_keeps_the_in_animation_on_the_left_and_the_transition_on_the_right() {
        let p = animated();
        let mut doc = to_app_project(&p, &mut |_| None);
        split(&mut doc, "c", "c2", 1.0);
        split(&mut doc, "v", "v2", 2.5);
        let back = import_v1_json(&doc).unwrap().project;
        let kinds = |id: &str| animations(&back, segment(&back, id)).iter().map(|a| (a.kind.clone(), a.start, a.duration)).collect::<Vec<_>>();
        // The left caption types in over its whole second; its words are on time.
        assert_eq!(kinds("c"), vec![(AnimationKind::In, Micros(0), Micros(1_000_000)), (AnimationKind::Caption, Micros(0), Micros(2_000_000))]);
        // The right one shows whole, a second into the speech, its caption covering it.
        assert_eq!(kinds("c2"), vec![(AnimationKind::Caption, Micros(-1_000_000), Micros(2_000_000))]);
        let transition = |id: &str| segment(&back, id).attachments.iter().find(|m| back.materials.transitions.iter().any(|t| &t.id == *m)).cloned();
        assert_eq!((transition("v"), transition("v2")), (None, Some(MaterialId("tr".into()))));
        assert_eq!(segment(&back, "v2").target, TimeRange::new(Micros(2_500_000), Micros(2_000_000)));
        assert_eq!(segment(&back, "v2").source.unwrap().start, Micros(3_000_000));
    }

    #[test]
    fn an_in_animation_ends_by_the_end_of_a_clip_trimmed_shorter() {
        let mut p = animated();
        // Also one the engine doesn't draw, on a second caption: kept, and ended in time too.
        let undrawn = Animation { kind: AnimationKind::In, start: Micros(0), duration: Micros(900_000), builtin: None, library: Some(LibraryRef { app: "capcut".into(), resource_id: "2".into(), name: "Glitter Horizon".into(), category: String::new() }), resource: None };
        p.materials.animations.push(Animations { id: MaterialId("an2".into()), items: vec![undrawn] });
        let mut c3 = segment(&p, "c").clone();
        (c3.id, c3.target, c3.attachments) = ("c3".into(), TimeRange::new(Micros(2_000_000), Micros(1_000_000)), vec![MaterialId("an2".into())]);
        p.tracks[1].segments.push(c3);
        let mut doc = to_app_project(&p, &mut |_| None);
        for clip in doc["timeline"]["clips"].as_array_mut().unwrap() {
            match clip["clipId"].as_str() {
                Some("c") => clip["endTick"] = json!("600000"),
                Some("c3") => clip["endTick"] = json!("2500000"),
                _ => {}
            }
        }
        let back = import_v1_json(&doc).unwrap().project;
        let a = animations(&back, segment(&back, "c"));
        assert_eq!(a.iter().find(|a| a.kind == AnimationKind::In).map(|a| (a.builtin.as_deref(), a.duration)), Some((Some("type_2"), Micros(600_000))));
        let a = animations(&back, segment(&back, "c3"));
        assert_eq!(a.iter().map(|a| (a.library.as_ref().unwrap().name.as_str(), a.duration)).collect::<Vec<_>>(), vec![("Glitter Horizon", Micros(500_000))]);
        // The app's own text too: its 2 s animation on a 1 s clip.
        let mut doc = to_app_project(&project(), &mut |_| None);
        let text = doc["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["type"] == "text").unwrap();
        text.as_object_mut().unwrap().remove("engine");
        text["endTick"] = json!("1000000");
        text["animationIn"] = json!({"type": "type_1", "duration": 2});
        let back = import_v1_json(&doc).unwrap().project;
        let seg = back.tracks.iter().flat_map(|t| &t.segments).find(|s| back.materials.texts.iter().any(|t| t.id == s.material)).unwrap();
        assert_eq!(animations(&back, seg)[0].duration, Micros(1_000_000));
    }

    #[test]
    fn a_caption_style_covers_its_clip_after_a_trim() {
        // CapCut's caption a µs short of its clip is left as the draft has it.
        let mut p = animated();
        p.materials.animations[0].items[1].duration = Micros(1_999_999);
        let back = import_v1_json(&to_app_project(&p, &mut |_| None)).unwrap().project;
        assert_eq!(segment(&back, "c").attachments, segment(&p, "c").attachments);
        let p = animated();
        let mut doc = to_app_project(&p, &mut |_| None);
        let clip = doc["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["clipId"] == "c").unwrap();
        clip["endTick"] = json!("3000000");
        let back = import_v1_json(&doc).unwrap().project;
        let cap = animations(&back, segment(&back, "c")).into_iter().find(|a| a.kind == AnimationKind::Caption).unwrap();
        assert_eq!((cap.start, cap.duration, cap.builtin.as_deref()), (Micros(0), Micros(3_000_000), Some("caption_word_color")));
        // A style chosen after the trim covers it too, and a trim of the start (the app moves
        // the caption into its speech) keeps its words on time.
        clip_mut(&mut doc, "c")["captionStyle"] = json!("caption_one_word");
        clip_mut(&mut doc, "c")["startTick"] = json!("500000");
        clip_mut(&mut doc, "c")["spokenFrom"] = json!(0.5);
        let back = import_v1_json(&doc).unwrap().project;
        let cap = animations(&back, segment(&back, "c")).into_iter().find(|a| a.kind == AnimationKind::Caption).unwrap();
        assert_eq!((cap.start, cap.duration, cap.builtin.as_deref()), (Micros(-500_000), Micros(3_000_000), Some("caption_one_word")));
    }

    fn clip_mut<'a>(doc: &'a mut Value, id: &str) -> &'a mut Value {
        doc["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["clipId"] == id).unwrap()
    }

    #[test]
    fn adjust_and_audio_panel_edits_apply_to_a_converted_video() {
        let p = project();
        let mut doc = to_app_project(&p, &mut |_| None);
        let clip = doc["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["clipId"] == "v").unwrap();
        clip["brightness"] = json!(25);
        clip["fadeIn"] = json!(0.5);
        let back = import_v1_json(&doc).unwrap().project;
        let v = segment(&back, "v");
        // The draft's effect stays, the app's adjustment and fade come on top.
        assert!(v.attachments.contains(&MaterialId("fx".into())));
        let adj = back.materials.effects.iter().find(|e| v.attachments.contains(&e.id) && e.builtin.as_deref() == Some("v1:brightness")).unwrap();
        assert_eq!(adj.params["value"], 25.0);
        let fade = back.materials.audio_fades.iter().find(|f| v.attachments.contains(&f.id)).unwrap();
        assert_eq!(fade.fade_in, Micros(500_000));
    }

    /// The project with CapCut's own adjustments on the video, besides its filter: two Adjust
    /// sliders (one the engine draws), colour wheels, an HSL range that changes something and
    /// one that doesn't, and empty curves.
    fn adjusted() -> Project {
        let mut p = project();
        let slider = |id: &str, name: &str, v: f64| {
            let mut params = BTreeMap::new();
            params.insert("intensity".to_string(), v);
            Effect { id: MaterialId(id.into()), category: EffectCategory::Adjust, name: String::new(), params, builtin: Some(name.into()), resource: Some("/bundle/color".into()), library: None, text_style: None }
        };
        p.materials.effects.push(slider("br", "brightness", -0.2));
        p.materials.effects.push(slider("cl", "clarity", 0.02));
        let w = WheelValue { red: 0.1, green: 0.0, blue: 0.0, luma: 0.0, saturation: 0.0 };
        p.materials.color_wheels.push(ColorWheels { id: MaterialId("wh".into()), log: false, lift: w, gamma: WheelValue::default(), gain: WheelValue::default(), offset: WheelValue::default(), intensity: 1.0 });
        p.materials.hsl.push(HslAdjust { id: MaterialId("h1".into()), range: 1, custom_color: None, hue: 0.0, saturation: 0.0, lightness: 0.0 });
        p.materials.hsl.push(HslAdjust { id: MaterialId("h2".into()), range: 2, custom_color: None, hue: 10.0, saturation: 0.0, lightness: 0.0 });
        p.materials.curves.push(ColorCurves { id: MaterialId("cu".into()), luma: Vec::new(), red: Vec::new(), green: Vec::new(), blue: Vec::new() });
        let v = p.tracks.iter_mut().flat_map(|t| &mut t.segments).find(|s| s.id == "v").unwrap();
        v.attachments.extend(["br", "cl", "wh", "h1", "h2", "cu"].map(MaterialId::from));
        p
    }

    #[test]
    fn the_drafts_adjustments_are_listed_on_capcuts_scale() {
        let doc = to_app_project(&adjusted(), &mut |_| None);
        let v = doc["timeline"]["clips"].as_array().unwrap().iter().find(|c| c["clipId"] == "v").unwrap();
        let list = v["draftAdjustments"].as_array().unwrap();
        let ids: Vec<&str> = list.iter().map(|e| e["id"].as_str().unwrap()).collect();
        // In the clip's order; the HSL range and curves that change nothing aren't listed.
        assert_eq!(ids, ["fx", "br", "cl", "wh", "h2"]);
        assert_eq!(list[0], json!({"id": "fx", "kind": "filter", "name": "Film", "drawn": false}));
        assert_eq!(list[1], json!({"id": "br", "kind": "brightness", "name": "Brightness", "value": -10.0, "min": -50.0, "max": 50.0, "drawn": true}));
        // Clarity is one-sided (0…100), and not drawn yet.
        assert_eq!((list[2]["value"].as_f64(), list[2]["max"].as_f64(), list[2]["drawn"].as_bool()), (Some(2.0), Some(100.0), Some(false)));
        assert_eq!((list[3]["kind"].as_str(), list[3]["value"].as_f64(), list[3]["drawn"].as_bool()), (Some("color_wheels"), Some(100.0), Some(true)));
        // Unedited, everything stays as the draft had it.
        let back = import_v1_json(&doc).unwrap().project;
        assert_eq!(segment(&back, "v").attachments, segment(&adjusted(), "v").attachments);
    }

    #[test]
    fn adjust_tab_edits_change_or_remove_the_drafts_adjustments() {
        let p = adjusted();
        let mut doc = to_app_project(&p, &mut |_| None);
        let clip = doc["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["clipId"] == "v").unwrap();
        let list = clip["draftAdjustments"].as_array_mut().unwrap();
        list[1]["value"] = json!(25);
        list[3]["value"] = json!(50);
        // The filter and clarity taken off.
        list.retain(|e| e["id"] != "fx" && e["id"] != "cl");
        let back = import_v1_json(&doc).unwrap().project;
        let v = segment(&back, "v");
        // The edited ones are copies for this clip, in the draft's place.
        assert_eq!(v.attachments, ["v-br", "v-wh", "h1", "h2", "cu"].map(MaterialId::from));
        let br = back.materials.effects.iter().find(|e| e.id.0 == "v-br").unwrap();
        assert_eq!((br.params["intensity"], br.builtin.as_deref(), br.resource.as_deref()), (0.5, Some("brightness"), Some("/bundle/color")));
        assert_eq!(back.materials.color_wheels.iter().find(|w| w.id.0 == "v-wh").unwrap().intensity, 0.5);
        // The draft's own materials are unchanged.
        assert_eq!(back.materials.effects.iter().find(|e| e.id.0 == "br").unwrap().params["intensity"], -0.2);
        assert!(back.validate().is_empty(), "{:?}", back.validate());
    }

    #[test]
    fn a_filter_bars_intensity_sets_the_filters_strength() {
        let mut p = project();
        let mut params = BTreeMap::new();
        params.insert("intensity".to_string(), 0.3);
        p.materials.effects.push(Effect { id: MaterialId("lut".into()), category: EffectCategory::Filter, name: "Sunset".into(), params, builtin: None, resource: Some("/bundle/sunset".into()), library: None, text_style: None });
        p.materials.foreign.push(Foreign { id: MaterialId("st".into()), app: "capcut".into(), kind: "stickers".into(), raw: json!({"name": "Heart"}) });
        let bar = |id: &str, material: &str| Segment { id: id.into(), material: MaterialId(material.into()), source: None, attachments: Vec::new(), render_index: 15000, ..segment(&p, "v").clone() };
        let (filter, sticker) = (bar("f", "lut"), bar("s", "st"));
        p.tracks.push(Track { id: "tf".into(), kind: TrackKind::Filter, name: String::new(), segments: vec![filter], muted: false, hidden: false, locked: false });
        p.tracks.push(Track { id: "ts".into(), kind: TrackKind::Sticker, name: String::new(), segments: vec![sticker], muted: false, hidden: false, locked: false });
        let mut doc = to_app_project(&p, &mut |_| None);
        let clips = doc["timeline"]["clips"].as_array_mut().unwrap();
        let f = clips.iter().find(|c| c["clipId"] == "f").unwrap();
        assert_eq!((f["intensity"].as_f64(), f["drawn"].as_bool(), f["draftKind"].as_str()), (Some(30.0), Some(true), Some("filter")));
        let s = clips.iter().find(|c| c["clipId"] == "s").unwrap();
        assert_eq!((s["name"].as_str(), s["drawn"].as_bool(), s["draftKind"].as_str()), (Some("Heart"), Some(false), Some("sticker")));
        for c in clips.iter_mut().filter(|c| c["clipId"] == "f") {
            c["intensity"] = json!(80);
        }
        let back = import_v1_json(&doc).unwrap().project;
        let f = segment(&back, "f");
        let e = back.materials.effects.iter().find(|e| e.id == f.material).unwrap();
        assert_eq!((e.params["intensity"], e.resource.as_deref(), e.category), (0.8, Some("/bundle/sunset"), EffectCategory::Filter));
        assert_eq!(back.materials.effects.iter().find(|e| e.id.0 == "lut").unwrap().params["intensity"], 0.3);
    }

    /// The app resizes a caption's box about its middle when the engine lays the text out
    /// anew (a new font, say): the text stays where it was. A move still moves it.
    #[test]
    fn a_captions_box_follows_its_text_without_moving_it() {
        let p = project();
        let mut doc = to_app_project(&p, &mut |_| Some([400.0, 900.0, 280.0, 120.0]));
        let clip = doc["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["clipId"] == "c").unwrap();
        clip["fontFamily"] = json!("Georgia");
        let t = &mut clip["transform"];
        let (w, h) = (t["width"].as_f64().unwrap(), t["height"].as_f64().unwrap());
        t["x"] = json!(t["x"].as_f64().unwrap() - 20.0);
        t["width"] = json!(w + 40.0);
        t["y"] = json!(t["y"].as_f64().unwrap() - 5.0);
        t["height"] = json!(h + 10.0);
        let back = import_v1_json(&doc).unwrap().project;
        let c = segment(&back, "c");
        let was = segment(&p, "c").transform.position.value;
        assert!((c.transform.position.value.x - was.x).abs() < 1e-9 && (c.transform.position.value.y - was.y).abs() < 1e-9, "{:?}", c.transform.position.value);
        assert_eq!(c.transform.scale.value, segment(&p, "c").transform.scale.value);
        // Moved 30 world units right as well.
        let clip = doc["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["clipId"] == "c").unwrap();
        clip["transform"]["x"] = json!(clip["transform"]["x"].as_f64().unwrap() + 30.0);
        let back = import_v1_json(&doc).unwrap().project;
        let dx = segment(&back, "c").transform.position.value.x - was.x;
        assert!((dx - 30.0 / (WORLD_H * 1080.0 / 1920.0) * 2.0).abs() < 1e-9, "{dx}");
    }

    /// The Text tab's case buttons send the words in the new case as well; the caption keeps
    /// its spoken-word timing (and so its caption style). New words drop it.
    #[test]
    fn a_case_change_keeps_a_captions_spoken_words() {
        let mut p = project();
        let words = vec![SpokenWord { range: (0, 5), start: Micros(0), end: Micros(500_000) }, SpokenWord { range: (6, 11), start: Micros(500_000), end: Micros(1_000_000) }];
        p.materials.texts[0].words = words.clone();
        let edit = |text: &str, transform: &str| {
            let mut doc = to_app_project(&p, &mut |_| None);
            let clip = doc["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["clipId"] == "c").unwrap();
            clip["text"] = json!(text);
            clip["textTransform"] = json!(transform);
            let back = import_v1_json(&doc).unwrap().project;
            back.materials.texts.iter().find(|t| t.id == segment(&back, "c").material).unwrap().clone()
        };
        let upper = edit("HELLO THERE", "uppercase");
        assert_eq!((upper.text.as_str(), &upper.words), ("HELLO THERE", &words));
        assert!(edit("Goodbye now", "none").words.is_empty());
    }

    #[test]
    fn texts_laid_out_anew_are_the_ones_whose_words_or_style_changed() {
        let p = project();
        let doc = to_app_project(&p, &mut |_| None);
        let first = import_v1_json(&doc).unwrap().project;
        let edit = |key: &str, value: Value| {
            let mut d = doc.clone();
            for c in d["timeline"]["clips"].as_array_mut().unwrap() {
                if c.get(key).is_some() {
                    c[key] = value.clone();
                }
            }
            import_v1_json(&d).unwrap().project
        };
        let upper = edit("textTransform", json!("uppercase"));
        assert_eq!(relaid_texts(&first, &upper), ["c"]);
        // Back to the draft's own text: laid out anew again.
        assert_eq!(relaid_texts(&upper, &first), ["c"]);
        // A video edit, or none, changes no text.
        assert!(relaid_texts(&first, &edit("brightness", json!(30))).is_empty());
        assert!(relaid_texts(&first, &first).is_empty());
    }

    #[test]
    fn edits_in_the_app_apply_on_top() {
        let p = project();
        let mut doc = to_app_project(&p, &mut |_| None);
        let world_w = WORLD_H * 1080.0 / 1920.0;
        for clip in doc["timeline"]["clips"].as_array_mut().unwrap() {
            if clip["clipId"] == "v" {
                // Moved 30 world units right and made twice as wide and tall.
                let t = &mut clip["transform"];
                t["x"] = json!(t["x"].as_f64().unwrap() + 30.0);
                t["scaleX"] = json!(2.0);
                t["scaleY"] = json!(2.0);
                // Trimmed: starts a second (30 frames) later.
                clip["startTick"] = json!("1500000");
            } else {
                clip["text"] = json!("Bye");
            }
        }
        let back = import_v1_json(&doc).unwrap().project;
        let v = segment(&back, "v");
        assert_eq!(v.target.start, Micros(1_500_000));
        // Doubling the box about its corner moves its centre by half its size, plus the move.
        assert_eq!(v.transform.scale.value, Vec2::new(1.0, 1.0));
        assert_eq!(v.transform.position.keys.len(), 2);
        let orig = segment(&p, "v");
        let dx = v.transform.position.keys[1].value.x - orig.transform.position.keys[1].value.x;
        assert!(dx > 30.0 / world_w * 2.0, "{dx}");
        assert_eq!(v.attachments, orig.attachments);
        let text = back.materials.texts.iter().find(|t| t.id == segment(&back, "c").material).unwrap();
        assert_eq!((text.text.as_str(), text.runs[0].range), ("Bye", (0, 3)));
        assert!(back.materials.texts.iter().any(|t| t.text == "Hello there"));
    }
}
