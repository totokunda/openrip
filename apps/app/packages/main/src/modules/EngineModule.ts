import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, ipcMain } from "electron";
import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";

/**
 * The Rust engine (`engine/crates/node`, built by `scripts/build-engine.mjs`), loaded into
 * the main process. Where it isn't available (no build for this platform, or it failed to
 * load) the app keeps using its own preview; `engine:info` says which.
 */
export type EngineAddon = {
  version(): string;
  [name: string]: unknown;
};

export type EngineInfo = {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
};

let addon: EngineAddon | null = null;
let info: EngineInfo = { available: false, error: "not loaded yet" };

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

export class EngineModule implements AppModule {
  enable(_context: ModuleContext): void {
    info = load();
    if (info.available) {
      console.info(`[engine] openrip-node ${info.version} loaded from ${info.path}`);
    } else {
      console.warn(`[engine] not available (${info.error}); using the app's own preview`);
    }
    try {
      ipcMain.removeHandler("engine:info");
    } catch {}
    ipcMain.handle("engine:info", () => info);
  }
}

export function engineModule(): EngineModule {
  return new EngineModule();
}
