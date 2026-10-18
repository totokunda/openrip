//! Audio: decode to 48 kHz stereo `f32`, and the timeline mixer.
//!
//! Mixing follows CapCut (docs/parity/calibration.md, session 1): muted and hidden tracks
//! are silent, every other clip's audio is summed at its volume (keyframes included) with
//! its fades. Video clips contribute their own sound. Speed changes keep the pitch (CapCut's
//! default; FFmpeg's atempo) unless the clip asks for the pitch to follow the speed
//! (`change_pitch`), which resamples. Reversed clips play their audio backwards (CapCut's
//! copy played backward where it has one), then through the same speed change. A speed curve
//! plays varispeed, the pitch following the speed, as CapCut's does. A clip's channel fill
//! (CapCut's "Fill channel") applies after the speed change; then its voice filters (CapCut's
//! audio effects, see [`fx`], or OpenRip's own, see [`voice`]), one after another, and then
//! its volume: keyframed volume is followed sample by sample, so a ramp sounds the same
//! whatever the size of the blocks it's mixed in. The mix is limited at full scale, as
//! CapCut's exports are (docs/parity/voice-effects.md).
//!
//! Besides mixing: loudness as EBU R128 measures it ([`loudness`], for loudness
//! normalisation) and beat detection ([`beats`], for beat markers).

pub mod beats;
#[cfg(feature = "ffmpeg")]
mod decode;
pub mod fx;
pub mod loudness;
mod peaks;
mod reverb;
mod source;
pub mod voice;
#[cfg(feature = "ffmpeg")]
mod tempo;

/// Without FFmpeg there is no pitch-keeping time-stretch yet: sped-up clips are resampled,
/// their pitch following the speed (todo: a portable WSOLA in place of `atempo`).
#[cfg(not(feature = "ffmpeg"))]
mod tempo {
    use crate::AudioError;

    pub(crate) const AVAILABLE: bool = false;

    pub(crate) struct Tempo;

    impl Tempo {
        pub(crate) fn new(_rate: u32, _speed: f64) -> Result<Tempo, AudioError> {
            Err(AudioError::Other("no time-stretch in this build".into()))
        }

        pub(crate) fn available(&self) -> usize {
            0
        }

        pub(crate) fn push(&mut self, _samples: &[f32]) -> Result<(), AudioError> {
            Ok(())
        }

        pub(crate) fn take(&mut self, _out: &mut [f32]) {}
    }
}

use std::collections::HashMap;
use std::path::Path;

use openrip_model::{AudioFade, ChannelFill, EffectCategory, MediaKind, Micros, Project, Remap, Segment, TrackKind};

#[cfg(feature = "ffmpeg")]
pub use decode::AudioDecoder;
pub use peaks::{peaks, Peaks};
pub use source::{add_audio_backend, open_audio, AudioBackend, AudioSource};

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

/// Source samples fed to a constant speed's stretcher at a time.
const STRETCH_CHUNK: usize = 1024;

/// Linear interpolation of interleaved stereo `src` at the positions `at(i)` (in samples) for
/// each output sample `i` of `out`.
fn resample(src: &[f32], at: impl Fn(usize) -> f64, out: &mut [f32]) {
    let last = src.len().saturating_sub(1);
    for i in 0..out.len() / CHANNELS {
        let x = at(i).max(0.0);
        let (k, f) = (x.floor() as usize, (x - x.floor()) as f32);
        for c in 0..CHANNELS {
            let a = src[(k * CHANNELS + c).min(last)];
            let b = src[((k + 1) * CHANNELS + c).min(last)];
            out[i * CHANNELS + c] = a + (b - a) * f;
        }
    }
}

/// Copy one channel over the other, or both to their mean (interleaved stereo, in place).
fn fill_channels(fill: ChannelFill, samples: &mut [f32]) {
    for f in samples.chunks_exact_mut(CHANNELS) {
        match fill {
            ChannelFill::None => return,
            ChannelFill::Left => f[1] = f[0],
            ChannelFill::Right => f[0] = f[1],
            ChannelFill::Mono => {
                let m = 0.5 * (f[0] + f[1]);
                f[0] = m;
                f[1] = m;
            }
        }
    }
}

