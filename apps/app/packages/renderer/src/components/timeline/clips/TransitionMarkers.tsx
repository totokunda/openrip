import React, { useCallback } from "react";
import Konva from "konva";
import { Group, Rect, Circle } from "react-konva";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useContextMenuStore } from "@/lib/context-menu";
import { cutsOn, setTransitionDuration, useTransitionDropStore } from "@/lib/transitions";
import type { ClipTransition } from "@/lib/types";

/** The narrowest a marker is drawn (px), however short its transition. */
const MIN_WIDTH = 14;
/** How far in from each side of a selected marker a press drags its duration (px). */
const EDGE = 5;

type Props = {
  timelineId: string;
  timelineWidth: number;
  timelinePadding: number;
  /** The track's band: its bottom and height (as its clips are drawn). */
  bottom: number;
  height: number;
};

/**
 * A track's transitions, as CapCut draws them: a translucent light handle over each cut that
 * has one, as wide as the transition is long (two halves either side of the cut). A click
 * selects it (its inspector shows, Delete removes it), a right-click opens its menu, and the
 * sides of a selected one drag its duration. While a transition card is dragged over a cut, the
 * cut shows where it would go.
 */
const TransitionMarkers: React.FC<Props> = ({ timelineId, timelineWidth, timelinePadding, bottom, height }) => {
  const clips = useClipStore((s) => s.clips);
  const [start, end] = useControlsStore((s) => s.timelineDuration);
  const fps = useControlsStore((s) => s.fps) || 30;
  const selected = useControlsStore((s) => s.selectedTransitionId);
  const dropTarget = useTransitionDropStore((s) => s.target);
  const pxPerFrame = timelineWidth / Math.max(1, end - start);
  const xOf = (frame: number) => timelinePadding + (frame - start) * pxPerFrame;
  const top = bottom - height;

  // Dragging a side: the duration follows the pointer, both halves moving together.
  const dragSide = useCallback(
    (clipId: string, side: -1 | 1, from: number, startX: number) => {
      const move = (e: MouseEvent) => {
        const seconds = from + (2 * side * (e.clientX - startX)) / (pxPerFrame * fps);
        setTransitionDuration(clipId, seconds);
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [pxPerFrame, fps],
  );

  const cuts = cutsOn(clips, timelineId);
  return (
    <Group>
      {cuts.map(({ clip, next }) => {
        const t = clip.transitionOut as ClipTransition | null | undefined;
        const target = dropTarget === clip.clipId;
        if (!t && !target) return null;
        const seconds = t?.duration ?? 0.5;
        const room = Math.min(clip.endFrame - clip.startFrame, next.endFrame - next.startFrame) * pxPerFrame;
        const w = Math.max(Math.min(MIN_WIDTH, room), Math.min(seconds * fps * pxPerFrame, room));
        const x = xOf(clip.endFrame);
        if (x + w / 2 < timelinePadding || x - w / 2 > timelinePadding + timelineWidth) return null;
        const isSelected = selected === clip.clipId;
        const select = (e: Konva.KonvaEventObject<MouseEvent>) => {
          e.cancelBubble = true;
          useControlsStore.getState().setSelectedTransitionId(clip.clipId);
        };
        return (
          <Group
            key={clip.clipId}
            name="transition-marker"
            x={x}
            y={top}
            onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "pointer")}
            onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "default")}
            onMouseDown={(e) => {
              e.cancelBubble = true;
              if (!t) return;
              // A press on a selected marker's side drags its duration.
              const local = e.target.getStage()!.getPointerPosition()!.x - x;
              if (isSelected && Math.abs(Math.abs(local) - w / 2) <= EDGE) dragSide(clip.clipId, local < 0 ? -1 : 1, t.duration, e.evt.clientX);
            }}
            onClick={select}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              if (!t) return;
              useControlsStore.getState().setSelectedTransitionId(clip.clipId);
              useContextMenuStore.getState().openMenu({
                position: { x: e.evt.clientX, y: e.evt.clientY },
                target: { type: "transition", clipId: clip.clipId },
                groups: [{ id: "edit", items: [{ id: "delete", label: "Delete", action: "deleteTransition", shortcut: "⌫" }] }],
              });
            }}
          >
            <Rect x={-w / 2} y={0} width={w} height={height} cornerRadius={3} fill={target ? "rgba(174,129,206,0.55)" : "rgba(205,220,222,0.62)"} />
            {/* The seam between its halves. */}
            <Rect x={-0.75} y={2} width={1.5} height={height - 4} fill="rgba(0,0,0,0.28)" listening={false} />
            {(isSelected || target) && (
              <Rect x={-w / 2} y={0} width={w} height={height} cornerRadius={3} stroke={target ? "#ae81ce" : "#ffffff"} strokeWidth={2} listening={false} />
            )}
            {isSelected &&
              [-1, 1].map((side) =>
                Array.from({ length: 5 }, (_, i) => (
                  <Circle key={`${side}-${i}`} x={side * (w / 2 - 3)} y={height / 2 - 6 + i * 3} radius={0.75} fill="rgba(255,255,255,0.8)" listening={false} />
                )),
              )}
          </Group>
        );
      })}
    </Group>
  );
};

export default TransitionMarkers;
