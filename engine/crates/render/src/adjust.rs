//! CapCut's Adjust sliders as a GPU pass.
//!
//! The behaviour comes from the colour bundle CapCut downloads (its Adjust shader and the
//! script that turns slider values into shader parameters), read locally and reimplemented
//! here; see docs/parity/adjust.md. Slider values are CapCut's: -1..1, the UI's -50..50 / 50.
//! Exposure ("light sensation") blends towards one of two 17x17x17 lookup tables that ship in
//! that bundle; without them, exposure is skipped.

use std::sync::Arc;

use crate::grade::{Curves, Hsl};
use crate::RgbaImage;

/// One wheel's values, each -1..1: per channel, luma, and saturation.
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct Wheel {
    pub red: f32,
    pub green: f32,
    pub blue: f32,
    pub luma: f32,
    pub saturation: f32,
}

/// CapCut's primary colour wheels (lift / gamma / gain / offset), applied before the
/// Adjust sliders. `intensity` 0 turns them off.
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct Wheels {
    pub lift: Wheel,
    pub gamma: Wheel,
    pub gain: Wheel,
    pub offset: Wheel,
    pub intensity: f32,
}

impl Wheels {
    fn is_identity(&self) -> bool {
        self.intensity.abs() <= 1e-5 || *self == Wheels { intensity: self.intensity, ..Default::default() }
    }
}

/// One clip's colour grade, in CapCut's order: HSL, curves, the primary wheels, then the
/// Adjust sliders, each -1..1 (0 = off).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Adjust {
    /// CapCut's HSL ranges and tone curves (grade.rs), a pass of their own before the rest.
    pub hsl: Hsl,
    pub curves: Option<Arc<Curves>>,
    pub wheels: Wheels,
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub temperature: f32,
    pub tint: f32,
    pub exposure: f32,
    /// CapCut's Fade slider (0..1): a mix towards its faded lookup table, between temperature
    /// and exposure.
    pub fade: f32,
    /// CapCut's Sharpen slider (0..1), a separate pass after the others.
    pub sharpen: f32,
    /// CapCut's Clarity and Vignette sliders (grade.rs), passes of their own after Sharpen:
    /// clarity 0..1, vignette -1..1 (below 0 it lightens the edges).
    pub clarity: f32,
    pub vignette: f32,
}

/// CapCut's exposure lookup tables (17 grids of 17x17, side by side: 289x17), its fade table
/// (same layout) when the bundle has one, and a key that identifies them for the GPU cache.
#[derive(Clone, Debug)]
pub struct ExposureLuts {
    pub key: u64,
    pub darker: Arc<RgbaImage>,
    pub brighter: Arc<RgbaImage>,
    pub fade: Option<Arc<RgbaImage>>,
}

impl Adjust {
    pub fn is_identity(&self) -> bool {
        self.sliders_identity() && self.colour_identity() && self.finish_identity()
    }

    /// Whether clarity and the vignette leave the picture as it is.
    pub(crate) fn finish_identity(&self) -> bool {
        self.clarity.abs() <= 1e-5 && self.vignette.abs() <= 1e-5
    }

    /// Whether the HSL and curves pass leaves the picture as it is.
    pub(crate) fn colour_identity(&self) -> bool {
        self.hsl.is_identity() && self.curves.as_ref().is_none_or(|c| c.is_identity())
    }

    /// Whether the Adjust pass and Sharpen (the wheels and sliders) leave the picture as it is.
    pub(crate) fn sliders_identity(&self) -> bool {
        let e = 1e-5;
        self.wheels.is_identity() && self.sharpen.abs() <= e && [self.brightness, self.contrast, self.saturation, self.highlights, self.shadows, self.whites, self.blacks, self.temperature, self.tint, self.exposure, self.fade].iter().all(|v| v.abs() <= e)
    }

