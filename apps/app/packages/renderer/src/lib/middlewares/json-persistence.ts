import type { StateCreator } from "zustand";
import { useClipStore, resolveOverlapsTimelines } from "../clip";
import { useControlsStore } from "../control";
import { noteSaved } from "../autosave";
import {
  saveProjectJson,
  loadProjectJson,
  createProject,
  listProjects,
  getActiveProjectId,
  setActiveProjectId,
  saveProjectCover,
  clearProjectCover,
} from "@app/preload";

import type {
  AnyClipProps,
  Asset,
  TimelineProps,
  MaskClipProps,
  MaskData,
  ShapeTool,
  ViewTool,
  Point,
  Marker,
  Guide,
  CompoundContent,
} from "../types";
import { foldStack } from "../compound";
import { migrateLegacyGroups } from "../bundle";
import { timelineRoot } from "../timelines";
import { listFromDoc, type TimelineContent } from "../project-timelines";

import _ from "lodash";
import { v4 as uuidv4 } from "uuid";
import { getMediaInfo } from "../media/utils";
import { useViewportStore } from "../viewport";
import { useCoverStore, type CoverSpec } from "../cover-store";
import { exportSequence, type ExportClip } from "@app/export-renderer";
import { prepareExportClipsForValue } from "../prepareExportClips";
import { sortClipsForStacking } from "../clipOrdering";
import { pauseHistory, resetHistory } from "../history";
import { isMainTrackPacked } from "../timeline-edit";
import { preferences } from "../preferences";
type JsonProjectSlice = {
  projects: Array<{
    id: number;
    name: string;
    fps: number;
    aspectRatio: { width: number; height: number; id: string };
    folderUuid: string;
    coverPath?: string;
    createdAt?: number;
    lastModified?: number;
  }>;
  addProject: (project: {
    id: number;
    name: string;
    fps: number;
    aspectRatio: { width: number; height: number; id: string };
    folderUuid: string;
  }) => void;
  updateProject?: (
    id: string | number,
    payload: Partial<{
      name: string;
      fps: number;
      aspectRatio: { width: number; height: number; id: string };
      folderUuid: string;
      coverPath?: string;
      createdAt?: number;
      lastModified?: number;
    }>,
  ) => void;
  activeProjectId: string | number | null;
  setProjects: (projects: {
    id: number;
    name: string;
    fps: number;
    aspectRatio: { width: number; height: number; id: string };
    folderUuid: string;
  }[]) => void;
  setActiveProjectId: (projectId: string | number) => void;
};

// Keep tick conversion aligned with main PersistenceModule/JSONPersistenceModule
const JSON_TICKS_PER_SECOND = 1_000_000n;
const JSON_POSITIVE_INFINITY_TICK = 1n;
const JSON_NEGATIVE_INFINITY_TICK = 2n;

const frameToTickForJson = (frame: unknown, fps: number): bigint => {
  if (frame == null) return 0n;
  if (typeof frame === "number" && !Number.isFinite(frame)) {
    return frame > 0 ? JSON_POSITIVE_INFINITY_TICK : JSON_NEGATIVE_INFINITY_TICK;
  }
  if (typeof frame === "string") {
    if (frame === "Infinity") return JSON_POSITIVE_INFINITY_TICK;
    if (frame === "-Infinity") return JSON_NEGATIVE_INFINITY_TICK;
  }
  try {
    const fpsInt = BigInt(Math.max(1, Math.round(Number(fps) || 0)));
    const f = BigInt(Math.round(Number(frame as number)));
    const numerator = f * JSON_TICKS_PER_SECOND;
    const tick = numerator / fpsInt;
    return tick;
  } catch {
    return 0n;
  }
};

const tickToFrameForJson = (tick: unknown, fps: number): number => {
  if (tick == null) return 0;
  try {
    const fpsInt = BigInt(Math.max(1, Math.round(Number(fps) || 0)));
    let t: bigint;
    if (typeof tick === "bigint") {
      t = tick;
    } else {
      const s = String(tick);
      t = BigInt(s);
    }
    if (t === JSON_POSITIVE_INFINITY_TICK) return Number.POSITIVE_INFINITY;
    if (t === JSON_NEGATIVE_INFINITY_TICK) return Number.NEGATIVE_INFINITY;
    // Ticks are truncated to whole µs, so round to the nearest frame: truncating again would
    // bring a frame whose tick isn't whole (175 at 24 fps) back a frame early, and move it a
    // frame more each time the project is opened.
    const numerator = t * fpsInt;
    const half = JSON_TICKS_PER_SECOND / 2n;
    const frame = (numerator >= 0n ? numerator + half : numerator - half) / JSON_TICKS_PER_SECOND;
    return Number(frame);
  } catch {
    return 0;
  }
};

/** A saved custom canvas size, or null. */
const validCanvas = (c: unknown): { width: number; height: number } | null => {
  const { width, height } = (c ?? {}) as { width?: number; height?: number };
  return Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0 ? { width: width!, height: height! } : null;
};

type ProjectJsonSnapshot = {
  version: string;
  meta: {
    id: string;
    name: string;
    createdAt: number;
    lastModified: number;
    projectId: number | null;
  };
  settings: {
    fps: number;
    defaultClipLength: number;
    aspectRatio?: { width: number; height: number; id: string };
    /** The canvas in pixels when Project settings' Resolution is Custom (the engine draws at it while it has the aspect ratio's shape). */
    engineCanvas?: { width: number; height: number };
    /** The main track magnet (CapCut's maintrack_adsorb). */
    mainTrackMagnet?: boolean;
    /** Project settings' Arrange layers (lib/arrange-layers.ts); absent is on, as in a project from before it. */
    arrangeLayers?: boolean;
    /** The player's guides (lib/guides.ts). */
    guides?: Guide[];
    /** The cover the cover editor set (lib/cover.ts); absent while the cover follows the first frame. */
    cover?: CoverSpec;
  };
  editorState: {
    duration: number;
    zoomLevel: number;
    scrollX: number;
    scrollY: number;
    playheadPosition: number;
    snapGuideX: number | null;
    /** The id of the timeline being edited (absent: the first). */
    activeTimeline?: string;
    position: Point;
    timelineWindow: [number, number];
    scale: number;
    tool: ViewTool;
    shape: ShapeTool;
    viewportSize: { width: number; height: number };
    /** Auto snapping and linkage on the timeline. */
    snapping?: boolean;
    linkage?: boolean;
    contentBounds: { x: number; y: number; width: number; height: number } | null;  
  };
  assets: Record<string, Asset>;
  /**
   * The project's first timeline (what older versions and the Rust engine read as the timeline),
   * or in an engine's snapshot the one to render.
   */
  timeline: JsonTimeline;
  /** The project's other timelines, in order after `timeline` (File ▸ New timeline); absent with just one. */
  moreTimelines?: JsonTimeline[];
};

type JsonTimeline = {
  /** Absent in a file from before several timelines ("Timeline 01"). */
  id?: string;
  name?: string;
  tracks: TimelineProps[];
  clips: TimelineClipJson[];
  /** Markers on the ruler; frames, like the playhead. */
  markers?: Marker[];
  /** The main track magnet, and for a timeline that isn't the one being edited its length, playhead and zoom. */
  magnet?: boolean;
  duration?: number;
  playhead?: number;
  view?: { total: number; window: [number, number]; zoom: number };
};

