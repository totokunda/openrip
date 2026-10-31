// Drawing the new timeline onto its canvases (docs/plan/timeline-rewrite.md): plain functions of
// a canvas context and the layout (lib/timeline/layout.ts), the look from CapCut's measurements
// (docs/plan/capcut-ui-spec.md §2.3, §4.11, §4.12) in OpenRip's colours. The main canvas holds
// everything but the playhead, which has a small canvas of its own over it so playback redraws a
// line, not the timeline.
import type { Marker } from "@/lib/types";
import type { ClipLook } from "@/lib/timeline/appearance";
import { OVERLAY_TOP, visibleBand, type ClipBox, type Layout, type Row } from "@/lib/timeline/layout";
import { ticksFor } from "@/lib/timeline/ticks";
import { xOf } from "@/lib/timeline/view";
import { RULER_HEIGHT } from "@/lib/timeline-geometry";
import { TIMELINE_COLORS } from "@/lib/timeline-colors";
import { drawBeats, drawCompoundGlyph, drawFace, drawMissing, drawMotion, drawWand } from "./clipface";
import { beginMediaPass, factsOf } from "./media";

export const FONT = "-apple-system, BlinkMacSystemFont, sans-serif";
const CLIP_RADIUS = 3;
const SELECTED = "#ffffff";

/** A rounded rectangle's path. */
const rounded = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.max(0, Math.min(r, w / 2, h / 2)));
};

