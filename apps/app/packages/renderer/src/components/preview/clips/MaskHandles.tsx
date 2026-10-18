import React, { useCallback, useEffect, useRef } from "react";
import { Circle, Ellipse, Group, Line, Path, Rect, RegularPolygon, Star } from "react-konva";
import Konva from "konva";
import { KonvaEventObject } from "konva/lib/Node";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useViewportStore } from "@/lib/viewport";
import { useMaskStore } from "@/lib/mask";
import { Bounds, boundsCentre, editMaskPose, heartPoints, maskFrame, placeBounds, textBox } from "@/lib/mask-shapes";
import type { MaskClipProps, MaskData, MaskPenPoint } from "@/lib/types";

/**
 * A mask's outline and CapCut's handles on the canvas, in the mask's own units (MaskPreview
 * puts it over its clip). Selected, a shape shows its box dashed with a size handle at each
 * corner, the feather handle above it (drag up to soften the edge) and the rotate handle below
 * it, and a rectangle the round-corner handle inside its top-left corner; Split is a line
 * across the picture and Filmstrip a band whose lines are dragged apart, each with the feather
 * and rotate handles; a pen path shows its anchors and their curve handles. Drag the shape
 * itself to move it. A drag edits the mask's pose at the playhead by CapCut's keyframe rule
 * (editMaskPose): one undo step, the engine redrawing as it goes.
 */

type Drag =
  | { kind: "move"; from: [number, number]; pose: MaskData }
  | { kind: "corner"; sx: number; sy: number; pose: MaskData }
  | { kind: "feather" | "rotate" | "round" | "band"; pose: MaskData }
  | { kind: "anchor" | "in" | "out"; index: number; pose: MaskData };

/** Screen sizes of the handles, in pixels. */
const CORNER = 5;
const KNOB = 10;
const GAP = 26;
const FEATHER_RANGE = 80;
/** Our own glyphs for the feather and rotate knobs (24-unit boxes). */
const FEATHER_ICON = "M7 13 L12 8 L17 13 M7 18 L12 13 L17 18";
const ROTATE_ICON = "M17.5 9 A6.5 6.5 0 1 0 18.5 13 M17.5 4.5 V9 H13";

