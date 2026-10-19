// The timeline's editing rules, as CapCut has them: the main track and its magnet, linked
// clips, locked tracks, where a clip dropped on the main track goes, and snapping. Plain
// functions of the clip store's clips and tracks; the store (lib/clip.ts) applies them to its
// edits and the timeline's components use them while a drag is under way.
// See docs/plan/app-engine-integration.md.
import type { Asset, AnyClipProps, GroupClipProps, Marker, TimelineProps } from "./types";
import { carriedClips } from "./linkage";

const startOf = (c: AnyClipProps) => c.startFrame ?? 0;
const endOf = (c: AnyClipProps) => c.endFrame ?? 0;

/**
 * The main track: the lowest video track, which CapCut keeps gapless from the start while its
 * magnet is on. Overlay video tracks sit above it; it's never moved below another video track
 * or deleted while one exists, so it stays the same track.
 */
export const mainTrackOf = (timelines: TimelineProps[]): TimelineProps | undefined => {
  for (let i = timelines.length - 1; i >= 0; i--) {
    if (timelines[i].type === "media") return timelines[i];
  }
  return undefined;
};

export const isTrackLocked = (timelines: TimelineProps[], timelineId?: string) =>
  !!timelineId && !!timelines.find((t) => t.timelineId === timelineId)?.locked;

/** The clips linked to `clip` (its video or its extracted audio), without it. */
export const linkedClips = (clips: AnyClipProps[], clip: AnyClipProps | undefined): AnyClipProps[] => {
  if (!clip?.linkId) return [];
  return clips.filter((c) => c.linkId === clip.linkId && c.clipId !== clip.clipId);
};

/**
 * Whether an edit may not touch `clip`: its track is locked, or (with linkage on, `linked`) a
 * clip linked to it is on a locked track (moving one would move the other).
 */
export const isClipLocked = (clips: AnyClipProps[], timelines: TimelineProps[], clip: AnyClipProps | undefined, linked = true) =>
  !!clip &&
  (isTrackLocked(timelines, clip.timelineId) || (linked && linkedClips(clips, clip).some((c) => isTrackLocked(timelines, c.timelineId))));

/** The main track's clips (a group's hidden children aren't on it), in time order. */
const mainClips = (clips: AnyClipProps[], main: TimelineProps, exclude?: Set<string>) =>
  clips
    .filter((c) => c.timelineId === main.timelineId && !c.hidden && !exclude?.has(c.clipId))
    .sort((a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b));

/** Whether the main track's clips already run end to end from the start. */
export const isMainTrackPacked = (clips: AnyClipProps[], timelines: TimelineProps[]) => {
  const main = mainTrackOf(timelines);
  if (!main) return true;
  let cursor = 0;
  for (const c of mainClips(clips, main)) {
    if (startOf(c) !== cursor) return false;
    cursor = endOf(c);
  }
  return true;
};

/**
 * The main track with its clips end to end from 0, in time order (a clip whose start moved
 * left onto the one before, a trim of its left edge outwards, stays after it and grows).
 * Clips in `insert` go in at the point `at` (a clip's start, or the end): before the clip
 * that starts there. What a clip carries moves with it: a group's children, and (with linkage
 * on, `linked`) the clips linked to it on other tracks, unless their track is locked. A locked
 * main track stays as it is. Returns `clips` itself when nothing moves.
 */
export function packMainTrack(
  clips: AnyClipProps[],
  timelines: TimelineProps[],
  insert?: { ids: string[]; at: number },
  linked = true,
): AnyClipProps[] {
  const main = mainTrackOf(timelines);
  if (!main || main.locked) return clips;
  const inserted = new Set(insert?.ids ?? []);
  const key = (c: AnyClipProps) => (inserted.has(c.clipId) ? insert!.at - 0.5 : startOf(c));
  const order = clips
    .filter((c) => c.timelineId === main.timelineId && !c.hidden)
    .sort((a, b) => key(a) - key(b) || startOf(a) - startOf(b) || endOf(a) - endOf(b));
  const shifts = new Map<string, number>();
  let cursor = 0;
  for (const c of order) {
    if (startOf(c) !== cursor) shifts.set(c.clipId, cursor - startOf(c));
    cursor += Math.max(0, endOf(c) - startOf(c));
  }
  if (shifts.size === 0) return clips;
  const moves = new Map(shifts);
  for (const c of order) {
    const d = shifts.get(c.clipId);
    if (!d) continue;
    if (c.type === "group") {
      for (const id of ((c as GroupClipProps).children ?? []).flat()) moves.set(id, d);
    }
    for (const p of linked ? linkedClips(clips, c) : []) {
      if (p.timelineId !== main.timelineId && !p.hidden && !isTrackLocked(timelines, p.timelineId)) moves.set(p.clipId, d);
    }
  }
  return clips.map((c) => {
    const d = moves.get(c.clipId);
    return d ? ({ ...c, startFrame: startOf(c) + d, endFrame: endOf(c) + d } as AnyClipProps) : c;
  });
}

/** The gaps on a track: where each runs from and to (from 0 to the first clip counts), in time order. */
export function trackGaps(clips: AnyClipProps[], timelineId: string): { from: number; to: number }[] {
  const gaps: { from: number; to: number }[] = [];
  let cursor = 0;
  const order = clips.filter((c) => c.timelineId === timelineId && !c.hidden).sort((a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b));
  for (const c of order) {
    if (startOf(c) > cursor) gaps.push({ from: cursor, to: startOf(c) });
    cursor = Math.max(cursor, endOf(c));
  }
  return gaps;
}

