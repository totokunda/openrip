//! FFmpeg's and VideoToolbox's buffers as [`VideoFrame`] pixels.

use ffmpeg_sys_next as ff;
use openrip_frame::{FrameError, FramePixels, Matrix, PixelFormat, RgbImage, Transfer, VideoFrame};

use crate::error::check;
use crate::{MediaError, Micros};

fn pixel_format_of(f: ff::AVPixelFormat) -> PixelFormat {
    use ff::AVPixelFormat::*;
    match f {
        AV_PIX_FMT_NV12 => PixelFormat::Nv12,
        AV_PIX_FMT_P010LE => PixelFormat::P010,
        AV_PIX_FMT_P210LE => PixelFormat::P210,
        AV_PIX_FMT_YUV420P | AV_PIX_FMT_YUVJ420P => PixelFormat::Yuv420p,
        AV_PIX_FMT_YUV420P10LE => PixelFormat::Yuv420p10,
        AV_PIX_FMT_YUV422P | AV_PIX_FMT_YUVJ422P => PixelFormat::Yuv422p,
        AV_PIX_FMT_YUV444P | AV_PIX_FMT_YUVJ444P => PixelFormat::Yuv444p,
        other => PixelFormat::Other(other as i32),
    }
}

/// The YCbCr matrix a stream tags; unspecified streams follow the usual convention (BT.709
/// from 720 lines up, BT.601 below).
fn matrix_of(cs: ff::AVColorSpace, height: u32) -> Matrix {
    use ff::AVColorSpace::*;
    match cs {
        AVCOL_SPC_BT709 => Matrix::Bt709,
        AVCOL_SPC_BT2020_NCL | AVCOL_SPC_BT2020_CL => Matrix::Bt2020,
        AVCOL_SPC_BT470BG | AVCOL_SPC_SMPTE170M => Matrix::Bt601,
        _ if height >= 720 => Matrix::Bt709,
        _ => Matrix::Bt601,
    }
}

/// SDR unless the stream says HLG or PQ.
fn transfer_of(trc: ff::AVColorTransferCharacteristic) -> Transfer {
    match trc {
        ff::AVColorTransferCharacteristic::AVCOL_TRC_ARIB_STD_B67 => Transfer::Hlg,
        ff::AVColorTransferCharacteristic::AVCOL_TRC_SMPTE2084 => Transfer::Pq,
        _ => Transfer::Sdr,
    }
}

fn frame_error(e: MediaError) -> FrameError {
    FrameError(Box::new(e))
}

/// A frame from FFmpeg's decoder (software, or VideoToolbox through FFmpeg's hwaccel): our
/// own reference on its buffers.
struct AvPixels(*mut ff::AVFrame);

// The frame owns its own reference; FFmpeg frames may be used from any thread.
unsafe impl Send for AvPixels {}

/// A frame from the native VideoToolbox decoder.
#[cfg(target_vendor = "apple")]
struct CvPixels {
    buffer: crate::vt::PixelBuffer,
    colorspace: ff::AVColorSpace,
    trc: ff::AVColorTransferCharacteristic,
}

/// A frame holding a new reference to `src` (no pixel copy).
pub(crate) fn av_frame(src: *const ff::AVFrame, time: Micros, duration: Micros) -> Result<VideoFrame, MediaError> {
    Ok(VideoFrame::new(Box::new(AvPixels::reference(src)?), time, duration))
}

/// A frame of a pixel buffer from the native VideoToolbox decoder.
#[cfg(target_vendor = "apple")]
pub(crate) fn cv_frame(buffer: crate::vt::PixelBuffer, colorspace: ff::AVColorSpace, trc: ff::AVColorTransferCharacteristic, time: Micros, duration: Micros) -> VideoFrame {
    VideoFrame::new(Box::new(CvPixels { buffer, colorspace, trc }), time, duration)
}

#[cfg(target_vendor = "apple")]
fn cv_format(pb: &objc2_core_video::CVPixelBuffer) -> (PixelFormat, bool) {
    use objc2_core_video::*;
    #[allow(non_upper_case_globals)]
    match CVPixelBufferGetPixelFormatType(pb) {
        kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange => (PixelFormat::Nv12, false),
        kCVPixelFormatType_420YpCbCr8BiPlanarFullRange => (PixelFormat::Nv12, true),
        kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange => (PixelFormat::P010, false),
        kCVPixelFormatType_420YpCbCr10BiPlanarFullRange => (PixelFormat::P010, true),
        kCVPixelFormatType_422YpCbCr10BiPlanarVideoRange => (PixelFormat::P210, false),
        kCVPixelFormatType_422YpCbCr10BiPlanarFullRange => (PixelFormat::P210, true),
        other => (PixelFormat::Other(other as i32), false),
    }
}

