// Pure edits behind the inspector's rows (lib/keyframe-ui.ts has the hooks that use them):
// several properties edited at once by CapCut's rule, the keyframe navigator's state (‹ ◇ ›)
// and toggle for one property or a section's several, and the clip's transform as its keys
// put it at a frame. Each returns new objects (the undo history shares clips); `node --test
// tests/*.test.ts` in packages/renderer checks them.
import {
  editProperty,
  keyframeAt,
  listKeyframes,
  localFrame,
  nextKeyframe,
  previousKeyframe,
  removeKeyframe,
  setKeyframe,
  valueAt,
} from "./keyframes.ts";
import { placeCentre } from "./transform-presets.ts";
import type { AnyClipProps, ClipTransform, KeyframeProperty, KeyframeValue } from "./types";

/**
 * Several edits at a timeline frame, each by CapCut's rule (`editProperty`: a keyed property
 * gets a key there, the others change their field), folded into one patch: each sees the clip
 * as the edits before it left it.
 */
export const editProperties = (clip: AnyClipProps, frame: number, edits: [KeyframeProperty, KeyframeValue][]): Partial<AnyClipProps> => {
  let now = clip;
  let patch: Record<string, unknown> = {};
  for (const [property, value] of edits) {
    const p = editProperty(now, property, frame, value);
    now = { ...now, ...p } as AnyClipProps;
    patch = { ...patch, ...p };
  }
  return patch as Partial<AnyClipProps>;
};

/** The state of a keyframe navigator over `properties` at a timeline frame. */
export type KeyNav = {
  /** Whether any of them has keys. */
  keyed: boolean;
  /** Whether every one of them has a key at the frame (the diamond filled). */
  at: boolean;
  /** The timeline frames of the nearest keys before and after the frame, of any of them. */
  prev?: number;
  next?: number;
};

export const keyNavOf = (clip: AnyClipProps | undefined, properties: KeyframeProperty[], frame: number): KeyNav => {
  if (!clip) return { keyed: false, at: false };
  const local = localFrame(clip, frame);
  const start = clip.startFrame ?? 0;
  let keyed = false;
  let at = properties.length > 0;
  let prev: number | undefined;
  let next: number | undefined;
  for (const p of properties) {
    if (listKeyframes(clip.keyframes, p).length) keyed = true;
    if (!keyframeAt(clip.keyframes, p, local)) at = false;
    const b = previousKeyframe(clip.keyframes, p, local);
    const a = nextKeyframe(clip.keyframes, p, local);
    if (b && (prev === undefined || start + b.frame > prev)) prev = start + b.frame;
    if (a && (next === undefined || start + a.frame < next)) next = start + a.frame;
  }
  return { keyed, at, prev, next };
};

/**
 * The diamond over `properties`: when every one has a key at the frame, they all lose it;
 * otherwise each one without a key there gets one with its value there (as CapCut's section
 * diamond keys every property of its section at once).
 */
export const toggleKeys = (clip: AnyClipProps, properties: KeyframeProperty[], frame: number, fps: number): Partial<AnyClipProps> => {
  const local = localFrame(clip, frame);
  const all = properties.every((p) => keyframeAt(clip.keyframes, p, local));
  let keyframes = clip.keyframes;
  for (const p of properties) {
    if (all) keyframes = removeKeyframe(keyframes, p, local);
    else if (!keyframeAt(keyframes, p, local)) {
      const value = valueAt(clip, p, frame, fps);
      if (value !== undefined) keyframes = setKeyframe(keyframes, p, local, value);
    }
  }
  return { keyframes };
};

/** The properties of the clip's transform that keys can drive. */
const TRANSFORM_PROPERTIES: KeyframeProperty[] = ["position", "scale", "rotation", "opacity"];

/**
 * The clip's transform as shown at a timeline frame: the field's, with the scale, turn,
 * centre and opacity its keys give there. The same transform when nothing of it is keyed.
 */
export const transformAt = (clip: AnyClipProps, frame: number, fps: number): ClipTransform | undefined => {
  const t = clip.transform;
  if (!t || !TRANSFORM_PROPERTIES.some((p) => listKeyframes(clip.keyframes, p).length)) return t;
  const scale = valueAt(clip, "scale", frame, fps) as number[];
  const rotation = Number(valueAt(clip, "rotation", frame, fps));
  const centre = valueAt(clip, "position", frame, fps) as number[];
  const opacity = Number(valueAt(clip, "opacity", frame, fps));
  const turned = { ...t, scaleX: scale[0], scaleY: scale[1] ?? scale[0], rotation, opacity };
  return placeCentre(turned, [centre[0], centre[1]]);
};
