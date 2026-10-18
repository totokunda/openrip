//! Adjust ▸ Auto adjust: the Basic sliders set from a clip's own statistics, so the user sees
//! the values in the panel and can change them.
//!
//! Each statistic is brought into a band that well-exposed, balanced footage sits in, and left
//! alone when it's already there (a low-key or pastel clip is a choice, not a fault):
//!
//! 1. White balance (Temperature, Tint): the cast of the near-neutral pixels (grey world on
//!    what should be grey), mostly taken out.
//! 2. Levels (Whites, Blacks): the 99.5th luma percentile up towards white and the 0.5th down
//!    towards black when the clip doesn't reach them.
//! 3. Brightness: mean Oklab lightness into its band.
//! 4. Contrast: the luma spread into its band (then brightness again, as contrast moves it).
//! 5. Saturation: mean chroma into its band (a nearly grey clip stays grey).
//!
//! Every target is reached by solving against the sliders' own maths (the `model`, the
//! compositor's CPU reference of its Adjust pass), not a rule of thumb about what a slider
//! does, so the values come out right for CapCut's curves.

use crate::colour::{chroma, luma, oklab};

/// The Basic sliders Auto adjust sets, on the draft's scale (−1…1; the panel shows 50×).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Sliders {
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub whites: f32,
    pub blacks: f32,
}

