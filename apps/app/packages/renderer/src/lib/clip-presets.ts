// Copy attributes, Paste attributes and Save preset, as the clip menu, the shortcuts and the
// Media tab's My presets use them: the attributes copied last (kept in memory, as CapCut
// keeps them), the saved presets (kept in the user data folder by the main process's
// ClipPresetsModule) and the one way both are put onto clips. The groups and the paste maths
// are lib/clip-attributes.ts's.
import { create } from "zustand";
import { ENGINE_FRAME_CANVAS_ID, clipPresetsRead, clipPresetsWrite } from "@app/preload";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { reversePatch } from "./speed";
import { toast } from "sonner";
import type { ContextMenuItem } from "./context-menu";
import { copyAttributes, groupLabel, groupsIn, hasGroup, pasteAttributes, pastableGroups, pasteTargets, type AttributeGroup, type ClipAttributes } from "./clip-attributes";
import { nextPresetName, parsePresets, serializePresets, type ClipPreset } from "./clip-preset-data";
import type { AnyClipProps } from "./types";

/** The attributes Copy attributes took last, or none. */
export const useAttributeClipboard = create<{ attrs: ClipAttributes | null; set: (a: ClipAttributes | null) => void }>((set) => ({
  attrs: null,
  set: (attrs) => set({ attrs }),
}));

/**
 * Put `groups` of `attrs` (all of them when left out) onto the clips of `ids` that have them,
 * in one go: one step to undo. Returns how many clips took something.
 */
export const applyAttributes = (attrs: ClipAttributes, ids: string[], groups?: AttributeGroup[]): number => {
  const store = useClipStore.getState();
  let n = 0;
  const want = (g: AttributeGroup) => !groups || groups.includes(g);
  for (const target of pasteTargets(attrs, store.clips, ids)) {
    // Speed first: it moves the clip's end, trims and keys, which the rest then sets on top of.
    const speed = want("speed") ? pasteAttributes(attrs, target, ["speed"]) : null;
    if (speed) {
      store.updateClip(target.clipId, speed.patch);
      const now = useClipStore.getState().getClipById(target.clipId);
      if (now && speed.reverse !== undefined) store.updateClip(target.clipId, reversePatch(now, speed.reverse));
    }
    const fresh = useClipStore.getState().getClipById(target.clipId);
    const others = fresh ? pastableGroups(attrs, fresh).filter((g) => g !== "speed" && want(g)) : [];
    const rest = fresh && others.length ? pasteAttributes(attrs, fresh, others) : null;
    if (rest) store.updateClip(target.clipId, rest.patch);
    if (speed || rest) n++;
  }
  return n;
};

/** Copy attributes: the last selected clip's, onto the clipboard. False when nothing is selected. */
export const copySelectedAttributes = (): boolean => {
  const ids = useControlsStore.getState().selectedClipIds;
  const clip = useClipStore.getState().getClipById(ids[ids.length - 1]);
  if (!clip || clip.type === "group") return false;
  useAttributeClipboard.getState().set(copyAttributes(clip));
  return true;
};

/** Paste attributes onto the selected clips (`groups`: only those). Returns how many took it. */
export const pasteSelectedAttributes = (groups?: AttributeGroup[]): number => {
  const attrs = useAttributeClipboard.getState().attrs;
  if (!attrs) return 0;
  return applyAttributes(attrs, useControlsStore.getState().selectedClipIds, groups);
};

/** A small JPEG of the player's picture now, or undefined when the engine's canvas isn't up. */
const frameThumb = (): string | undefined => {
  const c = document.getElementById(ENGINE_FRAME_CANVAS_ID) as HTMLCanvasElement | null;
  if (!c || c.width < 4 || c.height < 4) return undefined;
  try {
    const t = document.createElement("canvas");
    const k = 160 / Math.max(c.width, c.height);
    t.width = Math.max(1, Math.round(c.width * k));
    t.height = Math.max(1, Math.round(c.height * k));
    t.getContext("2d")?.drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  }
};

