// The bar kinds' colours (a draft's effect, sticker or adjustment comes in as a filter clip
// with its kind); filters and the app's own are the filter colour.
const KIND_COLOURS: Record<string, string> = {
  filter: TIMELINE_COLORS.filter,
  effect: TIMELINE_COLORS.effect,
  sticker: TIMELINE_COLORS.sticker,
  adjustment: TIMELINE_COLORS.adjustment,
};
import { TIMELINE_COLORS } from "@/lib/timeline-colors";

export const generateTimelineThumbnailFilter = async (
  clipType: string,
  imageCanvas: HTMLCanvasElement,
  groupRef: any,
  kind?: string,
) => {
  if (clipType !== "filter") return;
  // make canvas
  const ctx = imageCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    ctx.fillStyle = KIND_COLOURS[kind ?? "filter"] ?? KIND_COLOURS.filter;
    ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
  }
  groupRef.current?.getLayer()?.batchDraw();
};
