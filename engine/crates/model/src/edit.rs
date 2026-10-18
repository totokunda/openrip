//! Editing and undo/redo.
//!
//! Every change to a project is an [`Edit`]. Edits are plain data (serde), so the UI
//! can send them as JSON. An edit is *planned* against the current project into a list
//! of primitive [`Op`]s; applying an op returns its exact inverse. Undo therefore can't
//! drift from redo: it replays recorded inverses rather than hand-written undo logic.
//!
//! Edits are atomic: if any op fails, the ops already applied are rolled back.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::animated::Animated;
use crate::material::{AnyMaterial, MaterialId};
use crate::project::{Canvas, Project, Segment, Track, TrackKind, Transform};
use crate::time::{FrameRate, Micros, TimeRange};

#[derive(Clone, Debug, PartialEq)]
pub enum EditError {
    NotFound(String),
    /// The change would make two segments overlap on a track.
    Overlap { track_id: String, at: Micros },
    Locked(String),
    InUse(String),
    Invalid(String),
}

impl fmt::Display for EditError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EditError::NotFound(what) => write!(f, "not found: {what}"),
            EditError::Overlap { track_id, at } => write!(f, "overlaps another segment on track {track_id} at {}µs", at.0),
            EditError::Locked(track) => write!(f, "track {track} is locked"),
            EditError::InUse(what) => write!(f, "still in use: {what}"),
            EditError::Invalid(why) => write!(f, "invalid edit: {why}"),
        }
    }
}

impl std::error::Error for EditError {}

// ---- primitive ops -------------------------------------------------------------

/// Primitive, invertible operations. Applying one returns its inverse.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    InsertTrack { index: usize, track: Track },
    RemoveTrack { track_id: String },
    SetTrackFlags { track_id: String, name: String, muted: bool, hidden: bool, locked: bool },
    InsertSegment { track_id: String, segment: Segment },
    RemoveSegment { track_id: String, segment_id: String },
    /// Replace the segment with the same id (re-sorts the track if its start moved).
    ReplaceSegment { track_id: String, segment: Segment },
    InsertMaterial { index: Option<usize>, material: AnyMaterial },
    RemoveMaterial { id: MaterialId },
    SetSettings { name: String, canvas: Canvas, fps: FrameRate },
}

fn track_index(p: &Project, track_id: &str) -> Result<usize, EditError> {
    p.tracks
        .iter()
        .position(|t| t.id == track_id)
        .ok_or_else(|| EditError::NotFound(format!("track {track_id}")))
}

fn sort_segments(track: &mut Track) {
    track.segments.sort_by_key(|s| s.target.start);
}

/// Apply one op and return its inverse.
pub fn apply_op(p: &mut Project, op: &Op) -> Result<Op, EditError> {
    Ok(match op {
        Op::InsertTrack { index, track } => {
            if p.tracks.iter().any(|t| t.id == track.id) {
                return Err(EditError::Invalid(format!("track id {} already exists", track.id)));
            }
            let i = (*index).min(p.tracks.len());
            p.tracks.insert(i, track.clone());
            Op::RemoveTrack { track_id: track.id.clone() }
        }
        Op::RemoveTrack { track_id } => {
            let i = track_index(p, track_id)?;
            let track = p.tracks.remove(i);
            Op::InsertTrack { index: i, track }
        }
        Op::SetTrackFlags { track_id, name, muted, hidden, locked } => {
            let i = track_index(p, track_id)?;
            let t = &mut p.tracks[i];
            let inverse = Op::SetTrackFlags {
                track_id: track_id.clone(),
                name: t.name.clone(),
                muted: t.muted,
                hidden: t.hidden,
                locked: t.locked,
            };
            t.name = name.clone();
            t.muted = *muted;
            t.hidden = *hidden;
            t.locked = *locked;
            inverse
        }
        Op::InsertSegment { track_id, segment } => {
            if find_segment(p, &segment.id).is_some() {
                return Err(EditError::Invalid(format!("segment id {} already exists", segment.id)));
            }
            let i = track_index(p, track_id)?;
            let track = &mut p.tracks[i];
            let at = track.segments.partition_point(|s| s.target.start <= segment.target.start);
            track.segments.insert(at, segment.clone());
            Op::RemoveSegment { track_id: track_id.clone(), segment_id: segment.id.clone() }
        }
        Op::RemoveSegment { track_id, segment_id } => {
            let i = track_index(p, track_id)?;
            let track = &mut p.tracks[i];
            let j = track
                .segments
                .iter()
                .position(|s| &s.id == segment_id)
                .ok_or_else(|| EditError::NotFound(format!("segment {segment_id}")))?;
            let segment = track.segments.remove(j);
            Op::InsertSegment { track_id: track_id.clone(), segment }
        }
        Op::ReplaceSegment { track_id, segment } => {
            let i = track_index(p, track_id)?;
            let track = &mut p.tracks[i];
            let j = track
                .segments
                .iter()
                .position(|s| s.id == segment.id)
                .ok_or_else(|| EditError::NotFound(format!("segment {}", segment.id)))?;
            let old = std::mem::replace(&mut track.segments[j], segment.clone());
            if old.target.start != segment.target.start {
                sort_segments(track);
            }
            Op::ReplaceSegment { track_id: track_id.clone(), segment: old }
        }
        Op::InsertMaterial { index, material } => {
            if p.materials.contains(material.id()) {
                return Err(EditError::Invalid(format!("material id {} already exists", material.id().0)));
            }
            p.materials.insert_at(material.clone(), *index);
            Op::RemoveMaterial { id: material.id().clone() }
        }
        Op::RemoveMaterial { id } => {
            let (material, index) = p
                .materials
                .remove(id)
                .ok_or_else(|| EditError::NotFound(format!("material {}", id.0)))?;
            Op::InsertMaterial { index: Some(index), material }
        }
        Op::SetSettings { name, canvas, fps } => {
            let inverse = Op::SetSettings { name: p.name.clone(), canvas: p.canvas, fps: p.fps };
            p.name = name.clone();
            p.canvas = *canvas;
            p.fps = *fps;
            inverse
        }
    })
}

