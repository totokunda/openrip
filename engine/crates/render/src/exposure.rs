//! OpenRip's own curves for CapCut's Exposure and Fade sliders, for clips that have no CapCut
//! colour bundle behind them (the app's own). A draft's clips read the tables in the bundle the
//! draft points at (`ExposureLuts` from its files); nothing here reads or ships CapCut's.
//!
//! CapCut's sliders mix a picture towards a lookup table: exposure towards a brighter or a
//! darker one by the slider's size, fade towards a faded one (adjust.wgsl). These are formulas
//! of our own fitted to what those tables do to colours (least squares, weighted towards colours
//! from real footage, through the clamp the tables hit), and the tables OpenRip draws with are
//! generated from them (docs/parity/colour.md has how close they come):
//!
//! - **Fade:** one curve for every channel, a polynomial in the channel's level.
//! - **Exposure:** per output channel, a curve in the input's mean level L (what a grey gets),
//!   plus colour terms: products of L, u = r − g and v = b − g of degree 1 to 4 with u or v in
//!   them, so they vanish on grey. Clamped to 0–1, as the tables are.
//!
//! Curves are in Bernstein form (their coefficients read like the curve's control values).

use std::sync::{Arc, OnceLock};

use crate::adjust::ExposureLuts;
use crate::RgbaImage;

/// One end of the exposure slider: per output channel, the grey curve's Bernstein coefficients
/// (degree 11) and the colour terms' weights, in [`colour_terms`] order.
struct Fitted {
    grey: [[f64; 12]; 3],
    colour: [[f64; 30]; 3],
}

/// Fade: one curve for every channel (Bernstein coefficients, degree 9).
const FADE: [f64; 10] = [0.2705941475, 0.2974425767, 0.2790375343, 0.3893290291, 0.4254904811, 0.4755376875, 0.7548553058, 0.7120900785, 0.818696818, 0.8548224631];

/// The exposure slider's brighter end.
const BRIGHTER: Fitted = Fitted {
    grey: [
        [0.02662480822, 0.4331816805, -0.548283991, 2.746503543, -2.941813699, 5.106640037, -3.227014596, 3.64853499, -0.5388465954, 1.341655081, 0.9280577603, 0.9840999493],
        [0.0439901988, 0.41878169, -0.593317843, 2.866292126, -3.029221408, 4.947782893, -2.769288728, 3.098637237, -0.153405201, 1.17741142, 0.9649414511, 0.9893913363],
        [0.02682706741, 0.3095379275, -0.08400729586, 1.649306382, -1.120425143, 2.83253929, -1.06940314, 2.10019053, 0.260441837, 1.078260419, 0.9693544024, 0.988813665],
    ],
    colour: [
        [1.44325739, -0.6733081072, 0.3247658857, 0.2439634084, 1.48603628, -0.6162591001, 0.107013797, -3.426791747, 1.700133011, -5.382874046, 3.378960957, -0.9961461042, -0.4776121863, 1.226491302, -0.2112406631, -0.03652748167, 2.09670835, -1.632321197, 3.361895792, -2.34457874, 1.046470753, -0.4887461002, -0.8675411593, -0.06416873194, 0.07460916661, -0.1909792846, 0.200792258, 0.1662978275, -0.09409859697, 0.0310682765],
        [-0.6981097101, -0.7586250571, -0.04927592997, 0.9085295941, 0.4559159477, -0.1047257754, 0.07685712934, 1.386987083, 0.09391200478, -2.100838679, 0.1535582, -0.8854159328, -0.1899064775, 0.4187145463, 0.1789379595, -0.001596567511, -0.8563707659, -0.447433756, 1.843488134, -0.6123147406, 0.9634748686, 0.5936600449, -0.6349680812, -0.08392388062, 0.01137597412, 0.08608414136, -0.1799071643, 0.1275608173, -0.07656853442, 0.02325433635],
        [-0.749566603, 1.591444944, 0.4835699142, -0.6825343025, 0.4680756606, -0.655325738, 1.098499932, -0.04037418357, 0.4571381822, -1.938321834, 1.211709195, -2.218920129, -0.2478186645, 0.7674539574, -0.0586213368, 0.2346786061, 0.2193016, -1.279720659, 1.653092145, 0.7367133281, -0.135060254, 0.7127552061, -2.751466571, 2.559109747, -2.400509282, 0.03556664995, 0.06506983503, -0.4992354473, 1.300018247, -0.7329876529],
    ],
};

