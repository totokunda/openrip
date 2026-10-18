//! Where a picture clip's pixels come from at a timeline time: its file at its media time
//! (through its speed curve, if it has one), the copy played backward that CapCut rendered
//! for a reversed clip, or for a freeze frame its still, or the frozen video when there is
//! no still (docs/parity/speed.md).

use std::path::Path;

use openrip_model::{Media, MediaKind, Micros, Project, Segment};
use openrip_platform::assets;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Picture {
    /// A still image.
    Still(String),
    /// A video at a time in it, and the time in the clip's own media (they differ for the
    /// copy played backward). `backward`: the clip walks down through the file as the
    /// timeline goes on (reversed, with no copy played backward to read instead).
    Video { path: String, at: Micros, media: Micros, backward: bool },
}

impl Picture {
    pub(crate) fn path(&self) -> &str {
        match self {
            Picture::Still(p) => p,
            Picture::Video { path, .. } => path,
        }
    }
}

/// The picture a photo or video clip shows at `t`.
pub(crate) fn picture(project: &Project, seg: &Segment, media: &Media, t: Micros) -> Picture {
    if media.kind == MediaKind::Photo {
        return match &media.freeze {
            // A freeze frame without its still: the frame of the video it was taken from.
            Some(fr) if media.path.is_empty() || !assets::exists(Path::new(&media.path)) => Picture::Video { path: fr.video.clone(), at: fr.at, media: fr.at, backward: false },
            _ => Picture::Still(media.path.clone()),
        };
    }
    let at = media_time(project, seg, t, media.duration);
    if seg.reverse {
        if let Some(copy) = reversed_copy(media) {
            return Picture::Video { path: copy.to_string(), at: Micros((media.duration.0 - at.0).max(0)), media: at, backward: false };
        }
    }
    Picture::Video { path: media.path.clone(), at, media: at, backward: seg.reverse }
}

/// The media time a video clip shows at `t`: its media time inside the clip (through its speed
/// curve, if it has one). Outside it (the other clip of a transition that mixes them, drawn on
/// past its end or ahead of its start) its media carries on at its speed, up to the media's own
/// ends.
fn media_time(project: &Project, seg: &Segment, t: Micros, duration: Micros) -> Micros {
    let Some(source) = seg.source.filter(|_| !seg.target.contains(t) && duration.0 > 0) else { return seg.media_time(&project.materials, t).unwrap_or(Micros::ZERO) };
    let offset = (seg.local_time(t).0 as f64 * seg.speed).round() as i64;
    let at = if seg.reverse { source.end().0 - 1 - offset } else { source.start.0 + offset };
    Micros(at.clamp(0, duration.0 - 1))
}

/// The copy of a video played backward that CapCut rendered, if it's readable.
pub(crate) fn reversed_copy(media: &Media) -> Option<&str> {
    media.reverse_path.as_deref().filter(|p| assets::exists(Path::new(p)))
}
