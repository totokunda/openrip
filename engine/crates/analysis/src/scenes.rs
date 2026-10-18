//! Split scenes: where a run of frames changes shot, by classic shot boundary detection.
//!
//! Each frame is shrunk to about 4,000 pixels and described by its luma and chroma planes, a
//! luma histogram and a chroma histogram, and its edges (Sobel, thresholded). Two frames
//! differ by a score from three measures, each robust where another isn't:
//!
//! - the histograms' L1 distance (what colours are there, whatever moves);
//! - the edge change ratio (Zabih, Miller and Mai, 1995): the share of edges that appear or
//!   vanish, beyond a pixel's slack (lighting changes don't move edges);
//! - the mean luma difference (the plainest evidence of a different picture);
//!
//! the last two after the best global shift between the frames (a coarse-to-fine search),
//! so a pan or a tilt doesn't look like a change of shot.
//!
//! - **Hard cuts:** a neighbouring pair's score above an absolute floor and well above the
//!   median of the scores around it (an adaptive threshold: a handheld or busy shot raises its
//!   own baseline), the largest nearby, and not a flash (the frame before it like one just
//!   after).
//! - **Dissolves and fades:** scores between frames a span apart (0.2 to 1.6 s), peaking
//!   where a blend explains the change: the middle frame close to the mean of the span's ends
//!   (a cross-fade is that blend; a pan or someone walking isn't), and the ends different in
//!   structure (an exposure change keeps its edges). The cut goes where the blend is half way.
//! - **Through black or white:** a run of blank frames between two shots is one boundary, in
//!   its middle (or one at each end when the run is long enough to be a scene of its own); a
//!   fade out and back in through a dark frame is one boundary at the darkest frame.
//!
//! Boundaries closer together than the shortest scene keep the clearest; none falls in the
//! first or last shortest scene of the run.
//!
//! Frames are pushed one at a time and only a short window of them is kept, so a long file
//! costs no more memory than a short one.

use std::collections::VecDeque;

/// How the detector reads its frames.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SceneOptions {
    /// The frames' rate, for the windows measured in time.
    pub fps: f64,
    /// 0 (only clear changes) to 1 (subtle ones too).
    pub sensitivity: f32,
    /// The shortest scene kept, seconds.
    pub min_scene: f64,
}

