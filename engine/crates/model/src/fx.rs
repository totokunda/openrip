//! OpenRip's own video effects: the catalog of shader effects the engine draws on an effect
//! bar (a track of its own, affecting everything under it) or on one clip. The shaders are
//! in `openrip-render` (`effects.wgsl`); this is their data: id, name, category, the number the
//! shader switches on, and the parameters each has beside its strength.
//!
//! Every parameter, strength included, is 0…1 in the model (the app shows 0…100). An effect is
//! an [`crate::Effect`] with `builtin` `fx:<id>`; its `intensity` and parameters by name are
//! its values, and keyframes drive them ([`crate::Param::Intensity`] and `FxA`…`FxC`, which are
//! the first, second and third of the effect's own parameters).

use crate::material::Effect;

/// One of an effect's own parameters (besides its strength).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FxParam {
    pub id: &'static str,
    pub name: &'static str,
    pub default: f32,
}

/// One effect of the catalog.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FxDef {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    /// What the shader switches on.
    pub kind: u32,
    /// The strength a new one starts at.
    pub intensity: f32,
    /// Up to three.
    pub params: &'static [FxParam],
}

/// The `builtin` prefix of an effect's material.
pub const BUILTIN_PREFIX: &str = "fx:";

/// The categories, in the order the Effects tab lists them.
pub const CATEGORIES: &[&str] = &["Basic", "Retro", "Glitch", "Light", "Lens", "Party", "Motion", "Frames"];

const fn p(id: &'static str, name: &'static str, default: f32) -> FxParam {
    FxParam { id, name, default }
}

const SPEED: FxParam = p("speed", "Speed", 0.5);
const TEMPO: FxParam = p("tempo", "Tempo", 0.4);

const fn d(id: &'static str, name: &'static str, category: &'static str, kind: u32, intensity: f32, params: &'static [FxParam]) -> FxDef {
    FxDef { id, name, category, kind, intensity, params }
}

