// Auto captions and Auto lyrics: the speech in the timeline's mix, or in the selected clip,
// recognized by a local Whisper model (engine/crates/speech, through the main process's
// SpeechModule) and put on a new captions track of text clips with each word's timing, in
// the chosen caption style (lib/caption-actions.ts, lib/caption-presets.ts). Generate is one
// undo step; Generate again replaces the track the last one made ("Delete current captions").
// The model is downloaded on first use. The panel is components/menus/AutoCaptionsMenu.tsx.
import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import {
  speechCancel,
  speechDelete,
  speechDownload,
  speechDownloadCancel,
  speechProgress,
  speechStatus,
  speechTranscribe,
  type SpeechAsk,
  type SpeechCaption,
  type SpeechStatus,
} from "@app/preload";
import { captionClips, type Cue } from "./captions";
import { rememberTranscript } from "./transcript";
import { wordsOfCaptions } from "./transcript-edit";
import { captionStyle, useCaptionsStore } from "./caption-actions";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { beginStep } from "./history";
import { playedRange } from "./audio";
import { engineProjectSnapshot } from "./engine-preview";
import { useViewportStore } from "./viewport";
import { useSidebarStore } from "./sidebar";
import { BASE_LONG_SIDE } from "./settings";
import type { AnyClipProps, TextClipProps, VideoClipProps } from "./types";
import type { ContextMenuItem } from "./context-menu";

/** Spoken languages Whisper knows, by ISO 639-1 code (a menu of them, "Auto detect" first). */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "auto", label: "Auto detect" },
  { code: "ar", label: "Arabic" },
  { code: "bn", label: "Bengali" },
  { code: "my", label: "Burmese" },
  { code: "zh", label: "Chinese" },
  { code: "nl", label: "Dutch" },
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "he", label: "Hebrew" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ms", label: "Malay" },
  { code: "fa", label: "Persian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "es", label: "Spanish" },
  { code: "sv", label: "Swedish" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "ur", label: "Urdu" },
  { code: "vi", label: "Vietnamese" },
];

export type AutoKind = "captions" | "lyrics";

/** What the panel shows and the work in progress. */
type State = {
  language: string;
  highlightKeywords: boolean;
  fillerWords: boolean;
  /** "Delete current captions": Generate replaces the captions the last Generate made. */
  deleteCurrent: boolean;
  /** The model chosen, or null for the engine's default. */
  modelId: string | null;
  status: SpeechStatus | null;
  phase: "idle" | "downloading" | "working";
  /** 0–1 of the download or of the recognition. */
  progress: number;
  /** What the last run did or why it didn't. */
  message: string | null;
  kind: AutoKind;
};

const KEY = "openrip:autocaptions";

const saved = (): Partial<Pick<State, "language" | "highlightKeywords" | "fillerWords" | "deleteCurrent" | "modelId">> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};

export const useAutoCaptions = create<State>(() => ({
  language: "auto",
  highlightKeywords: false,
  fillerWords: false,
  deleteCurrent: true,
  modelId: null,
  ...saved(),
  status: null,
  phase: "idle",
  progress: 0,
  message: null,
  kind: "captions",
}));

/** Change a setting (and keep it for next time). */
export const setAutoCaptions = (patch: Partial<Pick<State, "language" | "highlightKeywords" | "fillerWords" | "deleteCurrent" | "modelId">>) => {
  useAutoCaptions.setState(patch);
  const { language, highlightKeywords, fillerWords, deleteCurrent, modelId } = useAutoCaptions.getState();
  try {
    localStorage.setItem(KEY, JSON.stringify({ language, highlightKeywords, fillerWords, deleteCurrent, modelId }));
  } catch {}
};

/** The models and where they stand, fetched again. */
export async function refreshSpeechStatus(): Promise<SpeechStatus> {
  const status = await speechStatus();
  useAutoCaptions.setState({ status });
  return status;
}

/** The model in use: the chosen one, else the default. */
export const modelInUse = (s: Pick<State, "modelId" | "status">) => s.modelId ?? s.status?.defaultModel ?? "small";

let nextJob = 1;
let currentJob: number | null = null;
let downloading: string | null = null;
let cancelled = false;

/** Stop what Generate is doing (a download or the recognition); nothing is changed. */
export function cancelAutoCaptions() {
  cancelled = true;
  if (downloading) void speechDownloadCancel(downloading);
  if (currentJob != null) void speechCancel(currentJob);
}

/** Download a model, its progress in the store. Resolves true when it's in place. */
export async function downloadModel(id: string): Promise<boolean> {
  if (downloading) return false;
  downloading = id;
  const timer = setInterval(() => {
    void speechStatus().then((status) => {
      const m = status.models.find((x) => x.id === id);
      useAutoCaptions.setState({ status, progress: m?.progress ?? 0 });
    });
  }, 150);
  try {
    const r = await speechDownload(id);
    if (!r.ok && !r.cancelled) useAutoCaptions.setState({ message: `Couldn't download the model: ${r.error ?? "unknown error"}` });
    return r.ok;
  } finally {
    clearInterval(timer);
    downloading = null;
    await refreshSpeechStatus();
  }
}

