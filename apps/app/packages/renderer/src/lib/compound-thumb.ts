// Pictures for a compound clip: its own composite frames (everything in its timeline put together
// by the engine, as the player shows it) stand in for it on the timeline as a video's thumbnails
// do, and in the Subprojects library. Until the engine's frame for a tile is here, the tile shows
// the poster of the media under it (the first frame of a media file, lib/media/timeline.ts).
import { useClipStore } from "./clip";
import { generatePosterCanvas } from "./media/timeline";
import { allClips } from "./compound";
import { engineProjectPreviews } from "@app/preload";
import { compoundDocument } from "./middlewares/json-persistence";
import { useControlsStore } from "./control";
import { useViewportStore } from "./viewport";
import type { AnyClipProps, CompoundContent, VideoClipProps, ImageClipProps } from "./types";

const posters = new Map<string, CanvasImageSource | null>();
const pending = new Map<string, Promise<CanvasImageSource | null>>();

/** A media file's poster, made once; null while it's being made or when it can't be. */
export const posterOf = (path: string, onReady?: () => void): CanvasImageSource | null => {
  if (posters.has(path)) return posters.get(path) ?? null;
  if (!pending.has(path)) {
    pending.set(
      path,
      generatePosterCanvas(path)
        .then((p) => {
          posters.set(path, p);
          return p;
        })
        .catch(() => {
          posters.set(path, null);
          return null;
        }),
    );
  }
  void pending.get(path)!.then(() => onReady?.());
  return null;
};

// ---- the compound's own frames, from the engine ----

/** Frame times are rounded to this many per second, so a zoom change mostly finds frames it has. */
const TILES_PER_SECOND = 4;
const TILE_HEIGHT = 96;

const bitmaps = new Map<string, ImageBitmap>();
const asked = new Set<string>();
const keys = new WeakMap<CompoundContent, string>();
let waiting: { content: CompoundContent; times: Set<number>; again: Set<() => void> } | null = null;
let draining: Promise<unknown> = Promise.resolve();

/** A short key for a compound's content: its saved form, hashed (made once per content object). */
export const contentKey = (content: CompoundContent): string => {
  let k = keys.get(content);
  if (!k) {
    const text = JSON.stringify(compoundDocument(content));
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    k = `${(h >>> 0).toString(36)}-${text.length}`;
    keys.set(content, k);
  }
  return k;
};

const tileKey = (content: CompoundContent, t: number) => `${contentKey(content)}@${t}`;
const quantize = (seconds: number) => Math.max(0, Math.round(seconds * TILES_PER_SECOND));

const flush = () => {
  const job = waiting;
  waiting = null;
  if (!job || job.times.size === 0) return;
  const times = [...job.times].sort((a, b) => a - b);
  const { aspectRatio } = useViewportStore.getState();
  const ratio = aspectRatio.width / aspectRatio.height;
  const width = Math.round(TILE_HEIGHT * (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9));
  // The engine draws one project at a time: the asks go in turn.
  draining = draining
    .then(async () => {
      const frames = await engineProjectPreviews(JSON.stringify(compoundDocument(job.content)), times.map((t) => t / TILES_PER_SECOND), width, TILE_HEIGHT);
      await Promise.all(
        frames.map(async (f, i) => {
          if (!f?.rgba?.length) return;
          const data = new ImageData(new Uint8ClampedArray(f.rgba.buffer.slice(f.rgba.byteOffset, f.rgba.byteOffset + f.rgba.byteLength) as ArrayBuffer), f.width, f.height);
          bitmaps.set(tileKey(job.content, times[i]), await createImageBitmap(data));
        }),
      );
      // How many composite frames are drawn, for the harness to read.
      document.documentElement.dataset.compoundFrames = String(bitmaps.size);
    })
    .catch(() => undefined)
    .then(() => job.again.forEach((f) => f()));
};

/** The engine's frame of the compound's content at `seconds`, if it's been drawn; otherwise it's asked for (`again` is called when it comes). */
export const compoundFrame = (content: CompoundContent, seconds: number, again?: () => void): ImageBitmap | null => {
  const t = quantize(seconds);
  const key = tileKey(content, t);
  const have = bitmaps.get(key);
  if (have) return have;
  if (!asked.has(key)) {
    asked.add(key);
    if (waiting && waiting.content !== content) flush();
    waiting ??= { content, times: new Set(), again: new Set() };
    waiting.times.add(t);
    if (again) waiting.again.add(again);
    // The tiles of one paint go out together.
    const job = waiting;
    setTimeout(() => waiting === job && flush(), 60);
  } else if (again && waiting?.content === content) {
    waiting.again.add(again);
  }
  return null;
};

const visual = (c: AnyClipProps): c is VideoClipProps | ImageClipProps => (c.type === "video" || c.type === "image") && !(c as VideoClipProps).compound;

/** The media file under a compound's content at `frame` (content frames): the lowest visible video or photo clip there. Falls back to the first one in time. */
export const pathAt = (content: CompoundContent, frame: number): string | undefined => {
  const assets = useClipStore.getState().assets;
  const pathOf = (c: AnyClipProps) => assets[(c as VideoClipProps).assetId]?.path;
  // The lowest track on screen first (the main track), within a nested compound too.
  const rows = [...content.timelines].reverse();
  const flat = (clips: AnyClipProps[]) => allClips(clips);
  for (const t of rows) {
    const hit = flat(content.clips.filter((c) => c.timelineId === t.timelineId)).find((c) => visual(c) && frame >= (c.startFrame ?? 0) && frame < (c.endFrame ?? 0) && pathOf(c));
    if (hit) return pathOf(hit);
  }
  const first = flat(content.clips).filter((c) => visual(c) && pathOf(c)).sort((a, b) => (a.startFrame ?? 0) - (b.startFrame ?? 0))[0];
  return first ? pathOf(first) : undefined;
};

/**
 * Paint a compound clip's strip into `canvas`: tiles of `tile` px, each the poster of the media
 * under the content at that tile's time (the clip showing frames `from`…`to` of its content),
 * on `fill` where there's none. Calls `again` when a poster that wasn't ready is.
 */
export const paintCompoundStrip = (canvas: HTMLCanvasElement, content: CompoundContent, from: number, to: number, tile: number, fill: string, again: () => void) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const [w, h] = [canvas.width, canvas.height];
  const fps = useControlsStore.getState().fps || 24;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  const step = Math.max(8, tile);
  for (let x = 0; x < w; x += step) {
    const frame = from + ((x + step / 2) / Math.max(1, w)) * (to - from);
    let picture: CanvasImageSource | null = compoundFrame(content, frame / fps, again);
    if (!picture) {
      const path = pathAt(content, Math.floor(frame));
      picture = path ? posterOf(path, again) : null;
    }
    if (!picture) continue;
    const [pw, ph] = [(picture as any).width || 1, (picture as any).height || 1];
    // Cover the tile, centred.
    const k = Math.max(step / pw, h / ph);
    const [dw, dh] = [pw * k, ph * k];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, step - 1, h);
    ctx.clip();
    ctx.drawImage(picture, x + (step - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
  }
};
