//! FFmpeg's encoders fed pictures read back from the GPU: ProRes in software (`prores_ks`, every
//! platform) and Windows' own H.264/HEVC encoders (Media Foundation's `h264_mf` / `hevc_mf`:
//! the GPU's where the machine has one, else Microsoft's software encoder).
//!
//! Each frame is composited on the GPU and read back as RGBA, then converted by FFmpeg's
//! swscale to the encoder's YUV (BT.709, limited range, as the VideoToolbox path writes). A
//! picture with alpha (ProRes 4444) keeps it, un-premultiplied: ProRes carries straight alpha.

use std::path::Path;

use ffmpeg_sys_next as ff;
use openrip_playback::{FrameReport, PreviewError};
use openrip_render::RgbaImage;

use crate::mux::{check, set_option, FfVideo, Muxer};
use crate::{Backend, Codec, Encoder, ExportError, ExportOptions, Picture};

/// FFmpeg's encoder for a backend and codec, the pixels it takes and its own options.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Spec {
    pub(crate) name: &'static str,
    pub(crate) pix_fmt: ff::AVPixelFormat,
    pub(crate) options: Vec<(&'static str, &'static str)>,
}

/// How `backend` writes `codec`, if it can (the backends here: `prores_ks` and Media
/// Foundation). Plain data on every platform, so the Windows choices are tested anywhere.
pub(crate) fn spec(backend: Backend, codec: Codec, exact_bitrate: bool) -> Option<Spec> {
    match (backend, codec) {
        (Backend::ProResKs, Codec::ProRes(p)) => Some(Spec {
            name: "prores_ks",
            pix_fmt: if codec.has_alpha() { ff::AVPixelFormat::AV_PIX_FMT_YUVA444P10LE } else { ff::AVPixelFormat::AV_PIX_FMT_YUV422P10LE },
            // "apl0": the vendor Apple's own encoder writes, which some players look for.
            options: vec![("profile", p.profile_name()), ("vendor", "apl0")],
        }),
        (Backend::MediaFoundation { hardware }, Codec::H264 | Codec::Hevc) => Some(Spec {
            name: if codec == Codec::H264 { "h264_mf" } else { "hevc_mf" },
            pix_fmt: ff::AVPixelFormat::AV_PIX_FMT_NV12,
            options: [
                // A hardware encoder, or a software one (Microsoft's), never whichever comes first.
                Some(("hw_encoding", if hardware { "1" } else { "0" })),
                // Constant frame rate: the encoder doesn't drop frames (FFmpeg's mfenc.c).
                Some(("scenario", "camera_record")),
                exact_bitrate.then_some(("rate_control", "cbr")),
            ]
            .into_iter()
            .flatten()
            .collect(),
        }),
        _ => None,
    }
}

/// Open `spec`'s encoder for `o` (no file): the probe, and the first step of an export.
fn open_video(spec: &Spec, global_header: bool, o: &ExportOptions) -> Result<FfVideo, ExportError> {
    FfVideo::open(spec.name, global_header, o, |e| unsafe {
        (*e).pix_fmt = spec.pix_fmt;
        FfVideo::bt709(e);
        // Slices or frames on every core (prores_ks); Media Foundation threads itself.
        (*e).thread_count = 0;
        for (k, v) in &spec.options {
            set_option(e, k, v);
        }
    })
}

/// Whether `backend` opens for `codec` on this machine, with a tiny picture.
pub(crate) fn probe(backend: Backend, codec: Codec) -> bool {
    let Some(spec) = spec(backend, codec, false) else { return false };
    let o = ExportOptions { width: 256, height: 144, fps: openrip_model::FrameRate::new(30, 1), codec, bitrate: 2_000_000, exact_bitrate: false, audio: false, hardware: false };
    open_video(&spec, false, &o).is_ok()
}