interface PresetState {
  presets: ClipPreset[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Save a clip's attributes (in the groups it has, or just `groups`) under a name; the new preset. */
  save: (clip: AnyClipProps, name?: string, groups?: AttributeGroup[]) => ClipPreset | null;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

/** Writes are queued: each one is the whole list as it was when asked. */
let writing: Promise<unknown> = Promise.resolve();
const persist = (list: ClipPreset[]) => {
  const text = serializePresets(list);
  writing = writing.then(() => clipPresetsWrite(text)).catch(() => {});
};

export const useClipPresets = create<PresetState>((set, get) => ({
  presets: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    // Presets saved while the file was being read stay (they're newer).
    const text = await clipPresetsRead().catch(() => null);
    const saved = text ? parsePresets(text) : [];
    set((s) => ({ presets: [...saved, ...s.presets.filter((p) => !saved.some((q) => q.id === p.id))], loaded: true }));
  },
  save: (clip, name, groups) => {
    if (clip.type === "group") return null;
    const attrs = copyAttributes(clip, groups);
    if (!Object.keys(attrs.groups).length) return null;
    const controls = useControlsStore.getState();
    const onFrame = controls.focusFrame >= (clip.startFrame ?? 0) && controls.focusFrame < (clip.endFrame ?? 0);
    const preset: ClipPreset = {
      id: `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name?.trim() || nextPresetName(get().presets),
      createdAt: Date.now(),
      source: clip.type,
      attrs,
      thumb: onFrame && (clip.type === "video" || clip.type === "image") ? frameThumb() : undefined,
    };
    const next = [...get().presets, preset];
    set({ presets: next });
    persist(next);
    return preset;
  },
  rename: (id, name) => {
    if (!name.trim()) return;
    const next = get().presets.map((p) => (p.id === id ? { ...p, name: name.trim() } : p));
    set({ presets: next });
    persist(next);
  },
  remove: (id) => {
    const next = get().presets.filter((p) => p.id !== id);
    set({ presets: next });
    persist(next);
  },
}));

/** Apply a saved preset to the clips of `ids` (the selected ones when left out). */
export const applyPreset = (preset: ClipPreset, ids?: string[]): number =>
  applyAttributes(preset.attrs, ids ?? useControlsStore.getState().selectedClipIds);

/**
 * The clip menu's "Copy/paste attributes" submenu and "Save preset", for the clips the menu was
 * opened on. Copy takes one clip's (CapCut disables it on several); Paste puts everything on
 * the clipboard onto every selected clip that has it, and the rows after it only one group.
 */
export const attributeMenuItems = (clip: AnyClipProps | undefined, ids: string[]): { attributes: ContextMenuItem; preset: ContextMenuItem } => {
  const attrs = useAttributeClipboard.getState().attrs;
  const clips = useClipStore.getState().clips;
  const targets = pasteTargets(attrs, clips, ids);
  const groups = groupsIn(attrs).filter((g) => targets.some((t) => hasGroup(t, g)));
  const canCopy = !!clip && clip.type !== "group" && ids.length === 1;
  return {
    attributes: {
      id: "attributes",
      label: "Copy/paste attributes",
      action: "none",
      children: [
        { id: "copy-attributes", label: "Copy attributes", action: "custom", shortcut: "⌘⇧C", disabled: !canCopy, run: () => void copySelectedAttributes() },
        { id: "paste-attributes", label: "Paste attributes", action: "custom", shortcut: "⌘⇧V", disabled: !targets.length, run: () => void applyAttributes(attrs!, ids) },
        ...groups.map((g) => ({ id: `paste-attributes-${g}`, label: `Paste ${groupLabel(g)} only`, action: "custom" as const, run: () => void applyAttributes(attrs!, ids, [g]) })),
      ],
    },
    preset: {
      id: "save-preset",
      label: "Save preset",
      action: "custom",
      disabled: !clip || clip.type === "group",
      run: () => {
        if (!clip) return;
        const saved = useClipPresets.getState().save(clip);
        if (saved) toast.success(`Saved "${saved.name}" to Yours › My presets`);
      },
    },
  };
};
