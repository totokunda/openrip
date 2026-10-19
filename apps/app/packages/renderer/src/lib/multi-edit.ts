// Editing several selected clips at once with a single clip's panel: the panel edits the last
// selected clip, and what that edit changed (the leaves of a field that differ before and after,
// the keyframe lists that differ) is made on the others too. Each clip keeps the rest of its own
// values: brightness set on three clips leaves their contrast alone. Pure; the panel's wrapper
// is components/properties/multi/MirrorEdits.tsx (`node --test tests/*.test.ts` checks this).
import _ from "lodash";
import type { ClipKeyframes, Keyframe } from "./types";

export type Leaf = { path: string[]; value: unknown };

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * What changed from `before` to `after`: each leaf that differs, by its path through the objects
 * (arrays and values are leaves, so a curve's points are replaced whole). A leaf that went away
 * has `undefined` as its value. The same value gives none.
 */
export const leafDiff = (before: unknown, after: unknown, path: string[] = []): Leaf[] => {
  if (_.isEqual(before, after)) return [];
  if (isPlain(before) && isPlain(after)) {
    const out: Leaf[] = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) out.push(...leafDiff(before[k], after[k], [...path, k]));
    return out;
  }
  return [{ path, value: _.cloneDeep(after) }];
};

/** `base` with the leaves set (objects on the way made as needed); `base` itself isn't touched. */
export const applyLeaves = (base: unknown, leaves: Leaf[]): unknown => {
  if (!leaves.length) return base;
  const whole = leaves.find((l) => l.path.length === 0);
  if (whole) return _.cloneDeep(whole.value);
  const out: Record<string, unknown> = isPlain(base) ? _.cloneDeep(base) : {};
  for (const { path, value } of leaves) {
    if (value === undefined) _.unset(out, path);
    else _.set(out, path, _.cloneDeep(value));
  }
  return out;
};

/**
 * The value several clips share, as a panel shows it: the first one's, and whether any differs
 * from it by more than `tolerance` (the panel shows "-" then, as CapCut does).
 */
export const shared = (values: number[], tolerance = 0.005): { value: number; mixed: boolean } => ({
  value: values[0] ?? 0,
  mixed: values.some((v) => Math.abs(v - values[0]) > tolerance),
});

/** The keyframe properties (those `matches` takes) whose lists differ, with the new list (undefined: gone). */
export const keyDiff = (before: ClipKeyframes | undefined, after: ClipKeyframes | undefined, matches: (property: string) => boolean): Record<string, Keyframe[] | undefined> => {
  const out: Record<string, Keyframe[] | undefined> = {};
  const props = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const p of props) {
    if (!matches(p)) continue;
    const a = (before as any)?.[p] as Keyframe[] | undefined;
    const b = (after as any)?.[p] as Keyframe[] | undefined;
    if (!_.isEqual(a ?? [], b ?? [])) out[p] = b && b.length ? _.cloneDeep(b) : undefined;
  }
  return out;
};

/** The keyframes with those lists replaced (or removed). */
export const applyKeys = (keys: ClipKeyframes | undefined, changes: Record<string, Keyframe[] | undefined>): ClipKeyframes | undefined => {
  const next: Record<string, Keyframe[]> = { ...(keys as Record<string, Keyframe[]> | undefined) };
  for (const [p, list] of Object.entries(changes)) {
    if (list) next[p] = _.cloneDeep(list);
    else delete next[p];
  }
  return Object.keys(next).length ? (next as ClipKeyframes) : undefined;
};
