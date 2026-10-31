// What goes on a clip of the new timeline besides its body and chips (docs/plan/timeline-rewrite.md):
// a video's or photo's thumbnails, a sound's bars and volume line, a sticker's picture, beat dots,
// animation lines and the speed badge, the "Media missing" cover. Each is a plain function of a
// canvas context and the clip's box that draws only what's on screen, from what media.ts has now.
// The look is what the timeline before this one drew (components/timeline/clips/*), cached.
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useMissingMedia } from "@/lib/media/missing";
import { posterOf, compoundFrame, pathAt } from "@/lib/compound-thumb";
import { mediaSecondsOf } from "@/lib/audio-tools";
import { beatFrames } from "@/lib/beats";
import { TIMELINE_COLORS } from "@/lib/timeline-colors";
import { AUDIO_SCALE, BAND_SCALE, BAR_WIDTH, LINE_COLOR, SOUND_COLORS, scaleFor, soundKindOf, volumeLine, type WaveScale, type WaveformBuckets } from "@/lib/waveform";
import { beatDots, motionMarks } from "@/lib/timeline/marks";
import { planTiles, tileWidthFor } from "@/lib/timeline/thumbs";
import { pxPerFrame } from "@/lib/timeline/view";
import type { ClipBox, Layout } from "@/lib/timeline/layout";
import type { ClipLook } from "@/lib/timeline/appearance";
import type { AnyClipProps, Asset, AudioClipProps, StickerClipProps, VideoClipProps } from "@/lib/types";
import { WAND_PATH } from "./glyphs";
import { barsOf, bucketsOf, compoundSoundOf, factsOf, gridOf, cachedBeats, mediaInfoOf, pictureAt, requestRedraw, stickerImage } from "./media";

/** The heights the waveforms' scales are measured at: an audio clip, and a video's sound band. */
const AUDIO_HEIGHT = 50;
const BAND_HEIGHT = 16;

/** The part of the clip on screen, px from its left edge. */
const visible = (l: Layout, b: ClipBox): [number, number] => [Math.max(0, l.view.x0 - b.x), Math.min(b.w, l.width - b.x)];

const assetOf = (clip: AnyClipProps): Asset | undefined => {
  const id = (clip as { assetId?: string }).assetId;
  return id ? useClipStore.getState().assets[id] : undefined;
};

const fpsNow = () => useControlsStore.getState().fps || 24;

// ---- thumbnails ----

/** A video's or photo's thumbnails in its middle band: tiles at the picture's aspect, edge to edge, each the media at that point of the clip. */
function drawThumbs(ctx: CanvasRenderingContext2D, l: Layout, b: ClipBox, look: ClipLook) {
  const bands = look.bands!;
  if (bands.thumbs <= 0) return;
  const clip = b.clip as VideoClipProps;
  const y = b.y + bands.label;
  const [from, to] = visible(l, b);
  if (to <= from) return;
  const fps = fpsNow();
  const ppf = pxPerFrame(l.view);
  const facts = factsOf(b.id);
  if (clip.compound) {
    drawCompoundThumbs(ctx, b, y, bands.thumbs, from, to, fps, ppf);
    return;
  }
  const asset = assetOf(clip);
  if (!asset || useMissingMedia.getState().paths.has(asset.path)) return;
  const info = mediaInfoOf(clip.assetId, asset.path);
  if (!info) return;
  const still = (b.clip.type as string) === "image";
  const size = still ? info.image : info.video;
  const aspect = still ? (info.image?.width ?? 1) / Math.max(1, info.image?.height ?? 1) : (info.video?.displayWidth ?? 1) / Math.max(1, info.video?.displayHeight ?? 1);
  if (!size) return;
  const tileW = tileWidthFor(aspect, bands.thumbs);
  const dpr = window.devicePixelRatio || 1;
  const hpx = Math.max(1, Math.round(bands.thumbs * dpr));
  const wpx = Math.max(1, Math.round(tileW * dpr));
  const clipFps = info.stats.video?.averagePacketRate || fps;
  const tiles = planTiles({
    clip,
    fps,
    pxPerFrame: ppf,
    tileWidth: tileW,
    fromPx: from,
    toPx: to,
    mediaSeconds: asset.duration || info.duration || undefined,
    mediaStart: still ? 0 : (info.startFrame ?? 0) / fps,
    still,
  });
  const src = { path: asset.path, hpx, wpx, clipFps, still, info };
  let exact = 0;
  let placeholder = 0;
  ctx.save();
  // Tiles cover the clip to the pixel, a tile's right edge being the next one's left.
  ctx.beginPath();
  ctx.rect(b.x, y, b.w, bands.thumbs);
  ctx.clip();
  for (const t of tiles) {
    const pic = pictureAt(src, t.tick);
    if (!pic) continue;
    if (pic.exact) exact++;
    else placeholder++;
    const x0 = Math.floor(b.x + t.x);
    const x1 = Math.floor(b.x + t.x + t.w);
    ctx.drawImage(pic.bitmap, x0, y, Math.max(1, x1 - x0), bands.thumbs);
  }
  ctx.restore();
  facts.thumbs = { tiles: tiles.length, exact, placeholder, tileWidth: tileW, y, height: bands.thumbs };
}

