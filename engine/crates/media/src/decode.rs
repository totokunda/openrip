use std::collections::VecDeque;
use std::path::Path;

use ffmpeg_sys_next as ff;

use crate::cache::FrameCache;
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
    /// Drive VideoToolbox directly for H.264/HEVC in MP4/MOV, instead of through FFmpeg's
    /// hwaccel: several frames in flight instead of one, and frames a seek only needs as
    /// references are never output. Several times faster; on by default.
    pub native_videotoolbox: bool,
    /// Memory for recently decoded frames (so stepping backward doesn't re-decode a GOP
    /// per frame). 0 disables the cache.
    pub cache_bytes: usize,
}

impl Default for DecoderOptions {
    fn default() -> Self {
        DecoderOptions { hardware: HardwareMode::Auto, threads: 0, native_videotoolbox: true, cache_bytes: 384 << 20 }
    }
}

/// Counters for benchmarks and diagnostics.
#[derive(Copy, Clone, Debug, Default)]
pub struct DecodeStats {
    /// Pictures decoded, including ones only needed as references while seeking.
    pub frames_decoded: u64,
    /// Demuxer seeks performed.
    pub seeks: u64,
    /// Packets the decoder rejected (skipped).
    pub decode_errors: u64,
    /// Hardware sessions restarted after seeking to an open-GOP keyframe.
    pub sessions_reset: u64,
    /// Requests answered from the frame cache.
    pub cache_hits: u64,
}

/// Frames worth decoding forward rather than seeking (a seek flushes and refills the decoder).
const SEEK_COST_FRAMES: i64 = 8;
/// Packets skipped after a seek while looking for a keyframe, before giving up and feeding them anyway.
const MAX_SKIP_TO_KEY: u32 = 1000;
/// Rejected packets tolerated over a decoder's life before decoding is treated as broken.
const MAX_DECODE_ERRORS: u64 = 100;
/// A request this far behind the current frame counts as stepping backward.
const REVERSE_WINDOW: i64 = 2_000_000;
/// Packets read ahead to find the frame shown at a seek target.
const MAX_LOOKAHEAD: usize = 1200;

/// A demuxed packet waiting for the decoder.
struct Queued {
    pkt: *mut ff::AVPacket,
    /// Whether its picture is needed as output (false: decode it only as a reference).
    output: bool,
}

impl Queued {
    fn pts(&self) -> i64 {
        unsafe { (*self.pkt).pts }
    }
    /// Decode timestamp, or the presentation one when the container has none.
    fn dts(&self) -> i64 {
        unsafe {
            if (*self.pkt).dts != ff::AV_NOPTS_VALUE {
                (*self.pkt).dts
            } else {
                (*self.pkt).pts
            }
        }
    }
}

impl Drop for Queued {
    fn drop(&mut self) {
        unsafe { ff::av_packet_free(&mut self.pkt) }
    }
}

/// Owns an opened FFmpeg codec context.
struct CodecContext(*mut ff::AVCodecContext);

impl Drop for CodecContext {
    fn drop(&mut self) {
        unsafe { ff::avcodec_free_context(&mut self.0) }
    }
}

enum Backend {
    /// FFmpeg's decoder: software, or VideoToolbox through FFmpeg's hwaccel.
    Ffmpeg { ctx: CodecContext, flush_sent: bool },
    #[cfg(target_os = "macos")]
    Native(crate::vt::VtDecoder),
}

