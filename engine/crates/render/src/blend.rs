//! Blend modes: how a layer is put over the running composite below it (CapCut's Blend ›
//! Mode). CapCut draws each mode with a bundle of its own that ships with the app
//! (`Resources/MixMode`, one per mode, listed in `MixMode.json`); this reimplements their
//! shaders' maths from reading them (docs/parity/compositing.md). Nothing is copied.
//!
//! Each bundle mixes the clip `s` (premultiplied, its opacity applied) with what's below it,
//! `b`, by Porter-Duff source-over with a blend function B of the straight colours:
//!
//! ```text
//! colour = s·(1 − αb) + b·(1 − αs) + αs·αb·B(b/αb, s/αs)
//! alpha  = αs + αb − αs·αb
//! ```
//!
//! The blend functions are the usual separable ones, with CapCut's soft light (Photoshop's,
//! with √b above the middle) and its ends: Color dodge of white is white and Color burn of
//! black is black, except over white.

/// A blend mode, by CapCut's name for it in its Blend menu.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub enum BlendMode {
    /// CapCut's "Default": plain "over".
    #[default]
    Normal,
    Darken,
    Screen,
    Overlay,
    Multiply,
    /// "Brighten".
    Lighten,
    ColorBurn,
    ColorDodge,
    LinearBurn,
    SoftLight,
    HardLight,
}

impl BlendMode {
    pub const ALL: [BlendMode; 11] = [
        BlendMode::Normal,
        BlendMode::Darken,
        BlendMode::Screen,
        BlendMode::Overlay,
        BlendMode::Multiply,
        BlendMode::Lighten,
        BlendMode::ColorBurn,
        BlendMode::ColorDodge,
        BlendMode::LinearBurn,
        BlendMode::SoftLight,
        BlendMode::HardLight,
    ];

    /// The mode's number in blend.wgsl.
    pub(crate) fn index(self) -> f32 {
        self as u8 as f32
    }

