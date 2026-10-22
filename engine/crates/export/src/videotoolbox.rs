//! VideoToolbox's H.264, HEVC and ProRes encoders through FFmpeg, muxed by FFmpeg (MP4/MOV), with
//! AAC audio: the export encoder on Apple platforms.
//!
//! Each frame is composited on the GPU straight into an NV12 (BT.709, limited range)
//! IOSurface from a CoreVideo pool, which goes to the encoder as a hardware frame: no pixel
//! copies and no CPU colour conversion.
//!
//! The codecs with an alpha channel (HEVC with alpha, ProRes 4444) take frames drawn over a
//! transparent canvas and read back (premultiplied RGBA) instead, as BGRA pictures; ProRes 4444's
//! un-premultiplied first, as the software encoder writes it (ProRes carries straight alpha).

use std::ffi::CString;
use std::path::Path;

use ffmpeg_sys_next as ff;
use openrip_playback::{FrameReport, PreviewError};

use crate::mux::{check, set_option, FfVideo, Muxer};
use crate::{Codec, Encoder, ExportError, ExportOptions, Picture};

fn encoder_name(codec: Codec) -> &'static str {
    match codec {
        Codec::H264 => "h264_videotoolbox",
        Codec::Hevc | Codec::HevcAlpha => "hevc_videotoolbox",
        Codec::ProRes(_) => "prores_videotoolbox",
    }
}

/// The options a codec's encoder has beyond the picture's: ProRes's profile, HEVC's alpha quality.
unsafe fn set_codec_options(e: *mut ff::AVCodecContext, codec: Codec) {
    match codec {
        Codec::HevcAlpha => set_option(e, "alpha_quality", "0.75"),
        Codec::ProRes(p) => set_option(e, "profile", p.profile_name()),
        _ => true,
    };
}

/// The codecs the encoders here can open on this machine (each is tried: an encoder that is
/// built in may still be refused by the system, or by this Mac's hardware).
pub(crate) fn available() -> Vec<Codec> {
    static CODECS: std::sync::OnceLock<Vec<Codec>> = std::sync::OnceLock::new();
    CODECS.get_or_init(|| Codec::ALL.into_iter().filter(|c| probe(*c, 256, 144)).collect()).clone()
}

/// The largest of the sizes exports offer (8K, then 4K) that `codec`'s encoder opens at, as
/// longer side x shorter side.
pub(crate) fn max_size(codec: Codec) -> (u32, u32) {
    static SIZES: std::sync::Mutex<Vec<(Codec, (u32, u32))>> = std::sync::Mutex::new(Vec::new());
    let mut sizes = SIZES.lock().unwrap();
    if let Some((_, s)) = sizes.iter().find(|(c, _)| *c == codec) {
        return *s;
    }
    let s = [(7680u32, 4320u32), (4096, 2304), (3840, 2160)].into_iter().find(|(w, h)| probe(codec, *w as i32, *h as i32)).unwrap_or((1920, 1080));
    sizes.push((codec, s));
    s
}

fn probe(codec: Codec, width: i32, height: i32) -> bool {
    let name = CString::new(encoder_name(codec)).unwrap();
    unsafe {
        let enc = ff::avcodec_find_encoder_by_name(name.as_ptr());
        if enc.is_null() {
            return false;
        }
        let mut e = ff::avcodec_alloc_context3(enc);
        (*e).width = width;
        (*e).height = height;
        (*e).time_base = ff::AVRational { num: 1, den: 30 };
        (*e).framerate = ff::AVRational { num: 30, den: 1 };
        if codec.has_alpha() {
            (*e).pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_BGRA;
            (*e).color_range = ff::AVColorRange::AVCOL_RANGE_JPEG;
        } else {
            (*e).pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX;
            (*e).sw_pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_NV12;
        }
        (*e).bit_rate = 2_000_000;
        set_codec_options(e, codec);
        let ok = ff::avcodec_open2(e, enc, std::ptr::null_mut()) >= 0;
        ff::avcodec_free_context(&mut e);
        ok
    }
}

/// The VideoToolbox encoder for `o`, as FFmpeg opens it.
fn open_video(mux: &Muxer, o: &ExportOptions) -> Result<FfVideo, ExportError> {
    FfVideo::open(encoder_name(o.codec), mux.global_header(), o, |e| unsafe {
        if o.codec.has_alpha() {
            // Frames arrive as BGRA pixels read back from the GPU. (The picture with alpha is
            // RGB: it carries no YCbCr matrix or range.)
            (*e).pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_BGRA;
            (*e).color_range = ff::AVColorRange::AVCOL_RANGE_JPEG;
        } else {
            // Frames arrive as CVPixelBuffers (NV12) we rendered into on the GPU.
            (*e).pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX;
            (*e).sw_pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_NV12;
            FfVideo::bt709(e);
        }
        set_codec_options(e, o.codec);
        if o.exact_bitrate && !matches!(o.codec, Codec::ProRes(_)) {
            // macOS 13 or newer; older systems refuse the open, which then fails.
            let key = CString::new("constant_bit_rate").unwrap();
            ff::av_opt_set_int((*e).priv_data, key.as_ptr(), 1, 0);
        }
    })
}