    /// The shader's parameters (see `fs_adjust` in adjust.wgsl), with the exposure tables
    /// and the fade table there or not.
    pub(crate) fn params(&self, has_lut: bool, has_fade: bool) -> AdjustParams {
        let on = |v: f32| (v.abs() > 1e-5) as u8 as f32;
        let c = |v: f32| v.clamp(-1.0, 1.0) as f64;
        let mut p = AdjustParams { tt_r: [1.0, 0.0, 0.0, 0.0], tt_g: [0.0, 1.0, 0.0, 0.0], tt_b: [0.0, 0.0, 1.0, 0.0], ..Default::default() };
        // Temperature and tint: a white-point change (Bradford adaptation), applied to the
        // encoded values as CapCut does.
        let tt = on(self.temperature).max(on(self.tint));
        if tt > 0.0 {
            let m = temperature_tint_matrix(c(self.temperature), c(self.tint));
            p.tt_r = [m[0][0] as f32, m[0][1] as f32, m[0][2] as f32, 0.0];
            p.tt_g = [m[1][0] as f32, m[1][1] as f32, m[1][2] as f32, 0.0];
            p.tt_b = [m[2][0] as f32, m[2][1] as f32, m[2][2] as f32, 0.0];
        }
        let saturation = c(self.saturation) + 1.0;
        let b = c(self.brightness);
        let brightness = if b > 0.0 && b <= 0.7 { 0.3 * b } else if b > 0.7 { 0.6333 * b - 0.2333 } else { b };
        let (contrast, x_factor, left, right, left_slope, right_slope, pivot_slope) = contrast_params(c(self.contrast));
        let poly = |p: f64, s: f64| 1.0 + s * 0.503 * p + 0.183 * p * p + s * 0.147 * p * p * p + 0.067 * p.powi(4);
        let (bw_slope, bw_bias) = black_white(c(self.blacks), c(self.whites));
        p.a = [saturation as f32, brightness as f32, contrast as f32, CONTRAST_PIVOT as f32];
        p.b = [x_factor as f32, left as f32, right as f32, left_slope as f32];
        p.c = [right_slope as f32, pivot_slope as f32, poly(c(self.highlights), 1.0) as f32, poly(c(self.shadows), -1.0) as f32];
        // Sharpen: CapCut's `sharpness` (1.6 x slider) times its white/black gain (0.5).
        p.d = [bw_slope as f32, bw_bias as f32, c(self.exposure) as f32, 0.8 * self.sharpen.clamp(0.0, 1.0)];
        p.on1 = [tt, on(self.saturation), on(self.brightness), on(self.contrast)];
        if !self.wheels.is_identity() {
            // CapCut's slider-to-shader mapping for the primary wheels.
            let w = &self.wheels;
            let c = |v: f32| v.clamp(-1.0, 1.0);
            let lift = |v: f32| if c(v) > 0.0 { c(v) * 0.5 } else { c(v) };
            let gamma = |v: f32| if c(v) < 0.0 { 1.0 - c(v) * 4.0 } else { 1.0 / (1.0 + c(v) * 4.0) };
            let gamma_s = |v: f32| if c(v) < 0.0 { 1.0 - c(v) * 4.0 } else { 1.0 / (1.0 + c(v) * c(v) * 4.0) };
            let gain = |v: f32, k: f32| if c(v) < 0.0 { 1.0 + c(v) * 0.999 } else { 1.0 + c(v) * c(v) * k };
            p.w_lift = [lift(w.lift.red), lift(w.lift.green), lift(w.lift.blue), lift(w.lift.luma)];
            p.w_gamma = [gamma(w.gamma.red), gamma(w.gamma.green), gamma(w.gamma.blue), gamma(w.gamma.luma)];
            p.w_gain = [gain(w.gain.red, 4.0), gain(w.gain.green, 4.0), gain(w.gain.blue, 4.0), gain(w.gain.luma, 4.0)];
            p.w_offset = [c(w.offset.red), c(w.offset.green), c(w.offset.blue), c(w.offset.saturation)];
            p.w_sat = [c(w.lift.saturation) * 0.5, gamma_s(w.gamma.saturation), gain(w.gain.saturation, 2.0), 1.0];
            p.w_on = [c(w.intensity), 1.0, 0.0, 0.0];
        }
        p.on2 = [on(self.highlights), on(self.shadows), on(self.blacks).max(on(self.whites)), on(self.exposure) * has_lut as u8 as f32];
        p.fade = [self.fade.clamp(0.0, 1.0), on(self.fade) * has_fade as u8 as f32, 0.0, 0.0];
        p
    }
}

