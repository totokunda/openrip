use std::collections::VecDeque;
use std::ffi::CString;
use std::path::Path;

use ffmpeg_sys_next as ff;

use crate::{AudioError, CHANNELS};

fn check(op: &'static str, code: i32) -> Result<i32, AudioError> {
    if code < 0 {
        Err(AudioError::Ffmpeg { op, code })
    } else {
        Ok(code)
    }
}

/// Decodes one file's audio as interleaved stereo `f32` at a chosen rate, addressed by
/// sample index from the start of the stream.
pub struct AudioDecoder {
    rate: u32,
    fmt: *mut ff::AVFormatContext,
    stream: i32,
    ctx: *mut ff::AVCodecContext,
    swr: *mut ff::SwrContext,
    pkt: *mut ff::AVPacket,
    frame: *mut ff::AVFrame,
    tb: ff::AVRational,
    /// Stream timestamp of sample 0.
    origin: i64,
    /// Decoded, converted samples (interleaved) starting at sample `start`.
    buffer: VecDeque<f32>,
    start: i64,
    /// `start` is known (set from the first frame after opening or seeking).
    anchored: bool,
    eof: bool,
    flushing: bool,
}

unsafe impl Send for AudioDecoder {}

impl AudioDecoder {
    /// `None` if the file has no audio stream.
    pub fn open(path: &Path, rate: u32) -> Result<Option<AudioDecoder>, AudioError> {
        let c = CString::new(path.to_string_lossy().as_bytes()).map_err(|_| AudioError::Other("path has a NUL byte".into()))?;
        unsafe {
            let mut fmt: *mut ff::AVFormatContext = std::ptr::null_mut();
            check("avformat_open_input", ff::avformat_open_input(&mut fmt, c.as_ptr(), std::ptr::null(), std::ptr::null_mut()))?;
            let mut d = AudioDecoder {
                rate,
                fmt,
                stream: -1,
                ctx: std::ptr::null_mut(),
                swr: std::ptr::null_mut(),
                pkt: ff::av_packet_alloc(),
                frame: ff::av_frame_alloc(),
                tb: ff::AVRational { num: 1, den: 1 },
                origin: 0,
                buffer: VecDeque::new(),
                start: 0,
                anchored: false,
                eof: false,
                flushing: false,
            };
            check("avformat_find_stream_info", ff::avformat_find_stream_info(fmt, std::ptr::null_mut()))?;
            let stream = ff::av_find_best_stream(fmt, ff::AVMediaType::AVMEDIA_TYPE_AUDIO, -1, -1, std::ptr::null_mut(), 0);
            if stream < 0 {
                return Ok(None);
            }
            d.stream = stream;
            let st = *(*fmt).streams.add(stream as usize);
            d.tb = (*st).time_base;
            d.origin = if (*st).start_time != ff::AV_NOPTS_VALUE { (*st).start_time } else { 0 };
            let codec = ff::avcodec_find_decoder((*(*st).codecpar).codec_id);
            if codec.is_null() {
                return Err(AudioError::Other("no decoder for the audio codec".into()));
            }
            d.ctx = ff::avcodec_alloc_context3(codec);
            check("avcodec_parameters_to_context", ff::avcodec_parameters_to_context(d.ctx, (*st).codecpar))?;
            (*d.ctx).pkt_timebase = (*st).time_base;
            check("avcodec_open2", ff::avcodec_open2(d.ctx, codec, std::ptr::null_mut()))?;
            d.reset_resampler()?;
            Ok(Some(d))
        }
    }

    unsafe fn reset_resampler(&mut self) -> Result<(), AudioError> {
        ff::swr_free(&mut self.swr);
        let mut out_layout: ff::AVChannelLayout = std::mem::zeroed();
        ff::av_channel_layout_default(&mut out_layout, CHANNELS as i32);
        let mut in_layout: ff::AVChannelLayout = std::mem::zeroed();
        if (*self.ctx).ch_layout.nb_channels > 0 {
            ff::av_channel_layout_copy(&mut in_layout, &(*self.ctx).ch_layout);
        } else {
            ff::av_channel_layout_default(&mut in_layout, 2);
        }
        let r = ff::swr_alloc_set_opts2(&mut self.swr, &out_layout, ff::AVSampleFormat::AV_SAMPLE_FMT_FLT, self.rate as i32, &in_layout, (*self.ctx).sample_fmt, (*self.ctx).sample_rate, 0, std::ptr::null_mut());
        ff::av_channel_layout_uninit(&mut in_layout);
        ff::av_channel_layout_uninit(&mut out_layout);
        check("swr_alloc_set_opts2", r)?;
        check("swr_init", ff::swr_init(self.swr))?;
        Ok(())
    }

