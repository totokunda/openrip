/**
 * Frames of a video this app's own decoder can't read (ProRes, for one), from the Rust
 * engine's thumbnailer: a stand-in for mediabunny's CanvasSink with the calls the app makes
 * of it. Frames come at the requested size (stretched to it, as `fit: "fill"`).
 */
import type { WrappedCanvas } from "mediabunny";
import { engineThumbnails } from "@app/preload";

/** Frames asked for in one go when streaming a range. */
const BATCH = 24;
/** At most this many frames for one range (a timeline strip asks for far fewer). */
const MAX_RANGE_FRAMES = 1200;

export class EngineCanvasSink {
  constructor(
    private readonly path: string,
    private readonly width: number,
    private readonly height: number,
    private readonly frameRate: number,
  ) {}

  private async frames(timestamps: number[]): Promise<(WrappedCanvas | null)[]> {
    const out: (WrappedCanvas | null)[] = timestamps.map(() => null);
    if (timestamps.length === 0) return out;
    const times = timestamps.map((t) => Math.max(0, Math.round(t * 1e6)));
    const thumbs = await engineThumbnails(this.path, times, Math.max(1, Math.round(this.height)), true).catch(() => []);
    const duration = 1 / (this.frameRate || 30);
    for (const t of thumbs) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(this.width));
      canvas.height = Math.max(1, Math.round(this.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      const pixels = new ImageData(new Uint8ClampedArray(t.rgba.buffer, t.rgba.byteOffset, t.rgba.byteLength), t.width, t.height);
      if (t.width === canvas.width && t.height === canvas.height) {
        ctx.putImageData(pixels, 0, 0);
      } else {
        const bitmap = await createImageBitmap(pixels);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
      }
      out[t.index] = { canvas, timestamp: timestamps[t.index], duration } as WrappedCanvas;
    }
    return out;
  }

  async getCanvas(timestamp: number): Promise<WrappedCanvas | null> {
    return (await this.frames([timestamp]))[0];
  }

  async *canvasesAtTimestamps(timestamps: Iterable<number> | AsyncIterable<number>): AsyncGenerator<WrappedCanvas | null> {
    const list: number[] = [];
    for await (const t of timestamps as AsyncIterable<number>) list.push(t);
    for (let i = 0; i < list.length; i += BATCH) {
      for (const c of await this.frames(list.slice(i, i + BATCH))) yield c;
    }
  }

  async *canvases(start = 0, end = Infinity): AsyncGenerator<WrappedCanvas> {
    const step = 1 / (this.frameRate || 30);
    const times: number[] = [];
    for (let t = start; t < end && times.length < MAX_RANGE_FRAMES; t += step) times.push(t);
    for (let i = 0; i < times.length; i += BATCH) {
      for (const c of await this.frames(times.slice(i, i + BATCH))) if (c) yield c;
    }
  }

  close(): void {}
}
