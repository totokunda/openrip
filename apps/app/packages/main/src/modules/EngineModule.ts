import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain, net, sharedTexture } from "electron";
import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { ensureProjectJson } from "./JSONPersistenceModule.js";
import { withFilterTablesOnDisk } from "./engineFiles.js";
import { getSettingsModule, type Preferences } from "./SettingsModule.js";
import { TilePreviews } from "./TilePreviews.js";

/**
 * The Rust engine (`engine/crates/node`, built by `scripts/build-engine.mjs`), loaded into
 * the main process. Where it isn't available (no build for this platform, or it failed to
 * load) the app keeps using its own preview; `engine:info` says which.
 *
 * With the engine preview on, the renderer sends the project after each edit
 * (`engine:sync-project`) and asks for frames (`engine:render`); frames go back to the
 * asking window as shared GPU textures (macOS) or pixels (Windows, Linux), which its
 * preload draws.
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
  /** Windows and Linux: the frame's pixels (RGBA) instead of an IOSurface. */
  rgba?: Buffer | null;
  width: number;
  height: number;
  timeUs: number;
  renderMs: number;
  layers: number;
  skipped: number;
};

type DisplayFrame = { id: number; ioSurface: Buffer; rgba?: Buffer | null; width: number; height: number; timeUs: number; renderMs: number };

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
  /** The playing mix's peaks (0..1) since the last call, before the volume; null without audio output. */
  outputLevels(): { left: number; right: number } | null;
  /** Play a short snippet of the mix at `timeUs`, for scrubbing; false when none started. */
  scrubAudio?(timeUs: number): boolean;
  scrubAudioStop?(): void;
  scrubAudioStats?(): { snippets: number; lastUs: number; left: number; right: number } | null;
  /** Render the frame at `timeUs` at `width`×`height` and save it as a PNG at `path`. */
  exportStill(timeUs: number, width: number, height: number, path: string): Promise<{ width: number; height: number; bytes: number }>;
  exportProject(json: string, path: string, options: EngineExportOptions): Promise<{ frames: number; seconds: number; skippedLayers: number }>;
  /** The project's sound alone: format "wav", "flac", "mp3" or "aac" (written as M4A). */
  exportAudio?(json: string, path: string, format: string): Promise<{ frames: number; seconds: number; skippedLayers: number }>;
  /** The project as a looping GIF, `shortSide` px on its shorter side. */
  exportGif?(json: string, path: string, shortSide: number, fps: number): Promise<{ frames: number; seconds: number; skippedLayers: number }>;
  exportProgress(): { done: number; total: number };
  cancelExport(): void;
  /** The video codecs the platform's encoder can write (absent in engines built before it). */
  exportCodecs?(): string[];
  setThumbnailCacheDir(dir: string): void;
  /** Render: pre-rendered chunks (absent in engines built before it). */
  setRenderCacheDir?(dir: string): void;
  renderCacheAvailable?(): boolean;
  setRenderCacheEnabled?(on: boolean): void;
  prerender?(startUs: number | null, endUs: number | null): Promise<{ rendered: number; reused: number; frames: number; seconds: number }>;
  prerenderProgress?(): { done: number; total: number };
  cancelPrerender?(): void;
  /** Start, end, start, end, ... in microseconds. */
  renderedRanges?(): number[];
  clearRenderCache?(): void;
  renderCacheBytes?(): number;
  renderCacheStats?(): { hits: number; misses: number };
  /** Performance › Speed up hardware decoding (absent in engines built before it). */
  setHardwareDecoding?(on: boolean): void;
  capcutToApp(dir: string): Promise<{ json: string; name: string; missingMedia: string[]; notes: string[] }>;
  thumbnails(path: string, timesUs: number[], height: number, exact: boolean): Promise<Thumbnail[]>;
  /** A file's audio as buckets per second (peak and RMS of the mono mix), cached; null without audio. */
  waveform(path: string, perSecond: number): Promise<{ perSecond: number; peak: Float32Array; rms: Float32Array } | null>;
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
  /** Split scenes: shot changes in a file's range (media µs); progress and cancel by `job`. */
  detectScenes(job: number, path: string, startUs: number, durationUs: number | null, sensitivity: number | null): Promise<SceneCut[]>;
  /** Color match: a range's colour statistics (Oklab moments and more). */
  colorStats(job: number, path: string, startUs: number, durationUs: number | null, look: Look | null): Promise<ColorStats>;
  /** Auto adjust: the Basic sliders (panel scale) from a range's statistics, through a match. */
  autoAdjust(job: number, path: string, startUs: number, durationUs: number | null, matched: MatchOn | null): Promise<AutoAdjustValues>;
  /** Stabilize and Remove flickers: track a file's camera motion and frame brightness (media µs), kept by the engine for preview and export. */
  analyseMotion(job: number, path: string, startUs: number, durationUs: number | null): Promise<void>;
  /** Whether a range has been tracked (in this run or an earlier one). */
  motionReady(path: string, startUs: number, durationUs: number | null): boolean;
  analysisProgress(job: number): { done: number; total: number } | null;
  cancelAnalysis(job: number): void;
  registerFonts(faces: { family: string; weight: number; italic: boolean; path: string; unicodeRange?: string }[]): void;
  fontFamilies(): FontFamily[];
  /** Motion tracking: a region of a video followed through its frames (engine/crates/core/src/track.rs). */
  /** OpenRip's own video effects (engine/crates/model/src/fx.rs) as JSON. */
  effectCatalog?(): string;
  /** Frames of an effect on a sample picture, drawn by the renderer (0–1 values). */
  effectPreviews?(id: string, intensity: number | null, params: number[], times: number[], duration: number, width: number, height: number): Promise<{ width: number; height: number; data: Buffer }[]>;
  /** Frames of a small project given as JSON (a library tile's preview), cropped to `crop` (fractions of the frame) when given. */
  /** A code that changes when the engine's drawing of the transition or effect `id` does (absent in engines built before it). */
  previewRevision?(id: string, effect: boolean): string;
  projectPreviews?(json: string, times: number[], width: number, height: number, crop: number[] | null): Promise<{ width: number; height: number; data: Buffer }[]>;
  trackRegion(request: EngineTrackRequest): Promise<EngineTrackResult>;
  trackProgress(): { done: number; total: number };
  cancelTrack(): void;
};

