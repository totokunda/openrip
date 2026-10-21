import React, { useMemo } from "react";
import { Group, Path, Rect, Shape, Text } from "react-konva";
import type { AnyClipProps } from "@/lib/types";
import { BAR_WIDTH, LINE_COLOR, clipBars, volumeLine, type WaveScale, type WaveformBuckets } from "@/lib/waveform";
import { TIMELINE_COLORS } from "@/lib/timeline-colors";

/**
 * A clip's sound as CapCut draws it on the timeline (lib/waveform.ts): its bars rising from the
 * bottom of a band and the volume line across, for the part of the clip on screen. Drawn in the
 * clip's own group, `y` the band's top; `snap` moves the bars onto whole device pixels, as
 * CapCut's are. The Shape carries what it draws (`clipId`, `heights`, `maxBar`, `line`, `area`,
 * `pxPerFrame`) for the harness.
 */
export const Waveform: React.FC<{
  clip: AnyClipProps;
  buckets: WaveformBuckets | null;
  fps: number;
  mediaSeconds?: number;
  pxPerFrame: number;
  /** The part of the clip on screen, px from its left edge. */
  fromPx: number;
  toPx: number;
  y: number;
  height: number;
  scale: WaveScale;
  color: string;
  snap: number;
}> = ({ clip, buckets, fps, mediaSeconds, pxPerFrame, fromPx, toPx, y, height, scale, color, snap }) => {
  const from = Math.floor(fromPx) - 4;
  const to = Math.ceil(toPx) + 4;
  const bars = useMemo(
    () => (buckets ? clipBars(clip, buckets, { fps, pxPerFrame, mediaSeconds, fromPx: from, toPx: to, scale, max: height }) : []),
    [clip, buckets, fps, pxPerFrame, mediaSeconds, from, to, scale.full, scale.line, scale.lag, height],
  );
  const line = useMemo(() => volumeLine(clip, { fps, pxPerFrame, fromPx: from, toPx: to, scale, max: height }), [clip, fps, pxPerFrame, from, to, scale.full, scale.line, height]);
  const maxBar = bars.reduce((m, b) => Math.max(m, b.h), 0);
  return (
    <Shape
      name="waveform"
      listening={false}
      clipId={clip.clipId}
      bars={bars.length}
      maxBar={maxBar}
      heights={bars}
      line={line}
      area={height}
      pxPerFrame={pxPerFrame}
      sceneFunc={(context) => {
        const ctx = (context as unknown as { _context: CanvasRenderingContext2D })._context;
        const bottom = y + height;
        ctx.fillStyle = color;
        for (const b of bars) ctx.fillRect(b.x + snap, bottom - b.h, BAR_WIDTH, b.h);
        if (line.length > 1) {
          // Half a pixel thick: one device pixel, as CapCut's.
          ctx.strokeStyle = LINE_COLOR;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          line.forEach((p, i) => (i ? ctx.lineTo(p.x, bottom - p.h - 0.25) : ctx.moveTo(p.x, bottom - p.h - 0.25)));
          ctx.stroke();
        }
      }}
    />
  );
};

/** The Effects tab's wand (Remix Icon's magic-fill, 24 px). */
export const WAND =
  "M15.2238 15.5079L13.0111 20.1581C12.8687 20.4573 12.5107 20.5844 12.2115 20.442C12.1448 20.4103 12.0845 20.3665 12.0337 20.3129L8.49229 16.5741C8.39749 16.474 8.27113 16.4096 8.13445 16.3918L3.02816 15.7243C2.69958 15.6814 2.46804 15.3802 2.51099 15.0516C2.52056 14.9784 2.54359 14.9075 2.5789 14.8426L5.04031 10.3192C5.1062 10.1981 5.12839 10.058 5.10314 9.92253L4.16 4.85991C4.09931 4.53414 4.3142 4.22086 4.63997 4.16017C4.7126 4.14664 4.78711 4.14664 4.85974 4.16017L9.92237 5.10331C10.0579 5.12855 10.198 5.10637 10.319 5.04048L14.8424 2.57907C15.1335 2.42068 15.4979 2.52825 15.6562 2.81931C15.6916 2.88421 15.7146 2.95507 15.7241 3.02833L16.3916 8.13462C16.4095 8.2713 16.4739 8.39766 16.5739 8.49245L20.3127 12.0338C20.5533 12.2617 20.5636 12.6415 20.3357 12.8821C20.2849 12.9357 20.2246 12.9795 20.1579 13.0112L15.5078 15.224C15.3833 15.2832 15.283 15.3835 15.2238 15.5079ZM16.0206 17.435L17.4348 16.0208L21.6775 20.2634L20.2633 21.6776L16.0206 17.435Z";

