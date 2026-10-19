// Clip keyframes: pure helpers over a clip's `keyframes` (lib/types.ts), for the inspector's
// keyframe navigators, the timeline's diamonds and graph, and the clip operations. Nothing here
// writes to a store or to an object it's given: every edit returns new objects, so the undo
// history (which shares clips between states) stays intact.
//
// Keys sit at clip-local frames (0 is the clip's start on the timeline), as CapCut's sit per
// clip. Sampling matches the engine (engine/crates/model/src/animated.rs): CapCut's curve, a
// cubic bezier through the keys' (time, value) points with handles in absolute units, its
// parameter found by CapCut's own solver, in single precision; times in µs as the engine
// converts them; colours in 0–1 channels and volume as gain, as the engine draws them. See
// docs/parity/keyframes.md and docs/plan/app-engine-integration.md ("Keyframes").
import type {
  AnyClipProps,
  ClipEffect,
  ClipKeyframes,
  ClipTransform,
  DraftAdjustment,
  Keyframe,
  KeyframeCurve,
  KeyframeEase,
  KeyframeProperty,
  KeyframeValue,
} from "./types";
import { COLOR_PROPERTIES, colorPropertyPatch, colorPropertyValue } from "./color.ts";
import { CHROMA_PROPERTIES, setChroma } from "./compositing.ts";

/** Keys closer than this (in frames) are at the same frame. */
const SAME_FRAME = 1e-6;

/** The text properties whose values are colours (#rrggbb). */
const COLOUR_PROPERTIES = new Set<string>(["color", "stroke", "shadowColor", "backgroundColor", "glowColor"]);

/** The app's Adjust sliders that can be keyframed (fields on video and image clips). */
export const ADJUST_PROPERTIES = ["brightness", "contrast", "hue", "saturation", "sharpness", "noise", "blur", "vignette"] as const;

/** The text style properties that can be keyframed (fields on text clips). */
export const TEXT_PROPERTIES = [
  "color",
  "fontSize",
  "stroke",
  "strokeWidth",
  "strokeOpacity",
  "shadowColor",
  "shadowOpacity",
  "shadowBlur",
  "backgroundColor",
  "backgroundOpacity",
  "glowColor",
  "glowIntensity",
  "glowRange",
] as const;

/** Which properties a clip of this type can keyframe (besides its `draft:` adjustments). */
export const keyframeableProperties = (clip: AnyClipProps): KeyframeProperty[] => {
  switch (clip.type) {
    case "video":
      return ["position", "scale", "rotation", "opacity", "volume", ...ADJUST_PROPERTIES, ...COLOR_PROPERTIES, ...CHROMA_PROPERTIES];
    case "image":
      return ["position", "scale", "rotation", "opacity", ...ADJUST_PROPERTIES, ...COLOR_PROPERTIES, ...CHROMA_PROPERTIES];
    case "audio":
      return ["volume"];
    case "text":
      return ["position", "scale", "rotation", "opacity", ...TEXT_PROPERTIES];
    case "shape":
    case "sticker":
      return ["position", "scale", "rotation", "opacity"];
    case "filter":
      // An adjustment layer keys the Adjust tab's tools, as a video does.
      return (clip as any).adjustment ? [...COLOR_PROPERTIES] : ["intensity"];
    default:
      return [];
  }
};

// ---- reading -------------------------------------------------------------------------------

/** A property's keys, sorted by frame. */
export const listKeyframes = (keyframes: ClipKeyframes | undefined, property: KeyframeProperty): Keyframe[] =>
  keyframes?.[property] ?? [];

export const hasKeyframes = (keyframes: ClipKeyframes | undefined, property: KeyframeProperty): boolean =>
  listKeyframes(keyframes, property).length > 0;

/** The properties that have keys. */
export const keyframedProperties = (keyframes: ClipKeyframes | undefined): KeyframeProperty[] =>
  (Object.keys(keyframes ?? {}) as KeyframeProperty[]).filter((p) => hasKeyframes(keyframes, p));

