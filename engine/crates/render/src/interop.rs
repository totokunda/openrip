//! GPU texture interop: decoded frames used as textures where they already are, and frames
//! rendered into surfaces the platform presents or encodes.
//!
//! On Apple platforms (macOS, iOS) a hardware frame's IOSurface planes (NV12 / P010 / P210)
//! become Metal textures without a copy, and the compositor renders into IOSurface-backed
//! pixel buffers: BGRA for the preview (Electron's `sharedTexture` in the app, a
//! `CALayer` or Metal view on iOS), NV12 for VideoToolbox's encoder.
//!
//! Elsewhere there is no interop yet, and the portable path stands in: frames are read back
//! to the CPU and uploaded (`VideoFrame::to_rgb`), and a [`Surface`] holds the frame read
//! back from the GPU. Still to write:
//! - todo: Android: a MediaCodec frame's `AHardwareBuffer` imported as a Vulkan texture, and
//!   surfaces as `AHardwareBuffer`s an `ASurfaceControl` or `SurfaceTexture` presents.
//! - todo: the web: a WebCodecs `VideoFrame` imported with `importExternalTexture`, and
//!   rendering straight to the page's canvas.

use crate::{Compositor, Layer, RenderError};
#[cfg(target_vendor = "apple")]
use crate::{Params, CANVAS, WIDE};
#[cfg(not(target_vendor = "apple"))]
use crate::RgbaImage;
#[cfg(target_vendor = "apple")]
use openrip_frame::{Matrix, PixelFormat};
use openrip_frame::VideoFrame;

/// A picture the compositor renders into for the platform to show or hand on. On Apple
/// platforms an IOSurface-backed BGRA pixel buffer (zero-copy to Electron, or to any Metal
/// or Core Animation consumer); elsewhere, until each platform has its own interop, RGBA pixels read
/// back from the GPU.
pub struct Surface {
    #[cfg(target_vendor = "apple")]
    buffer: objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>,
    #[cfg(not(target_vendor = "apple"))]
    image: RgbaImage,
}

// CoreVideo buffers may be used from any thread.
#[cfg(target_vendor = "apple")]
unsafe impl Send for Surface {}

impl Surface {
    /// A new surface; `None` if the platform can't allocate one.
    pub fn new(width: u32, height: u32) -> Option<Surface> {
        #[cfg(target_vendor = "apple")]
        return Compositor::output_surface(width, height).map(Surface::from_pixel_buffer);
        #[cfg(not(target_vendor = "apple"))]
        Some(Surface { image: RgbaImage { width, height, data: vec![0; width as usize * height as usize * 4] } })
    }

    pub fn width(&self) -> u32 {
        #[cfg(target_vendor = "apple")]
        return objc2_core_video::CVPixelBufferGetWidth(&self.buffer) as u32;
        #[cfg(not(target_vendor = "apple"))]
        self.image.width
    }

    pub fn height(&self) -> u32 {
        #[cfg(target_vendor = "apple")]
        return objc2_core_video::CVPixelBufferGetHeight(&self.buffer) as u32;
        #[cfg(not(target_vendor = "apple"))]
        self.image.height
    }

    /// A surface over an existing IOSurface-backed BGRA pixel buffer.
    #[cfg(target_vendor = "apple")]
    pub fn from_pixel_buffer(buffer: objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>) -> Surface {
        Surface { buffer }
    }

    #[cfg(target_vendor = "apple")]
    pub fn pixel_buffer(&self) -> &objc2_core_video::CVPixelBuffer {
        &self.buffer
    }

    /// The IOSurfaceRef behind the surface as a pointer value (Electron's `sharedTexture`
    /// takes its bytes).
    #[cfg(target_vendor = "apple")]
    pub fn io_surface_ptr(&self) -> Option<u64> {
        objc2_core_video::CVPixelBufferGetIOSurface(Some(&self.buffer)).map(|io| objc2_core_foundation::CFRetained::as_ptr(&io).as_ptr() as usize as u64)
    }

    /// The pixels last rendered, straight-alpha RGBA.
    #[cfg(not(target_vendor = "apple"))]
    pub fn image(&self) -> &RgbaImage {
        &self.image
    }
}

