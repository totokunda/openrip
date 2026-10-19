//! Audio-only export: the project's mix (at [`AUDIO_RATE`], stereo) written as a WAV, FLAC,
//! MP3 or AAC (M4A) file.
//!
//! WAV and FLAC are written in pure Rust, so they work wherever the engine does. MP3 (LAME,
//! statically linked, LGPL) and AAC (FFmpeg's encoder in an MP4 container) come with the
//! `ffmpeg` feature, the build that has the platform's other built-in backends.

use std::path::Path;
use std::time::Instant;

use openrip_model::Project;

use crate::{ExportError, ExportStats, AUDIO_RATE};

/// The sound file formats an audio export writes.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum AudioFormat {
    Mp3,
    Wav,
    Aac,
    Flac,
}

impl AudioFormat {
    /// "mp3", "wav", "aac" (or "m4a") and "flac", in any case.
    pub fn named(name: &str) -> Option<AudioFormat> {
        match name.to_ascii_lowercase().as_str() {
            "mp3" => Some(AudioFormat::Mp3),
            "wav" => Some(AudioFormat::Wav),
            "aac" | "m4a" => Some(AudioFormat::Aac),
            "flac" => Some(AudioFormat::Flac),
            _ => None,
        }
    }

    /// The file extension: AAC goes in an MP4 audio file, `.m4a`.
    pub fn extension(self) -> &'static str {
        match self {
            AudioFormat::Mp3 => "mp3",
            AudioFormat::Wav => "wav",
            AudioFormat::Aac => "m4a",
            AudioFormat::Flac => "flac",
        }
    }

    /// Whether this build can write it.
    pub fn available(self) -> bool {
        match self {
            AudioFormat::Wav | AudioFormat::Flac => true,
            AudioFormat::Mp3 => cfg!(feature = "ffmpeg"),
            AudioFormat::Aac => cfg!(feature = "ffmpeg"),
        }
    }

    /// The bit rate of the lossy formats, in bits per second (CapCut's audio exports are 192 kbps class).
    pub fn bitrate(self) -> Option<u64> {
        match self {
            AudioFormat::Mp3 | AudioFormat::Aac => Some(192_000),
            _ => None,
        }
    }
}

fn to_i16(samples: &[f32]) -> Vec<i16> {
    samples.iter().map(|s| (s.clamp(-1.0, 1.0) * 32767.0).round() as i16).collect()
}

/// Mix `project` and write it to `path`. `progress` gets (seconds mixed, seconds total) and
/// returns whether to go on; stopping removes nothing written yet and returns
/// [`ExportError::Cancelled`].
pub fn export_audio(project: Project, path: &Path, format: AudioFormat, mut progress: impl FnMut(u64, u64) -> bool) -> Result<ExportStats, ExportError> {
    let t0 = Instant::now();
    let duration = project.duration();
    let total = openrip_audio::sample_at(duration, AUDIO_RATE).max(0);
    let mut mixer = openrip_audio::Mixer::with_rate(project, AUDIO_RATE);
    let mut pcm: Vec<f32> = Vec::with_capacity(total as usize * 2);
    let step = AUDIO_RATE as i64;
    let seconds = ((total + step - 1) / step).max(1) as u64;
    let mut at = 0i64;
    let mut block = Vec::new();
    while at < total {
        let n = step.min(total - at);
        block.clear();
        block.resize(n as usize * 2, 0.0);
        mixer.mix(at, &mut block).map_err(|e| ExportError::Other(e.to_string()))?;
        pcm.extend_from_slice(&block);
        at += n;
        if !progress((at / step) as u64, seconds) {
            return Err(ExportError::Cancelled);
        }
    }
    let mixed = t0.elapsed().as_secs_f64();
    let bytes = match format {
        AudioFormat::Wav => wav(&to_i16(&pcm)),
        AudioFormat::Flac => flac(&to_i16(&pcm))?,
        AudioFormat::Mp3 => mp3(&to_i16(&pcm), format.bitrate().unwrap())?,
        AudioFormat::Aac => {
            #[cfg(feature = "ffmpeg")]
            {
                crate::aac_file::write(path, &pcm, format.bitrate().unwrap() as i64)?;
                return Ok(ExportStats { frames: 0, seconds: t0.elapsed().as_secs_f64(), render_seconds: mixed, encode_seconds: t0.elapsed().as_secs_f64() - mixed, skipped_layers: 0 });
            }
            #[cfg(not(feature = "ffmpeg"))]
            return Err(ExportError::Other("no AAC encoder in this build".into()));
        }
    };
    std::fs::write(path, bytes).map_err(|e| ExportError::Other(format!("can't write {}: {e}", path.display())))?;
    Ok(ExportStats { frames: 0, seconds: t0.elapsed().as_secs_f64(), render_seconds: mixed, encode_seconds: t0.elapsed().as_secs_f64() - mixed, skipped_layers: 0 })
}

