//! Decoded pictures and the pixel types around them: what a decoder hands out and the
//! compositor takes in, without either knowing the other.
//!
//! A [`VideoFrame`] is a time, a duration and pixels behind [`FramePixels`], which each
//! decode backend implements for its own buffers (FFmpeg's frames, VideoToolbox's pixel
//! buffers). Hardware frames stay where the decoder put them: on Apple platforms
//! [`FramePixels::pixel_buffer`] gives the compositor the IOSurface-backed `CVPixelBuffer`
//! to use as GPU textures in place; anything else is read back with [`VideoFrame::to_rgb`].

use openrip_model::Micros;

/// YCbCr→RGB matrix of a frame.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Matrix {
    Bt601,
    Bt709,
    Bt2020,
}

/// How a frame's signal relates to light.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Transfer {
    /// Standard dynamic range (BT.709/sRGB-like gamma, or unspecified).
    Sdr,
    /// HDR, hybrid log-gamma (BT.2100 HLG; iPhone HDR video).
    Hlg,
    /// HDR, perceptual quantizer (BT.2100 PQ / SMPTE ST 2084; HDR10).
    Pq,
}

/// Memory layout of a decoded frame (for hardware frames, of the GPU surface).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PixelFormat {
    Nv12,
    P010,
    /// 4:2:2 biplanar, 10 bits in 16 (ProRes 422 through VideoToolbox).
    P210,
    Yuv420p,
    Yuv420p10,
    Yuv422p,
    Yuv444p,
    /// Something else, by the backend's own number for it.
    Other(i32),
}

/// A backend's failure on a frame (reading it back, or another reference to it), with the
/// backend's own error inside.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct FrameError(pub Box<dyn std::error::Error + Send + Sync>);

/// A decoded picture's pixels, as one decode backend holds them.
pub trait FramePixels: Send {
    fn width(&self) -> u32;
    fn height(&self) -> u32;
    /// True when the pixels live on the GPU.
    fn is_hardware(&self) -> bool;
    /// Layout of the pixels; for hardware frames, the layout of the GPU surface.
    fn pixel_format(&self) -> PixelFormat;
    fn matrix(&self) -> Matrix;
    fn transfer(&self) -> Transfer;
    /// True for full-range ("pc"/JPEG) samples, false for limited (TV) range.
    fn full_range(&self) -> bool;
    /// Download (if needed) and convert to packed 8-bit RGB with full-range output, using
    /// the frame's own matrix and range.
    fn to_rgb(&self) -> Result<RgbImage, FrameError>;
    /// Another reference to the same pixels (no copy).
    fn try_clone(&self) -> Result<Box<dyn FramePixels>, FrameError>;
    /// The `CVPixelBuffer` behind a hardware frame (borrowed; valid while the frame lives).
    #[cfg(target_vendor = "apple")]
    fn pixel_buffer(&self) -> Option<&objc2_core_video::CVPixelBuffer> {
        None
    }
}

/// A decoded frame. Holds a reference on the decoder's buffer (or the hardware surface), so
/// it is cheap to keep and to move between threads.
pub struct VideoFrame {
    pixels: Box<dyn FramePixels>,
    /// Presentation time from the first frame of the stream.
    pub time: Micros,
    /// How long the frame is displayed.
    pub duration: Micros,
}

impl VideoFrame {
    pub fn new(pixels: Box<dyn FramePixels>, time: Micros, duration: Micros) -> Self {
        VideoFrame { pixels, time, duration }
    }

    /// Another reference to the same pixels (no copy).
    pub fn try_clone(&self) -> Result<Self, FrameError> {
        Ok(VideoFrame { pixels: self.pixels.try_clone()?, time: self.time, duration: self.duration })
    }

    pub fn width(&self) -> u32 {
        self.pixels.width()
    }

    pub fn height(&self) -> u32 {
        self.pixels.height()
    }

    /// True when the pixels live on the GPU (VideoToolbox on Apple platforms).
    pub fn is_hardware(&self) -> bool {
        self.pixels.is_hardware()
    }

    /// Layout of the pixels; for hardware frames, the layout of the GPU surface.
    pub fn pixel_format(&self) -> PixelFormat {
        self.pixels.pixel_format()
    }

    /// The frame's YCbCr matrix; unspecified streams follow the usual convention (BT.709
    /// from 720 lines up, BT.601 below).
    pub fn matrix(&self) -> Matrix {
        self.pixels.matrix()
    }

    /// The frame's transfer characteristic (SDR unless the stream says HLG or PQ).
    pub fn transfer(&self) -> Transfer {
        self.pixels.transfer()
    }

    /// True for full-range ("pc"/JPEG) samples, false for limited (TV) range.
    pub fn full_range(&self) -> bool {
        self.pixels.full_range()
    }

    /// The `CVPixelBuffer` behind a hardware frame (borrowed; valid while the frame lives).
    #[cfg(target_vendor = "apple")]
    pub fn pixel_buffer(&self) -> Option<&objc2_core_video::CVPixelBuffer> {
        self.pixels.pixel_buffer()
    }

    /// The `IOSurface` backing a hardware frame, for zero-copy hand-off to the GPU / Electron.
    #[cfg(target_vendor = "apple")]
    pub fn io_surface(&self) -> Option<objc2_core_foundation::CFRetained<objc2_io_surface::IOSurfaceRef>> {
        objc2_core_video::CVPixelBufferGetIOSurface(Some(self.pixel_buffer()?))
    }

    /// Download (if needed) and convert to packed 8-bit RGB with full-range output, using the
    /// frame's own matrix and range. For tests, thumbnails and analysis, not the playback path.
    pub fn to_rgb(&self) -> Result<RgbImage, FrameError> {
        self.pixels.to_rgb()
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

/// Straight-alpha 8-bit RGBA pixels, row-major.
#[derive(Clone, Debug, PartialEq)]
pub struct RgbaImage {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}
