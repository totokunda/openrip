// The pictures on the Transitions and Effects tiles: real footage with the transition or effect
// drawn on it by the engine (the main process makes each tile's JPEG sheet the first time it's
// asked for and keeps it in the rendering cache). The tiles that are on screen ask in turn, a
// few at a time, the ones seen first first, and a tile that scrolls away before its turn drops
// out of the line. What comes back is kept for the session: the frame a tile rests on, as a
// bitmap, and the sheet's bytes for when it's hovered.
import { engineTilePreview, type EngineTilePreview, type EngineTileSpec } from "@app/preload";

export type TileArt = {
  /** The frame the tile rests on, `size` px square. */
  still: ImageBitmap;
  /** The sheet of frames: decode it with `decodeSheet` when the tile is hovered. */
  sheet: EngineTilePreview;
};

const key = (spec: EngineTileSpec) => `${spec.kind}:${spec.id}`;

/** How many tiles are asked for at once (the main process draws them one at a time). */
const AT_ONCE = 2;

const done = new Map<string, TileArt | null>();
const started = new Set<string>();
let running = 0;
const waiting = new Map<string, EngineTileSpec>();
const listeners = new Map<string, Set<(art: TileArt | null) => void>>();
/** How long each tile took to draw the first time, for the tests and the logs. */
export const tileTimings = new Map<string, number>();

const decode = async (sheet: EngineTilePreview): Promise<TileArt> => {
  const all = await createImageBitmap(new Blob([sheet.jpeg as BlobPart], { type: "image/jpeg" }));
  const at = sheet.still;
  const still = await createImageBitmap(all, (at % sheet.cols) * sheet.size, Math.floor(at / sheet.cols) * sheet.size, sheet.size, sheet.size);
  all.close();
  return { still, sheet };
};

/** The sheet's frames as one bitmap (the caller closes it), for a hovered tile's loop. */
export const decodeSheet = (sheet: EngineTilePreview): Promise<ImageBitmap> => createImageBitmap(new Blob([sheet.jpeg as BlobPart], { type: "image/jpeg" }));

/** Draw frame `i` of a decoded sheet. */
export const drawFrame = (ctx: CanvasRenderingContext2D, sheet: EngineTilePreview, bitmap: ImageBitmap, i: number) => {
  ctx.drawImage(bitmap, (i % sheet.cols) * sheet.size, Math.floor(i / sheet.cols) * sheet.size, sheet.size, sheet.size, 0, 0, ctx.canvas.width, ctx.canvas.height);
};

const pump = () => {
  while (running < AT_ONCE && waiting.size > 0) {
    const [k, spec] = waiting.entries().next().value as [string, EngineTileSpec];
    waiting.delete(k);
    started.add(k);
    running++;
    const t0 = performance.now();
    void engineTilePreview(spec)
      .then((sheet) => (sheet ? decode(sheet) : null))
      .catch(() => null)
      .then((art) => {
        tileTimings.set(k, Math.round(performance.now() - t0));
        done.set(k, art);
        for (const l of listeners.get(k) ?? []) l(art);
        listeners.delete(k);
        running--;
        pump();
      });
  }
};

/**
 * Ask for a tile's pictures; `onReady` gets them (null when there's no engine to draw them).
 * Call the returned function when the tile scrolls out of view or goes: a tile still waiting
 * for its turn then leaves the line.
 */
export const wantTile = (spec: EngineTileSpec, onReady: (art: TileArt | null) => void): (() => void) => {
  const k = key(spec);
  if (done.has(k)) {
    const art = done.get(k) ?? null;
    queueMicrotask(() => onReady(art));
    return () => {};
  }
  const set = listeners.get(k) ?? new Set();
  set.add(onReady);
  listeners.set(k, set);
  if (!started.has(k)) waiting.set(k, spec);
  pump();
  return () => {
    set.delete(onReady);
    if (set.size === 0 && !started.has(k)) {
      waiting.delete(k);
      listeners.delete(k);
    }
  };
};
