import React, { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Line, Rect, Shape as KShape } from "react-konva";
import type Konva from "konva";
import { toast } from "sonner";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { dropStrayPenShapes, pathPatch, usePenStore, worldPoints, type WorldPoint } from "@/lib/pen";
import type { ShapeClipProps } from "@/lib/types";

/**
 * The Pen on the canvas (lib/pen.ts): the path being drawn, with the point under the cursor
 * and a line from the last point to it; or a finished pen shape's points while it's edited.
 * Its own marks: points as small white rings (the selected one filled with the accent),
 * handles as dots on thin lines, the outline being edited in the accent. In world units,
 * inside the preview's canvas group; sizes stay the same on screen whatever the zoom.
 */

const ACCENT = "#ae81ce";
/** How near (screen pixels) a press must be to grab a point, a handle or the outline. */
const GRAB = 7;
/** A press moved this far (screen pixels) pulls out handles instead of making a corner. */
const DRAG = 3;
/** Two presses this close in time and place are a double-click's, not two points. */
const DOUBLE_MS = 350;

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** The point on a cubic at `t`, and its split there (de Casteljau). */
const split = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number) => {
  const lerp = (a: Pt, b: Pt) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = lerp(p0, p1), b = lerp(p1, p2), c = lerp(p2, p3);
  const d = lerp(a, b), e = lerp(b, c);
  const m = lerp(d, e);
  return { m, a, d, e, c };
};

/** A segment's four control points (from point i to the next). */
const segment = (pts: WorldPoint[], i: number) => {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  return [
    { x: a.x, y: a.y },
    { x: a.x + a.outX, y: a.y + a.outY },
    { x: b.x + b.inX, y: b.y + b.inY },
    { x: b.x, y: b.y },
  ] as const;
};

/** The outline through `pts` on a 2D context. */
const tracePath = (ctx: CanvasRenderingContext2D, pts: WorldPoint[], closed: boolean) => {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const [, p1, p2, p3] = segment(pts, i);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  }
  if (closed) ctx.closePath();
};

