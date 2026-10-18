//! Fitting a motion to point matches: least-squares similarity (translation, uniform scale
//! and rotation) and affine transforms, and RANSAC around them so a few bad matches (points
//! on the background, or ones the tracker lost) don't pull the fit.

/// x' = a·x − b·y + tx, y' = b·x + a·y + ty: a uniform scale √(a² + b²) and a rotation
/// atan2(b, a) (radians, from +x toward +y), then a translation.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Similarity {
    pub a: f64,
    pub b: f64,
    pub tx: f64,
    pub ty: f64,
}

impl Similarity {
    pub const IDENTITY: Similarity = Similarity { a: 1.0, b: 0.0, tx: 0.0, ty: 0.0 };

    /// Scale by `scale` and turn by `rotation` (radians) about `center`, then move by `shift`.
    pub fn about(center: [f64; 2], scale: f64, rotation: f64, shift: [f64; 2]) -> Similarity {
        let (s, c) = rotation.sin_cos();
        let (a, b) = (scale * c, scale * s);
        // p' = R(p − c) + c + shift
        Similarity { a, b, tx: center[0] - (a * center[0] - b * center[1]) + shift[0], ty: center[1] - (b * center[0] + a * center[1]) + shift[1] }
    }

    #[inline]
    pub fn apply(&self, p: [f64; 2]) -> [f64; 2] {
        [self.a * p[0] - self.b * p[1] + self.tx, self.b * p[0] + self.a * p[1] + self.ty]
    }

    pub fn scale(&self) -> f64 {
        self.a.hypot(self.b)
    }

    /// Radians, from +x toward +y (clockwise on screen, where y points down).
    pub fn rotation(&self) -> f64 {
        self.b.atan2(self.a)
    }

    /// `self` after `first`: p ↦ self(first(p)).
    pub fn after(&self, first: &Similarity) -> Similarity {
        Similarity {
            a: self.a * first.a - self.b * first.b,
            b: self.b * first.a + self.a * first.b,
            tx: self.a * first.tx - self.b * first.ty + self.tx,
            ty: self.b * first.tx + self.a * first.ty + self.ty,
        }
    }

    pub fn inverse(&self) -> Similarity {
        let d = self.a * self.a + self.b * self.b;
        let (a, b) = (self.a / d, -self.b / d);
        Similarity { a, b, tx: -(a * self.tx - b * self.ty), ty: -(b * self.tx + a * self.ty) }
    }
}

/// x' = m[0]·(x, y, 1), y' = m[1]·(x, y, 1).
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Affine {
    pub m: [[f64; 3]; 2],
}

impl Affine {
    #[inline]
    pub fn apply(&self, p: [f64; 2]) -> [f64; 2] {
        [self.m[0][0] * p[0] + self.m[0][1] * p[1] + self.m[0][2], self.m[1][0] * p[0] + self.m[1][1] * p[1] + self.m[1][2]]
    }

    /// The closest similarity (its uniform part): for reporting a scale and a rotation.
    pub fn similarity(&self) -> Similarity {
        let a = 0.5 * (self.m[0][0] + self.m[1][1]);
        let b = 0.5 * (self.m[1][0] - self.m[0][1]);
        Similarity { a, b, tx: self.m[0][2], ty: self.m[1][2] }
    }
}

/// The least-squares similarity taking `src` to `dst` (Umeyama's closed form, optionally
/// weighted). `None` with fewer than two distinct points.
pub fn fit_similarity(src: &[[f64; 2]], dst: &[[f64; 2]], weights: Option<&[f64]>) -> Option<Similarity> {
    let n = src.len().min(dst.len());
    if n < 2 {
        return None;
    }
    let w = |i: usize| weights.map_or(1.0, |w| w[i]);
    let total: f64 = (0..n).map(w).sum();
    if total <= 0.0 {
        return None;
    }
    let mut ms = [0.0; 2];
    let mut md = [0.0; 2];
    for i in 0..n {
        for k in 0..2 {
            ms[k] += w(i) * src[i][k];
            md[k] += w(i) * dst[i][k];
        }
    }
    ms = [ms[0] / total, ms[1] / total];
    md = [md[0] / total, md[1] / total];
    let (mut num_a, mut num_b, mut den) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (x, y) = (src[i][0] - ms[0], src[i][1] - ms[1]);
        let (u, v) = (dst[i][0] - md[0], dst[i][1] - md[1]);
        num_a += w(i) * (x * u + y * v);
        num_b += w(i) * (x * v - y * u);
        den += w(i) * (x * x + y * y);
    }
    if den < 1e-12 {
        return None;
    }
    let (a, b) = (num_a / den, num_b / den);
    Some(Similarity { a, b, tx: md[0] - (a * ms[0] - b * ms[1]), ty: md[1] - (b * ms[0] + a * ms[1]) })
}

