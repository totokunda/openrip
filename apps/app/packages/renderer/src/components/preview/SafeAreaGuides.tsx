import React from "react";
import { useViewportStore } from "@/lib/viewport";
import { BASE_LONG_SIDE } from "@/lib/settings";

/**
 * Safe-area guides over the canvas: the action-safe (90%) and title-safe (80%) boxes and the
 * centre lines. The canvas sits where the preview draws it: BASE_LONG_SIDE tall in world
 * units, placed by the viewport's position and scale. Only drawn, never clicked.
 */
const SafeAreaGuides: React.FC = () => {
  const position = useViewportStore((s) => s.position);
  const scale = useViewportStore((s) => s.scale);
  const aspect = useViewportStore((s) => s.aspectRatio);
  const ratio = aspect.width / aspect.height;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const width = BASE_LONG_SIDE * ratio * scale;
  const height = BASE_LONG_SIDE * scale;
  const box = (inset: number): React.CSSProperties => ({
    position: "absolute",
    left: `${inset}%`,
    top: `${inset}%`,
    right: `${inset}%`,
    bottom: `${inset}%`,
  });
  return (
    <div
      data-testid="safe-area-guides"
      className="absolute pointer-events-none z-10"
      style={{ left: position.x, top: position.y, width, height }}
    >
      <div style={box(5)} className="border border-dashed border-white/35" />
      <div style={box(10)} className="border border-dashed border-white/25" />
      <div className="absolute left-1/2 top-[46%] bottom-[46%] w-px bg-white/40" />
      <div className="absolute top-1/2 left-[46%] right-[46%] h-px bg-white/40" />
    </div>
  );
};

export default SafeAreaGuides;