/// True if applying `op` would leave the project unchanged.
fn is_noop(p: &Project, op: &Op) -> bool {
    match op {
        Op::ReplaceSegment { segment, .. } => find_segment(p, &segment.id).is_some_and(|(_, cur)| cur == segment),
        Op::SetTrackFlags { track_id, name, muted, hidden, locked } => p.tracks.iter().any(|t| {
            &t.id == track_id && &t.name == name && t.muted == *muted && t.hidden == *hidden && t.locked == *locked
        }),
        Op::SetSettings { name, canvas, fps } => &p.name == name && &p.canvas == canvas && &p.fps == fps,
        _ => false,
    }
}

/// Apply ops atomically. Returns the inverse ops (already in undo order).
pub fn apply_ops(p: &mut Project, ops: &[Op]) -> Result<Vec<Op>, EditError> {
    let mut inverses = Vec::with_capacity(ops.len());
    for op in ops {
        match apply_op(p, op) {
            Ok(inv) => inverses.push(inv),
            Err(e) => {
                for inv in inverses.iter().rev() {
                    apply_op(p, inv).expect("rolling back an applied op must succeed");
                }
                return Err(e);
            }
        }
    }
    inverses.reverse();
    Ok(inverses)
}

// ---- high-level edits ----------------------------------------------------------

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Edge {
    Start,
    End,
}

/// A change to one property of a segment.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "property", content = "value", rename_all = "snake_case")]
pub enum SegmentChange {
    Transform(Transform),
    Opacity(Animated<f32>),
    Volume(Animated<f32>),
    Visible(bool),
    Reverse(bool),
    RenderIndex(i32),
    Attachments(Vec<MaterialId>),
}

/// A user-level edit. Serializable so the UI can send edits to the engine as JSON.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "edit", rename_all = "snake_case")]
pub enum Edit {
    AddTrack { kind: TrackKind, index: Option<usize>, id: Option<String> },
    RemoveTrack { track_id: String },
    SetTrackFlags {
        track_id: String,
        name: Option<String>,
        muted: Option<bool>,
        hidden: Option<bool>,
        locked: Option<bool>,
    },
    AddSegment { track_id: String, segment: Segment },
    /// Remove segments; with `ripple`, later segments on the same track close the gap.
    RemoveSegments { segment_ids: Vec<String>, ripple: bool },
    /// Move a segment to `start` on `track_id` (or its current track).
    MoveSegment { segment_id: String, track_id: Option<String>, start: Micros },
    /// Move one edge of a segment to timeline time `to`, adjusting the source range.
    /// The result is clamped to the media's length and to neighbouring segments.
    TrimSegment { segment_id: String, edge: Edge, to: Micros },
    /// Split a segment at timeline time `at`; the right half gets `new_id`.
    SplitSegment { segment_id: String, at: Micros, new_id: Option<String> },
    /// Change constant speed, retiming the segment from its start.
    SetSpeed { segment_id: String, speed: f64 },
    SetSegment { segment_id: String, change: SegmentChange },
    AddMaterial { material: AnyMaterial },
    RemoveMaterial { id: MaterialId },
    SetSettings { name: Option<String>, canvas: Option<Canvas>, fps: Option<FrameRate> },
}

