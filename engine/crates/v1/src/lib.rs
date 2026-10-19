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
//! - **Audio.** v1 volume is dB; the model stores linear gain. Fades become materials, and so
//!   do the Audio tab's voice effects, loudness normalisation, channel fill and beat markers
//!   (`audio.rs`).
//! - **Tracks.** v1 lists tracks top row first; the model lists them bottom first.
//!
//! - **Keyframes.** A clip's `keyframes` (clip-local frames, values in its fields' units) become
//!   the segment's keys in µs and model units (`keys.rs`).
//!
//! AI clips (`model`) are dropped.

use std::collections::BTreeMap;
use std::path::Path;

use openrip_model::*;
use serde::Serialize;
use serde_json::Value;

const APP: &str = "openrip-v1";
/// v1 canvas height in world units (`BASE_LONG_SIDE`).
pub(crate) const WORLD_H: f64 = 600.0;

mod app;
mod audio;
mod color;
mod compositing;
mod fx;
mod keys;
mod text;
pub use app::{relaid_texts, to_app_project};

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
        rotation: f(c, "rotation", 0.0),
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
    let raw = openrip_platform::assets::read(path).map_err(|source| ImportError::Io { path: path.display().to_string(), source })?;
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
            reverse_path: None,
            freeze: None,
            complement_frame: None,
            smart_complement_frame: None,
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
        let canvas = project.canvas;
        let converted = match clip.get("engine").filter(|e| e.get("segment").is_some()) {
            Some(engine) => engine_segment(clip, engine, &ty, &clock, &world, canvas, &mut project.materials, &mut report),
            None => convert_clip(clip, &ty, &clock, &world, &mut project.materials, &mut report).map(|mut seg| {
                keys::apply(&mut seg, clip, None, clock.fps.as_f64(), &world, canvas, &mut project.materials);
                let kind = match ty.as_str() {
                    "video" | "image" => TrackKind::Video,
                    "audio" => TrackKind::Audio,
                    "text" => TrackKind::Text,
                    // An effect bar is on an effect track, as CapCut's.
                    "filter" if !s(clip, "effectId").is_empty() => TrackKind::Effect,
                    "filter" => TrackKind::Filter,
                    _ => TrackKind::Graphic,
                };
                (seg, kind)
            }),
        };
        if let Some((seg, wanted)) = converted {
            // A filter track holding a draft's effects or stickers takes their kind.
            if let Some(t) = tracks.iter_mut().find(|t| t.id == s(clip, "timelineId") && t.kind != wanted && t.segments.is_empty() && (clip.get("engine").is_some() || !s(clip, "effectId").is_empty())) {
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
        if !m.path.is_empty() && !openrip_platform::assets::exists(Path::new(&m.path)) {
            report.missing_media.push(m.path.clone());
        }
    }
    report.problems = project.validate();
    Ok(Imported { project, report })
}

