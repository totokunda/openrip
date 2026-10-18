// The transitions and clip animations the engine draws (engine/crates/playback/src/
// transition.rs and animation.rs), listed for the Transitions panel and the Animation tab, and
// pure helpers that make the clip fields for them (lib/types.ts: `transitionOut`,
// `animationIn`, `animationOut`, `animationCombo`, `animationLoop`). Nothing here writes to a
// store: set the returned objects with `updateClip`.
//
// Each built-in has CapCut's name for it, the id the clip field keeps as `type`, a category
// like CapCut's panels, its parameters and its default duration. `capcut` says how it was
// matched: "bundle" when its behaviour comes from CapCut's own script for it (read on this
// machine), "named" when it follows CapCut's animation template or transition rules with our
// own curves until that bundle is on hand. See docs/parity/transitions.md and
// docs/parity/clip-animations.md; docs/plan/app-engine-integration.md ("Transitions and
// animations") has how the engine and the importer use them.
import type { AnimationDirection, AnimationParams, AnyClipProps, ClipAnimation, ClipTransition } from "./types";

/** The kinds of clip animation: In and Out on every clip, Combo on video and photos, Loop on text. */
export type AnimationKind = "in" | "out" | "combo" | "loop";

/** A built-in's parameter: so far only a direction, with the choices and the default. */
export type BuiltinParam = { key: "direction"; label: string; options: AnimationDirection[]; default: AnimationDirection };

export type BuiltinTransition = {
  type: string;
  name: string;
  category: string;
  params?: BuiltinParam[];
  /** Seconds, centred on the cut. */
  defaultDuration: number;
  /** Shows both clips at once as the engine draws it, the outgoing one played on past its
   * end and the incoming one from before its start (CapCut's "overlapping" transitions); the
   * others show the outgoing clip up to the cut and the incoming one after it. */
  overlap: boolean;
  capcut: "bundle" | "named";
  /** Draws images from CapCut's downloaded bundle (Blink): offered only with one on hand. */
  needsResource?: boolean;
};

export type BuiltinAnimation = {
  type: string;
  name: string;
  category: string;
  params?: BuiltinParam[];
  /** Seconds; for a Combo, 0: it spans the whole clip. For a Loop, how long one round takes. */
  defaultDuration: number;
  capcut: "bundle" | "named";
};

const DIRECTION: BuiltinParam = { key: "direction", label: "Direction", options: ["left", "right", "up", "down"], default: "left" };

/** Every transition the engine draws, in panel order. */
export const TRANSITIONS: BuiltinTransition[] = [
  { type: "mix", name: "Mix", category: "Classic", defaultDuration: 0.5, overlap: true, capcut: "named" },
  { type: "black_fade", name: "Black Fade", category: "Classic", defaultDuration: 0.5, overlap: false, capcut: "named" },
  { type: "white_flash", name: "White Flash", category: "Classic", defaultDuration: 0.5, overlap: false, capcut: "bundle" },
  { type: "white_fade", name: "White Fade", category: "Classic", defaultDuration: 2, overlap: false, capcut: "bundle" },
  { type: "pull_in", name: "Pull in", category: "Classic", defaultDuration: 1, overlap: false, capcut: "bundle" },
  { type: "pull_out", name: "Pull out", category: "Classic", defaultDuration: 1, overlap: false, capcut: "named" },
  { type: "blur", name: "Blur", category: "Classic", defaultDuration: 0.5, overlap: false, capcut: "named" },
  { type: "blink", name: "Blink", category: "Basic", defaultDuration: 0.5, overlap: false, capcut: "bundle", needsResource: true },
  { type: "slide", name: "Slide", category: "Slide", params: [DIRECTION], defaultDuration: 0.5, overlap: true, capcut: "named" },
  { type: "push", name: "Push", category: "Slide", params: [DIRECTION], defaultDuration: 0.5, overlap: true, capcut: "named" },
  { type: "wipe", name: "Wipe", category: "Slide", params: [DIRECTION], defaultDuration: 0.5, overlap: true, capcut: "named" },
  { type: "circle", name: "Circle", category: "Mask", defaultDuration: 0.5, overlap: true, capcut: "named" },
  { type: "spin", name: "Spin", category: "Movement", defaultDuration: 0.5, overlap: false, capcut: "named" },
];

/** A video or photo's moves (the typing intros are the text's own). */
const MOVES_IN: BuiltinAnimation[] = [
  { type: "fade_in", name: "Fade In", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "zoom_in", name: "Zoom In", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "zoom_out", name: "Zoom Out", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "slide", name: "Slide", category: "Basic", params: [DIRECTION], defaultDuration: 0.5, capcut: "named" },
  { type: "rotate", name: "Rotate", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "spin", name: "Spin", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "bounce", name: "Bounce", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "shake", name: "Shake", category: "Basic", defaultDuration: 0.5, capcut: "named" },
];

const MOVES_OUT: BuiltinAnimation[] = [
  { type: "fade_out", name: "Fade Out", category: "Basic", defaultDuration: 0.5, capcut: "bundle" },
  { type: "zoom_in", name: "Zoom In", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "zoom_out", name: "Zoom Out", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "slide", name: "Slide", category: "Basic", params: [DIRECTION], defaultDuration: 0.5, capcut: "named" },
  { type: "rotate", name: "Rotate", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "spin", name: "Spin", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "bounce", name: "Bounce", category: "Basic", defaultDuration: 0.5, capcut: "named" },
  { type: "shake", name: "Shake", category: "Basic", defaultDuration: 0.5, capcut: "named" },
];

