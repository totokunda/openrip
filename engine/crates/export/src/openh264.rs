//! H.264 in software through Cisco's OpenH264 binary, which the app downloads from Cisco the
//! first time an export needs it, as Firefox does. Cisco pays the H.264 patent fees for its
//! own binary only, and only when it is downloaded separately to the user's machine
//! (https://www.openh264.org/BINARY_LICENSE.txt), so it is never bundled with the app.
//!
//! - One binary is pinned per platform: its version, the URL on Cisco's server and the SHA-256
//!   of the download and of the library. The version is the one whose headers these bindings
//!   were generated from (openh264-sys2 0.9.8: OpenH264 2.6.0's API), so the ABI matches.
//! - [`install`] takes the downloaded `.bz2`, checks both hashes and keeps the library in the
//!   codec folder the app gives ([`set_codec_dir`], in its user data); its hash is checked
//!   again, and its version asked, before it is loaded.
//! - The user can turn its use off ([`set_enabled`]), as the licence requires.
//! - Without it (not downloaded, turned off, a file that isn't Cisco's) the engine runs as
//!   before: H.264 in software is just not available.
//!
//! Pictures are read back RGBA, converted to I420 (BT.709, limited range) by swscale, encoded
//! here, and muxed by FFmpeg, whose MP4 muxer takes the Annex B stream as it comes.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use ffmpeg_sys_next as ff;
use openh264_sys2 as oh;
use openh264_sys2::API;
use openrip_playback::{FrameReport, PreviewError};
use openrip_render::RgbaImage;
use sha2::{Digest, Sha256};

use crate::mux::Muxer;
use crate::software::Scaler;
use crate::{Encoder, ExportError, ExportOptions, Picture};

/// The OpenH264 release the bindings match.
pub const VERSION: &str = "2.6.0";

/// Cisco's binary for one platform.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Pin {
    /// `std::env::consts::OS` and `ARCH`.
    pub os: &'static str,
    pub arch: &'static str,
    /// The library's file name, as Cisco names it (and as it is kept).
    pub file: &'static str,
    /// SHA-256 of the `.bz2` Cisco serves, and of the library inside.
    pub bz2_sha256: &'static str,
    pub sha256: &'static str,
}

impl Pin {
    /// Where Cisco serves it.
    pub fn url(&self) -> String {
        format!("https://ciscobinary.openh264.org/{}.bz2", self.file)
    }
}

/// Cisco's OpenH264 2.6.0 binaries (https://github.com/cisco/openh264/releases/tag/v2.6.0),
/// hashed on 2026-10-21 after checking each against the MD5 Cisco publishes beside it
/// (`<file>.signed.md5.txt`); the library hashes are also the ones openh264-sys2 0.9.8 lists.
pub const PINS: [Pin; 6] = [
    Pin { os: "macos", arch: "aarch64", file: "libopenh264-2.6.0-mac-arm64.dylib", bz2_sha256: "6db362ee5abdab572311aeadb96d3f44b0617d9a4a4b9f4db4cb5ac4d968da71", sha256: "052e98bfcf7a9167d22f3bbb3f5988ef79065591f36af8b52924b22b13624551" },
    Pin { os: "macos", arch: "x86_64", file: "libopenh264-2.6.0-mac-x64.dylib", bz2_sha256: "38b2ed6d1d45b6a3e408c734173f2d67ab44a10d0e154ff3489b89877cd60e7e", sha256: "e3dc8bc01fe69363f61fd3c02fd27798537a585eadd38cd808f303d1ee505a19" },
    Pin { os: "linux", arch: "x86_64", file: "libopenh264-2.6.0-linux64.8.so", bz2_sha256: "27ab53323c110b76214c1c72222f459d17febbcd1e252136cadc292b0308d75b", sha256: "2f0cde7c6a6abcf5cae76942894ea42897fa677bce4ed6c91a24dd1b041d5f04" },
    Pin { os: "linux", arch: "aarch64", file: "libopenh264-2.6.0-linux-arm64.8.so", bz2_sha256: "a78aea7970150f46bcd3bb7994c9e6dd90bd7a9ea785920f5a73f6964e3fcda7", sha256: "12e7b33623667cdab0e575170c147b1b36eadb77d0d2aa7ceb5afd3e58902140" },
    Pin { os: "windows", arch: "x86_64", file: "openh264-2.6.0-win64.dll", bz2_sha256: "dab5f2a872777f9a58b69bfa9fbcf20d9f82f2d6ec91383fd70bff49bd34ac9f", sha256: "2076cb5675ec6c1a4c70e7a2a322552f547b6eeed649d6dfcd9e02a543b24691" },
    Pin { os: "windows", arch: "aarch64", file: "openh264-2.6.0-win-arm64.dll", bz2_sha256: "6b57d3ecd06bd80b5f3ee1abbb31d48798ca6d89ef1bc98cf2e6d1ebddf5cf45", sha256: "fb75103938f4f47d119b983e06334df41a803bc72fb5c46e3623f6fea5782732" },
];

