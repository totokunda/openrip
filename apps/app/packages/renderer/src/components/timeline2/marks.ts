// The marks the new timeline draws over its clips and ruler (docs/plan/timeline-rewrite.md):
// transitions on cuts, the selected clips' keyframes, the markers, the range (In/Out) and the
// rendered parts. Each has its drawing and its hit-test here; the surface's pointer controller
// turns a press on one into its gesture. The look is CapCut's (docs/plan/capcut-ui-spec.md
// §4.11–4.12), as the timeline before this one drew it.
import type { AnyClipProps, ClipTransition, Marker } from "@/lib/types";
import { cutsOn } from "@/lib/transitions";
import { keyframeFrames } from "@/lib/keyframes";
import { OVERLAY_TOP, visibleBand, type ClipBox, type Layout } from "@/lib/timeline/layout";
import { xOf } from "@/lib/timeline/view";
import { RULER_HEIGHT } from "@/lib/timeline-geometry";

const ACCENT = "#ae81ce";

// ---- Transitions -------------------------------------------------------------------------

/** The badge on a cut (px square), however short its transition. */
const BADGE = 20;
/** How far in from each side of a selected transition a press drags its duration (px). */
const SIDE = 5;
/** The Transitions tab's glyph, an hourglass on its side (Tabler's hourglass-filled, 24 px). */
const GLYPH = new Path2D(
  "M17 2a2 2 0 0 1 1.995 1.85l.005 .15v2a6.996 6.996 0 0 1 -3.393 6a6.994 6.994 0 0 1 3.388 5.728l.005 .272v2a2 2 0 0 1 -1.85 1.995l-.15 .005h-10a2 2 0 0 1 -1.995 -1.85l-.005 -.15v-2a6.996 6.996 0 0 1 3.393 -6a6.994 6.994 0 0 1 -3.388 -5.728l-.005 -.272v-2a2 2 0 0 1 1.85 -1.995l.15 -.005h10z",
);

export interface TransitionMark {
  /** The clip leaving the cut, which holds the transition. */
  clipId: string;
  transition: ClipTransition | null;
  /** The cut's x, the band's top and height, the band's width and the badge's size. */
  x: number;
  top: number;
  height: number;
  span: number;
  size: number;
  selected: boolean;
  /** A transition card is over this cut. */
  target: boolean;
  dimmed: boolean;
  locked: boolean;
  row: ClipBox["row"];
}

/** The cuts with a transition (or a card over them), on screen. */
export function transitionMarks(l: Layout, clips: AnyClipProps[], fps: number, selectedId: string | null, dropTarget: string | null): TransitionMark[] {
  const out: TransitionMark[] = [];
  const ppf = l.view.width / (l.view.end - l.view.start);
  for (const row of l.rows) {
    const [vTop, vBottom] = visibleBand(l, row);
    if (row.top > vBottom || row.top + row.height < vTop) continue;
    for (const { clip, next } of cutsOn(clips, row.id)) {
      const t = (clip.transitionOut as ClipTransition | null | undefined) ?? null;
      const target = dropTarget === clip.clipId;
      if (!t && !target) continue;
      const room = Math.min(clip.endFrame - clip.startFrame, next.endFrame - next.startFrame) * ppf;
      // The band as long as the transition (within the shorter clip), the badge on the cut.
      const w = Math.min((t?.duration ?? 0.5) * fps * ppf, room);
      const size = Math.max(10, Math.min(BADGE, room, row.height - 4));
      const span = Math.max(w, size);
      const x = xOf(l.view, clip.endFrame);
      if (x + span / 2 < l.view.x0 || x - span / 2 > l.width) continue;
      out.push({ clipId: clip.clipId, transition: t, x, top: row.top, height: row.height, span, size, selected: selectedId === clip.clipId, target, dimmed: !!row.track.hidden || !!row.track.locked, locked: !!row.track.locked, row });
    }
  }
  return out;
}