type SerializedMaskForJson = Omit<MaskClipProps, "keyframes"> & {
  keyframes: Record<number, MaskData>;
};

type TimelineClipBaseForJson = Omit<AnyClipProps, "masks">;

type TimelineClipJson = TimelineClipBaseForJson & {
  startTick: string;
  endTick: string;
  trimStartTick: string;
  trimEndTick: string;
  masks?: SerializedMaskForJson[];
};

const serializeMaskKeyframesForJson = (
  keyframes: MaskClipProps["keyframes"],
): Record<number, MaskData> => {
  if (!keyframes) return {};
  if (keyframes instanceof Map) {
    const out: Record<number, MaskData> = {};
    for (const [frame, data] of keyframes.entries()) {
      const frameNum = Number(frame);
      if (!Number.isFinite(frameNum)) continue;
      out[frameNum] = data;
    }
    return out;
  }
  const out: Record<number, MaskData> = {};
  for (const [k, v] of Object.entries(keyframes as Record<string, MaskData>)) {
    const frameNum = Number(k);
    if (!Number.isFinite(frameNum)) continue;
    out[frameNum] = v;
  }
  return out;
};

const serializeMasksForJson = (clip: AnyClipProps): SerializedMaskForJson[] => {
  // A video's or photo's, an adjustment layer's or an effect bar's.
  if (clip.type !== "video" && clip.type !== "image" && !(clip.type === "filter" && ((clip as any).adjustment || (clip as any).effectId))) return [];
  const masks = (clip as any).masks as MaskClipProps[] | undefined;
  if (!Array.isArray(masks) || masks.length === 0) return [];
  return masks.map((m) => ({
    ...m,
    keyframes: serializeMaskKeyframesForJson(m.keyframes),
  }));
};

/**
 * A clip as the project file holds it: frames as ticks, masks in their file shape, and a
 * compound clip's nested timeline the same way (`compound: { tracks, clips }`).
 */
export const clipToJson = (orig: AnyClipProps, fps: number): TimelineClipJson => {
  const clipId = String((orig as any).clipId);
  const timelineId = String((orig as any).timelineId ?? "");

  const startFrameRaw = (orig as any).startFrame;
  const endFrameRaw = (orig as any).endFrame;
  const trimStartRaw = (orig as any).trimStart;
  const trimEndRaw = (orig as any).trimEnd;
  const clipPaddingRaw = (orig as any).clipPadding;

  const startFrame =
    typeof startFrameRaw === "number" && Number.isFinite(startFrameRaw)
      ? startFrameRaw
      : 0;
  const endFrame =
    typeof endFrameRaw === "number" && Number.isFinite(endFrameRaw)
      ? endFrameRaw
      : 0;
  const trimStart =
    typeof trimStartRaw === "number" && Number.isFinite(trimStartRaw)
      ? trimStartRaw
      : 0;
  const trimEnd =
    typeof trimEndRaw === "number" && Number.isFinite(trimEndRaw)
      ? trimEndRaw
      : 0;
  const clipPadding =
    typeof clipPaddingRaw === "number" && Number.isFinite(clipPaddingRaw)
      ? clipPaddingRaw
      : 24;

  const startTick = frameToTickForJson(startFrame, fps);
  const endTick = frameToTickForJson(endFrame, fps);
  const trimStartTick = frameToTickForJson(trimStart, fps);
  const trimEndTick = frameToTickForJson(trimEnd, fps);

  let masks: SerializedMaskForJson[] | undefined;

  const origClip = orig as AnyClipProps;

  const serializedMasks = serializeMasksForJson(origClip);
  if (serializedMasks.length > 0) {
    masks = serializedMasks;
  }
  // Normalize the clip state we persist and strip large/derived fields
  const clipForJson: any = {
    ...(origClip as any),
    clipId,
    timelineId,
    clipPadding,
  };

  // Do not store frame-based fields in JSON; we derive them from ticks on load.
  delete clipForJson.startFrame;
  delete clipForJson.endFrame;
  delete clipForJson.trimStart;
  delete clipForJson.trimEnd;

  // These are stored as JSON-specific shapes below
  delete clipForJson.masks;

  const jsonClip: TimelineClipJson = {
    ...(clipForJson as TimelineClipBaseForJson),
    startTick: startTick.toString(),
    endTick: endTick.toString(),
    trimStartTick: trimStartTick.toString(),
    trimEndTick: trimEndTick.toString(),
    ...(masks ? { masks } : {}),
  };

  const nested = (orig as any).compound as CompoundContent | undefined;
  if (nested) {
    (jsonClip as any).compound = {
      tracks: nested.timelines,
      clips: nested.clips.filter(Boolean).map((n) => clipToJson(n, fps)),
    };
  }
  return jsonClip;
};

/**
 * A compound clip's own timeline as a small project the engine can draw or mix (its content from
 * frame 0, on the project's canvas and frame rate, with the project's media): what the compound's
 * thumbnails, its mixed sound for Transcript, Generate captions and Extract audio, are made from.
 */
export const compoundDocument = (content: CompoundContent, name = "Compound clip") => {
  const fps = useControlsStore.getState().fps || 24;
  const viewport = useViewportStore.getState();
  const assets: Record<string, Asset> = {};
  for (const a of Object.values((useClipStore.getState().assets ?? {}) as Record<string, Asset>)) if (a?.id) assets[a.id] = a;
  return {
    version: "1.0.0",
    meta: { id: `compound-${name}`, name, createdAt: 0, lastModified: 0, projectId: 0 },
    settings: { fps, aspectRatio: viewport.aspectRatio, ...(viewport.canvasSize ? { engineCanvas: viewport.canvasSize } : {}) },
    assets,
    timeline: { tracks: content.timelines, clips: content.clips.filter(Boolean).map((c) => clipToJson(c, fps)) },
  };
};

/**
 * `scope` "root" (the export) is the timeline being edited (or `timelineId`) whatever compound
 * is open; "current" is the timeline being edited as it is now, which the preview and playback
 * show; "file" is the whole project as saved: its first timeline as `timeline`, the others after it.
 */