/** The key at `frame`, if there's one. */
export const keyframeAt = (keyframes: ClipKeyframes | undefined, property: KeyframeProperty, frame: number): Keyframe | undefined =>
  listKeyframes(keyframes, property).find((k) => Math.abs(k.frame - frame) < SAME_FRAME);

/** The last key before `frame` and the first after it (the navigator's ‹ and ›). */
export const previousKeyframe = (keyframes: ClipKeyframes | undefined, property: KeyframeProperty, frame: number): Keyframe | undefined =>
  [...listKeyframes(keyframes, property)].reverse().find((k) => k.frame < frame - SAME_FRAME);
export const nextKeyframe = (keyframes: ClipKeyframes | undefined, property: KeyframeProperty, frame: number): Keyframe | undefined =>
  listKeyframes(keyframes, property).find((k) => k.frame > frame + SAME_FRAME);

/** Every keyed frame of the clip, once each (the timeline's diamonds). */
export const keyframeFrames = (keyframes: ClipKeyframes | undefined): number[] => {
  const frames: number[] = [];
  for (const p of keyframedProperties(keyframes)) {
    for (const k of listKeyframes(keyframes, p)) {
      if (!frames.some((f) => Math.abs(f - k.frame) < SAME_FRAME)) frames.push(k.frame);
    }
  }
  return frames.sort((a, b) => a - b);
};

// ---- editing --------------------------------------------------------------------------------

const withKeys = (keyframes: ClipKeyframes | undefined, property: KeyframeProperty, keys: Keyframe[]): ClipKeyframes => {
  const next: ClipKeyframes = { ...(keyframes ?? {}) };
  if (keys.length > 0) next[property] = keys;
  else delete next[property];
  return next;
};

/**
 * A key at `frame` with `value`: added, or the one there replaced (keeping its easing unless
 * `ease` is given).
 */
export const setKeyframe = (
  keyframes: ClipKeyframes | undefined,
  property: KeyframeProperty,
  frame: number,
  value: KeyframeValue,
  ease?: KeyframeEase,
): ClipKeyframes => {
  const keys = listKeyframes(keyframes, property);
  const at = keys.findIndex((k) => Math.abs(k.frame - frame) < SAME_FRAME);
  const key: Keyframe = { frame, value: Array.isArray(value) ? [...value] : value };
  const kept = ease ?? (at >= 0 ? keys[at].ease : undefined);
  if (kept !== undefined) key.ease = kept;
  const next = at >= 0 ? keys.map((k, i) => (i === at ? key : k)) : [...keys, key].sort((a, b) => a.frame - b.frame);
  return withKeys(keyframes, property, next);
};

/** Without the key at `frame` (the property loses its list when it was the last). */
export const removeKeyframe = (keyframes: ClipKeyframes | undefined, property: KeyframeProperty, frame: number): ClipKeyframes =>
  withKeys(keyframes, property, listKeyframes(keyframes, property).filter((k) => Math.abs(k.frame - frame) >= SAME_FRAME));

/** The key at `frame` with a new easing for the span after it. */
export const setKeyframeEase = (keyframes: ClipKeyframes | undefined, property: KeyframeProperty, frame: number, ease: KeyframeEase): ClipKeyframes =>
  withKeys(
    keyframes,
    property,
    listKeyframes(keyframes, property).map((k) => (Math.abs(k.frame - frame) < SAME_FRAME ? { ...k, ease } : k)),
  );

/** The key at `from` moved to `to` (replacing one already there). */
export const moveKeyframe = (keyframes: ClipKeyframes | undefined, property: KeyframeProperty, from: number, to: number): ClipKeyframes => {
  const key = keyframeAt(keyframes, property, from);
  if (!key) return { ...(keyframes ?? {}) };
  return setKeyframe(removeKeyframe(keyframes, property, from), property, to, key.value, key.ease);
};

/** Without any keys for `property` (its field's value applies again). */
export const clearKeyframes = (keyframes: ClipKeyframes | undefined, property: KeyframeProperty): ClipKeyframes =>
  withKeys(keyframes, property, []);

// ---- values, in the space they travel in -----------------------------------------------------

