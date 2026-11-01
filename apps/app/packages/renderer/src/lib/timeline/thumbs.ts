// The pure parts of the new timeline's thumbnails (docs/plan/timeline-rewrite.md): which frames of
// a clip's media its tiles show at a zoom, how those times are rounded so a scroll or a zoom finds
// frames it already has, and the memory-capped store the pictures are kept in. The fetching and
// the drawing are components/timeline2/media.ts. Pure: no stores, no DOM.
import type { AnyClipProps } from "../types.ts";
import { sourceTimeAt } from "../speed.ts";

/** The narrowest a tile is (px): a tall, narrow picture is stretched to this, as the timeline before did. */
export const TILE_MIN_WIDTH = 36;

/** Media times are kept in these many ticks a second. */
export const TICKS_PER_SECOND = 1024;
/** The finest and coarsest rounding of a tile's time (s), both powers of two. */
export const MIN_STEP = 1 / 64;
export const MAX_STEP = 64;

/** A tile's width (px): the picture's aspect at the band's height, never narrower than the minimum. */
export const tileWidthFor = (aspect: number, height: number): number => Math.max(TILE_MIN_WIDTH, Math.round(height * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1)));

/**
 * How finely a tile's time is rounded when a tile spans `span` seconds of media: the largest
 * power of two that doesn't skip over a tile. Every coarser step's times are also finer steps'
 * times, so zooming out finds the tiles zooming in fetched, and zooming in finds the coarse ones
 * to show until the fine ones come.
 */
export const gridStep = (span: number): number => {
  if (!(span > MIN_STEP)) return MIN_STEP;
  return Math.min(MAX_STEP, 2 ** Math.floor(Math.log2(span)));
};

/** `seconds` rounded to the nearest multiple of `step` (a power of two), as whole ticks. */
export const tickOf = (seconds: number, step: number): number => Math.round(Math.round(Math.max(0, seconds) / step) * step * TICKS_PER_SECOND);

/** A tile: its place in the clip (`x`, px from the clip's left, `w` wide) and the media time it shows (ticks). */
export interface Tile {
  i: number;
  x: number;
  w: number;
  tick: number;
}

export interface TileInput {
  clip: AnyClipProps;
  fps: number;
  /** The timeline's scale. */
  pxPerFrame: number;
  tileWidth: number;
  /** The part of the clip to cover, px from its left edge (what's on screen). */
  fromPx: number;
  toPx: number;
  /** The media's length (s), for a reversed clip, and where in the file it starts (s, a split's range). */
  mediaSeconds?: number;
  mediaStart?: number;
  /** A photo: every tile shows the same still. */
  still?: boolean;
}

/**
 * The tiles covering `fromPx`..`toPx` of the clip: edge to edge from its left, each showing the
 * media at its left edge through the clip's trim, speed, curve and direction (`sourceTimeAt`),
 * so the first tile is the clip's first frame. A photo's are all time 0.
 */
export const planTiles = (o: TileInput): Tile[] => {
  const len = Math.max(1, (o.clip.endFrame ?? 0) - (o.clip.startFrame ?? 0));
  const width = len * o.pxPerFrame;
  const first = Math.max(0, Math.floor(o.fromPx / o.tileWidth));
  const last = Math.min(Math.ceil(width / o.tileWidth), Math.ceil(o.toPx / o.tileWidth)) - 1;
  const maxTime = o.mediaSeconds ? Math.max(0, o.mediaSeconds - 1 / 64) + (o.mediaStart ?? 0) : Infinity;
  const out: Tile[] = [];
  for (let i = first; i <= last; i++) {
    const x = i * o.tileWidth;
    if (o.still) {
      out.push({ i, x, w: o.tileWidth, tick: 0 });
      continue;
    }
    const local = x / o.pxPerFrame;
    const t0 = sourceTimeAt(o.clip, local, o.fps, o.mediaSeconds) + (o.mediaStart ?? 0);
    const t1 = sourceTimeAt(o.clip, local + o.tileWidth / o.pxPerFrame, o.fps, o.mediaSeconds) + (o.mediaStart ?? 0);
    out.push({ i, x, w: o.tileWidth, tick: tickOf(Math.min(maxTime, t0), gridStep(Math.abs(t1 - t0))) });
  }
  return out;
};

interface Entry<T> {
  group: string;
  tick: number;
  value: T;
  bytes: number;
}

/**
 * The pictures kept for the tiles, a least-recently-used store under a memory cap. They're kept
 * per group (an asset at a tile height) by media time, so a tile can be asked for exactly, or the
 * nearest one stood in while the exact one is fetched.
 */
export class TileStore<T> {
  private entries = new Map<string, Entry<T>>();
  private groups = new Map<string, { ticks: Set<number>; sorted: number[] | null }>();
  private used = 0;

  private readonly cap: number;
  private readonly onEvict?: (value: T) => void;

  constructor(cap: number, onEvict?: (value: T) => void) {
    this.cap = cap;
    this.onEvict = onEvict;
  }

  get bytes() {
    return this.used;
  }
  get size() {
    return this.entries.size;
  }

  private static key = (group: string, tick: number) => `${group}@${tick}`;

  has(group: string, tick: number): boolean {
    return this.entries.has(TileStore.key(group, tick));
  }

  /** The picture at exactly `tick`, which counts as used. */
  get(group: string, tick: number): T | undefined {
    const k = TileStore.key(group, tick);
    const e = this.entries.get(k);
    if (!e) return undefined;
    this.entries.delete(k);
    this.entries.set(k, e);
    return e.value;
  }

  set(group: string, tick: number, value: T, bytes: number) {
    const k = TileStore.key(group, tick);
    const old = this.entries.get(k);
    if (old) this.drop(k, old);
    this.entries.set(k, { group, tick, value, bytes });
    this.used += bytes;
    let g = this.groups.get(group);
    if (!g) this.groups.set(group, (g = { ticks: new Set(), sorted: null }));
    g.ticks.add(tick);
    g.sorted = null;
    // The oldest go first, never the one just set.
    for (const [ok, oe] of this.entries) {
      if (this.used <= this.cap || ok === k) break;
      this.drop(ok, oe);
    }
  }

  private drop(k: string, e: Entry<T>) {
    this.entries.delete(k);
    this.used -= e.bytes;
    const g = this.groups.get(e.group);
    if (g) {
      g.ticks.delete(e.tick);
      g.sorted = null;
      if (g.ticks.size === 0) this.groups.delete(e.group);
    }
    this.onEvict?.(e.value);
  }

  /** The picture in `group` nearest `tick` in time (the earlier one on a tie), if there is one. */
  nearest(group: string, tick: number): { tick: number; value: T } | undefined {
    const g = this.groups.get(group);
    if (!g) return undefined;
    const a = (g.sorted ??= [...g.ticks].sort((x, y) => x - y));
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid] < tick) lo = mid + 1;
      else hi = mid;
    }
    const before = lo > 0 ? a[lo - 1] : undefined;
    const after = lo < a.length ? a[lo] : undefined;
    const t = before === undefined ? after! : after === undefined ? before : tick - before <= after - tick ? before : after;
    const value = this.get(group, t);
    return value === undefined ? undefined : { tick: t, value };
  }

  clear() {
    for (const e of this.entries.values()) this.onEvict?.(e.value);
    this.entries.clear();
    this.groups.clear();
    this.used = 0;
  }
}
