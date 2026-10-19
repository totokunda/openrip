import { promises as fsp } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ipcRenderer } from "electron";
import { getUserDataPath } from "../config.js";
import { symlinksDir } from "./paths.js";
import { ensureUniqueNameSync } from "./links.js";
import { AUDIO_EXTS, IMAGE_EXTS, VIDEO_EXTS, getLowercaseExtension } from "./fileExts.js";

/**
 * Missing media and Link to media (CapCut's relink). The library holds each import as a link
 * in `<media>/<project>/symlinks/` and the project's assets name those links, so pointing a
 * link at the moved file brings back every asset and clip that used it.
 */

const toPath = (p: string) => (p.startsWith("file://") ? decodeURIComponent(fileURLToPath(p)) : p);

async function linksFolder(folderUuid?: string): Promise<string> {
  const user = (await getUserDataPath())?.data?.user_data ?? "";
  const root = join(user, "media");
  return symlinksDir(typeof folderUuid === "string" && folderUuid.length > 0 ? join(root, folderUuid) : root);
}

/** The files among `paths` (file URLs or paths) that aren't there to read, in the form given. */
export async function mediaMissing(paths: string[]): Promise<string[]> {
  const gone: string[] = [];
  await Promise.all(
    paths.map(async (p) => {
      try {
        await fsp.stat(toPath(p));
      } catch (e: any) {
        if (e?.code === "ENOENT" || e?.code === "ENOTDIR") gone.push(p);
      }
    }),
  );
  return gone;
}

/** Where a library link points, or null if there is no such link. */
export async function mediaLinkTarget(name: string, folderUuid?: string): Promise<string | null> {
  try {
    return await fsp.readlink(join(await linksFolder(folderUuid), name));
  } catch {
    return null;
  }
}

/**
 * Point the library link `name` at `target` (the file it should show). Resolves the target it
 * pointed at before, for the undo that puts it back.
 */
export async function relinkMediaItem(name: string, target: string, folderUuid?: string): Promise<{ previous: string | null }> {
  const link = join(await linksFolder(folderUuid), name);
  await fsp.stat(target);
  const previous = await fsp.readlink(link).catch(() => null);
  await fsp.rm(link, { force: true });
  await fsp.symlink(target, link);
  return { previous };
}

/** Put a link back where it pointed, even at a file that's gone (an undone Link to media). */
export async function restoreMediaLink(name: string, target: string, folderUuid?: string): Promise<void> {
  const link = join(await linksFolder(folderUuid), name);
  await fsp.rm(link, { force: true });
  await fsp.symlink(target, link);
}

const SUPPORTED = new Set([...VIDEO_EXTS, ...IMAGE_EXTS, ...AUDIO_EXTS]);

/**
 * Search `folder` (and the folders in it, a bounded number of them) for files called one of
 * `names`, matching the case where it can and ignoring it otherwise. Resolves the path found
 * for each name that was found.
 */
export async function findMediaByName(folder: string, names: string[]): Promise<Record<string, string>> {
  const want = new Map(names.map((n) => [n.toLowerCase(), n] as const));
  const found: Record<string, string> = {};
  let visited = 0;
  const walk = async (dir: string, depth: number) => {
    if (depth > 8 || visited > 20000 || Object.keys(found).length >= want.size) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const folders: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      visited++;
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.endsWith(".app")) folders.push(join(dir, e.name));
      } else if (SUPPORTED.has(getLowercaseExtension(e.name))) {
        const name = want.get(e.name.toLowerCase());
        // An exact-case hit wins over a case-insensitive one.
        if (name && (!found[name] || e.name === name)) found[name] = join(dir, e.name);
      }
    }
    for (const f of folders) await walk(f, depth + 1);
  };
  await walk(folder, 0);
  return found;
}

/**
 * Link `srcAbs` into the project's library (as an import does) and resolve the link's path and
 * file URL (what an asset's path is), or null if it can't be linked. The name is made unique.
 */
export async function importMediaFile(srcAbs: string, folderUuid?: string): Promise<{ path: string; url: string } | null> {
  const dir = await linksFolder(folderUuid);
  await fsp.mkdir(dir, { recursive: true });
  const name = basename(srcAbs);
  if (!SUPPORTED.has(getLowercaseExtension(name))) return null;
  const found = (path: string) => ({ path, url: pathToFileURL(path).href });
  // The same file imported already: its link.
  for (const e of await fsp.readdir(dir).catch(() => [] as string[])) {
    if ((await fsp.readlink(join(dir, e)).catch(() => null)) === srcAbs) return found(join(dir, e));
  }
  const link = join(dir, ensureUniqueNameSync(dir, name));
  try {
    await fsp.symlink(srcAbs, link);
  } catch {
    await fsp.copyFile(srcAbs, link);
  }
  return found(link);
}

/** Show the file behind a library link or asset (a path or file URL) in the Finder. */
export async function revealMediaFile(pathOrUrl: string): Promise<void> {
  const p = toPath(pathOrUrl);
  const real = await fsp.realpath(p).catch(() => null);
  // A missing file: its link's target, so the Finder opens its folder if that still exists.
  const target = real ?? (await fsp.readlink(p).catch(() => null)) ?? p;
  await ipcRenderer.invoke("files:reveal-in-folder", target);
}