/// The binary for `os` and `arch`, if Cisco makes one we pinned.
pub fn pin_for(os: &str, arch: &str) -> Option<Pin> {
    PINS.into_iter().find(|p| p.os == os && p.arch == arch)
}

/// This machine's binary.
pub fn pin() -> Option<Pin> {
    pin_for(std::env::consts::OS, std::env::consts::ARCH)
}

/// The text Cisco's licence asks for where the user turns its use on and off.
pub const ATTRIBUTION: &str = "OpenH264 Video Codec provided by Cisco Systems, Inc.";

/// A loaded library, kept for the rest of the run.
pub(crate) struct Lib {
    api: oh::DynamicAPI,
}

// The library's functions are plain C, callable from any thread; each encoder is used by one.
unsafe impl Send for Lib {}
unsafe impl Sync for Lib {}

struct State {
    dir: Option<PathBuf>,
    enabled: bool,
    lib: Option<Arc<Lib>>,
    /// A load was tried since the folder or the file last changed (and why it failed).
    tried: bool,
    error: Option<String>,
}

static STATE: Mutex<State> = Mutex::new(State { dir: None, enabled: true, lib: None, tried: false, error: None });

/// Where the library is kept (the app's user data); it is looked for there from now on.
pub fn set_codec_dir(dir: &Path) {
    let mut s = STATE.lock().unwrap();
    if s.dir.as_deref() != Some(dir) {
        *s = State { dir: Some(dir.to_path_buf()), enabled: s.enabled, lib: None, tried: false, error: None };
    }
}

/// Use OpenH264 (on, the default) or not: off, H.264 in software is not offered.
pub fn set_enabled(on: bool) {
    STATE.lock().unwrap().enabled = on;
}

/// Where OpenH264 stands on this machine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Status {
    /// Cisco makes a binary for this platform.
    pub supported: bool,
    pub enabled: bool,
    /// Downloaded, checked and loaded.
    pub installed: bool,
    pub version: &'static str,
    /// What to download, and its SHA-256 (none where unsupported).
    pub url: Option<String>,
    pub bz2_sha256: Option<&'static str>,
    /// Why the file in the codec folder couldn't be used.
    pub error: Option<String>,
}

pub fn status() -> Status {
    let pin = pin();
    let lib = loaded(false);
    let s = STATE.lock().unwrap();
    Status { supported: pin.is_some(), enabled: s.enabled, installed: lib.is_some(), version: VERSION, url: pin.map(|p| p.url()), bz2_sha256: pin.map(|p| p.bz2_sha256), error: s.error.clone() }
}

