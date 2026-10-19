// Align and Distribute for several selected clips, as CapCut's Properties tab has them: the
// six alignments put each clip against the canvas's edge or middle (by its turned picture's
// bounds), and Distribute spaces three or more clips evenly between the outermost two. Pure:
// they take the clips' transforms as shown at the playhead and give back each one's new centre
// (world units, y down); the panel sets them as the Position edit (lib/keyframe-ui.ts).
import { centreOf } from "./transform-presets.ts";
import type { ClipTransform } from "./types";

export type Alignment = "left" | "center-h" | "right" | "top" | "center-v" | "bottom";
export type Box = { id: string; transform: ClipTransform };
export type World = { width: number; height: number };

/** Half the width and height of the box the turned picture fills. */
export const halfExtent = (t: ClipTransform): [number, number] => {
  const w = t.width * t.scaleX;
  const h = t.height * t.scaleY;
  const r = (t.rotation * Math.PI) / 180;
  return [(Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h) / 2, (Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h) / 2];
};

/** Each clip's new centre when aligned on the canvas; the other axis stays. */
export const alignOnCanvas = (boxes: Box[], to: Alignment, world: World): Map<string, [number, number]> => {
  const out = new Map<string, [number, number]>();
  for (const { id, transform } of boxes) {
    const [hw, hh] = halfExtent(transform);
    let [x, y] = centreOf(transform);
    if (to === "left") x = hw;
    if (to === "center-h") x = world.width / 2;
    if (to === "right") x = world.width - hw;
    if (to === "top") y = hh;
    if (to === "center-v") y = world.height / 2;
    if (to === "bottom") y = world.height - hh;
    out.set(id, [x, y]);
  }
  return out;
};

/**
 * Spaced evenly along an axis: the clips keep their order, the first and last stay, and the
 * gaps between neighbouring edges are made equal. Fewer than three clips have nothing to space.
 */
export const distribute = (boxes: Box[], axis: "horizontal" | "vertical"): Map<string, [number, number]> => {
  const out = new Map<string, [number, number]>();
  if (boxes.length < 3) return out;
  const i = axis === "horizontal" ? 0 : 1;
  const items = boxes
    .map((b) => {
      const c = centreOf(b.transform);
      const half = halfExtent(b.transform)[i];
      return { id: b.id, c, lo: c[i] - half, size: half * 2 };
    })
    .sort((a, b) => a.c[i] - b.c[i]);
  const first = items[0];
  const last = items[items.length - 1];
  const span = last.lo + last.size - first.lo;
  const gap = (span - items.reduce((s, x) => s + x.size, 0)) / (items.length - 1);
  let at = first.lo;
  for (const it of items) {
    const centre: [number, number] = [it.c[0], it.c[1]];
    centre[i] = at + it.size / 2;
    out.set(it.id, centre);
    at += it.size + gap;
  }
  return out;
};
