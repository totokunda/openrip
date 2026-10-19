import React from "react";
import { Ellipse, Rect, Shape as KShape } from "react-konva";
import { useShapePreviewStore } from "@/lib/shape-library-preview";
import { libraryRect, shapeClip } from "@/lib/shape-presets";
import { drawShape } from "@/lib/shape-geometry";
import { DEFAULT_FPS } from "@/lib/settings";

/**
 * The Shapes tile clicked in the library, shown over the middle of the canvas as it would be
 * added (CapCut's size and look), without being a clip. Not interactive. In world units,
 * inside the preview's canvas group.
 */
const ShapeLibraryPreview: React.FC<{ rectWidth: number; rectHeight: number }> = ({ rectWidth, rectHeight }) => {
  const shape = useShapePreviewStore((s) => s.shape);
  if (!shape) return null;
  const canvas = { width: rectWidth, height: rectHeight };
  const rect = libraryRect(shape, canvas);
  const clip = shapeClip(shape, rect, { clipId: "library-preview", timelineId: "library-preview", startFrame: 0, fps: DEFAULT_FPS, totalFrames: 0 }, canvas);
  const common = { listening: false, name: "shape-library-preview" };
  if (shape === "rectangle") return <Rect {...common} {...rect} fill={clip.fill} />;
  if (shape === "ellipse")
    return <Ellipse {...common} x={rect.x + rect.width / 2} y={rect.y + rect.height / 2} radiusX={rect.width / 2} radiusY={rect.height / 2} fill={clip.fill} />;
  return (
    <KShape
      {...common}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      sceneFunc={(ctx) => drawShape(ctx._context as CanvasRenderingContext2D, clip, rect.width, rect.height)}
    />
  );
};

export default ShapeLibraryPreview;