/// A 16-bit PCM stereo WAV file.
pub fn wav(samples: &[i16]) -> Vec<u8> {
    let data = samples.len() as u32 * 2;
    let mut v = Vec::with_capacity(44 + data as usize);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36 + data).to_le_bytes());
    v.extend_from_slice(b"WAVEfmt ");
    v.extend_from_slice(&16u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&2u16.to_le_bytes());
    v.extend_from_slice(&AUDIO_RATE.to_le_bytes());
    v.extend_from_slice(&(AUDIO_RATE * 4).to_le_bytes());
    v.extend_from_slice(&4u16.to_le_bytes());
    v.extend_from_slice(&16u16.to_le_bytes());
    v.extend_from_slice(b"data");
    v.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        v.extend_from_slice(&s.to_le_bytes());
    }
    v
}

fn flac(samples: &[i16]) -> Result<Vec<u8>, ExportError> {
    use flacenc::component::BitRepr;
    use flacenc::error::Verify;
    let config = flacenc::config::Encoder::default().into_verified().map_err(|e| ExportError::Other(format!("flac: {e:?}")))?;
    let ints: Vec<i32> = samples.iter().map(|&s| s as i32).collect();
    let source = flacenc::source::MemSource::from_samples(&ints, 2, 16, AUDIO_RATE as usize);
    let stream = flacenc::encode_with_fixed_block_size(&config, source, config.block_size).map_err(|e| ExportError::Other(format!("flac: {e:?}")))?;
    let mut sink = flacenc::bitsink::ByteSink::new();
    stream.write(&mut sink).map_err(|e| ExportError::Other(format!("flac: {e:?}")))?;
    Ok(sink.as_slice().to_vec())
}

#[cfg(feature = "ffmpeg")]
fn mp3(samples: &[i16], bitrate: u64) -> Result<Vec<u8>, ExportError> {
    use mp3lame_encoder::{Bitrate, Builder, FlushNoGap, InterleavedPcm, Quality};
    let err = |what: &str| ExportError::Other(format!("mp3: {what}"));
    let mut b = Builder::new().ok_or_else(|| err("no encoder"))?;
    b.set_num_channels(2).map_err(|_| err("channels"))?;
    b.set_sample_rate(AUDIO_RATE).map_err(|_| err("rate"))?;
    b.set_brate(match bitrate {
        0..=128_000 => Bitrate::Kbps128,
        129_000..=192_000 => Bitrate::Kbps192,
        _ => Bitrate::Kbps256,
    })
    .map_err(|_| err("bit rate"))?;
    b.set_quality(Quality::Good).map_err(|_| err("quality"))?;
    let mut enc = b.build().map_err(|_| err("init"))?;
    let mut out: Vec<u8> = Vec::with_capacity(mp3lame_encoder::max_required_buffer_size(samples.len() / 2));
    let n = enc.encode(InterleavedPcm(samples), out.spare_capacity_mut()).map_err(|_| err("encode"))?;
    unsafe { out.set_len(out.len() + n) };
    out.reserve(8192);
    let n = enc.flush::<FlushNoGap>(out.spare_capacity_mut()).map_err(|_| err("flush"))?;
    unsafe { out.set_len(out.len() + n) };
    Ok(out)
}

#[cfg(not(feature = "ffmpeg"))]
fn mp3(_samples: &[i16], _bitrate: u64) -> Result<Vec<u8>, ExportError> {
    Err(ExportError::Other("no MP3 encoder in this build".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_sizes() {
        let w = wav(&[0, 1, 2, 3]);
        assert_eq!(w.len(), 44 + 8);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(w[4..8].try_into().unwrap()), 36 + 8);
    }

    #[test]
    fn names() {
        assert_eq!(AudioFormat::named("M4A"), Some(AudioFormat::Aac));
        assert_eq!(AudioFormat::named("ogg"), None);
        assert_eq!(AudioFormat::Aac.extension(), "m4a");
    }
}