const buildProjectJsonSnapshot = (
  projectState: JsonProjectSlice,
  scope: "root" | "current" | "file" = "root",
  timelineId?: string,
): {
  projectId: number | null;
  snapshot: ProjectJsonSnapshot;
} | null => {
  try {
    const { projects, activeProjectId } = projectState;

    // If the clip/controls stores have not been fully initialized yet (for example
    // due to module loading order or circular imports), bail out gracefully
    // instead of throwing. We'll simply skip this save attempt and try again
    // on the next scheduled change.
    const clipState = useClipStore.getState();
    const controlsState = useControlsStore.getState();
    const viewportState = useViewportStore.getState();

    if (!clipState || !controlsState || !viewportState) {
      console.warn(
        "jsonPersistence: clip/controls/viewport stores not ready yet, skipping JSON snapshot",
      );
      return null;
    }

    const activeProject =
      projects.find((p) => p.id === activeProjectId) ?? null;

    if (!activeProject) {
      return null;
    }

    const projectId = activeProject.id;
    const fps = controlsState.fps || activeProject.fps || 24;

    const activeId = clipState.activeTimelineId;
    // Another timeline than the one being edited (an export of it): it is as parked.
    const other = scope !== "current" && timelineId && timelineId !== activeId ? timelineRoot(timelineId) : null;
    const stack = scope !== "current" && !other ? clipState.compoundStack ?? [] : [];
    const edited = { clips: Array.isArray(clipState.clips) ? (clipState.clips as AnyClipProps[]) : ([] as AnyClipProps[]), timelines: Array.isArray(clipState.timelines) ? (clipState.timelines as TimelineProps[]) : ([] as TimelineProps[]) };
    // With a compound open the file holds the main timeline, its compound as edited so far.
    const root = other ?? (stack.length ? foldStack(stack, edited.clips, edited.timelines) : edited);
    const clipsOf = (clips: AnyClipProps[]) => clips.filter(Boolean).map((orig) => clipToJson(orig, fps));
    const clipsForJson: ProjectJsonSnapshot["timeline"]["clips"] = clipsOf(root.clips);

    // The project's timelines as saved: the first is `timeline`, the rest `moreTimelines`.
    const jsonTimelines: JsonTimeline[] = [];
    if (scope === "file") {
      for (const t of clipState.projectTimelines ?? []) {
        if (t.id === activeId) {
          jsonTimelines.push({ id: t.id, name: t.name, tracks: root.timelines, clips: clipsForJson, markers: clipState.markers, magnet: clipState.magnet });
        } else if (t.content) {
          const c = t.content;
          jsonTimelines.push({ id: t.id, name: t.name, tracks: c.timelines, clips: clipsOf(c.clips), markers: c.markers, magnet: c.magnet, duration: c.clipDuration, playhead: c.playhead, view: c.view });
        }
      }
    }
    const [firstTimeline, ...moreTimelines] = jsonTimelines;

    // Normalize assets from the clip store into a Record<string, Asset> keyed by id.
    const assetsFromStore = clipState.assets as
      | Record<string, Asset>
      | Asset[]
      | undefined;

    const assets: Record<string, Asset> = {};
    if (Array.isArray(assetsFromStore)) {
      for (const asset of assetsFromStore as Asset[]) {
        if (!asset || !asset.id) continue;
        assets[asset.id] = asset;
      }
    } else if (assetsFromStore && typeof assetsFromStore === "object") {
      for (const [, asset] of Object.entries(assetsFromStore)) {
        if (!asset || !asset.id) continue;
        assets[asset.id] = asset as Asset;
      }
    }

    const now = Date.now();

    const snapshot: ProjectJsonSnapshot = {
      version: "1.0.0",
      meta: {
        id:
          (activeProject as any)?.folderUuid ||
          `project-${projectId}`,
        name: activeProject?.name ?? "Untitled Project",
        createdAt: now,
        lastModified: now,
        projectId,
      },
      settings: {
        fps,
        aspectRatio: viewportState?.aspectRatio,
        ...(viewportState?.canvasSize ? { engineCanvas: viewportState.canvasSize } : {}),
        defaultClipLength: controlsState.defaultClipLength,
        mainTrackMagnet: other ? other.magnet : clipState.magnet,
        arrangeLayers: clipState.arrangeLayers !== false,
        guides: clipState.guides ?? [],
        ...(useCoverStore.getState().cover ? { cover: useCoverStore.getState().cover! } : {}),
      },
      editorState: {
        duration: Number((other ? other.clipDuration : (stack[0]?.clipDuration ?? clipState.clipDuration)) || 0),
        activeTimeline: activeId,
        zoomLevel: Number((stack[0]?.view.zoom ?? controlsState.zoomLevel) || 1),
        scrollX: 0,
        scrollY: 0,
        playheadPosition: Number((stack[0]?.playhead ?? controlsState.focusFrame) || 0),
        tool: viewportState.tool,
        shape: viewportState.shape, 
        scale: viewportState.scale,
        position: viewportState.position,
        viewportSize: viewportState.viewportSize,
        contentBounds: viewportState.contentBounds,
        snapGuideX:
          typeof (clipState as any).snapGuideX === "number"
            ? (clipState as any).snapGuideX
            : null,
        timelineWindow: stack[0]
          ? stack[0].view.window
          : Array.isArray(controlsState.timelineDuration)
            ? (controlsState.timelineDuration as [number, number])
            : [0, controlsState.totalTimelineFrames || 0],
        snapping: controlsState.snapping,
        linkage: controlsState.linkage,
      },
      assets,
      timeline: firstTimeline ?? {
        tracks: root.timelines,
        clips: clipsForJson,
        markers: other ? other.markers : clipState.markers,
      },
      ...(moreTimelines.length ? { moreTimelines } : {}),
    };

    return { projectId, snapshot };
  } catch (err) {
    console.error("jsonPersistence: failed to build project snapshot", err);
    return null;
  }
};

let jsonSyncTimeout: ReturnType<typeof setTimeout> | null = null;
let jsonSyncGeneration = 0;
let subscriptionsInitialized = false;
let jsonProjectLoadGeneration = 0;

// Track JSON hydration lifecycle so that autosave does not run while a project
// is being switched / hydrated, which can otherwise cause one project's state
// to be written under another project's id.
let isHydratingFromJson = false;
let currentHydratedProjectId: string | number | null = null;

const normalizeProjectId = (
  raw: string | number | null | undefined,
): string | number | null => {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isInteger(n) && n > 0) return n;
  return s;
};

const cancelPendingJsonProjectSave = (): void => {
  // Invalidate any pending debounced save so it cannot fire after a project
  // switch/hydration and write an "empty" snapshot over another project.
  jsonSyncGeneration += 1;
  if (jsonSyncTimeout) {
    clearTimeout(jsonSyncTimeout);
    jsonSyncTimeout = null;
  }
};

// Robust change detection for Zustand subscriptions.
// We avoid relying on `prev` because some store updates may mutate data in-place,
// which can make prev/current comparisons unreliable.
let lastClipSignature: string | null = null;
let lastTimelineSignature: string | null = null;
let lastAssetSignature: string | null = null;

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    // Fallback: force "changed" on the next compare if serialization fails.
    return `__unserializable__:${Date.now()}`;
  }
};

const computeClipSignature = (clips: unknown): string => {
  if (!Array.isArray(clips)) return "[]";
  // Only include fields that impact the visual first-frame result.
  const reduced = (clips as any[]).map((c) => ({
    clipId: c?.clipId,
    type: c?.type,
    timelineId: c?.timelineId,
    groupId: c?.groupId,
    hidden: c?.hidden,
    assetId: c?.assetId,
    startFrame: c?.startFrame,
    endFrame: c?.endFrame,
    trimStart: c?.trimStart,
    trimEnd: c?.trimEnd,
    transform: c?.transform,
    originalTransform: c?.originalTransform,
    children: c?.type === "group" ? c?.children : undefined,
  }));
  return safeStringify(reduced);
};