impl Edit {
    pub fn label(&self) -> &'static str {
        match self {
            Edit::AddTrack { .. } => "Add track",
            Edit::RemoveTrack { .. } => "Remove track",
            Edit::SetTrackFlags { .. } => "Change track",
            Edit::AddSegment { .. } => "Add clip",
            Edit::RemoveSegments { ripple: true, .. } => "Ripple delete",
            Edit::RemoveSegments { .. } => "Delete",
            Edit::MoveSegment { .. } => "Move clip",
            Edit::TrimSegment { .. } => "Trim clip",
            Edit::SplitSegment { .. } => "Split clip",
            Edit::SetSpeed { .. } => "Change speed",
            Edit::SetSegment { .. } => "Change clip",
            Edit::AddMaterial { .. } => "Add material",
            Edit::RemoveMaterial { .. } => "Remove material",
            Edit::SetSettings { .. } => "Project settings",
        }
    }

    /// Plan this edit against the current project into primitive ops.
    pub fn plan(&self, p: &Project) -> Result<Vec<Op>, EditError> {
        match self {
            Edit::AddTrack { kind, index, id } => {
                let track = Track {
                    id: id.clone().unwrap_or_else(new_id),
                    kind: *kind,
                    name: String::new(),
                    segments: Vec::new(),
                    muted: false,
                    hidden: false,
                    locked: false,
                };
                Ok(vec![Op::InsertTrack { index: index.unwrap_or(p.tracks.len()), track }])
            }
            Edit::RemoveTrack { track_id } => {
                let i = track_index(p, track_id)?;
                if p.tracks[i].locked {
                    return Err(EditError::Locked(track_id.clone()));
                }
                Ok(vec![Op::RemoveTrack { track_id: track_id.clone() }])
            }
            Edit::SetTrackFlags { track_id, name, muted, hidden, locked } => {
                let t = &p.tracks[track_index(p, track_id)?];
                Ok(vec![Op::SetTrackFlags {
                    track_id: track_id.clone(),
                    name: name.clone().unwrap_or_else(|| t.name.clone()),
                    muted: muted.unwrap_or(t.muted),
                    hidden: hidden.unwrap_or(t.hidden),
                    locked: locked.unwrap_or(t.locked),
                }])
            }
            Edit::AddSegment { track_id, segment } => {
                let t = editable_track(p, track_id)?;
                check_segment_shape(p, segment)?;
                check_free(t, &segment.target, &[])?;
                Ok(vec![Op::InsertSegment { track_id: track_id.clone(), segment: segment.clone() }])
            }
            Edit::RemoveSegments { segment_ids, ripple } => plan_remove(p, segment_ids, *ripple),
            Edit::MoveSegment { segment_id, track_id, start } => {
                let (ti, si) = locate(p, segment_id)?;
                let from = &p.tracks[ti];
                ensure_unlocked(from)?;
                let to_id = track_id.clone().unwrap_or_else(|| from.id.clone());
                let to = editable_track(p, &to_id)?;
                if to.kind != from.kind {
                    return Err(EditError::Invalid(format!("can't move a {:?} clip to a {:?} track", from.kind, to.kind)));
                }
                if start.0 < 0 {
                    return Err(EditError::Invalid("start must not be negative".into()));
                }
                let mut seg = from.segments[si].clone();
                seg.target.start = *start;
                check_free(to, &seg.target, &[segment_id])?;
                if to.id == from.id {
                    Ok(vec![Op::ReplaceSegment { track_id: to_id, segment: seg }])
                } else {
                    Ok(vec![
                        Op::RemoveSegment { track_id: from.id.clone(), segment_id: segment_id.clone() },
                        Op::InsertSegment { track_id: to_id, segment: seg },
                    ])
                }
            }
            Edit::TrimSegment { segment_id, edge, to } => plan_trim(p, segment_id, *edge, *to),
            Edit::SplitSegment { segment_id, at, new_id } => plan_split(p, segment_id, *at, new_id.clone()),
            Edit::SetSpeed { segment_id, speed } => plan_speed(p, segment_id, *speed),
            Edit::SetSegment { segment_id, change } => {
                let (ti, si) = locate(p, segment_id)?;
                ensure_unlocked(&p.tracks[ti])?;
                let mut seg = p.tracks[ti].segments[si].clone();
                match change {
                    SegmentChange::Transform(v) => seg.transform = v.clone(),
                    SegmentChange::Opacity(v) => seg.opacity = v.clone(),
                    SegmentChange::Volume(v) => seg.volume = v.clone(),
                    SegmentChange::Visible(v) => seg.visible = *v,
                    SegmentChange::Reverse(v) => seg.reverse = *v,
                    SegmentChange::RenderIndex(v) => seg.render_index = *v,
                    SegmentChange::Attachments(v) => {
                        for id in v {
                            if !p.materials.contains(id) {
                                return Err(EditError::NotFound(format!("material {}", id.0)));
                            }
                        }
                        seg.attachments = v.clone();
                    }
                }
                Ok(vec![Op::ReplaceSegment { track_id: p.tracks[ti].id.clone(), segment: seg }])
            }
            Edit::AddMaterial { material } => Ok(vec![Op::InsertMaterial { index: None, material: material.clone() }]),
            Edit::RemoveMaterial { id } => {
                let used = p.tracks.iter().flat_map(|t| &t.segments).any(|s| &s.material == id || s.attachments.contains(id));
                if used {
                    return Err(EditError::InUse(format!("material {}", id.0)));
                }
                Ok(vec![Op::RemoveMaterial { id: id.clone() }])
            }
            Edit::SetSettings { name, canvas, fps } => Ok(vec![Op::SetSettings {
                name: name.clone().unwrap_or_else(|| p.name.clone()),
                canvas: canvas.unwrap_or(p.canvas),
                fps: fps.unwrap_or(p.fps),
            }]),
        }
    }
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string().to_uppercase()
}

pub fn find_segment<'a>(p: &'a Project, segment_id: &str) -> Option<(&'a Track, &'a Segment)> {
    p.tracks.iter().find_map(|t| t.segments.iter().find(|s| s.id == segment_id).map(|s| (t, s)))
}

fn locate(p: &Project, segment_id: &str) -> Result<(usize, usize), EditError> {
    for (ti, t) in p.tracks.iter().enumerate() {
        if let Some(si) = t.segments.iter().position(|s| s.id == segment_id) {
            return Ok((ti, si));
        }
    }
    Err(EditError::NotFound(format!("segment {segment_id}")))
}

fn ensure_unlocked(t: &Track) -> Result<(), EditError> {
    if t.locked {
        Err(EditError::Locked(t.id.clone()))
    } else {
        Ok(())
    }
}

fn editable_track<'a>(p: &'a Project, track_id: &str) -> Result<&'a Track, EditError> {
    let t = &p.tracks[track_index(p, track_id)?];
    ensure_unlocked(t)?;
    Ok(t)
}

