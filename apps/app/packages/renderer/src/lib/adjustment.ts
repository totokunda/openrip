// Adjustment layers (CapCut's): a bar on a track of its own that applies the Adjust tab's colour
// tools to everything under it for its duration. In the app it's a filter-track clip with
// `adjustment: true`, carrying the same `color` (ClipColor) and `masks` a video does; the
// engine draws it over the composite beneath (engine/crates/v1 turns it into a segment on an
// adjustment track, engine/crates/playback draws it). This file has the clip it makes, adding
// it, and the left Adjustment tab's own state: the presets the user saved ("Yours"), the LUTs
// they imported, and the one being previewed in the player.
import { create } from "zustand";
import type { AnyClipProps, ClipColor, FilterClipProps } from "./types";
import { isNeutralColor } from "./color";
import { loadStored, saveStored } from "./user-store";

/** Whether a clip is an adjustment layer. */
export const isAdjustmentLayer = (clip: { type?: string } | null | undefined): boolean => clip?.type === "filter" && !!(clip as FilterClipProps).adjustment;

/** What the Adjustment tab can add: nothing set ("Custom adjustment"), a saved preset, or a LUT. */
export type AdjustmentDrag = { type: "adjustment-tile"; kind: "custom" | "preset" | "lut"; id: string };

export type AdjustmentPreset = { id: string; name: string; color: ClipColor; createdAt: number };
export type ImportedLut = { path: string; name: string };

const PRESETS_KEY = "openrip.adjustment-presets";
const LUTS_KEY = "openrip.adjustment-luts";

const PRESETS_STORE = "adjustment-presets";
const LUTS_STORE = "adjustment-luts";
const write = (key: string, value: unknown) => saveStored(key === PRESETS_KEY ? PRESETS_STORE : LUTS_STORE, value);

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));

type AdjustmentLibrary = {
  presets: AdjustmentPreset[];
  luts: ImportedLut[];
  /** The tile that was clicked: the player shows it over the whole timeline until it's let go. */
  preview: { name: string; color: ClipColor } | null;
  setPreview: (p: { name: string; color: ClipColor } | null) => void;
  savePreset: (color: ClipColor, name?: string) => AdjustmentPreset;
  deletePreset: (id: string) => void;
  renamePreset: (id: string, name: string) => void;
  addLut: (lut: ImportedLut) => void;
  removeLut: (path: string) => void;
};

