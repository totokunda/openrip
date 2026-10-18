//! Reading a file's streams through FFmpeg, without decoding.

use std::path::Path;

use ffmpeg_sys_next as ff;

use crate::util::{cstr_or, Input, MICROS};
use crate::{AudioInfo, ColorInfo, FrameRate, MediaError, MediaInfo, Micros, VideoInfo};

/// Read a media file's streams without decoding.
pub fn probe(path: &Path) -> Result<MediaInfo, MediaError> {
    let input = Input::open(path)?;
    let fmt = input.0;
    unsafe {
        let duration = if (*fmt).duration > 0 { Micros((*fmt).duration) } else { Micros::ZERO };
        let format = cstr_or((*(*fmt).iformat).name, "unknown");
        let video = input.best_stream(ff::AVMediaType::AVMEDIA_TYPE_VIDEO).map(|i| video_info(&input, i));
        let audio = input.best_stream(ff::AVMediaType::AVMEDIA_TYPE_AUDIO).map(|i| audio_info(&input, i));
        Ok(MediaInfo { format, duration, video, audio })
    }
}

fn rational(r: ff::AVRational) -> Option<FrameRate> {
    (r.num > 0 && r.den > 0).then(|| {
        let g = gcd(r.num as u32, r.den as u32);
        FrameRate::new(r.num as u32 / g, r.den as u32 / g)
    })
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

pub(crate) fn stream_duration(input: &Input, st: *mut ff::AVStream) -> Micros {
    unsafe {
        if (*st).duration > 0 {
            Micros(ff::av_rescale_q((*st).duration, (*st).time_base, MICROS))
        } else if (*input.0).duration > 0 {
            Micros((*input.0).duration)
        } else {
            Micros::ZERO
        }
    }
}

pub(crate) fn video_info(input: &Input, index: i32) -> VideoInfo {
    unsafe {
        let st = input.stream(index);
        let par = (*st).codecpar;
        let fmt: ff::AVPixelFormat = std::mem::transmute((*par).format);
        let desc = ff::av_pix_fmt_desc_get(fmt);
        let bit_depth = if !desc.is_null() { (*desc).comp[0].depth as u8 } else { 8 };
        let profile = ff::avcodec_profile_name((*par).codec_id, (*par).profile);
        let mut rotation = 0;
        let sd = ff::av_packet_side_data_get((*par).coded_side_data, (*par).nb_coded_side_data, ff::AVPacketSideDataType::AV_PKT_DATA_DISPLAYMATRIX);
        if !sd.is_null() && (*sd).size >= 36 {
            let ccw = ff::av_display_rotation_get((*sd).data as *const i32);
            if ccw.is_finite() {
                rotation = ((-ccw / 90.0).round() as i32 * 90).rem_euclid(360);
            }
        }
        let sar = (*par).sample_aspect_ratio;
        VideoInfo {
            codec: cstr_or(ff::avcodec_get_name((*par).codec_id), "unknown"),
            profile: (!profile.is_null()).then(|| cstr_or(profile, "")),
            width: (*par).width as u32,
            height: (*par).height as u32,
            pixel_format: cstr_or(ff::av_get_pix_fmt_name(fmt), "unknown"),
            bit_depth,
            frame_rate: rational((*st).avg_frame_rate).or_else(|| rational((*st).r_frame_rate)),
            duration: stream_duration(input, st),
            frame_count: ((*st).nb_frames > 0).then_some((*st).nb_frames),
            rotation,
            sample_aspect: if sar.num > 0 && sar.den > 0 { (sar.num, sar.den) } else { (1, 1) },
            color: ColorInfo {
                range: cstr_or(ff::av_color_range_name((*par).color_range), "unknown"),
                matrix: cstr_or(ff::av_color_space_name((*par).color_space), "unknown"),
                primaries: cstr_or(ff::av_color_primaries_name((*par).color_primaries), "unknown"),
                transfer: cstr_or(ff::av_color_transfer_name((*par).color_trc), "unknown"),
            },
            time_base: ((*st).time_base.num, (*st).time_base.den),
        }
    }
}

fn audio_info(input: &Input, index: i32) -> AudioInfo {
    unsafe {
        let st = input.stream(index);
        let par = (*st).codecpar;
        AudioInfo {
            codec: cstr_or(ff::avcodec_get_name((*par).codec_id), "unknown"),
            sample_rate: (*par).sample_rate as u32,
            channels: (*par).ch_layout.nb_channels as u32,
            duration: stream_duration(input, st),
        }
    }
}
