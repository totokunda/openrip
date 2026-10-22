// The app's preferences: what the Settings window edits (CapCut's Draft, Edit, Performance and
// General tabs) and the Shortcuts window's bindings. The main process keeps them
// (SettingsModule, `settings:get/set-preferences`) and tells every window when they change;
// this store mirrors them for the editor, which reads them where they act:
// - Frame rate: a new project's (lib/project-actions.ts);
// - Time code: the player's times and the marker box (lib/timecode.ts);
// - Image duration: a photo dropped on the timeline (components/timeline/TimelineEditor.tsx);
// - Step forward or back many frames: ⇧← / ⇧→ (lib/timeline-shortcuts.ts);
// - Adjust value many units: ⇧↑ / ⇧↓ in the inspector's value fields;
// - Play audio while scrubbing: snippets of sound as the playhead moves (lib/scrub-audio.ts);
// - Target loudness: Normalize loudness (lib/audio.ts);
// - Sound for export and Notification: when an export finishes (lib/export-finished.ts);
// - Screen recording folder: where Record saves (preload record.ts);
// - Preset save path: where My presets are kept (the main process's ClipPresetsModule);
// - Auto optimization: the playable copy of a video the app's own preview can't decode;
// - the shortcuts: lib/keymap.ts.
// Hardware decoding and encoding, OpenH264, the cache's age, the rendering cache's size limit and Software update act in the main process.
import { create } from "zustand";
import { getPreferences, onPreferencesChanged, setPreferences, type Preferences } from "@app/preload";

export type { Preferences };

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
  hardwareEncoding: true,
  openh264: true,
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
  arrangeLayers: true,
  proxyDefault: true,
  renderCacheDir: "",
  autoRender: false,
};

/** CapCut's choices for the rows with a menu. */
export const FRAME_RATES = [24, 25, 29.97, 30, 50, 59.94, 60];
export const CACHE_AGES = [90, 60, 30, 15];
export const TARGET_LOUDNESS = [
  { lufs: -23, key: "settings.loudness.default" },
  { lufs: -14, key: "settings.loudness.youtube" },
  { lufs: -12, key: "settings.loudness.tiktok" },
] as const;

interface PreferencesState {
  prefs: Preferences;
  loaded: boolean;
  /** Save a change (the main process keeps it and tells every window). */
  save: (patch: Partial<Preferences>) => Promise<Preferences>;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  prefs: DEFAULT_PREFERENCES,
  loaded: false,
  save: async (patch) => {
    const next = await setPreferences(patch);
    set({ prefs: { ...DEFAULT_PREFERENCES, ...next }, loaded: true });
    return next;
  },
}));

let started = false;

/** Load the preferences and follow their changes (once, at start-up). */
export function initPreferences(): Promise<void> {
  if (started) return Promise.resolve();
  started = true;
  onPreferencesChanged((p) => usePreferencesStore.setState({ prefs: { ...DEFAULT_PREFERENCES, ...p }, loaded: true }));
  return getPreferences()
    .then((p) => usePreferencesStore.setState({ prefs: { ...DEFAULT_PREFERENCES, ...p }, loaded: true }))
    .catch(() => usePreferencesStore.setState({ loaded: true }));
}

/** The preferences now, outside React. */
export const preferences = (): Preferences => usePreferencesStore.getState().prefs;

/** One preference, for a component (it re-renders when that one changes). */
export const usePreference = <K extends keyof Preferences>(key: K): Preferences[K] => usePreferencesStore((s) => s.prefs[key]);

/** Edit › Image duration in frames at `fps`: how long a photo dropped on the timeline is. */
export const imageDurationFrames = (fps: number, p: Preferences = preferences()): number => {
  const rate = Math.max(1, fps || 1);
  const n = p.imageDurationUnit === "frames" ? p.imageDuration : p.imageDuration * rate;
  return Math.max(1, Math.round(Number.isFinite(n) ? n : 5 * rate));
};

/** Edit › Frame rate: a new project's. */
export const newProjectFps = (): number => {
  const f = Number(preferences().frameRate);
  return Number.isFinite(f) && f > 0 ? f : DEFAULT_PREFERENCES.frameRate;
};
