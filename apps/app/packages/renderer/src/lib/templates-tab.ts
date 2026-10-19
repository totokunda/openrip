// The editor's Templates tab: the templates saved from Home (main's ProjectShelves), the one being
// previewed, and laying a template's clips into the open project at the playhead.
import { create } from "zustand";
import { listTemplates, stageTemplate, type TemplateEntry } from "@app/preload";
import { clipsFromSnapshot } from "./middlewares/json-persistence";
import { useClipStore, resolveOverlapsTimelines } from "./clip";
import { useControlsStore } from "./control";
import { useViewportStore } from "./viewport";
import { useProjectsStore } from "./projects";
import { mergeTemplate } from "./template-merge";
import { getMediaInfo } from "./media/utils";
import { v4 as uuidv4 } from "uuid";
import type { Asset, TimelineProps } from "./types";

type TemplatesTab = {
  /** null until the first load. */
  items: TemplateEntry[] | null;
  /** The tile that was clicked: the player shows it until it's let go. */
  preview: TemplateEntry | null;
  setPreview: (t: TemplateEntry | null) => void;
  load: () => Promise<void>;
};

export const useTemplatesTab = create<TemplatesTab>((set) => ({
  items: null,
  preview: null,
  setPreview: (preview) => set({ preview }),
  load: async () => {
    try {
      const res = await listTemplates();
      set({ items: res?.success ? (res.data ?? []) : [] });
    } catch {
      set({ items: [] });
    }
  },
}));

/** A template's cover as the renderer loads it (`app://` serves any path in the app data). */
export const coverUrl = (t: TemplateEntry) => (t.coverPath ? `app://user-data${encodeURI(t.coverPath)}?v=${t.savedAt}` : null);

/** "00:12" for a length in seconds. */
export const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

type Doc = {
  timeline?: { tracks?: TimelineProps[]; clips?: unknown[] };
  assets?: Record<string, Asset>;
  settings?: { fps?: number; aspectRatio?: { width: number; height: number; id: string } };
};

/**
 * Lay a template's clips into the open project at the playhead (or at 0 in an empty project, which
 * also takes the template's canvas): its media is copied into the project's media folder, and
 * the clips, tracks and assets go in together, so one undo takes them all out. Returns how many
 * clips went in. Throws with a message the tab can show.
 */
export const insertTemplate = async (t: TemplateEntry): Promise<number> => {
  const project = useProjectsStore.getState().getActiveProject();
  if (!project?.folderUuid) throw new Error("Open a project first.");
  const res = await stageTemplate<Doc>(t.id, project.folderUuid);
  if (!res?.success || !res.data) throw new Error(res?.error || "The template couldn't be read.");
  const doc = res.data;
  const tpl = { clips: clipsFromSnapshot(doc as never), tracks: (doc.timeline?.tracks ?? []) as TimelineProps[], assets: (doc.assets ?? {}) as Record<string, Asset>, fps: doc.settings?.fps ?? t.fps ?? 24 };
  if (tpl.clips.length === 0) throw new Error("This template has no clips.");

  const store = useClipStore.getState();
  const controls = useControlsStore.getState();
  const empty = store.clips.length === 0;
  const fps = controls.fps || 24;
  const at = empty ? 0 : Math.max(0, Math.round(controls.focusFrame));
  // Media info is read before the clips go in, so the timeline and the engine know the files.
  await Promise.all(Object.values(tpl.assets).map((a) => getMediaInfo(a.path).catch(() => null)));
  const now = useClipStore.getState();
  const merged = mergeTemplate({ clips: now.clips, timelines: now.timelines, assets: now.assets }, tpl, at, fps, uuidv4);

  // The first clips in a project set its canvas (as the first video does).
  if (empty && doc.settings?.aspectRatio) useViewportStore.getState().setAspectRatio(doc.settings.aspectRatio);
  // One set: one step of the undo history.
  useClipStore.setState({
    clips: merged.clips,
    timelines: resolveOverlapsTimelines(merged.timelines),
    assets: merged.assets,
    clipDuration: merged.clips.reduce((end, c) => Math.max(end, Number((c as any).endFrame) || 0), 0),
  });
  const after = useClipStore.getState();
  after._updateZoomLevel(after.clips, after.clipDuration);
  controls.setSelectedClipIds(merged.ids);
  useTemplatesTab.getState().setPreview(null);
  return merged.ids.length;
};
