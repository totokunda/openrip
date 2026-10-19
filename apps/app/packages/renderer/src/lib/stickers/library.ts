// The Stickers tab's library: the manifest the app ships (public/stickers/manifest.json, made
// by scripts/build-sticker-manifest.mjs from Fluent Emoji, Noto Emoji and the animated Noto
// emoji), what's on this machine already (the starter set the app ships, and what was
// downloaded before), the favourites, the tile being previewed, and adding a sticker to the
// timeline. A sticker's file is fetched the first time it's used, into the user's app data,
// and the engine draws the clip from that file.
import { create } from "zustand";
import { stickerDownload, stickerStore, stickersCached } from "@app/preload";
import type { StickerClipProps } from "../types";

export type StickerSet = {
  id: string;
  name: string;
  style: "3D" | "Color" | "Flat" | "Noto" | "Animated";
  format: "png" | "svg" | "webp";
  animated: boolean;
  base: string;
  license: string;
  licenseUrl: string;
  attribution: string;
};

export type Sticker = {
  id: string;
  name: string;
  /** Lower-case words it's found by. */
  words: string[];
  /** Categories it's listed under ("Trending", "Love", …). */
  categories: string[];
  set: StickerSet;
  /** Where its file is at its source, and its thumbnail (the file itself when it has no other). */
  url: string;
  thumbUrl: string;
  ext: string;
  /** Shipped in the app (the starter set). */
  starter: boolean;
  /** Its popularity among the animated set (for Trending's order). */
  rank: number;
};

type Row = [string, string, string, number[], number, string, string | 0, number, number];
type Manifest = { version: number; sets: StickerSet[]; categories: string[]; items: Row[] };

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** The manifest's rows as stickers. */
export const parseManifest = (m: Manifest): { stickers: Sticker[]; categories: string[]; sets: StickerSet[] } => {
  const noto = m.sets.find((s) => s.id === "noto");
  const stickers = m.items.map(([id, name, keywords, cats, setIdx, file, thumb, rank, starter]) => {
    const set = m.sets[setIdx];
    const url = set.base + encodePath(file);
    const thumbUrl = thumb ? (thumb.startsWith("@noto:") && noto ? noto.base + encodePath(thumb.slice(6)) : set.base + encodePath(thumb)) : url;
    return {
      id,
      name,
      words: keywords.split(",").filter(Boolean),
      categories: cats.map((c) => m.categories[c]),
      set,
      url,
      thumbUrl,
      ext: file.split(".").pop() ?? set.format,
      starter: !!starter,
      rank,
    } satisfies Sticker;
  });
  return { stickers, categories: m.categories, sets: m.sets };
};

const FAVOURITES = "openrip.sticker-favorites";
const readFavourites = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FAVOURITES) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

type StickerLibrary = {
  stickers: Sticker[];
  categories: string[];
  loaded: boolean;
  /** Files on this machine: id to path. */
  cached: Record<string, string>;
  /** Downloads under way, and the ones that failed (id to the reason). */
  loading: string[];
  failed: Record<string, string>;
  favourites: string[];
  toggleFavourite: (id: string) => void;
  /** The tile that was clicked: the player shows it until it's let go. */
  preview: Sticker | null;
  setPreview: (s: Sticker | null) => void;
  load: () => Promise<void>;
};

export const useStickerLibrary = create<StickerLibrary>((set, get) => ({
  stickers: [],
  categories: [],
  loaded: false,
  cached: {},
  loading: [],
  failed: {},
  favourites: readFavourites(),
  toggleFavourite: (id) => {
    const now = get().favourites;
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    try {
      localStorage.setItem(FAVOURITES, JSON.stringify(next));
    } catch {
      // storage can be blocked; the favourites last the session
    }
    set({ favourites: next });
  },
  preview: null,
  setPreview: (preview) => set({ preview }),
  load: async () => {
    if (get().loaded) return;
    set({ loaded: true });
    try {
      const res = await fetch(new URL("stickers/manifest.json", document.baseURI).href);
      const parsed = parseManifest(await res.json());
      set({ stickers: parsed.stickers, categories: parsed.categories });
    } catch {
      set({ loaded: false });
    }
    try {
      set({ cached: (await stickersCached()) ?? {} });
    } catch {
      // not in the app shell: nothing is cached
    }
  },
}));

/** The stickers' categories as the tab's column lists them, after Trending. */
export const STICKER_CATEGORIES = ["Trending", "Emoji", "Animated", "Love", "Celebration", "Reactions", "Arrows", "Smileys", "People", "Nature", "Food", "Travel", "Activities", "Objects", "Symbols", "Flags"];

/** The filter beside the search: which sets' pictures show. "Recommended" is 3D and animated. */
export const STYLE_FILTERS = ["Recommended", "3D", "Color", "Flat", "Noto", "Animated"] as const;
export type StyleFilter = (typeof STYLE_FILTERS)[number];

export const inStyle = (s: Sticker, f: StyleFilter) => (f === "Recommended" ? s.set.style === "3D" || s.set.style === "Animated" : s.set.style === f);

/** A file in the cache as the renderer loads it. */
export const cachedUrl = (path: string) => `app://user-data${encodeURI(path)}`;

const publicUrl = (rel: string) => new URL(rel, document.baseURI).href;

/** What a tile shows: the starter file, the cached one, else the picture at its source. */
export const thumbSrc = (s: Sticker, cached: Record<string, string>) => {
  if (s.starter) return publicUrl(`stickers/starter/${s.id}${s.set.animated ? ".thumb.png" : `.${s.ext}`}`);
  if (!s.set.animated && cached[s.id]) return cachedUrl(cached[s.id]);
  return s.thumbUrl;
};

