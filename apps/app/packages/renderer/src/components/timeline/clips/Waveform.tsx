import React, { useMemo } from "react";
import { Group, Rect, Shape, Text } from "react-konva";
import type { AnyClipProps } from "@/lib/types";
import { BAR_WIDTH, LINE_COLOR, clipBars, volumeLine, type WaveScale, type WaveformBuckets } from "@/lib/waveform";

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
 * either side, 5 px apart (a media clip's name and length).
 */
export const ClipChips: React.FC<{ texts: string[]; fill: string; maxWidth: number; clipId: string }> = ({ texts, fill, maxWidth, clipId }) => {
  let x = 4.5;
  const out: React.ReactNode[] = [];
  for (const t of texts) {
    if (!t || x >= maxWidth - 6) break;
    const w = Math.min(Math.ceil(textWidth(t)) + 5, maxWidth - x - 2);
    out.push(
      <Group key={t} x={x} y={2} clipX={0} clipY={0} clipWidth={w} clipHeight={14}>
        <Rect width={w} height={14} cornerRadius={3} fill={fill} />
        <Text x={2.5} y={2.5} text={t} fontSize={CHIP_FONT_SIZE} letterSpacing={CHIP_SPACING} fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" fill="#e0e0e0" wrap="none" />
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
