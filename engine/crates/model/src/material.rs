//! Materials: the things segments point at (media, text, fills, fades, effects…).
//! Mirrors CapCut's `materials` tables. Anything OpenRip doesn't understand yet is
//! kept as a `Foreign` material so nothing is lost and it can be reported.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::animated::Rgba;
use crate::time::Micros;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MaterialId(pub String);

impl From<&str> for MaterialId {
    fn from(s: &str) -> Self {
        MaterialId(s.to_string())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Materials {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media: Vec<Media>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub texts: Vec<Text>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub speeds: Vec<Speed>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub canvas_fills: Vec<CanvasFill>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub audio_fades: Vec<AudioFade>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transitions: Vec<Transition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<Effect>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub foreign: Vec<Foreign>,
}

/// A borrowed view of any material, for lookups by id.
#[derive(Debug)]
pub enum MaterialRef<'a> {
    Media(&'a Media),
    Text(&'a Text),
    Speed(&'a Speed),
    CanvasFill(&'a CanvasFill),
    AudioFade(&'a AudioFade),
    Transition(&'a Transition),
    Effect(&'a Effect),
    Foreign(&'a Foreign),
}

impl Materials {
    pub fn get(&self, id: &MaterialId) -> Option<MaterialRef<'_>> {
        macro_rules! find {
            ($field:ident, $variant:ident) => {
                if let Some(m) = self.$field.iter().find(|m| &m.id == id) {
                    return Some(MaterialRef::$variant(m));
                }
            };
        }
        find!(media, Media);
        find!(texts, Text);
        find!(speeds, Speed);
        find!(canvas_fills, CanvasFill);
        find!(audio_fades, AudioFade);
        find!(transitions, Transition);
        find!(effects, Effect);
        find!(foreign, Foreign);
        None
    }

    pub fn contains(&self, id: &MaterialId) -> bool {
        self.get(id).is_some()
    }

    pub fn len(&self) -> usize {
        self.media.len()
            + self.texts.len()
            + self.speeds.len()
            + self.canvas_fills.len()
            + self.audio_fades.len()
            + self.transitions.len()
            + self.effects.len()
            + self.foreign.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Video,
    Photo,
    Audio,
}

/// A media file on disk.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Media {
    pub id: MaterialId,
    pub kind: MediaKind,
    pub path: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    pub duration: Micros,
    #[serde(default)]
    pub has_audio: bool,
}

/// Rich text: the full string plus styled runs over character ranges.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Text {
    pub id: MaterialId,
    pub text: String,
    pub runs: Vec<TextRun>,
    pub layout: TextLayout,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextRun {
    /// Character range `[start, end)` into `Text::text` (Unicode scalar values).
    pub range: (u32, u32),
    pub font: FontRef,
    pub size: f32,
    pub fill: Rgba,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Stroke>,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub underline: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct FontRef {
    /// Display/family name if known.
    #[serde(default)]
    pub name: String,
    /// Path to a font file if the source referenced one.
    #[serde(default)]
    pub path: String,
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    pub color: Rgba,
    pub width: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextLayout {
    /// 0 = left, 1 = centre, 2 = right (CapCut's convention).
    pub alignment: u8,
    #[serde(default)]
    pub letter_spacing: f32,
    #[serde(default)]
    pub line_spacing: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<TextBackground>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<TextShadow>,
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextBackground {
    pub color: Rgba,
    pub corner_radius: f32,
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextShadow {
    pub color: Rgba,
    pub distance: f32,
    pub angle_deg: f32,
    pub smoothing: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Speed {
    pub id: MaterialId,
    pub speed: f64,
    /// Speed-curve control points as (progress 0..1, speed multiplier), if curved.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub curve: Vec<(f64, f64)>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CanvasFillKind {
    Color { color: Rgba },
    Blur { amount: f32 },
    Image { path: String },
}

/// What fills the canvas behind a segment that doesn't cover it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CanvasFill {
    pub id: MaterialId,
    pub fill: CanvasFillKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AudioFade {
    pub id: MaterialId,
    pub fade_in: Micros,
    pub fade_out: Micros,
}

/// A reference to an asset from another app's online library that OpenRip does
/// not ship (proprietary effects, transitions, stickers, templates, fonts).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LibraryRef {
    pub app: String,
    pub resource_id: String,
    pub name: String,
    #[serde(default)]
    pub category: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transition {
    pub id: MaterialId,
    pub name: String,
    pub duration: Micros,
    /// Whether the two clips overlap during the transition.
    pub overlap: bool,
    /// Built-in OpenRip transition this maps to, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builtin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library: Option<LibraryRef>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectCategory {
    /// Colour filter (LUT-like look).
    Filter,
    /// Stylised video effect.
    VideoEffect,
    /// Basic colour adjustments (exposure, contrast, …).
    Adjust,
    Other,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Effect {
    pub id: MaterialId,
    pub category: EffectCategory,
    pub name: String,
    /// Numeric parameters by name (e.g. "intensity", "exposure").
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builtin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library: Option<LibraryRef>,
}

/// A material OpenRip doesn't interpret yet, kept verbatim.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Foreign {
    pub id: MaterialId,
    /// Source app, e.g. "capcut".
    pub app: String,
    /// Source table name, e.g. "stickers".
    pub kind: String,
    pub raw: serde_json::Value,
}
