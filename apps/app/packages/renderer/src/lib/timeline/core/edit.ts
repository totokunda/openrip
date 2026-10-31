// The timeline's moves and trims as CapCut makes them (docs/plan/timeline-rewrite.md): each goes
// from the document as it was when the gesture began, and how far the pointer has gone, to the
// document it leaves. A drag draws what these return and a drop commits exactly that, so the two
// can't disagree. Clips nothing touched come back as the same objects. Pure.
import type { AnyClipProps, TimelineProps, TimelineType } from "../../types.ts";
import { isTrackLocked, linkedClips, mainTrackOf, packMainTrack } from "../../timeline-edit.ts";
import { bundleMates } from "../../bundle.ts";
import { clampEdgeDelta, moveEdge } from "./edges.ts";
import { resolveOverlapsTimelines } from "./tracks.ts";

/** The part of the project an edit changes: the clips and the tracks, top to bottom. */
export interface Doc {
  clips: AnyClipProps[];
  tracks: TimelineProps[];
}

/** The switches an edit follows: the main track's magnet, linkage, and the frame rate. */
export interface Rules {
  magnet: boolean;
  linkage: boolean;
  fps: number;
}

const startOf = (c: AnyClipProps) => c.startFrame ?? 0;
const endOf = (c: AnyClipProps) => c.endFrame ?? 0;
const lengthOf = (c: AnyClipProps) => Math.max(1, endOf(c) - startOf(c));

/** A track's visible clips, by start, without those in `exclude`. */
export const clipsOnTrack = (clips: AnyClipProps[], trackId: string | undefined, exclude?: Set<string>) =>
  clips.filter((c) => c.timelineId === trackId && !c.hidden && !exclude?.has(c.clipId)).sort((a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b));

/**
 * The clips that go along when `ids` move: each one's linked clips (with linkage on) and group
 * mates. None hidden, none on a locked track, none a text template's container.
 */
export function goingWith(doc: Doc, ids: string[], rules: Rules): string[] {
  const out = new Set(ids);
  for (const id of ids) {
    const c = doc.clips.find((x) => x.clipId === id);
    if (!c) continue;
    for (const x of [...(rules.linkage ? linkedClips(doc.clips, c) : []), ...bundleMates(doc.clips, c)]) out.add(x.clipId);
  }
  return [...out].filter((id) => {
    const c = doc.clips.find((x) => x.clipId === id);
    return !!c && !c.hidden && c.type !== "group" && !isTrackLocked(doc.tracks, c.timelineId);
  });
}

/**
 * Where a clip `length` frames long starting at `start` goes among `others` (one track's clips,
 * by start) without overlapping any: where it is if it fits, else the free spot nearest it.
 */
export function nearestFree(others: AnyClipProps[], start: number, length: number): number {
  let best = Math.max(0, start);
  let bestDistance = Infinity;
  let cursor = 0;
  const consider = (from: number, to: number) => {
    if (to - from < length) return;
    const s = Math.min(Math.max(start, from), to - length);
    if (Math.abs(s - start) < bestDistance) {
      bestDistance = Math.abs(s - start);
      best = s;
    }
  };
  for (const c of others) {
    consider(cursor, startOf(c));
    cursor = Math.max(cursor, endOf(c));
  }
  consider(cursor, Infinity);
  return Math.max(0, best);
}

/** The free spot for a clip on a track, the clips in `exclude` (those moving) not counting. */
export const fitOnTrack = (clips: AnyClipProps[], trackId: string, exclude: Set<string>, start: number, length: number) =>
  nearestFree(clipsOnTrack(clips, trackId, exclude), start, length);

/**
 * Moving clips that would land on others go to the nearest free spot on their own track, the
 * clips that stayed where they were staying put. `order` puts the clip dragged first.
 */
function settle(clips: AnyClipProps[], movers: Set<string>, order: string[], skipTrack?: string): AnyClipProps[] {
  const tracks = new Set(clips.filter((c) => movers.has(c.clipId)).map((c) => c.timelineId ?? ""));
  const moved = new Map<string, AnyClipProps>();
  const rank = (id: string) => (order.indexOf(id) + 1 || order.length + 1);
  for (const t of tracks) {
    if (t === skipTrack) continue;
    const placed = clipsOnTrack(clips, t, movers);
    const going = clipsOnTrack(clips, t).filter((c) => movers.has(c.clipId)).sort((a, b) => rank(a.clipId) - rank(b.clipId) || startOf(a) - startOf(b));
    for (const c of going) {
      const s = nearestFree(placed, startOf(c), lengthOf(c));
      const next = s === startOf(c) ? c : ({ ...c, startFrame: s, endFrame: s + lengthOf(c) } as AnyClipProps);
      if (next !== c) moved.set(c.clipId, next);
      placed.push(next);
      placed.sort((a, b) => startOf(a) - startOf(b));
    }
  }
  return moved.size ? clips.map((c) => moved.get(c.clipId) ?? c) : clips;
}

export interface MoveSpec {
  /** The clip being dragged. */
  lead: string;
  /** The others going with it (selected with it, linked, grouped). */
  followers: string[];
  /** How many frames they all move. */
  delta: number;
  /** The track the dragged clip goes onto. */
  track: string;
  /** A new track of `type` inserted at `index` (top to bottom) for it, `track` its id. */
  newTrack?: { index: number; type: TimelineType };
  /** Onto the main track with the magnet on: in at this frame (a clip's start, or the end), the clips after it making room. */
  insertAt?: number | null;
}

