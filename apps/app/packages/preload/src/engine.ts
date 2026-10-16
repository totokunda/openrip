import { ipcRenderer, sharedTexture } from "electron";

/** Whether the Rust engine loaded in the main process, and which version. */
export type EngineInfo = {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
};

export type EngineProjectInfo = {
  name: string;
  width: number;
  height: number;
  fps: number;
  durationUs: number;
  source: string;
};

export type EngineRenderResult =
  | { ok: true; timeUs: number; width: number; height: number; renderMs: number; layers: number; skipped: number }
  | { ok: false; superseded?: boolean; error?: string };

/** Id of the canvas the engine's frames are drawn into; the page creates it. */
export const ENGINE_FRAME_CANVAS_ID = "openrip-engine-frame";
/** Event fired on that canvas after each frame is drawn (detail: time, width, height). */
export const ENGINE_FRAME_EVENT = "openrip-engine-frame";

export function engineInfo(): Promise<EngineInfo> {
  return ipcRenderer.invoke("engine:info");
}

/** Send the project (the JSON autosave's snapshot) to the engine. */
export function engineSyncProject(
  projectId: number,
  snapshot: unknown,
): Promise<{ ok: true; project: EngineProjectInfo } | { ok: false; error: string }> {
  return ipcRenderer.invoke("engine:sync-project", projectId, snapshot);
}

/**
 * Render the frame at `timeUs` at `width`×`height`. The pixels arrive separately and are
 * drawn into the canvas with id ENGINE_FRAME_CANVAS_ID; this resolves once they are.
 */
export function engineRender(timeUs: number, width: number, height: number): Promise<EngineRenderResult> {
  return ipcRenderer.invoke("engine:render", timeUs, width, height);
}

/**
 * Play from `fromUs` with the engine's sound and clock, frames drawn at `width`×`height`.
 * The frames arrive like rendered ones; `onEngineClock` reports the time of each.
 */
export function enginePlay(fromUs: number, width: number, height: number, token: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return ipcRenderer.invoke("engine:play", fromUs, width, height, token);
}

/** Stop playing; resolves to where it stopped (µs), or -1 if it wasn't playing. */
export function enginePause(): Promise<number> {
  return ipcRenderer.invoke("engine:pause");
}

/**
 * Called with the time (µs) of each frame shown while the engine plays, and the token the
 * run was started with. Returns an unsubscribe.
 */
export function onEngineClock(cb: (timeUs: number, token: number) => void): () => void {
  const listener = (_e: unknown, timeUs: number, token: number) => cb(timeUs, token);
  ipcRenderer.on("engine:clock", listener);
  return () => ipcRenderer.off("engine:clock", listener);
}

/** Called when playback reaches the end of the timeline, with where it stopped (µs) and the run's token. */
export function onEngineEnded(cb: (atUs: number, token: number) => void): () => void {
  const listener = (_e: unknown, atUs: number, token: number) => cb(atUs, token);
  ipcRenderer.on("engine:ended", listener);
  return () => ipcRenderer.off("engine:ended", listener);
}

export type EngineExportOptions = { width: number; height: number; fps: number; codec: string; bitrate: number; audio: boolean };

export type EngineExportResult =
  | { ok: true; frames: number; seconds: number; skippedLayers: number }
  | { ok: false; cancelled?: boolean; error?: string };

/** Export a project snapshot to `path` with the engine (H.264/HEVC, AAC). */
export function engineExport(projectId: number, snapshot: unknown, path: string, options: EngineExportOptions): Promise<EngineExportResult> {
  return ipcRenderer.invoke("engine:export", projectId, snapshot, path, options);
}

/** Stop the running engine export (its promise resolves with `cancelled`). */
export function engineExportCancel(): Promise<void> {
  return ipcRenderer.invoke("engine:export-cancel");
}

/** Called with frames done and total while an engine export runs. Returns an unsubscribe. */
export function onEngineExportProgress(cb: (done: number, total: number) => void): () => void {
  const listener = (_e: unknown, done: number, total: number) => cb(done, total);
  ipcRenderer.on("engine:export-progress", listener);
  return () => ipcRenderer.off("engine:export-progress", listener);
}

export function engineClose(): Promise<void> {
  return ipcRenderer.invoke("engine:close");
}

export function getEnginePreviewEnabled(): Promise<boolean> {
  return ipcRenderer.invoke("settings:get-engine-preview");
}

export function setEnginePreviewEnabled(on: boolean): Promise<void> {
  return ipcRenderer.invoke("settings:set-engine-preview", on);
}

// Frames arrive as shared GPU textures. This preload world draws them into the page's
// canvas (the DOM is shared between worlds; a VideoFrame can't cross the bridge) and tells
// the page with a DOM event.
try {
  sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, meta: { timeUs: number; width: number; height: number }) => {
    try {
      const canvas = document.getElementById(ENGINE_FRAME_CANVAS_ID) as HTMLCanvasElement | null;
      if (canvas) {
        if (canvas.width !== meta.width || canvas.height !== meta.height) {
          canvas.width = meta.width;
          canvas.height = meta.height;
        }
        const frame = importedSharedTexture.getVideoFrame();
        canvas.getContext("2d", { alpha: false })?.drawImage(frame, 0, 0, canvas.width, canvas.height);
        frame.close();
        canvas.dispatchEvent(new CustomEvent(ENGINE_FRAME_EVENT, { detail: meta }));
      }
    } finally {
      importedSharedTexture.release();
    }
  });
} catch (e) {
  // Not available (older Electron); the engine preview just won't show frames.
  console.warn("[engine] shared texture receiver unavailable:", e);
}
