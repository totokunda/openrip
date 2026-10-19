// Where the timeline's tracks are on screen. CapCut keeps the main track (and what's below it)
// fixed at the bottom of the track area while the overlay tracks above it scroll; when the
// tracks fit, nothing moves. The editor sets the two offsets when it lays out; the drag and drop
// code, track headers and graph panel read them, so each places a track by its own offset.

/** Space under the pinned tracks (the horizontal scrollbar's). */
export const PIN_BOTTOM = 12;
/** The overlay area's least height before pinning gives way to one scroll for everything. */
export const MIN_OVERLAY = 60;
/** The top of the track area: below the ruler, where a track's `timelineY` begins. */
export const TRACK_TOP = 32;

interface Track {
  timelineY?: number;
  timelineHeight?: number;
}

export interface TrackLayout {
  /** Whether the main track and what's below it are fixed while the tracks above scroll. */
  pinned: boolean;
  /** The `timelineY` from which tracks are pinned (the main track's). */
  from: number;
  /** The offsets added to the tracks above the pinned ones and to the pinned ones. */
  over: number;
  pin: number;
  /** The overlay area's bottom edge in the stage (where the pinned tracks start). */
  overBottom: number;
  /** The most the overlay tracks scroll, and what the scrollbar spans. */
  maxScroll: number;
}

export const trackView: TrackLayout = { pinned: false, from: Infinity, over: 0, pin: 0, overBottom: 0, maxScroll: 0 };

/**
 * Lays the tracks out. `tracks` run top to bottom, `main` the first pinned one; `scroll` is how
 * far the overlay tracks are scrolled from their top (the legacy single scroll when nothing
 * pins). `pad` is the room kept under the last track for dragging a new one in.
 */
export function layoutTracks(tracks: Track[], main: Track | undefined, stageHeight: number, scroll: number, pad: number): TrackLayout {
  const bottom = (t: Track) => (t.timelineY ?? 0) + (t.timelineHeight ?? 54) + TRACK_TOP;
  const end = tracks.reduce((m, t) => Math.max(m, bottom(t)), 0);
  const plain = (): TrackLayout => {
    const maxScroll = Math.max(0, end + pad - stageHeight);
    const dy = -Math.max(0, Math.min(scroll, maxScroll));
    return { pinned: false, from: Infinity, over: dy, pin: dy, overBottom: stageHeight, maxScroll };
  };
  if (!main || end + pad <= stageHeight) return plain();
  const mainTop = (main.timelineY ?? 0) + TRACK_TOP;
  const pin = stageHeight - PIN_BOTTOM - end;
  const overBottom = mainTop + pin;
  const room = overBottom - TRACK_TOP;
  if (room < MIN_OVERLAY || mainTop <= TRACK_TOP) return plain();
  const maxScroll = Math.max(0, mainTop - TRACK_TOP - room);
  return { pinned: true, from: main.timelineY ?? 0, over: -Math.max(0, Math.min(scroll, maxScroll)), pin, overBottom, maxScroll };
}

/** The vertical offset a track is drawn at. */
export const trackDy = (t: Track | undefined) => ((t?.timelineY ?? 0) >= trackView.from ? trackView.pin : trackView.over);

/** The top of a track's band in the stage. */
export const trackTop = (t: Track) => (t.timelineY ?? 0) + TRACK_TOP + trackDy(t);

/**
 * Which track a point of the stage (y from its top) is over, on the band or its gap below. The
 * pinned tracks come first, and the overlay tracks scrolled under them aren't there.
 */
export const trackAt = <T extends Track>(tracks: T[], y: number): T | undefined => {
  const hit = (t: T) => {
    const dy = trackDy(t);
    return y - dy >= (t.timelineY ?? 0) + TRACK_TOP && y - dy <= (t.timelineY ?? 0) + (t.timelineHeight ?? 0) + 24;
  };
  const pinned = trackView.pinned ? tracks.filter((t) => (t.timelineY ?? 0) >= trackView.from) : [];
  const over = trackView.pinned ? tracks.filter((t) => (t.timelineY ?? 0) < trackView.from && y <= trackView.overBottom) : tracks;
  return pinned.find(hit) ?? over.find(hit);
};
