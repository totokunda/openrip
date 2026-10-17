//! A model project (a CapCut draft, say) as the app's own project JSON, so the app can open
//! and edit it. The app's clips describe only what its editor knows (timing, a box on the
//! canvas, a text, a volume), so each clip also carries the segment it came from and the
//! materials that segment uses, under `engine`, with the clip fields as written (`base`).
//! [`crate::import_v1_json`] puts the segment back and applies on top only what the app
//! changed since: a move, a resize, a turn, a trim, a new text. Everything else (caption
//! styles, animations, effects, masks, keyframes, exact timing) is drawn as CapCut drew it.

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
            clip.insert("intensity".into(), json!(100));
        }
    }

    // What the engine needs to draw it as it was, and the app's fields as written, so an
    // import can tell what the app changed.
    let base_keys = ["startTick", "endTick", "trimStartTick", "trimEndTick", "speed", "volume", "transform", "text", "fontSize", "color"];
    let base: Map<String, Value> = base_keys.iter().filter_map(|k| clip.get(*k).map(|v| (k.to_string(), v.clone()))).collect();
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
            runs: vec![TextRun { range: (0, 11), font: FontRef { name: "Arial".into(), path: String::new() }, size: 15.0, size_unit: SizeUnit::CapCut, fill: Rgba::WHITE, stroke: None, bold: false, italic: false, underline: false }],
            layout: TextLayout { alignment: 1, letter_spacing: 0.0, line_spacing: 0.0, line_height: None, kerning: false, background: None, shadow: None, max_width: None, curve: 0.0, frame: None },
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
