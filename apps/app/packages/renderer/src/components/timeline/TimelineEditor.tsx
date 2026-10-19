import { getZoomLevelConfig } from "@/lib/zoom";
import { useControlsStore } from "@/lib/control";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Stage, Layer, Text, Line, Rect, Group } from "react-konva";
import Konva from "konva";
import { ScrubControl } from "./Scrubber";
import Timeline from "./Timeline";
import {
  useClipStore,
  getClipWidth,
  getClipX,
  isValidTimelineForClip,
  getTimelineTypeForClip,
  getTimelineHeightForClip,
} from "@/lib/clip";
import { GoFileMedia } from "react-icons/go";
import Droppable from "../dnd/Droppable";
import { useDndMonitor } from "@dnd-kit/core";
import { MediaItem } from "../media/Item";
import { v4 as uuidv4 } from "uuid";
import {
  AnyClipProps,
  Asset,
  Filter,
  FilterClipProps,
  ImageClipProps,
  VideoClipProps,
} from "@/lib/types";
import TimelineSidebar from "./TimelineSidebar";
import Scrollbar from "./Scrollbar";
import { useWebGLHaldClut } from "../preview/webgl-filters";
import { ensureFullMediaStats } from "@/lib/media/utils";
import { convertFrameRange } from "@/lib/media/fps";
import { useViewportStore } from "@/lib/viewport";
import { insertionFrame, mainTrackOf, mainTrackPreview } from "@/lib/timeline-edit";
import { MarkerEditor, MarkerFlags } from "./Markers";
import { RULER_HEIGHT, TIME_ZERO_X } from "@/lib/timeline-geometry";
import { applyTransition, cutsOn, useTransitionDropStore } from "@/lib/transitions";
import type { TransitionDrag } from "../menus/TransitionMenu";
import { addLibraryShape, type ShapeDrag } from "../menus/ShapesMenu";
import KeyframeGraph from "./KeyframeGraph";
import { imageDurationFrames } from "@/lib/preferences";
import { openCoverEditor } from "@/lib/cover";

interface TimelineEditorProps {}

interface TimelineMomentsProps {
  stageWidth: number;
  startPadding: number;
  maxScroll: number;
  thumbY: () => number;
  onRulerClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}

interface TickMark {
  x: number;
  text: string;
  type: "major" | "minor";
  format: "frame" | "second";
}

const SCROLLBAR_HW = 8;
const SCROLL_BOTTOM_PADDING = 48; // extra space at bottom for easier drag-in

const getMajorZoomConfigFormat = (
  zoomConfig: {
    majorTickFormat: "frame" | "second";
    minorTickFormat: "frame" | "second";
  },
  fps: number,
  frameInterval: number,
) => {
  if (zoomConfig.majorTickFormat == "second") {
    return "second";
  } else if (
    zoomConfig.majorTickFormat == "frame" &&
    frameInterval % fps == 0
  ) {
    return "second";
  } else {
    return "frame";
  }
};

const TimelineMoments: React.FC<TimelineMomentsProps> = React.memo(
  ({ stageWidth, startPadding, maxScroll, thumbY, onRulerClick }) => {
    const {
      timelineDuration,
      fps,
      zoomLevel,
      focusFrame,
      shiftTimelineDuration,
      maxZoomLevel,
      minZoomLevel,
    } = useControlsStore();
    const [startFrame, endFrame] = timelineDuration;

    // We will basically render from startDuration to startDuration + duration.
    useEffect(() => {
      // ensure focusframe is always within the timeline duration
      if (focusFrame < startFrame) {
        shiftTimelineDuration(focusFrame - startFrame);
      }
      if (focusFrame > endFrame) {
        let duration = endFrame - startFrame;
        const additionalDuration =
          duration + endFrame > focusFrame ? 0 : focusFrame - endFrame;
        shiftTimelineDuration(duration + additionalDuration);
      }
    }, [startFrame, endFrame, focusFrame]);
    // Convert duration to milliseconds if needed for consistent calculations
    const tickMark: TickMark[] = useMemo(() => {
      let ticks: TickMark[] = [];
      const zoomConfig = getZoomLevelConfig(
        zoomLevel,
        timelineDuration,
        fps,
        maxZoomLevel,
        minZoomLevel,
      );
      const majorTickInterval =
        zoomConfig.majorTickInterval *
        (zoomConfig.majorTickFormat === "second" ? fps : 1);
      const minorTickInterval =
        zoomConfig.minorTickInterval *
        (zoomConfig.minorTickFormat === "second" ? fps : 1);
      const [startFrame, endFrame] = timelineDuration;

      for (let i = startFrame; i <= endFrame; i += majorTickInterval) {
        ticks.push({
          x: Math.round(i),
          text: Math.round(i).toString(),
          type: "major",
          format: getMajorZoomConfigFormat(zoomConfig, fps, majorTickInterval),
        });
      }

      for (let i = startFrame; i <= endFrame; i += minorTickInterval) {
        ticks.push({
          x: Math.round(i),
          text: Math.round(i).toString(),
          type: "minor",
          format: zoomConfig.minorTickFormat,
        });
      }
      ticks.sort((a, b) => a.x - b.x);
      // remove duplicates where x is the same and minor is true
      ticks = ticks.filter(
        (tick, index, self) =>
          index === 0 || tick.x !== self[index - 1].x || tick.type !== "minor",
      );

      return ticks;
    }, [timelineDuration, zoomLevel, fps]);

    // Helper function to format tick labels
    const formatTickLabel = (
      value: number,
      format: "frame" | "second",
    ): string => {
      if (format === "frame") {
        return `${value}f`;
      } else {
        // Convert frames to seconds
        const seconds = value / fps;
        const totalSeconds = Math.floor(seconds);
        const minutes = Math.floor(totalSeconds / 60);
        const remainingSeconds = totalSeconds % 60;
        return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
      }
    };

    return (
      <>
        <Rect
          x={0}
          y={0}
          width={stageWidth}
          height={RULER_HEIGHT}
          // Ensure the ruler area always captures clicks (even when transparent),
          // so seeking works while vertically scrolled and clips are under it.
          fill={
            maxScroll > 0 && thumbY() > 24 ? "#262626" : "rgba(0,0,0,0)"
          }
          listening
          onClick={onRulerClick}
        />
        {tickMark.map((tick, index) => {
          // Calculate x position based on timeline progress
          const progress = (tick.x - startFrame) / (endFrame - startFrame);
          const xPosition = progress * stageWidth;

          // Only render ticks that are visible on screen
          if (xPosition < -50 || xPosition > stageWidth + 50) {
            return null;
          }

          // CapCut's ruler: 10.5 px majors with their label beside them, 5.5 px minors.
          const isMajor = tick.type === "major";
          const tickHeight = isMajor ? 10.5 : 5.5;
          const tickY = 0;

          return (
            <React.Fragment key={`${tick.x}-${tick.type}-${index}`}>
              {/* Tick line */}
              <Line
                points={[
                  xPosition + startPadding,
                  tickY,
                  xPosition + startPadding,
                  tickY + tickHeight,
                ]}
                stroke={isMajor ? "#727272" : "#404040"}
                strokeWidth={1}
                listening={false}
              />

              {/* Label for major ticks only */}
              {isMajor && (
                <Text
                  x={xPosition + 4 + startPadding}
                  y={tickY + 2}
                  text={formatTickLabel(tick.x, tick.format)}
                  fontSize={10.5}
                  fill="#6c6c6c"
                  fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
                  listening={false}
                />
              )}
            </React.Fragment>
          );
        })}
      </>
    );
  },
);