const computeTimelineSignature = (timelines: unknown): string => {
  if (!Array.isArray(timelines)) return "[]";
  const reduced = (timelines as any[]).map((t) => ({
    timelineId: t?.timelineId,
    hidden: t?.hidden,
    timelineY: t?.timelineY,
    muted: t?.muted,
    locked: t?.locked,
    size: t?.size,
    waveform: t?.waveform,
  }));
  return safeStringify(reduced);
};

const computeAssetSignature = (assets: unknown): string => {
  if (!assets || typeof assets !== "object") return "{}";
  const rec = assets as Record<string, any>;
  const reduced = Object.keys(rec)
    .sort()
    .map((id) => {
      const a = rec[id];
      // A transcript heard (or heard more of) is saved too.
      return [id, a?.type, a?.path, a?.transcript?.words?.length, a?.transcript?.covered?.length];
    });
  return safeStringify(reduced);
};

// Cover generation debounce (export first frame as project cover when only clips change).
let coverUpdateGeneration = 0;
const debouncedGenerateProjectCover = _.debounce(
  (gen: number, getProjectState: () => JsonProjectSlice) => {
    void (async () => {
      try {
        // If another request superseded this one, bail.
        if (gen !== coverUpdateGeneration) return;
        if (isHydratingFromJson) return;

        const projectState = getProjectState();
        const activeProjectId = projectState?.activeProjectId;
        if (activeProjectId == null) return;

        // Avoid writing covers for a project that isn't the one currently hydrated.
        if (
          currentHydratedProjectId != null &&
          activeProjectId !== currentHydratedProjectId
        ) {
          return;
        }

        // A cover chosen in the cover editor stays as it is.
        if (useCoverStore.getState().cover) return;

        const clipState = useClipStore.getState();
        const controlsState = useControlsStore.getState();
        const viewportState = useViewportStore.getState();

        // The project's cover (and its details on the home screen) are of its first timeline.
        if (clipState.projectTimelines?.[0] && clipState.projectTimelines[0].id !== clipState.activeTimelineId) return;

        const getAssetById = (clipState)?.getAssetById;
        const getClipsForGroup = (clipState)?.getClipsForGroup;
        const getClipsByType = (clipState)?.getClipsByType;
        const getClipPositionScore = (clipState)?.getClipPositionScore;
        if (
          typeof getAssetById !== "function" ||
          typeof getClipsForGroup !== "function" ||
          typeof getClipsByType !== "function" ||
          typeof getClipPositionScore !== "function"
        ) {
          return;
        }

        const fps = Number(controlsState?.fps || 0) || 24;
        const aspect =
          viewportState?.aspectRatio ||
          (projectState.projects?.find((p) => p.id === activeProjectId)
            ?.aspectRatio) ||
          ({ width: 16, height: 9 });

        const rawRatio = Number(aspect?.width) / Number(aspect?.height);
        const ratio = Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : 16 / 9;

        // Keep cover reasonably sized.
        const heightPx = 720;
        const widthPx = Math.max(1, Math.round(heightPx * ratio));

        const clips = Array.isArray((clipState as any)?.clips)
          ? ((clipState as any).clips as AnyClipProps[])
          : ([] as AnyClipProps[]);
        const timelines = Array.isArray((clipState as any)?.timelines)
          ? ((clipState as any).timelines as TimelineProps[])
          : ([] as TimelineProps[]);

        if (clips.length === 0) {
          // If the timeline is empty, clear the project cover.
          try {
            await clearProjectCover(activeProjectId);
          } catch {
            // ignore; best-effort
          }
          projectState?.updateProject?.(activeProjectId, {
            coverPath: undefined,
            lastModified: Date.now(),
          });
          return;
        }

        // Mirror export prep used by Topbar: stacking + ignore hidden timelines + expand groups/filters.
        let contentClips = sortClipsForStacking(clips, timelines);
        contentClips = contentClips.filter((clip) => {
          const timeline = timelines.find((t) => t.timelineId === clip.timelineId);
          return !timeline?.hidden;
        });

        const preparedClips: ExportClip[] = [];
        for (const clip of contentClips) {
          if (!clip) continue;
          if ((clip as any).type === "filter") continue;
          const prepared = prepareExportClipsForValue(
            clip as AnyClipProps,
            {
              aspectRatio: { width: Number(aspect.width), height: Number(aspect.height) },
              getAssetById,
              getClipsForGroup,
              getClipsByType,
              getClipPositionScore,
              timelines,
            },
            {
              clearMasks: false,
              applyCentering: false,
              dimensionsFrom: "aspect",
              target: { width: widthPx, height: heightPx },
            },
          );
          preparedClips.push(...(prepared.exportClips || []));
        }

        if (preparedClips.length === 0) return;

        // Export first frame (frame 0) as PNG, then transcode to JPEG for saveProjectCover.
        const result = await exportSequence({
          mode: "image",
          clips: preparedClips,
          fps,
          width: widthPx,
          height: heightPx,
          imageFrame: 0,
          backgroundColor: "#000000",
        } as any);

        if (!(result instanceof Blob)) return;

        let jpegBlob: Blob | null = null;
        try {
          const bitmap = await createImageBitmap(result);
          const canvas = document.createElement("canvas");
          canvas.width = widthPx;
          canvas.height = heightPx;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(bitmap, 0, 0, widthPx, heightPx);
          jpegBlob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.85),
          );
        } catch {
          jpegBlob = null;
        }
        if (!jpegBlob) return;

        const buffer = await jpegBlob.arrayBuffer();
        const res = await saveProjectCover(activeProjectId, new Uint8Array(buffer));

        if (res?.success && res.data?.path) {
          // Best-effort: update coverPath in the projects store so Topbar can render it.
          const anyState = projectState;
          if (typeof anyState.updateProject === "function") {
            anyState.updateProject(activeProjectId, {
              coverPath: res.data.path,
              lastModified: Date.now(),
            });
          }
        }
      } catch (err) {
        console.error("jsonPersistence: failed to generate project cover", err);
      }
    })();
  },
  1000,
);

/**
 * A saved project document's clips as the editor holds them (frames, not ticks): what loading a project
 * puts in the store, and what the Templates tab lays into another project.
 */
