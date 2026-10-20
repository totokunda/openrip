import { AppModule } from "src/AppModule.js";
import { ModuleContext } from "src/ModuleContext.js";
import Store from "electron-store";
import { BrowserWindow, Notification, app, dialog, ipcMain } from "electron";
import { EventEmitter } from "node:events";
import { promises as fsp } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getEngine } from "./EngineModule.js";

/**
 * The app's preferences, as the Settings window edits them (CapCut's Draft, Edit, Performance
 * and General tabs) and the Shortcuts window's key bindings. The renderer keeps the same
 * shape in `lib/preferences.ts` (preload's `Preferences` type): change both together.
 */
export interface Preferences {
  /** Draft › Cache: delete cache files older than `cacheMaxAgeDays` (false: don't delete). */
  cacheAutoDelete: boolean;
  cacheMaxAgeDays: number;
  /** Edit › Step forward or back many N frames (⇧← / ⇧→). */
  stepFrames: number;
  /** Edit › Adjust value many N units (⇧↑ / ⇧↓ in a value field). */
  adjustUnits: number;
  /** Edit › Image duration, in `imageDurationUnit`s. */
  imageDuration: number;
  imageDurationUnit: "s" | "frames";
  /** Edit › Frame rate of new projects. */
  frameRate: number;
  /** Edit › Time code: HH:MM:SS+frame ("frame") or HH:MM:SS:FF ("ff"). */
  timeCode: "frame" | "ff";
  /** Edit › Target loudness of Normalize loudness, LUFS. */
  targetLoudness: number;
  /** Edit › Sound for export. */
  exportSound: boolean;
  /** Performance › Speed up hardware decoding (the engine's VideoToolbox decoder). */
  hardwareDecoding: boolean;
  /** Performance › Auto optimization: a playable copy of media the preview can't decode. */
  autoOptimization: "none" | "smart";
  /** General › Language. */
  language: string;
  /** General › Notification. */
  notifications: boolean;
  /** General › Software update: install updates automatically, else only say there is one. */
  autoUpdate: boolean;
  /** The Shortcuts window: the preset in use (1–5) and each preset's changed bindings. */
  shortcutPreset: number;
  shortcutPresets: Record<string, Record<string, string[]>>;
  /** The first-run walkthrough has been shown (or skipped); Help ▸ Walkthrough shows it again. */
  walkthroughSeen: boolean;
  /** Draft › Screen recording: where recordings are saved ("": each project's media folder). */
  recordingsDir: string;
  /** Draft › Preset save path: where My presets are kept ("": `<userData>/clip-presets`). */
  presetsDir: string;
  /** Performance › Auto clear: the oldest rendering-cache files go once it's over this many GB. */
  renderCacheMaxGb: number;
  /** The timeline's Linkage settings: the kinds of clip that do not move or get deleted with the main track's clips (lib/linkage.ts). */
  linkageOff: string[];
  /** Edit › Play audio while scrubbing: short snippets of the sound play as the playhead is dragged or stepped (off by default, as CapCut's). */
  scrubAudio: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  cacheAutoDelete: false,
  cacheMaxAgeDays: 30,
  stepFrames: 10,
  adjustUnits: 10,
  imageDuration: 5,
  imageDurationUnit: "s",
  frameRate: 24,
  timeCode: "frame",
  targetLoudness: -23,
  exportSound: false,
  hardwareDecoding: true,
  autoOptimization: "smart",
  language: "en",
  notifications: false,
  autoUpdate: true,
  shortcutPreset: 1,
  shortcutPresets: {},
  walkthroughSeen: false,
  recordingsDir: "",
  presetsDir: "",
  renderCacheMaxGb: 10,
  linkageOff: [],
  scrubAudio: false,
};

interface Settings {
  activeProjectId?: string | number | null;
  /** Draw the preview with the Rust engine instead of the app's own renderer. */
  useEnginePreview?: boolean;
  /** The Settings window's preferences (what differs from the defaults). */
  preferences?: Partial<Preferences>;
  /** Draft › Save to: where projects are kept (unset: `<userData>/projects-json`). */
  projectsDir?: string;
}

/** Files and folders under `dir`, summed. Missing ones count as nothing. */
async function sizeOf(path: string): Promise<number> {
  try {
    const st = await fsp.lstat(path);
    if (!st.isDirectory()) return st.size;
    const entries = await fsp.readdir(path);
    let total = 0;
    for (const e of entries) total += await sizeOf(join(path, e));
    return total;
  } catch {
    return 0;
  }
}

