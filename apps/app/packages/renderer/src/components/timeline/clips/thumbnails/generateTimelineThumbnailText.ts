import { TIMELINE_COLORS } from "@/lib/timeline-colors";

export const generateTimelineThumbnailText = async (
  clipType: string,
  imageCanvas: HTMLCanvasElement,
  groupRef: any,
) => {
  if (clipType !== "text") return;
  // make canvas
  const ctx = imageCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    ctx.fillStyle = TIMELINE_COLORS.text; // text, templates and captions
    ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
  }
  groupRef.current?.getLayer()?.batchDraw();
};
