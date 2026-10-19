import { TIMELINE_COLORS } from "@/lib/timeline-colors";

/** A sticker clip's bar: the sticker colour (its name is drawn over it by the clip). */
export const generateTimelineThumbnailSticker = async (clipType: string, imageCanvas: HTMLCanvasElement, groupRef: any) => {
  if (clipType !== "sticker") return;
  const ctx = imageCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    ctx.fillStyle = TIMELINE_COLORS.sticker;
    ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
  }
  groupRef.current?.getLayer()?.batchDraw();
};