impl Adjust {
    /// One straight (not premultiplied) colour, encoded 0–1, through the Adjust sliders as
    /// `fs_adjust` draws them: brightness, contrast, saturation, highlights, shadows, whites
    /// and blacks, temperature and tint, each clamped as the shader clamps it. A CPU
    /// reference for analysis (Auto adjust solves against it) and tests. Left out: the
    /// primary wheels, exposure and fade (lookup tables), Sharpen, clarity and the vignette
    /// (neighbourhood passes), HSL and curves (grade.rs).
    pub fn apply_rgb(&self, rgb: [f32; 3]) -> [f32; 3] {
        let p = self.params(false, false);
        let clamp = |c: [f32; 3]| c.map(|v| v.clamp(0.0, 1.0));
        let mut c = clamp(rgb);
        if p.on1[2] > 0.5 {
            let b = p.a[1];
            let mut e = 1.0 + b * 5.0;
            if b <= 0.0 {
                e = 1.0 / (1.0 - b * 2.5);
                c = c.map(|v| v + b * 0.01);
            }
            c = clamp(c.map(|v| 1.0 - (1.0 - v).max(0.0).powf(e)));
        }
        if p.on1[3] > 0.5 {
            let pivot = p.a[3];
            if p.a[2] <= 1.0 {
                c = c.map(|v| p.a[2] * (v - pivot) + pivot);
            } else {
                c = c.map(|x| {
                    let s = 1.0 / (1.0 + (-p.b[0] * (x - pivot)).exp());
                    let y = s + pivot - 0.5;
                    let k = p.b[0] * s * (1.0 - s);
                    if x <= pivot {
                        let t = (p.c[1] - k) / p.b[3];
                        y + t * t * p.b[1]
                    } else {
                        let t = (p.c[1] - k) / p.c[0];
                        y + t * t * p.b[2]
                    }
                });
            }
            c = clamp(c);
        }
        if p.on1[1] > 0.5 {
            const LUMA: [f32; 3] = [0.208_54, 0.702_086, 0.089_374];
            let s = p.a[0];
            let l = (c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]) * (1.0 - s);
            c = clamp(c.map(|v| l + s * v));
        }
        if p.on2[0] > 0.5 {
            let e = p.c[2];
            c = clamp(c.map(|v| {
                let t = 1.0 - v;
                1.0 - t.max(0.0).powf(e) - (e - 1.0) * (t * t - t * t * t)
            }));
        }
        if p.on2[1] > 0.5 {
            let e = p.c[3];
            c = clamp(c.map(|v| v.max(0.0).powf(e) + (e - 1.0) * (v * v - v * v * v)));
        }
        if p.on2[2] > 0.5 {
            c = clamp(c.map(|v| p.d[0] * v + p.d[1]));
        }
        if p.on1[0] > 0.5 {
            let dot = |m: [f32; 4]| m[0] * c[0] + m[1] * c[1] + m[2] * c[2];
            c = clamp([dot(p.tt_r), dot(p.tt_g), dot(p.tt_b)]);
        }
        c
    }
}

const CONTRAST_PIVOT: f64 = 0.435;

#[repr(C)]
#[derive(Copy, Clone, Debug, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct AdjustParams {
    tt_r: [f32; 4],
    tt_g: [f32; 4],
    tt_b: [f32; 4],
    /// saturation, brightness, contrast, contrast pivot
    a: [f32; 4],
    /// contrast: sigmoid steepness, left/right end corrections, left slope difference
    b: [f32; 4],
    /// contrast: right slope difference, slope at the pivot; highlight and shadow exponents
    c: [f32; 4],
    /// black/white slope and bias, exposure, sharpen amount
    d: [f32; 4],
    /// enables: temperature/tint, saturation, brightness, contrast
    on1: [f32; 4],
    /// enables: highlights, shadows, black/white, exposure
    on2: [f32; 4],
    /// Primary wheels: lift, gamma and gain for (R, G, B, luma); offset (R, G, B,
    /// saturation); saturation wheel (lift, gamma, gain) and luma mix; intensity, enable.
    w_lift: [f32; 4],
    w_gamma: [f32; 4],
    w_gain: [f32; 4],
    w_offset: [f32; 4],
    w_sat: [f32; 4],
    w_on: [f32; 4],
    /// Fade: amount, enabled.
    fade: [f32; 4],
}