/// Its darker end.
const DARKER: Fitted = Fitted {
    grey: [
        [0.0007457239933, 0.0987036689, 0.1036945347, 0.6035972541, -0.4520586681, 1.681653539, -0.7776308545, 1.440813246, 0.309770015, 0.5540691061, 0.9956905619, 0.9809603915],
        [-0.001496981286, 0.1330760098, -0.04528606245, 0.9526378508, -0.9882873555, 2.280600435, -1.288779481, 1.821304472, 0.04131367982, 0.7129268695, 0.9408688221, 0.979770844],
        [-0.001495118325, 0.1145174179, 0.05903041016, 0.6797464056, -0.5753872138, 1.877288997, -1.02549342, 1.665241378, 0.1415725439, 0.6639154956, 0.9534929969, 0.9817551395],
    ],
    colour: [
        [0.5946985985, -0.437184091, 0.1874337218, 0.2082473355, 0.6959943639, -0.1669772781, -0.02651062595, -0.2455417757, -0.1253348451, -1.354805784, -0.5991528682, -0.1716939212, -0.7156554419, 1.052893522, -0.5573400534, 0.1600109681, 1.006246994, -0.6790582298, -0.1815046219, 2.578830024, -0.6516342266, 0.9931106779, -2.373249481, 2.407183061, -0.9536582251, 0.06509599897, 0.3277273469, -0.934548823, 0.879425751, -0.1974120669],
        [-0.3839357208, -0.2104358202, -0.155557339, -0.7298506718, -0.05372542462, -0.1321441888, 0.3014919997, 0.4949589961, 1.454523901, 0.4192018827, 0.378206665, -1.011527783, 0.1658318195, 0.0734695177, 0.2522893148, 0.2360386988, -1.00822036, -1.531680973, -1.254974695, -0.7166970138, 0.4827128309, -0.7178354127, -0.3235287921, 0.1822769317, -0.3551736975, -0.167011777, 0.3428448255, -0.5436632674, 0.6898790194, 0.07558576898],
        [-0.306095248, 0.5280563131, -0.6192851989, 0.8783952365, 0.05980971034, 0.01089136015, 0.3095761056, 2.115886753, -2.096936102, 0.08766348907, -1.667025836, -0.1802019789, 0.09037300955, 0.1921396337, 0.2551615076, -0.6272062158, -2.358059975, 2.650815281, -0.9279047752, 3.685937651, -1.661233623, -0.9626932159, 1.899822408, -2.10361682, 1.515210722, -0.33666356, 1.300452605, -1.900876411, 1.090131916, -0.05511596631],
    ],
};

/// A polynomial given by its Bernstein coefficients, at `x` (de Casteljau).
fn bernstein(b: &[f64], x: f64) -> f64 {
    let mut p = b.to_vec();
    for k in (1..p.len()).rev() {
        for i in 0..k {
            p[i] = p[i] * (1.0 - x) + p[i + 1] * x;
        }
    }
    p[0]
}

/// The colour terms for an input: every product of (L, u, v) of degree 1 to 4, the factors'
/// indices non-decreasing and in lexicographic order, except L's own powers.
fn colour_terms(l: f64, u: f64, v: f64) -> [f64; 30] {
    let f = [l, u, v];
    let mut out = [0.0; 30];
    let mut n = 0;
    let mut push = |idx: &[usize]| {
        if idx.iter().all(|&i| i == 0) {
            return;
        }
        out[n] = idx.iter().map(|&i| f[i]).product();
        n += 1;
    };
    for i in 0..3 {
        push(&[i]);
    }
    for i in 0..3 {
        for j in i..3 {
            push(&[i, j]);
        }
    }
    for i in 0..3 {
        for j in i..3 {
            for k in j..3 {
                push(&[i, j, k]);
            }
        }
    }
    for i in 0..3 {
        for j in i..3 {
            for k in j..3 {
                for m in k..3 {
                    push(&[i, j, k, m]);
                }
            }
        }
    }
    out
}

impl Fitted {
    fn at(&self, [r, g, b]: [f64; 3]) -> [f64; 3] {
        let l = (r + g + b) / 3.0;
        let terms = colour_terms(l, r - g, b - g);
        std::array::from_fn(|c| (bernstein(&self.grey[c], l) + terms.iter().zip(&self.colour[c]).map(|(t, w)| t * w).sum::<f64>()).clamp(0.0, 1.0))
    }
}

