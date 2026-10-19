// Adding a media card to the timeline without dragging it: the "+" on a hovered card, and the
// card's In/Out handles (only that range goes on). A video or photo lands on the main track at
// the cut nearest the playhead (the clips after it making room), or a first track; audio on a new
// audio track at the playhead. All of it is one undo step. The drag-and-drop route lives in
// TimelineEditor's handleDrop.
import type { MediaItem } from "@/components/media/Item";
import type { ImageClipProps, VideoClipProps } from "../types";

/** A part of a card's media, in seconds from its start. */
export type MediaRange = { inSec: number; outSec: number };

/** The clip's id, or null when the card has no readable media. */
export const addMediaAtPlayhead = async (item: MediaItem, opts: { startFrame?: number; range?: MediaRange } = {}): Promise<string | null> => {
  const info = item.mediaInfo;
  if (!info || item.missing) return null;
  const [{ v4: uuidv4 }, { useClipStore, getTimelineTypeForClip, getTimelineHeightForClip }, { useControlsStore }, { useViewportStore }, { imageDurationFrames }, { mainTrackOf, insertionFrame }, { TIME_ZERO_X }, { addSoundAtPlayhead }] =
    await Promise.all([
      import("uuid"),
      import("../clip"),
      import("../control"),
      import("../viewport"),
      import("../preferences"),
      import("../timeline-edit"),
      import("../timeline-geometry"),
      import("../audio-tools"),
    ]);

  const controls = useControlsStore.getState();
  const fps = controls.fps || 24;
  const whole = info.duration ?? 0;
  const inSec = Math.max(0, Math.min(opts.range?.inSec ?? 0, whole));
  const outSec = Math.max(inSec, Math.min(opts.range?.outSec ?? whole, whole));
  const ranged = item.type !== "image" && !!opts.range && (inSec > 0 || outSec < whole);

  if (item.type === "audio") {
    const clip = addSoundAtPlayhead(item.assetUrl, ranged ? outSec - inSec : whole, item.credit);
    if (ranged) useClipStore.getState().updateClip(clip.clipId, { trimStart: Math.round(inSec * fps), trimEnd: Math.max(0, Math.round((whole - outSec) * fps)) });
    return clip.clipId;
  }

  const video = item.type === "video";
  const width = video ? info.video?.displayWidth : info.image?.width;
  const height = video ? info.video?.displayHeight : info.image?.height;
  const numFrames = Math.max(1, video ? Math.round((ranged ? outSec - inSec : whole) * fps) : imageDurationFrames(fps));

  const store = useClipStore.getState();
  const mainFound = mainTrackOf(store.timelines);
  const startAt = Math.max(0, Math.round(opts.startFrame ?? controls.focusFrame));
  let timelineId = mainFound?.timelineId;
  let startFrame = startAt;
  const hadMedia = store.clips.some((c) => c.type === "video" || c.type === "image");
  if (!timelineId) {
    timelineId = uuidv4();
    store.addTimeline({ type: getTimelineTypeForClip({ type: video ? "video" : "image" } as never), timelineId, timelinePadding: TIME_ZERO_X, timelineWidth: 0, timelineY: 0, timelineHeight: getTimelineHeightForClip(video ? "video" : "image") });
    startFrame = 0;
  } else {
    startFrame = insertionFrame(store.clips, store.timelines, startAt);
  }
  const asset = useClipStore.getState().addAsset({ path: item.assetUrl, type: video ? "video" : "image", duration: video ? whole : 0, credit: item.credit });
  const clip = {
    timelineId,
    clipId: uuidv4(),
    startFrame,
    endFrame: startFrame + numFrames,
    type: video ? "video" : "image",
    trimStart: video ? (ranged ? Math.round(inSec * fps) : 0) : Infinity,
    trimEnd: video ? (ranged ? Math.max(0, Math.round((whole - outSec) * fps)) : 0) : -Infinity,
    speed: 1,
    assetId: asset.id,
    masks: [],
    ...(width && height ? { mediaWidth: width, mediaHeight: height, mediaAspectRatio: width / height } : {}),
  } as unknown as VideoClipProps | ImageClipProps;
  if (!hadMedia && width && height) {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(Math.round(width), Math.round(height)) || 1;
    useViewportStore.getState().setAspectRatio({ width: Math.round(width), height: Math.round(height), id: `${Math.round(width / g)}:${Math.round(height / g)}` });
  }
  useClipStore.getState().addClip(clip as never);
  useControlsStore.getState().setSelectedClipIds([clip.clipId]);
  return clip.clipId;
};
