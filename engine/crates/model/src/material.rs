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
    pub shapes: Vec<Shape>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub masks: Vec<Mask>,
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
    pub stickers: Vec<Sticker>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub foreign: Vec<Foreign>,
}

/// A borrowed view of any material, for lookups by id.
#[derive(Debug)]
pub enum MaterialRef<'a> {
    Media(&'a Media),
    Text(&'a Text),
    Shape(&'a Shape),
    Mask(&'a Mask),
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
    Sticker(&'a Sticker),
    Foreign(&'a Foreign),
}

impl MaterialRef<'_> {
    /// An owned copy, as stored in a project.
    pub fn to_owned_material(&self) -> AnyMaterial {
        match *self {
            MaterialRef::Media(m) => AnyMaterial::Media(m.clone()),
            MaterialRef::Text(m) => AnyMaterial::Text(m.clone()),
            MaterialRef::Shape(m) => AnyMaterial::Shape(m.clone()),
            MaterialRef::Mask(m) => AnyMaterial::Mask(m.clone()),
            MaterialRef::Speed(m) => AnyMaterial::Speed(m.clone()),
            MaterialRef::CanvasFill(m) => AnyMaterial::CanvasFill(m.clone()),
            MaterialRef::AudioFade(m) => AnyMaterial::AudioFade(m.clone()),
            MaterialRef::Transition(m) => AnyMaterial::Transition(m.clone()),
            MaterialRef::Effect(m) => AnyMaterial::Effect(m.clone()),
            MaterialRef::Hsl(m) => AnyMaterial::Hsl(m.clone()),
            MaterialRef::Curves(m) => AnyMaterial::Curves(m.clone()),
            MaterialRef::ColorWheels(m) => AnyMaterial::ColorWheels(m.clone()),
            MaterialRef::Animations(m) => AnyMaterial::Animations(m.clone()),
            MaterialRef::Loudness(m) => AnyMaterial::Loudness(m.clone()),
            MaterialRef::Sticker(m) => AnyMaterial::Sticker(m.clone()),
            MaterialRef::Foreign(m) => AnyMaterial::Foreign(m.clone()),
        }
    }
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
        find!(shapes, Shape);
        find!(masks, Mask);
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
        find!(stickers, Sticker);
        find!(foreign, Foreign);
        None
    }

    pub fn contains(&self, id: &MaterialId) -> bool {
        self.get(id).is_some()
    }

    pub fn len(&self) -> usize {
        self.media.len()
            + self.texts.len()
            + self.shapes.len()
            + self.masks.len()
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
            + self.stickers.len()
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
    /// The source app's saved cut-out of the subject (CapCut's background removal): a
    /// folder of per-frame masks, `mask/<source µs>` (8-bit, the size in
    /// `maskinfo/<source µs>`), covering the whole picture upright.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matte: Option<String>,
    /// A copy of the video played backward that the source app rendered (CapCut's
    /// `reverse_path`, made when a clip is reversed), with its sound. Frame for frame it's
    /// the video mirrored in time about its middle: its time `t` shows the video's
    /// `duration - t`. Reversed clips play it forward where it's readable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverse_path: Option<String>,
    /// A freeze frame: this material is a still of one instant of a video.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freeze: Option<Freeze>,
}

/// What a freeze frame holds (CapCut's Freeze). CapCut saves the still as a picture, the
/// material's `path` (a photo); OpenRip's own have no picture (an empty `path`) and are drawn
/// from the video, as CapCut's are when their picture is missing. A freeze has no sound.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Freeze {
    /// The video it's a still of.
    pub video: String,
    /// Its time in the video (the frame shown then).
    pub at: Micros,
}

/// Rich text: the full string plus styled runs over character ranges.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Text {
    pub id: MaterialId,
    pub text: String,
    pub runs: Vec<TextRun>,
    pub layout: TextLayout,
    /// When each word is spoken, for captions that follow the speech (word-by-word
    /// highlighting): the words of `text` in order, spaces excluded.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<SpokenWord>,
}

/// A word of a caption and when it's spoken.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SpokenWord {
    /// Character range `[start, end)` into `Text::text` (Unicode scalar values), with any
    /// punctuation that's part of the word.
    pub range: (u32, u32),
    /// Clip-local time the word starts and ends; equal when it isn't spoken (a word typed in
    /// after the speech was transcribed).
    pub start: Micros,
    pub end: Micros,
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
    /// width as the height of the font's line box (ascent + descent), linear in the size
    /// value.
    #[default]
    CapCut,
    /// Fraction of the canvas height.
    CanvasHeight,
}

/// Line-box height of one CapCut font-size unit, as a fraction of the canvas width
/// (docs/parity/calibration.md: 0.005789 on a square canvas, 0.005786–0.005789 at sizes
/// 10, 15 and 30 on 16:9 at 1080p and 4K, all with CapCut's default font, whose line box is
/// exactly 1 em; fonts with other line boxes confirm it's the line box that's sized).
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
    /// Line boxes this many em tall, each line placed in its box as Konva places text (the
    /// app's own text); `None` for CapCut's (the font's ascent + descent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f32>,
    /// Apply the font's kerning: the app's text does (a browser canvas kerns), CapCut's
    /// doesn't (its words come out as wide as their unkerned advances).
    #[serde(default)]
    pub kerning: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<TextBackground>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<TextShadow>,
    /// Lines longer than this break between words (anywhere in CJK text): a fraction of the
    /// canvas width at the clip's scale 1 (it scales with the clip, not with the font size).
    /// `None` never wraps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_width: Option<f32>,
    /// Curved text: each line bent along a circular arc spanning this many degrees,
    /// arching up when positive and sagging when negative (CapCut's `text_curve`). 0 is
    /// straight.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub curve: f32,
    /// A box the text sits in, centred on the clip's position (OpenRip's own text clips).
    /// Without one the block of lines is centred on the position, as CapCut does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<TextFrame>,
}