impl Default for SceneOptions {
    fn default() -> Self {
        SceneOptions { fps: 30.0, sensitivity: 0.5, min_scene: 0.4 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CutKind {
    /// From one frame to the next.
    Hard,
    /// A cross-fade.
    Dissolve,
    /// Through black or white.
    Fade,
}

/// A change of shot.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SceneCut {
    /// The new scene's first frame, by its index among the frames pushed.
    pub frame: usize,
    /// That frame's time, as pushed.
    pub time: i64,
    pub kind: CutKind,
    /// The transition's first and last frames' times (both `time` for a hard cut).
    pub start: i64,
    pub end: i64,
    /// How different the shots are (the difference score, about 0–1).
    pub score: f32,
}

/// Pixels a frame is shrunk to.
const AREA: f64 = 4096.0;
const HIST_Y: usize = 16;
const HIST_C: usize = 6;
/// The chroma histogram's range for Cb and Cr (beyond it, the end bins).
const CHROMA_RANGE: f32 = 0.25;
/// The global shift search: ±3 at a quarter size, then ±1 at half and at full size (±15
/// pixels in all, about a sixth of the frame's width), over the frames' overlap less a border.
const COARSE: i32 = 3;
const BORDER: usize = 2;
/// The score's weights: histograms, edges, pixels; the luma difference that counts fully.
const W_HIST: f32 = 0.4;
const W_EDGE: f32 = 0.3;
const W_PIXEL: f32 = 0.3;
const PIXEL_FULL: f32 = 0.25;
/// Blank: luma this flat, and this dark or bright.
const BLANK_STD: f32 = 0.02;
const BLANK_DARK: f32 = 0.12;
const BLANK_BRIGHT: f32 = 0.88;
/// Dark enough to be the bottom of a dip to black.
const DIP: f32 = 0.15;
/// The spans the gradual test compares across, seconds.
const SPANS: [f64; 4] = [0.2, 0.4, 0.8, 1.6];
/// A blend explains the middle frame when it's this much closer to it than either end is.
/// (Unrelated frames come out near 0.87; a clean cross-fade near 0, one between handheld
/// shots up to about 0.7. On real footage nothing but a transition came under 0.75.)
const BLEND: f32 = 0.7;
/// Below this the ends are too alike to tell a blend from anything else.
const MIN_END_DIFF: f32 = 0.015;
/// The ends of a dissolve differ in structure at least this much (edge change ratio).
const STRUCTURE: f32 = 0.25;
/// A hard cut changes at least this share of the edges (unless neither frame has many).
const CUT_EDGES: f32 = 0.2;
/// A blank run longer than this is a scene of its own.
const LONG_BLANK: f64 = 2.0;

struct Frame {
    w: usize,
    h: usize,
    y: Vec<f32>,
    cb: Vec<f32>,
    cr: Vec<f32>,
    hw: usize,
    hh: usize,
    y_half: Vec<f32>,
    qw: usize,
    qh: usize,
    y_quarter: Vec<f32>,
    edges: Vec<bool>,
    near: Vec<bool>,
    hist: [f32; HIST_Y + HIST_C * HIST_C],
    mean: f32,
    std: f32,
}

impl Frame {
    fn new(rgba: &[u8], width: usize, height: usize) -> Frame {
        let width = width.max(1);
        let height = height.max(1);
        let aspect = width as f64 / height as f64;
        let h = ((AREA / aspect).sqrt().round() as usize).clamp(16, 256);
        let w = ((h as f64 * aspect).round() as usize).clamp(16, 256);
        let n = w * h;
        let (mut y, mut cb, mut cr) = (vec![0f32; n], vec![0f32; n], vec![0f32; n]);
        // Area average (nearest when the source is smaller).
        for ty in 0..h {
            let y0 = ty * height / h;
            let y1 = ((ty + 1) * height / h).max(y0 + 1).min(height);
            for tx in 0..w {
                let x0 = tx * width / w;
                let x1 = ((tx + 1) * width / w).max(x0 + 1).min(width);
                let mut sum = [0u32; 3];
                for sy in y0..y1 {
                    let row = &rgba[(sy * width + x0) * 4..(sy * width + x1) * 4];
                    for px in row.chunks_exact(4) {
                        sum[0] += px[0] as u32;
                        sum[1] += px[1] as u32;
                        sum[2] += px[2] as u32;
                    }
                }
                let k = ((y1 - y0) * (x1 - x0)) as f32 * 255.0;
                let [r, g, b] = sum.map(|s| s as f32 / k);
                let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                let i = ty * w + tx;
                y[i] = l;
                cb[i] = (b - l) / 1.8556;
                cr[i] = (r - l) / 1.5748;
            }
        }
        let (y_half, hw, hh) = halve(&y, w, h);
        let (y_quarter, qw, qh) = halve(&y_half, hw, hh);
        // Histograms, each normalised.
        let mut hist = [0f32; HIST_Y + HIST_C * HIST_C];
        let bin_c = |v: f32| (((v + CHROMA_RANGE) / (2.0 * CHROMA_RANGE) * HIST_C as f32) as isize).clamp(0, HIST_C as isize - 1) as usize;
        for i in 0..n {
            hist[((y[i] * HIST_Y as f32) as usize).min(HIST_Y - 1)] += 1.0;
            hist[HIST_Y + bin_c(cb[i]) * HIST_C + bin_c(cr[i])] += 1.0;
        }
        hist.iter_mut().for_each(|v| *v /= n as f32);
        let mean = y.iter().sum::<f32>() / n as f32;
        let std = (y.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / n as f32).sqrt();
        // Sobel edges, thresholded relative to the frame's own gradients (with a floor), and
        // the edges grown by a pixel.
        let mut mag = vec![0f32; n];
        for j in 1..h - 1 {
            for i in 1..w - 1 {
                let p = |dx: isize, dy: isize| y[(j as isize + dy) as usize * w + (i as isize + dx) as usize];
                let gx = p(1, -1) + 2.0 * p(1, 0) + p(1, 1) - p(-1, -1) - 2.0 * p(-1, 0) - p(-1, 1);
                let gy = p(-1, 1) + 2.0 * p(0, 1) + p(1, 1) - p(-1, -1) - 2.0 * p(0, -1) - p(1, -1);
                mag[j * w + i] = (gx * gx + gy * gy).sqrt() / 4.0;
            }
        }
        let mean_mag = mag.iter().sum::<f32>() / n as f32;
        let threshold = (2.0 * mean_mag).max(0.04);
        let edges: Vec<bool> = mag.iter().map(|&m| m > threshold).collect();
        let mut near = vec![false; n];
        for j in 0..h {
            for i in 0..w {
                if edges[j * w + i] {
                    for dj in j.saturating_sub(1)..(j + 2).min(h) {
                        for di in i.saturating_sub(1)..(i + 2).min(w) {
                            near[dj * w + di] = true;
                        }
                    }
                }
            }
        }
        Frame { w, h, y, cb, cr, hw, hh, y_half, qw, qh, y_quarter, edges, near, hist, mean, std }
    }

    fn blank(&self) -> bool {
        self.std < BLANK_STD && (self.mean < BLANK_DARK || self.mean > BLANK_BRIGHT)
    }
}

/// How two frames differ.
#[derive(Clone, Copy, Debug)]
struct Difference {
    hist: f32,
    edges: f32,
    pixels: f32,
    /// Neither frame has enough edges for their change to mean anything (`edges` is 0).
    edgeless: bool,
}

impl Difference {
    fn score(&self) -> f32 {
        W_HIST * self.hist + W_EDGE * self.edges + W_PIXEL * (self.pixels / PIXEL_FULL).min(1.0)
    }
}

/// A plane at half its size (each 2×2 block averaged).
fn halve(p: &[f32], w: usize, h: usize) -> (Vec<f32>, usize, usize) {
    let (hw, hh) = ((w / 2).max(1), (h / 2).max(1));
    let mut out = vec![0f32; hw * hh];
    for j in 0..hh {
        for i in 0..hw {
            let at = |x: usize, y: usize| p[y.min(h - 1) * w + x.min(w - 1)];
            out[j * hw + i] = 0.25 * (at(2 * i, 2 * j) + at(2 * i + 1, 2 * j) + at(2 * i, 2 * j + 1) + at(2 * i + 1, 2 * j + 1));
        }
    }
    (out, hw, hh)
}

/// The rows or columns of `a` (0..len) that meet `b` shifted by `d`, less `border`.
fn overlap(len: usize, d: i32, border: usize) -> (usize, usize) {
    let lo = (border as i32).max(-d).max(0) as usize;
    let hi = ((len - border.min(len)) as i32).min(len as i32 - d).max(0) as usize;
    (lo, hi.max(lo))
}

/// Mean absolute difference of `a` and `b` shifted by (dx, dy), over where they overlap.
fn shifted_mad(a: &[f32], b: &[f32], w: usize, h: usize, dx: i32, dy: i32, border: usize) -> f32 {
    let (x0, x1) = overlap(w, dx, border);
    let (y0, y1) = overlap(h, dy, border);
    let n = (x1 - x0) * (y1 - y0);
    // Too little left to compare: as different as can be.
    if n * 4 < w * h {
        return f32::INFINITY;
    }
    let mut sum = 0.0;
    for y in y0..y1 {
        let by = (y as i32 + dy) as usize;
        let (ra, rb) = (&a[y * w..][..w], &b[by * w..][..w]);
        for x in x0..x1 {
            sum += (ra[x] - rb[(x as i32 + dx) as usize]).abs();
        }
    }
    sum / n as f32
}

/// The best shift within ±`r` of `centre` on one level (standing still wins ties).
fn search(a: &[f32], b: &[f32], w: usize, h: usize, centre: (i32, i32), r: i32, border: usize) -> ((i32, i32), f32) {
    let mut best = centre;
    let mut best_err = shifted_mad(a, b, w, h, centre.0, centre.1, border);
    for dy in -r..=r {
        for dx in -r..=r {
            let (sx, sy) = (centre.0 + dx, centre.1 + dy);
            let e = shifted_mad(a, b, w, h, sx, sy, border);
            // A move has to earn its place.
            if e < best_err - 1e-4 {
                best = (sx, sy);
                best_err = e;
            }
        }
    }
    (best, best_err)
}

/// The global shift of `b` against `a` that fits best, coarse to fine, and the luma
/// difference after it.
fn best_shift(a: &Frame, b: &Frame) -> ((i32, i32), f32) {
    let (q, _) = search(&a.y_quarter, &b.y_quarter, a.qw, a.qh, (0, 0), COARSE, 0);
    let (hs, _) = search(&a.y_half, &b.y_half, a.hw, a.hh, (q.0 * 2, q.1 * 2), 1, 1);
    let (shift, err) = search(&a.y, &b.y, a.w, a.h, (hs.0 * 2, hs.1 * 2), 1, BORDER);
    // Nothing overlaps enough: compare them as they stand.
    if err.is_finite() {
        (shift, err)
    } else {
        ((0, 0), shifted_mad(&a.y, &b.y, a.w, a.h, 0, 0, BORDER))
    }
}

/// The edge change ratio of `b` against `a`, `b` shifted by `shift`, over their overlap;
/// `None` when neither has enough edges to say.
fn edge_change(a: &Frame, b: &Frame, shift: (i32, i32)) -> Option<f32> {
    let (w, h) = (a.w, a.h);
    let (x0, x1) = overlap(w, shift.0, BORDER);
    let (y0, y1) = overlap(h, shift.1, BORDER);
    let area = (x1 - x0) * (y1 - y0);
    if area == 0 {
        return Some(1.0);
    }
    let (mut ea, mut eb, mut entering, mut exiting) = (0usize, 0usize, 0usize, 0usize);
    for y in y0..y1 {
        for x in x0..x1 {
            let pa = y * w + x;
            let pb = (y as i32 + shift.1) as usize * w + (x as i32 + shift.0) as usize;
            if b.edges[pb] {
                eb += 1;
                if !a.near[pa] {
                    entering += 1;
                }
            }
            if a.edges[pa] {
                ea += 1;
                if !b.near[pb] {
                    exiting += 1;
                }
            }
        }
    }
    let few = area / 200;
    match (ea < few, eb < few) {
        (true, true) => None,
        // Edges appearing from nothing (or vanishing into it) are all change.
        (true, false) | (false, true) => Some(1.0),
        _ => Some((entering as f32 / eb as f32).max(exiting as f32 / ea as f32)),
    }
}

fn hist_distance(a: &Frame, b: &Frame) -> f32 {
    let dy: f32 = a.hist[..HIST_Y].iter().zip(&b.hist[..HIST_Y]).map(|(p, q)| (p - q).abs()).sum();
    let dc: f32 = a.hist[HIST_Y..].iter().zip(&b.hist[HIST_Y..]).map(|(p, q)| (p - q).abs()).sum();
    0.25 * (dy + dc)
}

fn compare(a: &Frame, b: &Frame) -> Difference {
    let (shift, pixels) = best_shift(a, b);
    let edges = edge_change(a, b, shift);
    Difference { hist: hist_distance(a, b), edges: edges.unwrap_or(0.0), pixels, edgeless: edges.is_none() }
}

/// Mean absolute difference over the luma and chroma planes of `c` and `f(a, b)` per pixel.
fn plane_mad(c: &Frame, a: &Frame, b: &Frame, f: impl Fn(f32, f32) -> f32) -> f32 {
    let n = c.y.len();
    let mut sum = 0.0;
    for i in 0..n {
        sum += (c.y[i] - f(a.y[i], b.y[i])).abs() + (c.cb[i] - f(a.cb[i], b.cb[i])).abs() + (c.cr[i] - f(a.cr[i], b.cr[i])).abs();
    }
    sum / n as f32
}

/// How far frame `c` is along a blend from `a` (0) to `b` (1), by least squares.
fn blend_position(c: &Frame, a: &Frame, b: &Frame) -> f32 {
    let (mut num, mut den) = (0.0, 0.0);
    for (pc, pa, pb) in [(&c.y, &a.y, &b.y), (&c.cb, &a.cb, &b.cb), (&c.cr, &a.cr, &b.cr)] {
        for i in 0..pc.len() {
            let d = pb[i] - pa[i];
            num += (pc[i] - pa[i]) * d;
            den += d * d;
        }
    }
    if den < 1e-9 {
        0.5
    } else {
        (num / den).clamp(0.0, 1.0)
    }
}

/// What the gradual test found at one span's middle frame.
#[derive(Clone, Copy, Debug)]
struct Blend {
    /// The middle frame's distance from the ends' mean, over its distance from the nearer end.
    ratio: f32,
    nearer: f32,
    structural: bool,
    /// The frame where the blend is half way, and where it starts and ends.
    cut: usize,
    start: usize,
    end: usize,
    dark: bool,
}

struct Span {
    half: usize,
    /// The difference across the span centred on each frame (NaN where there's no span).
    diff: Vec<f32>,
    blend: Vec<Option<Blend>>,
}

/// Finds shot changes in frames pushed one at a time; see the module's documentation.
pub struct SceneDetector {
    options: SceneOptions,
    window: VecDeque<Frame>,
    /// Index of the window's first frame.
    first: usize,
    capacity: usize,
    times: Vec<i64>,
    means: Vec<f32>,
    blank: Vec<bool>,
    /// The difference between each frame and the one before (0 for the first), and its parts.
    step: Vec<f32>,
    parts: Vec<Difference>,
    /// For a pair that could be a cut: the smallest difference between a frame up to four
    /// before it and one up to three after (a flash or a glitch comes back to the shot).
    flash: Vec<f32>,
    spans: Vec<Span>,
    hard_floor: f32,
    hard_ratio: f32,
    gradual_floor: f32,
    gradual_ratio: f32,
}

impl SceneDetector {
    pub fn new(options: SceneOptions) -> SceneDetector {
        let fps = if options.fps.is_finite() && options.fps > 1.0 { options.fps } else { 30.0 };
        let s = options.sensitivity.clamp(0.0, 1.0);
        let mut halves: Vec<usize> = SPANS.iter().map(|t| ((t * fps / 2.0).round() as usize).max(1)).collect();
        halves.dedup();
        let capacity = 2 * halves.last().copied().unwrap_or(1) + 5;
        let hard_floor = 0.42 - 0.24 * s;
        SceneDetector {
            options: SceneOptions { fps, ..options },
            window: VecDeque::with_capacity(capacity + 1),
            first: 0,
            capacity,
            times: Vec::new(),
            means: Vec::new(),
            blank: Vec::new(),
            step: Vec::new(),
            parts: Vec::new(),
            flash: Vec::new(),
            spans: halves.into_iter().map(|half| Span { half, diff: Vec::new(), blend: Vec::new() }).collect(),
            hard_floor,
            hard_ratio: 3.0 - 1.6 * s,
            gradual_floor: hard_floor + 0.04,
            gradual_ratio: 1.8 - 0.6 * s,
        }
    }

    /// Frames pushed so far.
    pub fn len(&self) -> usize {
        self.times.len()
    }

    pub fn is_empty(&self) -> bool {
        self.times.is_empty()
    }

    fn frame(&self, i: usize) -> &Frame {
        &self.window[i - self.first]
    }

    /// The next frame: its time and straight RGBA pixels (any size; it's shrunk).
    pub fn push(&mut self, time: i64, rgba: &[u8], width: usize, height: usize) {
        let f = Frame::new(rgba, width, height);
        let n = self.times.len();
        self.times.push(time);
        self.means.push(f.mean);
        self.blank.push(f.blank());
        self.window.push_back(f);
        if self.window.len() > self.capacity {
            self.window.pop_front();
            self.first += 1;
        }
        let diff = if n >= 1 { compare(self.frame(n - 1), self.frame(n)) } else { Difference { hist: 0.0, edges: 0.0, pixels: 0.0, edgeless: true } };
        self.step.push(diff.score());
        self.parts.push(diff);
        self.flash.push(f32::INFINITY);
        if n >= 4 {
            self.check_flash(n - 3, n);
        }
        for s in 0..self.spans.len() {
            let half = self.spans[s].half;
            self.spans[s].diff.push(f32::NAN);
            self.spans[s].blend.push(None);
            if n >= 2 * half {
                let (a, c, b) = (n - 2 * half, n - half, n);
                let d = compare(self.frame(a), self.frame(b));
                let score = d.score();
                self.spans[s].diff[c] = score;
                if score >= 0.9 * self.gradual_floor {
                    let blend = self.blend(a, c, b);
                    self.spans[s].blend[c] = Some(blend);
                }
            }
        }
    }

    /// The flash test for the pair ending at frame `k`, with frames up to `last` there: the
    /// frames around it compared across it, but for the pair itself.
    fn check_flash(&mut self, k: usize, last: usize) {
        if k == 0 || self.step[k] < self.hard_floor {
            return;
        }
        let mut least = f32::INFINITY;
        for i in 1..=4.min(k).min(k - self.first) {
            for j in k..=(k + 3).min(last) {
                if i == 1 && j == k {
                    continue;
                }
                least = least.min(compare(self.frame(k - i), self.frame(j)).score());
            }
        }
        self.flash[k] = least;
    }

    fn blend(&self, a: usize, c: usize, b: usize) -> Blend {
        let (fa, fc, fb) = (self.frame(a), self.frame(c), self.frame(b));
        let mix = plane_mad(fc, fa, fb, |p, q| 0.5 * (p + q));
        let to_a = plane_mad(fc, fa, fb, |p, _| p);
        let to_b = plane_mad(fc, fa, fb, |_, q| q);
        let nearer = to_a.min(to_b);
        let structural = fa.blank() || fb.blank() || edge_change(fa, fb, best_shift(fa, fb).0).is_none_or(|e| e >= STRUCTURE);
        let dark = |f: &Frame| f.mean < DIP && f.std < 2.0 * BLANK_STD.max(0.02);
        // Where along the blend each frame is: the cut where it passes half way.
        let positions: Vec<f32> = (a..=b).map(|j| blend_position(self.frame(j), fa, fb)).collect();
        let cut = a + positions.iter().position(|&p| p >= 0.5).unwrap_or(c - a);
        let start = a + positions[..=cut - a].iter().rposition(|&p| p <= 0.1).unwrap_or(0);
        let end = a + positions[cut - a..].iter().position(|&p| p >= 0.9).map_or(b - a, |i| i + cut - a);
        Blend { ratio: if nearer > 0.0 { mix / nearer } else { 1.0 }, nearer, structural, cut: cut.max(a + 1), start, end, dark: dark(fa) || dark(fb) }
    }

    /// The shot changes found.
    pub fn finish(mut self) -> Vec<SceneCut> {
        let n = self.times.len();
        if n < 3 {
            return Vec::new();
        }
        for k in n.saturating_sub(3).max(1)..n {
            if self.flash[k].is_infinite() {
                self.check_flash(k, n - 1);
            }
        }
        let fps = self.options.fps;
        let frames = |secs: f64| ((secs * fps).round() as usize).max(1);
        let median = |v: &mut Vec<f32>| -> f32 {
            if v.is_empty() {
                return 0.0;
            }
            v.sort_by(f32::total_cmp);
            v[v.len() / 2]
        };

        // Hard cuts.
        let mut cuts: Vec<SceneCut> = Vec::new();
        let around = frames(0.33).max(4);
        for k in 1..n {
            let s = self.step[k];
            if s < self.hard_floor {
                continue;
            }
            if (k.saturating_sub(2).max(1)..(k + 3).min(n)).any(|j| j != k && self.step[j] > s) {
                continue;
            }
            let mut near: Vec<f32> = (k.saturating_sub(around).max(1)..(k + around + 1).min(n)).filter(|&j| j + 1 < k || j > k + 1).map(|j| self.step[j]).collect();
            let baseline = median(&mut near);
            if s < self.hard_ratio * baseline + 0.03 {
                continue;
            }
            if self.flash[k] < 0.5 * s {
                continue;
            }
            // A change of light (exposure, white balance) leaves the edges where they were.
            let p = self.parts[k];
            if !p.edgeless && p.edges < CUT_EDGES {
                continue;
            }
            cuts.push(SceneCut { frame: k, time: self.times[k], kind: CutKind::Hard, start: self.times[k], end: self.times[k], score: s });
        }

        // Dissolves and fades, from every span; of overlapping finds the widest span's, which
        // sees the whole transition (then the better blend).
        let mut gradual: Vec<(SceneCut, usize, f32, usize, usize)> = Vec::new();
        for span in &self.spans {
            let half = span.half;
            for c in half..n.saturating_sub(half) {
                let d = span.diff[c];
                let Some(b) = span.blend[c] else { continue };
                if d.is_nan() || d < self.gradual_floor || b.ratio > BLEND || b.nearer < MIN_END_DIFF || !b.structural {
                    continue;
                }
                if (c - half..=(c + half).min(n - 1)).any(|j| span.diff[j] > d) {
                    continue;
                }
                let mut near: Vec<f32> = (c.saturating_sub(4 * half)..(c + 4 * half + 1).min(n)).filter(|&j| j + half < c || j > c + half).map(|j| span.diff[j]).filter(|v| v.is_finite()).collect();
                if d < self.gradual_ratio * median(&mut near) + 0.02 {
                    continue;
                }
                // A hard cut explains it.
                if cuts.iter().any(|h| h.frame + half >= c && h.frame <= c + half) {
                    continue;
                }
                let kind = if b.dark { CutKind::Fade } else { CutKind::Dissolve };
                gradual.push((SceneCut { frame: b.cut, time: self.times[b.cut], kind, start: self.times[b.start], end: self.times[b.end], score: d }, half, b.ratio, b.start, b.end));
            }
        }
        gradual.sort_by(|x, y| y.1.cmp(&x.1).then(x.2.total_cmp(&y.2)));
        let mut kept: Vec<(SceneCut, usize, usize)> = Vec::new();
        for (cut, _, _, start, end) in gradual {
            if !kept.iter().any(|&(_, s, e)| start <= e + 1 && end + 1 >= s) {
                kept.push((cut, start, end));
            }
        }

        // Blank runs: the cuts into and out of them, and fades touching them, become one
        // boundary in the run (or one at each end of a long one); none at the run's ends.
        let mut extents: Vec<(SceneCut, usize, usize)> = cuts.into_iter().map(|c| (c, c.frame, c.frame)).chain(kept).collect();
        let mut k = 0;
        while k < n {
            if !self.blank[k] {
                k += 1;
                continue;
            }
            let s = k;
            while k < n && self.blank[k] {
                k += 1;
            }
            let e = k - 1;
            extents.retain(|&(c, start, end)| {
                let touches = if c.kind == CutKind::Hard { c.frame + 1 >= s && c.frame <= e + 1 } else { start <= e + 2 && end + 2 >= s };
                !touches
            });
            if s == 0 || e == n - 1 {
                continue;
            }
            let fade = |frame: usize| SceneCut { frame, time: self.times[frame], kind: CutKind::Fade, start: self.times[s], end: self.times[e], score: 1.0 };
            if (self.times[e] - self.times[s]) as f64 / 1e6 > LONG_BLANK {
                extents.push((fade(s), s, s));
                extents.push((fade(e + 1), e + 1, e + 1));
            } else {
                let mid = (s + e).div_ceil(2);
                extents.push((fade(mid), s, e));
            }
        }
        extents.sort_by_key(|x| x.0.frame);

        // A fade out and in through a dark frame is one boundary, at the darkest frame.
        let mut merged: Vec<(SceneCut, usize, usize)> = Vec::new();
        for x in extents {
            if let Some(last) = merged.last_mut() {
                let (a, b) = (last.0.frame, x.0.frame);
                let gradual = |c: &SceneCut| c.kind != CutKind::Hard;
                if gradual(&last.0) && gradual(&x.0) && b > a && (b - a) as f64 <= 2.0 * fps && (a..=b).all(|j| self.means[j] < DIP || self.blank[j]) {
                    let darkest = (a..=b).min_by(|&i, &j| self.means[i].total_cmp(&self.means[j])).unwrap();
                    last.0 = SceneCut { frame: darkest, time: self.times[darkest], kind: CutKind::Fade, start: last.0.start, end: x.0.end, score: last.0.score.max(x.0.score) };
                    last.2 = x.2;
                    continue;
                }
            }
            merged.push(x);
        }

        // The shortest scene: none at the run's ends, and the clearest of any too close.
        let min = frames(self.options.min_scene);
        let mut by_score: Vec<SceneCut> = merged.into_iter().map(|x| x.0).filter(|c| c.frame >= min && c.frame + min <= n).collect();
        by_score.sort_by(|a, b| b.score.total_cmp(&a.score));
        let mut out: Vec<SceneCut> = Vec::new();
        for c in by_score {
            if out.iter().all(|o| o.frame.abs_diff(c.frame) >= min) {
                out.push(c);
            }
        }
        out.sort_by_key(|c| c.frame);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: usize = 160;
    const H: usize = 90;

    /// A tiny deterministic random generator (xorshift).
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> f32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 40) as f32 / (1u64 << 24) as f32
        }
    }

