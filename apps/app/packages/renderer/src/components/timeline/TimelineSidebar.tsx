import React, { useCallback, useEffect, useRef, useState } from "react";
import { useClipStore } from "@/lib/clip";
import { GoFileMedia } from "react-icons/go";
import {
  LuAudioWaveform,
  LuPaintbrush,
  LuShapes,
  LuSticker,
  LuType,
} from "react-icons/lu";
import { LuLock } from "react-icons/lu";
import { TimelineProps } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useControlsStore } from "@/lib/control";
import { MdPhotoFilter } from "react-icons/md";
import { AddTrackButton, TrackButtons, openTrackMenu, useTrackReorder } from "./TrackControls";

interface TimelineSidebarProps {
  clampedScroll: number; // for the scroll position
}

// The track's kind, dimmer than its controls (CapCut's #5e5e5e beside #d8d8d8).
const TypeIcon: React.FC<{ type: TimelineProps["type"] }> = ({ type }) => (
  <>
    {type === "media" && <GoFileMedia className="w-3 h-3 text-brand-light/40" />}
    {type === "audio" && <LuAudioWaveform className="w-3 h-3 text-brand-light/40" />}
    {type === "shape" && <LuShapes className="w-3 h-3 text-brand-light/40" />}
    {type === "sticker" && <LuSticker className="w-3 h-3 text-brand-light/40" />}
    {type === "text" && <LuType className="w-3 h-3 text-brand-light/40" />}
    {type === "filter" && <MdPhotoFilter className="w-3 h-3 text-brand-light/40" />}
    {type === "draw" && <LuPaintbrush className="w-3 h-3 text-brand-light/40" />}
  </>
);

// A track's header: its kind, and when the sidebar is open its lock, hide and mute buttons and
// its menu in CapCut's columns. Right-click opens the track's menu; dragging it moves the track
// up or down.
const TimelineSidebarItem: React.FC<{
  track: TimelineProps;
  isCollapsed: boolean;
  clampedScroll: number;
  onMouseDown: (e: React.MouseEvent) => void;
}> = ({ track, isCollapsed, clampedScroll, onMouseDown }) => {
  const { type, timelineHeight, timelineY, locked } = track;
  return (
    <div
      data-track-header={track.timelineId}
      style={{
        height: (timelineHeight ?? 0) - 8,
        top: (timelineY ?? 0) + 32 - clampedScroll,
      }}
      className={cn("bg-brand-light/5  w-full absolute flex items-center justify-center cursor-grab", locked && "bg-brand-light/[0.02]")}
      onMouseDown={onMouseDown}
      onContextMenu={(e) => {
        e.preventDefault();
        openTrackMenu(e, track);
      }}
    >
      {isCollapsed && (locked ? <LuLock className="w-3 h-3 text-brand-light/70" /> : <TypeIcon type={type} />)}
      {!isCollapsed && (
        <div className="w-full h-full flex items-center pl-0.5">
          <div className="w-6 h-full shrink-0 flex items-center justify-center">
            <TypeIcon type={type} />
          </div>
          <TrackButtons track={track} />
        </div>
      )}
    </div>
  );
};

const TimelineSidebar: React.FC<TimelineSidebarProps> = ({ clampedScroll }) => {
  const collapsedWidth = 40; // ~ w-14
  const expandedWidth = 123; // CapCut's: the kind, lock, hide, mute and the menu
  // Open, as CapCut's always is; its rail still folds it to the kinds alone.
  const [width, setWidth] = useState<number>(expandedWidth);
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const startXRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const { timelines } = useClipStore();
  const { isFullscreen } = useControlsStore();
  const listRef = useRef<HTMLDivElement | null>(null);
  const last = timelines[timelines.length - 1];
  // The headers as laid out on screen, for dragging them.
  const reorder = useTrackReorder(() => {
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    return timelines.map((t) => ({ id: t.timelineId, top: top + (t.timelineY ?? 0) + 32 - clampedScroll, height: (t.timelineHeight ?? 0) - 8 }));
  });
  const indicatorTop = (gap: number) => {
    const t = timelines[Math.min(gap, timelines.length - 1)];
    const y = gap < timelines.length ? (t.timelineY ?? 0) + 32 - 5 : (t.timelineY ?? 0) + (t.timelineHeight ?? 0) + 32 - 7;
    return y - clampedScroll;
  };

  const endDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", endDrag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - startXRef.current;
      const THRESHOLD = 4;
      if (Math.abs(dx) < THRESHOLD) return;
      if (isOpen) {
        // Only allow collapse on initial left drag
        if (dx < 0) {
          setWidth(collapsedWidth);
          setIsOpen(false);
        }
      } else {
        // Only allow expand on initial right drag
        if (dx > 0) {
          setWidth(expandedWidth);
          setIsOpen(true);
        }
      }
      endDrag();
    },
    [collapsedWidth, expandedWidth, isOpen, endDrag],
  );

  const startDrag = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      isDraggingRef.current = true;
      startXRef.current = e.clientX;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", endDrag);
    },
    [onMouseMove, endDrag],
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endDrag);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [onMouseMove, endDrag]);

  return (
    <div
      className=" h-full border-brand-light/10 transition-all duration-200 relative shrink-0 bg-brand"
      style={{ width }}
    >
      {/* Right rail: drag to open or close */}
      <button
        aria-label="Drag to resize timeline sidebar"
        title="Drag to resize"
        className="absolute top-0 hover:bg-brand-light/50 right-0 h-full transition-all duration-100 w-px bg-brand-light/10 z-50 flex items-center justify-center group outline-none"
        style={{
          cursor: width === collapsedWidth ? "e-resize" : "w-resize",
          display: isFullscreen ? "none" : "block",
        }}
        onMouseDown={(e) => startDrag(e)}
      />
      <div className="relative h-full" ref={listRef}>
        {timelines.map((timeline) => (
          <TimelineSidebarItem
            key={timeline.timelineId}
            track={timeline}
            isCollapsed={!isOpen}
            clampedScroll={clampedScroll}
            onMouseDown={(e) => reorder.onMouseDown(e, timeline.timelineId)}
          />
        ))}
        {/* Where a dragged track would go. */}
        {reorder.indicator != null && (
          <div
            className="absolute left-0 right-0 h-0.5 bg-brand-accent pointer-events-none"
            style={{ top: indicatorTop(reorder.indicator) }}
          />
        )}
        {timelines.length > 0 && (
          <div
            className="absolute left-0 right-0"
            style={{ top: (last?.timelineY ?? 0) + (last?.timelineHeight ?? 0) + 30 - clampedScroll }}
          >
            <AddTrackButton />
          </div>
        )}
      </div>
    </div>
  );
};

export default TimelineSidebar;
