import React, { useState, useRef, useEffect } from "react";
import { scrubSound, scrubSoundStop } from "@/lib/scrub-audio";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { SNAP_PX, snapPoints, snapToPoints } from "@/lib/timeline-edit";
import { projectBeatPoints } from "@/lib/audio-tools";
import { cn } from "@/lib/utils";
import { TIME_ZERO_X } from "@/lib/timeline-geometry";
import { startEdgeScroll } from "@/lib/edge-scroll";

interface ScrubControlProps {
  stageHeight: number;
  stageWidth: number;
}

export const ScrubControl: React.FC<ScrubControlProps> = ({
  stageHeight,
  stageWidth,
}) => {
  const {
    timelineDuration,
    focusFrame,
    setFocusFrame,
    setFocusAnchorRatio,
    isPlaying,
    pause,
    play,
    isFullscreen,
    setPossibleKeyFocusFrames,
    setIsAccurateSeekNeeded,
  } = useControlsStore();
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState(18);
  // Geometry constants: keep in sync with timeline ticks padding and handle width
  const startPadding = TIME_ZERO_X; // ticks start at time 0, after the Cover column
  const handleHalf = 5; // half of the head's width (10 px)
  const containerRef = useRef<HTMLDivElement>(null);
  const [wasPlaying, setWasPlaying] = useState(false);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    setIsAccurateSeekNeeded(false);
    if (isPlaying) {
      setWasPlaying(true);
      pause();
    }
    // pause the video
    // Initialize anchor and focus based on current position
    const centerX = position + handleHalf;
    const progress = (centerX - startPadding) / stageWidth;
    const [startFrame, endFrame] = timelineDuration;
    const framePosition = startFrame + progress * (endFrame - startFrame);
    setFocusFrame(Math.round(framePosition));
    scrubSound(Math.round(framePosition));
    setFocusAnchorRatio(Math.max(0, Math.min(1, progress)));
  };

  const handleMouseMove = (e: Pick<MouseEvent, "clientX" | "metaKey">) => {
    if (!isDragging || !containerRef.current) return;

    const container = containerRef.current.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    // Compute desired center X in the same coordinate system as ticks (includes startPadding)
    const rawCenterX = e.clientX - rect.left;
    const minCenterX = startPadding;
    const maxCenterX = stageWidth - containerRef.current.offsetWidth / 2;
    const centerX = Math.max(minCenterX, Math.min(rawCenterX, maxCenterX));

    // Move handle smoothly by setting left to center - half width
    setPosition(centerX - handleHalf);
    // Persist anchor ratio so zoom can preserve relative alignment
    const anchorRatio = (centerX - startPadding) / stageWidth;
    setFocusAnchorRatio(anchorRatio);

    // The frame under the pointer, or a marker or clip edge it comes near (snapping, N; held
    // ⌘ skips it), as CapCut's playhead does.
    const progress = (centerX - startPadding) / stageWidth;
    // The window as it is now: the edge scroll moves it between renders.
    const [startFrame, endFrame] = useControlsStore.getState().timelineDuration;
    const framePosition = startFrame + progress * (endFrame - startFrame);
    const snapped = snapPlayhead(framePosition, e.metaKey);
    setFocusFrame(snapped);
    scrubSound(snapped);
  };

  /** A frame for the playhead: the nearest one, or a marker or clip edge within reach. */
  const snapPlayhead = (frame: number, skip: boolean) => {
    const nearest = Math.max(0, Math.round(frame));
    const controls = useControlsStore.getState();
    if (!controls.snapping || skip) return nearest;
    const { clips, markers } = useClipStore.getState();
    const [startFrame, endFrame] = timelineDuration;
    const points = snapPoints(clips, { playhead: -Infinity, markers, exclude: new Set(), beats: projectBeatPoints(clips) });
    const hit = snapToPoints([frame], points, (SNAP_PX * Math.max(1, endFrame - startFrame)) / Math.max(1, stageWidth));
    return hit ? hit.point : nearest;
  };

  // Let go: the playhead stays on the frame it was dragged to (the nearest frame, or what it
  // snapped to), not on the ruler's tick grid, which can be two frames or more apart.
  const handleMouseUp = () => {
    setIsDragging(false);
    scrubSoundStop();
    // The window and frame as they are now: the edge scroll moves both between renders.
    const { timelineDuration: [startFrame, endFrame], focusFrame: dragged } = useControlsStore.getState();
    const frame = Math.max(startFrame, Math.min(endFrame, dragged));
    const progress = (frame - startFrame) / Math.max(1, endFrame - startFrame);
    setPosition(startPadding + progress * stageWidth - handleHalf);
    setIsAccurateSeekNeeded(true);
    setFocusFrame(frame);
    setFocusAnchorRatio(progress);

    if (wasPlaying) {
      play();
      setWasPlaying(false);
    }
  };

  // Reposition scrubber when the visible range or focus frame changes (e.g., zoom in/out)
  useEffect(() => {
    // Keep the scrubber centered over the focusFrame in the new viewport
    const minCenterX = startPadding;
    const maxCenterX = startPadding + stageWidth;
    const [startFrame, endFrame] = timelineDuration;
    const centerX =
      startPadding +
      (stageWidth * (focusFrame - startFrame)) / (endFrame - startFrame);
    const clampedCenterX = Math.max(minCenterX, Math.min(centerX, maxCenterX));
    if (!isDragging) {
      setPosition(clampedCenterX - handleHalf);
    }
  }, [timelineDuration, stageWidth, focusFrame, isDragging]);

  // Add global event listeners for mouse move and up
  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, timelineDuration, stageWidth]);

  // Dragged near or past either edge of the visible timeline, the timeline scrolls that way each
  // animation frame (lib/edge-scroll.ts) with the playhead under the pointer, even while the
  // pointer is held still; it stops at frame 0 and at the timeline's end.
  useEffect(() => {
    const container = containerRef.current?.parentElement;
    if (!isDragging || !container) return;
    return startEdgeScroll(container, startPadding, stageWidth, useControlsStore.getState, handleMouseMove);
  }, [isDragging, stageWidth]);

  useEffect(() => {
    // Only calculate if we have valid dimensions
    if (stageWidth <= 0) return;

    const [startFrame, endFrame] = timelineDuration;
    // We can interact with at most stageWidth pixels (assuming 1px resolution)
    // The startPadding determines where the timeline effectively starts in the coordinate system
    // The handle movement is clamped between startPadding and stageWidth - startPadding (roughly)
    // However, the mouse move logic maps [startPadding, startPadding + stageWidth] to [startFrame, endFrame]
    // See handleMouseMove: progress = (centerX - startPadding) / stageWidth
    
    // We want to simulate every possible integer pixel position for centerX
    // The range of valid centerX values in handleMouseMove is effectively constrained by the container
    // But conceptually, the progress goes from 0 to 1 across 'stageWidth' pixels
    
    const frames = new Set<number>();
    
    // Iterate through every possible pixel offset relative to the start of the timeline area
    for (let pixelOffset = 0; pixelOffset <= stageWidth; pixelOffset++) {
        const progress = pixelOffset / stageWidth;
        const framePosition = startFrame + progress * (endFrame - startFrame);
        const snapped = Math.round(framePosition);
        frames.add(snapped);
    }
    
    setPossibleKeyFocusFrames(Array.from(frames).sort((a, b) => a - b));
  }, [timelineDuration, stageWidth, setPossibleKeyFocusFrames]);

  if (isFullscreen) {
    return <div ref={containerRef} className="hidden" />;
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      style={{ left: Math.min(position, stageWidth) }}
      className="absolute flex z-50 top-0 cursor-col-resize"
    >
      <div className="flex flex-col items-center">
        {/* CapCut's playhead: a hollow white shield over a 1 px white line. */}
        <div
          data-testid="playhead-handle"
          className={cn(
            "w-[10px] h-[14px] rounded-t-[3px] rounded-b-[5px] border-2 border-white",
          )}
        ></div>
        <div style={{ height: stageHeight }} className="w-px bg-white"></div>
      </div>
    </div>
  );
};
