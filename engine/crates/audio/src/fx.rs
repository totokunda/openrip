//! Voice filters: CapCut's audio effects (its "Voice filters"; SAMI `music_dsp_effect`s).
//!
//! Each bundle's `mdsp_preset.json` is a graph of named processors. OpenRip rebuilds the
//! graph from the same processors, with the clip's slider values mapped onto their
//! parameters the way the graph's `ParameterChangeTransform` nodes do
//! (docs/parity/voice-effects.md). Processors OpenRip doesn't have pass the sound through
//! and are listed in [`Chain::missing`].

use std::collections::{BTreeMap, HashMap};
use std::f32::consts::PI;
use std::path::Path;
use std::sync::Arc;

use realfft::num_complex::Complex32;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};
use serde_json::Value;

const CHANNELS: usize = 2;

/// One processor: interleaved stereo in place.
trait Processor: Send {
    fn process(&mut self, buf: &mut [f32]);
    /// Samples the output lags the input by.
    fn latency(&self) -> usize {
        0
    }
}

/// A voice filter, ready to process a clip's sound.
pub struct Chain {
    nodes: Vec<Node>,
    /// The graph's output: a node index.
    output: usize,
    rate: u32,
    /// Processors in the preset that OpenRip doesn't have (they pass the sound through).
    pub missing: Vec<String>,
}

struct Node {
    proc: Option<Box<dyn Processor>>,
    /// Upstream nodes (or `None` for the graph's input) summed into this node.
    inputs: Vec<Option<usize>>,
    out: Vec<f32>,
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str()?.parse().ok())
}

fn boolean(v: &Value) -> bool {
    v.as_bool().unwrap_or_else(|| num(v).is_some_and(|x| x != 0.0))
}

/// A preset processor's parameters by name (both preset formats), and by index where the
/// format has one.
fn parameters(node: &Value) -> (BTreeMap<String, Value>, Vec<String>) {
    let state = &node["processor_state"]["parameters"];
    match state {
        Value::Object(map) => (map.iter().map(|(k, v)| (k.clone(), v.clone())).collect(), Vec::new()),
        Value::Array(list) => {
            let mut by_name = BTreeMap::new();
            let mut names = Vec::new();
            for p in list {
                let name = p["name"].as_str().unwrap_or_default().to_string();
                let i = num(&p["index"]).unwrap_or(names.len() as f64) as usize;
                if names.len() <= i {
                    names.resize(i + 1, String::new());
                }
                names[i] = name.clone();
                by_name.insert(name, p["plain_value"].clone());
            }
            (by_name, names)
        }
        _ => (BTreeMap::new(), Vec::new()),
    }
}

/// A normalised (0–1) parameter value as the processor's own value, for the parameters the
/// local voice filters move. Semitone shifts span ±24 (Deep's slider defaults give exactly
/// its stored −4 and −6); gains run from −70 dB (off) through 0 dB at 0.4444, taken as
/// linear (only those two points are known).
fn plain(processor: &str, name: &str, normalised: f64) -> Option<Value> {
    let v = match (processor, name) {
        ("PitchAndFormantShift", n) if n.ends_with("Shift Semitone") => -24.0 + 48.0 * normalised,
        (_, "Gain dB") => {
            if normalised <= 0.0 {
                -200.0
            } else {
                -70.0 + 157.5 * normalised
            }
        }
        _ => return None,
    };
    Some(Value::from(v))
}

/// Piecewise-linear transform curve: [[x, y], …].
fn curve(points: &Value, x: f64) -> f64 {
    let pts: Vec<(f64, f64)> = points.as_array().into_iter().flatten().filter_map(|p| Some((num(p.get(0)?)?, num(p.get(1)?)?))).collect();
    let Some(&first) = pts.first() else { return x };
    if x <= first.0 {
        return first.1;
    }
    for w in pts.windows(2) {
        let ((x0, y0), (x1, y1)) = (w[0], w[1]);
        if x <= x1 {
            return if x1 > x0 { y0 + (y1 - y0) * (x - x0) / (x1 - x0) } else { y1 };
        }
    }
    pts.last().unwrap().1
}