/// The least-squares affine transform taking `src` to `dst`. `None` with fewer than three
/// points not on a line.
#[allow(clippy::needless_range_loop)]
pub fn fit_affine(src: &[[f64; 2]], dst: &[[f64; 2]]) -> Option<Affine> {
    let n = src.len().min(dst.len());
    if n < 3 {
        return None;
    }
    // Normal equations: (Σ p pᵀ) m_k = Σ p d_k with p = (x, y, 1).
    let mut ata = [[0.0f64; 3]; 3];
    let mut atb = [[0.0f64; 3]; 2];
    for i in 0..n {
        let p = [src[i][0], src[i][1], 1.0];
        for r in 0..3 {
            for c in 0..3 {
                ata[r][c] += p[r] * p[c];
            }
            atb[0][r] += p[r] * dst[i][0];
            atb[1][r] += p[r] * dst[i][1];
        }
    }
    let inv = invert3(&ata)?;
    let mut m = [[0.0; 3]; 2];
    for k in 0..2 {
        for r in 0..3 {
            m[k][r] = (0..3).map(|c| inv[r][c] * atb[k][c]).sum();
        }
    }
    Some(Affine { m })
}

#[allow(clippy::needless_range_loop)]
fn invert3(m: &[[f64; 3]; 3]) -> Option<[[f64; 3]; 3]> {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if det.abs() < 1e-12 {
        return None;
    }
    let mut out = [[0.0; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            let (r1, r2) = ((c + 1) % 3, (c + 2) % 3);
            let (c1, c2) = ((r + 1) % 3, (r + 2) % 3);
            out[r][c] = (m[r1][c1] * m[r2][c2] - m[r1][c2] * m[r2][c1]) / det;
        }
    }
    Some(out)
}

/// A small, deterministic pseudo-random generator (xorshift64*), so fits are repeatable.
#[derive(Clone, Debug)]
pub struct Rng(pub u64);

impl Rng {
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0.max(1);
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform in 0…1.
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n.max(1) as u64) as usize
    }
}

/// RANSAC's settings.
#[derive(Copy, Clone, Debug)]
pub struct Ransac {
    pub iterations: usize,
    /// A match is an inlier when the model puts its source within this many pixels of its
    /// destination.
    pub threshold: f64,
    pub seed: u64,
}

impl Default for Ransac {
    fn default() -> Self {
        Ransac { iterations: 200, threshold: 1.5, seed: 0x5eed }
    }
}

/// The similarity most matches agree with (RANSAC on pairs of matches, then a least-squares
/// fit to the inliers, repeated once on the refit's own inliers), with which matches are
/// inliers. `None` with fewer than two matches.
pub fn ransac_similarity(src: &[[f64; 2]], dst: &[[f64; 2]], o: &Ransac) -> Option<(Similarity, Vec<bool>)> {
    let n = src.len().min(dst.len());
    if n < 2 {
        return None;
    }
    let inliers_of = |s: &Similarity| -> Vec<bool> {
        (0..n)
            .map(|i| {
                let p = s.apply(src[i]);
                (p[0] - dst[i][0]).hypot(p[1] - dst[i][1]) <= o.threshold
            })
            .collect()
    };
    let mut rng = Rng(o.seed);
    let mut best: Option<(usize, Similarity)> = None;
    let tries = if n == 2 { 1 } else { o.iterations };
    for _ in 0..tries {
        let i = rng.below(n);
        let mut j = rng.below(n);
        if j == i {
            j = (i + 1) % n;
        }
        let Some(s) = fit_similarity(&[src[i], src[j]], &[dst[i], dst[j]], None) else { continue };
        let count = inliers_of(&s).iter().filter(|&&b| b).count();
        if best.as_ref().is_none_or(|(c, _)| count > *c) {
            best = Some((count, s));
            if count == n {
                break;
            }
        }
    }
    let (_, mut model) = best?;
    let mut inliers = inliers_of(&model);
    for _ in 0..2 {
        let (s, d): (Vec<_>, Vec<_>) = (0..n).filter(|&i| inliers[i]).map(|i| (src[i], dst[i])).unzip();
        match fit_similarity(&s, &d, None) {
            Some(refit) => {
                model = refit;
                inliers = inliers_of(&model);
            }
            None => break,
        }
    }
    Some((model, inliers))
}

