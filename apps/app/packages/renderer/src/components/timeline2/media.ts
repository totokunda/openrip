// What the new timeline's clips show of their media (docs/plan/timeline-rewrite.md), kept so the
// canvas can draw it in a frame: thumbnail tiles as bitmaps in a memory-capped store, waveform
// buckets per file, the media's info, sticker pictures. Drawing never waits for any of it: it
// takes what's here now (for a tile not yet fetched, the nearest one of the same media) and asks
// for the rest in the background; when something arrives, `setMediaRedraw`'s callback draws again.
//
// Asking is cheap to repeat: a tile asked for is only asked once (until it's fetched, or dropped
// unfetched), and a request waits in a queue where it's checked against what the last draw wanted,
// so tiles for clips that have scrolled away or been zoomed past are never decoded. A scroll or a
// zoom that finds its tiles in the store makes no request at all (see `mediaStats`). Nothing here
// goes through React.
import { getMediaInfo, getMediaInfoCached } from "@/lib/media/utils";
import { fetchCanvasSamplesStream } from "@/lib/media/canvas";
import { generateTimelineSamples } from "@/lib/media/timeline";
import { useMissingMedia } from "@/lib/media/missing";
import { waveformOf } from "@/lib/waveform-source";
import { compoundMix } from "@/lib/compound-mix";
import { contentKey } from "@/lib/compound-thumb";
import { cachedUrl } from "@/lib/stickers/library";
import { fetchBeatGrid, knownBeatGrid } from "@/lib/audio-tools";
import { TileStore, TICKS_PER_SECOND } from "@/lib/timeline/thumbs";
import { clipBars, type Bar, type WaveScale, type WaveformBuckets } from "@/lib/waveform";
import type { AnyClipProps, CompoundContent, MediaInfo } from "@/lib/types";
import type { BeatGrid } from "@/lib/beats";

/** The most memory the thumbnail tiles may take (a tile is about 30 KB). */
const TILE_BYTES = 96 * 1024 * 1024;
/** Decodes running at once, and tiles in one. */
const JOBS = 2;
const JOB_TILES = 8;
/** How long a draw's requests gather before they go out, so one scroll step's tiles go together. */
const GATHER_MS = 24;

let redraw: () => void = () => undefined;
let unwatch: (() => void) | null = null;
/** The surface says what draws the canvas again when something arrives (as it mounts); returns what undoes it. */
export const setMediaRedraw = (fn: () => void) => {
  redraw = fn;
  // A file coming or going missing changes what's drawn.
  unwatch?.();
  unwatch = useMissingMedia.subscribe(() => redraw());
  installHook();
  return () => {
    unwatch?.();
    unwatch = null;
    if (redraw === fn) redraw = () => undefined;
  };
};
const again = () => redraw();
export const requestRedraw = again;

// ---- what the harness reads ----

export interface MediaStats {
  /** Tiles decoded or loaded for the timeline, jobs run and the waveform files asked, since the page began. */
  tilesFetched: number;
  jobs: number;
  waveformsAsked: number;
  /** Tiles in the store and the bytes they take. */
  tiles: number;
  bytes: number;
  /** Requests waiting for a decode. */
  queued: number;
}
const counters = { tilesFetched: 0, jobs: 0, waveformsAsked: 0 };

export const mediaStats = (): MediaStats => ({ ...counters, tiles: store.size, bytes: store.bytes, queued: queue.length });

/** What the last draw put on each clip, for the smoke tests in place of probing pixels. */
export interface ClipFacts {
  clipId: string;
  thumbs?: { tiles: number; exact: number; placeholder: number; tileWidth: number; y: number; height: number };
  sound?: { y: number; height: number; heights: Bar[]; maxBar: number; line: Bar[]; pxPerFrame: number; color: string; scale: WaveScale };
  chips?: string[];
  /** The glyph before the first chip (a compound's, an effect bar's wand). */
  glyph?: string | null;
  missing?: boolean;
  beats?: number;
  sticker?: boolean;
  badge?: string | null;
}
const facts = new Map<string, ClipFacts>();
export const factsOf = (clipId: string): ClipFacts => {
  let f = facts.get(clipId);
  if (!f) facts.set(clipId, (f = { clipId }));
  return f;
};

let hooked = false;
const installHook = () => {
  if (hooked) return;
  hooked = true;
  const hook = {
    media: (clipId: string) => facts.get(clipId) ?? null,
    stats: mediaStats,
    /** Forget every tile (for measuring a cold start). */
    drop: () => store.clear(),
  };
  (window as unknown as { __openripTimelineMedia?: typeof hook }).__openripTimelineMedia = hook;
};

// ---- thumbnail tiles ----

const store = new TileStore<ImageBitmap>(TILE_BYTES, (b) => b.close());