impl Chain {
    /// The voice filter in `bundle` (CapCut's downloaded copy) with the clip's slider values
    /// by name; sliders not given take their defaults.
    pub fn load(bundle: &Path, sliders: &BTreeMap<String, f64>, rate: u32) -> Result<Chain, String> {
        let read = |name: &str| -> Result<Value, String> { serde_json::from_slice(&std::fs::read(bundle.join(name)).map_err(|e| format!("{name}: {e}"))?).map_err(|e| format!("{name}: {e}")) };
        let preset = read("mdsp_preset.json")?;
        // The sliders, in their parameter order.
        let extra = read("extra.json").unwrap_or(Value::Null);
        let mut slider_values: HashMap<usize, f64> = HashMap::new();
        for s in extra.pointer("/setting/audio_effect_parameters_change").and_then(Value::as_array).into_iter().flatten() {
            let i = num(&s["parameterIndex"]).unwrap_or(0.0) as usize;
            let name = s["sliderName"].as_str().unwrap_or_default();
            slider_values.insert(i, sliders.get(name).copied().or_else(|| num(&s["defaultValue"])).unwrap_or(0.0));
        }
        let nodes_json = preset["nodes"].as_array().cloned().unwrap_or_default();
        let index: HashMap<String, usize> = nodes_json.iter().enumerate().map(|(i, n)| (n["node_id"].as_str().unwrap_or_default().to_string(), i)).collect();
        let id = |v: &Value| v.as_str().and_then(|s| index.get(s).copied());
        let mut params: Vec<(BTreeMap<String, Value>, Vec<String>)> = nodes_json.iter().map(parameters).collect();
        // Parameter changes: each transform node feeds the node it's connected to.
        let connections = preset["connections"].as_array().cloned().unwrap_or_default();
        for c in connections.iter().filter(|c| c["port_type"] == "parameter_change") {
            let (Some(from), Some(to)) = (id(&c["upstream_node_id"]), id(&c["downstream_node_id"])) else { continue };
            let processor = nodes_json[to]["processor_name"].as_str().unwrap_or_default().to_string();
            for t in nodes_json[from].pointer("/processor_state/transforms").and_then(Value::as_array).into_iter().flatten() {
                let input = slider_values.get(&(num(&t["input_parameter_index"]).unwrap_or(0.0) as usize)).copied().unwrap_or(0.0);
                for out in t["transforms"].as_array().into_iter().flatten() {
                    let target = num(&out["output_parameter_index"]).unwrap_or(0.0) as usize;
                    let (by_name, names) = &mut params[to];
                    // Formats without indices list parameters by name; the gains have one.
                    let name = names.get(target).cloned().or_else(|| by_name.keys().find(|k| k.ends_with("Gain dB")).cloned());
                    if let Some(name) = name {
                        if let Some(v) = plain(&processor, &name, curve(&out["transform_curve"], input)) {
                            by_name.insert(name, v);
                        }
                    }
                }
            }
        }
        let mut missing = Vec::new();
        let mut nodes: Vec<Node> = nodes_json
            .iter()
            .zip(&params)
            .map(|(n, (p, _))| {
                let name = n["processor_name"].as_str().unwrap_or_default();
                let bypass = p.get("Bypass").is_some_and(boolean);
                let proc = if bypass { None } else { processor(name, p, rate) };
                if proc.is_none() && !bypass && !matches!(name, "ParameterChangeTransform" | "Mixer") {
                    missing.push(name.to_string());
                }
                Node { proc, inputs: Vec::new(), out: Vec::new() }
            })
            .collect();
        for c in connections.iter().filter(|c| c["port_type"] == "audio") {
            if let (Some(from), Some(to)) = (id(&c["upstream_node_id"]), id(&c["downstream_node_id"])) {
                nodes[to].inputs.push(Some(from));
            }
        }
        let mut output = None;
        for p in preset["ports"].as_array().into_iter().flatten().filter(|p| p["port_type"] == "audio") {
            let Some(node) = id(&p["internal_node_id"]) else { continue };
            match p["port_direction"].as_str() {
                Some("input") => nodes[node].inputs.push(None),
                Some("output") => output = Some(node),
                _ => {}
            }
        }
        let output = output.ok_or("the voice filter's graph has no output")?;
        Ok(Chain { nodes, output, rate, missing })
    }

    /// Samples the output lags the input by (the longest path through the graph).
    pub fn latency(&self) -> usize {
        fn path(nodes: &[Node], i: usize, depth: usize) -> usize {
            if depth > nodes.len() {
                return 0;
            }
            let own = nodes[i].proc.as_ref().map_or(0, |p| p.latency());
            own + nodes[i].inputs.iter().map(|u| u.map_or(0, |u| path(nodes, u, depth + 1))).max().unwrap_or(0)
        }
        path(&self.nodes, self.output, 0)
    }