    /// A world for one shot: a big picture of coloured rectangles and soft blobs on a tinted
    /// ground, with fine noise, that the camera looks at a window of.
    struct World {
        w: usize,
        h: usize,
        px: Vec<[f32; 3]>,
    }

    impl World {
        fn new(seed: u64) -> World {
            let mut r = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
            let (w, h) = (W * 3, H * 3);
            let ground = [r.next() * 0.6 + 0.2, r.next() * 0.6 + 0.2, r.next() * 0.6 + 0.2];
            let mut px = vec![ground; w * h];
            for _ in 0..60 {
                let (x0, y0) = ((r.next() * w as f32) as usize, (r.next() * h as f32) as usize);
                let (rw, rh) = ((r.next() * 60.0 + 8.0) as usize, (r.next() * 60.0 + 8.0) as usize);
                let c = [r.next(), r.next(), r.next()];
                for y in y0..(y0 + rh).min(h) {
                    for x in x0..(x0 + rw).min(w) {
                        px[y * w + x] = c;
                    }
                }
            }
            for p in px.iter_mut() {
                let n = (r.next() - 0.5) * 0.04;
                *p = p.map(|v| (v + n).clamp(0.0, 1.0));
            }
            World { w, h, px }
        }

        /// The camera's view at offset (x, y) in the world, zoomed by `zoom`.
        fn view(&self, x: f32, y: f32, zoom: f32) -> Vec<[f32; 3]> {
            let mut out = Vec::with_capacity(W * H);
            for j in 0..H {
                for i in 0..W {
                    // The world wraps round, so the camera never runs off it.
                    let sx = (x + (i as f32 - W as f32 / 2.0) / zoom + W as f32 / 2.0).floor().rem_euclid(self.w as f32) as usize;
                    let sy = (y + (j as f32 - H as f32 / 2.0) / zoom + H as f32 / 2.0).floor().rem_euclid(self.h as f32) as usize;
                    out.push(self.px[sy * self.w + sx]);
                }
            }
            out
        }
    }

