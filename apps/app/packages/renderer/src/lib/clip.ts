import { create, StateCreator } from "zustand";
import {
  AnyClipProps,
  Marker,
  TimelineProps,
  ClipTransform,
  TimelineType,
  VideoClipProps,
  ImageClipProps,
  MaskClipProps,
  MaskData,
  GroupClipProps,
  ClipType,
  Asset,
  TextClipProps,
} from "./types";
import { v4 as uuidv4 } from "uuid";
import { useControlsStore } from "./control";
import { MediaItem } from "@/components/media/Item";
import { AUDIO_EXTS, MIN_DURATION, VIDEO_EXTS, IMAGE_EXTS } from "./settings";
import { getMediaInfo, getMediaInfoCached } from "./media/utils";
import { getLowercaseExtension } from "@app/preload";
import { remapMaskWithClipTransformProportional } from "./mask/clipTransformUtils";
import { scaleKeyframes, shiftKeyframes, splitKeyframes } from "./keyframes";
import {
  mainTrackOf,
  isTrackLocked,
  isClipLocked,
  linkedClips,
  packMainTrack,
  insertionFrame as mainInsertionFrame,
  MARKER_COLORS,
} from "./timeline-edit";

import _ from "lodash";

interface ClipStore {
  // Clips
  clipDuration: number;
  _setClipDuration: (duration: number) => void;
  clips: AnyClipProps[];
  getAssetById: (assetId: string) => Asset | undefined;
  getAssetByPath: (path: string) => Asset | undefined;
  assets: Record<string, Asset>;  
  setAssets: (assets: Record<string, Asset>) => void;
  addAssetAsync: (asset: Partial<Asset> | string) => Promise<Asset>;
  addAsset: (asset: Partial<Asset> | string) => Asset;
  removeAsset: (assetId: string) => void;
  updateAsset: (assetId: string, assetToUpdate: Partial<Asset>) => void;
  getClipById: (
    clipId: string,
    timelineId?: string,
  ) => AnyClipProps | undefined;
  getClipsByType: (type: ClipType) => AnyClipProps[];
  getClipTransform: (clipId: string) => ClipTransform | undefined;
  getUncroppedClipTransform: (clipId: string) => ClipTransform | undefined;
  setClipTransform: (
    clipId: string,
    transform: Partial<ClipTransform>,
    applyToMasks?: boolean,
    remapMasks?: boolean,
  ) => void;
  setClips: (clips: AnyClipProps[]) => void;
  addClip: (clip: AnyClipProps) => void;
  removeClip: (clipId: string) => void;
  updateClip: (clipId: string, clipToUpdate: Partial<AnyClipProps>) => void;
  resizeClip: (
    clipId: string,
    side: "left" | "right",
    newFrame: number,
  ) => void;
  separateClip: (clipId: string) => void;
  isValidResize: (
    clipId: string,
    side: "left" | "right",
    newFrame: number,
  ) => boolean;
  splitClip: (cutFrame: number, clipId: string) => void;
  /**
   * Split at the playhead: the given clips there, or (none) the main track's clip under it;
   * "all" splits every clip under it. False when nothing was split.
   */
  splitAtPlayhead: (frame: number, clipIds: string[] | "all") => boolean;
  /**
   * CapCut's Delete left / Delete right (Q / W): the part of the given clips before or after
   * the playhead goes (none given: the main track's clip under it). With the magnet on, the
   * main track closes up and, after Delete left, the playhead goes to where the clip now
   * starts. False when nothing was trimmed.
   */
  trimToPlayhead: (side: "left" | "right", frame: number, clipIds: string[]) => boolean;
  /** Link clips (a video and audio), or unlink the links the given clips are in. */
  linkClips: (clipIds: string[]) => void;
  unlinkClips: (clipIds: string[]) => void;
  mergeClips: (clipIds: string[]) => void;
  clipboard: AnyClipProps[];
  copyClips: (clipIds: string[]) => void;
  cutClips: (clipIds: string[]) => void;
  pasteClips: (atFrame?: number, targetTimelineId?: string) => void;
  groupClips: (clipIds: string[]) => void;
  ungroupClips: (groupId: string) => void;
  getClipsForGroup: (children: string[][]) => AnyClipProps[];
  getClipAtFrame: (frame: number) => [AnyClipProps, number] | null;
  activeMediaItem: MediaItem | null;
  setActiveMediaItem: (mediaItem: MediaItem | null) => void;
  ghostStartEndFrame: [number, number];
  setGhostStartEndFrame: (startFrame: number, endFrame: number) => void;
  ghostX: number;
  setGhostX: (x: number) => void;
  ghostGuideLines: [number, number] | null;
  setGhostGuideLines: (guideLines: [number, number] | null) => void;
  muteTimeline: (timelineId: string) => void;
  unmuteTimeline: (timelineId: string) => void;
  hideTimeline: (timelineId: string) => void;
  unhideTimeline: (timelineId: string) => void;
  isTimelineMuted: (timelineId: string) => boolean;
  isTimelineHidden: (timelineId: string) => boolean;
  ghostInStage: boolean;
  setGhostInStage: (inStage: boolean) => void;
  hoveredTimelineId: string | null;
  setHoveredTimelineId: (timelineId: string | null) => void;
  ghostTimelineId: string | null;
  setGhostTimelineId: (timelineId: string | null) => void;
  draggingClipId: string | null;
  setDraggingClipId: (clipId: string | null) => void;
  isDragging: boolean;
  setIsDragging: (isDragging: boolean) => void;
  // Global snap guideline (absolute stage X in px). Null when inactive
  snapGuideX: number | null;
  setSnapGuideX: (x: number | null) => void;
  _updateZoomLevel: (clips: AnyClipProps[], clipDuration: number) => void;
  getTimelinePosition: (
    timelineId: string,
    scrollY?: number,
  ) => { top: number; bottom: number; left: number; right: number };
  getClipPosition: (
    clipId: string,
    scrollY?: number,
  ) => { top: number; bottom: number; left: number; right: number };
  // Computes a numeric score for a clip combining timeline order, group layering, and endFrame.
  // Higher score means visually "above" in stacking: lower timelines outrank above ones; within a timeline,
  // later layers (grouped upwards) outrank earlier ones; endFrame acts as final tiebreaker.
  getClipPositionScore: (clipId: string) => number;
  rescaleForFpsChange: (oldFps: number, newFps: number) => void;
  // Timelines
  timelines: TimelineProps[];
  getClipsForTimeline: (timelineId: string) => AnyClipProps[];
  getTimelineById: (timelineId: string) => TimelineProps | undefined;
  setTimelines: (timelines: TimelineProps[]) => void;
  addTimeline: (timeline: Partial<TimelineProps>, index?: number) => void;
  removeTimeline: (timelineId: string) => void;
  updateTimeline: (
    timelineId: string,
    timelineToUpdate: Partial<TimelineProps>,
  ) => void;
  clipWithinFrame: (
    clip: AnyClipProps,
    frame: number,
    overlap?: boolean,
    overlapAmount?: number,
  ) => boolean;
  updateMaskKeyframes: (
    clipId: string,
    maskId: string,
    updater: (
      keyframes: Map<number, MaskData> | Record<number, MaskData>,
    ) => Map<number, MaskData> | Record<number, MaskData>,
  ) => void;
  /** A new empty track: a video, text, filter or shape track on top, an audio track at the bottom. */
  addTrack: (type: TimelineType) => string;
  /**
   * Delete a track and its clips (clips linked to them elsewhere are unlinked). Not a locked
   * track, nor the main track while another video track exists. False when refused.
   */
  deleteTrack: (timelineId: string) => boolean;
  /** Move a track to `toIndex` in the list. The main track stays the lowest video track. */
  moveTrack: (timelineId: string, toIndex: number) => void;
  setTrackLocked: (timelineId: string, locked: boolean) => void;
  // The main track magnet (CapCut's, on by default): the lowest video track keeps its clips
  // end to end from the start; see lib/timeline-edit.ts. Part of the project.
  magnet: boolean;
  setMagnet: (on: boolean) => void;
  // Markers on the ruler, in time order. Part of the project.
  markers: Marker[];
  /** A marker at `frame` (or the one already there); its id. */
  addMarker: (frame: number) => string;
  updateMarker: (id: string, patch: Partial<Omit<Marker, "id">>) => void;
  removeMarker: (id: string) => void;
  removeAllMarkers: () => void;
  // While a clip is dragged over (or off) the main track with the magnet on: where its other
  // clips would start, so they make room as in CapCut. Null otherwise.
  mainPreview: Record<string, number> | null;
  setMainPreview: (starts: Record<string, number> | null) => void;
}

// Helper function to calculate total duration of all clips
const calculateTotalClipDuration = (clips: AnyClipProps[]): number => {
  const maxEndFrame = Math.max(...clips.map((clip) => clip.endFrame || 0));
  return maxEndFrame;
};

const rescaleFrame = (frame: any, oldFps: number, newFps: number): number | undefined => {
  if (frame == null) return undefined;
  const f = Number(frame);
  if (!Number.isFinite(f) || f < 0) return undefined;
  const safeOld = Math.max(1, Number(oldFps) || 1);
  const safeNew = Math.max(1, Number(newFps) || 1);
  if (safeOld === safeNew) return f;
  const seconds = f / safeOld;
  return Math.max(0, Math.round(seconds * safeNew));
};

// Helper to compute which assetIds are actually in use by current clips
const collectUsedAssetIds = (clips: AnyClipProps[]): Set<string> => {
  const used = new Set<string>();

  for (const clip of clips) {
    // Direct clip asset references
    if (
      (clip.type === "video" ||
        clip.type === "image" ||
        clip.type === "audio") &&
      (clip as any).assetId
    ) {
      used.add((clip as any).assetId as string);
    }

    // Asset history on media clips
    if (
      (clip.type === "video" || clip.type === "image") &&
      Array.isArray((clip as any).assetIdHistory)
    ) {
      for (const id of (clip as any).assetIdHistory as string[]) {
        if (typeof id === "string" && id) used.add(id);
      }
    }
  }

  return used;
};

// Given current clips, drop any assets that are no longer referenced by clips
export const pruneAssetsForClips = (
  assets: Record<string, Asset>,
  clips: AnyClipProps[],
): Record<string, Asset> => {
  if (!assets) return {};
  const assetValues = Object.values(assets);
  if (assetValues.length === 0) return assets;

  const used = collectUsedAssetIds(clips);
  const pruned: Record<string, Asset> = {};
  for (const asset of assetValues) {
    if (!asset || !asset.id) continue;
    if (used.has(asset.id)) {
      // Always key by asset id to keep lookups consistent with getAssetById
      pruned[asset.id] = asset;
    }
  }
  return pruned;
};

export const isValidTimelineForClip = (
  timeline: TimelineProps,
  clip: AnyClipProps | MediaItem | string,
) => {
  if (typeof clip === "string") clip = { type: clip } as AnyClipProps;
  if (timeline.type === "media") {
    return (
      clip.type === "video" ||
      clip.type === "image" ||
      (clip as AnyClipProps).type === "group"
    );
  }
  return timeline.type === clip.type;
};

export const getTimelineTypeForClip = (
  clip: AnyClipProps | MediaItem | string,
): TimelineType => {
  if (typeof clip === "string") clip = { type: clip } as AnyClipProps;
  if (
    clip.type === "video" ||
    clip.type === "image" ||
    clip.type === "group"
  ) {
    return "media";
  }
  return clip.type;
};

/** The space the timeline draws between tracks (inside each track's height). */
const TRACK_GAP = 8;

/**
 * A track's height: CapCut's row for its kind (docs/plan/capcut-ui-spec.md §4.11: the main
 * track 76 px, overlay video 52, audio 50, text, filter and the rest 24) and the gap below it.
 */
export const trackHeightFor = (type: TimelineType, main: boolean) =>
  (type === "media" ? (main ? 76 : 52) : type === "audio" ? 50 : 24) + TRACK_GAP;

