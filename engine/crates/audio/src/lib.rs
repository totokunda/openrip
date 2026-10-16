//! Audio: decode to 48 kHz stereo `f32`, and the timeline mixer.
//!
//! Mixing follows CapCut (docs/parity/calibration.md, session 1): muted and hidden tracks
//! are silent, every other clip's audio is summed at its volume (keyframes included) with
//! its fades. Video clips contribute their own sound. Speed changes keep the pitch (CapCut's
//! default; FFmpeg's atempo) unless the clip asks for the pitch to follow the speed
//! (`change_pitch`), which resamples. Reversed clips play their audio backwards. A clip's
//! voice filter (CapCut's audio effect, see [`fx`]) works on its sound after the speed
//! change and before its volume. The mix is limited at full scale, as CapCut's exports are
//! (docs/parity/voice-effects.md).

mod decode;
pub mod fx;
mod peaks;
mod tempo;

use std::collections::HashMap;
use std::path::Path;

use openrip_model::{AudioFade, EffectCategory, MediaKind, Micros, Project, Segment, TrackKind};

pub use decode::AudioDecoder;
pub use peaks::{peaks, Peaks};

/// The mixer's default rate (playback); export uses CapCut's 44.1 kHz.
pub const RATE: u32 = 48_000;
pub const CHANNELS: usize = 2;

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("{op} failed ({code})")]
    Ffmpeg { op: &'static str, code: i32 },
    #[error("{0}")]
    Other(String),
}

/// The sample index of a time at `rate`, rounded to the nearest sample.
pub fn sample_at(t: Micros, rate: u32) -> i64 {
    (t.0 as i128 * rate as i128 + 500_000).div_euclid(1_000_000) as i64
}

fn time_at(sample: i64, rate: u32) -> Micros {
    Micros((sample as i128 * 1_000_000 / rate as i128) as i64)
}

/// [`sample_at`] at the default [`RATE`].
pub fn sample_of(t: Micros) -> i64 {
    sample_at(t, RATE)
}

/// What a block of mixing involved.
#[derive(Clone, Debug, Default)]
pub struct MixReport {
    /// Clips that contributed sound.
    pub clips: usize,
    /// Media files that couldn't be opened (once each per mixer), and voice-filter
    /// processors OpenRip doesn't have.
    pub missing: Vec<String>,
}

/// A sped-up clip's time-stretcher, kept while the mix stays continuous.
struct Stretch {
    tempo: tempo::Tempo,
    /// Clip-local output sample the stretcher continues at.
    next_out: i64,
    /// Next source sample to feed it.
    next_in: i64,
}

/// A clip's voice filter, kept while the mix stays continuous. It runs ahead of the mix by
/// its latency, so what comes out lines up with the clip.
struct Voice {
    chain: fx::Chain,
    /// Clip-local sample the next block of output is for.
    next_out: i64,
    /// Clip-local sample to feed the filter next.
    next_feed: i64,
}

/// A decoded stretch of a reversed clip's source, so mixing backwards seeks about once a
/// second rather than every block.
struct ReverseWindow {
    start: i64,
    samples: Vec<f32>,
}

pub struct Mixer {
    project: Project,
    rate: u32,
    stretches: HashMap<String, Stretch>,
    reversed: HashMap<String, ReverseWindow>,
    /// One decoder per clip; `None` once a clip turned out to have no usable audio.
    decoders: HashMap<String, Option<AudioDecoder>>,
    /// Voice filters by clip; `None` when a clip's filter couldn't be loaded.
    voices: HashMap<String, Option<Voice>>,
    /// The output limiter's gain, and the sample it continues at (a jump resets it).
    limiter: (f32, i64),
    scratch: Vec<f32>,
    resampled: Vec<f32>,
}

impl Mixer {
    /// A mixer at the default [`RATE`].
    pub fn new(project: Project) -> Self {
        Self::with_rate(project, RATE)
    }

    pub fn with_rate(project: Project, rate: u32) -> Self {
        Mixer { project, rate, stretches: HashMap::new(), reversed: HashMap::new(), decoders: HashMap::new(), voices: HashMap::new(), limiter: (1.0, -1), scratch: Vec::new(), resampled: Vec::new() }
    }

    pub fn rate(&self) -> u32 {
        self.rate
    }

    /// Replace the project after an edit, keeping decoders of clips that still exist.
    pub fn set_project(&mut self, project: Project) {
        let ids: std::collections::HashSet<&str> = project.tracks.iter().flat_map(|t| t.segments.iter().map(|s| s.id.as_str())).collect();
        self.decoders.retain(|id, _| ids.contains(id.as_str()));
        self.stretches.clear();
        self.reversed.clear();
        self.voices.clear();
        self.project = project;
    }

