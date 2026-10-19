// CapCut's timeline and player shortcuts: playback and stepping, split, delete left and right,
// markers, the magnet and snapping toggles, selection, timeline zoom, the keyframe graph, the
// transform tools and the player's zoom. The keyboard handler in Controls.tsx passes keys here
// first; which key is which action is lib/keymap.ts's (the Shortcuts window changes it).
import { useClipStore } from "./clip";
import { zoomFit, zoomIn, zoomOut } from "./player-zoom";
import { usePlayerStore } from "./player";
import { useControlsStore } from "./control";
import { MIN_DURATION } from "./settings";
import type { ZoomLevel } from "./types";
import { isClipLocked } from "./timeline-edit";
import { useKeyframeGraphStore } from "./timeline-keyframes";
import { useViewportStore } from "./viewport";
import { actionFor } from "./keymap";
import { preferences } from "./preferences";
import { freezeAtPlayhead, reverseTarget, toggleReverse } from "./timeline-motion";
import { rotate90, toggleFlip } from "./transform-presets";
import { createAndOpenProject } from "./project-actions";
import { runCommand } from "./commands";
import { useSidebarStore } from "./sidebar";
import { useShellStore } from "./shell";
import { MARKER_COLORS } from "./timeline-edit";
import { keyframeAt, keyframeableProperties, localFrame, setKeyframe, valueAt } from "./keyframes";
import { shuttle, shuttleRate, stopShuttle } from "./shuttle";

/** The zoom level before Zoom to fit, which a second press goes back to. */
let beforeFit: number | null = null;

/** Zoom to fit (Shift+Z): the whole timeline in view; pressed again, back to the zoom it was. */
export function toggleZoomToFit() {
  const c = useControlsStore.getState();
  if (c.zoomLevel === c.minZoomLevel && beforeFit != null && beforeFit !== c.minZoomLevel) {
    zoomTimelineTo(beforeFit);
    beforeFit = null;
  } else {
    if (c.zoomLevel !== c.minZoomLevel) beforeFit = c.zoomLevel;
    zoomTimelineTo(c.minZoomLevel);
  }
}

/**
 * Zoom the timeline to `level` (1 shows the whole project, 10 a few frames), keeping the
 * playhead where it is on screen.
 */
export function zoomTimelineTo(level: number) {
  const c = useControlsStore.getState();
  const clamped = Math.max(c.minZoomLevel, Math.min(c.maxZoomLevel, Math.round(level)));
  // Level 1 spans the whole timeline's baseline and the last level MIN_DURATION frames.
  const maxDuration = Math.max(1, c.totalTimelineFrames);
  const minDuration = Math.max(1, Math.min(MIN_DURATION, maxDuration));
  const steps = Math.max(1, c.maxZoomLevel - c.minZoomLevel);
  const t = (clamped - c.minZoomLevel) / steps;
  const duration = Math.max(minDuration, Math.min(maxDuration, Math.round(maxDuration * Math.pow(minDuration / maxDuration, t))));
  let start = Math.round(c.focusFrame - c.focusAnchorRatio * duration);
  start = Math.max(0, Math.min(start, Math.max(0, c.totalTimelineFrames - duration)));
  c.setFocusAnchorRatio(duration > 0 ? (c.focusFrame - start) / duration : 0.5);
  c.setTimelineDuration(start, start + duration);
  c.setZoomLevel(clamped as ZoomLevel);
}

/** Move the playhead (paused) and keep it on screen. */
const seekTo = (frame: number) => {
  const c = useControlsStore.getState();
  const end = useClipStore.getState().clipDuration;
  if (c.isPlaying) c.pause();
  c.setFocusFrame(Math.max(0, Math.min(end, Math.round(frame))), false);
  c.setIsAccurateSeekNeeded(true);
};

/** The next (or previous) clip edge or marker after (before) the playhead. */
const nextStop = (frames: number[], from: number, forward: boolean) => {
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  return forward ? sorted.find((f) => f > from) : [...sorted].reverse().find((f) => f < from);
};

/** Add a marker at the playhead (CapCut's M), or pick the one there; it becomes selected. */
export function addMarkerAtPlayhead() {
  const id = useClipStore.getState().addMarker(useControlsStore.getState().focusFrame);
  useControlsStore.getState().setSelectedMarkerId(id);
  return id;
}

/**
 * Add a marker at the playhead in the next colour of the cycle after the nearest marker before
 * it (⌥M); a marker already there changes colour instead.
 */
export function addMarkerNewColor() {
  const { markers, addMarker, updateMarker } = useClipStore.getState();
  const frame = Math.max(0, Math.round(useControlsStore.getState().focusFrame));
  const at = markers.find((m) => m.frame === frame);
  const before = at ?? [...markers].reverse().find((m) => m.frame < frame) ?? markers[markers.length - 1];
  const i = before ? MARKER_COLORS.findIndex((c) => c.toLowerCase() === before.color.toLowerCase()) : 0;
  const color = MARKER_COLORS[(i + 1) % MARKER_COLORS.length];
  const id = at ? at.id : addMarker(frame);
  updateMarker(id, { color });
  useControlsStore.getState().setSelectedMarkerId(id);
  return id;
}