/// [`probe`], once a run for each backend and codec.
pub(crate) fn probe_cached(backend: Backend, codec: Codec) -> bool {
    static FOUND: std::sync::Mutex<Vec<(Backend, Codec, bool)>> = std::sync::Mutex::new(Vec::new());
    let mut found = FOUND.lock().unwrap();
    if let Some((.., ok)) = found.iter().find(|(b, c, _)| *b == backend && *c == codec) {
        return *ok;
    }
    let ok = probe(backend, codec);
    found.push((backend, codec, ok));
    ok
}

/// RGBA pictures to an encoder's YUV, through swscale (on every core).
pub(crate) struct Scaler {
    ctx: *mut ff::SwsContext,
    src: *mut ff::AVFrame,
}

impl Drop for Scaler {
    fn drop(&mut self) {
        unsafe {
            ff::av_frame_free(&mut self.src);
            ff::sws_free_context(&mut self.ctx);
        }
    }
}

impl Scaler {
    pub(crate) fn new() -> Scaler {
        unsafe {
            let ctx = ff::sws_alloc_context();
            (*ctx).threads = 0;
            (*ctx).flags = (ff::SwsFlags::SWS_BILINEAR as u32) | (ff::SwsFlags::SWS_ACCURATE_RND as u32);
            Scaler { ctx, src: ff::av_frame_alloc() }
        }
    }

    /// Convert `image` into `dst`, whose format and size are set; its buffers are allocated
    /// here. The picture is BT.709 limited range (the RGB is taken as BT.709 too, so only the
    /// matrix applies, as on the GPU path).
    pub(crate) unsafe fn convert(&mut self, image: &RgbaImage, dst: *mut ff::AVFrame) -> Result<(), ExportError> {
        let s = self.src;
        ff::av_frame_unref(s);
        (*s).format = ff::AVPixelFormat::AV_PIX_FMT_RGBA as i32;
        (*s).width = image.width as i32;
        (*s).height = image.height as i32;
        (*s).data[0] = image.data.as_ptr() as *mut u8;
        (*s).linesize[0] = image.width as i32 * 4;
        (*s).color_range = ff::AVColorRange::AVCOL_RANGE_JPEG;
        (*s).color_primaries = ff::AVColorPrimaries::AVCOL_PRI_BT709;
        (*s).color_trc = ff::AVColorTransferCharacteristic::AVCOL_TRC_BT709;
        (*s).colorspace = ff::AVColorSpace::AVCOL_SPC_RGB;
        (*dst).color_range = ff::AVColorRange::AVCOL_RANGE_MPEG;
        (*dst).color_primaries = ff::AVColorPrimaries::AVCOL_PRI_BT709;
        (*dst).color_trc = ff::AVColorTransferCharacteristic::AVCOL_TRC_BT709;
        (*dst).colorspace = ff::AVColorSpace::AVCOL_SPC_BT709;
        check("av_frame_get_buffer", ff::av_frame_get_buffer(dst, 0))?;
        let r = check("sws_scale_frame", ff::sws_scale_frame(self.ctx, dst, s));
        // The source's planes are borrowed from `image`: forget them, don't free them.
        (*s).data[0] = std::ptr::null_mut();
        r.map(|_| ())
    }
}

/// Premultiplied RGBA (the transparent canvas's) to straight alpha, in place.
pub(crate) fn unpremultiply(rgba: &mut [u8]) {
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a == 255 {
            continue;
        }
        for c in &mut px[..3] {
            *c = if a == 0 { 0 } else { ((*c as u32 * 255 + a / 2) / a).min(255) as u8 };
        }
    }
}

/// An export through one of FFmpeg's encoders fed read-back pixels.
pub(crate) struct SwEncoder {
    scaler: Scaler,
    image: Option<RgbaImage>,
    straight_alpha: bool,
    video: FfVideo,
    mux: Muxer,
}

