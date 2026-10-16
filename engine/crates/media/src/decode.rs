use std::path::Path;

use ffmpeg_sys_next as ff;

use crate::error::check;
use crate::info::video_info;
use crate::nal;
use crate::util::{Input, MICROS};
use crate::{MediaError, Micros, VideoFrame, VideoInfo};

/// Whether to decode on the GPU.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum HardwareMode {
    /// Hardware when the platform and codec support it, software otherwise.
    #[default]
    Auto,
    /// Always decode in software.
    Off,
    /// Fail rather than fall back to software.
    Require,
}

#[derive(Clone, Debug)]
pub struct DecoderOptions {
    pub hardware: HardwareMode,
    /// Software decoding threads; 0 picks automatically.
    pub threads: u32,
}

impl Default for DecoderOptions {
    fn default() -> Self {
        DecoderOptions { hardware: HardwareMode::Auto, threads: 0 }
    }
}

/// Counters for benchmarks and diagnostics.
#[derive(Copy, Clone, Debug, Default)]
pub struct DecodeStats {
    /// Frames that came out of the decoder (including ones skipped while seeking).
    pub frames_decoded: u64,
    /// Demuxer seeks performed.
    pub seeks: u64,
    /// Packets the decoder rejected (skipped).
    pub decode_errors: u64,
    /// Hardware sessions restarted after seeking to an open-GOP keyframe.
    pub sessions_reset: u64,
}

/// Frames worth decoding forward rather than seeking (a seek flushes and refills the decoder).
const SEEK_COST_FRAMES: i64 = 8;

/// Packets skipped after a seek while looking for a keyframe, before giving up and feeding them anyway.
const MAX_SKIP_TO_KEY: u32 = 1000;
/// Rejected packets tolerated over a decoder's life before decoding is treated as broken.
const MAX_DECODE_ERRORS: u64 = 100;

/// Decodes one video stream, sequentially or by time.
pub struct VideoDecoder {
    input: Input,
    stream: i32,
    codec: *const ff::AVCodec,
    /// VideoToolbox device, when decoding on the GPU (owned reference).
    device: *mut ff::AVBufferRef,
    threads: i32,
    /// Bitstream layout, for H.264/HEVC (to recognise IDR keyframes).
    nal: Option<(nal::Codec, nal::Framing)>,
    ctx: *mut ff::AVCodecContext,
    pkt: *mut ff::AVPacket,
    frame: *mut ff::AVFrame,
    tb: ff::AVRational,
    /// Stream timestamp of time zero (the first frame).
    origin: i64,
    info: VideoInfo,
    hardware: bool,
    require_hardware: bool,
    /// Duration used when the container doesn't give one.
    nominal: Micros,
    /// Most recently returned frame (kept so repeated requests for it cost nothing).
    current: Option<VideoFrame>,
    /// A frame decoded past a seek target, to be returned next.
    pending: Option<VideoFrame>,
    /// All packets have been sent and the decoder is draining.
    flushing: bool,
    /// Right after a seek, before the first packet has been sent.
    just_seeked: bool,
    /// Packets skipped since the seek while waiting for a keyframe.
    skipped: u32,
    /// Drop frames that start before this stream timestamp: the keyframe a seek landed on.
    /// Open-GOP leading pictures come before it and reference frames we never decoded.
    drop_before: i64,
    stats: DecodeStats,
}

// The decoder owns all its FFmpeg state and is used from one thread at a time.
unsafe impl Send for VideoDecoder {}

unsafe extern "C" fn pick_hw_format(_ctx: *mut ff::AVCodecContext, fmts: *const ff::AVPixelFormat) -> ff::AVPixelFormat {
    let mut p = fmts;
    while *p != ff::AVPixelFormat::AV_PIX_FMT_NONE {
        if *p == ff::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX {
            return *p;
        }
        p = p.add(1);
    }
    *fmts // first offered format is the native software one
}