export function drawTransitions(ctx: CanvasRenderingContext2D, l: Layout, marks: TransitionMark[]) {
  for (const m of marks) {
    ctx.save();
    const [vTop, vBottom] = visibleBand(l, m.row);
    ctx.beginPath();
    ctx.rect(0, vTop, l.width, vBottom - vTop);
    ctx.clip();
    ctx.globalAlpha = m.dimmed ? 0.5 : 1;
    // Its length, two halves either side of the cut.
    ctx.fillStyle = m.target ? "rgba(174,129,206,0.35)" : m.selected ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.16)";
    ctx.strokeStyle = m.target ? ACCENT : m.selected ? "#ffffff" : "rgba(255,255,255,0.45)";
    ctx.lineWidth = m.target || m.selected ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(m.x - m.span / 2, m.top, m.span, m.height, 4);
    ctx.fill();
    ctx.stroke();
    // The seam between its halves.
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(m.x - 0.75, m.top + 2, 1.5, m.height - 4);
    // A selected one's sides drag: dotted grips.
    if (m.selected) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(m.x + side * (m.span / 2 - 3), m.top + m.height / 2 - 6 + i * 3, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // The badge: white with the glyph (the accent while a card is over the cut), ringed when selected.
    const bx = m.x - m.size / 2;
    const by = m.top + m.height / 2 - m.size / 2;
    ctx.fillStyle = m.target ? ACCENT : "#ffffff";
    ctx.beginPath();
    ctx.roundRect(bx, by, m.size, m.size, 5);
    ctx.fill();
    if (m.selected) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const g = (m.size * 0.62) / 24;
    ctx.translate(m.x, by + m.size / 2);
    ctx.rotate(Math.PI / 2);
    ctx.scale(g, g);
    ctx.translate(-12, -12);
    ctx.fillStyle = m.target ? "#ffffff" : "#1b1b1c";
    ctx.fill(GLYPH);
    ctx.restore();
  }
}

/** A press on a transition: its badge selects it; a selected one's band takes it too, its sides dragging the duration. */
export function transitionAt(marks: TransitionMark[], x: number, y: number): { mark: TransitionMark; side: -1 | 1 | null } | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (!m.transition || m.locked || y < m.top || y > m.top + m.height) continue;
    const local = x - m.x;
    if (m.selected && Math.abs(Math.abs(local) - m.span / 2) <= SIDE) return { mark: m, side: local < 0 ? -1 : 1 };
    const onBadge = Math.abs(local) <= m.size / 2 && Math.abs(y - (m.top + m.height / 2)) <= m.size / 2;
    if (onBadge || (m.selected && Math.abs(local) <= m.span / 2)) return { mark: m, side: null };
  }
  return null;
}

// ---- Keyframes ---------------------------------------------------------------------------

/** CapCut's diamond: 9 px across. */
const DIAMOND = 9;
/** Diamonds closer than this (px) at the current zoom are drawn as one. */
const MIN_GAP = 4;

export interface KeyMark {
  clipId: string;
  /** The key's frame in the clip, and where it's drawn. */
  frame: number;
  x: number;
  y: number;
  atPlayhead: boolean;
}

/** The selected clips' keyframes (one diamond for every property keyed at a frame), on screen. */
export function keyMarks(l: Layout, selected: Set<string>, playhead: number, hidden?: string | null): KeyMark[] {
  const out: KeyMark[] = [];
  for (const b of l.clips) {
    if (!selected.has(b.id) || b.id === hidden) continue;
    const start = b.clip.startFrame ?? 0;
    const length = Math.max(1, (b.clip.endFrame ?? 0) - start);
    const ppf = b.w / length;
    const [vTop, vBottom] = visibleBand(l, b.row);
    const cy = b.y + b.h / 2;
    if (cy < vTop || cy > vBottom) continue;
    let last = -Infinity;
    for (const f of keyframeFrames(b.clip.keyframes).filter((f) => f >= 0 && f <= length)) {
      const at = Math.abs(start + f - playhead) < 0.5;
      if ((f - last) * ppf < MIN_GAP && !at) continue;
      last = f;
      const x = b.x + f * ppf;
      if (x < l.view.x0 - DIAMOND || x > l.width + DIAMOND) continue;
      out.push({ clipId: b.id, frame: f, x, y: cy, atPlayhead: at });
    }
  }
  return out;
}