/** The transform's properties: what ⇧⌥K keys (an audio clip's volume, else all it can). */
const MOVES = ["position", "scale", "rotation", "opacity"];

/**
 * Add keyframes at the playhead on the selected clip (⇧⌥K): its place, size, turn and opacity
 * (its volume for audio), each with its value there. Keys already there stay; none is removed.
 */
export function addKeyframeAtPlayhead() {
  const { selectedClipIds, focusFrame, fps, isPlaying, pause } = useControlsStore.getState();
  const clips = useClipStore.getState();
  const clip = clips.getClipById(selectedClipIds[selectedClipIds.length - 1] ?? "");
  if (!clip || focusFrame < (clip.startFrame ?? 0) || focusFrame > (clip.endFrame ?? 0)) return false;
  const all = keyframeableProperties(clip);
  const moves = all.filter((p) => MOVES.includes(p));
  const local = localFrame(clip, focusFrame);
  let keyframes = clip.keyframes;
  for (const p of moves.length ? moves : all) {
    if (keyframeAt(keyframes, p, local)) continue;
    const value = valueAt({ ...clip, keyframes }, p, focusFrame, fps);
    if (value !== undefined) keyframes = setKeyframe(keyframes, p, local, value);
  }
  if (keyframes === clip.keyframes) return false;
  if (isPlaying) pause();
  clips.updateClip(clip.clipId, { keyframes });
  return true;
}

/** Go to the previous or next marker. */
export function goToMarker(forward: boolean) {
  const { markers } = useClipStore.getState();
  const to = nextStop(markers.map((m) => m.frame), useControlsStore.getState().focusFrame, forward);
  if (to == null) return;
  seekTo(to);
  useControlsStore.getState().setSelectedMarkerId(markers.find((m) => m.frame === to)?.id ?? null);
}

/** Delete left or right of the playhead (Q / W) on the selected clips or the main track. */
export function deleteToPlayhead(side: "left" | "right") {
  const c = useControlsStore.getState();
  return useClipStore.getState().trimToPlayhead(side, c.focusFrame, c.selectedClipIds);
}

/** Select what's left or right of the playhead: the clips that start before it, or end after it. */
export const selectBeside = (side: "left" | "right") => {
  const controls = useControlsStore.getState();
  const clips = useClipStore.getState();
  const f = controls.focusFrame;
  const picked = clips.clips.filter(
    (c) => !c.hidden && !isClipLocked(clips.clips, clips.timelines, c, controls.linkage) && (side === "left" ? (c.startFrame ?? 0) < f : (c.endFrame ?? 0) > f),
  );
  controls.setSelectedClipIds(picked.map((c) => c.clipId));
};

/** The selected (else the last selected) video or photo, for Mirror and Rotate. */
const visualTarget = () => {
  const { selectedClipIds } = useControlsStore.getState();
  return useClipStore.getState().clips.find((c) => c.clipId === selectedClipIds[selectedClipIds.length - 1] && (c.type === "video" || c.type === "image"));
};

/** The previous or next edit: a clip's start or end on any track. */
const goToEdit = (forward: boolean) => {
  const clips = useClipStore.getState();
  const edges = clips.clips.filter((c) => !c.hidden).flatMap((c) => [c.startFrame ?? 0, c.endFrame ?? 0]);
  const to = nextStop([0, ...edges], useControlsStore.getState().focusFrame, forward);
  if (to != null) seekTo(to);
};

/** Edit › Step forward or back many frames. */
const stepMany = () => Math.max(1, Math.round(preferences().stepFrames || 10));

/**
 * What the timeline's and the player's actions do (lib/keymap.ts names them and the Shortcuts
 * window binds them to keys). Editing (undo, copy, delete, group…) is Controls.tsx's.
 */