impl SwEncoder {
    pub(crate) fn open(backend: Backend, path: &Path, o: &ExportOptions) -> Result<SwEncoder, ExportError> {
        let spec = spec(backend, o.codec, o.exact_bitrate).ok_or_else(|| ExportError::Other(format!("{} can't write {}", backend.name(), o.codec.name())))?;
        let mut mux = Muxer::new(path)?;
        let video = open_video(&spec, mux.global_header(), o)?;
        unsafe { mux.add_video(video.enc, o.codec)? };
        mux.start(o.audio)?;
        Ok(SwEncoder { scaler: Scaler::new(), image: None, straight_alpha: o.codec.has_alpha(), video, mux })
    }
}

impl Encoder for SwEncoder {
    fn video(&mut self, index: i64, draw: &mut dyn FnMut(Picture<'_>) -> Result<FrameReport, PreviewError>) -> Result<FrameReport, ExportError> {
        let (w, h) = unsafe { ((*self.video.enc).width as u32, (*self.video.enc).height as u32) };
        let mut image = self.image.take().unwrap_or(RgbaImage { width: w, height: h, data: Vec::new() });
        let report = draw(Picture::Rgba(&mut image))?;
        if self.straight_alpha {
            unpremultiply(&mut image.data);
        }
        unsafe {
            let f = self.video.frame;
            ff::av_frame_unref(f);
            (*f).format = (*self.video.enc).pix_fmt as i32;
            (*f).width = w as i32;
            (*f).height = h as i32;
            self.scaler.convert(&image, f)?;
            (*f).pts = index;
            let sent = self.video.send(&mut self.mux, f);
            ff::av_frame_unref(f);
            sent?;
        }
        self.image = Some(image);
        Ok(report)
    }

    fn audio(&mut self, samples: &[f32], flush: bool) -> Result<(), ExportError> {
        self.mux.encode_audio(samples, flush)
    }

    fn finish(mut self: Box<Self>) -> Result<(), ExportError> {
        unsafe { self.video.send(&mut self.mux, std::ptr::null())? };
        self.mux.finish()
    }

    fn cancel(self: Box<Self>) {
        let path = self.mux.path().to_path_buf();
        drop(self);
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ProRes;

    #[test]
    fn prores_takes_10_bit_422_or_4444_with_alpha() {
        let s = spec(Backend::ProResKs, Codec::ProRes(ProRes::Hq), false).unwrap();
        assert_eq!((s.name, s.pix_fmt), ("prores_ks", ff::AVPixelFormat::AV_PIX_FMT_YUV422P10LE));
        assert!(s.options.contains(&("profile", "hq")));
        let s = spec(Backend::ProResKs, Codec::ProRes(ProRes::FourFourFourFour), false).unwrap();
        assert_eq!(s.pix_fmt, ff::AVPixelFormat::AV_PIX_FMT_YUVA444P10LE);
        assert!(spec(Backend::ProResKs, Codec::H264, false).is_none());
    }

    #[test]
    fn media_foundation_hardware_and_software() {
        let hw = spec(Backend::MediaFoundation { hardware: true }, Codec::H264, true).unwrap();
        assert_eq!(hw.name, "h264_mf");
        assert!(hw.options.contains(&("hw_encoding", "1")) && hw.options.contains(&("rate_control", "cbr")));
        let sw = spec(Backend::MediaFoundation { hardware: false }, Codec::Hevc, false).unwrap();
        assert_eq!(sw.name, "hevc_mf");
        assert!(sw.options.contains(&("hw_encoding", "0")) && !sw.options.iter().any(|(k, _)| *k == "rate_control"));
        assert!(spec(Backend::MediaFoundation { hardware: true }, Codec::HevcAlpha, false).is_none());
        assert!(spec(Backend::MediaFoundation { hardware: true }, Codec::ProRes(ProRes::Lt), false).is_none());
    }

    #[test]
    fn unpremultiplies() {
        let mut px = [64, 32, 0, 128, 10, 20, 30, 255, 9, 9, 9, 0];
        unpremultiply(&mut px);
        assert_eq!(px, [128, 64, 0, 128, 10, 20, 30, 255, 0, 0, 0, 0]);
    }
}