impl Compositor {
    /// Render `layers` (bottom first) over an opaque `background` into `target`. Returns once
    /// the GPU has finished, so the surface can be presented.
    pub fn render_into(&self, target: &mut Surface, background: [u8; 3], layers: &[Layer]) -> Result<(), RenderError> {
        #[cfg(target_vendor = "apple")]
        return self.render_to_surface(&target.buffer, background, layers);
        #[cfg(not(target_vendor = "apple"))]
        {
            target.image = self.render(target.image.width, target.image.height, background, layers);
            Ok(())
        }
    }

    /// Convert a hardware frame's planes to an RGBA texture on the GPU, without copying them
    /// out of their IOSurface. `None` if the frame isn't a hardware NV12/P010 frame.
    #[cfg(target_vendor = "apple")]
    pub(crate) fn import_video(&self, enc: &mut wgpu::CommandEncoder, frame: &VideoFrame) -> Option<(wgpu::Texture, [wgpu::Texture; 2])> {
        let wide = self.device.features().contains(wgpu::Features::TEXTURE_FORMAT_16BIT_NORM);
        // (16-bit planes, vertical chroma subsampling)
        let (ten_bit, sub_v) = match frame.pixel_format() {
            PixelFormat::Nv12 => (false, 2.0),
            PixelFormat::P010 if wide => (true, 2.0),
            PixelFormat::P210 if wide => (true, 1.0),
            _ => return None,
        };
        let pb = frame.pixel_buffer()?;
        let surface = frame.io_surface()?;
        let plane_size = |i| (objc2_core_video::CVPixelBufferGetWidthOfPlane(pb, i) as u32, objc2_core_video::CVPixelBufferGetHeightOfPlane(pb, i) as u32);
        let (luma_fmt, chroma_fmt) = if ten_bit { (wgpu::TextureFormat::R16Unorm, wgpu::TextureFormat::Rg16Unorm) } else { (wgpu::TextureFormat::R8Unorm, wgpu::TextureFormat::Rg8Unorm) };
        let luma = self.wrap_plane(&surface, 0, plane_size(0), luma_fmt)?;
        let chroma = self.wrap_plane(&surface, 1, plane_size(1), chroma_fmt)?;
        let (w, h) = (frame.width(), frame.height());
        // A 10-bit frame stays wider than 8 bits (see `yuv_wide`).
        let rgba = self.texture(w, h, if ten_bit { WIDE } else { CANVAS }, wgpu::TextureUsages::empty());
        let (inv0, inv1, k) = yuv_params(frame.matrix(), frame.full_range(), ten_bit);
        let hlg = (frame.transfer() == openrip_frame::Transfer::Hlg) as u8 as f32;
        let params = Params { src_size: [w as f32, h as f32], dst_size: [w as f32, h as f32], inv0, inv1, misc: [1.0, hlg, k, sub_v] };
        self.pass_with(enc, if ten_bit { &self.yuv_wide } else { &self.yuv }, &luma, Some(&chroma), &rgba, params, Some(wgpu::Color::BLACK));
        Some((rgba, [luma, chroma]))
    }

    #[cfg(not(target_vendor = "apple"))]
    pub(crate) fn import_video(&self, _enc: &mut wgpu::CommandEncoder, _frame: &VideoFrame) -> Option<(wgpu::Texture, [wgpu::Texture; 2])> {
        None
    }

    /// One IOSurface plane as a wgpu texture (no copy).
    #[cfg(target_vendor = "apple")]
    fn wrap_plane(&self, surface: &objc2_io_surface::IOSurfaceRef, plane: usize, (w, h): (u32, u32), format: wgpu::TextureFormat) -> Option<wgpu::Texture> {
        self.wrap_surface(surface, plane, (w, h), format, false)
    }

