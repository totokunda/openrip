import React, { useCallback, useEffect, useRef } from "react";
import Konva from "konva";
import { Group, Rect, Circle, Path } from "react-konva";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useContextMenuStore } from "@/lib/context-menu";
import { cutsOn, setTransitionDuration, useTransitionDropStore } from "@/lib/transitions";
import { TIMELINE_COLORS } from "@/lib/timeline-colors";
import type { ClipTransition } from "@/lib/types";

/** The badge on a cut (px square), however short its transition. */
const BADGE = 20;
/** How far in from each side of a selected marker a press drags its duration (px). */
const EDGE = 5;
/** The app's accent (styles/index.css `--color-brand-accent`). */
const ACCENT = "#ae81ce";
/** The Transitions tab's glyph, an hourglass on its side (Tabler's hourglass-filled, 24 px). */
const GLYPH =
  "M17 2a2 2 0 0 1 1.995 1.85l.005 .15v2a6.996 6.996 0 0 1 -3.393 6a6.994 6.994 0 0 1 3.388 5.728l.005 .272v2a2 2 0 0 1 -1.85 1.995l-.15 .005h-10a2 2 0 0 1 -1.995 -1.85l-.005 -.15v-2a6.996 6.996 0 0 1 3.393 -6a6.994 6.994 0 0 1 -3.388 -5.728l-.005 -.272v-2a2 2 0 0 1 1.85 -1.995l.15 -.005h10z";

type Props = {
  timelineId: string;
  timelineWidth: number;
  timelinePadding: number;
  /** The track's band: its bottom and height (as its clips are drawn). */
  bottom: number;
  height: number;
  /** A hidden or locked track's transitions are dimmed; a locked one's can't be picked. */
  dimmed?: boolean;
  locked?: boolean;
};

/**
 * A track's transitions, as CapCut draws them: a white badge with the transition glyph on each
 * cut that has one, over a light band as wide as the transition is long (two halves either side
 * of the cut). They stay over the clips (a clip moved or trimmed is raised over its neighbours).
 * A click on the badge selects it (its inspector shows, Delete removes it, an accent ring marks
 * it), a right-click opens its menu, and the sides of a selected one drag its duration. While a
 * transition card is dragged over a cut, the cut it would go on shows in the accent.
 */
const TransitionMarkers: React.FC<Props> = ({ timelineId, timelineWidth, timelinePadding, bottom, height, dimmed, locked }) => {
  const clips = useClipStore((s) => s.clips);
  const dragging = useClipStore((s) => s.isDragging);
  const [start, end] = useControlsStore((s) => s.timelineDuration);
  const fps = useControlsStore((s) => s.fps) || 30;
  const selected = useControlsStore((s) => s.selectedTransitionId);
  const dropTarget = useTransitionDropStore((s) => s.target);
  const pxPerFrame = timelineWidth / Math.max(1, end - start);
  const xOf = (frame: number) => timelinePadding + (frame - start) * pxPerFrame;
  const top = bottom - height;
  const groupRef = useRef<Konva.Group>(null);

  // Over the clips again after each change (not while a clip is dragged: it's over everything then).
  // Only when something else is above it: the tracks' transitions raised over each other in turn
  // after every render, each move drawing the layer again.
  useEffect(() => {
    const group = groupRef.current;
    if (dragging || !group) return;
    const above = group.getParent()?.getChildren().slice(group.zIndex() + 1) ?? [];
    if (above.some((node) => node.name() !== "transition-markers")) group.moveToTop();
  });

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
    <Group ref={groupRef} name="transition-markers" opacity={dimmed ? 0.5 : 1} listening={!locked}>
      {cuts.map(({ clip, next }) => {
        const t = clip.transitionOut as ClipTransition | null | undefined;
        const target = dropTarget === clip.clipId;
        if (!t && !target) return null;
        const seconds = t?.duration ?? 0.5;
        const room = Math.min(clip.endFrame - clip.startFrame, next.endFrame - next.startFrame) * pxPerFrame;
        // The band as long as the transition (within the shorter clip), the badge on the cut.
        const w = Math.min(seconds * fps * pxPerFrame, room);
        const size = Math.max(10, Math.min(BADGE, room, height - 4));
        const span = Math.max(w, size);
        const x = xOf(clip.endFrame);
        if (x + span / 2 < timelinePadding || x - span / 2 > timelinePadding + timelineWidth) return null;
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
              if (isSelected && Math.abs(Math.abs(local) - span / 2) <= EDGE) dragSide(clip.clipId, local < 0 ? -1 : 1, t.duration, e.evt.clientX);
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
            {/* Its length. Picked only once selected (its sides drag), so the clips' edges stay at hand. */}
            <Rect
              x={-span / 2}
              y={0}
              width={span}
              height={height}
              cornerRadius={4}
              fill={target ? "rgba(174,129,206,0.35)" : isSelected ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.16)"}
              stroke={target ? ACCENT : isSelected ? "#ffffff" : "rgba(255,255,255,0.45)"}
              strokeWidth={target || isSelected ? 2 : 1}
              listening={isSelected}
            />
            {/* The seam between its halves. */}
            <Rect x={-0.75} y={2} width={1.5} height={height - 4} fill="rgba(0,0,0,0.28)" listening={false} />
            {isSelected &&
              [-1, 1].map((side) =>
                Array.from({ length: 5 }, (_, i) => (
                  <Circle key={`${side}-${i}`} x={side * (span / 2 - 3)} y={height / 2 - 6 + i * 3} radius={0.75} fill="rgba(255,255,255,0.8)" listening={false} />
                )),
              )}
            {/* The badge: white with the glyph (the accent while a card is over the cut), ringed when selected. */}
            <Rect
              name="transition-badge"
              x={-size / 2}
              y={height / 2 - size / 2}
              width={size}
              height={size}
              cornerRadius={5}
              fill={target ? ACCENT : "#ffffff"}
              stroke={isSelected && !target ? ACCENT : undefined}
              strokeWidth={isSelected && !target ? 2 : 0}
              shadowColor="#000000"
              shadowBlur={4}
              shadowOpacity={0.5}
              shadowOffsetY={1}
            />
            <Path
              y={height / 2}
              data={GLYPH}
              offsetX={12}
              offsetY={12}
              rotation={90}
              scaleX={(size * 0.6) / 24}
              scaleY={(size * 0.6) / 24}
              fill={target ? "#ffffff" : TIMELINE_COLORS.video}
              listening={false}
            />
          </Group>
        );
      })}
    </Group>
  );
};

export default TransitionMarkers;
