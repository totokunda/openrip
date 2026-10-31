// The new timeline (docs/plan/timeline-rewrite.md): the track headers beside one canvas drawn
// imperatively from the layout, and a small canvas over it for the playhead. Nothing here
// re-renders through React as the timeline is scrolled, zoomed, played or edited: the canvases
// redraw in the next animation frame when the stores change. Behind Settings › Labs › New
// timeline until it does everything the timeline before it does.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { mainTrackOf } from "@/lib/timeline-edit";
import { layoutTracks, trackView } from "@/lib/timeline-view";
import { scrubSound, scrubSoundStop, skimSound } from "@/lib/scrub-audio";
import { zoomTimelineTo } from "@/lib/timeline-shortcuts";
import { clipLook } from "@/lib/timeline/appearance";
import { hitTest, layoutTimeline, SCROLL_BOTTOM_PADDING, type ClipBox, type Layout } from "@/lib/timeline/layout";
import { frameAt, viewOf } from "@/lib/timeline/view";
import TimelineSidebar from "../timeline/TimelineSidebar";
import { drawClip, drawMarkers, drawPlayhead, drawRowShades, drawRows, drawRuler, drawSkim, inTrackAreas } from "./draw";

/** A ⌘-scroll (or pinch) of this many pixels is one zoom step. */
const ZOOM_WHEEL_STEP = 40;

/** Sizes a canvas to its box at the screen's pixel density; its context draws in CSS pixels. */
const fitCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
};