const MaskHandles: React.FC<{
  mask: MaskClipProps;
  clipId: string;
  pose: MaskData;
  /** The picture's box in the mask's units (Split and Filmstrip run across it). */
  picture: { w: number; h: number };
  /** The scale of the mask's units on screen besides the viewport's (the clip's over the mask's). */
  scale: number;
  interactive: boolean;
  tint: boolean;
}> = ({ mask, clipId, pose, picture, scale, interactive, tint }) => {
  const viewScale = useViewportStore((s) => s.scale);
  const tool = useViewportStore((s) => s.tool);
  const isFullscreen = useControlsStore((s) => s.isFullscreen);
  const selectedMaskId = useControlsStore((s) => s.selectedMaskId);
  const setSelectedMaskId = useControlsStore((s) => s.setSelectedMaskId);
  const setIsOverMask = useMaskStore((s) => s.setIsOverMask);
  const groupRef = useRef<Konva.Group>(null);
  const drag = useRef<Drag | null>(null);
  const selected = selectedMaskId === mask.id && interactive && !isFullscreen;
  // One screen pixel in the mask's units.
  const k = 1 / Math.max(1e-6, viewScale * scale);

  // Persist a new pose at the playhead (CapCut's rule: keyed, a pose there; static, its one pose).
  const persist = useCallback(
    (make: (p: MaskData) => MaskData) => {
      const state = useClipStore.getState();
      const clip = state.clips.find((c) => c.clipId === clipId);
      const now = ((clip as any)?.masks ?? []).find((m: MaskClipProps) => m.id === mask.id) as MaskClipProps | undefined;
      if (!clip || !now) return;
      const { focusFrame, fps } = useControlsStore.getState();
      // (The feather goes on the mask while it's static, on the pose once keyed.)
      const next = editMaskPose(now, maskFrame(clip, focusFrame), fps || 24, make);
      const masks = ((clip as any).masks ?? []).map((m: MaskClipProps) => (m.id === mask.id ? next : m));
      state.updateClip(clipId, { masks } as any);
    },
    [clipId, mask.id],
  );

  // The box as centre, half-sizes and turn.
  const b = pose.shapeBounds as Bounds | undefined;
  const c: [number, number] = b ? boundsCentre(b) : [0, 0];
  const [hw, hh] = b ? [(b.width * (b.scaleX ?? 1)) / 2, (b.height * (b.scaleY ?? 1)) / 2] : [0, 0];
  const theta = b?.rotation ?? 0;
  const shape = b?.shapeType ?? "rectangle";
  const rad = (theta * Math.PI) / 180;
  const [cs, sn] = [Math.cos(rad), Math.sin(rad)];
  // A point given in the box's own frame (x right, y down from its centre) in the mask's units.
  const at = (u: number, v: number): [number, number] => [c[0] + cs * u - sn * v, c[1] + sn * u + cs * v];
  // The pointer in the box's frame.
  const local = (p: { x: number; y: number }, from = c, turn = rad): [number, number] => {
    const [dx, dy] = [p.x - from[0], p.y - from[1]];
    return [Math.cos(turn) * dx + Math.sin(turn) * dy, -Math.sin(turn) * dx + Math.cos(turn) * dy];
  };
  const feather = (pose as any).featherAmount ?? mask.featherAmount ?? 0;
  const reach = Math.hypot(picture.w, picture.h);
  // Where the feather knob sits above the box (Split: above its line; Filmstrip: its top line).
  const top = shape === "linear" ? 0 : hh;
  const featherAt = at(0, -top - (GAP + (feather / 100) * FEATHER_RANGE) * k);
  const rotateAt = at(0, (shape === "linear" ? 0 : hh) + GAP * k);
  const round = shape === "rectangle" ? ((b?.cornerRadius ?? 0) / 100) * Math.min(hw, hh) : 0;
  const roundAt = at(-hw + (round + 10 * k) / Math.SQRT2, -hh + (round + 10 * k) / Math.SQRT2);

  const onMove = useCallback(() => {
    const d = drag.current;
    const g = groupRef.current;
    if (!d || !g) return;
    const p = g.getRelativePointerPosition();
    if (!p) return;
    const pb = d.pose.shapeBounds as Bounds | undefined;
    const pc: [number, number] = pb ? boundsCentre(pb) : [0, 0];
    const pr = ((pb?.rotation ?? 0) * Math.PI) / 180;
    const sized = (w: number, h: number) => (q: MaskData) => ({ ...q, shapeBounds: placeBounds({ ...(q.shapeBounds as Bounds), width: Math.max(2 * k, w), height: Math.max(2 * k, h), scaleX: 1, scaleY: 1 }, boundsCentre(q.shapeBounds as Bounds)) });
    switch (d.kind) {
      case "move": {
        const [dx, dy] = [p.x - d.from[0], p.y - d.from[1]];
        persist((q) => {
          if (q.shapeBounds) {
            const qb = d.pose.shapeBounds as Bounds;
            const [x, y] = boundsCentre(qb);
            return { ...q, shapeBounds: placeBounds({ ...(q.shapeBounds as Bounds) }, [x + dx, y + dy]) };
          }
          if (d.pose.penPath) return { ...q, penPath: { closed: true, points: d.pose.penPath.points.map((a) => ({ x: a.x + dx, y: a.y + dy, ix: a.ix + dx, iy: a.iy + dy, ox: a.ox + dx, oy: a.oy + dy })) } };
          if (d.pose.lassoPoints) return { ...q, lassoPoints: d.pose.lassoPoints.map((v, i) => v + (i % 2 ? dy : dx)) };
          return q;
        });
        break;
      }
      case "corner": {
        const [u, v] = local(p, pc, pr);
        if ((pb?.shapeType ?? "") === "text" && d.pose.text) {
          // A text scales: its em by how far the corner moved from the middle.
          const [w0, h0] = [(pb!.width * (pb!.scaleX ?? 1)) / 2, (pb!.height * (pb!.scaleY ?? 1)) / 2];
          const f = Math.max(0.05, Math.hypot(u, v) / Math.max(1e-6, Math.hypot(w0, h0)));
          const text = { ...d.pose.text, size: d.pose.text.size * f };
          const box = textBox(text);
          persist((q) => ({ ...sized(box.width, box.height)(q), text }));
        } else if ((pb?.shapeType ?? "") === "star" || (pb?.shapeType ?? "") === "polygon") {
          const s = Math.max(Math.abs(u) / Math.max(1e-6, pb!.width / 2), Math.abs(v) / Math.max(1e-6, pb!.height / 2));
          persist(sized(pb!.width * s, pb!.height * s));
        } else persist(sized(2 * Math.abs(u), 2 * Math.abs(v)));
        break;
      }
      case "band": {
        const [, v] = local(p, pc, pr);
        persist(sized(pb!.width, 2 * Math.abs(v)));
        break;
      }
      case "feather": {
        const [, v] = local(p, pc, pr);
        const edge = (pb?.shapeType ?? "") === "linear" ? 0 : (pb!.height * (pb!.scaleY ?? 1)) / 2;
        const amount = Math.max(0, Math.min(100, ((-v - edge) / k - GAP) / FEATHER_RANGE * 100));
        persist((q) => ({ ...q, featherAmount: Math.round(amount) }));
        break;
      }
      case "rotate": {
        // The knob hangs below the box: straight down is no turn.
        const deg = (Math.atan2(p.y - pc[1], p.x - pc[0]) * 180) / Math.PI - 90;
        const turned = ((deg % 360) + 540) % 360 - 180;
        persist((q) => ({ ...q, shapeBounds: placeBounds({ ...(q.shapeBounds as Bounds), rotation: Math.round(turned * 10) / 10 }, boundsCentre(q.shapeBounds as Bounds)) }));
        break;
      }
      case "round": {
        const [u, v] = local(p, pc, pr);
        const [w0, h0] = [(pb!.width * (pb!.scaleX ?? 1)) / 2, (pb!.height * (pb!.scaleY ?? 1)) / 2];
        // Along the diagonal in from the top-left corner.
        const along = ((u + w0) + (v + h0)) / Math.SQRT2 - 10 * k;
        const r = Math.max(0, Math.min(Math.min(w0, h0), along));
        persist((q) => ({ ...q, shapeBounds: { ...(q.shapeBounds as Bounds), cornerRadius: Math.round((r / Math.max(1e-6, Math.min(w0, h0))) * 100) } }));
        break;
      }
      case "anchor":
      case "in":
      case "out": {
        const pts = d.pose.penPath!.points;
        const a = pts[d.index];
        const next = pts.map((q, i): MaskPenPoint => {
          if (i !== d.index) return q;
          if (d.kind === "anchor") {
            const [dx, dy] = [p.x - a.x, p.y - a.y];
            return { x: p.x, y: p.y, ix: a.ix + dx, iy: a.iy + dy, ox: a.ox + dx, oy: a.oy + dy };
          }
          // A handle moves; the other mirrors it, so the curve stays smooth through the anchor.
          const [hx, hy] = [p.x, p.y];
          const [mx, my] = [2 * a.x - hx, 2 * a.y - hy];
          return d.kind === "out" ? { ...a, ox: hx, oy: hy, ix: mx, iy: my } : { ...a, ix: hx, iy: hy, ox: mx, oy: my };
        });
        persist((q) => ({ ...q, penPath: { closed: true, points: next } }));
        break;
      }
    }
  }, [persist, k]);

  const stop = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stop);
  }, [onMove]);
  useEffect(() => stop, [stop]);

  const start = (d: Drag) => (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!interactive) return;
    e.cancelBubble = true;
    if (selectedMaskId !== mask.id) {
      // A first press selects the mask (and its clip).
      setSelectedMaskId(mask.id);
      const { selectedClipIds, setSelectedClipIds } = useControlsStore.getState();
      if (!selectedClipIds.includes(clipId)) setSelectedClipIds([clipId]);
      if (d.kind !== "move") return;
    }
    drag.current = d;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
  };
  const press = (kind: Drag["kind"], extra: object = {}) => start({ kind, pose, ...extra } as Drag);
  const startMove = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const p = groupRef.current?.getRelativePointerPosition();
    if (p) start({ kind: "move", from: [p.x, p.y], pose })(e);
  };
  const cursor = (c: string) => ({
    onMouseEnter: (e: KonvaEventObject<MouseEvent>) => {
      const s = e.target.getStage()?.container();
      if (s && interactive) s.style.cursor = c;
    },
    onMouseLeave: (e: KonvaEventObject<MouseEvent>) => {
      const s = e.target.getStage()?.container();
      if (s) s.style.cursor = tool === "mask" ? "crosshair" : "default";
    },
  });

  const stroke = { stroke: "#ffffff", strokeWidth: 1.2, strokeScaleEnabled: false, shadowColor: "#000", shadowBlur: 2, shadowOpacity: 0.7, shadowForStrokeEnabled: true };
  const fill = tint ? "rgba(0,127,245,0.35)" : "rgba(0,0,0,0.001)";
  const body = { ...stroke, fill, listening: interactive, onMouseDown: startMove, onTouchStart: startMove, ...cursor(selected ? "move" : "pointer") };
  const knob = (pos: [number, number], icon: string, kind: Drag["kind"], cur: string, testId: string) => (
    <Group x={pos[0]} y={pos[1]} rotation={theta} name={testId} onMouseDown={press(kind)} onTouchStart={press(kind)} {...cursor(cur)}>
      <Circle radius={KNOB * k} fill="#ffffff" shadowColor="#000" shadowBlur={3} shadowOpacity={0.5} />
      <Path data={icon} x={-12 * k * 0.75} y={-12 * k * 0.75} scaleX={k * 0.75} scaleY={k * 0.75} stroke="#1c1c1c" strokeWidth={2} strokeScaleEnabled={false} lineCap="round" lineJoin="round" listening={false} />
    </Group>
  );

  // The outline of the shape itself.
  const outline = (() => {
    if (pose.penPath) {
      const pts = pose.penPath.points;
      const flat: number[] = [];
      pts.forEach((a, i) => {
        const n = pts[(i + 1) % pts.length];
        if (i === 0) flat.push(a.x, a.y);
        flat.push(a.ox, a.oy, n.ix, n.iy, n.x, n.y);
      });
      return <Line points={flat} bezier closed {...body} />;
    }
    if (pose.lassoPoints) return <Line points={pose.lassoPoints} closed {...body} />;
    if (pose.brushStrokes || !b) return null;
    const box = { x: c[0], y: c[1], rotation: theta };
    switch (shape) {
      case "ellipse":
      case "circle":
        return <Ellipse {...box} radiusX={hw} radiusY={hh} {...body} />;
      case "polygon":
        return <RegularPolygon {...box} sides={3} radius={Math.min((2 * hw) / Math.sqrt(3), (2 * hh) / 1.5)} {...body} />;
      case "star":
        return <Star {...box} numPoints={5} innerRadius={Math.min(hw, hh) / 2} outerRadius={Math.min(hw, hh)} {...body} />;
      case "heart":
        return <Line points={heartPoints(c[0], c[1], 2 * hw, 2 * hh, theta)} closed {...body} />;
      case "linear":
        return <Line name="mask-line" points={[...at(-reach, 0), ...at(reach, 0)]} {...body} hitStrokeWidth={16 * k} />;
      case "mirror":
        return (
          <Group>
            <Line name="mask-band" points={[...at(-reach, -hh), ...at(reach, -hh)]} {...stroke} listening={interactive} hitStrokeWidth={14 * k} onMouseDown={press("band")} onTouchStart={press("band")} {...cursor("ns-resize")} />
            <Line name="mask-band" points={[...at(-reach, hh), ...at(reach, hh)]} {...stroke} listening={interactive} hitStrokeWidth={14 * k} onMouseDown={press("band")} onTouchStart={press("band")} {...cursor("ns-resize")} />
            <Rect x={c[0]} y={c[1]} rotation={theta} offsetX={reach} offsetY={hh} width={2 * reach} height={2 * hh} fill={fill} listening={interactive} onMouseDown={startMove} onTouchStart={startMove} {...cursor("move")} />
          </Group>
        );
      case "text":
        return <Rect {...box} offsetX={hw} offsetY={hh} width={2 * hw} height={2 * hh} {...body} strokeWidth={0} />;
      default:
        return <Rect {...box} offsetX={hw} offsetY={hh} width={2 * hw} height={2 * hh} cornerRadius={round} {...body} />;
    }
  })();

  const boxed = b && shape !== "linear" && shape !== "mirror";
  return (
    <Group ref={groupRef} name={`mask-${mask.id}`} opacity={selected || tint ? 1 : 0.6} onMouseOver={() => interactive && setIsOverMask(true)} onMouseOut={() => setIsOverMask(false)}>
      {outline}
      {selected && boxed && (
        <>
          {/* The box, dashed, with its middle marked. */}
          <Rect x={c[0]} y={c[1]} rotation={theta} offsetX={hw} offsetY={hh} width={2 * hw} height={2 * hh} stroke="#ffffff" strokeWidth={1} strokeScaleEnabled={false} dash={[4 * k, 3 * k]} listening={false} />
          <Line points={[...at(-hw, 0), ...at(hw, 0)]} stroke="#ffffff" strokeWidth={1} strokeScaleEnabled={false} dash={[3 * k, 3 * k]} opacity={0.7} listening={false} />
          <Line points={[...at(0, -hh), ...at(0, hh)]} stroke="#ffffff" strokeWidth={1} strokeScaleEnabled={false} dash={[3 * k, 3 * k]} opacity={0.7} listening={false} />
          {([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => (
            <Circle key={`${sx}${sy}`} name="mask-corner" x={at(sx * hw, sy * hh)[0]} y={at(sx * hw, sy * hh)[1]} radius={CORNER * k} fill="#ffffff" shadowColor="#000" shadowBlur={2} shadowOpacity={0.5} onMouseDown={press("corner", { sx, sy })} onTouchStart={press("corner", { sx, sy })} {...cursor(sx * sy > 0 ? "nwse-resize" : "nesw-resize")} />
          ))}
          {shape === "rectangle" && (
            <Circle name="mask-round" x={roundAt[0]} y={roundAt[1]} radius={4 * k} fill="#ffffff" stroke="#1c1c1c" strokeWidth={1} strokeScaleEnabled={false} onMouseDown={press("round")} onTouchStart={press("round")} {...cursor("pointer")} />
          )}
        </>
      )}
      {selected && b && (
        <>
          {knob(featherAt, FEATHER_ICON, "feather", "ns-resize", "mask-feather")}
          {knob(rotateAt, ROTATE_ICON, "rotate", "grab", "mask-rotate")}
        </>
      )}
      {selected && pose.penPath &&
        pose.penPath.points.map((a, i) => (
          <Group key={i}>
            {(a.ix !== a.x || a.iy !== a.y || a.ox !== a.x || a.oy !== a.y) && (
              <>
                <Line points={[a.ix, a.iy, a.x, a.y, a.ox, a.oy]} stroke="#ffffff" strokeWidth={1} strokeScaleEnabled={false} opacity={0.8} listening={false} />
                <Circle name="pen-in" x={a.ix} y={a.iy} radius={3.5 * k} fill="#ffffff" onMouseDown={press("in", { index: i })} onTouchStart={press("in", { index: i })} {...cursor("pointer")} />
                <Circle name="pen-out" x={a.ox} y={a.oy} radius={3.5 * k} fill="#ffffff" onMouseDown={press("out", { index: i })} onTouchStart={press("out", { index: i })} {...cursor("pointer")} />
              </>
            )}
            <Rect name="pen-anchor" x={a.x} y={a.y} offsetX={4 * k} offsetY={4 * k} width={8 * k} height={8 * k} fill="#ffffff" stroke="#1c1c1c" strokeWidth={1} strokeScaleEnabled={false} onMouseDown={press("anchor", { index: i })} onTouchStart={press("anchor", { index: i })} {...cursor("move")} />
          </Group>
        ))}
    </Group>
  );
};

export default MaskHandles;
