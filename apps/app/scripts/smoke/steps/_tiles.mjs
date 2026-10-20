// Helpers for the Transitions and Effects tiles' pictures (real footage drawn by the engine, kept
// in the rendering cache): wait for the visible tiles' pictures, and read what a tile's canvas holds.

/** A number for the canvas's pixels, and how much the picture varies (flat ones have none). */
export const canvasHash = (canvas) =>
  canvas.evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let min = 255;
    let max = 0;
    for (let i = 0; i < d.length; i += 16) {
      sum = (sum * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) % 1000000007;
      min = Math.min(min, d[i + 1]);
      max = Math.max(max, d[i + 1]);
    }
    return { sum, spread: max - min };
  });

/** Wait until the tile pictures matching `selector` that are on screen are all drawn (data-ready 1). */
export const tilesReady = async (win, selector, timeout = 90000) => {
  const t0 = Date.now();
  for (;;) {
    const state = await win.locator(selector).evaluateAll((cs) => {
      const vis = cs.filter((c) => {
        const r = c.getBoundingClientRect();
        const clip = c.closest("[data-radix-scroll-area-viewport]")?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
        return r.bottom > clip.top && r.top < clip.bottom && r.width > 0;
      });
      return { total: vis.length, ready: vis.filter((c) => c.dataset.ready === "1").length };
    });
    if (state.total > 0 && state.ready === state.total) return { ...state, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) return { ...state, ms: Date.now() - t0, timedOut: true };
    await win.waitForTimeout(150);
  }
};

/** The tile-previews folder in the user data: its file count and bytes. */
export const tileCache = (fs, path, udDir) => {
  const dir = path.join(udDir, "engine-thumbnails", "tile-previews");
  try {
    const names = fs.readdirSync(dir);
    return { files: names.length, bytes: names.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) };
  } catch {
    return { files: 0, bytes: 0 };
  }
};
