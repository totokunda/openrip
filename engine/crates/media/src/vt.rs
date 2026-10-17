//! Native VideoToolbox decoding for H.264/HEVC in MP4/MOV (length-prefixed NAL units).
//!
//! FFmpeg's VideoToolbox hwaccel submits one frame and waits for it, which leaves the media
//! engine idle between frames: on an M2 Max it decodes 4K H.264 at ~108 fps where
//! AVFoundation reaches ~500 fps on the same file. Here FFmpeg only demuxes; packets go to a
//! `VTDecompressionSession` asynchronously with several frames in flight, and frames that a
//! seek only needs as references are decoded without being output.
//!
//! Frames come back from VideoToolbox in decode order. A frame is released in presentation
//! order once every packet submitted after it has a decode timestamp past its presentation
//! time (no later packet can display earlier).

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::{Condvar, Mutex};

use ffmpeg_sys_next as ff;
use objc2_core_foundation::{CFBoolean, CFData, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_media::{
    kCMBlockBufferAssureMemoryNowFlag, kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms, CMBlockBuffer, CMFormatDescription,
    CMSampleBuffer, CMSampleTimingInfo, CMTime, CMTimeFlags, CMVideoFormatDescriptionCreate,
};
use objc2_core_video::{
    kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferMetalCompatibilityKey, kCVPixelBufferPixelFormatTypeKey, kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange,
    kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, CVImageBuffer, CVPixelBuffer,
};
use objc2_video_toolbox::{VTDecodeFrameFlags, VTDecodeInfoFlags, VTDecompressionOutputCallbackRecord, VTDecompressionSession};

use crate::nal::Codec;
use crate::MediaError;

/// Frames submitted but not yet returned by VideoToolbox. Enough to keep the media engine
/// busy; more only costs memory.
const MAX_IN_FLIGHT: usize = 16;

/// A retained pixel buffer that may cross threads (CoreVideo buffers are thread-safe).
pub(crate) struct PixelBuffer(pub CFRetained<CVPixelBuffer>);
unsafe impl Send for PixelBuffer {}

#[derive(Default)]
struct State {
    /// Presentation timestamps of submitted frames that will be output, not yet released.
    wanted: BTreeSet<i64>,
    /// Decoded frames by presentation timestamp (`None` if decoding failed).
    done: BTreeMap<i64, Option<PixelBuffer>>,
    in_flight: usize,
    /// Decode timestamp of the last submitted packet.
    last_dts: Option<i64>,
    errors: u64,
}

struct Shared {
    state: Mutex<State>,
    cond: Condvar,
}

/// What the caller should do next.
pub(crate) enum Next {
    /// The next frame in presentation order (`None` pixels: it failed to decode).
    Frame(i64, Option<PixelBuffer>),
    /// Submit more packets.
    NeedInput,
    /// Everything submitted has been returned.
    Drained,
}

pub(crate) struct VtDecoder {
    session: CFRetained<VTDecompressionSession>,
    format: CFRetained<CMFormatDescription>,
    shared: Box<Shared>,
    tb: ff::AVRational,
}

unsafe impl Send for VtDecoder {}

unsafe extern "C-unwind" fn on_frame(
    refcon: *mut c_void,
    source_refcon: *mut c_void,
    status: i32,
    _flags: VTDecodeInfoFlags,
    image: *mut CVImageBuffer,
    _pts: CMTime,
    _duration: CMTime,
) {
    let shared = &*(refcon as *const Shared);
    let pts = source_refcon as isize as i64;
    let mut st = shared.state.lock().unwrap();
    st.in_flight -= 1;
    if st.wanted.contains(&pts) {
        let buffer = if status == 0 { NonNull::new(image).map(|p| PixelBuffer(CFRetained::retain(p.cast::<CVPixelBuffer>()))) } else { None };
        if buffer.is_none() {
            st.errors += 1;
        }
        st.done.insert(pts, buffer);
    }
    shared.cond.notify_all();
}

fn cm_time(value: i64, tb: ff::AVRational) -> CMTime {
    if value == ff::AV_NOPTS_VALUE {
        return CMTime { value: 0, timescale: 0, flags: CMTimeFlags(0), epoch: 0 };
    }
    CMTime { value: value * tb.num as i64, timescale: tb.den, flags: CMTimeFlags::Valid, epoch: 0 }
}

impl VtDecoder {
    /// A session for the stream, or `None` if VideoToolbox can't take it directly.
    pub(crate) fn new(codec: Codec, par: *const ff::AVCodecParameters, tb: ff::AVRational, bit_depth: u8) -> Option<VtDecoder> {
        unsafe {
            let extra = std::slice::from_raw_parts((*par).extradata, (*par).extradata_size as usize);
            Self::with_config(codec, extra, (*par).width, (*par).height, tb, bit_depth)
        }
    }

    /// A session from an avcC/hvcC configuration record.
    pub(crate) fn with_config(codec: Codec, extra: &[u8], width: i32, height: i32, tb: ff::AVRational, bit_depth: u8) -> Option<VtDecoder> {
        unsafe {
            let (codec_type, atom) = match codec {
                Codec::H264 => (u32::from_be_bytes(*b"avc1"), "avcC"),
                Codec::Hevc => (u32::from_be_bytes(*b"hvc1"), "hvcC"),
            };
            let atoms = CFDictionary::<CFString, CFData>::from_slices(&[&CFString::from_str(atom)], &[&CFData::from_bytes(extra)]);
            let ext = CFDictionary::<CFString, CFType>::from_slices(&[kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms], &[atoms.as_ref()]);
            let mut format: *const CMFormatDescription = std::ptr::null();
            if CMVideoFormatDescriptionCreate(None, codec_type, width, height, Some(ext.as_opaque()), NonNull::from(&mut format)) != 0 || format.is_null() {
                return None;
            }
            let format = CFRetained::from_raw(NonNull::new_unchecked(format as *mut CMFormatDescription));
            let pixel_format = if bit_depth > 8 { kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange } else { kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange };
            let surface_props = CFDictionary::<CFString, CFType>::from_slices(&[], &[]);
            let attrs = CFDictionary::<CFString, CFType>::from_slices(
                &[kCVPixelBufferPixelFormatTypeKey, kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferMetalCompatibilityKey],
                &[CFNumber::new_i32(pixel_format as i32).as_ref(), surface_props.as_ref(), CFBoolean::new(true).as_ref()],
            );
            let shared = Box::new(Shared { state: Mutex::new(State::default()), cond: Condvar::new() });
            let record = VTDecompressionOutputCallbackRecord { decompressionOutputCallback: Some(on_frame), decompressionOutputRefCon: &*shared as *const Shared as *mut c_void };
            let mut session: *mut VTDecompressionSession = std::ptr::null_mut();
            let r = VTDecompressionSession::create(None, &format, None, Some(attrs.as_opaque()), &record, NonNull::from(&mut session));
            if r != 0 || session.is_null() {
                return None;
            }
            let session = CFRetained::from_raw(NonNull::new_unchecked(session));
            Some(VtDecoder { session, format, shared, tb })
        }
    }

    /// Submit one packet. `output: false` decodes it (as a reference) without producing a frame.
    pub(crate) fn submit(&mut self, pkt: *const ff::AVPacket, output: bool) -> Result<(), MediaError> {
        unsafe {
            let size = (*pkt).size as usize;
            let pts = if (*pkt).pts != ff::AV_NOPTS_VALUE { (*pkt).pts } else { (*pkt).dts };
            {
                let mut st = self.shared.state.lock().unwrap();
                while st.in_flight >= MAX_IN_FLIGHT {
                    let (guard, timeout) = self.shared.cond.wait_timeout(st, std::time::Duration::from_millis(100)).unwrap();
                    st = guard;
                    if timeout.timed_out() {
                        // Shouldn't happen (every submitted frame gets a callback), but never
                        // deadlock on it: once the session is idle nothing is in flight.
                        if std::env::var_os("OPENRIP_TRACE").is_some() {
                            eprintln!("[vt] flow-control timeout with {} in flight, {} wanted, {} done", st.in_flight, st.wanted.len(), st.done.len());
                        }
                        drop(st);
                        self.session.wait_for_asynchronous_frames();
                        st = self.shared.state.lock().unwrap();
                        st.in_flight = 0;
                    }
                }
                st.in_flight += 1;
                if output {
                    st.wanted.insert(pts);
                }
                let dts = if (*pkt).dts != ff::AV_NOPTS_VALUE { (*pkt).dts } else { pts };
                st.last_dts = Some(st.last_dts.map_or(dts, |d| d.max(dts)));
            }
            let mut block: *mut CMBlockBuffer = std::ptr::null_mut();
            let mut r = CMBlockBuffer::create_with_memory_block(None, std::ptr::null_mut(), size, None, std::ptr::null(), 0, size, kCMBlockBufferAssureMemoryNowFlag, NonNull::from(&mut block));
            if r == 0 {
                r = CMBlockBuffer::replace_data_bytes(NonNull::new_unchecked((*pkt).data as *mut c_void), &*block, 0, size);
            }
            let block = (!block.is_null()).then(|| CFRetained::from_raw(NonNull::new_unchecked(block)));
            let mut sample: *mut CMSampleBuffer = std::ptr::null_mut();
            if r == 0 {
                let timing = CMSampleTimingInfo { duration: cm_time((*pkt).duration, self.tb), presentationTimeStamp: cm_time(pts, self.tb), decodeTimeStamp: cm_time((*pkt).dts, self.tb) };
                r = CMSampleBuffer::create_ready(None, block.as_deref(), Some(&self.format), 1, 1, &timing, 1, &size, NonNull::from(&mut sample));
            }
            if r == 0 && !sample.is_null() {
                let sample = CFRetained::from_raw(NonNull::new_unchecked(sample));
                let mut flags = VTDecodeFrameFlags::Frame_EnableAsynchronousDecompression;
                if !output {
                    flags |= VTDecodeFrameFlags::Frame_DoNotOutputFrame;
                }
                let mut info = VTDecodeInfoFlags(0);
                r = self.session.decode_frame(&sample, flags, pts as isize as *mut c_void, &mut info);
            }
            if r != 0 {
                // The callback won't run for this packet: undo its bookkeeping, count the loss.
                let mut st = self.shared.state.lock().unwrap();
                st.in_flight -= 1;
                if output {
                    st.done.insert(pts, None);
                }
                st.errors += 1;
            }
            Ok(())
        }
    }

    /// The next frame in presentation order if it is ready. With `eof`, no more packets are
    /// coming, so the decoder is drained instead of asking for input.
    pub(crate) fn next(&mut self, eof: bool) -> Next {
        if eof {
            unsafe { self.session.wait_for_asynchronous_frames() };
        }
        let mut st = self.shared.state.lock().unwrap();
        loop {
            let Some(&pts) = st.wanted.first() else {
                return if eof { Next::Drained } else { Next::NeedInput };
            };
            // Released once no later packet can present before it.
            let settled = eof || st.last_dts.is_some_and(|d| d > pts);
            if !settled {
                return Next::NeedInput;
            }
            if let Some(buffer) = st.done.remove(&pts) {
                st.wanted.remove(&pts);
                return Next::Frame(pts, buffer);
            }
            // Submitted and settled but still decoding: wait for it rather than feed more.
            let t0 = std::time::Instant::now();
            st = self.shared.cond.wait(st).unwrap();
            if t0.elapsed().as_millis() >= 10 && std::env::var_os("OPENRIP_TRACE").is_some() {
                eprintln!("[vt] waited {:.1} ms for pts {pts} ({} wanted, {} done)", t0.elapsed().as_secs_f64() * 1e3, st.wanted.len(), st.done.len());
            }
        }
    }

    /// The frame for `pts`, waiting for it to decode, without the presentation-order rule
    /// of [`Self::next`] (the caller knows nothing will present before it). `None` if it
    /// failed to decode or wasn't submitted for output.
    pub(crate) fn take(&mut self, pts: i64) -> Option<PixelBuffer> {
        unsafe { self.session.wait_for_asynchronous_frames() };
        let mut st = self.shared.state.lock().unwrap();
        st.wanted.remove(&pts);
        st.done.remove(&pts).flatten()
    }

    /// Wait for everything in flight and forget it (after a demuxer seek).
    pub(crate) fn reset(&mut self) {
        unsafe { self.session.wait_for_asynchronous_frames() };
        *self.shared.state.lock().unwrap() = State::default();
    }

    pub(crate) fn errors(&self) -> u64 {
        self.shared.state.lock().unwrap().errors
    }
}

/// avcC record of a 64×64 H.264 Baseline stream: enough to start a session.
const WARM_UP_AVCC: [u8; 39] = [
    0x01, 0x42, 0xc0, 0x0a, 0xff, 0xe1, 0x00, 0x17, 0x67, 0x42, 0xc0, 0x0a, 0xd9, 0x04, 0x26, 0xc0, 0x44, 0x00, 0x00, 0x03, 0x00, 0x04, 0x00, 0x00, 0x03, 0x00, 0xf0, 0x3c, 0x48,
    0x99, 0x20, 0x01, 0x00, 0x05, 0x68, 0xcb, 0x83, 0xcb, 0x20,
];

/// The first VideoToolbox session in a process costs ~80 ms (later ones ~2 ms); pay it now.
pub(crate) fn warm_up() {
    let _ = VtDecoder::with_config(Codec::H264, &WARM_UP_AVCC, 64, 64, ff::AVRational { num: 1, den: 30 }, 8);
}

impl Drop for VtDecoder {
    fn drop(&mut self) {
        // No callbacks may run once `shared` is freed.
        unsafe {
            self.session.wait_for_asynchronous_frames();
            self.session.invalidate();
        }
    }
}