/// A text box: the block of lines sits inside it by [`TextLayout::alignment`] and
/// `vertical_align`, and wraps at its width.
fn is_zero(v: &f32) -> bool {
    *v == 0.0
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextFrame {
    /// Fractions of the canvas width and height.
    pub width: f32,
    pub height: f32,
    /// 0 = top, 1 = middle, 2 = bottom.
    #[serde(default)]
    pub vertical_align: u8,
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextBackground {
    pub color: Rgba,
    /// Corner radius. CapCut imports keep CapCut's value (0.4 draws 0.22 em × the clip's
    /// scale, measured on exports); v1 imports store a fraction of the font size.
    pub corner_radius: f32,
    /// CapCut's background width/height values: the box's padding around each line, in em
    /// (measured; CapCut's default is 0.14).
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

/// A mask over a clip's own picture: CapCut's video masks (the clip inside, cut out
/// outside, or the other way round when inverted) and the app's masks (either side the clip
/// or a colour). It moves, turns and scales with the clip.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Mask {
    pub id: MaterialId,
    pub shape: MaskShape,
    /// Centre in the picture, in half-widths and half-heights from its middle (+y up).
    pub center: [f32; 2],
    /// Width and height as fractions of the picture's.
    pub size: [f32; 2],
    /// Degrees, clockwise.
    #[serde(default)]
    pub rotation: f32,
    /// CapCut's feather, 0 to 1: a soft edge in the mask's own units (its size), as CapCut's
    /// shape draws it; the app's shapes soften the same way (docs/parity/masks.md).
    #[serde(default)]
    pub feather: f32,
    #[serde(default)]
    pub invert: bool,
    #[serde(default = "MaskPaint::clip")]
    pub inside: MaskPaint,
    #[serde(default = "MaskPaint::clear")]
    pub outside: MaskPaint,
    /// Poses over time (the app's mask keyframes), in order, the first being the shape and
    /// place above. Before the first the first applies, after the last the last; between two
    /// of the same shape the place, size, turn (and a lasso's points) travel by the first's
    /// easing, else the first holds.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keys: Vec<MaskKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library: Option<LibraryRef>,
}

/// A mask's shape and place at `at` (time in the clip's source; for stills, in the clip).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MaskKey {
    pub at: Micros,
    pub shape: MaskShape,
    pub center: [f32; 2],
    pub size: [f32; 2],
    #[serde(default)]
    pub rotation: f32,
    /// How the pose travels to the next key's.
    #[serde(default)]
    pub ease: crate::animated::Easing,
}

/// What one side of a mask shows.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaskPaint {
    /// The clip's own pixels.
    Clip,
    /// A colour (clear when transparent).
    Color(Rgba),
}