impl Sliders {
    /// The values as the panel shows them (−50…50, whole steps), by the app's slider names.
    pub fn panel(&self) -> [(&'static str, i32); 7] {
        let p = |v: f32| (v * 50.0).round() as i32;
        [
            ("brightness", p(self.brightness)),
            ("contrast", p(self.contrast)),
            ("saturation", p(self.saturation)),
            ("temperature", p(self.temperature)),
            ("tint", p(self.tint)),
            ("whites", p(self.whites)),
            ("blacks", p(self.blacks)),
        ]
    }

    /// Each value on the panel's whole steps.
    fn rounded(mut self) -> Sliders {
        for v in [&mut self.brightness, &mut self.contrast, &mut self.saturation, &mut self.temperature, &mut self.tint, &mut self.whites, &mut self.blacks] {
            *v = (*v * 50.0).round() / 50.0;
        }
        self
    }
}

/// A colour through the sliders (encoded sRGB, 0–1).
pub type Model<'a> = dyn Fn(&Sliders, [f32; 3]) -> [f32; 3] + 'a;

/// The bands: mean Oklab lightness, luma standard deviation, mean chroma.
const LIGHTNESS: (f32, f32) = (0.52, 0.66);
const SPREAD: (f32, f32) = (0.15, 0.30);
const CHROMA: (f32, f32) = (0.035, 0.10);
/// Below this mean chroma the clip is meant to be grey.
const GREY: f32 = 0.012;
/// Levels: aim the ends here when the clip falls short of these.
const WHITE: (f32, f32) = (0.94, 0.965);
const BLACK: (f32, f32) = (0.05, 0.025);
/// The share of the cast taken out, and the smallest cast worth taking out.
const CAST_REMOVED: f32 = 0.8;
const MIN_CAST: f32 = 0.004;
/// Pixels the solver works on.
const MAX_PIXELS: usize = 6000;

/// What the solver reads off a picture.
#[derive(Clone, Copy, Debug)]
struct Measure {
    lightness: f32,
    spread: f32,
    low: f32,
    high: f32,
    chroma: f32,
    cast: [f32; 2],
}

fn measure(pixels: &[[f32; 3]], s: &Sliders, model: &Model) -> Measure {
    let n = pixels.len().max(1) as f32;
    let (mut l, mut y1, mut y2, mut c) = (0.0, 0.0, 0.0, 0.0);
    let (mut neutral, mut nc) = ([0.0f32; 2], 0usize);
    let mut all = [0.0f32; 2];
    let mut ys = Vec::with_capacity(pixels.len());
    for &p in pixels {
        let q = model(s, p);
        let lab = oklab(q);
        let y = luma(q);
        l += lab[0];
        y1 += y;
        y2 += y * y;
        ys.push(y);
        let ch = chroma(lab);
        c += ch;
        all[0] += lab[1];
        all[1] += lab[2];
        if ch < 0.05 && lab[0] > 0.25 && lab[0] < 0.95 {
            neutral[0] += lab[1];
            neutral[1] += lab[2];
            nc += 1;
        }
    }
    ys.sort_by(f32::total_cmp);
    let at = |q: f32| ys.get(((ys.len() as f32 - 1.0) * q).round() as usize).copied().unwrap_or(0.0);
    let mean_y = y1 / n;
    // Grey world on what's near neutral; with too little of it, half the whole picture's cast.
    let cast = if nc as f32 >= 0.03 * n { [neutral[0] / nc as f32, neutral[1] / nc as f32] } else { [0.5 * all[0] / n, 0.5 * all[1] / n] };
    Measure { lightness: l / n, spread: (y2 / n - mean_y * mean_y).max(0.0).sqrt(), low: at(0.005), high: at(0.995), chroma: c / n, cast }
}

/// The value in `lo..=hi` where an increasing `f` reaches `target` (an end if it doesn't).
fn solve(lo: f32, hi: f32, target: f32, f: impl Fn(f32) -> f32) -> f32 {
    if f(lo) >= target {
        return lo;
    }
    if f(hi) <= target {
        return hi;
    }
    let (mut a, mut b) = (lo, hi);
    for _ in 0..18 {
        let m = 0.5 * (a + b);
        if f(m) < target {
            a = m;
        } else {
            b = m;
        }
    }
    0.5 * (a + b)
}

/// `value` moved into `band`'s near edge (a little inside it), or `None` when it's in it.
fn into_band(value: f32, band: (f32, f32)) -> Option<f32> {
    let margin = 0.1 * (band.1 - band.0);
    if value < band.0 {
        Some(band.0 + margin)
    } else if value > band.1 {
        Some(band.1 - margin)
    } else {
        None
    }
}

/// The sliders that bring `pixels` (encoded sRGB, a sample of the clip) into the bands, as
/// `model` draws them.
pub fn auto_adjust(pixels: &[[f32; 3]], model: &Model) -> Sliders {
    if pixels.is_empty() {
        return Sliders::default();
    }
    let step = (pixels.len() as f64 / MAX_PIXELS as f64).max(1.0);
    let px: Vec<[f32; 3]> = (0..).map(|i| (i as f64 * step) as usize).take_while(|&i| i < pixels.len()).map(|i| pixels[i]).collect();
    let m = |s: &Sliders| measure(&px, s, model);
    let mut s = Sliders::default();

    let balance = |s: &mut Sliders| {
        let start = m(s).cast;
        if start[0].hypot(start[1]) < MIN_CAST {
            return;
        }
        let target = start.map(|v| v * (1.0 - CAST_REMOVED));
        // Newton's method on (temperature, tint) against the cast (a, b), the Jacobian
        // measured by small steps.
        for _ in 0..4 {
            let now = m(s).cast;
            let r = [now[0] - target[0], now[1] - target[1]];
            if r[0].hypot(r[1]) < MIN_CAST * 0.25 {
                break;
            }
            let h = 0.04;
            let dt = m(&Sliders { temperature: s.temperature + h, ..*s }).cast;
            let dn = m(&Sliders { tint: s.tint + h, ..*s }).cast;
            let j = [[(dt[0] - now[0]) / h, (dn[0] - now[0]) / h], [(dt[1] - now[1]) / h, (dn[1] - now[1]) / h]];
            let det = j[0][0] * j[1][1] - j[0][1] * j[1][0];
            if det.abs() < 1e-6 {
                break;
            }
            let d_temp = (j[1][1] * r[0] - j[0][1] * r[1]) / det;
            let d_tint = (j[0][0] * r[1] - j[1][0] * r[0]) / det;
            s.temperature = (s.temperature - d_temp).clamp(-0.5, 0.5);
            s.tint = (s.tint - d_tint).clamp(-0.5, 0.5);
        }
    };
    let lightness = |s: &mut Sliders| {
        if let Some(t) = into_band(m(s).lightness, LIGHTNESS) {
            s.brightness = solve(-0.4, 0.5, t, |v| m(&Sliders { brightness: v, ..*s }).lightness);
        }
    };

    // 1. White balance.
    balance(&mut s);
    // 2. Levels: stretch to the ends the clip doesn't reach.
    let now = m(&s);
    if now.high < WHITE.0 {
        s.whites = solve(0.0, 0.4, WHITE.1, |v| m(&Sliders { whites: v, ..s }).high);
    }
    if now.low > BLACK.0 {
        s.blacks = solve(-0.3, 0.0, BLACK.1, |v| m(&Sliders { blacks: v, ..s }).low);
    }
    // 3, 4. Lightness, spread, lightness again.
    lightness(&mut s);
    if let Some(t) = into_band(m(&s).spread, SPREAD) {
        s.contrast = solve(-0.4, 0.4, t, |v| m(&Sliders { contrast: v, ..s }).spread);
        lightness(&mut s);
    }
    // 5. Saturation, unless the clip is grey on purpose.
    let c = m(&s).chroma;
    if c > GREY {
        if let Some(t) = into_band(c, CHROMA) {
            s.saturation = solve(-0.4, 0.5, t, |v| m(&Sliders { saturation: v, ..s }).chroma);
        }
    }
    // The tone changes can tint what was balanced: once more.
    balance(&mut s);
    s.rounded()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::ColorStats;

    /// The compositor's own Adjust sliders.
    fn model(s: &Sliders, rgb: [f32; 3]) -> [f32; 3] {
        let a = openrip_render::Adjust {
            brightness: s.brightness,
            contrast: s.contrast,
            saturation: s.saturation,
            temperature: s.temperature,
            tint: s.tint,
            whites: s.whites,
            blacks: s.blacks,
            ..Default::default()
        };
        a.apply_rgb(rgb)
    }

    /// A scene: soft-coloured surfaces and greys at many levels.
    fn scene(gain: f32, lift: f32, cast: [f32; 3], colour: f32) -> Vec<[f32; 3]> {
        let mut out = Vec::new();
        for i in 0..60 {
            for j in 0..60 {
                let (u, v) = (i as f32 / 59.0, j as f32 / 59.0);
                let h = u * std::f32::consts::TAU * 2.0;
                // Half the picture grey (walls, a road), half coloured.
                let sat = if i % 2 == 0 { 0.0 } else { colour };
                let base = [0, 1, 2].map(|c| (v + sat * (h + c as f32 * 2.094).cos()).clamp(0.0, 1.0));
                out.push([0, 1, 2].map(|c| (lift + gain * base[c] * cast[c]).clamp(0.0, 1.0)));
            }
        }
        out
    }

    fn after(px: &[[f32; 3]], s: &Sliders) -> ColorStats {
        ColorStats::of(&px.iter().map(|&p| model(s, p)).collect::<Vec<_>>())
    }

    /// A dim, flat, blue picture comes out brighter, with more spread, reaching nearer the
    /// ends, and with most of its cast gone.
    #[test]
    fn a_dull_cool_picture_is_corrected() {
        let px = scene(0.45, 0.08, [0.9, 0.97, 1.18], 0.12);
        let before = ColorStats::of(&px);
        let s = auto_adjust(&px, &model);
        let fixed = after(&px, &s);
        eprintln!("{:?}\nbefore {before:?}\nafter {fixed:?}", s.panel());
        assert!(fixed.lab.mean[0] >= LIGHTNESS.0 - 0.01 && fixed.lab.mean[0] > before.lab.mean[0] + 0.05);
        assert!(fixed.luma_std > before.luma_std * 1.2);
        assert!(fixed.luma_percentiles[4] > before.luma_percentiles[4]);
        let (c0, c1) = (before.neutral.unwrap(), fixed.neutral.unwrap());
        assert!(c1[0].hypot(c1[1]) < 0.5 * c0[0].hypot(c0[1]), "{c0:?} -> {c1:?}");
        // A blue cast is warmed.
        assert!(s.temperature > 0.0);
    }

    /// A balanced, well-exposed picture is left nearly as it is.
    #[test]
    fn a_good_picture_is_left_alone() {
        let px = scene(0.96, 0.02, [1.0, 1.0, 1.0], 0.2);
        let st = ColorStats::of(&px);
        assert!(st.lab.mean[0] > LIGHTNESS.0 && st.lab.mean[0] < LIGHTNESS.1, "{st:?}");
        let s = auto_adjust(&px, &model);
        for (name, v) in s.panel() {
            assert!(v.abs() <= 3, "{name} {v} ({:?})", s.panel());
        }
    }

    /// A grey picture isn't given colour.
    #[test]
    fn a_grey_picture_stays_grey() {
        let px = scene(0.6, 0.1, [1.0, 1.0, 1.0], 0.0);
        let s = auto_adjust(&px, &model);
        assert_eq!(s.saturation, 0.0);
        assert!(after(&px, &s).chroma < 0.01);
    }
}