    /// B(b, s) for one channel: the backdrop `b` and the layer `s`, straight colours 0…1.
    pub fn channel(self, b: f32, s: f32) -> f32 {
        match self {
            BlendMode::Normal => s,
            BlendMode::Darken => b.min(s),
            BlendMode::Lighten => b.max(s),
            BlendMode::Multiply => b * s,
            BlendMode::Screen => b + s - b * s,
            BlendMode::Overlay => {
                if b < 0.5 {
                    2.0 * b * s
                } else {
                    1.0 - 2.0 * (1.0 - b) * (1.0 - s)
                }
            }
            BlendMode::HardLight => {
                if s < 0.5 {
                    2.0 * s * b
                } else {
                    1.0 - 2.0 * (1.0 - s) * (1.0 - b)
                }
            }
            BlendMode::SoftLight => {
                if s <= 0.5 {
                    2.0 * b * s + b * b * (1.0 - 2.0 * s)
                } else {
                    b.sqrt() * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s)
                }
            }
            BlendMode::LinearBurn => (b + s - 1.0).max(0.0),
            BlendMode::ColorDodge => {
                if s >= 1.0 {
                    1.0
                } else {
                    (b / (1.0 - s)).min(1.0)
                }
            }
            BlendMode::ColorBurn => {
                if s <= 0.0 {
                    if b >= 1.0 { 1.0 } else { 0.0 }
                } else {
                    1.0 - ((1.0 - b) / s).min(1.0)
                }
            }
        }
    }

    /// A premultiplied layer pixel `s` over a premultiplied backdrop pixel `b` (RGBA, 0…1),
    /// as the GPU pass blends them.
    pub fn over(self, b: [f32; 4], s: [f32; 4]) -> [f32; 4] {
        let (ab, a_s) = (b[3], s[3]);
        if a_s <= 0.0 {
            return b;
        }
        let mut out = [0.0; 4];
        for c in 0..3 {
            let cb = if ab > 0.0 { b[c] / ab } else { 0.0 };
            let cs = s[c] / a_s;
            out[c] = (s[c] * (1.0 - ab) + b[c] * (1.0 - a_s) + a_s * ab * self.channel(cb.clamp(0.0, 1.0), cs.clamp(0.0, 1.0))).clamp(0.0, 1.0);
        }
        out[3] = (a_s + ab - a_s * ab).clamp(0.0, 1.0);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-6
    }

    /// Each mode's function at a few points, worked by hand from its bundle's formula.
    #[test]
    fn each_mode_matches_its_formula() {
        let m = |mode: BlendMode, b: f32, s: f32| mode.channel(b, s);
        // Normal: the layer.
        assert!(close(m(BlendMode::Normal, 0.2, 0.7), 0.7));
        // Darken / Lighten: the smaller / larger.
        assert!(close(m(BlendMode::Darken, 0.2, 0.7), 0.2) && close(m(BlendMode::Darken, 0.9, 0.7), 0.7));
        assert!(close(m(BlendMode::Lighten, 0.2, 0.7), 0.7) && close(m(BlendMode::Lighten, 0.9, 0.7), 0.9));
        // Multiply and Screen.
        assert!(close(m(BlendMode::Multiply, 0.5, 0.4), 0.2));
        assert!(close(m(BlendMode::Screen, 0.5, 0.4), 0.7));
        // Overlay picks its branch by the backdrop, Hard light by the layer: the same function
        // with the two swapped.
        assert!(close(m(BlendMode::Overlay, 0.25, 0.8), 0.4));
        assert!(close(m(BlendMode::Overlay, 0.75, 0.8), 1.0 - 2.0 * 0.25 * 0.2));
        for (b, s) in [(0.1, 0.3), (0.6, 0.2), (0.3, 0.9), (0.8, 0.7)] {
            assert!(close(m(BlendMode::HardLight, b, s), m(BlendMode::Overlay, s, b)));
        }
        // Soft light: 2bs + b²(1 − 2s) up to the middle, √b(2s − 1) + 2b(1 − s) above; the
        // two meet at s = ½ (the backdrop unchanged).
        assert!(close(m(BlendMode::SoftLight, 0.25, 0.25), 2.0 * 0.25 * 0.25 + 0.0625 * 0.5));
        assert!(close(m(BlendMode::SoftLight, 0.25, 0.75), 0.5 * 0.5 + 2.0 * 0.25 * 0.25));
        assert!(close(m(BlendMode::SoftLight, 0.3, 0.5), 0.3));
        // Linear burn: b + s − 1, not below 0.
        assert!(close(m(BlendMode::LinearBurn, 0.7, 0.6), 0.3) && close(m(BlendMode::LinearBurn, 0.2, 0.3), 0.0));
        // Color dodge: b / (1 − s), at most 1; white dodges to white.
        assert!(close(m(BlendMode::ColorDodge, 0.3, 0.5), 0.6) && close(m(BlendMode::ColorDodge, 0.6, 0.5), 1.0));
        assert!(close(m(BlendMode::ColorDodge, 0.0, 1.0), 1.0));
        // Color burn: 1 − (1 − b) / s, at least 0; black burns to black except over white.
        assert!(close(m(BlendMode::ColorBurn, 0.7, 0.5), 0.4) && close(m(BlendMode::ColorBurn, 0.2, 0.5), 0.0));
        assert!(close(m(BlendMode::ColorBurn, 0.5, 0.0), 0.0) && close(m(BlendMode::ColorBurn, 1.0, 0.0), 1.0));
    }

    /// Over an opaque backdrop, opacity mixes the blend in (CapCut's mix(b, B, αs)); a clear
    /// layer leaves the backdrop; over nothing, the layer shows as itself.
    #[test]
    fn opacity_and_alpha_compose_as_source_over() {
        let b = [0.5, 0.2, 0.8, 1.0];
        let s = [0.4 * 0.5, 0.9 * 0.5, 0.1 * 0.5, 0.5]; // (0.4, 0.9, 0.1) at half opacity
        for mode in BlendMode::ALL {
            let o = mode.over(b, s);
            for c in 0..3 {
                let want = b[c] + 0.5 * (mode.channel(b[c], s[c] / 0.5) - b[c]);
                assert!(close(o[c], want), "{mode:?} channel {c}: {} vs {want}", o[c]);
            }
            assert!(close(o[3], 1.0));
            assert_eq!(mode.over(b, [0.0; 4]), b);
            assert_eq!(mode.over([0.0; 4], s), s);
        }
        // Normal is plain "over".
        let o = BlendMode::Normal.over(b, s);
        for c in 0..3 {
            assert!(close(o[c], s[c] + b[c] * 0.5));
        }
    }
}