/**
 * CapCut's Cover tile, in the column between the track headers and time 0 on the main track:
 * a dashed rounded tile with "Cover" in it. A click opens the cover editor (lib/cover.ts).
 */
const CoverTile: React.FC<{ top: number; height: number }> = ({ top, height }) => {
  const size = Math.max(0, Math.min(42, height - 4, TIME_ZERO_X - 8));
  const [hover, setHover] = useState(false);
  if (size < 20) return null;
  const stop = (e: Konva.KonvaEventObject<Event>) => {
    // The tile is not part of the timeline: no seek, no selection.
    e.cancelBubble = true;
  };
  const cursor = (e: Konva.KonvaEventObject<MouseEvent>, value: string) => {
    const c = e.target.getStage()?.container();
    if (c) c.style.cursor = value;
  };
  return (
    <Group
      name="cover-tile"
      x={(TIME_ZERO_X - size) / 2}
      y={top + (height - size) / 2}
      opacity={hover ? 1 : 0.85}
      onMouseDown={stop}
      onTouchStart={stop}
      onClick={(e) => {
        stop(e);
        openCoverEditor();
      }}
      onTap={(e) => {
        stop(e);
        openCoverEditor();
      }}
      onMouseEnter={(e) => {
        setHover(true);
        cursor(e, "pointer");
      }}
      onMouseLeave={(e) => {
        setHover(false);
        cursor(e, "");
      }}
    >
      <Rect width={size} height={size} cornerRadius={4} fill={hover ? "#454545" : "#3b3b3b"} stroke="#5c5c5c" strokeWidth={1} dash={[3, 2]} />
      <Text
        width={size}
        y={size / 2 - 5.5}
        text="Cover"
        align="center"
        fontSize={11}
        fill="#cccccc"
        fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
        listening={false}
      />
    </Group>
  );
};