impl AvPixels {
    fn reference(src: *const ff::AVFrame) -> Result<Self, MediaError> {
        let raw = unsafe { ff::av_frame_clone(src) };
        if raw.is_null() {
            return Err(MediaError::ffmpeg("av_frame_clone", ff::AVERROR(ff::ENOMEM)));
        }
        Ok(AvPixels(raw))
    }
}

impl FramePixels for AvPixels {
    fn width(&self) -> u32 {
        unsafe { (*self.0).width as u32 }
    }

    fn height(&self) -> u32 {
        unsafe { (*self.0).height as u32 }
    }

    fn is_hardware(&self) -> bool {
        unsafe { (*self.0).format == ff::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX as i32 }
    }

    fn pixel_format(&self) -> PixelFormat {
        unsafe {
            let raw = self.0;
            if self.is_hardware() && !(*raw).hw_frames_ctx.is_null() {
                let fc = (*(*raw).hw_frames_ctx).data as *const ff::AVHWFramesContext;
                return pixel_format_of((*fc).sw_format);
            }
            pixel_format_of(std::mem::transmute::<i32, ff::AVPixelFormat>((*raw).format))
        }
    }

    fn matrix(&self) -> Matrix {
        matrix_of(unsafe { (*self.0).colorspace }, self.height())
    }

    fn transfer(&self) -> Transfer {
        transfer_of(unsafe { (*self.0).color_trc })
    }

    fn full_range(&self) -> bool {
        unsafe { (*self.0).color_range == ff::AVColorRange::AVCOL_RANGE_JPEG }
    }

    fn to_rgb(&self) -> Result<RgbImage, FrameError> {
        unsafe {
            let raw = self.0;
            if !self.is_hardware() {
                return convert_rgb(raw).map_err(frame_error);
            }
            let mut tmp = ff::av_frame_alloc();
            let mut r = ff::av_hwframe_transfer_data(tmp, raw, 0);
            if r >= 0 {
                // The transfer copies pixels only; the matrix and range come with the props.
                r = ff::av_frame_copy_props(tmp, raw);
            }
            let result = if r < 0 { Err(MediaError::ffmpeg("av_hwframe_transfer_data", r)) } else { convert_rgb(tmp) };
            ff::av_frame_free(&mut tmp);
            result.map_err(frame_error)
        }
    }

    fn try_clone(&self) -> Result<Box<dyn FramePixels>, FrameError> {
        Ok(Box::new(AvPixels::reference(self.0).map_err(frame_error)?))
    }

    #[cfg(target_vendor = "apple")]
    fn pixel_buffer(&self) -> Option<&objc2_core_video::CVPixelBuffer> {
        if !self.is_hardware() {
            return None;
        }
        unsafe { ((*self.0).data[3] as *const objc2_core_video::CVPixelBuffer).as_ref() }
    }
}

impl Drop for AvPixels {
    fn drop(&mut self) {
        unsafe { ff::av_frame_free(&mut self.0) }
    }
}

#[cfg(target_vendor = "apple")]
impl FramePixels for CvPixels {
    fn width(&self) -> u32 {
        objc2_core_video::CVPixelBufferGetWidth(&self.buffer.0) as u32
    }

    fn height(&self) -> u32 {
        objc2_core_video::CVPixelBufferGetHeight(&self.buffer.0) as u32
    }

    fn is_hardware(&self) -> bool {
        true
    }

    fn pixel_format(&self) -> PixelFormat {
        cv_format(&self.buffer.0).0
    }

    fn matrix(&self) -> Matrix {
        matrix_of(self.colorspace, self.height())
    }

    fn transfer(&self) -> Transfer {
        transfer_of(self.trc)
    }

    fn full_range(&self) -> bool {
        cv_format(&self.buffer.0).1
    }

    fn to_rgb(&self) -> Result<RgbImage, FrameError> {
        unsafe { cv_to_rgb(&self.buffer.0, self.colorspace) }.map_err(frame_error)
    }

    fn try_clone(&self) -> Result<Box<dyn FramePixels>, FrameError> {
        Ok(Box::new(CvPixels { buffer: crate::vt::PixelBuffer(self.buffer.0.clone()), colorspace: self.colorspace, trc: self.trc }))
    }

    fn pixel_buffer(&self) -> Option<&objc2_core_video::CVPixelBuffer> {
        Some(&self.buffer.0)
    }
}

/// Wrap a locked pixel buffer's planes in a (non-owning) AVFrame and convert it.
#[cfg(target_vendor = "apple")]
unsafe fn cv_to_rgb(pb: &objc2_core_video::CVPixelBuffer, colorspace: ff::AVColorSpace) -> Result<RgbImage, MediaError> {
    use objc2_core_video::*;
    let (format, full) = cv_format(pb);
    let av_format = match format {
        PixelFormat::Nv12 => ff::AVPixelFormat::AV_PIX_FMT_NV12,
        PixelFormat::P010 => ff::AVPixelFormat::AV_PIX_FMT_P010LE,
        PixelFormat::P210 => ff::AVPixelFormat::AV_PIX_FMT_P210LE,
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