/** Delete a downloaded model. */
export async function deleteModel(id: string) {
  const status = await speechDelete(id);
  useAutoCaptions.setState({ status });
}

/**
 * Make sure the chosen model is here, downloading it first (progress in the store). Resolves
 * to its id, or null when the engine can't recognize speech or the download stopped.
 */
export async function ensureModel(): Promise<string | null> {
  const store = useAutoCaptions;
  const status = store.getState().status ?? (await refreshSpeechStatus());
  if (!status.available) {
    store.setState({ message: "This build of the engine can't recognize speech." });
    return null;
  }
  const modelId = modelInUse(store.getState());
  if (!status.models.find((m) => m.id === modelId)?.installed) {
    if (!(await downloadModel(modelId))) return null;
    if (cancelled) return null;
  }
  return modelId;
}

/** Recognize `ask`, its progress in the store (and Cancel working). */
export async function runSpeech(ask: SpeechAsk) {
  const job = nextJob++;
  currentJob = job;
  const timer = setInterval(() => {
    void speechProgress(job).then((p) => {
      if (p != null && currentJob === job) useAutoCaptions.setState({ progress: p / 100 });
    });
  }, 150);
  try {
    return await speechTranscribe(job, ask);
  } finally {
    clearInterval(timer);
    currentJob = null;
  }
}

/** Start a run (Generate, Transcript): false while another is under way; the cancel flag is reset. */
export function beginSpeechRun(phase: "downloading" | "working" = "downloading", kind: AutoKind = "captions"): boolean {
  const store = useAutoCaptions;
  if (store.getState().phase !== "idle") return false;
  cancelled = false;
  store.setState({ phase, progress: 0, message: null, kind });
  return true;
}

/** A run's end: the panel is idle again. */
export const endSpeechRun = () => useAutoCaptions.setState({ phase: "idle", progress: 0 });

/** Whether Cancel was pressed during the run. */
export const speechCancelled = () => cancelled;

/** The canvas in world units, as the preview lays it out. */
const worldCanvas = () => {
  const { aspectRatio } = useViewportStore.getState();
  const ratio = aspectRatio.width / aspectRatio.height;
  return { width: BASE_LONG_SIDE * (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9), height: BASE_LONG_SIDE };
};

/** Whether a clip has sound the recognizer can listen to on its own (a video or an audio clip with media). */
const listenable = (clip: AnyClipProps | undefined): clip is VideoClipProps =>
  (clip?.type === "video" || clip?.type === "audio") && (!!(clip as VideoClipProps).compound || !!useClipStore.getState().getAssetById((clip as VideoClipProps).assetId)?.path);

/** The clip Generate listens to: the one selected (alone), else the timeline's mix. */
export function sourceClip(): VideoClipProps | null {
  const ids = useControlsStore.getState().selectedClipIds;
  if (ids.length !== 1) return null;
  const clip = useClipStore.getState().getClipById(ids[0]);
  return listenable(clip) ? clip : null;
}

/** The tracks the last Generate made: those whose captions are all from speech. */
const autoTracks = () => {
  const { clips, timelines } = useClipStore.getState();
  return timelines.filter((t) => {
    const mine = clips.filter((c) => c.timelineId === t.timelineId);
    return mine.length > 0 && mine.every((c) => c.type === "text" && (c as TextClipProps).autoCaption);
  });
};

/** What a cue from the engine is in the app: seconds, with its words' timing. */
const cueOf = (c: SpeechCaption, scale: number): Cue => ({
  start: (c.startUs / 1e6) * scale,
  end: (c.endUs / 1e6) * scale,
  text: c.text,
  words: c.words.map((w) => ({ from: w.rangeStart, to: w.rangeEnd, start: (w.startUs / 1e6) * scale, end: (w.endUs / 1e6) * scale, keyword: w.keyword || undefined })),
});

/** Where the panel is told to open (the clip menu's Generate captions). */
export const useAutoCaptionsFocus = create<{ tick: number; kind: AutoKind }>(() => ({ tick: 0, kind: "captions" }));

/** Show the Auto captions panel (for the selected clip, if one is). */
export function openAutoCaptions(kind: AutoKind = "captions") {
  useAutoCaptionsFocus.setState((s) => ({ tick: s.tick + 1, kind }));
  useSidebarStore.getState().openSection("captions");
}

/**
 * Generate: make sure the model is here (downloading it), recognize the speech and add the
 * captions as one step. Resolves to how many captions were added (0 if none, null if it
 * stopped).
 */
