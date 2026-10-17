//! Import projects saved by the TypeScript app (`project-<N>.json`, format "1.0.0").
//!
//! The v1 format is documented in `docs/inventory/current-app.md` §11. Conversions:
//! - **Time.** v1 stores integer frames as "ticks" (µs) computed with truncating
//!   maths at the *rounded* fps, so some frames come back one short. The frame is
//!   recovered by rounding, then placed with exact rational frame timing.
//! - **Geometry.** v1 positions clips in "world units" on a canvas 600 units tall,
//!   by the top-left of the unrotated box, rotating media/text/rect/line about that
//!   corner and ellipse/polygon/star about the centre. This is converted to the
//!   model's centred, normalised, +y-up transform.
//! - **Audio.** v1 volume is dB; the model stores linear gain. Fades become materials.
//! - **Tracks.** v1 lists tracks top row first; the model lists them bottom first.
//!
//! AI clips (`model`) are dropped; masks are reported until the model supports them.

use std::collections::BTreeMap;
use std::path::Path;

use openrip_model::*;
use serde::Serialize;
use serde_json::Value;

const APP: &str = "openrip-v1";
/// v1 canvas height in world units (`BASE_LONG_SIDE`).
pub(crate) const WORLD_H: f64 = 600.0;

mod app;
pub use app::to_app_project;

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("can't read {path}: {source}")]
    Io { path: String, source: std::io::Error },
    #[error("{path} is not valid JSON: {source}")]
    Json { path: String, source: serde_json::Error },
    #[error("not a v1 project: {0}")]
    NotAProject(String),
}

pub struct Imported {
    pub project: Project,
    pub report: ImportReport,
}

#[derive(Debug, Default, Serialize)]
pub struct ImportReport {
    pub tracks: usize,
    pub segments: usize,
    /// Clips that were not imported, by reason.
    pub dropped: BTreeMap<String, usize>,
    /// Clip features kept verbatim (as `Foreign` materials) but not interpreted yet.
    pub kept_foreign: BTreeMap<String, usize>,
    /// Overlapping clips moved onto a new track (v1 allowed some overlaps).
    pub moved_to_new_track: usize,
    pub missing_media: Vec<String>,
    pub warnings: Vec<String>,
    pub problems: Vec<String>,
}

fn bump(map: &mut BTreeMap<String, usize>, key: &str) {
    *map.entry(key.to_string()).or_insert(0) += 1;
}

// ---- tolerant accessors ------------------------------------------------------

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}
fn f(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(Value::as_f64).filter(|x| x.is_finite()).unwrap_or(default)
}
fn b(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}
fn hex(v: &Value, key: &str, default: Rgba) -> Rgba {
    v.get(key).and_then(Value::as_str).and_then(Rgba::from_hex).unwrap_or(default)
}

