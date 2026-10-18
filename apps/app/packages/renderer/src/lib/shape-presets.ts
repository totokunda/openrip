import type { PathPoint, PolygonClipProps, ShapeClipProps, ShapeTool } from "./types";

/** The shapes CapCut's Stickers ▸ Shapes library adds; its Pen tile adds a `path`. */
export type LibraryShape = "rectangle" | "ellipse" | "triangle" | "parallelogram" | "trapezoid" | "line" | "arrow";

/**
 * CapCut's Shapes library in its order (the Pen tile comes after them), which the S tool's
 * number keys follow (1 rectangle … 7 arrow).
 */
export const SHAPES: { id: LibraryShape; label: string }[] = [
  { id: "rectangle", label: "Rectangle" },
  { id: "ellipse", label: "Circle" },
  { id: "triangle", label: "Triangle" },
  { id: "parallelogram", label: "Parallelogram" },
  { id: "trapezoid", label: "Trapezoid" },
  { id: "line", label: "Line" },
  { id: "arrow", label: "Arrow" },
];

/**
 * CapCut's defaults for a new shape (its FundamentalShapeInfoViewModel): a grey fill
 * (#949494) with the stroke off; a line or an arrow is a #949494 stroke 4 px wide; the pen's
 * shape starts as a #CCCCCC stroke 4 px wide with its fill off. The shadow is off: black at
 * 50%, 10 px away at 45°.
 */
export const SHAPE_FILL = "#949494";
export const SHAPE_STROKE = "#CCCCCC";
const STROKE_PX = 4;
const SHADOW = { color: "#000000", opacity: 50, px: 10, angle: 45 };
/** A shape's length, as CapCut's stickers (3 s). */
export const SHAPE_SECONDS = 3;

/** The canvas in world units, as the preview lays it out (BASE_LONG_SIDE tall). */
export const worldCanvas = (aspect: { width: number; height: number }, baseLongSide: number) => {
  const ratio = aspect.width / aspect.height;
  return { width: baseLongSide * (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9), height: baseLongSide };
};

/**
 * World units per CapCut pixel. CapCut's sizes are pixels of the canvas at 1080p (its
 * shorter side 1080 of them), so the panel's numbers are these.
 */
export const capcutPx = (canvas: { width: number; height: number }) => Math.min(canvas.width, canvas.height) / 1080;

/**
 * A new shape's box side in world units: CapCut's 230400 ÷ the canvas's width in pixels (a
 * ninth of a 1080p canvas's height either way round).
 */
export const shapeSide = (canvas: { width: number; height: number }) => {
  const k = capcutPx(canvas);
  return (230400 / (canvas.width / k)) * k;
};

/** A width and height kept to the shape's own proportions: a star square, a regular triangle its own. */
const TRIANGLE_RATIO = 1.1543665517482078;
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

/** A line's and an arrow's two points: across the middle of their box. */
export const LINE_POINTS: PathPoint[] = [
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 },
];

/** A line's or an arrow's box height for its length: thin, with room to grab it. */
export const lineHeight = (length: number) => length / 6;

/** Whether a shape is an open outline (no inside to fill): a line, an arrow, an open pen path. */
export const isOpenShape = (clip: Pick<ShapeClipProps, "shapeType" | "pathClosed">) =>
  clip.shapeType === "line" || clip.shapeType === "arrow" || (clip.shapeType === "path" && !clip.pathClosed);

/** Whether a shape's fill shows (its check, by default on for closed shapes but the pen's). */
export const fillOn = (clip: ShapeClipProps) => !isOpenShape(clip) && (clip.fillEnabled ?? clip.shapeType !== "path");

/** Whether a shape's stroke shows (its check, by default on when it has a width). */
export const strokeOn = (clip: ShapeClipProps) => (clip.strokeEnabled ?? (clip.strokeWidth ?? 2) > 0) && (clip.strokeWidth ?? 2) > 0;

/** An open outline's end mark (an arrow's end is an arrow unless it's set). */
export const capOf = (clip: ShapeClipProps, end: "start" | "end") =>
  (end === "start" ? clip.capStart : clip.capEnd) ?? (end === "end" && clip.shapeType === "arrow" ? "arrow" : "none");

/** Whether the shape has corners its Corner radius rounds. */
export const hasCorners = (shape?: ShapeTool) =>
  shape === "rectangle" || shape === "triangle" || shape === "parallelogram" || shape === "trapezoid" || shape === "polygon";

/**
 * A shape clip over `rect` (world units) from `startFrame`, three seconds long, with
 * CapCut's look for that shape. `canvas` (world units) sizes the stroke and shadow.
 */