/// The library, when it is turned on and installed (`regardless`: whether turned on or not).
pub(crate) fn loaded(regardless: bool) -> Option<Arc<Lib>> {
    let mut s = STATE.lock().unwrap();
    if !s.enabled && !regardless {
        return None;
    }
    if s.lib.is_none() && !s.tried {
        s.tried = true;
        if let (Some(dir), Some(pin)) = (s.dir.clone(), pin()) {
            let path = dir.join(pin.file);
            if path.exists() {
                match load(&path, &pin) {
                    Ok(lib) => s.lib = Some(lib),
                    Err(e) => s.error = Some(e),
                }
            }
        }
    }
    s.lib.clone()
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Load the library at `path` if it is the pinned binary, of the pinned version, and encodes.
fn load(path: &Path, pin: &Pin) -> Result<Arc<Lib>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("can't read {}: {e}", path.display()))?;
    if sha256_hex(&bytes) != pin.sha256 {
        return Err(format!("{} is not Cisco's OpenH264 {VERSION} (its SHA-256 doesn't match): not loaded", path.display()));
    }
    // SAFETY: the file is the pinned binary, whose ABI these bindings were made for.
    let api = unsafe { oh::DynamicAPI::from_blob_path_unchecked(path) }.map_err(|e| format!("can't load {}: {e}", path.display()))?;
    let v = unsafe { api.WelsGetCodecVersion() };
    let version = format!("{}.{}.{}", v.uMajor, v.uMinor, v.uRevision);
    if version != VERSION {
        return Err(format!("{} is OpenH264 {version}, not {VERSION}", path.display()));
    }
    let lib = Arc::new(Lib { api });
    probe(&lib).map_err(|e| format!("OpenH264 didn't encode a test picture: {e}"))?;
    Ok(lib)
}

/// Encode one small grey picture.
fn probe(lib: &Arc<Lib>) -> Result<(), ExportError> {
    let mut enc = RawEncoder::new(lib.clone(), 256, 144, 30.0, 500_000, false, 60)?;
    let y = vec![128u8; 256 * 144];
    let uv = vec![128u8; 128 * 72];
    let info = enc.encode([&y, &uv, &uv], [256, 128, 128], 0)?;
    if info.iFrameSizeInBytes > 0 && info.eFrameType == oh::videoFrameTypeIDR {
        Ok(())
    } else {
        Err(ExportError::Other("no keyframe came out".into()))
    }
}

/// Check and keep a download of this platform's binary (`bz2`, as Cisco serves it), then load
/// it. Nothing is kept unless both its hashes match the pinned ones.
pub fn install(bz2: &[u8]) -> Result<(), ExportError> {
    use std::io::Read;
    let fail = |m: String| ExportError::Other(m);
    let pin = pin().ok_or_else(|| fail("Cisco makes no OpenH264 binary for this platform".into()))?;
    if sha256_hex(bz2) != pin.bz2_sha256 {
        return Err(fail(format!("the download is not Cisco's OpenH264 {VERSION} for this platform (its SHA-256 doesn't match)")));
    }
    let mut lib = Vec::new();
    bzip2::read::BzDecoder::new(bz2).take(64 << 20).read_to_end(&mut lib).map_err(|e| fail(format!("can't unpack the download: {e}")))?;
    if sha256_hex(&lib) != pin.sha256 {
        return Err(fail(format!("the unpacked library is not Cisco's OpenH264 {VERSION} (its SHA-256 doesn't match)")));
    }
    let dir = STATE.lock().unwrap().dir.clone().ok_or_else(|| fail("no folder to keep codecs in".into()))?;
    std::fs::create_dir_all(&dir).map_err(|e| fail(format!("can't create {}: {e}", dir.display())))?;
    let path = dir.join(pin.file);
    let part = dir.join(format!("{}.part", pin.file));
    std::fs::write(&part, &lib).and_then(|_| std::fs::rename(&part, &path)).map_err(|e| fail(format!("can't save {}: {e}", path.display())))?;
    {
        let mut s = STATE.lock().unwrap();
        s.lib = None;
        s.tried = false;
        s.error = None;
    }
    loaded(true).map(|_| ()).ok_or_else(|| fail(STATE.lock().unwrap().error.clone().unwrap_or_else(|| "OpenH264 didn't load".into())))
}

/// OpenH264's largest picture (its README: "Encoder errors when resolution exceeds 3840x2160"),
/// as longer side x shorter side.
pub const MAX_SIZE: (u32, u32) = (3840, 2160);

