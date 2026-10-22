//! The file a video export writes, whichever encoder makes its pictures: FFmpeg's MP4/MOV
//! muxer (chosen by the file's extension) with one video stream and the AAC-LC sound, and the
//! FFmpeg video encoders that feed it ([`FfVideo`]: VideoToolbox, `prores_ks`, Media
//! Foundation).

use std::ffi::CString;
use std::path::{Path, PathBuf};

use ffmpeg_sys_next as ff;

use crate::{Codec, ExportError, ExportOptions, AUDIO_RATE};

const AUDIO_BITRATE: i64 = 192_000;

pub(crate) fn check(op: &'static str, code: i32) -> Result<i32, ExportError> {
    if code < 0 {
        Err(ExportError::Ffmpeg { op, code })
    } else {
        Ok(code)
    }
}

/// Set an encoder's own option (`priv_data`) by name; whether it took.
pub(crate) unsafe fn set_option(e: *mut ff::AVCodecContext, key: &str, value: &str) -> bool {
    let (k, v) = (CString::new(key).unwrap(), CString::new(value).unwrap());
    ff::av_opt_set((*e).priv_data, k.as_ptr(), v.as_ptr(), 0) >= 0
}

/// The muxer and the scratch packet, with the audio encoder when the export has sound.
pub(crate) struct Muxer {
    fmt: *mut ff::AVFormatContext,
    pkt: *mut ff::AVPacket,
    video: *mut ff::AVStream,
    /// The video packets' time base (one frame).
    video_tb: ff::AVRational,
    audio: Option<AudioOut>,
    path: PathBuf,
}

struct AudioOut {
    enc: *mut ff::AVCodecContext,
    stream: *mut ff::AVStream,
    frame: *mut ff::AVFrame,
    /// Interleaved stereo samples not yet sent (less than one encoder frame).
    pending: Vec<f32>,
    next_pts: i64,
}

impl Drop for Muxer {
    fn drop(&mut self) {
        unsafe {
            if let Some(a) = self.audio.as_mut() {
                ff::av_frame_free(&mut a.frame);
                ff::avcodec_free_context(&mut a.enc);
            }
            ff::av_packet_free(&mut self.pkt);
            if !self.fmt.is_null() {
                if (*(*self.fmt).oformat).flags & ff::AVFMT_NOFILE == 0 {
                    ff::avio_closep(&mut (*self.fmt).pb);
                }
                ff::avformat_free_context(self.fmt);
            }
        }
    }
}

impl Muxer {
    /// The output for `path`, nothing written yet: add the video stream, then [`Muxer::start`].
    pub(crate) fn new(path: &Path) -> Result<Muxer, ExportError> {
        let cpath = CString::new(path.to_string_lossy().as_bytes()).map_err(|_| ExportError::Other("path has a NUL byte".into()))?;
        let mut m = Muxer { fmt: std::ptr::null_mut(), pkt: unsafe { ff::av_packet_alloc() }, video: std::ptr::null_mut(), video_tb: ff::AVRational { num: 1, den: 1 }, audio: None, path: path.to_path_buf() };
        check("avformat_alloc_output_context2", unsafe { ff::avformat_alloc_output_context2(&mut m.fmt, std::ptr::null(), std::ptr::null(), cpath.as_ptr()) })?;
        Ok(m)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// Whether encoders must put their parameter sets in the header (MP4/MOV) rather than in
    /// the stream.
    pub(crate) fn global_header(&self) -> bool {
        unsafe { (*(*self.fmt).oformat).flags & ff::AVFMT_GLOBALHEADER != 0 }
    }

    /// The video stream, as FFmpeg encoder `enc` describes its packets.
    pub(crate) unsafe fn add_video(&mut self, enc: *const ff::AVCodecContext, codec: Codec) -> Result<(), ExportError> {
        self.video = ff::avformat_new_stream(self.fmt, std::ptr::null());
        check("avcodec_parameters_from_context", ff::avcodec_parameters_from_context((*self.video).codecpar, enc))?;
        // Apple's players want HEVC tagged "hvc1" (parameter sets in the header), not "hev1".
        if matches!(codec, Codec::Hevc | Codec::HevcAlpha) {
            (*(*self.video).codecpar).codec_tag = u32::from_le_bytes(*b"hvc1");
        }
        self.video_tb = (*enc).time_base;
        (*self.video).time_base = (*enc).time_base;
        (*self.video).avg_frame_rate = (*enc).framerate;
        Ok(())
    }

    /// A video stream for packets made outside FFmpeg (OpenH264), one frame of `o` a tick:
    /// `describe` fills in what they are.
    pub(crate) unsafe fn add_video_with(&mut self, o: &ExportOptions, describe: impl FnOnce(*mut ff::AVCodecParameters)) {
        self.video = ff::avformat_new_stream(self.fmt, std::ptr::null());
        let par = (*self.video).codecpar;
        (*par).codec_type = ff::AVMediaType::AVMEDIA_TYPE_VIDEO;
        (*par).width = o.width as i32;
        (*par).height = o.height as i32;
        describe(par);
        self.video_tb = ff::AVRational { num: o.fps.den as i32, den: o.fps.num as i32 };
        (*self.video).time_base = self.video_tb;
        (*self.video).avg_frame_rate = ff::AVRational { num: o.fps.num as i32, den: o.fps.den as i32 };
    }

    /// Add the sound's stream when `audio`, open the file and write its header.
    pub(crate) fn start(&mut self, audio: bool) -> Result<(), ExportError> {
        let cpath = CString::new(self.path.to_string_lossy().as_bytes()).unwrap();
        unsafe {
            if audio {
                self.audio = Some(Self::open_audio(self.fmt)?);
            }
            if (*(*self.fmt).oformat).flags & ff::AVFMT_NOFILE == 0 {
                check("avio_open", ff::avio_open(&mut (*self.fmt).pb, cpath.as_ptr(), ff::AVIO_FLAG_WRITE))?;
            }
            check("avformat_write_header", ff::avformat_write_header(self.fmt, std::ptr::null_mut()))?;
        }
        Ok(())
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
    pub(crate) fn encode_audio(&mut self, samples: &[f32], flush: bool) -> Result<(), ExportError> {
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
                Self::drain_into(self.fmt, a.enc, a.stream, self.pkt)?;
            }
            if flush {
                check("avcodec_send_frame (audio flush)", ff::avcodec_send_frame(a.enc, std::ptr::null()))?;
                Self::drain_into(self.fmt, a.enc, a.stream, self.pkt)?;
            }
        }
        Ok(())
    }

