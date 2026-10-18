import React, { useEffect, useRef } from "react";
import { useViewportStore } from "@/lib/viewport";
import { useEnginePreviewStore } from "@/lib/engine-preview";
import { canvasPixels } from "@/lib/guides";
import { dragGuide } from "./Guides";

/** The rulers' width, along the top and left of the canvas area. */
export const RULER_SIZE = 16;
const TICK = "#404040";
const LABEL = "#767676";

/**
 * A major step for a ruler `span` project pixels long: about a fifth of it, to two significant
 * figures, as CapCut's (its top ruler of a portrait 4K canvas reads −2200, −1100, 0, 1100…, its
 * left one 1400, 700, 0…). Ten minor ticks to a step.
 */
function majorStep(span: number): number {
  const raw = Math.max(1, span / 5);
  const unit = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
  return Math.max(1, Math.round(raw / unit) * unit);
}

/**
 * One ruler (`axis` "x" along the top, "y" down the left) in the project's pixels, 0 at the
 * canvas's middle and y upwards, as CapCut's. Dragging out of it makes a guide (a horizontal
 * one from the top ruler, a vertical one from the left).
 */
const Ruler: React.FC<{ axis: "x" | "y"; area: HTMLElement | null }> = ({ axis, area }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const position = useViewportStore((s) => s.position);
  const scale = useViewportStore((s) => s.scale);
  const bounds = useViewportStore((s) => s.contentBounds);
  const viewport = useViewportStore((s) => s.viewportSize);
  // The engine's canvas size, once it holds the project.
  useEnginePreviewStore((s) => s.project?.width);
  useViewportStore((s) => s.aspectRatio);

  useEffect(() => {
    const c = ref.current;
    if (!c || !bounds || !bounds.width || !bounds.height) return;
    const draw = () => {
      const dpr = c.ownerDocument.defaultView?.devicePixelRatio || 1;
      const r = c.getBoundingClientRect();
      const [w, h] = [Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr))];
      if (c.width !== w || c.height !== h) [c.width, c.height] = [w, h];
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, r.width, r.height);
      const px = canvasPixels();
      const length = axis === "x" ? r.width : r.height;
      // Screen px per project px, and where the canvas's middle is on this ruler.
      const k = axis === "x" ? (bounds.width * scale) / px.width : (bounds.height * scale) / px.height;
      const middle = axis === "x" ? position.x + (bounds.x + bounds.width / 2) * scale : position.y + (bounds.y + bounds.height / 2) * scale;
      if (!(k > 0)) return;
      const step = majorStep(length / k);
      const minor = step / 10;
      // Project value at a screen offset: x rightwards, y upwards.
      const valueAt = (s: number) => (axis === "x" ? (s - middle) / k : (middle - s) / k);
      const screenOf = (v: number) => (axis === "x" ? middle + v * k : middle - v * k);
      const [a, b] = [valueAt(0), valueAt(length)].sort((p, q) => p - q);
      g.strokeStyle = TICK;
      g.lineWidth = 1;
      g.beginPath();
      // The ruler's edge next to the canvas.
      if (axis === "x") {
        g.moveTo(0, r.height - 0.5);
        g.lineTo(r.width, r.height - 0.5);
      } else {
        g.moveTo(r.width - 0.5, 0);
        g.lineTo(r.width - 0.5, r.height);
      }
      for (let v = Math.ceil(a / minor) * minor; v <= b; v += minor) {
        const s = Math.round(screenOf(v)) + 0.5;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const len = major ? RULER_SIZE - 3 : 4;
        if (axis === "x") {
          g.moveTo(s, r.height);
          g.lineTo(s, r.height - len);
        } else {
          g.moveTo(r.width, s);
          g.lineTo(r.width - len, s);
        }
      }
      g.stroke();
      g.fillStyle = LABEL;
      g.font = "10px -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif";
      g.textBaseline = "top";
      for (let v = Math.ceil(a / step) * step; v <= b; v += step) {
        const s = screenOf(v);
        const label = String(Math.round(v) === 0 ? 0 : Math.round(v));
        if (axis === "x") {
          g.fillText(label, s + 3, 1.5);
        } else {
          // Read upwards, the label after its tick, as CapCut's.
          g.save();
          g.translate(1.5, s - 3);
          g.rotate(-Math.PI / 2);
          g.fillText(label, 0, 0);
          g.restore();
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [axis, position, scale, bounds, viewport]);

  return (
    <canvas
      ref={ref}
      data-testid={`ruler-${axis}`}
      className="absolute bg-brand-background"
      style={
        axis === "x"
          ? { left: RULER_SIZE, top: 0, width: `calc(100% - ${RULER_SIZE}px)`, height: RULER_SIZE, cursor: "row-resize" }
          : { left: 0, top: RULER_SIZE, width: RULER_SIZE, height: `calc(100% - ${RULER_SIZE}px)`, cursor: "col-resize" }
      }
      onPointerDown={(e) => {
        if (e.button !== 0 || !area) return;
        // The top ruler gives a horizontal guide (at a y), the left one a vertical one.
        dragGuide(e, axis === "x" ? "y" : "x", null, area);
      }}
    />
  );
};

/** The rulers along the top and left of the canvas area (⌘⌥R), as CapCut's. */
const Rulers: React.FC<{ area: HTMLElement | null }> = ({ area }) => (
  <>
    <Ruler axis="x" area={area} />
    <Ruler axis="y" area={area} />
    <div className="absolute left-0 top-0 bg-brand-background" style={{ width: RULER_SIZE, height: RULER_SIZE }} />
  </>
);

export default Rulers;