/// Decode a `file://` URL (as v1 stores asset paths) to a filesystem path.
fn file_url_to_path(url: &str) -> String {
    let Some(rest) = url.strip_prefix("file://") else { return url.to_string() };
    let bytes = rest.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&rest[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---- time --------------------------------------------------------------------

struct Clock {
    fps: FrameRate,
    /// v1 computed ticks with `round(fps)`.
    tick_fps: i128,
}

impl Clock {
    /// Recover the integer frame from a v1 tick string (truncated on save).
    fn tick_to_frame(&self, tick: &str) -> Option<i64> {
        let t: i128 = tick.trim().parse().ok()?;
        if t == 1 || t == 2 {
            return Some(0); // ±∞ sentinels; clip fields never really use them
        }
        let num = t * self.tick_fps;
        Some(((num + 500_000).div_euclid(1_000_000)) as i64)
    }

    fn frame(&self, clip: &Value, tick_key: &str, frame_key: &str) -> i64 {
        clip.get(tick_key)
            .and_then(Value::as_str)
            .and_then(|t| self.tick_to_frame(t))
            .or_else(|| clip.get(frame_key).and_then(Value::as_f64).filter(|x| x.is_finite()).map(|x| x.round() as i64))
            .unwrap_or(0)
    }

    fn at(&self, frame: i64) -> Micros {
        self.fps.frame_start(frame)
    }
}

// ---- geometry ----------------------------------------------------------------

pub(crate) struct World {
    pub(crate) w: f64,
    pub(crate) h: f64,
}

/// v1 `ClipTransform` → model `Transform` + crop + opacity.
fn convert_transform(
    world: &World,
    t: &Value,
    center_pivot: bool,
    fit: Option<(f64, f64)>,
) -> (Transform, Option<CropRect>, f32) {
    let (x, y) = (f(t, "x", 0.0), f(t, "y", 0.0));
    let (w, h) = (f(t, "width", 0.0) * f(t, "scaleX", 1.0), f(t, "height", 0.0) * f(t, "scaleY", 1.0));
    let theta = f(t, "rotation", 0.0).to_radians();
    // Centre of the box in world units (y down). Konva rotates clockwise about the node origin.
    let (cx, cy) = if center_pivot {
        (x + w / 2.0, y + h / 2.0)
    } else {
        let (c, sn) = (theta.cos(), theta.sin());
        (x + c * w / 2.0 - sn * h / 2.0, y + sn * w / 2.0 + c * h / 2.0)
    };
    let mut transform = Transform {
        position: Animated::constant(Vec2::new(cx / world.w * 2.0 - 1.0, 1.0 - cy / world.h * 2.0)),
        rotation: Animated::constant(f(t, "rotation", 0.0)),
        ..Transform::default()
    };
    let crop = t.get("crop").filter(|c| c.is_object()).map(|c| CropRect {
        x: f(c, "x", 0.0),
        y: f(c, "y", 0.0),
        width: f(c, "width", 1.0),
        height: f(c, "height", 1.0),
    });
    if let Some((fit_w, fit_h)) = fit {
        if fit_w > 0.0 && fit_h > 0.0 && w > 0.0 && h > 0.0 {
            transform.scale = Animated::constant(Vec2::new(w / fit_w, h / fit_h));
        }
    }
    let crop = crop.filter(|c| *c != CropRect::FULL);
    (transform, crop, (f(t, "opacity", 100.0) / 100.0) as f32)
}

/// Size of a source of `media_w`×`media_h` (after `crop`) contain-fitted into the world rect.
fn contain_fit(world: &World, media_w: f64, media_h: f64, crop: Option<CropRect>) -> Option<(f64, f64)> {
    let c = crop.unwrap_or(CropRect::FULL);
    let (sw, sh) = (media_w * c.width, media_h * c.height);
    if sw <= 0.0 || sh <= 0.0 {
        return None;
    }
    let src_aspect = sw / sh;
    Some(if src_aspect > world.w / world.h {
        (world.w, world.w / src_aspect)
    } else {
        (world.h * src_aspect, world.h)
    })
}

/// Output canvas for an aspect ratio: long side 1920, even dimensions.
fn canvas_for_aspect(aw: f64, ah: f64) -> Canvas {
    let even = |v: f64| ((v / 2.0).round() as u32).max(1) * 2;
    if aw >= ah {
        Canvas { width: 1920, height: even(1920.0 * ah / aw) }
    } else {
        Canvas { width: even(1920.0 * aw / ah), height: 1920 }
    }
}

// ---- entry points --------------------------------------------------------------

pub fn import_v1_file(path: &Path) -> Result<Imported, ImportError> {
    let raw = std::fs::read(path).map_err(|source| ImportError::Io { path: path.display().to_string(), source })?;
    let doc: Value =
        serde_json::from_slice(&raw).map_err(|source| ImportError::Json { path: path.display().to_string(), source })?;
    import_v1_json(&doc)
}

pub fn import_v1_json(doc: &Value) -> Result<Imported, ImportError> {
    let timeline = doc.get("timeline").filter(|t| t.is_object()).ok_or_else(|| ImportError::NotAProject("no timeline".into()))?;
    let mut report = ImportReport::default();
    let settings = doc.get("settings").cloned().unwrap_or(Value::Null);
    let meta = doc.get("meta").cloned().unwrap_or(Value::Null);

    let fps_raw = f(&settings, "fps", 24.0).max(1.0);
    let clock = Clock { fps: FrameRate::from_f64(fps_raw), tick_fps: fps_raw.round().max(1.0) as i128 };
    let ar = settings.get("aspectRatio").cloned().unwrap_or(Value::Null);
    let (aw, ah) = (f(&ar, "width", 16.0).max(1e-6), f(&ar, "height", 9.0).max(1e-6));
    let world = World { w: WORLD_H * aw / ah, h: WORLD_H };

    let mut project = Project::new(
        { let id = s(&meta, "id"); if id.is_empty() { format!("v1-{}", meta.get("projectId").and_then(Value::as_i64).unwrap_or(0)) } else { id } },
        { let n = s(&meta, "name"); if n.is_empty() { "Untitled Project".to_string() } else { n } },
        // The exact canvas of a converted draft, while the app's aspect ratio still matches it.
        settings
            .get("engineCanvas")
            .and_then(|c| Some(Canvas { width: c.get("width")?.as_u64()? as u32, height: c.get("height")?.as_u64()? as u32 }))
            .filter(|c| c.width > 0 && c.height > 0 && ((c.width as f64 / c.height as f64) / (aw / ah) - 1.0).abs() < 0.01)
            // An aspect ratio given in pixels (the app's presets, a converted draft) is the
            // canvas itself.
            .or_else(|| (aw.fract() == 0.0 && ah.fract() == 0.0 && (64.0..=8192.0).contains(&aw) && (64.0..=8192.0).contains(&ah)).then(|| Canvas { width: aw as u32, height: ah as u32 }))
            .unwrap_or_else(|| canvas_for_aspect(aw, ah)),
        clock.fps,
    );
    project.imported_from = Some(ImportSource { app: APP.into(), version: s(doc, "version") });

    // Assets → media materials.
    let assets = doc.get("assets").and_then(Value::as_object).cloned().unwrap_or_default();
    for (id, a) in &assets {
        let kind = match s(a, "type").as_str() {
            "audio" => MediaKind::Audio,
            "image" => MediaKind::Photo,
            _ => MediaKind::Video,
        };
        project.materials.media.push(Media {
            id: MaterialId(id.clone()),
            kind,
            path: file_url_to_path(&s(a, "path")),
            width: f(a, "width", 0.0) as u32,
            height: f(a, "height", 0.0) as u32,
            duration: Micros::from_secs_f64(f(a, "duration", 0.0)),
            has_audio: kind != MediaKind::Photo,
            matte: None,
        });
    }

    // Tracks: v1 top row first → model bottom first.
    let mut tracks: Vec<Track> = Vec::new();
    for t in timeline.get("tracks").and_then(Value::as_array).into_iter().flatten().rev() {
        let kind = match s(t, "type").as_str() {
            "media" => TrackKind::Video,
            "audio" => TrackKind::Audio,
            "text" => TrackKind::Text,
            "filter" => TrackKind::Filter,
            "shape" | "draw" => TrackKind::Graphic,
            other => {
                report.warnings.push(format!("skipped track of unknown type {other:?}"));
                continue;
            }
        };
        tracks.push(Track {
            id: s(t, "timelineId"),
            kind,
            name: String::new(),
            segments: Vec::new(),
            muted: b(t, "muted"),
            hidden: b(t, "hidden"),
            locked: false,
        });
    }

    // Grouped clips draw where their group sits, the group's first child on top, and its
    // track hides or mutes them (`lib/clipOrdering.ts`): each child gets a track of its own
    // just above the group's.
    let clips_json: Vec<&Value> = timeline.get("clips").and_then(Value::as_array).into_iter().flatten().collect();
    let mut grouped: BTreeMap<String, (String, usize, usize)> = BTreeMap::new(); // child → (group track, rank, count)
    for g in clips_json.iter().filter(|c| s(c, "type") == "group") {
        let children: Vec<String> = g.get("children").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_array).flatten().filter_map(Value::as_str).map(String::from).collect();
        for (rank, child) in children.iter().enumerate() {
            grouped.insert(child.clone(), (s(g, "timelineId"), rank, children.len()));
        }
    }
    // Sort keys for the tracks: the file's own in order, children just above their group's.
    let mut order: Vec<f64> = (0..tracks.len()).map(|i| i as f64).collect();

    for clip in clips_json.iter().copied() {
        let ty = s(clip, "type");
        match ty.as_str() {
            "model" => {
                bump(&mut report.dropped, "model (AI generation clip)");
                continue;
            }
            "group" => {
                // Group containers have no content; their children are ordinary clips.
                bump(&mut report.dropped, "group container (children kept)");
                continue;
            }
            "video" | "image" | "audio" | "text" | "filter" | "shape" | "draw" => {}
            other => {
                bump(&mut report.dropped, &format!("unknown clip type {other}"));
                continue;
            }
        }
        // A clip converted from a CapCut draft (or any model project) carries its segment.
        let converted = match clip.get("engine").filter(|e| e.get("segment").is_some()) {
            Some(engine) => engine_segment(clip, engine, &ty, &clock, &world, &mut project.materials, &mut report),
            None => convert_clip(clip, &ty, &clock, &world, &mut project.materials, &mut report).map(|seg| {
                let kind = match ty.as_str() {
                    "video" | "image" => TrackKind::Video,
                    "audio" => TrackKind::Audio,
                    "text" => TrackKind::Text,
                    "filter" => TrackKind::Filter,
                    _ => TrackKind::Graphic,
                };
                (seg, kind)
            }),
        };
        if let Some((seg, wanted)) = converted {
            // A filter track holding a draft's effects or stickers takes their kind.
            if let Some(t) = tracks.iter_mut().find(|t| t.id == s(clip, "timelineId") && t.kind != wanted && t.segments.is_empty() && clip.get("engine").is_some()) {
                t.kind = wanted;
            }
            if let Some((group_track, rank, count)) = grouped.get(&s(clip, "clipId")) {
                if let Some(gi) = tracks.iter().position(|t| &t.id == group_track) {
                    let g = &tracks[gi];
                    let track = Track { id: format!("{}-{}", group_track, s(clip, "clipId")), kind: wanted, name: String::new(), segments: vec![seg], muted: g.muted, hidden: g.hidden, locked: false };
                    // The last child lowest, the first on top, all between the group's track and the next.
                    order.push(order[gi] + 0.5 + 0.4 * (count - rank) as f64 / (count + 1) as f64);
                    tracks.push(track);
                    continue;
                }
            }
            let track_id = s(clip, "timelineId");
            let ti = match tracks.iter().position(|t| t.id == track_id && t.kind == wanted) {
                Some(i) => i,
                None => {
                    report.warnings.push(format!("{ty} clip without a matching track; created one"));
                    order.push(order.get(tracks.iter().position(|t| t.id == track_id).unwrap_or(usize::MAX)).copied().unwrap_or(tracks.len() as f64) + 0.05);
                    tracks.push(Track {
                        id: format!("{track_id}-{ty}"),
                        kind: wanted,
                        name: String::new(),
                        segments: Vec::new(),
                        muted: false,
                        hidden: false,
                        locked: false,
                    });
                    tracks.len() - 1
                }
            };
            tracks[ti].segments.push(seg);
        }
    }

    let mut keyed: Vec<(f64, Track)> = order.into_iter().zip(tracks).collect();
    keyed.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut tracks: Vec<Track> = keyed.into_iter().map(|(_, t)| t).collect();

    // Resolve overlaps by moving clips onto a new track just above.
    let mut i = 0;
    while i < tracks.len() {
        tracks[i].segments.sort_by_key(|s| s.target.start);
        let mut keep: Vec<Segment> = Vec::new();
        let mut spill: Vec<Segment> = Vec::new();
        for seg in tracks[i].segments.drain(..) {
            if keep.last().is_some_and(|prev: &Segment| prev.target.overlaps(&seg.target)) {
                spill.push(seg);
            } else {
                keep.push(seg);
            }
        }
        tracks[i].segments = keep;
        if !spill.is_empty() {
            report.moved_to_new_track += spill.len();
            let t = &tracks[i];
            let extra = Track {
                id: format!("{}-overlap", t.id),
                kind: t.kind,
                name: String::new(),
                segments: spill,
                muted: t.muted,
                hidden: t.hidden,
                locked: false,
            };
            tracks.insert(i + 1, extra);
        }
        i += 1;
    }

    // Stacking: later (higher) tracks draw on top.
    for (index, t) in tracks.iter_mut().enumerate() {
        for seg in &mut t.segments {
            seg.render_index = index as i32;
        }
    }
    report.tracks = tracks.len();
    report.segments = tracks.iter().map(|t| t.segments.len()).sum();
    project.tracks = tracks;

    for m in &project.materials.media {
        if !m.path.is_empty() && !Path::new(&m.path).exists() {
            report.missing_media.push(m.path.clone());
        }
    }
    report.problems = project.validate();
    Ok(Imported { project, report })
}

/// A clip the app opened from a converted project (`app.rs`): its own segment and materials,
/// with whatever the app changed since applied on top (timing, a move, resize or turn,
/// opacity, volume, the text, its size and colour).
fn engine_segment(clip: &Value, engine: &Value, ty: &str, clock: &Clock, world: &World, materials: &mut Materials, report: &mut ImportReport) -> Option<(Segment, TrackKind)> {
    let Ok(mut seg) = serde_json::from_value::<Segment>(engine.get("segment")?.clone()) else {
        report.warnings.push("a converted clip's segment couldn't be read; skipped".into());
        return None;
    };
    let kind = engine.get("track").and_then(Value::as_str).and_then(app::kind_from_name)?;
    for m in engine.get("materials").and_then(Value::as_array).into_iter().flatten() {
        match serde_json::from_value::<AnyMaterial>(m.clone()) {
            // The app's asset stands for the media (it may have been relinked), keeping what
            // only the draft knows: CapCut's saved background removal.
            Ok(AnyMaterial::Media(m)) => match materials.media.iter_mut().find(|a| a.id == m.id) {
                Some(asset) => asset.matte = asset.matte.take().or(m.matte),
                None => materials.media.push(m),
            },
            Ok(m) if !materials.contains(m.id()) => materials.insert_at(m, None),
            _ => {}
        }
    }
    // A clip split in the app keeps its payload in both halves: the clip id tells them apart.
    let id = s(clip, "clipId");
    if !id.is_empty() {
        seg.id = id;
    }
    let base = engine.get("base").cloned().unwrap_or(Value::Null);
    let changed = |k: &str| clip.get(k) != base.get(k);

    if ["startTick", "endTick", "trimStartTick", "trimEndTick", "speed"].into_iter().any(changed) {
        let (start, end) = (clock.frame(clip, "startTick", "startFrame"), clock.frame(clip, "endTick", "endFrame"));
        let target = TimeRange::new(clock.at(start), clock.at(end) - clock.at(start));
        if target.duration.0 <= 0 {
            return None;
        }
        if seg.source.is_some() {
            let speed = f(clip, "speed", seg.speed).clamp(0.1, 100.0);
            let trim_start = clock.frame(clip, "trimStartTick", "trimStart").max(0);
            seg.source = Some(TimeRange::new(Micros((clock.at(trim_start).0 as f64 * speed).round() as i64), Micros((target.duration.0 as f64 * speed).round() as i64)));
            seg.speed = speed;
        }
        seg.target = target;
    }
    if changed("volume") {
        seg.volume = Animated::constant(10f64.powf(f(clip, "volume", 0.0) / 20.0) as f32);
    }
    if changed("transform") {
        apply_moves(&mut seg, base.get("transform"), clip.get("transform"), world, ty == "text");
    }
    if ty == "text" && ["text", "fontSize", "color"].into_iter().any(changed) {
        edit_text(&mut seg, clip, &base, materials);
    }
    Some((seg, kind))
}

/// The app's move, resize, turn and opacity change of a converted clip, applied to its own
/// transform (keyframes included). A text box's size follows its text in the app, so a text
/// clip is resized only by its scale.
fn apply_moves(seg: &mut Segment, base: Option<&Value>, now: Option<&Value>, world: &World, text: bool) {
    let (Some(b), Some(t)) = (base, now) else { return };
    let (bsx, bsy, tsx, tsy) = (f(b, "scaleX", 1.0), f(b, "scaleY", 1.0), f(t, "scaleX", 1.0), f(t, "scaleY", 1.0));
    let (bw, bh) = (f(b, "width", 1.0) * bsx, f(b, "height", 1.0) * bsy);
    let (kx, ky, tw, th) = if text {
        let (kx, ky) = (tsx / bsx, tsy / bsy);
        (kx, ky, bw * kx, bh * ky)
    } else {
        let (tw, th) = (f(t, "width", 1.0) * tsx, f(t, "height", 1.0) * tsy);
        (tw / bw, th / bh, tw, th)
    };
    let centre = |v: &Value, w: f64, h: f64| {
        let (sn, cs) = f(v, "rotation", 0.0).to_radians().sin_cos();
        (f(v, "x", 0.0) + cs * w / 2.0 - sn * h / 2.0, f(v, "y", 0.0) + sn * w / 2.0 + cs * h / 2.0)
    };
    let ((bx, by), (tx, ty)) = (centre(b, bw, bh), centre(t, tw, th));
    let d = Vec2::new((tx - bx) / world.w * 2.0, -(ty - by) / world.h * 2.0);
    let turn = f(t, "rotation", 0.0) - f(b, "rotation", 0.0);
    let tr = &mut seg.transform;
    if d.x.abs() > 1e-9 || d.y.abs() > 1e-9 {
        let shift = |p: &mut Vec2| *p = Vec2::new(p.x + d.x, p.y + d.y);
        shift(&mut tr.position.value);
        tr.position.keys.iter_mut().for_each(|k| shift(&mut k.value));
    }
    if kx.is_finite() && ky.is_finite() && ((kx - 1.0).abs() > 1e-9 || (ky - 1.0).abs() > 1e-9) {
        let grow = |s: &mut Vec2| *s = Vec2::new(s.x * kx, s.y * ky);
        grow(&mut tr.scale.value);
        tr.scale.keys.iter_mut().for_each(|k| grow(&mut k.value));
    }
    if turn.abs() > 1e-9 {
        tr.rotation.value += turn;
        tr.rotation.keys.iter_mut().for_each(|k| k.value += turn);
    }
    if b.get("opacity") != t.get("opacity") {
        seg.opacity = Animated::constant((f(t, "opacity", 100.0) / 100.0) as f32);
    }
}

/// A converted text clip whose text, size or colour the app changed: a copy of its text
/// material for this clip, edited. New words drop the old spoken-word timing.
fn edit_text(seg: &mut Segment, clip: &Value, base: &Value, materials: &mut Materials) {
    let Some(mut t) = materials.texts.iter().find(|m| m.id == seg.material).cloned() else { return };
    t.id = MaterialId(format!("{}-text", seg.id));
    if clip.get("text") != base.get("text") {
        t.text = s(clip, "text");
        let n = t.text.chars().count() as u32;
        t.runs.truncate(1);
        if let Some(r) = t.runs.first_mut() {
            r.range = (0, n);
        }
        t.words.clear();
    }
    let (now, was) = (f(clip, "fontSize", 0.0), f(base, "fontSize", 0.0));
    if now > 0.0 && was > 0.0 && (now - was).abs() > 1e-9 {
        t.runs.iter_mut().for_each(|r| r.size *= (now / was) as f32);
    }
    if clip.get("color") != base.get("color") {
        if let Some(c) = Rgba::from_hex(&s(clip, "color")) {
            t.runs.iter_mut().for_each(|r| r.fill = Rgba { a: r.fill.a, ..c });
        }
    }
    seg.material = t.id.clone();
    materials.texts.retain(|m| m.id != t.id);
    materials.texts.push(t);
}

fn convert_clip(
    clip: &Value,
    ty: &str,
    clock: &Clock,
    world: &World,
    materials: &mut Materials,
    report: &mut ImportReport,
) -> Option<Segment> {
    let id = s(clip, "clipId");
    let start = clock.frame(clip, "startTick", "startFrame");
    let end = clock.frame(clip, "endTick", "endFrame");
    let target = TimeRange::new(clock.at(start), clock.at(end) - clock.at(start));
    if target.duration.0 <= 0 {
        report.warnings.push(format!("{ty} clip with no duration skipped"));
        return None;
    }
    let is_av = matches!(ty, "video" | "audio");
    let speed = if is_av { f(clip, "speed", 1.0).clamp(0.1, 100.0) } else { 1.0 };
    let mut attachments = Vec::new();

    // Source range. v1 trims are in timeline frames before speed (preview semantics).
    let source = match ty {
        "video" | "audio" => {
            let trim_start = clock.frame(clip, "trimStartTick", "trimStart").max(0);
            let src_start = Micros((clock.at(trim_start).0 as f64 * speed).round() as i64);
            Some(TimeRange::new(src_start, Micros((target.duration.0 as f64 * speed).round() as i64)))
        }
        "image" => Some(TimeRange::new(Micros::ZERO, target.duration)),
        _ => None,
    };

    let material = match ty {
        "video" | "image" | "audio" => {
            let asset = s(clip, "assetId");
            if !materials.contains(&MaterialId(asset.clone())) {
                bump(&mut report.dropped, &format!("{ty} clip whose asset is missing"));
                return None;
            }
            MaterialId(asset)
        }
        "text" => {
            let mid = MaterialId(format!("{id}-text"));
            materials.texts.push(convert_text(&mid, clip, world));
            mid
        }
        "filter" => {
            let mid = MaterialId(format!("{id}-filter"));
            let resource = [s(clip, "fullPath"), s(clip, "smallPath")].into_iter().find(|p| !p.is_empty());
            let mut params = BTreeMap::new();
            params.insert("intensity".to_string(), f(clip, "intensity", 100.0).clamp(0.0, 100.0) / 100.0);
            materials.effects.push(Effect {
                id: mid.clone(),
                category: EffectCategory::Filter,
                name: s(clip, "name"),
                params,
                builtin: Some("lut".into()),
                resource,
                library: None,
                text_style: None,
            });
            mid
        }
        "shape" | "draw" => {
            let mid = MaterialId(format!("{id}-{ty}"));
            materials.shapes.push(if ty == "shape" { convert_shape(&mid, clip) } else { convert_drawing(&mid, clip, world) });
            mid
        }
        _ => {
            bump(&mut report.kept_foreign, ty);
            let mid = MaterialId(format!("{id}-{ty}"));
            materials.foreign.push(Foreign { id: mid.clone(), app: APP.into(), kind: ty.into(), raw: clip.clone() });
            mid
        }
    };

    // Audio: dB → linear, fades → material.
    let mut volume = Animated::constant(1.0f32);
    if is_av {
        volume = Animated::constant(10f64.powf(f(clip, "volume", 0.0) / 20.0) as f32);
        let (fade_in, fade_out) = (f(clip, "fadeIn", 0.0), f(clip, "fadeOut", 0.0));
        if fade_in > 0.0 || fade_out > 0.0 {
            let mid = MaterialId(format!("{id}-fade"));
            materials.audio_fades.push(AudioFade {
                id: mid.clone(),
                fade_in: Micros::from_secs_f64(fade_in),
                fade_out: Micros::from_secs_f64(fade_out),
            });
            attachments.push(mid);
        }
    }

    // Adjustments (video/image): keep v1's own scale under a "v1:" name until the
    // colour milestone defines a shared adjustment scale.
    if matches!(ty, "video" | "image") {
        for name in ["brightness", "contrast", "hue", "saturation", "sharpness", "noise", "blur", "vignette"] {
            let v = f(clip, name, 0.0);
            if v != 0.0 {
                let mid = MaterialId(format!("{id}-adj-{name}"));
                let mut params = BTreeMap::new();
                params.insert("value".to_string(), v);
                // The app filters the clip on a canvas of its picture fitted to the world, so
                // its pixel distances (blur, sharpness, grain) are world units.
                params.insert("pixel".to_string(), 1.0 / WORLD_H);
                materials.effects.push(Effect {
                    id: mid.clone(),
                    category: EffectCategory::Adjust,
                    name: name.into(),
                    params,
                    builtin: Some(format!("v1:{name}")),
                    resource: None,
                    library: None,
                    text_style: None,
                });
                attachments.push(mid);
            }
        }
        for m in convert_masks(&id, clip, clock.fps.as_f64(), report) {
            attachments.push(m.id.clone());
            materials.masks.push(m);
        }
    }

    // Geometry.
    let (transform, crop, opacity) = match (ty, clip.get("transform").filter(|t| t.is_object())) {
        ("audio" | "filter", _) | (_, None) => (Transform::default(), None, 1.0),
        // A drawing covers the canvas; its lines carry their own transforms.
        ("draw", Some(t)) => (Transform::default(), None, (f(t, "opacity", 100.0) / 100.0) as f32),
        (_, Some(t)) => {
            let shape_type = s(clip, "shapeType");
            let center_pivot = ty == "shape" && matches!(shape_type.as_str(), "ellipse" | "polygon" | "star");
            let fit = if matches!(ty, "video" | "image") {
                let (mw, mh) = (f(clip, "mediaWidth", 0.0), f(clip, "mediaHeight", 0.0));
                let crop = t.get("crop").map(|c| CropRect {
                    x: f(c, "x", 0.0),
                    y: f(c, "y", 0.0),
                    width: f(c, "width", 1.0),
                    height: f(c, "height", 1.0),
                });
                let fit = contain_fit(world, mw, mh, crop);
                if fit.is_none() {
                    report.warnings.push(format!("{ty} clip without media size; scale left at 1"));
                }
                fit
            } else {
                None
            };
            convert_transform(world, t, center_pivot, fit)
        }
    };

    Some(Segment {
        id,
        material,
        source,
        target,
        speed,
        reverse: false,
        change_pitch: false,
        visible: true,
        render_index: 0,
        transform,
        crop,
        opacity: Animated::constant(opacity),
        volume,
        attachments,
    })
}

/// The app's masks on a video or image clip (`components/preview/mask`), each keyframe's
/// shape or lasso held until the next. Shapes and lasso points are in world units from the
/// clip's top-left, at the scale the clip had when the mask was drawn (the mask's own
/// `transform`), so they become fractions of the clip's box at that scale. A rectangle turns
/// about its top-left corner, the other shapes about their centre.
///
/// Each side shows the clip or a colour, as the app's WebGL canvas leaves it: the colour
/// times its opacity, at the opacity squared (it blends the alpha too). Only the first mask
/// paints outside itself. Crops, and the feather and invert the app stores but doesn't use,
/// are left out.
fn convert_masks(id: &str, clip: &Value, fps: f64, report: &mut ImportReport) -> Vec<Mask> {
    let t = clip.get("transform").cloned().unwrap_or(Value::Null);
    let (cw, ch) = (f(&t, "width", 0.0), f(&t, "height", 0.0));
    let masks = clip.get("masks").and_then(Value::as_array).cloned().unwrap_or_default();
    if cw <= 0.0 || ch <= 0.0 {
        return Vec::new();
    }
    // JavaScript's `x || 1`.
    let or_one = |v: f64| if v == 0.0 || !v.is_finite() { 1.0 } else { v };
    let paint = |on: bool, color: &str, default: &str, opacity: f64| {
        if !on {
            return MaskPaint::Clip;
        }
        let c = Rgba::from_hex(&Some(color.to_string()).filter(|c| !c.is_empty()).unwrap_or_else(|| default.into())).unwrap_or(Rgba::BLACK);
        let o = (opacity / 100.0).clamp(0.0, 1.0) as f32;
        MaskPaint::Color(Rgba { r: c.r * o, g: c.g * o, b: c.b * o, a: o * o })
    };
    let mut out = Vec::new();
    for (index, m) in masks.iter().enumerate() {
        let tool = s(m, "tool");
        if tool != "shape" && tool != "lasso" {
            continue;
        }
        let mt = [m.get("transform"), clip.get("originalTransform"), clip.get("transform")].into_iter().flatten().find(|v| v.is_object()).cloned().unwrap_or(Value::Null);
        let (bw, bh) = (or_one(f(&mt, "scaleX", 1.0)) * cw, or_one(f(&mt, "scaleY", 1.0)) * ch);
        let mut frames: Vec<(f64, &Value)> = m.get("keyframes").and_then(Value::as_object).into_iter().flatten().filter_map(|(k, v)| Some((k.parse::<f64>().ok()?, v))).collect();
        frames.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut keys: Vec<MaskKey> = Vec::new();
        for (frame, data) in frames {
            let at = Micros::from_secs_f64(frame / fps);
            if tool == "lasso" {
                let Some(pts) = data.get("lassoPoints").and_then(Value::as_array) else {
                    if data.get("lassoPointsBinPath").is_some() {
                        bump(&mut report.kept_foreign, "mask lassos saved as binary files (not read yet)");
                    }
                    continue;
                };
                let points: Vec<[f32; 2]> = pts.iter().filter_map(Value::as_f64).collect::<Vec<_>>().chunks_exact(2).map(|p| [(p[0] / bw) as f32, (p[1] / bh) as f32]).collect();
                keys.push(MaskKey { at, shape: MaskShape::Polygon { points }, center: [0.0, 0.0], size: [1.0, 1.0], rotation: 0.0 });
                continue;
            }
            let Some(b) = data.get("shapeBounds").filter(|b| b.is_object()) else { continue };
            let (w, h) = (f(b, "width", 0.0) * f(b, "scaleX", 1.0), f(b, "height", 0.0) * f(b, "scaleY", 1.0));
            let rotation = f(b, "rotation", 0.0);
            let (x, y) = (f(b, "x", 0.0), f(b, "y", 0.0));
            let shape_type = s(b, "shapeType");
            let (cx, cy) = if matches!(shape_type.as_str(), "ellipse" | "polygon" | "star") {
                (x + w / 2.0, y + h / 2.0)
            } else {
                let (sn, cs) = rotation.to_radians().sin_cos();
                (x + cs * w / 2.0 - sn * h / 2.0, y + sn * w / 2.0 + cs * h / 2.0)
            };
            let shape = match shape_type.as_str() {
                "ellipse" => MaskShape::Ellipse,
                "polygon" => MaskShape::Triangle,
                "star" => MaskShape::Star,
                _ => MaskShape::Rectangle { round_corner: 0.0 },
            };
            keys.push(MaskKey {
                at,
                shape,
                center: [(cx / bw * 2.0 - 1.0) as f32, (1.0 - cy / bh * 2.0) as f32],
                size: [(w / bw) as f32, (h / bh) as f32],
                rotation: rotation as f32,
            });
        }
        if keys.is_empty() {
            continue;
        }
        // Before the first key the mask takes the first key's shape.
        let first = keys.remove(0);
        out.push(Mask {
            id: MaterialId(format!("{id}-mask{index}")),
            shape: first.shape,
            center: first.center,
            size: first.size,
            rotation: first.rotation,
            feather: 0.0,
            invert: false,
            inside: paint(m.get("maskColorEnabled").and_then(Value::as_bool).unwrap_or(false), &s(m, "maskColor"), "#ffffff", f(m, "maskOpacity", 100.0)),
            outside: paint(index == 0 && m.get("backgroundColorEnabled").and_then(Value::as_bool).unwrap_or(false), &s(m, "backgroundColor"), "#000000", f(m, "backgroundOpacity", 100.0)),
            keys,
            library: None,
        });
    }
    out
}

/// A colour from `#rrggbb` with an opacity in percent.
fn hex_alpha(clip: &Value, key: &str, default: &str, opacity_key: &str) -> Rgba {
    let mut c = Rgba::from_hex(&Some(s(clip, key)).filter(|h| !h.is_empty()).unwrap_or_else(|| default.into())).unwrap_or(Rgba::BLACK);
    c.a = (f(clip, opacity_key, 100.0) / 100.0).clamp(0.0, 1.0) as f32;
    c
}

/// A shape clip as Konva draws it (`ShapePreview.tsx`): in a box of the clip's width and
/// height, scaled by its scaleX/scaleY, filled then stroked.
fn convert_shape(id: &MaterialId, clip: &Value) -> Shape {
    let t = clip.get("transform").cloned().unwrap_or(Value::Null);
    let (w, h) = (f(&t, "width", 100.0) as f32, f(&t, "height", 100.0) as f32);
    let corner = f(&t, "cornerRadius", 0.0) as f32;
    let shape_type = s(clip, "shapeType");
    let geometry = match shape_type.as_str() {
        "ellipse" => Geometry::Ellipse,
        "polygon" => Geometry::Polygon { sides: f(clip, "sides", 3.0).max(3.0) as u32, radius: (w / 3f32.sqrt()).min(h / 1.5), corner_radius: corner },
        "star" => Geometry::Star { points: f(clip, "points", 5.0).max(2.0) as u32, inner: w.min(h) / 4.0, outer: w.min(h) / 2.0 },
        "line" => Geometry::Line { points: vec![[0.0, 0.0], [w, 0.0]], tension: 0.0, closed: false },
        _ => Geometry::Rectangle { corner_radius: corner },
    };
    let stroke_width = f(clip, "strokeWidth", 2.0) as f32;
    Shape {
        id: id.clone(),
        size: [w, h],
        scale: [f(&t, "scaleX", 1.0) as f32, f(&t, "scaleY", 1.0) as f32],
        unit: (1.0 / WORLD_H) as f32,
        paths: vec![ShapePath {
            // A line has no inside.
            fill: (shape_type != "line").then(|| hex_alpha(clip, "fill", "#3b82f6", "fillOpacity")),
            stroke: (stroke_width > 0.0).then(|| ShapeStroke { color: hex_alpha(clip, "stroke", "#1e40af", "strokeOpacity"), width: stroke_width, ends: StrokeEnds::Butt }),
            opacity: 1.0,
            blend: PathBlend::Normal,
            geometry,
        }],
    }
}

/// A drawing clip (`DrawingLine.tsx`): its lines over the whole canvas, each placed by its
/// own transform. Brushes are round and curved by their smoothing, highlighters square and
/// straight, erasers round, curved at 0.5 and opaque. The app names a blend for each tool
/// but never hands it to Konva, so every line is drawn normally (its eraser cuts the lines
/// instead).
fn convert_drawing(id: &MaterialId, clip: &Value, world: &World) -> Shape {
    let paths = clip
        .get("lines")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|line| {
            let raw: Vec<f64> = line.get("points")?.as_array()?.iter().filter_map(Value::as_f64).collect();
            let t = line.get("transform").cloned().unwrap_or(Value::Null);
            let (tx, ty, sx, sy) = (f(&t, "x", 0.0), f(&t, "y", 0.0), f(&t, "scaleX", 1.0), f(&t, "scaleY", 1.0));
            let (sn, cs) = f(&t, "rotation", 0.0).to_radians().sin_cos();
            let points: Vec<[f32; 2]> = raw
                .chunks_exact(2)
                .map(|p| {
                    let (x, y) = (p[0] * sx, p[1] * sy);
                    [(tx + x * cs - y * sn) as f32, (ty + x * sn + y * cs) as f32]
                })
                .collect();
            if points.is_empty() {
                return None;
            }
            let tool = s(line, "tool");
            let (tension, ends) = match tool.as_str() {
                "highlighter" => (0.0, StrokeEnds::Square),
                "eraser" => (0.5, StrokeEnds::Round),
                _ => (f(line, "smoothing", 0.5) as f32, StrokeEnds::Round),
            };
            let color = Rgba::from_hex(&s(line, "stroke")).unwrap_or(Rgba::BLACK);
            Some(ShapePath {
                geometry: Geometry::Line { points, tension, closed: false },
                fill: None,
                stroke: Some(ShapeStroke { color, width: (f(line, "strokeWidth", 4.0) * (sx.abs() * sy.abs()).sqrt()) as f32, ends }),
                opacity: if tool == "eraser" { 1.0 } else { (f(line, "opacity", 100.0) / 100.0) as f32 },
                blend: PathBlend::Normal,
            })
        })
        .collect();
    Shape { id: id.clone(), size: [world.w as f32, world.h as f32], scale: [1.0, 1.0], unit: (1.0 / WORLD_H) as f32, paths }
}