export const clipsFromSnapshot = (doc: ProjectJsonSnapshot): AnyClipProps[] => {
    const clipsJson = Array.isArray(doc.timeline?.clips)
      ? (doc.timeline.clips as TimelineClipJson[])
      : [];

    const clips: AnyClipProps[] = [];

    const fpsForJson =
      typeof doc.settings?.fps === "number" &&
      Number.isFinite(doc.settings.fps)
        ? doc.settings.fps
        : 24;

    for (const c of clipsJson) {
      if (!c) continue;
      // Generated-model clips from older projects have no editor equivalent.
      if ((c as any).type === "model") continue;

      const baseStartFrame =
        (c as any).startTick != null
          ? tickToFrameForJson((c as any).startTick, fpsForJson)
          : Number((c as any).startFrame ?? 0);
      const baseEndFrame =
        (c as any).endTick != null
          ? tickToFrameForJson((c as any).endTick, fpsForJson)
          : Number((c as any).endFrame ?? 0);
      const baseTrimStart =
        c.type !== "audio" && c.type !== "video" && c.type !== "group"
          ? Infinity
          : tickToFrameForJson((c as any).trimStartTick, fpsForJson);
      const baseTrimEnd =
        c.type !== "audio" && c.type !== "video" && c.type !== "group"
          ? -Infinity
          : tickToFrameForJson((c as any).trimEndTick, fpsForJson);

      const base: Partial<AnyClipProps> = {
        clipId: String((c as any).clipId),
        timelineId: String((c as any).timelineId ?? ""),
        type: (c as any).type,
        groupId: ((c as any).groupId ?? undefined) as string | undefined,
        startFrame: baseStartFrame,
        endFrame: baseEndFrame,
        trimStart: baseTrimStart,
        trimEnd: baseTrimEnd,
        clipPadding: Number(
          typeof (c as any).clipPadding === "number" &&
            Number.isFinite((c as any).clipPadding)
            ? (c as any).clipPadding
            : 24,
        ),
        transform: (c as any).transform,
        originalTransform: (c as any).originalTransform,
      };

      const hasLegacyProps =
        typeof (c as any).props === "object" && (c as any).props !== null;

      let merged: AnyClipProps;

      if (hasLegacyProps) {
        // Backwards compatibility for older JSON snapshots that used a separate
        // props bag alongside base clip fields.
        const props = ((c as any).props ?? {}) as Record<string, any>;
        merged = { ...(props as any), ...(base as any) } as AnyClipProps;
      } else {
        // New format: the JSON clip already contains the full clip state
        // inline, so we take everything from the JSON entry, drop
        // JSON-specific metadata fields, and overlay normalized base fields.
        const clone: Record<string, any> = { ...(c as any) };
        delete clone.startTick;
        delete clone.endTick;
        delete clone.trimStartTick;
        delete clone.trimEndTick;
        merged = { ...clone, ...(base as any) } as AnyClipProps;
      }

      const mergedAny = merged as any;

      if (
        (mergedAny.type === "video" || mergedAny.type === "image" || (mergedAny.type === "filter" && (mergedAny.adjustment || mergedAny.effectId))) &&
        Array.isArray((c as any).masks)
      ) {
        mergedAny.masks = (c as any).masks
          // Drop AI "touch" masks saved by older versions.
          .filter((m: SerializedMaskForJson) => (m as any).tool !== "touch")
          .map((m: SerializedMaskForJson) => ({
            ...m,
            keyframes: m.keyframes ?? {},
          }));
      }

      // A compound clip's timeline, in frames like the rest.
      const content = (c as any).compound;
      if (content && typeof content === "object") {
        mergedAny.compound = {
          clips: clipsFromSnapshot({ settings: { fps: fpsForJson }, timeline: { clips: content.clips } } as unknown as ProjectJsonSnapshot),
          timelines: resolveOverlapsTimelines(Array.isArray(content.tracks) ? content.tracks : []),
        } satisfies CompoundContent;
      }

      // Strip fields left behind by older versions' AI features.
      delete mergedAny.preprocessors;
      delete mergedAny.frameInterpolateJobId;
      delete mergedAny.manifestRef;
      delete mergedAny.manifestVersion;

      clips.push(merged);
    }
  // A project saved when Group made a container clip: its clips are stuck together now.
  return migrateLegacyGroups(clips, uuidv4);
};

/** Markers as saved, in time order. */
const cleanMarkers = (markers: unknown): Marker[] =>
  (Array.isArray(markers) ? (markers as Marker[]) : [])
    .filter((m) => m && typeof m.id === "string" && Number.isFinite(m.frame))
    .map((m) => ({ id: m.id, frame: Math.max(0, Math.round(m.frame)), color: m.color || "#00C1CD", note: m.note ?? "" }))
    .sort((a, b) => a.frame - b.frame);

/** A saved timeline other than the one being edited, as the content parked in the project's list. */
const parkedContent = (saved: JsonTimeline, fps: number, canvasMagnet: boolean): TimelineContent => {
  const clips = clipsFromSnapshot({ settings: { fps }, timeline: { clips: saved.clips } } as unknown as ProjectJsonSnapshot);
  const timelines = resolveOverlapsTimelines(Array.isArray(saved.tracks) ? saved.tracks : []);
  const length = clips.reduce((m, c) => Math.max(m, Number((c as any).endFrame ?? 0) || 0), 0);
  const clipDuration = Math.max(length, Number.isFinite(saved.duration) ? Number(saved.duration) : 0);
  return {
    clips,
    timelines,
    markers: cleanMarkers(saved.markers),
    magnet: (typeof saved.magnet === "boolean" ? saved.magnet : canvasMagnet) && isMainTrackPacked(clips, timelines),
    clipDuration,
    playhead: Number.isFinite(saved.playhead) ? Number(saved.playhead) : 0,
    view: saved.view && Array.isArray(saved.view.window) ? saved.view : { total: clipDuration, window: [0, clipDuration], zoom: 1 },
  };
};

