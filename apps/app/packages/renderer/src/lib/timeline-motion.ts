// The timeline's timing tools beside the Speed tab, as CapCut has them in the toolbar's
// transform tools (▾) and the clip menu's Edit ›: Freeze (a 3 s still of the frame at the
// playhead) and Reverse. Which clip each acts on, and the action, through the store's
// `freezeFrame` and `setReverse` (lib/speed.ts does the maths).
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { mainTrackOf } from "./timeline-edit";
import type { AnyClipProps, TimelineProps, VideoClipProps } from "./types";

const under = (c: AnyClipProps, frame: number) => !c.hidden && frame > (c.startFrame ?? 0) && frame < (c.endFrame ?? 0);

/**
 * The clip Freeze works on: a selected video under the playhead, else the main track's video
 * there; none on a freeze already or off every video.
 */
export const freezeTarget = (clips: AnyClipProps[], timelines: TimelineProps[], frame: number, selected: string[]): VideoClipProps | undefined => {
  const ok = (c: AnyClipProps | undefined): c is VideoClipProps => !!c && c.type === "video" && !(c as VideoClipProps).freeze && under(c, frame);
  const picked = selected.map((id) => clips.find((c) => c.clipId === id)).find(ok);
  if (picked) return picked;
  const main = mainTrackOf(timelines);
  return clips.find((c) => c.timelineId === main?.timelineId && ok(c)) as VideoClipProps | undefined;
};

/** Freeze at the playhead (the still is selected); false when there's nothing to freeze. */
export const freezeAtPlayhead = (clipId?: string): boolean => {
  const { clips, timelines, freezeFrame } = useClipStore.getState();
  const { focusFrame, selectedClipIds } = useControlsStore.getState();
  const target = freezeTarget(clips, timelines, focusFrame, clipId ? [clipId] : selectedClipIds);
  return !!target && freezeFrame(target.clipId, focusFrame) != null;
};

/**
 * The clip Reverse works on: the selected video (not a freeze frame). CapCut offers it on
 * videos only; a video's detached sound follows it (the store reverses linked clips).
 */
export const reverseTarget = (clips: AnyClipProps[], selected: string[]): VideoClipProps | undefined => {
  const c = clips.find((x) => x.clipId === selected[selected.length - 1]);
  return c && c.type === "video" && !(c as VideoClipProps).freeze ? (c as VideoClipProps) : undefined;
};

/** Reverse the selected clip, or put it back. */
export const toggleReverse = (clipId?: string) => {
  const { clips, setReverse } = useClipStore.getState();
  const target = reverseTarget(clips, clipId ? [clipId] : useControlsStore.getState().selectedClipIds);
  if (target) setReverse(target.clipId, !target.reverse);
};