fn convert_text(id: &MaterialId, clip: &Value, world: &World) -> Text {
    let raw = s(clip, "text");
    let text = match s(clip, "textTransform").as_str() {
        "uppercase" => raw.to_uppercase(),
        "lowercase" => raw.to_lowercase(),
        "capitalize" => raw
            .split(' ')
            .map(|w| {
                let mut c = w.chars();
                match c.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + c.as_str(),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
        _ => raw,
    };
    let font_size = f(clip, "fontSize", 48.0).max(1.0);
    let rel = |px: f64| (px / font_size) as f32;
    let stroke = b(clip, "strokeEnabled").then(|| Stroke {
        color: hex(clip, "stroke", Rgba::BLACK),
        width: rel(f(clip, "strokeWidth", 2.0)),
    });
    let background = b(clip, "backgroundEnabled").then(|| {
        let mut color = hex(clip, "backgroundColor", Rgba::BLACK);
        color.a = (f(clip, "backgroundOpacity", 100.0) / 100.0) as f32;
        let corner_radius = rel(f(clip, "backgroundCornerRadius", 0.0));
        TextBackground { color, corner_radius, width: 0.0, height: 0.0, style: if corner_radius > 0.0 { 2 } else { 1 } }
    });
    let shadow = b(clip, "shadowEnabled").then(|| {
        let mut color = hex(clip, "shadowColor", Rgba::BLACK);
        color.a = (f(clip, "shadowOpacity", 75.0) / 100.0) as f32;
        let (dx, dy) = (f(clip, "shadowOffsetX", 2.0), f(clip, "shadowOffsetY", 2.0));
        TextShadow {
            color,
            distance: rel(dx.hypot(dy)),
            // v1 offsets are y-down; the model measures angles with +y up.
            angle_deg: (-dy).atan2(dx).to_degrees() as f32,
            smoothing: rel(f(clip, "shadowBlur", 4.0)),
        }
    });
    let chars = text.chars().count() as u32;
    Text {
        id: id.clone(),
        runs: vec![TextRun {
            range: (0, chars),
            font: FontRef { name: { let n = s(clip, "fontFamily"); if n.is_empty() { "Arial".into() } else { n } }, path: String::new() },
            size: (font_size / WORLD_H) as f32,
            size_unit: SizeUnit::CanvasHeight,
            // v1's colorOpacity has no effect in its renderer, so it isn't applied here.
            fill: hex(clip, "color", Rgba::BLACK),
            stroke,
            bold: f(clip, "fontWeight", 400.0) >= 700.0,
            italic: s(clip, "fontStyle") == "italic",
            underline: s(clip, "textDecoration") == "underline",
        }],
        text,
        words: Vec::new(),
        layout: TextLayout {
            alignment: match s(clip, "textAlign").as_str() {
                "center" => 1,
                "right" => 2,
                _ => 0,
            },
            letter_spacing: 0.0,
            line_spacing: 0.0,
            // Konva's default line height.
            line_height: Some(1.0),
            kerning: true,
            background,
            shadow,
            max_width: None,
            curve: 0.0,
            // Konva draws v1 text inside its box (wrapping at the box's width), aligned by
            // textAlign and verticalAlign.
            frame: clip.get("transform").map(|t| TextFrame {
                width: (f(t, "width", 0.0) * f(t, "scaleX", 1.0) / world.w) as f32,
                height: (f(t, "height", 0.0) * f(t, "scaleY", 1.0) / world.h) as f32,
                vertical_align: match s(clip, "verticalAlign").as_str() {
                    "middle" => 1,
                    "bottom" => 2,
                    _ => 0,
                },
            }).filter(|fr| fr.width > 0.0 && fr.height > 0.0),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 24 fps, 16:9 (world 1066.67×600). Track order in v1 is top first.
    fn doc() -> Value {
        // frame→tick exactly as v1 writes it: floor(frame * 1e6 / round(fps))
        let tick = |frame: i64| ((frame * 1_000_000) / 24).to_string();
        json!({
            "version": "1.0.0",
            "meta": {"id": "UUID-1", "name": "My edit", "projectId": 3},
            "settings": {"fps": 24, "aspectRatio": {"width": 16, "height": 9, "id": "16:9"}, "defaultClipLength": 5},
            "assets": {
                "A1": {"id": "A1", "type": "video", "path": "file:///Users/me/My%20Clip.mp4", "width": 1920, "height": 1080, "duration": 10.0},
                "A2": {"id": "A2", "type": "audio", "path": "file:///Users/me/song.mp3", "duration": 30.0}
            },
            "timeline": {
                "tracks": [
                    {"type": "text", "timelineId": "T-text", "muted": false, "hidden": false},
                    {"type": "media", "timelineId": "T-media", "muted": false, "hidden": false},
                    {"type": "audio", "timelineId": "T-audio", "muted": true, "hidden": false}
                ],
                "clips": [
                    {"clipId": "v1", "type": "video", "timelineId": "T-media", "assetId": "A1",
                     "startTick": tick(1), "endTick": tick(49), "trimStartTick": tick(24), "trimEndTick": tick(0),
                     "speed": 2.0, "volume": -6.0, "fadeIn": 0.5, "brightness": 20, "mediaWidth": 1920, "mediaHeight": 1080,
                     "transform": {"x": 0, "y": 0, "width": 1066.6666666666667, "height": 600, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 50}},
                    {"clipId": "v2", "type": "video", "timelineId": "T-media", "assetId": "A1",
                     "startTick": tick(40), "endTick": tick(60), "trimStartTick": tick(0), "trimEndTick": tick(0)},
                    {"clipId": "a1", "type": "audio", "timelineId": "T-audio", "assetId": "A2",
                     "startTick": tick(0), "endTick": tick(240), "trimStartTick": tick(0), "trimEndTick": tick(0), "volume": 0},
                    {"clipId": "t1", "type": "text", "timelineId": "T-text", "text": "hello world", "textTransform": "capitalize",
                     "fontSize": 60, "fontWeight": 700, "color": "#ff0000", "textAlign": "center",
                     "strokeEnabled": true, "stroke": "#000000", "strokeWidth": 3,
                     "shadowEnabled": true, "shadowOffsetX": 3, "shadowOffsetY": 4, "shadowBlur": 6,
                     "startTick": tick(0), "endTick": tick(72), "trimStartTick": "0", "trimEndTick": "0",
                     "transform": {"x": 433.3333333333333, "y": 250, "width": 200, "height": 100, "scaleX": 1, "scaleY": 1, "rotation": 90, "opacity": 100}},
                    {"clipId": "m1", "type": "model", "timelineId": "T-media", "startTick": tick(0), "endTick": tick(10)}
                ]
            }
        })
    }

    #[test]
    fn imports_time_exactly_despite_truncated_ticks() {
        let Imported { project, report } = import_v1_json(&doc()).unwrap();
        assert_eq!(project.fps, FrameRate::new(24, 1));
        let (_, v1) = edit::find_segment(&project, "v1").unwrap();
        // frame 1 was written as tick 41666 (truncated); it must come back as frame 1 exactly.
        assert_eq!(v1.target.start, FrameRate::new(24, 1).frame_start(1));
        assert_eq!(v1.target.end(), FrameRate::new(24, 1).frame_start(49));
        // trimStart 24 frames at 2× speed starts 2 s into the source.
        assert_eq!(v1.source.unwrap().start, Micros(2_000_000));
        assert_eq!(v1.source.unwrap().duration, Micros(v1.target.duration.0 * 2));
        assert!((v1.volume.value - 10f32.powf(-6.0 / 20.0)).abs() < 1e-6);
        assert_eq!(v1.opacity.value, 0.5);
        assert_eq!(report.dropped.get("model (AI generation clip)"), Some(&1));
        assert!(report.problems.is_empty(), "{:?}", report.problems);
    }

    #[test]
    fn geometry_converts_to_centred_normalised_coordinates() {
        let Imported { project, .. } = import_v1_json(&doc()).unwrap();
        // A full-frame 16:9 video on a 16:9 canvas: centred, scale 1.
        let (_, v1) = edit::find_segment(&project, "v1").unwrap();
        let p = v1.transform.position.value;
        let sc = v1.transform.scale.value;
        assert!(p.x.abs() < 1e-9 && p.y.abs() < 1e-9, "{p:?}");
        assert!((sc.x - 1.0).abs() < 1e-9 && (sc.y - 1.0).abs() < 1e-9, "{sc:?}");
        // Text box 200×100 at (433.33, 250), rotated 90° about its top-left: the centre
        // moves to (433.33 - 50, 250 + 100) = (383.33, 350) in y-down world units.
        let (_, t1) = edit::find_segment(&project, "t1").unwrap();
        let p = t1.transform.position.value;
        assert!((p.x - (383.3333333333333 / (1066.6666666666667) * 2.0 - 1.0)).abs() < 1e-9, "{p:?}");
        assert!((p.y - (1.0 - 350.0 / 600.0 * 2.0)).abs() < 1e-9, "{p:?}");
        assert_eq!(t1.transform.rotation.value, 90.0);
    }

    #[test]
    fn shapes_and_drawings_become_vector_materials() {
        let mut d = doc();
        let tl = d["timeline"].as_object_mut().unwrap();
        let tracks = tl["tracks"].as_array_mut().unwrap();
        tracks.insert(0, json!({"type": "shape", "timelineId": "T-shape"}));
        tracks.insert(0, json!({"type": "draw", "timelineId": "T-draw"}));
        let clips = tl["clips"].as_array_mut().unwrap();
        clips.push(json!({"clipId": "s1", "type": "shape", "timelineId": "T-shape", "shapeType": "star", "points": 6,
            "fill": "#ff0000", "fillOpacity": 50, "strokeWidth": 0, "startTick": "0", "endTick": "1000000", "trimStartTick": "0", "trimEndTick": "0",
            "transform": {"x": 100, "y": 100, "width": 200, "height": 100, "scaleX": 2, "scaleY": 1, "rotation": 0, "opacity": 100}}));
        clips.push(json!({"clipId": "d1", "type": "draw", "timelineId": "T-draw", "startTick": "0", "endTick": "1000000", "trimStartTick": "0", "trimEndTick": "0",
            "lines": [{"lineId": "l1", "tool": "highlighter", "points": [0, 0, 10, 0], "stroke": "#ffff00", "strokeWidth": 10, "opacity": 50, "smoothing": 0.5,
                       "transform": {"x": 5, "y": 7, "scaleX": 2, "scaleY": 2, "rotation": 90}}]}));
        let Imported { project, report } = import_v1_json(&d).unwrap();
        assert!(report.kept_foreign.is_empty(), "{:?}", report.kept_foreign);

        let star = project.materials.shapes.iter().find(|m| m.id.0 == "s1-shape").unwrap();
        assert_eq!((star.size, star.scale), ([200.0, 100.0], [2.0, 1.0]));
        assert_eq!(star.paths[0].geometry, Geometry::Star { points: 6, inner: 25.0, outer: 50.0 });
        assert_eq!(star.paths[0].fill.unwrap().a, 0.5);
        assert!(star.paths[0].stroke.is_none());
        // Stars pivot on their centre: x + width·scaleX/2.
        let (_, s1) = edit::find_segment(&project, "s1").unwrap();
        assert!((s1.transform.position.value.x - (300.0 / 1066.6666666666667 * 2.0 - 1.0)).abs() < 1e-9);

        // A line's points go through its own transform: scaled 2×, turned 90°, moved to (5, 7).
        let drawing = project.materials.shapes.iter().find(|m| m.id.0 == "d1-draw").unwrap();
        let line = &drawing.paths[0];
        assert_eq!(line.geometry, Geometry::Line { points: vec![[5.0, 7.0], [5.0, 27.0]], tension: 0.0, closed: false });
        let stroke = line.stroke.unwrap();
        assert_eq!((stroke.width, stroke.ends, line.blend, line.opacity), (20.0, StrokeEnds::Square, PathBlend::Normal, 0.5));
    }

    #[test]
    fn masks_become_fractions_of_the_clip_with_held_keys() {
        let mut d = doc();
        let clip = &mut d["timeline"]["clips"][0];
        clip["masks"] = json!([
            {"id": "m0", "tool": "shape", "maskColorEnabled": true, "maskColor": "#ffffff", "backgroundColorEnabled": true, "backgroundColor": "#000000", "backgroundOpacity": 50,
             "transform": {"x": 0, "y": 0, "width": 1066.6666666666667, "height": 600, "scaleX": 1, "scaleY": 1},
             "keyframes": {
                "24": {"shapeBounds": {"x": 0, "y": 0, "width": 600, "height": 300, "shapeType": "ellipse"}},
                "0": {"shapeBounds": {"x": 100, "y": 50, "width": 200, "height": 100, "rotation": 90, "shapeType": "rectangle"}}}},
            {"id": "m1", "tool": "lasso", "backgroundColorEnabled": true, "keyframes": {"0": {"lassoPoints": [0, 0, 533.3333333333334, 0, 0, 300]}}}
        ]);
        let Imported { project, report } = import_v1_json(&d).unwrap();
        assert!(report.kept_foreign.is_empty(), "{:?}", report.kept_foreign);
        let (_, v1) = edit::find_segment(&project, "v1").unwrap();
        assert!(v1.attachments.iter().any(|a| a.0 == "v1-mask0") && v1.attachments.iter().any(|a| a.0 == "v1-mask1"));
        let m = &project.materials.masks[0];
        // Turned 90° clockwise about its top-left (100, 50): the centre goes to (50, 150).
        assert_eq!(m.shape, MaskShape::Rectangle { round_corner: 0.0 });
        let close = |a: [f32; 2], b: [f32; 2]| (a[0] - b[0]).abs() < 1e-5 && (a[1] - b[1]).abs() < 1e-5;
        assert!(close(m.center, [-0.90625, 0.5]) && close(m.size, [0.1875, 1.0 / 6.0]), "{m:?}");
        assert_eq!((m.keys.len(), m.keys[0].at, m.keys[0].shape.clone()), (1, Micros(1_000_000), MaskShape::Ellipse));
        assert_eq!(m.inside, MaskPaint::Color(Rgba { r: 1.0, g: 1.0, b: 1.0, a: 1.0 }));
        assert_eq!(m.outside, MaskPaint::Color(Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.25 }));
        // Only the first mask paints outside itself.
        let lasso = &project.materials.masks[1];
        assert_eq!(lasso.shape, MaskShape::Polygon { points: vec![[0.0, 0.0], [0.5, 0.0], [0.0, 0.5]] });
        assert_eq!((lasso.inside, lasso.outside), (MaskPaint::Clip, MaskPaint::Clip));
    }

    #[test]
    fn grouped_clips_stack_at_their_group_first_child_on_top() {
        let mut d = doc();
        let tl = d["timeline"].as_object_mut().unwrap();
        // A hidden group track above the text track; the children say they're on the media track.
        tl["tracks"].as_array_mut().unwrap().insert(0, json!({"type": "media", "timelineId": "T-group", "hidden": true}));
        let clips = tl["clips"].as_array_mut().unwrap();
        clips.push(json!({"clipId": "g", "type": "group", "timelineId": "T-group", "startTick": "0", "endTick": "1000000", "children": [["c1", "c2"]]}));
        for id in ["c1", "c2"] {
            clips.push(json!({"clipId": id, "type": "text", "timelineId": "T-media", "groupId": "g", "text": id, "startTick": "0", "endTick": "1000000", "trimStartTick": "0", "trimEndTick": "0"}));
        }
        let Imported { project, .. } = import_v1_json(&d).unwrap();
        let at = |seg: &str| project.tracks.iter().position(|t| t.segments.iter().any(|s| s.id == seg)).unwrap();
        let group = project.tracks.iter().position(|t| t.id == "T-group").unwrap();
        // Bottom first: the group's track, then c2, then c1 on top; below every track above the group's.
        assert_eq!((at("c2"), at("c1")), (group + 1, group + 2));
        assert!(project.tracks[at("c1")].hidden && project.tracks[at("c2")].hidden);
        assert_eq!(project.tracks.len(), group + 3);
    }

    #[test]
    fn text_audio_tracks_and_overlaps() {
        let Imported { project, report } = import_v1_json(&doc()).unwrap();
        let text = &project.materials.texts[0];
        assert_eq!(text.text, "Hello World");
        let run = &text.runs[0];
        assert_eq!((run.size, run.size_unit), (0.1, SizeUnit::CanvasHeight));
        assert!(run.bold && run.stroke.unwrap().width == 0.05);
        let shadow = text.layout.shadow.unwrap();
        assert!((shadow.distance - 5.0 / 60.0).abs() < 1e-6);
        assert_eq!(text.layout.alignment, 1);

        // v1 lists tracks top first; the model lists them bottom first.
        let kinds: Vec<TrackKind> = project.tracks.iter().map(|t| t.kind).collect();
        assert_eq!(kinds[0], TrackKind::Audio);
        assert!(project.tracks[0].muted);
        // v2 (frames 40-60) overlapped v1 (frames 1-49): it moves to a new video track.
        assert_eq!(report.moved_to_new_track, 1);
        assert!(project.tracks.iter().any(|t| t.id == "T-media-overlap" && t.segments[0].id == "v2"));
        // Fades and adjustments became attached materials.
        let (_, v1) = edit::find_segment(&project, "v1").unwrap();
        assert!(v1.attachments.iter().any(|m| m.0 == "v1-fade"));
        assert!(v1.attachments.iter().any(|m| m.0 == "v1-adj-brightness"));
        assert_eq!(project.materials.media[0].path, "/Users/me/My Clip.mp4");
        assert!(project.validate().is_empty());
    }
}