    pub fn rate(&self) -> u32 {
        self.rate
    }

    /// Process a block of interleaved stereo in place.
    pub fn process(&mut self, buf: &mut [f32]) {
        let n = self.nodes.len();
        let mut done = vec![false; n];
        // Evaluate nodes once their inputs are ready (the graphs are small and acyclic).
        for _ in 0..n {
            for i in 0..n {
                if done[i] || self.nodes[i].inputs.iter().any(|u| u.is_some_and(|u| !done[u])) {
                    continue;
                }
                let mut acc = vec![0f32; buf.len()];
                for u in &self.nodes[i].inputs {
                    let src: &[f32] = match u {
                        Some(u) => &self.nodes[*u].out,
                        None => buf,
                    };
                    for (a, s) in acc.iter_mut().zip(src) {
                        *a += s;
                    }
                }
                if let Some(p) = self.nodes[i].proc.as_mut() {
                    p.process(&mut acc);
                }
                self.nodes[i].out = acc;
                done[i] = true;
            }
        }
        buf.copy_from_slice(&self.nodes[self.output].out);
    }
}

fn get(p: &BTreeMap<String, Value>, name: &str, default: f64) -> f64 {
    p.get(name).and_then(num).unwrap_or(default)
}

fn processor(name: &str, p: &BTreeMap<String, Value>, rate: u32) -> Option<Box<dyn Processor>> {
    let fs = rate as f32;
    Some(match name {
        "Gain" | "GainAndPan" => {
            let db = get(p, "Gain dB", 0.0) as f32;
            Box::new(Gain(if db <= -70.0 { 0.0 } else { 10f32.powf(db / 20.0) }))
        }
        "Equaliser" => Box::new(Equaliser::new(p, fs)),
        "Limiter" => Box::new(Limiter::new(get(p, "Input Gain dB", 0.0) as f32, get(p, "Ceiling dB", -0.3) as f32, get(p, "Release", 500.0) as f32, fs)),
        "Compressor" => Box::new(Compressor::new(p, fs)),
        "PitchAndFormantShift" => {
            let pitch = get(p, "Pitch Shift Semitone", 0.0) + get(p, "Pitch Shift Fine Tune", 0.0);
            let formant = get(p, "Formant Shift Semitone", 0.0) + get(p, "Formant Fine Tune", 0.0);
            if pitch.abs() < 1e-6 && formant.abs() < 1e-6 {
                Box::new(Gain(1.0))
            } else {
                Box::new(PitchShift::new(2f32.powf(pitch as f32 / 12.0), 2f32.powf(formant as f32 / 12.0)))
            }
        }
        "Chorus" => Box::new(Chorus::new(p, fs)),
        "Tremolo" => Box::new(Tremolo::new(p, fs)),
        _ => return None,
    })
}

struct Gain(f32);

impl Processor for Gain {
    fn process(&mut self, buf: &mut [f32]) {
        buf.iter_mut().for_each(|x| *x *= self.0);
    }
}

/// A biquad (transposed direct form II), per channel.
#[derive(Clone, Copy, Default)]
struct Biquad {
    b: [f32; 3],
    a: [f32; 2],
    z: [[f32; 2]; CHANNELS],
}

