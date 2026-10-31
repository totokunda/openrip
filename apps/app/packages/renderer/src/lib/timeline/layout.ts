// Where everything on the new timeline is (docs/plan/timeline-rewrite.md): from the clips, the
// tracks, the view and the canvas's size, every track row and every clip's rectangle. The canvas
// draws from it and the pointer hit-tests it, so what's drawn is what's clicked. Pure.
//
// The rows sit where the timeline before this one put them (and where the track headers and the
// smoke tests expect them): a track's band starts `TRACK_TOP` below the canvas's top plus its
// saved `timelineY`, `TRACK_GAP` shorter than its saved height. With more tracks than fit, the
// main track and what's below it stay pinned at the bottom and the overlay tracks scroll above it.
import type { AnyClipProps, TimelineProps } from "../types.ts";
import { RULER_HEIGHT } from "../timeline-geometry.ts";
import { TRACK_TOP, layoutTracks, type TrackLayout } from "../timeline-view.ts";
import { mainTrackOf } from "../timeline-edit.ts";
import { frameAt, xOf, type TimelineView } from "./view.ts";

/** The gap under each track's band (a track's saved height includes it). */
export const TRACK_GAP = 8;
/** Room kept under the last track to drag a new one in. */
export const SCROLL_BOTTOM_PADDING = 48;
/** Where the overlay tracks stop as they scroll up: under the ruler and its marker flags. */
export const OVERLAY_TOP = RULER_HEIGHT + 6;
/** The narrowest a clip is drawn. */
export const MIN_CLIP_WIDTH = 3;
/** How far inside a selected clip's edge a press takes hold of its trim handle. */
export const TRIM_GRAB = 10;

export interface Row {
  track: TimelineProps;
  id: string;
  /** The band's top and height on the canvas. */
  top: number;
  height: number;
  main: boolean;
  /** Fixed at the bottom while the overlay tracks scroll. */
  pinned: boolean;
}

export interface ClipBox {
  clip: AnyClipProps;
  id: string;
  row: Row;
  /** The clip's rectangle on the canvas (it can run past either edge). */
  x: number;
  w: number;
  y: number;
  h: number;
}

export interface Layout {
  view: TimelineView;
  width: number;
  height: number;
  /** Every track, top to bottom. */
  rows: Row[];
  /** The clips with any part on screen, in the order they're drawn. */
  clips: ClipBox[];
  /** The pinning: offsets, the overlay area's bottom and how far it scrolls. */
  tracks: TrackLayout;
}

export interface LayoutInput {
  clips: AnyClipProps[];
  tracks: TimelineProps[];
  view: TimelineView;
  width: number;
  height: number;
  /** How far the overlay tracks are scrolled. */
  scrollY: number;
}

/** The y range a row can be seen in: the overlay tracks scroll under the ruler, the pinned ones don't. */
export const visibleBand = (l: Pick<Layout, "tracks" | "height">, row: Row): [number, number] =>
  row.pinned || !l.tracks.pinned ? [OVERLAY_TOP, l.height] : [OVERLAY_TOP, l.tracks.overBottom];

export function layoutTimeline({ clips, tracks, view, width, height, scrollY }: LayoutInput): Layout {
  const main = mainTrackOf(tracks);
  const pin = layoutTracks(tracks, main, height, scrollY, SCROLL_BOTTOM_PADDING);
  const rows: Row[] = tracks.map((track) => {
    const y = track.timelineY ?? 0;
    const pinned = pin.pinned && y >= pin.from;
    return {
      track,
      id: track.timelineId,
      top: y + TRACK_TOP + (pinned ? pin.pin : pin.over),
      height: Math.max(1, (track.timelineHeight ?? 54) - TRACK_GAP),
      main: track === main,
      pinned,
    };
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const l: Layout = { view, width, height, rows, clips: [], tracks: pin };
  for (const clip of clips) {
    if (clip.hidden) continue;
    const row = byId.get(clip.timelineId ?? "");
    if (!row) continue;
    const x = xOf(view, clip.startFrame ?? 0);
    const w = Math.max(MIN_CLIP_WIDTH, xOf(view, clip.endFrame ?? 0) - x);
    if (x + w < 0 || x > width) continue;
    const [top, bottom] = visibleBand(l, row);
    if (row.top + row.height < top || row.top > bottom) continue;
    l.clips.push({ clip, id: clip.clipId, row, x, w, y: row.top, h: row.height });
  }
  return l;
}

export type Hit =
  | { kind: "ruler"; frame: number }
  | { kind: "clip"; box: ClipBox; frame: number; edge: "left" | "right" | null }
  | { kind: "row"; row: Row; frame: number }
  | { kind: "none"; frame: number };

/** The grab zone inside a clip's edge: a short clip keeps two thirds of itself to drag by. */
export const trimGrab = (w: number) => Math.max(MIN_CLIP_WIDTH, Math.min(TRIM_GRAB, w / 3));

/**
 * What's under canvas point (x, y). `canTrim` says whether a clip's edges take hold (a
 * selected clip on an unlocked track). Later clips are drawn over earlier ones, so they're
 * tested first.
 */
export function hitTest(l: Layout, x: number, y: number, canTrim: (box: ClipBox) => boolean): Hit {
  const frame = frameAt(l.view, x);
  if (y < OVERLAY_TOP) return { kind: "ruler", frame };
  for (let i = l.clips.length - 1; i >= 0; i--) {
    const b = l.clips[i];
    const [top, bottom] = visibleBand(l, b.row);
    if (y < Math.max(b.y, top) || y > Math.min(b.y + b.h, bottom) || x < b.x || x > b.x + b.w) continue;
    let edge: "left" | "right" | null = null;
    if (canTrim(b)) {
      const g = trimGrab(b.w);
      if (x <= b.x + g) edge = "left";
      else if (x >= b.x + b.w - g) edge = "right";
    }
    return { kind: "clip", box: b, frame, edge };
  }
  const row = l.rows.find((r) => {
    const [top, bottom] = visibleBand(l, r);
    return y >= Math.max(r.top, top) && y <= Math.min(r.top + r.height, bottom);
  });
  return row ? { kind: "row", row, frame } : { kind: "none", frame };
}