fn check_segment_shape(p: &Project, seg: &Segment) -> Result<(), EditError> {
    if seg.target.duration.0 <= 0 || seg.target.start.0 < 0 {
        return Err(EditError::Invalid("segment needs a non-negative start and a positive duration".into()));
    }
    if !(seg.speed > 0.0 && seg.speed.is_finite()) {
        return Err(EditError::Invalid("speed must be positive".into()));
    }
    if !p.materials.contains(&seg.material) {
        return Err(EditError::NotFound(format!("material {}", seg.material.0)));
    }
    Ok(())
}

fn check_free(track: &Track, range: &TimeRange, ignore: &[&String]) -> Result<(), EditError> {
    match track.segments.iter().find(|s| !ignore.contains(&&s.id) && s.target.overlaps(range)) {
        Some(s) => Err(EditError::Overlap { track_id: track.id.clone(), at: s.target.start }),
        None => Ok(()),
    }
}

fn plan_remove(p: &Project, ids: &[String], ripple: bool) -> Result<Vec<Op>, EditError> {
    let mut ops = Vec::new();
    for t in &p.tracks {
        let removed: Vec<&Segment> = t.segments.iter().filter(|s| ids.contains(&s.id)).collect();
        if removed.is_empty() {
            continue;
        }
        ensure_unlocked(t)?;
        for s in &removed {
            ops.push(Op::RemoveSegment { track_id: t.id.clone(), segment_id: s.id.clone() });
        }
        if ripple {
            // Each remaining segment moves left by the total duration removed before it.
            for s in t.segments.iter().filter(|s| !ids.contains(&s.id)) {
                let shift: i64 = removed.iter().filter(|r| r.target.start < s.target.start).map(|r| r.target.duration.0).sum();
                if shift > 0 {
                    let mut moved = s.clone();
                    moved.target.start = Micros(s.target.start.0 - shift);
                    ops.push(Op::ReplaceSegment { track_id: t.id.clone(), segment: moved });
                }
            }
        }
    }
    let found: usize = ops.iter().filter(|o| matches!(o, Op::RemoveSegment { .. })).count();
    if found != ids.len() {
        return Err(EditError::NotFound("one or more segments".into()));
    }
    Ok(ops)
}

/// Longest the segment's source may play from `source_start`, if the material has a length.
fn source_limit(p: &Project, seg: &Segment) -> Option<Micros> {
    match p.materials.get(&seg.material) {
        Some(crate::material::MaterialRef::Media(m))
            if m.kind != crate::material::MediaKind::Photo && m.duration.0 > 0 =>
        {
            Some(m.duration)
        }
        _ => None,
    }
}

fn scale(d: Micros, factor: f64) -> Micros {
    Micros((d.0 as f64 * factor).round() as i64)
}

fn plan_trim(p: &Project, segment_id: &str, edge: Edge, to: Micros) -> Result<Vec<Op>, EditError> {
    let (ti, si) = locate(p, segment_id)?;
    let track = &p.tracks[ti];
    ensure_unlocked(track)?;
    let seg = &track.segments[si];
    let min_len = p.fps.frame_duration();
    let speed = seg.speed;
    let mut out = seg.clone();
    match edge {
        Edge::End => {
            let mut end = to.max(seg.target.start + min_len);
            if let Some(next) = track.segments.get(si + 1) {
                end = end.min(next.target.start);
            }
            if let (Some(src), Some(limit)) = (seg.source, source_limit(p, seg)) {
                // Can't play past the end of the media.
                let max_target = scale(limit - src.start, 1.0 / speed);
                end = end.min(seg.target.start + max_target);
            }
            out.target.duration = end - seg.target.start;
            if let Some(src) = seg.source.as_ref() {
                out.source = Some(TimeRange::new(src.start, scale(out.target.duration, speed)));
            }
        }
        Edge::Start => {
            let mut start = to.min(seg.target.end() - min_len).max(Micros::ZERO);
            if si > 0 {
                start = start.max(track.segments[si - 1].target.end());
            }
            if let Some(src) = seg.source.as_ref() {
                // Can't start before the beginning of the media.
                let earliest = seg.target.start - scale(src.start, 1.0 / speed);
                start = start.max(earliest);
            }
            let delta = start - seg.target.start;
            out.target = TimeRange::new(start, seg.target.duration - delta);
            if let Some(src) = seg.source.as_ref() {
                let new_src_start = Micros((src.start.0 + scale(delta, speed).0).max(0));
                out.source = Some(TimeRange::new(new_src_start, scale(out.target.duration, speed)));
            }
            shift_keys(&mut out, Micros(-delta.0));
        }
    }
    if out == *seg {
        return Ok(Vec::new());
    }
    Ok(vec![Op::ReplaceSegment { track_id: track.id.clone(), segment: out }])
}

/// Shift every keyframe of a segment by `by` (segment-local time).
fn shift_keys(seg: &mut Segment, by: Micros) {
    fn shift<T>(keys: &mut [crate::Keyframe<T>], by: Micros) {
        for k in keys {
            k.at = k.at + by;
        }
    }
    shift(&mut seg.transform.position.keys, by);
    shift(&mut seg.transform.scale.keys, by);
    shift(&mut seg.transform.rotation.keys, by);
    shift(&mut seg.opacity.keys, by);
    shift(&mut seg.volume.keys, by);
    for p in &mut seg.keyframes {
        shift(&mut p.keys, by);
    }
}

