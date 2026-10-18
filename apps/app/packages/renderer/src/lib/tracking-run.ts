// Running motion tracking from the Tracking tab and Track mask: the region being drawn on the
// canvas, the engine's track (engine/crates/core/src/track.rs, through the main process) with
// its progress and cancel, and its result written to the clip as keys in one edit (one undo
// step). The geometry is lib/tracking.ts.
import { create } from "zustand";
import { engineSourcePaths, engineTrack, engineTrackCancel, onEngineTrackProgress } from "@app/preload";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { useViewportStore } from "./viewport";
import { worldOf } from "./transform-presets";
import type { AnyClipProps, MaskClipProps, VideoClipProps } from "./types";
import {
  DEFAULT_TRACKING,
  TrackDirection,
  TrackingSettings,
  WorldRegion,
  clipPoseAt,
  maskTrackRequest,
  objectPoses,
  overlapFrames,
  trackRequest,
  trackedKeys,
  trackedMaskKeys,
  videoUnder,
} from "./tracking";

interface TrackingRun {
  /** Regions drawn on the canvas, by clip, before (or between) tracks. */
  regions: Record<string, WorldRegion>;
  /** The track running: the clip (and mask), frames done of the total. */
  running: { clipId: string; maskId?: string; done: number; total: number } | null;
  /** What the last track said, by clip: lost at a time, or an error. */
  notes: Record<string, string>;
  setRegion: (clipId: string, region: WorldRegion) => void;
}

export const useTrackingStore = create<TrackingRun>((set) => ({
  regions: {},
  running: null,
  notes: {},
  setRegion: (clipId, region) => set((s) => ({ regions: { ...s.regions, [clipId]: region } })),
}));

/** A clip's tracking settings (the defaults until it has some). */
export const trackingOf = (clip: AnyClipProps | undefined): TrackingSettings => ({ ...DEFAULT_TRACKING, ...((clip as any)?.tracking ?? {}) });

/** The world's size now. */
const world = () => {
  const a = useViewportStore.getState().aspectRatio;
  return worldOf(a.width / a.height);
};

/** The region a clip's tracking draws: the one being drawn, else its last, else a square a
 * quarter of the canvas tall on the clip. */
export const regionOf = (clip: AnyClipProps): WorldRegion => {
  const drawn = useTrackingStore.getState().regions[clip.clipId] ?? trackingOf(clip).region;
  if (drawn) return drawn;
  const { focusFrame, fps } = useControlsStore.getState();
  const w = world();
  const pose = clipPoseAt(clip, Math.min(Math.max(focusFrame, clip.startFrame ?? 0), (clip.endFrame ?? 1) - 1), fps || 30, w);
  const side = w.height / 4;
  return { cx: pose.centre[0], cy: pose.centre[1], width: side, height: side, rotation: 0 };
};

const timeLabel = (us: number) => {
  const s = Math.max(0, us / 1e6);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
};

