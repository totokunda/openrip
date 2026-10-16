// Barrel file that re-exports all preload helpers, split into feature modules.
// This keeps the external API identical while avoiding a single giant implementation file.

// Core crypto/versioning
export { sha256sum } from "./nodeCrypto.js";
export { versions } from "./versions.js";

// The Rust engine in the main process
export {
  engineInfo,
  engineSyncProject,
  engineRender,
  engineClose,
  enginePlay,
  enginePause,
  onEngineClock,
  onEngineEnded,
  engineExport,
  engineExportCancel,
  onEngineExportProgress,
  getEnginePreviewEnabled,
  setEnginePreviewEnabled,
  ENGINE_FRAME_CANVAS_ID,
  ENGINE_FRAME_EVENT,
} from "./engine.js";
export type { EngineInfo, EngineProjectInfo, EngineRenderResult, EngineExportOptions, EngineExportResult } from "./engine.js";

// App updates (Electron auto-updater)
export * from "./appUpdates.js";

// Media processing primitives
export { processMediaTo24 } from "./media/process.js";
export { getMediaRootAbsolute } from "./media/root.js";
export {
  AUDIO_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  getLowercaseExtension,
} from "./media/fileExts.js";

import { pathToFileURL as pathToFileURLNode, fileURLToPath as fileURLToPathNode } from "node:url";

export const pathToFileURL = (path: string) => {
  return pathToFileURLNode(path).href;
};

export const fileURLToPath = (url: string) => {
  return fileURLToPathNode(url);
};

// Filters
export { fetchFilters } from "./filters/fetch.js";

// Shared types
export type { ConfigResponse } from "./types.js";
export type { ConvertedMediaItem } from "./media/library.js";

// Core IPC & filesystem helpers
export * from "./core/ipc.js";

// Media library and previews
export * from "./media/library.js";
export * from "./media/previews.js";
// Explicit re-export to ensure the virtual browser shim includes this new API.
export { exportVideoTranscodeWithFfmpeg } from "./media/previews.js";

// App paths (userData)
export * from "./config.js";

// Project JSON persistence
export * from "./projects.js";

// Settings helpers
export * from "./settings.js";

// Export result caching (persistent, electron-store)
export * from "./exportCache.js";