const hydrateStoresFromProjectJson = async (
  _projectId: string | number,
  fileDoc: ProjectJsonSnapshot,
) => {
  // The project's timelines: the one being edited loads into the stores as the single
  // timeline always did, the others are parked. A file from before several timelines has one.
  const { list: savedTimelines, active: activeTimelineId } = listFromDoc<TimelineClipJson>(fileDoc as any, uuidv4);
  const doc: ProjectJsonSnapshot = { ...fileDoc, timeline: savedTimelines.find((t) => t.id === activeTimelineId)!.saved as JsonTimeline };
  // While we're hydrating from disk, disable autosave and remember which
  // project id the current in-memory stores correspond to once complete.
  isHydratingFromJson = true;
  try {
    try {
      const timelineTracks = Array.isArray(doc.timeline?.tracks)
        ? (doc.timeline.tracks as TimelineProps[])
        : [];

      const clips = clipsFromSnapshot(doc);

      const defaultClipLength =
        typeof doc.settings?.defaultClipLength === "number" &&
        Number.isFinite(doc.settings.defaultClipLength)
          ? doc.settings.defaultClipLength
          : 5;


      const assetsRecord: Record<string, Asset> =
        (doc.assets as Record<string, Asset>) ?? {};

      const promises = Object.values(assetsRecord).map(async (asset) => {
        return await getMediaInfo(asset.path);
      });
      try { 
         await Promise.all(promises);
      } catch (err) {
        console.error("jsonPersistence: failed to get media info", err);
      }

      let clipDuration = 0;
      for (const clip of clips) {
        const end = Number((clip as any).endFrame ?? 0) || 0;
        if (end > clipDuration) clipDuration = end;
      }
      if (
        typeof doc.editorState?.duration === "number" &&
        Number.isFinite(doc.editorState.duration)
      ) {
        clipDuration = Math.max(clipDuration, doc.editorState.duration);
      }

      // Markers as saved, in time order.
      const markers: Marker[] = cleanMarkers(doc.timeline?.markers);
      // The player's guides as saved.
      const guides: Guide[] = (Array.isArray(doc.settings?.guides) ? doc.settings.guides : [])
        .filter((g) => g && typeof g.id === "string" && (g.axis === "x" || g.axis === "y") && Number.isFinite(g.at))
        .map((g) => ({ id: g.id, axis: g.axis, at: g.at }));
      // The magnet as saved (on for a project saved before it existed), but only over a main
      // track that's already gapless from the start: opening a project never moves its clips.
      const projectMagnet = typeof doc.settings?.mainTrackMagnet === "boolean" ? doc.settings.mainTrackMagnet : true;
      const magnet =
        (typeof doc.timeline?.magnet === "boolean" ? doc.timeline.magnet : projectMagnet) &&
        isMainTrackPacked(clips, timelineTracks);

      // The cover chosen in the cover editor, as saved.
      const savedCover = doc.settings?.cover as CoverSpec | undefined;
      useCoverStore.setState({
        cover:
          savedCover && Array.isArray(savedCover.texts) && savedCover.source && (savedCover.source.kind === "frame" || savedCover.source.kind === "image")
            ? savedCover
            : null,
      });

      if (useClipStore && typeof useClipStore.setState === "function") {
        const hydrateFps = typeof doc.settings?.fps === "number" && Number.isFinite(doc.settings.fps) ? doc.settings.fps : 24;
        useClipStore.setState({
          clips,
          compoundStack: [],
          activeTimelineId,
          projectTimelines: savedTimelines.map((t) =>
            t.id === activeTimelineId ? { id: t.id, name: t.name } : { id: t.id, name: t.name, content: parkedContent(t.saved as JsonTimeline, hydrateFps, projectMagnet) },
          ),
          // Laid out again: each track its kind's height (an older project's or a draft's
          // tracks were sized differently).
          timelines: resolveOverlapsTimelines(timelineTracks),
          assets: assetsRecord,
          clipDuration,
          markers,
          magnet,
          arrangeLayers: doc.settings?.arrangeLayers !== false,
          guides,
          mainPreview: null,
          snapGuideX:
            typeof doc.editorState?.snapGuideX === "number"
              ? doc.editorState.snapGuideX
              : null,
        });
      }

      if (useViewportStore && typeof useViewportStore.setState === "function" && Object.keys(doc.editorState ?? {}).length > 0) {
        useViewportStore.setState({
          aspectRatio: doc.settings?.aspectRatio,
          canvasSize: validCanvas(doc.settings?.engineCanvas),
          // The freehand draw tool is gone (CapCut has none): a project left on it opens on select.
          tool: doc.editorState?.tool === "draw" ? "pointer" : doc.editorState?.tool,
          shape: doc.editorState?.shape,
          scale: doc.editorState?.scale,
          position: doc.editorState?.position,
          viewportSize: doc.editorState?.viewportSize,
          contentBounds: doc.editorState?.contentBounds,
          shouldUpdateViewport: false
        });
      } else if (useViewportStore && typeof useViewportStore.setState === "function" && doc.settings?.aspectRatio) {
        // A project made outside the editor (an imported CapCut draft) has no editor state
        // yet: take its canvas and fit the view to it.
        useViewportStore.setState({ aspectRatio: doc.settings.aspectRatio, canvasSize: validCanvas(doc.settings?.engineCanvas), shouldUpdateViewport: true } as any);
      } else {
        console.warn(
          "jsonPersistence: viewport store not ready for JSON snapshot; JSON autosave will rely on project-store changes only until it is available",
        );
      }

      if (useControlsStore && typeof useControlsStore.setState === "function") {
        const currentControls = useControlsStore.getState() ?? {};
        const fps =
          typeof doc.settings?.fps === "number" &&
          Number.isFinite(doc.settings.fps)
            ? doc.settings.fps
            : currentControls.fps || 24;

        const timelineWindow = Array.isArray(doc.editorState?.timelineWindow)
          ? (doc.editorState.timelineWindow as [number, number])
          : [0, clipDuration];

        const totalTimelineFrames = Math.max(
          Number(timelineWindow[1] ?? 0) || 0,
          clipDuration || 0,
        );

        useControlsStore.setState({
          fps,
          defaultClipLength: defaultClipLength ?? 5,
          zoomLevel:
            typeof doc.editorState?.zoomLevel === "number" &&
            Number.isFinite(doc.editorState.zoomLevel)
              ? doc.editorState.zoomLevel
              : currentControls.zoomLevel ?? 1,
          focusFrame:
            typeof doc.editorState?.playheadPosition === "number" &&
            Number.isFinite(doc.editorState.playheadPosition)
              ? doc.editorState.playheadPosition
              : currentControls.focusFrame ?? 0,
          timelineDuration: timelineWindow as [number, number],
          totalTimelineFrames,
          snapping: typeof doc.editorState?.snapping === "boolean" ? doc.editorState.snapping : true,
          linkage: typeof doc.editorState?.linkage === "boolean" ? doc.editorState.linkage : true,
          selectedMarkerId: null,
        });
      }

      // At this point, the in-memory stores reflect the JSON for this project id.
      currentHydratedProjectId = _projectId;
    } catch (err) {
      console.error("jsonPersistence: failed to hydrate stores from JSON", err);
    }
  } finally {
    isHydratingFromJson = false;
  }
};

const scheduleJsonProjectSave = (getProjectState: () => JsonProjectSlice) => {
  const state = getProjectState();
  if (!state || state.activeProjectId == null) return;

  // Avoid saving while a project is actively being hydrated from JSON,
  // or when the active project id does not yet match the last hydrated
  // project. This prevents writing one project's state under another id
  // during rapid project switching.
  if (isHydratingFromJson) return;
  if (
    currentHydratedProjectId != null &&
    state.activeProjectId !== currentHydratedProjectId
  ) {
    return;
  }
  if ((state as any).projectsLoaded === false) {
    return;
  }

  const targetProjectId = normalizeProjectId(state.activeProjectId);
  if (targetProjectId == null) return;

  const myGen = ++jsonSyncGeneration;
  if (jsonSyncTimeout) clearTimeout(jsonSyncTimeout);
  jsonSyncTimeout = setTimeout(async () => {
    if (myGen !== jsonSyncGeneration) return;
    const latestState = getProjectState();
    if (!latestState || latestState.activeProjectId == null) return;

    // If the active project changed since we scheduled this save, abort.
    if (normalizeProjectId(latestState.activeProjectId) !== targetProjectId) {
      return;
    }
    // If hydration is in progress, abort.
    if (isHydratingFromJson) return;
    // If we're not fully loaded, abort.
    if ((latestState as any).projectsLoaded === false) return;
    // If our in-memory stores are known to correspond to a different project, abort.
    if (
      currentHydratedProjectId != null &&
      normalizeProjectId(currentHydratedProjectId) !== targetProjectId
    ) {
      return;
    }

    const snapshotResult = buildProjectJsonSnapshot(latestState, "file");
    if (!snapshotResult || snapshotResult.projectId == null) return;
    try {
      const res = await saveProjectJson(snapshotResult.projectId, snapshotResult.snapshot);
      if ((res as any)?.success !== false) noteSaved(snapshotResult.projectId);
    } catch (err) {
      console.error("jsonPersistence: failed to save project JSON", err);
    }
  }, 500);
};