const TimelineSurface: React.FC = () => {
  const hasClips = useClipStore((s) => s.clips.length > 0);
  const timelines = useClipStore((s) => s.timelines);
  const areaRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollY, setScrollY] = useState(0);
  const scene = useRef({ layout: null as Layout | null, dirty: true, overlayDirty: true, raf: 0 });
  const wheel = useRef({ zoom: 0, frames: 0 });

  // The pinning, worked out as the headers render so they and the canvas agree (the headers read
  // `trackView`, as they did beside the timeline before this one).
  const tracks = useMemo(() => layoutTracks(timelines, mainTrackOf(timelines), size.height, scrollY, SCROLL_BOTTOM_PADDING), [timelines, size.height, scrollY]);
  Object.assign(trackView, tracks);
  const maxScroll = tracks.maxScroll;
  useEffect(() => setScrollY((s) => Math.max(0, Math.min(s, maxScroll))), [maxScroll]);

  const draw = useCallback(() => {
    const s = scene.current;
    s.raf = 0;
    const area = areaRef.current;
    const main = mainRef.current;
    const overlay = overlayRef.current;
    if (!area || !main || !overlay) return;
    const width = area.clientWidth;
    const height = area.clientHeight;
    const clipsState = useClipStore.getState();
    const controls = useControlsStore.getState();
    if (s.dirty || !s.layout) {
      s.dirty = false;
      const layout = layoutTimeline({
        clips: clipsState.clips,
        tracks: clipsState.timelines,
        view: viewOf(controls.timelineDuration, width),
        width,
        height,
        scrollY: Math.max(0, Math.min(scrollYRef.current, trackView.maxScroll)),
      });
      s.layout = layout;
      const ctx = fitCanvas(main, width, height);
      ctx.clearRect(0, 0, width, height);
      drawRuler(ctx, layout, controls.fps || 24);
      drawMarkers(ctx, layout, clipsState.markers, controls.selectedMarkerId);
      const selected = new Set(controls.selectedClipIds);
      const fps = controls.fps || 24;
      inTrackAreas(ctx, layout, (pinned) => {
        drawRows(ctx, layout, pinned);
        for (const b of layout.clips) {
          if (layout.tracks.pinned && b.row.pinned !== pinned) continue;
          const asset = (b.clip as { assetId?: string }).assetId ? clipsState.assets[(b.clip as { assetId?: string }).assetId!] : undefined;
          drawClip(ctx, layout, b, { look: clipLook(b.clip, asset, fps, b.h, b.row.main), selected: selected.has(b.id), deactivated: !!b.clip.deactivated });
        }
        drawRowShades(ctx, layout, pinned);
      });
      s.overlayDirty = true;
    }
    if (s.overlayDirty && s.layout) {
      s.overlayDirty = false;
      const ctx = fitCanvas(overlay, width, height);
      ctx.clearRect(0, 0, width, height);
      if (controls.previewAxis && !controls.isPlaying && controls.hoverFrame != null) drawSkim(ctx, s.layout, controls.hoverFrame);
      drawPlayhead(ctx, s.layout, controls.focusFrame);
    }
  }, []);
  const scrollYRef = useRef(scrollY);
  scrollYRef.current = scrollY;

  const redraw = useCallback(
    (main = true) => {
      const s = scene.current;
      if (main) s.dirty = true;
      else s.overlayDirty = true;
      if (!s.raf) s.raf = requestAnimationFrame(draw);
    },
    [draw],
  );

  // The canvases follow their box's size.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: area.clientWidth, height: area.clientHeight });
      redraw();
    });
    ro.observe(area);
    return () => ro.disconnect();
  }, [redraw]);
  useEffect(() => redraw(), [scrollY, tracks, redraw]);
  useEffect(() => () => cancelAnimationFrame(scene.current.raf), []);

  // Redrawn when what they show changes; the playhead's canvas alone as it plays.
  useEffect(() => {
    const offClips = useClipStore.subscribe((s, p) => {
      if (s.clips !== p.clips || s.timelines !== p.timelines || s.assets !== p.assets || s.markers !== p.markers) redraw();
    });
    const offControls = useControlsStore.subscribe((s, p) => {
      if (s.timelineDuration !== p.timelineDuration || s.selectedClipIds !== p.selectedClipIds || s.fps !== p.fps || s.selectedMarkerId !== p.selectedMarkerId) redraw();
      else if (s.focusFrame !== p.focusFrame || s.hoverFrame !== p.hoverFrame || s.isPlaying !== p.isPlaying || s.previewAxis !== p.previewAxis) redraw(false);
      // The playhead played, sought or stepped out of view: the view follows it, as CapCut's does.
      // A scroll alone leaves it at its time, out of view if it goes there.
      if (s.focusFrame !== p.focusFrame) {
        const [start, end] = s.timelineDuration;
        const length = end - start;
        if (s.focusFrame < start) s.shiftTimelineDuration(s.focusFrame - start);
        else if (s.focusFrame > end) s.shiftTimelineDuration(length + (length + end > s.focusFrame ? 0 : s.focusFrame - end));
      }
    });
    return () => {
      offClips();
      offControls();
    };
  }, [redraw]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** The playhead to the frame at canvas x, paused, with a snippet of its sound. */
  const seek = (x: number, accurate: boolean) => {
    const layout = scene.current.layout;
    if (!layout) return;
    const controls = useControlsStore.getState();
    const frame = Math.max(0, Math.round(Math.max(layout.view.start, Math.min(layout.view.end, frameAt(layout.view, x)))));
    if (controls.isPlaying) controls.pause();
    controls.setFocusAnchorRatio(Math.max(0, Math.min(1, (x - layout.view.x0) / layout.view.width)));
    controls.setFocusFrame(frame, false);
    controls.setIsAccurateSeekNeeded(accurate);
    scrubSound(frame);
  };

  const canTrim = (b: ClipBox) => useControlsStore.getState().selectedClipIds.includes(b.id) && !b.row.track.locked && b.clip.type !== "group";

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = scene.current.layout;
    if (!layout || e.button !== 0) return;
    const { x, y } = local(e);
    const hit = hitTest(layout, x, y, canTrim);
    const controls = useControlsStore.getState();
    if (hit.kind === "clip") {
      if (hit.box.row.track.locked) return;
      if (e.shiftKey || e.metaKey) controls.toggleClipSelection(hit.box.id, true);
      else if (!controls.selectedClipIds.includes(hit.box.id)) controls.toggleClipSelection(hit.box.id, false);
      return;
    }
    // The ruler, a track's empty space or below the tracks: the playhead goes there, dragged on
    // as the pointer moves, and an empty-space press drops the selection.
    if (hit.kind !== "ruler") controls.clearSelection();
    controls.setSelectedMarkerId(null);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    seek(x, false);
    const move = (ev: PointerEvent) => seek(local(ev).x, false);
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      seek(local(ev).x, true);
      scrubSoundStop();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = scene.current.layout;
    if (!layout || e.buttons) return;
    const { x, y } = local(e);
    const hit = hitTest(layout, x, y, canTrim);
    e.currentTarget.style.cursor = hit.kind === "clip" ? (hit.edge ? "col-resize" : "pointer") : "default";
    const controls = useControlsStore.getState();
    // The preview axis: the player shows the frame under the pointer (not while playing).
    if (controls.previewAxis && !controls.isPlaying && x >= layout.view.x0) {
      const frame = Math.max(0, Math.min(useClipStore.getState().clipDuration, Math.round(frameAt(layout.view, x))));
      controls.setHoverFrame(frame);
      skimSound(frame);
    }
  };

  const onPointerLeave = () => {
    if (useControlsStore.getState().hoverFrame != null) useControlsStore.getState().setHoverFrame(null);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const layout = scene.current.layout;
    if (!layout) return;
    const controls = useControlsStore.getState();
    // ⌘ + scroll (Ctrl elsewhere; a trackpad's pinch comes as the same): up zooms in.
    if (e.metaKey || e.ctrlKey) {
      wheel.current.zoom += -e.deltaY;
      const steps = Math.trunc(wheel.current.zoom / ZOOM_WHEEL_STEP);
      if (steps !== 0) {
        wheel.current.zoom -= steps * ZOOM_WHEEL_STEP;
        zoomTimelineTo(controls.zoomLevel + steps);
      }
      return;
    }
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY) || e.shiftKey) {
      const delta = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * (e.shiftKey ? 3 : 1);
      const frames = delta / (layout.view.width / (layout.view.end - layout.view.start)) + wheel.current.frames;
      const whole = Math.trunc(frames);
      wheel.current.frames = frames - whole;
      if (whole !== 0 && controls.canTimelineDurationBeShifted(whole)) controls.shiftTimelineDuration(whole);
    } else if (maxScroll > 0) {
      setScrollY((s) => Math.max(0, Math.min(s + e.deltaY, maxScroll)));
    }
  };

  return (
    <div className="relative h-full flex flex-row overflow-hidden" data-testid="timeline-surface">
      {hasClips && <TimelineSidebar />}
      <div ref={areaRef} className="relative flex-1 h-full overflow-hidden" onWheel={onWheel}>
        <canvas ref={mainRef} className="absolute inset-0 w-full h-full" />
        <canvas
          ref={overlayRef}
          data-testid="timeline-canvas"
          className="absolute inset-0 w-full h-full"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
};

export default TimelineSurface;