/// Every effect.
pub static FX: &[FxDef] = &[
    // Basic
    d("blur", "Blur", "Basic", 1, 0.5, &[]),
    d("zoom_in", "Slow zoom in", "Basic", 2, 0.5, &[]),
    d("zoom_out", "Slow zoom out", "Basic", 3, 0.5, &[]),
    d("shake", "Shake", "Basic", 4, 0.5, &[SPEED]),
    d("flash", "Flash", "Basic", 5, 0.8, &[p("speed", "Speed", 0.4)]),
    d("strobe", "Strobe", "Basic", 6, 1.0, &[p("speed", "Speed", 0.4), p("shade", "Shade", 0.0)]),
    d("fade_in", "Fade from black", "Basic", 7, 1.0, &[]),
    d("fade_out", "Fade to black", "Basic", 8, 1.0, &[]),
    d("white_in", "Fade from white", "Basic", 9, 1.0, &[]),
    d("white_out", "Fade to white", "Basic", 10, 1.0, &[]),
    d("vignette_pulse", "Pulsing vignette", "Basic", 11, 0.7, &[p("speed", "Speed", 0.4)]),
    d("mosaic", "Mosaic", "Basic", 12, 0.5, &[]),
    d("mono", "Black and white", "Basic", 13, 1.0, &[]),
    d("invert", "Invert colours", "Basic", 14, 1.0, &[]),
    d("sepia", "Sepia", "Basic", 15, 1.0, &[]),
    d("comic", "Comic ink", "Basic", 16, 0.7, &[]),
    d("sketch", "Pencil sketch", "Basic", 17, 0.8, &[]),
    // Retro
    d("scanlines", "Scanlines", "Retro", 20, 0.6, &[p("size", "Line size", 0.4)]),
    d("tracking", "Tracking noise", "Retro", 21, 0.7, &[p("speed", "Speed", 0.4), p("band", "Band height", 0.5)]),
    d("colour_bleed", "Colour bleed", "Retro", 22, 0.6, &[]),
    d("film_grain", "Film grain", "Retro", 23, 0.5, &[p("size", "Grain size", 0.3)]),
    d("dust", "Dust and scratches", "Retro", 24, 0.6, &[p("amount", "Amount", 0.5)]),
    d("old_film", "Old film", "Retro", 25, 0.7, &[]),
    d("crt", "Tube screen", "Retro", 26, 0.6, &[]),
    d("tape_jitter", "Tape jitter", "Retro", 27, 0.6, &[]),
    d("flicker", "Flicker", "Retro", 28, 0.5, &[SPEED]),
    // Glitch
    d("rgb_split", "RGB split", "Glitch", 30, 0.5, &[p("spread", "Spread", 0.5), p("angle", "Angle", 0.0)]),
    d("block_glitch", "Block glitch", "Glitch", 31, 0.6, &[SPEED]),
    d("pixel_sort", "Pixel sort", "Glitch", 32, 0.6, &[p("speed", "Speed", 0.4), p("length", "Length", 0.5)]),
    d("smear", "Datamosh smear", "Glitch", 33, 0.6, &[p("speed", "Speed", 0.4)]),
    d("slice_glitch", "Slice glitch", "Glitch", 34, 0.6, &[SPEED]),
    d("digital_noise", "Digital noise", "Glitch", 35, 0.5, &[SPEED]),
    d("static", "Static", "Glitch", 36, 0.5, &[]),
    d("channel_swap", "Channel swap", "Glitch", 37, 0.6, &[SPEED]),
    // Light
    d("leak_warm", "Warm light leak", "Light", 40, 0.7, &[p("speed", "Speed", 0.4)]),
    d("leak_cool", "Cool light leak", "Light", 41, 0.7, &[p("speed", "Speed", 0.4)]),
    d("leak_prism", "Prism light leak", "Light", 42, 0.6, &[p("speed", "Speed", 0.4)]),
    d("lens_flare", "Lens flare", "Light", 43, 0.7, &[p("position", "Position", 0.3), p("size", "Size", 0.5)]),
    d("glow", "Glow", "Light", 44, 0.6, &[p("radius", "Radius", 0.5)]),
    d("bloom_pulse", "Pulsing bloom", "Light", 45, 0.7, &[p("speed", "Speed", 0.4)]),
    d("sparkle", "Sparkle", "Light", 46, 0.8, &[SPEED, p("density", "Density", 0.5)]),
    d("dream", "Dreamy focus", "Light", 47, 0.6, &[]),
    d("sun_rays", "Sun rays", "Light", 48, 0.7, &[p("position", "Position", 0.7)]),
    d("streak", "Light streaks", "Light", 49, 0.7, &[p("length", "Length", 0.6)]),
    // Lens
    d("fisheye", "Fisheye", "Lens", 50, 0.6, &[]),
    d("pinch", "Pinch", "Lens", 51, 0.6, &[]),
    d("magnify", "Magnifier", "Lens", 52, 0.7, &[p("size", "Size", 0.5)]),
    d("chroma_aberration", "Chromatic aberration", "Lens", 53, 0.6, &[]),
    d("tilt_shift", "Tilt-shift", "Lens", 54, 0.7, &[p("focus", "Focus", 0.5), p("band", "Band", 0.4)]),
    d("mirror_h", "Mirror left to right", "Lens", 55, 1.0, &[]),
    d("mirror_v", "Mirror top to bottom", "Lens", 56, 1.0, &[]),
    d("kaleidoscope", "Kaleidoscope", "Lens", 57, 1.0, &[p("segments", "Segments", 0.4), p("spin", "Spin", 0.3)]),
    d("split2", "Split screen 2", "Lens", 58, 1.0, &[]),
    d("split3", "Split screen 3", "Lens", 59, 1.0, &[]),
    d("split4", "Split screen 4", "Lens", 60, 1.0, &[]),
    d("split9", "Split screen 9", "Lens", 61, 1.0, &[]),
    d("swirl", "Swirl", "Lens", 62, 0.6, &[]),
    d("ripple", "Water ripple", "Lens", 63, 0.6, &[SPEED]),
    d("zoom_blur", "Radial blur", "Lens", 64, 0.6, &[]),
    d("prism", "Prism", "Lens", 65, 0.6, &[]),
    // Party
    d("rainbow", "Rainbow", "Party", 70, 0.6, &[SPEED]),
    d("colour_cycle", "Colour cycle", "Party", 71, 1.0, &[SPEED]),
    d("beat_flash", "Beat flash", "Party", 72, 0.7, &[p("tempo", "Tempo", 0.5)]),
    d("disco", "Disco lights", "Party", 73, 0.7, &[SPEED]),
    d("neon_edges", "Neon edges", "Party", 74, 0.8, &[]),
    d("confetti", "Confetti", "Party", 75, 1.0, &[SPEED, p("density", "Density", 0.5)]),
    // Motion
    d("zoom_punch", "Zoom punch", "Motion", 80, 0.6, &[TEMPO]),
    d("whip_pan", "Whip pan", "Motion", 81, 0.8, &[TEMPO]),
    d("camera_shake", "Handheld shake", "Motion", 82, 0.5, &[SPEED]),
    d("swing", "Swing", "Motion", 83, 0.5, &[p("speed", "Speed", 0.4)]),
    d("spin", "Spin", "Motion", 84, 0.5, &[p("speed", "Speed", 0.4)]),
    d("bounce", "Bounce", "Motion", 85, 0.5, &[TEMPO]),
    d("echo", "Echo trail", "Motion", 86, 0.6, &[p("distance", "Distance", 0.5)]),
    d("heartbeat", "Heartbeat", "Motion", 87, 0.6, &[TEMPO]),
    // Frames
    d("letterbox", "Letterbox", "Frames", 90, 0.7, &[]),
    d("border", "Border", "Frames", 91, 0.5, &[p("shade", "Shade", 1.0)]),
    d("polaroid", "Instant photo", "Frames", 92, 0.6, &[]),
    d("rounded", "Rounded corners", "Frames", 93, 0.6, &[]),
    d("film_strip", "Film strip", "Frames", 94, 0.6, &[]),
];

