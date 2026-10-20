// CapCut's Arrange layers (Settings ▸ Edit, Project settings ▸ Details). On, the tracks can be
// put in any order: a text track under a video track, a sticker above a caption. Off (the
// legacy way) the tracks stay in fixed bands by kind, top to bottom: text, stickers and shapes,
// effects and filters, overlay video, the main track, audio. A new track goes in its band and a
// track can't be moved out of it. Turned on, it stays on: the switch is one way.
import type { TimelineProps, TimelineType } from "./types";

/** The band of a kind of track, 0 the top. Video tracks are one band: the main track is the lowest of them. */
export const BAND: Record<TimelineType, number> = {
  text: 0,
  sticker: 1,
  shape: 1,
  draw: 1,
  filter: 2,
  media: 3,
  audio: 4,
};

export const bandOf = (track: Pick<TimelineProps, "type">): number => BAND[track.type] ?? 3;

/** The tracks in their bands, each band keeping the order it had. The same array when they already are. */
export const arrangeTracks = (timelines: TimelineProps[]): TimelineProps[] => {
  const sorted = timelines
    .map((t, i) => ({ t, i }))
    .sort((a, b) => bandOf(a.t) - bandOf(b.t) || a.i - b.i)
    .map((x) => x.t);
  return sorted.every((t, i) => t === timelines[i]) ? timelines : sorted;
};

/** Whether the tracks are already in their bands. */
export const isArranged = (timelines: TimelineProps[]): boolean => arrangeTracks(timelines) === timelines;
