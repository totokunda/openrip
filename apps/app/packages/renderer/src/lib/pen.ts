import { create } from "zustand";
import type { PathPoint, ShapeClipProps } from "./types";

/**
 * The Stickers tab's Pen (CapCut's custom shape): drawing a path point by point on the
 * canvas, then editing its points.
 *
 * Drawing (CapCut's ContourVectorBrush in its create mode): the Pen tile adds a "Shape to
 * draw" clip at the playhead; each click on the canvas adds a corner, a press dragged pulls
 * out a smooth point's two handles (the other mirroring it); a click on the first point
 * (with three or more) closes the path and finishes, a double-click finishes it open, and
 * Esc or Return finishes it too (with fewer than two points the clip goes). ⌘Z takes the last
 * point back while drawing.
 *
 * Editing: a double-click on a pen shape shows its points; a point or a handle dragged moves
 * it, a click on the outline adds a point there, Delete removes the selected point (two are
 * kept at least), Esc or a click away finishes.
 *
 * Points being drawn are in world units with their handles as offsets; the clip holds them as
 * fractions of its box once it's finished (`PathPoint`).
 */
export interface WorldPoint {
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
}

interface PenState {
  /** The pen shape being drawn, and its points so far. */
  drawingClipId: string | null;
  points: WorldPoint[];
  /** The pen shape whose points are shown for editing, and the selected point. */
  editingClipId: string | null;
  selected: number | null;
  start: (clipId: string) => void;
  setPoints: (points: WorldPoint[]) => void;
  /** Finish drawing: the path closed (a click on its first point) or open. */
  finish: (close: boolean) => Promise<void>;
  /** Stop drawing and remove the shape (nothing drawn). */
  cancel: () => Promise<void>;
  edit: (clipId: string | null) => void;
  select: (index: number | null) => void;
}

/** The smallest box a finished path gets (world units), for a straight line's thickness. */
const MIN_BOX = 1;

/** Points along each segment of a path, for its box (curves bulge past their points). */
const samples = (pts: WorldPoint[], closed: boolean) => {
  const out: { x: number; y: number }[] = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const p0 = { x: a.x, y: a.y };
    const p1 = { x: a.x + a.outX, y: a.y + a.outY };
    const p2 = { x: b.x + b.inX, y: b.y + b.inY };
    const p3 = { x: b.x, y: b.y };
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const u = 1 - t;
      out.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    }
  }
  if (!out.length) out.push(...pts.map((p) => ({ x: p.x, y: p.y })));
  return out;
};

/** A path's box (world units) and its points as fractions of it. */
export const fitPath = (pts: WorldPoint[], closed: boolean) => {
  const s = samples(pts, closed);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of s) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  let w = x1 - x0;
  let h = y1 - y0;
  if (w < MIN_BOX) {
    x0 -= (MIN_BOX - w) / 2;
    w = MIN_BOX;
  }
  if (h < MIN_BOX) {
    y0 -= (MIN_BOX - h) / 2;
    h = MIN_BOX;
  }
  const path: PathPoint[] = pts.map((p) => ({
    x: (p.x - x0) / w,
    y: (p.y - y0) / h,
    ...(p.inX || p.inY ? { inX: p.inX / w, inY: p.inY / h } : {}),
    ...(p.outX || p.outY ? { outX: p.outX / w, outY: p.outY / h } : {}),
  }));
  return { box: { x: x0, y: y0, width: w, height: h }, path };
};

/**
 * A finished pen shape's points in world units, through its box and transform (scaled and
 * turned about the box's top-left, as the preview draws it).
 */