    type Picture = Vec<[f32; 3]>;

    /// A shot: `frames` views of a world, the camera moving `pan` pixels a frame.
    fn shot(seed: u64, frames: usize, pan: (f32, f32)) -> Vec<Picture> {
        let world = World::new(seed);
        (0..frames).map(|t| world.view(W as f32 + pan.0 * t as f32, H as f32 + pan.1 * t as f32, 1.0)).collect()
    }

    fn mix(a: &Picture, b: &Picture, t: f32) -> Picture {
        a.iter().zip(b).map(|(p, q)| [0, 1, 2].map(|c| p[c] * (1.0 - t) + q[c] * t)).collect()
    }

    fn rgba(p: &Picture) -> Vec<u8> {
        p.iter().flat_map(|c| [(c[0] * 255.0).round() as u8, (c[1] * 255.0).round() as u8, (c[2] * 255.0).round() as u8, 255]).collect()
    }

    fn detect(frames: &[Picture]) -> Vec<SceneCut> {
        let mut d = SceneDetector::new(SceneOptions::default());
        for (i, f) in frames.iter().enumerate() {
            d.push(i as i64 * 33_333, &rgba(f), W, H);
        }
        d.finish()
    }

    /// Hard cuts between moving shots are found on their frame.
    #[test]
    fn hard_cuts() {
        let mut frames = Vec::new();
        let mut truth = Vec::new();
        for (i, len) in [40, 25, 60, 35].into_iter().enumerate() {
            if i > 0 {
                truth.push(frames.len());
            }
            frames.extend(shot(i as u64 + 1, len, (1.5 * i as f32 - 1.0, 0.5)));
        }
        let cuts = detect(&frames);
        let found: Vec<usize> = cuts.iter().map(|c| c.frame).collect();
        assert_eq!(found, truth, "{cuts:?}");
        assert!(cuts.iter().all(|c| c.kind == CutKind::Hard));
    }

