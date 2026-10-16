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
    pub hsl: Vec<HslAdjust>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub curves: Vec<ColorCurves>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub color_wheels: Vec<ColorWheels>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub animations: Vec<Animations>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub loudness: Vec<Loudness>,
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
    Hsl(&'a HslAdjust),
    Curves(&'a ColorCurves),
    ColorWheels(&'a ColorWheels),
    Animations(&'a Animations),
    Loudness(&'a Loudness),
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
        find!(hsl, Hsl);
        find!(curves, Curves);
        find!(color_wheels, ColorWheels);
        find!(animations, Animations);
        find!(loudness, Loudness);
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
            + self.hsl.len()
            + self.curves.len()
            + self.color_wheels.len()
            + self.animations.len()
            + self.loudness.len()
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
    /// What `size` is measured in. Stroke, shadow and background sizes are fractions of it.
    #[serde(default)]
    pub size_unit: SizeUnit,
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

/// Unit of a text run's font size.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SizeUnit {
    /// CapCut's own font-size unit: one unit is [`CAPCUT_SIZE_UNIT_EM`] of the canvas
    /// width as an em size, linear in the size value.
    #[default]
    CapCut,
    /// Fraction of the canvas height.
    CanvasHeight,
}

/// Em size of one CapCut font-size unit, as a fraction of the canvas width
/// (docs/parity/calibration.md: 0.005789 on a square canvas, 0.005786–0.005789 at sizes
/// 10, 15 and 30 on 16:9 at 1080p and 4K; a portrait check of width vs longer side is pending).
pub const CAPCUT_SIZE_UNIT_EM: f32 = 0.005_789;

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
    /// Fraction of the font size.
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
    /// Lines longer than this break between words (anywhere in CJK text): a fraction of the
    /// canvas width on screen (the clip's scale doesn't change it). `None` never wraps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_width: Option<f32>,
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextBackground {
    pub color: Rgba,
    /// Corner radius. CapCut imports keep CapCut's value until calibration session 3 pins
    /// its scale; v1 imports store a fraction of the font size.
    pub corner_radius: f32,
    /// CapCut's background width/height values, the box's padding around the text (scale
    /// still to be calibrated; CapCut's default is 0.14).
    #[serde(default)]
    pub width: f32,
    #[serde(default)]
    pub height: f32,
    /// CapCut's background style (1 = rectangle, 2 = rounded); 0 never reaches the model.
    #[serde(default)]
    pub style: u8,
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextShadow {
    pub color: Rgba,
    /// Offset length as a fraction of the font size.
    pub distance: f32,
    /// Direction of the offset in degrees, counter-clockwise from +x (+y up).
    pub angle_deg: f32,
    /// Blur radius as a fraction of the font size.
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

/// Loudness normalisation of a clip's sound (CapCut's "Normalize loudness"): the clip is
/// turned up or down to `target` from the loudness measured over its range.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Loudness {
    pub id: MaterialId,
    pub enabled: bool,
    /// Integrated loudness to reach, LUFS (CapCut: -23).
    pub target: f32,
    /// The clip's measured integrated loudness (LUFS) and sample peak (dBFS); `None`
    /// before the source app has measured it.
    pub measured: Option<f32>,
    pub peak: f32,
}

impl Loudness {
    /// Linear gain to apply: the difference to the target, held back so the peak stays
    /// below full scale (provisional: not yet measured against CapCut's output).
    pub fn gain(&self) -> f32 {
        let Some(measured) = self.measured.filter(|m| self.enabled && m.is_finite() && *m > -70.0) else { return 1.0 };
        let db = (self.target - measured).min(-self.peak.min(0.0));
        10f32.powf(db / 20.0)
    }
}

/// A clip's animations: an intro, an outro and a loop (at most one of each in CapCut), or a
/// caption style.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Animations {
    pub id: MaterialId,
    pub items: Vec<Animation>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Animation {
    pub kind: AnimationKind,
    /// Clip-local time the animation starts, and how long it runs.
    pub start: Micros,
    pub duration: Micros,
    /// Built-in OpenRip animation this maps to, if any (e.g. "type_1").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builtin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library: Option<LibraryRef>,
    /// The source app's downloaded copy of the animation, for animations that draw images
    /// from it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnimationKind {
    In,
    Out,
    Loop,
    /// Applies for the whole clip (CapCut's caption styles).
    Caption,
    #[serde(other)]
    Other,
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
    /// A file the effect reads, e.g. a LUT.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library: Option<LibraryRef>,
    /// A library text style's layers, for an effect attached to a text clip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_style: Option<Box<TextEffect>>,
}

/// A layered text style (CapCut's library "text styles"): shadows at the back, then
/// strokes, then the fill, each painted with a colour or a texture. Sizes are fractions of
/// the font size, like [`Stroke::width`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TextEffect {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Paint>,
    /// Outlines, first drawn on top (the outermost is usually last).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub strokes: Vec<EffectStroke>,
    /// Drawn in order, back to front, behind the strokes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shadows: Vec<EffectShadow>,
    /// Edges anti-aliased over a pixel, as CapCut draws its SDF text effects, instead of
    /// fading out a little beyond each shape, as it draws its text-style meshes.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sharp_edges: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EffectStroke {
    pub width: f32,
    pub paint: Paint,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EffectShadow {
    /// The shadow of the glyphs themselves.
    pub paint: Paint,
    /// Offset length (fraction of the font size) and direction (degrees, counter-clockwise
    /// from +x, +y up).
    pub distance: f32,
    pub angle_deg: f32,
    /// Softness (CapCut's `diffuse`).
    pub blur: f32,
    /// Outlines of the shadow, drawn under it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub strokes: Vec<EffectStroke>,
}

/// What a text layer is painted with, and its opacity.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Paint {
    pub alpha: f32,
    pub kind: PaintKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaintKind {
    Solid(Rgba),
    Texture(TexturePaint),
    /// The text's own colour shifted in HSB: hue in degrees, saturation and brightness as
    /// offsets on 0..1 (CapCut's SDF text effects colour their layers this way).
    TextColor { hue: f32, saturation: f32, brightness: f32 },
}

/// An image mapped onto each character: split into `columns` equal vertical strips, the
/// character with index i takes the square around the middle of strip i mod `columns`,
/// fitted to a square around the glyph, turned by `angle_deg`, and magnified by `scale`
/// (repeating beyond its edges).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TexturePaint {
    pub path: String,
    pub columns: u32,
    pub angle_deg: f32,
    pub scale: f32,
    pub stretch: TextureStretch,
    pub alpha: f32,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextureStretch {
    /// Keep the image's aspect, fitting inside the box.
    Fit,
    /// Keep the image's aspect, covering the box.
    Fill,
    /// Stretch to the box.
    Stretch,
}

/// HSL adjustment for one colour range (CapCut's HSL panel: one material per range).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HslAdjust {
    pub id: MaterialId,
    /// CapCut's colour-range index: 1–8 are its named ranges (red, orange, yellow, green,
    /// cyan, blue, purple, magenta — order still to be verified), 9 is a custom colour.
    pub range: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_color: Option<Rgba>,
    /// −100…100 each.
    pub hue: f32,
    pub saturation: f32,
    pub lightness: f32,
}

/// One curve anchor with bezier handles, all in 0…1 (x = input level, y = output level).
#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CurvePoint {
    pub anchor: (f64, f64),
    pub left: (f64, f64),
    pub right: (f64, f64),
}

/// Tone curves per channel. An empty channel is the identity curve.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ColorCurves {
    pub id: MaterialId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub luma: Vec<CurvePoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub red: Vec<CurvePoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub green: Vec<CurvePoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blue: Vec<CurvePoint>,
}

/// Evaluate a curve at input level `x` (0…1): cubic bezier segments between anchors,
/// using each anchor's right handle and the next anchor's left handle.
pub fn eval_curve(points: &[CurvePoint], x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    match points.len() {
        0 => return x,
        1 => return points[0].anchor.1,
        _ => {}
    }
    if x <= points[0].anchor.0 {
        return points[0].anchor.1;
    }
    let last = points.len() - 1;
    if x >= points[last].anchor.0 {
        return points[last].anchor.1;
    }
    let i = points.partition_point(|p| p.anchor.0 <= x).max(1);
    let (a, b) = (points[i - 1], points[i]);
    let (p0, p1, p2, p3) = (a.anchor, a.right, b.left, b.anchor);
    let bez = |t: f64, c0: f64, c1: f64, c2: f64, c3: f64| {
        let u = 1.0 - t;
        u * u * u * c0 + 3.0 * u * u * t * c1 + 3.0 * u * t * t * c2 + t * t * t * c3
    };
    // Solve x(t) = x by bisection (x is monotonic for well-formed curves).
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..60 {
        let mid = 0.5 * (lo + hi);
        if bez(mid, p0.0, p1.0, p2.0, p3.0) < x {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    bez(0.5 * (lo + hi), p0.1, p1.1, p2.1, p3.1).clamp(0.0, 1.0)
}

/// Values for one colour wheel.
#[derive(Copy, Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WheelValue {
    pub red: f64,
    pub green: f64,
    pub blue: f64,
    pub luma: f64,
    pub saturation: f64,
}

/// Lift / gamma / gain / offset colour wheels (CapCut's primary or log wheels).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ColorWheels {
    pub id: MaterialId,
    /// Log wheels (with range bounds in CapCut) rather than primary wheels.
    #[serde(default)]
    pub log: bool,
    pub lift: WheelValue,
    pub gamma: WheelValue,
    pub gain: WheelValue,
    pub offset: WheelValue,
    pub intensity: f64,
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

/// An owned material of any kind, for edits that add or remove materials.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AnyMaterial {
    Media(Media),
    Text(Text),
    Speed(Speed),
    CanvasFill(CanvasFill),
    AudioFade(AudioFade),
    Transition(Transition),
    Effect(Effect),
    Hsl(HslAdjust),
    Curves(ColorCurves),
    ColorWheels(ColorWheels),
    Animations(Animations),
    Loudness(Loudness),
    Foreign(Foreign),
}

impl AnyMaterial {
    pub fn id(&self) -> &MaterialId {
        match self {
            AnyMaterial::Media(m) => &m.id,
            AnyMaterial::Text(m) => &m.id,
            AnyMaterial::Speed(m) => &m.id,
            AnyMaterial::CanvasFill(m) => &m.id,
            AnyMaterial::AudioFade(m) => &m.id,
            AnyMaterial::Transition(m) => &m.id,
            AnyMaterial::Effect(m) => &m.id,
            AnyMaterial::Hsl(m) => &m.id,
            AnyMaterial::Curves(m) => &m.id,
            AnyMaterial::ColorWheels(m) => &m.id,
            AnyMaterial::Animations(m) => &m.id,
            AnyMaterial::Loudness(m) => &m.id,
            AnyMaterial::Foreign(m) => &m.id,
        }
    }
}

impl Materials {
    /// Insert a material at `index` within its table (clamped), or at the end.
    pub fn insert_at(&mut self, material: AnyMaterial, index: Option<usize>) {
        fn put<T>(v: &mut Vec<T>, item: T, index: Option<usize>) {
            let i = index.unwrap_or(v.len()).min(v.len());
            v.insert(i, item);
        }
        match material {
            AnyMaterial::Media(m) => put(&mut self.media, m, index),
            AnyMaterial::Text(m) => put(&mut self.texts, m, index),
            AnyMaterial::Speed(m) => put(&mut self.speeds, m, index),
            AnyMaterial::CanvasFill(m) => put(&mut self.canvas_fills, m, index),
            AnyMaterial::AudioFade(m) => put(&mut self.audio_fades, m, index),
            AnyMaterial::Transition(m) => put(&mut self.transitions, m, index),
            AnyMaterial::Effect(m) => put(&mut self.effects, m, index),
            AnyMaterial::Hsl(m) => put(&mut self.hsl, m, index),
            AnyMaterial::Curves(m) => put(&mut self.curves, m, index),
            AnyMaterial::ColorWheels(m) => put(&mut self.color_wheels, m, index),
            AnyMaterial::Animations(m) => put(&mut self.animations, m, index),
            AnyMaterial::Loudness(m) => put(&mut self.loudness, m, index),
            AnyMaterial::Foreign(m) => put(&mut self.foreign, m, index),
        }
    }

    /// Remove a material by id, returning it and its index within its table.
    pub fn remove(&mut self, id: &MaterialId) -> Option<(AnyMaterial, usize)> {
        macro_rules! take {
            ($field:ident, $variant:ident) => {
                if let Some(i) = self.$field.iter().position(|m| &m.id == id) {
                    return Some((AnyMaterial::$variant(self.$field.remove(i)), i));
                }
            };
        }
        take!(media, Media);
        take!(texts, Text);
        take!(speeds, Speed);
        take!(canvas_fills, CanvasFill);
        take!(audio_fades, AudioFade);
        take!(transitions, Transition);
        take!(effects, Effect);
        take!(hsl, Hsl);
        take!(curves, Curves);
        take!(color_wheels, ColorWheels);
        take!(animations, Animations);
        take!(loudness, Loudness);
        take!(foreign, Foreign);
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_and_bezier_curves() {
        assert_eq!(eval_curve(&[], 0.3), 0.3);
        // A straight diagonal written as bezier anchors with handles on the line.
        let line = [
            CurvePoint { anchor: (0.0, 0.0), left: (0.0, 0.0), right: (1.0 / 3.0, 1.0 / 3.0) },
            CurvePoint { anchor: (1.0, 1.0), left: (2.0 / 3.0, 2.0 / 3.0), right: (1.0, 1.0) },
        ];
        for i in 0..=10 {
            let x = i as f64 / 10.0;
            assert!((eval_curve(&line, x) - x).abs() < 1e-6, "{x}");
        }
        // A lifted black point: output at 0 is the first anchor's y.
        let lifted = [
            CurvePoint { anchor: (0.0, 0.1), left: (0.0, 0.1), right: (0.33, 0.4) },
            CurvePoint { anchor: (1.0, 0.9), left: (0.67, 0.6), right: (1.0, 0.9) },
        ];
        assert!((eval_curve(&lifted, 0.0) - 0.1).abs() < 1e-9);
        assert!((eval_curve(&lifted, 1.0) - 0.9).abs() < 1e-9);
        let mid = eval_curve(&lifted, 0.5);
        assert!(mid > 0.4 && mid < 0.6, "{mid}");
    }
}
