import React, { useEffect, useRef, useState } from "react";
import Konva from "konva";
import { Group, Label, Line, Tag, Text } from "react-konva";
import type { AnyClipProps } from "@/lib/types";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { dragVolume, formatDb, lineDb, lineHeight, volumeAt, volumeLine, type WaveScale } from "@/lib/waveform";

/** How far either side of the line it can be grabbed (px). */
const REACH = 3.5;
/** What the line leaves free at either end of the clip, for its trim handles (px). */
const INSET = 5;
/** The label's size, about: "-12.5 dB" in its font. */
const LABEL_WIDTH = 44;
const LABEL_HEIGHT = 15;

/**
 * The volume line over a clip's waveform as CapCut's, to drag (Waveform draws the line itself;
 * this is its handle, lit while hovered or dragged): the cursor turns to ns-resize over it, and
 * dragged up or down it sets the clip's volume through the clip store, as the inspector's slider
 * does (lib/waveform.ts `dragVolume`: the volume, or with keys the whole curve), staying under
 * the pointer, with a label by it giving the dB. A drag is one press, so one undo step
 * (lib/history.ts). Pressing it doesn't drag the clip; its ends leave the trim handles free.
 */
export const VolumeLine: React.FC<{
  clip: AnyClipProps;
  fps: number;
  pxPerFrame: number;
  width: number;
  /** The part of the clip on screen, px from its left edge. */
  fromPx: number;
  toPx: number;
  /** The waveform's area in the clip: its top and height, and its scale. */
  y: number;
  height: number;
  scale: WaveScale;
}> = ({ clip, fps, pxPerFrame, width, fromPx, toPx, y, height, scale }) => {
  const groupRef = useRef<Konva.Group>(null);
  const [hover, setHover] = useState(false);
  const hoverRef = useRef(false);
  // While dragged: the label's text and where the pointer is (px in the clip).
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const bottom = y + height;
  const line = volumeLine(clip, { fps, pxPerFrame, fromPx: Math.max(fromPx, INSET), toPx: Math.min(toPx, width - INSET), scale, max: height });
  if (line.length < 2) return null;

  const cursor = (e: Konva.KonvaEventObject<MouseEvent>, c: string) => {
    const s = e.target.getStage()?.container();
    if (s) s.style.cursor = c;
  };

  const press = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    // The line's drag, not the clip's (its group's, which a press starts as it bubbles there).
    e.cancelBubble = true;
    const at = groupRef.current?.getRelativePointerPosition();
    if (!at) return;
    const controls = useControlsStore.getState();
    if (!controls.selectedClipIds.includes(clip.clipId)) controls.toggleClipSelection(clip.clipId, false);
    const container = e.target.getStage()?.container();
    // From the clip as it was pressed: the line follows the pointer from there.
    const start = clip;
    const from = volumeAt(start, at.x / pxPerFrame, fps);
    const h0 = lineHeight(from, scale, height);
    const [x0, y0] = [e.evt.clientX, e.evt.clientY];
    let last = from;
    // Followed in mouse events, as the press came (a pointer event's coordinates can have fractions a mouse event's don't).
    const move = (ev: MouseEvent) => {
      // Let go outside the window: the drag is over.
      if (!(ev.buttons & 1)) return stop();
      // A drag, not a click: Konva makes no click of the release (its flags, as its own drags
      // clear them), which over another clip would select it, or over the empty timeline move the
      // playhead there.
      Object.assign(Konva, { _mouseListenClick: false, _pointerListenClick: false });
      if (container) container.style.cursor = "ns-resize";
      const { patch, value } = dragVolume(start, from, lineDb(h0 + y0 - ev.clientY, scale, height));
      if (value !== last) useClipStore.getState().updateClip(start.clipId, patch);
      last = value;
      setTip({ text: formatDb(value), x: at.x + ev.clientX - x0, y: bottom - lineHeight(value, scale, height) });
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      stopRef.current = null;
      setTip(null);
      if (container) container.style.cursor = hoverRef.current ? "ns-resize" : "default";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    stopRef.current = stop;
    setTip({ text: formatDb(from), x: at.x, y: bottom - h0 });
  };

  // The label above and right of the pointer, inside the clip.
  const tipX = tip && (tip.x + 10 + LABEL_WIDTH <= width - 2 ? tip.x + 10 : Math.max(2, tip.x - 10 - LABEL_WIDTH));
  const tipY = tip && (tip.y - 6 - LABEL_HEIGHT >= 1 ? tip.y - 6 - LABEL_HEIGHT : tip.y + 6);

  return (
    <Group ref={groupRef}>
      <Line
        name="volume-line"
        clipId={clip.clipId}
        points={line.flatMap((p) => [p.x, bottom - p.h - 0.25])}
        stroke={hover || tip ? "#ffffff" : "transparent"}
        strokeWidth={1}
        hitStrokeWidth={REACH * 2}
        perfectDrawEnabled={false}
        onMouseDown={press}
        onMouseEnter={(e) => {
          hoverRef.current = true;
          setHover(true);
          cursor(e, "ns-resize");
        }}
        onMouseLeave={(e) => {
          hoverRef.current = false;
          setHover(false);
          // Still over the clip (its group's leave puts the cursor back when the pointer leaves it too).
          if (!stopRef.current) cursor(e, "pointer");
        }}
      />
      {tip && (
        <Label name="volume-label" x={tipX!} y={tipY!} listening={false}>
          <Tag fill="rgba(0, 0, 0, 0.8)" cornerRadius={3} />
          <Text text={tip.text} padding={3} fontSize={10} fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" fill="#ffffff" />
        </Label>
      )}
    </Group>
  );
};