let measurer: CanvasRenderingContext2D | null = null;
const CHIP_FONT_SIZE = 10;
/** CapCut's chip text is tighter than the system font at its size: "IMG_9079.MOV" is 67.5 px. */
const CHIP_SPACING = -0.5;
/** How wide `text` is in the chips' font and spacing. */
const textWidth = (text: string): number => {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return text.length * 5.5;
  measurer.font = `${CHIP_FONT_SIZE}px -apple-system, BlinkMacSystemFont, sans-serif`;
  return measurer.measureText(text).width + CHIP_SPACING * text.length;
};

/**
 * CapCut's label chips at a clip's top left (measured on 003 and 18-inspector-video/001): 14 px
 * tall, 4.5 px in and 2 px down, its colour with white over it, 10 px #e0e0e0 text with 2.5 px
 * either side, 5 px apart (a media clip's name and length). `effect` (the clip's effects) leads in
 * the effect bars' colour with the Effects tab's wand, so a clip with effects shows it at a glance.
 */
export const ClipChips: React.FC<{ texts: string[]; fill: string; maxWidth: number; clipId: string; glyph?: "compound"; effect?: string }> = ({ texts, fill, maxWidth, clipId, glyph, effect }) => {
  let x = 4.5;
  const out: React.ReactNode[] = [];
  if (effect && x < maxWidth - 6) {
    const w = Math.min(Math.ceil(textWidth(effect)) + 5 + 13, maxWidth - x - 2);
    out.push(
      <Group key="clip-effect-chip" name="clip-effect-chip" x={x} y={2} clipX={0} clipY={0} clipWidth={w} clipHeight={14}>
        <Rect width={w} height={14} cornerRadius={3} fill={TIMELINE_COLORS.effect} />
        <Path x={2.5} y={2} scaleX={10 / 24} scaleY={10 / 24} data={WAND} fill="#ffffff" listening={false} />
        <Text x={15.5} y={2.5} text={effect} fontSize={CHIP_FONT_SIZE} letterSpacing={CHIP_SPACING} fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" fill="#ffffff" wrap="none" />
      </Group>,
    );
    x += w + 5;
  }
  for (const [i, t] of texts.entries()) {
    if (!t || x >= maxWidth - 6) break;
    // A compound clip's name chip has its glyph (a framed timeline) before the name.
    const lead = i === 0 && glyph ? 14 : 0;
    const w = Math.min(Math.ceil(textWidth(t)) + 5 + lead, maxWidth - x - 2);
    out.push(
      <Group key={t} x={x} y={2} clipX={0} clipY={0} clipWidth={w} clipHeight={14}>
        <Rect width={w} height={14} cornerRadius={3} fill={fill} />
        {lead > 0 && (
          <Path x={3.5} y={2} data="M1.5 0.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM3 3.5h4M3 5h4M3 6.5h2.5" stroke="#e0e0e0" strokeWidth={1} lineCap="round" lineJoin="round" listening={false} />
        )}
        <Text x={2.5 + lead} y={2.5} text={t} fontSize={CHIP_FONT_SIZE} letterSpacing={CHIP_SPACING} fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" fill="#e0e0e0" wrap="none" />
      </Group>,
    );
    x += w + 5;
  }
  return (
    <Group name="clip-chips" listening={false} chips={texts} clipId={clipId}>
      {out}
    </Group>
  );
};