    /// A cross-fade is one boundary in its middle; so is a fade through black.
    #[test]
    fn dissolves_and_fades() {
        let (a, b, c) = (shot(11, 50, (1.0, 0.0)), shot(12, 50, (0.0, 1.0)), shot(13, 50, (-1.0, 0.0)));
        let mut frames: Vec<Picture> = a[..35].to_vec();
        // A 15-frame dissolve from a to b.
        for t in 0..15 {
            frames.push(mix(&a[35 + t], &b[t], (t as f32 + 0.5) / 15.0));
        }
        let dissolve = 35..50;
        frames.extend_from_slice(&b[15..50]);
        // Fade out over 10 frames, 4 black frames, fade in over 10.
        let black = vec![[0.0; 3]; W * H];
        let fade_start = frames.len();
        for t in 0..10 {
            frames.push(mix(&b[49], &black, (t as f32 + 1.0) / 10.0));
        }
        for _ in 0..4 {
            frames.push(black.clone());
        }
        for t in 0..10 {
            frames.push(mix(&black, &c[t], (t as f32 + 1.0) / 10.0));
        }
        let fade = fade_start..frames.len();
        frames.extend_from_slice(&c[10..50]);
        let cuts = detect(&frames);
        assert_eq!(cuts.len(), 2, "{cuts:?}");
        assert!(dissolve.contains(&cuts[0].frame) && cuts[0].kind == CutKind::Dissolve, "{cuts:?}");
        assert!(fade.contains(&cuts[1].frame) && cuts[1].kind == CutKind::Fade, "{cuts:?}");
        // The dissolve's cut is near its middle.
        assert!(cuts[0].frame.abs_diff(42) <= 3, "{cuts:?}");
    }