/// A clip the app opened from a converted project (`app.rs`): its own segment and materials,
/// with whatever the app changed since applied on top (timing, a move, resize or turn,
/// opacity, volume, the text and its style, and the other panel fields `app.rs` writes).
fn engine_segment(clip: &Value, engine: &Value, ty: &str, clock: &Clock, world: &World, canvas: Canvas, materials: &mut Materials, report: &mut ImportReport) -> Option<(Segment, TrackKind)> {
    let Ok(mut seg) = serde_json::from_value::<Segment>(engine.get("segment")?.clone()) else {
        report.warnings.push("a converted clip's segment couldn't be read; skipped".into());
        return None;
    };
    let kind = engine.get("track").and_then(Value::as_str).and_then(app::kind_from_name)?;
    for m in engine.get("materials").and_then(Value::as_array).into_iter().flatten() {
        match serde_json::from_value::<AnyMaterial>(m.clone()) {
            // The app's asset stands for the media (it may have been relinked), keeping what
            // only the draft knows: CapCut's saved background removal, and that a video's sound
            // was extracted to a clip of its own (the video then plays none).
            Ok(AnyMaterial::Media(m)) => match materials.media.iter_mut().find(|a| a.id == m.id) {
                Some(asset) => {
                    asset.matte = asset.matte.take().or(m.matte);
                    asset.has_audio &= m.has_audio || m.kind != MediaKind::Video;
                    // Smooth slow-mo and Optical flow, as the draft set them.
                    asset.complement_frame = asset.complement_frame.take().or(m.complement_frame);
                    asset.smart_complement_frame = asset.smart_complement_frame.take().or(m.smart_complement_frame);
                }
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
    // Fields added to the conversion later: a project converted before has no base for them,
    // and counts as unchanged. Numbers compare by value (the app writes 3 for 3.0).
    let differs = |k: &str| base.get(k).is_some_and(|was| !same(clip.get(k), Some(was)));

    if ["startTick", "endTick", "trimStartTick", "trimEndTick", "speed"].into_iter().any(changed) {
        let (start, end) = (clock.frame(clip, "startTick", "startFrame"), clock.frame(clip, "endTick", "endFrame"));
        let target = TimeRange::new(clock.at(start), clock.at(end) - clock.at(start));
        if target.duration.0 <= 0 {
            return None;
        }
        let (was_start, was_source, was_speed) = (seg.target.start, seg.source, seg.speed);
        if seg.source.is_some() {
            let speed = f(clip, "speed", seg.speed).clamp(0.1, 100.0);
            let trim_start = clock.frame(clip, "trimStartTick", "trimStart").max(0);
            let played = TimeRange::new(Micros((clock.at(trim_start).0 as f64 * speed).round() as i64), Micros((target.duration.0 as f64 * speed).round() as i64));
            // A reversed clip's trims count from the media's end, as it plays.
            let reversed = if differs("reverse") { b(clip, "reverse") } else { seg.reverse };
            let length = materials.media.iter().find(|m| m.id == seg.material).map(|m| m.duration);
            seg.source = Some(match length {
                Some(length) if reversed => played_order(played, length),
                _ => played,
            });
            seg.speed = speed;
        }
        seg.target = target;
        // Keys stay on the media (on the clip's content for clips without media) through a
        // trim or a new speed; the app moves the ones it shows itself (below).
        match (was_source, seg.source) {
            (Some(was), Some(now)) => {
                let (old, new) = (was_speed, seg.speed);
                // Counted as it plays: from the in-point, or from the out-point when reversed.
                let shift = if seg.reverse || b(clip, "reverse") { now.end().0 - was.end().0 } else { was.start.0 - now.start.0 };
                keys::retime(&mut seg, |t| Micros(((t.0 as f64 * old + shift as f64) / new).round() as i64), old / new);
            }
            _ => {
                let moved = target.start - was_start;
                keys::retime(&mut seg, |t| t - moved, 1.0);
            }
        }
    }
    if changed("volume") {
        seg.volume = Animated::constant(10f64.powf(f(clip, "volume", 0.0) / 20.0) as f32);
    }
    if seg.source.is_some() && differs("reverse") {
        seg.reverse = b(clip, "reverse");
    }
    if seg.source.is_some() && differs("changePitch") {
        seg.change_pitch = b(clip, "changePitch");
    }
    if seg.source.is_some() && differs("speedCurve") {
        // The app's curve replaces the draft's speed (CapCut attaches one to every clip).
        seg.attachments.retain(|id| !materials.speeds.iter().any(|m| &m.id == id));
        if let Some(sp) = app_speed_curve(&seg.id, clip, seg.speed) {
            materials.speeds.retain(|m| m.id != sp.id);
            seg.attachments.push(sp.id.clone());
            materials.speeds.push(sp);
        }
    }
    if ty == "video" && seg.source.is_some() && (differs("smoothSlowMo") || differs("opticalFlow")) {
        let media = seg.material.clone();
        if let Some(mid) = app_video_algorithm(&seg.id, clip, &media, materials) {
            seg.material = mid;
        }
    }
    if ty == "video" && differs("freeze") {
        // Made a freeze frame in the app: a still of the media's frame, keeping the rest of the
        // clip (its effects, masks, adjustments), as CapCut's Freeze copies them.
        if let Some(mid) = app_freeze(&seg.id, clip, materials) {
            seg.material = mid;
            seg.source = Some(TimeRange::new(Micros::ZERO, seg.target.duration));
            seg.speed = 1.0;
            seg.reverse = false;
            seg.attachments.retain(|id| !materials.speeds.iter().any(|m| &m.id == id && m.curve.len() >= 2));
        }
    }
    if ["fadeIn", "fadeOut"].into_iter().any(differs) {
        // The app's fades replace the draft's.
        seg.attachments.retain(|id| !materials.audio_fades.iter().any(|m| &m.id == id));
        attach_fade(&seg.id.clone(), clip, materials, &mut seg.attachments);
    }
    // The Audio tab's voice effects, loudness normalisation, channel fill and beat markers
    // replace the draft's.
    if matches!(ty, "video" | "audio") {
        let id = seg.id.clone();
        if differs("audioEffects") {
            audio::set_effects(&id, clip.get("audioEffects"), materials, &mut seg.attachments);
        }
        if differs("loudness") {
            audio::set_loudness(&id, clip.get("loudness"), materials, &mut seg.attachments);
        }
        if differs("channel") {
            audio::set_channel(&id, clip.get("channel"), materials, &mut seg.attachments);
        }
        if differs("beats") {
            audio::set_beats(&id, clip.get("beats"), materials, &mut seg.attachments);
        }
    }
    if matches!(ty, "video" | "image") {
        // The app's adjustments go on top of the draft's own.
        if app::ADJUST_KEYS.into_iter().any(differs) {
            attach_adjustments(&seg.id.clone(), clip, materials, &mut seg.attachments);
        }
        // The draft's masks are the Mask tab's (`masks`, each naming its material in
        // `draftMask`): unedited, the draft's own stay as CapCut had them, keys and all;
        // edited, the app's replace the ones the tab showed (any it couldn't show stay). A
        // project converted before the tab showed them puts the app's on top.
        // Masks switched off (`masksOff`) take the draft's away too.
        let replace = masks_off(clip)
            || match base.get("masks") {
                Some(_) => differs("masks"),
                None => true,
            };
        if replace {
            let shown: Vec<String> = base.get("masks").and_then(Value::as_array).into_iter().flatten().map(|m| s(m, "draftMask")).filter(|id| !id.is_empty()).collect();
            seg.attachments.retain(|id| !shown.contains(&id.0));
            for m in convert_masks(&seg.id, clip, clock.fps.as_f64(), report) {
                seg.attachments.push(m.id.clone());
                materials.masks.push(m);
            }
        }
    }
    // The Animation tab's fields the app changed replace the draft's animations of their kind.
    let fields: &[(&str, AnimationKind)] = match ty {
        "text" => &[("animationIn", AnimationKind::In), ("animationOut", AnimationKind::Out), ("animationLoop", AnimationKind::Loop), ("captionStyle", AnimationKind::Caption)],
        "video" | "image" => &[("animationIn", AnimationKind::In), ("animationOut", AnimationKind::Out), ("animationCombo", AnimationKind::Combo)],
        _ => &[],
    };
    let edited: Vec<AnimationKind> = fields.iter().filter(|(k, _)| differs(k)).map(|(_, kind)| kind.clone()).collect();
    if !edited.is_empty() {
        edit_animations(&mut seg, clip, materials, &edited);
    }
    if !fields.is_empty() {
        fit_animations(&mut seg, Micros::from_secs_f64(f(clip, "spokenFrom", 0.0)), materials);
    }
    if matches!(ty, "video" | "image") && differs("transitionOut") {
        seg.attachments.retain(|id| !materials.transitions.iter().any(|m| &m.id == id));
        if let Some(t) = app_transition(&seg.id, clip, seg.target.duration) {
            materials.transitions.retain(|m| m.id != t.id);
            seg.attachments.push(t.id.clone());
            materials.transitions.push(t);
        }
    }
    // OpenRip's own effects on the clip come on top of the draft's.
    if matches!(ty, "video" | "image") {
        let id = seg.id.clone();
        fx::attach(&id, clip, materials, &mut seg.attachments);
    }
    if changed("transform") {
        apply_moves(&mut seg, base.get("transform"), clip.get("transform"), world, ty == "text");
    }
    if matches!(ty, "video" | "image") && differs("draftAdjustments") {
        edit_draft_adjustments(&mut seg, clip, &base, materials);
    }
    // The colour tools go on top of the draft's own; a blend mode, chroma key, canvas fill or
    // flip the app changed replaces the draft's.
    if matches!(ty, "video" | "image") {
        if differs("color") {
            color::attach(&seg.id.clone(), clip.get("color").unwrap_or(&Value::Null), materials, &mut seg.attachments);
        }
        if differs("chroma") {
            let was: Vec<MaterialId> = seg.attachments.iter().filter(|a| materials.chromas.iter().any(|c| &c.id == *a)).cloned().collect();
            compositing::set_chroma(&seg.id.clone(), clip.get("chroma"), materials, &mut seg.attachments);
            // The draft key's keyframes drive the app's key.
            let now = compositing::chroma_id(&seg.id);
            if seg.attachments.contains(&now) {
                seg.keyframes.iter_mut().filter(|k| was.contains(&k.material)).for_each(|k| k.material = now.clone());
            }
        }
        if differs("canvas") {
            compositing::set_canvas(&seg.id.clone(), clip.get("canvas"), materials, &mut seg.attachments);
        }
        if differs("flip") {
            compositing::set_flip(&mut seg.transform, clip.get("flip"));
        }
    }
    if matches!(ty, "video" | "image" | "text") && differs("blendMode") {
        compositing::set_blend(&seg.id.clone(), clip.get("blendMode"), materials, &mut seg.attachments);
    }
    if ty == "filter" && differs("intensity") {
        // A filter bar's strength (the Filter tab's intensity), on a copy of the draft's filter.
        if let Some(mut e) = materials.effects.iter().find(|e| e.id == seg.material && e.category == EffectCategory::Filter).cloned() {
            e.id = MaterialId(format!("{}-filter", seg.id));
            e.params.insert("intensity".into(), f(clip, "intensity", 100.0).clamp(0.0, 100.0) / 100.0);
            seg.material = e.id.clone();
            materials.effects.retain(|m| m.id != e.id);
            materials.effects.push(e);
        }
        // A sticker bar's: its opacity (keyframes scaled with it).
        if materials.stickers.iter().any(|s| s.id == seg.material) {
            let (was, now) = (seg.opacity.value.max(1e-6), (f(clip, "intensity", 100.0).clamp(0.0, 100.0) / 100.0) as f32);
            seg.opacity.value = now;
            seg.opacity.keys.iter_mut().for_each(|k| k.value = (k.value * now / was).clamp(0.0, 1.0));
        }
    }
    if ty == "text" && (["text", "fontSize", "color"].into_iter().any(changed) || app::TEXT_STYLE_KEYS.into_iter().any(differs)) {
        edit_text(&mut seg, clip, &base, materials);
    }
    if ty == "text" && differs("textEffect") {
        // The Effects tab's style replaces the draft's library style.
        seg.attachments.retain(|id| !text::is_text_style(materials, id));
        if let Some(e) = text::text_effect(&seg.id, clip) {
            materials.effects.retain(|m| m.id != e.id);
            seg.attachments.push(e.id.clone());
            materials.effects.push(e);
        }
    }
    // The app's keyframes for the properties it changed (on top of the draft's, which stay
    // for the rest).
    let props = |v: &Value| v.get("keyframes").and_then(Value::as_object).cloned().unwrap_or_default();
    let (now, was) = (props(clip), props(&base));
    let mut edited: Vec<String> = now.keys().chain(was.keys()).filter(|k| !same(now.get(*k), was.get(*k))).cloned().collect();
    edited.sort();
    edited.dedup();
    if !edited.is_empty() {
        keys::apply(&mut seg, clip, Some(&edited), clock.fps.as_f64(), world, canvas, materials);
    }
    Some((seg, kind))
}

/// The app's move, resize, turn and opacity change of a converted clip, applied to its own
/// transform (keyframes included). A text box's size follows its text in the app (it takes
/// the engine's block after a change of words or style), so a text clip is resized only by
/// its scale, and placed by the middle of its box.
fn apply_moves(seg: &mut Segment, base: Option<&Value>, now: Option<&Value>, world: &World, text: bool) {
    let (Some(b), Some(t)) = (base, now) else { return };
    let (bsx, bsy, tsx, tsy) = (f(b, "scaleX", 1.0), f(b, "scaleY", 1.0), f(t, "scaleX", 1.0), f(t, "scaleY", 1.0));
    let (bw, bh) = (f(b, "width", 1.0) * bsx, f(b, "height", 1.0) * bsy);
    let (tw, th) = (f(t, "width", 1.0) * tsx, f(t, "height", 1.0) * tsy);
    let (kx, ky) = if text { (tsx / bsx, tsy / bsy) } else { (tw / bw, th / bh) };
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
        let now = s(clip, "text");
        // The Text tab's case buttons rewrite the words in the new case: the runs and the
        // spoken-word timing still fit them.
        let recased = now.chars().count() == t.text.chars().count() && now.chars().zip(t.text.chars()).all(|(a, b)| a.to_lowercase().eq(b.to_lowercase()));
        if !recased {
            let n = now.chars().count() as u32;
            t.runs.truncate(1);
            if let Some(r) = t.runs.first_mut() {
                r.range = (0, n);
            }
            t.words.clear();
        }
        t.text = now;
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
    let differs = |k: &str| base.get(k).is_some_and(|was| !same(clip.get(k), Some(was)));
    if differs("textTransform") && !differs("text") {
        let shown = transform_case(&t.text, &s(clip, "textTransform"));
        // A case change can change the length (ß → SS): then the runs become one.
        if shown.chars().count() != t.text.chars().count() {
            t.runs.truncate(1);
            if let Some(r) = t.runs.first_mut() {
                r.range = (0, shown.chars().count() as u32);
            }
            t.words.clear();
        }
        t.text = shown;
    }
    if differs("fontFamily") {
        let name = s(clip, "fontFamily");
        if !name.is_empty() {
            t.runs.iter_mut().for_each(|r| r.font = FontRef { name: name.clone(), path: String::new() });
        }
    }
    if differs("fontWeight") {
        t.runs.iter_mut().for_each(|r| r.bold = f(clip, "fontWeight", 400.0) >= 700.0);
    }
    if differs("fontStyle") {
        t.runs.iter_mut().for_each(|r| r.italic = s(clip, "fontStyle") == "italic");
    }
    if differs("textDecoration") {
        t.runs.iter_mut().for_each(|r| r.underline = s(clip, "textDecoration") == "underline");
    }
    if differs("textAlign") {
        t.layout.alignment = match s(clip, "textAlign").as_str() {
            "left" => 0,
            "right" => 2,
            _ => 1,
        };
    }
    // Sizes are fractions of the font size, as for the app's own text (`text_effects`).
    let style = text_effects(clip);
    if ["strokeEnabled", "stroke", "strokeWidth", "strokeOpacity"].into_iter().any(differs) {
        t.runs.iter_mut().for_each(|r| r.stroke = style.stroke);
    }
    if ["shadowEnabled", "shadowColor", "shadowOpacity", "shadowOffsetX", "shadowOffsetY", "shadowBlur"].into_iter().any(differs) {
        t.layout.shadow = style.shadow;
    }
    if ["backgroundEnabled", "backgroundColor", "backgroundOpacity", "backgroundCornerRadius"].into_iter().any(differs) {
        t.layout.background = style.background.map(|b| match t.layout.background {
            // A CapCut background keeps its padding around each line.
            Some(old) => TextBackground { color: b.color, corner_radius: b.corner_radius, style: b.style, ..old },
            // A new one gets CapCut's default padding, if the text is CapCut's (it has no
            // Konva line boxes).
            None if t.layout.line_height.is_none() => TextBackground { width: 0.14, height: 0.14, ..b },
            None => b,
        });
    }
    text::edit(&mut t, clip, &differs);
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

    // A freeze frame (`freeze` on a video clip): a still of the asset's frame at `at` seconds,
    // drawn from the video, in a material of its own.
    let freeze = (ty == "video").then(|| app_freeze(&id, clip, materials)).flatten();
    let source = if freeze.is_some() { Some(TimeRange::new(Micros::ZERO, target.duration)) } else { source };
    let speed = if freeze.is_some() { 1.0 } else { speed };

    let material = match ty {
        _ if freeze.is_some() => freeze.clone().unwrap(),
        "video" | "image" | "audio" => {
            let asset = s(clip, "assetId");
            if !materials.contains(&MaterialId(asset.clone())) {
                bump(&mut report.dropped, &format!("{ty} clip whose asset is missing"));
                return None;
            }
            let asset = MaterialId(asset);
            // Smooth slow-mo or Optical flow: the clip's own copy of the media, flagged (CapCut
            // keeps them on each clip's video material).
            match ty {
                "video" => app_video_algorithm(&id, clip, &asset, materials).unwrap_or(asset),
                _ => asset,
            }
        }
        "text" => {
            let mid = MaterialId(format!("{id}-text"));
            materials.texts.push(convert_text(&mid, clip, world));
            // The Effects tab's style.
            if let Some(e) = text::text_effect(&id, clip) {
                attachments.push(e.id.clone());
                materials.effects.retain(|m| m.id != e.id);
                materials.effects.push(e);
            }
            mid
        }
        // One of OpenRip's own effects on a bar.
        "filter" if fx::bar(&id, clip).is_some() => {
            let e = fx::bar(&id, clip).unwrap();
            let mid = e.id.clone();
            materials.effects.push(e);
            mid
        }
        "filter" => {
            let mid = MaterialId(format!("{id}-filter"));
            let resource = [s(clip, "fullPath"), s(clip, "smallPath")].into_iter().find(|p| !p.is_empty());
            let mut params = BTreeMap::new();
            params.insert("intensity".to_string(), f(clip, "intensity", 100.0).clamp(0.0, 100.0) / 100.0);
            // A Hald CLUT image, or a .cube table.
            let cube = resource.as_deref().is_some_and(|p| p.to_lowercase().ends_with(".cube"));
            materials.effects.push(Effect {
                id: mid.clone(),
                category: EffectCategory::Filter,
                name: s(clip, "name"),
                params,
                builtin: Some(if cube { "cube" } else { "lut" }.into()),
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

    // A reversed clip's trims count in the order it plays: from the media's end.
    let reverse = is_av && freeze.is_none() && b(clip, "reverse");
    let source = match (source, materials.media.iter().find(|m| m.id == material)) {
        (Some(src), Some(m)) if reverse => Some(played_order(src, m.duration)),
        (s, _) => s,
    };

    // Audio: dB → linear, fades → material, and the Audio tab's other fields.
    let mut volume = Animated::constant(1.0f32);
    if is_av {
        volume = Animated::constant(10f64.powf(f(clip, "volume", 0.0) / 20.0) as f32);
        attach_fade(&id, clip, materials, &mut attachments);
        audio::attach(&id, clip, materials, &mut attachments);
    }
    // The Speed tab's curve: a speed the clip plays by (its `speed` is the curve's average).
    if is_av && freeze.is_none() {
        if let Some(sp) = app_speed_curve(&id, clip, speed) {
            attachments.push(sp.id.clone());
            materials.speeds.retain(|m| m.id != sp.id);
            materials.speeds.push(sp);
        }
    }

    // The Animation tab's animations: a text's In, Out and Loop; a video or photo's In, Out
    // and Combo.
    let kinds: &[AnimationKind] = match ty {
        "text" => &[AnimationKind::In, AnimationKind::Out, AnimationKind::Loop],
        "video" | "image" => &[AnimationKind::In, AnimationKind::Out, AnimationKind::Combo],
        _ => &[],
    };
    let items: Vec<Animation> = kinds.iter().filter_map(|k| app_animation(clip, k.clone(), target.duration)).collect();
    if !items.is_empty() {
        let mid = MaterialId(format!("{id}-animations"));
        materials.animations.push(Animations { id: mid.clone(), items });
        attachments.push(mid);
    }
    if matches!(ty, "video" | "image") {
        if let Some(t) = app_transition(&id, clip, target.duration) {
            attachments.push(t.id.clone());
            materials.transitions.push(t);
        }
        attach_adjustments(&id, clip, materials, &mut attachments);
        fx::attach(&id, clip, materials, &mut attachments);
        for m in convert_masks(&id, clip, clock.fps.as_f64(), report) {
            attachments.push(m.id.clone());
            materials.masks.push(m);
        }
        // The Adjust tab's colour tools, the chroma key and the canvas fill, as CapCut's.
        color::attach(&id, clip.get("color").unwrap_or(&Value::Null), materials, &mut attachments);
        compositing::set_chroma(&id, clip.get("chroma"), materials, &mut attachments);
        compositing::set_canvas(&id, clip.get("canvas"), materials, &mut attachments);
    }
    if matches!(ty, "video" | "image" | "text") {
        compositing::set_blend(&id, clip.get("blendMode"), materials, &mut attachments);
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
                    rotation: 0.0,
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
    let mut transform = transform;
    if matches!(ty, "video" | "image") {
        compositing::set_flip(&mut transform, clip.get("flip"));
    }

    Some(Segment {
        id,
        material,
        source,
        target,
        speed,
        reverse,
        // The Speed tab's Change audio pitch.
        change_pitch: is_av && freeze.is_none() && b(clip, "changePitch"),
        visible: true,
        render_index: 0,
        transform,
        crop,
        opacity: Animated::constant(opacity),
        volume,
        attachments,
        keyframes: Vec::new(),
    })
}

/// The source range of a reversed clip from one counted in the order it plays (the app's trims,
/// from the end of media `length` long), and back: the same mirror both ways.
pub(crate) fn played_order(src: TimeRange, length: Micros) -> TimeRange {
    TimeRange::new(Micros((length.0 - src.start.0 - src.duration.0).max(0)), src.duration)
}

/// The Speed tab's curve on a clip (`speedCurve`: `{ preset?, points: [{x, y}] }`, CapCut's
/// speed points), as a speed material for it; `None` without one (or with fewer than two
/// points). `speed` is the clip's, the curve's average.
fn app_speed_curve(id: &str, clip: &Value, speed: f64) -> Option<Speed> {
    let c = clip.get("speedCurve").filter(|c| c.is_object())?;
    let points: Vec<(f64, f64)> = c.get("points").and_then(Value::as_array)?.iter().map(|p| (f(p, "x", 0.0), f(p, "y", 1.0))).collect();
    (points.len() >= 2).then(|| Speed { id: MaterialId(format!("{id}-speed")), speed, curve: points, preset: Some(s(c, "preset")).filter(|p| !p.is_empty()) })
}

/// A video clip's Smooth slow-mo (`smoothSlowMo: { mode: "optical_flow" | "frame_blending" }`,
/// or null) and Optical flow (`opticalFlow: { fps }`, or null), as the model's flags.
fn app_complement(clip: &Value) -> (Option<ComplementFrame>, Option<SmartComplementFrame>) {
    let smooth = clip.get("smoothSlowMo").filter(|v| v.is_object()).and_then(|v| match s(v, "mode").as_str() {
        "frame_blending" => Some(ComplementMode::FrameBlending),
        "optical_flow" | "" => Some(ComplementMode::OpticalFlow),
        _ => None,
    });
    let flow = clip.get("opticalFlow").filter(|v| v.is_object()).map(|v| SmartComplementFrame { fps: f(v, "fps", 60.0).clamp(1.0, 240.0) as u32, sub_type: 0 });
    (smooth.map(|mode| ComplementFrame { mode }), flow)
}

/// A video clip whose Smooth slow-mo or Optical flow is set: its own copy of the media `of`
/// (as CapCut gives every clip its own video material), with the clip's flags. `None` when the
/// clip sets neither and the media has neither, so it plays the media as it is.
fn app_video_algorithm(id: &str, clip: &Value, of: &MaterialId, materials: &mut Materials) -> Option<MaterialId> {
    let (smooth, flow) = app_complement(clip);
    let media = materials.media.iter().find(|m| &m.id == of)?.clone();
    if smooth.is_none() && flow.is_none() && media.complement_frame.is_none() && media.smart_complement_frame.is_none() {
        return None;
    }
    let mid = MaterialId(format!("{id}-video"));
    materials.media.retain(|m| m.id != mid);
    materials.media.push(Media { id: mid.clone(), complement_frame: smooth, smart_complement_frame: flow, ..media });
    Some(mid)
}

/// A freeze-frame clip's still (`freeze: { at }` on a video clip, `at` in seconds of its
/// asset): a material of its own that holds the asset's frame then. `None` for any other clip.
fn app_freeze(id: &str, clip: &Value, materials: &mut Materials) -> Option<MaterialId> {
    let fr = clip.get("freeze").filter(|f| f.is_object())?;
    let asset = materials.media.iter().find(|m| m.id.0 == s(clip, "assetId"))?.clone();
    let mid = MaterialId(format!("{id}-freeze"));
    materials.media.retain(|m| m.id != mid);
    materials.media.push(Media {
        id: mid.clone(),
        kind: MediaKind::Photo,
        // No picture: it's drawn from the video.
        path: String::new(),
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
        has_audio: false,
        matte: asset.matte.clone(),
        reverse_path: None,
        freeze: Some(Freeze { video: asset.path.clone(), at: Micros::from_secs_f64(f(fr, "at", 0.0).max(0.0)) }),
        complement_frame: None,
        smart_complement_frame: None,
    });
    Some(mid)
}

/// The clip's audio fades, as a material it's attached to.
fn attach_fade(id: &str, clip: &Value, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    let (fade_in, fade_out) = (f(clip, "fadeIn", 0.0), f(clip, "fadeOut", 0.0));
    if fade_in > 0.0 || fade_out > 0.0 {
        let mid = MaterialId(format!("{id}-fade"));
        materials.audio_fades.retain(|m| m.id != mid);
        materials.audio_fades.push(AudioFade { id: mid.clone(), fade_in: Micros::from_secs_f64(fade_in), fade_out: Micros::from_secs_f64(fade_out) });
        attachments.push(mid);
    }
}

/// The Adjust panel's sliders (video/image), each an effect the clip is attached to. They
/// keep v1's own scale under a "v1:" name until the colour milestone defines a shared one.
fn attach_adjustments(id: &str, clip: &Value, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    for name in app::ADJUST_KEYS {
        let v = f(clip, name, 0.0);
        if v != 0.0 {
            let mid = MaterialId(format!("{id}-adj-{name}"));
            let mut params = BTreeMap::new();
            params.insert("value".to_string(), v);
            // The app filters the clip on a canvas of its picture fitted to the world, so
            // its pixel distances (blur, sharpness, grain) are world units.
            params.insert("pixel".to_string(), 1.0 / WORLD_H);
            materials.effects.retain(|m| m.id != mid);
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
}

/// The Adjust tab's changes to a converted clip's own adjustments (`draftAdjustments`, by
/// material id): one taken off the list comes off the clip; a new value for one the engine
/// draws (a CapCut Adjust slider, on CapCut's scale, the colour wheels' strength in percent,
/// or an HSL range's hue, saturation and lightness, −100…100) goes on a copy of the draft's
/// material for this clip, in the same place.
fn edit_draft_adjustments(seg: &mut Segment, clip: &Value, base: &Value, materials: &mut Materials) {
    let list = |v: &Value| v.get("draftAdjustments").and_then(Value::as_array).cloned().unwrap_or_default();
    let now = list(clip);
    for was in list(base) {
        let id = MaterialId(s(&was, "id"));
        let Some(entry) = now.iter().find(|e| s(e, "id") == id.0) else {
            seg.attachments.retain(|a| a != &id);
            continue;
        };
        if !b(&was, "drawn") || (same(entry.get("value"), was.get("value")) && same(entry.get("values"), was.get("values"))) {
            continue;
        }
        let value = f(entry, "value", 0.0);
        let copy = MaterialId(format!("{}-{}", seg.id, id.0));
        let edited = match materials.get(&id).map(|m| m.to_owned_material()) {
            Some(AnyMaterial::Effect(mut e)) => {
                let scale = app::capcut_scale(e.builtin.as_deref().unwrap_or_default());
                e.params.insert("intensity".into(), (value / scale).clamp(-1.0, 1.0));
                AnyMaterial::Effect(Effect { id: copy.clone(), ..e })
            }
            Some(AnyMaterial::ColorWheels(w)) => AnyMaterial::ColorWheels(ColorWheels { id: copy.clone(), intensity: (value / 100.0).clamp(0.0, 1.0), ..w }),
            Some(AnyMaterial::Hsl(h)) => {
                let values = entry.get("values").and_then(Value::as_array).cloned().unwrap_or_default();
                let get = |key: &str, now: f32| values.iter().find(|v| s(v, "key") == key).map_or(now, |v| f(v, "value", now as f64).clamp(-100.0, 100.0) as f32);
                AnyMaterial::Hsl(HslAdjust { id: copy.clone(), hue: get("hue", h.hue), saturation: get("saturation", h.saturation), lightness: get("lightness", h.lightness), ..h })
            }
            _ => continue,
        };
        materials.remove(&copy);
        materials.insert_at(edited, None);
        seg.attachments.iter_mut().filter(|a| **a == id).for_each(|a| *a = copy.clone());
    }
}

/// Whether two of the app's values are the same: numbers by value (3 and 3.0 are), objects
/// and arrays field by field, the rest exactly.
fn same(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(Value::Number(x)), Some(Value::Number(y))) => (x.as_f64().unwrap_or(f64::NAN) - y.as_f64().unwrap_or(f64::NAN)).abs() < 1e-6,
        (Some(Value::Object(x)), Some(Value::Object(y))) => x.len() == y.len() && x.iter().all(|(k, v)| same(Some(v), y.get(k))),
        (Some(Value::Array(x)), Some(Value::Array(y))) => x.len() == y.len() && x.iter().zip(y).all(|(v, w)| same(Some(v), Some(w))),
        _ => a == b,
    }
}

/// One of the Animation tab's animations, of `kind`, if it's one the engine draws, within
/// the clip's `length`: an In from the start; an Out up to the end, after the In (they don't
/// overlap); a Combo over the whole clip; a Loop repeating at most once per clip. A clip
/// trimmed shorter than its animation ends it sooner, as CapCut does.
fn app_animation(clip: &Value, kind: AnimationKind, length: Micros) -> Option<Animation> {
    let (field, known): (&str, &[&str]) = match kind {
        AnimationKind::In => ("animationIn", &app::BUILTIN_IN),
        AnimationKind::Out => ("animationOut", &app::BUILTIN_OUT),
        AnimationKind::Combo => ("animationCombo", &app::BUILTIN_COMBO),
        AnimationKind::Loop => ("animationLoop", &app::BUILTIN_LOOP),
        _ => return None,
    };
    let a = clip.get(field).filter(|a| a.is_object())?;
    let builtin = app::engine_builtin(&s(a, "type"), a.get("params"), known)?;
    let given = Micros::from_secs_f64(f(a, "duration", 0.5).max(0.0));
    let (start, duration) = match kind {
        AnimationKind::Out => {
            let room = length - app_animation(clip, AnimationKind::In, length).map_or(Micros::ZERO, |a| a.duration);
            let d = given.min(room);
            (length - d, d)
        }
        AnimationKind::Combo => (Micros::ZERO, length),
        _ => (Micros::ZERO, given.min(length)),
    };
    (duration.0 > 0).then_some(Animation { kind, start, duration, builtin: Some(builtin), library: None, resource: None })
}

/// The Animation tab's caption style, over the whole clip.
fn app_caption_style(clip: &Value, duration: Micros) -> Option<Animation> {
    let ty = s(clip, "captionStyle");
    app::BUILTIN_CAPTION.contains(&ty.as_str()).then(|| Animation { kind: AnimationKind::Caption, start: Micros::ZERO, duration, builtin: Some(ty), library: None, resource: None })
}

/// The Animation tab's transition into the next clip, if it's one the engine draws, at most
/// as long as the clip.
fn app_transition(id: &str, clip: &Value, length: Micros) -> Option<Transition> {
    let t = clip.get("transitionOut").filter(|t| t.is_object())?;
    let ty = s(t, "type");
    let duration = Micros::from_secs_f64(f(t, "duration", 0.5).max(0.0)).min(length);
    let resource = Some(s(t, "resource")).filter(|r| !r.is_empty());
    // Blink draws CapCut's own image sequence.
    let builtin = app::engine_builtin(&ty, t.get("params"), &app::BUILTIN_TRANSITION).filter(|_| ty != "blink" || resource.is_some())?;
    let overlap = app::OVERLAPPING.contains(&ty.as_str());
    (duration.0 > 0).then(|| Transition { id: MaterialId(format!("{id}-transition")), name: s(t, "name"), duration, overlap, builtin: Some(builtin), library: None, resource })
}

/// A segment's animations: all its animation materials' items.
fn attached_animations(seg: &Segment, materials: &Materials) -> Vec<Animation> {
    seg.attachments.iter().filter_map(|id| materials.animations.iter().find(|m| &m.id == id)).flat_map(|m| m.items.iter().cloned()).collect()
}

/// Give a segment these animations, in a material of its own (the two halves of a clip split
/// in the app share the draft's materials).
fn set_animations(seg: &mut Segment, items: Vec<Animation>, materials: &mut Materials) {
    seg.attachments.retain(|id| !materials.animations.iter().any(|m| &m.id == id));
    if !items.is_empty() {
        let id = MaterialId(format!("{}-animations", seg.id));
        materials.animations.retain(|m| m.id != id);
        materials.animations.push(Animations { id: id.clone(), items });
        seg.attachments.push(id);
    }
}

/// Replace a converted clip's animations of the `kinds` the app changed (its caption style
/// for `Caption`) with the app's.
fn edit_animations(seg: &mut Segment, clip: &Value, materials: &mut Materials, kinds: &[AnimationKind]) {
    let mut items = attached_animations(seg, materials);
    items.retain(|a| !kinds.contains(&a.kind));
    for kind in kinds {
        match kind {
            AnimationKind::Caption => items.extend(app_caption_style(clip, seg.target.duration)),
            k => items.extend(app_animation(clip, k.clone(), seg.target.duration)),
        }
    }
    set_animations(seg, items, materials);
}

/// A converted clip's animations after a trim or split in the app: an In, Combo or Loop
/// animation ends by the clip's end (a combo kept by both halves of a split spans each), an
/// Out one is no longer than the clip, and a caption covers the clip and keeps time with the
/// speech, starting `from` into it (what a split or a trim cut off its start, the app's
/// `spokenFrom`). Left as they are when they fit.
fn fit_animations(seg: &mut Segment, from: Micros, materials: &mut Materials) {
    let mut items = attached_animations(seg, materials);
    let length = seg.target.duration;
    let mut changed = false;
    for a in &mut items {
        match a.kind {
            AnimationKind::In | AnimationKind::Combo | AnimationKind::Loop if a.start.0 + a.duration.0 > length.0 => {
                a.duration = Micros((length.0 - a.start.0).max(0));
                changed = true;
            }
            AnimationKind::Out if a.duration.0 > length.0 => {
                a.duration = length;
                changed = true;
            }
            // CapCut's own often ends a µs before its clip.
            AnimationKind::Caption if a.start.0 != -from.0 || a.start.0 + a.duration.0 + 1_000 < length.0 => {
                a.start = Micros(-from.0);
                a.duration = Micros(length.0 + from.0);
                changed = true;
            }
            _ => {}
        }
    }
    if changed {
        set_animations(seg, items, materials);
    }
}

/// The app's masks on a video or image clip (`components/preview/mask`). Shapes, lassos and
/// brush strokes are in world units from the clip's top-left, at the scale the clip had when
/// the mask was drawn (the mask's own `transform`), so they become fractions of the clip's box
/// at that scale. A rectangle turns about its top-left corner, the other shapes about their
/// centre. Each keyframe travels to the next of the same shape by its `ease` (as the clip
/// keyframes', `keys.rs`; linear without one), else holds. Besides the app's own shapes the
/// inspector offers CapCut's: `linear` (Split) and `mirror` (Filmstrip) as CapCut draws them,
/// a `heart` as a polygon of its outline, and a rectangle's `cornerRadius` (0–100, CapCut's
/// Round corners). A key's own `featherAmount` keyframes the feather with the place.
///
/// Each side shows the clip or a colour, as the app's WebGL canvas leaves it: the colour
/// times its opacity, at the opacity squared (it blends the alpha too). Only the first mask
/// paints outside itself. The feather (`featherAmount`, 0–100 as CapCut's slider) softens the
/// edge as CapCut's shapes do, and `inverted` swaps inside and out. Crops are left out.
/// `masksOff` (the Mask section's checkbox, unticked) keeps the masks but draws none.
fn convert_masks(id: &str, clip: &Value, fps: f64, report: &mut ImportReport) -> Vec<Mask> {
    let t = clip.get("transform").cloned().unwrap_or(Value::Null);
    let (cw, ch) = (f(&t, "width", 0.0), f(&t, "height", 0.0));
    let masks = clip.get("masks").and_then(Value::as_array).cloned().unwrap_or_default();
    if cw <= 0.0 || ch <= 0.0 || masks_off(clip) {
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
        if !matches!(tool.as_str(), "shape" | "lasso" | "draw" | "pen") {
            continue;
        }
        let mt = [m.get("transform"), clip.get("originalTransform"), clip.get("transform")].into_iter().flatten().find(|v| v.is_object()).cloned().unwrap_or(Value::Null);
        let (bw, bh) = (or_one(f(&mt, "scaleX", 1.0)) * cw, or_one(f(&mt, "scaleY", 1.0)) * ch);
        let mut frames: Vec<(f64, &Value)> = m.get("keyframes").and_then(Value::as_object).into_iter().flatten().filter_map(|(k, v)| Some((k.parse::<f64>().ok()?, v))).collect();
        frames.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut keys: Vec<MaskKey> = Vec::new();
        let mut eases: Vec<Value> = Vec::new();
        for (frame, data) in frames {
            let at = Micros::from_secs_f64(frame / fps);
            let ease = data.get("ease").cloned().unwrap_or(Value::Null);
            if tool == "draw" {
                // Brush strokes: points and width in world units at the mask's scale.
                let strokes: Vec<BrushStroke> = data
                    .get("brushStrokes")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|st| {
                        let pts: Vec<f64> = st.get("points")?.as_array()?.iter().filter_map(Value::as_f64).collect();
                        let points: Vec<[f32; 2]> = pts.chunks_exact(2).map(|p| [(p[0] / bw) as f32, (p[1] / bh) as f32]).collect();
                        (!points.is_empty()).then(|| BrushStroke { points, width: (f(st, "size", 10.0) / bh) as f32, erase: b(st, "erase") })
                    })
                    .collect();
                if strokes.is_empty() {
                    continue;
                }
                keys.push(MaskKey { at, shape: MaskShape::Brush { strokes }, center: [0.0, 0.0], size: [1.0, 1.0], rotation: 0.0, feather: key_feather(data), expansion: key_expansion(data), ease: Easing::Linear });
                eases.push(ease);
                continue;
            }
            if tool == "pen" {
                // CapCut's pen: a closed path of cubic beziers through its anchors (each with
                // the handles it leaves and arrives by), drawn as the polygon of the curve.
                let anchors: Vec<[f64; 6]> = data
                    .pointer("/penPath/points")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(|p| {
                        let (x, y) = (f(p, "x", 0.0), f(p, "y", 0.0));
                        [x, y, f(p, "ix", x), f(p, "iy", y), f(p, "ox", x), f(p, "oy", y)]
                    })
                    .collect();
                if anchors.len() < 3 {
                    continue;
                }
                let points: Vec<[f32; 2]> = pen_points(&anchors).into_iter().map(|[px, py]| [(px / bw) as f32, (py / bh) as f32]).collect();
                keys.push(MaskKey { at, shape: MaskShape::Polygon { points }, center: [0.0, 0.0], size: [1.0, 1.0], rotation: 0.0, feather: key_feather(data), expansion: key_expansion(data), ease: Easing::Linear });
                eases.push(ease);
                continue;
            }
            if tool == "lasso" {
                let Some(pts) = data.get("lassoPoints").and_then(Value::as_array) else {
                    if data.get("lassoPointsBinPath").is_some() {
                        bump(&mut report.kept_foreign, "mask lassos saved as binary files (not read yet)");
                    }
                    continue;
                };
                let points: Vec<[f32; 2]> = pts.iter().filter_map(Value::as_f64).collect::<Vec<_>>().chunks_exact(2).map(|p| [(p[0] / bw) as f32, (p[1] / bh) as f32]).collect();
                keys.push(MaskKey { at, shape: MaskShape::Polygon { points }, center: [0.0, 0.0], size: [1.0, 1.0], rotation: 0.0, feather: key_feather(data), expansion: key_expansion(data), ease: Easing::Linear });
                eases.push(ease);
                continue;
            }
            let Some(b) = data.get("shapeBounds").filter(|b| b.is_object()) else { continue };
            let (w, h) = (f(b, "width", 0.0) * f(b, "scaleX", 1.0), f(b, "height", 0.0) * f(b, "scaleY", 1.0));
            let rotation = f(b, "rotation", 0.0);
            let (x, y) = (f(b, "x", 0.0), f(b, "y", 0.0));
            let shape_type = s(b, "shapeType");
            let (cx, cy) = if matches!(shape_type.as_str(), "ellipse" | "circle" | "polygon" | "star" | "heart" | "linear" | "mirror" | "text") {
                (x + w / 2.0, y + h / 2.0)
            } else {
                let (sn, cs) = rotation.to_radians().sin_cos();
                (x + cs * w / 2.0 - sn * h / 2.0, y + sn * w / 2.0 + cs * h / 2.0)
            };
            // A draft's heart or star keeps CapCut's own picture (`picture`), drawn as CapCut
            // draws it while that's on this machine.
            let picture = s(b, "picture");
            let shape = match shape_type.as_str() {
                "heart" | "star" if !picture.is_empty() => MaskShape::Picture { name: if shape_type == "heart" { "heart".into() } else { "pentagram".into() }, path: picture },
                "circle" => MaskShape::Circle,
                "ellipse" => MaskShape::Ellipse,
                "polygon" => MaskShape::Triangle,
                "star" => MaskShape::Star,
                "linear" => MaskShape::Linear,
                "mirror" => MaskShape::Mirror,
                "heart" => MaskShape::Polygon { points: heart_points(cx, cy, w, h, rotation).into_iter().map(|[px, py]| [(px / bw) as f32, (py / bh) as f32]).collect() },
                // A text mask: its words and style; the size in world units at the mask's scale.
                "text" => {
                    let t = data.get("text").unwrap_or(&Value::Null);
                    MaskShape::Text(MaskText {
                        text: s(t, "content"),
                        font: s(t, "font"),
                        size: (f(t, "size", 40.0) / bh) as f32,
                        bold: t.get("bold").and_then(Value::as_bool).unwrap_or(false),
                        italic: t.get("italic").and_then(Value::as_bool).unwrap_or(false),
                        underline: t.get("underline").and_then(Value::as_bool).unwrap_or(false),
                        letter_spacing: f(t, "letterSpacing", 0.0) as f32,
                        line_spacing: f(t, "lineSpacing", 0.0) as f32,
                        align: match s(t, "align").as_str() {
                            "left" => 0,
                            "right" => 2,
                            _ => 1,
                        },
                    })
                }
                _ => MaskShape::Rectangle { round_corner: (f(b, "cornerRadius", 0.0) / 100.0).clamp(0.0, 1.0) as f32 },
            };
            keys.push(MaskKey {
                at,
                shape,
                center: [(cx / bw * 2.0 - 1.0) as f32, (1.0 - cy / bh * 2.0) as f32],
                size: [(w / bw) as f32, (h / bh) as f32],
                rotation: rotation as f32,
                feather: key_feather(data),
                expansion: key_expansion(data),
                ease: Easing::Linear,
            });
            eases.push(ease);
        }
        if keys.is_empty() {
            continue;
        }
        // Each key's easing over the span to the next.
        for i in 0..keys.len().saturating_sub(1) {
            let span = (keys[i + 1].at.0 - keys[i].at.0) as f64;
            keys[i].ease = keys::progress_ease(&eases[i], span, fps);
        }
        // The mask's own shape and place are its first key's (all its keys are kept).
        let first = keys[0].clone();
        out.push(Mask {
            id: MaterialId(format!("{id}-mask{index}")),
            shape: first.shape,
            center: first.center,
            size: first.size,
            rotation: first.rotation,
            feather: (f(m, "featherAmount", 0.0) / 100.0).clamp(0.0, 1.0) as f32,
            expansion: expansion_of(m.get("expansion")).unwrap_or(0.0),
            invert: b(m, "inverted"),
            inside: paint(m.get("maskColorEnabled").and_then(Value::as_bool).unwrap_or(false), &s(m, "maskColor"), "#ffffff", f(m, "maskOpacity", 100.0)),
            // A mask that cuts the clip (a clear outside, as the Mask tab makes them) cuts it
            // wherever it is in the list, as each of a CapCut draft's masks does.
            outside: paint((index == 0 || f(m, "backgroundOpacity", 100.0) == 0.0) && m.get("backgroundColorEnabled").and_then(Value::as_bool).unwrap_or(false), &s(m, "backgroundColor"), "#000000", f(m, "backgroundOpacity", 100.0)),
            keys: if keys.len() > 1 { keys } else { Vec::new() },
            library: None,
        });
    }
    out
}

/// Whether the clip's masks are switched off (the Mask section's checkbox).
fn masks_off(clip: &Value) -> bool {
    clip.get("masksOff").and_then(Value::as_bool).unwrap_or(false)
}

/// A mask key's own feather (`featherAmount`, 0–100), when it has one.
fn key_feather(data: &Value) -> Option<f32> {
    data.get("featherAmount").and_then(Value::as_f64).map(|v| (v / 100.0).clamp(0.0, 1.0) as f32)
}

/// The Mask tab's Expansion (−100…100) as the engine's: a tenth of the picture's height at
/// either end of the slider (OpenRip's own scale; CapCut's isn't measured).
fn expansion_of(v: Option<&Value>) -> Option<f32> {
    v.and_then(Value::as_f64).map(|v| (v.clamp(-100.0, 100.0) / 100.0 * 0.1) as f32)
}

/// A mask key's own expansion, when it has one.
fn key_expansion(data: &Value) -> Option<f32> {
    expansion_of(data.get("expansion"))
}

/// The polygon of a closed pen path: each anchor `[x, y, in x, in y, out x, out y]` (its
/// handles absolute), the curve from one anchor to the next a cubic bezier through the first's
/// out handle and the next's in handle, 16 points a span.
fn pen_points(anchors: &[[f64; 6]]) -> Vec<[f64; 2]> {
    const STEPS: usize = 16;
    let n = anchors.len();
    let mut out = Vec::with_capacity(n * STEPS);
    for i in 0..n {
        let (a, b) = (anchors[i], anchors[(i + 1) % n]);
        let p = [[a[0], a[1]], [a[4], a[5]], [b[2], b[3]], [b[0], b[1]]];
        for k in 0..STEPS {
            let t = k as f64 / STEPS as f64;
            let u = 1.0 - t;
            let w = [u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t];
            out.push([0, 1].map(|c| (0..4).map(|j| w[j] * p[j][c]).sum::<f64>()));
        }
    }
    out
}

/// The app's heart mask: the classic heart curve (x = 16 sin³t, y = 13 cos t − 5 cos 2t −
/// 2 cos 3t − cos 4t) across the box's width and 0.9 of its height (as CapCut's heart fills
/// its box), about the box's centre `cx`, `cy`, turned clockwise by `rotation` degrees; 64
/// points in world units, y down. `lib/mask-shapes.ts` draws the same outline on the canvas.
fn heart_points(cx: f64, cy: f64, w: f64, h: f64, rotation: f64) -> Vec<[f64; 2]> {
    const N: usize = 64;
    // The curve's extent: x in ±16, y from −17 (the point) to about 11.92 (the lobes).
    let (top, bottom) = (11.9233, -17.0);
    let (sn, cs) = rotation.to_radians().sin_cos();
    (0..N)
        .map(|i| {
            let t = i as f64 / N as f64 * std::f64::consts::TAU;
            let x = 16.0 * t.sin().powi(3);
            let y = 13.0 * t.cos() - 5.0 * (2.0 * t).cos() - 2.0 * (3.0 * t).cos() - (4.0 * t).cos();
            let (dx, dy) = (x / 32.0 * w, -(y - (top + bottom) / 2.0) / (top - bottom) * 0.9 * h);
            [cx + cs * dx - sn * dy, cy + sn * dx + cs * dy]
        })
        .collect()
}

/// A colour from `#rrggbb` with an opacity in percent.
fn hex_alpha(clip: &Value, key: &str, default: &str, opacity_key: &str) -> Rgba {
    let mut c = Rgba::from_hex(&Some(s(clip, key)).filter(|h| !h.is_empty()).unwrap_or_else(|| default.into())).unwrap_or(Rgba::BLACK);
    c.a = (f(clip, opacity_key, 100.0) / 100.0).clamp(0.0, 1.0) as f32;
    c
}

/// A shape clip as the app's preview draws it (`ShapePreview.tsx`): in a box of the clip's
/// width and height, scaled by its scaleX/scaleY, filled then stroked, over its shadow.
/// - CapCut's shapes from the Stickers tab: a triangle, parallelogram and trapezoid filling
///   the box (`triangle`, `parallelogram`, `trapezoid`), a line and an arrow (an open `path`
///   of two points, the arrow with an arrow at its end), and the pen's `path`: points in
///   fractions of the box with Bézier handles as offsets (`inX`, `inY`, `outX`, `outY`),
///   closed or open (`pathClosed`).
/// - `fillEnabled` and `strokeEnabled` turn the fill and stroke on (by default the fill for
///   closed shapes and the stroke when it has a width); `strokeStyle` dashes it; `capStart` and
///   `capEnd` mark an open outline's ends (`arrow`, `round`).
/// - `shadowEnabled` with `shadowColor`, `shadowOpacity` (%), `shadowDistance` (world units)
///   and `shadowAngle` (degrees clockwise from +x on screen): a copy under the shape.
/// - Older shapes (`rectangle`, `ellipse`, a regular `polygon`, `star`, a `line` with no path
///   along the box's top) draw as before.
fn convert_shape(id: &MaterialId, clip: &Value) -> Shape {
    let t = clip.get("transform").cloned().unwrap_or(Value::Null);
    let (w, h) = (f(&t, "width", 100.0) as f32, f(&t, "height", 100.0) as f32);
    let scale = [f(&t, "scaleX", 1.0) as f32, f(&t, "scaleY", 1.0) as f32];
    let corner = f(&t, "cornerRadius", 0.0) as f32;
    let shape_type = s(clip, "shapeType");
    // The pen's points (and a line's or an arrow's), in the box's units.
    let nodes: Option<Vec<[f32; 6]>> = clip.get("path").and_then(Value::as_array).map(|pts| {
        pts.iter()
            .map(|p| [f(p, "x", 0.0) as f32 * w, f(p, "y", 0.0) as f32 * h, f(p, "inX", 0.0) as f32 * w, f(p, "inY", 0.0) as f32 * h, f(p, "outX", 0.0) as f32 * w, f(p, "outY", 0.0) as f32 * h])
            .collect()
    });
    let closed = b(clip, "pathClosed");
    let geometry = match shape_type.as_str() {
        "ellipse" => Geometry::Ellipse,
        "polygon" => Geometry::Polygon { sides: f(clip, "sides", 3.0).max(3.0) as u32, radius: (w / 3f32.sqrt()).min(h / 1.5), corner_radius: corner },
        "star" => Geometry::Star { points: f(clip, "points", 5.0).max(2.0) as u32, inner: w.min(h) / 4.0, outer: w.min(h) / 2.0 },
        "triangle" => Geometry::Vertices { points: vec![[w / 2.0, 0.0], [w, h], [0.0, h]], corner_radius: corner },
        "parallelogram" => Geometry::Vertices { points: vec![[w / 3.0, 0.0], [w, 0.0], [w * 2.0 / 3.0, h], [0.0, h]], corner_radius: corner },
        "trapezoid" => Geometry::Vertices { points: vec![[w / 4.0, 0.0], [w * 3.0 / 4.0, 0.0], [w, h], [0.0, h]], corner_radius: corner },
        "path" => Geometry::Path { nodes: nodes.clone().unwrap_or_default(), closed },
        "line" | "arrow" => match &nodes {
            Some(nodes) => Geometry::Path { nodes: nodes.clone(), closed: false },
            // The app's first lines ran along the top of their box.
            None if shape_type == "line" => Geometry::Line { points: vec![[0.0, 0.0], [w, 0.0]], tension: 0.0, closed: false },
            None => Geometry::Line { points: vec![[0.0, h / 2.0], [w, h / 2.0]], tension: 0.0, closed: false },
        },
        _ => Geometry::Rectangle { corner_radius: corner },
    };
    let open = matches!(shape_type.as_str(), "line" | "arrow") || (shape_type == "path" && !closed);
    let fill_on = clip.get("fillEnabled").and_then(Value::as_bool).unwrap_or(!open && shape_type != "path");
    let stroke_width = f(clip, "strokeWidth", 2.0) as f32;
    let stroke_on = clip.get("strokeEnabled").and_then(Value::as_bool).unwrap_or(stroke_width > 0.0) && stroke_width > 0.0;
    let marker = |key: &str, default: StrokeMarker| match clip.get(key).and_then(Value::as_str) {
        Some("arrow") => StrokeMarker::Arrow,
        Some("round") => StrokeMarker::Dot,
        Some(_) => StrokeMarker::None,
        None => default,
    };
    let stroke = stroke_on.then(|| ShapeStroke {
        color: hex_alpha(clip, "stroke", "#1e40af", "strokeOpacity"),
        width: stroke_width,
        ends: StrokeEnds::Butt,
        dash: match s(clip, "strokeStyle").as_str() {
            "dashed" => StrokeDash::Dashed,
            "dotted" => StrokeDash::Dotted,
            _ => StrokeDash::Solid,
        },
        start: if open { marker("capStart", StrokeMarker::None) } else { StrokeMarker::None },
        end: if open { marker("capEnd", if shape_type == "arrow" { StrokeMarker::Arrow } else { StrokeMarker::None }) } else { StrokeMarker::None },
    });
    // The shadow's offset is in world units, whatever the shape's scale.
    let shadow = b(clip, "shadowEnabled").then(|| {
        let (dist, angle) = (f(clip, "shadowDistance", 0.0), f(clip, "shadowAngle", 45.0).to_radians());
        let off = |v: f64, s: f32| (v / f64::from(if s.abs() > 1e-6 { s.abs() } else { 1.0 })) as f32;
        ShapeShadow { color: hex_alpha(clip, "shadowColor", "#000000", "shadowOpacity"), offset: [off(dist * angle.cos(), scale[0]), off(dist * angle.sin(), scale[1])] }
    });
    Shape {
        id: id.clone(),
        size: [w, h],
        scale,
        unit: (1.0 / WORLD_H) as f32,
        paths: vec![ShapePath {
            // An open outline (a line, an arrow, an open pen path) has no inside.
            fill: (fill_on && !open).then(|| hex_alpha(clip, "fill", "#3b82f6", "fillOpacity")),
            stroke,
            opacity: 1.0,
            blend: PathBlend::Normal,
            geometry,
        }],
        shadow,
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
                stroke: Some(ShapeStroke { color, width: (f(line, "strokeWidth", 4.0) * (sx.abs() * sy.abs()).sqrt()) as f32, ends, dash: StrokeDash::Solid, start: StrokeMarker::None, end: StrokeMarker::None }),
                opacity: if tool == "eraser" { 1.0 } else { (f(line, "opacity", 100.0) / 100.0) as f32 },
                blend: PathBlend::Normal,
            })
        })
        .collect();
    Shape { id: id.clone(), size: [world.w as f32, world.h as f32], scale: [1.0, 1.0], unit: (1.0 / WORLD_H) as f32, paths, shadow: None }
}

/// `text` in the case the app's `textTransform` shows it in.
fn transform_case(raw: &str, transform: &str) -> String {
    match transform {
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
        _ => raw.to_string(),
    }
}

/// A text clip's stroke, shadow and background, with sizes as fractions of its font size.
struct TextEffects {
    stroke: Option<Stroke>,
    shadow: Option<TextShadow>,
    background: Option<TextBackground>,
}

fn text_effects(clip: &Value) -> TextEffects {
    let font_size = f(clip, "fontSize", 48.0).max(1.0);
    let rel = |px: f64| (px / font_size) as f32;
    let stroke = b(clip, "strokeEnabled").then(|| Stroke {
        color: hex_alpha(clip, "stroke", "#000000", "strokeOpacity"),
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
    TextEffects { stroke, shadow, background }
}

fn convert_text(id: &MaterialId, clip: &Value, world: &World) -> Text {
    let text = transform_case(&s(clip, "text"), &s(clip, "textTransform"));
    let font_size = f(clip, "fontSize", 48.0).max(1.0);
    let TextEffects { stroke, shadow, background } = text_effects(clip);
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
            gradient: clip.get("fillGradient").and_then(text::gradient),
            stroke,
            more_strokes: text::more_strokes(clip),
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
            letter_spacing: text::letter_spacing(clip),
            line_spacing: text::line_spacing(clip, false),
            // Konva's default line height.
            line_height: Some(1.0),
            kerning: true,
            background,
            shadow,
            glow: text::glow(clip),
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
    fn capcuts_shapes_and_the_pen_become_outlines() {
        let mut d = doc();
        let tl = d["timeline"].as_object_mut().unwrap();
        tl["tracks"].as_array_mut().unwrap().insert(0, json!({"type": "shape", "timelineId": "T-shape"}));
        let clips = tl["clips"].as_array_mut().unwrap();
        let shape = |id: &str, extra: Value| {
            let mut c = json!({"clipId": id, "type": "shape", "timelineId": "T-shape", "startTick": "0", "endTick": "1000000", "trimStartTick": "0", "trimEndTick": "0",
                "fill": "#949494", "stroke": "#cccccc", "strokeWidth": 4,
                "transform": {"x": 100, "y": 100, "width": 90, "height": 60, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 100, "cornerRadius": 5}});
            c.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            c
        };
        clips.push(shape("par", json!({"shapeType": "parallelogram", "fillEnabled": true, "strokeEnabled": false})));
        clips.push(shape("trap", json!({"shapeType": "trapezoid", "fillEnabled": true, "strokeEnabled": true, "strokeStyle": "dashed",
            "shadowEnabled": true, "shadowColor": "#000000", "shadowOpacity": 50, "shadowDistance": 10, "shadowAngle": 90})));
        clips.push(shape("tri", json!({"shapeType": "triangle", "fillEnabled": false, "strokeEnabled": true})));
        clips.push(shape("arrow", json!({"shapeType": "arrow", "fillEnabled": false, "strokeEnabled": true, "path": [{"x": 0, "y": 0.5}, {"x": 1, "y": 0.5}]})));
        clips.push(shape("pen", json!({"shapeType": "path", "fillEnabled": true, "strokeEnabled": true, "pathClosed": true, "capEnd": "arrow",
            "path": [{"x": 0, "y": 1}, {"x": 0.5, "y": 0, "inX": -0.25, "inY": 0, "outX": 0.25, "outY": 0}, {"x": 1, "y": 1}]})));
        clips.push(shape("open", json!({"shapeType": "path", "fillEnabled": true, "strokeEnabled": true, "pathClosed": false, "capStart": "round", "strokeStyle": "dotted",
            "path": [{"x": 0, "y": 0}, {"x": 1, "y": 1}]})));
        let Imported { project, report } = import_v1_json(&d).unwrap();
        assert!(report.kept_foreign.is_empty(), "{:?}", report.kept_foreign);
        let get = |id: &str| project.materials.shapes.iter().find(|m| m.id.0 == format!("{id}-shape")).unwrap().clone();

        // The parallelogram leans right by a third of its box; filled, no stroke, its corners rounded.
        let par = get("par");
        assert_eq!(par.paths[0].geometry, Geometry::Vertices { points: vec![[30.0, 0.0], [90.0, 0.0], [60.0, 60.0], [0.0, 60.0]], corner_radius: 5.0 });
        assert!(par.paths[0].fill.is_some() && par.paths[0].stroke.is_none() && par.shadow.is_none());
        // The trapezoid's top is half its bottom; a dashed stroke; a half-black shadow 10 down.
        let trap = get("trap");
        assert_eq!(trap.paths[0].geometry, Geometry::Vertices { points: vec![[22.5, 0.0], [67.5, 0.0], [90.0, 60.0], [0.0, 60.0]], corner_radius: 5.0 });
        assert_eq!(trap.paths[0].stroke.unwrap().dash, StrokeDash::Dashed);
        let sh = trap.shadow.unwrap();
        assert!((sh.color.a - 0.5).abs() < 1e-6 && sh.offset[0].abs() < 1e-4 && (sh.offset[1] - 10.0).abs() < 1e-4, "{sh:?}");
        // The triangle's apex is the top's middle; its fill off.
        let tri = get("tri");
        assert_eq!(tri.paths[0].geometry, Geometry::Vertices { points: vec![[45.0, 0.0], [90.0, 60.0], [0.0, 60.0]], corner_radius: 5.0 });
        assert!(tri.paths[0].fill.is_none() && tri.paths[0].stroke.is_some());
        // The arrow: an open path across the box's middle, an arrow at its end and no inside.
        let arrow = get("arrow");
        assert_eq!(arrow.paths[0].geometry, Geometry::Path { nodes: vec![[0.0, 30.0, 0.0, 0.0, 0.0, 0.0], [90.0, 30.0, 0.0, 0.0, 0.0, 0.0]], closed: false });
        let st = arrow.paths[0].stroke.unwrap();
        assert_eq!((st.start, st.end, st.width), (StrokeMarker::None, StrokeMarker::Arrow, 4.0));
        assert!(arrow.paths[0].fill.is_none());
        // The pen: its points and handles in the box's units, closed and filled; a closed
        // outline has no ends to mark.
        let pen = get("pen");
        assert_eq!(
            pen.paths[0].geometry,
            Geometry::Path { nodes: vec![[0.0, 60.0, 0.0, 0.0, 0.0, 0.0], [45.0, 0.0, -22.5, 0.0, 22.5, 0.0], [90.0, 60.0, 0.0, 0.0, 0.0, 0.0]], closed: true }
        );
        assert!(pen.paths[0].fill.is_some());
        assert_eq!(pen.paths[0].stroke.unwrap().end, StrokeMarker::None);
        // An open pen path isn't filled, and keeps its caps and dots.
        let open = get("open");
        let st = open.paths[0].stroke.unwrap();
        assert!(open.paths[0].fill.is_none());
        assert_eq!((st.start, st.dash), (StrokeMarker::Dot, StrokeDash::Dotted));
    }

    #[test]
    fn masks_become_fractions_of_the_clip_with_their_keys() {
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
        assert_eq!((m.keys.len(), m.keys[1].at, m.keys[1].shape.clone(), m.keys[0].ease), (2, Micros(1_000_000), MaskShape::Ellipse, Easing::Linear));
        assert_eq!(m.inside, MaskPaint::Color(Rgba { r: 1.0, g: 1.0, b: 1.0, a: 1.0 }));
        assert_eq!(m.outside, MaskPaint::Color(Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.25 }));
        // Only the first mask paints outside itself.
        let lasso = &project.materials.masks[1];
        assert_eq!(lasso.shape, MaskShape::Polygon { points: vec![[0.0, 0.0], [0.5, 0.0], [0.0, 0.5]] });
        assert_eq!((lasso.inside, lasso.outside), (MaskPaint::Clip, MaskPaint::Clip));
        // The Mask section's checkbox unticked: the masks stay on the clip, none is drawn.
        d["timeline"]["clips"][0]["masksOff"] = json!(true);
        let Imported { project, .. } = import_v1_json(&d).unwrap();
        assert!(project.materials.masks.is_empty());
    }

    /// The inspector's CapCut shapes: Split and Filmstrip as CapCut's linear and mirror, a
    /// heart as its outline, a rectangle's round corners, and a feather keyed with the place.
    #[test]
    fn the_inspectors_mask_shapes_and_keyed_feather() {
        let mut d = doc();
        let clip = &mut d["timeline"]["clips"][0];
        let mask = |id: &str, bounds: Value| json!({"id": id, "tool": "shape", "featherAmount": 10, "transform": {"x": 0, "y": 0, "width": 1066.6666666666667, "height": 600, "scaleX": 1, "scaleY": 1}, "keyframes": {"0": {"shapeBounds": bounds}}});
        clip["masks"] = json!([
            mask("a", json!({"x": 433.3333333333333, "y": 250, "width": 200, "height": 100, "rotation": 30, "shapeType": "linear"})),
            mask("b", json!({"x": 433.3333333333333, "y": 250, "width": 200, "height": 100, "shapeType": "mirror"})),
            mask("c", json!({"x": 433.3333333333333, "y": 200, "width": 200, "height": 200, "shapeType": "heart"})),
            {"id": "d", "tool": "shape", "featherAmount": 10, "transform": {"x": 0, "y": 0, "width": 1066.6666666666667, "height": 600, "scaleX": 1, "scaleY": 1},
             "keyframes": {"0": {"shapeBounds": {"x": 0, "y": 0, "width": 200, "height": 100, "cornerRadius": 40, "shapeType": "rectangle"}, "featherAmount": 0},
                           "24": {"shapeBounds": {"x": 0, "y": 0, "width": 200, "height": 100, "cornerRadius": 80, "shapeType": "rectangle"}, "featherAmount": 50}}},
        ]);
        let Imported { project, .. } = import_v1_json(&d).unwrap();
        let m = |id: &str| project.materials.masks.iter().find(|m| m.id.0 == format!("v1-mask{id}")).unwrap();
        // Centred in the picture, turned as given.
        let (a, b) = (m("0"), m("1"));
        assert_eq!((a.shape.clone(), a.rotation, b.shape.clone()), (MaskShape::Linear, 30.0, MaskShape::Mirror));
        assert!(a.center[0].abs() < 1e-5 && a.center[1].abs() < 1e-5 && (b.size[1] - 1.0 / 6.0).abs() < 1e-5, "{a:?} {b:?}");
        // The heart spans the box's width and 0.9 of its height, about its centre.
        let MaskShape::Polygon { points } = &m("2").shape else { panic!("a heart polygon") };
        let xs = points.iter().map(|p| p[0]).fold((f32::MAX, f32::MIN), |(lo, hi), x| (lo.min(x), hi.max(x)));
        let ys = points.iter().map(|p| p[1]).fold((f32::MAX, f32::MIN), |(lo, hi), y| (lo.min(y), hi.max(y)));
        assert!(points.len() == 64 && ((xs.1 - xs.0) - 0.1875).abs() < 0.002 && ((ys.1 - ys.0) - 0.3).abs() < 0.003, "{xs:?} {ys:?}");
        // Round corners and the feather travel from key to key.
        let r = m("3");
        assert_eq!((r.keys[0].shape.clone(), r.keys[1].shape.clone()), (MaskShape::Rectangle { round_corner: 0.4 }, MaskShape::Rectangle { round_corner: 0.8 }));
        assert_eq!((r.feather, r.keys[0].feather, r.keys[1].feather), (0.1, Some(0.0), Some(0.5)));
    }

    /// The Mask tab's Text, Pen and Brush: a text's words and style, a pen's closed bezier
    /// path as its polygon, the expansion; and a second mask that cuts the clip cuts it too.
    #[test]
    fn text_pen_expansion_and_a_second_cutting_mask() {
        let mut d = doc();
        let clip = &mut d["timeline"]["clips"][0];
        let tr = json!({"x": 0, "y": 0, "width": 1066.6666666666667, "height": 600, "scaleX": 1, "scaleY": 1});
        clip["masks"] = json!([
            {"id": "t", "tool": "shape", "featherAmount": 0, "transform": tr, "backgroundColorEnabled": true, "backgroundOpacity": 0,
             "keyframes": {"0": {"shapeBounds": {"x": 433.3333333333333, "y": 250, "width": 200, "height": 100, "rotation": 15, "shapeType": "text"},
                                 "text": {"content": "Hello", "font": "Georgia", "size": 60, "bold": true, "underline": true, "letterSpacing": 0.1, "align": "left"}}}},
            {"id": "p", "tool": "pen", "featherAmount": 0, "expansion": 50, "transform": tr, "backgroundColorEnabled": true, "backgroundOpacity": 0,
             "keyframes": {"0": {"penPath": {"closed": true, "points": [
                {"x": 100, "y": 100, "ix": 100, "iy": 100, "ox": 100, "oy": 100},
                {"x": 300, "y": 100, "ix": 300, "iy": 100, "ox": 300, "oy": 100},
                {"x": 300, "y": 300, "ix": 300, "iy": 300, "ox": 300, "oy": 300}]}}}}
        ]);
        let Imported { project, .. } = import_v1_json(&d).unwrap();
        let m = |id: &str| project.materials.masks.iter().find(|m| m.id.0 == format!("v1-mask{id}")).unwrap();
        let MaskShape::Text(t) = &m("0").shape else { panic!("a text mask") };
        assert_eq!((t.text.as_str(), t.font.as_str(), t.bold, t.underline, t.align, t.letter_spacing), ("Hello", "Georgia", true, true, 0, 0.1));
        assert!((t.size - 0.1).abs() < 1e-6 && m("0").center[0].abs() < 1e-5 && m("0").rotation == 15.0);
        // The pen's straight spans: 16 points each, the corners on it.
        let MaskShape::Polygon { points } = &m("1").shape else { panic!("a pen polygon") };
        assert_eq!(points.len(), 48);
        assert!((points[16][0] - 300.0 / 1066.6666666666667).abs() < 1e-5 && (points[16][1] - 100.0 / 600.0).abs() < 1e-5);
        assert!((m("1").expansion - 0.05).abs() < 1e-6);
        // Both cut the clip: a clear outside, the second's too.
        assert!(m("1").outside == MaskPaint::Color(Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }));
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

    #[test]
    fn the_text_tabs_spacing_glow_gradient_outlines_and_style() {
        let mut d = doc();
        let clip = d["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["type"] == "text").unwrap();
        // Character 2 and Line 3 (CapCut's steps of 1/20 em), a gradient, a second outline of
        // 9 px at 60 px, a glow in the text's colours and a style from the Effects tab.
        clip["letterSpacing"] = json!(2);
        clip["lineSpacing"] = json!(3);
        clip["fillGradient"] = json!({ "colors": ["#ff0000", "#0000ff80"], "angle": 90, "span": "text" });
        clip["moreStrokes"] = json!([{ "color": "#ffffff", "width": 9, "opacity": 50 }, { "color": "#000000", "width": 0 }]);
        clip["glowEnabled"] = json!(true);
        clip["glowIntensity"] = json!(60);
        clip["glowOffsetY"] = json!(-50);
        clip["textEffect"] = json!({ "id": "shadowed", "name": "Shadowed", "shadows": [{ "paint": { "color": "#000000", "opacity": 80 }, "distance": 0.08, "angle": -45, "blur": 0.05 }] });
        let fs = clip["fontSize"].as_f64().unwrap();
        let Imported { project, .. } = import_v1_json(&d).unwrap();
        let text = &project.materials.texts[0];
        let run = &text.runs[0];
        assert!((text.layout.letter_spacing - 0.1).abs() < 1e-6 && (text.layout.line_spacing - 0.15).abs() < 1e-6);
        let g = run.gradient.as_ref().unwrap();
        assert_eq!((g.stops.clone(), g.angle_deg, g.span, g.colors[1].a), (vec![0.0, 1.0], 90.0, GradientSpan::Text, 128.0 / 255.0));
        assert_eq!(run.more_strokes.len(), 1);
        assert!((run.more_strokes[0].width - (9.0 / fs) as f32).abs() < 1e-6 && run.more_strokes[0].color.a == 0.5);
        let glow = text.layout.glow.as_ref().unwrap();
        assert_eq!((glow.color, glow.strength, glow.range, glow.direction), (None, 0.6, 0.2, [0.5, 0.25]));
        let seg = project.tracks.iter().flat_map(|t| &t.segments).find(|s| s.material == text.id).unwrap();
        let style = project.materials.effects.iter().find(|e| seg.attachments.contains(&e.id)).unwrap();
        let fx = style.text_style.as_ref().unwrap();
        assert_eq!((style.name.as_str(), fx.shadows.len(), fx.shadows[0].paint.alpha), ("Shadowed", 1, 0.8));
        // Without the fields, the text is as before.
        let plain = &import_v1_json(&doc()).unwrap().project.materials.texts[0];
        assert!(plain.layout.glow.is_none() && plain.runs[0].gradient.is_none() && plain.runs[0].more_strokes.is_empty());
        assert_eq!((plain.layout.letter_spacing, plain.layout.line_spacing), (0.0, 0.0));
    }

    #[test]
    fn glow_keyframes_drive_the_glow() {
        let mut d = doc();
        let clip = d["timeline"]["clips"].as_array_mut().unwrap().iter_mut().find(|c| c["type"] == "text").unwrap();
        clip["glowEnabled"] = json!(true);
        clip["keyframes"] = json!({ "glowIntensity": [{ "frame": 0, "value": 0 }, { "frame": 12, "value": 100 }], "glowColor": [{ "frame": 0, "value": "#ff0000" }] });
        let project = import_v1_json(&d).unwrap().project;
        let text = &project.materials.texts[0];
        let seg = project.tracks.iter().flat_map(|t| &t.segments).find(|s| s.material == text.id).unwrap();
        let at = seg.text_at(text, Micros(250_000));
        let glow = at.layout.glow.unwrap();
        assert!((glow.strength - 0.5).abs() < 1e-3, "{glow:?}");
        assert_eq!(glow.color, Some(Rgba { r: 1.0, g: 0.0, b: 0.0, a: 1.0 }));
    }
}

