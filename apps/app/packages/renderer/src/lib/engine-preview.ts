// The Rust engine preview: the setting, the engine's state, and keeping the engine's copy
// of the project current. With it on (and the engine loaded and holding the project), the
// preview shows the engine's frames; clip components stop drawing (and decoding) but keep
// their handles. See docs/plan/app-engine-integration.md.
import { create } from "zustand";
import {
  engineInfo,
  engineSyncProject,
  getEnginePreviewEnabled,
  setEnginePreviewEnabled,
  type EngineInfo,
  type EngineProjectInfo,
} from "@app/preload";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
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
    // Until the first sync, the app's own preview keeps drawing.
    set({ enabled: on, project: null, error: null });
    void setEnginePreviewEnabled(on);
    if (on) scheduleSync(0);
  },
}));

/** Whether the engine draws the preview right now. */
export const useEngineDraws = () =>
  useEnginePreviewStore((s) => s.enabled && !!s.info?.available && s.project != null);

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
    const r = await engineSyncProject(snap.projectId, snap.snapshot);
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
}
