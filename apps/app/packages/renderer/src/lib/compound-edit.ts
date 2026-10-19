// Opening a compound clip's timeline to edit it, and coming back (CapCut's double-click on a
// compound, and the "‹ Compound clip1" bar). The editor's clips and tracks are swapped for the
// compound's content, the timelines left being kept in the clip store's `compoundStack`; every
// edit goes through the same tools and undo as the main timeline's. Opening and closing
// aren't steps of their own (the history keeps the stack with each state, so undo follows the
// edit it undoes there). See lib/compound.ts and docs/plan/app-engine-integration.md.
import { useClipStore, resolveOverlaps, resolveOverlapsTimelines } from "./clip";
import { mainTrackOf } from "./timeline-edit";
import { useControlsStore } from "./control";
import { withoutHistory } from "./history";
import { MIN_DURATION } from "./settings";
import { afterEdit, allClips, contentLength, isCompound, mapClips, type CompoundFrame } from "./compound";

/** How wide the timeline's baseline is for a timeline `length` frames long (the longest clip takes 60% at zoom 1; see `_updateZoomLevel`). */
const baselineFor = (length: number) => Math.max(MIN_DURATION, Math.round((Math.max(0, length) * 5) / 3));

/** Open a compound clip's timeline in the editor. False when the clip isn't a compound. */
export function openCompound(clipId: string): boolean {
  const store = useClipStore.getState();
  const clip = store.clips.find((c) => c.clipId === clipId);
  if (!isCompound(clip)) return false;
  const controls = useControlsStore.getState();
  const length = contentLength(clip.compound);
  const frame: CompoundFrame = {
    clipId,
    clips: store.clips,
    timelines: store.timelines,
    clipDuration: store.clipDuration,
    playhead: controls.focusFrame,
    length,
    view: { total: controls.totalTimelineFrames, window: [...controls.timelineDuration] as [number, number], zoom: controls.zoomLevel },
  };
  if (controls.isPlaying) controls.pause();
  // The playhead keeps its place in the clip: the content frame it shows.
  const into = controls.focusFrame - (clip.startFrame ?? 0) + Math.max(0, clip.trimStart ?? 0);
  const inside = controls.focusFrame >= (clip.startFrame ?? 0) && controls.focusFrame < (clip.endFrame ?? 0);
  withoutHistory(() => {
    useClipStore.setState({
      clips: clip.compound.clips,
      timelines: resolveOverlapsTimelines(clip.compound.timelines),
      clipDuration: length,
      compoundStack: [...store.compoundStack, frame],
      mainPreview: null,
    });
    const total = baselineFor(length);
    useControlsStore.setState({ totalTimelineFrames: total, timelineDuration: [0, total], zoomLevel: 1 as any, selectedClipIds: [], selectedMaskId: null });
    useControlsStore.getState().setFocusFrame(inside ? Math.max(0, Math.min(Math.max(0, length - 1), into)) : 0, false);
  });
  return true;
}

/** Close the compound being edited (`levels` of them), back to the timeline it was opened from; the compound shows what was done in it. */
export function closeCompound(levels = 1): boolean {
  let closed = false;
  for (let i = 0; i < levels && useClipStore.getState().compoundStack.length > 0; i++) {
    const store = useClipStore.getState();
    const stack = store.compoundStack;
    const frame = stack[stack.length - 1];
    const controls = useControlsStore.getState();
    if (controls.isPlaying) controls.pause();
    withoutHistory(() => {
      // The compound takes the content as edited (and its new length, if it played all of it).
      const clips = resolveOverlaps(
        frame.clips.map((c) => (c.clipId === frame.clipId && isCompound(c) ? afterEdit(c, { clips: store.clips, timelines: store.timelines }, frame.length) : c)),
      );
      const clipDuration = clips.reduce((m, c) => Math.max(m, c.endFrame || 0), 0);
      useClipStore.setState({ clips, timelines: frame.timelines, clipDuration, compoundStack: stack.slice(0, -1), mainPreview: null });
      useControlsStore.setState({
        totalTimelineFrames: frame.view.total,
        timelineDuration: frame.view.window,
        zoomLevel: frame.view.zoom,
        selectedClipIds: [frame.clipId],
        selectedMaskId: null,
      });
      useControlsStore.getState().setFocusFrame(frame.playhead, false);
    });
    closed = true;
  }
  return closed;
}

/** Close every compound being edited, back to the main timeline. */
export const closeAllCompounds = () => closeCompound(useClipStore.getState().compoundStack.length);

/** Give a compound clip a name (the Subprojects library renames its items), wherever it is in the timeline being edited. */
export function renameCompound(clipId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { clips } = useClipStore.getState();
  const renamed = mapClips(clips, (c) => (c.clipId === clipId && isCompound(c) && c.name !== trimmed ? { ...c, name: trimmed } : c));
  if (renamed !== clips) useClipStore.setState({ clips: renamed });
}

/**
 * Another instance of a compound clip (the Subprojects library's "+" and its drag): a copy of it,
 * its content copied with fresh ids and played whole, on the main track at `frame` (the playhead
 * by default), made like a paste (so the magnet makes room, and it's selected). One step.
 * Returns the new clip's id, or null when `clipId` isn't a compound in the timeline being edited.
 */
export function addCompoundInstance(clipId: string, frame?: number): string | null {
  const store = useClipStore.getState();
  const source = allClips(store.clips).find((c) => c.clipId === clipId);
  if (!isCompound(source)) return null;
  const at = Math.max(0, Math.round(frame ?? useControlsStore.getState().focusFrame));
  const whole = { ...source, startFrame: 0, endFrame: Math.max(1, contentLength(source.compound)), trimStart: 0, trimEnd: 0 };
  // Pasting does the placing; the user's own clipboard stays as it was.
  const kept = store.clipboard;
  useClipStore.setState({ clipboard: [whole] });
  store.pasteClips(at, mainTrackOf(store.timelines)?.timelineId);
  useClipStore.setState({ clipboard: kept });
  return useControlsStore.getState().selectedClipIds[0] ?? null;
}
