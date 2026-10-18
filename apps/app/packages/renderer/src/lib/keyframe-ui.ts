// The inspector's side of keyframes (lib/keyframes.ts has the model, lib/inspector-edits.ts
// the pure edits): a property's value at the playhead and its edit by CapCut's rule, and the
// keyframe navigator's toggle, from the stores. One press of a diamond or one drag of a
// slider is one undo step (lib/history.ts).
import { useCallback, useMemo } from "react";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { editProperty, hasKeyframes, valueAt } from "./keyframes";
import { editProperties, keyNavOf, toggleKeys, transformAt } from "./inspector-edits";
import { centreOf } from "./transform-presets";
import type { AnyClipProps, ClipTransform, KeyframeProperty, KeyframeValue } from "./types";

export { editProperties, keyNavOf, toggleKeys, transformAt } from "./inspector-edits";
export type { KeyNav } from "./inspector-edits";

/** The playhead and the project's rate. */
export const usePlayhead = () => {
  const frame = useControlsStore((s) => s.focusFrame);
  const fps = useControlsStore((s) => s.fps);
  return { frame, fps };
};

/**
 * The playhead, but only while one of `properties` is keyed (their value and navigator don't
 * depend on it otherwise), so unkeyed rows don't redraw on every frame of playback.
 */
export const usePlayheadIfKeyed = (clip: AnyClipProps | undefined, properties: KeyframeProperty[]) => {
  const keyed = !!clip && properties.some((p) => hasKeyframes(clip.keyframes, p));
  const frame = useControlsStore((s) => (keyed ? s.focusFrame : 0));
  const fps = useControlsStore((s) => s.fps);
  return { frame, fps };
};

/** Move the playhead to a key (pausing playback). */
export const seekTo = (frame: number) => useControlsStore.getState().setFocusFrame(Math.round(frame), true);

/**
 * One keyframeable property of a clip, for a row: its value at the playhead (its keys', else
 * its field's), `set` to edit it there by CapCut's rule, and the navigator's state and toggle.
 */
export const useKeyedProperty = (clipId: string, property: KeyframeProperty) => {
  const clip = useClipStore((s) => s.getClipById(clipId));
  const { frame, fps } = usePlayheadIfKeyed(clip, [property]);
  const value = clip ? valueAt(clip, property, frame, fps) : undefined;
  const set = useCallback(
    (v: KeyframeValue) => {
      const { getClipById, updateClip } = useClipStore.getState();
      const now = getClipById(clipId);
      if (!now) return;
      const controls = useControlsStore.getState();
      if (controls.isPlaying) controls.pause();
      updateClip(clipId, editProperty(now, property, controls.focusFrame, v));
    },
    [clipId, property],
  );
  return { clip, value, set, nav: keyNavOf(clip, [property], frame) };
};

/** Toggle the keys of `properties` at the playhead on a clip in the store. */
export const toggleKeysInStore = (clipId: string, properties: KeyframeProperty[]) => {
  const { getClipById, updateClip } = useClipStore.getState();
  const clip = getClipById(clipId);
  if (!clip) return;
  const { focusFrame, fps, isPlaying, pause } = useControlsStore.getState();
  if (isPlaying) pause();
  updateClip(clipId, toggleKeys(clip, properties, focusFrame, fps));
};

// ---- the canvas handles -------------------------------------------------------------------

const MOVES: KeyframeProperty[] = ["position", "scale", "rotation", "opacity"];
const keyedMoves = (clip: AnyClipProps | undefined) => !!clip && MOVES.some((p) => hasKeyframes(clip.keyframes, p));

/**
 * The transform a clip's handles on the canvas show: its keys' at the playhead while its
 * place, size, turn or opacity is keyed (so the handles sit on the engine's picture), else
 * `fallback` (the field). Only a keyed clip follows the playhead, so the others don't redraw
 * on every frame of playback.
 */
export const useShownTransform = (clipId: string, fallback: ClipTransform | undefined): ClipTransform | undefined => {
  const clip = useClipStore((s) => s.getClipById(clipId));
  const keyed = keyedMoves(clip);
  const frame = useControlsStore((s) => (keyed ? s.focusFrame : -1));
  const fps = useControlsStore((s) => s.fps);
  return useMemo(() => (keyed && clip ? transformAt(clip, frame, fps) : fallback), [keyed, clip, frame, fps, fallback]);
};

/**
 * A change from a clip's handles on the canvas (a drag, a resize or a turn of what
 * useShownTransform shows), by CapCut's rule: while the place, size or turn is keyed, the
 * change sets keys at the playhead for what's keyed and changes the field for the rest
 * (`editProperties`); otherwise it's the store's `setClipTransform`, as before.
 */
export const setShownTransform = (clipId: string, partial: Partial<ClipTransform>, applyToMasks?: boolean, remapMasks?: boolean) => {
  const { getClipById, setClipTransform, updateClip } = useClipStore.getState();
  const clip = getClipById(clipId);
  if (!clip?.transform || !(["position", "scale", "rotation"] as KeyframeProperty[]).some((p) => hasKeyframes(clip.keyframes, p))) {
    setClipTransform(clipId, partial, applyToMasks, remapMasks);
    return;
  }
  const { focusFrame, fps } = useControlsStore.getState();
  const shown = transformAt(clip, focusFrame, fps)!;
  const next = { ...shown, ...partial };
  // The shown box over the field's box is the scale (a resize changes the box).
  const box = clip.transform;
  const scale: [number, number] = [(next.width * next.scaleX) / (box.width || 1), (next.height * next.scaleY) / (box.height || 1)];
  const edits: [KeyframeProperty, KeyframeValue][] = [];
  if (["width", "height", "scaleX", "scaleY"].some((k) => k in partial)) edits.push(["scale", scale]);
  if ("rotation" in partial) edits.push(["rotation", next.rotation]);
  edits.push(["position", centreOf({ ...next, width: box.width, height: box.height, scaleX: scale[0], scaleY: scale[1] })]);
  updateClip(clipId, editProperties(clip, focusFrame, edits));
};
