// CapCut's colours for its bar kinds (a draft's effect, sticker or adjustment comes in as a
// filter clip with its kind); filters and the app's own are the filter colour.
const KIND_COLOURS: Record<string, string> = {
  filter: "#464186",
  effect: "#6e4c7f",
  sticker: "#cc9641",
  adjustment: "#a58744",
};

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