/** The gap on a track that `frame` is in, if it's in one. */
export const gapAt = (clips: AnyClipProps[], timelineId: string, frame: number) =>
  trackGaps(clips, timelineId).find((g) => frame >= g.from && frame < g.to);

/**
 * CapCut's Close gap (the gap at `frame`) and Close all gaps (`frame` null) on a track: the
 * clips after a gap move back by its length. A group's children and (with linkage on,
 * `linked`) the clips linked to a moved one go with it, unless their track is locked. A locked
 * track stays as it is. Returns `clips` itself when nothing moves.
 */
export function closeGaps(
  clips: AnyClipProps[],
  timelines: TimelineProps[],
  timelineId: string,
  frame: number | null,
  linked = true,
  /** With linkage on, the kinds of Linkage settings that are off and the assets (sound effects): the main track's overlays go with its clips. */
  carry?: { off: string[]; assets?: Record<string, Asset> },
): AnyClipProps[] {
  if (isTrackLocked(timelines, timelineId)) return clips;
  const gaps = trackGaps(clips, timelineId).filter((g) => frame == null || (frame >= g.from && frame < g.to));
  if (gaps.length === 0) return clips;
  const shiftOf = (start: number) => gaps.filter((g) => g.to <= start).reduce((n, g) => n + (g.to - g.from), 0);
  const moves = new Map<string, number>();
  for (const c of clips.filter((c) => c.timelineId === timelineId && !c.hidden)) {
    const d = shiftOf(startOf(c));
    if (!d) continue;
    moves.set(c.clipId, d);
    if (c.type === "group") for (const id of ((c as GroupClipProps).children ?? []).flat()) moves.set(id, d);
    for (const p of linked ? linkedClips(clips, c) : []) {
      if (p.timelineId !== timelineId && !p.hidden && !isTrackLocked(timelines, p.timelineId)) moves.set(p.clipId, d);
    }
    // The overlays on the main track's clip (Linkage settings).
    if (carry && mainTrackOf(timelines)?.timelineId === timelineId) {
      for (const p of carriedClips(clips, timelines, timelineId, [c], carry.off, carry.assets)) moves.set(p.clipId, d);
    }
  }
  return clips.map((c) => {
    const d = moves.get(c.clipId);
    return d ? ({ ...c, startFrame: startOf(c) - d, endFrame: endOf(c) - d } as AnyClipProps) : c;
  });
}

/**
 * Where a clip dropped at `frame` goes on the main track: before the clip under it when it's
 * in that clip's first half, else after it (the start of the next clip, or the track's end).
 * `exclude` holds the clips being moved.
 */
export function insertionFrame(clips: AnyClipProps[], timelines: TimelineProps[], frame: number, exclude?: Set<string>) {
  const main = mainTrackOf(timelines);
  if (!main) return Math.max(0, frame);
  const others = mainClips(clips, main, exclude);
  for (const c of others) {
    if (frame < (startOf(c) + endOf(c)) / 2) return startOf(c);
  }
  return others.length ? endOf(others[others.length - 1]) : 0;
}

/**
 * The main track as a drag would leave it, for showing during the drag: the clips' starts
 * with the moving ones (`exclude`) taken out and, if `insertLength` is given, a clip of that
 * length put in at the point `at` (from insertionFrame). `insertAt` is where it would start.
 */
export function mainTrackPreview(
  clips: AnyClipProps[],
  timelines: TimelineProps[],
  exclude: Set<string>,
  insertLength: number | null,
  at: number,
): { starts: Record<string, number>; insertAt: number | null } {
  const main = mainTrackOf(timelines);
  const starts: Record<string, number> = {};
  if (!main) return { starts, insertAt: null };
  let cursor = 0;
  let insertAt: number | null = null;
  for (const c of mainClips(clips, main, exclude)) {
    if (insertLength != null && insertAt == null && startOf(c) >= at) {
      insertAt = cursor;
      cursor += insertLength;
    }
    starts[c.clipId] = cursor;
    cursor += Math.max(0, endOf(c) - startOf(c));
  }
  if (insertLength != null && insertAt == null) insertAt = cursor;
  return { starts, insertAt };
}

/** How near (in screen pixels) an edge has to come to a point to snap to it. */
export const SNAP_PX = 6;

/**
 * What a dragged clip or edge snaps to, in frames: the playhead, the markers, the edges of
 * every clip on every track, except the ones being moved (`exclude`), and the music's beat
 * markers (`beats`: lib/beats.ts `beatSnapPoints`, as CapCut snaps to them).
 */
export function snapPoints(
  clips: AnyClipProps[],
  { playhead, markers, exclude, beats = [] }: { playhead: number; markers: Marker[]; exclude: Set<string>; beats?: number[] },
): number[] {
  const points = [playhead, ...markers.map((m) => m.frame), ...beats];
  for (const c of clips) {
    if (c.hidden || exclude.has(c.clipId)) continue;
    points.push(startOf(c), endOf(c));
  }
  return points;
}

/**
 * The point nearest to any of `edges` (frames) within `tolerance` frames, and how far the
 * edges move to reach it; null when none is that near.
 */
export function snapToPoints(edges: number[], points: number[], tolerance: number): { delta: number; point: number } | null {
  let best: { delta: number; point: number } | null = null;
  for (const e of edges) {
    for (const p of points) {
      const d = p - e;
      if (Math.abs(d) <= tolerance && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, point: p };
    }
  }
  return best;
}

/**
 * The colours a marker can have: CapCut's five hues, with OpenRip's accent first (a new
 * marker's) where CapCut has its cyan, and the cyan last. A CapCut draft's markers keep their
 * own colour.
 */
export const MARKER_COLORS = ["#AE81CE", "#EB7A6B", "#E49F54", "#A8C06B", "#57BECB"];
