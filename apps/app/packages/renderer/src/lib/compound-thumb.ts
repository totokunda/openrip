// Pictures for a compound clip: its content's pictures stand in for it on the timeline (a strip
// of its clips' posters, as the thumbnails of a video) and in the Subprojects library. A poster
// is the first frame of a media file (lib/media/timeline.ts); the compound's own picture at a
// time would come from the engine, which the timeline doesn't ask for per tile.
import { useClipStore } from "./clip";
import { generatePosterCanvas } from "./media/timeline";
import { allClips } from "./compound";
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
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  const step = Math.max(8, tile);
  for (let x = 0; x < w; x += step) {
    const frame = from + ((x + step / 2) / Math.max(1, w)) * (to - from);
    const path = pathAt(content, Math.floor(frame));
    const poster = path ? posterOf(path, again) : null;
    if (!poster) continue;
    const [pw, ph] = [(poster as any).width || 1, (poster as any).height || 1];
    // Cover the tile, centred.
    const k = Math.max(step / pw, h / ph);
    const [dw, dh] = [pw * k, ph * k];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, step - 1, h);
    ctx.clip();
    ctx.drawImage(poster, x + (step - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
  }
};