/** What to track: the video, the source times (µs), the region on its upright picture (fractions, degrees). */
export type EngineTrackRequest = {
  path: string;
  atUs: number;
  fromUs: number;
  toUs: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
  direction: string;
};

export type EngineTrackResult = {
  samples: { timeUs: number; centerX: number; centerY: number; width: number; height: number; rotation: number; scale: number; confidence: number }[];
  lostForwardUs?: number | null;
  lostBackwardUs?: number | null;
};

/** A family the engine draws text in: the app's bundled fonts, then the installed ones. */
export type FontFamily = { name: string; weights: number[]; italic: boolean; bundled: boolean };

/** A font face the page has (an `@font-face` rule), its file as the page loads it. */
export type PageFontFace = { family: string; weight: number; italic: boolean; url: string; unicodeRange?: string };

/** A shot change: the new shot's first frame (media µs), its kind, the transition's span. */
export type SceneCut = { timeUs: number; kind: "hard" | "dissolve" | "fade"; startUs: number; endUs: number; score: number };
/** A range's colour statistics: Oklab means and spreads, luma, chroma, the cast. */
export type ColorStats = { mean: number[]; std: number[]; lumaMean: number; lumaStd: number; lumaPercentiles: number[]; chroma: number; neutral: number[] | null; pixels: number };
export type MatchOn = { sourceMean: number[]; sourceStd: number[]; referenceMean: number[]; referenceStd: number[]; intensity: number };
/** A clip's look on its media for its statistics: its match, then its Basic sliders (panel scale). */
export type Look = { matched?: MatchOn | null } & Partial<Record<"brightness" | "contrast" | "saturation" | "highlights" | "shadows" | "whites" | "blacks" | "temperature" | "tint", number>>;
export type AutoAdjustValues = { brightness: number; contrast: number; saturation: number; temperature: number; tint: number; whites: number; blacks: number; stats: ColorStats };
/** An analysis's answer, or why there's none (`cancelled` after a cancel). */
export type AnalysisResult<T> = { ok: true; value: T } | { ok: false; cancelled?: boolean; error?: string };