export async function generateCaptions(kind: AutoKind = "captions"): Promise<number | null> {
  const store = useAutoCaptions;
  if (store.getState().phase !== "idle") return null;
  cancelled = false;
  store.setState({ phase: "downloading", progress: 0, message: null, kind });
  try {
    const modelId = await ensureModel();
    if (!modelId) return null;
    store.setState({ phase: "working", progress: 0 });

    const fps = useControlsStore.getState().fps || 30;
    const { language, highlightKeywords, fillerWords, deleteCurrent } = store.getState();
    const clip = sourceClip();
    const speed = Math.max(0.1, Number((clip as VideoClipProps | null)?.speed || 1));
    const simple = !!clip && !(clip as VideoClipProps).compound && !(clip as VideoClipProps).reverse && !(clip as VideoClipProps).speedCurve;
    const ask: SpeechAsk = {
      modelId,
      language: language === "auto" ? null : language,
      startSec: 0,
      durationSec: null,
      removeFillers: fillerWords,
      highlightKeywords,
      maxChars: kind === "lyrics" ? 26 : null,
      maxLines: kind === "lyrics" ? 2 : null,
    };
    let offsetFrames = 0;
    let scale = 1;
    if (clip && simple) {
      // The clip's own sound over the range it plays; its times are the media's, so a speed shortens them.
      const asset = useClipStore.getState().getAssetById(clip.assetId)!;
      const [start, duration] = playedRange(clip, fps, asset.duration);
      ask.audioPath = asset.path;
      ask.startSec = start;
      ask.durationSec = duration;
      offsetFrames = clip.startFrame ?? 0;
      scale = 1 / speed;
    } else {
      // The timeline's mix (of the clip's span, if one is selected).
      const snap = await engineProjectSnapshot();
      if (!snap) {
        store.setState({ message: "Open a project first." });
        return null;
      }
      ask.projectId = snap.projectId;
      ask.snapshot = snap.snapshot;
      if (clip) {
        ask.startSec = (clip.startFrame ?? 0) / fps;
        ask.durationSec = Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0)) / fps;
        offsetFrames = clip.startFrame ?? 0;
      }
    }

    const answer = await runSpeech(ask);
    if (!answer.ok) {
      if (!answer.cancelled) store.setState({ message: `Couldn't generate captions: ${answer.error ?? "unknown error"}` });
      return null;
    }
    // The words stay with the media for Transcript (a run that left the fillers out isn't the whole speech).
    if (clip && simple && !fillerWords) {
      const asset = useClipStore.getState().getAssetById(clip.assetId);
      if (asset) rememberTranscript(asset.id, wordsOfCaptions(answer.value.captions, ask.startSec), [ask.startSec, ask.startSec + (ask.durationSec ?? 0)], answer.value.language, modelId);
    }
    const cues = answer.value.captions.map((c) => cueOf(c, scale));
    if (cues.length === 0) {
      store.setState({ message: "No speech found." });
      toast("No speech found");
      return 0;
    }

    // One step: the old captions out, the new track in.
    beginStep();
    const clips = useClipStore.getState();
    if (deleteCurrent) for (const t of autoTracks()) clips.deleteTrack(t.timelineId);
    let styleId = useCaptionsStore.getState().styleId;
    // Lyrics fill as they're sung unless a word-by-word style was chosen.
    if (kind === "lyrics" && !captionStyle(styleId).kind) styleId = "karaoke-lavender";
    const style = { ...captionStyle(styleId).props, ...(highlightKeywords ? { captionKeywordColor: "#ffd23f" } : {}) };
    const { timeline, clips: made } = captionClips(cues, { fps, canvas: worldCanvas(), style, makeId: uuidv4, offsetFrames, auto: true });
    useClipStore.getState().addTimeline(timeline, -1);
    for (const c of made) useClipStore.getState().addClip(c);
    const language2 = LANGUAGES.find((l) => l.code === answer.value.language)?.label ?? answer.value.language;
    store.setState({ message: `Added ${made.length} caption${made.length === 1 ? "" : "s"} (${language2}).` });
    return made.length;
  } finally {
    store.setState({ phase: "idle", progress: 0 });
  }
}

/** The clip menu's Generate captions row (a video or audio clip with sound), as CapCut's video clip menu has it. */
export const captionMenuItems = (clip: AnyClipProps | undefined, selected: number): ContextMenuItem[] => {
  if (selected > 1 || !listenable(clip)) return [];
  return [{ id: "generate-captions", label: "Generate captions", action: "generateCaptions", disabled: useAutoCaptions.getState().phase !== "idle" }];
};

/** The clip menu's Generate captions: the panel opens with the clip selected. */
export const runGenerateCaptions = (clipId: string) => {
  useControlsStore.getState().setSelectedClipIds([clipId]);
  openAutoCaptions("captions");
};