impl VideoDecoder {
    pub fn open(path: &Path, opts: &DecoderOptions) -> Result<Self, MediaError> {
        let input = Input::open(path)?;
        let stream = input.best_stream(ff::AVMediaType::AVMEDIA_TYPE_VIDEO).ok_or_else(|| MediaError::NoVideoStream { path: path.into() })?;
        let info = video_info(&input, stream);
        unsafe {
            let st = input.stream(stream);
            let par = (*st).codecpar;
            let codec = ff::avcodec_find_decoder((*par).codec_id);
            if codec.is_null() {
                return Err(MediaError::NoDecoder(info.codec.clone()));
            }
            let mut device: *mut ff::AVBufferRef = std::ptr::null_mut();
            if opts.hardware != HardwareMode::Off && cfg!(target_os = "macos") {
                let r = ff::av_hwdevice_ctx_create(&mut device, ff::AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX, std::ptr::null(), std::ptr::null_mut(), 0);
                if r < 0 {
                    device = std::ptr::null_mut();
                    if opts.hardware == HardwareMode::Require {
                        return Err(MediaError::ffmpeg("av_hwdevice_ctx_create", r));
                    }
                }
            }
            let mut dec = VideoDecoder {
                input,
                stream,
                codec,
                device,
                threads: opts.threads as i32,
                nal: {
                    let extra = if (*par).extradata.is_null() { &[][..] } else { std::slice::from_raw_parts((*par).extradata, (*par).extradata_size as usize) };
                    nal::detect((*par).codec_id, extra)
                },
                ctx: std::ptr::null_mut(),
                pkt: ff::av_packet_alloc(),
                frame: ff::av_frame_alloc(),
                tb: (*st).time_base,
                origin: if (*st).start_time != ff::AV_NOPTS_VALUE { (*st).start_time } else { ff::AV_NOPTS_VALUE },
                nominal: info.frame_rate.map(|r| r.frame_duration()).unwrap_or(Micros(33_333)),
                info,
                hardware: !device.is_null(),
                require_hardware: opts.hardware == HardwareMode::Require,
                current: None,
                pending: None,
                flushing: false,
                just_seeked: false,
                skipped: 0,
                drop_before: ff::AV_NOPTS_VALUE,
                stats: DecodeStats::default(),
            };
            dec.ctx = dec.new_context()?;
            if dec.origin == ff::AV_NOPTS_VALUE {
                // No start time in the container: the first frame defines time zero.
                if let Some(first) = dec.decode()? {
                    dec.pending = Some(first);
                }
            }
            Ok(dec)
        }
    }

    /// A configured, opened codec context for the stream.
    unsafe fn new_context(&self) -> Result<*mut ff::AVCodecContext, MediaError> {
        let st = self.input.stream(self.stream);
        let mut ctx = ff::avcodec_alloc_context3(self.codec);
        let result = (|| {
            check("avcodec_parameters_to_context", ff::avcodec_parameters_to_context(ctx, (*st).codecpar))?;
            (*ctx).pkt_timebase = (*st).time_base;
            // Never hand out frames the decoder knows are damaged (e.g. before a recovery point).
            (*ctx).flags &= !(ff::AV_CODEC_FLAG_OUTPUT_CORRUPT as i32);
            (*ctx).thread_count = self.threads;
            (*ctx).thread_type = ff::FF_THREAD_FRAME | ff::FF_THREAD_SLICE;
            if !self.device.is_null() {
                (*ctx).hw_device_ctx = ff::av_buffer_ref(self.device);
                (*ctx).get_format = Some(pick_hw_format);
                // The GPU does the work; frame threads around it only add latency.
                (*ctx).thread_count = 1;
            }
            check("avcodec_open2", ff::avcodec_open2(ctx, self.codec, std::ptr::null_mut()))
        })();
        match result {
            Ok(_) => Ok(ctx),
            Err(e) => {
                ff::avcodec_free_context(&mut ctx);
                Err(e)
            }
        }
    }

    pub fn info(&self) -> &VideoInfo {
        &self.info
    }

    /// True if the decoder was set up for hardware decoding (individual frames may still
    /// fall back to software if the hardware rejects the stream; see [`VideoFrame::is_hardware`]).
    pub fn hardware(&self) -> bool {
        self.hardware
    }

    pub fn stats(&self) -> DecodeStats {
        self.stats
    }

    /// The next frame in presentation order, or `None` at the end of the stream.
    pub fn next_frame(&mut self) -> Result<Option<VideoFrame>, MediaError> {
        let next = match self.pending.take() {
            Some(f) => Some(f),
            None => self.decode()?,
        };
        match next {
            Some(f) => {
                let out = f.try_clone()?;
                self.current = Some(f);
                Ok(Some(out))
            }
            None => Ok(None),
        }
    }