/// One OpenH264 encoder, set up for an export.
struct RawEncoder {
    lib: Arc<Lib>,
    enc: *mut oh::ISVCEncoder,
    info: Box<oh::SFrameBSInfo>,
    width: u32,
    height: u32,
    /// Milliseconds a frame, for the pictures' timestamps.
    frame_ms: f64,
}

impl Drop for RawEncoder {
    fn drop(&mut self) {
        unsafe {
            if let Some(f) = (**self.enc).Uninitialize {
                f(self.enc);
            }
            self.lib.api.WelsDestroySVCEncoder(self.enc);
        }
    }
}

impl RawEncoder {
    /// High profile with CABAC, `bitrate` (held to it when `exact`), an IDR every `gop`
    /// frames, no frames skipped, BT.709 limited range in the VUI, slices on up to four cores.
    fn new(lib: Arc<Lib>, width: u32, height: u32, fps: f64, bitrate: u64, exact: bool, gop: u32) -> Result<RawEncoder, ExportError> {
        let (long, short) = (width.max(height), width.min(height));
        if long > MAX_SIZE.0 || short > MAX_SIZE.1 {
            return Err(ExportError::Other(format!("H.264 in software (OpenH264) goes up to {}x{}; {width}x{height} is larger", MAX_SIZE.0, MAX_SIZE.1)));
        }
        let fail = |op: &str, r: i32| ExportError::Other(format!("OpenH264 {op} failed ({r})"));
        unsafe {
            let mut enc: *mut oh::ISVCEncoder = std::ptr::null_mut();
            let r = lib.api.WelsCreateSVCEncoder(&mut enc);
            if r != 0 || enc.is_null() {
                return Err(fail("WelsCreateSVCEncoder", r));
            }
            // Dropped (uninitialised and destroyed) if setting it up fails.
            let this = RawEncoder { lib, enc, info: Box::default(), width, height, frame_ms: 1000.0 / fps };
            let vt = &**enc;
            let quiet: i32 = oh::WELS_LOG_QUIET as i32;
            vt.SetOption.unwrap()(enc, oh::ENCODER_OPTION_TRACE_LEVEL, &quiet as *const i32 as *mut _);
            let mut p = oh::SEncParamExt::default();
            vt.GetDefaultParams.unwrap()(enc, &mut p);
            // Slices on up to four cores: OpenH264's most (MAX_THREADS_NUM).
            let threads = std::thread::available_parallelism().map_or(1, |n| n.get()).min(4) as u16;
            let bps = bitrate.min(i32::MAX as u64) as i32;
            // (OpenH264 2.6 refuses the non-real-time usages: ParamValidationExt, "Invalid usage type".)
            p.iUsageType = oh::CAMERA_VIDEO_REAL_TIME;
            p.iPicWidth = width as i32;
            p.iPicHeight = height as i32;
            p.iRCMode = oh::RC_BITRATE_MODE;
            p.iTargetBitrate = bps;
            let max = if exact { bps } else { oh::UNSPECIFIED_BIT_RATE as i32 };
            p.iMaxBitrate = max;
            p.fMaxFrameRate = fps as f32;
            p.iTemporalLayerNum = 1;
            p.iSpatialLayerNum = 1;
            p.uiIntraPeriod = gop;
            p.eSpsPpsIdStrategy = oh::CONSTANT_ID;
            p.iEntropyCodingModeFlag = 1;
            p.bEnableFrameSkip = false;
            p.iComplexityMode = oh::HIGH_COMPLEXITY;
            p.iMultipleThreadIdc = threads;
            p.bEnableDenoise = false;
            p.bEnableSceneChangeDetect = true;
            p.bEnableAdaptiveQuant = true;
            // On, it leaves still-looking areas skipped and the encoder at its lowest QP well
            // under the bit rate asked (a phone clip at 8 Mbps: 5.6 Mbps, 47.4 dB; off: 7.8 Mbps,
            // 52.2 dB, VideoToolbox's 51.9).
            p.bEnableBackgroundDetection = false;
            p.iLoopFilterDisableIdc = 0;
            let l = &mut p.sSpatialLayers[0];
            l.iVideoWidth = width as i32;
            l.iVideoHeight = height as i32;
            l.fFrameRate = fps as f32;
            l.iSpatialBitrate = bps;
            l.iMaxSpatialBitrate = max;
            l.uiProfileIdc = oh::PRO_HIGH;
            l.uiLevelIdc = oh::LEVEL_UNKNOWN;
            l.sSliceArgument.uiSliceMode = if threads > 1 { oh::SM_FIXEDSLCNUM_SLICE } else { oh::SM_SINGLE_SLICE };
            l.sSliceArgument.uiSliceNum = threads as u32;
            // BT.709, limited range (H.264 table E-3: 1 is BT.709; video_format 5 unspecified).
            l.bVideoSignalTypePresent = true;
            l.uiVideoFormat = 5;
            l.bFullRange = false;
            l.bColorDescriptionPresent = true;
            l.uiColorPrimaries = 1;
            l.uiTransferCharacteristics = 1;
            l.uiColorMatrix = 1;
            let r = vt.InitializeExt.unwrap()(enc, &p);
            if r != 0 {
                return Err(fail("InitializeExt", r));
            }
            let format: i32 = oh::videoFormatI420 as i32;
            vt.SetOption.unwrap()(enc, oh::ENCODER_OPTION_DATAFORMAT, &format as *const i32 as *mut _);
            Ok(this)
        }
    }