/// A 17³ table in the Adjust pass's layout: 17 grids of 17×17 side by side (289×17), red
/// across, green down, blue picking the grid.
fn table(f: impl Fn([f64; 3]) -> [f64; 3]) -> RgbaImage {
    let mut data = vec![255u8; 289 * 17 * 4];
    for b in 0..17 {
        for g in 0..17 {
            for r in 0..17 {
                let out = f([r as f64 / 16.0, g as f64 / 16.0, b as f64 / 16.0]);
                let i = (g * 289 + b * 17 + r) * 4;
                for c in 0..3 {
                    data[i + c] = (out[c] * 255.0).round() as u8;
                }
            }
        }
    }
    RgbaImage { width: 289, height: 17, data }
}

/// The exposure and fade tables generated from OpenRip's curves, made once. Their key ("OPENRIP"
/// in ASCII) keeps them apart from any bundle's in the GPU cache.
pub fn fitted() -> &'static ExposureLuts {
    static TABLES: OnceLock<ExposureLuts> = OnceLock::new();
    TABLES.get_or_init(|| ExposureLuts {
        key: 0x4f50_454e_5249_5000,
        brighter: Arc::new(table(|c| BRIGHTER.at(c))),
        darker: Arc::new(table(|c| DARKER.at(c))),
        fade: Some(Arc::new(table(|c| c.map(|v| bernstein(&FADE, v).clamp(0.0, 1.0))))),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(img: &RgbaImage, [r, g, b]: [usize; 3]) -> [u8; 3] {
        let i = (g * 289 + b * 17 + r) * 4;
        [img.data[i], img.data[i + 1], img.data[i + 2]]
    }

    fn near(a: [u8; 3], b: [u8; 3], tolerance: i32) -> bool {
        a.iter().zip(b).all(|(x, y)| (*x as i32 - y as i32).abs() <= tolerance)
    }

    /// The generated tables have the layout the Adjust pass reads, a key whose lowest bit is
    /// free (the pass picks the brighter or darker table by it), and CapCut's behaviour where it
    /// shows most: the grey axis, and a few colours, within a few levels of what CapCut's own
    /// sliders give (those values read off its tables when fitting).
    #[test]
    fn the_tables_behave_as_capcuts_sliders() {
        let t = fitted();
        assert_eq!(t.key & 1, 0);
        for img in [&t.brighter, &t.darker, t.fade.as_ref().unwrap()] {
            assert_eq!((img.width, img.height), (289, 17));
            assert!(img.data.chunks_exact(4).all(|p| p[3] == 255));
        }
        let fade = t.fade.as_ref().unwrap();
        // Grey at 0, ¼, ½, ¾ and 1.
        for (i, brighter, darker, faded) in [(0, 7, 0, 69), (4, 121, 63, 86), (8, 190, 118, 128), (12, 225, 166, 182), (16, 251, 251, 218)] {
            assert!(near(entry(&t.brighter, [i, i, i]), [brighter; 3], 4), "brighter at {i}: {:?}", entry(&t.brighter, [i, i, i]));
            assert!(near(entry(&t.darker, [i, i, i]), [darker; 3], 4), "darker at {i}: {:?}", entry(&t.darker, [i, i, i]));
            assert!(near(entry(fade, [i, i, i]), [faded; 3], 1), "fade at {i}: {:?}", entry(fade, [i, i, i]));
        }
        // Colours: brighter lifts a dark red more than a grey of its level; fade is per channel.
        assert!(entry(&t.brighter, [4, 0, 0])[0] > entry(&t.brighter, [4, 4, 4])[0] + 20);
        assert_eq!(entry(fade, [16, 0, 8]), [entry(fade, [16, 16, 16])[0], entry(fade, [0, 0, 0])[0], entry(fade, [8, 8, 8])[0]]);
        // The grey curves rise.
        for img in [&t.brighter, &t.darker, fade] {
            let grey: Vec<u8> = (0..17).map(|i| entry(img, [i, i, i])[1]).collect();
            assert!(grey.windows(2).all(|w| w[1] as i32 + 1 >= w[0] as i32), "{grey:?}");
        }
    }

    /// Bernstein evaluation is the polynomial; the colour terms vanish on grey.
    #[test]
    fn bernstein_and_terms() {
        assert!((bernstein(&[0.0, 1.0], 0.3) - 0.3).abs() < 1e-12);
        assert!((bernstein(&[1.0, 0.0, 1.0], 0.5) - 0.5).abs() < 1e-12);
        assert!(colour_terms(0.7, 0.0, 0.0).iter().all(|t| *t == 0.0));
        assert_eq!(colour_terms(0.5, 0.25, 0.0)[0], 0.25);
    }
}
