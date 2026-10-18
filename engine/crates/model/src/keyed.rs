//! Keyframed material parameters: a segment's own keyframes for the values of the materials
//! it uses (its Adjust sliders, a filter's strength, the colour wheels' strength, an HSL
//! range, its text's colours, sizes and glow, a mask's place and size). The transform, opacity and
//! volume are keyframed on the segment itself ([`crate::Animated`]).
//!
//! Keys are in the segment's local time, like the segment's own, and replace the material's
//! value while they last: before the first key the first key's value applies, after the last
//! the last's (as CapCut holds a keyframed property's ends). The helpers here give a copy of
//! a material with its keyframed values at a time, for the renderer to draw.

use serde::{Deserialize, Serialize};

use crate::animated::{sample_keys, Keyframe};
use crate::material::*;
use crate::project::Segment;
use crate::time::Micros;

/// A material parameter keyframes can drive.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Param {
    /// An effect's strength: an Adjust slider's value (CapCut's `intensity`, −1…1, or the
    /// app's own `value` on its scale) or a filter's intensity (0…1).
    Intensity,
    /// The colour wheels' strength (0…1).
    WheelIntensity,
    /// An HSL range's hue, saturation and lightness (−100…100).
    HslHue,
    HslSaturation,
    HslLightness,
    /// The text's fill: red, green, blue (0…1) and its opacity.
    TextRed,
    TextGreen,
    TextBlue,
    TextAlpha,
    /// The text's outline: colour, opacity and width (a fraction of the font size).
    StrokeRed,
    StrokeGreen,
    StrokeBlue,
    StrokeAlpha,
    StrokeWidth,
    /// The text's shadow: colour, opacity, angle (degrees), distance and softness (fractions
    /// of the font size).
    ShadowRed,
    ShadowGreen,
    ShadowBlue,
    ShadowAlpha,
    ShadowAngle,
    ShadowDistance,
    ShadowSmoothing,
    /// The text's background box: colour, opacity, corner radius and padding (CapCut's units).
    BackgroundRed,
    BackgroundGreen,
    BackgroundBlue,
    BackgroundAlpha,
    BackgroundRadius,
    BackgroundWidth,
    BackgroundHeight,
    /// Curved text's arc (degrees).
    TextCurve,
    /// The text's glow: colour, opacity, strength and range (0…1), and where it spreads from
    /// (CapCut's `dirX` and `dirY`).
    GlowRed,
    GlowGreen,
    GlowBlue,
    GlowAlpha,
    GlowStrength,
    GlowRange,
    GlowDirX,
    GlowDirY,
    /// The text's font size: its first run's (in its unit), the others scaled alike.
    TextSize,
    /// A mask's centre (half-sizes from the picture's middle, +y up), size (fractions of the
    /// picture), rotation (degrees), feather and rounded corners (its own units).
    MaskCenterX,
    MaskCenterY,
    MaskWidth,
    MaskHeight,
    MaskRotation,
    MaskFeather,
    MaskRoundCorner,
    /// A chroma key's intensity, shadow, edge smoothing and spill (0…1).
    ChromaIntensity,
    ChromaShadow,
    ChromaEdgeSmooth,
    ChromaSpill,
}

/// Keyframes of one parameter of one of a segment's materials.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ParamKeys {
    /// The material: the segment's own (its text, a filter bar's filter) or an attachment.
    pub material: MaterialId,
    pub param: Param,
    /// Sorted by time; never empty.
    pub keys: Vec<Keyframe<f64>>,
}

impl Segment {
    /// The value keyframes give `param` of `material` at local time `t`, if it has keys.
    pub fn keyed(&self, material: &MaterialId, param: Param, t: Micros) -> Option<f64> {
        self.keyframes.iter().find(|k| &k.material == material && k.param == param).and_then(|k| sample_keys(&k.keys, t))
    }

    /// Whether any of `material`'s parameters are keyframed.
    pub fn has_keyed(&self, material: &MaterialId) -> bool {
        self.keyframes.iter().any(|k| &k.material == material)
    }

    /// An effect (an Adjust slider, a filter) with its keyframed strength at local time `t`:
    /// CapCut's `intensity`, or `value` for the app's own sliders (`v1:` builtins).
    pub fn effect_at(&self, e: &Effect, t: Micros) -> Effect {
        let mut e = e.clone();
        if let Some(v) = self.keyed(&e.id, Param::Intensity, t) {
            let key = if e.builtin.as_deref().is_some_and(|b| b.starts_with("v1:")) { "value" } else { "intensity" };
            e.params.insert(key.into(), v);
        }
        e
    }

