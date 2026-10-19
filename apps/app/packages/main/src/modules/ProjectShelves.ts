// What sits beside the projects on disk: the Trash (deleted projects, kept 30 days), the
// templates (projects saved to start new ones from) and the media library (every file the
// projects import). Registered from JSONPersistenceModule, which owns the projects folder.
import { ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

type Ok<T> = { success: true; data: T };
type Err = { success: false; error: string };
type Res<T> = Ok<T> | Err;

export interface ShelfPaths {
  projectsDir: string;
  userDataDir: string;
}

const DAY = 86400000;
/** Days a deleted project stays in the Trash (OPENRIP_TRASH_DAYS shortens it for tests). */
const retentionDays = () => {
  const n = Number(process.env.OPENRIP_TRASH_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 30;
};

const fail = (e: unknown): Err => ({ success: false, error: e instanceof Error ? e.message : String(e) });
const exists = (p: string) => fs.stat(p).then(() => true, () => false);
const safeUuid = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

/** Rename, or copy and remove across volumes. */
const move = async (a: string, b: string) => {
  try {
    await fs.rename(a, b);
  } catch (e: any) {
    if (e?.code !== "EXDEV") throw e;
    await fs.cp(a, b, { recursive: true, verbatimSymlinks: true });
    await fs.rm(a, { recursive: true, force: true });
  }
};

const trashDir = (p: ShelfPaths) => path.join(p.projectsDir, "trash");
const templatesDir = (p: ShelfPaths) => path.join(p.projectsDir, "templates");
const mediaDir = (p: ShelfPaths, uuid: string) => path.join(p.userDataDir, "media", safeUuid(uuid));

export interface TrashEntry {
  id: number;
  name: string;
  fps?: number;
  folderUuid?: string;
  aspectRatio?: { width: number; height: number; id: string };
  deletedAt: number;
  sizeBytes: number;
  durationUs: number;
  coverPath?: string;
  /** Whole days left before it is deleted for good (at least 1 until it is). */
  daysLeft: number;
}

/** Ids a new project must not take: the ones in the Trash could still come back. */
export const trashedIds = async (projectsDir: string): Promise<number[]> => {
  const entries = await fs.readdir(path.join(projectsDir, "trash")).catch(() => [] as string[]);
  return entries.map((e) => /^project-(\d+)$/.exec(e)?.[1]).filter((x): x is string => !!x).map(Number);
};

/** Move a project (file, cover, mask data, media folder) into the Trash. */
export const moveToTrash = async (p: ShelfPaths, id: number): Promise<void> => {
  const file = path.join(p.projectsDir, `project-${id}.json`);
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw == null) return; // already gone
  let doc: any = {};
  try {
    doc = JSON.parse(raw);
  } catch {}
  const dest = path.join(trashDir(p), `project-${id}`);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  const clips: any[] = Array.isArray(doc?.timeline?.clips) ? doc.timeline.clips : [];
  const durationUs = clips.reduce((end, c) => Math.max(end, Number(c?.endTick) || 0), 0);
  const folderUuid = typeof doc?.meta?.id === "string" && doc.meta.id ? doc.meta.id : undefined;
  const cover = path.join(p.projectsDir, "covers", `project-${id}.jpg`);
  const entry = {
    id,
    name: typeof doc?.meta?.name === "string" && doc.meta.name ? doc.meta.name : "Untitled Project",
    fps: doc?.settings?.fps,
    folderUuid,
    aspectRatio: doc?.settings?.aspectRatio,
    deletedAt: Date.now(),
    sizeBytes: Buffer.byteLength(raw, "utf8"),
    durationUs: Number.isFinite(durationUs) ? durationUs : 0,
  };
  // The file goes last: a project half moved is still listed, and moving again finishes it.
  if (await exists(cover)) await move(cover, path.join(dest, "cover.jpg"));
  const masks = path.join(p.projectsDir, "local", "mask", `project-${id}`);
  if (await exists(masks)) await move(masks, path.join(dest, "mask"));
  if (folderUuid && (await exists(mediaDir(p, folderUuid)))) await move(mediaDir(p, folderUuid), path.join(dest, "media"));
  await fs.writeFile(path.join(dest, "trash.json"), JSON.stringify(entry), "utf8");
  await move(file, path.join(dest, "project.json"));
};

const readEntry = async (p: ShelfPaths, dir: string): Promise<TrashEntry | null> => {
  try {
    const e = JSON.parse(await fs.readFile(path.join(dir, "trash.json"), "utf8"));
    const cover = path.join(dir, "cover.jpg");
    const left = Math.ceil((e.deletedAt + retentionDays() * DAY - Date.now()) / DAY);
    return { ...e, coverPath: (await exists(cover)) ? cover : undefined, daysLeft: Math.max(0, left) };
  } catch {
    return null;
  }
};

const removeEntry = async (p: ShelfPaths, id: number) => {
  await fs.rm(path.join(trashDir(p), `project-${id}`), { recursive: true, force: true });
};

/** Delete what has been in the Trash past its time. */
export const purgeTrash = async (p: ShelfPaths): Promise<number> => {
  const names = await fs.readdir(trashDir(p)).catch(() => [] as string[]);
  let n = 0;
  for (const name of names) {
    const m = /^project-(\d+)$/.exec(name);
    if (!m) continue;
    const e = await readEntry(p, path.join(trashDir(p), name));
    // An entry with no readable record has nothing to restore; one that is old goes.
    if (!e || e.deletedAt + retentionDays() * DAY <= Date.now()) {
      await removeEntry(p, Number(m[1]));
      n += 1;
    }
  }
  return n;
};

const listTrash = async (p: ShelfPaths): Promise<TrashEntry[]> => {
  await purgeTrash(p);
  const names = await fs.readdir(trashDir(p)).catch(() => [] as string[]);
  const out: TrashEntry[] = [];
  for (const name of names) {
    if (!/^project-\d+$/.test(name)) continue;
    const e = await readEntry(p, path.join(trashDir(p), name));
    if (e) out.push(e);
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
};

const restore = async (p: ShelfPaths, id: number): Promise<void> => {
  const dir = path.join(trashDir(p), `project-${id}`);
  const e = await readEntry(p, dir);
  if (!e) throw new Error("That project is no longer in the Trash");
  const file = path.join(p.projectsDir, `project-${id}.json`);
  if (await exists(file)) throw new Error("A project with the same number already exists");
  await fs.mkdir(path.join(p.projectsDir, "covers"), { recursive: true });
  if (await exists(path.join(dir, "cover.jpg"))) await move(path.join(dir, "cover.jpg"), path.join(p.projectsDir, "covers", `project-${id}.jpg`));
  if (await exists(path.join(dir, "mask"))) {
    await fs.mkdir(path.join(p.projectsDir, "local", "mask"), { recursive: true });
    await move(path.join(dir, "mask"), path.join(p.projectsDir, "local", "mask", `project-${id}`));
  }
  if (e.folderUuid && (await exists(path.join(dir, "media")))) {
    await fs.mkdir(path.join(p.userDataDir, "media"), { recursive: true });
    await move(path.join(dir, "media"), mediaDir(p, e.folderUuid));
  }
  await move(path.join(dir, "project.json"), file);
  await removeEntry(p, id);
};

// ---- templates -----------------------------------------------------------------------

export interface TemplateEntry {
  id: string;
  name: string;
  savedAt: number;
  aspectRatio?: { width: number; height: number; id: string };
  fps?: number;
  clipCount: number;
  durationUs: number;
  coverPath?: string;
  sizeBytes: number;
}

const templateRoot = (p: ShelfPaths, id: string) => path.join(templatesDir(p), safeUuid(id));

/** A project's text with its media folder's name swapped for another's. */
const retarget = (text: string, from: string, to: string) => text.split(`/media/${safeUuid(from)}/`).join(`/media/${safeUuid(to)}/`);

const copyMedia = async (from: string, to: string) => {
  if (!(await exists(from))) return;
  await fs.cp(from, to, { recursive: true, verbatimSymlinks: true, mode: 1 /* COPYFILE_FICLONE */ });
};

const saveTemplate = async (p: ShelfPaths, projectId: number, name: string): Promise<TemplateEntry> => {
  const raw = await fs.readFile(path.join(p.projectsDir, `project-${projectId}.json`), "utf8");
  const doc = JSON.parse(raw);
  const from: string = doc?.meta?.id;
  const id = randomUUID();
  const dir = templateRoot(p, id);
  await fs.mkdir(dir, { recursive: true });
  // Its own copy of the media, so the template outlives the project it came from.
  if (from) await copyMedia(mediaDir(p, from), mediaDir(p, `tpl-${id}`));
  const text = from ? retarget(raw, from, `tpl-${id}`) : raw;
  await fs.writeFile(path.join(dir, "project.json"), text, "utf8");
  const cover = path.join(p.projectsDir, "covers", `project-${projectId}.jpg`);
  if (await exists(cover)) await fs.copyFile(cover, path.join(dir, "cover.jpg"));
  const clips: any[] = Array.isArray(doc?.timeline?.clips) ? doc.timeline.clips : [];
  const entry = {
    id,
    name: name.trim() || doc?.meta?.name || "Template",
    savedAt: Date.now(),
    aspectRatio: doc?.settings?.aspectRatio,
    fps: doc?.settings?.fps,
    clipCount: clips.filter((c) => c?.type !== "filter").length,
    durationUs: clips.reduce((end, c) => Math.max(end, Number(c?.endTick) || 0), 0),
    sizeBytes: Buffer.byteLength(text, "utf8"),
  };
  await fs.writeFile(path.join(dir, "template.json"), JSON.stringify(entry), "utf8");
  return entry;
};

const listTemplates = async (p: ShelfPaths): Promise<TemplateEntry[]> => {
  const names = await fs.readdir(templatesDir(p)).catch(() => [] as string[]);
  const out: TemplateEntry[] = [];
  for (const name of names) {
    const dir = path.join(templatesDir(p), name);
    try {
      const e = JSON.parse(await fs.readFile(path.join(dir, "template.json"), "utf8"));
      const cover = path.join(dir, "cover.jpg");
      out.push({ ...e, coverPath: (await exists(cover)) ? cover : undefined });
    } catch {}
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
};

/** Start a project from a template: its own media copied, its own id and name. */
const useTemplate = async (p: ShelfPaths, templateId: string, name: string, nextId: () => Promise<number>) => {
  const dir = templateRoot(p, templateId);
  const raw = await fs.readFile(path.join(dir, "project.json"), "utf8");
  const doc = JSON.parse(raw);
  const entry = JSON.parse(await fs.readFile(path.join(dir, "template.json"), "utf8"));
  const id = await nextId();
  const uuid = randomUUID();
  await copyMedia(mediaDir(p, `tpl-${templateId}`), mediaDir(p, uuid));
  const text = retarget(raw, `tpl-${templateId}`, uuid);
  const now = Date.now();
  const next = JSON.parse(text);
  next.meta = { ...(doc.meta ?? {}), id: uuid, name, createdAt: now, lastModified: now, projectId: id };
  await fs.writeFile(path.join(p.projectsDir, `project-${id}.json`), JSON.stringify(next, null, 2), "utf8");
  await fs.mkdir(path.join(p.projectsDir, "covers"), { recursive: true });
  if (await exists(path.join(dir, "cover.jpg"))) await fs.copyFile(path.join(dir, "cover.jpg"), path.join(p.projectsDir, "covers", `project-${id}.jpg`));
  return { id, name, fps: entry.fps ?? doc?.settings?.fps ?? 24, folderUuid: uuid, aspectRatio: doc?.settings?.aspectRatio };
};

// ---- the media library ----------------------------------------------------------------

const EXTS: Record<"video" | "image" | "audio", string[]> = {
  video: ["mov", "mp4", "m4v", "mkv", "webm", "avi", "mpg", "mpeg", "mts", "m2ts", "wmv", "flv", "3gp"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "avif"],
  audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif", "wma"],
};
const kindOf = (file: string): "video" | "image" | "audio" | null => {
  const ext = path.extname(file).slice(1).toLowerCase();
  for (const k of ["video", "image", "audio"] as const) if (EXTS[k].includes(ext)) return k;
  return null;
};

export interface LibraryItem {
  /** The file it stands for. */
  path: string;
  name: string;
  type: "video" | "image" | "audio";
  sizeBytes: number;
  /** When the file was last changed and made. */
  modifiedMs: number;
  createdMs: number;
  durationSec?: number;
  width?: number;
  height?: number;
  /** The projects that use it. */
  projects: string[];
}

const baseKey = (file: string) => path.basename(file, path.extname(file)).replace(/_playable$/, "");

const listLibrary = async (p: ShelfPaths): Promise<LibraryItem[]> => {
  const files = (await fs.readdir(p.projectsDir).catch(() => [] as string[])).filter((f) => /^project-\d+\.json$/i.test(f));
  const byPath = new Map<string, LibraryItem>();
  const add = (item: Omit<LibraryItem, "projects">, project: string) => {
    const seen = byPath.get(item.path);
    if (seen) {
      if (!seen.projects.includes(project)) seen.projects.push(project);
      seen.durationSec ??= item.durationSec;
      seen.width ??= item.width;
      seen.height ??= item.height;
    } else byPath.set(item.path, { ...item, projects: [project] });
  };
  for (const f of files) {
    let doc: any;
    try {
      doc = JSON.parse(await fs.readFile(path.join(p.projectsDir, f), "utf8"));
    } catch {
      continue;
    }
    const project: string = doc?.meta?.name || "Untitled Project";
    const uuid: string | undefined = doc?.meta?.id;
    const assets: any[] = Object.values(doc?.assets ?? {});
    const info = new Map<string, any>();
    for (const a of assets) {
      if (typeof a?.path !== "string") continue;
      const decoded = a.path.startsWith("file://") ? decodeURIComponent(new URL(a.path).pathname) : a.path;
      info.set(baseKey(decoded), a);
    }
    const seenKeys = new Set<string>();
    if (uuid) {
      const links = path.join(mediaDir(p, uuid), "symlinks");
      for (const name of await fs.readdir(links).catch(() => [] as string[])) {
        const type = kindOf(name);
        if (!type) continue;
        const link = path.join(links, name);
        const target = await fs.realpath(link).catch(() => null);
        const st = target ? await fs.stat(target).catch(() => null) : null;
        if (!target || !st?.isFile()) continue;
        const a = info.get(baseKey(name));
        seenKeys.add(baseKey(name));
        add(
          { path: target, name: path.basename(target), type, sizeBytes: st.size, modifiedMs: st.mtimeMs, createdMs: st.birthtimeMs || st.mtimeMs, durationSec: a?.duration, width: a?.width, height: a?.height },
          project,
        );
      }
    }
    // Files a project holds that never came through the Media tab (a voiceover, a made file).
    for (const a of assets) {
      if (typeof a?.path !== "string") continue;
      const decoded = a.path.startsWith("file://") ? decodeURIComponent(new URL(a.path).pathname) : a.path;
      const type = kindOf(decoded);
      if (!type || seenKeys.has(baseKey(decoded)) || /_playable\.[a-z0-9]+$/i.test(decoded)) continue;
      const st = await fs.stat(decoded).catch(() => null);
      if (!st?.isFile()) continue;
      add({ path: decoded, name: path.basename(decoded), type, sizeBytes: st.size, modifiedMs: st.mtimeMs, createdMs: st.birthtimeMs || st.mtimeMs, durationSec: a.duration, width: a.width, height: a.height }, project);
    }
  }
  return [...byPath.values()];
};

// ---- IPC ------------------------------------------------------------------------------

export const registerShelves = (paths: () => ShelfPaths, nextProjectId: () => Promise<number>) => {
  const handle = <T>(channel: string, fn: (...a: any[]) => Promise<T>) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_e, ...args): Promise<Res<T>> => {
      try {
        return { success: true, data: await fn(...args) };
      } catch (e) {
        return fail(e);
      }
    });
  };
  handle("trash:list", () => listTrash(paths()));
  handle("trash:restore", async (ids: number[]) => {
    for (const id of ids) await restore(paths(), Number(id));
    return { ids };
  });
  handle("trash:delete", async (ids: number[]) => {
    for (const id of ids) await removeEntry(paths(), Number(id));
    return { ids };
  });
  handle("trash:empty", async () => {
    const all = await listTrash(paths());
    for (const e of all) await removeEntry(paths(), e.id);
    return { count: all.length };
  });
  handle("templates:list", () => listTemplates(paths()));
  handle("templates:save", (projectId: number, name: string) => saveTemplate(paths(), Number(projectId), String(name ?? "")));
  handle("templates:rename", async (id: string, name: string) => {
    const file = path.join(templateRoot(paths(), id), "template.json");
    const e = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(file, JSON.stringify({ ...e, name: String(name).trim() || e.name }), "utf8");
    return { id };
  });
  handle("templates:delete", async (id: string) => {
    const p = paths();
    await fs.rm(templateRoot(p, id), { recursive: true, force: true });
    await fs.rm(mediaDir(p, `tpl-${id}`), { recursive: true, force: true });
    return { id };
  });
  handle("templates:use", (id: string, name: string) => useTemplate(paths(), String(id), String(name), nextProjectId));
  handle("library:list", () => listLibrary(paths()));
};
