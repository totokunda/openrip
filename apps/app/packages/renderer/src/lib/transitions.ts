// Transitions on the timeline, as CapCut has them: a transition sits on a cut (a clip and the
// clip starting where it ends on its track) and is kept on the first clip (`transitionOut`).
// These are the helpers the Transitions panel, the marker drawn on a cut and the transition's
// inspector share: which cuts there are, giving a cut a transition, its duration and direction,
// and Apply to all. The fields come from lib/animations.ts (`transitionOf`); edits go through
// `updateClip`, so the clips in the store (which the undo history shares) are replaced, not
// written to.
import { create } from "zustand";
import { TRANSITIONS, TRANSITION_CATEGORIES, transitionOf } from "./animations";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { isRestoring } from "./history";
import { cutsOn, fitTransitions, takesTransition, transitionMax, withinTransition } from "./transition-cuts";
import type { AnimationDirection, AnyClipProps, ClipTransition, TransitionParamValue, VideoClipProps } from "./types";

export { MIN_TRANSITION, cutAtFrame, cutForSelection, cutNear, cutsOn, nextClipOf, previousClipOf, sameShotAt, takesTransition, transitionMax, withinTransition } from "./transition-cuts";

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
export const transitionCategories = (blink: string | null): string[] => {
  const have = new Set(offeredTransitions(blink).map((t) => t.category));
  return TRANSITION_CATEGORIES.filter((c) => have.has(c));
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
  // The direction carries over to another with one; a shader transition starts from its own defaults.
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

/** One of a shader transition's own parameters (a number, a flag, `[x, y]` or a colour). */
export const setTransitionParam = (clipId: string, key: string, value: TransitionParamValue) =>
  editTransition(clipId, (t) => ({ ...t, params: { ...(t.params ?? {}), [key]: value } }));

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

let fitting = false;

/**
 * Keep every transition fitted to its cut (`fitTransitions`) as the clips change: once each edit
 * is done (an edit can pass through states where its clips don't meet yet), and in the same undo
 * step as the edit. A state an undo or redo puts back was fitted when it was made.
 */
export function initTransitionFitting() {
  if (fitting) return;
  fitting = true;
  let queued = false;
  useClipStore.subscribe((s, p) => {
    if (s.clips === p.clips || queued || isRestoring()) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const { clips } = useClipStore.getState();
      const fitted = fitTransitions(clips, fpsNow());
      if (fitted !== clips) useClipStore.setState({ clips: fitted });
    });
  });
}