/// Scale every keyframe's time (and its curve handles') by `factor`, for a speed change:
/// the keys stay on the same media.
fn scale_keys(seg: &mut Segment, factor: f64) {
    fn sc<T>(keys: &mut [crate::Keyframe<T>], factor: f64) {
        for k in keys {
            k.at = scale(k.at, factor);
            if let crate::Easing::Curve { out, into, .. } = &mut k.ease {
                out.t.iter_mut().chain(into.t.iter_mut()).for_each(|t| *t *= factor);
            }
        }
    }
    sc(&mut seg.transform.position.keys, factor);
    sc(&mut seg.transform.scale.keys, factor);
    sc(&mut seg.transform.rotation.keys, factor);
    sc(&mut seg.opacity.keys, factor);
    sc(&mut seg.volume.keys, factor);
    for p in &mut seg.keyframes {
        sc(&mut p.keys, factor);
    }
}

/// A key at local time `t` in every keyframed property that hasn't one, keeping the motion
/// (CapCut adds them where it splits a clip, so each half starts and ends where it was).
fn split_keys_at(seg: &mut Segment, t: Micros) {
    fn at<T: crate::Lerp>(keys: &mut Vec<crate::Keyframe<T>>, t: Micros) {
        if !keys.is_empty() {
            crate::split_keys(keys, t);
        }
    }
    at(&mut seg.transform.position.keys, t);
    at(&mut seg.transform.scale.keys, t);
    at(&mut seg.transform.rotation.keys, t);
    at(&mut seg.opacity.keys, t);
    at(&mut seg.volume.keys, t);
    for p in &mut seg.keyframes {
        at(&mut p.keys, t);
    }
}

fn plan_split(p: &Project, segment_id: &str, at: Micros, new_id: Option<String>) -> Result<Vec<Op>, EditError> {
    let (ti, si) = locate(p, segment_id)?;
    let track = &p.tracks[ti];
    ensure_unlocked(track)?;
    let seg = &track.segments[si];
    let min_len = p.fps.frame_duration();
    if at < seg.target.start + min_len || at > seg.target.end() - min_len {
        return Err(EditError::Invalid("split point must be at least one frame inside the clip".into()));
    }
    let left_len = at - seg.target.start;
    let mut seg = seg.clone();
    split_keys_at(&mut seg, left_len);
    let mut left = seg.clone();
    let mut right = seg.clone();
    left.target.duration = left_len;
    right.id = new_id.unwrap_or_else(new_id_fn);
    right.target = TimeRange::new(at, seg.target.end() - at);
    if let Some(src) = seg.source {
        let left_src = scale(left_len, seg.speed);
        left.source = Some(TimeRange::new(src.start, left_src));
        right.source = Some(TimeRange::new(src.start + left_src, Micros((src.duration.0 - left_src.0).max(0))));
    }
    shift_keys(&mut right, Micros(-left_len.0));
    // TODO: duplicate per-segment attachment materials (fades, speed curves) so the halves
    // can be edited independently, as CapCut does.
    Ok(vec![
        Op::ReplaceSegment { track_id: track.id.clone(), segment: left },
        Op::InsertSegment { track_id: track.id.clone(), segment: right },
    ])
}

fn new_id_fn() -> String {
    new_id()
}

fn plan_speed(p: &Project, segment_id: &str, speed: f64) -> Result<Vec<Op>, EditError> {
    if !(0.1..=100.0).contains(&speed) {
        return Err(EditError::Invalid("speed must be between 0.1× and 100×".into()));
    }
    let (ti, si) = locate(p, segment_id)?;
    let track = &p.tracks[ti];
    ensure_unlocked(track)?;
    let seg = &track.segments[si];
    let Some(src) = seg.source else {
        return Err(EditError::Invalid("speed only applies to media clips".into()));
    };
    let mut out = seg.clone();
    out.speed = speed;
    // A constant speed replaces a curve (CapCut's Normal tab).
    out.attachments.retain(|id| !p.materials.speeds.iter().any(|s| &s.id == id && s.curve.len() >= 2));
    out.target.duration = scale(src.duration, 1.0 / speed).max(p.fps.frame_duration());
    scale_keys(&mut out, seg.speed / speed);
    check_free(track, &out.target, &[&seg.id])?;
    Ok(vec![Op::ReplaceSegment { track_id: track.id.clone(), segment: out }])
}

// ---- document + history --------------------------------------------------------

/// What an applied edit (or undo/redo) touched, so the engine can invalidate caches.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ChangeSet {
    pub revision: u64,
    pub tracks: Vec<String>,
    pub segments: Vec<String>,
    pub materials: Vec<MaterialId>,
    pub settings: bool,
}

impl ChangeSet {
    fn from_ops(revision: u64, ops: &[Op]) -> Self {
        let mut c = ChangeSet { revision, ..Default::default() };
        let add = |v: &mut Vec<String>, s: &String| {
            if !v.contains(s) {
                v.push(s.clone());
            }
        };
        for op in ops {
            match op {
                Op::InsertTrack { track, .. } => add(&mut c.tracks, &track.id),
                Op::RemoveTrack { track_id } | Op::SetTrackFlags { track_id, .. } => add(&mut c.tracks, track_id),
                Op::InsertSegment { track_id, segment } | Op::ReplaceSegment { track_id, segment } => {
                    add(&mut c.tracks, track_id);
                    add(&mut c.segments, &segment.id);
                }
                Op::RemoveSegment { track_id, segment_id } => {
                    add(&mut c.tracks, track_id);
                    add(&mut c.segments, segment_id);
                }
                Op::InsertMaterial { material, .. } => {
                    if !c.materials.contains(material.id()) {
                        c.materials.push(material.id().clone());
                    }
                }
                Op::RemoveMaterial { id } => {
                    if !c.materials.contains(id) {
                        c.materials.push(id.clone());
                    }
                }
                Op::SetSettings { .. } => c.settings = true,
            }
        }
        c
    }
}

