import fs from "node:fs";
import { promises as fsp } from "node:fs";
import { basename, extname, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ipcRenderer } from "electron";
import { spawn } from "node:child_process";
import { resolveFfmpegCommand } from "./ffmpegBin.js";
import { symlinksDir, proxyDir } from "./paths.js";
import {
  AUDIO_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  getLowercaseExtension,
} from "./fileExts.js";
import { ensureUniqueNameSync } from "./links.js";
import type { ClipType } from "../../../renderer/src/lib/types.js";
import { getUserDataPath } from "../config.js";
import {
  renameMediaPairInRoot,
  deleteMediaPairInRoot,
} from "./renameDelete.js";

type ProxyIndex = {
  [symlinkName: string]: string;
};

export type ConvertedMediaItem = {
  name: string;
  absPath: string;
  assetUrl: string;
  originalAssetUrl?: string;
  dateAddedMs: number;
  /** When the file itself was made (the library's link was made when it was imported: dateAddedMs). */
  createdMs?: number;
  type: ClipType;
  hasProxy?: boolean;
  /**
   * The proxy is a playable copy of a video this app can't decode itself (see
   * makePlayable), not an optional speed-up: it can't be removed.
   */
  isPlayableCopy?: boolean;
  /**
   * The library's link points at a file that is gone (moved, deleted, a drive unplugged):
   * the card says so and "Link to media" can point it at the file again. `target` is where
   * the link points.
   */
  missing?: boolean;
  target?: string;
};

function isSupportedExt(ext: string): boolean {
  return VIDEO_EXTS.has(ext) || IMAGE_EXTS.has(ext) || AUDIO_EXTS.has(ext);
}

/** Where a library link points if the file there is gone (a broken symlink), else null. */
async function brokenSymlinkTarget(absPath: string): Promise<string | null> {
  try {
    const st = await fsp.lstat(absPath);
    if (!st.isSymbolicLink()) return null;
    try {
      // Follow the link; if the target is missing, stat() throws ENOENT.
      await fsp.stat(absPath);
      return null;
    } catch (e: any) {
      const code = e?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
      return await fsp.readlink(absPath);
    }
  } catch {
    return null;
  }
}

