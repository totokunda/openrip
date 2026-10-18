// A clip's keyframes as the timeline shows them: one diamond per keyed frame, standing for every
// property keyed there (CapCut draws one diamond for the frame however many properties have a
// key on it). Moving, deleting or easing a diamond does it to each of those keys, through
// lib/keyframes.ts. Pure: the returned keyframes are new objects, for `updateClip`.
import { create } from "zustand";
import { keyframeAt, keyframedProperties, moveKeyframe, removeKeyframe, setKeyframeEase } from "./keyframes";
import type { ClipKeyframes, KeyframeEase, KeyframePreset, KeyframeProperty } from "./types";

/** Whether the selected clip's keyframe graph is open (⌥K), and the property it shows. */
export const useKeyframeGraphStore = create<{ open: boolean; property: KeyframeProperty | null; toggle: () => void; setProperty: (p: KeyframeProperty) => void }>((set) => ({
  open: false,
  property: null,
  toggle: () => set((s) => ({ open: !s.open })),
  setProperty: (property) => set({ property }),
}));

/** The properties with a key at clip-local `frame`. */
export const propertiesAt = (keyframes: ClipKeyframes | undefined, frame: number): KeyframeProperty[] =>
  keyframedProperties(keyframes).filter((p) => !!keyframeAt(keyframes, p, frame));

/** The keys at `from` moved to `to` (replacing any there), for every property keyed at `from`. */
export const moveKeysAt = (keyframes: ClipKeyframes | undefined, from: number, to: number): ClipKeyframes | undefined => {
  if (from === to) return keyframes;
  let next = keyframes;
  for (const p of propertiesAt(keyframes, from)) next = moveKeyframe(next, p, from, to);
  return next;
};

/** Without the keys at `frame`. */
export const removeKeysAt = (keyframes: ClipKeyframes | undefined, frame: number): ClipKeyframes | undefined => {
  let next = keyframes;
  for (const p of propertiesAt(keyframes, frame)) next = removeKeyframe(next, p, frame);
  return next;
};

/** The keys at `frame` with `ease` for the span after them. */
export const easeKeysAt = (keyframes: ClipKeyframes | undefined, frame: number, ease: KeyframeEase): ClipKeyframes | undefined => {
  let next = keyframes;
  for (const p of propertiesAt(keyframes, frame)) next = setKeyframeEase(next, p, frame, ease);
  return next;
};

/**
 * The ease the keys at `frame` share, as a preset: "custom" for a curve of their own, null when
 * they differ.
 */
export const easeAt = (keyframes: ClipKeyframes | undefined, frame: number): KeyframePreset | "custom" | null => {
  const eases = propertiesAt(keyframes, frame).map((p) => {
    const e = keyframeAt(keyframes, p, frame)?.ease;
    return e === undefined ? "linear" : typeof e === "string" ? e : "custom";
  });
  return eases.length && eases.every((e) => e === eases[0]) ? eases[0] : null;
};

/** The ease presets the diamond's menu offers, in CapCut's graph's order. */
export const EASE_PRESETS: { value: KeyframePreset; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "easeIn", label: "Ease in" },
  { value: "easeOut", label: "Ease out" },
  { value: "easeInOut", label: "Ease in and out" },
  { value: "hold", label: "Hold" },
];