export const worldPoints = (clip: ShapeClipProps): WorldPoint[] => {
  const t = clip.transform;
  if (!t) return [];
  const sx = (t.width || 1) * (t.scaleX ?? 1);
  const sy = (t.height || 1) * (t.scaleY ?? 1);
  const r = ((t.rotation ?? 0) * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  const turn = (x: number, y: number) => ({ x: x * c - y * s, y: x * s + y * c });
  return (clip.path ?? []).map((p) => {
    const at = turn(p.x * sx, p.y * sy);
    const i = turn((p.inX ?? 0) * sx, (p.inY ?? 0) * sy);
    const o = turn((p.outX ?? 0) * sx, (p.outY ?? 0) * sy);
    return { x: t.x + at.x, y: t.y + at.y, inX: i.x, inY: i.y, outX: o.x, outY: o.y };
  });
};

/**
 * Edited points back into the clip: its box refitted around them in its own (unturned)
 * frame, the box's top-left moved so nothing else shifts, scale folded into the size.
 */
export const pathPatch = (clip: ShapeClipProps, pts: WorldPoint[]): Partial<ShapeClipProps> => {
  const t = clip.transform!;
  const r = ((t.rotation ?? 0) * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  // Into the shape's frame: unturned about its top-left.
  const local = pts.map((p) => {
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const un = (x: number, y: number) => ({ x: x * c + y * s, y: -x * s + y * c });
    const at = un(dx, dy);
    const i = un(p.inX, p.inY);
    const o = un(p.outX, p.outY);
    return { x: at.x, y: at.y, inX: i.x, inY: i.y, outX: o.x, outY: o.y };
  });
  const { box, path } = fitPath(local, !!clip.pathClosed);
  // The new box's top-left, turned back into the world.
  const origin = { x: t.x + box.x * c - box.y * s, y: t.y + box.x * s + box.y * c };
  return { path, transform: { ...t, x: origin.x, y: origin.y, width: box.width, height: box.height, scaleX: 1, scaleY: 1 } };
};

export const usePenStore = create<PenState>((set, get) => ({
  drawingClipId: null,
  points: [],
  editingClipId: null,
  selected: null,
  start: (clipId) => set({ drawingClipId: clipId, points: [], editingClipId: null, selected: null }),
  setPoints: (points) => set({ points }),
  finish: async (close) => {
    const { drawingClipId, points } = get();
    if (!drawingClipId) return;
    if (points.length < 2) return get().cancel();
    const [{ useClipStore }, { useControlsStore }, { withoutHistory }] = await Promise.all([import("./clip"), import("./control"), import("./history")]);
    const store = useClipStore.getState();
    const clip = store.getClipById(drawingClipId) as ShapeClipProps | undefined;
    set({ drawingClipId: null, points: [] });
    if (!clip) return;
    const closed = close && points.length >= 3;
    const { box, path } = fitPath(points, closed);
    // The shape being drawn was never a step of its own: the finished one is added as one.
    const timeline = store.timelines.find((t) => t.timelineId === clip.timelineId);
    withoutHistory(() => store.removeClip(clip.clipId));
    const after = useClipStore.getState();
    if (!after.timelines.some((t) => t.timelineId === clip.timelineId) && timeline) after.addTimeline({ ...timeline }, -1);
    const finished: ShapeClipProps = {
      ...clip,
      penDrawing: false,
      path,
      pathClosed: closed,
      transform: { ...clip.transform!, ...box, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useClipStore.getState().addClip(finished);
    useControlsStore.getState().setSelectedClipIds([finished.clipId]);
  },
  cancel: async () => {
    const { drawingClipId } = get();
    set({ drawingClipId: null, points: [] });
    if (!drawingClipId) return;
    const [{ useClipStore }, { withoutHistory }] = await Promise.all([import("./clip"), import("./history")]);
    withoutHistory(() => useClipStore.getState().removeClip(drawingClipId));
  },
  edit: (clipId) => set({ editingClipId: clipId, selected: null }),
  select: (index) => set({ selected: index }),
}));

/**
 * The Pen tile: a "Shape to draw" clip at the playhead (not a step of its own), and the pen
 * drawing it. Anything still being drawn is finished first.
 */
export const startPen = async (opts: { startFrame?: number } = {}) => {
  const pen = usePenStore.getState();
  if (pen.drawingClipId) await pen.finish(false);
  const [{ addShapeNow, shapeDeps }, { withoutHistory }] = await Promise.all([import("./shape-presets"), import("./history")]);
  const deps = await shapeDeps();
  let id = "";
  withoutHistory(() => {
    id = addShapeNow(deps, "path", opts);
  });
  deps.useViewportStore.getState().setTool("pointer");
  usePenStore.getState().start(id);
  return id;
};

/**
 * A pen shape left half drawn (the app closed while drawing, or the project reopened) has no
 * pen drawing it: it goes, as it never was a step.
 */
export const dropStrayPenShapes = async () => {
  const [{ useClipStore }, { withoutHistory }] = await Promise.all([import("./clip"), import("./history")]);
  const { drawingClipId } = usePenStore.getState();
  const stray = useClipStore.getState().clips.filter((c) => c.type === "shape" && (c as ShapeClipProps).penDrawing && c.clipId !== drawingClipId);
  if (stray.length) withoutHistory(() => stray.forEach((c) => useClipStore.getState().removeClip(c.clipId)));
};