/** A compound clip's content: the engine's frames where it has them, the poster of the media under it where it doesn't (lib/compound-thumb.ts). */
function drawCompoundThumbs(ctx: CanvasRenderingContext2D, b: ClipBox, y: number, h: number, from: number, to: number, fps: number, ppf: number) {
  const clip = b.clip as VideoClipProps;
  const content = clip.compound!;
  const len = Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));
  const start = Math.max(0, clip.trimStart ?? 0);
  const end = start + len * Math.max(0.01, Math.abs(Number(clip.speed) || 1));
  const width = len * ppf;
  const step = Math.max(8, Math.max(36, h * 1.2));
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.x, y, b.w, h);
  ctx.clip();
  let tiles = 0;
  for (let i = Math.floor(from / step); i * step < Math.min(to, width); i++) {
    const x = i * step;
    const frame = start + ((x + step / 2) / Math.max(1, width)) * (end - start);
    let picture: CanvasImageSource | null = compoundFrame(content, frame / fps, requestRedraw);
    if (!picture) {
      const path = pathAt(content, Math.floor(frame));
      picture = path ? posterOf(path, requestRedraw) : null;
    }
    if (!picture) continue;
    tiles++;
    const [pw, ph] = [(picture as { width?: number }).width || 1, (picture as { height?: number }).height || 1];
    // Cover the tile, centred.
    const k = Math.max(step / pw, h / ph);
    const [dw, dh] = [pw * k, ph * k];
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x + x, y, step - 1, h);
    ctx.clip();
    ctx.drawImage(picture, b.x + x + (step - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  ctx.restore();
  factsOf(b.id).thumbs = { tiles, exact: tiles, placeholder: 0, tileWidth: step, y, height: h };
}

// ---- sound ----

/** One waveform in `area` (its top and height) at the bottom of the clip's box: the bars, then the volume line. */
function drawBars(ctx: CanvasRenderingContext2D, l: Layout, b: ClipBox, buckets: WaveformBuckets, o: { y: number; height: number; scale: WaveScale; color: string; mediaSeconds?: number }) {
  const fps = fpsNow();
  const ppf = pxPerFrame(l.view);
  const [from, to] = visible(l, b);
  if (to <= from) return;
  const bars = barsOf(b.clip, buckets, { fps, pxPerFrame: ppf, mediaSeconds: o.mediaSeconds, from: from - 4, to: to + 4, scale: o.scale, max: o.height });
  const line = volumeLine(b.clip, { fps, pxPerFrame: ppf, fromPx: from - 4, toPx: to + 4, scale: o.scale, max: o.height });
  // On whole device pixels, as CapCut's bars are.
  const dpr = window.devicePixelRatio || 1;
  const snap = Math.round(b.x * dpr) / dpr - b.x;
  const bottom = o.y + o.height;
  ctx.save();
  ctx.fillStyle = o.color;
  let maxBar = 0;
  for (const bar of bars) {
    if (bar.x < from - 4) continue;
    if (bar.x > to + 4) break;
    ctx.fillRect(b.x + bar.x + snap, bottom - bar.h, BAR_WIDTH, bar.h);
    if (bar.h > maxBar) maxBar = bar.h;
  }
  if (line.length > 1) {
    // Half a pixel thick: one device pixel on Retina.
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    line.forEach((p, i) => (i ? ctx.lineTo(b.x + p.x, bottom - p.h - 0.25) : ctx.moveTo(b.x + p.x, bottom - p.h - 0.25)));
    ctx.stroke();
  }
  ctx.restore();
  factsOf(b.id).sound = { y: o.y, height: o.height, heights: bars.filter((x) => x.x >= from - 4 && x.x <= to + 4), maxBar, line, pxPerFrame: ppf, color: o.color, scale: o.scale };
}

/** An audio clip's waveform over the whole clip. */
function drawAudio(ctx: CanvasRenderingContext2D, l: Layout, b: ClipBox) {
  const asset = assetOf(b.clip);
  if (!asset) return;
  const buckets = bucketsOf(asset.path);
  if (!buckets) return;
  const size = b.row.track.waveform ?? 30;
  drawBars(ctx, l, b, buckets, {
    y: b.y,
    height: b.h,
    scale: scaleFor(AUDIO_SCALE, b.h, AUDIO_HEIGHT, size),
    color: SOUND_COLORS[soundKindOf(asset)].bar,
    mediaSeconds: asset.duration || undefined,
  });
}

/**
 * A video's own sound in its bottom band: left empty for a photo and for a video whose sound was
 * detached (its asset's path ends `#video`); a compound clip's is the mix of its content.
 */
function drawBand(ctx: CanvasRenderingContext2D, l: Layout, b: ClipBox, look: ClipLook) {
  const bands = look.bands!;
  if (bands.sound <= 0) return;
  const clip = b.clip as VideoClipProps;
  const asset = assetOf(clip);
  const own = clip.type === "video" && !!asset && !asset.path?.endsWith("#video");
  let buckets = own ? bucketsOf(asset!.path) : null;
  let seconds = asset?.duration || undefined;
  if (!buckets && clip.compound && !clip.audioSeparated) {
    const mix = compoundSoundOf(clip.clipId, clip.compound);
    buckets = mix?.buckets ?? null;
    seconds = mix?.seconds;
  }
  if (!buckets) return;
  const size = b.row.track.waveform ?? 30;
  drawBars(ctx, l, b, buckets, { y: b.y + b.h - bands.sound, height: bands.sound, scale: scaleFor(BAND_SCALE, bands.sound, BAND_HEIGHT, size), color: TIMELINE_COLORS.fromVideoWave, mediaSeconds: seconds });
}

// ---- the face ----

/**
 * The media on a clip's face, under its chips: a media clip's thumbnails and sound band, an audio
 * clip's waveform, a sticker's picture. Says whether it drew a picture that stands in for the chips.
 */
export function drawFace(ctx: CanvasRenderingContext2D, l: Layout, b: ClipBox, look: ClipLook): { picture: boolean } {
  const clip = b.clip;
  if (look.bands) {
    drawThumbs(ctx, l, b, look);
    drawBand(ctx, l, b, look);
  } else if (clip.type === "audio") {
    drawAudio(ctx, l, b);
  } else if (clip.type === "sticker") {
    const img = stickerImage((clip as StickerClipProps).stickerPath);
    if (img) {
      // The sticker's picture, fitted into the bar, instead of its name.
      const h = Math.max(4, b.h - 6);
      const k = Math.min(h / img.naturalHeight, (b.w - 8) / img.naturalWidth, 4);
      const [w, hh] = [img.naturalWidth * k, img.naturalHeight * k];
      const x = Math.max(b.x, l.view.x0) + 4;
      ctx.save();
      ctx.drawImage(img, x, b.y + (b.h - hh) / 2, w, hh);
      ctx.restore();
      factsOf(b.id).sticker = true;
      return { picture: true };
    }
  }
  return { picture: false };
}

/** A clip's beat dots, near its foot (a media clip's or a sound's marks, hand-made or the engine's). */
export function drawBeats(ctx: CanvasRenderingContext2D, l: Layout, b: ClipBox) {
  const beats = (b.clip as AudioClipProps).beats;
  if (!beats) return;
  const fps = fpsNow();
  const wantsGrid = !!beats.auto && !beats.detected?.length;
  const grid = gridOf(b.clip, wantsGrid);
  const frames = cachedBeats(b.clip, grid, () => beatFrames(b.clip, fps, grid, mediaSecondsOf(b.clip)));
  const [from, to] = visible(l, b);
  const xs = beatDots(frames, b.clip.startFrame ?? 0, Math.max(1, (b.clip.endFrame ?? 0) - (b.clip.startFrame ?? 0)), pxPerFrame(l.view), from, to);
  factsOf(b.id).beats = xs.length;
  if (xs.length === 0) return;
  ctx.save();
  ctx.fillStyle = TIMELINE_COLORS.beat;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 0.75;
  const y = b.y + b.h - 5;
  for (const x of xs) {
    ctx.beginPath();
    ctx.arc(b.x + x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** The cover over a clip whose file is gone. */
export function drawMissing(ctx: CanvasRenderingContext2D, l: Layout, b: ClipBox, font: string) {
  const asset = assetOf(b.clip);
  if (!asset || !useMissingMedia.getState().paths.has(asset.path)) return;
  ctx.save();
  ctx.fillStyle = "rgba(120, 28, 32, 0.62)";
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.font = `500 10px ${font}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffb4b7";
  ctx.fillText("Media missing", Math.max(b.x, l.view.x0) + 8, b.y + b.h / 2 + 0.5);
  ctx.restore();
  factsOf(b.id).missing = true;
}

/** A clip's animation lines along its foot and, selected, its speed badge. */
export function drawMotion(ctx: CanvasRenderingContext2D, b: ClipBox, selected: boolean, font: string) {
  const m = motionMarks(b.clip, b.w, b.h, fpsNow(), selected);
  factsOf(b.id).badge = m.badge?.label ?? null;
  if (!m.arrows.length && !m.dashed && !m.badge) return;
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1;
  const y = b.y + m.y;
  for (const a of m.arrows) {
    // A line with an arrowhead at its far end, 3.5 long and 4 wide.
    const dir = Math.sign(a.x1 - a.x0) || 1;
    ctx.beginPath();
    ctx.moveTo(b.x + a.x0, y);
    ctx.lineTo(b.x + a.x1, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x + a.x1, y);
    ctx.lineTo(b.x + a.x1 - dir * 3.5, y - 2);
    ctx.lineTo(b.x + a.x1 - dir * 3.5, y + 2);
    ctx.closePath();
    ctx.fill();
  }
  if (m.dashed) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(b.x + 2, y);
    ctx.lineTo(b.x + b.w - 2, y);
    ctx.stroke();
    ctx.restore();
  }
  if (m.badge) {
    const { x, y: by, w, h, label } = m.badge;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.roundRect(b.x + x, b.y + by, w, h, 3);
    ctx.fill();
    ctx.font = `10px ${font}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = "#e0e0e0";
    ctx.fillText(label, b.x + x + w / 2, b.y + by + h / 2 + 0.5);
  }
  ctx.restore();
}

/** The wand glyph at (x, y), 10 px, white. */
export function drawWand(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(10 / 24, 10 / 24);
  ctx.fillStyle = "#ffffff";
  if (WAND_PATH) ctx.fill(WAND_PATH);
  ctx.restore();
}

/** A compound clip's glyph (a framed timeline) at (x, y). */
const COMPOUND_PATH = typeof Path2D === "undefined" ? null : new Path2D("M1.5 0.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM3 3.5h4M3 5h4M3 6.5h2.5");
export function drawCompoundGlyph(ctx: CanvasRenderingContext2D, x: number, y: number) {
  if (!COMPOUND_PATH) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(COMPOUND_PATH);
  ctx.restore();
}
