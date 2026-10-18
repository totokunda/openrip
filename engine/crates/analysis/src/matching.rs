//! Adjust ▸ Color match: a clip's colours moved to a reference's, after Reinhard et al.,
//! "Color Transfer between Images" (2001): each channel's mean and spread taken from the
//! clip's to the reference's, here in Oklab (a perceptual space like the paper's lαβ, whose
//! channels hardly interact). The result is a 3D lookup table the compositor applies to the
//! clip's own pixels, mixed in by the section's intensity.
//!
//! The spreads' ratios are bounded, so a nearly grey clip isn't stretched into noise or a
//! busy one flattened: a match should look like a grade, not a repaint.

use crate::colour::{oklab, oklab_to_rgb};
use crate::stats::Moments;

/// How far a channel's spread may be scaled: lightness, then the colour channels.
const L_SCALE: (f32, f32) = (0.6, 1.6);
const AB_SCALE: (f32, f32) = (0.5, 2.0);
/// Below this a spread is treated as this (a flat channel has no spread to scale).
const MIN_STD: f32 = 1e-3;

/// Oklab in, Oklab out: `scale · lab + offset` per channel.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Transfer {
    pub scale: [f32; 3],
    pub offset: [f32; 3],
}

impl Default for Transfer {
    fn default() -> Self {
        Transfer::identity()
    }
}

impl Transfer {
    pub fn identity() -> Transfer {
        Transfer { scale: [1.0; 3], offset: [0.0; 3] }
    }

    /// The transfer that gives `source`'s colours `reference`'s means and spreads.
    pub fn between(source: &Moments, reference: &Moments) -> Transfer {
        let mut t = Transfer::identity();
        for c in 0..3 {
            let (lo, hi) = if c == 0 { L_SCALE } else { AB_SCALE };
            let s = (reference.std[c].max(MIN_STD) / source.std[c].max(MIN_STD)).clamp(lo, hi);
            t.scale[c] = s;
            t.offset[c] = reference.mean[c] - s * source.mean[c];
        }
        t
    }

    pub fn is_identity(&self) -> bool {
        self.scale.iter().all(|s| (s - 1.0).abs() < 1e-4) && self.offset.iter().all(|o| o.abs() < 1e-4)
    }

    /// One encoded sRGB colour (0–1) through the transfer, clipped to the gamut.
    pub fn apply(&self, rgb: [f32; 3]) -> [f32; 3] {
        let lab = oklab(rgb);
        oklab_to_rgb([0, 1, 2].map(|c| self.scale[c] * lab[c] + self.offset[c]))
    }

    /// The transfer as a 3D table with `size` entries a side: entry (r, g, b) at
    /// r + size·g + size²·b holds the colour (i/(size−1) per channel) mapped, red fastest,
    /// entries at the cube's corners (as `.cube` files and Hald images have them).
    pub fn lut(&self, size: usize) -> Vec<f32> {
        let n = size.max(2);
        let at = |i: usize| i as f32 / (n - 1) as f32;
        let mut out = Vec::with_capacity(n * n * n * 3);
        for b in 0..n {
            for g in 0..n {
                for r in 0..n {
                    out.extend(self.apply([at(r), at(g), at(b)]));
                }
            }
        }
        out
    }
}

/// A colour through an edge-aligned table from [`Transfer::lut`], by trilinear
/// interpolation, as the compositor reads it (for tests and previews on the CPU).
pub fn lookup(table: &[f32], size: usize, rgb: [f32; 3]) -> [f32; 3] {
    let n = size;
    let pos = rgb.map(|v| v.clamp(0.0, 1.0) * (n - 1) as f32);
    let lo = pos.map(|p| (p.floor() as usize).min(n - 2));
    let f = [0, 1, 2].map(|c| pos[c] - lo[c] as f32);
    let entry = |r: usize, g: usize, b: usize| -> [f32; 3] {
        let i = (r + n * g + n * n * b) * 3;
        [table[i], table[i + 1], table[i + 2]]
    };
    let mut out = [0.0; 3];
    for (corner, w) in (0..8).map(|k| {
        let (dr, dg, db) = (k & 1, (k >> 1) & 1, (k >> 2) & 1);
        let w = (if dr == 1 { f[0] } else { 1.0 - f[0] }) * (if dg == 1 { f[1] } else { 1.0 - f[1] }) * (if db == 1 { f[2] } else { 1.0 - f[2] });
        (entry(lo[0] + dr, lo[1] + dg, lo[2] + db), w)
    }) {
        for c in 0..3 {
            out[c] += corner[c] * w;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::ColorStats;

    /// A deterministic, varied picture: a hue sweep across, lightness down, with a cast.
    fn picture(n: usize, cast: [f32; 3], gain: f32, lift: f32) -> Vec<[f32; 3]> {
        let mut out = Vec::new();
        for i in 0..n {
            for j in 0..n {
                let (u, v) = (i as f32 / n as f32, j as f32 / n as f32);
                let h = u * std::f32::consts::TAU;
                let base = [0.5 + 0.3 * h.cos(), 0.5 + 0.3 * (h + 2.1).cos(), 0.5 + 0.3 * (h + 4.2).cos()];
                out.push([0, 1, 2].map(|c| (lift + gain * (base[c] * (0.25 + 0.75 * v)) * cast[c]).clamp(0.0, 1.0)));
            }
        }
        out
    }

    /// The transfer brings one picture's Oklab means and spreads to another's, through the
    /// table as the compositor reads it.
    #[test]
    fn matching_brings_the_statistics_to_the_references() {
        let source = picture(48, [0.85, 0.95, 1.15], 0.8, 0.02); // cool and dim
        let reference = picture(48, [1.12, 1.0, 0.82], 1.0, 0.06); // warm and bright
        let (s, r) = (ColorStats::of(&source), ColorStats::of(&reference));
        let t = Transfer::between(&s.lab, &r.lab);
        let table = t.lut(33);
        let matched: Vec<[f32; 3]> = source.iter().map(|&p| lookup(&table, 33, p)).collect();
        let m = ColorStats::of(&matched);
        for c in 0..3 {
            let before = (s.lab.mean[c] - r.lab.mean[c]).abs();
            let after = (m.lab.mean[c] - r.lab.mean[c]).abs();
            assert!(after < 0.01 && after <= before * 0.5 + 1e-4, "mean {c}: {} -> {} (ref {})", s.lab.mean[c], m.lab.mean[c], r.lab.mean[c]);
            assert!((m.lab.std[c] / r.lab.std[c] - 1.0).abs() < 0.1, "std {c}: {} -> {} (ref {})", s.lab.std[c], m.lab.std[c], r.lab.std[c]);
        }
        // Matching a picture to itself changes nothing.
        let same = Transfer::between(&s.lab, &s.lab);
        assert!(same.is_identity());
        let p = [0.3, 0.6, 0.2];
        let q = lookup(&same.lut(17), 17, p);
        assert!((0..3).all(|c| (q[c] - p[c]).abs() < 2e-3), "{q:?}");
    }

    #[test]
    fn spreads_are_bounded() {
        let grey = Moments { mean: [0.6, 0.0, 0.0], std: [0.1, 0.0, 0.0] };
        let vivid = Moments { mean: [0.6, 0.02, 0.03], std: [0.4, 0.2, 0.2] };
        let t = Transfer::between(&grey, &vivid);
        assert_eq!(t.scale, [1.6, 2.0, 2.0]);
        let back = Transfer::between(&vivid, &grey);
        assert_eq!(back.scale, [0.6, 0.5, 0.5]);
    }
}
