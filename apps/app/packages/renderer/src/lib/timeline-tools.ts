// The timeline toolbar's tools: the Split blade (B) and the preview axis, which both work from
// the frame under the mouse. Select leftward and rightward are in lib/timeline-shortcuts.ts.
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { TIME_ZERO_X } from "./timeline-geometry";
import { SNAP_PX, snapPoints, snapToPoints } from "./timeline-edit";

/** The frame under a pointer at stage x (the visible window starts at TIME_ZERO_X). */
export function frameAtStageX(x: number, stageWidth: number): number {
  const [start, end] = useControlsStore.getState().timelineDuration;
  return Math.round(start + ((x - TIME_ZERO_X) / Math.max(1, stageWidth)) * (end - start));
}

/** Where a frame sits on the stage, in px. */
export function stageXOfFrame(frame: number, stageWidth: number): number {
  const [start, end] = useControlsStore.getState().timelineDuration;
  return TIME_ZERO_X + ((frame - start) / Math.max(1, end - start)) * stageWidth;
}

/**
 * Where the blade cuts for a pointer at `frame`: with auto snapping on, a clip edge, marker or
 * the playhead within a few px, as the playhead snaps; else the frame itself.
 */
export function bladeFrame(frame: number, stageWidth: number): number {
  const controls = useControlsStore.getState();
  if (!controls.snapping) return frame;
  const { clips, markers } = useClipStore.getState();
  const [start, end] = controls.timelineDuration;
  const hit = snapToPoints([frame], snapPoints(clips, { playhead: controls.focusFrame, markers, exclude: new Set() }), (SNAP_PX * Math.max(1, end - start)) / Math.max(1, stageWidth));
  return hit ? hit.point : frame;
}

/** Cut `clipId` (and what's linked to it) at the blade's frame; false when it isn't inside the clip. */
export function bladeCut(clipId: string, frame: number): boolean {
  const before = useClipStore.getState().clips;
  useClipStore.getState().splitClip(frame, clipId);
  return useClipStore.getState().clips !== before;
}