impl MaskPaint {
    pub fn clip() -> Self {
        MaskPaint::Clip
    }
    pub fn clear() -> Self {
        MaskPaint::Color(Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.0 })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum MaskShape {
    /// Corners rounded by `round_corner` of the shorter half-side.
    Rectangle { round_corner: f32 },
    /// The ellipse inscribed in the box.
    Ellipse,
    /// The app's triangle: apex at the top middle, base along the bottom, all moved up a
    /// sixth of the height so its centroid is the box's centre.
    Triangle,
    /// The app's five-pointed star, stretched to the box, inner points at half its radii.
    Star,
    /// A closed polygon (the app's lasso), points in fractions of the picture's width and
    /// height from its top-left; `center`, `size` and `rotation` don't apply.
    Polygon { points: Vec<[f32; 2]> },
    /// CapCut's circle: the ellipse inscribed in the box, its edge softened as CapCut's
    /// bundle does it.
    Circle,
    /// CapCut's linear mask: the side of a line through the centre that the rotation points
    /// up from (`size` doesn't apply).
    Linear,
    /// CapCut's mirror: a band along a line through the centre, as tall as the box (its
    /// width doesn't apply).
    Mirror,
    /// A shape drawn from a picture in the source app's bundle (CapCut's heart and star,
    /// `pentagram`): a distance field whose 0.5 level is the outline, spanning 1.7 times the
    /// box (so the shape fills it). `path` is the picture (`…/image/mask.png`); without it the
    /// clip shows whole.
    Picture { name: String, path: String },
    /// The app's brush: strokes painted over the picture, round-ended, each `width` across
    /// (a fraction of the picture's height), points in fractions of its width and height
    /// from its top-left; an erasing stroke takes away what's under it. `center`, `size`
    /// and `rotation` don't apply.
    Brush { strokes: Vec<BrushStroke> },
    /// A shape not drawn yet, by CapCut's name for it (`contour`, …).
    Other { name: String },
}

/// One stroke of the app's brush mask.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BrushStroke {
    pub points: Vec<[f32; 2]>,
    pub width: f32,
    #[serde(default)]
    pub erase: bool,
}

/// A vector graphic: shapes and drawings. Drawn in a box of its own units, `scale`d on each
/// axis (stroke widths too), centred on the segment's position and turned by its rotation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Shape {
    pub id: MaterialId,
    /// The box, in the shape's own units, before `scale`.
    pub size: [f32; 2],
    #[serde(default = "unit_scale")]
    pub scale: [f32; 2],
    /// One of the shape's units as a fraction of the canvas height.
    pub unit: f32,
    /// Drawn in order, each over the ones before.
    pub paths: Vec<ShapePath>,
}

