// A video or photo's masks as CapCut's Mask tab edits them: its shapes (Split, Filmstrip,
// Circle, Rectangle, Stars, Heart; the app's lasso as Pen), a new mask centred on the
// picture, a mask's poses over time and the keyframe rule for them, and the heart's outline.
// Pure helpers returning new objects (the undo history shares clips); `node --test
// tests/*.test.ts` in packages/renderer checks them.
//
// A mask keeps poses by frame (`keyframes`: shape bounds or lasso points, and optionally its
// own feather), in the clip's source frames for a video ((timeline frame − start + trimStart)
// × speed, as the engine reads them) and clip frames for a photo. One pose and no `keyed` flag
// is a static mask: an edit changes that pose wherever the playhead is. Keyed (the diamond
// pressed, or several poses), an edit sets the pose at the playhead, starting from the pose
// the mask has there, which travels between poses of one shape as the engine draws it
// (linearly, or by the first pose's easing).
import type { AnyClipProps, ClipTransform, KeyframeEase, MaskClipProps, MaskData, MaskShapeTool } from "./types";
import { sampleKeyframes } from "./keyframes.ts";

/** The shapes the inspector offers, with CapCut's names; `polygon` is the app's triangle. */
export type MaskShape = MaskShapeTool;
export type Bounds = NonNullable<MaskData["shapeBounds"]>;

/** The tiles in CapCut's order; Brush and Pen start the canvas's brush and lasso. */
export const MASK_SHAPES: { id: MaskShape | "none" | "brush" | "lasso"; name: string }[] = [
  { id: "none", name: "None" },
  { id: "linear", name: "Split" },
  { id: "mirror", name: "Filmstrip" },
  { id: "ellipse", name: "Circle" },
  { id: "rectangle", name: "Rectangle" },
  { id: "star", name: "Stars" },
  { id: "heart", name: "Heart" },
  { id: "brush", name: "Brush" },
  { id: "lasso", name: "Pen" },
];

/** A mask's name in its chip ("Rectangle", "Pen", …). */
export const maskShapeName = (mask: MaskClipProps): string => {
  if (mask.tool === "lasso") return "Pen";
  if (mask.tool === "draw") return "Brush";
  const first = posesOf(mask)[0]?.[1];
  const t = (first?.shapeBounds as Bounds | undefined)?.shapeType ?? "rectangle";
  return MASK_SHAPES.find((s) => s.id === t)?.name ?? (t === "polygon" ? "Triangle" : t);
};

// ---- frames -------------------------------------------------------------------------------

const exact = (v: number) => Math.round(v * 1000) / 1000;
const speedOf = (clip: AnyClipProps) => {
  const s = Number((clip as any).speed ?? 1);
  return Number.isFinite(s) && s > 0 ? s : 1;
};
const trimOf = (clip: AnyClipProps) => (Number.isFinite(clip.trimStart ?? 0) ? (clip.trimStart ?? 0) : 0);

/** The mask frame (a pose's key) for a timeline frame. */
export const maskFrame = (clip: AnyClipProps, timelineFrame: number): number =>
  clip.type === "video" ? exact((timelineFrame - clip.startFrame + trimOf(clip)) * speedOf(clip)) : exact(timelineFrame - clip.startFrame);

/** The timeline frame a pose's key is at. */
export const timelineFrameOf = (clip: AnyClipProps, key: number): number =>
  clip.type === "video" ? clip.startFrame + key / speedOf(clip) - trimOf(clip) : clip.startFrame + key;

// ---- poses --------------------------------------------------------------------------------

/** A mask's poses, sorted by frame. */
export const posesOf = (mask: MaskClipProps): [number, MaskData][] => {
  const k = mask.keyframes as any;
  const entries: [number, MaskData][] = k instanceof Map ? [...k.entries()].map(([f, d]) => [Number(f), d]) : Object.entries(k ?? {}).map(([f, d]) => [Number(f), d as MaskData]);
  return entries.filter(([f]) => Number.isFinite(f)).sort((a, b) => a[0] - b[0]);
};