export const getTimelineHeightForClip = (
  clip: AnyClipProps | MediaItem | string,
): number => {
  if (typeof clip === "string") clip = { type: clip } as AnyClipProps;
  return trackHeightFor(getTimelineTypeForClip(clip as AnyClipProps), false);
};

// Helper function to resolve overlaps by shifting clips to maintain frame gaps
export const resolveOverlaps = (clips: AnyClipProps[]): AnyClipProps[] => {
  if (clips.length === 0) return clips;

  // Sort clips by start frame
  // filter clips that are hidden
  const hiddenClips = clips.filter((clip) => clip.hidden);
  const visibleClips = clips.filter((clip) => !clip.hidden);
  const sortedClips = [...visibleClips].sort(
    (a, b) => (a.startFrame || 0) - (b.startFrame || 0),
  );
  const resolvedClips: AnyClipProps[] = [];

  for (let i = 0; i < sortedClips.length; i++) {
    const currentClip = { ...sortedClips[i] };
    const currentStart = currentClip.startFrame || 0;
    const currentEnd = currentClip.endFrame || 0;
    const currentTimelineId = currentClip.timelineId || "";

    // Check for overlap with previous clip
    if (resolvedClips.length > 0) {
      const previousClip = resolvedClips[resolvedClips.length - 1];
      const previousEnd = previousClip.endFrame || 0;

      // If current clip overlaps with previous clip, shift it to start after previous clip ends
      if (
        currentStart < previousEnd &&
        currentTimelineId === previousClip.timelineId
      ) {
        const clipDuration = currentEnd - currentStart;
        currentClip.startFrame = previousEnd;
        currentClip.endFrame = previousEnd + clipDuration;
      }
    }

    resolvedClips.push(currentClip);
  }
  // add hidden clips to the resolved clips
  hiddenClips.forEach((clip) => {
    resolvedClips.push(clip);
  });

  return resolvedClips;
};

export const getCorrectedClip = (
  clipId: string,
  clips: AnyClipProps[],
): AnyClipProps | null => {
  // find the clip in the clips array
  const resolvedClips = resolveOverlaps(clips);
  const clip = resolvedClips.find((clip) => clip.clipId === clipId);
  if (!clip) return null;
  return clip;
};

// The tracks laid out top to bottom, each its kind's height (trackHeightFor: the main track
// taller than the overlays above it).
export const resolveOverlapsTimelines = (
  timelines: TimelineProps[],
): TimelineProps[] => {
  if (timelines.length === 0) return timelines;

  const resolvedTimelines: TimelineProps[] = [];
  const main = mainTrackOf(timelines);

  for (let i = 0; i < timelines.length; i++) {
    const timeline = { ...timelines[i], timelineHeight: trackHeightFor(timelines[i].type, timelines[i] === main) };

    // First timeline starts at 0
    if (i === 0) {
      timeline.timelineY = 0;
    } else {
      // Each subsequent timeline is positioned based on the previous timeline's position + height
      const previousTimeline = resolvedTimelines[i - 1];
      const previousY = previousTimeline.timelineY || 0;
      const previousHeight = previousTimeline.timelineHeight || 54;
      timeline.timelineY = previousY + previousHeight;
    }

    resolvedTimelines.push(timeline);
  }

  return resolvedTimelines;
};

/**
 * What follows from any edit to the clips or tracks: a track the edit left empty goes, as in
 * CapCut (the main track stays while anything is on the timeline; a track added empty stays
 * until it's used); and with the magnet on, the main track closes up.
 */
const followRules = (prev: ClipStore, next: ClipStore): Partial<ClipStore> => {
  const out: Partial<ClipStore> = {};
  let timelines = next.timelines;
  if (next.clips !== prev.clips) {
    const counts = (clips: AnyClipProps[]) => {
      const m = new Map<string, number>();
      for (const c of clips) if (!c.hidden) m.set(c.timelineId ?? "", (m.get(c.timelineId ?? "") ?? 0) + 1);
      return m;
    };
    const [before, after] = [counts(prev.clips), counts(next.clips)];
    const main = mainTrackOf(timelines);
    const emptied = timelines.filter(
      (t) => (before.get(t.timelineId) ?? 0) > 0 && !after.get(t.timelineId) && !(after.size > 0 && t === main),
    );
    if (emptied.length > 0) {
      timelines = resolveOverlapsTimelines(timelines.filter((t) => !emptied.includes(t)));
      out.timelines = timelines;
    }
  }
  if (next.magnet) {
    const packed = packMainTrack(next.clips, timelines, undefined, linkage());
    if (packed !== next.clips) {
      const clips = resolveOverlaps(packed);
      out.clips = clips;
      out.clipDuration = calculateTotalClipDuration(clips);
      next._updateZoomLevel(clips, out.clipDuration);
    }
  }
  return out;
};

/**
 * Applies followRules to every edit the store makes. States put back by undo or loaded from
 * a file come in through setState and stay as they were.
 */
const withTimelineRules =
  (config: StateCreator<ClipStore>): StateCreator<ClipStore> =>
  (set, get, api) =>
    config(
      ((partial: any, replace?: any) =>
        set((state) => {
          const next = typeof partial === "function" ? partial(state) : partial;
          if (!next || (next.clips === undefined && next.timelines === undefined && next.magnet === undefined)) return next;
          // As the store is now: the edit may have set something itself already (a new track).
          const merged = { ...api.getState(), ...next } as ClipStore;
          return { ...next, ...followRules(state, merged) };
        }, replace)) as any,
      get,
      api,
    );

/** Whether linked clips are edited together (CapCut's linkage, the toolbar's toggle). */
const linkage = () => useControlsStore.getState().linkage;

/** The clips linked to `clip` that its edits carry along: none with linkage off. */
const partners = (clips: AnyClipProps[], clip: AnyClipProps | undefined) => (linkage() ? linkedClips(clips, clip) : []);

/** The two halves of `clip` cut at `cutFrame` (between its ends), with new ids. */
const splitClipAt = (clip: AnyClipProps, cutFrame: number): [AnyClipProps, AnyClipProps] => {
  // create new clip ids
  const newClipId1 = uuidv4();
  const newClipId2 = uuidv4();
  // IMPORTANT:
  // Splitting must not change the displayed frames at any given timeline focusFrame.
  // We achieve this by preserving the original clip's media mapping and only
  // adjusting trims for the new boundaries.
  //
  // - `trimStart` is the source-frame offset at the clip's start (in project frames).
  // - `trimEnd` is a <= 0 "give" value used by resize logic (negative when trimmed in).
  // - The right clip must advance `trimStart` by the cut offset so it starts on the
  //   same source frame the original clip had at `cutFrame`.
  const oldStart = Math.max(0, Number(clip.startFrame ?? 0));
  const oldEnd = Math.max(oldStart + 1, Number(clip.endFrame ?? oldStart + 1));
  const safeOldTrimStart = isFinite(clip.trimStart ?? 0)
    ? Number(clip.trimStart ?? 0)
    : 0;
  const safeOldTrimEnd = isFinite(clip.trimEnd ?? 0)
    ? Number(clip.trimEnd ?? 0)
    : 0;
  const cutRel = Math.max(0, Math.min(oldEnd - oldStart, cutFrame - oldStart));

  // Left clip: same start/trimStart; end at cut; adjust trimEnd exactly like a right-edge resize.
  const newClip1: AnyClipProps = {
    ...clip,
    clipId: newClipId1,
    endFrame: cutFrame,
    trimStart: safeOldTrimStart,
    trimEnd: safeOldTrimEnd + (cutFrame - oldEnd),
  };

  // Right clip: start at cut; advance trimStart so it begins at the cut point in the source.
  const newClip2: AnyClipProps = {
    ...clip,
    clipId: newClipId2,
    startFrame: cutFrame,
    trimStart: safeOldTrimStart + cutRel,
    trimEnd: safeOldTrimEnd,
  };

  // Each half keeps the keys on its side, and one at the cut so the motion carries on
  // (the right half's moved to its start), as CapCut splits a keyframed clip.
  if (clip.keyframes) {
    const [leftKeys, rightKeys] = splitKeyframes(clip.keyframes, cutRel, useControlsStore.getState().fps || 30);
    newClip1.keyframes = leftKeys;
    newClip2.keyframes = rightKeys;
  }

  // A text's In animation plays where the clip starts, so it stays on the left clip; a
  // transition leads into the clip after, so it stays on the right one, which ends where
  // the clip did. A caption's words keep time with the speech: the right clip starts that
  // far into it.
  if (clip.type === "text") {
    const text = newClip2 as TextClipProps;
    text.animationIn = null;
    if (text.spokenWords) text.spokenFrom = (text.spokenFrom ?? 0) + cutRel / (useControlsStore.getState().fps || 30);
  }
  if (clip.type === "video" || clip.type === "image") {
    (newClip1 as VideoClipProps | ImageClipProps).transitionOut = null;
  }

  if (clip.type === "image" || clip.type === "video") {
    // Split masks by local frame index (mask frames use the same local frame space
    // as preview: focusFrame - startFrame + trimStart).
    const originalMasks = (clip as VideoClipProps | ImageClipProps).masks;
    if (Array.isArray(originalMasks) && originalMasks.length > 0) {
      const masksForClip1: MaskClipProps[] = [];
      const masksForClip2: MaskClipProps[] = [];

      const startFrame = Number(clip.startFrame ?? 0);
      const trimStart = isFinite(clip.trimStart ?? 0)
        ? Number(clip.trimStart ?? 0)
        : 0;
      const cutLocal = Math.max(0, cutFrame - startFrame + trimStart);

      const makeEmptyKeyframesLike = (
        kf: Map<number, MaskData> | Record<number, MaskData>,
      ) =>
        kf instanceof Map
          ? new Map<number, MaskData>()
          : ({} as Record<number, MaskData>);

      const setKeyframe = (
        target: Map<number, MaskData> | Record<number, MaskData>,
        frame: number,
        data: MaskData,
      ) => {
        if (target instanceof Map) target.set(frame, data);
        else (target as Record<number, MaskData>)[frame] = data;
      };

      const getKeyframe = (
        source: Map<number, MaskData> | Record<number, MaskData>,
        frame: number,
      ): MaskData | undefined => {
        return source instanceof Map
          ? source.get(frame)
          : (source as Record<number, MaskData>)[frame];
      };

      const getSortedFrames = (
        kf: Map<number, MaskData> | Record<number, MaskData>,
      ): number[] =>
        (kf instanceof Map
          ? Array.from(kf.keys())
          : Object.keys(kf).map(Number)
        ).sort((a, b) => a - b);

      for (const mask of originalMasks) {
        const keyframes = mask.keyframes;
        const frames = getSortedFrames(keyframes);
        const now = Date.now();

        // Image clips only use frame 0; copy that to both
        if (clip.type === "image") {
          const dataAt0 =
            getKeyframe(keyframes, 0) ??
            (frames.length > 0
              ? getKeyframe(keyframes, frames[0])
              : undefined);
          if (dataAt0) {
            const kf1 = makeEmptyKeyframesLike(keyframes);
            const kf2 = makeEmptyKeyframesLike(keyframes);
            setKeyframe(kf1, 0, { ...dataAt0 });
            setKeyframe(kf2, 0, { ...dataAt0 });
            masksForClip1.push({
              ...mask,
              keyframes: kf1,
              clipId: newClip1.clipId,
              lastModified: now,
            });
            masksForClip2.push({
              ...mask,
              keyframes: kf2,
              clipId: newClip2.clipId,
              lastModified: now,
            });
          }
          continue;
        }

        const kfLeft = makeEmptyKeyframesLike(keyframes);
        const kfRight = makeEmptyKeyframesLike(keyframes);
        for (const f of frames) {
          const data = getKeyframe(keyframes, f);
          if (!data) continue;
          if (f < cutLocal) setKeyframe(kfLeft, f, { ...data });
          else setKeyframe(kfRight, f, { ...data });
        }

        masksForClip1.push({
          ...mask,
          keyframes: kfLeft,
          clipId: newClip1.clipId,
          lastModified: now,
        });
        masksForClip2.push({
          ...mask,
          keyframes: kfRight,
          clipId: newClip2.clipId,
          lastModified: now,
        });
      }

      (newClip1 as VideoClipProps | ImageClipProps).masks = masksForClip1;
      (newClip2 as VideoClipProps | ImageClipProps).masks = masksForClip2;
    }
  }
  return [newClip1, newClip2];
};