impl Biquad {
    /// JUCE's (RBJ) coefficients for the Equaliser's filter modes.
    fn new(mode: &str, freq: f32, q: f32, gain_db: f32, fs: f32) -> Option<Biquad> {
        let w = 2.0 * PI * freq.clamp(1.0, fs * 0.49) / fs;
        let (sn, cs) = w.sin_cos();
        let q = q.max(0.01);
        let a_gain = 10f32.powf(gain_db / 40.0);
        let (b, a) = match mode {
            "Bell" | "Peak" => {
                let alpha = sn / (2.0 * q);
                ([1.0 + alpha * a_gain, -2.0 * cs, 1.0 - alpha * a_gain], [1.0 + alpha / a_gain, -2.0 * cs, 1.0 - alpha / a_gain])
            }
            "HighShelf" | "LowShelf" => {
                let (am1, ap1) = (a_gain - 1.0, a_gain + 1.0);
                let beta = sn * a_gain.sqrt() / q;
                if mode == "HighShelf" {
                    (
                        [a_gain * (ap1 + am1 * cs + beta), -2.0 * a_gain * (am1 + ap1 * cs), a_gain * (ap1 + am1 * cs - beta)],
                        [ap1 - am1 * cs + beta, 2.0 * (am1 - ap1 * cs), ap1 - am1 * cs - beta],
                    )
                } else {
                    (
                        [a_gain * (ap1 - am1 * cs + beta), 2.0 * a_gain * (am1 - ap1 * cs), a_gain * (ap1 - am1 * cs - beta)],
                        [ap1 + am1 * cs + beta, -2.0 * (am1 + ap1 * cs), ap1 + am1 * cs - beta],
                    )
                }
            }
            "HighPass" | "LowPass" => {
                let alpha = sn / (2.0 * q);
                let b = if mode == "HighPass" { [(1.0 + cs) / 2.0, -(1.0 + cs), (1.0 + cs) / 2.0] } else { [(1.0 - cs) / 2.0, 1.0 - cs, (1.0 - cs) / 2.0] };
                (b, [1.0 + alpha, -2.0 * cs, 1.0 - alpha])
            }
            _ => return None,
        };
        Some(Biquad { b: [b[0] / a[0], b[1] / a[0], b[2] / a[0]], a: [a[1] / a[0], a[2] / a[0]], z: [[0.0; 2]; CHANNELS] })
    }

    fn tick(&mut self, c: usize, x: f32) -> f32 {
        let z = &mut self.z[c];
        let y = self.b[0] * x + z[0];
        z[0] = self.b[1] * x - self.a[0] * y + z[1];
        z[1] = self.b[2] * x - self.a[1] * y;
        y
    }
}

/// SAMI's Equaliser: up to eight filters and an output gain.
struct Equaliser {
    filters: Vec<Biquad>,
    gain: f32,
}

impl Equaliser {
    fn new(p: &BTreeMap<String, Value>, fs: f32) -> Equaliser {
        let filters = (1..=8)
            .filter(|i| !p.get(&format!("Filter {i} Bypass")).is_some_and(boolean))
            .filter_map(|i| {
                let mode = p.get(&format!("Filter {i} Mode"))?.as_str()?.to_string();
                Biquad::new(&mode, get(p, &format!("Filter {i} Freq"), 1000.0) as f32, get(p, &format!("Filter {i} Q"), 1.0) as f32, get(p, &format!("Filter {i} Gain dB"), 0.0) as f32, fs)
            })
            .collect();
        Equaliser { filters, gain: 10f32.powf(get(p, "Gain dB", 0.0) as f32 / 20.0) }
    }
}

impl Processor for Equaliser {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            for (c, x) in frame.iter_mut().enumerate() {
                let mut y = *x;
                for f in &mut self.filters {
                    y = f.tick(c, y);
                }
                *x = y * self.gain;
            }
        }
    }
}

/// A peak limiter: instant attack, exponential release, linked channels.
struct Limiter {
    input: f32,
    ceiling: f32,
    release: f32,
    gain: f32,
}

impl Limiter {
    fn new(input_db: f32, ceiling_db: f32, release_ms: f32, fs: f32) -> Limiter {
        Limiter { input: 10f32.powf(input_db / 20.0), ceiling: 10f32.powf(ceiling_db / 20.0), release: 1.0 - (-1.0 / (release_ms.max(1.0) * 1e-3 * fs)).exp(), gain: 1.0 }
    }
}

impl Processor for Limiter {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            let peak = frame.iter().fold(0f32, |m, x| m.max((x * self.input).abs()));
            let want = if peak > self.ceiling { self.ceiling / peak } else { 1.0 };
            self.gain = if want < self.gain { want } else { self.gain + (want - self.gain) * self.release };
            frame.iter_mut().for_each(|x| *x *= self.input * self.gain);
        }
    }
}

/// A feed-forward compressor with a soft knee.
struct Compressor {
    threshold: f32,
    ratio: f32,
    knee: f32,
    attack: f32,
    release: f32,
    makeup: f32,
    env: f32,
}

