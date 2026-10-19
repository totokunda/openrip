// The Media tab's stock Library: what's listed (searched through the main process, which asks the
// openly licensed sources politely), what's downloaded, the favourites, the tile being previewed,
// and adding an item to the timeline. A file is fetched the first time it's used into the user's
// app data (`<userData>/stock/`), then imported into the project's media like any other file; its
// licence, author and source address go into the asset (`asset.credit`, lib/credits.ts).
import { create } from "zustand";
import { loadStored, saveStored, parseList } from "../user-store";
import { importMediaPaths, listConvertedMedia, stockCached, stockDownload, stockSearch } from "@app/preload";
import type { AssetCredit, VideoClipProps, ImageClipProps } from "../types";
import { SOURCE_NAMES, type StockItem, type StockKind } from "./sources";

/** The column's categories (CapCut's Library has Trending, Green Screen, Background, Scenery, …): each is a search. */
export const STOCK_CATEGORIES: { id: string; label: string; video: string; photo: string }[] = [
  { id: "trending", label: "Trending", video: "timelapse", photo: "landscape" },
  { id: "green-screen", label: "Green Screen", video: "green screen", photo: "green screen" },
  { id: "background", label: "Background", video: "abstract background", photo: "abstract background" },
  { id: "scenery", label: "Scenery", video: "scenery", photo: "scenery" },
  { id: "atmosphere", label: "Atmosphere", video: "clouds sky", photo: "clouds sky" },
  { id: "life", label: "Life", video: "people daily life", photo: "people daily life" },
  { id: "nature", label: "Nature", video: "nature", photo: "nature" },
  { id: "animals", label: "Animals", video: "animals", photo: "animals" },
  { id: "city", label: "City", video: "city street", photo: "city skyline" },
  { id: "travel", label: "Travel", video: "travel", photo: "travel" },
  { id: "food", label: "Food", video: "food", photo: "food" },
  { id: "space", label: "Space", video: "space", photo: "space" },
  { id: "technology", label: "Technology", video: "technology", photo: "technology" },
];

/** The search a category (or the typed query) stands for. */
export const searchFor = (category: string, kind: StockKind, typed: string): string => {
  const q = typed.trim();
  if (q) return q;
  const c = STOCK_CATEGORIES.find((x) => x.id === category) ?? STOCK_CATEGORIES[0];
  return c[kind];
};

const FAVOURITES = "openrip.stock-favorites";
const STORE_KEY = "favourites.stock";

type StockLibrary = {
  kind: StockKind;
  setKind: (k: StockKind) => void;
  items: StockItem[];
  more: boolean;
  page: number;
  loading: boolean;
  /** A message when the search couldn't be made (offline, rate-limited). */
  error: string | null;
  /** Sources that didn't answer this time. */
  missing: string[];
  /** Files on this machine: item id to path. */
  cached: Record<string, string>;
  /** Downloads under way, and the ones that failed (id to the reason). */
  downloading: string[];
  failed: Record<string, string>;
  favourites: StockItem[];
  toggleFavourite: (item: StockItem) => void;
  /** The tile that was clicked: the player shows it until it's let go. */
  preview: StockItem | null;
  setPreview: (s: StockItem | null) => void;
  /** Search; `page` 1 starts a new list, later pages add to it. */
  search: (query: string, page?: number) => Promise<void>;
  loadCached: () => Promise<void>;
};

let searchToken = 0;