/// Contrast: below 0 a straight line through the pivot; above, a sigmoid through the pivot
/// bent at both ends so 0 and 1 stay put.
fn contrast_params(intensity: f64) -> (f64, f64, f64, f64, f64, f64, f64) {
    let p = if intensity <= 0.0 { intensity * 0.4 + 1.0 } else { intensity * 0.6 + 1.0 };
    let a = (8.33 * p - 12.16).exp() + 5.82 * p - 1.72;
    let sig = |x: f64| {
        let s = 1.0 / (1.0 + (-a * (x - CONTRAST_PIVOT)).exp());
        (s + CONTRAST_PIVOT - 0.5, a * s * (1.0 - s))
    };
    let ((lv, ls), (rv, rs), (_, ps)) = (sig(0.0), sig(1.0), sig(CONTRAST_PIVOT));
    (p, a, -lv, 1.0 - rv, ps - ls, ps - rs, ps)
}

/// Black and white points as a straight line: whites move the white point left (or down),
/// blacks move the black point up (or right), by up to half the range.
fn black_white(black: f64, white: f64) -> (f64, f64) {
    let (mut xw, mut yw) = if white >= 0.0 { (1.0 - white * 0.5, 1.0) } else { (1.0, 1.0 + white * 0.5) };
    let (mut xb, mut yb) = if black >= 0.0 { (0.0, black * 0.5) } else { (-black * 0.5, 0.0) };
    let eps = 0.005;
    xw = xw.max(eps);
    yw = yw.max(eps);
    xb = xb.min(xw - eps);
    yb = yb.min(yw - eps);
    let slope = (yw - yb) / (xw - xb);
    (slope, yb - slope * xb)
}

/// Planckian locus in CIE 1960 UCS: (mired, u, v, slope of the isotemperature line).
const LOCUS: [[f64; 4]; 31] = [
    [0.0, 0.18006, 0.26352, -0.24341],
    [10.0, 0.18066, 0.26589, -0.25479],
    [20.0, 0.18133, 0.26846, -0.26876],
    [30.0, 0.18208, 0.27119, -0.28539],
    [40.0, 0.18293, 0.27407, -0.30470],
    [50.0, 0.18388, 0.27709, -0.32675],
    [60.0, 0.18494, 0.28021, -0.35156],
    [70.0, 0.18611, 0.28342, -0.37915],
    [80.0, 0.18740, 0.28668, -0.40955],
    [90.0, 0.18880, 0.28997, -0.44278],
    [100.0, 0.19032, 0.29326, -0.47888],
    [125.0, 0.19462, 0.30141, -0.58204],
    [150.0, 0.19962, 0.30921, -0.70471],
    [175.0, 0.20525, 0.31647, -0.84901],
    [200.0, 0.21142, 0.32312, -1.0182],
    [225.0, 0.21807, 0.32909, -1.2168],
    [250.0, 0.22511, 0.33439, -1.4512],
    [275.0, 0.23247, 0.33904, -1.7298],
    [300.0, 0.24010, 0.34308, -2.0637],
    [325.0, 0.24792, 0.34655, -2.4681],
    [350.0, 0.25591, 0.34951, -2.9641],
    [375.0, 0.26400, 0.35200, -3.5814],
    [400.0, 0.27218, 0.35407, -4.3633],
    [425.0, 0.28039, 0.35577, -5.3762],
    [450.0, 0.28863, 0.35714, -6.7262],
    [475.0, 0.29685, 0.35823, -8.5955],
    [500.0, 0.30505, 0.35907, -11.324],
    [525.0, 0.31320, 0.35968, -15.628],
    [550.0, 0.32129, 0.36011, -23.325],
    [575.0, 0.32931, 0.36038, -40.770],
    [600.0, 0.33724, 0.36051, -116.45],
];

/// The white point (as XYZ with Y = 1) of a colour temperature (K) shifted by a tint along
/// the isotemperature line.
fn white_point(kelvin: f64, tint: f64) -> [f64; 3] {
    let mired = 1e6 / kelvin;
    let offset = tint * 1e-4;
    // The locus entry just past `mired` (or the last one), and the one before it.
    let hi = (1..LOCUS.len()).find(|&i| LOCUS[i][0] > mired).unwrap_or(LOCUS.len() - 1);
    let (p0, p1) = (LOCUS[hi - 1], LOCUS[hi]);
    let f = (p1[0] - mired) / (p1[0] - p0[0]);
    let mix = |x: f64, y: f64, a: f64| x * (1.0 - a) + y * a;
    let (mut u, mut v) = (mix(p1[1], p0[1], f), mix(p1[2], p0[2], f));
    // Step along the (interpolated) isotemperature line's normal by the tint.
    let (sa, sb) = ((p0[3] * p0[3] + 1.0).sqrt(), (p1[3] * p1[3] + 1.0).sqrt());
    let (du, dv) = (mix(1.0 / sb, 1.0 / sa, f), mix(p1[3] / sb, p0[3] / sa, f));
    let len = (du * du + dv * dv).sqrt();
    u += offset * du / len;
    v += offset * dv / len;
    // UCS (u, v) to chromaticity (x, y).
    let d = -4.0 * v + u + 2.0;
    let (mut x, mut y) = ((u * 1.5 / d).clamp(1e-6, 0.999_999), (v / d).clamp(1e-6, 0.999_999));
    if x + y > 0.999_999 {
        // (CapCut divides by the reciprocal here, scaling up; kept for parity.)
        let t = 0.999_999 / (x + y);
        x /= t;
        y /= t;
    }
    [x / y, 1.0, (1.0 - x - y) / y]
}

