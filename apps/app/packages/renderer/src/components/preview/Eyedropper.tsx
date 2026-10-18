import React, { useEffect } from "react";
import { Rect } from "react-konva";
import { ENGINE_FRAME_CANVAS_ID } from "@app/preload";
import { sampleFrame, useEyedropperStore } from "@/lib/eyedropper";

/**
 * The eyedropper's catch over the picture (lib/eyedropper.ts): while a panel picks a colour,
 * a transparent rect over the whole canvas takes the click, with a crosshair, and hands the
 * panel the engine frame's colour there (the frame covers the canvas, `rectWidth` ×
 * `rectHeight` world units). Escape stops picking.
 */
const Eyedropper: React.FC<{ rectWidth: number; rectHeight: number }> = ({ rectWidth, rectHeight }) => {
  const onPick = useEyedropperStore((s) => s.onPick);
  const stop = useEyedropperStore((s) => s.stop);
  useEffect(() => {
    if (!onPick) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && stop();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onPick, stop]);
  if (!onPick) return null;
  return (
    <Rect
      name="eyedropper"
      x={0}
      y={0}
      width={rectWidth}
      height={rectHeight}
      fill="rgba(0,0,0,0.001)"
      onMouseEnter={(e) => {
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = "crosshair";
      }}
      onMouseLeave={(e) => {
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = "default";
      }}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        // The click that follows is the eyedropper's: the clips' "click outside drops the
        // selection" listeners mustn't see it.
        window.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true });
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        const p = e.target.getRelativePointerPosition();
        if (!p) return;
        const hex = sampleFrame(document.getElementById(ENGINE_FRAME_CANVAS_ID) as HTMLCanvasElement | null, p.x / rectWidth, p.y / rectHeight);
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = "default";
        if (hex) onPick(hex);
        stop();
      }}
    />
  );
};

export default Eyedropper;