    /// Encode frame `index` from its I420 planes; what came out is in the returned info.
    fn encode(&mut self, planes: [&[u8]; 3], strides: [i32; 3], index: i64) -> Result<&oh::SFrameBSInfo, ExportError> {
        let pic = oh::SSourcePicture {
            iColorFormat: oh::videoFormatI420 as i32,
            iStride: [strides[0], strides[1], strides[2], 0],
            pData: [planes[0].as_ptr() as *mut u8, planes[1].as_ptr() as *mut u8, planes[2].as_ptr() as *mut u8, std::ptr::null_mut()],
            iPicWidth: self.width as i32,
            iPicHeight: self.height as i32,
            uiTimeStamp: (index as f64 * self.frame_ms).round() as i64,
            bPsnrY: false,
            bPsnrU: false,
            bPsnrV: false,
        };
        let r = unsafe { (**self.enc).EncodeFrame.unwrap()(self.enc, &pic, &mut *self.info) };
        if r != 0 {
            return Err(ExportError::Other(format!("OpenH264 EncodeFrame failed ({r})")));
        }
        Ok(&self.info)
    }
}

/// The NAL units (Annex B, start codes included) of every layer that came out, in order.
fn bitstream(info: &oh::SFrameBSInfo, out: &mut Vec<u8>) {
    out.clear();
    for layer in &info.sLayerInfo[..info.iLayerNum.max(0) as usize] {
        let lens = unsafe { std::slice::from_raw_parts(layer.pNalLengthInByte, layer.iNalCount.max(0) as usize) };
        let size: usize = lens.iter().map(|n| *n as usize).sum();
        out.extend_from_slice(unsafe { std::slice::from_raw_parts(layer.pBsBuf, size) });
    }
}

/// An export through OpenH264.
pub(crate) struct H264Encoder {
    scaler: Scaler,
    image: Option<RgbaImage>,
    yuv: *mut ff::AVFrame,
    packet: Vec<u8>,
    raw: RawEncoder,
    mux: Muxer,
}

impl Drop for H264Encoder {
    fn drop(&mut self) {
        unsafe { ff::av_frame_free(&mut self.yuv) };
    }
}

