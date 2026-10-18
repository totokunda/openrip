// The Rust engine preview: the setting, the engine's state, and keeping the engine's copy
// of the project current. With it on (and the engine loaded and holding the project), the
// preview shows the engine's frames; clip components stop drawing (and decoding) but keep
// their handles. See docs/plan/app-engine-integration.md.
import { create } from "zustand";
import {
  engineInfo,
  engineSyncProject,
  enginePlay,
  enginePause,
  engineSourcePaths,
  onEngineClock,
  onEngineEnded,
  engineExport,
  engineExportCancel,
  onEngineExportProgress,
  getEnginePreviewEnabled,
  setEnginePreviewEnabled,
  type EngineInfo,
  type EngineProjectInfo,
  type EngineExportResult,
} from "@app/preload";
import { useClipStore } from "./clip";
import { useControlsStore, setPlaybackDriver } from "./control";
import { useViewportStore } from "./viewport";
import { useMaskStore } from "./mask";
import { useProjectsStore } from "./projects";
import { getActiveProjectJsonSnapshot } from "./middlewares/json-persistence";
import { withoutHistory } from "./history";
import { BASE_LONG_SIDE } from "./settings";
import { registerBundledFonts } from "./fonts";
import { useFilterLibrary } from "./filters/library";

type EnginePreviewState = {
  /** The user's setting. */
  enabled: boolean;
  info: EngineInfo | null;
  /** The project the engine holds, after the last successful sync. */
  project: EngineProjectInfo | null;
  /** Bumped after each sync, so the preview asks for a fresh frame. */
  version: number;
  error: string | null;
  setEnabled: (on: boolean) => void;
};

export const useEnginePreviewStore = create<EnginePreviewState>((set) => ({
  enabled: false,
  info: null,
  project: null,
  version: 0,
  error: null,
  setEnabled: (on) => {
    // Hand playback back (or over) cleanly: stop whatever is playing first.
    if (useControlsStore.getState().isPlaying) useControlsStore.getState().pause();
    // Until the first sync, the app's own preview keeps drawing.
    set({ enabled: on, project: null, error: null });
    void setEnginePreviewEnabled(on);
    if (on) scheduleSync(0);
  },
}));

const drawsNow = (s: EnginePreviewState) => s.enabled && !!s.info?.available && s.project != null;

/** Whether the engine draws the preview right now. */
export const useEngineDraws = () => useEnginePreviewStore(drawsNow);

/**
 * The playhead frame a clip component works with. While the engine draws the preview, a
 * clip only needs to know whether it's on screen, so this changes only when the playhead
 * enters or leaves [start, end]: it's `start` inside, `start - 1` before and `end + 1`
 * after. That spares every clip a re-render on each frame of playback and scrubbing.
 * Otherwise (or with `exact`) it's the frame itself.
 */
export function useClipFocusFrame(start: number, end: number, exact = false): number {
  const draws = useEngineDraws();
  return useControlsStore((s) => {
    const f = s.focusFrame;
    if (exact || !draws || !Number.isFinite(f)) return f;
    return f < start ? start - 1 : f > end ? end + 1 : start;
  });
}