const initExternalSubscriptions = (getProjectState: () => JsonProjectSlice) => {
  if (subscriptionsInitialized) return;
  subscriptionsInitialized = true;

  try {

    if (useClipStore && typeof useClipStore.subscribe === "function") {
      useClipStore.subscribe((state, prev) => {
        const clipsSig = computeClipSignature((state as any)?.clips);
        const timelinesSig = computeTimelineSignature((state as any)?.timelines);
        const assetsSig = computeAssetSignature((state as any)?.assets);

        // Initialize baseline signatures on first emission.
        if (
          lastClipSignature == null ||
          lastTimelineSignature == null ||
          lastAssetSignature == null
        ) {
          lastClipSignature = clipsSig;
          lastTimelineSignature = timelinesSig;
          lastAssetSignature = assetsSig;
          return;
        }

        const clipsChanged = clipsSig !== lastClipSignature;
        const timelinesChanged = timelinesSig !== lastTimelineSignature;
        const assetsChanged = assetsSig !== lastAssetSignature;

        lastClipSignature = clipsSig;
        lastTimelineSignature = timelinesSig;
        lastAssetSignature = assetsSig;

        // The signature covers what the cover shows; any other edit to a clip (a panel's
        // field: its style, animation, transition…) replaces the clips and is saved too, as
        // are the markers and the magnet.
        const clipsEdited =
          (state as any)?.clips !== (prev as any)?.clips ||
          (state as any)?.markers !== (prev as any)?.markers ||
          (state as any)?.guides !== (prev as any)?.guides ||
          (state as any)?.magnet !== (prev as any)?.magnet ||
          (state as any)?.arrangeLayers !== (prev as any)?.arrangeLayers ||
          (state as any)?.projectTimelines !== (prev as any)?.projectTimelines;
        if (clipsChanged || timelinesChanged || assetsChanged || clipsEdited) {
          scheduleJsonProjectSave(getProjectState);
        }

        // Only generate a new cover when *only* clips changed (no timeline/asset changes),
        // and only after things have settled for at least 1s.
        if (clipsChanged && !timelinesChanged && !assetsChanged) {
          const gen = ++coverUpdateGeneration;
          debouncedGenerateProjectCover(gen, getProjectState);
        }
      });
    } else {
      console.warn(
        "jsonPersistence: clip store not ready for JSON subscriptions; JSON autosave will rely on project-store changes only until it is available",
      );
    }

    useCoverStore.subscribe((state, prev) => {
      if (state.cover !== prev.cover) scheduleJsonProjectSave(getProjectState);
    });

    if (useViewportStore && typeof useViewportStore.subscribe === "function") {
      useViewportStore.subscribe((state, prev) => {
        if (
          !_.isEqual(state?.aspectRatio, prev?.aspectRatio) ||
          !_.isEqual(state?.canvasSize, prev?.canvasSize) ||
          !_.isEqual(state?.scale, prev?.scale) ||
          !_.isEqual(state?.position, prev?.position) ||
          !_.isEqual(state?.tool, prev?.tool) ||
          !_.isEqual(state?.shape, prev?.shape) ||
          !_.isEqual(state?.viewportSize, prev?.viewportSize) ||
          !_.isEqual(state?.contentBounds, prev?.contentBounds)
        ) {
          scheduleJsonProjectSave(getProjectState);
        }
      });
    }
    else {
      console.warn(
        "jsonPersistence: viewport store not ready for JSON subscriptions; JSON autosave will rely on project-store changes only until it is available",
      );
    }

    if (useControlsStore && typeof useControlsStore.subscribe === "function") {
      useControlsStore.subscribe((state, prev) => {
        if (
          state?.fps !== prev?.fps ||
          state?.defaultClipLength !== prev?.defaultClipLength ||
          state?.timelineDuration !== prev?.timelineDuration ||
          state?.zoomLevel !== prev?.zoomLevel ||
          state?.focusFrame !== prev?.focusFrame ||
          state?.snapping !== prev?.snapping ||
          state?.linkage !== prev?.linkage
        ) {
          scheduleJsonProjectSave(getProjectState);
        }
      });
    } else {
      console.warn(
        "jsonPersistence: controls store not ready for JSON subscriptions; JSON autosave will rely on project-store changes only until it is available",
      );
    }

  } catch (err) {
    console.error("jsonPersistence: failed to initialize subscriptions", err);
  }
};

/**
 * The active project as the JSON autosave writes it, for the Rust engine, or null while a
 * project is loading.
 */
export const getActiveProjectJsonSnapshot = (
  projectState: JsonProjectSlice,
  scope: "root" | "current" = "root",
  /** Export: this timeline of the project instead of the one being edited. */
  timelineId?: string,
): { projectId: number; snapshot: ProjectJsonSnapshot } | null => {
  if (isHydratingFromJson || (projectState as any).projectsLoaded === false) return null;
  const r = buildProjectJsonSnapshot(projectState, scope, timelineId);
  return r && r.projectId != null ? { projectId: r.projectId, snapshot: r.snapshot } : null;
};