fn unit_scale() -> [f32; 2] {
    [1.0, 1.0]
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ShapePath {
    pub geometry: Geometry,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Rgba>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<ShapeStroke>,
    #[serde(default = "one")]
    pub opacity: f32,
    #[serde(default)]
    pub blend: PathBlend,
}

fn one() -> f32 {
    1.0
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ShapeStroke {
    pub color: Rgba,
    /// In the shape's units, centred on the outline.
    pub width: f32,
    #[serde(default)]
    pub ends: StrokeEnds,
}

/// A stroke's caps and joins.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrokeEnds {
    /// Butt caps, mitred joins.
    #[default]
    Butt,
    /// Round caps and joins (drawings' brushes).
    Round,
    /// Square caps, bevelled joins (highlighters).
    Square,
}

/// How a path combines with what's under it.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PathBlend {
    #[default]
    Normal,
    /// Darkens what's under it (a highlighter).
    Multiply,
    /// Removes the paths drawn before it in the same shape (an eraser).
    Erase,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum Geometry {
    /// The box, its corners rounded by `corner_radius` (at most half the shorter side).
    Rectangle { corner_radius: f32 },
    /// The ellipse inscribed in the box.
    Ellipse,
    /// A regular polygon centred in the box, its first vertex straight up, corners rounded
    /// by `corner_radius`.
    Polygon { sides: u32, radius: f32, corner_radius: f32 },
    /// A star centred in the box, its first point straight up.
    Star { points: u32, inner: f32, outer: f32 },
    /// A polyline through points in the box's units (origin at its top-left), curved through
    /// them by `tension` (0 is straight segments; Konva's cardinal spline).
    Line { points: Vec<[f32; 2]>, tension: f32, closed: bool },
}

/// A clip's speed (CapCut's `speeds` table): constant, or a curve that remaps its time
/// (`crate::speed`). A segment plays by the curve of the speed it's attached to.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Speed {
    pub id: MaterialId,
    pub speed: f64,
    /// Speed-curve control points as (progress 0..1, speed multiplier), if curved (CapCut's
    /// `curve_speed.speed_points`; see `crate::speed` for what they mean).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub curve: Vec<(f64, f64)>,
    /// The curve's preset (CapCut's `curve_speed.name`: "Montage", "Hero", …), if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
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
    /// The source app's downloaded copy of the transition, for transitions that draw images
    /// from it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
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

/// A clip's animations: an intro, an outro and a loop or combo (at most one of each in
/// CapCut), or a caption style.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Animations {
    pub id: MaterialId,
    pub items: Vec<Animation>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Animation {
    pub kind: AnimationKind,
    /// Clip-local time the animation starts, and how long it runs. An Out animation ends
    /// with its clip whatever its start (CapCut writes 0 there).
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
    /// Repeats over the clip, once per its duration (CapCut's text and sticker loops).
    Loop,
    /// Runs once over the whole clip (a video or photo's combo; CapCut's type "group").
    Combo,
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
    /// A sound effect on a clip's audio (CapCut's voice filters).
    Audio,
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

/// A sticker from the source app's library (CapCut's info stickers): an image, or an animated
/// GIF that loops, drawn centred on the segment's position at a size of its own (not fitted
/// to the canvas like a photo).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Sticker {
    pub id: MaterialId,
    /// The image or GIF in the source app's downloaded bundle; empty when the bundle isn't on
    /// this machine (the sticker is then left out).
    pub path: String,
    #[serde(default)]
    pub animated: bool,
    /// One frame's size in pixels, as the bundle describes it (0 if it doesn't).
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
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

/// An owned material of any kind, for edits that add or remove materials.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AnyMaterial {
    Media(Media),
    Text(Text),
    Shape(Shape),
    Mask(Mask),
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
    Sticker(Sticker),
    Foreign(Foreign),
}

impl AnyMaterial {
    pub fn id(&self) -> &MaterialId {
        match self {
            AnyMaterial::Media(m) => &m.id,
            AnyMaterial::Text(m) => &m.id,
            AnyMaterial::Shape(m) => &m.id,
            AnyMaterial::Mask(m) => &m.id,
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
            AnyMaterial::Sticker(m) => &m.id,
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
            AnyMaterial::Shape(m) => put(&mut self.shapes, m, index),
            AnyMaterial::Mask(m) => put(&mut self.masks, m, index),
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
            AnyMaterial::Sticker(m) => put(&mut self.stickers, m, index),
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
        take!(shapes, Shape);
        take!(masks, Mask);
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
        take!(stickers, Sticker);
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