type M3 = [[f64; 3]; 3];

#[allow(clippy::needless_range_loop)]
fn mul(a: &M3, b: &M3) -> M3 {
    let mut m = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    m
}

fn apply(m: &M3, v: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|i| m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2])
}

/// RGB -> RGB matrix for a temperature/tint slider pair: adapt from 6500 K (tint 0) to the
/// slider's white point with the Bradford transform, in BT.709/sRGB primaries.
fn temperature_tint_matrix(temperature: f64, tint: f64) -> M3 {
    let kelvin = 6500.0 - 1970.0 * temperature + 876.0 * temperature.powi(2) - 2630.0 * temperature.powi(3);
    const BRADFORD: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
    // CapCut's (rounded) inverse of the Bradford matrix.
    const BRADFORD_INV: M3 = [[0.987, -0.1471, 0.16], [0.4323, 0.5184, 0.0493], [-0.0085, 0.04, 0.9685]];
    const RGB_TO_XYZ: M3 = [[0.4123907992659595, 0.357584339383878, 0.1804807884018343], [0.21263900587151036, 0.715168678767756, 0.07219231536073371], [0.019330818715591832, 0.11919477979462598, 0.9505321522496607]];
    const XYZ_TO_RGB: M3 = [[3.2409699419045213, -1.5373831775700935, -0.4986107602930033], [-0.9692436362808796, 1.8759675015077208, 0.04155505740717562], [0.05563007969699364, -0.20397695888897655, 1.0569715142428784]];
    let target = apply(&BRADFORD, white_point(kelvin, tint * 100.0));
    let base = apply(&BRADFORD, white_point(6500.0, 0.0));
    let scale: M3 = [[target[0] / base[0], 0.0, 0.0], [0.0, target[1] / base[1], 0.0], [0.0, 0.0, target[2] / base[2]]];
    mul(&XYZ_TO_RGB, &mul(&BRADFORD_INV, &mul(&mul(&scale, &BRADFORD), &RGB_TO_XYZ)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[allow(clippy::needless_range_loop)]
    fn neutral_temperature_is_identity_and_warm_raises_red() {
        let m = temperature_tint_matrix(0.0, 0.0);
        for i in 0..3 {
            for j in 0..3 {
                let want = (i == j) as u8 as f64;
                // CapCut's rounded inverse Bradford leaves a small residue.
                assert!((m[i][j] - want).abs() < 0.01, "{i}{j}: {}", m[i][j]);
            }
        }
        let warm = apply(&temperature_tint_matrix(1.0, 0.0), [0.5, 0.5, 0.5]);
        assert!(warm[0] > 0.5 && warm[2] < 0.5, "{warm:?}");
    }

    #[test]
    fn contrast_curve_keeps_the_ends() {
        let (p, a, l, r, ls, rs, ps) = contrast_params(1.0);
        assert!(p > 1.0);
        let f = |x: f64| {
            let s = 1.0 / (1.0 + (-a * (x - CONTRAST_PIVOT)).exp());
            let (y, k) = (s + CONTRAST_PIVOT - 0.5, a * s * (1.0 - s));
            if x <= CONTRAST_PIVOT { y + ((ps - k) / ls).powi(2) * l } else { y + ((ps - k) / rs).powi(2) * r }
        };
        assert!(f(0.0).abs() < 1e-9 && (f(1.0) - 1.0).abs() < 1e-9 && (f(CONTRAST_PIVOT) - CONTRAST_PIVOT).abs() < 1e-9);
    }
}