    /// An IOSurface plane as a wgpu texture (no copy); `target` makes it renderable.
    #[cfg(target_vendor = "apple")]
    fn wrap_surface(&self, surface: &objc2_io_surface::IOSurfaceRef, plane: usize, (w, h): (u32, u32), format: wgpu::TextureFormat, target: bool) -> Option<wgpu::Texture> {
        use objc2_metal::{MTLDevice, MTLPixelFormat, MTLTextureDescriptor, MTLTextureType, MTLTextureUsage};
        let mtl_format = match format {
            wgpu::TextureFormat::R8Unorm => MTLPixelFormat::R8Unorm,
            wgpu::TextureFormat::Rg8Unorm => MTLPixelFormat::RG8Unorm,
            wgpu::TextureFormat::R16Unorm => MTLPixelFormat::R16Unorm,
            wgpu::TextureFormat::Rg16Unorm => MTLPixelFormat::RG16Unorm,
            wgpu::TextureFormat::Bgra8Unorm => MTLPixelFormat::BGRA8Unorm,
            _ => return None,
        };
        let raw = unsafe {
            let hal = self.device.as_hal::<wgpu::hal::api::Metal>()?;
            let desc = MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(mtl_format, w as usize, h as usize, false);
            desc.setUsage(if target { MTLTextureUsage::ShaderRead | MTLTextureUsage::RenderTarget } else { MTLTextureUsage::ShaderRead });
            hal.raw_device().newTextureWithDescriptor_iosurface_plane(&desc, surface, plane)?
        };
        let size = wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 };
        let hal_texture = unsafe { wgpu::hal::metal::Device::texture_from_raw(raw, format, MTLTextureType::Type2D, 1, 1, wgpu::hal::CopyExtent { width: w, height: h, depth: 1 }, None) };
        let desc = wgpu::TextureDescriptor {
            label: Some("video plane"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: if target { wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT } else { wgpu::TextureUsages::TEXTURE_BINDING },
            view_formats: &[],
        };
        Some(unsafe { self.device.create_texture_from_hal::<wgpu::hal::api::Metal>(hal_texture, &desc, wgpu::TextureUses::RESOURCE) })
    }

    /// A new IOSurface-backed BGRA pixel buffer to render into with
    /// [`Compositor::render_to_surface`] and hand to the app.
    #[cfg(target_vendor = "apple")]
    pub fn output_surface(width: u32, height: u32) -> Option<objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>> {
        use objc2_core_foundation::{CFBoolean, CFDictionary, CFRetained, CFString, CFType};
        use objc2_core_video::*;
        let props = CFDictionary::<CFString, CFType>::from_slices(&[], &[]);
        let attrs = unsafe { CFDictionary::<CFString, CFType>::from_slices(&[kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferMetalCompatibilityKey], &[props.as_ref(), CFBoolean::new(true).as_ref()]) };
        let mut out: *mut CVPixelBuffer = std::ptr::null_mut();
        let r = unsafe { CVPixelBufferCreate(None, width as usize, height as usize, kCVPixelFormatType_32BGRA, Some(attrs.as_opaque()), std::ptr::NonNull::from(&mut out)) };
        (r == 0 && !out.is_null()).then(|| unsafe { CFRetained::from_raw(std::ptr::NonNull::new_unchecked(out)) })
    }

    /// Render into an IOSurface-backed BGRA pixel buffer (the app's preview hands its
    /// IOSurface to Electron's `sharedTexture`; nothing is copied to the CPU). Returns once
    /// the GPU has finished, so the surface can be presented.
    #[cfg(target_vendor = "apple")]
    pub fn render_to_surface(&self, target: &objc2_core_video::CVPixelBuffer, background: [u8; 3], layers: &[Layer]) -> Result<(), RenderError> {
        let (w, h) = (objc2_core_video::CVPixelBufferGetWidth(target) as u32, objc2_core_video::CVPixelBufferGetHeight(target) as u32);
        let surface = objc2_core_video::CVPixelBufferGetIOSurface(Some(target)).ok_or_else(|| RenderError::Device("target has no IOSurface".into()))?;
        let canvas = self.wrap_surface(&surface, 0, (w, h), wgpu::TextureFormat::Bgra8Unorm, true).ok_or_else(|| RenderError::Device("can't render into that surface".into()))?;
        let mut enc = self.device.create_command_encoder(&Default::default());
        let textures = self.encode_frame(&mut enc, &canvas, Some(background), layers);
        let done = self.queue.submit([enc.finish()]);
        self.wait_for(done)?;
        self.recycle(textures.scratch);
        Ok(())
    }

