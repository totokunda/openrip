import React from "react";
import type { IconType } from "react-icons";
import { LuBrush, LuCircle, LuLasso, LuSquare, LuStar, LuTriangle } from "react-icons/lu";
import { useViewportStore } from "@/lib/viewport";
import { useMaskStore, type MaskShapeTool, type MaskTool } from "@/lib/mask";
import { cn } from "@/lib/utils";

const TOOLS: { id: string; label: string; icon: IconType; tool: MaskTool; shape?: MaskShapeTool }[] = [
  { id: "rectangle", label: "Rectangle", icon: LuSquare, tool: "shape", shape: "rectangle" },
  { id: "ellipse", label: "Ellipse", icon: LuCircle, tool: "shape", shape: "ellipse" },
  { id: "polygon", label: "Triangle", icon: LuTriangle, tool: "shape", shape: "polygon" },
  { id: "star", label: "Star", icon: LuStar, tool: "shape", shape: "star" },
  { id: "lasso", label: "Lasso", icon: LuLasso, tool: "lasso" },
  { id: "brush", label: "Brush", icon: LuBrush, tool: "draw" },
];

/**
 * The Mask tab's way to start a mask: pick a shape, the lasso or the brush, then drag or
 * draw it on the canvas over the clip (the player has no tool row, as CapCut's has none).
 */
const AddMaskTools: React.FC<{ className?: string }> = ({ className }) => {
  const viewTool = useViewportStore((s) => s.tool);
  const setViewTool = useViewportStore((s) => s.setTool);
  const maskTool = useMaskStore((s) => s.tool);
  const maskShape = useMaskStore((s) => s.shape);
  const armed = (t: (typeof TOOLS)[number]) => viewTool === "mask" && maskTool === t.tool && (t.tool !== "shape" || maskShape === t.shape);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-[11px] text-brand-light/70">Add a mask, then drag or draw it on the canvas</span>
      <div className="grid grid-cols-6 gap-1.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.label}
            data-testid={`add-mask-${t.id}`}
            aria-pressed={armed(t)}
            onClick={() => {
              const mask = useMaskStore.getState();
              mask.setTool(t.tool);
              if (t.shape) mask.setShape(t.shape);
              setViewTool("mask");
            }}
            className={cn(
              "h-9 flex items-center justify-center rounded-[6px] border transition-colors cursor-pointer",
              armed(t) ? "border-brand-accent text-brand-light bg-brand-accent-shade/40" : "border-brand-light/[0.06] bg-brand-background-dark text-brand-light/80 hover:border-brand-light/30",
            )}
          >
            <t.icon className="w-4 h-4" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default AddMaskTools;