/** Delete the oldest files under `dir` until what's left is at most `maxBytes`. */
async function trimToSize(dir: string, maxBytes: number): Promise<void> {
  const files: { path: string; size: number; mtime: number }[] = [];
  const walk = async (d: string) => {
    let entries: string[];
    try {
      entries = await fsp.readdir(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      try {
        const st = await fsp.lstat(p);
        if (st.isDirectory()) await walk(p);
        else files.push({ path: p, size: st.size, mtime: st.mtimeMs });
      } catch {
        // gone meanwhile
      }
    }
  };
  await walk(dir);
  let total = files.reduce((n, f) => n + f.size, 0);
  files.sort((a, b) => a.mtime - b.mtime);
  for (const f of files) {
    if (total <= maxBytes) break;
    await fsp.rm(f.path, { force: true }).catch(() => {});
    total -= f.size;
  }
}

/** Delete what's in `dir` (older than `before`, a time in ms, when given); `dir` itself stays. */
async function prune(dir: string, before?: number): Promise<void> {
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    try {
      const st = await fsp.lstat(p);
      if (st.isDirectory()) {
        await prune(p, before);
        if (before == null || (await fsp.readdir(p)).length === 0) await fsp.rmdir(p).catch(() => {});
      } else if (before == null || st.mtimeMs < before) {
        await fsp.rm(p, { force: true });
      }
    } catch {
      // A file in use or already gone: leave it.
    }
  }
}

// Singleton instance
let settingsInstance: SettingsModule | null = null;

export class SettingsModule extends EventEmitter implements AppModule {
  private store: Store<Settings>;

  constructor() {
    super();
    this.store = new Store<Settings>();
    if (!settingsInstance) {
      settingsInstance = this;
    }
    return settingsInstance;
  }

  enable(_context: ModuleContext): void {
    this.registerHandlers();
    // Draft › Cache's automatic deletion, once the app is up.
    void app.whenReady().then(() => this.pruneCacheByAge());
    void app.whenReady().then(() => this.trimRenderCache());
  }

  /** The engine's rendering cache: timeline thumbnails and the analyses it keeps per file. */
  renderCacheDir(): string {
    return join(app.getPath("userData"), "engine-thumbnails");
  }