    fn seek(&mut self, sample: i64) -> Result<(), AudioError> {
        unsafe {
            let us = sample * 1_000_000 / self.rate as i64;
            let ts = self.origin + ff::av_rescale_q(us, ff::AVRational { num: 1, den: 1_000_000 }, self.tb);
            if ff::av_seek_frame(self.fmt, self.stream, ts, ff::AVSEEK_FLAG_BACKWARD) < 0 {
                check("av_seek_frame", ff::av_seek_frame(self.fmt, self.stream, i64::MIN / 2, ff::AVSEEK_FLAG_BACKWARD))?;
            }
            ff::avcodec_flush_buffers(self.ctx);
            self.reset_resampler()?;
        }
        self.buffer.clear();
        self.anchored = false;
        self.eof = false;
        self.flushing = false;
        Ok(())
    }

    /// Decode one more frame into the buffer; false at the end of the stream.
    fn decode_more(&mut self) -> Result<bool, AudioError> {
        unsafe {
            loop {
                let r = ff::avcodec_receive_frame(self.ctx, self.frame);
                if r == 0 {
                    let f = self.frame;
                    if !self.anchored {
                        let pts = if (*f).best_effort_timestamp != ff::AV_NOPTS_VALUE { (*f).best_effort_timestamp } else { (*f).pts };
                        let pts = if pts == ff::AV_NOPTS_VALUE { self.origin } else { pts };
                        self.start = ff::av_rescale_q(pts - self.origin, self.tb, ff::AVRational { num: 1, den: self.rate as i32 });
                        self.anchored = true;
                    }
                    let room = ff::swr_get_out_samples(self.swr, (*f).nb_samples).max(0) as usize;
                    let mut out = vec![0f32; room * CHANNELS];
                    let ptr = out.as_mut_ptr() as *mut u8;
                    let n = ff::swr_convert(self.swr, &ptr, room as i32, (*f).extended_data as *const *const u8, (*f).nb_samples);
                    ff::av_frame_unref(f);
                    let n = check("swr_convert", n)? as usize;
                    self.buffer.extend(&out[..n * CHANNELS]);
                    return Ok(true);
                }
                if r == ff::AVERROR_EOF {
                    self.eof = true;
                    return Ok(false);
                }
                if r != ff::AVERROR(ff::EAGAIN) {
                    check("avcodec_receive_frame", r)?;
                }
                if self.flushing {
                    self.eof = true;
                    return Ok(false);
                }
                if ff::av_read_frame(self.fmt, self.pkt) < 0 {
                    ff::avcodec_send_packet(self.ctx, std::ptr::null());
                    self.flushing = true;
                    continue;
                }
                if (*self.pkt).stream_index == self.stream {
                    // A damaged packet costs its samples, not the stream.
                    let _ = ff::avcodec_send_packet(self.ctx, self.pkt);
                }
                ff::av_packet_unref(self.pkt);
            }
        }
    }

    /// Fill `out` (interleaved stereo) with the audio from sample `at` onwards; silence where
    /// the stream has none.
    pub fn read(&mut self, at: i64, out: &mut [f32]) -> Result<(), AudioError> {
        let frames = (out.len() / CHANNELS) as i64;
        let buffered_end = self.start + (self.buffer.len() / CHANNELS) as i64;
        // Jump if the request is behind the buffer or more than a second past it.
        let outside = !self.anchored || at < self.start || at > buffered_end + self.rate as i64;
        if outside && (self.anchored || at > 0) {
            self.seek(at.max(0))?;
        }
        loop {
            if self.anchored {
                // Drop what's before the request.
                let drop = ((at - self.start).max(0) as usize * CHANNELS).min(self.buffer.len());
                self.buffer.drain(..drop);
                self.start += (drop / CHANNELS) as i64;
                if self.start + (self.buffer.len() / CHANNELS) as i64 >= at + frames || self.eof {
                    break;
                }
            }
            if !self.decode_more()? {
                break;
            }
        }
        out.fill(0.0);
        if !self.anchored {
            return Ok(());
        }
        // Copy the overlap of [at, at + frames) with the buffer.
        let skip = (self.start - at).max(0); // buffer starts after the request (a gap)
        let src_from = ((at - self.start).max(0) as usize) * CHANNELS;
        let n = ((frames - skip).max(0) as usize * CHANNELS).min(self.buffer.len().saturating_sub(src_from));
        for (i, v) in self.buffer.iter().skip(src_from).take(n).enumerate() {
            out[skip as usize * CHANNELS + i] = *v;
        }
        Ok(())
    }
}

impl Drop for AudioDecoder {
    fn drop(&mut self) {
        unsafe {
            ff::swr_free(&mut self.swr);
            ff::av_frame_free(&mut self.frame);
            ff::av_packet_free(&mut self.pkt);
            ff::avcodec_free_context(&mut self.ctx);
            ff::avformat_close_input(&mut self.fmt);
        }
    }
}