#[derive(Clone, Debug)]
struct HistoryEntry {
    label: String,
    /// Edits sharing a group key (e.g. one slider drag) merge into one undo step.
    group: Option<String>,
    forward: Vec<Op>,
    inverse: Vec<Op>,
}

/// A project plus its undo/redo history.
pub struct Document {
    project: Project,
    undo: Vec<HistoryEntry>,
    redo: Vec<HistoryEntry>,
    revision: u64,
    max_history: usize,
}

impl Document {
    pub fn new(project: Project) -> Self {
        Document { project, undo: Vec::new(), redo: Vec::new(), revision: 0, max_history: 1000 }
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn into_project(self) -> Project {
        self.project
    }

    /// Increments on every change; cheap to compare for "did anything change".
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn undo_label(&self) -> Option<&str> {
        self.undo.last().map(|e| e.label.as_str())
    }

    pub fn redo_label(&self) -> Option<&str> {
        self.redo.last().map(|e| e.label.as_str())
    }

    /// Apply an edit as a new undo step.
    pub fn apply(&mut self, edit: &Edit) -> Result<ChangeSet, EditError> {
        self.apply_in_group(edit, None)
    }

    /// Apply an edit, merging it into the previous undo step if that step has the same
    /// `group` key. Use one key per gesture (e.g. "drag:<segment>:<pointer-down time>").
    pub fn apply_grouped(&mut self, edit: &Edit, group: &str) -> Result<ChangeSet, EditError> {
        self.apply_in_group(edit, Some(group))
    }

    fn apply_in_group(&mut self, edit: &Edit, group: Option<&str>) -> Result<ChangeSet, EditError> {
        let mut forward = edit.plan(&self.project)?;
        // Edits that change nothing (same speed, same position, …) must not create undo steps.
        forward.retain(|op| !is_noop(&self.project, op));
        if forward.is_empty() {
            return Ok(ChangeSet { revision: self.revision, ..Default::default() });
        }
        let inverse = apply_ops(&mut self.project, &forward)?;
        self.revision += 1;
        let change = ChangeSet::from_ops(self.revision, &forward);
        self.redo.clear();
        match (group, self.undo.last_mut()) {
            (Some(g), Some(last)) if last.group.as_deref() == Some(g) => {
                last.forward.extend(forward);
                let mut merged = inverse;
                merged.append(&mut last.inverse);
                last.inverse = merged;
            }
            _ => {
                self.undo.push(HistoryEntry {
                    label: edit.label().to_string(),
                    group: group.map(str::to_string),
                    forward,
                    inverse,
                });
                if self.undo.len() > self.max_history {
                    self.undo.remove(0);
                }
            }
        }
        Ok(change)
    }

    pub fn undo(&mut self) -> Option<ChangeSet> {
        let mut entry = self.undo.pop()?;
        apply_ops(&mut self.project, &entry.inverse).expect("undo must apply cleanly");
        self.revision += 1;
        let change = ChangeSet::from_ops(self.revision, &entry.inverse);
        entry.group = None; // never merge into a redone step
        self.redo.push(entry);
        Some(change)
    }

    pub fn redo(&mut self) -> Option<ChangeSet> {
        let entry = self.redo.pop()?;
        apply_ops(&mut self.project, &entry.forward).expect("redo must apply cleanly");
        self.revision += 1;
        let change = ChangeSet::from_ops(self.revision, &entry.forward);
        self.undo.push(entry);
        Some(change)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::material::{Media, MediaKind};

    const SEC: i64 = 1_000_000;

    fn media(id: &str, secs: i64) -> AnyMaterial {
        AnyMaterial::Media(Media {
            id: MaterialId::from(id),
            kind: MediaKind::Video,
            path: format!("/media/{id}.mp4"),
            width: 1920,
            height: 1080,
            duration: Micros(secs * SEC),
            has_audio: true,
            matte: None,
            reverse_path: None,
            freeze: None,
            complement_frame: None,
            smart_complement_frame: None,
        })
    }

    fn clip(id: &str, material: &str, start: i64, len: i64, src_start: i64) -> Segment {
        Segment {
            id: id.into(),
            material: MaterialId::from(material),
            source: Some(TimeRange::new(Micros(src_start), Micros(len))),
            target: TimeRange::new(Micros(start), Micros(len)),
            speed: 1.0,
            reverse: false,
        change_pitch: false,
            visible: true,
            render_index: 0,
            transform: Transform::default(),
            crop: None,
            opacity: Animated::constant(1.0),
            volume: Animated::constant(1.0),
            attachments: Vec::new(),
            keyframes: Vec::new(),
        }
    }

    /// Two video tracks: A = [a1 0-2s][gap][a2 3-5s], B = [b1 1-4s]. Media is 10 s long.
    fn project() -> Project {
        let mut p = Project::new("P", "Test", Canvas { width: 1920, height: 1080 }, FrameRate::new(30, 1));
        p.materials.insert_at(media("M1", 10), None);
        p.materials.insert_at(media("M2", 10), None);
        p.tracks.push(Track {
            id: "A".into(),
            kind: TrackKind::Video,
            name: String::new(),
            segments: vec![clip("a1", "M1", 0, 2 * SEC, 0), clip("a2", "M1", 3 * SEC, 2 * SEC, 4 * SEC)],
            muted: false,
            hidden: false,
            locked: false,
        });
        p.tracks.push(Track {
            id: "B".into(),
            kind: TrackKind::Video,
            name: String::new(),
            segments: vec![clip("b1", "M2", SEC, 3 * SEC, 0)],
            muted: false,
            hidden: false,
            locked: false,
        });
        assert!(p.validate().is_empty());
        p
    }

    fn seg<'a>(p: &'a Project, id: &str) -> &'a Segment {
        find_segment(p, id).unwrap().1
    }