    /// Write every packet the encoder has ready.
    unsafe fn drain_into(fmt: *mut ff::AVFormatContext, enc: *mut ff::AVCodecContext, stream: *mut ff::AVStream, pkt: *mut ff::AVPacket) -> Result<(), ExportError> {
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

    /// Write every packet the video encoder `enc` has ready.
    pub(crate) unsafe fn drain(&mut self, enc: *mut ff::AVCodecContext) -> Result<(), ExportError> {
        Self::drain_into(self.fmt, enc, self.video, self.pkt)
    }

    /// Write one video packet made outside FFmpeg: `data`, for frame `index`.
    pub(crate) fn write_video(&mut self, data: &[u8], index: i64, key: bool) -> Result<(), ExportError> {
        unsafe {
            let pkt = self.pkt;
            ff::av_packet_unref(pkt);
            check("av_new_packet", ff::av_new_packet(pkt, data.len() as i32))?;
            std::ptr::copy_nonoverlapping(data.as_ptr(), (*pkt).data, data.len());
            (*pkt).pts = index;
            (*pkt).dts = index;
            (*pkt).duration = 1;
            if key {
                (*pkt).flags |= ff::AV_PKT_FLAG_KEY as i32;
            }
            ff::av_packet_rescale_ts(pkt, self.video_tb, (*self.video).time_base);
            (*pkt).stream_index = (*self.video).index;
            check("av_interleaved_write_frame", ff::av_interleaved_write_frame(self.fmt, pkt)).map(|_| ())
        }
    }

    /// Close the file (the video encoder has been flushed).
    pub(crate) fn finish(&mut self) -> Result<(), ExportError> {
        unsafe { check("av_write_trailer", ff::av_write_trailer(self.fmt)).map(|_| ()) }
    }
}

/// An FFmpeg video encoder, with the frame it fills for each picture.
pub(crate) struct FfVideo {
    pub(crate) enc: *mut ff::AVCodecContext,
    pub(crate) frame: *mut ff::AVFrame,
}

impl Drop for FfVideo {
    fn drop(&mut self) {
        unsafe {
            ff::av_frame_free(&mut self.frame);
            ff::avcodec_free_context(&mut self.enc);
        }
    }
}

impl FfVideo {
    /// Open FFmpeg's encoder `name` for `o`'s size, rate and bit rate, a keyframe every two
    /// seconds; `setup` sets its picture format, colour and own options before it opens.
    pub(crate) fn open(name: &str, global_header: bool, o: &ExportOptions, setup: impl FnOnce(*mut ff::AVCodecContext)) -> Result<FfVideo, ExportError> {
        let cname = CString::new(name).unwrap();
        unsafe {
            let codec = ff::avcodec_find_encoder_by_name(cname.as_ptr());
            if codec.is_null() {
                return Err(ExportError::Other(format!("encoder {name} not available")));
            }
            let v = FfVideo { enc: ff::avcodec_alloc_context3(codec), frame: ff::av_frame_alloc() };
            let e = v.enc;
            (*e).width = o.width as i32;
            (*e).height = o.height as i32;
            (*e).time_base = ff::AVRational { num: o.fps.den as i32, den: o.fps.num as i32 };
            (*e).framerate = ff::AVRational { num: o.fps.num as i32, den: o.fps.den as i32 };
            (*e).bit_rate = o.bitrate as i64;
            (*e).gop_size = (o.fps.as_f64() * 2.0).round() as i32;
            if global_header {
                (*e).flags |= ff::AV_CODEC_FLAG_GLOBAL_HEADER as i32;
            }
            setup(e);
            check("avcodec_open2", ff::avcodec_open2(e, codec, std::ptr::null_mut()))?;
            Ok(v)
        }
    }

    /// Tag the encoder's pictures BT.709, limited range (CapCut's exports are).
    pub(crate) unsafe fn bt709(e: *mut ff::AVCodecContext) {
        (*e).color_range = ff::AVColorRange::AVCOL_RANGE_MPEG;
        (*e).colorspace = ff::AVColorSpace::AVCOL_SPC_BT709;
        (*e).color_primaries = ff::AVColorPrimaries::AVCOL_PRI_BT709;
        (*e).color_trc = ff::AVColorTransferCharacteristic::AVCOL_TRC_BT709;
    }

    /// Send `frame` (null flushes) and write whatever packets come out.
    pub(crate) unsafe fn send(&mut self, mux: &mut Muxer, frame: *const ff::AVFrame) -> Result<(), ExportError> {
        check("avcodec_send_frame", ff::avcodec_send_frame(self.enc, frame))?;
        mux.drain(self.enc)
    }
}
