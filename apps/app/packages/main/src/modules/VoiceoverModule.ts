import { existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, ipcMain, systemPreferences } from "electron";
import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { getEngine } from "./EngineModule.js";

/**
 * Voiceover recording (CapCut's Voiceover panel, the timeline's microphone button): the engine
 * records the default microphone into a WAV file in the project's media folder
 * (`<userData>/media/<folder>/voiceover/`), linked into its media library like an import.
 * The window that starts a recording gets its level (`voiceover:level`, about 20 times a second)
 * until it stops; the renderer then puts the file on the timeline (lib/audio.ts
 * `placeVoiceover`).
 *
 * "Mute project" (the panel's) silences the project's playback while it records, so the
 * microphone doesn't pick it up from the speakers; the sound comes back when it stops.
 *
 * On macOS the system asks for the microphone the first time, from here, before the engine
 * opens it. With `OPENRIP_FAKE_MIC` set (automated tests) the engine records a stand-in
 * microphone that hears a steady tone instead: nothing real is recorded and nothing is asked.
 * `OPENRIP_FAKE_MIC=denied` plays a refused permission instead, for the panel's message.
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

/** A take in the project's voiceover folder (the Audio tab's Voiceovers list). */
export type VoiceoverTake = { path: string; url: string; name: string; modifiedMs: number };

export type VoiceoverStart = { ok: true; path: string; rate: number; channels: number } | { ok: false; error: string; denied?: boolean };

export type VoiceoverStop = { ok: true; path: string; url: string; durationSec: number; rate: number; channels: number } | { ok: false; error: string };

export type VoiceoverLevel = { peak: number; rms: number; elapsedMs: number };

const fake = () => !!process.env.OPENRIP_FAKE_MIC;
/** Tests of the panel's refused-permission message: nothing is recorded or asked. */
const fakeDenied = () => process.env.OPENRIP_FAKE_MIC === "denied";

const permission = (): string => {
  if (fakeDenied()) return "denied";
  if (fake()) return "granted";
  if (process.platform !== "darwin" && process.platform !== "win32") return "granted";
  try {
    return systemPreferences.getMediaAccessStatus("microphone");
  } catch {
    return "unknown";
  }
};

/** Ask for the microphone where the system wants asking (macOS); true if it may be used. */
async function askForMicrophone(): Promise<boolean> {
  if (fakeDenied()) return false;
  if (fake() || process.platform !== "darwin") return true;
  if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return true;
  return systemPreferences.askForMediaAccess("microphone");
}

/** The project's media folder (the app's per-project folder under `media/`, or the shared one). */
export function mediaFolder(folder?: string): string {
  const root = join(app.getPath("userData"), "media");
  return folder && /^[\w.-]+$/.test(folder) ? join(root, folder) : root;
}

/** A new file name in `dir`: "Voiceover 1.wav", "Voiceover 2.wav", … */
export function nextVoiceoverPath(dir: string): string {
  for (let n = 1; ; n++) {
    const p = join(dir, `Voiceover ${n}.wav`);
    if (!existsSync(p)) return p;
  }
}

/** The project's takes, newest first: the WAV files the recorder left in its voiceover folder. */
export function listTakes(folder?: string): VoiceoverTake[] {
  const dir = join(mediaFolder(folder), "voiceover");
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".wav"));
  } catch {
    return [];
  }
  const takes: VoiceoverTake[] = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      takes.push({ path, url: pathToFileURL(path).href, name: name.replace(/\.wav$/i, ""), modifiedMs: statSync(path).mtimeMs });
    } catch {}
  }
  return takes.sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/** The engine's output level when nothing silences it (tests run it muted). */
const playbackVolume = () => (process.env.OPENRIP_ENGINE_MUTE ? 0 : 1);

class Recording {
  readonly path: string;
  readonly folder: string;
  readonly muted: boolean;
  readonly started = Date.now();
  #timer: ReturnType<typeof setInterval>;

