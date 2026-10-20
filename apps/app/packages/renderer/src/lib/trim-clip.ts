// More clip actions › Trim clip (CapCut's): set where a video or sound clip starts and ends on
// its source, scrubbing a preview of the source (components/dialogs/TrimClipDialog.tsx). The
// clip keeps its place on the timeline (its start doesn't move) and its speed; its length
// becomes the chosen stretch, and everything else of the source stays available to drag out
// again with the clip's edges. All of it is one `updateClip`, so one undo step.
//
// A clip's `trimStart` is what's cut off the front of its media and `-trimEnd` what's cut off
// the back, both in frames of the timeline at the clip's speed and in the order the clip plays
// (lib/speed.ts); `extent` puts the whole source on that scale.
import { create } from "zustand";
import { hasCurve, sourceTimeAt } from "./speed.ts";
import { shiftKeyframes } from "./keyframes.ts";
import type { AnyClipProps, VideoClipProps } from "./types";

/** Whether Trim clip applies: a video or sound clip on a source of its own (no freeze frame, no speed curve). */
export const canTrimClip = (clip: AnyClipProps | undefined): boolean => {
  if (!clip || (clip.type !== "video" && clip.type !== "audio") || !(clip as VideoClipProps).assetId) return false;
  return !(clip as VideoClipProps).freeze && !hasCurve(clip);
};

const finite = (v: number | undefined): number => (Number.isFinite(v ?? 0) ? Number(v ?? 0) : 0);

/** The clip's source on the timeline's scale: `total` frames, the clip showing `[start, end]` of them. */
export const trimExtent = (clip: AnyClipProps): { total: number; start: number; end: number } => {
  const length = Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));
  const start = Math.max(0, finite(clip.trimStart));
  const cutAfter = Math.max(0, -finite(clip.trimEnd));
  return { total: start + length + cutAfter, start, end: start + length };
};

/** The patch (for `updateClip`) that makes the clip show frames `[start, end]` of its source (see `trimExtent`). */
export const trimPatch = (clip: AnyClipProps, start: number, end: number): Partial<AnyClipProps> => {
  const { total, start: oldStart } = trimExtent(clip);
  const a = Math.min(Math.max(0, Math.round(start)), total - 1);
  const b = Math.min(Math.max(a + 1, Math.round(end)), total);
  return {
    trimStart: a,
    trimEnd: b - total,
    endFrame: (clip.startFrame ?? 0) + (b - a),
    // Keys stay on the content as its in-point moves (they're clip-local).
    keyframes: shiftKeyframes(clip.keyframes, -(a - oldStart)),
  } as Partial<AnyClipProps>;
};

/** The time (s) of the clip's asset shown at frame `at` of its source (see `trimExtent`); `mediaSeconds` is the asset's length. */
export const sourceSecondsAt = (clip: AnyClipProps, at: number, fps: number, mediaSeconds?: number): number =>
  sourceTimeAt({ ...clip, trimStart: at, speedCurve: null } as AnyClipProps, 0, fps, mediaSeconds);

/** The Trim clip dialog: the clip it is open for. */
export const useTrimClip = create<{ clipId: string | null; open: (clipId: string) => void; close: () => void }>((set) => ({
  clipId: null,
  open: (clipId) => set({ clipId }),
  close: () => set({ clipId: null }),
}));
