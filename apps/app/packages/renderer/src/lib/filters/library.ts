// The Filters tab's own state: favourites (kept in the user data folder), the filter being
// previewed (shown by the engine without touching the project), and adding one at the
// playhead. A preview is never saved or exported: engine-preview.ts adds it to the engine's
// copy of the project only.
import { create } from "zustand";
import { loadStored, saveStored, parseStrings } from "../user-store";
import type { Filter, FilterClipProps } from "../types";

const KEY = "openrip.filter-favorites";
const STORE_KEY = "favourites.filters";

/** A filter's identity across categories. */
export const filterKey = (f: Pick<Filter, "id" | "category">) => `${f.category}/${f.id}`;

type FilterLibrary = {
  favourites: string[];
  toggleFavourite: (f: Filter) => void;
  /** The tile that was clicked: the player shows it on the whole timeline until it's let go. */
  preview: Filter | null;
  setPreview: (f: Filter | null) => void;
};

export const useFilterLibrary = create<FilterLibrary>((set, get) => ({
  favourites: [],
  toggleFavourite: (f) => {
    const k = filterKey(f);
    const now = get().favourites;
    const next = now.includes(k) ? now.filter((x) => x !== k) : [...now, k];
    saveStored(STORE_KEY, next);
    set({ favourites: next });
  },
  preview: null,
  setPreview: (preview) => set({ preview }),
}));

void loadStored(STORE_KEY, KEY, parseStrings).then((v) => v && useFilterLibrary.setState((s) => ({ favourites: [...new Set([...v, ...s.favourites])] })));

/** The filter clip a tile makes (the same fields a tile dropped on the timeline gets). */
export const filterClipFields = (f: Filter): Partial<FilterClipProps> => ({
  name: f.name,
  smallPath: f.smallPath,
  fullPath: f.fullPath,
  category: f.category,
  examplePath: f.examplePath,
  exampleAssetUrl: f.exampleAssetUrl,
  intensity: 100,
});

/**
 * A filter clip at the playhead on a new track above the rest, selected, with its Filter tab
 * open (CapCut's "+" on a filter tile). The stores load when it's called.
 */
export const addFilterAtPlayhead = async (f: Filter) => {
  const [{ v4: uuidv4 }, { useClipStore }, { useControlsStore }, { useInspectorStore }] = await Promise.all([
    import("uuid"),
    import("../clip"),
    import("../control"),
    import("../inspector"),
  ]);
  const { addTimeline, addClip } = useClipStore.getState();
  const controls = useControlsStore.getState();
  const timelineId = uuidv4();
  addTimeline({ timelineId, type: "filter", timelineY: 0, timelineHeight: 40, timelineWidth: 0, muted: false, hidden: false }, -1);
  const fps = controls.fps || 24;
  const startFrame = controls.focusFrame;
  const clip = {
    timelineId,
    clipId: uuidv4(),
    type: "filter",
    startFrame,
    endFrame: startFrame + Math.round(fps * controls.defaultClipLength),
    trimStart: Infinity,
    trimEnd: -Infinity,
    speed: 1,
    ...filterClipFields(f),
  } as unknown as FilterClipProps;
  addClip(clip as any);
  controls.setSelectedClipIds([clip.clipId]);
  useInspectorStore.getState().setTab?.("filter" as any);
  useFilterLibrary.getState().setPreview(null);
};
