// CapCut's timeline shortcuts: playback and stepping, split, delete left and right, markers,
// the magnet and snapping toggles, selection, timeline zoom and the keyframe graph. The keyboard handler in
// Controls.tsx passes keys here first; the list the Shortcuts menu shows is lib/shortcuts.ts.
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { MIN_DURATION } from "./settings";
import type { ZoomLevel } from "./types";
import { isClipLocked } from "./timeline-edit";
import { useKeyframeGraphStore } from "./timeline-keyframes";

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

/**
 * Handle a timeline shortcut. True when the key was one (the caller stops there). Keys typed
 * into a field never get here.
 */
export function handleTimelineKey(e: KeyboardEvent): boolean {
  // A menu or list that's open (Radix's) took the key itself: arrows move through it.
  if (e.defaultPrevented) return false;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  const controls = useControlsStore.getState();
  const clips = useClipStore.getState();
  const done = () => {
    e.preventDefault();
    return true;
  };

  // Play / pause.
  if (e.code === "Space" && !mod) {
    if (controls.isPlaying) controls.pause();
    else controls.play();
    return done();
  }
  // Split at the playhead (⌘B), and across every track (⇧⌘B).
  if (mod && e.code === "KeyB") {
    clips.splitAtPlayhead(controls.focusFrame, e.shiftKey ? "all" : controls.selectedClipIds);
    return done();
  }
  // Extract audio from the selected video (⇧⌘S).
  if (mod && e.shiftKey && e.code === "KeyS") {
    const video = controls.selectedClipIds.map((id) => clips.getClipById(id)).find((c) => c?.type === "video");
    if (video && !(video as any).linkId) clips.separateClip(video.clipId);
    return done();
  }
  // Select every clip that isn't on a locked track (⌘A).
  if (mod && key === "a" && !e.shiftKey) {
    controls.setSelectedClipIds(clips.clips.filter((c) => !c.hidden && !isClipLocked(clips.clips, clips.timelines, c, controls.linkage)).map((c) => c.clipId));
    return done();
  }
  // Timeline zoom in and out (⌘= / ⌘−).
  if (mod && (e.key === "=" || e.key === "+" || e.key === "-")) {
    zoomTimelineTo(controls.zoomLevel + (e.key === "-" ? -1 : 1));
    return done();
  }
  // The selected clip's keyframe graph (⌥K; by its key, ⌥ changes the letter).
  if (e.altKey && !mod && e.code === "KeyK") {
    useKeyframeGraphStore.getState().toggle();
    return done();
  }
  if (mod || (e.altKey && !["ArrowLeft", "ArrowRight"].includes(e.key))) return false;

  switch (e.key) {
    // Frames: ← / →, ten with ⇧; with ⌥, the previous or next marker.
    case "ArrowLeft":
    case "ArrowRight": {
      const forward = e.key === "ArrowRight";
      if (e.altKey) goToMarker(forward);
      else seekTo(controls.focusFrame + (forward ? 1 : -1) * (e.shiftKey ? 10 : 1));
      return done();
    }
    // The previous or next edit: a clip's start or end on any track.
    case "ArrowUp":
    case "ArrowDown": {
      const edges = clips.clips.filter((c) => !c.hidden).flatMap((c) => [c.startFrame ?? 0, c.endFrame ?? 0]);
      const to = nextStop([0, ...edges], controls.focusFrame, e.key === "ArrowDown");
      if (to != null) seekTo(to);
      return done();
    }
    case "Home":
      seekTo(0);
      return done();
    case "End":
      seekTo(clips.clipDuration);
      return done();
  }

  // Letters without ⇧ (⇧Z is zoom to fit).
  if (e.shiftKey) {
    if (key === "z") {
      zoomTimelineTo(controls.minZoomLevel);
      return done();
    }
    return false;
  }
  switch (key) {
    case "q":
      deleteToPlayhead("left");
      return done();
    case "w":
      deleteToPlayhead("right");
      return done();
    case "m":
      addMarkerAtPlayhead();
      return done();
    case "n":
      controls.setSnapping(!controls.snapping);
      return done();
    case "p":
      clips.setMagnet(!clips.magnet);
      return done();
    case "`":
      controls.setLinkage(!controls.linkage);
      return done();
    // Select what's left or right of the playhead: the clips that start before it, or end
    // after it.
    case "[":
    case "]": {
      const f = controls.focusFrame;
      const picked = clips.clips.filter(
        (c) => !c.hidden && !isClipLocked(clips.clips, clips.timelines, c, controls.linkage) && (key === "[" ? (c.startFrame ?? 0) < f : (c.endFrame ?? 0) > f),
      );
      controls.setSelectedClipIds(picked.map((c) => c.clipId));
      return done();
    }
  }
  return false;
}
