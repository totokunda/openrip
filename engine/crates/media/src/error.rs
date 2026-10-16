use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("cannot open {path}: {msg}")]
    Open { path: PathBuf, msg: String },
    #[error("{path} has no video stream")]
    NoVideoStream { path: PathBuf },
    #[error("no decoder for codec {0}")]
    NoDecoder(String),
    #[error("{op} failed: {msg} ({code})")]
    Ffmpeg { op: &'static str, code: i32, msg: String },
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
