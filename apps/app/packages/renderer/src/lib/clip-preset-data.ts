// The saved presets as plain data (CapCut's My presets): what a preset is, how a list is read
// back from the user data folder (a file that's damaged or from a later version loses only the
// entries it can't read) and how a new one is named. lib/clip-presets.ts keeps them in a store
// and the main process's ClipPresetsModule keeps the file.
import { ATTRIBUTE_GROUPS, type AttributeGroup, type ClipAttributes } from "./clip-attributes.ts";
import type { ClipType } from "./types";

export type ClipPreset = {
  id: string;
  name: string;
  createdAt: number;
  /** The type of the clip it was saved from. */
  source: ClipType;
  attrs: ClipAttributes;
  /** A small picture of the clip's frame when it was saved (a JPEG data URL), or none. */
  thumb?: string;
};

const GROUP_IDS = new Set<string>(ATTRIBUTE_GROUPS.map((g) => g.id));
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The presets in a file's contents: the entries that have a name and attributes, in order. */
export const parsePresets = (raw: unknown): ClipPreset[] => {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (isObject(list) && Array.isArray(list.presets)) list = list.presets;
  if (!Array.isArray(list)) return [];
  const out: ClipPreset[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    if (!isObject(e) || typeof e.id !== "string" || typeof e.name !== "string" || !isObject(e.attrs) || !isObject(e.attrs.groups)) continue;
    if (seen.has(e.id)) continue;
    const groups: ClipAttributes["groups"] = {};
    for (const [g, d] of Object.entries(e.attrs.groups)) {
      if (GROUP_IDS.has(g) && isObject(d) && isObject(d.fields)) groups[g as AttributeGroup] = { fields: d.fields, keys: isObject(d.keys) ? (d.keys as any) : {} };
    }
    if (!Object.keys(groups).length) continue;
    seen.add(e.id);
    out.push({
      id: e.id,
      name: e.name,
      createdAt: typeof e.createdAt === "number" ? e.createdAt : 0,
      source: (e.attrs.source ?? e.source) as ClipType,
      attrs: { source: (e.attrs.source ?? e.source) as ClipType, groups },
      thumb: typeof e.thumb === "string" && e.thumb.startsWith("data:image/") ? e.thumb : undefined,
    });
  }
  return out;
};

/** The file's contents for a list. */
export const serializePresets = (list: ClipPreset[]): string => JSON.stringify({ version: 1, presets: list });

/** "My presets1", "My presets2", …: the next name not taken (CapCut's own naming). */
export const nextPresetName = (list: ClipPreset[]): string => {
  const used = new Set(list.map((p) => p.name));
  let n = 1;
  while (used.has(`My presets${n}`)) n++;
  return `My presets${n}`;
};