const hexToRgb = (hex: string): number[] => {
  const h = hex.trim().replace(/^#/, "");
  const byte = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return h.length >= 6 ? [byte(0), byte(2), byte(4)] : [0, 0, 0];
};

const rgbToHex = (c: number[]): string =>
  "#" + c.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");

/** A value's components as the engine moves them: colour channels 0–1, volume as gain. */
const toSpace = (property: KeyframeProperty, v: KeyframeValue): number[] => {
  if (typeof v === "string") return hexToRgb(v);
  const c = Array.isArray(v) ? v : [v];
  return property === "volume" ? c.map((db) => Math.pow(10, db / 20)) : [...c];
};

const fromSpace = (property: KeyframeProperty, c: number[], like: KeyframeValue): KeyframeValue => {
  if (COLOUR_PROPERTIES.has(property) || typeof like === "string") return rgbToHex(c);
  const v = property === "volume" ? c.map((g) => 20 * Math.log10(Math.max(g, 1e-4))) : c;
  return Array.isArray(like) ? v : v[0];
};

/** Per-component numbers from a handle's `frames` or `value`. */
const perComponent = (v: number | number[] | undefined, n: number): number[] =>
  Array.from({ length: n }, (_, i) => (Array.isArray(v) ? (v[i] ?? 0) : (v ?? 0)));

// ---- CapCut's curve ------------------------------------------------------------------------

const f32 = Math.fround;
/** a·b + c rounded once, as a fused multiply-add (a·b of two f32 is exact in f64). */
const fma = (a: number, b: number, c: number) => f32(a * b + c);

/**
 * The bezier parameter at which CapCut's normalised time `c[0]·s³ + c[1]·s² + c[2]·s`
 * reaches `u`: Newton from s = u for up to 8 steps (kept in [0, 1]) within 0.001, else
 * bisection (engine: `capcut_solve`).
 */
export const capcutSolve = (c: [number, number, number], u: number): number => {
  const EPS = f32(1e-6);
  const TOLERANCE = f32(1e-3);
  const [c3, c2, c1] = c.map(f32);
  const x = (s: number) => f32(s * f32(c1 + f32(s * f32(c2 + f32(s * c3)))));
  const dx = (s: number) => f32(c1 + f32(s * f32(f32(f32(c3 * 3) * s) + f32(c2 + c2))));
  if (u < 0 || Math.abs(u) < EPS) return 0;
  if (u > 1 || Math.abs(f32(u - 1)) < EPS) return 1;
  let s = u;
  for (let i = 0; i < 8; i++) {
    const at = x(s);
    if (Math.abs(f32(at - u)) < TOLERANCE) return s;
    const d = dx(s);
    if (Math.abs(d) < EPS) break;
    s = Math.max(Math.min(f32(s - f32(f32(at - u) / d)), 1), 0);
  }
  let lo = 0;
  let hi = 1;
  while (lo < hi && Math.abs(f32(hi - lo)) > EPS) {
    const mid = f32(lo + f32(f32(hi - lo) * 0.5));
    const at = x(mid);
    if (at < u) lo = mid;
    else hi = mid;
    if (Math.abs(f32(at - u)) < TOLERANCE) return mid;
  }
  return Math.min(s, 1);
};

/**
 * CapCut's keyframe curve through `p` (the keys' (time, value) points and the control points
 * between them) at progress `u`, in single precision and CapCut's order of operations
 * (engine: `capcut_curve`).
 */
export const capcutCurve = (p: [number, number][], u: number): number => {
  const [p0, p1, p2, p3] = p.map(([t, v]) => [f32(t), f32(v)]);
  const span = f32(p3[0] - p0[0]);
  const a = f32(f32(p1[0] - p0[0]) / span);
  const b = f32(f32(p2[0] - p0[0]) / span);
  const b3 = f32(b * 3);
  const c1 = f32(a * 3);
  const c3 = f32(c1 + f32(1 - b3));
  const c2 = f32(b3 + f32(a * -6));
  const s = capcutSolve([c3, c2, c1], f32(u));
  const r = f32(1 - s);
  let y = fma(f32(r * f32(r * p0[1])), r, f32(r * f32(r * f32(s * f32(p1[1] * 3)))));
  y = fma(f32(s * f32(s * f32(p2[1] * 3))), r, y);
  return fma(f32(s * f32(s * p3[1])), s, y);
};

/** The handles a span's easing gives, in µs and the travel space, per component. */
type Handles = { out: [number[], number[]]; into: [number[], number[]]; straight: boolean[] };

const spanHandles = (
  ease: KeyframeEase | undefined,
  property: KeyframeProperty,
  a: Keyframe,
  b: Keyframe,
  span: number,
  fps: number,
): Handles | null => {
  const va = toSpace(property, a.value);
  const n = va.length;
  const flat = (t: number): [number[], number[]] => [Array(n).fill(t), Array(n).fill(0)];
  const none = Array(n).fill(false);
  switch (ease) {
    case "easeIn":
      return { out: flat(0.4 * span), into: flat(0), straight: none };
    case "easeOut":
      return { out: flat(0), into: flat(-0.4 * span), straight: none };
    case "easeInOut":
      return { out: flat(0.4 * span), into: flat(-0.4 * span), straight: none };
    case undefined:
    case "linear":
    case "hold":
      return null;
  }
  const curve = ease as KeyframeCurve;
  const vb = toSpace(property, b.value);
  // A handle's point converted like a value, as an offset from its key.
  const point = (key: Keyframe, keyed: number[], dv: number[]): number[] => {
    if (typeof key.value === "string") return dv;
    const base = Array.isArray(key.value) ? key.value : [key.value];
    const moved = toSpace(property, base.map((x, i) => x + (dv[i] ?? 0)));
    return moved.map((m, i) => m - keyed[i]);
  };
  const us = (frames: number) => (frames / fps) * 1e6;
  return {
    out: [perComponent(curve.out?.frames, n).map(us), point(a, va, perComponent(curve.out?.value, n))],
    into: [perComponent(curve.in?.frames, n).map(us), point(b, vb, perComponent(curve.in?.value, n))],
    straight: Array.from({ length: n }, (_, i) => curve.straight?.[i] === true),
  };
};

/** A clip-local frame as the engine's µs. */
const micros = (frame: number, fps: number) => Math.round((frame / fps) * 1e6);

/**
 * The value `keys` (one property's, sorted) give at clip-local `frame`: the first key's before
 * the first, the last's after the last, and between two keys what the first one's easing
 * makes of the span, as the engine computes it. `undefined` without keys.
 */
export const sampleKeyframes = (keys: Keyframe[], frame: number, property: KeyframeProperty, fps: number): KeyframeValue | undefined => {
  if (keys.length === 0) return undefined;
  const t = micros(frame, fps);
  const first = keys[0];
  if (keys.length === 1 || t <= micros(first.frame, fps)) return first.value;
  const last = keys[keys.length - 1];
  if (t >= micros(last.frame, fps)) return last.value;
  const i = keys.findIndex((k) => micros(k.frame, fps) > t);
  const [a, b] = [keys[i - 1], keys[i]];
  const [ta, tb] = [micros(a.frame, fps), micros(b.frame, fps)];
  if (a.ease === "hold") return a.value;
  const u = tb > ta ? (t - ta) / (tb - ta) : 1;
  const [va, vb] = [toSpace(property, a.value), toSpace(property, b.value)];
  const h = spanHandles(a.ease, property, a, b, tb - ta, fps);
  const v = va.map((x, c) => {
    if (!h || h.straight[c]) return x + ((vb[c] ?? x) - x) * u;
    return capcutCurve(
      [
        [ta, x],
        [ta + h.out[0][c], x + h.out[1][c]],
        [tb + h.into[0][c], vb[c] + h.into[1][c]],
        [tb, vb[c]],
      ],
      u,
    );
  });
  return fromSpace(property, v, a.value);
};

// ---- clip operations ------------------------------------------------------------------------

const mapKeys = (keyframes: ClipKeyframes | undefined, f: (k: Keyframe) => Keyframe): ClipKeyframes | undefined => {
  if (!keyframes) return undefined;
  const next: ClipKeyframes = {};
  for (const p of keyframedProperties(keyframes)) next[p] = listKeyframes(keyframes, p).map(f);
  return next;
};

const scaleEase = (ease: KeyframeEase | undefined, factor: number): KeyframeEase | undefined => {
  if (!ease || typeof ease === "string") return ease;
  const frames = (v: number | number[]) => (Array.isArray(v) ? v.map((x) => x * factor) : v * factor);
  return { ...ease, out: { ...ease.out, frames: frames(ease.out.frames) }, in: { ...ease.in, frames: frames(ease.in.frames) } };
};

/** Every key moved by `by` frames (a trim of the clip's start by d moves them by −d, so they stay on the content). */
export const shiftKeyframes = (keyframes: ClipKeyframes | undefined, by: number): ClipKeyframes | undefined =>
  by === 0 ? keyframes : mapKeys(keyframes, (k) => ({ ...k, frame: k.frame + by }));

/**
 * Every key's frame (and its handles' frames) times `factor`: a speed change from s0 to s1
 * scales them by s0/s1, a frame-rate change from f0 to f1 by f1/f0.
 */
export const scaleKeyframes = (keyframes: ClipKeyframes | undefined, factor: number): ClipKeyframes | undefined =>
  factor === 1 ? keyframes : mapKeys(keyframes, (k) => ({ ...k, frame: k.frame * factor, ease: scaleEase(k.ease, factor) }));

/** De Casteljau's split of a cubic bezier (points in µs and value) at `s`. */
const deCasteljau = (p: number[][], s: number) => {
  const mix = (a: number[], b: number[]) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  const [a, b, c] = [mix(p[0], p[1]), mix(p[1], p[2]), mix(p[2], p[3])];
  const [d, e] = [mix(a, b), mix(b, c)];
  const f = mix(d, e);
  return { left: [p[0], a, d, f], right: [f, e, c, p[3]] };
};

/** The parameter at which a bezier's time reaches `t`, by bisection. */
const paramAt = (p: number[][], t: number) => {
  const x = (s: number) => {
    const r = 1 - s;
    return r * r * r * p[0][0] + 3 * r * r * s * p[1][0] + 3 * r * s * s * p[2][0] + s * s * s * p[3][0];
  };
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (x(mid) < t) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/** A value back in the app's units from the travel space, and a handle's offsets likewise. */
const handleBack = (property: KeyframeProperty, keySpace: number[], dvSpace: number[], like: KeyframeValue): number[] => {
  if (COLOUR_PROPERTIES.has(property) || typeof like === "string") return dvSpace;
  const key = fromSpace(property, keySpace, [0]) as number[];
  const moved = fromSpace(property, keySpace.map((x, i) => x + dvSpace[i]), [0]) as number[];
  return moved.map((m, i) => m - key[i]);
};

const one = (v: number[]): number | number[] => (v.length === 1 ? v[0] : v);

/**
 * One property's keys split at clip-local `cut`, keeping the motion: a key at the cut in both
 * halves (a curve cut in two by de Casteljau's construction, as CapCut splits a keyframed
 * clip), the left keeping the keys before it, the right the keys after it, moved to its start.
 */
const splitList = (keys: Keyframe[], property: KeyframeProperty, cut: number, fps: number): [Keyframe[], Keyframe[]] => {
  if (keys.length === 0) return [[], []];
  const exact = keys.find((k) => Math.abs(k.frame - cut) < SAME_FRAME);
  const before = keys.filter((k) => k.frame < cut - SAME_FRAME);
  const after = keys.filter((k) => k.frame > cut + SAME_FRAME).map((k) => ({ ...k, frame: k.frame - cut }));
  const value = sampleKeyframes(keys, cut, property, fps) as KeyframeValue;
  if (exact) return [[...before, { frame: cut, value: exact.value }], [{ ...exact, frame: 0 }, ...after]];
  if (before.length === 0 || after.length === 0) {
    // Outside the keys: the end value holds on both sides of the cut.
    return [[...before, { frame: cut, value }], [{ frame: 0, value }, ...after]];
  }
  const a = before[before.length - 1];
  const b = keys[keys.indexOf(a) + 1];
  const [ta, tb, tc] = [micros(a.frame, fps), micros(b.frame, fps), micros(cut, fps)];
  const h = spanHandles(a.ease, property, a, b, tb - ta, fps);
  if (!h) {
    const ease = a.ease === "hold" ? "hold" : undefined;
    const right: Keyframe = { frame: 0, value: a.ease === "hold" ? a.value : value };
    if (ease) right.ease = ease;
    return [[...before, { frame: cut, value: right.value }], [right, ...after]];
  }
  const [va, vb] = [toSpace(property, a.value), toSpace(property, b.value)];
  const n = va.length;
  const lo: KeyframeCurve = { out: { frames: [], value: [] }, in: { frames: [], value: [] } };
  const hi: KeyframeCurve = { out: { frames: [], value: [] }, in: { frames: [], value: [] } };
  const mid: number[] = [];
  const frames = (us: number) => (us * fps) / 1e6;
  for (let c = 0; c < n; c++) {
    if (h.straight[c]) {
      mid.push(va[c] + (vb[c] - va[c]) * ((tc - ta) / (tb - ta)));
      for (const half of [lo, hi]) {
        (half.out.frames as number[]).push(0);
        (half.out.value as number[]).push(0);
        (half.in.frames as number[]).push(0);
        (half.in.value as number[]).push(0);
      }
      continue;
    }
    const p = [
      [ta, va[c]],
      [ta + h.out[0][c], va[c] + h.out[1][c]],
      [tb + h.into[0][c], vb[c] + h.into[1][c]],
      [tb, vb[c]],
    ];
    const { left, right } = deCasteljau(p, paramAt(p, tc));
    mid.push(left[3][1]);
    (lo.out.frames as number[]).push(frames(left[1][0] - left[0][0]));
    (lo.out.value as number[]).push(left[1][1] - left[0][1]);
    (lo.in.frames as number[]).push(frames(left[2][0] - left[3][0]));
    (lo.in.value as number[]).push(left[2][1] - left[3][1]);
    (hi.out.frames as number[]).push(frames(right[1][0] - right[0][0]));
    (hi.out.value as number[]).push(right[1][1] - right[0][1]);
    (hi.in.frames as number[]).push(frames(right[2][0] - right[3][0]));
    (hi.in.value as number[]).push(right[2][1] - right[3][1]);
  }
  const midValue = fromSpace(property, mid, a.value);
  // Handle values back in the app's units, as offsets from their keys.
  const back = (curve: KeyframeCurve, from: number[], to: number[]): KeyframeCurve => {
    const c: KeyframeCurve = {
      out: { frames: one(curve.out.frames as number[]), value: one(handleBack(property, from, curve.out.value as number[], a.value)) },
      in: { frames: one(curve.in.frames as number[]), value: one(handleBack(property, to, curve.in.value as number[], a.value)) },
    };
    if (h.straight.some(Boolean)) c.straight = [...h.straight];
    return c;
  };
  const left: Keyframe[] = [...before.slice(0, -1), { ...a, ease: back(lo, va, mid) }, { frame: cut, value: midValue }];
  const right: Keyframe[] = [{ frame: 0, value: midValue, ease: back(hi, mid, vb) }, ...after];
  return [left, right];
};

/** A clip's keyframes split at clip-local `cut` frames, for the left and right clips. */
export const splitKeyframes = (keyframes: ClipKeyframes | undefined, cut: number, fps: number): [ClipKeyframes | undefined, ClipKeyframes | undefined] => {
  if (!keyframes) return [undefined, undefined];
  const left: ClipKeyframes = {};
  const right: ClipKeyframes = {};
  for (const p of keyframedProperties(keyframes)) {
    const [l, r] = splitList(listKeyframes(keyframes, p), p, cut, fps);
    if (l.length) left[p] = l;
    if (r.length) right[p] = r;
  }
  return [left, right];
};

// ---- a property's value, and editing it as CapCut does ----------------------------------------

/** The clip-local frame for a timeline frame. */
export const localFrame = (clip: AnyClipProps, timelineFrame: number): number => timelineFrame - (clip.startFrame ?? 0);

const boxOf = (t: ClipTransform) => {
  const w = (t.width || 0) * (t.scaleX ?? 1);
  const h = (t.height || 0) * (t.scaleY ?? 1);
  const r = ((t.rotation || 0) * Math.PI) / 180;
  return { w, h, cos: Math.cos(r), sin: Math.sin(r) };
};

/** The centre of a transform's box (it turns about its top-left corner). */
const centreOf = (t: ClipTransform): [number, number] => {
  const { w, h, cos, sin } = boxOf(t);
  return [t.x + (cos * w) / 2 - (sin * h) / 2, t.y + (sin * w) / 2 + (cos * h) / 2];
};

/** A transform with its box's centre at `centre` (its size and turn as they are). */
const placeCentre = (t: ClipTransform, centre: [number, number]): ClipTransform => {
  const { w, h, cos, sin } = boxOf(t);
  return { ...t, x: centre[0] - ((cos * w) / 2 - (sin * h) / 2), y: centre[1] - ((sin * w) / 2 + (cos * h) / 2) };
};

const draftParts = (property: string): [string, string | undefined] => {
  const rest = property.slice("draft:".length);
  const at = rest.indexOf(":");
  return at < 0 ? [rest, undefined] : [rest.slice(0, at), rest.slice(at + 1)];
};

/**
 * OpenRip's own video effects (lib/effects): `fx:<param>` on an effect bar (`effectParams`),
 * `fx:<id>:<param>` on a clip's effect `id`, where `intensity` is the effect's strength.
 */
const effectParts = (property: string): [string | undefined, string] => {
  const rest = property.slice("fx:".length);
  const at = rest.indexOf(":");
  return at < 0 ? [undefined, rest] : [rest.slice(0, at), rest.slice(at + 1)];
};

const effectValue = (c: any, property: string): number | undefined => {
  const [id, param] = effectParts(property);
  if (id === undefined) return c.effectParams?.[param];
  const e = (c.effects as ClipEffect[] | undefined)?.find((x) => x.id === id);
  return e ? (param === "intensity" ? (e.intensity ?? 100) : e.params?.[param]) : undefined;
};

const effectPatch = (c: any, property: string, value: number): Partial<AnyClipProps> => {
  const [id, param] = effectParts(property);
  if (id === undefined) return { effectParams: { ...(c.effectParams ?? {}), [param]: value } } as Partial<AnyClipProps>;
  const list = (c.effects as ClipEffect[] | undefined) ?? [];
  return { effects: list.map((e) => (e.id !== id ? e : param === "intensity" ? { ...e, intensity: value } : { ...e, params: { ...e.params, [param]: value } })) } as Partial<AnyClipProps>;
};

/** The property's own value on the clip (its field's), in keyframe units. */
export const propertyValue = (clip: AnyClipProps, property: KeyframeProperty): KeyframeValue | undefined => {
  const c = clip as any;
  const t = clip.transform;
  switch (property) {
    case "position":
      return t ? centreOf(t) : undefined;
    case "scale":
      return t ? [t.scaleX ?? 1, t.scaleY ?? 1] : undefined;
    case "rotation":
      return t?.rotation ?? 0;
    case "opacity":
      return t?.opacity ?? 100;
    case "volume":
      return c.volume ?? 0;
    case "intensity":
      return c.intensity ?? 100;
    // A glow in the text's own colours keys from the text's colour; CapCut's glow starts at
    // 30 and 20.
    case "glowColor":
      return c.glowColor || c.color || "#ffffff";
    case "glowIntensity":
      return c.glowIntensity ?? 30;
    case "glowRange":
      return c.glowRange ?? 20;
  }
  if (property.startsWith("fx:")) return effectValue(c, property);
  if (property.startsWith("draft:")) {
    const [id, part] = draftParts(property);
    const entry = (c.draftAdjustments as DraftAdjustment[] | undefined)?.find((a) => a.id === id);
    if (!entry) return undefined;
    return part ? entry.values?.find((v) => v.key === part)?.value : entry.value;
  }
  if ((ADJUST_PROPERTIES as readonly string[]).includes(property)) return c[property] ?? 0;
  // The colour tools and the chroma key (lib/color.ts, lib/compositing.ts).
  if (/^(adjust|hsl|wheels|lut):/.test(property)) return colorPropertyValue(clip, property);
  if (property.startsWith("chroma:")) return c.chroma?.[property.slice(7)] ?? 0;
  return c[property];
};

/** The property's value at a timeline frame: its keys' if it has any, else its field's. */
export const valueAt = (clip: AnyClipProps, property: KeyframeProperty, timelineFrame: number, fps: number): KeyframeValue | undefined => {
  const keys = listKeyframes(clip.keyframes, property);
  return keys.length ? sampleKeyframes(keys, localFrame(clip, timelineFrame), property, fps) : propertyValue(clip, property);
};

/** A change to the property's own field (no keys involved). Turns and scales keep the centre. */
const fieldPatch = (clip: AnyClipProps, property: KeyframeProperty, value: KeyframeValue): Partial<AnyClipProps> => {
  const c = clip as any;
  const t = clip.transform;
  const pair = (v: KeyframeValue): [number, number] => (Array.isArray(v) ? [v[0], v[1] ?? v[0]] : [Number(v), Number(v)]);
  switch (property) {
    case "position":
      return t ? { transform: placeCentre(t, pair(value)) } : {};
    case "scale": {
      if (!t) return {};
      const [scaleX, scaleY] = pair(value);
      return { transform: placeCentre({ ...t, scaleX, scaleY }, centreOf(t)) };
    }
    case "rotation":
      return t ? { transform: placeCentre({ ...t, rotation: Number(value) }, centreOf(t)) } : {};
    case "opacity":
      return t ? { transform: { ...t, opacity: Number(value) } } : {};
  }
  if (property.startsWith("fx:")) return effectPatch(c, property, Number(value));
  if (property.startsWith("draft:")) {
    const [id, part] = draftParts(property);
    const list = (c.draftAdjustments as DraftAdjustment[] | undefined) ?? [];
    return {
      draftAdjustments: list.map((a) =>
        a.id !== id ? a : part ? { ...a, values: a.values?.map((v) => (v.key === part ? { ...v, value: Number(value) } : v)) } : { ...a, value: Number(value) },
      ),
    } as Partial<AnyClipProps>;
  }
  if (/^(adjust|hsl|wheels|lut):/.test(property)) return colorPropertyPatch(clip, property, Number(value));
  if (property.startsWith("chroma:")) return setChroma(clip, property.slice(7) as any, Number(value));
  return { [property]: value } as Partial<AnyClipProps>;
};

/**
 * Edit a property at a timeline frame as CapCut does: while it has keys, the edit sets the
 * key at that frame (adding one there); otherwise it changes the field. The returned patch is
 * for `updateClip`.
 */
export const editProperty = (clip: AnyClipProps, property: KeyframeProperty, timelineFrame: number, value: KeyframeValue): Partial<AnyClipProps> =>
  hasKeyframes(clip.keyframes, property)
    ? { keyframes: setKeyframe(clip.keyframes, property, localFrame(clip, timelineFrame), value) }
    : fieldPatch(clip, property, value);

/**
 * The keyframe diamond: a key at the playhead with the property's value there, or, if one is
 * already there, without it. The returned patch is for `updateClip`.
 */
export const toggleKeyframe = (clip: AnyClipProps, property: KeyframeProperty, timelineFrame: number, fps: number): Partial<AnyClipProps> => {
  const frame = localFrame(clip, timelineFrame);
  if (keyframeAt(clip.keyframes, property, frame)) return { keyframes: removeKeyframe(clip.keyframes, property, frame) };
  const value = valueAt(clip, property, timelineFrame, fps);
  return value === undefined ? {} : { keyframes: setKeyframe(clip.keyframes, property, frame, value) };
};