/** The preview's size on screen in pixels, which playback renders at (set by EngineFrame). */
let previewSize = { width: 1280, height: 720 };
export const setEnginePreviewSize = (width: number, height: number) => {
  previewSize = { width, height };
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;
let syncAgain = false;

async function syncNow() {
  const state = useEnginePreviewStore.getState();
  if (!state.enabled || !state.info?.available) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  const snap = getActiveProjectJsonSnapshot(useProjectsStore.getState() as any);
  if (!snap) {
    scheduleSync(200); // still loading
    return;
  }
  syncing = true;
  try {
    // The engine reads originals (ProRes included) where the app uses proxies or playable
    // copies.
    const snapshot = withFilterPreview(withoutMasksWhileEditing(await withOriginalMedia(snap.snapshot)));
    // Its text in the bundled fonts from the first frame.
    await registerBundledFonts();
    const r = await engineSyncProject(snap.projectId, snapshot);
    if (r.ok) {
      useEnginePreviewStore.setState((s) => ({ project: r.project, version: s.version + 1, error: null }));
      if (r.project.textBlocks?.length) followTextBlocks(r.project);
    } else {
      useEnginePreviewStore.setState({ error: r.error });
      console.warn("[engine] sync failed:", r.error);
    }
  } finally {
    syncing = false;
    if (syncAgain) {
      syncAgain = false;
      scheduleSync(0);
    }
  }
}

/**
 * A CapCut text the engine laid out anew (a new font, case or words): its box takes the new
 * block's size about the same middle, so its handles fit the text. The importer places
 * CapCut text by its box's middle, so this doesn't move it. It follows the edit that changed
 * the text rather than being an edit itself: undo takes it back with that edit.
 */
function followTextBlocks(project: EngineProjectInfo) {
  withoutHistory(() => fitTextBlocks(project));
}

function fitTextBlocks(project: EngineProjectInfo) {
  const toWorld = BASE_LONG_SIDE / Math.max(1, project.height);
  const { getClipById, setClipTransform } = useClipStore.getState();
  for (const block of project.textBlocks ?? []) {
    const clip = getClipById(block.segment);
    const t = clip?.transform;
    // Only converted clips (they carry their CapCut segment); the app's own text keeps the
    // box the user gave it.
    if (clip?.type !== "text" || !t || !(clip as any).engine?.segment) continue;
    const [sx, sy] = [t.scaleX || 1, t.scaleY || 1];
    const [w, h] = [(block.width * toWorld) / sx, (block.height * toWorld) / sy];
    if (Math.abs(w - t.width) < 0.01 && Math.abs(h - t.height) < 0.01) continue;
    // The box turns about its top-left corner.
    const [sin, cos] = [Math.sin((t.rotation * Math.PI) / 180), Math.cos((t.rotation * Math.PI) / 180)];
    const middle = (x: number, y: number, bw: number, bh: number) => [x + (cos * bw - sin * bh) / 2, y + (sin * bw + cos * bh) / 2];
    const [cx, cy] = middle(t.x, t.y, t.width * sx, t.height * sy);
    const [mx, my] = middle(0, 0, w * sx, h * sy);
    setClipTransform(clip.clipId, { x: cx - mx, y: cy - my, width: w, height: h });
  }
}

/** A volume (dB) the engine plays as silence. */
const SILENT_DB = -1000;

/**
 * The snapshot with each asset's path pointing at its original file. A video whose audio was
 * detached (separateClip) uses the file as `…#video` and its audio as `…#audio`: the engine
 * reads the file itself for both, the video half silent, as the app's own preview plays them.
 */
async function withOriginalMedia<T>(snapshot: T): Promise<T> {
  const assets = (snapshot as any)?.assets;
  if (!assets || typeof assets !== "object") return snapshot;
  const entries = Object.entries(assets as Record<string, any>).filter(([, a]) => typeof a?.path === "string");
  if (entries.length === 0) return snapshot;
  const silent = new Set(entries.filter(([, a]) => a.path.endsWith("#video")).map(([id]) => id));
  const paths = entries.map(([, a]) => a.path.replace(/#(video|audio)$/, ""));
  const originals = await engineSourcePaths(paths);
  const mapped = { ...(assets as Record<string, any>) };
  entries.forEach(([id, a], i) => {
    if (originals[i] !== a.path) mapped[id] = { ...a, path: originals[i] };
  });
  let out = { ...(snapshot as any), assets: mapped };
  const clips = out.timeline?.clips;
  if (silent.size > 0 && Array.isArray(clips)) {
    out = { ...out, timeline: { ...out.timeline, clips: clips.map((c: any) => (silent.has(c?.assetId) ? { ...c, volume: SILENT_DB } : c)) } };
  }
  return out;
}

/**
 * While the mask tool's lasso (or shape) is out, clips show unmasked, so the outline can be
 * drawn on the whole picture (as the app's own preview does). The brush paints onto the
 * masked picture, so its strokes show as they're kept, and the Pen draws over it (the mask it
 * draws is empty until its path closes, as CapCut's).
 */
function withoutMasksWhileEditing<T>(snapshot: T): T {
  const clips = (snapshot as any)?.timeline?.clips;
  const maskTool = useMaskStore.getState().tool;
  if (useViewportStore.getState().tool !== "mask" || maskTool === "draw" || maskTool === "pen" || !Array.isArray(clips)) return snapshot;
  const s = snapshot as any;
  return { ...s, timeline: { ...s.timeline, clips: clips.map((c: any) => (c?.masks?.length ? { ...c, masks: [] } : c)) } };
}

/**
 * The filter picked in the Filters tab, on the engine's copy only: a filter clip on a track of
 * its own above the rest, over the whole timeline. The project (and so the saved file and an
 * export) never has it.
 */
function withFilterPreview<T>(snapshot: T): T {
  const f = useFilterLibrary.getState().preview;
  const s = snapshot as any;
  if (!f || !s?.timeline || !Array.isArray(s.timeline.clips)) return snapshot;
  const end = Math.max(1, ...s.timeline.clips.map((c: any) => Number(c?.endTick) || 0));
  const track = { type: "filter", timelineId: "filter-preview", timelineWidth: 0, timelineY: 0, timelineHeight: 40, timelinePadding: 0, muted: false, hidden: false };
  const clip = {
    type: "filter",
    clipId: "filter-preview",
    timelineId: "filter-preview",
    startTick: "0",
    endTick: String(end),
    trimStartTick: "0",
    trimEndTick: "0",
    name: f.name,
    smallPath: f.smallPath,
    fullPath: f.fullPath,
    category: f.category,
    examplePath: f.examplePath,
    exampleAssetUrl: f.exampleAssetUrl,
    intensity: 100,
  };
  return { ...s, timeline: { ...s.timeline, tracks: [track, ...(s.timeline.tracks ?? [])], clips: [...s.timeline.clips, clip] } };
}

/** Sync soon; edits arriving within `ms` are sent together. */
function scheduleSync(ms = 60) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncNow();
  }, ms);
}

