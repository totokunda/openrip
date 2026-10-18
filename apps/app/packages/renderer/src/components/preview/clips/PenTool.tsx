import React, { useEffect, useRef, useState } from "react";
import { Circle, Group, Line, Rect } from "react-konva";
import Konva from "konva";
import { KonvaEventObject } from "konva/lib/Node";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useViewportStore } from "@/lib/viewport";
import { maskFrame, newPenMask, remakeMask } from "@/lib/mask-shapes";
import { useMaskStore } from "@/lib/mask";
import type { MaskClipProps, MaskPenPoint } from "@/lib/types";

/**
 * CapCut's Pen on the canvas (the Mask tab's Pen tile), in the selected clip's mask units
 * (MaskPreview puts it over the clip): a click adds an anchor, a drag from it pulls out its
 * curve handles (the one it leaves by follows the pointer, the other mirrors it), and a click
 * on the first anchor (or Enter) closes the path: the selected mask becomes it (or a new
 * pen mask), then back to the pointer.
 * Escape (the tool chip) drops the path.
 */
const PenTool: React.FC<{ clipId: string; scale: number; reach: number }> = ({ clipId, scale, reach }) => {
  const viewScale = useViewportStore((s) => s.scale);
  const groupRef = useRef<Konva.Group>(null);
  const [points, setPoints] = useState<MaskPenPoint[]>([]);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const pulling = useRef<number | null>(null);
  const k = 1 / Math.max(1e-6, viewScale * scale);

  const close = (pts: MaskPenPoint[]) => {
    const { getClipById, updateClip } = useClipStore.getState();
    const clip = getClipById(clipId);
    if (!clip || pts.length < 3) return;
    const made = newPenMask(clip, pts, maskFrame(clip, useControlsStore.getState().focusFrame));
    // The path is the mask the Pen tile was picked for (CapCut's tiles shape the selected
    // mask), else a new one.
    const masks: MaskClipProps[] = (clip as any).masks ?? [];
    const target = masks.find((m) => m.id === useMaskStore.getState().activeMaskId && m.id === useControlsStore.getState().selectedMaskId);
    const mask = target ? remakeMask(target, made) : made;
    updateClip(clipId, { masks: target ? masks.map((m) => (m.id === target.id ? mask : m)) : [...masks, mask] } as any);
    useControlsStore.getState().setSelectedMaskId(mask.id);
    setPoints([]);
    useViewportStore.getState().setTool("pointer");
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter") close(points);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [points]);
  useEffect(() => {
    const up = () => (pulling.current = null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const pointer = () => groupRef.current?.getRelativePointerPosition();
  const down = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    const p = pointer();
    if (!p) return;
    if (points.length >= 3 && Math.hypot(p.x - points[0].x, p.y - points[0].y) < 8 * k) {
      close(points);
      return;
    }
    pulling.current = points.length;
    setPoints([...points, { x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y }]);
  };
  const move = () => {
    const p = pointer();
    if (!p) return;
    setHover([p.x, p.y]);
    const i = pulling.current;
    if (i == null) return;
    setPoints((pts) => pts.map((a, j) => (j === i ? { ...a, ox: p.x, oy: p.y, ix: 2 * a.x - p.x, iy: 2 * a.y - p.y } : a)));
  };

  // The path so far, the span to the pointer included.
  const flat: number[] = [];
  points.forEach((a, i) => {
    if (i === 0) flat.push(a.x, a.y);
    else {
      const b = points[i - 1];
      flat.push(b.ox, b.oy, a.ix, a.iy, a.x, a.y);
    }
  });
  const last = points[points.length - 1];
  return (
    <Group ref={groupRef}>
      <Rect name="pen-catch" x={-reach} y={-reach} width={reach * 3} height={reach * 3} fill="rgba(0,0,0,0.001)" onMouseDown={down} onTouchStart={down} onMouseMove={move} onTouchMove={move} />
      {points.length > 1 && <Line points={flat} bezier stroke="#ffffff" strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />}
      {last && hover && pulling.current == null && <Line points={[last.x, last.y, hover[0], hover[1]]} stroke="#ffffff" strokeWidth={1} strokeScaleEnabled={false} dash={[4 * k, 3 * k]} listening={false} />}
      {points.map((a, i) => (
        <Group key={i} listening={false}>
          {(a.ox !== a.x || a.oy !== a.y) && (
            <>
              <Line points={[a.ix, a.iy, a.x, a.y, a.ox, a.oy]} stroke="#ffffff" strokeWidth={1} strokeScaleEnabled={false} opacity={0.8} />
              <Circle x={a.ix} y={a.iy} radius={3 * k} fill="#ffffff" />
              <Circle x={a.ox} y={a.oy} radius={3 * k} fill="#ffffff" />
            </>
          )}
          <Rect x={a.x} y={a.y} offsetX={4 * k} offsetY={4 * k} width={8 * k} height={8 * k} fill={i === 0 && points.length >= 3 ? "#ae81ce" : "#ffffff"} stroke="#1c1c1c" strokeWidth={1} strokeScaleEnabled={false} />
        </Group>
      ))}
    </Group>
  );
};

export default PenTool;