    /// Mix the timeline into `out` (interleaved stereo) starting at sample `start`.
    pub fn mix(&mut self, start: i64, out: &mut [f32]) -> Result<MixReport, AudioError> {
        out.fill(0.0);
        let rate = self.rate;
        let frames = (out.len() / CHANNELS) as i64;
        let end = start + frames;
        let mut report = MixReport::default();
        let clips: Vec<Segment> = self
            .project
            .tracks
            .iter()
            .filter(|t| matches!(t.kind, TrackKind::Video | TrackKind::Audio) && !t.muted && !t.hidden)
            .flat_map(|t| t.segments.iter().filter(|s| s.visible && sample_at(s.target.start, rate) < end && sample_at(s.target.end(), rate) > start).cloned())
            .collect();
        for seg in clips {
            let Some(media) = self.project.materials.media.iter().find(|m| m.id == seg.material) else { continue };
            if media.kind == MediaKind::Photo || (media.kind == MediaKind::Video && !media.has_audio) {
                continue;
            }
            let path = media.path.clone();
            if !self.decoders.contains_key(&seg.id) {
                let d = match AudioDecoder::open(Path::new(&path), self.rate) {
                    Ok(d) => d,
                    Err(_) => {
                        report.missing.push(path.clone());
                        None
                    }
                };
                self.decoders.insert(seg.id.clone(), d);
            }
            let Some(Some(mut decoder)) = self.decoders.remove(&seg.id) else { continue };
            let (s0, s1) = (sample_at(seg.target.start, rate), sample_at(seg.target.end(), rate));
            let (from, to) = (start.max(s0), end.min(s1));
            let n = (to - from) as usize;
            let local = from - s0;
            let fetched = match self.voice_of(&seg, local, &mut decoder, &mut report) {
                // The filter runs `latency` samples ahead: feed it from where it's got to.
                Some(at) => self.clip_samples(&seg, &mut decoder, at, n).map(|mut block| {
                        if let Some(Some(voice)) = self.voices.get_mut(&seg.id) {
                            voice.chain.process(&mut block);
                            voice.next_feed += n as i64;
                            voice.next_out += n as i64;
                        }
                        block
                    }),
                None => self.clip_samples(&seg, &mut decoder, local, n),
            };
            self.decoders.insert(seg.id.clone(), Some(decoder));
            let samples = fetched?;
            // Volume (keyframes interpolated across the block) and fades.
            let fade = seg.attachments.iter().find_map(|id| self.project.materials.audio_fades.iter().find(|f| &f.id == id)).cloned();
            // CapCut's loudness normalisation scales the clip as a whole.
            let norm = seg.attachments.iter().find_map(|id| self.project.materials.loudness.iter().find(|l| &l.id == id)).map_or(1.0, |l| l.gain());
            let (g0, g1) = (norm * seg.volume.sample(time_at(local, rate)), norm * seg.volume.sample(time_at(local + n as i64, rate)));
            let len = (s1 - s0).max(1);
            let base = (from - start) as usize * CHANNELS;
            for i in 0..n {
                let pos = local + i as i64;
                let mut gain = g0 + (g1 - g0) * (i as f32 / n.max(1) as f32);
                if let Some(AudioFade { fade_in, fade_out, .. }) = fade {
                    let (fi, fo) = (sample_at(fade_in, rate), sample_at(fade_out, rate));
                    if fi > 0 && pos < fi {
                        gain *= pos as f32 / fi as f32;
                    }
                    if fo > 0 && len - pos < fo {
                        gain *= (len - pos) as f32 / fo as f32;
                    }
                }
                for c in 0..CHANNELS {
                    out[base + i * CHANNELS + c] += samples[i * CHANNELS + c] * gain;
                }
            }
            report.clips += 1;
        }
        self.limit(start, out);
        Ok(report)
    }

