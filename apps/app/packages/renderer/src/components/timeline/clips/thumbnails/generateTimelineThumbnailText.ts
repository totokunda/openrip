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
    ctx.fillStyle = "#924e3c"; // CapCut's text, template and caption colour
    ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
  }
  groupRef.current?.getLayer()?.batchDraw();
};
