//! A clip's colour statistics, from pixels sampled across its frames.

use crate::colour::{chroma, luma, oklab};

/// Pixels gathered from a clip's frames: encoded sRGB, 0–1. A few thousand per frame from a
/// dozen frames describe a clip's colour well; the statistics don't need more.
#[derive(Clone, Debug, Default)]
pub struct ColorSample {
    pixels: Vec<[f32; 3]>,
}

impl ColorSample {
    pub fn new() -> ColorSample {
        ColorSample::default()
    }

    pub fn from_pixels(pixels: Vec<[f32; 3]>) -> ColorSample {
        ColorSample { pixels }
    }

    /// Add a frame (straight RGBA bytes, `width` × `height`): at most `max` of its pixels,
    /// spread evenly over it; mostly transparent ones are left out.
    pub fn add_rgba(&mut self, data: &[u8], width: u32, height: u32, max: usize) {
        let n = (width as usize * height as usize).min(data.len() / 4);
        if n == 0 || max == 0 {
            return;
        }
        let step = (n as f64 / max as f64).max(1.0);
        let mut i = 0.0f64;
        while (i as usize) < n {
            let px = &data[i as usize * 4..][..4];
            if px[3] >= 128 {
                self.pixels.push([px[0] as f32 / 255.0, px[1] as f32 / 255.0, px[2] as f32 / 255.0]);
            }
            i += step;
        }
    }

    pub fn pixels(&self) -> &[[f32; 3]] {
        &self.pixels
    }

    pub fn len(&self) -> usize {
        self.pixels.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pixels.is_empty()
    }

    pub fn stats(&self) -> ColorStats {
        ColorStats::of(&self.pixels)
    }
}

/// The mean and standard deviation of each Oklab channel (L, a, b).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Moments {
    pub mean: [f32; 3],
    pub std: [f32; 3],
}

/// What the tools read off a clip's pixels.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ColorStats {
    pub pixels: usize,
    /// Oklab means and spreads (what Color match moves).
    pub lab: Moments,
    /// BT.709 luma of the encoded values: mean, standard deviation, and the 0.5th, 5th, 50th,
    /// 95th and 99.5th percentiles.
    pub luma_mean: f32,
    pub luma_std: f32,
    pub luma_percentiles: [f32; 5],
    /// Mean Oklab chroma (how colourful it is).
    pub chroma: f32,
    /// Mean a and b of the near-neutral pixels (low chroma, neither dark nor clipped): the
    /// colour cast white balance takes out. `None` when too few pixels are near neutral.
    pub neutral: Option<[f32; 2]>,
    /// The share of pixels counted as near neutral.
    pub neutral_share: f32,
}

/// Near neutral: chroma below this, lightness between these.
const NEUTRAL_CHROMA: f32 = 0.05;
const NEUTRAL_L: (f32, f32) = (0.25, 0.95);
/// Fewer near-neutral pixels than this share and there's no cast to read.
const MIN_NEUTRAL_SHARE: f32 = 0.03;
const BINS: usize = 1024;

impl ColorStats {
    pub fn of(pixels: &[[f32; 3]]) -> ColorStats {
        let n = pixels.len();
        if n == 0 {
            return ColorStats::default();
        }
        let mut sum = [0f64; 3];
        let mut sq = [0f64; 3];
        let (mut ysum, mut ysq, mut csum) = (0f64, 0f64, 0f64);
        let (mut nsum, mut ncount) = ([0f64; 2], 0usize);
        let mut hist = vec![0u32; BINS];
        for &rgb in pixels {
            let lab = oklab(rgb);
            for c in 0..3 {
                sum[c] += lab[c] as f64;
                sq[c] += (lab[c] as f64).powi(2);
            }
            let y = luma(rgb).clamp(0.0, 1.0);
            ysum += y as f64;
            ysq += (y as f64).powi(2);
            hist[((y * (BINS - 1) as f32).round() as usize).min(BINS - 1)] += 1;
            let ch = chroma(lab);
            csum += ch as f64;
            if ch < NEUTRAL_CHROMA && lab[0] > NEUTRAL_L.0 && lab[0] < NEUTRAL_L.1 {
                nsum[0] += lab[1] as f64;
                nsum[1] += lab[2] as f64;
                ncount += 1;
            }
        }
        let nf = n as f64;
        let mean = sum.map(|s| (s / nf) as f32);
        let std = [0, 1, 2].map(|c| ((sq[c] / nf - (sum[c] / nf).powi(2)).max(0.0)).sqrt() as f32);
        let luma_mean = (ysum / nf) as f32;
        let luma_std = ((ysq / nf - (ysum / nf).powi(2)).max(0.0)).sqrt() as f32;
        let percentile = |q: f64| -> f32 {
            let target = (q * nf).ceil().max(1.0) as u64;
            let mut seen = 0u64;
            for (i, &h) in hist.iter().enumerate() {
                seen += h as u64;
                if seen >= target {
                    return i as f32 / (BINS - 1) as f32;
                }
            }
            1.0
        };
        let neutral_share = ncount as f32 / n as f32;
        ColorStats {
            pixels: n,
            lab: Moments { mean, std },
            luma_mean,
            luma_std,
            luma_percentiles: [percentile(0.005), percentile(0.05), percentile(0.5), percentile(0.95), percentile(0.995)],
            chroma: (csum / nf) as f32,
            neutral: (neutral_share >= MIN_NEUTRAL_SHARE).then(|| [(nsum[0] / ncount as f64) as f32, (nsum[1] / ncount as f64) as f32]),
            neutral_share,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statistics_of_a_known_picture() {
        // Half black, half white: luma mean 0.5, spread 0.5, percentiles at the ends.
        let mut px = vec![[0.0, 0.0, 0.0]; 500];
        px.extend(vec![[1.0, 1.0, 1.0]; 500]);
        let s = ColorStats::of(&px);
        assert!((s.luma_mean - 0.5).abs() < 1e-3 && (s.luma_std - 0.5).abs() < 1e-3);
        assert_eq!(s.luma_percentiles[0], 0.0);
        assert_eq!(s.luma_percentiles[4], 1.0);
        assert!((s.lab.mean[0] - 0.5).abs() < 1e-3 && s.chroma < 1e-3);
        // Black and white are outside the neutral lightness band.
        assert!(s.neutral.is_none());

        // A warm grey: a cast towards yellow-red (a and b above 0) among neutrals.
        let warm = ColorStats::of(&vec![[0.6, 0.5, 0.4]; 100]);
        let cast = warm.neutral.unwrap();
        assert!(cast[0] > 0.0 && cast[1] > 0.0, "{cast:?}");
        assert_eq!(warm.neutral_share, 1.0);
    }

    #[test]
    fn a_sample_takes_pixels_evenly_and_skips_transparent_ones() {
        let mut data = Vec::new();
        for i in 0..100u32 {
            data.extend_from_slice(&[i as u8, 0, 0, if i < 50 { 255 } else { 0 }]);
        }
        let mut s = ColorSample::new();
        s.add_rgba(&data, 10, 10, 20);
        assert_eq!(s.len(), 10);
        assert!(s.pixels().iter().all(|p| p[0] < 50.0 / 255.0));
    }
}
