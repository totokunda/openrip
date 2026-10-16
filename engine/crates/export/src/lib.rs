//! Export: render a project frame by frame and encode it to a video file.
//!
//! Each frame is composited on the GPU straight into an NV12 (BT.709, limited range)
//! IOSurface from a CoreVideo pool, which goes to VideoToolbox's H.264/HEVC encoder through
//! FFmpeg as a hardware frame: no pixel copies and no CPU colour conversion. FFmpeg muxes
//! the result (MP4/MOV). CapCut exports BT.709 limited range too (calibration session 1).
//!
//! Audio is mixed at CapCut's export rate (44.1 kHz stereo) in step with the video and
//! encoded as AAC-LC.

use std::ffi::CString;
use std::path::Path;
use std::time::Instant;

use ffmpeg_sys_next as ff;
use openrip_model::{FrameRate, Micros, Project};
use openrip_playback::{PreviewEngine, PreviewError};

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("{op} failed ({code})")]
    Ffmpeg { op: &'static str, code: i32 },
    #[error(transparent)]
    Render(#[from] PreviewError),
    #[error("{0}")]
    Other(String),
    #[error("cancelled")]
    Cancelled,
}

fn check(op: &'static str, code: i32) -> Result<i32, ExportError> {
    if code < 0 {
        Err(ExportError::Ffmpeg { op, code })
    } else {
        Ok(code)
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Codec {
    H264,
    Hevc,
}

#[derive(Clone, Debug)]
pub struct ExportOptions {
    pub width: u32,
    pub height: u32,
    pub fps: FrameRate,
    pub codec: Codec,
    /// Bits per second.
    pub bitrate: u64,
    /// Mix and encode the audio (AAC-LC, 44.1 kHz stereo, like CapCut's exports).
    pub audio: bool,
}

/// CapCut exports AAC-LC at 44.1 kHz stereo (calibration sessions 1-2).
pub const AUDIO_RATE: u32 = 44_100;
const AUDIO_BITRATE: i64 = 192_000;

#[derive(Clone, Debug, Default)]
pub struct ExportStats {
    pub frames: u64,
    pub seconds: f64,
    /// Time spent compositing (decode included) vs waiting on the encoder/muxer.
    pub render_seconds: f64,
    pub encode_seconds: f64,
    /// Layers skipped because their media or font was missing (summed over frames).
    pub skipped_layers: u64,
}

/// Owns the muxer, encoder and the frame/packet scratch objects.
struct Output {
    fmt: *mut ff::AVFormatContext,
    enc: *mut ff::AVCodecContext,
    stream: *mut ff::AVStream,
    pkt: *mut ff::AVPacket,
    frame: *mut ff::AVFrame,
    audio: Option<AudioOut>,
}

struct AudioOut {
    enc: *mut ff::AVCodecContext,
    stream: *mut ff::AVStream,
    frame: *mut ff::AVFrame,
    /// Interleaved stereo samples not yet sent (less than one encoder frame).
    pending: Vec<f32>,
    next_pts: i64,
}

impl Drop for Output {
    fn drop(&mut self) {
        unsafe {
            if let Some(a) = self.audio.as_mut() {
                ff::av_frame_free(&mut a.frame);
                ff::avcodec_free_context(&mut a.enc);
            }
            ff::av_frame_free(&mut self.frame);
            ff::av_packet_free(&mut self.pkt);
            ff::avcodec_free_context(&mut self.enc);
            if !self.fmt.is_null() {
                if (*(*self.fmt).oformat).flags & ff::AVFMT_NOFILE == 0 {
                    ff::avio_closep(&mut (*self.fmt).pb);
                }
                ff::avformat_free_context(self.fmt);
            }
        }
    }
}

impl Output {
    fn open(path: &Path, o: &ExportOptions) -> Result<Output, ExportError> {
        let cpath = CString::new(path.to_string_lossy().as_bytes()).map_err(|_| ExportError::Other("path has a NUL byte".into()))?;
        let name = CString::new(match o.codec {
            Codec::H264 => "h264_videotoolbox",
            Codec::Hevc => "hevc_videotoolbox",
        })
        .unwrap();
        unsafe {
            let mut out = Output { fmt: std::ptr::null_mut(), enc: std::ptr::null_mut(), stream: std::ptr::null_mut(), pkt: ff::av_packet_alloc(), frame: ff::av_frame_alloc(), audio: None };
            check("avformat_alloc_output_context2", ff::avformat_alloc_output_context2(&mut out.fmt, std::ptr::null(), std::ptr::null(), cpath.as_ptr()))?;
            let codec = ff::avcodec_find_encoder_by_name(name.as_ptr());
            if codec.is_null() {
                return Err(ExportError::Other(format!("encoder {name:?} not available")));
            }
            out.enc = ff::avcodec_alloc_context3(codec);
            let e = out.enc;
            (*e).width = o.width as i32;
            (*e).height = o.height as i32;
            (*e).time_base = ff::AVRational { num: o.fps.den as i32, den: o.fps.num as i32 };
            (*e).framerate = ff::AVRational { num: o.fps.num as i32, den: o.fps.den as i32 };
            // Frames arrive as CVPixelBuffers (NV12) we rendered into on the GPU.
            (*e).pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX;
            (*e).sw_pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_NV12;
            (*e).bit_rate = o.bitrate as i64;
            (*e).gop_size = (o.fps.as_f64() * 2.0).round() as i32;
            (*e).color_range = ff::AVColorRange::AVCOL_RANGE_MPEG;
            (*e).colorspace = ff::AVColorSpace::AVCOL_SPC_BT709;
            (*e).color_primaries = ff::AVColorPrimaries::AVCOL_PRI_BT709;
            (*e).color_trc = ff::AVColorTransferCharacteristic::AVCOL_TRC_BT709;
            if (*(*out.fmt).oformat).flags & ff::AVFMT_GLOBALHEADER != 0 {
                (*e).flags |= ff::AV_CODEC_FLAG_GLOBAL_HEADER as i32;
            }
            check("avcodec_open2", ff::avcodec_open2(e, codec, std::ptr::null_mut()))?;
            out.stream = ff::avformat_new_stream(out.fmt, std::ptr::null());
            check("avcodec_parameters_from_context", ff::avcodec_parameters_from_context((*out.stream).codecpar, e))?;
            (*out.stream).time_base = (*e).time_base;
            (*out.stream).avg_frame_rate = (*e).framerate;
            if o.audio {
                out.audio = Some(Self::open_audio(out.fmt)?);
            }
            if (*(*out.fmt).oformat).flags & ff::AVFMT_NOFILE == 0 {
                check("avio_open", ff::avio_open(&mut (*out.fmt).pb, cpath.as_ptr(), ff::AVIO_FLAG_WRITE))?;
            }
            check("avformat_write_header", ff::avformat_write_header(out.fmt, std::ptr::null_mut()))?;
            Ok(out)
        }
    }

    unsafe fn open_audio(fmt: *mut ff::AVFormatContext) -> Result<AudioOut, ExportError> {
        let name = CString::new("aac").unwrap();
        let codec = ff::avcodec_find_encoder_by_name(name.as_ptr());
        if codec.is_null() {
            return Err(ExportError::Other("AAC encoder not available".into()));
        }
        let e = ff::avcodec_alloc_context3(codec);
        (*e).sample_rate = AUDIO_RATE as i32;
        ff::av_channel_layout_default(&mut (*e).ch_layout, 2);
        (*e).sample_fmt = ff::AVSampleFormat::AV_SAMPLE_FMT_FLTP;
        (*e).bit_rate = AUDIO_BITRATE;
        (*e).time_base = ff::AVRational { num: 1, den: AUDIO_RATE as i32 };
        if (*(*fmt).oformat).flags & ff::AVFMT_GLOBALHEADER != 0 {
            (*e).flags |= ff::AV_CODEC_FLAG_GLOBAL_HEADER as i32;
        }
        check("avcodec_open2 (aac)", ff::avcodec_open2(e, codec, std::ptr::null_mut()))?;
        let stream = ff::avformat_new_stream(fmt, std::ptr::null());
        check("avcodec_parameters_from_context (aac)", ff::avcodec_parameters_from_context((*stream).codecpar, e))?;
        (*stream).time_base = (*e).time_base;
        Ok(AudioOut { enc: e, stream, frame: ff::av_frame_alloc(), pending: Vec::new(), next_pts: 0 })
    }

    /// Queue interleaved stereo samples; whole encoder frames are encoded and written.
    /// `flush` also sends the remainder and drains the encoder.
    fn encode_audio(&mut self, samples: &[f32], flush: bool) -> Result<(), ExportError> {
        let Some(a) = self.audio.as_mut() else { return Ok(()) };
        a.pending.extend_from_slice(samples);
        unsafe {
            let size = ((*a.enc).frame_size.max(1)) as usize;
            while a.pending.len() >= size * 2 || (flush && !a.pending.is_empty()) {
                let n = (a.pending.len() / 2).min(size);
                let f = a.frame;
                ff::av_frame_unref(f);
                (*f).nb_samples = n as i32;
                (*f).format = ff::AVSampleFormat::AV_SAMPLE_FMT_FLTP as i32;
                (*f).sample_rate = AUDIO_RATE as i32;
                ff::av_channel_layout_copy(&mut (*f).ch_layout, &(*a.enc).ch_layout);
                check("av_frame_get_buffer (audio)", ff::av_frame_get_buffer(f, 0))?;
                for c in 0..2 {
                    let plane = std::slice::from_raw_parts_mut((*f).data[c] as *mut f32, n);
                    for (i, v) in plane.iter_mut().enumerate() {
                        *v = a.pending[i * 2 + c].clamp(-1.0, 1.0);
                    }
                }
                a.pending.drain(..n * 2);
                (*f).pts = a.next_pts;
                a.next_pts += n as i64;
                check("avcodec_send_frame (audio)", ff::avcodec_send_frame(a.enc, f))?;
                Self::drain(self.fmt, a.enc, a.stream, self.pkt)?;
            }
            if flush {
                check("avcodec_send_frame (audio flush)", ff::avcodec_send_frame(a.enc, std::ptr::null()))?;
                Self::drain(self.fmt, a.enc, a.stream, self.pkt)?;
            }
        }
        Ok(())
    }

    /// Write every packet the encoder has ready.
    unsafe fn drain(fmt: *mut ff::AVFormatContext, enc: *mut ff::AVCodecContext, stream: *mut ff::AVStream, pkt: *mut ff::AVPacket) -> Result<(), ExportError> {
        loop {
            let r = ff::avcodec_receive_packet(enc, pkt);
            if r == ff::AVERROR(ff::EAGAIN) || r == ff::AVERROR_EOF {
                return Ok(());
            }
            check("avcodec_receive_packet", r)?;
            ff::av_packet_rescale_ts(pkt, (*enc).time_base, (*stream).time_base);
            (*pkt).stream_index = (*stream).index;
            check("av_interleaved_write_frame", ff::av_interleaved_write_frame(fmt, pkt))?;
        }
    }

    /// Send one frame (or `None` to flush) and write whatever packets come out.
    fn encode(&mut self, frame: Option<(&objc2_core_video::CVPixelBuffer, i64)>) -> Result<(), ExportError> {
        unsafe {
            let f = match frame {
                Some((pb, pts)) => {
                    let f = self.frame;
                    ff::av_frame_unref(f);
                    (*f).format = ff::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX as i32;
                    (*f).width = (*self.enc).width;
                    (*f).height = (*self.enc).height;
                    (*f).pts = pts;
                    // FFmpeg reference-counts frames by their buffers: give it one that holds
                    // a retain on the pixel buffer and releases it when FFmpeg is done.
                    let held = objc2_core_foundation::CFRetained::retain(std::ptr::NonNull::from(pb));
                    let raw = objc2_core_foundation::CFRetained::into_raw(held).as_ptr() as *mut u8;
                    (*f).buf[0] = ff::av_buffer_create(raw, std::mem::size_of::<usize>(), Some(release_pixel_buffer), std::ptr::null_mut(), 0);
                    (*f).data[3] = raw;
                    f
                }
                None => std::ptr::null_mut(),
            };
            check("avcodec_send_frame", ff::avcodec_send_frame(self.enc, f))?;
            if !f.is_null() {
                ff::av_frame_unref(f);
            }
            Self::drain(self.fmt, self.enc, self.stream, self.pkt)
        }
    }

    fn finish(&mut self) -> Result<(), ExportError> {
        self.encode(None)?;
        unsafe { check("av_write_trailer", ff::av_write_trailer(self.fmt)).map(|_| ()) }
    }
}

unsafe extern "C" fn release_pixel_buffer(_opaque: *mut std::ffi::c_void, data: *mut u8) {
    drop(objc2_core_foundation::CFRetained::from_raw(std::ptr::NonNull::new_unchecked(data as *mut objc2_core_video::CVPixelBuffer)));
}

/// A pool of IOSurface-backed NV12 buffers: a buffer comes back once the encoder lets go.
struct Pool(objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBufferPool>);

impl Pool {
    fn new(width: u32, height: u32) -> Option<Pool> {
        use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType};
        use objc2_core_video::*;
        let props = CFDictionary::<CFString, CFType>::from_slices(&[], &[]);
        let (w, h, f) = (CFNumber::new_i32(width as i32), CFNumber::new_i32(height as i32), CFNumber::new_i32(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange as i32));
        let attrs = unsafe {
            CFDictionary::<CFString, CFType>::from_slices(
                &[kCVPixelBufferWidthKey, kCVPixelBufferHeightKey, kCVPixelBufferPixelFormatTypeKey, kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferMetalCompatibilityKey],
                &[w.as_ref(), h.as_ref(), f.as_ref(), props.as_ref(), CFBoolean::new(true).as_ref()],
            )
        };
        let mut pool: *mut CVPixelBufferPool = std::ptr::null_mut();
        let r = unsafe { CVPixelBufferPool::create(None, None, Some(attrs.as_opaque()), std::ptr::NonNull::from(&mut pool)) };
        (r == 0 && !pool.is_null()).then(|| Pool(unsafe { CFRetained::from_raw(std::ptr::NonNull::new_unchecked(pool)) }))
    }

    fn next(&self) -> Option<objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>> {
        let mut pb: *mut objc2_core_video::CVPixelBuffer = std::ptr::null_mut();
        let r = unsafe { objc2_core_video::CVPixelBufferPool::create_pixel_buffer(None, &self.0, std::ptr::NonNull::from(&mut pb)) };
        (r == 0 && !pb.is_null()).then(|| unsafe { objc2_core_foundation::CFRetained::from_raw(std::ptr::NonNull::new_unchecked(pb)) })
    }
}

/// Render `project` to `path`. `progress` gets (frame, total) after each frame and returns
/// whether to go on; stopping removes the unfinished file and returns
/// [`ExportError::Cancelled`].
pub fn export(project: Project, path: &Path, o: &ExportOptions, mut progress: impl FnMut(u64, u64) -> bool) -> Result<ExportStats, ExportError> {
    let t0 = Instant::now();
    let duration = project.duration();
    let total = o.fps.frame_of(Micros(duration.0 - 1)).max(0) as u64 + 1;
    let mut mixer = o.audio.then(|| openrip_audio::Mixer::with_rate(project.clone(), AUDIO_RATE));
    let mut mixed: i64 = 0;
    let mut block = Vec::new();
    let mut engine = PreviewEngine::new(project)?;
    let pool = Pool::new(o.width, o.height).ok_or_else(|| ExportError::Other("can't create the frame pool".into()))?;
    let mut out = Output::open(path, o)?;
    let mut stats = ExportStats::default();
    for n in 0..total {
        let t = o.fps.frame_start(n as i64);
        let pb = pool.next().ok_or_else(|| ExportError::Other("frame pool exhausted".into()))?;
        let r0 = Instant::now();
        let report = engine.render_to_nv12(t, &pb)?;
        stats.skipped_layers += report.missing.len() as u64;
        let e0 = Instant::now();
        stats.render_seconds += (e0 - r0).as_secs_f64();
        out.encode(Some((&pb, n as i64)))?;
        // The audio up to the end of this frame.
        if let Some(m) = mixer.as_mut() {
            let until = openrip_audio::sample_at(o.fps.frame_start(n as i64 + 1).min(duration), AUDIO_RATE);
            if until > mixed {
                block.resize((until - mixed) as usize * 2, 0.0);
                m.mix(mixed, &mut block).map_err(|e| ExportError::Other(e.to_string()))?;
                out.encode_audio(&block, false)?;
                mixed = until;
            }
        }
        stats.encode_seconds += e0.elapsed().as_secs_f64();
        stats.frames += 1;
        if !progress(n + 1, total) {
            drop(out);
            let _ = std::fs::remove_file(path);
            return Err(ExportError::Cancelled);
        }
    }
    let e0 = Instant::now();
    if mixer.is_some() {
        out.encode_audio(&[], true)?;
    }
    out.finish()?;
    stats.encode_seconds += e0.elapsed().as_secs_f64();
    stats.seconds = t0.elapsed().as_secs_f64();
    Ok(stats)
}