    /// The frame displayed at time `t`: the last frame starting at or before `t` (the last
    /// frame of the stream if `t` is past its end, the first if `t` is before it).
    pub fn frame_at(&mut self, t: Micros) -> Result<Option<VideoFrame>, MediaError> {
        let t = Micros(t.0.max(0));
        if !self.can_reach_by_decoding(t) {
            self.seek_before(t, 0)?;
        }
        let mut retreat = 0;
        loop {
            // Decode forward until the next frame would start after `t`.
            loop {
                if let Some(p) = &self.pending {
                    if p.time > t {
                        break;
                    }
                }
                let next = match self.pending.take() {
                    Some(f) => Some(f),
                    None => self.decode()?,
                };
                match next {
                    Some(f) if f.time <= t => self.current = Some(f),
                    Some(f) => {
                        self.pending = Some(f);
                        break;
                    }
                    None => break, // end of stream: the last frame stays on screen
                }
            }
            if self.current.is_some() || t.0 == 0 || retreat >= 4 {
                break;
            }
            // The seek landed after `t` (keyframe index in decode order, leading pictures
            // dropped): go back further and try again.
            retreat += 1;
            self.seek_before(t, retreat)?;
        }
        match &self.current {
            Some(f) => Ok(Some(f.try_clone()?)),
            None => match self.pending.take() {
                // `t` precedes the first frame: show the first frame.
                Some(f) => {
                    let out = f.try_clone()?;
                    self.current = Some(f);
                    Ok(Some(out))
                }
                None => Ok(None),
            },
        }
    }

    /// Whether decoding forward from the current position reaches `t` sooner than a seek.
    fn can_reach_by_decoding(&self, t: Micros) -> bool {
        let Some(cur) = &self.current else { return false };
        if t < cur.time {
            return false;
        }
        let cheap = SEEK_COST_FRAMES * self.nominal.0;
        if t.0 - cur.time.0 <= cheap {
            return true;
        }
        unsafe {
            let st = self.input.stream(self.stream);
            if ff::avformat_index_get_entries_count(st) > 0 {
                // A seek decodes from the keyframe before `t`; decoding on decodes from here.
                // Seek only when that keyframe is far enough ahead to pay for the seek.
                let ts = self.origin + ff::av_rescale_q(t.0, MICROS, self.tb);
                let e = ff::avformat_index_get_entry_from_timestamp(st, ts, ff::AVSEEK_FLAG_BACKWARD);
                if e.is_null() {
                    return true;
                }
                let key = ff::av_rescale_q((*e).timestamp - self.origin, self.tb, MICROS);
                return key <= cur.time.0 + cheap;
            }
        }
        // No index: decode forward for up to two seconds.
        t.0 - cur.time.0 <= 2_000_000
    }

    /// Seek the demuxer to the keyframe at or before `t` (moved back by 2^attempt - 1 seconds
    /// on retries) and reset the decoder.
    fn seek_before(&mut self, t: Micros, attempt: u32) -> Result<(), MediaError> {
        let back = ((1i64 << attempt) - 1) * 1_000_000;
        // Seeking past the end finds nothing to decode; aim at the last frame instead.
        let end = self.info.duration.0 - self.nominal.0;
        let t = if end > 0 { t.0.min(end) } else { t.0 };
        let target = Micros((t - back).max(0));
        unsafe {
            let mut ts = self.origin + ff::av_rescale_q(target.0, MICROS, self.tb);
            if target.0 == 0 {
                // A timestamp seek to exactly the start can land just past the first keyframe
                // in formats without a full index (MPEG-TS); aim well before it instead.
                ts = self.origin - ff::av_rescale_q(3_600_000_000, MICROS, self.tb);
            }
            let r = ff::av_seek_frame(self.input.0, self.stream, ts, ff::AVSEEK_FLAG_BACKWARD);
            if r < 0 {
                // Some demuxers can't seek backward from a timestamp; fall back to the start.
                check("av_seek_frame", ff::av_seek_frame(self.input.0, self.stream, i64::MIN / 2, ff::AVSEEK_FLAG_BACKWARD))?;
            }
            ff::avcodec_flush_buffers(self.ctx);
        }
        self.stats.seeks += 1;
        self.current = None;
        self.pending = None;
        self.flushing = false;
        self.just_seeked = true;
        self.skipped = 0;
        self.drop_before = ff::AV_NOPTS_VALUE;
        Ok(())
    }

    /// Whether the packet in `self.pkt` is a keyframe that doesn't reset reference pictures.
    unsafe fn open_gop_keyframe(&self) -> bool {
        match self.nal {
            Some((codec, framing)) => {
                let data = std::slice::from_raw_parts((*self.pkt).data, (*self.pkt).size as usize);
                !nal::is_idr(codec, framing, data)
            }
            None => false,
        }
    }

