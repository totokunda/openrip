//! What a media file holds, as the decoders describe it.

use serde::Serialize;

use crate::{FrameRate, Micros};

#[derive(Clone, Debug, Serialize)]
pub struct MediaInfo {
    /// Container format, e.g. "mov,mp4,m4a,3gp,3g2,mj2".
    pub format: String,
    pub duration: Micros,
    pub video: Option<VideoInfo>,
    pub audio: Option<AudioInfo>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VideoInfo {
    pub codec: String,
    pub profile: Option<String>,
    pub width: u32,
    pub height: u32,
    /// Pixel format of the coded stream, e.g. "yuv420p", "yuv420p10le".
    pub pixel_format: String,
    pub bit_depth: u8,
    /// Average frame rate; `None` when the container doesn't say.
    pub frame_rate: Option<FrameRate>,
    /// Duration of the stream, from its first frame.
    pub duration: Micros,
    /// Number of frames, when the container records it.
    pub frame_count: Option<i64>,
    /// Clockwise rotation (0, 90, 180 or 270) needed to display the frames upright.
    pub rotation: i32,
    /// Sample (pixel) aspect ratio; 1/1 for square pixels.
    pub sample_aspect: (i32, i32),
    pub color: ColorInfo,
    /// Time base of the stream, as num/den seconds.
    pub time_base: (i32, i32),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ColorInfo {
    /// "tv" (limited) or "pc" (full); "unknown" if unspecified.
    pub range: String,
    pub matrix: String,
    pub primaries: String,
    pub transfer: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AudioInfo {
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub duration: Micros,
}