let initialized = false;

/** Load the setting and engine state, and follow edits. Safe to call more than once. */
export function initEnginePreview() {
  if (initialized) return;
  initialized = true;
  void Promise.all([engineInfo(), getEnginePreviewEnabled()]).then(([info, enabled]) => {
    useEnginePreviewStore.setState({ info, enabled });
    // The engine draws text in the app's bundled fonts and lists the installed ones.
    if (info.available) void registerBundledFonts();
    if (enabled && info.available) scheduleSync(0);
  });
  // Whatever the autosave would write changes the engine's copy too. Stores replace what
  // they change, so comparing references is enough (and cheap during drags).
  const watch = <T>(subscribe: (cb: (s: T, p: T) => void) => () => void, pick: (s: T) => unknown[]) =>
    subscribe((s, p) => {
      if (!useEnginePreviewStore.getState().enabled) return;
      const [a, b] = [pick(s), pick(p)];
      if (a.some((v, i) => v !== b[i])) scheduleSync();
    });
  watch(useClipStore.subscribe as any, (s: any) => [s.clips, s.timelines, s.assets]);
  watch(useControlsStore.subscribe as any, (s: any) => [s.fps]);
  watch(useViewportStore.subscribe as any, (s: any) => [s.aspectRatio, s.tool === "mask"]);
  useFilterLibrary.subscribe((s, p) => {
    if (s.preview !== p.preview && useEnginePreviewStore.getState().enabled) scheduleSync(0);
  });
  watch(useMaskStore.subscribe as any, (s: any) => [s.tool]);
  watch(useProjectsStore.subscribe as any, (s: any) => [s.activeProjectId, (s as any).projectsLoaded]);

  // Playback by the engine: its sound, and its clock moving the playhead. Each run has a
  // token, so ticks still in flight from a run that was stopped (a seek while playing
  // stops and restarts) are ignored.
  let run = 0;
  let playing = false;
  setPlaybackDriver({
    active: () => drawsNow(useEnginePreviewStore.getState()),
    play: (fromFrame) => {
      const { fps } = useControlsStore.getState();
      const token = ++run;
      playing = true;
      void enginePlay((fromFrame / Math.max(1, fps)) * 1e6, previewSize.width, previewSize.height, token).then((r) => {
        if (!r.ok && token === run) {
          console.warn("[engine] play failed:", r.error);
          playing = false;
          useControlsStore.getState().setIsPlaying(false);
        }
      });
    },
    pause: () => {
      const token = run;
      playing = false;
      const focusAtPause = useControlsStore.getState().focusFrame;
      void enginePause().then((atUs) => {
        // Show where the sound actually stopped, unless the playhead has moved since (a
        // seek) or a new run started.
        const c = useControlsStore.getState();
        if (atUs < 0 || token !== run || c.isPlaying || c.focusFrame !== focusAtPause) return;
        c.setFocusFrame(Math.round((atUs * c.fps) / 1e6), false);
      });
    },
  });
  onEngineClock((timeUs, token) => {
    const c = useControlsStore.getState();
    if (!playing || token !== run || !c.isPlaying) return;
    c.setFocusFrame(Math.round((timeUs * c.fps) / 1e6), false);
  });
  onEngineEnded((_atUs, token) => {
    if (token !== run) return;
    playing = false;
    useControlsStore.getState().pause();
  });
}