    /// Pull the next frame out of the decoder, feeding it packets as needed.
    fn decode(&mut self) -> Result<Option<VideoFrame>, MediaError> {
        unsafe {
            loop {
                let r = ff::avcodec_receive_frame(self.ctx, self.frame);
                if r == 0 {
                    self.stats.frames_decoded += 1;
                    let f = self.frame;
                    let mut ts = (*f).best_effort_timestamp;
                    if ts == ff::AV_NOPTS_VALUE {
                        ts = (*f).pts;
                    }
                    if self.drop_before != ff::AV_NOPTS_VALUE && ts != ff::AV_NOPTS_VALUE && ts < self.drop_before {
                        ff::av_frame_unref(f);
                        continue;
                    }
                    if self.origin == ff::AV_NOPTS_VALUE && ts != ff::AV_NOPTS_VALUE {
                        self.origin = ts;
                    }
                    let time = if ts == ff::AV_NOPTS_VALUE {
                        self.current.as_ref().map(|c| c.time + c.duration).unwrap_or(Micros::ZERO)
                    } else {
                        Micros(ff::av_rescale_q(ts - self.origin, self.tb, MICROS))
                    };
                    let duration = if (*f).duration > 0 { Micros(ff::av_rescale_q((*f).duration, self.tb, MICROS)) } else { self.nominal };
                    let frame = VideoFrame::reference(f, time, duration);
                    ff::av_frame_unref(f);
                    let frame = frame?;
                    if self.require_hardware && !frame.is_hardware() {
                        return Err(MediaError::Ffmpeg { op: "hardware decode", code: -1, msg: format!("{} was decoded in software", self.info.codec) });
                    }
                    return Ok(Some(frame));
                }
                if r == ff::AVERROR_EOF {
                    return Ok(None);
                }
                if r != ff::AVERROR(ff::EAGAIN) {
                    return Err(MediaError::ffmpeg("avcodec_receive_frame", r));
                }
                if self.flushing {
                    return Ok(None);
                }
                let r = ff::av_read_frame(self.input.0, self.pkt);
                if r < 0 {
                    // End of file (or a read error): drain what the decoder still holds.
                    ff::avcodec_send_packet(self.ctx, std::ptr::null());
                    self.flushing = true;
                    continue;
                }
                if (*self.pkt).stream_index != self.stream {
                    ff::av_packet_unref(self.pkt);
                    continue;
                }
                if self.just_seeked {
                    // Containers without an index (MPEG-TS) land near a keyframe, not on one:
                    // start feeding the decoder at the first keyframe.
                    if (*self.pkt).flags & ff::AV_PKT_FLAG_KEY == 0 && self.skipped < MAX_SKIP_TO_KEY {
                        self.skipped += 1;
                        ff::av_packet_unref(self.pkt);
                        continue;
                    }
                    self.just_seeked = false;
                    if (*self.pkt).flags & ff::AV_PKT_FLAG_KEY != 0 {
                        self.drop_before = (*self.pkt).pts;
                        if self.hardware && self.open_gop_keyframe() {
                            // VideoToolbox keeps its own reference pictures, which a flush
                            // doesn't clear, and only an IDR picture resets them. After an
                            // open-GOP keyframe it would resolve references to stale surfaces
                            // from before the seek, so start a fresh session.
                            let ctx = self.new_context()?;
                            ff::avcodec_free_context(&mut self.ctx);
                            self.ctx = ctx;
                            self.stats.sessions_reset += 1;
                        }
                    }
                }
                let r = ff::avcodec_send_packet(self.ctx, self.pkt);
                ff::av_packet_unref(self.pkt);
                if r < 0 && r != ff::AVERROR(ff::EAGAIN) {
                    // A damaged packet (or one picture the hardware rejected) costs that
                    // picture, not the stream.
                    self.stats.decode_errors += 1;
                    if self.stats.decode_errors > MAX_DECODE_ERRORS {
                        return Err(MediaError::ffmpeg("avcodec_send_packet", r));
                    }
                }
            }
        }
    }
}

impl Drop for VideoDecoder {
    fn drop(&mut self) {
        self.current = None;
        self.pending = None;
        unsafe {
            ff::av_frame_free(&mut self.frame);
            ff::av_packet_free(&mut self.pkt);
            ff::avcodec_free_context(&mut self.ctx);
            ff::av_buffer_unref(&mut self.device);
        }
    }
}
