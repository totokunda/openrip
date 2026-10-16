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