    pub fn wheels_at(&self, w: &ColorWheels, t: Micros) -> ColorWheels {
        let mut w = w.clone();
        if let Some(v) = self.keyed(&w.id, Param::WheelIntensity, t) {
            w.intensity = v;
        }
        w
    }

    pub fn hsl_at(&self, h: &HslAdjust, t: Micros) -> HslAdjust {
        let mut h = h.clone();
        let set = |p: Param, slot: &mut f32| {
            if let Some(v) = self.keyed(&h.id, p, t) {
                *slot = v as f32;
            }
        };
        set(Param::HslHue, &mut h.hue);
        set(Param::HslSaturation, &mut h.saturation);
        set(Param::HslLightness, &mut h.lightness);
        h
    }

    /// The segment's text with its keyframed colours and sizes at local time `t`. A colour
    /// keyframed on a run applies to every run (CapCut keyframes the whole text); an outline,
    /// shadow or background that's keyframed but absent is added from the keys.
    pub fn text_at(&self, text: &Text, t: Micros) -> Text {
        let mut text = text.clone();
        if !self.has_keyed(&text.id) {
            return text;
        }
        let id = text.id.clone();
        let k = |p: Param| self.keyed(&id, p, t).map(|v| v as f32);
        // The size is the first run's; the others keep their proportion to it.
        let grow = k(Param::TextSize).zip(text.runs.first().map(|r| r.size)).filter(|(_, was)| *was > 0.0).map(|(now, was)| now / was);
        for run in &mut text.runs {
            let c = &mut run.fill;
            (c.r, c.g, c.b, c.a) = (k(Param::TextRed).unwrap_or(c.r), k(Param::TextGreen).unwrap_or(c.g), k(Param::TextBlue).unwrap_or(c.b), k(Param::TextAlpha).unwrap_or(c.a));
            if let Some(g) = grow {
                run.size *= g;
            }
            let stroke_keyed = [Param::StrokeRed, Param::StrokeGreen, Param::StrokeBlue, Param::StrokeAlpha, Param::StrokeWidth].into_iter().any(|p| k(p).is_some());
            if stroke_keyed {
                let s = run.stroke.get_or_insert(Stroke { color: crate::animated::Rgba::BLACK, width: 0.0 });
                let c = &mut s.color;
                (c.r, c.g, c.b, c.a) = (k(Param::StrokeRed).unwrap_or(c.r), k(Param::StrokeGreen).unwrap_or(c.g), k(Param::StrokeBlue).unwrap_or(c.b), k(Param::StrokeAlpha).unwrap_or(c.a));
                s.width = k(Param::StrokeWidth).unwrap_or(s.width);
            }
        }
        let shadow = [Param::ShadowRed, Param::ShadowGreen, Param::ShadowBlue, Param::ShadowAlpha, Param::ShadowAngle, Param::ShadowDistance, Param::ShadowSmoothing];
        if shadow.into_iter().any(|p| k(p).is_some()) {
            let s = text.layout.shadow.get_or_insert(TextShadow { color: crate::animated::Rgba::BLACK, distance: 0.0, angle_deg: 0.0, smoothing: 0.0 });
            let c = &mut s.color;
            (c.r, c.g, c.b, c.a) = (k(Param::ShadowRed).unwrap_or(c.r), k(Param::ShadowGreen).unwrap_or(c.g), k(Param::ShadowBlue).unwrap_or(c.b), k(Param::ShadowAlpha).unwrap_or(c.a));
            s.angle_deg = k(Param::ShadowAngle).unwrap_or(s.angle_deg);
            s.distance = k(Param::ShadowDistance).unwrap_or(s.distance);
            s.smoothing = k(Param::ShadowSmoothing).unwrap_or(s.smoothing);
        }
        let background = [Param::BackgroundRed, Param::BackgroundGreen, Param::BackgroundBlue, Param::BackgroundAlpha, Param::BackgroundRadius, Param::BackgroundWidth, Param::BackgroundHeight];
        if background.into_iter().any(|p| k(p).is_some()) {
            let b = text.layout.background.get_or_insert(TextBackground { color: crate::animated::Rgba::BLACK, corner_radius: 0.0, width: 0.14, height: 0.14, style: 1 });
            let c = &mut b.color;
            (c.r, c.g, c.b, c.a) = (k(Param::BackgroundRed).unwrap_or(c.r), k(Param::BackgroundGreen).unwrap_or(c.g), k(Param::BackgroundBlue).unwrap_or(c.b), k(Param::BackgroundAlpha).unwrap_or(c.a));
            b.corner_radius = k(Param::BackgroundRadius).unwrap_or(b.corner_radius);
            b.width = k(Param::BackgroundWidth).unwrap_or(b.width);
            b.height = k(Param::BackgroundHeight).unwrap_or(b.height);
        }
        if let Some(curve) = k(Param::TextCurve) {
            text.layout.curve = curve;
        }
        let glow = [Param::GlowRed, Param::GlowGreen, Param::GlowBlue, Param::GlowAlpha, Param::GlowStrength, Param::GlowRange, Param::GlowDirX, Param::GlowDirY];
        if glow.into_iter().any(|p| k(p).is_some()) {
            let g = text.layout.glow.get_or_insert(TextGlow { color: None, strength: 0.3, range: 0.2, direction: [0.5, 0.5], style: None });
            // A keyed colour on a glow in the text's colours starts from white.
            if [Param::GlowRed, Param::GlowGreen, Param::GlowBlue, Param::GlowAlpha].into_iter().any(|p| k(p).is_some()) {
                let c = g.color.get_or_insert(crate::animated::Rgba::WHITE);
                (c.r, c.g, c.b, c.a) = (k(Param::GlowRed).unwrap_or(c.r), k(Param::GlowGreen).unwrap_or(c.g), k(Param::GlowBlue).unwrap_or(c.b), k(Param::GlowAlpha).unwrap_or(c.a));
            }
            g.strength = k(Param::GlowStrength).unwrap_or(g.strength);
            g.range = k(Param::GlowRange).unwrap_or(g.range);
            g.direction = [k(Param::GlowDirX).unwrap_or(g.direction[0]), k(Param::GlowDirY).unwrap_or(g.direction[1])];
        }
        text
    }