    /// Hold the mix within full scale: instant attack, a 350 ms release. CapCut's exports
    /// never go over (where a 458% clip on a voice would take OpenRip's mix to twice full
    /// scale, CapCut's export peaks at 1.00 and a 300–500 ms release matches its level).
    fn limit(&mut self, start: i64, out: &mut [f32]) {
        const RELEASE_S: f32 = 0.35;
        let (mut gain, next) = self.limiter;
        if next != start {
            gain = 1.0;
        }
        let release = 1.0 - (-1.0 / (RELEASE_S * self.rate as f32)).exp();
        for frame in out.chunks_exact_mut(CHANNELS) {
            let peak = frame.iter().fold(0f32, |m, x| m.max(x.abs()));
            let want = if peak > 1.0 { 1.0 / peak } else { 1.0 };
            gain = if want < gain { want } else { gain + (want - gain) * release };
            if gain < 1.0 {
                frame.iter_mut().for_each(|x| *x *= gain);
            }
        }
        self.limiter = (gain, start + (out.len() / CHANNELS) as i64);
    }
    /// A clip's sound for `n` samples from clip-local sample `local`, speed and direction
    /// applied (interleaved stereo).
    fn clip_samples(&mut self, seg: &Segment, decoder: &mut AudioDecoder, local: i64, n: usize) -> Result<Vec<f32>, AudioError> {
        let rate = self.rate;
        let source_start = seg.source.map_or(0, |s| sample_at(s.start, rate));
        let speed = if seg.speed > 0.0 { seg.speed } else { 1.0 };
        let src_at = source_start + (local as f64 * speed).round() as i64;
        self.scratch.resize(n * CHANNELS, 0.0);
        let samples: &[f32] = if seg.reverse {
            // Backwards from the out-point: sample i of the block is source sample
            // last - (local + i) * speed.
            let source_end = seg.source.map_or(0, |s| sample_at(s.end(), rate));
            let hi = source_end - 1 - (local as f64 * speed).round() as i64;
            let lo = hi - (n as f64 * speed).ceil() as i64;
            let fits = self.reversed.get(&seg.id).is_some_and(|w| w.start <= lo.max(0) && hi < w.start + (w.samples.len() / CHANNELS) as i64);
            if !fits {
                // Decode a second (plus this block) ending at `hi`, reading forward once.
                let start = (lo - rate as i64).max(0);
                let mut samples = vec![0f32; ((hi - start + 1).max(0) as usize) * CHANNELS];
                decoder.read(start, &mut samples)?;
                self.reversed.insert(seg.id.clone(), ReverseWindow { start, samples });
            }
            let w = &self.reversed[&seg.id];
            for i in 0..n {
                let src = hi - (i as f64 * speed).round() as i64;
                let k = (src - w.start).clamp(0, (w.samples.len() / CHANNELS) as i64 - 1) as usize;
                for c in 0..CHANNELS {
                    self.scratch[i * CHANNELS + c] = if src >= 0 { w.samples[k * CHANNELS + c] } else { 0.0 };
                }
            }
            &self.scratch
        } else if (speed - 1.0).abs() < 1e-9 {
            decoder.read(src_at, &mut self.scratch)?;
            &self.scratch
        } else if !seg.change_pitch {
            // Keep the pitch: stream the source through atempo.
            let rate = self.rate;
            let fresh = self.stretches.get(&seg.id).is_none_or(|st| st.next_out != local);
            if fresh {
                self.stretches.insert(seg.id.clone(), Stretch { tempo: tempo::Tempo::new(rate, speed)?, next_out: local, next_in: src_at });
            }
            let st = self.stretches.get_mut(&seg.id).unwrap();
            let chunk = 1024usize;
            let mut feed = vec![0f32; chunk * CHANNELS];
            let mut guard = 0;
            while st.tempo.available() < n && guard < 10_000 {
                decoder.read(st.next_in, &mut feed)?;
                st.tempo.push(&feed)?;
                st.next_in += chunk as i64;
                guard += 1;
            }
            st.tempo.take(&mut self.scratch);
            st.next_out += n as i64;
            &self.scratch
        } else {
            // Linear resampling: pitch follows speed until time-stretching lands.
            let need = (n as f64 * speed).ceil() as usize + 2;
            self.resampled.resize(need * CHANNELS, 0.0);
            decoder.read(src_at, &mut self.resampled)?;
            for i in 0..n {
                let x = i as f64 * speed;
                let (k, f) = (x.floor() as usize, (x - x.floor()) as f32);
                for c in 0..CHANNELS {
                    let a = self.resampled[(k * CHANNELS + c).min(self.resampled.len() - 1)];
                    let b = self.resampled[((k + 1) * CHANNELS + c).min(self.resampled.len() - 1)];
                    self.scratch[i * CHANNELS + c] = a + (b - a) * f;
                }
            }
            &self.scratch
        };
        Ok(samples.to_vec())
    }

    /// The clip's voice filter, ready for the block at clip-local `local`: where its input
    /// for that block starts, or `None` for a clip without one (or whose filter can't load).
    fn voice_of(&mut self, seg: &Segment, local: i64, decoder: &mut AudioDecoder, report: &mut MixReport) -> Option<i64> {
        let effect = seg.attachments.iter().find_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id && e.category == EffectCategory::Audio))?.clone();
        let continuous = matches!(self.voices.get(&seg.id), Some(Some(v)) if v.next_out == local);
        if !continuous {
            if matches!(self.voices.get(&seg.id), Some(None)) {
                return None;
            }
            let bundle = effect.resource.clone()?;
            let mut chain = match fx::Chain::load(Path::new(&bundle), &effect.params, self.rate) {
                Ok(c) => c,
                Err(why) => {
                    report.missing.push(format!("{bundle}: {why}"));
                    self.voices.insert(seg.id.clone(), None);
                    return None;
                }
            };
            for m in &chain.missing {
                report.missing.push(format!("{bundle}: no {m} processor"));
            }
            // Prime it with the block's first `latency` samples: its output then starts at
            // the block.
            let lat = chain.latency();
            if let Ok(mut pre) = self.clip_samples(seg, decoder, local, lat) {
                chain.process(&mut pre);
            }
            self.voices.insert(seg.id.clone(), Some(Voice { chain, next_out: local, next_feed: local + lat as i64 }));
        }
        match self.voices.get(&seg.id) {
            Some(Some(v)) => Some(v.next_feed),
            _ => None,
        }
    }
}
