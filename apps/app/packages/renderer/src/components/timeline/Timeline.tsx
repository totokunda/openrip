import React, { useMemo } from "react";
import { Rect, Line, Group } from "react-konva";
import { TimelineProps } from "@/lib/types";
import { useClipStore, getTimelineX } from "@/lib/clip";
import TimelineClip from "./clips/TimelineClip";
import GhostTimeline from "./clips/GhostTimeline";
import TransitionMarkers from "./clips/TransitionMarkers";
import { useControlsStore } from "@/lib/control";
import { useContextMenuStore } from "@/lib/context-menu";
import { calculateFrameFromX } from "@/lib/zoom";
import { Rect as KonvaRect } from "konva/lib/shapes/Rect";
import {
  useAssetControlsStore,
  updateAssetZoomLevel,
} from "@/lib/assetControl";
import { canDeleteTrack } from "./TrackControls";
import { TIME_ZERO_X } from "@/lib/timeline-geometry";
import { gapAt, trackGaps } from "@/lib/timeline-edit";

// One function, so the memoised clips keep their props when no selection is passed.
const NEVER_SELECTED = (_clipId: string) => false;

const Timeline: React.FC<
  TimelineProps & {
    index: number;
    scrollY: number;
    cornerRadius?: number;
    assetMode?: boolean;
    excludeClipId?: string | null;
    isAssetSelected?: (clipId: string) => boolean;
  }