impl Compressor {
    fn new(p: &BTreeMap<String, Value>, fs: f32) -> Compressor {
        let coef = |ms: f64| 1.0 - (-1.0 / (ms.max(0.01) as f32 * 1e-3 * fs)).exp();
        let (threshold, ratio) = (get(p, "Threshold dB", 0.0) as f32, get(p, "Ratio", 1.0).max(1.0) as f32);
        let mut makeup = get(p, "Output Gain dB", 0.0) as f32;
        if p.get("Auto Makeup Gain").is_some_and(boolean) {
            // Undo the reduction a full-scale signal gets.
            makeup += -threshold * (1.0 - 1.0 / ratio) * 0.5;
        }
        Compressor { threshold, ratio, knee: get(p, "Knee dB", 0.0) as f32, attack: coef(get(p, "Attack", 5.0)), release: coef(get(p, "Release", 100.0)), makeup: 10f32.powf(makeup / 20.0), env: 0.0 }
    }

    fn reduction_db(&self, level_db: f32) -> f32 {
        let over = level_db - self.threshold;
        let slope = 1.0 - 1.0 / self.ratio;
        if self.knee > 0.0 && over.abs() < self.knee / 2.0 {
            -slope * (over + self.knee / 2.0).powi(2) / (2.0 * self.knee)
        } else if over > 0.0 {
            -slope * over
        } else {
            0.0
        }
    }
}

impl Processor for Compressor {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            let peak = frame.iter().fold(0f32, |m, x| m.max(x.abs()));
            let k = if peak > self.env { self.attack } else { self.release };
            self.env += (peak - self.env) * k;
            let g = 10f32.powf(self.reduction_db(20.0 * self.env.max(1e-9).log10()) / 20.0) * self.makeup;
            frame.iter_mut().for_each(|x| *x *= g);
        }
    }
}

/// A modulated delay mixed with the dry sound; the right channel's sweep is offset by the
/// stereo phase.
struct Chorus {
    line: Vec<[f32; CHANNELS]>,
    at: usize,
    phase: f32,
    step: f32,
    delay: f32,
    depth: f32,
    feedback: f32,
    wet: f32,
    offset: f32,
}

impl Chorus {
    fn new(p: &BTreeMap<String, Value>, fs: f32) -> Chorus {
        let ms = fs / 1000.0;
        let (delay, depth) = (get(p, "Delay", 7.0) as f32 * ms, get(p, "Depth", 2.0) as f32 * ms);
        let len = (delay + depth + 4.0).ceil() as usize + 2;
        Chorus {
            line: vec![[0.0; CHANNELS]; len],
            at: 0,
            phase: 0.0,
            step: 2.0 * PI * get(p, "Rate", 1.0) as f32 / fs,
            delay,
            depth,
            feedback: get(p, "Feedback", 0.0) as f32,
            wet: get(p, "Wetness", 0.5) as f32,
            offset: get(p, "Stereo Phase Offset", 0.0) as f32,
        }
    }
}

impl Processor for Chorus {
    fn process(&mut self, buf: &mut [f32]) {
        let len = self.line.len();
        for frame in buf.chunks_exact_mut(CHANNELS) {
            for (c, x) in frame.iter_mut().enumerate() {
                let d = self.delay + self.depth * 0.5 * (1.0 + (self.phase + c as f32 * self.offset).sin());
                let pos = self.at as f32 + len as f32 - d;
                let (i, f) = (pos.floor() as usize, pos.fract());
                let delayed = self.line[i % len][c] * (1.0 - f) + self.line[(i + 1) % len][c] * f;
                self.line[self.at][c] = *x + self.feedback * delayed;
                *x = *x * (1.0 - self.wet) + delayed * self.wet;
            }
            self.at = (self.at + 1) % len;
            self.phase = (self.phase + self.step) % (2.0 * PI);
        }
    }
}

/// Amplitude modulation at a steady `Rate Hz` from `Phase`, dipping by `Depth` (at most all
/// the way): Demonized's export wobbles at 14 Hz as strongly as this does at depth 1.
/// (`Mod_Rate` isn't known; a sweep of the rate by it doesn't match.)
struct Tremolo {
    phase: f32,
    rate: f32,
    depth: f32,
}

impl Tremolo {
    fn new(p: &BTreeMap<String, Value>, fs: f32) -> Tremolo {
        Tremolo {
            phase: get(p, "Phase", 0.0) as f32,
            rate: 2.0 * PI * get(p, "Rate Hz", 5.0) as f32 / fs,
            depth: (get(p, "Depth", 0.5) as f32).clamp(0.0, 1.0),
        }
    }
}

