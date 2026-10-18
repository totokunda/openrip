import type { PathPoint, ShapeClipProps, StrokeCap, StrokeStyle } from "./types";
import { capOf, fillOn, isOpenShape, strokeOn } from "./shape-presets";

/**
 * The outlines of CapCut's shapes as the engine draws them (engine/crates/render/src/shape.rs
 * and the v1 importer), for the preview's own drawing and the pen's overlay: in a box of
 * `w`×`h` units from its top-left.
 */

type Pt = { x: number; y: number };

/** A command of an outline (the engine's zeno commands). */
export type Cmd =
  | { k: "M"; p: Pt }
  | { k: "L"; p: Pt }
  | { k: "C"; a: Pt; b: Pt; p: Pt }
  | { k: "Q"; a: Pt; p: Pt }
  | { k: "Z" };

/** The corners of a triangle, parallelogram or trapezoid filling the box. */
export const vertices = (shape: ShapeClipProps["shapeType"], w: number, h: number): Pt[] | null => {
  switch (shape) {
    case "triangle":
      return [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    case "parallelogram":
      return [{ x: w / 3, y: 0 }, { x: w, y: 0 }, { x: (w * 2) / 3, y: h }, { x: 0, y: h }];
    case "trapezoid":
      return [{ x: w / 4, y: 0 }, { x: (w * 3) / 4, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    default:
      return null;
  }
};

/** A closed polygon, each corner cut back by up to `r` (half the shorter edge beside it at most) and rounded through the corner. */
export const roundedPolygon = (pts: Pt[], r: number): Cmd[] => {
  if (pts.length < 2) return [];
  if (r <= 0) return [{ k: "M", p: pts[0] }, ...pts.slice(1).map((p) => ({ k: "L" as const, p })), { k: "Z" }];
  const out: Cmd[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const prev = pts[(i + n - 1) % n];
    const v1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-6 || l2 < 1e-6) {
      out.push({ k: i === 0 ? "M" : "L", p: cur } as Cmd);
      continue;
    }
    const rr = Math.min(r, Math.min(l1, l2) / 2);
    const start = { x: cur.x - (v1.x / l1) * rr, y: cur.y - (v1.y / l1) * rr };
    const end = { x: cur.x + (v2.x / l2) * rr, y: cur.y + (v2.y / l2) * rr };
    out.push({ k: i === 0 ? "M" : "L", p: start } as Cmd);
    out.push({ k: "Q", a: cur, p: end });
  }
  out.push({ k: "Z" });
  return out;
};

/** Path points in box units (the stored ones are fractions of the box). */
export const boxNodes = (path: PathPoint[], w: number, h: number) =>
  path.map((p) => ({ x: p.x * w, y: p.y * h, inX: (p.inX ?? 0) * w, inY: (p.inY ?? 0) * h, outX: (p.outX ?? 0) * w, outY: (p.outY ?? 0) * h }));

type Node = ReturnType<typeof boxNodes>[number];

/** A pen path: a cubic from each point's out handle to the next's in handle (straight when both are zero), closed back to the first when `closed`. */
export const bezierPath = (nodes: Node[], closed: boolean): Cmd[] => {
  if (!nodes.length) return [];
  const seg = (a: Node, b: Node): Cmd =>
    a.outX === 0 && a.outY === 0 && b.inX === 0 && b.inY === 0
      ? { k: "L", p: { x: b.x, y: b.y } }
      : { k: "C", a: { x: a.x + a.outX, y: a.y + a.outY }, b: { x: b.x + b.inX, y: b.y + b.inY }, p: { x: b.x, y: b.y } };
  const out: Cmd[] = [{ k: "M", p: { x: nodes[0].x, y: nodes[0].y } }];
  for (let i = 1; i < nodes.length; i++) out.push(seg(nodes[i - 1], nodes[i]));
  if (closed && nodes.length > 1) {
    out.push(seg(nodes[nodes.length - 1], nodes[0]));
    out.push({ k: "Z" });
  }
  return out;
};

/** An arrow's length and its base's width, and a dot's diameter, in stroke widths (the engine's). */
export const ARROW_LENGTH = 3;
export const DOT_DIAMETER = 2.5;
const KAPPA = 0.5522848;

/** An open outline with its end marks: the outline stopped short under an arrow, and each mark as a filled outline. */
export const withMarkers = (cmds: Cmd[], width: number, start: StrokeCap, end: StrokeCap): { cmds: Cmd[]; marks: Cmd[][] } => {
  const marks: Cmd[][] = [];
  if (cmds.length < 2 || cmds.some((c) => c.k === "Z") || width <= 0 || cmds[0].k !== "M") return { cmds, marks };
  const out = cmds.slice();
  const unit = (x: number, y: number) => {
    const l = Math.hypot(x, y);
    return l > 1e-6 ? { x: x / l, y: y / l } : null;
  };
  const sub = (a: Pt, b: Pt) => unit(a.x - b.x, a.y - b.y);
  const back = (p: Pt, d: Pt, t: number) => ({ x: p.x - d.x * t, y: p.y - d.y * t });
  const endOf = (c: Cmd) => (c.k === "Z" ? null : c.p);
  const last = out.length - 1;
  const beforeLast = endOf(out[last - 1]);
  const first = (out[0] as { p: Pt }).p;
  const lc = out[last];
  const endAt =
    lc.k === "L" ? (beforeLast ? sub(lc.p, beforeLast) : null)
    : lc.k === "Q" ? sub(lc.p, lc.a) ?? (beforeLast ? sub(lc.p, beforeLast) : null)
    : lc.k === "C" ? sub(lc.p, lc.b) ?? sub(lc.p, lc.a) ?? (beforeLast ? sub(lc.p, beforeLast) : null)
    : null;
  const fc = out[1];
  const startAt =
    fc.k === "L" ? sub(first, fc.p)
    : fc.k === "Q" ? sub(first, fc.a) ?? sub(first, fc.p)
    : fc.k === "C" ? sub(first, fc.a) ?? sub(first, fc.b) ?? sub(first, fc.p)
    : null;
  const mark = (kind: StrokeCap, at: Pt, d: Pt): Cmd[] | null => {
    if (kind === "arrow") {
      const len = ARROW_LENGTH * width;
      const half = len / 2;
      const base = back(at, d, len);
      const n = { x: -d.y, y: d.x };
      return [
        { k: "M", p: at },
        { k: "L", p: { x: base.x + n.x * half, y: base.y + n.y * half } },
        { k: "L", p: { x: base.x - n.x * half, y: base.y - n.y * half } },
        { k: "Z" },
      ];
    }
    if (kind === "round") {
      const r = (DOT_DIAMETER * width) / 2;
      const k = r * KAPPA;
      const { x: cx, y: cy } = at;
      return [
        { k: "M", p: { x: cx + r, y: cy } },
        { k: "C", a: { x: cx + r, y: cy + k }, b: { x: cx + k, y: cy + r }, p: { x: cx, y: cy + r } },
        { k: "C", a: { x: cx - k, y: cy + r }, b: { x: cx - r, y: cy + k }, p: { x: cx - r, y: cy } },
        { k: "C", a: { x: cx - r, y: cy - k }, b: { x: cx - k, y: cy - r }, p: { x: cx, y: cy - r } },
        { k: "C", a: { x: cx + k, y: cy - r }, b: { x: cx + r, y: cy - k }, p: { x: cx + r, y: cy } },
        { k: "Z" },
      ];
    }
    return null;
  };
  const trim = ARROW_LENGTH * width * 0.9;
  if (endAt && lc.k !== "M" && lc.k !== "Z") {
    const m = mark(end, lc.p, endAt);
    if (m) marks.push(m);
    if (end === "arrow") {
      out[last] =
        lc.k === "L" ? { k: "L", p: back(lc.p, endAt, trim) }
        : lc.k === "Q" ? { k: "Q", a: back(lc.a, endAt, trim), p: back(lc.p, endAt, trim) }
        : { k: "C", a: lc.a, b: back(lc.b, endAt, trim), p: back(lc.p, endAt, trim) };
    }
  }
  if (startAt) {
    const m = mark(start, first, startAt);
    if (m) marks.push(m);
    if (start === "arrow") {
      out[0] = { k: "M", p: back(first, startAt, trim) };
      const c1 = out[1];
      if (c1.k === "Q") out[1] = { k: "Q", a: back(c1.a, startAt, trim), p: c1.p };
      else if (c1.k === "C") out[1] = { k: "C", a: back(c1.a, startAt, trim), b: c1.b, p: c1.p };
    }
  }
  return { cmds: out, marks };
};

/** A stroke's dashes for its style (the engine's): 4-width dashes with 2-width gaps, or round dots every 2 widths. */
export const dashes = (style: StrokeStyle | undefined, width: number): number[] =>
  style === "dashed" ? [4 * width, 2 * width] : style === "dotted" ? [0.001, 2 * width] : [];

/** Trace `cmds` on a 2D context (a new path). */
export const trace = (ctx: CanvasRenderingContext2D, cmds: Cmd[]) => {
  ctx.beginPath();
  for (const c of cmds) {
    if (c.k === "M") ctx.moveTo(c.p.x, c.p.y);
    else if (c.k === "L") ctx.lineTo(c.p.x, c.p.y);
    else if (c.k === "C") ctx.bezierCurveTo(c.a.x, c.a.y, c.b.x, c.b.y, c.p.x, c.p.y);
    else if (c.k === "Q") ctx.quadraticCurveTo(c.a.x, c.a.y, c.p.x, c.p.y);
    else ctx.closePath();
  }
};

/** The outline of a shape drawn by its outline (the new shapes and the pen), or null for the app's first ones. */
export const outlineOf = (clip: ShapeClipProps, w: number, h: number, cornerRadius = 0): Cmd[] | null => {
  const v = vertices(clip.shapeType, w, h);
  if (v) return roundedPolygon(v, cornerRadius);
  if ((clip.shapeType === "line" || clip.shapeType === "arrow") && clip.path) return bezierPath(boxNodes(clip.path, w, h), false);
  if (clip.shapeType === "arrow") return bezierPath(boxNodes([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], w, h), false);
  if (clip.shapeType === "path") return bezierPath(boxNodes(clip.path ?? [], w, h), !!clip.pathClosed);
  return null;
};

const rgba = (hex: string | undefined, opacity: number) => {
  const h = (hex ?? "#000000").replace("#", "");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) || 0;
  return `rgba(${n(0)}, ${n(2)}, ${n(4)}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
};

/**
 * Draw a shape by its outline as the engine does: its shadow (offset by its distance and
 * angle), its fill, its stroke (dashed or dotted) and the marks on its open ends.
 */
export const drawShape = (ctx: CanvasRenderingContext2D, clip: ShapeClipProps, w: number, h: number, cornerRadius = 0) => {
  const outline = outlineOf(clip, w, h, cornerRadius);
  if (!outline) return;
  const width = clip.strokeWidth ?? 2;
  const stroke = strokeOn(clip) && width > 0;
  const fill = fillOn(clip);
  const { cmds, marks } = stroke && isOpenShape(clip) ? withMarkers(outline, width, capOf(clip, "start"), capOf(clip, "end")) : { cmds: outline, marks: [] as Cmd[][] };
  const paint = (fillStyle: string | null, strokeStyle: string | null) => {
    if (fill && fillStyle) {
      trace(ctx, cmds);
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (stroke && strokeStyle) {
      trace(ctx, cmds);
      ctx.lineWidth = width;
      ctx.miterLimit = 4;
      ctx.lineJoin = "miter";
      ctx.lineCap = clip.strokeStyle === "dotted" ? "round" : "butt";
      ctx.setLineDash(dashes(clip.strokeStyle, width));
      ctx.strokeStyle = strokeStyle;
      ctx.stroke();
      ctx.setLineDash([]);
      for (const m of marks) {
        trace(ctx, m);
        ctx.fillStyle = strokeStyle;
        ctx.fill();
      }
    }
  };
  if (clip.shadowEnabled) {
    const a = ((clip.shadowAngle ?? 45) * Math.PI) / 180;
    const d = clip.shadowDistance ?? 0;
    ctx.save();
    ctx.translate(d * Math.cos(a), d * Math.sin(a));
    const s = rgba(clip.shadowColor, clip.shadowOpacity ?? 50);
    paint(s, s);
    ctx.restore();
  }
  paint(rgba(clip.fill, clip.fillOpacity ?? 100), rgba(clip.stroke, clip.strokeOpacity ?? 100));
};