/// Send one CVPixelBuffer (or `None` to flush) and write whatever packets come out.
fn encode_pixel_buffer(video: &mut FfVideo, mux: &mut Muxer, frame: Option<(&objc2_core_video::CVPixelBuffer, i64)>) -> Result<(), ExportError> {
    unsafe {
        let f = match frame {
            Some((pb, pts)) => {
                let f = video.frame;
                ff::av_frame_unref(f);
                (*f).format = ff::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX as i32;
                (*f).width = (*video.enc).width;
                (*f).height = (*video.enc).height;
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
        let sent = video.send(mux, f);
        if !f.is_null() {
            ff::av_frame_unref(f);
        }
        sent
    }
}

/// Send one BGRA picture (premultiplied alpha, `width * 4` bytes a row) and write what comes out.
fn encode_bgra(video: &mut FfVideo, mux: &mut Muxer, bgra: &[u8], pts: i64) -> Result<(), ExportError> {
    unsafe {
        let f = video.frame;
        ff::av_frame_unref(f);
        (*f).format = ff::AVPixelFormat::AV_PIX_FMT_BGRA as i32;
        (*f).width = (*video.enc).width;
        (*f).height = (*video.enc).height;
        (*f).pts = pts;
        check("av_frame_get_buffer", ff::av_frame_get_buffer(f, 0))?;
        let (w, h, stride) = ((*f).width as usize, (*f).height as usize, (*f).linesize[0] as usize);
        for y in 0..h {
            std::ptr::copy_nonoverlapping(bgra.as_ptr().add(y * w * 4), (*f).data[0].add(y * stride), w * 4);
        }
        let sent = video.send(mux, f);
        ff::av_frame_unref(f);
        sent
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

/// The pool and the encoder for one export.
pub(crate) struct VtEncoder {
    /// The NV12 pool; none for a codec with alpha, which takes read-back pixels.
    pool: Option<Pool>,
    image: Option<openrip_render::RgbaImage>,
    /// ProRes 4444: its alpha is written straight.
    straight_alpha: bool,
    video: FfVideo,
    mux: Muxer,
}

impl VtEncoder {
    pub(crate) fn open(path: &Path, o: &ExportOptions) -> Result<VtEncoder, ExportError> {
        let pool = if o.codec.has_alpha() { None } else { Some(Pool::new(o.width, o.height).ok_or_else(|| ExportError::Other("can't create the frame pool".into()))?) };
        let mut mux = Muxer::new(path)?;
        let video = open_video(&mux, o)?;
        unsafe { mux.add_video(video.enc, o.codec)? };
        mux.start(o.audio)?;
        Ok(VtEncoder { pool, image: None, straight_alpha: matches!(o.codec, Codec::ProRes(_)) && o.codec.has_alpha(), video, mux })
    }
}

impl Encoder for VtEncoder {
    fn video(&mut self, index: i64, draw: &mut dyn FnMut(Picture<'_>) -> Result<FrameReport, PreviewError>) -> Result<FrameReport, ExportError> {
        let Some(pool) = &self.pool else {
            let (w, h) = unsafe { ((*self.video.enc).width as u32, (*self.video.enc).height as u32) };
            let mut image = self.image.take().unwrap_or(openrip_render::RgbaImage { width: w, height: h, data: Vec::new() });
            let report = draw(Picture::Rgba(&mut image))?;
            if self.straight_alpha {
                crate::software::unpremultiply(&mut image.data);
            }
            // RGBA to BGRA, in place.
            for px in image.data.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            encode_bgra(&mut self.video, &mut self.mux, &image.data, index)?;
            self.image = Some(image);
            return Ok(report);
        };
        let pb = pool.next().ok_or_else(|| ExportError::Other("frame pool exhausted".into()))?;
        let report = draw(Picture::Nv12(&pb))?;
        encode_pixel_buffer(&mut self.video, &mut self.mux, Some((&pb, index)))?;
        Ok(report)
    }

    fn audio(&mut self, samples: &[f32], flush: bool) -> Result<(), ExportError> {
        self.mux.encode_audio(samples, flush)
    }

    fn finish(mut self: Box<Self>) -> Result<(), ExportError> {
        encode_pixel_buffer(&mut self.video, &mut self.mux, None)?;
        self.mux.finish()
    }

    fn cancel(self: Box<Self>) {
        let path = self.mux.path().to_path_buf();
        drop(self);
        let _ = std::fs::remove_file(path);
    }
}
