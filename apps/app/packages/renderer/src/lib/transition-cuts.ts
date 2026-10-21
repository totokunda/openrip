// The cuts a transition can sit on, worked out from the clips alone (no stores, so the tests
// can load it): a cut is a video or photo and the clip starting where it ends on its track,
// the transition kept on the first clip (`transitionOut`). lib/transitions.ts makes the edits.
import { clipSeconds, maxTransitionDuration } from "./animations.ts";
import { sourceTimeAt } from "./speed.ts";
import { mainTrackOf } from "./timeline-edit.ts";
import type { AnyClipProps, ImageClipProps, TimelineProps, VideoClipProps } from "./types";

/** The clips a transition can leave: videos and photos. */
export const takesTransition = (clip: AnyClipProps | undefined): clip is VideoClipProps | ImageClipProps =>
  !!clip && (clip.type === "video" || clip.type === "image");

/** The clip starting where `clip` ends on its track (the other side of its cut), if any. */
export const nextClipOf = (clips: AnyClipProps[], clip: AnyClipProps | undefined): AnyClipProps | undefined =>
  clip ? clips.find((c) => c.clipId !== clip.clipId && c.timelineId === clip.timelineId && c.startFrame === clip.endFrame && !c.hidden) : undefined;

/** The clip ending where `clip` starts on its track, if any. */
export const previousClipOf = (clips: AnyClipProps[], clip: AnyClipProps | undefined): AnyClipProps | undefined =>
  clip ? clips.find((c) => c.clipId !== clip.clipId && c.timelineId === clip.timelineId && c.endFrame === clip.startFrame && !c.hidden) : undefined;

/** A track's cuts a transition can go on: each video or photo with a clip starting at its end. */
export const cutsOn = (clips: AnyClipProps[], timelineId: string): { clip: VideoClipProps | ImageClipProps; next: AnyClipProps }[] => {
  const out: { clip: VideoClipProps | ImageClipProps; next: AnyClipProps }[] = [];
  for (const clip of clips) {
    if (clip.timelineId !== timelineId || clip.hidden || !takesTransition(clip)) continue;
    const next = nextClipOf(clips, clip);
    if (next) out.push({ clip, next });
  }
  return out.sort((a, b) => a.clip.endFrame - b.clip.endFrame);
};

/** The shortest a transition can be (s), and the step its duration moves by. */
export const MIN_TRANSITION = 0.1;

/** The longest the transition leaving `clip` can run (s): the shorter clip at its cut. */
export const transitionMax = (clips: AnyClipProps[], clip: AnyClipProps, fps: number): number =>
  Math.max(MIN_TRANSITION, maxTransitionDuration(clip, nextClipOf(clips, clip), fps) || clipSeconds(clip, fps));

/** A duration within a transition's bounds, to hundredths of a second. */
export const withinTransition = (d: number, max: number) => Math.round(Math.max(MIN_TRANSITION, Math.min(d, max)) * 100) / 100;

/**
 * Which cut the Transitions panel's "+" gives a transition to for the selected clip: its own
 * end when a clip starts there, else the cut before it. The id of the clip leaving that cut, or
 * null when the clip has neither.
 */
export const cutForSelection = (clips: AnyClipProps[], clipId: string | undefined): string | null => {
  const clip = clips.find((c) => c.clipId === clipId);
  if (!clip) return null;
  if (takesTransition(clip) && nextClipOf(clips, clip)) return clip.clipId;
  const before = previousClipOf(clips, clip);
  return before && takesTransition(before) ? before.clipId : null;
};

/**
 * With nothing selected, the cut "+" gives a transition to, as CapCut's: that of the main
 * track's clip under the playhead (`cutForSelection`).
 */
export const cutAtFrame = (clips: AnyClipProps[], timelines: TimelineProps[], frame: number): string | null => {
  const main = mainTrackOf(timelines)?.timelineId;
  const clip = clips.find((c) => c.timelineId === main && !c.hidden && c.startFrame <= frame && frame < c.endFrame);
  return clip ? cutForSelection(clips, clip.clipId) : null;
};

/**
 * The cut a transition let go at `frame` on a track lands on (the id of the clip leaving it):
 * over a clip, the nearer of its ends that is a cut, else its other one; between clips, the
 * nearest cut within `slack` frames. Null where there's none.
 */
export const cutNear = (clips: AnyClipProps[], timelineId: string, frame: number, slack: number): string | null => {
  const cuts = cutsOn(clips, timelineId);
  const over = clips.find((c) => c.timelineId === timelineId && !c.hidden && c.startFrame <= frame && frame < c.endFrame);
  if (over) {
    const end = cuts.find((c) => c.clip.clipId === over.clipId)?.clip.clipId ?? null;
    const start = cuts.find((c) => c.next.clipId === over.clipId)?.clip.clipId ?? null;
    return frame - over.startFrame < over.endFrame - frame ? (start ?? end) : (end ?? start);
  }
  let best: string | null = null;
  let gap = slack;
  for (const { clip } of cuts) {
    const d = Math.abs(clip.endFrame - frame);
    if (d <= gap) [best, gap] = [clip.clipId, d];
  }
  return best;
};

/**
 * `clips` with every transition fitted to its cut, as CapCut keeps them: one whose cut is gone
 * (the clip after it removed or moved away) comes off, and one longer than its cut allows (a
 * clip either side trimmed shorter) is cut down to fit. The same array when nothing changes.
 */
export const fitTransitions = (clips: AnyClipProps[], fps: number): AnyClipProps[] => {
  let out: AnyClipProps[] | null = null;
  clips.forEach((clip, i) => {
    const t = takesTransition(clip) ? clip.transitionOut : null;
    if (!t) return;
    let fitted: typeof t | null = t;
    if (!nextClipOf(clips, clip)) fitted = null;
    else {
      // Down to the hundredth at or under the most it can be (no less than the least).
      const most = Math.max(MIN_TRANSITION, Math.floor(transitionMax(clips, clip, fps) * 100 + 1e-6) / 100);
      if (t.duration > most) fitted = { ...t, duration: most };
    }
    if (fitted !== t) (out ??= clips.slice())[i] = { ...clip, transitionOut: fitted } as AnyClipProps;
  });
  return out ?? clips;
};

/**
 * Whether the two sides of `clip`'s cut are one shot carrying on (a split left in place): the
 * same photo, or the same video playing on from the frame the first one ends on. A transition
 * that blends one picture into the other draws the same picture twice there, and shows nothing.
 */
export const sameShotAt = (clips: AnyClipProps[], clip: AnyClipProps, fps: number): boolean => {
  const next = nextClipOf(clips, clip);
  if (!takesTransition(clip) || !takesTransition(next) || !clip.assetId || clip.assetId !== next.assetId || clip.type !== next.type) return false;
  if (clip.type === "image") return true;
  const [a, b] = [clip as VideoClipProps, next as VideoClipProps];
  if (a.reverse || b.reverse || a.freeze || b.freeze) return false;
  return Math.abs(sourceTimeAt(a, a.endFrame - a.startFrame, fps) - sourceTimeAt(b, 0, fps)) < 1 / fps;
};