/** What an engine export takes from the export dialog. */
export type EngineExportRequest = {
  path: string;
  width: number;
  height: number;
  fps: number;
  codec: string;
  /** Bits per second. */
  bitrate: number;
  audio: boolean;
};

/**
 * Whether a video export with these settings goes through the engine: with the engine
 * preview on, for H.264/HEVC in MP4, MOV or MKV without alpha. Anything else uses the
 * app's own exporter.
 */
export function engineExports(settings: { kind: string; format?: string; codec?: string; preserveAlpha?: boolean }): boolean {
  const s = useEnginePreviewStore.getState();
  return (
    s.enabled &&
    !!s.info?.available &&
    settings.kind === "video" &&
    ["mp4", "mov", "mkv"].includes(settings.format ?? "") &&
    ["h264", "hevc"].includes(settings.codec ?? "") &&
    !settings.preserveAlpha
  );
}

/** "10M" / "5000k" / a number of bits per second. */
export function parseBitrate(value: string | number): number {
  if (typeof value === "number") return value;
  const m = /^\s*([\d.]+)\s*([kKmM]?)/.exec(value);
  if (!m) return 10_000_000;
  const n = parseFloat(m[1]);
  return Math.round(n * (m[2].toLowerCase() === "m" ? 1e6 : m[2].toLowerCase() === "k" ? 1e3 : 1));
}

/** Export the open project with the engine (the snapshot the preview gets, with originals). */
export async function engineExportProject(request: EngineExportRequest, onProgress: (ratio: number) => void): Promise<EngineExportResult> {
  const snap = getActiveProjectJsonSnapshot(useProjectsStore.getState() as any);
  if (!snap) return { ok: false, error: "no project open" };
  const snapshot = await withOriginalMedia(snap.snapshot);
  await registerBundledFonts();
  const off = onEngineExportProgress((done, total) => onProgress(total > 0 ? done / total : 0));
  try {
    const { path, ...options } = request;
    return await engineExport(snap.projectId, snapshot, path, options);
  } finally {
    off();
  }
}

export function cancelEngineExport(): Promise<void> {
  return engineExportCancel();
}

