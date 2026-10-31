// What a drag on the new timeline does (docs/plan/timeline-rewrite.md): from the document as it
// was at the press, the layout and the pointer, the edit the drag would make (lib/timeline/core)
// and what to show with it: the snap guide, the line where a new track would go. The surface
// draws the result as the pointer moves and commits it as it's let go. Pure.
import type { Marker } from "../types.ts";
import { insertionFrame, linkedClips, mainTrackOf, mainTrackPreview, snapPoints, snapToPoints, SNAP_PX } from "../timeline-edit.ts";
import { fitOnTrack, moveClips, trimEdge, type Doc, type MoveSpec, type Rules } from "./core/edit.ts";
import { getTimelineTypeForClip, isValidTimelineForClip } from "./core/tracks.ts";
import { TRACK_GAP, visibleBand, type Layout, type Row } from "./layout.ts";
import { frameAt, framesFor } from "./view.ts";

/** What snapping (CapCut's auto snapping, N) snaps to besides the clips' edges. */
export interface SnapContext {
  on: boolean;
  playhead: number;
  markers: Marker[];
  beats: number[];
}

/** Where a clip dragged between tracks would make a new one: the index it goes in at, the line's y. */
export interface NewTrackLine {
  index: number;
  y: number;
}

/** How near (px) a line between tracks takes a drag. */
export const LINE_ZONE = 7;

/** The rows that can be seen, top to bottom. */
const seenRows = (l: Layout) =>
  l.rows.filter((r) => {
    const [top, bottom] = visibleBand(l, r);
    return r.top + r.height >= top && r.top <= bottom;
  });

/**
 * What the pointer at `y` drags onto: a track, or (above the top one, below the last, or on a
 * line between two) a new track at that place.
 */
export function targetAt(l: Layout, y: number): { row: Row } | { line: NewTrackLine } | null {
  const rows = seenRows(l);
  if (rows.length === 0) return null;
  const index = (r: Row) => l.rows.indexOf(r);
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (y < first.top - 2) return { line: { index: index(first), y: first.top - TRACK_GAP / 2 } };
  if (y > last.top + last.height + 2) return { line: { index: index(last) + 1, y: last.top + last.height + TRACK_GAP / 2 } };
  for (let i = 1; i < rows.length; i++) {
    const lineY = (rows[i - 1].top + rows[i - 1].height + rows[i].top) / 2;
    if (Math.abs(y - lineY) <= LINE_ZONE) return { line: { index: index(rows[i]), y: lineY } };
  }
  let best = rows[0];
  for (const r of rows) if (Math.abs(y - (r.top + r.height / 2)) < Math.abs(y - (best.top + best.height / 2))) best = r;
  return { row: best };
}

export interface MoveDrag {
  /** The document at the press, which every step of the drag starts from. */
  start: Doc;
  lead: string;
  followers: string[];
  /** The frame under the pointer at the press, and the dragged clip's start, length and track then. */
  pressFrame: number;
  leadStart: number;
  length: number;
  leadTrack: string;
  /** The id a new track gets. */
  newTrackId: string;
}

export interface MovePreview {
  doc: Doc;
  spec: MoveSpec;
  /** The frame a snap guide is drawn at. */
  guide: number | null;
  /** The line where a new track would go. */
  line: NewTrackLine | null;
}

/**
 * A move to pointer (x, y): the dragged clip goes where the pointer takes it, keeping where it
 * was held; onto the track under the pointer if it can go there (else it stays on its own), or a
 * new one on a line between tracks; snapped, and fitted into the free spot nearest. With the
 * magnet on, over the main track it goes in before or after the clip under the pointer. A new
 * video track never goes under the main track: with the magnet on the clip goes onto the main
 * track instead, with it off onto a new track just above it.
 */
