// Transitions on the timeline, as CapCut has them: a transition sits on a cut (a clip and the
// clip starting where it ends on its track) and is kept on the first clip (`transitionOut`).
// These are the helpers the Transitions panel, the marker drawn on a cut and the transition's
// inspector share: which cuts there are, giving a cut a transition, its duration and direction,
// and Apply to all. The fields come from lib/animations.ts (`transitionOf`); edits go through
// `updateClip`, so the clips in the store (which the undo history shares) are replaced, not
// written to.
import { create } from "zustand";
import { TRANSITIONS, clipSeconds, maxTransitionDuration, transitionOf } from "./animations";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import type { AnimationDirection, AnyClipProps, ClipTransition, ImageClipProps, VideoClipProps } from "./types";

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
 * Blink draws CapCut's downloaded image sequence: offered when the project has one, on a clip
 * or among a draft clip's materials (where it stays when the app replaces it).
 */
export const projectBlink = (clips: AnyClipProps[]): string | null => {
  for (const c of clips) {
    const t = (c as VideoClipProps).transitionOut;
    if (t?.type === "blink" && t.resource) return t.resource;
    const m = ((c as any).engine?.materials ?? []).find((m: any) => m?.type === "transition" && m.builtin === "blink" && m.resource);
    if (m) return m.resource as string;
  }
  return null;
};

/** The transitions the panel offers: every one the engine draws, Blink with its images on hand. */
export const offeredTransitions = (blink: string | null) => TRANSITIONS.filter((t) => !t.needsResource || !!blink);

/** The panel's categories, in its order, for what's offered. */
export const transitionCategories = (blink: string | null): string[] => [...new Set(offeredTransitions(blink).map((t) => t.category))];

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

const fpsNow = () => useControlsStore.getState().fps || 30;

/**
 * Give the cut after `clipId` the transition `type` and select it (its inspector shows). It
 * keeps the duration and direction the cut had where the new one takes them, within its bounds.
 */
export const applyTransition = (clipId: string, type: string) => {
  const { clips, getClipById, updateClip } = useClipStore.getState();
  const clip = getClipById(clipId);
  if (!takesTransition(clip)) return;
  const max = transitionMax(clips, clip, fpsNow());
  const was = clip.transitionOut ?? null;
  const builtin = TRANSITIONS.find((t) => t.type === type);
  if (!builtin) return;
  const direction = builtin.params?.length && was?.params?.direction ? { direction: was.params.direction } : undefined;
  const next = transitionOf(type, {
    duration: withinTransition(was?.duration ?? builtin.defaultDuration, max),
    params: direction,
    resource: type === "blink" ? (was?.type === "blink" ? was.resource : projectBlink(clips)) : null,
  });
  if (!next) return;
  updateClip(clipId, { transitionOut: next } as Partial<AnyClipProps>);
  useControlsStore.getState().setSelectedTransitionId(clipId);
};

/** Take the transition off the cut after `clipId`. */
export const removeTransition = (clipId: string) => {
  const { getClipById, updateClip } = useClipStore.getState();
  if (!takesTransition(getClipById(clipId))) return;
  updateClip(clipId, { transitionOut: null } as Partial<AnyClipProps>);
  if (useControlsStore.getState().selectedTransitionId === clipId) useControlsStore.getState().setSelectedTransitionId(null);
};

/** The transition's patch with `change` applied (duration within its bounds). */
const editTransition = (clipId: string, change: (t: ClipTransition, max: number) => ClipTransition) => {
  const { clips, getClipById, updateClip } = useClipStore.getState();
  const clip = getClipById(clipId);
  if (!takesTransition(clip) || !clip.transitionOut) return;
  updateClip(clipId, { transitionOut: change(clip.transitionOut, transitionMax(clips, clip, fpsNow())) } as Partial<AnyClipProps>);
};

export const setTransitionDuration = (clipId: string, seconds: number) =>
  editTransition(clipId, (t, max) => ({ ...t, duration: withinTransition(seconds, max) }));

export const setTransitionDirection = (clipId: string, direction: AnimationDirection) =>
  editTransition(clipId, (t) => ({ ...t, params: { ...(t.params ?? {}), direction } }));

/** Back to its default duration and direction (the section's reset). */
export const resetTransition = (clipId: string) =>
  editTransition(clipId, (t, max) => {
    const fresh = transitionOf(t.type, { resource: t.resource ?? null });
    return fresh ? { ...fresh, duration: withinTransition(fresh.duration, max) } : t;
  });

/**
 * CapCut's Apply to all: the same transition, at the same duration (within each cut's bounds)
 * and direction, on every cut of its track. One undo step (one user action).
 */
export const applyTransitionToAll = (clipId: string) => {
  const { clips, getClipById, updateClip } = useClipStore.getState();
  const clip = getClipById(clipId);
  const t = takesTransition(clip) ? clip.transitionOut : null;
  if (!clip || !t) return;
  const fps = fpsNow();
  for (const { clip: c } of cutsOn(clips, clip.timelineId!)) {
    if (c.clipId === clipId) continue;
    updateClip(c.clipId, { transitionOut: { ...t, duration: withinTransition(t.duration, transitionMax(clips, c, fps)) } } as Partial<AnyClipProps>);
  }
};

/**
 * The cut a transition card is being dragged over (the id of the clip leaving it), for the
 * timeline to mark; null when it's over none.
 */
export const useTransitionDropStore = create<{ target: string | null; setTarget: (id: string | null) => void }>((set) => ({
  target: null,
  setTarget: (target) => set((s) => (s.target === target ? s : { target })),
}));
