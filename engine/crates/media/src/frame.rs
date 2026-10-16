use ffmpeg_sys_next as ff;

use crate::error::check;
use crate::{MediaError, Micros};

/// YCbCr→RGB matrix of a frame.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Matrix {
    Bt601,
    Bt709,
    Bt2020,
}

/// Memory layout of a decoded frame (for hardware frames, of the GPU surface).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PixelFormat {
    Nv12,
    P010,
    Yuv420p,
    Yuv420p10,
    Yuv422p,
    Yuv444p,
    Other(i32),
}

impl PixelFormat {
    fn from_av(f: ff::AVPixelFormat) -> Self {
        use ff::AVPixelFormat::*;
        match f {
            AV_PIX_FMT_NV12 => PixelFormat::Nv12,
            AV_PIX_FMT_P010LE => PixelFormat::P010,
            AV_PIX_FMT_YUV420P | AV_PIX_FMT_YUVJ420P => PixelFormat::Yuv420p,
            AV_PIX_FMT_YUV420P10LE => PixelFormat::Yuv420p10,
            AV_PIX_FMT_YUV422P | AV_PIX_FMT_YUVJ422P => PixelFormat::Yuv422p,
            AV_PIX_FMT_YUV444P | AV_PIX_FMT_YUVJ444P => PixelFormat::Yuv444p,
            other => PixelFormat::Other(other as i32),
        }
    }
}

enum Pixels {
    /// A frame from FFmpeg's decoder (software, or VideoToolbox through FFmpeg's hwaccel).
    Av(*mut ff::AVFrame),
    /// A frame from the native VideoToolbox decoder.
    #[cfg(target_os = "macos")]
    Cv { buffer: crate::vt::PixelBuffer, colorspace: ff::AVColorSpace },
}

/// A decoded frame. Holds a reference on FFmpeg's buffer (or the hardware surface), so it
/// is cheap to keep and to move between threads.
pub struct VideoFrame {
    pixels: Pixels,
    /// Presentation time from the first frame of the stream.
    pub time: Micros,
    /// How long the frame is displayed.
    pub duration: Micros,
}

// The frame owns its own reference; FFmpeg frames and CVPixelBuffers may be used from any thread.
unsafe impl Send for VideoFrame {}

#[cfg(target_os = "macos")]
fn cv_format(pb: &objc2_core_video::CVPixelBuffer) -> (PixelFormat, bool) {
    use objc2_core_video::*;
    #[allow(non_upper_case_globals)]
    match CVPixelBufferGetPixelFormatType(pb) {
        kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange => (PixelFormat::Nv12, false),
        kCVPixelFormatType_420YpCbCr8BiPlanarFullRange => (PixelFormat::Nv12, true),
        kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange => (PixelFormat::P010, false),
        kCVPixelFormatType_420YpCbCr10BiPlanarFullRange => (PixelFormat::P010, true),
        other => (PixelFormat::Other(other as i32), false),
    }
}