/// Decodes one video stream, sequentially or by time.
pub struct VideoDecoder {
    input: Input,
    stream: i32,
    codec: *const ff::AVCodec,
    /// VideoToolbox device for FFmpeg's hwaccel, when decoding on the GPU (owned reference).
    device: *mut ff::AVBufferRef,
    threads: i32,
    native_videotoolbox: bool,
    /// Bitstream layout, for H.264/HEVC (to recognise IDR keyframes).
    nal: Option<(nal::Codec, nal::Framing)>,
    backend: Backend,
    /// Scratch frame for FFmpeg's decoder.
    frame: *mut ff::AVFrame,
    tb: ff::AVRational,
    /// Stream timestamp of time zero (the first frame).
    origin: i64,
    info: VideoInfo,
    colorspace: ff::AVColorSpace,
    hardware: bool,
    require_hardware: bool,
    /// Duration used when the container doesn't give one.
    nominal: Micros,
    /// Most recently returned frame (kept so repeated requests for it cost nothing).
    current: Option<VideoFrame>,
    /// A frame decoded past a seek target, to be returned next.
    pending: Option<VideoFrame>,
    /// Packets read ahead of the decoder.
    queue: VecDeque<Queued>,
    /// The demuxer has no more packets.
    eof: bool,
    /// Right after a seek, before the first packet has been read.
    just_seeked: bool,
    /// Packets skipped since the seek while waiting for a keyframe.
    skipped: u32,
    /// Drop frames that start before this stream timestamp: the keyframe a seek landed on.
    /// Open-GOP leading pictures come before it and reference frames we never decoded.
    drop_before: i64,
    cache: FrameCache,
    /// Approximate size of one decoded frame.
    frame_bytes: usize,
    /// The time most recently asked for (cache eviction keeps frames near it).
    request: Micros,
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
            let info_depth = info.bit_depth;
            let extra = if (*par).extradata.is_null() { &[][..] } else { std::slice::from_raw_parts((*par).extradata, (*par).extradata_size as usize) };
            let mut dec = VideoDecoder {
                input,
                stream,
                codec,
                device,
                threads: opts.threads as i32,
                native_videotoolbox: opts.native_videotoolbox,
                nal: nal::detect((*par).codec_id, extra),
                backend: Backend::Ffmpeg { ctx: CodecContext(std::ptr::null_mut()), flush_sent: false },
                frame: ff::av_frame_alloc(),
                tb: (*st).time_base,
                origin: if (*st).start_time != ff::AV_NOPTS_VALUE { (*st).start_time } else { ff::AV_NOPTS_VALUE },
                nominal: info.frame_rate.map(|r| r.frame_duration()).unwrap_or(Micros(33_333)),
                colorspace: (*par).color_space,
                info,
                hardware: !device.is_null(),
                require_hardware: opts.hardware == HardwareMode::Require,
                current: None,
                pending: None,
                queue: VecDeque::new(),
                eof: false,
                just_seeked: false,
                skipped: 0,
                drop_before: ff::AV_NOPTS_VALUE,
                cache: FrameCache::new(opts.cache_bytes),
                frame_bytes: ((*par).width.max(1) as usize * (*par).height.max(1) as usize * 3 / 2) << ((info_depth > 8) as usize),
                request: Micros::ZERO,
                stats: DecodeStats::default(),
            };
            dec.backend = dec.new_backend()?;
            if dec.origin == ff::AV_NOPTS_VALUE {
                // No start time in the container: the first frame defines time zero.
                if let Some(first) = dec.decode()? {
                    dec.pending = Some(first);
                }
            }
            Ok(dec)
        }
    }

    /// The native VideoToolbox decoder when it can take the stream, FFmpeg's otherwise.
    unsafe fn new_backend(&self) -> Result<Backend, MediaError> {
        #[cfg(target_os = "macos")]
        if self.hardware && self.native_videotoolbox {
            if let Some((codec, nal::Framing::LengthPrefixed(_))) = self.nal {
                let par = (*self.input.stream(self.stream)).codecpar;
                if let Some(vt) = crate::vt::VtDecoder::new(codec, par, self.tb, self.info.bit_depth) {
                    return Ok(Backend::Native(vt));
                }
            }
        }
        Ok(Backend::Ffmpeg { ctx: self.new_context()?, flush_sent: false })
    }

    /// A configured, opened FFmpeg codec context for the stream.
    unsafe fn new_context(&self) -> Result<CodecContext, MediaError> {
        let st = self.input.stream(self.stream);
        let ctx = CodecContext(ff::avcodec_alloc_context3(self.codec));
        let c = ctx.0;
        check("avcodec_parameters_to_context", ff::avcodec_parameters_to_context(c, (*st).codecpar))?;
        (*c).pkt_timebase = (*st).time_base;
        // Never hand out frames the decoder knows are damaged (e.g. before a recovery point).
        (*c).flags &= !(ff::AV_CODEC_FLAG_OUTPUT_CORRUPT as i32);
        (*c).thread_count = self.threads;
        (*c).thread_type = ff::FF_THREAD_FRAME | ff::FF_THREAD_SLICE;
        if !self.device.is_null() {
            (*c).hw_device_ctx = ff::av_buffer_ref(self.device);
            (*c).get_format = Some(pick_hw_format);
            // The GPU does the work; frame threads around it only add latency.
            (*c).thread_count = 1;
        }
        check("avcodec_open2", ff::avcodec_open2(c, self.codec, std::ptr::null_mut()))?;
        Ok(ctx)
    }

    pub fn info(&self) -> &VideoInfo {
        &self.info
    }

    /// True if the decoder was set up for hardware decoding (individual frames may still
    /// fall back to software if the hardware rejects the stream; see [`VideoFrame::is_hardware`]).
    pub fn hardware(&self) -> bool {
        self.hardware
    }

    /// True if frames come from the native VideoToolbox path.
    pub fn native_videotoolbox(&self) -> bool {
        #[cfg(target_os = "macos")]
        if let Backend::Native(_) = self.backend {
            return true;
        }
        false
    }

    pub fn stats(&self) -> DecodeStats {
        let mut s = self.stats;
        #[cfg(target_os = "macos")]
        if let Backend::Native(vt) = &self.backend {
            s.decode_errors += vt.errors();
        }
        s
    }

    /// The next frame in presentation order, or `None` at the end of the stream.
    pub fn next_frame(&mut self) -> Result<Option<VideoFrame>, MediaError> {
        let next = match self.pending.take() {
            Some(f) => Some(f),
            None => self.decode_cached()?,
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
        self.request = t;
        if let Some(f) = self.cache.get(t) {
            self.stats.cache_hits += 1;
            return f.map(Some);
        }
        // Stepping or playing backward: output the whole GOP up to `t` so the frames before it
        // come from the cache next time. (A long jump back is just a seek.)
        let backward = self.current.as_ref().is_some_and(|c| t < c.time && c.time.0 - t.0 <= REVERSE_WINDOW);
        if !self.can_reach_by_decoding(t) {
            self.seek_before(t, 0)?;
        }
        let mut retreat = 0;
        loop {
            if !backward && self.pending.as_ref().is_none_or(|p| p.time <= t) {
                self.prepare_target(t)?;
            }
            // Decode forward until the next frame would start after `t`.
            loop {
                if let Some(p) = &self.pending {
                    if p.time > t {
                        break;
                    }
                }
                let next = match self.pending.take() {
                    Some(f) => Some(f),
                    None => self.decode_cached()?,
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

    /// Read ahead to the frame shown at `t` and mark every queued picture before it as
    /// reference-only, so the native decoder doesn't output (or allocate) pictures nobody
    /// will see. All candidates are known once a packet decodes after `t`: no later packet
    /// can present at or before it.
    fn prepare_target(&mut self, t: Micros) -> Result<(), MediaError> {
        #[cfg(target_os = "macos")]
        if let Backend::Native(_) = self.backend {
            if self.origin == ff::AV_NOPTS_VALUE {
                return Ok(());
            }
            // Compare in microseconds, rounded exactly like frame times, so the frame chosen
            // here is the one `frame_at` will pick.
            let (origin, tb) = (self.origin, self.tb);
            let after = move |ts: i64| ts != ff::AV_NOPTS_VALUE && unsafe { ff::av_rescale_q(ts - origin, tb, MICROS) } > t.0;
            while !self.eof && self.queue.len() < MAX_LOOKAHEAD && !self.queue.back().is_some_and(|q| after(q.dts())) {
                if let Some(q) = self.read_packet()? {
                    self.queue.push_back(q);
                }
            }
            let floor = self.drop_before;
            let shown = self
                .queue
                .iter()
                .map(Queued::pts)
                .filter(|&p| p != ff::AV_NOPTS_VALUE && !after(p) && (floor == ff::AV_NOPTS_VALUE || p >= floor))
                .max();
            if let Some(shown) = shown {
                for q in &mut self.queue {
                    q.output = q.pts() == ff::AV_NOPTS_VALUE || q.pts() >= shown;
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = t;
        Ok(())
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
            match &mut self.backend {
                Backend::Ffmpeg { ctx, flush_sent } => {
                    ff::avcodec_flush_buffers(ctx.0);
                    *flush_sent = false;
                }
                #[cfg(target_os = "macos")]
                Backend::Native(vt) => vt.reset(),
            }
        }
        self.stats.seeks += 1;
        self.current = None;
        self.pending = None;
        self.queue.clear();
        self.eof = false;
        self.just_seeked = true;
        self.skipped = 0;
        self.drop_before = ff::AV_NOPTS_VALUE;
        self.cache.break_chain();
        Ok(())
    }

    /// Next packet of our stream from the demuxer. After a seek, skips to the first keyframe
    /// and, if that keyframe is open-GOP, restarts a hardware decoder.
    fn read_packet(&mut self) -> Result<Option<Queued>, MediaError> {
        unsafe {
            loop {
                let q = Queued { pkt: ff::av_packet_alloc(), output: true };
                if ff::av_read_frame(self.input.0, q.pkt) < 0 {
                    // End of file (or a read error).
                    self.eof = true;
                    return Ok(None);
                }
                if (*q.pkt).stream_index != self.stream {
                    continue;
                }
                if self.just_seeked {
                    let key = (*q.pkt).flags & ff::AV_PKT_FLAG_KEY != 0;
                    // Containers without an index (MPEG-TS) land near a keyframe, not on one:
                    // start feeding the decoder at the first keyframe.
                    if !key && self.skipped < MAX_SKIP_TO_KEY {
                        self.skipped += 1;
                        continue;
                    }
                    self.just_seeked = false;
                    if key {
                        self.drop_before = (*q.pkt).pts;
                        if self.hardware && self.open_gop_keyframe(q.pkt) {
                            // VideoToolbox keeps its own reference pictures, which a flush
                            // doesn't clear, and only an IDR picture resets them. After an
                            // open-GOP keyframe it would resolve references to stale surfaces
                            // from before the seek, so start a fresh session.
                            self.backend = self.new_backend()?;
                            self.stats.sessions_reset += 1;
                        }
                    }
                }
                return Ok(Some(q));
            }
        }
    }

    fn next_packet(&mut self) -> Result<Option<Queued>, MediaError> {
        match self.queue.pop_front() {
            Some(q) => Ok(Some(q)),
            None if self.eof => Ok(None),
            None => self.read_packet(),
        }
    }

    /// Whether `pkt` is a keyframe that doesn't reset reference pictures.
    unsafe fn open_gop_keyframe(&self, pkt: *const ff::AVPacket) -> bool {
        match self.nal {
            Some((codec, framing)) => !nal::is_idr(codec, framing, std::slice::from_raw_parts((*pkt).data, (*pkt).size as usize)),
            None => false,
        }
    }

    fn time_of(&mut self, ts: i64) -> Micros {
        if self.origin == ff::AV_NOPTS_VALUE && ts != ff::AV_NOPTS_VALUE {
            self.origin = ts;
        }
        if ts == ff::AV_NOPTS_VALUE {
            self.current.as_ref().map(|c| c.time + c.duration).unwrap_or(Micros::ZERO)
        } else {
            Micros(unsafe { ff::av_rescale_q(ts - self.origin, self.tb, MICROS) })
        }
    }

    fn dropped(&self, ts: i64) -> bool {
        self.drop_before != ff::AV_NOPTS_VALUE && ts != ff::AV_NOPTS_VALUE && ts < self.drop_before
    }

    /// [`Self::decode`], remembering the frame in the cache.
    fn decode_cached(&mut self) -> Result<Option<VideoFrame>, MediaError> {
        let f = self.decode()?;
        if let Some(f) = &f {
            self.cache.insert(f, self.frame_bytes, self.request)?;
        }
        Ok(f)
    }

    /// Pull the next frame out of the decoder, feeding it packets as needed.
    fn decode(&mut self) -> Result<Option<VideoFrame>, MediaError> {
        loop {
            match &mut self.backend {
                Backend::Ffmpeg { ctx, flush_sent } => unsafe {
                    let r = ff::avcodec_receive_frame(ctx.0, self.frame);
                    if r == 0 {
                        self.stats.frames_decoded += 1;
                        let f = self.frame;
                        let mut ts = (*f).best_effort_timestamp;
                        if ts == ff::AV_NOPTS_VALUE {
                            ts = (*f).pts;
                        }
                        if self.dropped(ts) {
                            ff::av_frame_unref(f);
                            continue;
                        }
                        let time = self.time_of(ts);
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
                    if *flush_sent {
                        return Ok(None);
                    }
                    // Reading may restart the decoder (open-GOP keyframe after a seek), so
                    // look the context up again afterwards.
                    let packet = self.next_packet()?;
                    let Backend::Ffmpeg { ctx, .. } = &self.backend else { continue };
                    let ctx = ctx.0;
                    match packet {
                        Some(q) => {
                            let r = ff::avcodec_send_packet(ctx, q.pkt);
                            if r < 0 && r != ff::AVERROR(ff::EAGAIN) {
                                // A damaged packet (or one picture the hardware rejected) costs
                                // that picture, not the stream.
                                self.stats.decode_errors += 1;
                                if self.stats.decode_errors > MAX_DECODE_ERRORS {
                                    return Err(MediaError::ffmpeg("avcodec_send_packet", r));
                                }
                            }
                        }
                        None => {
                            // Drain what the decoder still holds.
                            ff::avcodec_send_packet(ctx, std::ptr::null());
                            if let Backend::Ffmpeg { flush_sent, .. } = &mut self.backend {
                                *flush_sent = true;
                            }
                        }
                    }
                },
                #[cfg(target_os = "macos")]
                Backend::Native(vt) => {
                    let done = self.eof && self.queue.is_empty();
                    match vt.next(done) {
                        crate::vt::Next::Frame(pts, Some(buffer)) => {
                            if self.dropped(pts) {
                                continue;
                            }
                            let time = self.time_of(pts);
                            return Ok(Some(VideoFrame::from_pixel_buffer(buffer, self.colorspace, time, self.nominal)));
                        }
                        crate::vt::Next::Frame(_, None) => continue, // counted in vt.errors()
                        crate::vt::Next::Drained => return Ok(None),
                        crate::vt::Next::NeedInput => {
                            if let Some(q) = self.next_packet()? {
                                self.stats.frames_decoded += 1;
                                if !q.output {
                                    if self.origin != ff::AV_NOPTS_VALUE && q.pts() != ff::AV_NOPTS_VALUE {
                                        self.cache.hide(Micros(unsafe { ff::av_rescale_q(q.pts() - self.origin, self.tb, MICROS) }));
                                    } else {
                                        self.cache.break_chain();
                                    }
                                }
                                if let Backend::Native(vt) = &mut self.backend {
                                    vt.submit(q.pkt, q.output)?;
                                }
                            }
                        }
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
        self.queue.clear();
        self.cache = FrameCache::new(0);
        // Free the decoder (and its hold on the device) before the device.
        self.backend = Backend::Ffmpeg { ctx: CodecContext(std::ptr::null_mut()), flush_sent: false };
        unsafe {
            ff::av_frame_free(&mut self.frame);
            ff::av_buffer_unref(&mut self.device);
        }
    }
}