const RUN: Record<string, () => void> = {
  playPause: () => {
    const c = useControlsStore.getState();
    if (shuttleRate() !== 0) stopShuttle();
    else if (c.isPlaying) c.pause();
    else c.play();
  },
  // Split at the playhead, and across every track.
  split: () => {
    const c = useControlsStore.getState();
    useClipStore.getState().splitAtPlayhead(c.focusFrame, c.selectedClipIds);
  },
  splitAll: () => useClipStore.getState().splitAtPlayhead(useControlsStore.getState().focusFrame, "all"),
  // Extract audio from the selected video.
  extractAudio: () => {
    const clips = useClipStore.getState();
    const video = useControlsStore.getState().selectedClipIds.map((id) => clips.getClipById(id)).find((c) => c?.type === "video");
    if (video && !(video as any).linkId) clips.separateClip(video.clipId);
  },
  // Every clip that isn't on a locked track.
  selectAll: () => {
    const controls = useControlsStore.getState();
    const clips = useClipStore.getState();
    controls.setSelectedClipIds(clips.clips.filter((c) => !c.hidden && !isClipLocked(clips.clips, clips.timelines, c, controls.linkage)).map((c) => c.clipId));
  },
  zoomIn: () => zoomTimelineTo(useControlsStore.getState().zoomLevel + 1),
  zoomOut: () => zoomTimelineTo(useControlsStore.getState().zoomLevel - 1),
  zoomToFit: () => toggleZoomToFit(),
  keyframePanel: () => useKeyframeGraphStore.getState().toggle(),
  prevFrame: () => seekTo(useControlsStore.getState().focusFrame - 1),
  nextFrame: () => seekTo(useControlsStore.getState().focusFrame + 1),
  stepBackMany: () => seekTo(useControlsStore.getState().focusFrame - stepMany()),
  stepForwardMany: () => seekTo(useControlsStore.getState().focusFrame + stepMany()),
  prevMarker: () => goToMarker(false),
  nextMarker: () => goToMarker(true),
  prevEdit: () => goToEdit(false),
  nextEdit: () => goToEdit(true),
  firstFrame: () => seekTo(0),
  lastFrame: () => seekTo(useClipStore.getState().clipDuration),
  deleteLeft: () => void deleteToPlayhead("left"),
  deleteRight: () => void deleteToPlayhead("right"),
  addMarker: () => void addMarkerAtPlayhead(),
  addMarkerColor: () => void addMarkerNewColor(),
  addKeyframe: () => void addKeyframeAtPlayhead(),
  shuttleLeft: () => shuttle(false),
  shuttleRight: () => shuttle(true),
  shuttleStop: () => stopShuttle(),
  snapping: () => {
    const c = useControlsStore.getState();
    c.setSnapping(!c.snapping);
  },
  magnet: () => {
    const clips = useClipStore.getState();
    clips.setMagnet(!clips.magnet);
  },
  linkage: () => {
    const c = useControlsStore.getState();
    c.setLinkage(!c.linkage);
  },
  selectMode: () => useControlsStore.getState().setTimelineTool("select"),
  splitMode: () => useControlsStore.getState().setTimelineTool("split"),
  previewAxis: () => {
    const c = useControlsStore.getState();
    c.setPreviewAxis(!c.previewAxis);
  },
  // V is the pointer tool, and with the pointer tool already in use and clips selected,
  // CapCut's Deactivate clip.
  activateClip: () => {
    const viewport = useViewportStore.getState();
    const selected = useControlsStore.getState().selectedClipIds;
    if (viewport.tool === "pointer" && selected.length > 0) useClipStore.getState().setClipsDeactivated(selected);
    else viewport.setTool("pointer");
  },
  selectLeft: () => selectBeside("left"),
  selectRight: () => selectBeside("right"),
  // The toolbar's transform tools.
  freeze: () => void freezeAtPlayhead(),
  reverse: () => {
    if (reverseTarget(useClipStore.getState().clips, useControlsStore.getState().selectedClipIds)) toggleReverse();
  },
  mirror: () => {
    const v = visualTarget();
    if (v) useClipStore.getState().updateClip(v.clipId, toggleFlip(v, "horizontal"));
  },
  rotate: () => {
    const v = visualTarget();
    if (v) useClipStore.getState().updateClip(v.clipId, rotate90(v, 1));
  },
  // The player.
  fullScreenPreview: () => {
    const c = useControlsStore.getState();
    c.setIsFullscreen(!c.isFullscreen);
  },
  // The zoom popover's steps (lib/player-zoom.ts): 10% of fit, 50–400%.
  zoomInPlayer: () => zoomIn(),
  zoomOutPlayer: () => zoomOut(),
  zoomFitPlayer: () => zoomFit(),
  showRulers: () => {
    const p = usePlayerStore.getState();
    p.setRulers(!p.rulers);
  },
  showGuides: () => {
    const p = usePlayerStore.getState();
    p.setShowGuides(!p.showGuides);
  },
  zoom50Player: () => useViewportStore.getState().setScalePercent(50),
  zoom100Player: () => useViewportStore.getState().setScalePercent(100),
  zoom200Player: () => useViewportStore.getState().setScalePercent(200),
  // The project.
  newProject: () => void createAndOpenProject().catch(() => {}),
  // The Media tab's picker, as the home screen's Import media opens it.
  importMedia: () => {
    useSidebarStore.getState().openSection("media");
    useShellStore.getState().setImportOnOpen(true);
  },
  export: () => void runCommand("export"),
};

/**
 * Handle a timeline or player shortcut, as the keymap binds it. True when the key was one (the
 * caller stops there). Keys typed into a field never get here.
 */
export function handleTimelineKey(e: KeyboardEvent): boolean {
  // A menu or list that's open (Radix's) took the key itself: arrows move through it.
  if (e.defaultPrevented) return false;
  const id = actionFor(e);
  const run = id ? RUN[id] : undefined;
  if (!run) return false;
  // A held J or L is one press.
  if (e.repeat && id?.startsWith("shuttle")) {
    e.preventDefault();
    return true;
  }
  run();
  e.preventDefault();
  return true;
}

/** Run an action by its id, as its key does (the menu bar's items). False when it isn't one. */
export function runAction(id: string): boolean {
  const run = RUN[id];
  if (!run) return false;
  run();
  return true;
}
