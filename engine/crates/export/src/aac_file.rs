//! An audio-only AAC-LC file (an MP4 container, `.m4a`) through FFmpeg's encoder and muxer.

use std::ffi::CString;
use std::path::Path;

use ffmpeg_sys_next as ff;

use crate::{ExportError, AUDIO_RATE};

fn check(op: &'static str, code: i32) -> Result<i32, ExportError> {
    if code < 0 {
        Err(ExportError::Ffmpeg { op, code })
    } else {
        Ok(code)
    }
}

struct Guard {
    fmt: *mut ff::AVFormatContext,
    enc: *mut ff::AVCodecContext,
    pkt: *mut ff::AVPacket,
    frame: *mut ff::AVFrame,
}

impl Drop for Guard {
    fn drop(&mut self) {
        unsafe {
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

unsafe fn drain(g: &Guard, stream: *mut ff::AVStream) -> Result<(), ExportError> {
    loop {
        let r = ff::avcodec_receive_packet(g.enc, g.pkt);
        if r == ff::AVERROR(ff::EAGAIN) || r == ff::AVERROR_EOF {
            return Ok(());
        }
        check("avcodec_receive_packet (aac)", r)?;
        ff::av_packet_rescale_ts(g.pkt, (*g.enc).time_base, (*stream).time_base);
        (*g.pkt).stream_index = (*stream).index;
        check("av_interleaved_write_frame (aac)", ff::av_interleaved_write_frame(g.fmt, g.pkt))?;
    }
}

/// Encode interleaved stereo `samples` (at [`AUDIO_RATE`]) as AAC-LC at `bitrate` into `path`.
pub(crate) fn write(path: &Path, samples: &[f32], bitrate: i64) -> Result<(), ExportError> {
    let cpath = CString::new(path.to_string_lossy().as_bytes()).map_err(|_| ExportError::Other("path has a NUL byte".into()))?;
    let mp4 = CString::new("mp4").unwrap();
    let aac = CString::new("aac").unwrap();
    unsafe {
        let mut g = Guard { fmt: std::ptr::null_mut(), enc: std::ptr::null_mut(), pkt: ff::av_packet_alloc(), frame: ff::av_frame_alloc() };
        check("avformat_alloc_output_context2", ff::avformat_alloc_output_context2(&mut g.fmt, std::ptr::null(), mp4.as_ptr(), cpath.as_ptr()))?;
        let codec = ff::avcodec_find_encoder_by_name(aac.as_ptr());
        if codec.is_null() {
            return Err(ExportError::Other("AAC encoder not available".into()));
        }
        g.enc = ff::avcodec_alloc_context3(codec);
        let e = g.enc;
        (*e).sample_rate = AUDIO_RATE as i32;
        ff::av_channel_layout_default(&mut (*e).ch_layout, 2);
        (*e).sample_fmt = ff::AVSampleFormat::AV_SAMPLE_FMT_FLTP;
        (*e).bit_rate = bitrate;
        (*e).time_base = ff::AVRational { num: 1, den: AUDIO_RATE as i32 };
        if (*(*g.fmt).oformat).flags & ff::AVFMT_GLOBALHEADER != 0 {
            (*e).flags |= ff::AV_CODEC_FLAG_GLOBAL_HEADER as i32;
        }
        check("avcodec_open2 (aac)", ff::avcodec_open2(e, codec, std::ptr::null_mut()))?;
        let stream = ff::avformat_new_stream(g.fmt, std::ptr::null());
        check("avcodec_parameters_from_context (aac)", ff::avcodec_parameters_from_context((*stream).codecpar, e))?;
        (*stream).time_base = (*e).time_base;
        if (*(*g.fmt).oformat).flags & ff::AVFMT_NOFILE == 0 {
            check("avio_open", ff::avio_open(&mut (*g.fmt).pb, cpath.as_ptr(), ff::AVIO_FLAG_WRITE))?;
        }
        check("avformat_write_header", ff::avformat_write_header(g.fmt, std::ptr::null_mut()))?;
        let size = ((*e).frame_size.max(1)) as usize;
        let total = samples.len() / 2;
        let mut at = 0usize;
        while at < total {
            let n = size.min(total - at);
            let f = g.frame;
            ff::av_frame_unref(f);
            (*f).nb_samples = n as i32;
            (*f).format = ff::AVSampleFormat::AV_SAMPLE_FMT_FLTP as i32;
            (*f).sample_rate = AUDIO_RATE as i32;
            ff::av_channel_layout_copy(&mut (*f).ch_layout, &(*e).ch_layout);
            check("av_frame_get_buffer (aac)", ff::av_frame_get_buffer(f, 0))?;
            for c in 0..2 {
                let plane = std::slice::from_raw_parts_mut((*f).data[c] as *mut f32, n);
                for (i, v) in plane.iter_mut().enumerate() {
                    *v = samples[(at + i) * 2 + c].clamp(-1.0, 1.0);
                }
            }
            (*f).pts = at as i64;
            at += n;
            check("avcodec_send_frame (aac)", ff::avcodec_send_frame(e, f))?;
            drain(&g, stream)?;
        }
        check("avcodec_send_frame (aac flush)", ff::avcodec_send_frame(e, std::ptr::null()))?;
        drain(&g, stream)?;
        check("av_write_trailer", ff::av_write_trailer(g.fmt))?;
    }
    Ok(())
}