/// Like [`ransac_similarity`] for an affine transform (triples of matches).
pub fn ransac_affine(src: &[[f64; 2]], dst: &[[f64; 2]], o: &Ransac) -> Option<(Affine, Vec<bool>)> {
    let n = src.len().min(dst.len());
    if n < 3 {
        return None;
    }
    let inliers_of = |m: &Affine| -> Vec<bool> {
        (0..n)
            .map(|i| {
                let p = m.apply(src[i]);
                (p[0] - dst[i][0]).hypot(p[1] - dst[i][1]) <= o.threshold
            })
            .collect()
    };
    let mut rng = Rng(o.seed);
    let mut best: Option<(usize, Affine)> = None;
    for _ in 0..o.iterations {
        let (i, j, k) = (rng.below(n), rng.below(n), rng.below(n));
        if i == j || j == k || i == k {
            continue;
        }
        let Some(m) = fit_affine(&[src[i], src[j], src[k]], &[dst[i], dst[j], dst[k]]) else { continue };
        let count = inliers_of(&m).iter().filter(|&&b| b).count();
        if best.as_ref().is_none_or(|(c, _)| count > *c) {
            best = Some((count, m));
        }
    }
    let (_, mut model) = best?;
    let mut inliers = inliers_of(&model);
    for _ in 0..2 {
        let (s, d): (Vec<_>, Vec<_>) = (0..n).filter(|&i| inliers[i]).map(|i| (src[i], dst[i])).unzip();
        match fit_affine(&s, &d) {
            Some(refit) => {
                model = refit;
                inliers = inliers_of(&model);
            }
            None => break,
        }
    }
    Some((model, inliers))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ransac_recovers_a_similarity_despite_outliers() {
        let truth = Similarity::about([50.0, 40.0], 1.25, 0.3, [7.0, -3.0]);
        let mut rng = Rng(3);
        let src: Vec<[f64; 2]> = (0..60).map(|_| [rng.unit() * 100.0, rng.unit() * 80.0]).collect();
        let mut dst: Vec<[f64; 2]> = src.iter().map(|p| truth.apply(*p)).collect();
        for d in dst.iter_mut().take(20) {
            *d = [rng.unit() * 100.0, rng.unit() * 80.0];
        }
        let (fit, inliers) = ransac_similarity(&src, &dst, &Ransac::default()).unwrap();
        assert!((fit.scale() - 1.25).abs() < 1e-9 && (fit.rotation() - 0.3).abs() < 1e-9, "{fit:?}");
        assert_eq!(inliers.iter().filter(|&&b| b).count(), 40);
        let c = fit.apply([50.0, 40.0]);
        assert!((c[0] - 57.0).abs() < 1e-9 && (c[1] - 37.0).abs() < 1e-9);
        // Composition and inverse.
        let back = fit.inverse().after(&fit);
        assert!((back.a - 1.0).abs() < 1e-12 && back.b.abs() < 1e-12 && back.tx.abs() < 1e-9);
        let affine = Affine { m: [[fit.a, -fit.b, fit.tx], [fit.b, fit.a, fit.ty]] };
        let (af, _) = ransac_affine(&src, &dst, &Ransac::default()).unwrap();
        for k in 0..2 {
            for c in 0..3 {
                assert!((af.m[k][c] - affine.m[k][c]).abs() < 1e-6);
            }
        }
    }
}