const PenOverlay: React.FC<{ rectWidth: number; rectHeight: number; scale: number; position: Pt }> = ({ rectWidth, rectHeight, scale, position }) => {
  const drawingClipId = usePenStore((s) => s.drawingClipId);
  const points = usePenStore((s) => s.points);
  const editingClipId = usePenStore((s) => s.editingClipId);
  const selected = usePenStore((s) => s.selected);
  const drawingClip = useClipStore((s) => (drawingClipId ? (s.getClipById(drawingClipId) as ShapeClipProps | undefined) : undefined));
  const editingClip = useClipStore((s) => (editingClipId ? (s.getClipById(editingClipId) as ShapeClipProps | undefined) : undefined));
  const selectedIds = useControlsStore((s) => s.selectedClipIds);
  const [hover, setHover] = useState<Pt | null>(null);
  const press = useRef<{ at: Pt; index: number; moved: boolean; kind: "new" | "close" | "anchor" | "in" | "out"; time: number; base?: WorldPoint[] } | null>(null);
  const lastAdd = useRef<{ at: Pt; time: number } | null>(null);
  const u = 1 / Math.max(scale, 1e-4);

  const editPoints = useMemo(() => (editingClip ? worldPoints(editingClip) : []), [editingClip]);

  // A pen shape half drawn with no pen drawing it (the app was closed while drawing) goes.
  const stray = useClipStore((s) =>
    s.clips
      .filter((c) => c.type === "shape" && (c as ShapeClipProps).penDrawing && c.clipId !== drawingClipId)
      .map((c) => c.clipId)
      .join(","),
  );
  useEffect(() => {
    if (stray) void dropStrayPenShapes();
  }, [stray]);

  // Editing ends when the shape goes or another clip is selected.
  useEffect(() => {
    if (!editingClipId) return;
    if (!editingClip || !selectedIds.includes(editingClipId)) usePenStore.getState().edit(null);
  }, [editingClipId, editingClip, selectedIds]);
  // The shape being drawn gone (undone, deleted): the pen stops.
  useEffect(() => {
    if (drawingClipId && !drawingClip) usePenStore.setState({ drawingClipId: null, points: [] });
  }, [drawingClipId, drawingClip]);

  // Keys while drawing or editing: they're the pen's, not the timeline's.
  useEffect(() => {
    if (!drawingClipId && !editingClipId) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const pen = usePenStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (pen.drawingClipId) {
        if (e.key === "Escape" || e.key === "Enter") {
          e.preventDefault();
          e.stopImmediatePropagation();
          void pen.finish(false);
        } else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
          // ⌘Z takes the last point back (and with none, stops drawing).
          e.preventDefault();
          e.stopImmediatePropagation();
          if (pen.points.length) pen.setPoints(pen.points.slice(0, -1));
          else void pen.cancel();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (pen.points.length) pen.setPoints(pen.points.slice(0, -1));
        }
        return;
      }
      if (pen.editingClipId) {
        if (e.key === "Escape" || e.key === "Enter") {
          e.preventDefault();
          e.stopImmediatePropagation();
          pen.edit(null);
        } else if ((e.key === "Delete" || e.key === "Backspace") && pen.selected != null) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const clip = useClipStore.getState().getClipById(pen.editingClipId) as ShapeClipProps | undefined;
          if (!clip) return;
          const pts = worldPoints(clip);
          if (pts.length <= 2) {
            toast("Keep at least two endpoints");
            return;
          }
          pts.splice(pen.selected, 1);
          useClipStore.getState().updateClip(clip.clipId, pathPatch(clip, pts));
          pen.select(null);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawingClipId, editingClipId]);

  if (!drawingClipId && !(editingClipId && editingClip)) return null;

  const world = (e: Konva.KonvaEventObject<MouseEvent>): Pt | null => {
    const p = e.target.getStage()?.getPointerPosition();
    return p ? { x: (p.x - position.x) / scale, y: (p.y - position.y) / scale } : null;
  };

  // ---- Drawing ----
  const onDrawDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    if (e.evt.button !== 0) return;
    const at = world(e);
    if (!at) return;
    const pen = usePenStore.getState();
    const now = performance.now();
    // A double-click's second press adds nothing (the double-click finishes the path).
    if (lastAdd.current && now - lastAdd.current.time < DOUBLE_MS && dist(lastAdd.current.at, at) * scale < 4) return;
    const pts = pen.points;
    if (pts.length >= 3 && dist(pts[0], at) * scale <= GRAB) {
      press.current = { at, index: 0, moved: false, kind: "close", time: now };
      return;
    }
    pen.setPoints([...pts, { x: at.x, y: at.y, inX: 0, inY: 0, outX: 0, outY: 0 }]);
    press.current = { at, index: pts.length, moved: false, kind: "new", time: now };
    lastAdd.current = { at, time: now };
  };
  const onDrawMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const at = world(e);
    if (!at) return;
    setHover(at);
    const p = press.current;
    if (!p || p.kind !== "new") return;
    if (!p.moved && dist(p.at, at) * scale < DRAG) return;
    p.moved = true;
    // A smooth point: the out handle follows the cursor, the in handle mirrors it.
    const pen = usePenStore.getState();
    const pts = pen.points.slice();
    const pt = pts[p.index];
    if (!pt) return;
    const dx = at.x - pt.x;
    const dy = at.y - pt.y;
    pts[p.index] = { ...pt, outX: dx, outY: dy, inX: -dx, inY: -dy };
    pen.setPoints(pts);
  };
  const onDrawUp = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const p = press.current;
    press.current = null;
    if (p?.kind === "close") void usePenStore.getState().finish(true);
  };
  const onDrawDouble = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    void usePenStore.getState().finish(false);
  };

  // ---- Editing ----
  const commit = (pts: WorldPoint[]) => {
    const clip = editingClip;
    if (!clip) return;
    useClipStore.getState().updateClip(clip.clipId, pathPatch(clip, pts));
  };
  const onEditDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0 || !editingClip) return;
    const at = world(e);
    if (!at) return;
    const pts = editPoints;
    const near = (q: Pt) => dist(q, at) * scale <= GRAB;
    const sel = usePenStore.getState().selected;
    // The selected point's handles first, then any point, then the outline.
    if (sel != null && pts[sel]) {
      const pt = pts[sel];
      if ((pt.outX || pt.outY) && near({ x: pt.x + pt.outX, y: pt.y + pt.outY })) {
        e.cancelBubble = true;
        press.current = { at, index: sel, moved: false, kind: "out", time: performance.now(), base: pts };
        return;
      }
      if ((pt.inX || pt.inY) && near({ x: pt.x + pt.inX, y: pt.y + pt.inY })) {
        e.cancelBubble = true;
        press.current = { at, index: sel, moved: false, kind: "in", time: performance.now(), base: pts };
        return;
      }
    }
    const hit = pts.findIndex((q) => near(q));
    if (hit >= 0) {
      e.cancelBubble = true;
      usePenStore.getState().select(hit);
      press.current = { at, index: hit, moved: false, kind: "anchor", time: performance.now(), base: pts };
      return;
    }
    // On the outline: a new point there, the curve kept as it was.
    const closed = !!editingClip.pathClosed;
    const segs = closed ? pts.length : pts.length - 1;
    let best: { i: number; t: number; d: number } | null = null;
    for (let i = 0; i < segs; i++) {
      const [p0, p1, p2, p3] = segment(pts, i);
      for (let k = 1; k < 48; k++) {
        const t = k / 48;
        const d = dist(split(p0, p1, p2, p3, t).m, at);
        if (!best || d < best.d) best = { i, t, d };
      }
    }
    if (best && best.d * scale <= GRAB) {
      e.cancelBubble = true;
      const [p0, p1, p2, p3] = segment(pts, best.i);
      const s = split(p0, p1, p2, p3, best.t);
      const next = pts.map((q) => ({ ...q }));
      const a = next[best.i];
      const bi = (best.i + 1) % next.length;
      const b = next[bi];
      a.outX = s.a.x - a.x;
      a.outY = s.a.y - a.y;
      b.inX = s.c.x - b.x;
      b.inY = s.c.y - b.y;
      const curved = !(p1.x === p0.x && p1.y === p0.y && p2.x === p3.x && p2.y === p3.y);
      const added: WorldPoint = curved
        ? { x: s.m.x, y: s.m.y, inX: s.d.x - s.m.x, inY: s.d.y - s.m.y, outX: s.e.x - s.m.x, outY: s.e.y - s.m.y }
        : { x: s.m.x, y: s.m.y, inX: 0, inY: 0, outX: 0, outY: 0 };
      if (!curved) {
        a.outX = a.outY = 0;
        b.inX = b.inY = 0;
      }
      next.splice(best.i + 1, 0, added);
      commit(next);
      usePenStore.getState().select(best.i + 1);
      return;
    }
    // Anywhere else: editing ends.
    usePenStore.getState().edit(null);
  };
  const onEditMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = press.current;
    if (!p || !p.base) return;
    const at = world(e);
    if (!at) return;
    if (!p.moved && dist(p.at, at) * scale < DRAG) return;
    p.moved = true;
    const next = p.base.map((q) => ({ ...q }));
    const pt = next[p.index];
    if (p.kind === "anchor") {
      pt.x = p.base[p.index].x + (at.x - p.at.x);
      pt.y = p.base[p.index].y + (at.y - p.at.y);
    } else {
      // A handle: the other mirrors its direction, keeping its own length (⌥ drags it alone).
      const dx = at.x - pt.x;
      const dy = at.y - pt.y;
      const len = Math.hypot(dx, dy) || 1;
      const [ox, oy] = p.kind === "out" ? [pt.inX, pt.inY] : [pt.outX, pt.outY];
      const olen = Math.hypot(ox, oy);
      if (p.kind === "out") {
        pt.outX = dx;
        pt.outY = dy;
        if (!e.evt.altKey && olen > 0) [pt.inX, pt.inY] = [(-dx / len) * olen, (-dy / len) * olen];
      } else {
        pt.inX = dx;
        pt.inY = dy;
        if (!e.evt.altKey && olen > 0) [pt.outX, pt.outY] = [(-dx / len) * olen, (-dy / len) * olen];
      }
    }
    commit(next);
  };
  const onEditUp = () => {
    press.current = null;
  };

  const ring = (p: Pt, key: string, on: boolean, big = false) => (
    <Circle key={key} x={p.x} y={p.y} radius={(big ? 6 : 4.5) * u} fill={on ? ACCENT : "#ffffff"} stroke={on ? "#ffffff" : ACCENT} strokeWidth={1.5 * u} listening={false} />
  );
  const handles = (pt: WorldPoint, key: string) =>
    [
      [pt.inX, pt.inY, "in"],
      [pt.outX, pt.outY, "out"],
    ]
      .filter(([dx, dy]) => dx || dy)
      .map(([dx, dy, k]) => (
        <Group key={`${key}-${k}`} listening={false}>
          <Line points={[pt.x, pt.y, pt.x + (dx as number), pt.y + (dy as number)]} stroke={ACCENT} strokeWidth={1 * u} />
          <Circle x={pt.x + (dx as number)} y={pt.y + (dy as number)} radius={3 * u} fill={ACCENT} stroke="#ffffff" strokeWidth={1 * u} />
        </Group>
      ));

  // A press anywhere on the player belongs to the pen while it draws or edits.
  const catcher = { x: -rectWidth * 4, y: -rectHeight * 4, width: rectWidth * 9, height: rectHeight * 9 };

  if (drawingClipId) {
    const last = points[points.length - 1];
    const closable = points.length >= 3 && !!hover && dist(points[0], hover) * scale <= GRAB;
    const width = drawingClip?.strokeWidth ?? 2;
    const strokeColor = drawingClip?.stroke ?? "#CCCCCC";
    const pressing = press.current?.kind === "new" && press.current.moved;
    return (
      <Group name="pen-overlay">
        <Rect
          {...catcher}
          name="pen-catcher"
          fill="rgba(0,0,0,0.001)"
          onMouseDown={onDrawDown}
          onMouseMove={onDrawMove}
          onMouseUp={onDrawUp}
          onDblClick={onDrawDouble}
          onMouseLeave={() => setHover(null)}
        />
        {/* The path so far, in the shape's stroke. */}
        <KShape
          listening={false}
          sceneFunc={(ctx) => {
            const c = ctx._context as CanvasRenderingContext2D;
            if (points.length < 2) return;
            tracePath(c, points, false);
            c.lineWidth = width;
            c.lineJoin = "miter";
            c.miterLimit = 4;
            c.strokeStyle = strokeColor;
            c.stroke();
          }}
        />
        {/* From the last point to the cursor. */}
        {last && hover && !pressing && (
          <Line
            listening={false}
            points={[last.x, last.y, closable ? points[0].x : hover.x, closable ? points[0].y : hover.y]}
            stroke={ACCENT}
            strokeWidth={1 * u}
            dash={[4 * u, 3 * u]}
          />
        )}
        {points.map((p, i) => ring(p, `p${i}`, i === points.length - 1, i === 0 && closable))}
        {last && handles(last, "last")}
      </Group>
    );
  }

  const clip = editingClip!;
  return (
    <Group name="pen-overlay">
      <Rect {...catcher} name="pen-catcher" fill="rgba(0,0,0,0.001)" onMouseDown={onEditDown} onMouseMove={onEditMove} onMouseUp={onEditUp} />
      <KShape
        listening={false}
        sceneFunc={(ctx) => {
          const c = ctx._context as CanvasRenderingContext2D;
          tracePath(c, editPoints, !!clip.pathClosed);
          c.lineWidth = 1 * u;
          c.strokeStyle = ACCENT;
          c.stroke();
        }}
      />
      {selected != null && editPoints[selected] && handles(editPoints[selected], "sel")}
      {editPoints.map((p, i) => ring(p, `e${i}`, i === selected))}
    </Group>
  );
};

export default PenOverlay;