/**
 * How far an edge of `clip` can move by `delta` frames: its length stays at least a frame, a
 * left edge stays at or after 0, and a trim doesn't reach past its media (`trimStart` ≥ 0,
 * `trimEnd` ≤ 0; text, photos and the like have no such bound).
 */
const clampEdgeDelta = (clip: AnyClipProps, side: "left" | "right", delta: number) => {
  const start = clip.startFrame ?? 0;
  const end = Math.max(clip.endFrame ?? 0, start + 1);
  if (side === "right") {
    let d = Math.max(delta, start + 1 - end);
    if (isFinite(clip.trimEnd ?? 0)) d = Math.min(d, -(clip.trimEnd ?? 0));
    return d;
  }
  let d = Math.min(delta, end - 1 - start);
  d = Math.max(d, -start);
  if (isFinite(clip.trimStart ?? 0)) d = Math.max(d, -(clip.trimStart ?? 0));
  return d;
};

/** `clip` with an edge moved by `delta` frames, its trim following. */
const moveEdge = (clip: AnyClipProps, side: "left" | "right", delta: number): AnyClipProps => {
  if (side === "right") {
    return { ...clip, endFrame: (clip.endFrame ?? 0) + delta, trimEnd: (clip.trimEnd || 0) + delta };
  }
  const next = {
    ...clip,
    startFrame: (clip.startFrame ?? 0) + delta,
    trimStart: (clip.trimStart || 0) + delta,
    // Keys stay on the content as the start moves (they're clip-local).
    keyframes: shiftKeyframes(clip.keyframes, -delta),
  } as AnyClipProps;
  // A caption's words keep time with the speech as its start moves.
  if (clip.type === "text" && clip.spokenWords) {
    (next as TextClipProps).spokenFrom = (clip.spokenFrom ?? 0) + delta / (useControlsStore.getState().fps || 30);
  }
  return next;
};