const withPoses = (mask: MaskClipProps, poses: [number, MaskData][], extra: Partial<MaskClipProps> = {}): MaskClipProps => ({
  ...mask,
  ...extra,
  keyframes: Object.fromEntries(poses.map(([f, d]) => [f, d])),
  lastModified: Date.now(),
});

/** Whether the mask moves over time: the diamond was pressed, or it has several poses. */
export const isMaskKeyed = (mask: MaskClipProps) => !!(mask as any).keyed || posesOf(mask).length > 1;

const SAME = 1e-3;

/** The centre of a shape's box (a rectangle turns about its top-left, the others about their centre). */
export const boundsCentre = (b: Bounds): [number, number] => {
  const [w, h] = [b.width * (b.scaleX ?? 1), b.height * (b.scaleY ?? 1)];
  if ((b.shapeType ?? "rectangle") !== "rectangle") return [b.x + w / 2, b.y + h / 2];
  const r = ((b.rotation ?? 0) * Math.PI) / 180;
  return [b.x + (Math.cos(r) * w) / 2 - (Math.sin(r) * h) / 2, b.y + (Math.sin(r) * w) / 2 + (Math.cos(r) * h) / 2];
};

/** The box with its centre at `c` (its size, turn and shape as they are). */
export const placeBounds = (b: Bounds, c: [number, number]): Bounds => {
  const [w, h] = [b.width * (b.scaleX ?? 1), b.height * (b.scaleY ?? 1)];
  if ((b.shapeType ?? "rectangle") !== "rectangle") return { ...b, x: c[0] - w / 2, y: c[1] - h / 2 };
  const r = ((b.rotation ?? 0) * Math.PI) / 180;
  return { ...b, x: c[0] - ((Math.cos(r) * w) / 2 - (Math.sin(r) * h) / 2), y: c[1] - ((Math.sin(r) * w) / 2 + (Math.cos(r) * h) / 2) };
};

/** How far from pose `a` to pose `b` at frame `f` (0–1), by `a`'s easing, as the engine travels. */
const progress = (fa: number, fb: number, f: number, ease: KeyframeEase | undefined, fps: number) =>
  Number(
    sampleKeyframes(
      [
        { frame: fa, value: 0, ease },
        { frame: fb, value: 1 },
      ],
      f,
      "opacity",
      fps,
    ),
  );

const mix = (x: number, y: number, p: number) => x + (y - x) * p;

/**
 * The pose a mask has at mask frame `f`: a pose there, else between the poses either side
 * when they're of one shape (centre, size, turn, round corners and feather travelling, a
 * lasso's points too when it has as many), else the last pose before (the first before it).
 * `featherAmount` is the pose's feather, the mask's own when the poses don't keep one.
 */
export const poseAt = (mask: MaskClipProps, f: number, fps: number): MaskData | undefined => {
  const poses = posesOf(mask);
  if (!poses.length) return undefined;
  const feather = (d: MaskData) => (d as any).featherAmount ?? mask.featherAmount ?? 0;
  const withFeather = (d: MaskData): MaskData => ({ ...d, featherAmount: feather(d) } as MaskData);
  const i = poses.findIndex(([k]) => k > f + SAME);
  if (i === 0) return withFeather(poses[0][1]);
  if (i < 0) return withFeather(poses[poses.length - 1][1]);
  const [[fa, a], [fb, b]] = [poses[i - 1], poses[i]];
  if (Math.abs(fa - f) < SAME) return withFeather(a);
  if (a.ease === "hold") return withFeather(a);
  const p = progress(fa, fb, f, a.ease, fps);
  const out: any = { ...a, featherAmount: mix(feather(a), feather(b), p) };
  const ba = a.shapeBounds as Bounds | undefined;
  const bb = b.shapeBounds as Bounds | undefined;
  if (ba && bb && (ba.shapeType ?? "rectangle") === (bb.shapeType ?? "rectangle")) {
    const [ca, cb] = [boundsCentre(ba), boundsCentre(bb)];
    const sized: Bounds = {
      ...ba,
      width: mix(ba.width * (ba.scaleX ?? 1), bb.width * (bb.scaleX ?? 1), p),
      height: mix(ba.height * (ba.scaleY ?? 1), bb.height * (bb.scaleY ?? 1), p),
      scaleX: 1,
      scaleY: 1,
      rotation: mix(ba.rotation ?? 0, bb.rotation ?? 0, p),
      cornerRadius: mix(ba.cornerRadius ?? 0, bb.cornerRadius ?? 0, p),
    };
    out.shapeBounds = placeBounds(sized, [mix(ca[0], cb[0], p), mix(ca[1], cb[1], p)]);
    return out;
  }
  if (a.lassoPoints && b.lassoPoints && a.lassoPoints.length === b.lassoPoints.length) {
    out.lassoPoints = a.lassoPoints.map((v, k) => mix(v, b.lassoPoints![k], p));
    return out;
  }
  return withFeather(a);
};

