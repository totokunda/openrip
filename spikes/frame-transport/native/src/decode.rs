//! AVFoundation hardware decode into IOSurface-backed CVPixelBuffers.

use std::sync::atomic::Ordering;
use std::time::Instant;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetReader, AVAssetReaderStatus, AVAssetReaderTrackOutput, AVAssetTrack, AVMediaTypeVideo,
    AVURLAsset,
};
use objc2_core_foundation::CFRetained;
use objc2_core_media::CMTime;
use objc2_core_video::CVPixelBuffer;
use objc2_foundation::{NSDictionary, NSNumber, NSObject, NSString, NSURL};

use crate::{HeldFrame, Shared, StreamInfo};

/// Retained CVPixelBuffer that can move between threads (CVPixelBuffer is thread-safe).
pub(crate) struct PixelBuffer(#[allow(dead_code)] CFRetained<CVPixelBuffer>);
unsafe impl Send for PixelBuffer {}
unsafe impl Sync for PixelBuffer {}

const K_420V: u32 = u32::from_be_bytes(*b"420v"); // NV12 video range
const K_X420: u32 = u32::from_be_bytes(*b"x420"); // P010 video range (10-bit)
const K_BGRA: u32 = u32::from_be_bytes(*b"BGRA");

fn cv_format(pixel_format: &str) -> std::result::Result<u32, String> {
    match pixel_format {
        "nv12" => Ok(K_420V),
        "p010le" => Ok(K_X420),
        "bgra" => Ok(K_BGRA),
        other => Err(format!("unsupported pixel format: {other}")),
    }
}

fn video_track(path: &str) -> std::result::Result<(Retained<AVURLAsset>, Retained<AVAssetTrack>), String> {
    unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let asset = AVURLAsset::URLAssetWithURL_options(&url, None);
        #[allow(deprecated)]
        let tracks = asset.tracksWithMediaType(AVMediaTypeVideo.ok_or("AVMediaTypeVideo missing")?);
        let track = tracks.firstObject().ok_or_else(|| format!("no video track in {path}"))?;
        Ok((asset, track))
    }
}

fn seconds(t: CMTime) -> f64 {
    if t.timescale == 0 {
        0.0
    } else {
        t.value as f64 / t.timescale as f64
    }
}

pub(crate) fn probe(path: &str, pixel_format: &str) -> std::result::Result<StreamInfo, String> {
    cv_format(pixel_format)?;
    let (asset, track) = video_track(path)?;
    unsafe {
        let size = track.naturalSize();
        #[allow(deprecated)]
        let duration = asset.duration();
        Ok(StreamInfo {
            width: size.width as u32,
            height: size.height as u32,
            fps: track.nominalFrameRate() as f64,
            duration_sec: seconds(duration),
            pixel_format: pixel_format.to_string(),
        })
    }
}

fn output_settings(format: u32) -> Retained<NSDictionary<NSString, AnyObject>> {
    let k_format = NSString::from_str("PixelFormatType"); // kCVPixelBufferPixelFormatTypeKey
    let k_iosurface = NSString::from_str("IOSurfaceProperties"); // kCVPixelBufferIOSurfacePropertiesKey
    let fmt = NSNumber::new_u32(format);
    let empty: Retained<NSDictionary<NSString, NSObject>> = NSDictionary::new();
    let dict: Retained<NSDictionary<NSString, NSObject>> =
        NSDictionary::from_slices(&[&*k_format, &*k_iosurface], &[&**fmt, &**empty]);
    unsafe { Retained::cast_unchecked(dict) }
}

/// Decode loop: runs until `shared.stop`, looping the clip.
pub(crate) fn run(path: &str, pixel_format: &str, shared: &Shared) {
    let Ok(format) = cv_format(pixel_format) else { return };
    let mut next_id: u32 = 1;
    while !shared.stop.load(Ordering::SeqCst) {
        let Ok((asset, track)) = video_track(path) else { return };
        let reader = match unsafe { AVAssetReader::assetReaderWithAsset_error(&asset) } {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[ft-decode] reader error: {e:?}");
                return;
            }
        };
        let settings = output_settings(format);
        let output = unsafe {
            AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, Some(&settings))
        };
        unsafe {
            output.setAlwaysCopiesSampleData(false);
            reader.addOutput(&output);
            if !reader.startReading() {
                eprintln!("[ft-decode] startReading failed: {:?}", reader.error());
                return;
            }
        }

        loop {
            if shared.stop.load(Ordering::SeqCst) {
                unsafe { reader.cancelReading() };
                return;
            }
            // Backpressure: don't hold more than `max_outstanding` frames.
            {
                let mut held = shared.held.lock().unwrap();
                while held.len() >= shared.max_outstanding && !shared.stop.load(Ordering::SeqCst) {
                    held = shared.space.wait(held).unwrap();
                }
            }
            let Some(sample) = (unsafe { output.copyNextSampleBuffer() }) else { break };
            let pts = unsafe { sample.presentation_time_stamp() };
            let Some(image) = (unsafe { sample.image_buffer() }) else { continue };
            let pixel: CFRetained<CVPixelBuffer> = image;
            let surface = objc2_core_video::CVPixelBufferGetIOSurface(Some(&pixel));
            let Some(surface) = surface else {
                eprintln!("[ft-decode] frame is not IOSurface-backed");
                continue;
            };
            let surface_ptr = CFRetained::as_ptr(&surface).as_ptr() as usize;
            let width = objc2_core_video::CVPixelBufferGetWidth(&pixel) as u32;
            let height = objc2_core_video::CVPixelBufferGetHeight(&pixel) as u32;
            let id = next_id;
            next_id = next_id.wrapping_add(1).max(1);
            shared.held.lock().unwrap().insert(
                id,
                HeldFrame {
                    pixel_buffer: PixelBuffer(pixel),
                    io_surface_ptr: surface_ptr,
                    width,
                    height,
                    pts_us: (seconds(pts) * 1_000_000.0) as i64,
                    decoded_at: Instant::now(),
                },
            );
            shared.ready.lock().unwrap().push_back(id);
            shared.decoded.fetch_add(1, Ordering::Relaxed);
        }
        let status = unsafe { reader.status() };
        if status == AVAssetReaderStatus::Failed {
            eprintln!("[ft-decode] reader failed: {:?}", unsafe { reader.error() });
            return;
        }
    }
}