export const withJsonProjectPersistence =
  <T extends JsonProjectSlice>(
    config: StateCreator<T, [], []>,
  ): StateCreator<T, [], []> =>
  (set, get, api) => {
    const base = config(set, get, api);

    // Initialize cross-store subscriptions once
    initExternalSubscriptions(() => get() as unknown as JsonProjectSlice);

    const loadActiveProjectFromJson = async (projectId?: string | number) => {
      const myGen = ++jsonProjectLoadGeneration;
      // Cancel any pending cover generation during project switches/hydration.
      try {
        debouncedGenerateProjectCover.cancel();
      } catch {
        // ignore
      }
      // Cancel any pending autosave debounce from the previous project.
      cancelPendingJsonProjectSave();
      // Undo stays within a project: its history starts again once this one is in the stores.
      pauseHistory();

      try {
        // While we are hydrating from JSON, mark projects as not yet fully loaded
        (api.setState as any)({ projectsLoaded: false });
      } catch {
        // If the slice doesn't have projectsLoaded yet, ignore
      }

      const activeProjectId = normalizeProjectId(await getActiveProjectId());
      projectId = normalizeProjectId(projectId ?? undefined) ?? undefined;

      if (projectId != activeProjectId && projectId) {
        await setActiveProjectId(projectId);
      } else if (!activeProjectId && projectId) {
        await setActiveProjectId(projectId);
      } else if (activeProjectId && !projectId) {
        projectId = activeProjectId;
      }

       let projects = get().projects; 
       let hasAnyProjects = projects.length > 0;
        if (projects.length === 0) {
            const res = await listProjects<{
              id: number;
              name: string;
              fps: number;
              aspectRatio: { width: number; height: number; id: string };
              folderUuid: string;
              coverPath?: string;
              createdAt?: number;
              lastModified?: number;
            }>();
            if (res?.success && Array.isArray(res.data)) {
              projects = res.data;
            }
            // add the projects to the store
            get().setProjects(projects);
        }
        // check if active project id is in the projects array if not hasAnyProjects is false
        if (activeProjectId && !projects.some((p) => p.id === activeProjectId)) {
            if (projects.length > 0) {
              hasAnyProjects = true;
              setActiveProjectId(projects[0].id);
            } else {
              hasAnyProjects = false;
              setActiveProjectId(null);
              projectId = undefined
            }
          }

      if (!projectId) {
        try {
          if (!hasAnyProjects) {
            const controlsAny = useControlsStore as any;
            const controlsState = controlsAny?.getState?.();
            const fpsFromControls =
              controlsState &&
              typeof controlsState.fps === "number" &&
              Number.isFinite(controlsState.fps)
                ? controlsState.fps
                : 24;

            const res = await createProject<{
                id: number;
                name: string;
                fps: number;
                aspectRatio: {
                 width: number; 
                 height: number; 
                 id: string };
                folderUuid: string;}>({
              name: "Project 1",
              fps: fpsFromControls,
            });
            if (res?.success && res.data) {
                await setActiveProjectId(res.data.id);
                get().addProject(res.data)
            } else {
                console.error("jsonPersistence: failed to create project", res?.error);
            }
          }

        } finally {
          try {
              (api.setState as any)({ projectsLoaded: true });
          } catch {
            // ignore
          }
        }
        return;
      }

      try {
        const res = await loadProjectJson(projectId);
        if (myGen !== jsonProjectLoadGeneration) return;
        if (!res?.success) {
          console.error("jsonPersistence: failed to load project JSON", res?.error);
          return;
        }
        const doc = res.data as ProjectJsonSnapshot | null;
        if (!doc) {
          // New project with no on-disk JSON yet: explicitly reset stores to a blank
          // state under this project id, but do not trigger an immediate autosave.
          const normalizedId = normalizeProjectId(projectId);
          if (normalizedId == null) return;

          isHydratingFromJson = true;
          try {
            const projectState = get() as unknown as JsonProjectSlice;
            const activeProject =
              projectState.projects.find((p) => p.id === normalizedId) ?? null;
            const now = Date.now();

            // Clear clip/timeline/assets state.
            try {
              const firstId = uuidv4();
              useClipStore.setState({
                clips: [],
                compoundStack: [],
                projectTimelines: [{ id: firstId, name: "Timeline 01" }],
                activeTimelineId: firstId,
                timelines: [],
                assets: {},
                clipDuration: 0,
                snapGuideX: null,
                markers: [],
                magnet: true,
                arrangeLayers: preferences().arrangeLayers !== false,
                guides: [],
                mainPreview: null,
              } as any);
            } catch {
              // ignore; best-effort
            }

            // Reset viewport to sensible defaults (keep aspect ratio from project if present).
            try {
              const existingViewport = useViewportStore.getState();
              const aspectRatio =
                activeProject?.aspectRatio ?? existingViewport?.aspectRatio ?? { width: 16, height: 9, id: "16:9" };
              useViewportStore.setState({
                aspectRatio,
                tool: "pointer",
                shape: "rectangle",
                scale: 0.75,
                position: { x: 0, y: 0 },
                contentBounds: null,
                shouldUpdateViewport: true,
              } as any);
            } catch {
              // ignore; best-effort
            }


            // Reset controls to match project fps and a blank timeline.
            try {
              const controlsAny = useControlsStore as any;
              const currentControls = controlsAny?.getState?.() ?? {};
              const fps =
                typeof (activeProject as any)?.fps === "number" &&
                Number.isFinite((activeProject as any).fps)
                  ? (activeProject as any).fps
                  : currentControls?.fps || 24;
              useControlsStore.setState({
                fps,
                defaultClipLength: currentControls?.defaultClipLength ?? 5,
                zoomLevel: currentControls?.zoomLevel ?? 1,
                focusFrame: 0,
                timelineDuration: [0, 0] as [number, number],
                totalTimelineFrames: 0,
              } as any);
            } catch {
              // ignore; best-effort
            }

            // Mark the new blank project as the one our in-memory stores correspond to.
            currentHydratedProjectId = normalizedId;
            resetHistory();

            // Best-effort: update project metadata timestamps in the projects list so UI stays consistent.
            if (activeProject && typeof (projectState as any).updateProject === "function") {
              (projectState as any).updateProject(normalizedId, {
                createdAt: (activeProject as any).createdAt ?? now,
                lastModified: (activeProject as any).lastModified ?? now,
              });
            }
          } finally {
            isHydratingFromJson = false;
          }
          return;
        }
        await hydrateStoresFromProjectJson(projectId, doc);
        if (myGen === jsonProjectLoadGeneration) resetHistory();
        // we need to set the active project id to the project id
        get().setActiveProjectId(projectId as string | number);
      } catch (err) {
        console.error("jsonPersistence: error loading project JSON", err);
      } finally {
        if (myGen === jsonProjectLoadGeneration) {
          try {
            setTimeout(() => {
              (api.setState as any)({ projectsLoaded: true });
            }, 1000);
          } catch {
            // ignore
          }
        }
      }
    };

    // Also react to project-store changes (project list and active project id)
    try {
      const anyApi = api;
      if (typeof anyApi.subscribe === "function") {
        anyApi.subscribe((state, prev) => {
          const activeChanged =
            state?.activeProjectId !== prev?.activeProjectId;

          if (activeChanged) {
            try {
              debouncedGenerateProjectCover.cancel();
            } catch {
              // ignore
            }
            // Best-effort: flush the previous project's state to disk before we
            // switch/hydrate. This prevents a newly-created blank project from
            // ever overwriting the previous project's JSON due to timing.
            try {
              const prevId = normalizeProjectId(prev?.activeProjectId);
              if (
                prevId != null &&
                !isHydratingFromJson &&
                normalizeProjectId(currentHydratedProjectId) === prevId
              ) {
                const prevState = {
                  ...(prev as any),
                  activeProjectId: prevId,
                } as JsonProjectSlice;
                const snapshotResult = buildProjectJsonSnapshot(prevState, "file");
                if (snapshotResult?.projectId != null) {
                  void saveProjectJson(
                    snapshotResult.projectId,
                    snapshotResult.snapshot,
                  );
                }
              }
            } catch {
              // ignore; best-effort
            }

            // Cancel any pending autosave so it can't land during the switch.
            cancelPendingJsonProjectSave();
            void loadActiveProjectFromJson(state?.activeProjectId ?? undefined);
          }

          const projectsChanged = state?.projects !== prev?.projects;

          // Do not autosave on active project switches: during creation/switching
          // we can briefly have "blank" stores that must not be persisted.
          if (projectsChanged) {
            scheduleJsonProjectSave(() => state);
          }

          // Whenever the project list changes (create/delete/rename), also
          // trigger a lightweight listProjects call so that the JSON
          // persistence layer stays in sync with on-disk JSON metadata.
          if (projectsChanged) {
            void (async () => {
              try {
                await listProjects();
              } catch (err) {
                console.error(
                  "jsonPersistence: failed to list projects after change",
                  err,
                );
              }
            })();
          }
        });
      }
    } catch (err) {
      console.error(
        "jsonPersistence: failed to subscribe to project store changes",
        err,
      );
    }

    // Initial load for whatever the current active project is (if any)
    try {
      void loadActiveProjectFromJson();
    } catch (err) {
      console.error("jsonPersistence: failed initial JSON project load", err);
    }
    return base;
  };