    /// A new IOSurface-backed NV12 (BT.709 limited range) pixel buffer for the encoder.
    #[cfg(target_vendor = "apple")]
    pub fn output_surface_nv12(width: u32, height: u32) -> Option<objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>> {
        use objc2_core_foundation::{CFBoolean, CFDictionary, CFRetained, CFString, CFType};
        use objc2_core_video::*;
        let props = CFDictionary::<CFString, CFType>::from_slices(&[], &[]);
        let attrs = unsafe { CFDictionary::<CFString, CFType>::from_slices(&[kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferMetalCompatibilityKey], &[props.as_ref(), CFBoolean::new(true).as_ref()]) };
        let mut out: *mut CVPixelBuffer = std::ptr::null_mut();
        let r = unsafe { CVPixelBufferCreate(None, width as usize, height as usize, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, Some(attrs.as_opaque()), std::ptr::NonNull::from(&mut out)) };
        (r == 0 && !out.is_null()).then(|| unsafe { CFRetained::from_raw(std::ptr::NonNull::new_unchecked(out)) })
    }

    /// Render into an NV12 pixel buffer for the encoder: composite as usual, then convert
    /// to BT.709 limited-range YCbCr on the GPU, written straight into the buffer's planes.
    #[cfg(target_vendor = "apple")]
    pub fn render_to_nv12(&self, target: &objc2_core_video::CVPixelBuffer, background: [u8; 3], layers: &[Layer]) -> Result<(), RenderError> {
        use objc2_core_video::*;
        let plane = |i| (CVPixelBufferGetWidthOfPlane(target, i) as u32, CVPixelBufferGetHeightOfPlane(target, i) as u32);
        let surface = CVPixelBufferGetIOSurface(Some(target)).ok_or_else(|| RenderError::Device("target has no IOSurface".into()))?;
        let luma = self.wrap_surface(&surface, 0, plane(0), wgpu::TextureFormat::R8Unorm, true).ok_or_else(|| RenderError::Device("can't render into the luma plane".into()))?;
        let chroma = self.wrap_surface(&surface, 1, plane(1), wgpu::TextureFormat::Rg8Unorm, true).ok_or_else(|| RenderError::Device("can't render into the chroma plane".into()))?;
        let (w, h) = plane(0);
        let canvas = self.texture(w, h, CANVAS, wgpu::TextureUsages::empty());
        let mut enc = self.device.create_command_encoder(&Default::default());
        let mut textures = self.encode_frame(&mut enc, &canvas, Some(background), layers);
        let (kr, kb) = (0.2126f32, 0.0722f32);
        let params = Params { src_size: [w as f32, h as f32], dst_size: [w as f32, h as f32], inv0: [0.0; 4], inv1: [kr, 1.0 - kr - kb, kb, 0.0], misc: [0.0; 4] };
        self.pass(&mut enc, &self.luma, &canvas, &luma, params, Some(wgpu::Color::BLACK));
        self.pass(&mut enc, &self.chroma, &canvas, &chroma, params, Some(wgpu::Color::BLACK));
        let done = self.queue.submit([enc.finish()]);
        self.wait_for(done)?;
        textures.scratch.push(canvas);
        self.recycle(textures.scratch);
        Ok(())
    }
}

/// Code-value offsets/ranges and RGB coefficients for the YUV import shader.
#[cfg(target_vendor = "apple")]
fn yuv_params(matrix: Matrix, full: bool, ten_bit: bool) -> ([f32; 4], [f32; 4], f32) {
    let (kr, kb) = match matrix {
        Matrix::Bt601 => (0.299, 0.114),
        Matrix::Bt709 => (0.2126, 0.0722),
        Matrix::Bt2020 => (0.2627, 0.0593),
    };
    let kg = 1.0 - kr - kb;
    let coeffs = [2.0 * (1.0 - kr), -2.0 * kb * (1.0 - kb) / kg, -2.0 * kr * (1.0 - kr) / kg, 2.0 * (1.0 - kb)];
    let ranges = match (ten_bit, full) {
        (false, false) => [16.0, 219.0, 128.0, 224.0],
        (false, true) => [0.0, 255.0, 128.0, 255.0],
        (true, false) => [64.0, 876.0, 512.0, 896.0],
        (true, true) => [0.0, 1023.0, 512.0, 1023.0],
    };
    // P010 keeps 10-bit samples in the top bits of 16: unit sample = 65535 / 64 code values.
    let k = if ten_bit { 65535.0 / 64.0 } else { 255.0 };
    (ranges, coeffs, k)
}
