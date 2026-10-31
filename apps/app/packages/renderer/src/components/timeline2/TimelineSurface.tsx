// The new timeline (docs/plan/timeline-rewrite.md): the track headers beside one canvas drawn
// imperatively from the layout, and a small canvas over it for the playhead. Nothing here
// re-renders through React as the timeline is scrolled, zoomed, played or edited: the canvases
// redraw in the next animation frame when the stores change.
//
// One controller owns the pointer. A press hit-tests the layout and starts a gesture: a trim on a
// selected clip's edge, a move on a clip's body (once the pointer has gone a few pixels), a
// marquee on empty space, a scrub on the ruler or the playhead. Each pointer move asks the
// editing rules (lib/timeline/gesture.ts) what the drag would leave, from the document as it was
// at the press, and draws that; letting go commits exactly that as one change (one undo step).
// Esc cancels. Behind Settings › Edit › New timeline until it does everything the old one does.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { mainTrackOf, snapPoints, snapToPoints, SNAP_PX } from "@/lib/timeline-edit";
import { RULER_HEIGHT } from "@/lib/timeline-geometry";
import { layoutTracks, trackView } from "@/lib/timeline-view";
import { scrubSound, scrubSoundStop, skimSound } from "@/lib/scrub-audio";
import { zoomTimelineTo } from "@/lib/timeline-shortcuts";
import { bladeCut, bladeFrame } from "@/lib/timeline-tools";
import { projectBeatPoints } from "@/lib/audio-tools";
import { startEdgeScroll, type EdgePointer } from "@/lib/edge-scroll";
import { stickSelection } from "@/lib/bundle";
import { clipLook, timecode } from "@/lib/timeline/appearance";
import { hitTest, layoutTimeline, SCROLL_BOTTOM_PADDING, type ClipBox, type Hit, type Layout } from "@/lib/timeline/layout";
import { frameAt, framesFor, viewOf, xOf } from "@/lib/timeline/view";
import { duplicateClips, goingWith, type Doc, type Rules } from "@/lib/timeline/core/edit";
import { marqueeHits, previewMove, previewTrim, type MoveDrag, type MovePreview, type SnapContext, type TrimDrag } from "@/lib/timeline/gesture";
import TimelineSidebar from "../timeline/TimelineSidebar";
import Droppable from "../dnd/Droppable";
import { GoFileMedia } from "react-icons/go";
import { useEffectDropStore } from "@/lib/effects/library";
import { useTransitionDropStore } from "@/lib/transitions";
import { DROP_ID, useTimelineDrops, type DropState } from "./drops";
import { drawKeyframes, drawRange, drawRendered, drawTransitions, keyMarks, keyframeAt, markerAt, rangeEdgeAt, transitionAt, transitionMarks } from "./marks";
import { MarkerEditor, useMarkerEditorStore } from "../timeline/Markers";
import KeyframeGraph from "../timeline/KeyframeGraph";
import { setTransitionDuration } from "@/lib/transitions";
import { moveKeysAt } from "@/lib/timeline-keyframes";
import { withEnd } from "@/lib/range";
import { useRenderStore } from "@/lib/prerender";
import { openKeyframeMenu, openTransitionMenu } from "./markMenus";
import { openMarkerMenu } from "../timeline/menus/markerMenu";
import { doubleClickClip, openClipMenu } from "../timeline/menus/clipMenu";
import { openTrackSpaceMenu } from "../timeline/menus/trackMenu";
import { drawBlade, drawCoverTile, drawScrollbars, hThumb, onCoverTile, scrollbarAt, vThumb } from "./chrome";
import { openCoverEditor } from "@/lib/cover";
import { drawCardGhost, drawClip, drawCutTarget, drawDropTarget, drawFloating, drawGuide, drawMarkers, drawMarquee, drawNewTrackLine, drawPlayhead, drawRowShades, drawRows, drawRuler, drawSkim, drawSlot, drawTrimTip, inTrackAreas } from "./draw";

/** A ⌘-scroll (or pinch) of this many pixels is one zoom step. */
const ZOOM_WHEEL_STEP = 40;
/** How far (px) the pointer goes before a press on a clip or empty space becomes a drag. */
const DRAG_START = 3;
/** How near (px) the playhead a press takes hold of it. */
const PLAYHEAD_GRAB = 4;

type Gesture =
  | { kind: "press"; hit: Hit; x0: number; y0: number; additive: boolean; reselect: string | null; copy: boolean }
  | { kind: "scrub" }
  | { kind: "move"; drag: MoveDrag; preview: MovePreview | null; x0: number; y0: number; x: number; y: number; select: string[] | null }
  | { kind: "trim"; drag: TrimDrag; preview: { doc: Doc; applied: number; guide: number | null } | null; x: number; y: number }
  | { kind: "marquee"; x0: number; y0: number; x: number; y: number; base: string[] }
  | { kind: "marker"; id: string; from: number; frame: number; x0: number; moved: boolean }
  | { kind: "range"; which: "in" | "out"; frame: number }
  | { kind: "transitionSide"; clipId: string; side: -1 | 1; from: number; x0: number }
  | { kind: "keyframe"; clipId: string; start: number; length: number; from: number; to: number; x0: number; moved: boolean }
  | { kind: "hbar"; x0: number; start: number; framesPerPx: number; wasPlaying: boolean }
  | { kind: "vbar"; y0: number; scroll0: number; pxPerScroll: number };

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

