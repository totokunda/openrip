// The Effects tab's own state: favourites (kept in the user data folder), the effect being
// previewed (shown by the engine without touching the project), and adding an effect: as a bar
// at the playhead, or onto one clip. A preview is never saved or exported: engine-preview.ts
// adds it to the engine's copy of the project only.
import { create } from "zustand";
import { loadStored, saveStored, parseStrings } from "../user-store";
import type { ClipEffect, FilterClipProps } from "../types";
import { defaultEffectParams, effectDef, loadEffectCatalog, type EffectDef } from "./catalog";

const KEY = "openrip.effect-favorites";
const STORE_KEY = "favourites.effects";

type EffectLibrary = {
  favourites: string[];
  toggleFavourite: (id: string) => void;
  /** The tile that was clicked: the player shows it on the whole timeline until it's let go. */
  preview: string | null;
  setPreview: (id: string | null) => void;
};

export const useEffectLibrary = create<EffectLibrary>((set, get) => ({
  favourites: [],
  toggleFavourite: (id) => {
    const now = get().favourites;
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    saveStored(STORE_KEY, next);
    set({ favourites: next });
  },
  preview: null,
  setPreview: (preview) => set({ preview }),
}));

void loadStored(STORE_KEY, KEY, parseStrings).then((v) => v && useEffectLibrary.setState((s) => ({ favourites: [...new Set([...v, ...s.favourites])] })));

/** The bar a tile makes: the fields of a filter-track clip drawing the effect (also what a tile dropped on the timeline gets). */
export const effectClipFields = (def: EffectDef): Partial<FilterClipProps> => ({
  name: def.name,
  category: def.category,
  effectId: def.id,
  effectParams: defaultEffectParams(def),
  intensity: def.intensity,
});

/** An effect on a clip: a new instance of `def` at its defaults. */
export const newClipEffect = async (def: EffectDef): Promise<ClipEffect> => {
  const { v4: uuidv4 } = await import("uuid");
  return { id: `fx-${uuidv4().slice(0, 8)}`, effectId: def.id, name: def.name, intensity: def.intensity, params: defaultEffectParams(def) };
};

const definition = async (id: string): Promise<EffectDef | undefined> => {
  await loadEffectCatalog();
  return effectDef(id);
};

/**
 * An effect bar on a new track above the rest, at the playhead (or `startFrame`), selected,
 * its inspector open (CapCut's "+" on an effect tile). Resolves to the clip's id.
 */
export const addEffectBar = async (effectId: string, startFrame?: number): Promise<string | null> => {
  const def = await definition(effectId);
  if (!def) return null;
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
  const start = startFrame ?? controls.focusFrame;
  const clip = {
    timelineId,
    clipId: uuidv4(),
    type: "filter",
    startFrame: start,
    endFrame: start + Math.round(fps * controls.defaultClipLength),
    trimStart: Infinity,
    trimEnd: -Infinity,
    speed: 1,
    ...effectClipFields(def),
  } as unknown as FilterClipProps;
  addClip(clip as any);
  controls.setSelectedClipIds([clip.clipId]);
  useInspectorStore.getState().setTab?.("filter" as any);
  useEffectLibrary.getState().setPreview(null);
  return clip.clipId;
};

/** The clip types an effect can be put on. */
export const takesEffects = (type: string | undefined) => type === "video" || type === "image";

/** An effect onto one video or photo (its Adjust tab lists it). Resolves to the instance's id. */
export const applyEffectToClip = async (clipId: string, effectId: string): Promise<string | null> => {
  const def = await definition(effectId);
  if (!def) return null;
  const [{ useClipStore }, { useControlsStore }, { useInspectorStore }] = await Promise.all([import("../clip"), import("../control"), import("../inspector")]);
  const clip = useClipStore.getState().getClipById(clipId) as { type?: string; effects?: ClipEffect[] } | undefined;
  if (!clip || !takesEffects(clip.type)) return null;
  const instance = await newClipEffect(def);
  useClipStore.getState().updateClip(clipId, { effects: [...(clip.effects ?? []), instance] } as any);
  useControlsStore.getState().setSelectedClipIds([clipId]);
  useInspectorStore.getState().setTab("adjust" as any);
  useInspectorStore.getState().setSub?.("adjust", "effects");
  useEffectLibrary.getState().setPreview(null);
  return instance.id;
};