impl H264Encoder {
    pub(crate) fn open(path: &Path, o: &ExportOptions) -> Result<H264Encoder, ExportError> {
        let lib = loaded(false).ok_or(ExportError::NeedsOpenH264)?;
        let gop = (o.fps.as_f64() * 2.0).round() as u32;
        let raw = RawEncoder::new(lib, o.width, o.height, o.fps.as_f64(), o.bitrate, o.exact_bitrate, gop)?;
        let mut mux = Muxer::new(path)?;
        unsafe {
            mux.add_video_with(o, |par| {
                (*par).codec_id = ff::AVCodecID::AV_CODEC_ID_H264;
                (*par).format = ff::AVPixelFormat::AV_PIX_FMT_YUV420P as i32;
                (*par).profile = ff::AV_PROFILE_H264_HIGH as i32;
                (*par).color_range = ff::AVColorRange::AVCOL_RANGE_MPEG;
                (*par).color_space = ff::AVColorSpace::AVCOL_SPC_BT709;
                (*par).color_primaries = ff::AVColorPrimaries::AVCOL_PRI_BT709;
                (*par).color_trc = ff::AVColorTransferCharacteristic::AVCOL_TRC_BT709;
            });
        }
        mux.start(o.audio)?;
        Ok(H264Encoder { scaler: Scaler::new(), image: None, yuv: unsafe { ff::av_frame_alloc() }, packet: Vec::new(), raw, mux })
    }
}

impl Encoder for H264Encoder {
    fn video(&mut self, index: i64, draw: &mut dyn FnMut(Picture<'_>) -> Result<FrameReport, PreviewError>) -> Result<FrameReport, ExportError> {
        let (w, h) = (self.raw.width, self.raw.height);
        let mut image = self.image.take().unwrap_or(RgbaImage { width: w, height: h, data: Vec::new() });
        let report = draw(Picture::Rgba(&mut image))?;
        let key = unsafe {
            let f = self.yuv;
            ff::av_frame_unref(f);
            (*f).format = ff::AVPixelFormat::AV_PIX_FMT_YUV420P as i32;
            (*f).width = w as i32;
            (*f).height = h as i32;
            self.scaler.convert(&image, f)?;
            let plane = |i: usize, rows: u32| std::slice::from_raw_parts((*f).data[i], (*f).linesize[i] as usize * rows as usize);
            let info = self.raw.encode([plane(0, h), plane(1, h / 2), plane(2, h / 2)], [(*f).linesize[0], (*f).linesize[1], (*f).linesize[2]], index)?;
            bitstream(info, &mut self.packet);
            info.eFrameType == oh::videoFrameTypeIDR || info.eFrameType == oh::videoFrameTypeI
        };
        self.image = Some(image);
        // Skipping is off: every picture comes out, one packet each.
        if !self.packet.is_empty() {
            self.mux.write_video(&self.packet, index, key)?;
        }
        Ok(report)
    }

    fn audio(&mut self, samples: &[f32], flush: bool) -> Result<(), ExportError> {
        self.mux.encode_audio(samples, flush)
    }

    fn finish(mut self: Box<Self>) -> Result<(), ExportError> {
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

    #[test]
    fn a_pin_for_each_desktop_on_ciscos_server() {
        for (os, arch) in [("macos", "aarch64"), ("macos", "x86_64"), ("windows", "x86_64"), ("windows", "aarch64"), ("linux", "x86_64"), ("linux", "aarch64")] {
            let p = pin_for(os, arch).unwrap();
            assert!(p.file.contains(VERSION), "{p:?}");
            assert!(p.url().starts_with("https://ciscobinary.openh264.org/") && p.url().ends_with(".bz2"));
            assert!(p.sha256.len() == 64 && p.bz2_sha256.len() == 64);
        }
        assert!(pin_for("ios", "aarch64").is_none() && pin_for("linux", "x86").is_none());
    }

    #[test]
    fn a_download_that_isnt_ciscos_is_refused() {
        // Whatever the platform: no pin, or a hash that doesn't match.
        let e = install(b"BZh91AY&SY not openh264").unwrap_err().to_string();
        assert!(e.contains("SHA-256") || e.contains("no OpenH264 binary"), "{e}");
    }

    #[test]
    fn a_wrong_file_in_the_codec_folder_is_not_loaded() {
        let Some(pin) = pin() else { return };
        let dir = std::env::temp_dir().join(format!("openrip-openh264-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(pin.file), b"not a library").unwrap();
        let e = load(&dir.join(pin.file), &pin).err().unwrap();
        assert!(e.contains("SHA-256"), "{e}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