/** The rendered parts of the timeline (lib/prerender.ts keeps them in µs) in frames. */
const renderedFrames = () => {
  const fps = useControlsStore.getState().fps || 24;
  return useRenderStore.getState().ranges.map((r) => ({ start: (r.start * fps) / 1e6, end: (r.end * fps) / 1e6 }));
};

/** The switches the editing rules follow, as the stores have them now. */
const rulesNow = (): Rules => ({ magnet: useClipStore.getState().magnet, linkage: useControlsStore.getState().linkage, fps: useControlsStore.getState().fps || 24 });

/** What snapping snaps to now (beats from every clip but those in `exclude`). */
const snapNow = (exclude?: Set<string>): SnapContext => {
  const controls = useControlsStore.getState();
  const clips = useClipStore.getState();
  return { on: controls.snapping, playhead: controls.focusFrame, markers: clips.markers, beats: projectBeatPoints(clips.clips, exclude) };
};

const TimelineSurface: React.FC = () => {
  const hasClips = useClipStore((s) => s.clips.length > 0);
  const timelines = useClipStore((s) => s.timelines);
  const areaRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollY, setScrollY] = useState(0);
  const scrollYRef = useRef(scrollY);
  scrollYRef.current = scrollY;
  const scene = useRef({ layout: null as Layout | null, dirty: true, overlayDirty: true, raf: 0, gesture: null as Gesture | null, stopScroll: null as null | (() => void), drop: null as DropState | null, hover: { cover: false, bar: null as "h" | "v" | null, bladeX: null as number | null } });
  const wheel = useRef({ zoom: 0, frames: 0 });

  // The pinning, worked out as the headers render so they and the canvas agree (the headers read
  // `trackView`, as they did beside the timeline before this one).
  const tracks = useMemo(() => layoutTracks(timelines, mainTrackOf(timelines), size.height, scrollY, SCROLL_BOTTOM_PADDING), [timelines, size.height, scrollY]);
  Object.assign(trackView, tracks);
  const maxScroll = tracks.maxScroll;
  useEffect(() => setScrollY((s) => Math.max(0, Math.min(s, maxScroll))), [maxScroll]);

  /** The layout of `doc` (the store's document by default) as the canvas is now. */
  const layoutOf = useCallback((doc?: { clips: Doc["clips"]; tracks: Doc["tracks"] }): Layout | null => {
    const area = areaRef.current;
    if (!area) return null;
    const clipsState = useClipStore.getState();
    return layoutTimeline({
      clips: doc?.clips ?? clipsState.clips,
      tracks: doc?.tracks ?? clipsState.timelines,
      view: viewOf(useControlsStore.getState().timelineDuration, area.clientWidth),
      width: area.clientWidth,
      height: area.clientHeight,
      scrollY: Math.max(0, Math.min(scrollYRef.current, trackView.maxScroll)),
    });
  }, []);

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
    const g = s.gesture;
    if (s.dirty || !s.layout) {
      s.dirty = false;
      // While a move, a trim or a card from a panel is under way, the timeline as it would be
      // left, on the tracks as they are.
      const preview = s.drop?.preview ?? (g && (g.kind === "move" || g.kind === "trim") ? g.preview : null);
      const layout = layoutOf(preview ? { clips: preview.doc.clips, tracks: clipsState.timelines } : undefined);
      if (!layout) return;
      s.layout = layout;
      const ctx = fitCanvas(main, width, height);
      ctx.clearRect(0, 0, width, height);
      const fps = controls.fps || 24;
      drawRuler(ctx, layout, fps);
      drawRendered(ctx, layout, renderedFrames());
      const range = g?.kind === "range" && controls.range ? { ...controls.range, [g.which === "in" ? "start" : "end"]: g.frame } : controls.range;
      if (range) drawRange(ctx, layout, range);
      const markers = g?.kind === "marker" ? clipsState.markers.map((m) => (m.id === g.id ? { ...m, frame: g.frame } : m)) : clipsState.markers;
      drawMarkers(ctx, layout, markers, controls.selectedMarkerId);
      const selected = new Set(controls.selectedClipIds);
      const movers = s.drop?.preview ? new Set([DROP_ID]) : g?.kind === "move" && g.preview ? new Set([g.drag.lead, ...g.drag.followers]) : null;
      const lookOf = (b: ClipBox) => {
        const id = (b.clip as { assetId?: string }).assetId;
        return clipLook(b.clip, id ? clipsState.assets[id] : undefined, fps, b.h, b.row.main);
      };
      inTrackAreas(ctx, layout, (pinned) => {
        drawRows(ctx, layout, pinned);
        for (const b of layout.clips) {
          if (layout.tracks.pinned && b.row.pinned !== pinned) continue;
          // A moving clip's place is where it would land; the clip itself follows the pointer.
          if (movers?.has(b.id)) drawSlot(ctx, b);
          else drawClip(ctx, layout, b, { look: lookOf(b), selected: selected.has(b.id), deactivated: !!b.clip.deactivated });
        }
        drawRowShades(ctx, layout, pinned);
      });
      // Transitions on the cuts, and the selected clips' keyframes, over the clips.
      drawTransitions(ctx, layout, transitionMarks(layout, clipsState.clips, fps, controls.selectedTransitionId, useTransitionDropStore.getState().target));
      const keys = g?.kind === "move" || g?.kind === "trim" ? [] : keyMarks(layout, selected, controls.focusFrame, g?.kind === "keyframe" && g.moved ? g.clipId : null);
      if (g?.kind === "keyframe" && g.moved) {
        const b = layout.clips.find((c) => c.id === g.clipId);
        if (b) keys.push({ clipId: g.clipId, frame: g.to, x: b.x + (g.to * b.w) / g.length, y: b.y + b.h / 2, atPlayhead: false });
      }
      drawKeyframes(ctx, keys);
      drawCoverTile(ctx, layout, s.hover.cover, clipsState.compoundStack.length > 0);
      drawScrollbars(ctx, layout, controls.totalTimelineFrames, scrollYRef.current, g?.kind === "hbar" ? "h" : g?.kind === "vbar" ? "v" : s.hover.bar);
      if (g?.kind === "move" && g.preview) {
        if (g.preview.line) drawNewTrackLine(ctx, layout, g.preview.line.y);
        if (g.preview.guide != null) drawGuide(ctx, layout, g.preview.guide);
        // The clips being moved, where the pointer has taken them from where they were.
        const before = layoutOf();
        const dFrames = frameAt(layout.view, g.x) - frameAt(layout.view, g.x0);
        for (const b of before?.clips ?? []) {
          if (!movers!.has(b.id)) continue;
          const x = xOf(layout.view, (b.clip.startFrame ?? 0) + dFrames);
          drawFloating(ctx, layout, { ...b, x, y: b.y + (g.y - g.y0) }, { look: lookOf(b), selected: true, deactivated: !!b.clip.deactivated });
        }
      }
      if (g?.kind === "trim" && g.preview) {
        if (g.preview.guide != null) drawGuide(ctx, layout, g.preview.guide);
        const b = layout.clips.find((c) => c.id === g.drag.id);
        if (b) drawTrimTip(ctx, layout, b, timecode((b.clip.endFrame ?? 0) - (b.clip.startFrame ?? 0), fps), g.x);
      }
      if (g?.kind === "marquee") drawMarquee(ctx, g.x0, g.y0, g.x, g.y);
      // A card from a panel: where it would land, and the card itself at the pointer.
      if (s.drop) {
        if (s.drop.preview?.line) drawNewTrackLine(ctx, layout, s.drop.preview.line.y);
        if (s.drop.preview?.guide != null) drawGuide(ctx, layout, s.drop.preview.guide);
        drawCardGhost(ctx, s.drop.x, s.drop.y, s.drop.length * (layout.view.width / (layout.view.end - layout.view.start)), s.drop.label);
      }
      // An effect tile over a clip marks it; a transition card the cut it would go on.
      const effectTarget = useEffectDropStore.getState().target;
      const cutTarget = useTransitionDropStore.getState().target;
      for (const b of layout.clips) {
        if (b.id === effectTarget) drawDropTarget(ctx, layout, b);
        if (b.id === cutTarget) drawCutTarget(ctx, layout, b);
      }
      s.overlayDirty = true;
    }
    if (s.overlayDirty && s.layout) {
      s.overlayDirty = false;
      const ctx = fitCanvas(overlay, width, height);
      ctx.clearRect(0, 0, width, height);
      if (controls.previewAxis && !controls.isPlaying && controls.hoverFrame != null) drawSkim(ctx, s.layout, controls.hoverFrame);
      if (controls.timelineTool === "split" && s.hover.bladeX != null && !s.gesture) drawBlade(ctx, s.layout, s.hover.bladeX);
      drawPlayhead(ctx, s.layout, controls.focusFrame);
    }
  }, [layoutOf]);

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
  useEffect(
    () => () => {
      cancelAnimationFrame(scene.current.raf);
      scene.current.stopScroll?.();
    },
    [],
  );

  // Redrawn when what they show changes; the playhead's canvas alone as it plays.
  useEffect(() => {
    const offClips = useClipStore.subscribe((s, p) => {
      if (s.clips !== p.clips || s.timelines !== p.timelines || s.assets !== p.assets || s.markers !== p.markers || s.compoundStack !== p.compoundStack) redraw();
    });
    const offControls = useControlsStore.subscribe((s, p) => {
      if (s.timelineDuration !== p.timelineDuration || s.selectedClipIds !== p.selectedClipIds || s.fps !== p.fps || s.selectedMarkerId !== p.selectedMarkerId || s.selectedTransitionId !== p.selectedTransitionId || s.range !== p.range || s.totalTimelineFrames !== p.totalTimelineFrames) redraw();
      // The diamond under the playhead is ringed.
      else if (s.focusFrame !== p.focusFrame && s.selectedClipIds.length) redraw();
      else if (s.focusFrame !== p.focusFrame || s.hoverFrame !== p.hoverFrame || s.isPlaying !== p.isPlaying || s.previewAxis !== p.previewAxis) redraw(false);
      // The playhead played, sought or stepped out of view: the view follows it, as CapCut's does.
      // A scroll alone leaves it at its time, out of view if it goes there.
      if (s.focusFrame !== p.focusFrame && !(scene.current.gesture?.kind === "scrub")) {
        const [start, end] = s.timelineDuration;
        const length = end - start;
        if (s.focusFrame < start) s.shiftTimelineDuration(s.focusFrame - start);
        else if (s.focusFrame > end) s.shiftTimelineDuration(length + (length + end > s.focusFrame ? 0 : s.focusFrame - end));
      }
    });
    const offRender = useRenderStore.subscribe(() => redraw());
    return () => {
      offClips();
      offControls();
      offRender();
    };
  }, [redraw]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** The playhead to the frame at canvas x (snapped while dragged), paused, with a snippet of its sound. */
  const seek = (x: number, accurate: boolean, snap = false, skipSnap = false) => {
    const layout = layoutOf();
    if (!layout) return;
    const controls = useControlsStore.getState();
    let frame = Math.max(0, Math.round(frameAt(layout.view, Math.max(layout.view.x0, Math.min(layout.width, x)))));
    if (snap && controls.snapping && !skipSnap) {
      const s = snapNow();
      const hit = snapToPoints([frame], snapPoints(useClipStore.getState().clips, { playhead: -Infinity, markers: s.markers, exclude: new Set(), beats: s.beats }), framesFor(layout.view, SNAP_PX));
      if (hit) frame = hit.point;
    }
    if (controls.isPlaying) controls.pause();
    controls.setFocusAnchorRatio(Math.max(0, Math.min(1, (x - layout.view.x0) / layout.view.width)));
    controls.setFocusFrame(frame, false);
    controls.setIsAccurateSeekNeeded(accurate);
    scrubSound(frame);
  };

  const canTrim = (b: ClipBox) => useControlsStore.getState().selectedClipIds.includes(b.id) && !b.row.track.locked && b.clip.type !== "group";

  /** The store's document now. */
  const docNow = (): Doc => ({ clips: useClipStore.getState().clips, tracks: useClipStore.getState().timelines });

  /** A press on a clip's body that has moved far enough: the clip and those going with it move. */
  const beginMove = (box: ClipBox, x0: number, y0: number, layout: Layout, copy: boolean): Gesture => {
    let doc = docNow();
    const rules = rulesNow();
    const controls = useControlsStore.getState();
    const main = mainTrackOf(doc.tracks);
    // The others selected, and what's linked (linkage on) or grouped with any of them. With the
    // magnet on, the main track's other clips keep its order unless they're the dragged clip's own.
    const own = new Set(goingWith(doc, [box.id], rules));
    const selected = controls.selectedClipIds.includes(box.id) ? controls.selectedClipIds : [box.id];
    const followers = goingWith(doc, selected, rules).filter((id) => {
      if (id === box.id) return false;
      const c = doc.clips.find((x) => x.clipId === id);
      return own.has(id) || !(rules.magnet && main && c?.timelineId === main.timelineId);
    });
    // ⌥ held (CapCut's Drag to duplicate): copies move, the originals stay where they are.
    let lead = box.id;
    let going = followers;
    let select: string[] | null = null;
    if (copy) {
      const dup = duplicateClips(doc, [box.id, ...followers], () => crypto.randomUUID());
      doc = dup.doc;
      lead = dup.copies.get(box.id)!;
      going = followers.map((id) => dup.copies.get(id)!).filter(Boolean);
      select = [lead, ...going];
    }
    const drag: MoveDrag = {
      start: doc,
      lead,
      followers: going,
      pressFrame: frameAt(layout.view, x0),
      leadStart: box.clip.startFrame ?? 0,
      length: Math.max(1, (box.clip.endFrame ?? 0) - (box.clip.startFrame ?? 0)),
      leadTrack: box.clip.timelineId ?? box.row.id,
      newTrackId: crypto.randomUUID(),
    };
    return { kind: "move", drag, preview: null, x0, y0, x: x0, y: y0, select };
  };

  /** The gesture under way, at pointer (x, y) (again after an edge scroll, the pointer held still). */
  const step = (x: number, y: number, meta: boolean) => {
    const s = scene.current;
    const g = s.gesture;
    if (!g) return;
    if (g.kind === "move" || g.kind === "marquee") scrollToward(y);
    const layout = layoutOf();
    if (!layout) return;
    if (g.kind === "move") {
      g.x = x;
      g.y = y;
      g.preview = previewMove(g.drag, layout, rulesNow(), snapNow(new Set([g.drag.lead, ...g.drag.followers])), x, y, meta);
      redraw();
    } else if (g.kind === "trim") {
      g.x = x;
      g.y = y;
      g.preview = previewTrim(g.drag, layout, rulesNow(), snapNow(), x, meta);
      redraw();
    } else if (g.kind === "marquee") {
      g.x = x;
      g.y = y;
      const hits = marqueeHits(layout, g.x0, g.y0, x, y);
      const next = stickSelection(useClipStore.getState().clips, [...new Set([...g.base, ...hits])]);
      const controls = useControlsStore.getState();
      if (next.join() !== controls.selectedClipIds.join()) controls.setSelectedClipIds(next);
      redraw();
    } else if (g.kind === "scrub") {
      seek(x, false, true, meta);
    } else if (g.kind === "marker") {
      // Dragged along the ruler, a marker snaps to the playhead and clip edges as a clip does.
      g.moved ||= Math.abs(x - g.x0) >= DRAG_START;
      if (!g.moved) return;
      let frame = Math.max(0, Math.round(frameAt(layout.view, Math.max(layout.view.x0, Math.min(layout.width, x)))));
      const controls = useControlsStore.getState();
      if (controls.snapping && !meta) {
        const hit = snapToPoints([frame], snapPoints(useClipStore.getState().clips, { playhead: controls.focusFrame, markers: [], exclude: new Set() }), framesFor(layout.view, SNAP_PX));
        if (hit) frame = hit.point;
      }
      g.frame = frame;
      redraw();
    } else if (g.kind === "range") {
      g.frame = Math.max(0, Math.round(frameAt(layout.view, Math.max(layout.view.x0, Math.min(layout.width, x)))));
      redraw();
    } else if (g.kind === "transitionSide") {
      // Both halves move together: the duration grows by twice what a side is dragged.
      const fps = useControlsStore.getState().fps || 24;
      setTransitionDuration(g.clipId, g.from + (2 * g.side * framesFor(layout.view, x - g.x0)) / fps);
    } else if (g.kind === "hbar") {
      const controls = useControlsStore.getState();
      const target = Math.round(g.start + (x - g.x0) * g.framesPerPx);
      const shift = target - controls.timelineDuration[0];
      if (shift) controls.shiftTimelineDuration(shift);
    } else if (g.kind === "vbar") {
      const max = trackView.maxScroll;
      setScrollY(Math.max(0, Math.min(max, g.scroll0 + (y - g.y0) / Math.max(1e-6, g.pxPerScroll))));
    } else if (g.kind === "keyframe") {
      g.moved ||= Math.abs(x - g.x0) >= DRAG_START;
      if (!g.moved) return;
      // Along the clip, on whole frames.
      g.to = Math.round(Math.max(0, Math.min(g.length, g.from + framesFor(layout.view, x - g.x0))));
      redraw();
    }
  };

  /**
   * A move or marquee near the top or bottom of the scrolling tracks scrolls them that way, faster
   * the nearer the edge (each animation frame while the edge scroll runs).
   */
  const scrollToward = (y: number) => {
    const layout = scene.current.layout;
    if (!layout || trackView.maxScroll <= 0) return;
    const ZONE = 36;
    const top = 24 + ZONE;
    const bottom = (trackView.pinned ? trackView.overBottom : layout.height) - ZONE;
    const delta = y < top ? -Math.max(2, ((top - y) / ZONE) * 14) : y > bottom ? Math.max(2, ((y - bottom) / ZONE) * 14) : 0;
    if (delta) setScrollY((v) => Math.max(0, Math.min(trackView.maxScroll, v + delta)));
  };

  /** Edge scrolling for a drag: near or past either edge the timeline scrolls, the drag following. */
  const edgeScroll = () => {
    const canvas = overlayRef.current;
    const layout = scene.current.layout;
    if (!canvas || !layout) return;
    scene.current.stopScroll?.();
    scene.current.stopScroll = startEdgeScroll(canvas, layout.view.x0, layout.width, useControlsStore.getState, (p: EdgePointer) => {
      const { x, y } = local(p);
      step(x, y, p.metaKey);
    });
  };

  const end = (commit: boolean) => {
    const s = scene.current;
    const g = s.gesture;
    s.gesture = null;
    s.stopScroll?.();
    s.stopScroll = null;
    if (commit && g && (g.kind === "move" || g.kind === "trim") && g.preview) {
      useClipStore.getState().commitTimeline(g.preview.doc);
      if (g.kind === "move" && g.select) useControlsStore.getState().setSelectedClipIds(g.select);
    }
    if (g?.kind === "scrub") {
      useControlsStore.getState().setIsAccurateSeekNeeded(true);
      scrubSoundStop();
    }
    if (commit && g?.kind === "marker") {
      const controls = useControlsStore.getState();
      if (g.moved) useClipStore.getState().updateMarker(g.id, { frame: g.frame });
      else {
        // A click goes to the marker and selects it (Delete removes it).
        if (controls.isPlaying) controls.pause();
        controls.setFocusFrame(g.from, false);
        controls.setIsAccurateSeekNeeded(true);
        controls.clearSelection();
        controls.setSelectedMarkerId(g.id);
      }
    }
    if (g?.kind === "hbar" && g.wasPlaying) useControlsStore.getState().play();
    if (commit && g?.kind === "range") {
      const c = useControlsStore.getState();
      if (c.range) c.setRange(withEnd(c.range, g.which, g.frame, c.range.end));
    }
    if (commit && g?.kind === "keyframe") {
      const clip = useClipStore.getState().getClipById(g.clipId);
      if (clip && g.moved && g.to !== g.from) useClipStore.getState().updateClip(g.clipId, { keyframes: moveKeysAt(clip.keyframes, g.from, g.to) });
      useControlsStore.getState().setFocusFrame(Math.round(g.start + (g.moved ? g.to : g.from)));
    }
    if (overlayRef.current) overlayRef.current.style.cursor = "default";
    redraw();
  };

  // Drops from the panels: media cards land as a moved clip does; the rest at the frame or clip under the pointer.
  useTimelineDrops({
    canvas: () => overlayRef.current,
    layout: () => layoutOf(),
    setDrop: (drop) => {
      scene.current.drop = drop;
      redraw();
    },
    redraw: () => redraw(),
  });

  // For the smoke tests (scripts/smoke): the layout as the canvas has it, what a point hits, and
  // the gesture under way, in place of probing the canvas's pixels.
  useEffect(() => {
    const hook = {
      layout: () => layoutOf(),
      hit: (x: number, y: number) => {
        const l = layoutOf();
        if (!l) return null;
        const h = hitTest(l, x, y, canTrim);
        return h.kind === "clip" ? { kind: h.kind, id: h.box.id, edge: h.edge, frame: h.frame } : { kind: h.kind, frame: h.frame };
      },
      gesture: () => scene.current.gesture?.kind ?? null,
    };
    (window as unknown as { __openripTimeline?: typeof hook }).__openripTimeline = hook;
    return () => {
      delete (window as unknown as { __openripTimeline?: typeof hook }).__openripTimeline;
    };
  }, [layoutOf]);

  // Esc lets go of a drag without changing anything.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && scene.current.gesture && scene.current.gesture.kind !== "press") {
        e.preventDefault();
        e.stopPropagation();
        end(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = layoutOf();
    if (!layout || e.button !== 0) return;
    scene.current.layout = layout;
    const { x, y } = local(e);
    const controls = useControlsStore.getState();
    e.currentTarget.setPointerCapture(e.pointerId);
    // The range's edges and the markers' tags, in the ruler.
    const edge = rangeEdgeAt(layout, controls.range, x, y);
    if (edge && controls.range) {
      scene.current.gesture = { kind: "range", which: edge, frame: edge === "in" ? controls.range.start : controls.range.end };
      edgeScroll();
      return;
    }
    const marker = markerAt(layout, useClipStore.getState().markers, x, y);
    if (marker) {
      if (e.detail === 2) {
        useMarkerEditorStore.getState().open(marker.id);
        return;
      }
      scene.current.gesture = { kind: "marker", id: marker.id, from: marker.frame, frame: marker.frame, x0: x, moved: false };
      return;
    }
    // The Cover tile opens the cover editor (not inside a compound clip, which has no cover).
    if (onCoverTile(layout, x, y)) {
      if (useClipStore.getState().compoundStack.length === 0) openCoverEditor();
      return;
    }
    // The scrollbars: the bottom one scrolls the timeline (playback pauses while it's dragged), the side one the overlay tracks.
    const bar = scrollbarAt(layout, controls.totalTimelineFrames, scrollYRef.current, x, y);
    if (bar === "h") {
      const wasPlaying = controls.isPlaying;
      if (wasPlaying) controls.pause();
      scene.current.gesture = { kind: "hbar", x0: x, start: layout.view.start, framesPerPx: hThumb(layout, controls.totalTimelineFrames).framesPerPx, wasPlaying };
      return;
    }
    if (bar === "v") {
      const v = vThumb(layout, scrollYRef.current);
      if (v) scene.current.gesture = { kind: "vbar", y0: y, scroll0: scrollYRef.current, pxPerScroll: v.pxPerScroll };
      return;
    }
    // The playhead's line takes a press near it, in the ruler or over the tracks.
    if (Math.abs(x - xOf(layout.view, controls.focusFrame)) <= PLAYHEAD_GRAB && x >= layout.view.x0) {
      scene.current.gesture = { kind: "scrub" };
      if (controls.isPlaying) controls.pause();
      edgeScroll();
      return;
    }
    // A selected clip's keyframe diamonds, then the transitions' badges and a selected one's sides.
    const key = keyframeAt(keyMarks(layout, new Set(controls.selectedClipIds), controls.focusFrame), x, y);
    if (key) {
      const clip = useClipStore.getState().getClipById(key.clipId);
      if (clip) {
        const start = clip.startFrame ?? 0;
        scene.current.gesture = { kind: "keyframe", clipId: key.clipId, start, length: Math.max(1, (clip.endFrame ?? 0) - start), from: key.frame, to: key.frame, x0: x, moved: false };
        return;
      }
    }
    const tr = transitionAt(transitionMarks(layout, useClipStore.getState().clips, controls.fps || 24, controls.selectedTransitionId, null), x, y);
    if (tr) {
      controls.setSelectedTransitionId(tr.mark.clipId);
      if (tr.side && tr.mark.transition) {
        scene.current.gesture = { kind: "transitionSide", clipId: tr.mark.clipId, side: tr.side, from: tr.mark.transition.duration, x0: x };
        e.currentTarget.style.cursor = "ew-resize";
      }
      return;
    }
    const hit = hitTest(layout, x, y, canTrim);
    if (hit.kind === "clip") {
      const box = hit.box;
      if (box.row.track.locked) return;
      // The blade (B): a click cuts the clip under the pointer at its frame.
      if (controls.timelineTool === "split") {
        bladeCut(box.id, bladeFrame(Math.round(hit.frame), layout.width));
        return;
      }
      if (hit.edge) {
        const edge = hit.edge === "left" ? box.clip.startFrame ?? 0 : box.clip.endFrame ?? 0;
        scene.current.gesture = { kind: "trim", drag: { start: docNow(), id: box.id, side: hit.edge, pressFrame: frameAt(layout.view, x), edge }, preview: null, x, y };
        e.currentTarget.style.cursor = "col-resize";
        edgeScroll();
        return;
      }
      const additive = e.shiftKey || e.metaKey;
      const selected = controls.selectedClipIds.includes(box.id);
      if (additive) controls.toggleClipSelection(box.id, true);
      else if (!selected) controls.toggleClipSelection(box.id, false);
      // A press on one of several selected clips that doesn't drag selects it alone, on release.
      scene.current.gesture = { kind: "press", hit, x0: x, y0: y, additive, reselect: !additive && selected && controls.selectedClipIds.length > 1 ? box.id : null, copy: e.altKey };
      return;
    }
    if (hit.kind === "ruler") {
      controls.setSelectedMarkerId(null);
      scene.current.gesture = { kind: "scrub" };
      seek(x, false);
      edgeScroll();
      return;
    }
    // Empty track space or below the tracks: a drag draws a marquee, a click moves the playhead
    // there. Either drops the selection first, unless Shift or ⌘ is held.
    const additive = e.shiftKey || e.metaKey;
    if (!additive) controls.clearSelection();
    controls.setSelectedMarkerId(null);
    scene.current.gesture = { kind: "press", hit, x0: x, y0: y, additive, reselect: null, copy: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = scene.current;
    const layout = s.layout ?? layoutOf();
    if (!layout) return;
    const { x, y } = local(e);
    const g = s.gesture;
    if (g?.kind === "press") {
      if (Math.hypot(x - g.x0, y - g.y0) < DRAG_START) return;
      if (g.hit.kind === "clip") {
        s.gesture = beginMove(g.hit.box, g.x0, g.y0, layout, g.copy);
        e.currentTarget.style.cursor = "grabbing";
      } else {
        s.gesture = { kind: "marquee", x0: g.x0, y0: g.y0, x: g.x0, y: g.y0, base: g.additive ? useControlsStore.getState().selectedClipIds : [] };
      }
      edgeScroll();
    }
    if (s.gesture) {
      step(x, y, e.metaKey);
      return;
    }
    if (e.buttons) return;
    const hit = hitTest(layout, x, y, canTrim);
    const controls = useControlsStore.getState();
    const cover = onCoverTile(layout, x, y);
    const bar = scrollbarAt(layout, controls.totalTimelineFrames, scrollYRef.current, x, y);
    if (cover !== s.hover.cover || bar !== s.hover.bar) {
      s.hover.cover = cover;
      s.hover.bar = bar;
      redraw();
    }
    // The blade's line follows the pointer over the tracks, snapped where a click would cut.
    const bladeX = controls.timelineTool === "split" && y > RULER_HEIGHT && x >= layout.view.x0 ? xOf(layout.view, bladeFrame(Math.round(frameAt(layout.view, x)), layout.width)) : null;
    if (bladeX !== s.hover.bladeX) {
      s.hover.bladeX = bladeX;
      redraw(false);
    }
    if (cover || bar) {
      e.currentTarget.style.cursor = cover && useClipStore.getState().compoundStack.length === 0 ? "pointer" : "default";
      return;
    }
    const nearHead = Math.abs(x - xOf(layout.view, controls.focusFrame)) <= PLAYHEAD_GRAB && x >= layout.view.x0;
    e.currentTarget.style.cursor = nearHead ? "ew-resize" : hit.kind === "clip" ? (controls.timelineTool === "split" ? "crosshair" : hit.edge ? "col-resize" : "pointer") : "default";
    // The preview axis: the player shows the frame under the pointer (not while playing).
    if (controls.previewAxis && !controls.isPlaying && x >= layout.view.x0) {
      const frame = Math.max(0, Math.min(useClipStore.getState().clipDuration, Math.round(frameAt(layout.view, x))));
      controls.setHoverFrame(frame);
      skimSound(frame);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = scene.current;
    const g = s.gesture;
    if (!g) return;
    if (g.kind === "press") {
      s.gesture = null;
      if (g.hit.kind === "clip") {
        if (g.reselect) useControlsStore.getState().setSelectedClipIds(stickSelection(useClipStore.getState().clips, [g.reselect]));
      } else seek(local(e).x, true);
      return;
    }
    if (g.kind === "scrub") seek(local(e).x, true, true, e.metaKey);
    end(true);
  };

  /** Right click: a marker's, a transition's or a keyframe's menu; else a clip's (locked tracks get none) or a track's empty space's; nothing on the ruler. */
  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const layout = layoutOf();
    if (!layout) return;
    const { x, y } = local(e);
    const controls = useControlsStore.getState();
    const marker = markerAt(layout, useClipStore.getState().markers, x, y);
    if (marker) return openMarkerMenu(marker.id, e.clientX, e.clientY);
    const key = keyframeAt(keyMarks(layout, new Set(controls.selectedClipIds), controls.focusFrame), x, y);
    if (key) return openKeyframeMenu(key.clipId, key.frame, e.clientX, e.clientY);
    const tr = transitionAt(transitionMarks(layout, useClipStore.getState().clips, controls.fps || 24, controls.selectedTransitionId, null), x, y);
    if (tr) return openTransitionMenu(tr.mark.clipId, e.clientX, e.clientY);
    const hit = hitTest(layout, x, y, canTrim);
    if (hit.kind === "clip") {
      if (hit.box.row.track.locked) return;
      openClipMenu(hit.box.id, e.clientX, e.clientY);
    } else if (hit.kind === "row") {
      // The playhead moves to the click first, as on the old timeline.
      const frame = Math.max(0, Math.round(hit.frame));
      controls.setFocusAnchorRatio(Math.max(0, Math.min(1, (x - layout.view.x0) / layout.view.width)));
      controls.setFocusFrame(frame, false);
      openTrackSpaceMenu(hit.row.track.timelineId, frame, e.clientX, e.clientY);
    }
  };

  /** Double click on a clip: a compound opens, a text template opens its words. */
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const layout = layoutOf();
    if (!layout) return;
    const { x, y } = local(e);
    const hit = hitTest(layout, x, y, canTrim);
    if (hit.kind === "clip" && !hit.box.row.track.locked) doubleClickClip(hit.box.id);
  };

  const onPointerLeave = () => {
    const hover = scene.current.hover;
    if (hover.cover || hover.bar || hover.bladeX != null) {
      scene.current.hover = { cover: false, bar: null, bladeX: null };
      redraw();
    }
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
      const frames = framesFor(layout.view, delta) + wheel.current.frames;
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
        <MarkerEditor anchor={areaRef} stageWidth={Math.max(1, size.width - 50)} startPadding={50} />
        {hasClips && <KeyframeGraph stageWidth={Math.max(1, size.width - 50)} />}
        {!hasClips && (
          <div className="absolute inset-0 flex items-center justify-center w-full p-8 z-10">
            <Droppable
              id="timeline"
              className="w-full rounded-[4px] border border-dashed border-[#3e3e3e] bg-[#292929] text-[#cccccc] duration-100 ease-in-out"
              accepts={["media"]}
              highlight={{ borderColor: "#A477C4", textColor: "#FFFFFF", bgColor: "#A477C4" }}
            >
              <div className="w-full py-6 px-10 rounded-lg flex items-center">
                <h4 className="mx-auto flex items-center flex-row leading-none gap-x-3.5 font-sans">
                  <GoFileMedia className="w-5 h-5" />
                  <span className="text-[12px] font-light font-poppins leading-none">Drag and drop media to start creating</span>
                </h4>
              </div>
            </Droppable>
          </div>
        )}
        <canvas
          ref={overlayRef}
          data-testid="timeline-canvas"
          className="absolute inset-0 w-full h-full touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => end(false)}
          onPointerLeave={onPointerLeave}
          onContextMenu={onContextMenu}
          onDoubleClick={onDoubleClick}
        />
      </div>
    </div>
  );
};

export default TimelineSurface;