export const shapeClip = (
  shape: ShapeTool,
  rect: { x: number; y: number; width: number; height: number },
  at: { clipId: string; timelineId: string; startFrame: number; fps: number; totalFrames: number },
  canvas: { width: number; height: number } = { width: 1066.6666666666667, height: 600 },
): ShapeClipProps => {
  const k = capcutPx(canvas);
  const line = shape === "line" || shape === "arrow";
  const pen = shape === "path";
  const clip: ShapeClipProps = {
    clipId: at.clipId,
    type: "shape",
    timelineId: at.timelineId,
    startFrame: at.startFrame,
    endFrame: at.startFrame + Math.round(SHAPE_SECONDS * at.fps),
    trimEnd: -Infinity,
    trimStart: Infinity,
    shapeType: shape,
    fill: SHAPE_FILL,
    fillOpacity: 100,
    fillEnabled: !line && !pen,
    stroke: line ? SHAPE_FILL : SHAPE_STROKE,
    strokeOpacity: 100,
    strokeWidth: STROKE_PX * k,
    strokeEnabled: line || pen,
    strokeStyle: "solid",
    shadowEnabled: false,
    shadowColor: SHADOW.color,
    shadowOpacity: SHADOW.opacity,
    shadowDistance: SHADOW.px * k,
    shadowAngle: SHADOW.angle,
    transform: { ...rect, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 },
  };
  if (line) {
    clip.path = LINE_POINTS.map((p) => ({ ...p }));
    clip.capStart = "none";
    clip.capEnd = shape === "arrow" ? "arrow" : "none";
  }
  if (pen) {
    clip.path = [];
    clip.pathClosed = false;
    clip.penDrawing = true;
    clip.capStart = "none";
    clip.capEnd = "none";
  }
  if (shape === "polygon") (clip as PolygonClipProps).sides = 3;
  return clip;
};

/** Where and how big a new library shape is: CapCut's size, its middle at `center`. */
export const libraryRect = (shape: ShapeTool, canvas: { width: number; height: number }, center = { x: canvas.width / 2, y: canvas.height / 2 }) => {
  const side = shapeSide(canvas);
  const { width, height } = shape === "line" || shape === "arrow" ? { width: side, height: lineHeight(side) } : { width: side, height: side };
  return { x: center.x - width / 2, y: center.y - height / 2, width, height };
};

/**
 * A shape from the Shapes library added at the playhead (or `startFrame`), in the middle of
 * the canvas (or at `center`, world units), on a new track at the top, and selected. The
 * Pen's shape covers the canvas until it's drawn. Returns the new clip's id.
 */
export const addShape = async (shape: ShapeTool, opts: { startFrame?: number; center?: { x: number; y: number } } = {}) => addShapeNow(await shapeDeps(), shape, opts);

/** What adding a shape needs, loaded once (the stores import this module). */
export const shapeDeps = async () => {
  const [{ v4: uuidv4 }, { useClipStore }, { useControlsStore }, { useViewportStore }, { BASE_LONG_SIDE, DEFAULT_FPS }] = await Promise.all([
    import("uuid"),
    import("./clip"),
    import("./control"),
    import("./viewport"),
    import("./settings"),
  ]);
  return { uuidv4, useClipStore, useControlsStore, useViewportStore, BASE_LONG_SIDE, DEFAULT_FPS };
};

/** `addShape` with its modules at hand, all in one go (for `withoutHistory`). */
export const addShapeNow = (
  deps: Awaited<ReturnType<typeof shapeDeps>>,
  shape: ShapeTool,
  opts: { startFrame?: number; center?: { x: number; y: number } } = {},
) => {
  const { uuidv4, useClipStore, useControlsStore, useViewportStore, BASE_LONG_SIDE, DEFAULT_FPS } = deps;
  const { addTimeline, addClip } = useClipStore.getState();
  const controls = useControlsStore.getState();
  const canvas = worldCanvas(useViewportStore.getState().aspectRatio, BASE_LONG_SIDE);
  const rect = shape === "path" ? { x: 0, y: 0, width: canvas.width, height: canvas.height } : libraryRect(shape, canvas, opts.center);
  const timelineId = uuidv4();
  addTimeline({ timelineId, type: "shape", timelineY: 0, timelineHeight: 40, timelineWidth: 0, muted: false, hidden: false }, -1);
  const clip = shapeClip(
    shape,
    rect,
    {
      clipId: uuidv4(),
      timelineId,
      startFrame: Math.max(0, Math.round(opts.startFrame ?? controls.focusFrame)),
      fps: controls.fps || DEFAULT_FPS,
      totalFrames: controls.totalTimelineFrames,
    },
    canvas,
  );
  addClip(clip);
  controls.setSelectedClipIds([clip.clipId]);
  return clip.clipId;
};