export function previewMove(drag: MoveDrag, l: Layout, rules: Rules, snap: SnapContext, x: number, y: number, skipSnap = false): MovePreview {
  const lead = drag.start.clips.find((c) => c.clipId === drag.lead)!;
  const movers = new Set([drag.lead, ...drag.followers]);
  const pointer = frameAt(l.view, x);
  let start = Math.round(pointer - (drag.pressFrame - drag.leadStart));
  const main = mainTrackOf(drag.start.tracks);
  const mainIndex = main ? drag.start.tracks.indexOf(main) : -1;
  const kind = getTimelineTypeForClip(lead);
  let track = drag.leadTrack;
  let newTrack: MoveSpec["newTrack"];
  let line: NewTrackLine | null = null;
  const target = targetAt(l, y);
  if (target && "line" in target) {
    let index = target.line.index;
    const onMain = kind === "media" && main && index > mainIndex && rules.magnet && !main.locked;
    if (kind === "media" && main && index > mainIndex && !onMain) index = mainIndex;
    if (onMain) track = main!.timelineId;
    else {
      newTrack = { index, type: kind };
      track = drag.newTrackId;
      // Moved up from under the main track: the line just above it.
      line = index === target.line.index ? target.line : { index, y: (l.rows[index]?.top ?? target.line.y) - TRACK_GAP / 2 };
    }
  } else if (target && "row" in target && isValidTimelineForClip(target.row.track, lead) && !target.row.track.locked) {
    track = target.row.id;
  }
  let guide: number | null = null;
  let insertAt: number | null = null;
  if (rules.magnet && main && !main.locked && track === main.timelineId) {
    insertAt = insertionFrame(drag.start.clips, drag.start.tracks, pointer, new Set([drag.lead]));
    start = mainTrackPreview(drag.start.clips, drag.start.tracks, new Set([drag.lead]), drag.length, insertAt).insertAt ?? 0;
  } else {
    if (snap.on && !skipSnap) {
      const points = snapPoints(drag.start.clips, { playhead: snap.playhead, markers: snap.markers, exclude: movers, beats: snap.beats });
      const hit = snapToPoints([start, start + drag.length], points, framesFor(l.view, SNAP_PX));
      if (hit) {
        start += hit.delta;
        guide = hit.point;
      }
    }
    start = Math.max(0, start);
    if (!newTrack) {
      const fitted = fitOnTrack(drag.start.clips, track, movers, start, drag.length);
      if (fitted !== start) guide = null;
      start = fitted;
    }
  }
  const spec: MoveSpec = { lead: drag.lead, followers: drag.followers, delta: start - drag.leadStart, track, newTrack, insertAt };
  return { doc: moveClips(drag.start, rules, spec), spec, guide, line };
}

export interface TrimDrag {
  start: Doc;
  id: string;
  side: "left" | "right";
  /** The frame under the pointer at the press, and the edge's frame then. */
  pressFrame: number;
  edge: number;
}

/** A trim to pointer x: the edge follows the pointer from where it was held, snapped, as far as the trim can go. */
export function previewTrim(drag: TrimDrag, l: Layout, rules: Rules, snap: SnapContext, x: number, skipSnap = false): { doc: Doc; applied: number; guide: number | null } {
  let target = drag.edge + Math.round(frameAt(l.view, x) - drag.pressFrame);
  let guide: number | null = null;
  if (snap.on && !skipSnap) {
    const clip = drag.start.clips.find((c) => c.clipId === drag.id);
    const exclude = new Set([drag.id, ...(rules.linkage ? linkedClips(drag.start.clips, clip) : []).map((c) => c.clipId)]);
    const points = snapPoints(drag.start.clips, { playhead: snap.playhead, markers: snap.markers, exclude, beats: snap.beats });
    const hit = snapToPoints([target], points, framesFor(l.view, SNAP_PX));
    if (hit) {
      target = hit.point;
      guide = hit.point;
    }
  }
  const { doc, applied } = trimEdge(drag.start, rules, drag.id, drag.side, target - drag.edge);
  return { doc, applied, guide: applied === target - drag.edge ? guide : null };
}

/** The clips a marquee from (x0, y0) to (x1, y1) touches: on screen, none on a locked track. */
export function marqueeHits(l: Layout, x0: number, y0: number, x1: number, y1: number): string[] {
  const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
  return l.clips
    .filter((b) => {
      if (b.row.track.locked) return false;
      const [vt, vb] = visibleBand(l, b.row);
      const bt = Math.max(b.y, vt);
      const bb = Math.min(b.y + b.h, vb);
      return b.x <= right && b.x + b.w >= left && bt <= bottom && bb >= top;
    })
    .map((b) => b.id);
}
