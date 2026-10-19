import { spawn } from "node:child_process";
import { promises as fsp, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ipcRenderer } from "electron";
import { getUserDataPath } from "./config.js";
import { resolveFfmpegCommand } from "./media/ffmpegBin.js";
import { symlinksDir } from "./media/paths.js";

/**
 * Recording from the page (Media tab's Record, the Voiceover panel): the page captures the
 * screen, camera and microphone (getDisplayMedia, getUserMedia), the main process says what
 * can be captured and what the system allows (RecordModule), and these save what was captured
 * into the project's media folder as a file the engine and the editor decode, linked into the
 * media library like an import.
 */

export type RecordSource = { id: string; name: string; kind: "screen" | "window"; thumbnail: string };
export type RecordSources = { permission: string; sources: RecordSource[] };
export type RecordKind = "camera" | "microphone" | "screen";

/** The screens and windows that can be recorded, with a picture of each, and the Screen Recording permission. */
export function recordSources(): Promise<RecordSources> {
  return ipcRenderer.invoke("record:sources");
}

/** Test mode: the page records fake devices (a tone for the microphone), nothing real. */
export function recordFake(): Promise<boolean> {
  return ipcRenderer.invoke("record:fake");
}

/** What the system allows: "granted", "denied", "restricted", "not-determined" or "unknown". */
export function recordPermission(kind: RecordKind): Promise<string> {
  return ipcRenderer.invoke("record:permission", kind);
}

/** Ask for the camera or microphone where the system wants asking (macOS); true if it may be used. */
export function recordAsk(kind: "camera" | "microphone"): Promise<boolean> {
  return ipcRenderer.invoke("record:ask", kind);
}

/** The screen or window the page's next getDisplayMedia gets (a source id from recordSources). */
export function recordPick(id: string | null): Promise<void> {
  return ipcRenderer.invoke("record:pick", id);
}

type Bytes = ArrayBuffer | ArrayBufferView;
const bytes = (b: Bytes) => (ArrayBuffer.isView(b) ? Buffer.from(b.buffer, b.byteOffset, b.byteLength) : Buffer.from(b));

async function mediaFolderFor(folderUuid: string | undefined, sub: string): Promise<{ root: string; dir: string }> {
  const user = (await getUserDataPath())?.data?.user_data ?? "";
  const base = join(user, "media");
  const root = typeof folderUuid === "string" && /^[\w.-]+$/.test(folderUuid) ? join(base, folderUuid) : base;
  const dir = join(root, sub);
  await fsp.mkdir(dir, { recursive: true });
  return { root, dir };
}

/** A new name in `dir`: "Recording 1.mp4", "Recording 2.mp4", … */
const nextName = (dir: string, stem: string, ext: string) => {
  for (let n = 1; ; n++) {
    const name = `${stem} ${n}.${ext}`;
    if (!existsSync(join(dir, name))) return name;
  }
};

/** In the media library too, as an import is. */
async function linkIntoLibrary(root: string, file: string, name: string): Promise<string> {
  const links = symlinksDir(root);
  await fsp.mkdir(links, { recursive: true });
  const link = join(links, name);
  try {
    await fsp.rm(link, { force: true });
    await fsp.symlink(file, link);
  } catch {
    await fsp.copyFile(file, link);
  }
  return link;
}

export type SavedRecording = { path: string; url: string; linkPath: string; linkUrl: string; durationSec: number };

/**
 * Save a screen or camera recording (`data`: the WebM the page's MediaRecorder made, which has
 * no length or seek points) as `<media>/<folder>/recordings/Recording N.mp4` (H.264 and AAC,
 * constant frame rate, even size), linked into the library. Rejects with ffmpeg's message if it
 * can't be converted.
 */
export async function recordingSave(data: Bytes, options: { folder?: string; hasAudio?: boolean; fps?: number }): Promise<SavedRecording> {
  const { root, dir } = await mediaFolderFor(options.folder, "recordings");
  const name = nextName(dir, "Recording", "mp4");
  const out = join(dir, name);
  const source = join(dir, `${name}.webm.part`);
  await fsp.writeFile(source, bytes(data));
  const fps = Math.max(1, Math.round(options.fps ?? 30));
  const args = [
    "-i", source,
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-fps_mode", "cfr", "-r", String(fps),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-g", "30",
    ...(options.hasAudio === false ? ["-an"] : ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]),
    "-movflags", "+faststart",
    "-y", out,
  ];
  const stderr = await new Promise<string>((resolve, reject) => {
    const ps = spawn(resolveFfmpegCommand("ffmpeg"), args);
    let err = "";
    ps.stderr.on("data", (d) => {
      err = (err + d.toString()).slice(-6000);
    });
    ps.on("error", reject);
    ps.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg failed with code ${code}: ${err.slice(-600)}`))));
  }).finally(() => fsp.rm(source, { force: true }).catch(() => {}));
  const t = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  const durationSec = t ? +t[1] * 3600 + +t[2] * 60 + +t[3] : 0;
  const linkPath = await linkIntoLibrary(root, out, name);
  return { path: out, url: pathToFileURL(out).href, linkPath, linkUrl: pathToFileURL(linkPath).href, durationSec };
}

export type SavedTake = { path: string; url: string; durationSec: number; rate: number; channels: number };

/**
 * Save a voiceover take (`pcm`: 16-bit samples, interleaved) as `<media>/<folder>/voiceover/Voiceover N.wav`,
 * linked into the library, where the engine's own recorder would have put it.
 */
export async function voiceoverSaveTake(pcm: Bytes, options: { folder?: string; rate: number; channels: number }): Promise<SavedTake> {
  const { root, dir } = await mediaFolderFor(options.folder, "voiceover");
  const name = nextName(dir, "Voiceover", "wav");
  const path = join(dir, name);
  const body = bytes(pcm);
  const { rate, channels } = options;
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + body.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * channels * 2, 28);
  head.writeUInt16LE(channels * 2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(body.length, 40);
  await fsp.writeFile(path, Buffer.concat([head, body]));
  try {
    await linkIntoLibrary(root, path, name);
  } catch (e) {
    console.warn("[voiceover] couldn't link into the media library:", e);
  }
  return { path, url: pathToFileURL(path).href, durationSec: body.length / 2 / channels / rate, rate, channels };
}

/** The microphone permission and asking for it, as the Voiceover panel needs them. */
export function voiceoverAsk(): Promise<boolean> {
  return ipcRenderer.invoke("voiceover:ask");
}

/** A take the page is capturing starts: the status shows it, and `muteProject` silences the project's playback. */
export function voiceoverBegin(options?: { muteProject?: boolean }): Promise<void> {
  return ipcRenderer.invoke("voiceover:begin", { muteProject: !!options?.muteProject });
}

/** The take the page was capturing is over: the project's sound comes back. */
export function voiceoverEnd(): Promise<void> {
  return ipcRenderer.invoke("voiceover:end");
}