impl Processor for Tremolo {
    fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.chunks_exact_mut(CHANNELS) {
            let g = 1.0 - self.depth * 0.5 * (1.0 + self.phase.sin());
            frame.iter_mut().for_each(|x| *x *= g);
            self.phase = (self.phase + self.rate) % (2.0 * PI);
        }
    }
}

const PV_SIZE: usize = 2048;
const PV_HOP: usize = PV_SIZE / 4;
/// Cepstral coefficients kept for the spectral envelope (below a 300 Hz voice's period).
const PV_LIFTER: usize = 60;

/// Pitch and formants shifted independently: a phase vocoder moves the harmonics by the
/// pitch ratio, and each frame's spectral envelope (cepstrally smoothed) is moved by the
/// formant ratio instead.
struct PitchShift {
    pitch: f32,
    formant: f32,
    fft: Arc<dyn RealToComplex<f32>>,
    ifft: Arc<dyn ComplexToReal<f32>>,
    window: Vec<f32>,
    ch: [PvChannel; CHANNELS],
    /// Samples since the last frame.
    fill: usize,
}

#[derive(Default)]
struct PvChannel {
    input: Vec<f32>,
    output: Vec<f32>,
    last_phase: Vec<f32>,
    sum_phase: Vec<f32>,
}

impl PitchShift {
    fn new(pitch: f32, formant: f32) -> PitchShift {
        let mut planner = RealFftPlanner::<f32>::new();
        let window = (0..PV_SIZE).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / PV_SIZE as f32).cos()).collect();
        let bins = PV_SIZE / 2 + 1;
        let channel = || PvChannel { input: vec![0.0; PV_SIZE], output: vec![0.0; PV_SIZE], last_phase: vec![0.0; bins], sum_phase: vec![0.0; bins] };
        PitchShift { pitch, formant, fft: planner.plan_fft_forward(PV_SIZE), ifft: planner.plan_fft_inverse(PV_SIZE), window, ch: [channel(), channel()], fill: 0 }
    }

    /// Spectral envelope of a magnitude spectrum: the low quefrencies of its log.
    fn envelope(&self, mag: &[f32]) -> Vec<f32> {
        let mut spec: Vec<Complex32> = mag.iter().map(|m| Complex32::new((m + 1e-9).ln(), 0.0)).collect();
        let mut cep = vec![0f32; PV_SIZE];
        spec[0].im = 0.0;
        let last = spec.len() - 1;
        spec[last].im = 0.0;
        let _ = self.ifft.process(&mut spec, &mut cep);
        for (i, c) in cep.iter_mut().enumerate() {
            let q = i.min(PV_SIZE - i);
            *c = if q < PV_LIFTER { *c / PV_SIZE as f32 } else { 0.0 };
        }
        let mut out = self.fft.make_output_vec();
        let _ = self.fft.process(&mut cep, &mut out);
        out.iter().map(|c| c.re.exp()).collect()
    }

    fn frame(&mut self, c: usize) {
        let bins = PV_SIZE / 2 + 1;
        let mut buf: Vec<f32> = self.ch[c].input.iter().zip(&self.window).map(|(x, w)| x * w).collect();
        let mut spec = self.fft.make_output_vec();
        let _ = self.fft.process(&mut buf, &mut spec);
        let mag: Vec<f32> = spec.iter().map(|z| z.norm()).collect();
        let expected = 2.0 * PI * PV_HOP as f32 / PV_SIZE as f32;
        // Each bin's true frequency (in bins), from its phase advance over the hop.
        let freq: Vec<f32> = (0..bins)
            .map(|k| {
                let phase = spec[k].arg();
                let mut d = phase - self.ch[c].last_phase[k] - k as f32 * expected;
                self.ch[c].last_phase[k] = phase;
                d -= 2.0 * PI * (d / (2.0 * PI)).round();
                k as f32 + d / expected
            })
            .collect();
        let env = self.envelope(&mag);
        let at = |v: &[f32], x: f32| {
            let i = x.floor() as usize;
            if i + 1 >= v.len() {
                return 0.0;
            }
            let f = x - i as f32;
            v[i] * (1.0 - f) + v[i + 1] * f
        };
        let mut out = self.fft.make_output_vec();
        for (j, o) in out.iter_mut().enumerate() {
            let src = j as f32 / self.pitch;
            if src >= (bins - 1) as f32 {
                continue;
            }
            // The harmonic structure moved by the pitch ratio, on the envelope moved by the
            // formant ratio.
            let exc = at(&mag, src) / at(&env, src).max(1e-9);
            let m = exc * at(&env, j as f32 / self.formant);
            let f = freq[src.round() as usize] * self.pitch;
            let ph = &mut self.ch[c].sum_phase[j];
            *ph = (*ph + f * expected) % (2.0 * PI);
            *o = Complex32::from_polar(m, *ph);
        }
        out[0].im = 0.0;
        out[bins - 1].im = 0.0;
        let mut time = vec![0f32; PV_SIZE];
        let _ = self.ifft.process(&mut out, &mut time);
        // Windowed overlap-add: four overlapping Hann² frames sum to 1.5.
        let scale = 1.0 / (PV_SIZE as f32 * 1.5);
        for (i, t) in time.iter().enumerate() {
            self.ch[c].output[i] += t * self.window[i] * scale;
        }
    }
}

