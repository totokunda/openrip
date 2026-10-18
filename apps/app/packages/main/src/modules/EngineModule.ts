import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain, sharedTexture } from "electron";
import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { ensureProjectJson } from "./JSONPersistenceModule.js";

/**
 * The Rust engine (`engine/crates/node`, built by `scripts/build-engine.mjs`), loaded into
 * the main process. Where it isn't available (no build for this platform, or it failed to
 * load) the app keeps using its own preview; `engine:info` says which.
 *
 * With the engine preview on, the renderer sends the project after each edit
 * (`engine:sync-project`) and asks for frames (`engine:render`); frames go back to the
 * asking window as shared GPU textures, which its preload draws.
 */
export type ProjectInfo = {
  name: string;
  width: number;
  height: number;
  fps: number;
  durationUs: number;
  source: string;
};

type FrameHandle = {
  id: number;
  ioSurface: Buffer;
  width: number;
  height: number;
  timeUs: number;
  renderMs: number;
  layers: number;
  skipped: number;
};

type DisplayFrame = { id: number; ioSurface: Buffer; width: number; height: number; timeUs: number; renderMs: number };

export type EngineAddon = {
  version(): string;
  openProjectJson(json: string): ProjectInfo;
  updateProject(json: string): ProjectInfo;
  close(): void;
  renderFrame(timeUs: number, width: number, height: number, scrub?: boolean): Promise<FrameHandle>;
  release(id: number): void;
  setPreviewSize(width: number, height: number): void;
  startPlayback(fromUs: number): void;
  stopPlayback(): number;
  frameForDisplay(): DisplayFrame | null;
  positionUs(): number;
  setVolume(volume: number): void;
  exportProject(json: string, path: string, options: EngineExportOptions): Promise<{ frames: number; seconds: number; skippedLayers: number }>;
  exportProgress(): { done: number; total: number };
  cancelExport(): void;
  setThumbnailCacheDir(dir: string): void;
  capcutToApp(dir: string): Promise<{ json: string; name: string; missingMedia: string[]; notes: string[] }>;
  thumbnails(path: string, timesUs: number[], height: number, exact: boolean): Promise<Thumbnail[]>;
  /** The beats in a file's audio (times in s of its media; downbeats 1 where a bar starts), cached; null without audio. */
  beats(path: string): Promise<{ bpm: number; times: Float64Array; downbeats: Uint8Array } | null>;
  /** EBU R128 loudness (LUFS, null for silence) and peak (dBFS) of a file's range, as CapCut measures it. */
  loudness(path: string, startUs: number, durationUs: number | null): Promise<{ integrated: number | null; peak: number } | null>;
  /** Voiceover recording into a WAV file (lib/VoiceoverModule.ts). */
  startRecording(path: string): { rate: number; channels: number };
  recordingLevel(): { peak: number; rms: number } | null;
  stopRecording(): { path: string; durationUs: number; rate: number; channels: number } | null;
  /** Record a stand-in microphone that hears a tone (automated tests). */
  useToneInput(): void;
  registerFonts(faces: { family: string; weight: number; italic: boolean; path: string; unicodeRange?: string }[]): void;
  fontFamilies(): FontFamily[];
};

/** A family the engine draws text in: the app's bundled fonts, then the installed ones. */
export type FontFamily = { name: string; weights: number[]; italic: boolean; bundled: boolean };

/** A font face the page has (an `@font-face` rule), its file as the page loads it. */
export type PageFontFace = { family: string; weight: number; italic: boolean; url: string; unicodeRange?: string };

/** A frame from the engine's thumbnailer: RGBA, `width * height * 4` bytes. */
export type Thumbnail = { index: number; timeUs: number; exact: boolean; width: number; height: number; rgba: Buffer };

export type EngineExportOptions = { width: number; height: number; fps: number; codec: string; bitrate: number; audio: boolean };

export type ExportResult =
  | { ok: true; frames: number; seconds: number; skippedLayers: number }
  | { ok: false; cancelled?: boolean; error?: string };

