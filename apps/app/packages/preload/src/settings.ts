import { ipcRenderer } from "electron";

function getActiveProjectId(): Promise<string | number | undefined | null> {
  return ipcRenderer.invoke("settings:get-active-project-id");
}

function setActiveProjectId(projectId: string | number | null): Promise<void> {
  return ipcRenderer.invoke("settings:set-active-project-id", projectId);
}

/**
 * The app's preferences (the Settings and Shortcuts windows), kept by the main process's
 * SettingsModule, which has the same shape: change both together.
 */
export interface Preferences {
  cacheAutoDelete: boolean;
  cacheMaxAgeDays: number;
  stepFrames: number;
  adjustUnits: number;
  imageDuration: number;
  imageDurationUnit: "s" | "frames";
  frameRate: number;
  timeCode: "frame" | "ff";
  targetLoudness: number;
  exportSound: boolean;
  hardwareDecoding: boolean;
  /** Performance › Speed up hardware encoding (off: exports in software). */
  hardwareEncoding: boolean;
  /** Performance › OpenH264 Video Codec provided by Cisco Systems, Inc. (H.264 in software). */
  openh264: boolean;
  autoOptimization: "none" | "smart";
  language: string;
  notifications: boolean;
  autoUpdate: boolean;
  shortcutPreset: number;
  shortcutPresets: Record<string, Record<string, string[]>>;
  walkthroughSeen: boolean;
  recordingsDir: string;
  presetsDir: string;
  renderCacheMaxGb: number;
  /** The timeline's Linkage settings: the kinds of clip that do not move or get deleted with the main track's clips (lib/linkage.ts). */
  linkageOff: string[];
  /** Edit › Play audio while scrubbing. */
  scrubAudio: boolean;
  /** Edit › Arrange layers: a new project starts with free layer order. */
  arrangeLayers: boolean;
  /** Performance › Proxy: a project's Proxy switch starts on. */
  proxyDefault: boolean;
  /** Performance › Rendering cache location ("": the default folder). */
  renderCacheDir: string;
  /** Performance › Auto render. */
  autoRender: boolean;
}

function getPreferences(): Promise<Preferences> {
  return ipcRenderer.invoke("settings:get-preferences");
}

/** Merge `patch` into the preferences; resolves with all of them. Every window hears of it. */
function setPreferences(patch: Partial<Preferences>): Promise<Preferences> {
  return ipcRenderer.invoke("settings:set-preferences", patch);
}

/** Called with the preferences whenever they change (from any window). Returns an unsubscribe. */
function onPreferencesChanged(cb: (prefs: Preferences) => void): () => void {
  const listener = (_e: unknown, prefs: Preferences) => cb(prefs);
  ipcRenderer.on("settings:preferences-changed", listener);
  return () => ipcRenderer.off("settings:preferences-changed", listener);
}

/** A folder from the native picker, or null when cancelled. */
function pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null> {
  return ipcRenderer.invoke("settings:pick-folder", opts ?? {});
}

/** Draft › Cache: the bytes OpenRip's caches take, and clearing them (resolves with what's left). */
function getCacheSize(): Promise<number> {
  return ipcRenderer.invoke("settings:cache-size");
}
function clearCache(): Promise<number> {
  return ipcRenderer.invoke("settings:clear-cache");
}

/** Performance › Rendering cache: its folder and size, and clearing it (resolves with what's left). */
function getRenderCache(): Promise<{ dir: string; defaultDir: string; bytes: number }> {
  return ipcRenderer.invoke("settings:render-cache");
}
function clearRenderCache(): Promise<number> {
  return ipcRenderer.invoke("settings:clear-render-cache");
}

/** Performance › Proxy size: the proxies and playable copies in every project's media folder. */
function getProxySize(): Promise<number> {
  return ipcRenderer.invoke("settings:proxy-size");
}

/** Performance › Proxy size's bin: remove every proxy (resolves with the bytes left). */
function clearProxies(): Promise<number> {
  return ipcRenderer.invoke("settings:clear-proxies");
}

function getAppPaths(): Promise<{ userData: string; media: string; presets: string }> {
  return ipcRenderer.invoke("settings:paths");
}

/** Draft › Save to: the projects folder (and the default one). */
function getProjectsDir(): Promise<{ dir: string; defaultDir: string }> {
  return ipcRenderer.invoke("projects:get-dir");
}

/** Move the projects to `dir` and keep them there from now on. */
function setProjectsDir(dir: string): Promise<{ success: true; data: { dir: string } } | { success: false; error: string }> {
  return ipcRenderer.invoke("projects:set-dir", dir);
}

export type AppInfo = { name: string; version: string; electron: string; chrome: string; node: string; platform: string; arch: string };

function getAppInfo(): Promise<AppInfo> {
  return ipcRenderer.invoke("settings:app-info");
}

/** The open-source notices made from the lockfiles at build time (null when missing). */
export type ThirdPartyNotices = {
  generatedAt: string;
  /** Each distinct licence text with the packages under it. */
  licenses: { id: string; text: string; packages: { name: string; version: string; source: "npm" | "cargo" | "bundled" | "other"; url?: string }[] }[];
};

function getThirdPartyNotices(): Promise<ThirdPartyNotices | null> {
  return ipcRenderer.invoke("settings:third-party-notices");
}

/** A system notification (General › Notification decides whether it shows). */
function notify(title: string, body?: string): Promise<boolean> {
  return ipcRenderer.invoke("settings:notify", { title, body });
}

export {
  getActiveProjectId,
  setActiveProjectId,
  getPreferences,
  setPreferences,
  onPreferencesChanged,
  pickFolder,
  getCacheSize,
  clearCache,
  getRenderCache,
  clearRenderCache,
  getProxySize,
  clearProxies,
  getAppPaths,
  getProjectsDir,
  setProjectsDir,
  getAppInfo,
  getThirdPartyNotices,
  notify,
};
