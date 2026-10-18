import type { PolygonClipProps, ShapeClipProps, ShapeTool } from "./types";

/**
 * The shapes the Stickers tab's Shapes section adds, in the order the S tool's number keys
 * pick them (1 rectangle … 5 star).
 */
export const SHAPES: { id: ShapeTool; label: string }[] = [
  { id: "rectangle", label: "Rectangle" },
  { id: "ellipse", label: "Ellipse" },
  { id: "polygon", label: "Triangle" },
  { id: "line", label: "Line" },
  { id: "star", label: "Star" },
];

/** A triangle's width over its height, as the polygon shape draws one. */
const TRIANGLE_RATIO = 1.1543665517482078;

/** A width and height kept to the shape's own proportions: a star square, a triangle its own. */
export const shapeSize = (shape: ShapeTool, width: number, height: number) => {
  if (shape === "star") {
    const size = Math.max(width, height);
    return { width: size, height: size };
  }
  if (shape === "polygon") {
    return width / (height || 1) >= TRIANGLE_RATIO ? { width, height: width / TRIANGLE_RATIO } : { width: height * TRIANGLE_RATIO, height };
  }
  return { width, height };
};

/** A shape clip over `rect` (world units) from `startFrame`, three seconds long. */
export const shapeClip = (
  shape: ShapeTool,
  rect: { x: number; y: number; width: number; height: number },
  at: { clipId: string; timelineId: string; startFrame: number; fps: number; totalFrames: number },
): ShapeClipProps => {
  const clip: ShapeClipProps = {
    clipId: at.clipId,
    type: "shape",
    timelineId: at.timelineId,
    startFrame: at.startFrame,
    endFrame: Math.min(at.startFrame + 3 * at.fps, at.totalFrames - 1),
    trimEnd: -Infinity,
    trimStart: Infinity,
    shapeType: shape,
    fill: "#E3E3E3",
    stroke: "#E3E3E3",
    // A line is only its stroke.
    strokeWidth: shape === "line" ? 8 : 1,
    transform: { ...rect, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 },
  };
  if (shape === "polygon") (clip as PolygonClipProps).sides = 3;
  return clip;
};

/**
 * A shape added at the playhead in the middle of the canvas, a third of its height across,
 * on a new track at the top, and selected.
 */
export const addShape = async (shape: ShapeTool) => {
  const [{ v4: uuidv4 }, { useClipStore }, { useControlsStore }, { useViewportStore }, { BASE_LONG_SIDE, DEFAULT_FPS }] = await Promise.all([
    import("uuid"),
    import("./clip"),
    import("./control"),
    import("./viewport"),
    import("./settings"),
  ]);
  const { addTimeline, addClip } = useClipStore.getState();
  const controls = useControlsStore.getState();
  const { aspectRatio } = useViewportStore.getState();
  // The canvas in world units, as the preview lays it out (BASE_LONG_SIDE tall).
  const ratio = aspectRatio.width / aspectRatio.height;
  const canvas = { width: BASE_LONG_SIDE * (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9), height: BASE_LONG_SIDE };
  const side = canvas.height / 3;
  const { width, height } = shape === "line" ? { width: side * 1.5, height: 8 } : shapeSize(shape, side, side);
  const timelineId = uuidv4();
  addTimeline({ timelineId, type: "shape", timelineY: 0, timelineHeight: 40, timelineWidth: 0, muted: false, hidden: false }, -1);
  const clip = shapeClip(
    shape,
    { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height },
    { clipId: uuidv4(), timelineId, startFrame: controls.focusFrame, fps: DEFAULT_FPS, totalFrames: controls.totalTimelineFrames },
  );
  addClip(clip);
  controls.setSelectedClipIds([clip.clipId]);
};