impl VideoFrame {
    /// Take a new reference to `src` (no pixel copy).
    pub(crate) fn reference(src: *const ff::AVFrame, time: Micros, duration: Micros) -> Result<Self, MediaError> {
        let raw = unsafe { ff::av_frame_clone(src) };
        if raw.is_null() {
            return Err(MediaError::ffmpeg("av_frame_clone", ff::AVERROR(ff::ENOMEM)));
        }
        Ok(VideoFrame { pixels: Pixels::Av(raw), time, duration })
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn from_pixel_buffer(buffer: crate::vt::PixelBuffer, colorspace: ff::AVColorSpace, time: Micros, duration: Micros) -> Self {
        VideoFrame { pixels: Pixels::Cv { buffer, colorspace }, time, duration }
    }

    /// Another reference to the same pixels (no copy).
    pub fn try_clone(&self) -> Result<Self, MediaError> {
        match &self.pixels {
            Pixels::Av(raw) => VideoFrame::reference(*raw, self.time, self.duration),
            #[cfg(target_os = "macos")]
            Pixels::Cv { buffer, colorspace } => {
                Ok(Self::from_pixel_buffer(crate::vt::PixelBuffer(buffer.0.clone()), *colorspace, self.time, self.duration))
            }
        }
    }

    pub fn width(&self) -> u32 {
        match &self.pixels {
            Pixels::Av(raw) => unsafe { (**raw).width as u32 },
            #[cfg(target_os = "macos")]
            Pixels::Cv { buffer, .. } => objc2_core_video::CVPixelBufferGetWidth(&buffer.0) as u32,
        }
    }

    pub fn height(&self) -> u32 {
        match &self.pixels {
            Pixels::Av(raw) => unsafe { (**raw).height as u32 },
            #[cfg(target_os = "macos")]
            Pixels::Cv { buffer, .. } => objc2_core_video::CVPixelBufferGetHeight(&buffer.0) as u32,
        }
    }

    /// True when the pixels live on the GPU (VideoToolbox on macOS).
    pub fn is_hardware(&self) -> bool {
        match &self.pixels {
            Pixels::Av(raw) => unsafe { (**raw).format == ff::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX as i32 },
            #[cfg(target_os = "macos")]
            Pixels::Cv { .. } => true,
        }
    }

    /// Layout of the pixels; for hardware frames, the layout of the GPU surface.
    pub fn pixel_format(&self) -> PixelFormat {
        match &self.pixels {
            Pixels::Av(raw) => unsafe {
                let raw = *raw;
                if self.is_hardware() && !(*raw).hw_frames_ctx.is_null() {
                    let fc = (*(*raw).hw_frames_ctx).data as *const ff::AVHWFramesContext;
                    return PixelFormat::from_av((*fc).sw_format);
                }
                PixelFormat::from_av(std::mem::transmute::<i32, ff::AVPixelFormat>((*raw).format))
            },
            #[cfg(target_os = "macos")]
            Pixels::Cv { buffer, .. } => cv_format(&buffer.0).0,
        }
    }

    /// The frame's YCbCr matrix; unspecified streams follow the usual convention (BT.709
    /// from 720 lines up, BT.601 below).
    pub fn matrix(&self) -> Matrix {
        let cs = match &self.pixels {
            Pixels::Av(raw) => unsafe { (**raw).colorspace },
            #[cfg(target_os = "macos")]
            Pixels::Cv { colorspace, .. } => *colorspace,
        };
        use ff::AVColorSpace::*;
        match cs {
            AVCOL_SPC_BT709 => Matrix::Bt709,
            AVCOL_SPC_BT2020_NCL | AVCOL_SPC_BT2020_CL => Matrix::Bt2020,
            AVCOL_SPC_BT470BG | AVCOL_SPC_SMPTE170M => Matrix::Bt601,
            _ if self.height() >= 720 => Matrix::Bt709,
            _ => Matrix::Bt601,
        }
    }

    /// True for full-range ("pc"/JPEG) samples, false for limited (TV) range.
    pub fn full_range(&self) -> bool {
        match &self.pixels {
            Pixels::Av(raw) => unsafe { (**raw).color_range == ff::AVColorRange::AVCOL_RANGE_JPEG },
            #[cfg(target_os = "macos")]
            Pixels::Cv { buffer, .. } => cv_format(&buffer.0).1,
        }
    }

    /// The `CVPixelBuffer` behind a hardware frame (borrowed; valid while the frame lives).
    #[cfg(target_os = "macos")]
    pub fn pixel_buffer(&self) -> Option<&objc2_core_video::CVPixelBuffer> {
        match &self.pixels {
            Pixels::Av(raw) => unsafe {
                if !self.is_hardware() {
                    return None;
                }
                ((**raw).data[3] as *const objc2_core_video::CVPixelBuffer).as_ref()
            },
            Pixels::Cv { buffer, .. } => Some(&buffer.0),
        }
    }

    /// The `IOSurface` backing a hardware frame, for zero-copy hand-off to the GPU / Electron.
    #[cfg(target_os = "macos")]
    pub fn io_surface(&self) -> Option<objc2_core_foundation::CFRetained<objc2_io_surface::IOSurfaceRef>> {
        objc2_core_video::CVPixelBufferGetIOSurface(Some(self.pixel_buffer()?))
    }

    /// Download (if needed) and convert to packed 8-bit RGB with full-range output, using the
    /// frame's own matrix and range. For tests, thumbnails and analysis, not the playback path.
    pub fn to_rgb(&self) -> Result<RgbImage, MediaError> {
        match &self.pixels {
            Pixels::Av(raw) => unsafe {
                let raw = *raw;
                if !self.is_hardware() {
                    return convert_rgb(raw);
                }
                let mut tmp = ff::av_frame_alloc();
                let r = ff::av_hwframe_transfer_data(tmp, raw, 0);
                let result = if r < 0 { Err(MediaError::ffmpeg("av_hwframe_transfer_data", r)) } else { convert_rgb(tmp) };
                ff::av_frame_free(&mut tmp);
                result
            },
            #[cfg(target_os = "macos")]
            Pixels::Cv { buffer, colorspace } => unsafe { cv_to_rgb(&buffer.0, *colorspace) },
        }
    }
}

/// Wrap a locked pixel buffer's planes in a (non-owning) AVFrame and convert it.
#[cfg(target_os = "macos")]
unsafe fn cv_to_rgb(pb: &objc2_core_video::CVPixelBuffer, colorspace: ff::AVColorSpace) -> Result<RgbImage, MediaError> {
    use objc2_core_video::*;
    let (format, full) = cv_format(pb);
    let av_format = match format {
        PixelFormat::Nv12 => ff::AVPixelFormat::AV_PIX_FMT_NV12,
        PixelFormat::P010 => ff::AVPixelFormat::AV_PIX_FMT_P010LE,
        _ => return Err(MediaError::Ffmpeg { op: "to_rgb", code: -1, msg: format!("unsupported pixel buffer format {format:?}") }),
    };
    if CVPixelBufferLockBaseAddress(pb, CVPixelBufferLockFlags::ReadOnly) != 0 {
        return Err(MediaError::Ffmpeg { op: "CVPixelBufferLockBaseAddress", code: -1, msg: "lock failed".into() });
    }
    let mut f = ff::av_frame_alloc();
    (*f).width = CVPixelBufferGetWidth(pb) as i32;
    (*f).height = CVPixelBufferGetHeight(pb) as i32;
    (*f).format = av_format as i32;
    (*f).colorspace = colorspace;
    (*f).color_range = if full { ff::AVColorRange::AVCOL_RANGE_JPEG } else { ff::AVColorRange::AVCOL_RANGE_MPEG };
    for plane in 0..2 {
        (*f).data[plane] = CVPixelBufferGetBaseAddressOfPlane(pb, plane) as *mut u8;
        (*f).linesize[plane] = CVPixelBufferGetBytesPerRowOfPlane(pb, plane) as i32;
    }
    let result = convert_rgb(f);
    ff::av_frame_free(&mut f); // no buffers attached: the planes stay with the pixel buffer
    CVPixelBufferUnlockBaseAddress(pb, CVPixelBufferLockFlags::ReadOnly);
    result
}

unsafe fn convert_rgb(f: *mut ff::AVFrame) -> Result<RgbImage, MediaError> {
    let (w, h) = ((*f).width, (*f).height);
    let fmt: ff::AVPixelFormat = std::mem::transmute((*f).format);
    let sws = ff::sws_getContext(
        w,
        h,
        fmt,
        w,
        h,
        ff::AVPixelFormat::AV_PIX_FMT_RGB24,
        (ff::SwsFlags::SWS_BICUBIC as u32 | ff::SwsFlags::SWS_ACCURATE_RND as u32 | ff::SwsFlags::SWS_FULL_CHR_H_INT as u32) as i32,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        std::ptr::null(),
    );
    if sws.is_null() {
        return Err(MediaError::Ffmpeg { op: "sws_getContext", code: -1, msg: format!("unsupported conversion from {fmt:?}") });
    }
    use ff::AVColorSpace::*;
    let cs = match (*f).colorspace {
        AVCOL_SPC_BT709 => ff::SWS_CS_ITU709,
        AVCOL_SPC_BT2020_NCL | AVCOL_SPC_BT2020_CL => ff::SWS_CS_BT2020,
        AVCOL_SPC_UNSPECIFIED if h >= 720 => ff::SWS_CS_ITU709,
        _ => ff::SWS_CS_ITU601,
    };
    let full = ((*f).color_range == ff::AVColorRange::AVCOL_RANGE_JPEG) as i32;
    ff::sws_setColorspaceDetails(sws, ff::sws_getCoefficients(cs), full, ff::sws_getCoefficients(cs), 1, 0, 1 << 16, 1 << 16);
    let mut data = vec![0u8; (w * h * 3) as usize];
    let dst = [data.as_mut_ptr(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()];
    let stride = [w * 3, 0, 0, 0];
    let r = ff::sws_scale(sws, (*f).data.as_ptr() as *const *const u8, (*f).linesize.as_ptr(), 0, h, dst.as_ptr(), stride.as_ptr());
    ff::sws_freeContext(sws);
    check("sws_scale", r)?;
    Ok(RgbImage { width: w as u32, height: h as u32, data })
}

impl Drop for VideoFrame {
    fn drop(&mut self) {
        if let Pixels::Av(raw) = &mut self.pixels {
            unsafe { ff::av_frame_free(raw) }
        }
    }
}

impl std::fmt::Debug for VideoFrame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VideoFrame")
            .field("time", &self.time)
            .field("duration", &self.duration)
            .field("size", &(self.width(), self.height()))
            .field("hardware", &self.is_hardware())
            .field("format", &self.pixel_format())
            .finish()
    }
}

/// Packed 8-bit RGB pixels, row-major, no padding.
#[derive(Clone, Debug)]
pub struct RgbImage {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl RgbImage {
    pub fn pixel(&self, x: u32, y: u32) -> [u8; 3] {
        let i = ((y * self.width + x) * 3) as usize;
        [self.data[i], self.data[i + 1], self.data[i + 2]]
    }
}
