// A clip's edges: how far one can move, and the clip with one moved, its trim following. The
// timeline's trims and the clip store's resizeClip both go through these. Pure.
import type { AnyClipProps, TextClipProps, VideoClipProps } from "../../types.ts";
import { shiftKeyframes } from "../../keyframes.ts";

/**
 * How far an edge of `clip` can move by `delta` frames: its length stays at least a frame, a
 * left edge stays at or after 0, and a trim doesn't reach past its media (`trimStart` ≥ 0,
 * `trimEnd` ≤ 0; text, photos and the like have no such bound).
 */
export const clampEdgeDelta = (clip: AnyClipProps, side: "left" | "right", delta: number) => {
  const start = clip.startFrame ?? 0;
  const end = Math.max(clip.endFrame ?? 0, start + 1);
  // A freeze frame holds its still as long as it's made: it has no media to run out of.
  const bounded = (trim: number | undefined) => isFinite(trim ?? 0) && !(clip as VideoClipProps).freeze;
  if (side === "right") {
    let d = Math.max(delta, start + 1 - end);
    if (bounded(clip.trimEnd)) d = Math.min(d, -(clip.trimEnd ?? 0));
    return d;
  }
  let d = Math.min(delta, end - 1 - start);
  d = Math.max(d, -start);
  if (bounded(clip.trimStart)) d = Math.max(d, -(clip.trimStart ?? 0));
  return d;
};

/** `clip` with an edge moved by `delta` frames, its trim following (`fps` keeps a caption's words on its speech). */
export const moveEdge = (clip: AnyClipProps, side: "left" | "right", delta: number, fps: number): AnyClipProps => {
  if (side === "right") {
    return { ...clip, endFrame: (clip.endFrame ?? 0) + delta, trimEnd: (clip.trimEnd || 0) + delta };
  }
  const next = {
    ...clip,
    startFrame: (clip.startFrame ?? 0) + delta,
    trimStart: (clip.trimStart || 0) + delta,
    // Keys stay on the content as the start moves (they're clip-local).
    keyframes: shiftKeyframes(clip.keyframes, -delta),
  } as AnyClipProps;
  // A caption's words keep time with the speech as its start moves.
  if (clip.type === "text" && (clip as TextClipProps).spokenWords) {
    (next as TextClipProps).spokenFrom = ((clip as TextClipProps).spokenFrom ?? 0) + delta / (fps || 30);
  }
  return next;
};
