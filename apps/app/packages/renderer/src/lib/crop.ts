// The Crop dialog's geometry (components/dialogs/CropDialog.tsx), kept apart from its drawing.
//
// A clip's crop is `transform.crop`: the rectangle of its picture it shows, normalised on the
// picture (x, y, width, height), with `rotation`, degrees clockwise: the clip shows that
// rectangle upright, so the picture inside it is turned by that much (the dialog's Rotation:
// straightening a horizon). The engine draws it (engine/crates/playback/src/crop.rs); the
// clip's box (`transform.width`, `height`, `x`, `y`) is the rectangle's box, as the app keeps a
// cropped clip.
//
// In the dialog the picture is shown turned by the rotation, and the rectangle is a "window" over
// it, upright on screen: `Win` is its edges in the picture's pixels, measured on screen's axes from
// the picture's centre.
import type { ClipTransform } from "./types";

export type CropRect = { x: number; y: number; width: number; height: number; rotation?: number };

/** The window's edges, in picture pixels from the picture's centre, on the shown (turned) axes. */
export type Win = { l: number; t: number; r: number; b: number };

/** A handle of the window: which edges it moves (-1 the left or top one, 1 the right or bottom one). */
export type Handle = { sx: -1 | 0 | 1; sy: -1 | 0 | 1 };

/** (x, y) turned `deg` degrees clockwise on screen (y down). */
export const turn = (x: number, y: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return [c * x - s * y, s * x + c * y];
};

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1, rotation: 0 };

export const isFullCrop = (c: CropRect | undefined | null) =>
  !c || (Math.abs(c.x) < 1e-6 && Math.abs(c.y) < 1e-6 && Math.abs(c.width - 1) < 1e-6 && Math.abs(c.height - 1) < 1e-6 && Math.abs(c.rotation ?? 0) < 1e-6);

/** The window of a saved crop on a picture of `sw`×`sh` pixels. */
export const winOfCrop = (c: CropRect | undefined | null, sw: number, sh: number): { win: Win; theta: number } => {
  const k = c ?? FULL_CROP;
  const theta = k.rotation ?? 0;
  const [cx, cy] = [(k.x + k.width / 2) * sw - sw / 2, (k.y + k.height / 2) * sh - sh / 2];
  const [dx, dy] = turn(cx, cy, theta);
  const [hw, hh] = [(k.width * sw) / 2, (k.height * sh) / 2];
  return { win: { l: dx - hw, t: dy - hh, r: dx + hw, b: dy + hh }, theta };
};

/** The crop a window makes on a picture of `sw`×`sh` pixels. */
export const cropOfWin = (w: Win, theta: number, sw: number, sh: number): CropRect => {
  const [dx, dy] = [(w.l + w.r) / 2, (w.t + w.b) / 2];
  const [cx, cy] = turn(dx, dy, -theta);
  const [width, height] = [(w.r - w.l) / sw, (w.b - w.t) / sh];
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  // (The window may reach half a pixel past the picture; the crop stays inside it.)
  const x = Math.max(0, (cx + sw / 2) / sw - width / 2);
  const y = Math.max(0, (cy + sh / 2) / sh - height / 2);
  return { x: round(x), y: round(y), width: round(Math.min(width, 1 - x)), height: round(Math.min(height, 1 - y)), rotation: round(theta) };
};

/** Whether the window lies inside the picture turned by `theta`. */
export const winInside = (w: Win, theta: number, sw: number, sh: number) => {
  const e = 0.5;
  for (const [x, y] of [[w.l, w.t], [w.r, w.t], [w.r, w.b], [w.l, w.b]] as const) {
    const [px, py] = turn(x, y, -theta);
    if (px < -sw / 2 - e || px > sw / 2 + e || py < -sh / 2 - e || py > sh / 2 + e) return false;
  }
  return true;
};

const lerpWin = (a: Win, b: Win, u: number): Win => ({ l: a.l + (b.l - a.l) * u, t: a.t + (b.t - a.t) * u, r: a.r + (b.r - a.r) * u, b: a.b + (b.b - a.b) * u });

/**
 * The window a drag asks for (`cand`), kept inside the picture: the one the drag has come as
 * far as it can along its way from `prev` (which is inside).
 */
export const clampWin = (prev: Win, cand: Win, theta: number, sw: number, sh: number): Win => {
  if (winInside(cand, theta, sw, sh)) return cand;
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (winInside(lerpWin(prev, cand, mid), theta, sw, sh)) lo = mid;
    else hi = mid;
  }
  return lerpWin(prev, cand, lo);
};

/** The window after the picture turns to `theta`: it keeps its place if it can, else moves in and shrinks. */
export const fitWin = (w: Win, theta: number, sw: number, sh: number): Win => {
  if (winInside(w, theta, sw, sh)) return w;
  const [hw, hh] = [(w.r - w.l) / 2, (w.b - w.t) / 2];
  let [cx, cy] = [(w.l + w.r) / 2, (w.t + w.b) / 2];
  const at = (k: number, x: number, y: number): Win => ({ l: x - hw * k, r: x + hw * k, t: y - hh * k, b: y + hh * k });
  // The centre has to be in the picture for any window to be; if it isn't, move it to the middle.
  const [px, py] = turn(cx, cy, -theta);
  if (Math.abs(px) > sw / 2 || Math.abs(py) > sh / 2) [cx, cy] = [0, 0];
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (winInside(at(mid, cx, cy), theta, sw, sh)) lo = mid;
    else hi = mid;
  }
  return at(lo, cx, cy);
};

