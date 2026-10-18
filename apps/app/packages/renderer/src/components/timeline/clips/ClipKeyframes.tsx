import React from "react";
import { Group, Line } from "react-konva";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useContextMenuStore } from "@/lib/context-menu";
import { keyframeFrames } from "@/lib/keyframes";
import { EASE_PRESETS, easeAt, moveKeysAt, useKeyframeGraphStore } from "@/lib/timeline-keyframes";
import type { AnyClipProps } from "@/lib/types";

/** CapCut's diamond: 9 px across. */
const SIZE = 9;
/** Diamonds closer than this (px) at the current zoom are drawn as one. */
const MIN_GAP = 4;

type Props = {
  clip: AnyClipProps;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The selected clip's keyframes on its bar, as CapCut draws them: a diamond in the accent at
 * each keyed frame (one for all the properties keyed there), the one under the playhead ringed
 * in white. A click moves the playhead to it; a drag moves its keys along the clip (whole
 * frames); a right-click deletes them or sets the ease after them.
 */
const ClipKeyframes: React.FC<Props> = ({ clip, x, y, width, height }) => {
  const updateClip = useClipStore((s) => s.updateClip);
  const start = clip.startFrame ?? 0;
  const length = Math.max(1, (clip.endFrame ?? 0) - start);
  const pxPerFrame = width / length;
  // Only whether the playhead is on a key re-renders this, not each frame of playback.
  const frames = keyframeFrames(clip.keyframes).filter((f) => f >= 0 && f <= length);
  const atPlayhead = useControlsStore((s) => frames.find((f) => Math.abs(start + f - s.focusFrame) < 0.5) ?? null);
  if (!frames.length) return null;
  const cy = y + height / 2;
  const shown: number[] = [];
  for (const f of frames) {
    if (!shown.length || (f - shown[shown.length - 1]) * pxPerFrame >= MIN_GAP || f === atPlayhead) shown.push(f);
  }
  const points = [0, -SIZE / 2, SIZE / 2, 0, 0, SIZE / 2, -SIZE / 2, 0];

  return (
    <Group name="clip-keyframes">
      {shown.map((frame) => {
        const fx = x + frame * pxPerFrame;
        return (
          <Line
            key={frame}
            name="keyframe-diamond"
            x={fx}
            y={cy}
            points={points}
            closed
            fill="#ae81ce"
            stroke={frame === atPlayhead ? "#ffffff" : "#141414"}
            strokeWidth={frame === atPlayhead ? 1.5 : 1}
            hitStrokeWidth={6}
            draggable
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onDragMove={(e) => {
              // Along the clip, on whole frames.
              const node = e.target;
              const f = Math.round(Math.max(0, Math.min(length, (node.x() - x) / pxPerFrame)));
              node.x(x + f * pxPerFrame);
              node.y(cy);
            }}
            onDragEnd={(e) => {
              const to = Math.round(Math.max(0, Math.min(length, (e.target.x() - x) / pxPerFrame)));
              if (to !== frame) updateClip(clip.clipId, { keyframes: moveKeysAt(clip.keyframes, frame, to) });
              useControlsStore.getState().setFocusFrame(start + to);
            }}
            onClick={(e) => {
              e.cancelBubble = true;
              useControlsStore.getState().setFocusFrame(Math.round(start + frame));
            }}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              const ease = easeAt(clip.keyframes, frame);
              useContextMenuStore.getState().openMenu({
                position: { x: e.evt.clientX, y: e.evt.clientY },
                target: { type: "keyframe", clipId: clip.clipId, frame },
                groups: [
                  { id: "ease", items: EASE_PRESETS.map((p) => ({ id: `ease-${p.value}`, label: p.label, action: "keyframeEase" as const, value: p.value, checked: ease === p.value })) },
                  {
                    id: "edit",
                    items: [
                      { id: "keyframe-graph", label: useKeyframeGraphStore.getState().open ? "Hide keyframe graph" : "Keyframe graph", action: "keyframeGraph", shortcut: "⌥K" },
                      { id: "delete-keyframe", label: "Delete keyframe", action: "deleteKeyframe" },
                    ],
                  },
                ],
              });
            }}
            onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "pointer")}
            onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "default")}
          />
        );
      })}
    </Group>
  );
};

export default ClipKeyframes;