export const useStockLibrary = create<StockLibrary>((set, get) => ({
  kind: "video",
  setKind: (kind) => set({ kind }),
  items: [],
  more: false,
  page: 1,
  loading: false,
  error: null,
  missing: [],
  cached: {},
  downloading: [],
  failed: {},
  favourites: [],
  toggleFavourite: (item) => {
    const now = get().favourites;
    const next = now.some((x) => x.id === item.id) ? now.filter((x) => x.id !== item.id) : [...now, item];
    saveStored(STORE_KEY, next);
    set({ favourites: next });
  },
  preview: null,
  setPreview: (preview) => set({ preview }),
  search: async (query, page = 1) => {
    const token = ++searchToken;
    const kind = get().kind;
    set(page === 1 ? { loading: true, error: null, items: [], more: false, page: 1, missing: [] } : { loading: true });
    try {
      const res = await stockSearch({ kind, query, page });
      if (token !== searchToken) return;
      if (!res.ok) {
        set({ loading: false, error: res.message });
        return;
      }
      set((s) => {
        const seen = new Set(s.items.map((i) => i.id));
        const fresh = res.items.filter((i) => !seen.has(i.id));
        return { loading: false, error: null, items: page === 1 ? res.items : [...s.items, ...fresh], more: res.more, page, missing: res.missing };
      });
    } catch (e) {
      if (token !== searchToken) return;
      set({ loading: false, error: (e as Error).message || "The library couldn't be reached." });
    }
  },
  loadCached: async () => {
    try {
      set({ cached: (await stockCached()) ?? {} });
    } catch {
      // not in the app shell: nothing is cached
    }
  },
}));

/** A file in the cache as the renderer loads it. */
export const cachedUrl = (path: string) => `app://user-data${encodeURI(path)}`;

/** What a tile's hover plays, and the player's preview: the file here, else the small video at its source. */
export const previewSrc = (item: StockItem, cached: Record<string, string>): string | null => {
  if (cached[item.id]) return cachedUrl(cached[item.id]);
  if (item.kind === "video") return item.preview ?? null;
  return item.thumb;
};

/** The credit an item carries into the project. */
export const creditOf = (item: StockItem): AssetCredit => ({
  kind: item.kind,
  title: item.title,
  author: item.author,
  authorUrl: item.authorUrl,
  license: item.license,
  licenseUrl: item.licenseUrl,
  sourceName: SOURCE_NAMES[item.source],
  sourceUrl: item.sourceUrl,
  attributionRequired: item.attributionRequired,
});

/** "0:09" style length for a tile. */
export const durationText = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Make an item's file local: it's downloaded into the cache the first time. Resolves with its
 * path, or null when it couldn't be fetched (the tile then says why, and tries again on a click).
 */
export const ensureStock = async (item: StockItem): Promise<string | null> => {
  const lib = useStockLibrary.getState();
  const have = lib.cached[item.id];
  if (have) return have;
  useStockLibrary.setState((st) => ({ downloading: [...new Set([...st.downloading, item.id])], failed: Object.fromEntries(Object.entries(st.failed).filter(([k]) => k !== item.id)) }));
  let path: string | null = null;
  let error = "";
  try {
    const out = await stockDownload({ id: item.id, kind: item.kind, url: item.url });
    if (out.ok) path = out.path;
    else error = out.error;
  } catch (e) {
    error = (e as Error).message;
  }
  useStockLibrary.setState((st) => ({
    downloading: st.downloading.filter((x) => x !== item.id),
    cached: path ? { ...st.cached, [item.id]: path } : st.cached,
    failed: path ? st.failed : { ...st.failed, [item.id]: error || "download failed" },
  }));
  return path;
};

/**
 * An item on the timeline at the playhead (or `startFrame`), as the Media tab's "+" adds a
 * file: downloaded if it isn't here yet, imported into the project's media, then a clip on the
 * main track (at the cut nearest the playhead, the clips after it making room), or a first
 * track. The asset keeps the item's licence, author and source (`asset.credit`). All in one
 * undo step. Returns the clip's id, or null if the file couldn't be fetched or read.
 */
