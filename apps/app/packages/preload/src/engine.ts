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
  /**
   * After a sync: where CapCut texts whose words or style the edit changed are now laid out
   * (canvas pixels, before their rotation), so their boxes can follow.
   */
  textBlocks?: { segment: string; left: number; top: number; width: number; height: number }[];
};

export type EngineRenderResult =
  | { ok: true; timeUs: number; width: number; height: number; renderMs: number; layers: number; skipped: number }
  | { ok: false; superseded?: boolean; error?: string };

/** A frame from the engine's thumbnailer, at the requested height: RGBA, `width * height * 4` bytes. */
export type EngineThumbnail = { index: number; timeUs: number; exact: boolean; width: number; height: number; rgba: Uint8Array };

/**
 * Frames of a video at `timesUs` (one per time, `index` into it), `height` pixels tall;
 * `exact` false allows the GOP's keyframe as a quick stand-in. Empty without the engine.
 */
export function engineThumbnails(path: string, timesUs: number[], height: number, exact: boolean): Promise<EngineThumbnail[]> {
  return ipcRenderer.invoke("engine:thumbnails", path, timesUs, height, exact);
}

/** A file's audio for the timeline's waveforms: per bucket of the mono mix, its peak and RMS (0..1). */
export type EngineWaveform = { perSecond: number; peak: Float32Array; rms: Float32Array };

/**
 * The audio of `path` (a path or file URL) at `perSecond` buckets a second (it must divide
 * 48 000), decoded once by the engine and kept on disk; null without audio or the engine.
 */
export function engineWaveform(path: string, perSecond: number): Promise<EngineWaveform | null> {
  return ipcRenderer.invoke("engine:waveform", path, perSecond);
}

/** A file's beats as the engine finds them (lib/beats.ts `BeatGrid`): times in s of its media. */
export type EngineBeats = { bpm: number; beats: { time: number; downbeat: boolean }[] };

/** The beats in the audio of `path` (a path or file URL), cached by the engine per file; null without audio or the engine. */
export function engineBeats(path: string): Promise<EngineBeats | null> {
  return ipcRenderer.invoke("engine:beats", path);
}

/**
 * The EBU R128 loudness (LUFS; null for silence) and peak (dBFS) of `path` over `durationSec`
 * from `startSec` of its media (all of it for null), as CapCut measures it for "Normalize
 * loudness" (lib/audio.ts `MeasureLoudness`); null without audio or the engine.
 */
export function engineLoudness(path: string, startSec: number, durationSec: number | null): Promise<{ integrated: number | null; peak: number } | null> {
  return ipcRenderer.invoke("engine:loudness", path, startSec, durationSec);
}

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
/** The frame at `timeUs`; `scrub` while the playhead is dragged (a quick stand-in for video). */
export function engineRender(timeUs: number, width: number, height: number, scrub = false): Promise<EngineRenderResult> {
  return ipcRenderer.invoke("engine:render", timeUs, width, height, scrub);
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

/** The playing mix's left and right peaks (0..1) since the last ask, for the player's meter; null without the engine's sound. */
export function engineOutputLevels(): Promise<{ left: number; right: number } | null> {
  return ipcRenderer.invoke("engine:levels");
}

export type EngineStillResult = { ok: true; path: string; width: number; height: number; bytes: number } | { ok: false; error: string };

/** Save the frame at `timeUs` at the project's size as a PNG at `path` (the player's Export still frames). */
export function engineExportStill(timeUs: number, path: string): Promise<EngineStillResult> {
  return ipcRenderer.invoke("engine:export-still", timeUs, path);
}

export function engineClose(): Promise<void> {
  return ipcRenderer.invoke("engine:close");
}

/** A font face the page has (an `@font-face` rule), its file as the page loads it. */
export type EngineFontFace = { family: string; weight: number; italic: boolean; url: string; unicodeRange?: string };

/** A family the engine draws text in. `bundled`: one of the app's own fonts, else installed. */
export type EngineFontFamily = { name: string; weights: number[]; italic: boolean; bundled: boolean };

/**
 * Give the engine the page's bundled fonts, so it draws text in the fonts the font menu shows.
 * Resolves to how many faces it took (0 without the engine).
 */
export function engineRegisterFonts(faces: EngineFontFace[]): Promise<number> {
  return ipcRenderer.invoke("engine:register-fonts", faces);
}

/** The families the engine draws text in: the bundled ones, then the installed ones. Empty without the engine. */
export function engineFontFamilies(): Promise<EngineFontFamily[]> {
  return ipcRenderer.invoke("engine:font-families");
}

export function getEnginePreviewEnabled(): Promise<boolean> {
  return ipcRenderer.invoke("settings:get-engine-preview");
}

export function setEnginePreviewEnabled(on: boolean): Promise<void> {
  return ipcRenderer.invoke("settings:set-engine-preview", on);
}

// Electron's release() sends its IPC call without awaiting it: when main has let the texture
// go already (its send gave up on a slow window), that call rejects with nothing to catch it.
// It's harmless, so it's kept out of the page's errors; any other rejection still shows.
window.addEventListener("unhandledrejection", (e) => {
  if (String(e.reason?.message ?? e.reason).includes("IMPORT_SHARED_TEXTURE_RELEASE")) e.preventDefault();
});

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
      // When the window is slow, main can have let the texture go already (its send gave
      // up); the late release then finds nothing to release, which is harmless.
      Promise.resolve(importedSharedTexture.release()).catch(() => {});
    }
  });
} catch (e) {
  // Not available (older Electron); the engine preview just won't show frames.
  console.warn("[engine] shared texture receiver unavailable:", e);
}
