// The small marks on a clip of the new timeline, as the timeline before it drew them
// (components/timeline/clips/BeatMarkers.tsx, MotionMarks.tsx): where the beat dots go and how
// many are drawn, and the lines and the speed badge a clip's animations and speed give it. Pure.
import type { AnyClipProps, ClipAnimation, VideoClipProps } from "../types.ts";
import { hasCurve } from "../speed.ts";

/** Beat dots closer than this (px) are thinned out, as the ruler drops ticks. */
const BEAT_MIN_GAP = 6;

/** Which beats to draw of `count` over `width` px: every one, or every n-th when they're too dense to tell apart. */
export const beatStep = (width: number, count: number): number => (count <= 0 ? 1 : Math.max(1, Math.ceil(BEAT_MIN_GAP / Math.max(0.001, width / count))));

/** The beats (frames on the timeline) that fall in px `fromPx`..`toPx` of a clip `pxPerFrame` wide a frame, each as px from its left, thinned by `beatStep` of all of them. */
export const beatDots = (frames: number[], clipStart: number, clipLength: number, pxPerFrame: number, fromPx: number, toPx: number): number[] => {
  const step = beatStep(clipLength * pxPerFrame, frames.length);
  const out: number[] = [];
  for (let i = 0; i < frames.length; i += step) {
    const x = (frames[i] - clipStart) * pxPerFrame;
    if (x >= fromPx - 4 && x <= toPx + 4) out.push(x);
  }
  return out;
};

/** The badge's width (px) and the clip width it needs: it's left off a clip narrower than 106 px. */
export const BADGE_W = 46;
export const BADGE_MIN_CLIP = BADGE_W + 60;

export interface MotionMarks {
  /** A line along the clip's foot with an arrowhead: from `x0` to `x1` (px from the clip's left), at `y`. */
  arrows: { x0: number; x1: number }[];
  /** A dashed line across (a Combo or a Loop animation). */
  dashed: boolean;
  /** Where the speed badge goes and what it says ("1.00x ▸", "Curve ▸"). */
  badge: { x: number; y: number; w: number; h: number; label: string } | null;
  /** The marks' baseline: 3 px up from the clip's bottom. */
  y: number;
}

/**
 * What a clip's bar says about its motion: a thin white line with an arrowhead as long as its In
 * animation (from the start) or its Out (to the end), a dashed one across for a Combo or Loop; and,
 * on a selected video or sound wider than 106 px, its speed at the top right.
 */
export const motionMarks = (clip: AnyClipProps, width: number, height: number, fps: number, selected: boolean): MotionMarks => {
  const c = clip as VideoClipProps & { animationLoop?: ClipAnimation | null };
  const len = Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));
  const px = (seconds: number) => Math.min(width - 4, Math.max(6, (seconds * fps * width) / len));
  const arrows: MotionMarks["arrows"] = [];
  if (c.animationIn) arrows.push({ x0: 2, x1: 2 + px(c.animationIn.duration) });
  if (c.animationOut) arrows.push({ x0: width - 2, x1: width - 2 - px(c.animationOut.duration) });
  // (A compound clip plays at speed 1 and has no Speed tab.)
  const timed = (clip.type === "video" || clip.type === "audio") && !c.freeze && !(c as VideoClipProps).compound;
  const label = hasCurve(clip) ? "Curve ▸" : `${Number(c.speed || 1).toFixed(2)}x ▸`;
  return {
    arrows,
    dashed: !!(c.animationCombo || c.animationLoop),
    badge: selected && timed && width > BADGE_MIN_CLIP ? { x: width - BADGE_W - 4, y: 3, w: BADGE_W, h: 14, label } : null,
    y: height - 3,
  };
};