impl Processor for PitchShift {
    /// Streaming overlap-add: each sample goes into the analysis window and the next
    /// finished output sample comes out; every `PV_HOP` samples a frame is analysed and added
    /// in. A sample comes out exactly `PV_SIZE` samples after it went in.
    fn process(&mut self, buf: &mut [f32]) {
        for i in 0..buf.len() / CHANNELS {
            for c in 0..CHANNELS {
                let ch = &mut self.ch[c];
                ch.input.push(buf[i * CHANNELS + c]);
                buf[i * CHANNELS + c] = ch.output[self.fill];
            }
            self.fill += 1;
            if self.fill == PV_HOP {
                self.fill = 0;
                for c in 0..CHANNELS {
                    let ch = &mut self.ch[c];
                    ch.input.drain(..PV_HOP);
                    ch.output.drain(..PV_HOP);
                    ch.output.resize(PV_SIZE, 0.0);
                }
                for c in 0..CHANNELS {
                    self.frame(c);
                }
            }
        }
    }

    fn latency(&self) -> usize {
        PV_SIZE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(f: f32, n: usize, fs: f32) -> Vec<f32> {
        (0..n).flat_map(|i| {
            let x = (2.0 * PI * f * i as f32 / fs).sin() * 0.5;
            [x, x]
        }).collect()
    }

    /// Strongest frequency of the left channel (Hz), from a long FFT.
    fn peak_hz(x: &[f32], fs: f32) -> f32 {
        let n = 16384;
        let mut buf: Vec<f32> = x.iter().step_by(2).skip(x.len() / 2 - n).take(n).copied().collect();
        let mut planner = RealFftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(n);
        let mut out = fft.make_output_vec();
        fft.process(&mut buf, &mut out).unwrap();
        let k = out.iter().enumerate().skip(1).max_by(|a, b| a.1.norm().partial_cmp(&b.1.norm()).unwrap()).unwrap().0;
        k as f32 * fs / n as f32
    }

    #[test]
    fn pitch_shift_moves_a_tone_by_the_ratio() {
        let fs = 48_000.0;
        let mut x = sine(220.0, 96_000, fs);
        let mut p = PitchShift::new(2f32.powf(-4.8 / 12.0), 2f32.powf(-6.0 / 12.0));
        for block in x.chunks_mut(1000) {
            p.process(block);
        }
        let got = peak_hz(&x, fs);
        assert!((got - 220.0 * 2f32.powf(-4.8 / 12.0)).abs() < 4.0, "{got} Hz");
    }

    #[test]
    fn the_limiter_holds_the_ceiling() {
        let mut l = Limiter::new(0.0, -0.3, 500.0, 48_000.0);
        let mut x = sine(100.0, 4800, 48_000.0).iter().map(|v| v * 4.0).collect::<Vec<_>>();
        l.process(&mut x);
        assert!(x.iter().all(|v| v.abs() <= 10f32.powf(-0.3 / 20.0) + 1e-4));
    }

    #[test]
    fn transform_curves_interpolate_between_points() {
        let c: Value = serde_json::json!([["0", "0.5"], ["1", "0.4"]]);
        assert!((curve(&c, 0.834) - 0.4166).abs() < 1e-4);
        // Deep's pitch slider at its default gives the preset's own −4 semitones.
        assert!((plain("PitchAndFormantShift", "Pitch Shift Semitone", curve(&c, 0.834)).unwrap().as_f64().unwrap() + 4.0).abs() < 0.01);
    }
}