  constructor(path: string, folder: string, sender: Electron.WebContents, muted: boolean) {
    this.path = path;
    this.folder = folder;
    this.muted = muted;
    if (muted) getEngine()?.setVolume(0);
    this.#timer = setInterval(() => {
      const level = getEngine()?.recordingLevel();
      if (!level || sender.isDestroyed()) return;
      const msg: VoiceoverLevel = { peak: level.peak, rms: level.rms, elapsedMs: Date.now() - this.started };
      sender.send("voiceover:level", msg);
    }, 50);
  }

  end() {
    clearInterval(this.#timer);
    if (this.muted) getEngine()?.setVolume(playbackVolume());
  }
}

export class VoiceoverModule implements AppModule {
  #recording: Recording | null = null;
  /** A take the page is capturing itself (the panel's input device, volume and echo reduction need the page's own capture). */
  #session: { muted: boolean } | null = null;

  enable(_context: ModuleContext): void {
    for (const channel of ["voiceover:status", "voiceover:start", "voiceover:stop", "voiceover:cancel", "voiceover:list", "voiceover:begin", "voiceover:end", "voiceover:ask"]) {
      try {
        ipcMain.removeHandler(channel);
      } catch {}
    }
    if (fake()) getEngine()?.useToneInput();

    ipcMain.handle("voiceover:status", (): VoiceoverStatus => ({
      available: !!getEngine(),
      recording: !!this.#recording || !!this.#session,
      permission: permission(),
      projectMuted: !!this.#recording?.muted || !!this.#session?.muted,
    }));

    // The page records the take itself (getUserMedia): these keep the status and "Mute project".
    ipcMain.handle("voiceover:ask", () => askForMicrophone());
    ipcMain.handle("voiceover:begin", (_event, options?: { muteProject?: boolean }) => {
      this.#session = { muted: !!options?.muteProject };
      if (this.#session.muted) getEngine()?.setVolume(0);
    });
    ipcMain.handle("voiceover:end", () => {
      if (this.#session?.muted) getEngine()?.setVolume(playbackVolume());
      this.#session = null;
    });

    ipcMain.handle("voiceover:list", (_event, options?: { folder?: string }): VoiceoverTake[] => listTakes(options?.folder));

    ipcMain.handle("voiceover:start", async (event, options?: { folder?: string; muteProject?: boolean }): Promise<VoiceoverStart> => {
      const engine = getEngine();
      if (!engine) return { ok: false, error: "engine not available" };
      if (this.#recording) return { ok: false, error: "already recording" };
      if (!(await askForMicrophone())) return { ok: false, error: "microphone access denied", denied: true };
      const folder = mediaFolder(options?.folder);
      const dir = join(folder, "voiceover");
      try {
        mkdirSync(dir, { recursive: true });
        const path = nextVoiceoverPath(dir);
        const started = engine.startRecording(path);
        this.#recording = new Recording(path, folder, event.sender, !!options?.muteProject);
        return { ok: true, path, rate: started.rate, channels: started.channels };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });

    ipcMain.handle("voiceover:stop", (): VoiceoverStop => {
      const rec = this.#recording;
      this.#recording = null;
      const engine = getEngine();
      if (!rec || !engine) return { ok: false, error: "not recording" };
      rec.end();
      try {
        const done = engine.stopRecording();
        if (!done) return { ok: false, error: "not recording" };
        // In the media library too, as an import would be.
        const links = join(rec.folder, "symlinks");
        try {
          mkdirSync(links, { recursive: true });
          const link = join(links, basename(done.path));
          if (!existsSync(link)) symlinkSync(done.path, link);
        } catch (e) {
          console.warn("[voiceover] couldn't link into the media library:", e);
        }
        return { ok: true, path: done.path, url: pathToFileURL(done.path).href, durationSec: done.durationUs / 1e6, rate: done.rate, channels: done.channels };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });

    // Stop and throw the take away.
    ipcMain.handle("voiceover:cancel", () => {
      const rec = this.#recording;
      this.#recording = null;
      if (!rec) return;
      rec.end();
      try {
        getEngine()?.stopRecording();
      } catch {}
      rmSync(rec.path, { force: true });
    });

    app.on("before-quit", () => {
      if (this.#session?.muted) getEngine()?.setVolume(playbackVolume());
      this.#session = null;
      if (!this.#recording) return;
      this.#recording.end();
      try {
        getEngine()?.stopRecording();
      } catch {}
      this.#recording = null;
    });
  }
}

export function voiceoverModule(): VoiceoverModule {
  return new VoiceoverModule();
}