    /// A chroma key with its keyframed intensity, shadow, edge smoothing and spill at local
    /// time `t`.
    pub fn chroma_at(&self, c: &Chroma, t: Micros) -> Chroma {
        let mut c = c.clone();
        if !self.has_keyed(&c.id) {
            return c;
        }
        let id = c.id.clone();
        let k = |p: Param| self.keyed(&id, p, t).map(|v| v as f32);
        c.intensity = k(Param::ChromaIntensity).unwrap_or(c.intensity);
        c.shadow = k(Param::ChromaShadow).unwrap_or(c.shadow);
        c.edge_smooth = k(Param::ChromaEdgeSmooth).unwrap_or(c.edge_smooth);
        c.spill = k(Param::ChromaSpill).unwrap_or(c.spill);
        c
    }

    /// A mask with its keyframed place, size, rotation, feather and rounded corners at local
    /// time `t`.
    pub fn mask_at(&self, m: &Mask, t: Micros) -> Mask {
        let mut m = m.clone();
        if !self.has_keyed(&m.id) {
            return m;
        }
        let id = m.id.clone();
        let k = |p: Param| self.keyed(&id, p, t).map(|v| v as f32);
        m.center = [k(Param::MaskCenterX).unwrap_or(m.center[0]), k(Param::MaskCenterY).unwrap_or(m.center[1])];
        m.size = [k(Param::MaskWidth).unwrap_or(m.size[0]), k(Param::MaskHeight).unwrap_or(m.size[1])];
        m.rotation = k(Param::MaskRotation).unwrap_or(m.rotation);
        m.feather = k(Param::MaskFeather).unwrap_or(m.feather);
        if let (MaskShape::Rectangle { round_corner }, Some(r)) = (&mut m.shape, k(Param::MaskRoundCorner)) {
            *round_corner = r;
        }
        m
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::animated::{Animated, Rgba};
    use crate::project::Transform;
    use crate::time::TimeRange;
    use std::collections::BTreeMap;

    fn segment(keyframes: Vec<ParamKeys>) -> Segment {
        Segment {
            id: "s".into(),
            material: MaterialId("t".into()),
            source: None,
            target: TimeRange::new(Micros(0), Micros(2_000_000)),
            speed: 1.0,
            reverse: false,
            change_pitch: false,
            visible: true,
            render_index: 0,
            transform: Transform::default(),
            crop: None,
            opacity: Animated::constant(1.0),
            volume: Animated::constant(1.0),
            attachments: vec![MaterialId("fx".into())],
            keyframes,
        }
    }

    fn keys(material: &str, param: Param, pairs: &[(i64, f64)]) -> ParamKeys {
        ParamKeys { material: MaterialId(material.into()), param, keys: pairs.iter().map(|&(t, v)| Keyframe::new(Micros(t), v)).collect() }
    }

    #[test]
    fn an_adjust_slider_follows_its_keys_over_its_own_value() {
        let s = segment(vec![keys("fx", Param::Intensity, &[(0, 0.0), (1_000_000, 0.5)])]);
        let mut params = BTreeMap::new();
        params.insert("intensity".to_string(), 0.9);
        let e = Effect { id: MaterialId("fx".into()), category: EffectCategory::Adjust, name: String::new(), params, builtin: Some("brightness".into()), resource: None, library: None, text_style: None };
        assert_eq!(s.effect_at(&e, Micros(500_000)).params["intensity"], 0.25);
        assert_eq!(s.effect_at(&e, Micros(1_500_000)).params["intensity"], 0.5);
        // The app's sliders keep their value under "value".
        let app = Effect { builtin: Some("v1:brightness".into()), ..e.clone() };
        assert_eq!(s.effect_at(&app, Micros(0)).params.get("value"), Some(&0.0));
        // Another material's keys don't apply.
        let other = Effect { id: MaterialId("fy".into()), ..e };
        assert_eq!(s.effect_at(&other, Micros(500_000)).params["intensity"], 0.9);
    }

    #[test]
    fn text_colours_and_a_missing_outline_come_from_keys() {
        let s = segment(vec![keys("t", Param::TextRed, &[(0, 0.0), (1_000_000, 1.0)]), keys("t", Param::StrokeWidth, &[(0, 0.1)])]);
        let text = Text {
            id: MaterialId("t".into()),
            text: "hi".into(),
            runs: vec![TextRun { range: (0, 2), font: FontRef::default(), size: 15.0, size_unit: SizeUnit::CapCut, fill: Rgba::WHITE, gradient: None, stroke: None, more_strokes: Vec::new(), bold: false, italic: false, underline: false }],
            layout: TextLayout { alignment: 1, letter_spacing: 0.0, line_spacing: 0.0, line_height: None, kerning: false, background: None, shadow: None, glow: None, max_width: None, curve: 0.0, frame: None },
            words: Vec::new(),
        };
        let at = s.text_at(&text, Micros(250_000));
        assert_eq!((at.runs[0].fill.r, at.runs[0].fill.g), (0.25, 1.0));
        assert_eq!(at.runs[0].stroke.map(|s| s.width), Some(0.1));
    }

    #[test]
    fn a_chroma_keys_sliders_follow_their_keys() {
        let s = segment(vec![keys("k", Param::ChromaIntensity, &[(0, 0.0), (1_000_000, 0.8)]), keys("k", Param::ChromaSpill, &[(0, 0.5)])]);
        let c = Chroma { id: MaterialId("k".into()), color: Rgba { r: 0.0, g: 1.0, b: 0.0, a: 1.0 }, intensity: 0.3, shadow: 0.2, edge_smooth: 0.1, spill: 0.0 };
        let at = s.chroma_at(&c, Micros(500_000));
        assert_eq!((at.intensity, at.shadow, at.edge_smooth, at.spill), (0.4, 0.2, 0.1, 0.5));
        assert!(!at.is_off() && s.chroma_at(&c, Micros(0)).is_off());
    }

    #[test]
    fn a_mask_moves_with_its_keys() {
        let s = segment(vec![keys("m", Param::MaskCenterX, &[(0, -0.5), (1_000_000, 0.5)]), keys("m", Param::MaskRoundCorner, &[(0, 0.2)])]);
        let m = Mask { id: MaterialId("m".into()), shape: MaskShape::Rectangle { round_corner: 0.0 }, center: [0.0, 0.3], size: [0.5, 0.5], rotation: 0.0, feather: 0.0, invert: false, inside: MaskPaint::Clip, outside: MaskPaint::clear(), keys: Vec::new(), library: None };
        let at = s.mask_at(&m, Micros(750_000));
        assert_eq!((at.center, at.shape), ([0.25, 0.3], MaskShape::Rectangle { round_corner: 0.2 }));
    }
}