/// A sped-up clip's time-stretcher, kept while the mix stays continuous.
struct Stretch {
    tempo: tempo::Tempo,
    /// Clip-local output sample the stretcher continues at.
    next_out: i64,
    /// Next source sample to feed it.
    next_in: i64,
}

/// A clip's voice filters, kept while the mix stays continuous. They run ahead of the mix by
/// their latency, so what comes out lines up with the clip.
struct Voice {
    chains: Vec<fx::Chain>,
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
    /// Reversed clips whose decoder reads the copy played backward, with the time it mirrors
    /// about (the media's length: the copy's `t` is the media's `length - t`).
    copies: HashMap<String, Micros>,
    /// One decoder per clip; `None` once a clip turned out to have no usable audio.
    decoders: HashMap<String, Option<Box<dyn AudioSource>>>,
    /// Voice filters by clip; `None` when none of a clip's filters could be loaded.
    voices: HashMap<String, Option<Voice>>,
    /// The output limiter's gain, and the sample it continues at (a jump resets it).
    limiter: (f32, i64),
    resampled: Vec<f32>,
}

impl Mixer {
    /// A mixer at the default [`RATE`].
    pub fn new(project: Project) -> Self {
        Self::with_rate(project, RATE)
    }

    pub fn with_rate(project: Project, rate: u32) -> Self {
        Mixer { project, rate, stretches: HashMap::new(), reversed: HashMap::new(), copies: HashMap::new(), decoders: HashMap::new(), voices: HashMap::new(), limiter: (1.0, -1), resampled: Vec::new() }
    }

    pub fn rate(&self) -> u32 {
        self.rate
    }