export function drawKeyframes(ctx: CanvasRenderingContext2D, marks: KeyMark[]) {
  ctx.save();
  for (const m of marks) {
    const r = DIAMOND / 2;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y - r);
    ctx.lineTo(m.x + r, m.y);
    ctx.lineTo(m.x, m.y + r);
    ctx.lineTo(m.x - r, m.y);
    ctx.closePath();
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.strokeStyle = m.atPlayhead ? "#ffffff" : "#141414";
    ctx.lineWidth = m.atPlayhead ? 1.5 : 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** A press on a diamond (a few px round it count). */
export const keyframeAt = (marks: KeyMark[], x: number, y: number) =>
  [...marks].reverse().find((m) => Math.abs(x - m.x) + Math.abs(y - m.y) <= DIAMOND / 2 + 3) ?? null;

// ---- Markers -----------------------------------------------------------------------------

// The tag (CapCut's: 10 px wide, square-shouldered, pointed below), hanging from the ruler's foot.
const FLAG_HALF = 5;
const FLAG_TOP = 19;
const FLAG_BOTTOM = 31;

/** A press on a marker's tag (a little wider than the tag). */
export function markerAt(l: Layout, markers: Marker[], x: number, y: number): Marker | null {
  if (y < FLAG_TOP - 6 || y > FLAG_BOTTOM + 2) return null;
  for (let i = markers.length - 1; i >= 0; i--) {
    const mx = xOf(l.view, markers[i].frame);
    if (Math.abs(x - mx) <= FLAG_HALF + 2) return markers[i];
  }
  return null;
}

// ---- The range ---------------------------------------------------------------------------

/** The range on the ruler: a lavender band between In and Out, faint over the tracks, an edge to drag at each end. */
export function drawRange(ctx: CanvasRenderingContext2D, l: Layout, range: { start: number; end: number }) {
  const x0 = xOf(l.view, range.start);
  const x1 = xOf(l.view, range.end);
  const left = Math.max(l.view.x0, x0);
  const right = Math.min(l.width, x1);
  ctx.save();
  if (right > left) {
    ctx.fillStyle = "rgba(174,129,206,0.35)";
    ctx.fillRect(left, 1, right - left, 16);
    ctx.fillStyle = "rgba(174,129,206,0.07)";
    ctx.fillRect(left, RULER_HEIGHT, right - left, Math.max(0, l.height - RULER_HEIGHT));
  }
  ctx.fillStyle = ACCENT;
  for (const x of [x0, x1]) {
    if (x < l.view.x0 || x > l.width) continue;
    ctx.beginPath();
    ctx.roundRect(x - 3, 1, 6, 16, 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A press on one of the range's edges. */
export function rangeEdgeAt(l: Layout, range: { start: number; end: number } | null, x: number, y: number): "in" | "out" | null {
  if (!range || y < 0 || y > 18) return null;
  if (Math.abs(x - xOf(l.view, range.start)) <= 4) return "in";
  if (Math.abs(x - xOf(l.view, range.end)) <= 4) return "out";
  return null;
}

// ---- What's rendered ---------------------------------------------------------------------

/** The thin bar along the ruler's foot over the parts of the timeline that are rendered (lib/prerender.ts). */
export function drawRendered(ctx: CanvasRenderingContext2D, l: Layout, ranges: { start: number; end: number }[]) {
  ctx.save();
  ctx.fillStyle = "#5aa0e6";
  for (const r of ranges) {
    const x0 = Math.max(l.view.x0, xOf(l.view, r.start));
    const x1 = Math.min(l.width, xOf(l.view, r.end));
    if (x1 > x0) ctx.fillRect(x0, RULER_HEIGHT - 3, x1 - x0, 3);
  }
  ctx.restore();
}

export { OVERLAY_TOP };
