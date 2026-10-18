import React, { useEffect } from "react";
import { useViewportStore } from "@/lib/viewport";
import { useDrawingStore } from "@/lib/drawing";
import { useMaskStore } from "@/lib/mask";

const PEN = { brush: "pen", highlighter: "highlighter", eraser: "eraser" } as const;
const SHAPE = { rectangle: "a rectangle", ellipse: "an ellipse", polygon: "a triangle", line: "a line", star: "a star" } as const;
const MASK_SHAPE = { rectangle: "a rectangle", ellipse: "an ellipse", polygon: "a triangle", star: "a star" } as const;

/**
 * While a canvas tool is on (drawing, a shape, a text or a mask; picked in the left panel, the
 * Mask tab or with D, S, T), a chip at the top of the canvas says what a drag does, with Done
 * to go back to selecting. Esc does the same; V and H still pick select and hand.
 */
const ToolChip: React.FC = () => {
  const tool = useViewportStore((s) => s.tool);
  const setTool = useViewportStore((s) => s.setTool);
  const shape = useViewportStore((s) => s.shape);
  const pen = useDrawingStore((s) => s.tool);
  const maskTool = useMaskStore((s) => s.tool);
  const maskShape = useMaskStore((s) => s.shape);
  const on = tool === "draw" || tool === "shape" || tool === "text" || tool === "mask";

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

  if (!on) return null;
  const text =
    tool === "draw"
      ? `Drawing with the ${PEN[pen]}`
      : tool === "shape"
        ? `Drag out ${SHAPE[shape]} on the canvas`
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