/**
 * An edit of the mask's pose at mask frame `f` by CapCut's rule: keyed, the pose there is set
 * (from the pose the mask has there); static, its one pose changes. The feather goes on the
 * pose when keyed, on the mask when static.
 */
export const editMaskPose = (mask: MaskClipProps, f: number, fps: number, edit: (pose: MaskData) => MaskData): MaskClipProps => {
  const poses = posesOf(mask);
  if (!isMaskKeyed(mask) && poses.length) {
    const [frame, data] = poses[0];
    const next = edit({ ...data, featherAmount: (data as any).featherAmount ?? mask.featherAmount ?? 0 } as MaskData) as any;
    const featherAmount = next.featherAmount;
    delete next.featherAmount;
    return withPoses(mask, [[frame, next]], { featherAmount: featherAmount ?? mask.featherAmount });
  }
  const base = poseAt(mask, f, fps) ?? {};
  const next = edit({ ...base });
  const kept = poses.filter(([k]) => Math.abs(k - f) >= SAME);
  // A pose keeps its own easing over the span after it.
  const at = poses.find(([k]) => Math.abs(k - f) < SAME)?.[1];
  const pose: MaskData = { ...next, ...(at?.ease !== undefined ? { ease: at.ease } : {}) };
  if (at?.ease === undefined) delete (pose as any).ease;
  return withPoses(mask, [...kept, [f, pose] as [number, MaskData]].sort((x, y) => x[0] - y[0]));
};

/** The navigator's state for a mask at a timeline frame (its keys in timeline frames). */
export const maskNav = (mask: MaskClipProps, clip: AnyClipProps, timelineFrame: number) => {
  if (!isMaskKeyed(mask)) return { keyed: false, at: false };
  const f = maskFrame(clip, timelineFrame);
  const keys = posesOf(mask).map(([k]) => k);
  const before = keys.filter((k) => k < f - SAME);
  const after = keys.filter((k) => k > f + SAME);
  return {
    keyed: true,
    at: keys.some((k) => Math.abs(k - f) < SAME),
    prev: before.length ? Math.round(timelineFrameOf(clip, before[before.length - 1])) : undefined,
    next: after.length ? Math.round(timelineFrameOf(clip, after[0])) : undefined,
  };
};

/**
 * The diamond on a mask: static, it becomes keyed with its pose at the playhead; keyed, a
 * pose at the playhead goes (the last one leaves the mask static as it is there), and
 * without one there, the mask's pose there becomes a key.
 */
export const toggleMaskPose = (mask: MaskClipProps, f: number, fps: number): MaskClipProps => {
  const poses = posesOf(mask);
  if (!poses.length) return mask;
  const featherOf = (d: MaskData) => (d as any).featherAmount ?? mask.featherAmount ?? 0;
  if (!isMaskKeyed(mask)) {
    return withPoses(mask, [[f, { ...poses[0][1], featherAmount: featherOf(poses[0][1]) } as MaskData]], { keyed: true } as any);
  }
  const here = poses.find(([k]) => Math.abs(k - f) < SAME);
  if (here) {
    const rest = poses.filter(([k]) => Math.abs(k - f) >= SAME);
    if (rest.length) return withPoses(mask, rest, { keyed: true } as any);
    const data = { ...here[1] } as any;
    const featherAmount = featherOf(data);
    delete data.featherAmount;
    delete data.ease;
    return withPoses(mask, [[here[0], data]], { keyed: false, featherAmount } as any);
  }
  const pose = poseAt(mask, f, fps)!;
  delete (pose as any).ease;
  return withPoses(mask, [...poses, [f, pose] as [number, MaskData]].sort((x, y) => x[0] - y[0]), { keyed: true } as any);
};