  /** The rendered chunks are about to be deleted from the folder: the engine forgets them, and the timelines stop showing them as rendered. */
  forgetRenderedChunks(): void {
    getEngine()?.clearRenderCache?.();
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send("engine:render-cache-changed");
      } catch {
        // ignore
      }
    }
  }

  /** Performance › Auto clear: the oldest files of the rendering cache go once it's over its limit. */
  async trimRenderCache(): Promise<void> {
    const gb = this.getPreferences().renderCacheMaxGb;
    if (gb > 0) await trimToSize(this.renderCacheDir(), gb * 1024 ** 3);
  }

  getActiveProjectId(): string | null {
    const v = (this.store.get("activeProjectId") as string | number | null | undefined) ?? null;
    return typeof v === "string" ? v : v ? String(v) : null;
  }

  setActiveProjectId(projectId: string | number | null): void {
    this.store.set("activeProjectId", projectId ?? null);
    this.emit("active-project-id-changed", projectId ?? null);
  }

  getPreferences(): Preferences {
    const saved = (this.store.get("preferences") as Partial<Preferences> | undefined) ?? {};
    // OPENRIP_NO_WALKTHROUGH: the automated tests' fresh profile counts the tour as seen.
    return { ...DEFAULT_PREFERENCES, ...saved, ...(process.env.OPENRIP_NO_WALKTHROUGH ? { walkthroughSeen: true } : {}) };
  }

  /** Merge `patch` into the preferences, tell every window and the main process's modules. */
  setPreferences(patch: Partial<Preferences>): Preferences {
    const before = this.getPreferences();
    const next = { ...before, ...(patch ?? {}) };
    const changed: Partial<Preferences> = {};
    for (const k of Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[]) {
      if (JSON.stringify(next[k]) !== JSON.stringify(DEFAULT_PREFERENCES[k])) (changed as any)[k] = next[k];
    }
    this.store.set("preferences", changed);
    this.emit("preferences-changed", next, before);
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send("settings:preferences-changed", next);
      } catch {
        // ignore
      }
    }
    if (before.cacheAutoDelete !== next.cacheAutoDelete || before.cacheMaxAgeDays !== next.cacheMaxAgeDays) void this.pruneCacheByAge();
    if (before.renderCacheMaxGb !== next.renderCacheMaxGb) void this.trimRenderCache();
    return next;
  }

  /** The projects folder the user chose (Draft › Save to), or null for the default one. */
  getProjectsDir(): string | null {
    const v = this.store.get("projectsDir");
    return typeof v === "string" && v.length > 0 ? v : null;
  }

  setProjectsDir(dir: string | null): void {
    if (dir) this.store.set("projectsDir", dir);
    else this.store.delete("projectsDir");
  }

  /**
   * What Draft › Cache counts and clears: files OpenRip can make again. The engine's
   * timeline thumbnails, the audio mixes made for exports, and finished exports kept to
   * reuse when nothing changed.
   */
  cacheDirs(): string[] {
    const userData = app.getPath("userData");
    return [join(userData, "engine-thumbnails"), join(userData, "media", "previews"), join(userData, "apex-export-cache")];
  }

  async pruneCacheByAge(): Promise<void> {
    const p = this.getPreferences();
    if (!p.cacheAutoDelete) return;
    const before = Date.now() - Math.max(1, p.cacheMaxAgeDays) * 24 * 3600 * 1000;
    for (const dir of this.cacheDirs()) await prune(dir, before);
  }

  /** Proxies and playable copies made for the app's own preview, in every project's media folder. */
  async proxySize(): Promise<number> {
    const media = join(app.getPath("userData"), "media");
    let total = 0;
    try {
      for (const e of await fsp.readdir(media)) total += await sizeOf(join(media, e, "proxy"));
    } catch {
      // no media yet
    }
    return total + (await sizeOf(join(media, "proxy")));
  }

  private registerHandlers() {
    ipcMain.handle(
      "settings:get-active-project-id",
      (): string | number | undefined | null => {
        return this.store.get("activeProjectId") ?? null;
      },
    );

    ipcMain.handle(
      "settings:set-active-project-id",
      (_event, projectId: string | number | null): void => {
        this.setActiveProjectId(projectId);
      },
    );

    // On unless the user turned it off.
    ipcMain.handle("settings:get-engine-preview", (): boolean => {
      return this.store.get("useEnginePreview") !== false;
    });

    ipcMain.handle("settings:set-engine-preview", (_event, on: boolean): void => {
      this.store.set("useEnginePreview", on === true);
    });

    ipcMain.handle("settings:get-preferences", (): Preferences => this.getPreferences());
    ipcMain.handle("settings:set-preferences", (_event, patch: Partial<Preferences>): Preferences => this.setPreferences(patch));

    // A folder from the native picker (Draft › Save to and the other path rows).
    ipcMain.handle("settings:pick-folder", async (event, opts?: { title?: string; defaultPath?: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options: Electron.OpenDialogOptions = {
        title: opts?.title,
        defaultPath: opts?.defaultPath,
        properties: ["openDirectory", "createDirectory"],
      };
      const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return res.canceled ? null : (res.filePaths[0] ?? null);
    });

    ipcMain.handle("settings:cache-size", async () => {
      let total = 0;
      for (const dir of this.cacheDirs()) total += await sizeOf(dir);
      return total;
    });
    ipcMain.handle("settings:clear-cache", async () => {
      this.forgetRenderedChunks();
      for (const dir of this.cacheDirs()) await prune(dir);
      let total = 0;
      for (const dir of this.cacheDirs()) total += await sizeOf(dir);
      return total;
    });
    ipcMain.handle("settings:render-cache", async () => ({ dir: this.renderCacheDir(), bytes: await sizeOf(this.renderCacheDir()) }));
    ipcMain.handle("settings:clear-render-cache", async () => {
      this.forgetRenderedChunks();
      await prune(this.renderCacheDir());
      return sizeOf(this.renderCacheDir());
    });
    ipcMain.handle("settings:proxy-size", () => this.proxySize());
    ipcMain.handle("settings:paths", () => ({
      userData: app.getPath("userData"),
      media: join(app.getPath("userData"), "media"),
      presets: join(app.getPath("userData"), "clip-presets"),
    }));

    // The About window's facts.
    ipcMain.handle("settings:app-info", () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    }));

    // The open-source notices, made from the lockfiles when the app is built
    // (scripts/third-party-notices.mjs writes them beside the main process's bundle).
    ipcMain.handle("settings:third-party-notices", async () => {
      const here = dirname(fileURLToPath(import.meta.url));
      for (const p of [join(here, "third-party-notices.json"), join(here, "..", "third-party-notices.json")]) {
        try {
          return JSON.parse(await fsp.readFile(p, "utf8"));
        } catch {
          // try the next
        }
      }
      return null;
    });

    // General › Notification: a system notification, when the user allowed them.
    ipcMain.handle("settings:notify", (_event, n: { title: string; body?: string }) => {
      if (!this.getPreferences().notifications || !Notification.isSupported()) return false;
      try {
        new Notification({ title: String(n?.title ?? ""), body: n?.body ? String(n.body) : undefined, silent: true }).show();
        return true;
      } catch {
        return false;
      }
    });
  }
}

export function settingsModule(
  ...args: ConstructorParameters<typeof SettingsModule>
) {
  if (!settingsInstance) {
    settingsInstance = new SettingsModule(...args);
  }
  return settingsInstance;
}

export function getSettingsModule() {
  if (!settingsInstance) {
    settingsInstance = new SettingsModule();
  }
  return settingsInstance;
}
