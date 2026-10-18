use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("cannot open {path}: {msg}")]
    Open { path: PathBuf, msg: String },
    #[error("{path} has no video stream")]
    NoVideoStream { path: PathBuf },
    #[error("no decoder for codec {0}")]
    NoDecoder(String),
    /// A backend can't take this asset (another may).
    #[error("{path}: {msg}")]
    Unsupported { path: PathBuf, msg: String },
    #[error("{op} failed: {msg} ({code})")]
    Ffmpeg { op: &'static str, code: i32, msg: String },
    /// A frame from another backend failed.
    #[error("{0}")]
    Frame(String),
}

/// A frame's error is its backend's own: for frames from this crate, a `MediaError`.
impl From<openrip_frame::FrameError> for MediaError {
    fn from(e: openrip_frame::FrameError) -> Self {
        match e.0.downcast::<MediaError>() {
            Ok(m) => *m,
            Err(other) => MediaError::Frame(other.to_string()),
        }
    }
}

impl MediaError {
    pub(crate) fn ffmpeg(op: &'static str, code: i32) -> Self {
        MediaError::Ffmpeg { op, code, msg: crate::util::err_str(code) }
    }
}

pub(crate) fn check(op: &'static str, code: i32) -> Result<i32, MediaError> {
    if code < 0 {
        Err(MediaError::ffmpeg(op, code))
    } else {
        Ok(code)
    }
}
