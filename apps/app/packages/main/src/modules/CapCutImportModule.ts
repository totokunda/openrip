/**
 * Open a CapCut draft as an OpenRip project. The engine converts the draft into the app's
 * project format (`capcutToApp`): the app's own clips, each carrying the CapCut segment it
 * came from, so the editor can move, trim and retype them while the engine still draws
 * captions, effects, animations and masks as CapCut did. The draft's media are linked into
 * the new project's media folder, as the app's own imports are; the draft is only read.
 */
import { app, dialog, ipcMain } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { createProject, ensureProjectJson } from "./JSONPersistenceModule.js";
import { getEngine } from "./EngineModule.js";

/** Where CapCut for Mac keeps its drafts. */
export function capcutDraftsRoot(): string {
  return path.join(os.homedir(), "Movies", "CapCut", "User Data", "Projects", "com.lveditor.draft");
}

export type CapCutDraft = {
  name: string;
  folder: string;
  /** CapCut's own render of the first frame, if it has one. */
  cover: string | null;
  durationUs: number;
  modifiedMs: number;
};

export type CapCutImportResult =
  | {
      success: true;
      data: { id: number; name: string; fps: number; folderUuid: string; aspectRatio?: { width: number; height: number; id: string }; coverPath?: string };
      missingMedia: string[];
      notes: string[];
    }
  | { success: false; error: string };

/** The drafts CapCut lists on its home screen (root_meta_info.json), newest first. */
async function listDrafts(): Promise<CapCutDraft[]> {
  const root = capcutDraftsRoot();
  const out: CapCutDraft[] = [];
  try {
    const meta = JSON.parse(await fs.readFile(path.join(root, "root_meta_info.json"), "utf8"));
    for (const e of Array.isArray(meta?.all_draft_store) ? meta.all_draft_store : []) {
      const folder = typeof e?.draft_fold_path === "string" ? e.draft_fold_path : "";
      if (!folder || !existsSync(path.join(folder, "draft_info.json"))) continue;
      const cover = typeof e.draft_cover === "string" && existsSync(e.draft_cover) ? e.draft_cover : null;
      out.push({
        name: String(e.draft_name ?? path.basename(folder)),
        folder,
        cover,
        durationUs: Number(e.tm_duration ?? 0) || 0,
        // CapCut stores µs.
        modifiedMs: Math.round((Number(e.tm_draft_modified ?? 0) || 0) / 1000),
      });
    }
  } catch {
    // No CapCut, or an unreadable list: none.
  }
  return out.sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/** A link named after `target` in `dir`, numbered if the name is taken by another file. */
async function linkInto(dir: string, target: string): Promise<string> {
  const ext = path.extname(target);
  const stem = path.basename(target, ext);
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${stem}${ext}` : `${stem} (${i})${ext}`;
    const link = path.join(dir, name);
    try {
      const existing = await fs.readlink(link);
      if (existing === target) return link;
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        await fs.symlink(target, link);
        return link;
      }
    }
  }
}

async function importDraft(folder: string): Promise<CapCutImportResult> {
  const engine = getEngine();
  if (!engine) return { success: false, error: "The engine isn't available, and it's what reads CapCut drafts." };
  if (!existsSync(path.join(folder, "draft_info.json"))) return { success: false, error: "That folder isn't a CapCut draft (no draft_info.json)." };

  const t0 = performance.now();
  const converted = await engine.capcutToApp(folder);
  const t1 = performance.now();
  const doc = JSON.parse(converted.json);
  const userData = app.getPath("userData");
  const projectsDir = path.join(userData, "projects-json");
  const fps = Number(doc?.settings?.fps) || 30;
  const created = await createProject(projectsDir, converted.name || path.basename(folder), fps, app.getVersion());

  // The draft's media, linked into the project's media folder like the app's own imports.
  const linksDir = path.join(userData, "media", created.folderUuid, "symlinks");
  await fs.mkdir(linksDir, { recursive: true });
  for (const asset of Object.values<any>(doc.assets ?? {})) {
    if (typeof asset?.path !== "string" || !asset.path) continue;
    const target = asset.path.startsWith("file://") ? fileURLToPath(asset.path) : asset.path;
    asset.path = pathToFileURL(await linkInto(linksDir, target)).href;
  }

  // The project file createProject wrote, with the draft's contents.
  const base = JSON.parse(await fs.readFile(created.filePath, "utf8"));
  const project = ensureProjectJson({ ...doc, meta: { ...base.meta, name: created.name } }, created.id, app.getVersion());
  await fs.writeFile(created.filePath, JSON.stringify(project, null, 2), "utf8");

  // CapCut's cover becomes the project's.
  let coverPath: string | undefined;
  const cover = path.join(folder, "draft_cover.jpg");
  if (existsSync(cover)) {
    coverPath = path.join(projectsDir, "covers", `project-${created.id}.jpg`);
    await fs.mkdir(path.dirname(coverPath), { recursive: true });
    await fs.copyFile(cover, coverPath).catch(() => (coverPath = undefined));
  }

  if (process.env.OPENRIP_TRACE) {
    console.error(`[capcut] import: engine ${(t1 - t0).toFixed(0)} ms, project files ${(performance.now() - t1).toFixed(0)} ms, ${(converted.json.length / 1e6).toFixed(2)} MB`);
  }
  return {
    success: true,
    data: { id: created.id, name: created.name, fps: created.fps, folderUuid: created.folderUuid, aspectRatio: project.settings.aspectRatio as any, coverPath },
    missingMedia: converted.missingMedia,
    notes: converted.notes,
  };
}

export class CapCutImportModule implements AppModule {
  enable(_context: ModuleContext): void {
    for (const channel of ["capcut:list-drafts", "capcut:pick-draft", "capcut:import"]) {
      try {
        ipcMain.removeHandler(channel);
      } catch {}
    }
    ipcMain.handle("capcut:list-drafts", () => listDrafts());
    ipcMain.handle("capcut:pick-draft", async () => {
      const root = capcutDraftsRoot();
      const r = await dialog.showOpenDialog({
        title: "Open a CapCut draft",
        defaultPath: existsSync(root) ? root : os.homedir(),
        properties: ["openDirectory"],
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    });
    ipcMain.handle("capcut:import", async (_event, folder: string): Promise<CapCutImportResult> => {
      try {
        return await importDraft(String(folder));
      } catch (e) {
        console.error("[capcut] import failed", e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
  }
}

export function capCutImportModule() {
  return new CapCutImportModule();
}