const TimelineEditor: React.FC<TimelineEditorProps> = React.memo(() => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Dev-only: if timeline HMR updates "stick" visually (react-konva/Electron), we remount the Stage.
  const [hmrStageKey, setHmrStageKey] = useState(0);
  // Always mount timeline elements; avoid conditional unmounts that can
  // cause rendering glitches in Tauri's WebView. Toggle visibility via data.

  const controlStore = useControlsStore();
  const {
    clips,
    timelines,
    addTimeline,
    addClip,
    setGhostStartEndFrame,
    setGhostX,
    setGhostTimelineId,
    setActiveMediaItem,
    setGhostInStage,
    setHoveredTimelineId,
    hoveredTimelineId,
    snapGuideX,
    setIsDragging,
    addAsset
  } = useClipStore();
  // const scrollBarRef = useRef<any>(null);
  // const isSyncingScrollRef = useRef(false);
  const [isRulerDragging, setIsRulerDragging] = useState(false);
  const panStateRef = useRef({
    startX: 0,
    lastX: 0,
    startFrame: 0,
    fractionalFrames: 0,
  });
  const wheelRemainderRef = useRef(0);
  // While media is dragged over the main track with the magnet on: the point it would go in at.
  const insertAtRef = useRef<number | null>(null);
  const timelinesLayerRef = useRef<Konva.Layer | null>(null);
  const haldClutRef = useWebGLHaldClut();
  const [verticalScroll, setVerticalScroll] = useState(0);
  const verticalScrollRef = useRef(0);
  const [isScrollbarHovered, setIsScrollbarHovered] = useState(false);
  const [canScrollHorizontal, setCanScrollHorizontal] = useState(false);
  const { totalTimelineFrames, timelineDuration } = useControlsStore();

  useEffect(() => {
    if (!import.meta.hot) return;
    const onTimelineHmr = () => setHmrStageKey((k) => k + 1);
    import.meta.hot.on("apex:timeline-hmr", onTimelineHmr);
    return () => {
      import.meta.hot?.off("apex:timeline-hmr", onTimelineHmr);
    };
  }, []);

  useEffect(() => {
    const [startFrame, endFrame] = timelineDuration;
    const totalDuration = endFrame - startFrame;
    if (totalDuration < totalTimelineFrames) {
      setCanScrollHorizontal(true);
    } else {
      setCanScrollHorizontal(false);
    }
  }, [totalTimelineFrames, timelineDuration]);

  const getBoundsForTimeline = (timelineId: string) => {
    const timeline = timelines.find((t) => t.timelineId === timelineId);
    if (!timeline) return 8;
    if (timeline.type === "media") return 16;
    return 8;
  };

  // A transition card dragged from the Transitions tab: the cut under the pointer (on the track
  // under it, the nearest cut within 24 px), by the id of the clip leaving it.
  const cutUnder = (event: { activatorEvent: Event | null; delta: { x: number; y: number } }): string | null => {
    const start = event.activatorEvent as PointerEvent | null;
    const el = containerRef.current;
    if (!start || !el || typeof start.clientX !== "number") return null;
    const r = el.getBoundingClientRect();
    const x = start.clientX + event.delta.x - r.left;
    const y = start.clientY + event.delta.y - r.top + clampedScroll;
    const track = timelines.find((t) => y >= (t.timelineY ?? 0) + 32 && y <= (t.timelineY ?? 0) + (t.timelineHeight ?? 0) + 24);
    if (!track || x < 0 || x > r.width) return null;
    const [vs, ve] = controlStore.timelineDuration;
    const perPx = (ve - vs) / Math.max(1, dimensions.stageWidth);
    const frame = vs + (x - TIME_ZERO_X) * perPx;
    let best: string | null = null;
    let gap = 24 * perPx;
    for (const { clip } of cutsOn(clips, track.timelineId)) {
      const d = Math.abs(clip.endFrame - frame);
      if (d <= gap) [best, gap] = [clip.clipId, d];
    }
    return best;
  };

  // A shape tile from Stickers ▸ Shapes dropped on the timeline: the frame under the pointer
  // (null when it's let go elsewhere).
  const frameUnder = (event: { activatorEvent: Event | null; delta: { x: number; y: number } }): number | null => {
    const start = event.activatorEvent as PointerEvent | null;
    const el = containerRef.current;
    if (!start || !el || typeof start.clientX !== "number") return null;
    const r = el.getBoundingClientRect();
    const cx = start.clientX + event.delta.x;
    const cy = start.clientY + event.delta.y;
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
    const [vs, ve] = controlStore.timelineDuration;
    const perPx = (ve - vs) / Math.max(1, dimensions.stageWidth);
    return Math.max(0, Math.round(vs + (cx - r.left - TIME_ZERO_X) * perPx));
  };

  useDndMonitor({
    onDragStart: (event) => {
      const data = event.active?.data?.current as unknown as
        | MediaItem
        | undefined;
      if (!data || (data as unknown as TransitionDrag).type === "transition" || (data as unknown as ShapeDrag).type === "shape-preset") return;

      setIsDragging(true);

      const mediaInfo = (data as MediaItem).mediaInfo;
      setActiveMediaItem(data as MediaItem);
      const clipFrames = (() => {
        const fps = controlStore.fps;
        // Settings › Edit › Image duration.
        if (data.type === "image") return imageDurationFrames(fps);
        if (data.type === "video") {
          const realFps = mediaInfo?.stats.video?.averagePacketRate ?? fps;
          const realEnd = (mediaInfo?.duration ?? 0) * realFps;
          const { end: endFrameReal } = convertFrameRange(
            0,
            realEnd,
            realFps,
            fps,
          );
          return endFrameReal;
        }
        if (data.type === "audio") {
          return Math.round((mediaInfo?.duration ?? 0) * fps);
        }
        if (data.type === "filter") {
          return Math.round(fps * controlStore.defaultClipLength);
        }
        return 0;
      })();
      setGhostStartEndFrame(0, clipFrames);
    },
    onDragMove: (event) => {
      const container = containerRef.current;
      let pointerX: number | null = null;
      let pointerY: number | null = null;
      const data = event.active?.data?.current as unknown as
        | MediaItem
        | undefined;

      if (clips.length === 0) return;
      if ((data as unknown as TransitionDrag)?.type === "transition") {
        useTransitionDropStore.getState().setTarget(cutUnder(event));
        return;
      }

      if (container) {
        const rect = container.getBoundingClientRect();
        const activeRect =
          (event as any)?.active?.rect?.current?.translated ||
          (event as any)?.active?.rect?.current;
        if (activeRect) {
          const centerX = (activeRect.left ?? 0) + (activeRect.width ?? 0) / 2;
          const centerY = (activeRect.top ?? 0) + (activeRect.height ?? 0) / 2;
          pointerX = centerX - rect.left;
          pointerY = centerY - rect.top;
        }
      }

      if (pointerX == null || pointerY == null) {
        return;
      }

      // Edge auto-scroll for external DnD moves
      edgeAutoScroll(pointerY);

      if (
        data?.type === "image" ||
        data?.type === "video" ||
        data?.type === "audio" ||
        data?.type === "filter"
      ) {
        handleDragMove(data as MediaItem, pointerY, pointerX);
      }
    },
    onDragEnd: (event) => {
      const data = event.active?.data?.current as unknown as
        | MediaItem
        | undefined;

      if (!data) {
        setIsDragging(false);
        return;
      }
      // A transition dropped on a cut goes onto it (a press without a move is the card's click,
      // which the Transitions tab handles).
      const drag = data as unknown as TransitionDrag;
      if (drag.type === "transition") {
        const target = Math.hypot(event.delta.x, event.delta.y) > 3 ? cutUnder(event) : null;
        useTransitionDropStore.getState().setTarget(null);
        if (target) applyTransition(target, drag.transition);
        return;
      }
      // A shape goes in at the time it's let go at, on a new track at the top (the Shapes
      // tab handles a press without a move, and a drop on the player).
      const shapeDrag = data as unknown as ShapeDrag;
      if (shapeDrag.type === "shape-preset") {
        const frame = Math.hypot(event.delta.x, event.delta.y) > 3 ? frameUnder(event) : null;
        if (frame != null) void addLibraryShape(shapeDrag.shape, { startFrame: frame });
        setIsDragging(false);
        return;
      }

      if (
        data?.type === "image" ||
        data?.type === "video" ||
        data?.type === "audio" ||
        data?.type === "filter"
      ) {
        handleDrop(event, data);
      }

      setIsDragging(false);
    },
    // A drag given up (Escape): the main track goes back to how it is.
    onDragCancel: () => {
      useTransitionDropStore.getState().setTarget(null);
      insertAtRef.current = null;
      useClipStore.getState().setMainPreview(null);
      setGhostTimelineId(null);
      setGhostInStage(false);
      setIsDragging(false);
    },
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Throttle resize updates to improve performance
    let timeoutId: NodeJS.Timeout;
    const observer = new ResizeObserver((entries) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }, 16); // ~60fps throttle
    });

    observer.observe(el);
    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, []);

  // A track an edit leaves empty is removed by the store, in the same edit (withTimelineRules
  // in lib/clip.ts): one undo step, and a track added empty stays until it's used.

  // Memoize dimensions to prevent unnecessary recalculations
  const dimensions = useMemo(() => {
    const stageWidth = Math.max(1, size.width);
    const stageHeight = Math.max(1, size.height);
    const dropZonePadding = 24;
    const dropZoneHeight = 80;
    const dropZoneX = dropZonePadding;
    const dropZoneY = Math.max(0, stageHeight / 2 - dropZoneHeight / 2);
    const dropZoneWidth = Math.max(0, stageWidth - dropZonePadding * 2);

    return {
      stageWidth,
      stageHeight,
      dropZoneX,
      dropZoneY,
      dropZoneWidth,
      dropZoneHeight,
    };
  }, [size.width, size.height]);

  const handleDragMove = useCallback(
    (data: MediaItem | undefined, pointerY: number, pointerX: number) => {
      if (!data) return;
      // Record last pointer X for later use on drop when creating a new timeline via dashed hover
      try {
        (window as any).__apex_lastPointerX = pointerX;
      } catch {}
      // check if the pointer is over a dashed line
      const stage = timelinesLayerRef.current;
      const children = stage?.children || [];
      let hoveredTimelineIdCurrent: string | null = null;

      for (const child of children) {
        const id = child.id();
        if (id.startsWith("dashed-")) {
          // get the rect of the child
          const rect = child.getClientRect();

          const rectY = rect.y;
          const rectX = rect.x;
          const rectWidth = rect.width;
          const boundNumber = getBoundsForTimeline(id);
          const boundNumberTop = id?.endsWith("-top") ? 36 : boundNumber;
          const boundNumberBottom = boundNumber;
          const boundsY = [rectY - boundNumberTop, rectY + boundNumberBottom];

          const boundsX = [rectX, rectX + rectWidth];
          if (
            pointerY >= boundsY[0] &&
            pointerY <= boundsY[1] &&
            pointerX >= boundsX[0] &&
            pointerX <= boundsX[1]
          ) {
            hoveredTimelineIdCurrent = id;
            break;
          }
        }
      }

      setHoveredTimelineId(hoveredTimelineIdCurrent);

      if (hoveredTimelineIdCurrent) {
        // make everything else null
        setGhostTimelineId(null);
        setGhostInStage(false);
        insertAtRef.current = null;
        useClipStore.getState().setMainPreview(null);
        return;
      }

      const timelinePadding = TIME_ZERO_X;
      const stageWidth = dimensions.stageWidth;
      const timelines = useClipStore.getState().timelines;

      let activeTimelineId: string | null = null;
      for (let i = 0; i < timelines.length; i++) {
        const t = timelines[i];
        const top = (t.timelineY ?? 0) + 8 - (verticalScrollRef.current || 0);
        const height = t.timelineHeight ?? 54;
        const left = timelinePadding;
        const right = left + stageWidth;
        const bottom = top + height;

        const isInside =
          pointerY >= top &&
          pointerY <= bottom &&
          pointerX >= left &&
          pointerX <= right;
        if (isInside) {
          // check for same type
          if (isValidTimelineForClip(t, data!) && !t.locked) {
            activeTimelineId = t.timelineId!;
            break;
          }
        }
      }

      if (!activeTimelineId) {
        setGhostTimelineId(null);
        setGhostInStage(false);
        useClipStore.getState().setMainPreview(null);
        return;
      }

      // Over the main track with the magnet on, its clips make room where the new one would go
      // in (before or after the clip under the pointer), as in CapCut.
      {
        const state = useClipStore.getState();
        const main = mainTrackOf(state.timelines);
        if (state.magnet && main && !main.locked && activeTimelineId === main.timelineId) {
          const [vs, ve] = useControlsStore.getState().timelineDuration;
          const span = Math.max(1, ve - vs);
          const len = Math.max(1, state.ghostStartEndFrame[1] - state.ghostStartEndFrame[0]);
          const at = insertionFrame(state.clips, state.timelines, vs + ((pointerX - timelinePadding) / stageWidth) * span);
          const preview = mainTrackPreview(state.clips, state.timelines, new Set(), len, at);
          insertAtRef.current = at;
          state.setMainPreview(preview.starts);
          setGhostTimelineId(activeTimelineId);
          setGhostInStage(true);
          setGhostX((((preview.insertAt ?? 0) - vs) / span) * stageWidth);
          return;
        }
        insertAtRef.current = null;
        if (state.mainPreview) state.setMainPreview(null);
      }

      // Center ghost under pointer and validate against bounds/overlaps
      const pointerLocalX = pointerX - timelinePadding; // pointer relative to inner timeline
      let [visibleStartFrame, visibleEndFrame] =
        useControlsStore.getState().timelineDuration;
      const ghostFrames = useClipStore.getState().ghostStartEndFrame;
      const ghostFramesLen = Math.max(
        1,
        (ghostFrames[1] ?? 0) - (ghostFrames[0] ?? 0),
      );

      // Map pointer directly to ghost's left edge in PX to keep exact alignment
      const desiredLeftPx = pointerLocalX;
      const ghostWidthPx = getClipWidth(0, ghostFramesLen, stageWidth, [
        visibleStartFrame,
        visibleEndFrame,
      ]);
      let desiredLeft = desiredLeftPx;

      // Build occupied intervals (in px, inner coordinates)
      const getClipsForTimeline = useClipStore.getState().getClipsForTimeline;
      const existingClips = getClipsForTimeline(activeTimelineId);
      let maxRight = 0;
      const occupied = existingClips
        .map((c) => {
          const sx = getClipX(c.startFrame || 0, c.endFrame || 0, stageWidth, [
            visibleStartFrame,
            visibleEndFrame,
          ]);
          const sw = getClipWidth(
            c.startFrame || 0,
            c.endFrame || 0,
            stageWidth,
            [visibleStartFrame, visibleEndFrame],
          );
          const lo = Math.max(0, sx);
          const hi = Math.max(0, sx + sw);
          maxRight = Math.max(maxRight, hi);
          return hi > lo ? ([lo, hi] as [number, number]) : null;
        })
        .filter(Boolean) as [number, number][];

      occupied.sort((a, b) => a[0] - b[0]);
      // Merge overlapping/touching intervals
      const merged: [number, number][] = [];
      for (const [lo, hi] of occupied) {
        if (merged.length === 0) {
          merged.push([lo, hi]);
        } else {
          const last = merged[merged.length - 1];
          if (lo <= last[1]) {
            last[1] = Math.max(last[1], hi);
          } else {
            merged.push([lo, hi]);
          }
        }
      }

      // Compute gaps
      const gaps: [number, number][] = [];
      let prev = 0;
      for (const [lo, hi] of merged) {
        if (lo > prev) gaps.push([prev, lo]);
        prev = Math.max(prev, hi);
      }
      // add the last gap
      if (prev < stageWidth) gaps.push([prev, Infinity]);

      const validGaps = gaps.filter(([lo, hi]) => hi - lo >= ghostWidthPx);
      const pointerCenter = desiredLeft;
      let chosenGap: [number, number] | null = null;

      for (const gap of validGaps) {
        if (pointerCenter >= gap[0] && pointerCenter <= gap[1]) {
          chosenGap = gap;
          break;
        }
      }
      if (!chosenGap && validGaps.length > 0) {
        chosenGap = validGaps.reduce((best, gap) => {
          const gc = (gap[0] + gap[1]) / 2;
          const bc = (best[0] + best[1]) / 2;
          return Math.abs(pointerCenter - gc) < Math.abs(pointerCenter - bc)
            ? gap
            : best;
        });
      }

      let validatedLeft = desiredLeft;

      if (chosenGap) {
        const [gLo, gHi] = chosenGap;
        validatedLeft = Math.min(
          Math.max(desiredLeft, gLo),
          gHi - ghostWidthPx,
        );
      } else {
        // Ensure validated Left
        validatedLeft = Math.max(validatedLeft, maxRight);
      }

      validatedLeft = Math.max(0, validatedLeft);

      setGhostTimelineId(activeTimelineId);
      setGhostInStage(true);
      setGhostX(validatedLeft);
    },
    [
      dimensions.stageWidth,
      dimensions.stageHeight,
      verticalScrollRef.current,
      timelinesLayerRef.current,
      hoveredTimelineId,
      setGhostTimelineId,
      setGhostInStage,
      setGhostX,
      setGhostStartEndFrame,
      setGhostInStage,
      setGhostX,
    ],
  );

  const handleDrop = useCallback(
    (_event: any, data: MediaItem) => {
      const timelines = useClipStore.getState().timelines;
      let timelineId: string | undefined = undefined;
      const timelineHeight = getTimelineHeightForClip(data);

      if (timelines.length === 0) {
        if (!_event.over) {
          return;
        }
        timelineId = uuidv4();
        const newTimeline = {
          type: getTimelineTypeForClip(data),
          timelineId,
          timelinePadding: TIME_ZERO_X,
          timelineWidth: size.width,
          timelineY: 0,
          timelineHeight: timelineHeight,
        };
        addTimeline(newTimeline);
      } else if (hoveredTimelineId) {
        // we add a new timeline at the hovered timeline id
        const timelines = useClipStore.getState().timelines;
        let hoveredTimelineIdx = timelines.findIndex(
          (t) => t.timelineId === hoveredTimelineId.replace("dashed-", ""),
        );
        // A video track under the main track would become the main track: it goes just
        // above it (with the magnet on, the clip goes onto the main track itself, below).
        const main = mainTrackOf(timelines);
        const mainIdx = main ? timelines.indexOf(main) : -1;
        if (main && getTimelineTypeForClip(data) === "media" && hoveredTimelineIdx >= mainIdx) {
          hoveredTimelineIdx = mainIdx - 1;
        }
        const hoveredTimeline =
          hoveredTimelineIdx !== -1 ? timelines[hoveredTimelineIdx] : null;
        timelineId = uuidv4();
        const newTimeline = {
          type: getTimelineTypeForClip(data),
          timelineId,
          timelinePadding: TIME_ZERO_X,
          timelineWidth: size.width,
          timelineY: (hoveredTimeline?.timelineY ?? 0) + timelineHeight,
          timelineHeight: timelineHeight,
        };
        addTimeline(newTimeline, hoveredTimelineIdx);
      }

      const mediaInfo = (data as MediaItem)?.mediaInfo;

      if (!mediaInfo && data.type !== "filter") {
        setActiveMediaItem(null);
        setGhostTimelineId(null);
        setGhostStartEndFrame(0, 0);
        setGhostX(0);
        return;
      }

      let numFrames: number = 0;
      let trimEnd = 0;
      let trimStart = 0;
      let height: number | undefined = undefined;
      let width: number | undefined = undefined;

      if (data.type === "video") {
        const duration = mediaInfo?.duration ?? 0;
        const fps = controlStore.fps; // Use project fps for clip duration
        height = mediaInfo?.video?.displayHeight;
        width = mediaInfo?.video?.displayWidth;
        numFrames = Math.round(duration * fps);
      } else if (data.type === "audio") {
        const duration = mediaInfo?.duration ?? 0;
        const fps = controlStore.fps;
        numFrames = Math.round(duration * fps);
      } else if (data.type === "image") {
        numFrames = imageDurationFrames(controlStore.fps);
        trimEnd = -Infinity;
        trimStart = Infinity;
        height = mediaInfo?.image?.height;
        width = mediaInfo?.image?.width;
      } else if (data.type === "filter") {
        numFrames = Math.round(controlStore.fps * controlStore.defaultClipLength);
        trimEnd = -Infinity;
        trimStart = Infinity;
        // Start with smallPath
        void haldClutRef?.preloadClut((data as unknown as Filter).smallPath);
      }

      // Use validated ghost position to compute frames
      const state = useClipStore.getState();
      const ghostTimelineId = state.ghostTimelineId;
      // Use ghostX when we have a ghost target; if we are creating a new timeline via dashed hover,
      // compute the X from the last pointer position captured in onDragMove (center of draggable)
      let ghostX = state.ghostTimelineId ? state.ghostX : 0;

      // If we're creating a new timeline (hovered dashed), align start using current mouse position
      if (
        hoveredTimelineId &&
        typeof (window as any).__apex_lastPointerX === "number"
      ) {
        const pointerX = Number((window as any).__apex_lastPointerX);
        const innerX = Math.max(
          0,
          Math.min(dimensions.stageWidth, pointerX - 24),
        );
        ghostX = Math.round(innerX);
      }

      let dropTimelineId = hoveredTimelineId
        ? timelineId
        : ghostTimelineId || timelineId;
      setHoveredTimelineId(null);
      let insertAt = insertAtRef.current;
      insertAtRef.current = null;
      state.setMainPreview(null);
      // Dropped under the main track with the magnet on: onto the main track, where the
      // pointer is.
      const main = mainTrackOf(useClipStore.getState().timelines);
      const magnetMain = state.magnet && !!main && !main.locked;
      if (hoveredTimelineId && magnetMain && getTimelineTypeForClip(data) === "media") {
        const timelines = useClipStore.getState().timelines;
        const idx = timelines.findIndex((t) => t.timelineId === hoveredTimelineId.replace("dashed-", ""));
        if (idx >= timelines.indexOf(main!)) {
          const [vs, ve] = controlStore.timelineDuration;
          const pointerX = Number((window as any).__apex_lastPointerX ?? 24);
          insertAt = insertionFrame(state.clips, timelines, vs + ((pointerX - 24) / dimensions.stageWidth) * (ve - vs));
          // The track just made above the main track isn't wanted.
          if (timelineId) useClipStore.getState().removeTimeline(timelineId);
          dropTimelineId = main!.timelineId;
        }
      }

      if (!dropTimelineId) {
        setActiveMediaItem(null);
        setGhostTimelineId(null);
        setGhostStartEndFrame(0, 0);
        setGhostX(0);
        return;
      }

      // If this is the first media (image/video) clip being added, set the preview aspect ratio
      try {
        const existingClips = useClipStore.getState().clips;
        const hasMediaAlready = existingClips.some(
          (c) => c.type === "video" || c.type === "image",
        );
        const isMediaIncoming = data.type === "video" || data.type === "image";
        if (!hasMediaAlready && isMediaIncoming) {
          const w = Number(width);
          const h = Number(height);
          if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            const gcd = (a: number, b: number): number =>
              b === 0 ? a : gcd(b, a % b);
            const g = gcd(Math.round(w), Math.round(h)) || 1;
            const id = `${Math.round(w / g)}:${Math.round(h / g)}`;
            useViewportStore
              .getState()
              .setAspectRatio({
                width: Math.round(w),
                height: Math.round(h),
                id,
              });
          }
        }
      } catch {}

      let [tStart, tEnd] = controlStore.timelineDuration;
      const stageWidth = dimensions.stageWidth;
      const visibleDuration = tEnd - tStart;
      const clipLen = Math.max(1, numFrames);
      // Map ghostX (left edge) to frame in visible window

      let startFrame = Math.round(
        tStart +
          (Math.max(0, Math.min(stageWidth, ghostX)) / stageWidth) *
            visibleDuration,
      );
      let endFrame = startFrame + clipLen;

      // Validate against overlaps on the target timeline across ALL frames
      // and choose a feasible placement. If no gap at desired position, append at end.
      const getClipsForTimeline = state.getClipsForTimeline;
      const existingClips = getClipsForTimeline(dropTimelineId)
        .map((c) => ({ lo: c.startFrame || 0, hi: c.endFrame || 0 }))
        .filter((iv) => iv.hi > iv.lo)
        .sort((a, b) => a.lo - b.lo);

      // Merge intervals globally
      const merged: { lo: number; hi: number }[] = [];
      for (const iv of existingClips) {
        if (merged.length === 0) merged.push({ ...iv });
        else {
          const last = merged[merged.length - 1];
          if (iv.lo <= last.hi) last.hi = Math.max(last.hi, iv.hi);
          else merged.push({ ...iv });
        }
      }

      // Try to place at or after requested startFrame without overlap
      let placementStart = Math.max(0, startFrame);
      if (merged.length === 0) {
        // No existing clips; keep startFrame as selected (0 if first clip logic below)
      } else {
        // Advance placementStart past any overlapping intervals
        for (const iv of merged) {
          if (placementStart + clipLen <= iv.lo) {
            // Fits before this interval
            break;
          }
          if (placementStart < iv.hi) {
            // Overlaps; move right after this interval and continue
            placementStart = iv.hi;
          }
        }
      }
      startFrame =
        existingClips.length === 0
          ? existingClips.length === 0
            ? startFrame
            : placementStart
          : placementStart;
      // Onto the main track with the magnet on: in at the point the drag showed (addClip lays
      // the track out).
      if (magnetMain && dropTimelineId === main!.timelineId) {
        startFrame = insertAt ?? insertionFrame(state.clips, state.timelines, startFrame);
      }
      endFrame = startFrame + clipLen;


      let asset: Asset | null = null

      if (data.type === 'audio' || data.type === 'video' || data.type === 'image') {
        asset = addAsset({ path: (data as MediaItem)?.assetUrl });
      }

      // @ts-ignore
      const newClip: AnyClipProps = {
        timelineId: dropTimelineId,
        clipId: uuidv4(),
        startFrame: existingClips.length === 0 ? startFrame : startFrame,
        endFrame,
        // @ts-ignore
        type: data.type,
        trimEnd: trimEnd,
        trimStart: trimStart,
        speed: 1.0,
      };

      if (asset) {
        (newClip as VideoClipProps | ImageClipProps).assetId = asset.id;
      }

      // Ensure intrinsic media dimensions are captured for image/video clips
      if (data.type === "image" || data.type === "video") {
        const mw = Number(width);
        const mh = Number(height);
        if (Number.isFinite(mw) && Number.isFinite(mh) && mw > 0 && mh > 0) {
          (newClip as VideoClipProps | ImageClipProps).mediaWidth = mw;
          (newClip as VideoClipProps | ImageClipProps).mediaHeight = mh;
          (newClip as VideoClipProps | ImageClipProps).mediaAspectRatio =
            mw / mh;
        }
      }

      if (data.type === "filter") {
        (newClip as FilterClipProps).name = (data as unknown as Filter).name;
        (newClip as FilterClipProps).smallPath = (
          data as unknown as Filter
        ).smallPath;
        (newClip as FilterClipProps).fullPath = (
          data as unknown as Filter
        ).fullPath;
        (newClip as FilterClipProps).category = (
          data as unknown as Filter
        ).category;
        (newClip as FilterClipProps).examplePath = (
          data as unknown as Filter
        ).examplePath;
        (newClip as FilterClipProps).exampleAssetUrl = (
          data as unknown as Filter
        ).exampleAssetUrl;
      }

      if (data.type === "image" || data.type === "video") {
        (newClip as VideoClipProps | ImageClipProps).masks = [];
      }

      addClip(newClip as AnyClipProps);

      // Upgrade to full stats when clip is added to timeline (for media clips only)
      if (
        (data as MediaItem)?.assetUrl &&
        ((data as MediaItem)?.type === "video" ||
          (data as MediaItem)?.type === "audio")
      ) {
        void ensureFullMediaStats((data as MediaItem)?.assetUrl);
      }

      setActiveMediaItem(null);
      setGhostTimelineId(null);
      setGhostStartEndFrame(0, 0);
      setGhostX(0);

      // Baseline and zoom level recalibration happen within addClip -> _updateZoomLevel
    },
    [
      size.width,
      hoveredTimelineId,
      controlStore,
      dimensions.stageWidth,
      haldClutRef,
      addTimeline,
      setActiveMediaItem,
      setGhostTimelineId,
      setGhostStartEndFrame,
      setGhostX,
      setHoveredTimelineId,
      addClip,
    ],
  );

  // Compute vertical content height for scrollbar logic
  const contentHeight = useMemo(() => {
    if (!timelines || timelines.length === 0) return dimensions.stageHeight;
    const bottoms = timelines.map((t) => {
      const y = t.timelineY || 0;
      const h = t.timelineHeight || 54;
      return y + h + 32; // include padding/offsets in Timeline rendering
    });
    return Math.max(...bottoms, 0) + SCROLL_BOTTOM_PADDING;
  }, [timelines, dimensions.stageHeight]);

  const maxScroll = useMemo(
    () => Math.max(0, contentHeight - dimensions.stageHeight),
    [contentHeight, dimensions.stageHeight],
  );
  const clampedScroll = useMemo(
    () => Math.max(0, Math.min(verticalScroll, maxScroll)),
    [verticalScroll, maxScroll],
  );

  useEffect(() => {
    setVerticalScroll((prev) => Math.max(0, Math.min(prev, maxScroll)));
  }, [maxScroll]);

  useEffect(() => {
    verticalScrollRef.current = clampedScroll;
  }, [clampedScroll]);

  // Auto-scroll when dragging near top/bottom edges (both external DnD and internal clip drags)
  const edgeAutoScroll = useCallback(
    (pointerY: number) => {
      if (maxScroll <= 0) return;
      const stageHeight = dimensions.stageHeight || 0;
      const TOP_MARGIN = 24; // ruler height
      const EDGE_ZONE = 36; // px threshold near edges
      const MAX_DELTA = 28; // px per invocation

      // Scroll up when within top edge zone (below the ruler)
      const topEdgeY = TOP_MARGIN + EDGE_ZONE;
      if (pointerY <= topEdgeY) {
        const intensity = Math.max(0, (topEdgeY - pointerY) / EDGE_ZONE);
        const delta = Math.max(6, Math.round(intensity * MAX_DELTA));
        setVerticalScroll((prev) => Math.max(0, prev - delta));
        return;
      }

      // Scroll down when within bottom edge zone
      const bottomEdgeStart = Math.max(0, stageHeight - EDGE_ZONE);
      if (pointerY >= bottomEdgeStart) {
        const intensity = Math.max(0, (pointerY - bottomEdgeStart) / EDGE_ZONE);
        const delta = Math.max(6, Math.round(intensity * MAX_DELTA));
        setVerticalScroll((prev) => Math.min(maxScroll, prev + delta));
      }
    },
    [dimensions.stageHeight, maxScroll],
  );

  // Listen for internal clip drag auto-scroll events
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const anyEvt = e as any;
        const y = Number(anyEvt?.detail?.y);
        if (!Number.isFinite(y)) return;
        edgeAutoScroll(y);
      } catch {}
    };
    window.addEventListener("timeline-editor-autoscroll", handler as any);
    return () => {
      window.removeEventListener("timeline-editor-autoscroll", handler as any);
    };
  }, [edgeAutoScroll]);

  // Horizontal scroll/pan with mouse wheel or trackpad
  const handleWheelScroll = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!dimensions.stageWidth) return;
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const isHorizontalIntent = absX >= absY || e.shiftKey;

      if (isHorizontalIntent) {
        const [startFrame, endFrame] = controlStore.timelineDuration;
        const duration = endFrame - startFrame;
        const framesPerPixel = duration / dimensions.stageWidth;
        const speedMultiplier = e.shiftKey ? 3 : 1;
        const deltaFramesFloat =
          e.deltaX * framesPerPixel * speedMultiplier +
          wheelRemainderRef.current;
        const integerShift = Math.trunc(deltaFramesFloat);
        wheelRemainderRef.current = deltaFramesFloat - integerShift;
        if (integerShift !== 0) {
          if (controlStore.canTimelineDurationBeShifted(integerShift)) {
            controlStore.shiftTimelineDuration(integerShift, true, true);
          }
        }
      } else if (maxScroll > 0) {
        const pxDelta = e.deltaY;
        if (pxDelta !== 0) {
          setVerticalScroll((prev) =>
            Math.max(0, Math.min(prev + pxDelta, maxScroll)),
          );
        }
      }
    },
    [dimensions.stageWidth, controlStore.timelineDuration, maxScroll],
  );

  // Drag to pan when clicking the top ruler area
  const handleStageMouseDown = useCallback(
    (e: any) => {
      const stage = e?.target?.getStage?.();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const tickAreaHeight = RULER_HEIGHT; // top ruler area height
      if (pos.y <= tickAreaHeight) {
        setIsRulerDragging(true);
        panStateRef.current.startX = pos.x;
        panStateRef.current.lastX = pos.x;
        panStateRef.current.startFrame = controlStore.timelineDuration[0];
        panStateRef.current.fractionalFrames = 0;
        if (e?.evt?.preventDefault) e.evt.preventDefault();
      }
    },
    [controlStore.timelineDuration],
  );

  const handleStageMouseMove = useCallback(
    (e: any) => {
      if (!isRulerDragging) return;
      const stage = e?.target?.getStage?.();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const deltaX = pos.x - panStateRef.current.lastX;
      const [startFrame, endFrame] = controlStore.timelineDuration;
      const duration = endFrame - startFrame;
      const framesPerPixel = duration / Math.max(1, dimensions.stageWidth);
      const deltaFramesFloat =
        deltaX * framesPerPixel + panStateRef.current.fractionalFrames;
      const integerShift = Math.trunc(deltaFramesFloat);
      panStateRef.current.fractionalFrames = deltaFramesFloat - integerShift;
      if (integerShift !== 0) {
        // update focus frame

        if (controlStore.canTimelineDurationBeShifted(integerShift)) {
          controlStore.shiftTimelineDuration(integerShift, true);
        }
      }
      panStateRef.current.lastX = pos.x;
    },
    [isRulerDragging, controlStore.timelineDuration, dimensions.stageWidth],
  );

  const endRulerDrag = useCallback(() => {
    if (isRulerDragging) setIsRulerDragging(false);
  }, [isRulerDragging]);

  const hasClips = useMemo(() => clips.length > 0, [clips]);

  const seekToPointerX = useCallback(
    (pointerX: number) => {
      // Map pointer X to frame within the visible window [startFrame, endFrame]
      const timelinePadding = TIME_ZERO_X; // time 0, after the Cover column
      const [startFrame, endFrame] = controlStore.timelineDuration;
      const innerX = Math.max(
        0,
        Math.min(pointerX - timelinePadding, dimensions.stageWidth),
      );
      const progress = dimensions.stageWidth > 0 ? innerX / dimensions.stageWidth : 0;
      const clampedProgress = Math.max(0, Math.min(1, progress));
      const targetFrame = Math.round(
        startFrame + clampedProgress * (endFrame - startFrame),
      );

      // Pause if playing, then set focus without auto-resume
      if (controlStore.isPlaying) controlStore.pause();
      controlStore.setFocusAnchorRatio(clampedProgress);
      controlStore.setFocusFrame(targetFrame, false);
      controlStore.setIsAccurateSeekNeeded(true);
    },
    [controlStore, controlStore.timelineDuration, dimensions.stageWidth],
  );

  const handleRulerClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      controlStore.clearSelection();
      controlStore.setSelectedMarkerId(null);
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos) return;
      seekToPointerX(pos.x);
    },
    [controlStore, seekToPointerX],
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Check if the click target is the stage itself (background click)
      if (e.target === e.target.getStage()) {
        controlStore.clearSelection();
        controlStore.setSelectedMarkerId(null);
        const stage = e.target.getStage();
        const pos = stage?.getPointerPosition();
        if (!pos) return;
        seekToPointerX(pos.x);
      }
    },
    [controlStore, seekToPointerX],
  );

  return (
    <div className="relative h-full flex flex-row overflow-hidden">
      {hasClips && <TimelineSidebar clampedScroll={clampedScroll} />}
      <div
        className="relative h-full w-full overflow-hidden"
        ref={containerRef}
        onWheel={handleWheelScroll}
      >
        {dimensions.stageWidth > 0 && dimensions.stageHeight > 0 && (
          <>
            {hasClips && (
              <>
                <Stage
                  key={hmrStageKey}
                  width={dimensions.stageWidth}
                  height={dimensions.stageHeight}
                  className="border-b border-brand-light/10 bg-brand-background z-10 relative"
                  onClick={handleStageClick}
                  onMouseDown={handleStageMouseDown}
                  onMouseMove={handleStageMouseMove}
                  onMouseUp={endRulerDrag}
                  onMouseLeave={endRulerDrag}
                  style={{ cursor: isRulerDragging ? "grabbing" : "default" }}
                >
                  <Layer
                    ref={timelinesLayerRef}
                    visible={hasClips}
                    y={-clampedScroll}
                  >
                    {timelines.map((timeline, index) => (
                      <Timeline
                      
                        key={timeline.timelineId}
                        scrollY={clampedScroll}
                        timelinePadding={timeline.timelinePadding}
                        index={index}
                        type={timeline.type}
                        muted={timeline.muted}
                        hidden={timeline.hidden}
                        timelineWidth={dimensions.stageWidth}
                        timelineY={timeline.timelineY}
                        timelineHeight={timeline.timelineHeight}
                        timelineId={timeline.timelineId}
                        assetMode={false}
                      />
                    ))}
                    {(() => {
                      // Where Timeline draws the main track's band (its y + 32, 8 px shorter).
                      const main = mainTrackOf(timelines);
                      if (!main) return null;
                      return <CoverTile top={(main.timelineY ?? 0) + 32} height={(main.timelineHeight ?? 0) - 8} />;
                    })()}
                  </Layer>
                  <Layer visible={hasClips}>
                    {/* Time labels along the top */}
                    <TimelineMoments
                      stageWidth={dimensions.stageWidth}
                      startPadding={TIME_ZERO_X}
                      maxScroll={maxScroll}
                      onRulerClick={handleRulerClick}
                      thumbY={() => {
                        const trackTop = 24;
                        const trackBottomPad = 8;
                        const trackHeight = Math.max(
                          0,
                          dimensions.stageHeight - trackTop - trackBottomPad,
                        );
                        const ratio = Math.max(
                          0,
                          Math.min(
                            1,
                            dimensions.stageHeight / Math.max(1, contentHeight),
                          ),
                        );
                        const minThumb = 24;
                        const thumbHeight = Math.max(
                          minThumb,
                          Math.round(trackHeight * ratio),
                        );
                        const maxThumbY = Math.max(
                          0,
                          trackHeight - thumbHeight,
                        );
                        const thumbY =
                          trackTop +
                          (maxScroll > 0
                            ? Math.round(
                                (clampedScroll / maxScroll) * maxThumbY,
                              )
                            : 0);
                        return thumbY;
                      }}
                    />
                    <MarkerFlags stageWidth={dimensions.stageWidth} startPadding={TIME_ZERO_X} />
                  </Layer>
                  {/* Snap guideline overlay */}
                  <Layer listening={false}>
                    {typeof snapGuideX === "number" && (
                      <Line
                        points={[
                          snapGuideX,
                          0,
                          snapGuideX,
                          dimensions.stageHeight,
                        ]}
                        stroke={"#FFFFFF"}
                        strokeWidth={1.5}
                        dash={[4, 4]}
                        shadowColor={"#FFFFFF"}
                        shadowBlur={6}
                        shadowOpacity={0.4}
                      />
                    )}
                  </Layer>
                  {/* Virtual vertical scrollbar */}
                  {hasClips && maxScroll > 0 && (
                    <Layer>
                      {/* Invisible hover track to detect mouseover across full height on the right margin */}
                      <Rect
                        x={Math.max(0, dimensions.stageWidth - SCROLLBAR_HW)}
                        y={0}
                        width={SCROLLBAR_HW}
                        height={dimensions.stageHeight}
                        fill={"transparent"}
                        listening
                        onMouseEnter={() => setIsScrollbarHovered(true)}
                        onMouseLeave={() => setIsScrollbarHovered(false)}
                      />
                      {(() => {
                        const scrollbarWidth = SCROLLBAR_HW;
                        const trackTop = 24;
                        const trackBottomPad = 8;
                        const trackHeight = Math.max(
                          0,
                          dimensions.stageHeight - trackTop - trackBottomPad,
                        );
                        const ratio = Math.max(
                          0,
                          Math.min(
                            1,
                            dimensions.stageHeight / Math.max(1, contentHeight),
                          ),
                        );
                        const minThumb = 24;
                        const thumbHeight = Math.max(
                          minThumb,
                          Math.round(trackHeight * ratio),
                        );
                        const maxThumbY = Math.max(
                          0,
                          trackHeight - thumbHeight,
                        );
                        const thumbY =
                          trackTop +
                          (maxScroll > 0
                            ? Math.round(
                                (clampedScroll / maxScroll) * maxThumbY,
                              )
                            : 0);
                        const thumbX = Math.max(
                          0,
                          dimensions.stageWidth - scrollbarWidth,
                        );
                        return (
                          <Rect
                            x={thumbX}
                            y={thumbY}
                            width={scrollbarWidth}
                            height={thumbHeight}
                            cornerRadius={scrollbarWidth}
                            fill={
                              isScrollbarHovered
                                ? "rgba(227,227,227,0.4)"
                                : "rgba(227,227,227,0.1)"
                            }
                            draggable
                            dragBoundFunc={(pos) => {
                              const clampedY = Math.max(
                                trackTop,
                                Math.min(trackTop + maxThumbY, pos.y),
                              );
                              return { x: thumbX, y: clampedY };
                            }}
                            onDragMove={(e) => {
                              const y = e.target.y();
                              const rel =
                                maxThumbY > 0 ? (y - trackTop) / maxThumbY : 0;
                              const next = rel * maxScroll;
                              setVerticalScroll(next);
                            }}
                            onDragEnd={(e) => {
                              const y = e.target.y();
                              const rel =
                                maxThumbY > 0 ? (y - trackTop) / maxThumbY : 0;
                              const next = rel * maxScroll;
                              setVerticalScroll(next);
                            }}
                            onMouseEnter={() => setIsScrollbarHovered(true)}
                            onMouseLeave={() => setIsScrollbarHovered(false)}
                          />
                        );
                      })()}
                    </Layer>
                  )}
                  {canScrollHorizontal && (
                    <Layer>
                      <Scrollbar
                        stageWidth={dimensions.stageWidth}
                        stageHeight={dimensions.stageHeight}
                        isScrollbarHovered={isScrollbarHovered}
                        setIsScrollbarHovered={setIsScrollbarHovered}
                      />
                    </Layer>
                  )}
                </Stage>
              </>
            )}
            {!hasClips && (
              <>
                {/* Overlay helper text/icon centered */}

                <div
                  style={{ display: clips.length > 0 ? "none" : "flex" }}
                  className="h-full items-center justify-center w-full p-8"
                >
                  <Droppable
                    id="timeline"
                    className="w-full rounded-[4px] border border-dashed border-[#3e3e3e] bg-[#292929] text-[#cccccc] duration-100 ease-in-out "
                    accepts={["media"]}
                    highlight={{
                      borderColor: "#A477C4",
                      textColor: "#FFFFFF",
                      bgColor: "#A477C4",
                    }}
                  >
                    <div className="w-full group py-6 px-10  rounded-lg  flex items-center ">
                      <div className=" mx-auto w-full flex items-center font-sans pointer-events-auto">
                        <h4 className=" flex items-center flex-row leading-none gap-x-3.5">
                          <span className="flex items-center justify-center leading-none">
                            <GoFileMedia className="w-5 h-5 " />
                          </span>
                          <span className="text-[12px] font-light font-poppins leading-none ">
                            Drag and drop media to start creating
                          </span>
                        </h4>
                      </div>
                    </div>
                  </Droppable>
                </div>
              </>
            )}
          </>
        )}
        <MarkerEditor anchor={containerRef} stageWidth={dimensions.stageWidth} startPadding={TIME_ZERO_X} />
        {hasClips && <KeyframeGraph stageWidth={dimensions.stageWidth} scrollY={clampedScroll} />}
        <div style={{ display: hasClips ? undefined : "none" }}>
          <ScrubControl
            stageHeight={dimensions.stageHeight - 30}
            stageWidth={dimensions.stageWidth}
          />
        </div>
      </div>
    </div>
  );
});

export default TimelineEditor;