export const useAdjustmentLibrary = create<AdjustmentLibrary>((set, get) => ({
  presets: [],
  luts: [],
  preview: null,
  setPreview: (preview) => set({ preview }),
  savePreset: (color, name) => {
    const now = get().presets;
    const preset: AdjustmentPreset = {
      id: `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name?.trim() || `Preset ${now.length + 1}`,
      color: copy(color),
      createdAt: Date.now(),
    };
    const next = [...now, preset];
    write(PRESETS_KEY, next);
    set({ presets: next });
    return preset;
  },
  deletePreset: (id) => {
    const next = get().presets.filter((p) => p.id !== id);
    write(PRESETS_KEY, next);
    set({ presets: next });
  },
  renamePreset: (id, name) => {
    const next = get().presets.map((p) => (p.id === id && name.trim() ? { ...p, name: name.trim() } : p));
    write(PRESETS_KEY, next);
    set({ presets: next });
  },
  addLut: (lut) => {
    const now = get().luts;
    if (now.some((l) => l.path === lut.path)) return;
    const next = [...now, lut];
    write(LUTS_KEY, next);
    set({ luts: next });
  },
  removeLut: (path) => {
    const next = get().luts.filter((l) => l.path !== path);
    write(LUTS_KEY, next);
    set({ luts: next });
  },
}));

const parseObjects = <T>(v: unknown): T[] | undefined => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as T[]) : undefined);
void loadStored(PRESETS_STORE, PRESETS_KEY, parseObjects<AdjustmentPreset>).then(
  (v) => v && useAdjustmentLibrary.setState((s) => ({ presets: [...v, ...s.presets.filter((p) => !v.some((q) => q.id === p.id))] })),
);
void loadStored(LUTS_STORE, LUTS_KEY, parseObjects<ImportedLut>).then(
  (v) => v && useAdjustmentLibrary.setState((s) => ({ luts: [...v, ...s.luts.filter((l) => !v.some((m) => m.path === l.path))] })),
);

/** A LUT file's display name: its file name without the extension. */
export const lutName = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");

/** The next free "Adjust1", "Adjust2", … (CapCut's names). */
const nextName = (clips: AnyClipProps[]) => {
  const used = new Set(clips.filter(isAdjustmentLayer).map((c) => (c as FilterClipProps).name));
  let n = 1;
  while (used.has(`Adjust${n}`)) n++;
  return `Adjust${n}`;
};

/**
 * An adjustment layer on a new track above the rest, at the playhead (or `startFrame`), selected,
 * its Adjust tab open (CapCut's "+" on the Custom adjustment tile). `color` is what it starts
 * with: nothing, a saved preset, or a LUT. Resolves to the clip's id.
 */
export const addAdjustmentLayer = async (opts: { color?: ClipColor; startFrame?: number; name?: string } = {}): Promise<string> => {
  const [{ v4: uuidv4 }, { useClipStore }, { useControlsStore }, { useInspectorStore }, { useViewportStore }, { BASE_LONG_SIDE }, { worldCanvas }] = await Promise.all([
    import("uuid"),
    import("./clip"),
    import("./control"),
    import("./inspector"),
    import("./viewport"),
    import("./settings"),
    import("./shape-presets"),
  ]);
  const { addTimeline, addClip, clips } = useClipStore.getState();
  const controls = useControlsStore.getState();
  const timelineId = uuidv4();
  addTimeline({ timelineId, type: "filter", timelineY: 0, timelineHeight: 40, timelineWidth: 0, muted: false, hidden: false }, -1);
  const fps = controls.fps || 24;
  const start = Math.max(0, Math.round(opts.startFrame ?? controls.focusFrame));
  // The layer's picture is the whole canvas: masks are placed in it.
  const canvas = worldCanvas(useViewportStore.getState().aspectRatio, BASE_LONG_SIDE);
  const transform = { x: 0, y: 0, width: canvas.width, height: canvas.height, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 };
  const clip = {
    timelineId,
    clipId: uuidv4(),
    type: "filter",
    startFrame: start,
    endFrame: start + Math.round(fps * controls.defaultClipLength),
    trimStart: Infinity,
    trimEnd: -Infinity,
    speed: 1,
    name: opts.name ?? nextName(clips),
    category: "Adjustment",
    adjustment: true,
    draftKind: "adjustment",
    drawn: true,
    color: copy(opts.color ?? {}),
    masks: [],
    transform,
    originalTransform: { ...transform },
  } as unknown as FilterClipProps;
  addClip(clip as any);
  controls.setSelectedClipIds([clip.clipId]);
  useInspectorStore.getState().setTab("adjust", "basic");
  useAdjustmentLibrary.getState().setPreview(null);
  return clip.clipId;
};

/** An adjustment layer with a LUT on it. */
export const addLutLayer = (lut: ImportedLut, startFrame?: number) => addAdjustmentLayer({ color: { lut: { path: lut.path, name: lut.name, intensity: 100 } }, startFrame, name: lut.name });

/** An adjustment tile let go on the timeline at `frame`: the layer it stands for. */
export const dropAdjustment = (drag: AdjustmentDrag, frame: number) => {
  if (drag.kind === "preset") {
    const p = useAdjustmentLibrary.getState().presets.find((x) => x.id === drag.id);
    return p ? addAdjustmentLayer({ color: p.color, name: p.name, startFrame: frame }) : undefined;
  }
  if (drag.kind === "lut") return addLutLayer({ path: drag.id, name: lutName(drag.id) }, frame);
  return addAdjustmentLayer({ startFrame: frame });
};

/** The preset (or nothing) a layer's settings make: undefined when the layer changes nothing. */
export const savePresetFrom = (clip: AnyClipProps | undefined): AdjustmentPreset | undefined => {
  const color = (clip as FilterClipProps | undefined)?.color;
  if (!clip || !color || isNeutralColor(color)) return undefined;
  return useAdjustmentLibrary.getState().savePreset(color);
};