/** A frame from the engine's thumbnailer: RGBA, `width * height * 4` bytes. */
export type Thumbnail = { index: number; timeUs: number; exact: boolean; width: number; height: number; rgba: Buffer };

/** `kind` picks the output: a video (the default), the sound alone (`audioFormat`) or a GIF (`shortSide`, `fps`). `exactBitrate` holds a custom bit rate. */
export type EngineExportOptions = { kind?: "video" | "audio" | "gif"; width: number; height: number; fps: number; codec: string; bitrate: number; exactBitrate?: boolean; audio: boolean; audioFormat?: string; shortSide?: number };

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

/** Where the engine reads the look tables of the filters bundled inside app.asar (engineFiles.ts). */
const filterTablesDir = () => join(app.getPath("userData"), "engine-filters");

/**
 * The file behind a font the page loads: the file itself for a file URL, or the dev server's
 * `/@fs/` path to it; otherwise (the built app's `app://renderer/…`, a dev server's other
 * paths) a copy fetched through the app's protocols into `<userData>/engine-fonts`, named
 * after the URL's path (the built app's file names carry their content hash). Null if it
 * can't be had.
 */
async function fontFile(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return fileURLToPath(u);
    if (u.pathname.startsWith("/@fs/")) {
      const path = decodeURIComponent(u.pathname.slice(4));
      if (existsSync(path)) return path;
    }
    if (!["app:", "http:", "https:"].includes(u.protocol)) return null;
    const dir = join(app.getPath("userData"), "engine-fonts");
    const file = join(dir, `${u.hostname}${decodeURIComponent(u.pathname)}`.replace(/[^\w.-]+/g, "_"));
    if (!existsSync(file)) {
      const res = await net.fetch(u.href);
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
async function sendFrame(engine: EngineAddon, sender: Electron.WebContents, f: { id: number; ioSurface: Buffer; rgba?: Buffer | null; width: number; height: number; timeUs: number; renderMs?: number }) {
  // Windows and Linux: the engine shares no GPU texture with Electron there yet, so its frame
  // comes as pixels read back from the GPU (a copy: the surface goes back to the engine now),
  // which the window's preload draws (preload/src/engine.ts).
  if (f.rgba) {
    engine.release(f.id);
    sender.send("engine:frame-pixels", { timeUs: f.timeUs, width: f.width, height: f.height, renderMs: f.renderMs }, f.rgba);
    return;
  }
  try {
    const imported = sharedTexture.importSharedTexture({
      textureInfo: {
        pixelFormat: "bgra",
        codedSize: { width: f.width, height: f.height },
        visibleRect: { x: 0, y: 0, width: f.width, height: f.height },
        // Rec. 709, as an export is tagged, shown as macOS shows Rec. 709 video (QuickTime, Final
        // Cut Pro: CoreMedia's gamma 1.961) rather than as sRGB, which is darker in the mid-tones.
        colorSpace: { primaries: "bt709", transfer: "bt709-apple", matrix: "rgb", range: "full" },
        timestamp: f.timeUs,
        handle: { ioSurface: f.ioSurface },
      },
      allReferencesReleased: () => engine.release(f.id),
    });
    await sharedTexture.sendSharedTexture({ frame: sender.mainFrame, importedSharedTexture: imported }, { timeUs: f.timeUs, width: f.width, height: f.height, renderMs: f.renderMs });
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
    // (Performance › Rendering cache location: the folder the user chose, else one in the user data.)
    const settings = getSettingsModule();
    if (addon) addon.setThumbnailCacheDir(settings.renderCacheDir());
    // Pre-rendered chunks go in a folder of their own inside it, so Settings' size, Clear and Auto clear cover them.
    if (addon) addon.setRenderCacheDir?.(settings.renderCacheDir());
    // Performance › Speed up hardware decoding, now and when it changes.
    addon?.setHardwareDecoding?.(settings.getPreferences().hardwareDecoding);
    settings.on("preferences-changed", (p: Preferences) => addon?.setHardwareDecoding?.(p.hardwareDecoding));
    // The rendering cache moved: the engine keeps its files in the new folder from now on.
    settings.on("render-cache-moved", (dir: string) => {
      addon?.setThumbnailCacheDir(dir);
      addon?.setRenderCacheDir?.(dir);
    });
    for (const channel of ["engine:info", "engine:sync-project", "engine:render", "engine:close", "engine:play", "engine:pause", "engine:export", "engine:export-cancel", "engine:thumbnails", "engine:waveform", "engine:beats", "engine:loudness", "engine:register-fonts", "engine:font-families", "engine:levels", "engine:export-still", "engine:detect-scenes", "engine:color-stats", "engine:auto-adjust", "engine:analyse-motion", "engine:motion-ready", "engine:analysis-progress", "engine:analysis-cancel", "engine:render-cache-info", "engine:prerender", "engine:prerender-cancel", "engine:rendered-ranges", "engine:render-cache-delete", "engine:render-cache-stats", "engine:render-cache-enabled"]) {
      try {
        ipcMain.removeHandler(channel);
      } catch {}
    }
    ipcMain.handle("engine:info", () => info);

    // The Effects tab: OpenRip's own video effects and frames of them drawn by the engine.
    for (const channel of ["engine:effect-catalog", "engine:effect-previews", "engine:project-previews"]) {
      try {
        ipcMain.removeHandler(channel);
      } catch {}
    }
    ipcMain.handle("engine:effect-catalog", () => {
      try {
        return addon?.effectCatalog ? JSON.parse(addon.effectCatalog()) : null;
      } catch (e) {
        console.warn("[engine] effect catalog failed:", message(e));
        return null;
      }
    });
    ipcMain.handle("engine:effect-previews", async (_event, id: string, intensity: number | null, params: number[], times: number[], duration: number, width: number, height: number) => {
      if (!addon?.effectPreviews) return [];
      try {
        const frames = await addon.effectPreviews(id, intensity, params, times, duration, width, height);
        return frames.map((f) => ({ width: f.width, height: f.height, rgba: new Uint8Array(f.data) }));
      } catch (e) {
        console.warn("[engine] effect previews failed:", message(e));
        return [];
      }
    });

    // The Text tab's templates: frames of a small project drawn by the engine, as the player draws it.
    ipcMain.handle("engine:project-previews", async (_event, json: string, times: number[], width: number, height: number, crop: number[] | null) => {
      if (!addon?.projectPreviews) return [];
      try {
        const frames = await addon.projectPreviews(json, times, width, height, crop);
        return frames.map((f) => ({ width: f.width, height: f.height, rgba: new Uint8Array(f.data) }));
      } catch (e) {
        console.warn("[engine] project previews failed:", message(e));
        return [];
      }
    });

    // The Transitions and Effects tabs' tiles: real footage with the transition or effect drawn on it.
    new TilePreviews(() => addon).register();

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

    // A file's audio as buckets for the timeline's waveforms (the engine decodes it once and
    // keeps the buckets on disk with the thumbnails).
    ipcMain.handle("engine:waveform", async (_event, path: string, perSecond: number) => {
      if (!addon) return null;
      const file = path.startsWith("file://") ? fileURLToPath(path) : path;
      try {
        const w = await addon.waveform(file, perSecond);
        return w && { perSecond: w.perSecond, peak: w.peak, rms: w.rms };
      } catch (e) {
        console.warn("[engine] waveform failed:", message(e));
        return null;
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
    // Split scenes, Color match and Auto adjust (lib/analysis.ts): long reads of a clip's
    // media, each with a job number for its progress and cancel.
    const analysis = async <T>(what: string, run: (engine: EngineAddon) => Promise<T>): Promise<AnalysisResult<T>> => {
      if (!addon) return { ok: false, error: "engine not available" };
      try {
        return { ok: true, value: await run(addon) };
      } catch (e) {
        const why = message(e);
        if (why === "cancelled") return { ok: false, cancelled: true };
        console.warn(`[engine] ${what} failed:`, why);
        return { ok: false, error: why };
      }
    };
    const fileOf = (path: string) => (path.startsWith("file://") ? fileURLToPath(path) : path);
    const us = (sec: number | null) => (sec == null ? null : Math.round(sec * 1e6));
    ipcMain.handle("engine:detect-scenes", (_event, job: number, path: string, startSec: number, durationSec: number | null, sensitivity: number | null) =>
      analysis("split scenes", (e) => e.detectScenes(job, fileOf(path), us(startSec) ?? 0, us(durationSec), sensitivity ?? null)),
    );
    ipcMain.handle("engine:color-stats", (_event, job: number, path: string, startSec: number, durationSec: number | null, look: Look | null) =>
      analysis("colour statistics", (e) => e.colorStats(job, fileOf(path), us(startSec) ?? 0, us(durationSec), look ?? null)),
    );
    ipcMain.handle("engine:auto-adjust", (_event, job: number, path: string, startSec: number, durationSec: number | null, matched: MatchOn | null) =>
      analysis("auto adjust", (e) => e.autoAdjust(job, fileOf(path), us(startSec) ?? 0, us(durationSec), matched ?? null)),
    );
    ipcMain.handle("engine:analyse-motion", (_event, job: number, path: string, startSec: number, durationSec: number | null) =>
      analysis("motion tracking", (e) => e.analyseMotion(job, fileOf(path), us(startSec) ?? 0, us(durationSec))),
    );
    ipcMain.handle("engine:motion-ready", (_event, path: string, startSec: number, durationSec: number | null) => addon?.motionReady(fileOf(path), us(startSec) ?? 0, us(durationSec)) ?? false);
    ipcMain.handle("engine:analysis-progress", (_event, job: number) => addon?.analysisProgress(job) ?? null);
    ipcMain.handle("engine:analysis-cancel", (_event, job: number) => addon?.cancelAnalysis(job));
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
        const doc = withFilterTablesOnDisk(ensureProjectJson({ ...(payload as object) }, id, app.getVersion()), filterTablesDir());
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

    // The player's meter: the mix's level since the last ask (zero while paused).
    ipcMain.handle("engine:levels", () => {
      try {
        return addon?.outputLevels() ?? null;
      } catch {
        return null;
      }
    });

    // Scrubbing sound: a snippet of the mix at the playhead (fire and forget), cut short when the drag ends.
    ipcMain.on("engine:scrub-audio", (_event, timeUs: number) => {
      try {
        if (Number.isFinite(timeUs)) addon?.scrubAudio?.(Math.max(0, Math.round(timeUs)));
      } catch {
        /* no sound is not an error */
      }
    });
    ipcMain.on("engine:scrub-audio-stop", () => {
      try {
        addon?.scrubAudioStop?.();
      } catch {
        /* nothing to stop */
      }
    });
    ipcMain.handle("engine:scrub-audio-stats", () => {
      try {
        return addon?.scrubAudioStats?.() ?? null;
      } catch {
        return null;
      }
    });

    // The player's Export still frames: the frame at `timeUs` at the project's size, as a PNG.
    ipcMain.handle("engine:export-still", async (_event, timeUs: number, path: string) => {
      const engine = addon;
      if (!engine) return { ok: false, error: "engine not available" };
      if (openProjectId == null || !openProject) return { ok: false, error: "no project sent to the engine yet" };
      try {
        const r = await engine.exportStill(Math.max(0, Math.round(timeUs)), openProject.width, openProject.height, path);
        return { ok: true, path, ...r };
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    });

    // Export the project (the same snapshot the preview gets) to a file, independent of the
    // preview; progress goes to the asking window as `engine:export-progress` (frames done, total).
    ipcMain.handle("engine:export", async (event, projectId: number, payload: unknown, path: string, options: EngineExportOptions): Promise<ExportResult> => {
      const engine = addon;
      if (!engine) return { ok: false, error: "engine not available" };
      const json = JSON.stringify(withFilterTablesOnDisk(ensureProjectJson({ ...(payload as object) }, Number(projectId), app.getVersion()), filterTablesDir()));
      const sender = event.sender;
      const timer = setInterval(() => {
        if (!sender.isDestroyed()) {
          const p = engine.exportProgress();
          sender.send("engine:export-progress", p.done, p.total);
        }
      }, 200);
      try {
        if (options.kind === "audio") {
          if (!engine.exportAudio) return { ok: false, error: "this engine can't export sound alone; rebuild it" };
          return { ok: true, ...(await engine.exportAudio(json, path, options.audioFormat ?? "wav")) };
        }
        if (options.kind === "gif") {
          if (!engine.exportGif) return { ok: false, error: "this engine can't export GIFs; rebuild it" };
          return { ok: true, ...(await engine.exportGif(json, path, options.shortSide ?? 240, options.fps || 15)) };
        }
        const { kind: _kind, audioFormat: _audioFormat, shortSide: _shortSide, ...video } = options;
        const r = await engine.exportProject(json, path, video);
        return { ok: true, ...r };
      } catch (e) {
        const why = message(e);
        return why === "cancelled" ? { ok: false, cancelled: true } : { ok: false, error: why };
      } finally {
        clearInterval(timer);
      }
    });

    ipcMain.handle("engine:export-cancel", () => addon?.cancelExport());

    // Render (the Render menu): timeline ranges composited into the render cache, which the
    // preview then plays from; progress goes to the asking window as
    // `engine:prerender-progress` (frames done, total).
    ipcMain.handle("engine:render-cache-info", () => {
      try {
        return { available: !!addon?.renderCacheAvailable?.(), bytes: addon?.renderCacheBytes?.() ?? 0 };
      } catch {
        return { available: false, bytes: 0 };
      }
    });
    ipcMain.handle("engine:prerender", async (event, startUs: number | null, endUs: number | null) => {
      const engine = addon;
      if (!engine?.prerender) return { ok: false, error: "this engine can't render ahead; rebuild it" };
      if (!engine.renderCacheAvailable?.()) return { ok: false, error: "this platform has no video encoder to render with" };
      const sender = event.sender;
      const timer = setInterval(() => {
        if (!sender.isDestroyed()) {
          const p = engine.prerenderProgress?.() ?? { done: 0, total: 0 };
          sender.send("engine:prerender-progress", p.done, p.total);
        }
      }, 150);
      try {
        const r = await engine.prerender(startUs == null ? null : Math.round(startUs), endUs == null ? null : Math.round(endUs));
        return { ok: true, ...r };
      } catch (e) {
        const why = message(e);
        return why === "cancelled" ? { ok: false, cancelled: true } : { ok: false, error: why };
      } finally {
        clearInterval(timer);
      }
    });
    ipcMain.handle("engine:prerender-cancel", () => addon?.cancelPrerender?.());
    ipcMain.handle("engine:rendered-ranges", () => {
      try {
        const flat = addon?.renderedRanges?.() ?? [];
        return Array.from({ length: Math.floor(flat.length / 2) }, (_, i) => [flat[i * 2], flat[i * 2 + 1]]);
      } catch {
        return [];
      }
    });
    ipcMain.handle("engine:render-cache-delete", () => addon?.clearRenderCache?.());
    ipcMain.handle("engine:render-cache-stats", () => addon?.renderCacheStats?.() ?? { hits: 0, misses: 0 });
    ipcMain.handle("engine:render-cache-enabled", (_event, on: boolean) => addon?.setRenderCacheEnabled?.(!!on));
    // The codecs the Export dialog may offer beyond H.264 and HEVC: only what this platform's encoder has.
    ipcMain.handle("engine:export-codecs", (): string[] => {
      try {
        return addon?.exportCodecs?.() ?? [];
      } catch {
        return [];
      }
    });

    // Motion tracking over a video's own frames; progress goes to the asking window as
    // `engine:track-progress` (frames done, total).
    for (const channel of ["engine:track", "engine:track-cancel"]) {
      try {
        ipcMain.removeHandler(channel);
      } catch {}
    }
    ipcMain.handle("engine:track", async (event, request: EngineTrackRequest) => {
      const engine = addon;
      if (!engine) return { ok: false, error: "engine not available" };
      const path = request.path.startsWith("file://") ? fileURLToPath(request.path) : request.path;
      const sender = event.sender;
      const timer = setInterval(() => {
        if (!sender.isDestroyed()) {
          const p = engine.trackProgress();
          sender.send("engine:track-progress", p.done, p.total);
        }
      }, 100);
      try {
        const r = await engine.trackRegion({ ...request, path });
        return { ok: true, ...r };
      } catch (e) {
        const why = message(e);
        return why === "cancelled" ? { ok: false, cancelled: true } : { ok: false, error: why };
      } finally {
        clearInterval(timer);
      }
    });
    ipcMain.handle("engine:track-cancel", () => addon?.cancelTrack());

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
