// Group (⌘G), as CapCut's: clips "stuck together". Each stays on its own track, drawn as usual;
// they share a `bundleId`, and the editor treats them as one when they're picked (clicking one
// selects all), moved, deleted, cut, copied, split and deactivated. Pure functions of the
// clips. (A text template's clip is a different thing, a container with its parts hidden under
// one bar: type "group" with `template`, lib/text-templates.ts.)
import type { AnyClipProps, GroupClipProps } from "./types.ts";

/** The clips stuck to `clip` (same group), without it. */
export const bundleMates = (clips: AnyClipProps[], clip: AnyClipProps | undefined): AnyClipProps[] => {
  const id = clip?.bundleId;
  if (!id) return [];
  return clips.filter((c) => c.bundleId === id && c.clipId !== clip!.clipId);
};

/** The ids whole: every clip stuck to a clip of `ids` is in too. */
export const withMates = (clips: AnyClipProps[], ids: string[]): string[] => {
  const bundles = new Set(clips.filter((c) => ids.includes(c.clipId) && c.bundleId).map((c) => c.bundleId));
  if (bundles.size === 0) return ids;
  const out = [...ids];
  for (const c of clips) if (c.bundleId && bundles.has(c.bundleId) && !out.includes(c.clipId)) out.push(c.clipId);
  return out;
};

/** A selection with every group in it whole: a clip picked brings the clips stuck to it. */
export const stickSelection = (clips: AnyClipProps[], next: string[]): string[] => (clips.some((c) => c.bundleId) ? withMates(clips, next) : next);

/** Whether the clips can be grouped: two or more, none a text template's container. */
export const canGroup = (clips: AnyClipProps[], ids: string[]): boolean => {
  const picked = clips.filter((c) => ids.includes(c.clipId) && !c.hidden);
  return picked.length >= 2 && picked.every((c) => c.type !== "group") && new Set(picked.map((c) => c.bundleId ?? c.clipId)).size >= 2;
};

/** `clips` with those of `ids` (and what's stuck to them) stuck together under one new id. */
export const groupTogether = (clips: AnyClipProps[], ids: string[], newId: () => string): AnyClipProps[] => {
  const whole = new Set(withMates(clips, ids));
  const id = newId();
  return clips.map((c) => (whole.has(c.clipId) ? ({ ...c, bundleId: id } as AnyClipProps) : c));
};

/** `clips` with the groups of `ids` taken apart. */
export const ungroupTogether = (clips: AnyClipProps[], ids: string[]): AnyClipProps[] => {
  const bundles = new Set(clips.filter((c) => ids.includes(c.clipId) && c.bundleId).map((c) => c.bundleId));
  if (bundles.size === 0) return clips;
  return clips.map((c) => {
    if (!c.bundleId || !bundles.has(c.bundleId)) return c;
    const { bundleId: _gone, ...rest } = c;
    return rest as AnyClipProps;
  });
};

/**
 * Projects saved before Group meant "stuck together" hold a container clip (type "group", its
 * clips hidden under it). One that isn't a text template's is opened into a stuck-together
 * group: the container goes, its clips are shown again and share a `bundleId`.
 */
export const migrateLegacyGroups = (clips: AnyClipProps[], newId: () => string): AnyClipProps[] => {
  const legacy = clips.filter((c) => c.type === "group" && !(c as GroupClipProps).template) as GroupClipProps[];
  if (legacy.length === 0) return clips;
  const gone = new Set(legacy.map((g) => g.clipId));
  const bundleOf = new Map<string, string>();
  for (const g of legacy) {
    const id = newId();
    for (const child of (g.children ?? []).flat()) bundleOf.set(child, id);
  }
  return clips
    .filter((c) => !gone.has(c.clipId))
    .map((c) => {
      if (!bundleOf.has(c.clipId) && !(c.groupId && gone.has(c.groupId))) return c;
      const { groupId: _g, ...rest } = c;
      return { ...rest, hidden: false, ...(bundleOf.has(c.clipId) ? { bundleId: bundleOf.get(c.clipId) } : {}) } as AnyClipProps;
    });
};

/** `clips` with the group ids of clips that are alone in theirs dropped (a group of one is no group). */
export const tidyBundles = (clips: AnyClipProps[]): AnyClipProps[] => {
  const counts = new Map<string, number>();
  for (const c of clips) if (c.bundleId) counts.set(c.bundleId, (counts.get(c.bundleId) ?? 0) + 1);
  if (![...counts.values()].some((n) => n < 2)) return clips;
  return clips.map((c) => {
    if (!c.bundleId || (counts.get(c.bundleId) ?? 0) >= 2) return c;
    const { bundleId: _gone, ...rest } = c;
    return rest as AnyClipProps;
  });
};
