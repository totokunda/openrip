import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, ipcMain } from "electron";
import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { getEngine } from "./EngineModule.js";
import { ensureProjectJson } from "./JSONPersistenceModule.js";

/**
 * Auto captions: speech recognition with a local Whisper model (engine/crates/speech), and the
 * models it needs. Nothing leaves the device but the model download.
 *
 * Models are ggml files from `ggerganov/whisper.cpp` on Hugging Face (the Whisper weights are
 * MIT licensed, see Third-party copyright), downloaded on first use into
 * `<userData>/speech-models/`: one file each, written as `.part` and renamed only when its
 * size and SHA-256 match the engine's catalog. The renderer lists them with their state
 * (`speech:models`), polls that for a download's progress, starts, cancels and deletes
 * downloads, and asks for a transcription (`speech:transcribe`, with job number, progress and
 * cancel as the analyses have).
 *
 * For tests: `OPENRIP_SPEECH_MODELS` is the folder models are kept in (pre-seed a model
 * there), `OPENRIP_SPEECH_DOWNLOAD_BASE` replaces the Hugging Face address files are fetched
 * from (a local server serving the same file names).
 */

/** What the engine's addon has for speech (engine/crates/node/index.d.ts). */
type SpeechAddon = {
  speechModels(): { id: string; label: string; file: string; englishOnly: boolean; size: number; sha256: string; note: string; url: string }[];
  speechDefaultModel(): string;
  speechAvailable(): boolean;
  speechProgress(job: number): number | null;
  cancelSpeech(job: number): void;
  transcribeSpeech(job: number, request: SpeechRequest): Promise<SpeechResult>;
};

export type SpeechRequest = {
  modelPath: string;
  language: string | null;
  audioPath: string | null;
  projectJson: string | null;
  startUs: number;
  durationUs: number | null;
  removeFillers: boolean;
  highlightKeywords: boolean;
  maxChars: number | null;
  maxLines: number | null;
};

export type SpeechResult = {
  language: string;
  wordCount: number;
  captions: { startUs: number; endUs: number; text: string; words: { rangeStart: number; rangeEnd: number; startUs: number; endUs: number; keyword: boolean }[] }[];
};

/** A model with where it stands on this machine. */
export type SpeechModelState = {
  id: string;
  label: string;
  englishOnly: boolean;
  /** Bytes. */
  size: number;
  note: string;
  installed: boolean;
  downloading: boolean;
  /** 0–1 while downloading. */
  progress: number;
};

export type SpeechStatus = {
  /** The engine can recognize speech (its build has whisper.cpp). */
  available: boolean;
  defaultModel: string;
  models: SpeechModelState[];
  /** Where the models are kept. */
  folder: string;
};

export type SpeechAsk = {
  modelId: string;
  /** ISO 639-1 code, or null to detect. */
  language: string | null;
  /** A media file's sound... */
  audioPath?: string | null;
  /** ...or the timeline's mix: the project and its snapshot. */
  projectId?: number | null;
  snapshot?: unknown;
  startSec: number;
  durationSec: number | null;
  removeFillers: boolean;
  highlightKeywords: boolean;
  maxChars?: number | null;
  maxLines?: number | null;
};

type Answer<T> = { ok: true; value: T } | { ok: false; cancelled?: boolean; error?: string };