/** The largest window of `ratio` (width over height, in picture pixels) round the window's centre, kept inside the picture. */
export const winForRatio = (ratio: number, from: Win, theta: number, sw: number, sh: number): Win => {
  const [cx, cy] = [(from.l + from.r) / 2, (from.t + from.b) / 2];
  const at = (k: number, x: number, y: number): Win => ({ l: x - (ratio * k) / 2, r: x + (ratio * k) / 2, t: y - k / 2, b: y + k / 2 });
  const [px, py] = turn(cx, cy, -theta);
  const [x, y] = Math.abs(px) > sw / 2 || Math.abs(py) > sh / 2 ? [0, 0] : [cx, cy];
  let [lo, hi] = [0, Math.max(sw, sh) * 2];
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (winInside(at(mid, x, y), theta, sw, sh)) lo = mid;
    else hi = mid;
  }
  // Shifting the centre can give a larger window when this one is held by one side: try the
  // centre's own place first (as above), then the picture's middle.
  const a = at(lo, x, y);
  let [lo2, hi2] = [0, Math.max(sw, sh) * 2];
  for (let i = 0; i < 40; i++) {
    const mid = (lo2 + hi2) / 2;
    if (winInside(at(mid, 0, 0), theta, sw, sh)) lo2 = mid;
    else hi2 = mid;
  }
  return lo >= lo2 * 0.5 ? a : at(lo2, 0, 0);
};

/** The window as a handle's drag by (dx, dy) picture pixels from `start` asks for it, before it's kept inside. */
export const dragWin = (start: Win, h: Handle | "move", dx: number, dy: number, ratio: number | null, minSide: number): Win => {
  if (h === "move") return { l: start.l + dx, r: start.r + dx, t: start.t + dy, b: start.b + dy };
  let { l, t, r, b } = start;
  if (h.sx < 0) l = Math.min(l + dx, r - minSide);
  if (h.sx > 0) r = Math.max(r + dx, l + minSide);
  if (h.sy < 0) t = Math.min(t + dy, b - minSide);
  if (h.sy > 0) b = Math.max(b + dy, t + minSide);
  if (ratio == null) return { l, t, r, b };
  // Held to a ratio: a corner keeps the opposite corner and follows the longer move; a side
  // keeps the opposite side and the other axis follows, about its middle.
  if (h.sx !== 0 && h.sy !== 0) {
    const w = r - l;
    const hh = b - t;
    const useW = w / ratio >= hh;
    const [nw, nh] = useW ? [w, w / ratio] : [hh * ratio, hh];
    if (h.sx < 0) l = r - nw;
    else r = l + nw;
    if (h.sy < 0) t = b - nh;
    else b = t + nh;
  } else if (h.sx !== 0) {
    const nh = (r - l) / ratio;
    const mid = (start.t + start.b) / 2;
    [t, b] = [mid - nh / 2, mid + nh / 2];
  } else {
    const nw = (b - t) * ratio;
    const mid = (start.l + start.r) / 2;
    [l, r] = [mid - nw / 2, mid + nw / 2];
  }
  return { l, t, r, b };
};

type Box = Pick<ClipTransform, "x" | "y" | "width" | "height" | "scaleX" | "scaleY" | "rotation">;

/**
 * The clip's box after its crop changes from `from` to `to`, the picture staying where it is on the
 * canvas: the box is the crop's rectangle, so it shrinks to it. (The box's rotation turns it about its
 * top-left corner, as the preview's does.)
 */
export const recrop = (box: Box, from: CropRect | undefined | null, to: CropRect | undefined | null): Pick<ClipTransform, "x" | "y" | "width" | "height"> => {
  const [a, b] = [from ?? FULL_CROP, to ?? FULL_CROP];
  const [sx, sy] = [Math.abs(box.scaleX || 1), Math.abs(box.scaleY || 1)];
  const [w0, h0] = [box.width * sx, box.height * sy];
  // The whole picture's size on the canvas, and its centre.
  const [fw, fh] = [w0 / Math.max(a.width, 1e-6), h0 / Math.max(a.height, 1e-6)];
  const [ox, oy] = turn(w0 / 2, h0 / 2, box.rotation);
  const centre0: [number, number] = [box.x + ox, box.y + oy];
  const offset = (c: CropRect): [number, number] => turn((c.x + c.width / 2 - 0.5) * fw, (c.y + c.height / 2 - 0.5) * fh, box.rotation + (c.rotation ?? 0));
  const [ax, ay] = offset(a);
  const whole: [number, number] = [centre0[0] - ax, centre0[1] - ay];
  const [bx, by] = offset(b);
  const centre1: [number, number] = [whole[0] + bx, whole[1] + by];
  const [w1, h1] = [fw * b.width, fh * b.height];
  const [cx, cy] = turn(w1 / 2, h1 / 2, box.rotation);
  return { x: centre1[0] - cx, y: centre1[1] - cy, width: w1 / sx, height: h1 / sy };
};

/** The ratios Crop offers, in CapCut's order; Free is null. */
export const CROP_RATIOS: { id: string; label: string; ratio: number | null }[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

/** The ratio id a crop is held to (the nearest of the list, else Free). */
export const ratioIdOf = (c: CropRect | undefined | null, sw: number, sh: number) => {
  if (isFullCrop(c) || !c) return "free";
  const r = (c.width * sw) / (c.height * sh);
  return CROP_RATIOS.find((o) => o.ratio != null && Math.abs(o.ratio / r - 1) < 0.003)?.id ?? "free";
};