export type EngineInfo = {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
};

/** What a render request produced (the pixels go separately, as a shared texture). */
export type RenderResult =
  | { ok: true; timeUs: number; width: number; height: number; renderMs: number; layers: number; skipped: number }
  | { ok: false; superseded?: boolean; error?: string };

let addon: EngineAddon | null = null;
let info: EngineInfo = { available: false, error: "not loaded yet" };
/** The app project the engine has open, so later syncs update it in place. */
let openProjectId: number | null = null;
let openProject: ProjectInfo | null = null;

/** The loaded engine, or null. */
export function getEngine(): EngineAddon | null {
  return addon;
}

function addonPath(): string {
  if (process.env.OPENRIP_ENGINE_PATH) return process.env.OPENRIP_ENGINE_PATH;
  const file = "openrip_node.node";
  if (app.isPackaged) return join(process.resourcesPath, "engine", file);
  // In development the app folder (apps/app) holds native/<platform>-<arch>/. The app path
  // is that folder when Electron is started on it, but `npm start` starts Electron on
  // packages/entry-point.mjs, which makes it apps/app/packages: look upwards from there.
  const rel = join("native", `${process.platform}-${process.arch}`, file);
  let dir = app.getAppPath();
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return join(app.getAppPath(), rel);
}

function load(): EngineInfo {
  const path = addonPath();
  if (!existsSync(path)) {
    return { available: false, path, error: "no engine build for this platform" };
  }
  try {
    addon = createRequire(import.meta.url)(path) as EngineAddon;
    return { available: true, version: addon.version(), path };
  } catch (e) {
    addon = null;
    return { available: false, path, error: e instanceof Error ? e.message : String(e) };
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The file behind a font the page loads: a file URL in the built app; in development the dev
 * server's `/@fs/` path to the file, or else a copy fetched from the server into
 * `<userData>/engine-fonts`. Null if it can't be had.
 */
async function fontFile(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return fileURLToPath(u);
    if (u.pathname.startsWith("/@fs/")) {
      const path = decodeURIComponent(u.pathname.slice(4));
      if (existsSync(path)) return path;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const dir = join(app.getPath("userData"), "engine-fonts");
    const file = join(dir, decodeURIComponent(u.pathname).replace(/[^\w.-]+/g, "_"));
    if (!existsSync(file)) {
      const res = await fetch(u);
      if (!res.ok) return null;
      await mkdir(dir, { recursive: true });
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
    }
    return file;
  } catch {
    return null;
  }
}

/** Hand a rendered surface to a window as a shared texture; the engine gets it back once released. */
async function sendFrame(engine: EngineAddon, sender: Electron.WebContents, f: { id: number; ioSurface: Buffer; width: number; height: number; timeUs: number }) {
  try {
    const imported = sharedTexture.importSharedTexture({
      textureInfo: {
        pixelFormat: "bgra",
        codedSize: { width: f.width, height: f.height },
        visibleRect: { x: 0, y: 0, width: f.width, height: f.height },
        colorSpace: { primaries: "bt709", transfer: "srgb", matrix: "rgb", range: "full" },
        timestamp: f.timeUs,
        handle: { ioSurface: f.ioSurface },
      },
      allReferencesReleased: () => engine.release(f.id),
    });
    await sharedTexture.sendSharedTexture({ frame: sender.mainFrame, importedSharedTexture: imported }, { timeUs: f.timeUs, width: f.width, height: f.height });
    imported.release();
  } catch (e) {
    engine.release(f.id);
    throw e;
  }
}

/**
 * Playback by the engine: it plays the sound and renders frames ahead of its audio clock.
 * Each display tick sends the window the frame due now and its time (`engine:clock`), which
 * the timeline's playhead follows; at the end it stops and says so (`engine:ended`).
 */
class EnginePlayback {
  #timer: ReturnType<typeof setInterval> | null = null;
  #sender: Electron.WebContents | null = null;
  #sending = false;
  #endUs = 0;
  /** The renderer's id for this run, sent back with every clock tick so it can drop stale ones. */
  #token = 0;

  start(sender: Electron.WebContents, fromUs: number, width: number, height: number, token: number): void {
    const engine = addon;
    if (!engine) throw new Error("engine not available");
    if (openProjectId == null) throw new Error("no project sent to the engine yet");
    this.stop();
    engine.setPreviewSize(width, height);
    engine.startPlayback(Math.max(0, Math.round(fromUs)));
    this.#sender = sender;
    this.#token = token;
    this.#endUs = openProject?.durationUs ?? 0;
    this.#timer = setInterval(() => void this.#tick(), 1000 / 60);
  }

  /** Stop; returns where it stopped (µs), or -1 if it wasn't playing. */
  stop(): number {
    if (!this.#timer) return -1;
    clearInterval(this.#timer);
    this.#timer = null;
    this.#sender = null;
    return addon?.stopPlayback() ?? -1;
  }

  async #tick() {
    const [engine, sender] = [addon, this.#sender];
    if (!engine || !sender || this.#sending) return;
    if (sender.isDestroyed()) {
      this.stop();
      return;
    }
    const heard = engine.positionUs();
    if (this.#endUs > 0 && heard >= this.#endUs) {
      const token = this.#token;
      const at = this.stop();
      sender.send("engine:ended", at, token);
      return;
    }
    const f = engine.frameForDisplay();
    if (!f) return;
    this.#sending = true;
    try {
      await sendFrame(engine, sender, f);
      sender.send("engine:clock", f.timeUs, this.#token);
    } catch (e) {
      console.warn("[engine] frame send failed:", message(e));
    } finally {
      this.#sending = false;
    }
    // Without an audio device the clock is the frames' own.
    if (heard < 0 && this.#endUs > 0 && f.timeUs >= this.#endUs - 50_000) {
      const token = this.#token;
      const at = this.stop();
      sender.send("engine:ended", at, token);
    }
  }
}

/**
 * Renders one request at a time; a request arriving while one renders waits as the next,
 * and a newer one replaces it (the older is answered as superseded), so scrubbing never
 * queues up stale frames.
 */
/** A rendered frame on its way to the window. */
type Delivery = { sender: Electron.WebContents; frame: FrameHandle; scrub: boolean; t0: number; t1: number; resolve: (r: RenderResult) => void };

class FrameRenderer {
  #busy = false;
  #next: { args: [number, number, number, boolean]; sender: Electron.WebContents; resolve: (r: RenderResult) => void } | null = null;
  // Delivery runs beside rendering: the next frame renders while this one reaches the
  // window, and a frame rendered meanwhile replaces any still waiting (only the newest
  // matters while scrubbing).
  #sending = false;
  #waiting: Delivery | null = null;

  request(sender: Electron.WebContents, timeUs: number, width: number, height: number, scrub = false): Promise<RenderResult> {
    return new Promise((resolve) => {
      if (this.#next) this.#next.resolve({ ok: false, superseded: true });
      this.#next = { args: [timeUs, width, height, scrub], sender, resolve };
      void this.#pump();
    });
  }

  async #pump() {
    if (this.#busy) return;
    while (this.#next) {
      const job = this.#next;
      this.#next = null;
      this.#busy = true;
      await this.#render(job.sender, job.resolve, ...job.args);
      this.#busy = false;
    }
  }

  async #render(sender: Electron.WebContents, resolve: (r: RenderResult) => void, timeUs: number, width: number, height: number, scrub: boolean): Promise<void> {
    const engine = addon;
    if (!engine) return resolve({ ok: false, error: "engine not available" });
    if (openProjectId == null) return resolve({ ok: false, error: "no project sent to the engine yet" });
    if (sender.isDestroyed()) return resolve({ ok: false, error: "window closed" });
    let frame: FrameHandle;
    const t0 = performance.now();
    try {
      frame = await engine.renderFrame(Math.max(0, Math.round(timeUs)), width, height, scrub);
    } catch (e) {
      return resolve({ ok: false, error: message(e) });
    }
    const job: Delivery = { sender, frame, scrub, t0, t1: performance.now(), resolve };
    if (this.#sending) {
      if (this.#waiting) {
        engine.release(this.#waiting.frame.id);
        this.#waiting.resolve({ ok: false, superseded: true });
      }
      this.#waiting = job;
      return;
    }
    void this.#deliver(engine, job);
  }

  async #deliver(engine: EngineAddon, first: Delivery) {
    this.#sending = true;
    let job: Delivery | null = first;
    while (job) {
      try {
        await sendFrame(engine, job.sender, job.frame);
        const { timeUs: t, width: w, height: h, renderMs, layers, skipped } = job.frame;
        if (process.env.OPENRIP_TRACE) {
          console.error(`[engine] frame${job.scrub ? " (scrub)" : ""}: engine ${renderMs.toFixed(1)} ms, task ${(job.t1 - job.t0).toFixed(1)} ms, send ${(performance.now() - job.t1).toFixed(1)} ms`);
        }
        job.resolve({ ok: true, timeUs: t, width: w, height: h, renderMs, layers, skipped });
      } catch (e) {
        job.resolve({ ok: false, error: message(e) });
      }
      job = this.#waiting;
      this.#waiting = null;
    }
    this.#sending = false;
  }

}

export class EngineModule implements AppModule {
  readonly #frames = new FrameRenderer();
  readonly #playback = new EnginePlayback();

  enable(_context: ModuleContext): void {
    info = load();
    if (info.available) {
      console.info(`[engine] openrip-node ${info.version} loaded from ${info.path}`);
    } else {
      console.warn(`[engine] not available (${info.error}); using the app's own preview`);
    }
    // Exact thumbnails are kept across runs.
    if (addon) addon.setThumbnailCacheDir(join(app.getPath("userData"), "engine-thumbnails"));
    for (const channel of ["engine:info", "engine:sync-project", "engine:render", "engine:close", "engine:play", "engine:pause", "engine:export", "engine:export-cancel", "engine:thumbnails", "engine:beats", "engine:loudness", "engine:register-fonts", "engine:font-families"]) {
      try {
        ipcMain.removeHandler(channel);
      } catch {}
    }
    ipcMain.handle("engine:info", () => info);

    // Frames of a video for the app's own decoder when it can't read it (ProRes).
    ipcMain.handle("engine:thumbnails", async (_event, path: string, timesUs: number[], height: number, exact: boolean) => {
      if (!addon) return [];
      const file = path.startsWith("file://") ? fileURLToPath(path) : path;
      try {
        return await addon.thumbnails(file, timesUs, height, exact);
      } catch (e) {
        console.warn("[engine] thumbnails failed:", message(e));
        return [];
      }
    });

    // The Audio tab: a file's beats for the beat markers, and a clip's loudness for
    // "Normalize loudness" (lib/beats.ts, lib/audio.ts).
    ipcMain.handle("engine:beats", async (_event, path: string) => {
      if (!addon) return null;
      const file = path.startsWith("file://") ? fileURLToPath(path) : path;
      try {
        const g = await addon.beats(file);
        return g && { bpm: g.bpm, beats: Array.from(g.times, (time, i) => ({ time, downbeat: g.downbeats[i] === 1 })) };
      } catch (e) {
        console.warn("[engine] beats failed:", message(e));
        return null;
      }
    });
    ipcMain.handle("engine:loudness", async (_event, path: string, startSec: number, durationSec: number | null) => {
      if (!addon) return null;
      const file = path.startsWith("file://") ? fileURLToPath(path) : path;
      try {
        return await addon.loudness(file, Math.round(startSec * 1e6), durationSec == null ? null : Math.round(durationSec * 1e6));
      } catch (e) {
        console.warn("[engine] loudness failed:", message(e));
        return null;
      }
    });

    // The page's bundled fonts (its @font-face files), so the engine draws text in the
    // fonts the font menu shows. Returns how many faces it registered.
    ipcMain.handle("engine:register-fonts", async (_event, faces: PageFontFace[]) => {
      if (!addon || !Array.isArray(faces)) return 0;
      const files = await Promise.all(faces.map((f) => fontFile(String(f.url))));
      const found = faces.flatMap((f, i) => {
        const path = files[i];
        return path ? [{ family: String(f.family), weight: Number(f.weight) || 400, italic: !!f.italic, path, unicodeRange: f.unicodeRange || undefined }] : [];
      });
      try {
        addon.registerFonts(found);
      } catch (e) {
        console.warn("[engine] registering fonts failed:", message(e));
        return 0;
      }
      return found.length;
    });

    // The families the engine draws text in, for the font menu: the bundled ones, then the
    // installed ones.
    ipcMain.handle("engine:font-families", () => {
      if (!addon) return [];
      try {
        return addon.fontFamilies();
      } catch (e) {
        console.warn("[engine] font families failed:", message(e));
        return [];
      }
    });

    // The project as the JSON autosave would write it (same wrapper), opened on first use
    // and updated in place after that, which keeps the engine's decoders warm.
    ipcMain.handle("engine:sync-project", (_event, projectId: number, payload: unknown) => {
      if (!addon) return { ok: false, error: "engine not available" };
      try {
        const id = Number(projectId);
        const t0 = performance.now();
        const doc = ensureProjectJson({ ...(payload as object) }, id, app.getVersion());
        const json = JSON.stringify(doc);
        if (openProjectId !== id) this.#playback.stop();
        const t1 = performance.now();
        const project = openProjectId === id ? addon.updateProject(json) : addon.openProjectJson(json);
        if (process.env.OPENRIP_TRACE) {
          console.error(`[engine] sync: ${(json.length / 1e6).toFixed(2)} MB, JSON ${(t1 - t0).toFixed(1)} ms, engine ${(performance.now() - t1).toFixed(1)} ms`);
        }
        // For automated tests: keep the clock, silence the speakers.
        if (openProjectId !== id && process.env.OPENRIP_ENGINE_MUTE) addon.setVolume(0);
        openProjectId = id;
        openProject = project;
        return { ok: true, project };
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    });

    ipcMain.handle("engine:render", (event, timeUs: number, width: number, height: number, scrub?: boolean) =>
      this.#frames.request(event.sender, timeUs, Math.max(2, Math.round(width)), Math.max(2, Math.round(height)), scrub === true),
    );

    ipcMain.handle("engine:play", (event, fromUs: number, width: number, height: number, token: number) => {
      try {
        this.#playback.start(event.sender, fromUs, Math.max(2, Math.round(width)), Math.max(2, Math.round(height)), token);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    });

    ipcMain.handle("engine:pause", () => this.#playback.stop());

    // Export the project (the same snapshot the preview gets) to a file, independent of the
    // preview; progress goes to the asking window as `engine:export-progress` (frames done, total).
    ipcMain.handle("engine:export", async (event, projectId: number, payload: unknown, path: string, options: EngineExportOptions): Promise<ExportResult> => {
      const engine = addon;
      if (!engine) return { ok: false, error: "engine not available" };
      const json = JSON.stringify(ensureProjectJson({ ...(payload as object) }, Number(projectId), app.getVersion()));
      const sender = event.sender;
      const timer = setInterval(() => {
        if (!sender.isDestroyed()) {
          const p = engine.exportProgress();
          sender.send("engine:export-progress", p.done, p.total);
        }
      }, 200);
      try {
        const r = await engine.exportProject(json, path, options);
        return { ok: true, ...r };
      } catch (e) {
        const why = message(e);
        return why === "cancelled" ? { ok: false, cancelled: true } : { ok: false, error: why };
      } finally {
        clearInterval(timer);
      }
    });

    ipcMain.handle("engine:export-cancel", () => addon?.cancelExport());

    ipcMain.handle("engine:close", () => {
      this.#playback.stop();
      addon?.close();
      openProjectId = null;
      openProject = null;
    });
  }
}

export function engineModule(): EngineModule {
  return new EngineModule();
}
