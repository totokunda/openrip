import { ipcRenderer } from "electron";

/**
 * Auto captions: local speech recognition and its models (the main process's SpeechModule).
 * Models are Whisper ggml files downloaded on first use into the user's app data.
 */

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
  /** The engine can recognize speech. */
  available: boolean;
  defaultModel: string;
  models: SpeechModelState[];
  /** Where the models are kept. */
  folder: string;
};

/** What to recognize: a media file's range (`audioPath`), or the timeline's mix (`snapshot`). Times in seconds. */
export type SpeechAsk = {
  modelId: string;
  /** ISO 639-1 code, or null to detect it. */
  language: string | null;
  audioPath?: string | null;
  projectId?: number | null;
  snapshot?: unknown;
  startSec: number;
  durationSec: number | null;
  removeFillers: boolean;
  highlightKeywords: boolean;
  maxChars?: number | null;
  maxLines?: number | null;
};

/** A caption the engine cut from the speech: times in µs from the start of the range recognized; word ranges are characters of `text`. */
export type SpeechCaption = {
  startUs: number;
  endUs: number;
  text: string;
  words: { rangeStart: number; rangeEnd: number; startUs: number; endUs: number; keyword: boolean }[];
};

export type SpeechResult = { language: string; wordCount: number; captions: SpeechCaption[] };

export type SpeechAnswer<T> = { ok: true; value: T } | { ok: false; cancelled?: boolean; error?: string };

/** The models, which are here, and whether this engine can recognize speech. */
export function speechStatus(): Promise<SpeechStatus> {
  return ipcRenderer.invoke("speech:status");
}

/** Download a model (resolves when it's verified and in place; watch `speechStatus` for progress). */
export function speechDownload(id: string): Promise<SpeechAnswer<true>> {
  return ipcRenderer.invoke("speech:download", id);
}

export function speechDownloadCancel(id: string): Promise<void> {
  return ipcRenderer.invoke("speech:download-cancel", id);
}

/** Delete a model's file. */
export function speechDelete(id: string): Promise<SpeechStatus> {
  return ipcRenderer.invoke("speech:delete", id);
}

/** Recognize speech; `job` is a number the caller picks for `speechProgress` and `speechCancel`. */
export function speechTranscribe(job: number, ask: SpeechAsk): Promise<SpeechAnswer<SpeechResult>> {
  return ipcRenderer.invoke("speech:transcribe", job, ask);
}

/** A running recognition's progress, 0–100; null when it isn't running. */
export function speechProgress(job: number): Promise<number | null> {
  return ipcRenderer.invoke("speech:progress", job);
}

export function speechCancel(job: number): Promise<void> {
  return ipcRenderer.invoke("speech:cancel", job);
}