/** The video file the engine reads for an asset (the original, not a proxy), and its length. */
const sourceOf = async (video: VideoClipProps) => {
  const asset = useClipStore.getState().getAssetById(video.assetId);
  if (!asset?.path) return null;
  const [path] = await engineSourcePaths([asset.path.replace(/#(video|audio)$/, "")]);
  return { path, seconds: asset.duration || undefined };
};

/** Run the engine's track with progress in the store; null when cancelled or failed (the note
 * says why). */
const run = async (clipId: string, maskId: string | undefined, request: Parameters<typeof engineTrack>[0]) => {
  useTrackingStore.setState((s) => ({ running: { clipId, maskId, done: 0, total: 0 }, notes: { ...s.notes, [clipId]: "" } }));
  const off = onEngineTrackProgress((done, total) => useTrackingStore.setState((s) => (s.running ? { running: { ...s.running, done, total } } : {})));
  try {
    const r = await engineTrack(request);
    if (!r.ok) {
      const note = r.cancelled ? "" : r.error ?? "Tracking failed";
      useTrackingStore.setState((s) => ({ notes: { ...s.notes, [clipId]: note } }));
      return null;
    }
    const lost = [r.lostForwardUs, r.lostBackwardUs].filter((t): t is number => typeof t === "number");
    if (lost.length) useTrackingStore.setState((s) => ({ notes: { ...s.notes, [clipId]: `Tracking lost at ${lost.map(timeLabel).join(" and ")} (of the video)` } }));
    return r;
  } finally {
    off();
    useTrackingStore.setState({ running: null });
  }
};

/** The frame the region was drawn on: the playhead, inside the clip. */
const frameIn = (clip: AnyClipProps) => {
  const { focusFrame } = useControlsStore.getState();
  return Math.min(Math.max(Math.round(focusFrame), clip.startFrame ?? 0), (clip.endFrame ?? 1) - 1);
};

/**
 * Track the region drawn for a text, sticker or photo through the video under it, and key the
 * clip to follow it (Start in the Tracking tab).
 */
export async function trackClip(clipId: string): Promise<boolean> {
  const store = useClipStore.getState();
  const clip = store.getClipById(clipId);
  if (!clip || useTrackingStore.getState().running) return false;
  const settings = trackingOf(clip);
  const fps = useControlsStore.getState().fps || 30;
  const frame = frameIn(clip);
  const region = regionOf(clip);
  const order = (store.timelines ?? []).map((t) => t.timelineId);
  const video = videoUnder(store.clips, order, clip, frame, fps, [region.cx, region.cy]);
  const note = (text: string) => useTrackingStore.setState((s) => ({ notes: { ...s.notes, [clipId]: text } }));
  if (!video) {
    note("There's no video under the clip to track.");
    return false;
  }
  const range = overlapFrames(clip, video);
  const source = await sourceOf(video);
  const request = range && source && trackRequest(video, region, frame, range, fps, source.path, source.seconds, settings.direction);
  if (!range || !source || !request) {
    note("The video isn't on the canvas there.");
    return false;
  }
  const r = await run(clipId, undefined, request);
  if (!r) return false;
  const now = useClipStore.getState().getClipById(clipId);
  if (!now) return false;
  const poses = objectPoses(video, r.samples, range, fps, source.seconds);
  const keyframes = trackedKeys(now, poses, frame, settings, fps, world());
  const tracking: TrackingSettings = { ...settings, mode: "motion", region, frame, video: video.clipId };
  useClipStore.getState().updateClip(clipId, { keyframes, tracking } as Partial<AnyClipProps>);
  return true;
}

/** Track a shape mask through its own video clip, keying its poses (Track mask's Track). */
export async function trackMask(clipId: string, maskId: string, direction: TrackDirection): Promise<boolean> {
  const clip = useClipStore.getState().getClipById(clipId) as VideoClipProps | undefined;
  if (!clip || clip.type !== "video" || useTrackingStore.getState().running) return false;
  const mask = (clip.masks ?? []).find((m) => m.id === maskId);
  const note = (text: string) => useTrackingStore.setState((s) => ({ notes: { ...s.notes, [clipId]: text } }));
  if (!mask || mask.tool !== "shape") {
    note("Only shape masks can be tracked.");
    return false;
  }
  const fps = useControlsStore.getState().fps || 30;
  const frame = frameIn(clip);
  const source = await sourceOf(clip);
  const request = source && maskTrackRequest(clip, mask, frame, fps, source.path, source.seconds, direction);
  if (!source || !request) {
    note("The mask has no shape to track here.");
    return false;
  }
  const r = await run(clipId, maskId, request);
  if (!r) return false;
  const now = useClipStore.getState().getClipById(clipId) as VideoClipProps | undefined;
  const current = now?.masks?.find((m) => m.id === maskId);
  if (!now || !current) return false;
  const keyframes = trackedMaskKeys(now, current, r.samples, frame, fps, source.seconds);
  const masks = (now.masks ?? []).map((m: MaskClipProps) => (m.id === maskId ? { ...m, keyframes, lastModified: Date.now() } : m));
  useClipStore.getState().updateClip(clipId, { masks } as Partial<AnyClipProps>);
  return true;
}

/** Stop the running track. */
export const cancelTracking = () => engineTrackCancel();