const COMBOS: BuiltinAnimation[] = [
  { type: "swing", name: "Swing", category: "Basic", defaultDuration: 0, capcut: "named" },
  { type: "shake", name: "Shake", category: "Basic", defaultDuration: 0, capcut: "named" },
  { type: "pulse", name: "Pulse", category: "Basic", defaultDuration: 0, capcut: "named" },
  { type: "spin", name: "Spin", category: "Basic", defaultDuration: 0, capcut: "named" },
];

/** A text's typing intros (CapCut's own timings, from their bundles). */
const TYPING: BuiltinAnimation[] = [
  { type: "type_1", name: "Type 1", category: "Typing", defaultDuration: 0.5, capcut: "bundle" },
  { type: "type_2", name: "Type 2", category: "Typing", defaultDuration: 0.5, capcut: "bundle" },
  { type: "typewriter", name: "Typewriter", category: "Typing", defaultDuration: 1, capcut: "bundle" },
];

const LOOPS: BuiltinAnimation[] = [
  { type: "pulse", name: "Pulse", category: "Basic", defaultDuration: 1, capcut: "named" },
  { type: "swing", name: "Swing", category: "Basic", defaultDuration: 1, capcut: "named" },
  { type: "shake", name: "Shake", category: "Basic", defaultDuration: 1, capcut: "named" },
  { type: "float", name: "Float", category: "Basic", defaultDuration: 1, capcut: "named" },
  { type: "blink", name: "Blink", category: "Basic", defaultDuration: 1, capcut: "named" },
];

/** The clip moves a text can take: fades, zooms and slides. */
const TEXT_MOVES = new Set(["fade_in", "fade_out", "zoom_in", "zoom_out", "slide"]);

/** The animations of `kind` a clip of this type can take, in panel order (none for other types). */
export const animationsFor = (clipType: AnyClipProps["type"], kind: AnimationKind): BuiltinAnimation[] => {
  const media = clipType === "video" || clipType === "image";
  if (!media && clipType !== "text") return [];
  switch (kind) {
    case "in":
      return media ? MOVES_IN : [...TYPING, ...MOVES_IN.filter((a) => TEXT_MOVES.has(a.type))];
    case "out":
      return media ? MOVES_OUT : MOVES_OUT.filter((a) => TEXT_MOVES.has(a.type));
    case "combo":
      return media ? COMBOS : [];
    case "loop":
      return media ? [] : LOOPS;
  }
};

/** The clip field each kind is kept in. */
export const ANIMATION_FIELD: Record<AnimationKind, "animationIn" | "animationOut" | "animationCombo" | "animationLoop"> = {
  in: "animationIn",
  out: "animationOut",
  combo: "animationCombo",
  loop: "animationLoop",
};

/** A built-in's default parameters (a direction where it takes one). */
const defaultParams = (params?: BuiltinParam[]): AnimationParams | undefined =>
  params?.length ? Object.fromEntries(params.map((p) => [p.key, p.default])) : undefined;

/** A clip's length in seconds. */
export const clipSeconds = (clip: AnyClipProps, fps: number): number =>
  Math.max(0, (Number(clip.endFrame ?? 0) - Number(clip.startFrame ?? 0)) / (fps || 30));

/**
 * The `transitionOut` field for a built-in, at its default duration (or `duration`) and
 * parameters (or `params`), as the engine draws it; `null` for a type it doesn't know.
 */
export const transitionOf = (type: string, opts: { duration?: number; params?: AnimationParams; resource?: string | null } = {}): ClipTransition | null => {
  const t = TRANSITIONS.find((x) => x.type === type);
  if (!t) return null;
  const params = t.params ? { ...defaultParams(t.params), ...opts.params } : undefined;
  return {
    type,
    name: t.name,
    duration: opts.duration ?? t.defaultDuration,
    ...(params ? { params } : {}),
    ...(t.needsResource ? { resource: opts.resource ?? null } : {}),
  };
};

/**
 * The field for a built-in animation of `kind` on `clip` (`animationIn`, …), at its default
 * duration (or `duration`) and parameters: a Combo spans the whole clip (`fps` gives its
 * length). `null` for one the clip can't take.
 */
export const animationOf = (
  clip: AnyClipProps,
  kind: AnimationKind,
  type: string,
  opts: { duration?: number; params?: AnimationParams; fps?: number } = {},
): ClipAnimation | null => {
  const a = animationsFor(clip.type, kind).find((x) => x.type === type);
  if (!a) return null;
  const params = a.params ? { ...defaultParams(a.params), ...opts.params } : undefined;
  const duration = kind === "combo" ? clipSeconds(clip, opts.fps ?? 30) : (opts.duration ?? a.defaultDuration);
  return { type, name: a.name, duration, ...(params ? { params } : {}) };
};

/**
 * The longest a clip's animation of `kind` can run, in seconds: an In or a Loop the clip's
 * length, an Out what the In leaves of it (as the engine fits them); a Combo always spans it.
 */
export const maxAnimationDuration = (clip: AnyClipProps, kind: AnimationKind, fps: number): number => {
  const length = clipSeconds(clip, fps);
  if (kind !== "out") return length;
  const before = (clip as { animationIn?: ClipAnimation | null }).animationIn;
  return Math.max(0, length - Math.min(before?.duration ?? 0, length));
};

/**
 * The longest a transition between `clip` and `next` can run, in seconds: the shorter clip's
 * length (half of it lies in each).
 */
export const maxTransitionDuration = (clip: AnyClipProps, next: AnyClipProps | undefined, fps: number): number =>
  next ? Math.min(clipSeconds(clip, fps), clipSeconds(next, fps)) : 0;