> = ({
  timelineWidth,
  timelineY,
  timelineHeight = 54,
  timelinePadding = TIME_ZERO_X,
  timelineId,
  index,
  scrollY,
  type,
  muted,
  hidden,
  cornerRadius = 1,
  assetMode = false,
  excludeClipId = null,
  isAssetSelected = NEVER_SELECTED,
}) => {


  const { hoveredTimelineId, getClipsForTimeline } = useClipStore();
  const hiddenRectRef = React.useRef<KonvaRect>(null);
  const lockedRectRef = React.useRef<KonvaRect>(null);
  const locked = useClipStore((s) => !!s.getTimelineById(timelineId)?.locked);

  const clipsAll = getClipsForTimeline(timelineId);
  const clips = useMemo(() => {
    if (!excludeClipId) return clipsAll;
    return clipsAll.filter((c) => c.clipId !== excludeClipId);
  }, [clipsAll, excludeClipId]);
  // Stable signature to detect only meaningful clip-set changes (global across all timelines)
  const allClips = useClipStore((s) => s.clips);
  const allVisibleClips = useMemo(
    () => allClips.filter((c) => !c.hidden),
    [allClips],
  );

  const allClipsSignature = useMemo(() => {
    if (!allVisibleClips || allVisibleClips.length === 0) return "0:0";
    let longest = 0;
    for (let i = 0; i < allVisibleClips.length; i++) {
      const end = Math.max(0, allVisibleClips[i].endFrame || 0);
      if (end > longest) longest = end;
    }
    return `${allVisibleClips.length}:${longest}`;
  }, [allVisibleClips]);
  const clipDuration = useClipStore((s) => s.clipDuration);

  const ctrlTimelineDuration = useControlsStore((s) => s.timelineDuration);
  const assetTimelineDuration = useAssetControlsStore((s) => s.timelineDuration);
  const timelineDuration = assetMode ? assetTimelineDuration : ctrlTimelineDuration;

  const renderedTimelineHeight = useMemo(() => {
    return timelineHeight - 8;
  }, [timelineHeight]);

  // Compute exact edges of the visible timeline rect
  const timelineTopY = (timelineY ?? 0) + 32;
  const timelineBottomY = timelineTopY + renderedTimelineHeight;

  // Timelines are spaced by their full height but rects are 8px shorter, creating an 8px gap
  const gapBetweenTimelines = 8;
  // Hover target spans the full gap for easy interaction
  const underGroupHeight = gapBetweenTimelines;

  // Position groups so the line (drawn at underGroupHeight/2) sits exactly in the middle of the gap
  const topDashGroupY =
    timelineTopY - gapBetweenTimelines / 2 - underGroupHeight / 2;
  const bottomDashGroupY =
    timelineBottomY + gapBetweenTimelines / 2 - underGroupHeight / 2;

  const timelineX = useMemo(
    () => getTimelineX(timelineWidth!, timelinePadding, timelineDuration),
    [timelineWidth, timelinePadding, timelineDuration],
  );

  // When viewing in assetMode, calibrate baseline/zoom from ALL visible clips once (top row only)
  React.useEffect(() => {
    if (!assetMode || index !== 0) return;
    updateAssetZoomLevel(allVisibleClips, clipDuration);
  }, [assetMode, index, allClipsSignature]);

  // Ensure the hidden/disabled overlay rect always stays on top visually
  React.useEffect(() => {
    if (hiddenRectRef.current || lockedRectRef.current) {
      setTimeout(() => {
        hiddenRectRef.current?.moveToTop();
        lockedRectRef.current?.moveToTop();
        hiddenRectRef.current?.getLayer()?.batchDraw();
      }, 100);
    }
  }, [hidden, muted, type, locked]);



  
  return (
    <>
      {index === 0 && (
        <Group
          id={`dashed-${timelineId}-top`}
          name={"timeline-dashed"}
          height={underGroupHeight}
          x={timelinePadding}
          y={topDashGroupY}
        >
          <Line
            points={[
              0,
              underGroupHeight / 2,
              timelineWidth!,
              underGroupHeight / 2,
            ]}
            stroke={"rgba(255, 255, 255, 0.75)"}
            strokeWidth={
              hoveredTimelineId === `dashed-${timelineId}-top` ? 1.2 : 0
            }
          />
        </Group>
      )}
      <Rect
        id={timelineId}
        x={timelineX}
        y={timelineY! + 32}
        cornerRadius={4}
        width={Math.max(0, timelineWidth! - timelineX + 8)}
        height={renderedTimelineHeight}
        fill={"rgba(11, 11, 13, 0.25)"}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          const stage = e.target.getStage();
          const pos = stage?.getPointerPosition();
          if (!pos) return;
          const [startFrame, endFrame] = timelineDuration;
          const innerWidth = timelineWidth!; // stage width used in calculateFrameFromX expects total stage width
          const frame = calculateFrameFromX(
            pos.x,
            timelinePadding,
            innerWidth,
            [startFrame, endFrame],
          );
          const progress = Math.max(
            0,
            Math.min(1, (pos.x - timelinePadding) / Math.max(1, innerWidth)),
          );
          if (assetMode) {
            useAssetControlsStore.getState().setFocusAnchorRatio(progress);
            useAssetControlsStore.getState().setFocusFrame(frame);
          } else {
            useControlsStore.getState().setFocusAnchorRatio(progress);
            useControlsStore.getState().setFocusFrame(frame, false);
          }
          const store = useClipStore.getState();
          const track = store.getTimelineById(timelineId);
          useContextMenuStore.getState().openMenu({
            position: { x: e.evt.clientX, y: e.evt.clientY },
            target: { type: "timeline", timelineId },
            groups: [
              // CapCut's empty-space menu: the gap under the mouse, every gap on the track, and
              // the track's clips.
              {
                id: "gaps",
                items: [
                  {
                    id: "close-gap",
                    label: "Close gap",
                    action: "custom",
                    disabled: !!track?.locked || !gapAt(store.clips, timelineId, frame),
                    run: () => void useClipStore.getState().closeGap(timelineId, frame),
                  },
                  {
                    id: "close-all-gaps",
                    label: "Close all gaps",
                    action: "custom",
                    disabled: !!track?.locked || trackGaps(store.clips, timelineId).length === 0,
                    run: () => void useClipStore.getState().closeGap(timelineId, null),
                  },
                ],
              },
              {
                id: "select",
                items: [
                  {
                    id: "select-track",
                    label: "Select",
                    action: "custom",
                    disabled: !!track?.locked || !store.clips.some((c) => c.timelineId === timelineId && !c.hidden),
                    // Every clip on the track.
                    run: () =>
                      useControlsStore.getState().setSelectedClipIds(
                        useClipStore.getState().clips.filter((c) => c.timelineId === timelineId && !c.hidden).map((c) => c.clipId),
                      ),
                  },
                ],
              },
              {
                id: "edit",
                items: [
                  {
                    id: "paste",
                    label: "Paste at Playhead",
                    action: "paste",
                    shortcut: "⌘V",
                    disabled: !!track?.locked,
                  },
                ],
              },
              {
                id: "track",
                items: [
                  track?.locked
                    ? { id: "unlock", label: "Unlock track", action: "unlockTrack" }
                    : { id: "lock", label: "Lock track", action: "lockTrack" },
                  {
                    id: "delete",
                    label: "Delete track",
                    action: "deleteTrack",
                    disabled: !track || !canDeleteTrack(store.timelines, track),
                  },
                ],
              },
            ],
          });
        }}
      />
      {clips.map((clip) => (
        <TimelineClip
          key={clip.clipId}
          muted={muted}
          hidden={assetMode ? false : hidden}
          cornerRadius={cornerRadius}
          timelineId={timelineId}
          clipId={clip.clipId}
          timelinePadding={timelinePadding}
          timelineWidth={timelineWidth}
          timelineY={timelineBottomY}
          timelineHeight={renderedTimelineHeight}
          clipType={clip.type}
          type={type}
          scrollY={scrollY}
          isAssetSelected={isAssetSelected}
          assetMode={assetMode}
        />
      ))}
      {/* The transitions on the track's cuts, over its clips. */}
      {!assetMode && (
        <TransitionMarkers
          timelineId={timelineId}
          timelineWidth={timelineWidth!}
          timelinePadding={timelinePadding}
          bottom={timelineBottomY}
          height={renderedTimelineHeight}
          dimmed={hidden || !!locked}
          locked={!!locked}
        />
      )}
      <GhostTimeline
        timelineId={timelineId}
        timelineY={timelineBottomY}
        timelineHeight={renderedTimelineHeight}
        timelinePadding={timelinePadding}
        timelineWidth={timelineWidth}
        type={type}
        muted={muted}
        hidden={assetMode ? false : hidden}
      />
      <Group
        id={`dashed-${timelineId}`}
        name={"timeline-dashed"}
        height={underGroupHeight}
        x={timelinePadding}
        y={bottomDashGroupY}
      >
        <Line
          points={[
            0,
            underGroupHeight / 2,
            timelineWidth!,
            underGroupHeight / 2,
          ]}
          stroke={"rgba(255, 255, 255, 0.75)"}
          strokeWidth={hoveredTimelineId === `dashed-${timelineId}` ? 1.2 : 0}
        />
      </Group>
      {(!assetMode && (hidden || (muted && type === "audio"))) && (
        <Rect
          ref={hiddenRectRef}
          id={`hidden-${timelineId}`}
          x={timelineX}
          y={timelineY! + 32}
          cornerRadius={0}
          width={Math.max(0, timelineWidth! - timelineX + 8)}
          height={timelineHeight - 8}
          fill={"rgba(11, 11, 13, 0.60)"}
        />
      )}
      {/* A locked track: its clips are dimmed, and clicks go through to the track's menu. */}
      {!assetMode && locked && (
        <Rect
          ref={lockedRectRef}
          id={`locked-${timelineId}`}
          x={timelineX}
          y={timelineY! + 32}
          width={Math.max(0, timelineWidth! - timelineX + 8)}
          height={timelineHeight - 8}
          fill={"rgba(11, 11, 13, 0.45)"}
          listening={false}
        />
      )}
    </>
  );
};

export default Timeline;
