//! Project → tracks → segments, mirroring CapCut's draft structure so CapCut
//! projects translate one-to-one.

use serde::{Deserialize, Serialize};

use crate::animated::{Animated, Vec2};
use crate::material::{MaterialId, Materials};
use crate::time::{FrameRate, Micros, TimeRange};

/// Version of OpenRip's native project format (v1 was the TypeScript app's JSON).
pub const FORMAT_VERSION: u32 = 2;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub format: u32,
    pub id: String,
    pub name: String,
    pub canvas: Canvas,
    pub fps: FrameRate,
    pub tracks: Vec<Track>,
    pub materials: Materials,
    /// Where the project came from, if it was imported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_from: Option<ImportSource>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImportSource {
    /// e.g. "capcut"
    pub app: String,
    /// The source app's own schema version string, e.g. CapCut's `new_version`.
    pub version: String,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Video,
    Audio,
    Text,
    Sticker,
    Effect,
    Filter,
    Adjustment,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub kind: TrackKind,
    #[serde(default)]
    pub name: String,
    pub segments: Vec<Segment>,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub locked: bool,
}

/// One clip on a track: a material placed at `target`, reading `source` from it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    pub id: String,
    pub material: MaterialId,
    /// Range read from the material (media in-point and length). `None` for
    /// generated content such as text.
    pub source: Option<TimeRange>,
    /// Where the segment sits on the timeline.
    pub target: TimeRange,
    /// Constant playback speed (1.0 = normal). Speed curves are an attachment.
    pub speed: f64,
    #[serde(default)]
    pub reverse: bool,
    pub visible: bool,
    /// Explicit stacking order; higher draws on top.
    pub render_index: i32,
    pub transform: Transform,
    pub opacity: Animated<f32>,
    /// Linear gain; 1.0 = unity.
    pub volume: Animated<f32>,
    /// Materials applied to this segment: canvas fill, audio fades, speed curve,
    /// animations, effects, filters, masks, transitions, …
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<MaterialId>,
}

impl Segment {
    /// Segment-local time for a timeline time (keyframes are stored in local time).
    pub fn local_time(&self, timeline: Micros) -> Micros {
        timeline - self.target.start
    }
}

/// 2D placement on the canvas, in CapCut's convention: `position` is the clip
/// centre in half-canvas units with (0, 0) at the canvas centre; `scale` 1.0 is
/// the clip's fitted size; `rotation` is in degrees.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub position: Animated<Vec2>,
    pub scale: Animated<Vec2>,
    pub rotation: Animated<f64>,
    #[serde(default)]
    pub flip_h: bool,
    #[serde(default)]
    pub flip_v: bool,
}

impl Default for Transform {
    fn default() -> Self {
        Transform {
            position: Animated::constant(Vec2::new(0.0, 0.0)),
            scale: Animated::constant(Vec2::new(1.0, 1.0)),
            rotation: Animated::constant(0.0),
            flip_h: false,
            flip_v: false,
        }
    }
}

impl Project {
    pub fn new(id: impl Into<String>, name: impl Into<String>, canvas: Canvas, fps: FrameRate) -> Self {
        Project {
            format: FORMAT_VERSION,
            id: id.into(),
            name: name.into(),
            canvas,
            fps,
            tracks: Vec::new(),
            materials: Materials::default(),
            imported_from: None,
        }
    }

    /// End of the last segment on any track.
    pub fn duration(&self) -> Micros {
        self.tracks
            .iter()
            .flat_map(|t| t.segments.iter())
            .map(|s| s.target.end())
            .max()
            .unwrap_or(Micros::ZERO)
    }

    pub fn segment_count(&self) -> usize {
        self.tracks.iter().map(|t| t.segments.len()).sum()
    }

    /// Structural problems that would make the project unsafe to render.
    pub fn validate(&self) -> Vec<String> {
        let mut problems = Vec::new();
        for track in &self.tracks {
            let mut ranges: Vec<&TimeRange> = Vec::new();
            for seg in &track.segments {
                if seg.target.duration.0 <= 0 {
                    problems.push(format!("segment {} has non-positive duration", seg.id));
                }
                if !self.materials.contains(&seg.material) {
                    problems.push(format!("segment {} references missing material {}", seg.id, seg.material.0));
                }
                for att in &seg.attachments {
                    if !self.materials.contains(att) {
                        problems.push(format!("segment {} references missing attachment {}", seg.id, att.0));
                    }
                }
                if ranges.iter().any(|r| r.overlaps(&seg.target)) {
                    problems.push(format!("segment {} overlaps another segment on track {}", seg.id, track.id));
                }
                ranges.push(&seg.target);
            }
        }
        problems
    }
}