export const addStock = async (item: StockItem, opts: { startFrame?: number } = {}): Promise<string | null> => {
  const path = await ensureStock(item);
  if (!path) return null;
  const [{ v4: uuidv4 }, { useClipStore, getTimelineTypeForClip, getTimelineHeightForClip }, { useControlsStore }, { useViewportStore }, { useProjectsStore }, { getMediaInfo }, { imageDurationFrames }, { mainTrackOf, insertionFrame }, { bumpMediaLibraryVersion }, { TIME_ZERO_X }] =
    await Promise.all([
      import("uuid"),
      import("../clip"),
      import("../control"),
      import("../viewport"),
      import("../projects"),
      import("../media/utils"),
      import("../preferences"),
      import("../timeline-edit"),
      import("../media/library"),
      import("../timeline-geometry"),
    ]);
  const folderUuid = useProjectsStore.getState().getActiveProject()?.folderUuid;
  const fileName = path.split(/[/\\]/).pop() ?? "";
  let listed = (await listConvertedMedia(folderUuid)).find((it) => it.name === fileName);
  if (!listed) {
    await importMediaPaths([path], undefined, folderUuid);
    listed = (await listConvertedMedia(folderUuid)).find((it) => it.name === fileName);
    bumpMediaLibraryVersion();
  }
  if (!listed) return null;
  const info = await getMediaInfo(listed.assetUrl);
  if (!info) return null;

  const controls = useControlsStore.getState();
  const fps = controls.fps || 24;
  const video = item.kind === "video";
  const width = video ? info.video?.displayWidth : info.image?.width;
  const height = video ? info.video?.displayHeight : info.image?.height;
  const numFrames = Math.max(1, video ? Math.round((info.duration ?? item.duration ?? 0) * fps) : imageDurationFrames(fps));

  // Everything from here is one step of the undo history.
  const store = useClipStore.getState();
  const mainFound = mainTrackOf(store.timelines);
  const startAt = Math.max(0, Math.round(opts.startFrame ?? controls.focusFrame));
  let timelineId = mainFound?.timelineId;
  let startFrame = startAt;
  const hadMedia = store.clips.some((c) => c.type === "video" || c.type === "image");
  if (!timelineId) {
    timelineId = uuidv4();
    store.addTimeline({ type: getTimelineTypeForClip({ type: video ? "video" : "image" } as never), timelineId, timelinePadding: TIME_ZERO_X, timelineWidth: 0, timelineY: 0, timelineHeight: getTimelineHeightForClip(video ? "video" : "image") });
    startFrame = 0;
  } else {
    startFrame = insertionFrame(store.clips, store.timelines, startAt);
  }
  const asset = useClipStore.getState().addAsset({ path: listed.assetUrl, type: video ? "video" : "image", duration: video ? (info.duration ?? 0) : 0 });
  useClipStore.getState().updateAsset(asset.id, { credit: creditOf(item) });
  const clip = {
    timelineId,
    clipId: uuidv4(),
    startFrame,
    endFrame: startFrame + numFrames,
    type: video ? "video" : "image",
    trimStart: video ? 0 : Infinity,
    trimEnd: video ? 0 : -Infinity,
    speed: 1,
    assetId: asset.id,
    masks: [],
    ...(width && height ? { mediaWidth: width, mediaHeight: height, mediaAspectRatio: width / height } : {}),
  } as unknown as VideoClipProps | ImageClipProps;
  if (!hadMedia && width && height) {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(Math.round(width), Math.round(height)) || 1;
    useViewportStore.getState().setAspectRatio({ width: Math.round(width), height: Math.round(height), id: `${Math.round(width / g)}:${Math.round(height / g)}` });
  }
  useClipStore.getState().addClip(clip as never);
  useStockLibrary.getState().setPreview(null);
  return clip.clipId;
};

void loadStored(STORE_KEY, FAVOURITES, parseList<StockItem>((x) => x && typeof x.id === "string" && typeof x.url === "string")).then(
  (v) => v && useStockLibrary.setState((s) => ({ favourites: [...v, ...s.favourites.filter((f) => !v.some((x) => x.id === f.id))] })),
);