/** A new empty track of `type` (its height and place are set when the tracks are stacked). */
export const newTrackOf = (id: string, type: TimelineType): TimelineProps =>
  ({ timelineId: id, type, timelineY: 0, timelineHeight: 0, timelinePadding: 0, timelineWidth: 0, muted: false, hidden: false }) as TimelineProps;

/**
 * The document after a move: the dragged clip onto its track, it and the clips going with it
 * `delta` frames on (none before frame 0), group mates across as many tracks as it went. With
 * the magnet on, the main track makes room where a clip goes in and closes up behind one that
 * left it. A clip going along that would land on another goes to the nearest free spot.
 */
export function moveClips(doc: Doc, rules: Rules, spec: MoveSpec): Doc {
  const lead = doc.clips.find((c) => c.clipId === spec.lead);
  if (!lead) return doc;
  let tracks = doc.tracks;
  if (spec.newTrack) {
    tracks = [...tracks];
    tracks.splice(Math.max(0, Math.min(tracks.length, spec.newTrack.index)), 0, newTrackOf(spec.track, spec.newTrack.type));
    tracks = resolveOverlapsTimelines(tracks);
  }
  const ids = new Set([spec.lead, ...spec.followers]);
  const movers = doc.clips.filter((c) => ids.has(c.clipId) && !c.hidden && !isTrackLocked(tracks, c.timelineId));
  if (!movers.includes(lead)) return doc;
  const d = Math.max(Math.round(spec.delta), -Math.min(...movers.map(startOf)));
  const order = tracks.map((t) => t.timelineId);
  const kindOf = (id: string | undefined) => tracks.find((t) => t.timelineId === id)?.type;
  const shift = order.indexOf(spec.track) - order.indexOf(lead.timelineId ?? "");
  const mates = new Set(bundleMates(doc.clips, lead).map((c) => c.clipId));
  const moved = new Map<string, AnyClipProps>();
  for (const m of movers) {
    let timelineId = m.timelineId;
    if (m === lead) timelineId = spec.track;
    else if (mates.has(m.clipId) && shift !== 0) {
      // Group mates go across as many tracks as the dragged clip, onto a track of their kind.
      const to = tracks[order.indexOf(m.timelineId ?? "") + shift];
      if (to && !to.locked && to.type === kindOf(m.timelineId)) timelineId = to.timelineId;
    }
    if (d === 0 && timelineId === m.timelineId) continue;
    moved.set(m.clipId, { ...m, timelineId, startFrame: startOf(m) + d, endFrame: endOf(m) + d } as AnyClipProps);
  }
  let clips = moved.size ? doc.clips.map((c) => moved.get(c.clipId) ?? c) : doc.clips;
  const main = mainTrackOf(tracks);
  if (rules.magnet) clips = packMainTrack(clips, tracks, spec.insertAt != null ? { ids: [spec.lead], at: spec.insertAt } : undefined, rules.linkage);
  clips = settle(clips, ids, [spec.lead], rules.magnet ? main?.timelineId : undefined);
  return { clips, tracks };
}

/**
 * The document after a trim: `id`'s `side` edge moved `delta` frames, with its linked clips
 * (linkage on). Each stops at its media's end, at a frame long, at frame 0, and on any track
 * but the magnetic main track at the clip next to it; on that one the clips after it follow
 * (ripple). `applied` is how far the edge went.
 */
export function trimEdge(doc: Doc, rules: Rules, id: string, side: "left" | "right", delta: number): { doc: Doc; applied: number } {
  const clip = doc.clips.find((c) => c.clipId === id);
  if (!clip || clip.type === "group" || clip.hidden) return { doc, applied: 0 };
  const group = [clip, ...(rules.linkage ? linkedClips(doc.clips, clip) : [])].filter((c) => c.type !== "group" && !c.hidden);
  if (group.some((c) => isTrackLocked(doc.tracks, c.timelineId))) return { doc, applied: 0 };
  let d = Math.round(delta);
  for (const c of group) d = clampEdgeDelta(c, side, d);
  const main = mainTrackOf(doc.tracks);
  const ids = new Set(group.map((c) => c.clipId));
  for (const c of group) {
    if (rules.magnet && c.timelineId === main?.timelineId) continue;
    const others = clipsOnTrack(doc.clips, c.timelineId, ids);
    if (side === "right" && d > 0) {
      const next = others.filter((o) => startOf(o) >= endOf(c)).map(startOf);
      if (next.length) d = Math.min(d, Math.min(...next) - endOf(c));
    } else if (side === "left" && d < 0) {
      const prev = others.filter((o) => endOf(o) <= startOf(c)).map(endOf);
      if (prev.length) d = Math.max(d, Math.max(...prev) - startOf(c));
    }
  }
  if (d === 0) return { doc, applied: 0 };
  const changed = new Map(group.map((c) => [c.clipId, moveEdge(c, side, d, rules.fps)] as const));
  let clips = doc.clips.map((c) => changed.get(c.clipId) ?? c);
  if (rules.magnet) clips = packMainTrack(clips, doc.tracks, undefined, rules.linkage);
  return { doc: { clips, tracks: doc.tracks }, applied: d };
}