    /// Replace the project after an edit, keeping decoders of clips that still exist.
    pub fn set_project(&mut self, project: Project) {
        let ids: std::collections::HashSet<&str> = project.tracks.iter().flat_map(|t| t.segments.iter().map(|s| s.id.as_str())).collect();
        self.decoders.retain(|id, _| ids.contains(id.as_str()));
        self.copies.retain(|id, _| ids.contains(id.as_str()));
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
            // A reversed clip plays the copy CapCut rendered backward (with its sound) where
            // it's readable, forward from the mirrored time.
            let copy = if seg.reverse { media.reverse_path.clone().filter(|p| openrip_platform::assets::exists(Path::new(p))) } else { None };
            let mirror = copy.as_ref().map(|_| media.duration);
            let path = copy.unwrap_or_else(|| media.path.clone());
            if !self.decoders.contains_key(&seg.id) {
                match mirror {
                    Some(d) => self.copies.insert(seg.id.clone(), d),
                    None => self.copies.remove(&seg.id),
                };
                let d = match open_audio(Path::new(&path), self.rate) {
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
            let fetched = match self.voice_of(&seg, local, decoder.as_mut(), &mut report) {
                // The filter runs `latency` samples ahead: feed it from where it's got to.
                Some(at) => self.clip_samples(&seg, decoder.as_mut(), at, n).map(|mut block| {
                        if let Some(Some(voice)) = self.voices.get_mut(&seg.id) {
                            voice.chains.iter_mut().for_each(|c| c.process(&mut block));
                            voice.next_feed += n as i64;
                            voice.next_out += n as i64;
                        }
                        block
                    }),
                None => self.clip_samples(&seg, decoder.as_mut(), local, n),
            };
            self.decoders.insert(seg.id.clone(), Some(decoder));
            let samples = fetched?;
            // Volume (keyframes interpolated across the block) and fades.
            let fade = seg.attachments.iter().find_map(|id| self.project.materials.audio_fades.iter().find(|f| &f.id == id)).cloned();
            // CapCut's loudness normalisation scales the clip as a whole.
            let norm = seg.attachments.iter().find_map(|id| self.project.materials.loudness.iter().find(|l| &l.id == id)).map_or(1.0, |l| l.gain());
            // Keyframed volume at each sample's own time; otherwise one gain for the block.
            let keyed = seg.volume.is_animated();
            let g0 = norm * seg.volume.sample(time_at(local, rate));
            let len = (s1 - s0).max(1);
            let base = (from - start) as usize * CHANNELS;
            for i in 0..n {
                let pos = local + i as i64;
                let mut gain = if keyed { norm * seg.volume.sample(time_at(pos, rate)) } else { g0 };
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
    /// applied, its channels filled (interleaved stereo).
    fn clip_samples(&mut self, seg: &Segment, decoder: &mut dyn AudioSource, local: i64, n: usize) -> Result<Vec<f32>, AudioError> {
        let mut out = self.played_samples(seg, decoder, local, n)?;
        let fill = seg.attachments.iter().find_map(|id| self.project.materials.channels.iter().find(|c| &c.id == id)).map_or(ChannelFill::None, |c| c.fill);
        fill_channels(fill, &mut out);
        Ok(out)
    }

    /// [`Mixer::clip_samples`] before the channel fill.
    fn played_samples(&mut self, seg: &Segment, decoder: &mut dyn AudioSource, local: i64, n: usize) -> Result<Vec<f32>, AudioError> {
        let speed = if seg.speed > 0.0 { seg.speed } else { 1.0 };
        let mut out = vec![0f32; n * CHANNELS];
        if let Some(remap) = seg.speed_curve(&self.project.materials).and_then(|s| Remap::new(&s.curve)) {
            self.curved(seg, decoder, &remap, local, &mut out)?;
            return Ok(out);
        }
        // Where the block starts in the clip's source as it plays it.
        let pos = (local as f64 * speed).round() as i64;
        if (speed - 1.0).abs() < 1e-9 {
            self.played(seg, decoder, pos, &mut out)?;
        } else if !seg.change_pitch && tempo::AVAILABLE {
            // Keep the pitch: stream the source through atempo.
            let fresh = self.stretches.get(&seg.id).is_none_or(|st| st.next_out != local);
            if fresh {
                self.stretches.insert(seg.id.clone(), Stretch { tempo: tempo::Tempo::new(self.rate, speed)?, next_out: local, next_in: pos });
            }
            let mut feed = vec![0f32; STRETCH_CHUNK * CHANNELS];
            let mut guard = 0;
            while self.stretches[&seg.id].tempo.available() < n && guard < 10_000 {
                let next_in = self.stretches[&seg.id].next_in;
                self.played(seg, decoder, next_in, &mut feed)?;
                let st = self.stretches.get_mut(&seg.id).unwrap();
                st.tempo.push(&feed)?;
                st.next_in += STRETCH_CHUNK as i64;
                guard += 1;
            }
            let st = self.stretches.get_mut(&seg.id).unwrap();
            st.tempo.take(&mut out);
            st.next_out += n as i64;
        } else {
            // Linear resampling: the pitch follows the speed.
            let need = (n as f64 * speed).ceil() as usize + 2;
            let mut src = std::mem::take(&mut self.resampled);
            src.resize(need * CHANNELS, 0.0);
            self.played(seg, decoder, pos, &mut src)?;
            resample(&src, |i| i as f64 * speed, &mut out);
            self.resampled = src;
        }
        Ok(out)
    }

    /// A curved clip's sound (`clip_samples`), as CapCut plays it: varispeed, each sample read
    /// at the source time the remap gives and interpolated, so the pitch follows the speed
    /// (CapCut's curve ignores "change pitch"; docs/parity/speed.md).
    fn curved(&mut self, seg: &Segment, decoder: &mut dyn AudioSource, remap: &Remap, local: i64, out: &mut [f32]) -> Result<(), AudioError> {
        let rate = self.rate;
        let n = out.len() / CHANNELS;
        let length = (sample_at(seg.target.end(), rate) - sample_at(seg.target.start, rate)).max(1) as f64;
        let source = seg.source.map_or(length, |s| sample_at(s.duration, rate).max(1) as f64);
        // Source position (as played) at clip-local sample `i`.
        let at = |i: i64| remap.source_at(i as f64 / length) * source;
        let (first, last) = (at(local), at(local + n as i64));
        let base = first.floor() as i64;
        let need = (last.ceil() as i64 - base).max(0) as usize + 2;
        let mut src = std::mem::take(&mut self.resampled);
        src.resize(need * CHANNELS, 0.0);
        self.played(seg, decoder, base, &mut src)?;
        resample(&src, |i| at(local + i as i64) - base as f64, out);
        self.resampled = src;
        Ok(())
    }

    /// The clip's source samples in the order it plays them, from `pos` samples into its
    /// playback (0 is its in-point, or its out-point when reversed), into `out`.
    fn played(&mut self, seg: &Segment, decoder: &mut dyn AudioSource, pos: i64, out: &mut [f32]) -> Result<(), AudioError> {
        let rate = self.rate;
        let n = out.len() / CHANNELS;
        let source = seg.source.unwrap_or_default();
        if !seg.reverse {
            return decoder.read(sample_at(source.start, rate) + pos, out);
        }
        if let Some(&length) = self.copies.get(&seg.id) {
            // The copy played backward, forward from the out-point's mirror.
            return decoder.read(sample_at(length - source.end(), rate) + pos, out);
        }
        // Backward from the out-point: sample i is source sample `last - (pos + i)`.
        let hi = sample_at(source.end(), rate) - 1 - pos;
        let lo = hi - n as i64;
        let fits = self.reversed.get(&seg.id).is_some_and(|w| w.start <= lo.max(0) && hi < w.start + (w.samples.len() / CHANNELS) as i64);
        if !fits {
            // Decode a second (plus this block) ending at `hi`, reading forward once.
            let start = (lo - rate as i64).max(0);
            let mut samples = vec![0f32; ((hi - start + 1).max(0) as usize) * CHANNELS];
            decoder.read(start, &mut samples)?;
            self.reversed.insert(seg.id.clone(), ReverseWindow { start, samples });
        }
        let w = &self.reversed[&seg.id];
        let have = (w.samples.len() / CHANNELS) as i64;
        for i in 0..n {
            let src = hi - i as i64;
            let k = (src - w.start).clamp(0, (have - 1).max(0)) as usize;
            for c in 0..CHANNELS {
                out[i * CHANNELS + c] = if src >= 0 && have > 0 { w.samples[k * CHANNELS + c] } else { 0.0 };
            }
        }
        Ok(())
    }

    /// The clip's voice filters, ready for the block at clip-local `local`: where their input
    /// for that block starts, or `None` for a clip without any (or none of whose filters
    /// load). A filter is CapCut's (its bundle, `resource`) or OpenRip's own (`builtin`
    /// names its kind).
    fn voice_of(&mut self, seg: &Segment, local: i64, decoder: &mut dyn AudioSource, report: &mut MixReport) -> Option<i64> {
        let effects: Vec<openrip_model::Effect> = seg.attachments.iter().filter_map(|id| self.project.materials.effects.iter().find(|e| &e.id == id && e.category == EffectCategory::Audio)).cloned().collect();
        if effects.is_empty() {
            return None;
        }
        let continuous = matches!(self.voices.get(&seg.id), Some(Some(v)) if v.next_out == local);
        if !continuous {
            if matches!(self.voices.get(&seg.id), Some(None)) {
                return None;
            }
            let mut chains = Vec::new();
            for effect in &effects {
                let (what, chain) = match (&effect.resource, &effect.builtin) {
                    (Some(bundle), _) => (bundle.clone(), fx::Chain::load(Path::new(bundle), &effect.params, self.rate)),
                    (None, Some(kind)) => (kind.clone(), voice::builtin(kind, &effect.params, self.rate)),
                    (None, None) => continue,
                };
                match chain {
                    Ok(c) => {
                        for m in &c.missing {
                            report.missing.push(format!("{what}: no {m} processor"));
                        }
                        chains.push(c);
                    }
                    Err(why) => report.missing.push(format!("{what}: {why}")),
                }
            }
            if chains.is_empty() {
                self.voices.insert(seg.id.clone(), None);
                return None;
            }
            // Prime them with the block's first `latency` samples: their output then starts
            // at the block.
            let lat: usize = chains.iter().map(|c| c.latency()).sum();
            if let Ok(mut pre) = self.clip_samples(seg, decoder, local, lat) {
                chains.iter_mut().for_each(|c| c.process(&mut pre));
            }
            self.voices.insert(seg.id.clone(), Some(Voice { chains, next_out: local, next_feed: local + lat as i64 }));
        }
        match self.voices.get(&seg.id) {
            Some(Some(v)) => Some(v.next_feed),
            _ => None,
        }
    }
}
