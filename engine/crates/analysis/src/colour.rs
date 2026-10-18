//! Colour spaces for the analysis. Pixels are encoded sRGB (BT.709 primaries, the values the
//! compositor works in), 0–1. Statistics and matching work in Oklab (Björn Ottosson, 2020): a
//! perceptual space where L is lightness and a, b are green–red and blue–yellow, so averages
//! and spreads follow what the eye sees and a change to one hardly moves the others.

/// An encoded sRGB value in linear light.
#[inline]
pub fn to_linear(v: f32) -> f32 {
    if v <= 0.040_45 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// A linear-light value encoded as sRGB.
#[inline]
pub fn to_encoded(v: f32) -> f32 {
    if v <= 0.003_130_8 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// Encoded sRGB (0–1) in Oklab.
pub fn oklab(rgb: [f32; 3]) -> [f32; 3] {
    let [r, g, b] = rgb.map(|v| to_linear(v.clamp(0.0, 1.0)));
    let l = (0.412_221_47 * r + 0.536_332_54 * g + 0.051_445_99 * b).cbrt();
    let m = (0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b).cbrt();
    let s = (0.088_302_46 * r + 0.281_718_84 * g + 0.629_978_7 * b).cbrt();
    [
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ]
}

/// Oklab in linear sRGB, not clamped (outside 0–1 where the colour is out of gamut).
pub fn oklab_to_linear(lab: [f32; 3]) -> [f32; 3] {
    let [l, a, b] = lab;
    let l_ = l + 0.396_337_78 * a + 0.215_803_76 * b;
    let m_ = l - 0.105_561_346 * a - 0.063_854_17 * b;
    let s_ = l - 0.089_484_18 * a - 1.291_485_5 * b;
    let (l3, m3, s3) = (l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
    [
        4.076_741_7 * l3 - 3.307_711_6 * m3 + 0.230_969_94 * s3,
        -1.268_438 * l3 + 2.609_757_4 * m3 - 0.341_319_38 * s3,
        -0.004_196_086_3 * l3 - 0.703_418_6 * m3 + 1.707_614_7 * s3,
    ]
}

/// Oklab in encoded sRGB, clipped to the gamut (each channel to 0–1 in linear light).
pub fn oklab_to_rgb(lab: [f32; 3]) -> [f32; 3] {
    oklab_to_linear(lab).map(|v| to_encoded(v.clamp(0.0, 1.0)))
}

/// BT.709 luma of encoded values (what the Adjust sliders' contrast pivots on is close to it).
#[inline]
pub fn luma(rgb: [f32; 3]) -> f32 {
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

/// Oklab chroma: the distance from grey.
#[inline]
pub fn chroma(lab: [f32; 3]) -> f32 {
    (lab[1] * lab[1] + lab[2] * lab[2]).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oklab_round_trips_and_has_its_reference_values() {
        // White is L 1, grey has no chroma; Ottosson's published values for the primaries.
        let w = oklab([1.0, 1.0, 1.0]);
        assert!((w[0] - 1.0).abs() < 1e-3 && w[1].abs() < 1e-3 && w[2].abs() < 1e-3, "{w:?}");
        let red = oklab([1.0, 0.0, 0.0]);
        assert!((red[0] - 0.627_955).abs() < 1e-3 && (red[1] - 0.224_863).abs() < 1e-3 && (red[2] - 0.125_846).abs() < 1e-3, "{red:?}");
        let grey = oklab([0.5, 0.5, 0.5]);
        assert!(chroma(grey) < 1e-3);
        for rgb in [[0.1, 0.5, 0.9], [0.9, 0.2, 0.3], [0.0, 0.0, 0.0], [0.7, 0.7, 0.1]] {
            let back = oklab_to_rgb(oklab(rgb));
            for c in 0..3 {
                assert!((back[c] - rgb[c]).abs() < 1e-3, "{rgb:?} -> {back:?}");
            }
        }
    }
}
