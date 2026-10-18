import { TIMELINE_COLORS } from "@/lib/timeline-colors";

export const generateTimelineThumbnailDrawing = async (
  clipType: string,
  imageCanvas: HTMLCanvasElement,
  clipRef: any,
) => {
  if (clipType !== "draw") return;
  // make canvas
  const ctx = imageCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    ctx.fillStyle = TIMELINE_COLORS.drawing;
    ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
  }
  clipRef.current?.getLayer()?.batchDraw();
};