    /// A camera moving across one scene (panning, then faster, then tilting, then zooming), a
    /// flash and an exposure change in it: no cut.
    #[test]
    fn moving_camera_without_a_cut() {
        let world = World::new(21);
        let mut frames = Vec::new();
        let (mut x, mut y, mut zoom) = (W as f32, H as f32, 1.0f32);
        for t in 0..240 {
            let (dx, dy) = match t {
                0..=59 => (1.0, 0.0),
                60..=119 => (3.5, 0.5),
                120..=179 => (-0.5, 2.5),
                _ => (0.5, 0.0),
            };
            if t >= 180 {
                zoom *= 1.006;
            }
            x += dx;
            y += dy;
            let mut f = world.view(x, y, zoom);
            // A two-frame camera flash.
            if t == 70 || t == 71 {
                f = f.iter().map(|p| p.map(|v| (v * 0.3 + 0.7).min(1.0))).collect();
            }
            // Exposure ramping down then up.
            if (140..170).contains(&t) {
                let k = 1.0 - 0.3 * (((t - 140) as f32 / 30.0) * std::f32::consts::PI).sin();
                f = f.iter().map(|p| p.map(|v| v * k)).collect();
            }
            frames.push(f);
        }
        let cuts = detect(&frames);
        assert!(cuts.is_empty(), "{cuts:?}");
    }

    /// Fading in from black at the start and out at the end isn't a change of shot.
    #[test]
    fn fades_at_the_ends_are_not_cuts() {
        let a = shot(31, 60, (1.0, 0.0));
        let black = vec![[0.0; 3]; W * H];
        let mut frames: Vec<Picture> = (0..12).map(|t| mix(&black, &a[0], t as f32 / 12.0)).collect();
        frames.extend_from_slice(&a);
        frames.extend((0..12).map(|t| mix(&a[59], &black, (t as f32 + 1.0) / 12.0)));
        assert!(detect(&frames).is_empty());
    }
}