export const useClipStore = create<ClipStore>()(withTimelineRules((set, get) => ({
  clipDuration: 0,
  _setClipDuration: (duration) => set({ clipDuration: duration }),
  clips: [],
  assets: {},
  timelines: [],
  magnet: true,
  // CapCut won't turn the magnet on or off while the main track is locked. Turned on, the
  // main track closes up (withTimelineRules).
  setMagnet: (on) =>
    set((state) => (mainTrackOf(state.timelines)?.locked ? {} : { magnet: on })),
  markers: [],
  addMarker: (frame) => {
    const at = Math.max(0, Math.round(frame));
    const existing = get().markers.find((m) => m.frame === at);
    if (existing) return existing.id;
    const id = uuidv4();
    set((state) => ({
      markers: [
        ...state.markers,
        // CapCut names them "Marker 01", "Marker 02", …
        { id, frame: at, color: MARKER_COLORS[0], note: `Marker ${String(state.markers.length + 1).padStart(2, "0")}` },
      ].sort((a, b) => a.frame - b.frame),
    }));
    return id;
  },
  updateMarker: (id, patch) =>
    set((state) => ({
      markers: state.markers
        .map((m) => (m.id === id ? { ...m, ...patch, frame: Math.max(0, Math.round(patch.frame ?? m.frame)) } : m))
        .sort((a, b) => a.frame - b.frame),
    })),
  removeMarker: (id) => set((state) => ({ markers: state.markers.filter((m) => m.id !== id) })),
  removeAllMarkers: () => set({ markers: [] }),
  mainPreview: null,
  setMainPreview: (starts) => set({ mainPreview: starts }),
  addTrack: (type) => {
    const id = uuidv4();
    set((state) => {
      const ref = state.timelines[0];
      const track: TimelineProps = {
        timelineId: id,
        type,
        timelineHeight: getTimelineHeightForClip(type === "media" ? "video" : type),
        timelineWidth: ref?.timelineWidth ?? 0,
        timelineY: 0,
        timelinePadding: ref?.timelinePadding ?? 24,
        muted: false,
        hidden: false,
      };
      // Audio goes under the video, as in CapCut; the rest on top, above what's there.
      const timelines = type === "audio" ? [...state.timelines, track] : [track, ...state.timelines];
      return { timelines: resolveOverlapsTimelines(timelines) };
    });
    return id;
  },
  deleteTrack: (timelineId) => {
    const state = get();
    const track = state.getTimelineById(timelineId);
    if (!track || track.locked) return false;
    const main = mainTrackOf(state.timelines);
    if (track === main && state.timelines.some((t) => t.type === "media" && t !== main)) return false;
    // Its clips go; clips linked to them on other tracks stay, unlinked. A group's hidden
    // children belong to the group's track.
    const gone = state.clips.filter((c) => c.timelineId === timelineId && !c.hidden);
    const goneIds = new Set(gone.map((c) => c.clipId));
    const links = new Set(gone.map((c) => c.linkId).filter(Boolean));
    set((s) => {
      const clips = s.clips
        .filter((c) => !goneIds.has(c.clipId))
        .filter((c) => !gone.some((g) => g.type === "group" && ((g as GroupClipProps).children ?? []).flat().includes(c.clipId)))
        .map((c) => (c.linkId && links.has(c.linkId) ? ({ ...c, linkId: undefined } as AnyClipProps) : c));
      const resolvedClips = resolveOverlaps(clips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      return {
        clips: resolvedClips,
        clipDuration,
        assets: pruneAssetsForClips(s.assets, resolvedClips),
        timelines: resolveOverlapsTimelines(s.timelines.filter((t) => t.timelineId !== timelineId)),
      };
    });
    const controls = useControlsStore.getState();
    controls.setSelectedClipIds(controls.selectedClipIds.filter((id) => !goneIds.has(id)));
    return true;
  },
  moveTrack: (timelineId, toIndex) =>
    set((state) => {
      const from = state.timelines.findIndex((t) => t.timelineId === timelineId);
      if (from === -1) return {};
      const main = mainTrackOf(state.timelines);
      const track = state.timelines[from];
      if (track === main) return {};
      const rest = state.timelines.filter((t) => t !== track);
      let at = Math.max(0, Math.min(rest.length, toIndex));
      // A video track can't go under the main track: it would become the main track.
      if (track.type === "media" && main) at = Math.min(at, rest.indexOf(main));
      const timelines = [...rest.slice(0, at), track, ...rest.slice(at)];
      if (timelines.every((t, i) => t === state.timelines[i])) return {};
      return { timelines: resolveOverlapsTimelines(timelines) };
    }),
  setTrackLocked: (timelineId, locked) => {
    set((state) => ({
      timelines: state.timelines.map((t) => (t.timelineId === timelineId ? { ...t, locked } : t)),
    }));
    // A locked track's clips can't be selected.
    if (locked) {
      const onTrack = new Set(get().clips.filter((c) => c.timelineId === timelineId).map((c) => c.clipId));
      const controls = useControlsStore.getState();
      controls.setSelectedClipIds(controls.selectedClipIds.filter((id) => !onTrack.has(id)));
    }
  },
  setAssets: (assets) => set({ assets }),
  addAssetAsync: async (asset): Promise<Asset> => {
    if (typeof asset === "string") {
      asset = { path: asset };
    }

    const path =
      typeof asset === "object" && "path" in asset
        ? (asset.path as string)
        : (asset as string);

    // Reuse existing asset for this path to avoid duplicates.
    const existing = Object.values(get().assets).find((a) => a.path === path);
    if (existing) return existing;


    const mediaInfo = getMediaInfoCached(path as string);

    // Initial, best-effort values; will be refined asynchronously if needed
    const inferredTypeFromMedia =
      mediaInfo?.video
        ? "video"
        : mediaInfo?.audio
          ? "audio"
          : mediaInfo
            ? "image"
            : undefined;

    let type =
      asset.type ??
      inferredTypeFromMedia;

    if (!type) {
      const ext = getLowercaseExtension(path ?? "");
      if (VIDEO_EXTS.includes(ext)) type = "video";
      else if (AUDIO_EXTS.includes(ext)) type = "audio";
      else if (IMAGE_EXTS.includes(ext)) type = "image";
      else type = "image";
    }

    const height =
      asset.height ??
      mediaInfo?.video?.displayHeight ??
      mediaInfo?.image?.height;
    const width =
      asset.width ??
      mediaInfo?.video?.displayWidth ??
      mediaInfo?.image?.width;
    const duration = asset.duration ?? mediaInfo?.duration ?? 0;

    const newAsset: Asset = {
      id: uuidv4(),
      path: path,
      type: type,
      duration: duration,
      width: height === undefined ? undefined : width,
      height: height === undefined ? undefined : height,
    };

    const newAssets: Record<string, Asset> = {
      ...get().assets,
      [newAsset.id]: newAsset,
    };

    // If media info wasn't cached, fetch it asynchronously and update this asset
    if (!mediaInfo) {
      const info = await getMediaInfo(path as string);
        
        if (!info) return newAsset;

          const updatedHeight =
            info.video?.displayHeight ?? info.image?.height;
          const updatedWidth =
            info.video?.displayWidth ?? info.image?.width;
          const updatedDuration = info.duration ?? 0;

          let updatedType: Asset["type"] = newAsset.type;
          if (info.video) updatedType = "video";
          else if (info.audio) updatedType = "audio";
          else if (info.image) updatedType = "image";

          newAsset.height = updatedHeight;
          newAsset.width = updatedWidth;
          newAsset.duration = updatedDuration;
          newAsset.type = updatedType;
    }
    set({ assets: newAssets });
    return newAsset;
  },
  addAsset: (asset): Asset => {
    if (typeof asset === "string") {
      asset = { path: asset };
    }

    const path =
      typeof asset === "object" && "path" in asset
        ? (asset.path as string)
        : (asset as string);

    // Reuse existing asset for this path to avoid duplicates.
    const existing = Object.values(get().assets).find((a) => a.path === path);
    if (existing) return existing;


    const mediaInfo = getMediaInfoCached(path as string);

    // Initial, best-effort values; will be refined asynchronously if needed
    const inferredTypeFromMedia =
      mediaInfo?.video
        ? "video"
        : mediaInfo?.audio
          ? "audio"
          : mediaInfo
            ? "image"
            : undefined;

    let type =
      asset.type ??
      inferredTypeFromMedia;

    if (!type) {
      const ext = getLowercaseExtension(path ?? "");
      if (VIDEO_EXTS.includes(ext)) type = "video";
      else if (AUDIO_EXTS.includes(ext)) type = "audio";
      else if (IMAGE_EXTS.includes(ext)) type = "image";
      else type = "image";
    }

    const height =
      asset.height ??
      mediaInfo?.video?.displayHeight ??
      mediaInfo?.image?.height;
    const width =
      asset.width ??
      mediaInfo?.video?.displayWidth ??
      mediaInfo?.image?.width;
    const duration = asset.duration ?? mediaInfo?.duration ?? 0;

    const newAsset: Asset = {
      id: uuidv4(),
      path: path,
      type: type,
      duration: duration,
      width: height === undefined ? undefined : width,
      height: height === undefined ? undefined : height,
    };

    const newAssets: Record<string, Asset> = {
      ...get().assets,
      [newAsset.id]: newAsset,
    };

    set({ assets: newAssets });
    // If media info wasn't cached, fetch it asynchronously and update this asset
    if (!mediaInfo) {
      void getMediaInfo(path as string)
        .then((info) => {
          if (!info) return;

          const updatedHeight =
            info.video?.displayHeight ?? info.image?.height;
          const updatedWidth =
            info.video?.displayWidth ?? info.image?.width;
          const updatedDuration = info.duration ?? 0;

          let updatedType: Asset["type"] = newAsset.type;
          if (info.video) updatedType = "video";
          else if (info.audio) updatedType = "audio";
          else if (info.image) updatedType = "image";

          get().updateAsset(newAsset.id, {
            height: newAsset.height ?? updatedHeight,
            width: newAsset.width ?? updatedWidth,
            duration:
              newAsset.duration && newAsset.duration > 0
                ? newAsset.duration
                : updatedDuration,
            type: newAsset.type ?? updatedType,
          });
        })
        .catch((err) => {
          console.error("Failed to load media info for asset", path, err);
        });
    }

    return newAsset;
  },
  removeAsset: (assetId) => set((state) => ({ assets: _.omit(state.assets, assetId) })),
  // A new record, not the old one changed: the undo history keeps the old one.
  updateAsset: (assetId, assetToUpdate) => set((state) => ({ assets: { ...state.assets, [assetId]: { ...state.assets[assetId], ...assetToUpdate } } })),
  getAssetById: (assetId) => get().assets[assetId],
  getAssetByPath: (path) => Object.values(get().assets).find((a) => a.path === path),
  isTimelineMuted: (timelineId) =>
    get().timelines.find((timeline) => timeline.timelineId === timelineId)
      ?.muted || false,
  isTimelineHidden: (timelineId) =>
    get().timelines.find((timeline) => timeline.timelineId === timelineId)
      ?.hidden || false,
  muteTimeline: (timelineId) =>
    set((state) => {
      const newTimelines = state.timelines.map((timeline) =>
        timeline.timelineId === timelineId
          ? { ...timeline, muted: true }
          : timeline,
      );
      const resolvedTimelines = resolveOverlapsTimelines(newTimelines);
      return { timelines: resolvedTimelines };
    }),
  unmuteTimeline: (timelineId) =>
    set((state) => {
      const newTimelines = state.timelines.map((timeline) =>
        timeline.timelineId === timelineId
          ? { ...timeline, muted: false }
          : timeline,
      );
      const resolvedTimelines = resolveOverlapsTimelines(newTimelines);
      return { timelines: resolvedTimelines };
      return state;
    }),
  hideTimeline: (timelineId) =>
    set((state) => {
      const newTimelines = state.timelines.map((timeline) =>
        timeline.timelineId === timelineId
          ? { ...timeline, hidden: true }
          : timeline,
      );
      const resolvedTimelines = resolveOverlapsTimelines(newTimelines);
      return { timelines: resolvedTimelines };
      return state;
    }),
  unhideTimeline: (timelineId) =>
    set((state) => {
      const newTimelines = state.timelines.map((timeline) =>
        timeline.timelineId === timelineId
          ? { ...timeline, hidden: false }
          : timeline,
      );
      const resolvedTimelines = resolveOverlapsTimelines(newTimelines);
      return { timelines: resolvedTimelines };
    }),
  ghostStartEndFrame: [0, 0],
  activeMediaItem: null,
  setActiveMediaItem: (mediaItem) => set({ activeMediaItem: mediaItem }),
  setGhostStartEndFrame: (startFrame, endFrame) =>
    set({ ghostStartEndFrame: [startFrame, endFrame] }),
  ghostX: 0,
  _updateZoomLevel: (clips: AnyClipProps[], clipDuration: number) => {
    // Determine if this is the first clip being added (based on current store state before set)
    const hadNoClips = (get().clips || []).length === 0;

    // Longest clip length in frames (endFrame max)
    const longestClipFrames = Math.max(0, Math.round(clipDuration || 0));

    // Compute new baseline total timeline frames at zoom level 1 so that
    // the longest clip occupies 60% of the timeline (5/3 multiplier).
    // Clamp to at least MIN_DURATION to ensure we can always zoom to 5 frames.
    const newTotalFrames = Math.max(
      MIN_DURATION,
      Math.round((longestClipFrames * 5) / 3),
    );

    const controls = useControlsStore.getState();
    const prevTotalFrames = Math.max(0, controls.totalTimelineFrames || 0);
    const minZoomLevel = controls.minZoomLevel;
    const maxZoomLevel = controls.maxZoomLevel;
    const [currentStart, currentEnd] = controls.timelineDuration || [
      0,
      newTotalFrames,
    ];
    const currentWidth = Math.max(1, currentEnd - currentStart);

    const needsBaselineUpdate =
      newTotalFrames !== prevTotalFrames && clips.length > 0;

    if (!needsBaselineUpdate) {
      return;
    }

    // Apply the new baseline total frames
    useControlsStore.setState({ totalTimelineFrames: newTotalFrames });

    if (hadNoClips) {
      // First clip: set zoom level 1 window to exactly the baseline width,
      // so the clip takes 60% of the timeline at zoom level 1.
      controls.setTimelineDuration(0, newTotalFrames);
      controls.setZoomLevel(1 as any);
      return;
    }

    // For subsequent changes (e.g., adding a longer clip), keep the current
    // window to avoid jitter, but recalibrate the zoom level so that the
    // current window width maps to the nearest zoom step under the new baseline.
    const steps = Math.max(1, maxZoomLevel - minZoomLevel);
    const ratio = MIN_DURATION / newTotalFrames;
    const durations: number[] = new Array(steps + 1).fill(0).map((_, i) => {
      const ti = i / steps;
      const d = Math.round(newTotalFrames * Math.pow(ratio, ti));
      return Math.max(MIN_DURATION, Math.min(newTotalFrames, d));
    });

    // Keep the same window; clamp within new total if needed
    let clampedStart = currentStart;
    let clampedEnd = currentEnd;
    const width = Math.max(1, clampedEnd - clampedStart);
    if (clampedEnd > newTotalFrames) {
      clampedStart = Math.max(0, newTotalFrames - width);
      clampedEnd = clampedStart + width;
      controls.setTimelineDuration(clampedStart, clampedEnd);
    }

    // Pick the zoom level whose target duration is closest to the current width
    let bestIndex = 0;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= steps; i++) {
      const diff = Math.abs(durations[i] - currentWidth);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }
    const newZoomLevel = (minZoomLevel + bestIndex) as any;
    controls.setZoomLevel(newZoomLevel);
  },
  setGhostX: (x) => set({ ghostX: x }),
  ghostGuideLines: null,
  setGhostGuideLines: (guideLines) => set({ ghostGuideLines: guideLines }),
  hoveredTimelineId: null,
  setHoveredTimelineId: (timelineId) => set({ hoveredTimelineId: timelineId }),
  ghostTimelineId: null,
  setGhostTimelineId: (timelineId) => set({ ghostTimelineId: timelineId }),
  ghostInStage: false,
  setGhostInStage: (inStage) => set({ ghostInStage: inStage }),
  draggingClipId: null,
  setDraggingClipId: (clipId) => set({ draggingClipId: clipId }),
  isDragging: false,
  setIsDragging: (isDragging) => set({ isDragging }),
  snapGuideX: null,
  setSnapGuideX: (x) => set({ snapGuideX: x }),
  getClipTransform: (clipId: string) => {
    const clip = get().clips.find((c) => c.clipId === clipId);
    return clip?.transform;
  },
  getUncroppedClipTransform: (clipId: string) => {
    const clip = get().clips.find((c) => c.clipId === clipId);
    if (!clip) return undefined;
    const crop = clip.transform?.crop;
    if (!crop) return clip.transform;
    return {
      ...clip.transform,
      width: (clip.transform?.width ?? 0) / crop.width,
      height: (clip.transform?.height ?? 0) / crop.height,
      crop: undefined,
      x: clip.transform?.x ?? 0,
      y: clip.transform?.y ?? 0,
      scaleX: clip.transform?.scaleX ?? 1,
      scaleY: clip.transform?.scaleY ?? 1,
      rotation: clip.transform?.rotation ?? 0,
      cornerRadius: clip.transform?.cornerRadius ?? 0,
      opacity: clip.transform?.opacity ?? 100,
    };
  },
  setClipTransform: (clipId: string, transform: Partial<ClipTransform>, applyToMasks: boolean = false, remapMasks: boolean = false) =>
    set((state) => {
      const index = state.clips.findIndex((c) => c.clipId === clipId);
      if (index === -1) return { clips: state.clips };

      const current = state.clips[index];
      const previous: ClipTransform = current.transform || {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        cornerRadius: 0,
        opacity: 100,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      };
      const next: ClipTransform = { ...previous, ...transform };

      const updatedClip: AnyClipProps = { ...current, transform: next };

      // give the transform to all masks if applyToMasks is true
      if (applyToMasks && Object.keys(current).includes("masks")) {
        let  masks = [...(current as VideoClipProps | ImageClipProps).masks];
        masks = masks.map((mask: MaskClipProps) => {
          if (remapMasks) {
            mask = remapMaskWithClipTransformProportional(mask, mask.transform as ClipTransform, next);
          } else {
            // A copy: the undo history keeps the clip's old masks.
            mask = { ...mask, transform: { ...next } };
          }
          return mask;
        });
        (updatedClip as VideoClipProps | ImageClipProps).masks = masks;
      }

      if (!current.originalTransform && next.width > 0 && next.height > 0) {
        updatedClip.originalTransform = { ...next, x: 0, y: 0 };
      }
      const newClips = [...state.clips];
      newClips[index] = updatedClip;
      const resolvedClips = resolveOverlaps(newClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    }),
  getTimelineById: (timelineId: string) =>
    get().timelines.find((timeline) => timeline.timelineId === timelineId),
  setTimelines: (timelines: TimelineProps[]) => set({ timelines }),
  addTimeline: (timeline: Partial<TimelineProps>, index?: number) =>
    set((state) => {
      const newTimeline: TimelineProps = {
        timelineId: timeline.timelineId ?? uuidv4(),
        timelineHeight: timeline.timelineHeight ?? 54,
        timelineWidth: timeline.timelineWidth ?? 0,
        timelineY: timeline.timelineY ?? 0,
        timelinePadding: timeline.timelinePadding ?? 24,
        type: timeline.type ?? "media",
        muted: timeline.muted ?? false,
        hidden: timeline.hidden ?? false,
      };
      const timelines =
        index !== undefined
          ? [
              ...state.timelines.slice(0, index + 1),
              newTimeline,
              ...state.timelines.slice(index + 1),
            ]
          : [...state.timelines, newTimeline];
      const resolvedTimelines = resolveOverlapsTimelines(timelines);
      return { timelines: resolvedTimelines };
    }),
  removeTimeline: (timelineId: string) =>
    set((state) => {
      const newTimelines = state.timelines.filter(
        (timeline) => timeline.timelineId !== timelineId,
      );
      const resolvedTimelines = resolveOverlapsTimelines(newTimelines);
      return { timelines: resolvedTimelines };
    }),
  updateTimeline: (
    timelineId: string,
    timelineToUpdate: Partial<TimelineProps>,
  ) =>
    set((state) => {
      const newTimelines = state.timelines.map((timeline) =>
        timeline.timelineId === timelineId
          ? { ...timeline, ...timelineToUpdate }
          : timeline,
      );
      const resolvedTimelines = resolveOverlapsTimelines(newTimelines);
      return { timelines: resolvedTimelines };
    }),
  clipboard: [],
  getClipsForTimeline: (timelineId: string) =>
    get().clips.filter(
      (clip) => clip.timelineId === timelineId && !clip.hidden,
    ) || [],
  getClipById: (clipId: string, timelineId?: string) =>
    get().clips.find(
      (clip) =>
        clip.clipId === clipId &&
        (timelineId ? clip.timelineId === timelineId : true),
    ),
  setClips: (clips: AnyClipProps[]) => {
    set((state) => {
      const resolvedClips = resolveOverlaps(clips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    });
  },
  addClip: (clip: AnyClipProps) =>
    set((state) => {
      if (isTrackLocked(state.timelines, clip.timelineId)) return {};
      let newClips = [...state.clips, clip];
      // Onto the main track with the magnet on: it goes in at its start (a clip's start, from
      // insertionFrame), the clips after it making room.
      const main = mainTrackOf(state.timelines);
      if (state.magnet && main && clip.timelineId === main.timelineId) {
        newClips = packMainTrack(newClips, state.timelines, { ids: [clip.clipId], at: clip.startFrame ?? 0 }, linkage());
      }
      const resolvedClips = resolveOverlaps(newClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      get()._updateZoomLevel(resolvedClips, clipDuration);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    }),
  removeClip: (clipId: string) =>
    set((state) => {
      const clipToDelete = state.clips.find((c) => c.clipId === clipId);
      // A locked track's clips stay. With the magnet on, the main track closes up behind a
      // clip deleted from it (CapCut's ripple delete; withTimelineRules).
      if (clipToDelete && isClipLocked(state.clips, state.timelines, clipToDelete, linkage())) return {};

      // Linked clips (a video's extracted audio) go with it.
      const linked = new Set(partners(state.clips, clipToDelete).map((c) => c.clipId));
      let newClips: AnyClipProps[] = state.clips.filter((c) => !linked.has(c.clipId));

      if (!clipToDelete) {
        const resolvedClips = resolveOverlaps(newClips);
        const clipDuration = calculateTotalClipDuration(resolvedClips);
        get()._updateZoomLevel(resolvedClips, clipDuration);
        return { clips: resolvedClips, clipDuration };
      }

      // Case 1: Deleting a group – remove the group and all its children in one transaction
      if (clipToDelete.type === "group") {
        const nested = (clipToDelete as GroupClipProps).children || ([] as any);
        const childrenSet = new Set((nested as string[][]).flat());
        newClips = newClips.filter(
          (c) => c.clipId !== clipId && !childrenSet.has(c.clipId),
        );
      } else {
        // Case 2: Deleting a non-group clip
        newClips = newClips.filter((c) => c.clipId !== clipId);

        // If the clip belongs to a group, update the group's children and ungroup if only one remains
        if (clipToDelete.groupId) {
          const groupIdx = newClips.findIndex(
            (c) => c.clipId === clipToDelete.groupId,
          );
          const groupClip = groupIdx !== -1 ? newClips[groupIdx] : undefined;
          if (groupClip && groupClip.type === "group") {
            const prevChildren =
              (groupClip as GroupClipProps).children || ([] as any);
            const updatedNested = (prevChildren as string[][])
              .map((sub) => sub.filter((childId) => childId !== clipId))
              .filter((sub) => sub.length > 0);

            const totalRemaining = updatedNested.reduce(
              (acc, sub) => acc + sub.length,
              0,
            );
            if (totalRemaining <= 1) {
              // Ungroup: remove the group clip; if one child remains, reveal it and clear its groupId
              // call ungroupClips as this can get complex
              state.ungroupClips(clipToDelete.groupId);
            } else {
              // Just update group's children nested array
              newClips[groupIdx] = {
                ...(groupClip as GroupClipProps),
                children: updatedNested,
              } as AnyClipProps;
            }
          }
        }
      }

      const resolvedClips = resolveOverlaps(newClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      get()._updateZoomLevel(resolvedClips, clipDuration);
      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    }),
  updateClip: (clipId: string, clipToUpdate: Partial<AnyClipProps>) =>
    set((state) => {
      const index = state.clips.findIndex((c) => c.clipId === clipId);
      if (index === -1) {
        return { clips: state.clips };
      }
      const current = state.clips[index];

      // Prepare update payload and handle speed-induced duration rescale
      let nextUpdate: Partial<AnyClipProps> = { ...clipToUpdate };
      if (Object.prototype.hasOwnProperty.call(clipToUpdate, "speed")) {
        const oldSpeed = Math.max(
          0.1,
          Number((current as VideoClipProps).speed || 1),
        );
        const newSpeedRaw = Number((clipToUpdate as any).speed);
        const newSpeed = Math.max(
          0.1,
          Math.min(5, Number.isFinite(newSpeedRaw) ? newSpeedRaw : 1),
        );

        // Anchor at left edge: keep startFrame, adjust endFrame to preserve source coverage
        const start = Math.max(0, Number(current.startFrame || 0));
        const end = Math.max(start + 1, Number(current.endFrame || start + 1));
        const oldDuration = Math.max(1, end - start);
        const newDuration = Math.max(
          1,
          Math.round(oldDuration * (oldSpeed / newSpeed)),
        );
        nextUpdate.endFrame = start + newDuration;
        (nextUpdate as VideoClipProps).speed = newSpeed as any;
        // Keys stay on the media: their frames scale with the clip.
        if (!Object.prototype.hasOwnProperty.call(clipToUpdate, "keyframes")) {
          nextUpdate.keyframes = scaleKeyframes(current.keyframes, oldSpeed / newSpeed);
        }
      }

      const updatedClip = { ...current, ...nextUpdate } as AnyClipProps;
      let newClips = [...state.clips];
      newClips[index] = updatedClip;

      // Timing and track changes leave a locked track alone, and don't go onto one.
      const timingKeys = ["startFrame", "endFrame", "trimStart", "trimEnd", "timelineId", "speed"] as const;
      const retimed = timingKeys.some((k) => Object.prototype.hasOwnProperty.call(nextUpdate, k) && (nextUpdate as any)[k] !== (current as any)[k]);
      if (retimed && (isClipLocked(state.clips, state.timelines, current, linkage()) || isTrackLocked(state.timelines, updatedClip.timelineId))) {
        return {};
      }
      const deltaStart = (updatedClip.startFrame ?? 0) - (current.startFrame ?? 0);
      const deltaEnd = (updatedClip.endFrame ?? 0) - (current.endFrame ?? 0);

      // Linked clips keep time with it: they move as it moves (on their own tracks) and take
      // its speed.
      if (current.type !== "group") {
        const speedChanged = (nextUpdate as VideoClipProps).speed !== undefined && (nextUpdate as VideoClipProps).speed !== (current as VideoClipProps).speed;
        for (const partner of partners(state.clips, current)) {
          const i = newClips.findIndex((c) => c.clipId === partner.clipId);
          if (speedChanged && (partner.type === "video" || partner.type === "audio")) {
            const speed = (nextUpdate as VideoClipProps).speed as number;
            const start = partner.startFrame + deltaStart;
            const length = Math.max(1, Math.round(Math.max(1, partner.endFrame - partner.startFrame) * (Math.max(0.1, Number(partner.speed || 1)) / speed)));
            const keyframes = scaleKeyframes(partner.keyframes, Math.max(0.1, Number(partner.speed || 1)) / speed);
            newClips[i] = { ...partner, speed, startFrame: start, endFrame: start + length, keyframes } as AnyClipProps;
          } else if (deltaStart !== 0 || deltaEnd !== 0) {
            newClips[i] = { ...partner, startFrame: partner.startFrame + deltaStart, endFrame: partner.endFrame + deltaEnd };
          }
        }
      }

      // Moved onto or along the main track with the magnet on: it goes in at its new start
      // (a clip's start, from insertionFrame), the clips after it making room.
      const main = mainTrackOf(state.timelines);
      const moved = updatedClip.timelineId !== current.timelineId || (deltaStart !== 0 && deltaStart === deltaEnd);
      if (state.magnet && main && updatedClip.timelineId === main.timelineId && moved) {
        newClips = packMainTrack(newClips, state.timelines, { ids: [clipId], at: updatedClip.startFrame ?? 0 }, linkage());
      }

      // If updating a group clip's location, offset its children accordingly
      if (current.type === "group") {
        const oldStart = current.startFrame ?? 0;
        const newStart = updatedClip.startFrame ?? oldStart;
        const deltaStart = newStart - oldStart;
        const timelineChanged =
          typeof updatedClip.timelineId === "string" &&
          updatedClip.timelineId !== current.timelineId;
        const newTimelineId = updatedClip.timelineId;

        const childrenNested =
          (updatedClip as GroupClipProps).children || ([] as any);
        const childIdsFlat: string[] = (childrenNested as string[][]).reduce(
          (acc: string[], sub) => acc.concat(sub),
          [],
        );
        if (deltaStart !== 0 || timelineChanged) {
          newClips = newClips.map((clipItem) => {
            if (!childIdsFlat.includes(clipItem.clipId)) return clipItem;
            const shiftedStart = (clipItem.startFrame ?? 0) + deltaStart;
            const shiftedEnd = (clipItem.endFrame ?? 0) + deltaStart;
            const nextChild: AnyClipProps = {
              ...clipItem,
              startFrame: shiftedStart,
              endFrame: shiftedEnd,
            };
            if (timelineChanged && newTimelineId) {
              (nextChild as AnyClipProps).timelineId = newTimelineId;
            }
            return nextChild;
          });
        }
      }

      const resolvedClips = resolveOverlaps(newClips as AnyClipProps[]);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      // update the zoom level
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      get()._updateZoomLevel(resolvedClips, clipDuration);
      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    }),
  separateClip: (clipId) =>
    set((state) => {
      const clip = state.clips.find((c) => c.clipId === clipId);
      if (!clip || clip.type !== "video") return { clips: state.clips };
      if (isClipLocked(state.clips, state.timelines, clip, linkage())) return {};
      const newClipId1 = uuidv4();
      const newClipId2 = uuidv4();
      const newAudioTimelineId = uuidv4();

      // Find the index of the current timeline
      const currentTimelineIndex = state.timelines.findIndex(
        (t) => t.timelineId === clip.timelineId,
      );
      const clipTimeline = state.getTimelineById(clip.timelineId || "");

      // Create a new audio timeline for the separated audio clip
      const audioTimeline: TimelineProps = {
        timelineId: newAudioTimelineId,
        type: "audio",
        timelineHeight: getTimelineHeightForClip("audio"),
        timelineWidth: clipTimeline?.timelineWidth ?? 0,
        timelineY:
          (clipTimeline?.timelineY ?? 0) + (clipTimeline?.timelineHeight ?? 54),
        timelinePadding: clipTimeline?.timelinePadding ?? 0,
        muted: false,
        hidden: false,
      };
      const asset = get().getAssetById(clip.assetId);
      const url1 = new URL(asset?.path ?? "");
      const url2 = new URL(asset?.path ?? "");

      url1.hash = "video";
      url2.hash = "audio";
      const asset1 = get().addAsset({ 
        path: url1.toString(),
        type: "video",
        duration: asset?.duration ?? 0,
        width: asset?.width ?? 0,
        height: asset?.height ?? 0,
      });
      const asset2 = get().addAsset({ 
        path: url2.toString(),
        type: "audio",
        duration: asset?.duration ?? 0,
        width: asset?.width ?? 0,
        height: asset?.height ?? 0,
      });

      // The two stay linked, as in CapCut: they move, trim, split and delete together.
      const linkId = uuidv4();
      const clipVideo: AnyClipProps = {
        ...clip,
        assetId: asset1.id,
        clipId: newClipId1,
        linkId,
      };
      const clipAudio: AnyClipProps = {
        ...clip,
        type: "audio",
        assetId: asset2.id,
        clipId: newClipId2,
        timelineId: newAudioTimelineId,
        linkId,
      };
      // A converted CapCut clip's payload stays with the video: the audio is a plain audio clip.
      delete (clipAudio as any).engine;

      // Remove the original clip and add both new clips
      const newClips = [
        ...state.clips.filter((c) => c.clipId !== clipId),
        clipVideo,
        clipAudio,
      ];

      // Insert the new audio timeline directly below the current timeline
      const newTimelines =
        currentTimelineIndex !== -1
          ? [
              ...state.timelines.slice(0, currentTimelineIndex + 1),
              audioTimeline,
              ...state.timelines.slice(currentTimelineIndex + 1),
            ]
          : [...state.timelines, audioTimeline];
      const resolvedTimelines = resolveOverlapsTimelines(newTimelines);

      // Resolve overlaps and calculate duration
      const resolvedClips = resolveOverlaps(newClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(get().assets, resolvedClips);
      return {
        clips: resolvedClips,
        clipDuration,
        assets: prunedAssets,
        timelines: resolvedTimelines,
      };
    }),
  isValidResize: (clipId: string, side: "left" | "right", newFrame: number) => {
    const state = get();
    const clip = state.clips.find((c) => c.clipId === clipId);
    if (!clip || clip.type === "group" || isClipLocked(state.clips, state.timelines, clip, linkage())) return false;
    const edge = side === "right" ? clip.endFrame ?? 0 : clip.startFrame ?? 0;
    const delta = newFrame - edge;
    return clampEdgeDelta(clip, side, delta) === delta;
  },
  // An edge dragged to `newFrame`, as far as the clip's media allows. Clips linked to it
  // (its extracted audio) take the same change, so they stay in step; it goes only as far as
  // all of them can. Neighbours aren't checked: resolveOverlaps pushes them, and with the
  // magnet on the main track closes up (a left edge stays where the clip before ends).
  resizeClip: (clipId: string, side: "left" | "right", newFrame: number) =>
    set((state) => {
      const clip = state.clips.find((c) => c.clipId === clipId);
      if (!clip || clip.type === "group" || isClipLocked(state.clips, state.timelines, clip, linkage())) return {};
      const group = [clip, ...partners(state.clips, clip).filter((c) => c.type !== "group" && !c.hidden)];
      const edge = side === "right" ? clip.endFrame ?? 0 : clip.startFrame ?? 0;
      let delta = Math.round(newFrame) - edge;
      for (const c of group) delta = clampEdgeDelta(c, side, delta);
      if (delta === 0) return {};
      const changed = new Map(group.map((c) => [c.clipId, moveEdge(c, side, delta)] as const));
      const newClips = state.clips.map((c) => changed.get(c.clipId) ?? c);
      const resolvedClips = resolveOverlaps(newClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      get()._updateZoomLevel(resolvedClips, clipDuration);
      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    }),
  updateMaskKeyframes: (clipId, maskId, updater) =>
    set((state) => {
      const newClips = [...state.clips];
      const clipIndex = newClips.findIndex(
        (c) =>
          c.clipId === clipId && (c.type === "video" || c.type === "image"),
      );
      if (clipIndex === -1) return { clips: state.clips };

      const clip = newClips[clipIndex] as VideoClipProps | ImageClipProps;
      const masks = [...(clip.masks || [])];
      const maskIndex = masks.findIndex((m) => m.id === maskId);
      if (maskIndex === -1) return { clips: state.clips };

      const targetMask = masks[maskIndex];
      const updatedKeyframes = updater(
        targetMask.keyframes as
          | Map<number, MaskData>
          | Record<number, MaskData>,
      );

      masks[maskIndex] = {
        ...targetMask,
        keyframes: updatedKeyframes,
        lastModified: Date.now(),
      } as MaskClipProps;

      newClips[clipIndex] = {
        ...clip,
        masks,
      } as AnyClipProps;

      const resolvedClips = resolveOverlaps(newClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    }),
  groupClips: (clipIds: string[]) =>
    set((state) => {
      const newClips = [...state.clips];
      const clips = newClips.filter((c) => clipIds.includes(c.clipId));
      if (clips.some((c) => isClipLocked(state.clips, state.timelines, c, linkage()))) return {};
      // Sort clips by vertical timeline position (top to bottom), then by startFrame
      const sortedByTimeline = [...clips].sort((a, b) => {
        const ta = state.timelines.find((t) => t.timelineId === a.timelineId);
        const tb = state.timelines.find((t) => t.timelineId === b.timelineId);
        const yA = ta?.timelineY ?? 0;
        const yB = tb?.timelineY ?? 0;
        if (yA !== yB) return yA - yB; // earlier (smaller) timelineY first
        return (a.startFrame || 0) - (b.startFrame || 0);
      });
      // sort our clips based on location on the tim
      const startFrame = clips.reduce(
        (min, c) => Math.min(min, c.startFrame || 0),
        Infinity,
      );
      const endFrame = clips.reduce(
        (max, c) => Math.max(max, c.endFrame || 0),
        -Infinity,
      );
      const groupClipId = uuidv4();

      // Choose a valid media timeline with sufficient free space; if none, create one
      const desiredType: TimelineType = "media";
      const intervalOverlaps = (
        loA: number,
        hiA: number,
        loB: number,
        hiB: number,
      ) => loA < hiB && hiA > loB;

      // Check free space on a timeline between startFrame and endFrame
      // Exclude the selected clips being grouped since they'll be hidden/removed from timelines
      const idsToExclude = new Set(clips.map((c) => c.clipId));
      const hasFreeSpace = (timelineId: string) => {
        const existing = state
          .getClipsForTimeline(timelineId)
          .filter((c) => !idsToExclude.has(c.clipId))
          .map((c) => ({ lo: c.startFrame || 0, hi: c.endFrame || 0 }))
          .filter((iv) => iv.hi > iv.lo);
        return !existing.some((iv) =>
          intervalOverlaps(startFrame, endFrame, iv.lo, iv.hi),
        );
      };

      // Candidates: all existing media timelines with free space, pick lowest timelineY
      const mediaTimelines = state.timelines.filter(
        (t) => t.type === desiredType,
      );
      const candidateTimelines = mediaTimelines
        .filter((t) => hasFreeSpace(t.timelineId) && !t.locked)
        .sort((a, b) => (a.timelineY || 0) - (b.timelineY || 0));

      // Clips grouped from the main track stay on it where they can, as a CapCut compound
      // clip does (with the magnet on, the main track would otherwise close up behind them).
      const main = mainTrackOf(state.timelines);
      const fromMain = main && clips.some((c) => c.timelineId === main.timelineId) && candidateTimelines.includes(main);
      let targetTimelineId: string | undefined = fromMain
        ? main.timelineId
        : candidateTimelines[0]?.timelineId;

      const timelines = [...state.timelines];

      // If no suitable existing timeline, create a new media timeline, above the main track
      // (one under it would become the main track).
      if (!targetTimelineId) {
        const newTimelineId = uuidv4();
        const last = state.timelines[state.timelines.length - 1];
        const newTimeline: TimelineProps = {
          timelineId: newTimelineId,
          type: desiredType,
          timelineHeight: getTimelineHeightForClip("group"),
          timelineWidth: last?.timelineWidth ?? 0,
          timelineY: (last?.timelineY ?? 0) + (last?.timelineHeight ?? 54),
          timelinePadding: last?.timelinePadding ?? 24,
          muted: false,
          hidden: false,
        };
        const mainIndex = main ? timelines.indexOf(main) : -1;
        if (mainIndex === -1) timelines.push(newTimeline);
        else timelines.splice(mainIndex, 0, newTimeline);
        targetTimelineId = newTimelineId;
      }

      // Build nested children arrays: per-timeline lists ordered by y then by startFrame
      const uniqueSortedTimelineIds: string[] = Array.from(
        new Set(sortedByTimeline.map((c) => c.timelineId || "")),
      );
      const timelinesByY = uniqueSortedTimelineIds
        .map((id) => ({
          id,
          y: state.timelines.find((t) => t.timelineId === id)?.timelineY ?? 0,
        }))
        .sort((a, b) => a.y - b.y)
        .map((x) => x.id);

      const childrenNested: string[][] = timelinesByY
        .map((tid) =>
          sortedByTimeline
            .filter((c) => c.timelineId === tid)
            .sort((a, b) => (a.startFrame || 0) - (b.startFrame || 0))
            .map((c) => c.clipId),
        )
        .filter((sub) => sub.length > 0);

      const groupClip: GroupClipProps = {
        type: "group",
        clipId: groupClipId,
        timelineId: targetTimelineId,
        startFrame: startFrame,
        endFrame: endFrame,
        children: childrenNested,
      };

      // we need to replace our sortedbytimeline clips and add the group clip
      const clipsToReplace = [...state.clips];
      sortedByTimeline.forEach((c) => {
        const index = clipsToReplace.findIndex((x) => x.clipId === c.clipId);
        if (index !== -1) {
          clipsToReplace[index] = { ...c, groupId: groupClipId, hidden: true };
        }
      });

      const finalClips = [...clipsToReplace, groupClip];
      const resolvedClips = resolveOverlaps(finalClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      get()._updateZoomLevel(resolvedClips, clipDuration);
      const resolvedTimelines = resolveOverlapsTimelines(timelines);

      // Select the newly created group
      try {
        const controls = useControlsStore.getState();
        controls.setSelectedClipIds([groupClipId]);
      } catch {}

      return {
        clips: resolvedClips,
        clipDuration,
        assets: prunedAssets,
        timelines: resolvedTimelines,
      };
    }),
  ungroupClips: (_groupId: string) =>
    set((state) => {
      const groupClip = state.clips.find((c) => c.clipId === _groupId);
      if (!groupClip || groupClip.type !== "group")
        return { clips: state.clips };
      if (isTrackLocked(state.timelines, groupClip.timelineId)) return {};

      const childrenNested = ((groupClip as GroupClipProps).children ||
        []) as string[][];
      if (!childrenNested || childrenNested.length === 0) {
        // No children, just remove the empty group
        const remaining = state.clips.filter((c) => c.clipId !== _groupId);
        const resolvedClips = resolveOverlaps(remaining);
        const clipDuration = calculateTotalClipDuration(resolvedClips);
        get()._updateZoomLevel(resolvedClips, clipDuration);
        const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
        return { clips: resolvedClips, clipDuration, assets: prunedAssets };
      }

      // Determine ordering: always ungroup upwards
      // childrenNested is ordered top->bottom; bottom is the last array
      const bottomIndex = childrenNested.length - 1;

      // Precompute child clips map for quick lookup
      const clipsById = new Map(state.clips.map((c) => [c.clipId, c] as const));

      // Helper: derive required timeline type for a subarray from its first child
      const requiredTypeForSub = (ids: string[]): TimelineType => {
        const first = ids.map((id) => clipsById.get(id)).find(Boolean) as
          | AnyClipProps
          | undefined;
        if (!first) return "media";
        return getTimelineTypeForClip(first);
      };

      // Helper: compute [start,end) for a subarray
      const boundsForSub = (ids: string[]): [number, number] => {
        const items = ids
          .map((id) => clipsById.get(id))
          .filter(Boolean) as AnyClipProps[];
        const s = items.reduce(
          (min, c) => Math.min(min, c.startFrame || 0),
          Infinity,
        );
        const e = items.reduce(
          (max, c) => Math.max(max, c.endFrame || 0),
          -Infinity,
        );
        return [Math.max(0, s), Math.max(Math.max(0, s) + 1, e)];
      };

      const intervalOverlaps = (
        loA: number,
        hiA: number,
        loB: number,
        hiB: number,
      ) => loA < hiB && hiA > loB;

      // Build quick timeline index lookup and locate the group's timeline position
      const timelines = [...state.timelines];
      const timelineIndexById = new Map(
        timelines.map((t, i) => [t.timelineId, i] as const),
      );
      const groupTimelineIndex = timelineIndexById.get(
        groupClip.timelineId || "",
      );

      // If group's timeline is missing, fallback to appending to the bottom
      const fallbackGroupIndex =
        typeof groupTimelineIndex === "number"
          ? groupTimelineIndex
          : timelines.length - 1;

      // Track planned intervals per timeline to avoid conflicts when placing multiple subarrays
      const plannedIntervals = new Map<string, Array<[number, number]>>();

      const hasFreeSpace = (
        timelineId: string,
        start: number,
        end: number,
        excludeClipIds: Set<string>,
      ) => {
        const existing = state
          .getClipsForTimeline(timelineId)
          .filter((c) => !excludeClipIds.has(c.clipId))
          .map((c) => ({ lo: c.startFrame || 0, hi: c.endFrame || 0 }))
          .filter((iv) => iv.hi > iv.lo);
        const planned = plannedIntervals.get(timelineId) || [];
        return ![...existing, ...planned.map(([lo, hi]) => ({ lo, hi }))].some(
          (iv) => intervalOverlaps(start, end, iv.lo, iv.hi),
        );
      };

      // Assign a target timeline for a subarray, searching upwards (indices decreasing)
      const assignTimelineUpwards = (
        subIds: string[],
        baseIndex: number,
        preferExactIndexId?: string,
      ): string => {
        const [s, e] = boundsForSub(subIds);
        const excludeIds = new Set<string>(subIds.concat(_groupId));
        const requiredType = requiredTypeForSub(subIds);

        // 1) Try the preferred timeline (group's timeline) if provided and compatible
        if (preferExactIndexId) {
          const tl = timelines.find((t) => t.timelineId === preferExactIndexId);
          if (
            tl &&
            tl.type === requiredType &&
            hasFreeSpace(tl.timelineId, s, e, excludeIds)
          ) {
            const arr = plannedIntervals.get(tl.timelineId) || [];
            arr.push([s, e]);
            plannedIntervals.set(tl.timelineId, arr);
            return tl.timelineId;
          }
        }

        // 2) Search existing timelines above for matching type and free space
        for (let i = Math.max(0, baseIndex - 1); i >= 0; i--) {
          const tl = timelines[i];
          if (!tl) continue;
          if (tl.type !== requiredType) continue;
          if (hasFreeSpace(tl.timelineId, s, e, excludeIds)) {
            const arr = plannedIntervals.get(tl.timelineId) || [];
            arr.push([s, e]);
            plannedIntervals.set(tl.timelineId, arr);
            return tl.timelineId;
          }
        }

        // 3) Create a new timeline of the required type inserted above the baseIndex
        const newTimelineId = uuidv4();
        const height = getTimelineHeightForClip(requiredType);
        const ref = timelines[Math.max(0, baseIndex)];
        const newTimeline: TimelineProps = {
          timelineId: newTimelineId,
          type: requiredType,
          timelineHeight: height,
          timelineWidth: ref?.timelineWidth ?? 0,
          timelineY: 0,
          timelinePadding: ref?.timelinePadding ?? 24,
          muted: false,
          hidden: false,
        };
        const insertAt = Math.max(0, baseIndex);
        timelines.splice(insertAt, 0, newTimeline);

        // Reserve the interval on this newly created timeline
        plannedIntervals.set(newTimelineId, [[s, e]]);
        return newTimelineId;
      };

      // Build assignments from bottom subarray at group's timeline, then upwards
      const assignments = new Map<number, string>(); // subIndex -> timelineId

      // Bottom subarray: prefer group's timeline
      const groupTlId = (timelines[fallbackGroupIndex] || {}).timelineId;
      const bottomTlId = assignTimelineUpwards(
        childrenNested[bottomIndex],
        fallbackGroupIndex,
        groupTlId,
      );
      assignments.set(bottomIndex, bottomTlId);

      // Remaining subarrays: place upwards (search above the group's index)
      for (let idx = bottomIndex - 1; idx >= 0; idx--) {
        const tlId = assignTimelineUpwards(
          childrenNested[idx],
          fallbackGroupIndex,
        );
        assignments.set(idx, tlId);
      }

      // Reveal children and remove the group
      const childIdsFlat = childrenNested.flat();
      const childIdSet = new Set(childIdsFlat);

      const newClips = state.clips
        .filter((c) => c.clipId !== _groupId)
        .map((c) => {
          if (!childIdSet.has(c.clipId)) return c;
          // Determine which subarray this child belongs to
          const subIndex = childrenNested.findIndex((sub) =>
            sub.includes(c.clipId),
          );
          const targetTimelineId = assignments.get(subIndex || 0);
          return {
            ...c,
            hidden: false,
            groupId: undefined,
            timelineId: targetTimelineId ?? c.timelineId,
          } as AnyClipProps;
        });

      // Resolve timelines positioning after inserts
      const resolvedTimelines = resolveOverlapsTimelines(timelines);

      const resolvedClips = resolveOverlaps(newClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      get()._updateZoomLevel(resolvedClips, clipDuration);

      // Select all ungrouped children
      try {
        const controls = useControlsStore.getState();
        controls.setSelectedClipIds(childIdsFlat);
      } catch {}

      return {
        clips: resolvedClips,
        clipDuration,
        assets: pruneAssetsForClips(state.assets, resolvedClips),
        timelines: resolvedTimelines,
      };
    }),

  // Create two new clips from the original clip at the cut frame. Clips linked to it are cut
  // there too: the left halves stay linked to each other, and the right halves.
  splitClip: (cutFrame: number, clipId: string) =>
    set((state) => {
      // Find the clip that contains the cut frame
      const within = (c: AnyClipProps) => cutFrame > (c.startFrame || 0) && cutFrame < (c.endFrame || 0);
      const clip = state.clips.find((c) => c.clipId === clipId && within(c));
      if (!clip || isClipLocked(state.clips, state.timelines, clip, linkage())) return {};
      const cut = [clip, ...partners(state.clips, clip).filter((c) => within(c) && c.type !== "group")];
      const [leftLink, rightLink] = [uuidv4(), uuidv4()];
      const halves = cut.map((c) => {
        const [left, right] = splitClipAt(c, cutFrame);
        if (cut.length > 1) {
          left.linkId = leftLink;
          right.linkId = rightLink;
        }
        return [left, right] as const;
      });
      const cutIds = new Set(cut.map((c) => c.clipId));
      const newClips = [...state.clips.filter((c) => !cutIds.has(c.clipId)), ...halves.flat()];
      const resolvedClips = resolveOverlaps(newClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(get().assets, resolvedClips);
      get()._updateZoomLevel(resolvedClips, clipDuration);
      const controlStore = useControlsStore.getState();
      controlStore.setSelectedClipIds([halves[0][0].clipId, halves[0][1].clipId]);
      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    }),
  splitAtPlayhead: (frame, clipIds) => {
    const state = get();
    const at = (c: AnyClipProps) =>
      !c.hidden && c.type !== "group" && frame > (c.startFrame ?? 0) && frame < (c.endFrame ?? 0) && !isClipLocked(state.clips, state.timelines, c, linkage());
    const main = mainTrackOf(state.timelines);
    const targets =
      clipIds === "all"
        ? state.clips.filter(at)
        : clipIds.length > 0
          ? state.clips.filter((c) => clipIds.includes(c.clipId) && at(c))
          : state.clips.filter((c) => c.timelineId === main?.timelineId && at(c));
    // A linked clip is cut with the first of its link to come: then it isn't there any more.
    const selection: string[] = [];
    for (const c of targets) {
      if (!get().clips.some((x) => x.clipId === c.clipId)) continue;
      get().splitClip(frame, c.clipId);
      selection.push(...useControlsStore.getState().selectedClipIds);
    }
    if (selection.length > 0) useControlsStore.getState().setSelectedClipIds(selection);
    return selection.length > 0;
  },
  trimToPlayhead: (side, frame, clipIds) => {
    const state = get();
    const at = (c: AnyClipProps) =>
      !c.hidden && c.type !== "group" && frame > (c.startFrame ?? 0) && frame < (c.endFrame ?? 0) && !isClipLocked(state.clips, state.timelines, c, linkage());
    const main = mainTrackOf(state.timelines);
    const chosen = state.clips.filter((c) => clipIds.includes(c.clipId) && at(c));
    const targets = chosen.length > 0 ? chosen : state.clips.filter((c) => c.timelineId === main?.timelineId && at(c));
    if (targets.length === 0) return false;
    const done = new Set<string>();
    let mainClipId: string | null = null;
    for (const t of targets) {
      if (done.has(t.clipId)) continue;
      // Its linked clips are trimmed with it.
      [t, ...partners(state.clips, t)].forEach((c) => done.add(c.clipId));
      if (t.timelineId === main?.timelineId) mainClipId = t.clipId;
      get().resizeClip(t.clipId, side, frame);
    }
    // Delete left on the main track with the magnet on: what's left of the clip moves back to
    // where the clip started, and the playhead goes with it, as in CapCut.
    if (side === "left" && mainClipId && get().magnet) {
      const clip = get().getClipById(mainClipId);
      if (clip) useControlsStore.getState().setFocusFrame(clip.startFrame ?? 0);
    }
    return true;
  },
  linkClips: (clipIds) =>
    set((state) => {
      const clips = state.clips.filter((c) => clipIds.includes(c.clipId) && !c.hidden && c.type !== "group");
      if (clips.length < 2 || clips.some((c) => isTrackLocked(state.timelines, c.timelineId))) return {};
      const linkId = uuidv4();
      const ids = new Set(clips.map((c) => c.clipId));
      return { clips: state.clips.map((c) => (ids.has(c.clipId) ? ({ ...c, linkId } as AnyClipProps) : c)) };
    }),
  unlinkClips: (clipIds) =>
    set((state) => {
      const links = new Set(state.clips.filter((c) => clipIds.includes(c.clipId) && c.linkId).map((c) => c.linkId));
      if (links.size === 0) return {};
      return { clips: state.clips.map((c) => (c.linkId && links.has(c.linkId) ? ({ ...c, linkId: undefined } as AnyClipProps) : c)) };
    }),
  mergeClips: (clipIds: string[]) =>
    set((state) => {
      if (clipIds.length < 2) return { clips: state.clips };

      // Find all clips to merge
      const clipsToMerge = clipIds
        .map((id) => state.clips.find((clip) => clip.clipId === id))
        .filter(Boolean) as AnyClipProps[];

      if (clipsToMerge.length < 2) return { clips: state.clips };

      // Sort clips by start frame to check adjacency
      const sortedClips = clipsToMerge.sort(
        (a, b) => (a.startFrame || 0) - (b.startFrame || 0),
      );

      // Check if all clips are frame-adjacent (no gaps between them)
      for (let i = 0; i < sortedClips.length - 1; i++) {
        const currentEnd = sortedClips[i].endFrame || 0;
        const nextStart = sortedClips[i + 1].startFrame || 0;

        // If there's a gap between clips, don't merge
        if (currentEnd !== nextStart) {
          return { clips: state.clips };
        }
      }

      // Remove the clips from the array
      const filteredClips = state.clips.filter(
        (clip) => !clipIds.includes(clip.clipId),
      );

      // Find the bounds of all clips to merge
      const clipStart = sortedClips[0].startFrame || 0;
      const clipEnd = sortedClips[sortedClips.length - 1].endFrame || 0;

      // Use the first clip as the base and merge all others into it
      const baseClip = sortedClips[0];
      const newClip = { ...baseClip, startFrame: clipStart, endFrame: clipEnd };
      const newClips = [...filteredClips, newClip];
      const resolvedClips = resolveOverlaps(newClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    }),
  copyClips: (clipIds: string[]) =>
    set((state) => {
      if (!clipIds || clipIds.length === 0)
        return { clipboard: state.clipboard };
      const toCopy = clipIds
        .map((id) => state.clips.find((c) => c.clipId === id))
        .filter(Boolean) as AnyClipProps[];
      return { clipboard: toCopy.map((c) => ({ ...c })) };
    }),
  getClipsByType: (type: ClipType) =>
    get().clips.filter((c) => c.type === type),
  getClipsForGroup: (children: string[][]) => {
    const state = get();
    const clipsById = new Map(state.clips.map((c) => [c.clipId, c] as const));
    const getY = (timelineId?: string) =>
      state.timelines.find((t) => t.timelineId === timelineId)?.timelineY ?? 0;

    // Map each child id to its clip, filter missing, then sort by render order:
    // bottom-to-top (higher timelineY first). Use startFrame as a stable tie-breaker.
    const flat: AnyClipProps[] = (children || [])
      .flat()
      .map((id) => clipsById.get(id))
      .filter((c): c is AnyClipProps => Boolean(c))
      .sort((a, b) => {
        const ya = getY(a.timelineId);
        const yb = getY(b.timelineId);
        if (ya !== yb) return yb - ya; // larger y first (drawn earlier)
        const sa = a.startFrame ?? 0;
        const sb = b.startFrame ?? 0;
        return sa - sb;
      })
      .reverse();

    return flat;
  },
  cutClips: (clipIds: string[]) =>
    set((state) => {
      if (!clipIds || clipIds.length === 0)
        return { clips: state.clips, clipboard: state.clipboard };
      // Not from a locked track; a clip's linked clips go with it, as in a delete.
      const picked = state.clips.filter((c) => clipIds.includes(c.clipId) && !isClipLocked(state.clips, state.timelines, c, linkage()));
      const toCut = _.uniqBy([...picked, ...picked.flatMap((c) => partners(state.clips, c))], (c) => c.clipId);
      const cutIds = new Set(toCut.map((c) => c.clipId));
      const remaining = state.clips.filter((c) => !cutIds.has(c.clipId));
      const resolvedClips = resolveOverlaps(remaining);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      return {
        clips: resolvedClips,
        clipDuration,
        clipboard: toCut.map((c) => ({ ...c })),
        assets: prunedAssets,
      };
    }),
  pasteClips: (atFrame?: number, targetTimelineId?: string) =>
    set((state) => {
      const clipboardItems = state.clipboard || [];
      if (clipboardItems.length === 0) return { clips: state.clips };
      const baseStart = Math.min(
        ...clipboardItems.map((c) => c.startFrame || 0),
      );
      const insertionFrame = Math.max(0, Math.round(atFrame || 0));
      const newIds: string[] = [];
      // Determine the destination timeline per item: prefer provided target, otherwise a compatible existing timeline or create one
      const chooseTimelineFor = (template: AnyClipProps): string => {
        if (targetTimelineId && !isTrackLocked(state.timelines, targetTimelineId)) return targetTimelineId;
        const desiredType = getTimelineTypeForClip(template);
        const existing = state.timelines.find((t) => t.type === desiredType && !t.locked);
        if (existing) return existing.timelineId;
        // If no matching timeline, create one beside last timeline
        const timelineId = uuidv4();
        const last = state.timelines[state.timelines.length - 1];
        const newTimeline: TimelineProps = {
          timelineId,
          type: desiredType,
          timelineHeight: getTimelineHeightForClip(desiredType),
          timelineWidth: last?.timelineWidth ?? 0,
          timelineY: (last?.timelineY ?? 0) + (last?.timelineHeight ?? 54),
          timelinePadding: last?.timelinePadding ?? 24,
          muted: false,
          hidden: false,
        };
        state.addTimeline(newTimeline);
        return timelineId;
      };
      // Copies of linked clips are linked to each other, not to the originals.
      const links = new Map<string, string>();
      const linkCounts = _.countBy(clipboardItems.filter((c) => c.linkId), (c) => c.linkId);
      const linkFor = (id?: string) => {
        if (!id || linkCounts[id] < 2) return undefined;
        if (!links.has(id)) links.set(id, uuidv4());
        return links.get(id);
      };
      const pasted = clipboardItems.map((template) => {
        const templateStart = template.startFrame || 0;
        const templateEnd = template.endFrame || 0;
        const duration = Math.max(1, templateEnd - templateStart);
        const offset = templateStart - baseStart;
        const start = insertionFrame + offset;
        const end = start + duration;
        const newId = uuidv4();
        newIds.push(newId);
        const timelineId = chooseTimelineFor(template);
        return {
          ...template,
          clipId: newId,
          timelineId,
          startFrame: start,
          endFrame: end,
          trimEnd: 0,
          trimStart: 0,
          linkId: linkFor(template.linkId),
        } as AnyClipProps;
      });
      let newClips = [...state.clips, ...pasted];
      // Onto the main track with the magnet on: in at the clip boundary nearest the playhead,
      // the clips after making room.
      const timelines = get().timelines;
      const main = mainTrackOf(timelines);
      const onMain = pasted.filter((c) => c.timelineId === main?.timelineId);
      if (state.magnet && main && onMain.length > 0) {
        const at = mainInsertionFrame(state.clips, timelines, insertionFrame);
        newClips = packMainTrack(newClips, timelines, { ids: onMain.map((c) => c.clipId), at }, linkage());
      }
      const resolvedClips = resolveOverlaps(newClips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);
      // The timeline's zoom range follows a longer project, as after an add.
      get()._updateZoomLevel(resolvedClips, clipDuration);
      // Select newly pasted clips
      try {
        const controls = useControlsStore.getState();
        controls.setSelectedClipIds(newIds);
      } catch {}
      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    }),
  getClipAtFrame: (frame: number) => {
    const clips = get().clips;
    const clip = clips.find(
      (clip) =>
        frame >= (clip.startFrame || 0) && frame <= (clip.endFrame || 0),
    );
    if (!clip) return null;
    return [clip, frame - (clip.startFrame || 0)];
  },
  clipWithinFrame: (
    clip: AnyClipProps,
    frame: number,
    overlap: boolean = false,
    overlapAmount: number = 0,
  ) => {
    if (overlap) {
      return (
        frame >= (clip.startFrame || 0) - (overlapAmount || 0) &&
        frame <= (clip.endFrame || 0)
      );
    }
    return frame >= (clip.startFrame || 0) && frame <= (clip.endFrame || 0);
  },
  getTimelinePosition: (timelineId: string, scrollY?: number) => {
    const timeline = get().timelines.find((t) => t.timelineId === timelineId);
    if (!timeline) return { top: 0, bottom: 0, left: 0, right: 0 };
    const top = (timeline.timelineY ?? 0) + 8 - (scrollY || 0);
    const bottom = top + (timeline.timelineHeight ?? 54);
    return {
      top,
      bottom,
      left: timeline.timelinePadding!,
      right: timeline.timelinePadding! + (timeline.timelineWidth ?? 0),
    };
  },
  getClipPosition: (clipId: string, scrollY?: number) => {
    const clip = get().clips.find((c) => c.clipId === clipId);
    if (!clip) return { top: 0, bottom: 0, left: 0, right: 0 };

    const timeline = get().timelines.find(
      (t) => t.timelineId === clip.timelineId,
    );
    if (!timeline) return { top: 0, bottom: 0, left: 0, right: 0 };

    const controls = useControlsStore.getState();
    const timelineDuration = controls.timelineDuration;

    const clipX = getClipX(
      clip.startFrame ?? 0,
      clip.endFrame ?? 0,
      timeline.timelineWidth ?? 0,
      timelineDuration,
    );
    const clipWidth = getClipWidth(
      clip.startFrame ?? 0,
      clip.endFrame ?? 0,
      timeline.timelineWidth ?? 0,
      timelineDuration,
    );

    const top = (timeline.timelineY ?? 0) + 8 - (scrollY || 0);
    const bottom = top + (timeline.timelineHeight ?? 54);
    const left = (timeline.timelinePadding ?? 0) + clipX;
    const right = left + clipWidth;

    return { top, bottom, left, right };
  },
  getClipPositionScore: (clipId: string) => {
    const state = get();
    const clip = state.clips.find((c) => c.clipId === clipId);
    if (!clip) return 0;

    // Timeline order: sort by Y (top->bottom). Lower (greater Y) timelines get higher base score.
    const timelinesSorted = [...state.timelines].sort(
      (a, b) => (a.timelineY ?? 0) - (b.timelineY ?? 0),
    );
    const timelineIndex = Math.max(
      0,
      timelinesSorted.findIndex((t) => t.timelineId === clip.timelineId),
    );

    // Weights: ensure timeline separation dominates layer, which dominates endFrame
    const TIMELINE_WEIGHT = 1e9; // enough to dominate any layer/endFrame additions
    const LAYER_WEIGHT = 1e6; // enough to dominate endFrame within same timeline

    // Compute layer rank within a timeline considering groups (we group upwards)
    let layerRank: number = 0;

    // If clip is part of a group, rank by the child's subarray index; last children array ranks highest
    const parentGroup: GroupClipProps | undefined =
      typeof (clip as any).groupId === "string"
        ? (state.clips.find(
            (c) => c.clipId === (clip as any).groupId && c.type === "group",
          ) as GroupClipProps | undefined)
        : undefined;

    if (parentGroup && Array.isArray(parentGroup.children)) {
      const childrenNested = parentGroup.children as string[][];
      const idx = childrenNested.findIndex((arr) => arr.includes(clip.clipId));
      layerRank = Math.max(0, idx);
    } else if (clip.type === "group") {
      // Place the group container just above its highest child layer
      const childrenNested = ((clip as GroupClipProps).children ||
        []) as string[][];
      const lastIdx = Math.max(0, childrenNested.length - 1);
      layerRank = lastIdx + 0.75;
    } else {
      // Non-group clip: compare against any groups on the same timeline
      const groupsOnTimeline = state.clips.filter(
        (c) => c.type === "group" && c.timelineId === clip.timelineId,
      ) as GroupClipProps[];
      if (groupsOnTimeline.length > 0) {
        const clipEnd = Math.max(0, clip.endFrame ?? 0);
        let best = 0;
        for (const g of groupsOnTimeline) {
          const lastIdx = Math.max(0, (g.children?.length ?? 1) - 1);
          const gEnd = Math.max(0, g.endFrame ?? 0);
          // If this clip ends before the group's end, it should be below only the last children array
          // Otherwise, it should be above all clips in the group
          const candidate = clipEnd <= gEnd ? lastIdx - 0.5 : lastIdx + 1;
          if (candidate > best) best = candidate;
        }
        layerRank = best;
      } else {
        layerRank = 0;
      }
    }

    const end = Math.max(0, clip.endFrame ?? 0);
    return timelineIndex * TIMELINE_WEIGHT + layerRank * LAYER_WEIGHT + end;
  },
  rescaleForFpsChange: (oldFps: number, newFps: number) => {
    set((state) => {
      const clips = (state.clips || []).map((clip) => {
        const updated: any = { ...clip };

        const sf = rescaleFrame(clip.startFrame, oldFps, newFps);
        const ef = rescaleFrame(clip.endFrame, oldFps, newFps);
        const ts = rescaleFrame((clip as any).trimStart, oldFps, newFps);
        const te = rescaleFrame((clip as any).trimEnd, oldFps, newFps);

        if (sf != null) updated.startFrame = sf;
        if (ef != null) updated.endFrame = ef;
        if (ts != null) (updated as any).trimStart = ts;
        if (te != null) (updated as any).trimEnd = te;
        if (clip.keyframes && oldFps > 0 && newFps > 0) updated.keyframes = scaleKeyframes(clip.keyframes, newFps / oldFps);

        return updated as AnyClipProps;
      });

      const resolvedClips = resolveOverlaps(clips);
      const clipDuration = calculateTotalClipDuration(resolvedClips);
      const prunedAssets = pruneAssetsForClips(state.assets, resolvedClips);

      return { clips: resolvedClips, clipDuration, assets: prunedAssets };
    });
  },
})));

export const getClipWidth = (
  startFrame: number,
  endFrame: number,
  timelineWidth: number,
  timelineDuration: number[],
) => {
  const [timelineStartFrame, timelineEndFrame] = timelineDuration;
  const percentage =
    (endFrame - startFrame) / (timelineEndFrame - timelineStartFrame);
  return timelineWidth * percentage;
};

export const getClipX = (
  startFrame: number | null,
  endFrame: number | null,
  timelineWidth: number | null,
  timelineDuration: number[],
) => {
  if (startFrame === null || endFrame === null || timelineWidth === null)
    return 0;

  const [timelineStartFrame, timelineEndFrame] = timelineDuration;
  const relativePosition =
    (startFrame - timelineStartFrame) / (timelineEndFrame - timelineStartFrame);
  return relativePosition * timelineWidth;
};

export const getTimelineX = (
  timelineWidth: number,
  timelinePadding: number,
  timelineDuration: number[],
) => {
  const [timelineStartFrame, timelineEndFrame] = timelineDuration;
  const timelineX =
    timelinePadding -
    (timelineWidth / (timelineEndFrame - timelineStartFrame)) *
      timelineStartFrame;
  return Math.max(0, timelineX);
};

export const getLocalFrame = (focusFrame: number, clip: AnyClipProps) => {
  const startFrame = clip.startFrame ?? 0;
  const trimStart = isFinite(clip.trimStart ?? 0) ? (clip.trimStart ?? 0) : 0;
  const realStartFrame = startFrame + trimStart;
  return focusFrame - realStartFrame;
};

export const getGlobalFrame = (focusFrame: number, clip: AnyClipProps) => {
  const startFrame = clip.startFrame ?? 0;
  const trimStart = isFinite(clip.trimStart ?? 0) ? (clip.trimStart ?? 0) : 0;
  const realStartFrame = startFrame + trimStart;
  return focusFrame + realStartFrame;
};

export const convertFrameToProjectSeconds = (frame: number) => {
  // get fps from controls store
  const fps = useControlsStore((s) => s.fps);
  return frame / fps;
};
