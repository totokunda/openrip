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
  getEnginePreviewEnabled,
  setEnginePreviewEnabled,
  type EngineInfo,
  type EngineProjectInfo,
} from "@app/preload";
import { useClipStore } from "./clip";
import { useControlsStore, setPlaybackDriver } from "./control";
import { useViewportStore } from "./viewport";
import { useProjectsStore } from "./projects";
import { getActiveProjectJsonSnapshot } from "./middlewares/json-persistence";

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
    const snapshot = await withOriginalMedia(snap.snapshot);
    const r = await engineSyncProject(snap.projectId, snapshot);
    if (r.ok) {
      useEnginePreviewStore.setState((s) => ({ project: r.project, version: s.version + 1, error: null }));
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

/** The snapshot with each asset's path pointing at its original file. */
async function withOriginalMedia<T>(snapshot: T): Promise<T> {
  const assets = (snapshot as any)?.assets;
  if (!assets || typeof assets !== "object") return snapshot;
  const entries = Object.entries(assets as Record<string, any>).filter(([, a]) => typeof a?.path === "string");
  if (entries.length === 0) return snapshot;
  const originals = await engineSourcePaths(entries.map(([, a]) => a.path));
  const mapped = { ...(assets as Record<string, any>) };
  entries.forEach(([id, a], i) => {
    if (originals[i] !== a.path) mapped[id] = { ...a, path: originals[i] };
  });
  return { ...(snapshot as any), assets: mapped };
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
  watch(useViewportStore.subscribe as any, (s: any) => [s.aspectRatio]);
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
