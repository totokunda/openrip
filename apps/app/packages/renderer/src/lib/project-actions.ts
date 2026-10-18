// What the home screen and the editor's top bar do with projects: create one at a size, open
// one, rename or delete any of them, and go back home with a fresh cover.
import {
  createProject,
  deleteProject,
  listProjects,
  loadProjectJson,
  saveProjectCover,
  saveProjectJson,
  ENGINE_FRAME_CANVAS_ID,
} from "@app/preload";
import { useProjectsStore, type ProjectSettings } from "./projects";
import { useShellStore } from "./shell";
import { useControlsStore } from "./control";
import { useClipStore } from "./clip";
import { useEnginePreviewStore } from "./engine-preview";
import { useViewportStore } from "./viewport";
import { DEFAULT_FPS } from "./settings";

/** "Project <k>" with the smallest k no project uses. */
export const nextProjectName = (projects: ProjectSettings[]) => {
  const used = new Set(
    projects
      .map((p) => /^Project\s+(\d+)$/i.exec(p.name || "")?.[1])
      .filter((n): n is string => n != null)
      .map(Number),
  );
  let k = 1;
  while (used.has(k)) k += 1;
  return `Project ${k}`;
};

/** Open a project in the editor. The stores load it (json-persistence) if it isn't the one in them. */
export const openProject = (id: number | string) => {
  const store = useProjectsStore.getState();
  if (store.activeProjectId !== id) store.setActiveProjectId(id);
  useShellStore.getState().setView("editor");
};

/** A new empty project, at the canvas size given (16:9 otherwise), opened in the editor. */
export const createAndOpenProject = async (aspectRatio?: { width: number; height: number; id: string }) => {
  const store = useProjectsStore.getState();
  const res = await createProject<ProjectSettings>({
    name: nextProjectName(store.projects),
    fps: useControlsStore.getState().fps || DEFAULT_FPS,
    aspectRatio,
  });
  if (!res?.success || !res.data) throw new Error(res?.error || "The project couldn't be created");
  const created = { ...res.data, createdAt: Date.now(), lastModified: Date.now() };
  if (!useProjectsStore.getState().projects.some((p) => p.id === created.id)) store.addProject(created);
  openProject(created.id);
  return created;
};

/**
 * Bring the projects' lengths, file sizes and covers up to date from their files, for the
 * home screen (the list is read once at start-up). Names and times the stores hold win:
 * the open project's may not have been written yet.
 */
export const refreshProjects = async () => {
  const res = await listProjects<ProjectSettings>();
  if (!res?.success || !Array.isArray(res.data)) return;
  const disk = new Map(res.data.map((p) => [p.id, p]));
  const store = useProjectsStore.getState();
  store.setProjects(
    store.projects.map((p) => {
      const d = disk.get(p.id);
      return d ? { ...p, filePath: d.filePath, sizeBytes: d.sizeBytes, durationUs: d.durationUs, coverPath: p.coverPath ?? d.coverPath } : p;
    }),
  );
};

/** Resolves once the project `id` is the one in the stores (after a switch has loaded it). */
const loaded = (id: number | string) =>
  new Promise<void>((resolve, reject) => {
    const done = (s: ReturnType<typeof useProjectsStore.getState>) => s.activeProjectId === id && s.projectsLoaded;
    if (done(useProjectsStore.getState())) return resolve();
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("The project took too long to open"));
    }, 20000);
    const unsubscribe = useProjectsStore.subscribe((s) => {
      if (!done(s)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });

/**
 * Rename a project. The one in the stores is saved by the autosave, as the top bar's field
 * does; any other is rewritten in its own file, since only the open project is autosaved.
 */
export const renameProject = async (project: ProjectSettings, name: string) => {
  const trimmed = name.trim();
  if (!trimmed || trimmed === project.name) return;
  const store = useProjectsStore.getState();
  if (store.activeProjectId !== project.id) {
    const res = await loadProjectJson(project.id);
    if (!res?.success || !res.data) throw new Error(res?.error || "The project's file couldn't be read");
    const doc = res.data;
    const saved = await saveProjectJson(project.id, { ...doc, meta: { ...(doc.meta ?? {}), name: trimmed } });
    if (!saved?.success) throw new Error(saved?.error || "The project's file couldn't be written");
  }
  store.updateProject(project.id, { name: trimmed, lastModified: Date.now() });
};

/**
 * Delete a project and its media links (never the user's files). The one in the stores is
 * swapped for another first (the most recent, or a new empty one), so the switch's save of
 * the outgoing project can't write it back after it's gone.
 */
export const deleteProjectAnywhere = async (project: ProjectSettings) => {
  const store = useProjectsStore.getState();
  if (store.activeProjectId === project.id) {
    const others = store.projects.filter((p) => p.id !== project.id).sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
    let next = others[0]?.id;
    if (next == null) {
      const res = await createProject<ProjectSettings>({ name: nextProjectName(store.projects), fps: useControlsStore.getState().fps || DEFAULT_FPS });
      if (!res?.success || !res.data) throw new Error(res?.error || "The project couldn't be replaced");
      store.addProject({ ...res.data, createdAt: Date.now(), lastModified: Date.now() });
      next = res.data.id;
    }
    store.setActiveProjectId(next);
    await loaded(next);
  }
  const res = await deleteProject(project.id);
  if (!res?.success) throw new Error(res?.error || "The project couldn't be deleted");
  useProjectsStore.getState().removeProject(project.id);
};

/**
 * The engine's picture at the playhead as the open project's cover (a JPEG at most 720 px
 * tall), for the home screen. Best effort: nothing happens without a frame from the engine.
 */
export const saveCoverFromEngine = async () => {
  const id = useProjectsStore.getState().activeProjectId;
  const engine = useEnginePreviewStore.getState();
  if (id == null || !engine.enabled || !engine.project || useClipStore.getState().clips.length === 0) return;
  const frame = document.getElementById(ENGINE_FRAME_CANVAS_ID) as HTMLCanvasElement | null;
  if (!frame || frame.width < 16 || frame.height < 16) return;
  try {
    const fit = Math.min(1, 720 / frame.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(frame.width * fit));
    canvas.height = Math.max(1, Math.round(frame.height * fit));
    canvas.getContext("2d")?.drawImage(frame, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return;
    const res = await saveProjectCover(id, new Uint8Array(await blob.arrayBuffer()));
    if (res?.success && res.data?.path) {
      useProjectsStore.getState().updateProject(id, { coverPath: res.data.path, lastModified: Date.now() });
    }
  } catch (e) {
    console.warn("Couldn't save the project's cover", e);
  }
};

/** Leave the editor for the home screen: playback stops and the cover is brought up to date. */
export const goHome = async () => {
  const controls = useControlsStore.getState();
  if (controls.isPlaying) controls.pause();
  // The canvas may have changed since the list was read (a ratio picked, the first clip's).
  const id = useProjectsStore.getState().activeProjectId;
  if (id != null) useProjectsStore.getState().updateProject(id, { aspectRatio: useViewportStore.getState().aspectRatio });
  await saveCoverFromEngine();
  useShellStore.getState().setView("home");
};