/** A group of tiles in the store: one file at one tile height (device px). */
export const groupOf = (path: string, hpx: number) => `${path}|${hpx}`;

interface Req {
  key: string;
  group: string;
  path: string;
  tick: number;
  wpx: number;
  hpx: number;
  clipFps: number;
  still: boolean;
  info: MediaInfo;
}
const queue: Req[] = [];
/** Tiles asked for and not yet fetched or dropped. */
const inflight = new Set<string>();
/** Tiles the last draw wanted: a queued request that isn't in it is stale. */
const wanted = new Set<string>();
/** Tiles that couldn't be made, not asked for again. */
const failed = new Set<string>();
let active = 0;
let gather = 0;

/** A draw is starting: what it asks for is what's wanted now. Called once per draw of the main canvas. */
export const beginMediaPass = () => {
  wanted.clear();
  facts.clear();
};

export interface TileSource {
  path: string;
  hpx: number;
  wpx: number;
  clipFps: number;
  still: boolean;
  info: MediaInfo;
}

/**
 * The picture for the tile at `tick` of `src`: the exact one if it's here, else the nearest one of
 * the same file (not exact), and the exact one is asked for. Undefined when there's nothing yet.
 */
export const pictureAt = (src: TileSource, tick: number): { bitmap: ImageBitmap; exact: boolean } | undefined => {
  const group = groupOf(src.path, src.hpx);
  const key = `${group}@${tick}`;
  const have = store.get(group, tick);
  if (have) return { bitmap: have, exact: true };
  if (!failed.has(key)) {
    wanted.add(key);
    if (!inflight.has(key)) {
      inflight.add(key);
      queue.push({ key, group, path: src.path, tick, wpx: src.wpx, hpx: src.hpx, clipFps: src.clipFps, still: src.still, info: src.info });
      if (!gather) gather = window.setTimeout(pump, GATHER_MS);
    }
  }
  const near = store.nearest(group, tick);
  return near ? { bitmap: near.value, exact: false } : undefined;
};

/** Takes the next requests that are still wanted, up to a job's worth for one file and height. */
const nextJob = (): Req[] | null => {
  let head: Req | undefined;
  const job: Req[] = [];
  for (let i = 0; i < queue.length && job.length < JOB_TILES; ) {
    const r = queue[i];
    if (!wanted.has(r.key)) {
      // Stale: the clip has scrolled away or the zoom has moved on. It can be asked for again later.
      queue.splice(i, 1);
      inflight.delete(r.key);
      continue;
    }
    if (!head || r.group === head.group) {
      head ??= r;
      job.push(r);
      queue.splice(i, 1);
      continue;
    }
    i++;
  }
  return job.length ? job : null;
};

function pump() {
  gather = 0;
  while (active < JOBS) {
    const job = nextJob();
    if (!job) return;
    active++;
    void run(job).finally(() => {
      active--;
      pump();
    });
  }
}

const put = async (r: Req, canvas: CanvasImageSource) => {
  const bitmap = await createImageBitmap(canvas);
  store.set(r.group, r.tick, bitmap, bitmap.width * bitmap.height * 4);
  inflight.delete(r.key);
  counters.tilesFetched++;
};

async function run(job: Req[]) {
  const head = job[0];
  counters.jobs++;
  try {
    if (head.still) {
      const samples = await generateTimelineSamples("timeline", head.path, [0], head.wpx, head.hpx, head.wpx, { mediaInfo: head.info });
      const canvas = samples?.[0]?.canvas;
      if (canvas) await put(head, canvas as CanvasImageSource);
      else failed.add(head.key);
    } else {
      const frames = job.map((r) => Math.round((r.tick / TICKS_PER_SECOND) * r.clipFps));
      const done = new Set<number>();
      for await (const { pos, sample } of fetchCanvasSamplesStream(head.path, frames, head.wpx, head.hpx, { mediaInfo: head.info })) {
        const r = job[pos];
        if (sample?.canvas) await put(r, sample.canvas as CanvasImageSource);
        else failed.add(r.key);
        done.add(pos);
        redraw();
        // Everything left is stale: stop decoding.
        if (!job.some((x, i) => !done.has(i) && wanted.has(x.key))) break;
      }
    }
  } catch {
    // The frames that didn't come are tried again by a later draw only if they weren't marked failed.
  } finally {
    for (const r of job) inflight.delete(r.key);
    redraw();
  }
}

// ---- media info ----

const infoAsked = new Set<string>();
/** The media's info (size, frame rate) if the app has read it; otherwise it's read in the background. */
export const mediaInfoOf = (assetId: string | undefined, path: string | undefined): MediaInfo | undefined => {
  if (!assetId || !path) return undefined;
  const have = getMediaInfoCached(assetId);
  if (have) return have;
  if (!infoAsked.has(path)) {
    infoAsked.add(path);
    void getMediaInfo(path)
      .catch(() => undefined)
      .then((i) => {
        if (!i) infoAsked.delete(path);
        redraw();
      });
  }
  return undefined;
};

