import React, { useEffect } from "react";
import { useViewportStore } from "@/lib/viewport";
import { useMaskStore } from "@/lib/mask";
import { usePenStore } from "@/lib/pen";

const SHAPE = {
  rectangle: "a rectangle",
  ellipse: "a circle",
  triangle: "a triangle",
  parallelogram: "a parallelogram",
  trapezoid: "a trapezoid",
  line: "a line",
  arrow: "an arrow",
  path: "a shape",
  polygon: "a triangle",
  star: "a star",
} as const;
const MASK_SHAPE = { rectangle: "a rectangle", ellipse: "an ellipse", polygon: "a triangle", star: "a star" } as const;

/**
 * What the canvas says while a tool is on.
 *
 * - The Pen (Stickers ▸ Shapes) before its first point, as CapCut's player: the canvas dimmed
 *   (black at 30%) and a white pill 40 px from the top, "Click to start drawing".
 * - A shape, a text or a mask (S, T, the Mask tab): a chip at the top of the canvas says what
 *   a drag does, with Done to go back to selecting. Esc does the same; V and H still pick
 *   select and hand.
 */
const ToolChip: React.FC = () => {
  const tool = useViewportStore((s) => s.tool);
  const setTool = useViewportStore((s) => s.setTool);
  const shape = useViewportStore((s) => s.shape);
  const maskTool = useMaskStore((s) => s.tool);
  const maskShape = useMaskStore((s) => s.shape);
  const penDrawing = usePenStore((s) => !!s.drawingClipId);
  const penStarted = usePenStore((s) => s.points.length > 0);
  const penEditing = usePenStore((s) => s.editingClipId);
  const penSelected = usePenStore((s) => s.selected);
  const on = tool === "shape" || tool === "text" || tool === "mask";

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      setTool("pointer");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, setTool]);

  if (penDrawing) {
    return (
      <div data-testid="pen-toast" data-started={penStarted ? "1" : "0"} className="absolute inset-0 z-20 pointer-events-none">
        {!penStarted && (
          <>
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute top-10 left-1/2 -translate-x-1/2 rounded-full bg-white px-2 py-2 text-[10px] leading-none text-black whitespace-nowrap [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]">
              Click to start drawing
            </div>
          </>
        )}
      </div>
    );
  }

  // A pen shape's points being edited: nothing shows but its points (for tests, which point is selected).
  if (penEditing) return <div data-testid="pen-editing" data-selected={penSelected ?? ""} hidden />;

  if (!on) return null;
  const text =
    tool === "shape"
      ? `Drag out ${SHAPE[shape] ?? "a shape"} on the canvas`
      : tool === "text"
        ? "Click the canvas to add a text"
        : maskTool === "lasso"
          ? "Draw a lasso mask over the clip"
          : maskTool === "draw"
            ? "Paint a mask over the clip"
            : `Drag out ${MASK_SHAPE[maskShape]} mask over the clip`;

  return (
    <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
      <div
        data-testid="tool-chip"
        data-tool={tool}
        className="pointer-events-auto h-7 flex items-center gap-2 pl-3 pr-1 rounded-full bg-black/70 backdrop-blur-sm border-[0.5px] border-white/10 text-[12px] text-brand-light whitespace-nowrap"
      >
        {text}
        <button
          type="button"
          data-testid="tool-chip-done"
          onClick={() => setTool("pointer")}
          className="h-5 px-2.5 rounded-full text-[11.5px] font-medium bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  );
};

export default ToolChip;