    #[test]
    fn split_then_undo_redo_round_trips() {
        let original = project();
        let mut doc = Document::new(original.clone());
        doc.apply(&Edit::SplitSegment { segment_id: "a1".into(), at: Micros(SEC / 2), new_id: Some("a1b".into()) }).unwrap();
        let after = doc.project().clone();
        assert_eq!(seg(&after, "a1").target, TimeRange::new(Micros(0), Micros(SEC / 2)));
        assert_eq!(seg(&after, "a1b").target, TimeRange::new(Micros(SEC / 2), Micros(3 * SEC / 2)));
        assert_eq!(seg(&after, "a1b").source.unwrap().start, Micros(SEC / 2));
        assert!(after.validate().is_empty());

        doc.undo().unwrap();
        assert_eq!(doc.project(), &original);
        doc.redo().unwrap();
        assert_eq!(doc.project(), &after);
        assert_eq!(doc.undo_label(), Some("Split clip"));
    }

    #[test]
    fn trim_respects_media_length_neighbours_and_speed() {
        let mut doc = Document::new(project());
        // a2 reads source 4-6 s of a 10 s file; extending its end far is clamped by the media length…
        doc.apply(&Edit::TrimSegment { segment_id: "a2".into(), edge: Edge::End, to: Micros(100 * SEC) }).unwrap();
        assert_eq!(seg(doc.project(), "a2").target.end(), Micros(9 * SEC));
        assert_eq!(seg(doc.project(), "a2").source.unwrap(), TimeRange::new(Micros(4 * SEC), Micros(6 * SEC)));
        // …and extending a2's start left is clamped by a1's end (2 s).
        doc.apply(&Edit::TrimSegment { segment_id: "a2".into(), edge: Edge::Start, to: Micros(0) }).unwrap();
        let a2 = seg(doc.project(), "a2");
        assert_eq!(a2.target.start, Micros(2 * SEC));
        assert_eq!(a2.source.unwrap().start, Micros(3 * SEC));

        // At 2× speed, trimming 1 s off the start skips 2 s of source.
        doc.apply(&Edit::SetSpeed { segment_id: "b1".into(), speed: 2.0 }).unwrap();
        assert_eq!(seg(doc.project(), "b1").target.duration, Micros(3 * SEC / 2));
        doc.apply(&Edit::TrimSegment { segment_id: "b1".into(), edge: Edge::Start, to: Micros(SEC + SEC / 2) }).unwrap();
        let b1 = seg(doc.project(), "b1");
        assert_eq!(b1.source.unwrap().start, Micros(SEC));
        assert_eq!(b1.target, TimeRange::new(Micros(SEC + SEC / 2), Micros(SEC)));
        assert!(doc.project().validate().is_empty());

        while doc.undo().is_some() {}
        assert_eq!(doc.project(), &project());
    }

    #[test]
    fn failed_edits_change_nothing() {
        let mut doc = Document::new(project());
        let before = doc.project().clone();
        // b1 can't move onto track A at 1 s: it would overlap a1.
        let err = doc.apply(&Edit::MoveSegment { segment_id: "b1".into(), track_id: Some("A".into()), start: Micros(SEC) });
        assert!(matches!(err, Err(EditError::Overlap { .. })));
        assert_eq!(doc.project(), &before);
        assert!(!doc.can_undo());
        // Removing a material that clips use is refused.
        assert!(matches!(doc.apply(&Edit::RemoveMaterial { id: "M1".into() }), Err(EditError::InUse(_))));
    }

    #[test]
    fn moves_between_tracks_and_ripple_deletes() {
        let mut doc = Document::new(project());
        doc.apply(&Edit::MoveSegment { segment_id: "b1".into(), track_id: Some("A".into()), start: Micros(5 * SEC) }).unwrap();
        assert_eq!(doc.project().tracks[0].segments.len(), 3);
        assert!(doc.project().tracks[1].segments.is_empty());
        doc.apply(&Edit::RemoveSegments { segment_ids: vec!["a1".into()], ripple: true }).unwrap();
        let a = &doc.project().tracks[0];
        assert_eq!(a.segments.iter().map(|s| s.target.start.0).collect::<Vec<_>>(), vec![SEC, 3 * SEC]);
        while doc.undo().is_some() {}
        assert_eq!(doc.project(), &project());
    }