// ---- waveforms ----

const buckets = new Map<string, { b: WaveformBuckets | null; at: number }>();
const asking = new Set<string>();
/** A file with no buckets (no sound, or the engine not ready) is asked again after this long, if drawn. */
const RETRY_MS = 10_000;

/** The buckets of a media file (a path with its `#audio` or `#video` suffix is fine): null until they've come or without sound. */
export const bucketsOf = (file: string): WaveformBuckets | null => {
  const have = buckets.get(file);
  if (have && (have.b || performance.now() - have.at < RETRY_MS)) return have.b;
  if (!asking.has(file)) {
    asking.add(file);
    counters.waveformsAsked++;
    void waveformOf(file).then((b) => {
      asking.delete(file);
      buckets.set(file, { b, at: performance.now() });
      if (b) redraw();
    });
  }
  return have?.b ?? null;
};

/** A compound clip's mix: the last one made stays up while a new one is, so the band doesn't blink on every edit. */
const mixes = new Map<string, { key: string; timer: number; made: { buckets: WaveformBuckets; seconds: number } | null }>();
export const compoundSoundOf = (clipId: string, content: CompoundContent): { buckets: WaveformBuckets; seconds: number } | null => {
  const key = contentKey(content);
  let m = mixes.get(clipId);
  if (!m) mixes.set(clipId, (m = { key: "", timer: 0, made: null }));
  if (m.key !== key) {
    m.key = key;
    window.clearTimeout(m.timer);
    const mine = m;
    // A moment after the content stops changing.
    m.timer = window.setTimeout(() => {
      void compoundMix(content).then(async (mix) => {
        if (!mix || mine.key !== key) return;
        const b = await waveformOf(mix.path);
        if (b && mine.key === key) {
          mine.made = { buckets: b, seconds: mix.seconds };
          redraw();
        }
      });
    }, 500);
  }
  return m.made;
};

// ---- bars, kept while the zoom and the clip stay the same ----

const bucketIds = new WeakMap<WaveformBuckets, number>();
let nextBucketId = 1;
const barCache = new WeakMap<AnyClipProps, { key: string; from: number; to: number; bars: Bar[] }>();
/** How far past what's on screen bars are worked out, so a scroll reuses them. */
const BAR_MARGIN = 600;

/** The clip's bars over px `from`..`to` of it (lib/waveform.ts `clipBars`), reused while the clip, its sound and the zoom stay and the range is inside the last one worked out. */
export const barsOf = (clip: AnyClipProps, b: WaveformBuckets, o: { fps: number; pxPerFrame: number; mediaSeconds?: number; from: number; to: number; scale: WaveScale; max: number }): Bar[] => {
  let id = bucketIds.get(b);
  if (!id) bucketIds.set(b, (id = nextBucketId++));
  const key = `${id}|${o.fps}|${o.pxPerFrame}|${o.mediaSeconds ?? ""}|${o.scale.full}|${o.scale.lag}|${o.max}`;
  const have = barCache.get(clip);
  if (have && have.key === key && have.from <= o.from && have.to >= o.to) return have.bars;
  const from = Math.max(0, o.from - BAR_MARGIN);
  const to = o.to + BAR_MARGIN;
  const bars = clipBars(clip, b, { fps: o.fps, pxPerFrame: o.pxPerFrame, mediaSeconds: o.mediaSeconds, fromPx: from, toPx: to, scale: o.scale, max: o.max });
  barCache.set(clip, { key, from, to, bars });
  return bars;
};

// ---- beats ----

const beatCache = new WeakMap<AnyClipProps, { grid: BeatGrid | null; frames: number[] }>();
export const gridOf = (clip: AnyClipProps, wantsGrid: boolean): BeatGrid | null => {
  if (!wantsGrid) return null;
  const known = knownBeatGrid(clip);
  if (known === undefined) void fetchBeatGrid(clip).then(() => redraw());
  return known ?? null;
};
export const cachedBeats = (clip: AnyClipProps, grid: BeatGrid | null, make: () => number[]): number[] => {
  const have = beatCache.get(clip);
  if (have && have.grid === grid) return have.frames;
  const frames = make();
  beatCache.set(clip, { grid, frames });
  return frames;
};

// ---- stickers ----

const stickers = new Map<string, HTMLImageElement | null>();
/** A sticker's picture once it's loaded (asked for, in the background, the first time). */
export const stickerImage = (path: string | undefined): HTMLImageElement | null => {
  if (!path) return null;
  if (stickers.has(path)) {
    const img = stickers.get(path);
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }
  const img = new Image();
  stickers.set(path, img);
  img.onload = () => redraw();
  img.onerror = () => stickers.set(path, null);
  img.src = cachedUrl(path);
  return null;
};
