import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

export type EngineAddon = {
  version(): string;
  openProjectJson(json: string): ProjectInfo;
  updateProject(json: string): ProjectInfo;
  close(): void;
  renderFrame(timeUs: number, width: number, height: number): Promise<FrameHandle>;
  release(id: number): void;
};

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

/** The loaded engine, or null. */
export function getEngine(): EngineAddon | null {
  return addon;
}

function addonPath(): string {
  if (process.env.OPENRIP_ENGINE_PATH) return process.env.OPENRIP_ENGINE_PATH;
  const file = "openrip_node.node";
  return app.isPackaged
    ? join(process.resourcesPath, "engine", file)
    : join(app.getAppPath(), "native", `${process.platform}-${process.arch}`, file);
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
 * Renders one request at a time; a request arriving while one renders waits as the next,
 * and a newer one replaces it (the older is answered as superseded), so scrubbing never
 * queues up stale frames.
 */
class FrameRenderer {
  #busy = false;
  #next: { args: [number, number, number]; sender: Electron.WebContents; resolve: (r: RenderResult) => void } | null = null;

  request(sender: Electron.WebContents, timeUs: number, width: number, height: number): Promise<RenderResult> {
    return new Promise((resolve) => {
      if (this.#next) this.#next.resolve({ ok: false, superseded: true });
      this.#next = { args: [timeUs, width, height], sender, resolve };
      void this.#pump();
    });
  }

  async #pump() {
    if (this.#busy) return;
    while (this.#next) {
      const job = this.#next;
      this.#next = null;
      this.#busy = true;
      job.resolve(await this.#render(job.sender, ...job.args));
      this.#busy = false;
    }
  }

  async #render(sender: Electron.WebContents, timeUs: number, width: number, height: number): Promise<RenderResult> {
    const engine = addon;
    if (!engine) return { ok: false, error: "engine not available" };
    if (openProjectId == null) return { ok: false, error: "no project sent to the engine yet" };
    if (sender.isDestroyed()) return { ok: false, error: "window closed" };
    let frame: FrameHandle;
    try {
      frame = await engine.renderFrame(Math.max(0, Math.round(timeUs)), width, height);
    } catch (e) {
      return { ok: false, error: message(e) };
    }
    try {
      const imported = sharedTexture.importSharedTexture({
        textureInfo: {
          pixelFormat: "bgra",
          codedSize: { width: frame.width, height: frame.height },
          visibleRect: { x: 0, y: 0, width: frame.width, height: frame.height },
          colorSpace: { primaries: "bt709", transfer: "srgb", matrix: "rgb", range: "full" },
          timestamp: frame.timeUs,
          handle: { ioSurface: frame.ioSurface },
        },
        allReferencesReleased: () => engine.release(frame.id),
      });
      await sharedTexture.sendSharedTexture(
        { frame: sender.mainFrame, importedSharedTexture: imported },
        { timeUs: frame.timeUs, width: frame.width, height: frame.height },
      );
      imported.release();
    } catch (e) {
      engine.release(frame.id);
      return { ok: false, error: message(e) };
    }
    const { timeUs: t, width: w, height: h, renderMs, layers, skipped } = frame;
    return { ok: true, timeUs: t, width: w, height: h, renderMs, layers, skipped };
  }
}

export class EngineModule implements AppModule {
  readonly #frames = new FrameRenderer();

  enable(_context: ModuleContext): void {
    info = load();
    if (info.available) {
      console.info(`[engine] openrip-node ${info.version} loaded from ${info.path}`);
    } else {
      console.warn(`[engine] not available (${info.error}); using the app's own preview`);
    }
    for (const channel of ["engine:info", "engine:sync-project", "engine:render", "engine:close"]) {
      try {
        ipcMain.removeHandler(channel);
      } catch {}
    }
    ipcMain.handle("engine:info", () => info);

    // The project as the JSON autosave would write it (same wrapper), opened on first use
    // and updated in place after that, which keeps the engine's decoders warm.
    ipcMain.handle("engine:sync-project", (_event, projectId: number, payload: unknown) => {
      if (!addon) return { ok: false, error: "engine not available" };
      try {
        const id = Number(projectId);
        const doc = ensureProjectJson({ ...(payload as object) }, id, app.getVersion());
        const json = JSON.stringify(doc);
        const project = openProjectId === id ? addon.updateProject(json) : addon.openProjectJson(json);
        openProjectId = id;
        return { ok: true, project };
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    });

    ipcMain.handle("engine:render", (event, timeUs: number, width: number, height: number) =>
      this.#frames.request(event.sender, timeUs, Math.max(2, Math.round(width)), Math.max(2, Math.round(height))),
    );

    ipcMain.handle("engine:close", () => {
      addon?.close();
      openProjectId = null;
    });
  }
}

export function engineModule(): EngineModule {
  return new EngineModule();
}