    #[test]
    fn grouped_edits_are_one_undo_step() {
        let mut doc = Document::new(project());
        for x in 1..=10 {
            let mut t = Transform::default();
            t.position.value.x = x as f64 / 10.0;
            doc.apply_grouped(&Edit::SetSegment { segment_id: "a1".into(), change: SegmentChange::Transform(t) }, "drag-1")
                .unwrap();
        }
        assert_eq!(seg(doc.project(), "a1").transform.position.value.x, 1.0);
        doc.undo().unwrap();
        assert_eq!(doc.project(), &project());
        assert!(!doc.can_undo());
        doc.redo().unwrap();
        assert_eq!(seg(doc.project(), "a1").transform.position.value.x, 1.0);
    }

    #[test]
    fn no_op_edits_create_no_undo_step() {
        let mut doc = Document::new(project());
        doc.apply(&Edit::SetSpeed { segment_id: "a1".into(), speed: 1.0 }).unwrap();
        doc.apply(&Edit::MoveSegment { segment_id: "a2".into(), track_id: None, start: Micros(3 * SEC) }).unwrap();
        assert!(!doc.can_undo());
        assert_eq!(doc.revision(), 0);
    }

    #[test]
    fn locked_tracks_reject_edits() {
        let mut doc = Document::new(project());
        doc.apply(&Edit::SetTrackFlags { track_id: "A".into(), name: None, muted: None, hidden: None, locked: Some(true) }).unwrap();
        let err = doc.apply(&Edit::SplitSegment { segment_id: "a1".into(), at: Micros(SEC), new_id: None });
        assert!(matches!(err, Err(EditError::Locked(_))));
    }

    #[test]
    fn edits_round_trip_as_json() {
        let e = Edit::TrimSegment { segment_id: "a1".into(), edge: Edge::End, to: Micros(SEC) };
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(json, r#"{"edit":"trim_segment","segment_id":"a1","edge":"end","to":1000000}"#);
        assert_eq!(serde_json::from_str::<Edit>(&json).unwrap(), e);
    }

    /// Small deterministic RNG so the randomized test is reproducible.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n.max(1)
        }
    }

    #[test]
    fn random_edit_sequences_undo_to_the_original() {
        // OPENRIP_FUZZ_SEEDS=2000 cargo test … for a longer run.
        let seeds: u64 = std::env::var("OPENRIP_FUZZ_SEEDS").ok().and_then(|v| v.parse().ok()).unwrap_or(20);
        let (mut applied, mut rejected) = (0usize, 0usize);
        for seed in 1..=seeds {
            let original = project();
            let mut doc = Document::new(original.clone());
            let mut rng = Rng(0x9E37_79B9_7F4A_7C15 ^ seed);
            let mut snapshots = vec![original.clone()];
            for step in 0..150 {
                let segs: Vec<String> =
                    doc.project().tracks.iter().flat_map(|t| t.segments.iter().map(|s| s.id.clone())).collect();
                if segs.is_empty() {
                    break;
                }
                let id = segs[rng.below(segs.len() as u64) as usize].clone();
                let t = Micros(rng.below(12 * SEC as u64) as i64);
                let track = if rng.below(2) == 0 { "A" } else { "B" };
                let edit = match rng.below(16) {
                    0..=2 => Edit::SplitSegment { segment_id: id, at: t, new_id: Some(format!("s{seed}-{step}")) },
                    3..=4 => Edit::TrimSegment { segment_id: id, edge: Edge::Start, to: t },
                    5..=6 => Edit::TrimSegment { segment_id: id, edge: Edge::End, to: t },
                    7..=9 => Edit::MoveSegment { segment_id: id, track_id: Some(track.into()), start: t },
                    10..=11 => Edit::SetSpeed { segment_id: id, speed: [0.5, 1.0, 2.0, 3.0][rng.below(4) as usize] },
                    12 if segs.len() > 3 => Edit::RemoveSegments { segment_ids: vec![id], ripple: rng.below(2) == 0 },
                    13..=14 => {
                        let len = (rng.below(3 * SEC as u64) as i64).max(SEC / 10);
                        let src = rng.below(5 * SEC as u64) as i64;
                        Edit::AddSegment {
                            track_id: track.into(),
                            segment: clip(&format!("n{seed}-{step}"), if rng.below(2) == 0 { "M1" } else { "M2" }, t.0, len, src),
                        }
                    }
                    _ => Edit::SetSegment {
                        segment_id: id,
                        change: SegmentChange::Opacity(Animated::constant(rng.below(100) as f32 / 100.0)),
                    },
                };
                let before = doc.project().clone();
                match doc.apply(&edit) {
                    Ok(_) => {
                        if doc.project() != &before {
                            applied += 1;
                            snapshots.push(doc.project().clone());
                        }
                    }
                    Err(_) => {
                        rejected += 1;
                        assert_eq!(doc.project(), &before, "failed edit must not change the project");
                    }
                }
                let problems = doc.project().validate();
                assert!(problems.is_empty(), "seed {seed} step {step} {edit:?}: {problems:?}");
            }
            // Undo walks back through every snapshot in reverse…
            for expected in snapshots.iter().rev().skip(1) {
                doc.undo().unwrap();
                assert_eq!(doc.project(), expected, "seed {seed}");
            }
            assert!(!doc.can_undo());
            assert_eq!(doc.project(), &original);
            // …and redo walks forward again.
            for expected in snapshots.iter().skip(1) {
                doc.redo().unwrap();
                assert_eq!(doc.project(), expected, "seed {seed}");
            }
        }
        eprintln!("randomized edits: {applied} applied, {rejected} rejected over {seeds} seeds");
        assert!(applied >= seeds as usize * 60, "too few edits exercised: {applied}");
    }
}
