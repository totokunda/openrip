// The new timeline's own furniture (docs/plan/timeline-rewrite.md): the Cover tile in the main
// track's column left of time 0, the scrollbars, and the blade's line. Drawing and hit-testing;
// the surface wires the presses. The look is the timeline before this one's (CapCut's, §4.10–4.11
// of docs/plan/capcut-ui-spec.md).
import { visibleBand, type Layout, type Row } from "@/lib/timeline/layout";
import { RULER_HEIGHT, TIME_ZERO_X } from "@/lib/timeline-geometry";
import { FONT } from "./draw";

// ---- The Cover tile -----------------------------------------------------------------------

/** The Cover tile's square on the main track (null when the track is too short for one, or off screen). */
export function coverTile(l: Layout): { x: number; y: number; size: number; row: Row } | null {
  const row = l.rows.find((r) => r.main);
  if (!row) return null;
  const size = Math.max(0, Math.min(42, row.height - 4, TIME_ZERO_X - 8));
  if (size < 20) return null;
  const y = row.top + (row.height - size) / 2;
  const [top, bottom] = visibleBand(l, row);
  if (y < top || y + size > bottom) return null;
  return { x: (TIME_ZERO_X - size) / 2, y, size, row };
}

/** The tile: dashed, with "Cover" in it; greyed inside a compound clip's timeline, which has no cover. */
export function drawCoverTile(ctx: CanvasRenderingContext2D, l: Layout, hover: boolean, inCompound: boolean) {
  const t = coverTile(l);
  if (!t) return;
  ctx.save();
  ctx.globalAlpha = inCompound ? 0.35 : hover ? 1 : 0.85;
  ctx.fillStyle = hover && !inCompound ? "#454545" : "#3b3b3b";
  ctx.strokeStyle = "#5c5c5c";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.roundRect(t.x + 0.5, t.y + 0.5, t.size - 1, t.size - 1, 4);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = "#cccccc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Cover", t.x + t.size / 2, t.y + t.size / 2);
  ctx.restore();
}

export const onCoverTile = (l: Layout, x: number, y: number) => {
  const t = coverTile(l);
  return !!t && x >= t.x && x <= t.x + t.size && y >= t.y && y <= t.y + t.size;
};

// ---- Scrollbars ---------------------------------------------------------------------------

const BAR = 8;
const MIN_THUMB_H = 20;
const MIN_THUMB_V = 24;

/** The horizontal scrollbar's track and thumb along the bottom: the window against the whole timeline (`total` frames). */
export function hThumb(l: Layout, total: number) {
  const left = l.view.x0;
  const width = Math.max(1, l.width - left - 2);
  const span = Math.max(1, total, l.view.end);
  const w = Math.min(width, Math.max(MIN_THUMB_H, ((l.view.end - l.view.start) / span) * width));
  const x = left + Math.max(0, Math.min(width - w, (l.view.start / span) * width));
  return { x, y: l.height - BAR - 2, w, h: BAR, track: { x: left, w: width }, framesPerPx: span / width };
}

/** The vertical scrollbar beside the scrolling (overlay) tracks, when they scroll. */
export function vThumb(l: Layout, scrollY: number) {
  if (l.tracks.maxScroll <= 0) return null;
  const top = RULER_HEIGHT + 6;
  const bottom = l.tracks.pinned ? l.tracks.overBottom : l.height - BAR - 4;
  const height = Math.max(1, bottom - top);
  const h = Math.max(MIN_THUMB_V, (height / (height + l.tracks.maxScroll)) * height);
  const y = top + (Math.max(0, Math.min(l.tracks.maxScroll, scrollY)) / l.tracks.maxScroll) * (height - h);
  return { x: l.width - BAR - 2, y, w: BAR, h, pxPerScroll: (height - h) / l.tracks.maxScroll };
}

export function drawScrollbars(ctx: CanvasRenderingContext2D, l: Layout, total: number, scrollY: number, hover: "h" | "v" | null) {
  ctx.save();
  const h = hThumb(l, total);
  if (h.w < h.track.w - 0.5) {
    ctx.fillStyle = hover === "h" ? "rgba(227,227,227,0.4)" : "rgba(227,227,227,0.1)";
    ctx.beginPath();
    ctx.roundRect(h.x, h.y, h.w, h.h, BAR / 2);
    ctx.fill();
  }
  const v = vThumb(l, scrollY);
  if (v) {
    ctx.fillStyle = hover === "v" ? "rgba(227,227,227,0.4)" : "rgba(227,227,227,0.1)";
    ctx.beginPath();
    ctx.roundRect(v.x, v.y, v.w, v.h, BAR / 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Which scrollbar thumb a point is on. */
export function scrollbarAt(l: Layout, total: number, scrollY: number, x: number, y: number): "h" | "v" | null {
  const h = hThumb(l, total);
  if (h.w < h.track.w - 0.5 && x >= h.x && x <= h.x + h.w && y >= h.y - 2 && y <= h.y + h.h + 2) return "h";
  const v = vThumb(l, scrollY);
  if (v && x >= v.x - 2 && x <= v.x + v.w + 2 && y >= v.y && y <= v.y + v.h) return "v";
  return null;
}

// ---- The blade ----------------------------------------------------------------------------

/** The blade's line (B): a dashed accent line through the tracks where a click would cut. */
export function drawBlade(ctx: CanvasRenderingContext2D, l: Layout, x: number) {
  ctx.save();
  ctx.strokeStyle = "#ae81ce";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, RULER_HEIGHT);
  ctx.lineTo(Math.round(x) + 0.5, l.height);
  ctx.stroke();
  ctx.restore();
}