async function loadProxyIndex(): Promise<ProxyIndex> {
  try {
    const userDataDir = (await getUserDataPath())?.data?.user_data ?? "";
    const root = join(userDataDir, "media");
    const indexPath = join(root, ".proxy-index.json");
    const content = await fsp.readFile(indexPath, "utf8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveProxyIndex(index: ProxyIndex): Promise<void> {
  const userDataDir = (await getUserDataPath())?.data?.user_data ?? "";
  const root = join(userDataDir, "media");
  const indexPath = join(root, ".proxy-index.json");
  await fsp.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
}

async function ensureMediaDirs(): Promise<{
  root: string;
  symlinksAbs: string;
  proxyAbs: string;
}> {
  const userDataDir = (await getUserDataPath())?.data?.user_data ?? "";
  const root = join(userDataDir, "media");
  const symlinksAbs = symlinksDir(root);
  const proxyAbs = proxyDir(root);
  if (!fs.existsSync(symlinksAbs))
    fs.mkdirSync(symlinksAbs, { recursive: true });
  if (!fs.existsSync(proxyAbs)) fs.mkdirSync(proxyAbs, { recursive: true });
  return { root, symlinksAbs, proxyAbs };
}

async function renameMediaPair(
  convertedOldName: string,
  convertedNewName: string,
  folderUuid?: string,
): Promise<any> {
  const userDataDir = (await getUserDataPath())?.data?.user_data ?? "";
  const baseRoot = join(userDataDir, "media");
  const mediaRootAbs =
    typeof folderUuid === "string" && folderUuid.length > 0
      ? join(baseRoot, folderUuid)
      : baseRoot;
  return renameMediaPairInRoot(mediaRootAbs, convertedOldName, convertedNewName);
}

async function deleteMediaPair(
  convertedName: string,
  folderUuid?: string,
): Promise<any> {
  const userDataDir = (await getUserDataPath())?.data?.user_data ?? "";
  const baseRoot = join(userDataDir, "media");
  const mediaRootAbs =
    typeof folderUuid === "string" && folderUuid.length > 0
      ? join(baseRoot, folderUuid)
      : baseRoot;
  return deleteMediaPairInRoot(mediaRootAbs, convertedName);
}

async function pickMediaPaths(options: {
  directory?: boolean;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
  defaultPath?: string;
}): Promise<string[]> {
  try {
    const paths = await ipcRenderer.invoke("dialog:pick-media", options ?? {});
    if (Array.isArray(paths)) return paths as string[];
    return [];
  } catch {
    return [];
  }
}

/** Ask where to save a file (the native save dialog); null if cancelled. Write it with
 * `writeFileBuffer`. */
async function pickSavePath(options: {
  filters?: { name: string; extensions: string[] }[];
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  try {
    const path = await ipcRenderer.invoke("dialog:pick-save-path", options ?? {});
    return typeof path === "string" && path ? path : null;
  } catch {
    return null;
  }
}

async function listConvertedMedia(
  folderUuid?: string,
): Promise<ConvertedMediaItem[]> {
  const userDataDir = (await getUserDataPath())?.data?.user_data ?? "";
  const baseRoot = join(userDataDir, "media");

  let symlinksAbs: string;
  let proxyAbs: string;
  if (typeof folderUuid === "string" && folderUuid.length > 0) {
    const projectRoot = join(baseRoot, folderUuid);
    symlinksAbs = symlinksDir(projectRoot);
    proxyAbs = proxyDir(projectRoot);
    if (!fs.existsSync(symlinksAbs)) {
      fs.mkdirSync(symlinksAbs, { recursive: true });
    }
    if (!fs.existsSync(proxyAbs)) {
      fs.mkdirSync(proxyAbs, { recursive: true });
    }
  } else {
    const baseDirs = await ensureMediaDirs();
    symlinksAbs = baseDirs.symlinksAbs;
    proxyAbs = baseDirs.proxyAbs;
  }

  const proxyIndex = await loadProxyIndex();
  let proxyIndexDirty = false;

  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = (await fsp.readdir(symlinksAbs, {
      withFileTypes: true,
    })) as unknown as import("node:fs").Dirent[];
  } catch {
    entries = [] as any;
  }

  const items: ConvertedMediaItem[] = [];
  for (const e of entries) {
    const name = e.name;
    const ext = getLowercaseExtension(name);
    if (!isSupportedExt(ext)) continue;

    const originalAbsPath = join(symlinksAbs, name);

    // A link whose file is gone stays in the library, marked missing (Link to media fixes it).
    const brokenTarget = await brokenSymlinkTarget(originalAbsPath);

    let absPath = originalAbsPath;
    let hasProxy = false;
    let isPlayableCopy = false;

    if (proxyIndex[name] && brokenTarget == null) {
      const proxyPath = join(proxyAbs, proxyIndex[name]);
      if (fs.existsSync(proxyPath)) {
        absPath = proxyPath;
        hasProxy = true;
        isPlayableCopy = proxyIndex[name].endsWith(PLAYABLE_SUFFIX);
      }
    }

    let dateAddedMs = Date.now();
    try {
      const st = await fsp.lstat(originalAbsPath);
      dateAddedMs =
        st.birthtime?.getTime?.() ?? st.mtime?.getTime?.() ?? dateAddedMs;
    } catch {
      // If we can't stat it (race / deleted), don't return it.
      continue;
    }

    let createdMs = dateAddedMs;
    if (brokenTarget == null) {
      try {
        const st = await fsp.stat(originalAbsPath);
        createdMs = st.birthtime?.getTime?.() || st.mtime?.getTime?.() || dateAddedMs;
      } catch {
        // keep the import time
      }
    }

    const originalAssetUrl = pathToFileURL(originalAbsPath).href;
    const assetUrl = pathToFileURL(absPath).href;
    const type: ConvertedMediaItem["type"] = VIDEO_EXTS.has(ext)
      ? "video"
      : IMAGE_EXTS.has(ext)
      ? "image"
      : AUDIO_EXTS.has(ext)
      ? "audio"
      : "video";

    items.push({
      name,
      absPath,
      assetUrl,
      originalAssetUrl,
      dateAddedMs,
      createdMs,
      type,
      hasProxy,
      isPlayableCopy,
      ...(brokenTarget != null ? { missing: true, target: brokenTarget } : {}),
    });
  }

  if (proxyIndexDirty) {
    try {
      await saveProxyIndex(proxyIndex);
    } catch {
      // ignore
    }
  }

  items.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  return items;
}

async function importMediaPaths(
  inputAbsPaths: string[],
  _resolution?: string,
  folderUuid?: string,
  /** Project settings > Copy media to project: a real copy in the project's media folder instead of a link. */
  copy?: boolean,
): Promise<number> {
  const userDataPath = (await getUserDataPath())?.data?.user_data ?? "";
  const baseRoot = join(userDataPath, "media");

  let symlinksAbs: string;
  if (typeof folderUuid === "string" && folderUuid.length > 0) {
    const projectRoot = join(baseRoot, folderUuid);
    symlinksAbs = symlinksDir(projectRoot);
    if (!fs.existsSync(symlinksAbs)) {
      fs.mkdirSync(symlinksAbs, { recursive: true });
    }
  } else {
    const { symlinksAbs: globalSymlinks } = await ensureMediaDirs();
    symlinksAbs = globalSymlinks;
  }

  let count = 0;
  for (const srcAbs of inputAbsPaths) {
    const fileName = srcAbs.split(/[/\\]/g).pop();
    if (!fileName) continue;
    const ext = getLowercaseExtension(fileName);
    if (!isSupportedExt(ext)) continue;
    const uniqueName = ensureUniqueNameSync(symlinksAbs, fileName);
    const dstAbs = join(symlinksAbs, uniqueName);
 
    try {
      await fsp.rm(dstAbs, { force: true });
      if (copy) await fsp.copyFile(srcAbs, dstAbs);
      else await fsp.symlink(srcAbs, dstAbs);

    } catch (error) {
      console.error("Error creating symlink:", error);
      try {
        await fsp.copyFile(srcAbs, dstAbs);
      } catch (copyError) {
        console.error("Error copying file:", copyError);
        continue;
      }
    }
    count += 1;
  }
  return count;
}

/**
 * Copy media to project, for what is already imported: each library link that points at a file
 * becomes a real copy of it in the project's media folder (the link's path, which the clips
 * use, stays). Resolves with how many were copied; links to missing files are left.
 */
async function copyMediaIntoProject(folderUuid?: string): Promise<number> {
  const userDataDir = (await getUserDataPath())?.data?.user_data ?? "";
  const root = typeof folderUuid === "string" && folderUuid.length > 0 ? join(userDataDir, "media", folderUuid) : join(userDataDir, "media");
  const dir = symlinksDir(root);
  let names: string[] = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of names) {
    const link = join(dir, name);
    try {
      if (!(await fsp.lstat(link)).isSymbolicLink()) continue;
      const target = await fsp.realpath(link);
      const tmp = `${link}.${process.pid}.part`;
      await fsp.copyFile(target, tmp);
      await fsp.rename(tmp, link);
      n++;
    } catch {
      // a link to a missing file, or one that can't be copied: leave it
    }
  }
  return n;
}

async function ensureUniqueConvertedName(desiredName: string): Promise<string> {
  const { symlinksAbs } = await ensureMediaDirs();
  return ensureUniqueNameSync(symlinksAbs, desiredName);
}

async function revealMediaItemInFolder(fileName: string): Promise<void> {
  try {
    if (!fileName) return;
    const { symlinksAbs } = await ensureMediaDirs();
    const symlinkPath = join(symlinksAbs, fileName);
    let targetPath = symlinkPath;
    try {
      const st = await fsp.lstat(symlinkPath);
      if (st.isSymbolicLink()) {
        targetPath = await fsp.realpath(symlinkPath);
      }
    } catch {
      // ignore
    }

    await ipcRenderer.invoke("files:reveal-in-folder", targetPath);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("revealMediaItemInFolder failed", e);
  }
}

async function revealPathInFolder(absPath: string): Promise<void> {
  try {
    if (!absPath) return;
    await ipcRenderer.invoke("files:reveal-in-folder", absPath);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("revealPathInFolder failed", e);
  }
}

async function createProxy(
  fileName: string,
  resolution: string = "480p",
  folderUuid?: string,
): Promise<void> {
  const userDataPath = (await getUserDataPath())?.data?.user_data ?? "";
  const baseRoot = join(userDataPath, "media");

  let symlinksAbs: string;
  let proxyAbs: string;
  if (typeof folderUuid === "string" && folderUuid.length > 0) {
    const projectRoot = join(baseRoot, folderUuid);
    symlinksAbs = symlinksDir(projectRoot);
    proxyAbs = proxyDir(projectRoot);
    if (!fs.existsSync(symlinksAbs))
      fs.mkdirSync(symlinksAbs, { recursive: true });
    if (!fs.existsSync(proxyAbs)) fs.mkdirSync(proxyAbs, { recursive: true });
  } else {
    const dirs = await ensureMediaDirs();
    symlinksAbs = dirs.symlinksAbs;
    proxyAbs = dirs.proxyAbs;
  }
  const symlinkPath = join(symlinksAbs, fileName);

  if (!fs.existsSync(symlinkPath)) {
    throw new Error("Source file not found");
  }

  const realPath = await fsp.realpath(symlinkPath);

  const baseName = basename(fileName, extname(fileName));
  const proxyFileName = `${baseName}_proxy.mp4`;
  const proxyPath = join(proxyAbs, proxyFileName);

  const parseHeight = (res: string): number => {
    const s = res.trim().toLowerCase();
    if (s === "720" || s === "720p" || s === "hd") return 720;
    if (s === "1080" || s === "1080p") return 1080;
    const raw = s.endsWith("p") ? s.slice(0, -1) : s;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 480;
  };

  const targetHeight = parseHeight(resolution);

  await new Promise<void>((resolve, reject) => {
    const args = [
      "-i",
      realPath,
      "-vf",
      `scale=-2:${targetHeight}`,
      "-r",
      "24",
      "-g",
      "1",
      "-keyint_min",
      "1",
      "-sc_threshold",
      "0",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-y",
      proxyPath,
    ];

    const ffmpeg = spawn(resolveFfmpegCommand("ffmpeg"), args);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", async (code) => {
      if (code === 0) {
        const proxyIndex = await loadProxyIndex();
        proxyIndex[fileName] = proxyFileName;
        await saveProxyIndex(proxyIndex);
        resolve();
      } else {
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
}

// Suffix of a stand-in made because the original's video can't be decoded here (e.g.
// ProRes, which Chromium's WebCodecs doesn't support). Unlike a proxy it is also used for
// export, since the original can't be.
const PLAYABLE_SUFFIX = "_playable.mp4";

/**
 * Make a full-resolution H.264 copy of a video this app can't decode, and use it in place
 * of the original (as a proxy is). The rotation is applied to the pixels.
 */
async function makePlayable(fileName: string, folderUuid?: string): Promise<void> {
  const userDataPath = (await getUserDataPath())?.data?.user_data ?? "";
  const baseRoot = join(userDataPath, "media");
  let symlinksAbs: string;
  let proxyAbs: string;
  if (typeof folderUuid === "string" && folderUuid.length > 0) {
    const projectRoot = join(baseRoot, folderUuid);
    symlinksAbs = symlinksDir(projectRoot);
    proxyAbs = proxyDir(projectRoot);
    if (!fs.existsSync(proxyAbs)) fs.mkdirSync(proxyAbs, { recursive: true });
  } else {
    const dirs = await ensureMediaDirs();
    symlinksAbs = dirs.symlinksAbs;
    proxyAbs = dirs.proxyAbs;
  }
  const symlinkPath = join(symlinksAbs, fileName);
  if (!fs.existsSync(symlinkPath)) throw new Error("Source file not found");
  const realPath = await fsp.realpath(symlinkPath);
  const outName = `${basename(fileName, extname(fileName))}${PLAYABLE_SUFFIX}`;
  const outPath = join(proxyAbs, outName);
  const partPath = `${outPath}.part.mp4`;

  await new Promise<void>((resolve, reject) => {
    const args = [
      "-i", realPath,
      "-map", "0:v:0", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
      // Short GOPs keep seeking and scrubbing quick.
      "-g", "15",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-movflags", "+faststart",
      "-y", partPath,
    ];
    const ffmpeg = spawn(resolveFfmpegCommand("ffmpeg"), args);
    let stderr = "";
    ffmpeg.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", async (code) => {
      if (code !== 0) {
        await fsp.rm(partPath, { force: true }).catch(() => {});
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        return;
      }
      try {
        await fsp.rename(partPath, outPath);
        const proxyIndex = await loadProxyIndex();
        proxyIndex[fileName] = outName;
        await saveProxyIndex(proxyIndex);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function removeProxy(
  fileName: string,
  folderUuid?: string,
): Promise<void> {
  const userDataPath = (await getUserDataPath())?.data?.user_data ?? "";
  const baseRoot = join(userDataPath, "media");

  let proxyAbs: string;
  if (typeof folderUuid === "string" && folderUuid.length > 0) {
    const projectRoot = join(baseRoot, folderUuid);
    proxyAbs = proxyDir(projectRoot);
    if (!fs.existsSync(proxyAbs)) {
      const proxyIndex = await loadProxyIndex();
      if (proxyIndex[fileName]) {
        delete proxyIndex[fileName];
        await saveProxyIndex(proxyIndex);
      }
      return;
    }
  } else {
    const dirs = await ensureMediaDirs();
    proxyAbs = dirs.proxyAbs;
  }
  const proxyIndex = await loadProxyIndex();

  if (proxyIndex[fileName]) {
    const proxyPath = join(proxyAbs, proxyIndex[fileName]);
    if (fs.existsSync(proxyPath)) {
      await fsp.rm(proxyPath, { force: true });
    }
    delete proxyIndex[fileName];
    await saveProxyIndex(proxyIndex);
  }
}

/**
 * The original files behind proxies and playable copies, for the Rust engine, which
 * decodes originals (ProRes included) quickly. Paths may be file URLs or plain paths and
 * come back in the same form; anything that isn't a proxy comes back unchanged.
 */
async function engineSourcePaths(paths: string[]): Promise<string[]> {
  const proxyIndex = await loadProxyIndex();
  const byProxy = new Map(Object.entries(proxyIndex).map(([original, proxy]) => [proxy, original]));
  return paths.map((p) => {
    try {
      const isUrl = p.startsWith("file://");
      const fsPath = isUrl ? fileURLToPath(p) : p;
      const dir = dirname(fsPath);
      const original = byProxy.get(basename(fsPath));
      if (!original || basename(dir) !== "proxy") return p;
      const originalPath = join(symlinksDir(dirname(dir)), original);
      if (!fs.existsSync(originalPath)) return p;
      return isUrl ? pathToFileURL(originalPath).href : originalPath;
    } catch {
      return p;
    }
  });
}

async function resolveOriginalPath(path: string): Promise<string> {
  try {
    // Check if it's likely a proxy path
    if (!path.includes("proxy")) return path;
    // A playable stand-in replaces an original that can't be decoded: keep it.
    if (path.endsWith(PLAYABLE_SUFFIX)) return path;

    const proxyIndex = await loadProxyIndex();
    const fileName = basename(path);
    
    // Find key for this proxy file
    const originalName = Object.keys(proxyIndex).find(
      (key) => proxyIndex[key] === fileName
    );

    if (originalName) {
      // Reconstruct original path assuming standard structure
      const dir = dirname(path);
      // Check if we are in a 'proxy' directory
      if (basename(dir) === "proxy") {
        const root = dirname(dir);
        const symlinks = symlinksDir(root);
        const originalPath = join(symlinks, originalName);
        
        // Verify existence
        if (fs.existsSync(originalPath)) {
          return originalPath;
        }
      }
    }
  } catch (e) {
    console.warn("Failed to resolve original path for:", path, e);
  }
  return path;
}

export {
  renameMediaPair,
  deleteMediaPair,
  pickMediaPaths,
  pickSavePath,
  listConvertedMedia,
  importMediaPaths,
  copyMediaIntoProject,
  ensureUniqueConvertedName,
  revealMediaItemInFolder,
  revealPathInFolder,
  createProxy,
  makePlayable,
  removeProxy,
  ensureMediaDirs,
  resolveOriginalPath,
  engineSourcePaths,
};


