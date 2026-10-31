// Track kinds, heights and stacking (CapCut's rows, docs/plan/capcut-ui-spec.md §4.10–4.11): which
// track a clip can go on, how tall each kind's row is, and the tracks laid out top to bottom.
// Pure, for the timeline's editing rules and the clip store (lib/clip.ts re-exports them).
import type { AnyClipProps, TimelineProps, TimelineType } from "../../types.ts";
import { TIME_ZERO_X } from "../../timeline-geometry.ts";
import { mainTrackOf } from "../../timeline-edit.ts";

type Kinded = AnyClipProps | { type: string } | string;

export const isValidTimelineForClip = (timeline: TimelineProps, clip: Kinded) => {
  const type = typeof clip === "string" ? clip : clip.type;
  if (timeline.type === "media") return type === "video" || type === "image" || type === "group";
  return timeline.type === type;
};

export const getTimelineTypeForClip = (clip: Kinded): TimelineType => {
  const type = typeof clip === "string" ? clip : clip.type;
  if (type === "video" || type === "image" || type === "group") return "media";
  return type as TimelineType;
};

/** The space the timeline draws between tracks (inside each track's height). */
export const TRACK_GAP = 8;

/** The track menu's Track height: Short and Tall against the Default row. */
export const TRACK_SIZES = { short: 0.7, tall: 1.4 } as const;

/**
 * A track's height: CapCut's row for its kind (docs/plan/capcut-ui-spec.md §4.11: the main
 * track 76 px, overlay video 52, audio 50, text, filter and the rest 24), scaled by its Track
 * height (video and audio tracks), and the gap below it.
 */
export const trackHeightFor = (type: TimelineType, main: boolean, size?: TimelineProps["size"]) => {
  const row = type === "media" ? (main ? 76 : 52) : type === "audio" ? 50 : 24;
  const scaled = size && (type === "media" || type === "audio") ? Math.round(row * TRACK_SIZES[size]) : row;
  return scaled + TRACK_GAP;
};

/** The tracks stacked top to bottom, each its kind's height, time 0 after the Cover column. */
export const resolveOverlapsTimelines = (timelines: TimelineProps[]): TimelineProps[] => {
  if (timelines.length === 0) return timelines;
  const main = mainTrackOf(timelines);
  let y = 0;
  return timelines.map((t) => {
    // Every track starts time 0 after the Cover column (an older project saved 24 px).
    const track = { ...t, timelinePadding: TIME_ZERO_X, timelineHeight: trackHeightFor(t.type, t === main, t.size), timelineY: y };
    y += track.timelineHeight;
    return track;
  });
};