/// The effect with this id.
pub fn find(id: &str) -> Option<&'static FxDef> {
    FX.iter().find(|e| e.id == id)
}

impl FxDef {
    /// The `builtin` name of an effect material of this kind.
    pub fn builtin(&self) -> String {
        format!("{BUILTIN_PREFIX}{}", self.id)
    }

    /// The parameter named `name` (`intensity` is slot 0, the effect's own from 1).
    pub fn slot(&self, name: &str) -> Option<usize> {
        if name == "intensity" {
            return Some(0);
        }
        self.params.iter().position(|p| p.id == name).map(|i| i + 1)
    }

    /// The name of parameter slot `slot` (0 is the strength).
    pub fn param_name(&self, slot: usize) -> Option<&'static str> {
        if slot == 0 {
            Some("intensity")
        } else {
            self.params.get(slot - 1).map(|p| p.id)
        }
    }
}

/// An effect's values as the shader takes them: the strength and its three parameters, the
/// stored ones with the catalog's defaults for any it lacks, clamped to 0…1.
pub fn values(e: &Effect) -> Option<(&'static FxDef, f32, [f32; 3])> {
    let def = find(e.builtin.as_deref()?.strip_prefix(BUILTIN_PREFIX)?)?;
    let get = |name: &str, default: f32| e.params.get(name).map_or(default, |v| *v as f32).clamp(0.0, 1.0);
    let mut own = [0.0; 3];
    for (slot, param) in def.params.iter().enumerate() {
        own[slot] = get(param.id, param.default);
    }
    Some((def, get("intensity", def.intensity), own))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_consistent() {
        let mut kinds: Vec<u32> = FX.iter().map(|e| e.kind).collect();
        kinds.sort();
        kinds.dedup();
        assert_eq!(kinds.len(), FX.len(), "kinds are unique");
        let mut ids: Vec<&str> = FX.iter().map(|e| e.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), FX.len(), "ids are unique");
        assert!(FX.len() >= 60 && FX.len() <= 100);
        for e in FX {
            assert!(e.params.len() <= 3, "{}", e.id);
            assert!(CATEGORIES.contains(&e.category), "{}", e.id);
        }
    }
}