/** The picture in motion (an animated sticker's file), or the still one. */
export const fullSrc = (s: Sticker, cached: Record<string, string>) => {
  if (cached[s.id]) return cachedUrl(cached[s.id]);
  if (s.starter) return publicUrl(`stickers/starter/${s.id}.${s.ext}`);
  return s.url;
};

/** Whether the sticker's file is on this machine (or ships with the app, to be copied in). */
export const isReady = (s: Sticker, cached: Record<string, string>) => s.starter || !!cached[s.id];

/**
 * Make the sticker's file local: a starter one is copied from the app, the others downloaded.
 * Resolves with its path, or null when it couldn't be fetched (the tile then says why).
 */
export const ensureSticker = async (s: Sticker): Promise<string | null> => {
  const lib = useStickerLibrary.getState();
  const have = lib.cached[s.id];
  if (have) return have;
  useStickerLibrary.setState((st) => ({ loading: [...new Set([...st.loading, s.id])], failed: { ...st.failed, [s.id]: "" } }));
  let path: string | null = null;
  let error = "";
  try {
    if (s.starter) {
      const res = await fetch(publicUrl(`stickers/starter/${s.id}.${s.ext}`));
      const out = await stickerStore({ id: s.id, ext: s.ext, bytes: new Uint8Array(await res.arrayBuffer()) });
      if (out.ok) path = out.path;
      else error = out.error;
    } else {
      const out = await stickerDownload({ id: s.id, ext: s.ext, url: s.url });
      if (out.ok) path = out.path;
      else error = out.error;
    }
  } catch (e) {
    error = (e as Error).message;
  }
  useStickerLibrary.setState((st) => ({
    loading: st.loading.filter((x) => x !== s.id),
    cached: path ? { ...st.cached, [s.id]: path } : st.cached,
    failed: path ? Object.fromEntries(Object.entries(st.failed).filter(([k]) => k !== s.id)) : { ...st.failed, [s.id]: error || "download failed" },
  }));
  return path;
};

/** A picture's size in pixels as the browser reads it (an SVG without one gets 256). */
const naturalSize = (url: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 256, height: img.naturalHeight || img.naturalWidth || 256 });
    img.onerror = () => resolve({ width: 256, height: 256 });
    img.src = url;
  });

/** A sticker's default length on the timeline (CapCut's stickers: 3 s). */
export const STICKER_SECONDS = 3;
/** How much of the canvas's short side a new sticker's longer side covers. */
export const STICKER_FRACTION = 0.3;

/** The clip a sticker makes: its box (world units) centred on `center` of the canvas. */
export const stickerClip = (
  s: Sticker,
  file: { path: string; width: number; height: number },
  at: { clipId: string; timelineId: string; startFrame: number; fps: number },
  canvas: { width: number; height: number },
  center = { x: canvas.width / 2, y: canvas.height / 2 },
): StickerClipProps => {
  const long = Math.min(canvas.width, canvas.height) * STICKER_FRACTION;
  const k = long / Math.max(file.width, file.height);
  const [width, height] = [file.width * k, file.height * k];
  const transform = { x: center.x - width / 2, y: center.y - height / 2, width, height, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 };
  return {
    clipId: at.clipId,
    type: "sticker",
    timelineId: at.timelineId,
    startFrame: at.startFrame,
    endFrame: at.startFrame + Math.round(STICKER_SECONDS * at.fps),
    trimEnd: -Infinity,
    trimStart: Infinity,
    stickerId: s.id,
    name: s.name,
    category: s.categories.find((c) => c !== "Trending" && c !== "Emoji") ?? s.categories[0],
    stickerPath: file.path,
    stickerWidth: file.width,
    stickerHeight: file.height,
    stickerAnimated: s.set.animated,
    stickerSet: s.set.id,
    transform,
    originalTransform: { ...transform },
  };
};

/**
 * A sticker at the playhead (or `startFrame`) in the middle of the canvas (or at `center`, world
 * units) on a new track at the top, selected, with its Stickers tab open. It's downloaded first
 * when it isn't here yet. Returns the clip's id, or null if it couldn't be fetched.
 */
export const addSticker = async (s: Sticker, opts: { startFrame?: number; center?: { x: number; y: number } } = {}): Promise<string | null> => {
  const path = await ensureSticker(s);
  if (!path) return null;
  const [{ v4: uuidv4 }, { useClipStore }, { useControlsStore }, { useViewportStore }, { BASE_LONG_SIDE, DEFAULT_FPS }, { worldCanvas }, { useInspectorStore }] = await Promise.all([
    import("uuid"),
    import("../clip"),
    import("../control"),
    import("../viewport"),
    import("../settings"),
    import("../shape-presets"),
    import("../inspector"),
  ]);
  const size = await naturalSize(cachedUrl(path));
  const controls = useControlsStore.getState();
  const canvas = worldCanvas(useViewportStore.getState().aspectRatio, BASE_LONG_SIDE);
  const timelineId = uuidv4();
  useClipStore.getState().addTimeline({ timelineId, type: "sticker", timelineY: 0, timelineHeight: 40, timelineWidth: 0, muted: false, hidden: false }, -1);
  const clip = stickerClip(
    s,
    { path, ...size },
    { clipId: uuidv4(), timelineId, startFrame: Math.max(0, Math.round(opts.startFrame ?? controls.focusFrame)), fps: controls.fps || DEFAULT_FPS },
    canvas,
    opts.center,
  );
  useClipStore.getState().addClip(clip);
  controls.setSelectedClipIds([clip.clipId]);
  useInspectorStore.getState().setTab("sticker");
  // What was being previewed is now a clip.
  useStickerLibrary.getState().setPreview(null);
  return clip.clipId;
};
