import { ipcRenderer } from "electron";

/**
 * Voiceover recording for the Voiceover panel (the main process's VoiceoverModule): start
 * records the default microphone into the project's media folder, the level arrives while it
 * records, and stop returns the file for lib/audio.ts `placeVoiceover` to put on the timeline.
 */
export type VoiceoverStatus = {
  /** The engine is loaded, so recording can work. */
  available: boolean;
  recording: boolean;
  /** The microphone permission: "granted", "denied", "restricted", "not-determined" or "unknown". */
  permission: string;
  /** The project's playback is silenced while this recording lasts ("Mute project"). */
  projectMuted: boolean;
};

/** A take in the project's voiceover folder, newest first (the Audio tab's Voiceovers list). */
export type VoiceoverTake = { path: string; url: string; name: string; modifiedMs: number };

export type VoiceoverStart = { ok: true; path: string; rate: number; channels: number } | { ok: false; error: string; denied?: boolean };

export type VoiceoverStop = { ok: true; path: string; url: string; durationSec: number; rate: number; channels: number } | { ok: false; error: string };

/** The level since the last report (0..1, peak and RMS) and how long it's been recording. */
export type VoiceoverLevel = { peak: number; rms: number; elapsedMs: number };

export function voiceoverStatus(): Promise<VoiceoverStatus> {
  return ipcRenderer.invoke("voiceover:status");
}

/**
 * Start recording into `<media>/<folder>/voiceover/Voiceover N.wav` (`folder`: the project's
 * media folder id; none for the shared one). macOS asks for the microphone the first time;
 * refused, this resolves `{ok: false, denied: true}`. `muteProject` silences the project's
 * playback until the recording stops (the panel's "Mute project").
 */
export function voiceoverStart(folder?: string, options?: { muteProject?: boolean }): Promise<VoiceoverStart> {
  return ipcRenderer.invoke("voiceover:start", { folder, muteProject: !!options?.muteProject });
}

/** The takes recorded for the project (`folder`: its media folder id), newest first. */
export function voiceoverList(folder?: string): Promise<VoiceoverTake[]> {
  return ipcRenderer.invoke("voiceover:list", { folder });
}

/** Stop and keep the take: its file (path and file URL) and length. */
export function voiceoverStop(): Promise<VoiceoverStop> {
  return ipcRenderer.invoke("voiceover:stop");
}

/** Stop and throw the take away. */
export function voiceoverCancel(): Promise<void> {
  return ipcRenderer.invoke("voiceover:cancel");
}

/** Called with the level about 20 times a second while recording. Returns an unsubscribe. */
export function onVoiceoverLevel(cb: (level: VoiceoverLevel) => void): () => void {
  const listener = (_e: unknown, level: VoiceoverLevel) => cb(level);
  ipcRenderer.on("voiceover:level", listener);
  return () => ipcRenderer.off("voiceover:level", listener);
}