// ---- shapes -------------------------------------------------------------------------------

/** The picture's box in the mask's units: the clip's box at its own scale. */
export const pictureBox = (t: ClipTransform) => ({ w: (t.width || 0) * (t.scaleX || 1), h: (t.height || 0) * (t.scaleY || 1) });

/** A shape's box when it's new: centred on the picture, half its shorter side (Split and Filmstrip across it, a third as tall). */
export const defaultBounds = (shape: MaskShape, t: ClipTransform): Bounds => {
  const { w, h } = pictureBox(t);
  const s = 0.5 * Math.min(w, h);
  const [bw, bh] = shape === "linear" || shape === "mirror" ? [w, h / 3] : [s, s];
  return { x: (w - bw) / 2, y: (h - bh) / 2, width: bw, height: bh, rotation: 0, scaleX: 1, scaleY: 1, shapeType: shape, ...(shape === "rectangle" ? { cornerRadius: 0 } : {}) };
};

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `mask-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * A new mask of `shape` on the clip, centred on its picture, as CapCut adds one: it shows the
 * clip inside and nothing outside, with no feather, static at mask frame `f`.
 */
export const newShapeMask = (clip: AnyClipProps, shape: MaskShape, f: number): MaskClipProps => {
  const t = clip.transform!;
  const now = Date.now();
  return {
    id: newId(),
    clipId: clip.clipId,
    tool: "shape",
    featherAmount: 0,
    keyframes: { [f]: { shapeBounds: defaultBounds(shape, t) } },
    createdAt: now,
    lastModified: now,
    inverted: false,
    // The clip inside, and outside a clear colour: the clip cut to the shape, as CapCut's.
    maskColorEnabled: false,
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    backgroundColorEnabled: true,
    transform: { ...t },
  };
};

/** The bounds of a lasso's points. */
const pointsBox = (pts: number[]) => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
};

/**
 * The mask with another shape, each pose keeping its centre, size and turn (a lasso's poses
 * become boxes round their points). Split and Filmstrip span the picture's width.
 */
export const changeMaskShape = (mask: MaskClipProps, shape: MaskShape, t: ClipTransform): MaskClipProps => {
  const poses = posesOf(mask).map(([f, d]): [number, MaskData] => {
    const old: Bounds = (d.shapeBounds as Bounds) ?? { ...pointsBox(d.lassoPoints ?? []), rotation: 0, shapeType: "rectangle" };
    const c = boundsCentre(old);
    const sized: Bounds = { ...old, shapeType: shape, scaleX: 1, scaleY: 1, width: old.width * (old.scaleX ?? 1), height: old.height * (old.scaleY ?? 1) };
    if (shape === "linear" || shape === "mirror") sized.width = Math.max(sized.width, pictureBox(t).w);
    if (shape !== "rectangle") delete sized.cornerRadius;
    const next: any = { ...d, shapeBounds: placeBounds(sized, c) };
    delete next.lassoPoints;
    delete next.lassoPointsBinPath;
    return [f, next];
  });
  return withPoses(mask, poses, { tool: "shape" });
};

// ---- the heart ----------------------------------------------------------------------------

/**
 * The heart's outline in a w×h box centred on (cx, cy), turned clockwise by `rotation`
 * degrees: the classic heart curve across the box's width and 0.9 of its height, as CapCut's
 * heart fills its box; 64 points, flat [x0, y0, x1, y1, …], y down. The engine draws the same
 * outline (engine/crates/v1/src/lib.rs, `heart_points`).
 */
export const heartPoints = (cx: number, cy: number, w: number, h: number, rotation: number): number[] => {
  const N = 64;
  const [top, bottom] = [11.9233, -17];
  const r = (rotation * Math.PI) / 180;
  const [sn, cs] = [Math.sin(r), Math.cos(r)];
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const [dx, dy] = [(x / 32) * w, (-(y - (top + bottom) / 2) / (top - bottom)) * 0.9 * h];
    out.push(cx + cs * dx - sn * dy, cy + sn * dx + cs * dy);
  }
  return out;
};