const speech = (): SpeechAddon | null => {
  const a = getEngine() as unknown as Partial<SpeechAddon> | null;
  return a && typeof a.speechModels === "function" ? (a as SpeechAddon) : null;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const folder = () => process.env.OPENRIP_SPEECH_MODELS || join(app.getPath("userData"), "speech-models");

/** Where a model's file is fetched from (the catalog's address, or the test server's). */
const urlOf = (m: { url: string; file: string }) => {
  const base = process.env.OPENRIP_SPEECH_DOWNLOAD_BASE;
  return base ? `${base.replace(/\/$/, "")}/${m.file}` : m.url;
};

const fileOf = (m: { file: string }) => join(folder(), m.file);

/** Whether a model's file is here whole (its size is the catalog's; the checksum was checked when it came). */
const installed = (m: { file: string; size: number }) => {
  try {
    return statSync(fileOf(m)).size === m.size;
  } catch {
    return false;
  }
};

type Download = { abort: AbortController; received: number; total: number };
const downloads = new Map<string, Download>();

async function download(id: string): Promise<Answer<true>> {
  const m = speech()?.speechModels().find((x) => x.id === id);
  if (!m) return { ok: false, error: `no speech model called ${id}` };
  if (downloads.has(id)) return { ok: false, error: "already downloading" };
  if (installed(m)) return { ok: true, value: true };
  mkdirSync(folder(), { recursive: true });
  const part = `${fileOf(m)}.part`;
  const job: Download = { abort: new AbortController(), received: 0, total: m.size };
  downloads.set(id, job);
  try {
    const res = await fetch(urlOf(m), { signal: job.abort.signal, redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`the download failed (${res.status} ${res.statusText})`);
    const hash = createHash("sha256");
    const out = createWriteStream(part);
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        job.received += value.length;
        if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", resolve));
      }
    } finally {
      await new Promise<void>((resolve) => out.end(resolve));
    }
    if (job.received !== m.size) throw new Error(`the model came to ${job.received} bytes, not ${m.size}`);
    if (hash.digest("hex") !== m.sha256) throw new Error("the downloaded model's checksum is wrong, so it was thrown away");
    renameSync(part, fileOf(m));
    return { ok: true, value: true };
  } catch (e) {
    rmSync(part, { force: true });
    if (job.abort.signal.aborted) return { ok: false, cancelled: true };
    return { ok: false, error: message(e) };
  } finally {
    downloads.delete(id);
  }
}

function status(): SpeechStatus {
  const a = speech();
  const models = (a?.speechModels() ?? []).map((m): SpeechModelState => {
    const d = downloads.get(m.id);
    return { id: m.id, label: m.label, englishOnly: m.englishOnly, size: m.size, note: m.note, installed: installed(m), downloading: !!d, progress: d ? d.received / Math.max(1, d.total) : 0 };
  });
  return { available: !!a && a.speechAvailable(), defaultModel: a?.speechDefaultModel() ?? "small", models, folder: folder() };
}

export class SpeechModule implements AppModule {
  enable(_context: ModuleContext): void {
    for (const channel of ["speech:status", "speech:download", "speech:download-cancel", "speech:delete", "speech:transcribe", "speech:progress", "speech:cancel"]) {
      try {
        ipcMain.removeHandler(channel);
      } catch {}
    }
    ipcMain.handle("speech:status", () => status());
    ipcMain.handle("speech:download", (_event, id: string) => download(id));
    ipcMain.handle("speech:download-cancel", (_event, id: string) => downloads.get(id)?.abort.abort());
    ipcMain.handle("speech:delete", (_event, id: string) => {
      downloads.get(id)?.abort.abort();
      const m = speech()?.speechModels().find((x) => x.id === id);
      if (m) rmSync(fileOf(m), { force: true });
      return status();
    });
    ipcMain.handle("speech:progress", (_event, job: number) => speech()?.speechProgress(job) ?? null);
    ipcMain.handle("speech:cancel", (_event, job: number) => speech()?.cancelSpeech(job));
    ipcMain.handle("speech:transcribe", async (_event, job: number, ask: SpeechAsk): Promise<Answer<SpeechResult>> => {
      const a = speech();
      if (!a) return { ok: false, error: "speech recognition isn't in this build of the engine" };
      const m = a.speechModels().find((x) => x.id === ask.modelId);
      if (!m || !installed(m)) return { ok: false, error: "the speech model isn't downloaded" };
      try {
        const projectJson = ask.snapshot ? JSON.stringify(ensureProjectJson({ ...(ask.snapshot as object) }, Number(ask.projectId ?? 0), app.getVersion())) : null;
        const audio = ask.audioPath ? (ask.audioPath.startsWith("file://") ? fileURLToPath(ask.audioPath) : ask.audioPath) : null;
        const value = await a.transcribeSpeech(job, {
          modelPath: fileOf(m),
          language: ask.language && ask.language !== "auto" ? ask.language : null,
          audioPath: projectJson ? null : audio,
          projectJson,
          startUs: Math.round(ask.startSec * 1e6),
          durationUs: ask.durationSec == null ? null : Math.round(ask.durationSec * 1e6),
          removeFillers: ask.removeFillers,
          highlightKeywords: ask.highlightKeywords,
          maxChars: ask.maxChars ?? null,
          maxLines: ask.maxLines ?? null,
        });
        return { ok: true, value };
      } catch (e) {
        const why = message(e);
        if (why === "cancelled") return { ok: false, cancelled: true };
        console.warn("[speech] transcription failed:", why);
        return { ok: false, error: why };
      }
    });
  }
}

export function speechModule(): SpeechModule {
  return new SpeechModule();
}