/** The ruler: ticks hanging from its foot, MM:SS (or frame) labels right of the majors. */
export function drawRuler(ctx: CanvasRenderingContext2D, l: Layout, fps: number) {
  // The ruler is the first thing of a draw of the main canvas: what the clips ask of their media from here to the next is what's wanted.
  beginMediaPass();
  const foot = RULER_HEIGHT;
  ctx.save();
  ctx.font = `10.5px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#6c6c6c";
  for (const t of ticksFor(l.view, fps)) {
    if (t.x < l.view.x0 - 1 || t.x > l.width + 1) continue;
    const x = Math.round(t.x) + 0.5;
    ctx.fillStyle = t.major ? "#727272" : "#404040";
    ctx.fillRect(x - 0.5, foot - (t.major ? 10.5 : 5.5), 1, t.major ? 10.5 : 5.5);
    if (t.label) {
      ctx.fillStyle = "#6c6c6c";
      ctx.fillText(t.label, x + 4, foot - 5);
    }
  }
  ctx.restore();
}

/** Runs `paint` clipped to each part of the track area: the scrolling overlay tracks, then the pinned ones. */
export function inTrackAreas(ctx: CanvasRenderingContext2D, l: Layout, paint: (pinned: boolean) => void) {
  const parts: [boolean, number, number][] = l.tracks.pinned
    ? [
        [false, OVERLAY_TOP, l.tracks.overBottom],
        [true, l.tracks.overBottom, l.height],
      ]
    : [[false, OVERLAY_TOP, l.height]];
  for (const [pinned, top, bottom] of parts) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, l.width, Math.max(0, bottom - top));
    ctx.clip();
    paint(pinned);
    ctx.restore();
  }
}

const inPart = (l: Layout, row: Row, pinned: boolean) => (l.tracks.pinned ? row.pinned === pinned : true);

/** The track bands, from time 0 to past the right edge. */
export function drawRows(ctx: CanvasRenderingContext2D, l: Layout, pinned: boolean) {
  const x = Math.max(0, xOf(l.view, 0));
  for (const r of l.rows) {
    if (!inPart(l, r, pinned)) continue;
    ctx.fillStyle = "rgba(11, 11, 13, 0.25)";
    rounded(ctx, x, r.top, l.width - x + 8, r.height, 4);
    ctx.fill();
  }
}

/** A hidden, muted (audio) or locked track's dimming, over its clips. */
export function drawRowShades(ctx: CanvasRenderingContext2D, l: Layout, pinned: boolean) {
  const x = Math.max(0, xOf(l.view, 0));
  for (const r of l.rows) {
    if (!inPart(l, r, pinned)) continue;
    const off = r.track.hidden || (r.track.type === "audio" && r.track.muted);
    if (off) {
      ctx.fillStyle = "rgba(11, 11, 13, 0.60)";
      ctx.fillRect(x, r.top, l.width - x + 8, r.height);
    }
    if (r.track.locked) {
      ctx.fillStyle = "rgba(11, 11, 13, 0.45)";
      ctx.fillRect(x, r.top, l.width - x + 8, r.height);
    }
  }
}

let hatch: CanvasPattern | null = null;
/** The diagonal stripes a deactivated clip is drawn with. */
const hatchOn = (ctx: CanvasRenderingContext2D) => {
  if (hatch) return hatch;
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255, 255, 255, 0.18)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, 8);
  g.lineTo(8, 0);
  g.stroke();
  hatch = ctx.createPattern(c, "repeat");
  return hatch!;
};

/** Text cut to fit `max` px, with an ellipsis. */
const fit = (ctx: CanvasRenderingContext2D, text: string, max: number) => {
  if (max <= 6) return "";
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "…").width <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "";
};

/**
 * A clip's label chips: in its top band for media and sound, centred in a one-line bar
 * otherwise. They keep to the visible part of the clip, so a clip scrolled half out of view
 * still says what it is. A media clip's effects chip leads, in the effect bars' colour with the
 * wand; a compound clip's name chip and an effect bar's lead with their glyphs.
 */
function drawChips(ctx: CanvasRenderingContext2D, b: ClipBox, look: ClipLook, from: number, to: number) {
  const texts = look.chips;
  if (texts.length === 0 && !look.effects) return;
  ctx.save();
  ctx.font = `500 10px ${FONT}`;
  ctx.letterSpacing = "-0.3px";
  ctx.textBaseline = "middle";
  const h = 14;
  const y = look.chipsOnTop ? b.y + 2 : b.y + (b.h - h) / 2;
  let x = Math.max(b.x, from) + 4.5;
  const right = Math.min(b.x + b.w, to) - 4;
  // The glyph's room before the first chip's text: the compound glyph's, or the wand's.
  const glyph = look.glyph === "compound" ? 14 : look.glyph === "effect" ? 13 : 0;
  const chip = (text: string, lead: number, fill: string, draw?: (x: number) => void, color = "#e0e0e0") => {
    const room = right - x - 5 - lead;
    const t = fit(ctx, text, room);
    if (!t) return false;
    const w = ctx.measureText(t).width + 5 + lead;
    ctx.fillStyle = fill;
    rounded(ctx, x, y, w, h, 3);
    ctx.fill();
    draw?.(x);
    ctx.fillStyle = color;
    ctx.fillText(t, x + 2.5 + lead, y + h / 2 + 0.5);
    x += w + 5;
    return true;
  };
  if (look.effects) chip(look.effects, 13, TIMELINE_COLORS.effect, (cx) => drawWand(ctx, cx + 2.5, y + 2), "#ffffff");
  texts.forEach((t, i) => {
    if (i !== 0 || !glyph) return void chip(t, 0, look.chip);
    chip(t, glyph, look.chip, (cx) => (look.glyph === "compound" ? drawCompoundGlyph(ctx, cx + 3.5, y + 2) : drawWand(ctx, cx + 2.5, y + 2)));
  });
  ctx.restore();
}

export interface ClipPaint {
  look: ClipLook;
  selected: boolean;
  deactivated: boolean;
}

/** A clip: its body, bands, chips, hatching, and if selected its outline and trim handles. */
export function drawClip(ctx: CanvasRenderingContext2D, l: Layout, b: ClipBox, p: ClipPaint) {
  const { look } = p;
  const [vTop, vBottom] = visibleBand(l, b.row);
  if (b.y > vBottom || b.y + b.h < vTop) return;
  ctx.save();
  rounded(ctx, b.x, b.y, b.w, b.h, CLIP_RADIUS);
  ctx.clip();
  ctx.fillStyle = look.body;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  if (look.bands) {
    // The thumbnails' band, a shade darker until its frames are drawn over it.
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(b.x, b.y + look.bands.label, b.w, look.bands.thumbs);
  }
  // The media: thumbnails and sound, a sound's waveform, a sticker's picture (which stands in for its name chip).
  const { picture } = drawFace(ctx, l, b, look);
  const shown = picture ? { ...look, chips: [] } : look;
  factsOf(b.id).chips = look.effects ? [look.effects, ...shown.chips] : shown.chips;
  drawChips(ctx, b, shown, l.view.x0, l.width);
  drawBeats(ctx, l, b);
  if (p.deactivated) {
    ctx.fillStyle = "rgba(30, 30, 32, 0.72)";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = hatchOn(ctx);
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  drawMissing(ctx, l, b, FONT);
  drawMotion(ctx, b, p.selected, FONT);
  ctx.restore();
  if (p.selected) {
    ctx.save();
    ctx.strokeStyle = SELECTED;
    ctx.lineWidth = 1.5;
    rounded(ctx, b.x + 0.75, b.y + 0.75, b.w - 1.5, b.h - 1.5, CLIP_RADIUS);
    ctx.stroke();
    // The trim handles: a 3 px bar inside each end.
    ctx.fillStyle = SELECTED;
    rounded(ctx, b.x, b.y, 3, b.h, CLIP_RADIUS);
    ctx.fill();
    rounded(ctx, b.x + b.w - 3, b.y, 3, b.h, CLIP_RADIUS);
    ctx.fill();
    ctx.restore();
  }
}

/** The markers' flags, hanging below the ruler. */
export function drawMarkers(ctx: CanvasRenderingContext2D, l: Layout, markers: Marker[], selectedId: string | null) {
  ctx.save();
  for (const m of markers) {
    const x = xOf(l.view, m.frame);
    if (x < l.view.x0 - 6 || x > l.width + 6) continue;
    ctx.beginPath();
    ctx.moveTo(x - 5, 19);
    ctx.lineTo(x + 5, 19);
    ctx.lineTo(x + 5, 27);
    ctx.lineTo(x, 31);
    ctx.lineTo(x - 5, 27);
    ctx.closePath();
    ctx.fillStyle = m.color || "#AE81CE";
    ctx.fill();
    if (m.id === selectedId) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The playhead: a 1 px white line through ruler and tracks under a hollow shield (10×14, 2 px). */
export function drawPlayhead(ctx: CanvasRenderingContext2D, l: Layout, frame: number) {
  const x = Math.round(xOf(l.view, frame)) + 0.5;
  if (x < l.view.x0 - 1 || x > l.width) return;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - 0.5, 0, 1, l.height);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.fillStyle = "#1b1b1c";
  ctx.beginPath();
  ctx.moveTo(x - 4, 1);
  ctx.lineTo(x + 4, 1);
  ctx.lineTo(x + 4, 8);
  ctx.quadraticCurveTo(x + 4, 13, x, 14);
  ctx.quadraticCurveTo(x - 4, 13, x - 4, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The preview axis's line where the pointer skims (not while playing). */
export function drawSkim(ctx: CanvasRenderingContext2D, l: Layout, frame: number) {
  const x = Math.round(xOf(l.view, frame)) + 0.5;
  if (x < l.view.x0 || x > l.width) return;
  ctx.save();
  ctx.fillStyle = "rgba(174, 129, 206, 0.9)";
  ctx.fillRect(x - 0.5, OVERLAY_TOP, 1, l.height - OVERLAY_TOP);
  ctx.restore();
}

/** Where a moving clip would land: a translucent white slot. */
export function drawSlot(ctx: CanvasRenderingContext2D, b: ClipBox) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 1.5;
  rounded(ctx, b.x + 0.75, b.y + 0.75, b.w - 1.5, b.h - 1.5, CLIP_RADIUS);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** A clip being moved, drawn where the pointer has taken it, over everything. */
export function drawFloating(ctx: CanvasRenderingContext2D, l: Layout, b: ClipBox, p: ClipPaint) {
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = p.look.body;
  rounded(ctx, b.x, b.y, b.w, b.h, CLIP_RADIUS);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.85;
  // Drawn whole wherever it is: the floating clip isn't held to its row's band.
  drawClip(ctx, { ...l, tracks: { ...l.tracks, pinned: false }, height: Infinity } as Layout, { ...b, row: { ...b.row, pinned: true } }, p);
  ctx.restore();
}

/** The snap guide: a dashed white line through the tracks at frame `f`. */
export function drawGuide(ctx: CanvasRenderingContext2D, l: Layout, f: number) {
  const x = Math.round(xOf(l.view, f)) + 0.5;
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 2;
  ctx.beginPath();
  ctx.moveTo(x, OVERLAY_TOP);
  ctx.lineTo(x, l.height);
  ctx.stroke();
  ctx.restore();
}

/** Where a clip dragged between tracks would make a new one: an accent line across. */
export function drawNewTrackLine(ctx: CanvasRenderingContext2D, l: Layout, y: number) {
  ctx.save();
  ctx.fillStyle = "#ae81ce";
  ctx.fillRect(l.view.x0, Math.round(y) - 1, l.width - l.view.x0, 2);
  ctx.restore();
}

/** The marquee a drag on empty space draws. */
export function drawMarquee(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.save();
  ctx.fillStyle = "rgba(174, 129, 206, 0.12)";
  ctx.strokeStyle = "rgba(174, 129, 206, 0.9)";
  ctx.lineWidth = 1;
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  ctx.fillRect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0));
  ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
  ctx.restore();
}

/** A trimmed clip's new length, in a tip above it by the pointer. */
export function drawTrimTip(ctx: CanvasRenderingContext2D, l: Layout, b: ClipBox, text: string, pointerX: number) {
  ctx.save();
  ctx.font = `500 10.5px ${FONT}`;
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 12;
  const h = 18;
  const x = Math.max(l.view.x0, Math.min(l.width - w - 2, pointerX - w / 2));
  const y = Math.max(OVERLAY_TOP, b.y - h - 4);
  ctx.fillStyle = "rgba(20, 20, 22, 0.92)";
  rounded(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x + 6, y + h / 2 + 0.5);
  ctx.restore();
}
