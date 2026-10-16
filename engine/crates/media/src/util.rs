use std::ffi::{c_char, CStr, CString};
use std::path::Path;

use ffmpeg_sys_next as ff;

use crate::MediaError;

pub(crate) fn err_str(code: i32) -> String {
    let mut buf = [0 as c_char; 128];
    unsafe {
        ff::av_strerror(code, buf.as_mut_ptr(), buf.len());
        CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned()
    }
}

pub(crate) fn c_path(path: &Path) -> Result<CString, MediaError> {
    CString::new(path.to_string_lossy().as_bytes()).map_err(|_| MediaError::Open { path: path.into(), msg: "path contains a NUL byte".into() })
}

pub(crate) fn cstr_or(p: *const c_char, fallback: &str) -> String {
    if p.is_null() {
        fallback.to_string()
    } else {
        unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
    }
}

pub(crate) const MICROS: ff::AVRational = ff::AVRational { num: 1, den: 1_000_000 };

/// Keep FFmpeg quiet below errors (real-world files trigger a stream of harmless warnings);
/// `OPENRIP_FFMPEG_LOG=info|verbose|debug` turns it up.
fn init_logging() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let level = match std::env::var("OPENRIP_FFMPEG_LOG").as_deref() {
            Ok("warning") => ff::AV_LOG_WARNING,
            Ok("info") => ff::AV_LOG_INFO,
            Ok("verbose") => ff::AV_LOG_VERBOSE,
            Ok("debug") => ff::AV_LOG_DEBUG,
            _ => ff::AV_LOG_ERROR,
        };
        unsafe { ff::av_log_set_level(level) };
    });
}

/// Owns an opened `AVFormatContext`.
pub(crate) struct Input(pub *mut ff::AVFormatContext);

impl Input {
    pub(crate) fn open(path: &Path) -> Result<Input, MediaError> {
        init_logging();
        let c = c_path(path)?;
        let mut fmt: *mut ff::AVFormatContext = std::ptr::null_mut();
        unsafe {
            let r = ff::avformat_open_input(&mut fmt, c.as_ptr(), std::ptr::null(), std::ptr::null_mut());
            if r < 0 {
                return Err(MediaError::Open { path: path.into(), msg: err_str(r) });
            }
            let input = Input(fmt);
            let r = ff::avformat_find_stream_info(fmt, std::ptr::null_mut());
            if r < 0 {
                return Err(MediaError::Open { path: path.into(), msg: err_str(r) });
            }
            Ok(input)
        }
    }

    pub(crate) fn stream(&self, index: i32) -> *mut ff::AVStream {
        unsafe { *(*self.0).streams.add(index as usize) }
    }

    pub(crate) fn best_stream(&self, kind: ff::AVMediaType) -> Option<i32> {
        let i = unsafe { ff::av_find_best_stream(self.0, kind, -1, -1, std::ptr::null_mut(), 0) };
        (i >= 0).then_some(i)
    }
}

impl Drop for Input {
    fn drop(&mut self) {
        unsafe { ff::avformat_close_input(&mut self.0) }
    }
}
