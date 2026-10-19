// The clips cut to a range of the timeline, for Export range: each clip that touches it is cut at
// the range's ends the way a split cuts it (the media it shows, its keyframes, speed curve and
// animations carried over by lib/clip.ts's splitClipAt), keeps its id so groups still hold,
// and the lot moves back to start at 0.
import { splitClipAt } from "./clip";
import type { AnyClipProps } from "./types";

export function clipsWithinRange<T extends { clipId: string; startFrame?: number; endFrame?: number }>(clips: T[], start: number, end: number): T[] {
  if (!(end > start)) return [];
  const out: T[] = [];
  for (const original of clips) {
    let c = original as unknown as AnyClipProps;
    const [s, e] = [c.startFrame ?? 0, c.endFrame ?? 0];
    if (e <= start || s >= end) continue;
    if (s < start) c = { ...splitClipAt(c, start)[1], clipId: original.clipId } as AnyClipProps;
    if ((c.endFrame ?? 0) > end) c = { ...splitClipAt(c, end)[0], clipId: original.clipId } as AnyClipProps;
    out.push({ ...c, startFrame: (c.startFrame ?? 0) - start, endFrame: (c.endFrame ?? 0) - start } as unknown as T);
  }
  return out;
}
