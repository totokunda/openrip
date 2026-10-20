// Several timelines per project (CapCut's File ▸ New timeline). A project holds a list of
// timelines, each with tracks, clips and markers of its own, named "Timeline 01", "Timeline 02",
// …; the media (assets), the canvas, the frame rate and the player's guides belong to the
// project and are shared. The one being edited lives in the clip store's `clips`, `timelines`,
// `markers` and `magnet` as it always did; the others are parked here as plain content and
// swapped in by lib/timelines.ts. Not to be confused with a compound clip (lib/compound.ts): a
// timeline nested inside one clip. Pure functions, in the style of lib/compound.ts.
import type { AnyClipProps, Marker, TimelineProps } from "./types";
import { cloneContent } from "./compound.ts";

/** What a timeline holds apart from its name: what the editor shows while it is the one being edited. */
export interface TimelineContent {
  clips: AnyClipProps[];
  /** The tracks (the store calls them `timelines`). */
  timelines: TimelineProps[];
  markers: Marker[];
  magnet: boolean;
  clipDuration: number;
  /** Where the playhead was, and the timeline's zoom: to come back to. */
  playhead: number;
  view: { total: number; window: [number, number]; zoom: number };
}

/** An entry of the project's list. `content` is absent for the timeline being edited (the stores hold it). */
export interface ProjectTimeline {
  id: string;
  name: string;
  content?: TimelineContent;
}

type NewId = () => string;

/** "Timeline 01", "Timeline 02", …: the smallest number no timeline of `names` uses. */
export const nextTimelineName = (names: string[]) => {
  const used = new Set(names.map((n) => /^Timeline\s+(\d+)$/i.exec(n.trim())?.[1]).filter((n): n is string => n != null).map(Number));
  let k = 1;
  while (used.has(k)) k += 1;
  return `Timeline ${String(k).padStart(2, "0")}`;
};

/** `base`, or "base 2", "base 3", … when a timeline has that name already. */
export const uniqueName = (base: string, names: string[]) => {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let k = 2;
  while (taken.has(`${base} ${k}`.toLowerCase())) k += 1;
  return `${base} ${k}`;
};

/** A new timeline with nothing in it. */
export const emptyContent = (): TimelineContent => ({
  clips: [],
  timelines: [],
  markers: [],
  magnet: true,
  clipDuration: 0,
  playhead: 0,
  view: { total: 0, window: [0, 0], zoom: 1 },
});

/** A copy of a timeline's content with every id fresh (clips, tracks, links, markers), for Duplicate. */
export const cloneTimelineContent = (content: TimelineContent, newId: NewId): TimelineContent => {
  const copy = cloneContent({ clips: content.clips, timelines: content.timelines }, newId);
  return { ...content, clips: copy.clips, timelines: copy.timelines, markers: content.markers.map((m) => ({ ...m, id: newId() })) };
};

/** The list with `content` parked in `id`'s entry (the timeline being left). */
export const park = (list: ProjectTimeline[], id: string, content: TimelineContent): ProjectTimeline[] => list.map((t) => (t.id === id ? { ...t, content } : t));

/** `id`'s content, brought out of the list to be edited (empty for a new timeline), and the list without it. */
export const take = (list: ProjectTimeline[], id: string): { list: ProjectTimeline[]; content: TimelineContent } => ({
  list: list.map((t) => (t.id === id ? { id: t.id, name: t.name } : t)),
  content: list.find((t) => t.id === id)?.content ?? emptyContent(),
});

/** The list after renaming `id` to `name` (trimmed; unchanged when empty). Names stay unique. */
export const renameIn = (list: ProjectTimeline[], id: string, name: string): ProjectTimeline[] => {
  const trimmed = name.trim();
  const at = list.find((t) => t.id === id);
  if (!at || !trimmed || at.name === trimmed) return list;
  const unique = uniqueName(trimmed, list.filter((t) => t.id !== id).map((t) => t.name));
  return list.map((t) => (t.id === id ? { ...t, name: unique } : t));
};

/** The timeline to edit after deleting `id`: the one after it (or before it, for the last), null for the only one. */
export const afterDelete = (list: ProjectTimeline[], id: string): string | null => {
  const i = list.findIndex((t) => t.id === id);
  if (i < 0 || list.length < 2) return null;
  return (list[i + 1] ?? list[i - 1]).id;
};

// ---- the project file -----------------------------------------------------------------------

/** A timeline as the project file holds it (clips in the file's own form). */
export interface SavedTimeline<C = unknown> {
  id: string;
  name: string;
  tracks: TimelineProps[];
  clips: C[];
  markers?: Marker[];
  magnet?: boolean;
  /** Content length in frames, playhead and zoom (kept for timelines other than the active one). */
  duration?: number;
  playhead?: number;
  view?: { total: number; window: [number, number]; zoom: number };
}

/**
 * The timelines a project file lists, in order: `timeline` (with its `id` and `name` when it
 * was saved by a version that has several timelines; the first, whatever else is active) and
 * `moreTimelines`. A file from before them has just `timeline`: it becomes "Timeline 01".
 * The active one is `editorState.activeTimeline` when that names one in the file, else the first.
 */
export const listFromDoc = <C>(doc: {
  timeline?: Partial<SavedTimeline<C>>;
  moreTimelines?: SavedTimeline<C>[];
  editorState?: { activeTimeline?: string };
}, newId: NewId): { list: { id: string; name: string; saved: SavedTimeline<C> }[]; active: string } => {
  const first = doc.timeline ?? {};
  const head = { id: first.id || newId(), name: (first.name ?? "").trim() || "Timeline 01" };
  const more = (Array.isArray(doc.moreTimelines) ? doc.moreTimelines : []).filter((t) => t && typeof t === "object");
  const used = new Set<string>([head.id]);
  const names = [head.name];
  const list: { id: string; name: string; saved: SavedTimeline<C> }[] = [{ ...head, saved: { tracks: [], clips: [], ...first, ...head } }];
  for (const t of more) {
    const id = typeof t.id === "string" && t.id && !used.has(t.id) ? t.id : newId();
    used.add(id);
    const name = uniqueName((t.name ?? "").trim() || nextTimelineName(names), names);
    names.push(name);
    list.push({ id, name, saved: { ...t, id, name } });
  }
  const wanted = doc.editorState?.activeTimeline;
  return { list, active: wanted && used.has(wanted) ? wanted : head.id };
};
