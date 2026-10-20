// Transcript: the words a clip says, from the local speech model, shown as text to edit the
// video by. Listening reuses Auto captions' pipeline (lib/autocaptions.ts: the model and its
// download, the progress, Cancel) and keeps the words with their times in the media on the
// asset (lib/types.ts `Transcript`), so every clip of the media maps them through its own trim
// and speed (lib/transcript-edit.ts) and a cut only has to move the words with the clip.
// Deleting words, Remove filler words and Remove pauses all come to spans of the timeline to
// cut: each is split out of the clip (and the clips linked to it) and removed, closing the
// main track up when its magnet is on, as one undo step. The panel is
// components/menus/TranscriptMenu.tsx.
import { create } from "zustand";
import { toast } from "sonner";
import type { SpeechAsk } from "@app/preload";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { beginStep } from "./history";
import { useSidebarStore } from "./sidebar";
import { isClipLocked } from "./timeline-edit";
import { beginSpeechRun, endSpeechRun, ensureModel, runSpeech, speechCancelled, useAutoCaptions } from "./autocaptions";
import { clipWords, mergeTranscript, missingRange, transcribable, wholeSpans, wordsOfCaptions, type ClipWord, type Span } from "./transcript-edit";
import type { AnyClipProps, Asset, Transcript, TranscriptWord } from "./types";
import type { ContextMenuItem } from "./context-menu";

/** What the panel works on and shows. */
type State = {
  /** The media and track the panel follows: its clips there, in time order, are the transcript. */
  target: { assetId: string; timelineId: string } | null;
  /** Remove filler words or Remove pauses, shown (struck through) before they are applied. */
  preview: "fillers" | "pauses" | null;
  /** Remove pauses: longer than this, seconds. */
  pauseSecs: number;
  /** What the last action did or why it didn't. */
  message: string | null;
  /** Bumped to open the panel on this. */
  tick: number;
};

export const useTranscript = create<State>(() => ({ target: null, preview: null, pauseSecs: 0.5, message: null, tick: 0 }));

/** The least a pause can be to be cut, seconds, and the quiet each cut leaves. */
export const KEEP_PAUSE_SECS = 0.2;

/** The asset whose sound a clip plays: its media, or a compound clip's mixed sound (lib/compound-actions.ts). */
export const soundAssetId = (clip: AnyClipProps | undefined): string => ((clip as { assetId?: string } | undefined)?.assetId || (clip as { mixAssetId?: string } | undefined)?.mixAssetId || "") as string;

/** A clip the transcript can follow: a video or audio clip with media (a compound with its sound mixed), played forwards at a steady speed. */
export const followable = (clip: AnyClipProps | undefined): boolean => transcribable(clip) && !!useClipStore.getState().getAssetById(soundAssetId(clip))?.path;

/** The clips the panel shows the words of: the target media's on its track, in time order. */
export const targetPieces = (clips: AnyClipProps[], target: State["target"]): AnyClipProps[] =>
  target
    ? clips
        .filter((c) => !c.hidden && c.timelineId === target.timelineId && soundAssetId(c) === target.assetId && transcribable(c))
        .sort((a, b) => (a.startFrame ?? 0) - (b.startFrame ?? 0))
    : [];

/** The words of all the pieces on the timeline, in order. */
export const wordsOf = (pieces: AnyClipProps[], transcript: Transcript | undefined, fps: number): ClipWord[] => pieces.flatMap((c) => clipWords(transcript, c, fps));

/** Follow `clip` (its media on its track). */
export const followClip = (clip: AnyClipProps | undefined) => {
  if (!followable(clip)) return;
  const target = { assetId: soundAssetId(clip), timelineId: clip!.timelineId! };
  const now = useTranscript.getState().target;
  if (now?.assetId !== target.assetId || now.timelineId !== target.timelineId) useTranscript.setState({ target, preview: null, message: null });
};

/** Keep what the model heard in `range` of the asset (replacing what it had heard there). */
export function rememberTranscript(assetId: string, words: TranscriptWord[], range: [number, number], language: string, model: string) {
  const store = useClipStore.getState();
  const asset = store.getAssetById(assetId);
  if (!asset) return;
  store.updateAsset(assetId, { transcript: mergeTranscript(asset.transcript, words, range, language, model) } as Partial<Asset>);
}

/** Show the Transcript panel for `clipId` (selected). */
export function openTranscript(clipId: string) {
  const clip = useClipStore.getState().getClipById(clipId);
  useControlsStore.getState().setSelectedClipIds([clipId]);
  followClip(clip);
  useTranscript.setState((s) => ({ tick: s.tick + 1 }));
  useSidebarStore.getState().openSection("captions");
}

/**
 * Listen to what the target's clips play that the transcript hasn't heard (all of it the
 * first time, only the stretch a trim has since brought in after that), downloading the model
 * if it is needed. Resolves to the number of words heard, or null if it stopped.
 */
export async function transcribe(): Promise<number | null> {
  const t = useTranscript.getState().target;
  const { clips, getAssetById } = useClipStore.getState();
  const asset = t ? getAssetById(t.assetId) : undefined;
  const pieces = targetPieces(clips, t);
  if (!asset?.path || pieces.length === 0) return null;
  const fps = useControlsStore.getState().fps || 30;
  const gaps = pieces.map((c) => missingRange(asset.transcript, c, fps)).filter((r): r is [number, number] => !!r);
  if (gaps.length === 0) return 0;
  const range: [number, number] = [Math.min(...gaps.map((r) => r[0])), Math.max(...gaps.map((r) => r[1]))];
  if (!beginSpeechRun()) return null;
  useTranscript.setState({ message: null });
  try {
    const modelId = await ensureModel();
    if (!modelId) return null;
    useAutoCaptions.setState({ phase: "working", progress: 0 });
    const ask: SpeechAsk = {
      modelId,
      language: useAutoCaptions.getState().language === "auto" ? null : useAutoCaptions.getState().language,
      audioPath: asset.path,
      startSec: range[0],
      durationSec: range[1] - range[0],
      removeFillers: false,
      highlightKeywords: false,
    };
    const answer = await runSpeech(ask);
    if (!answer.ok) {
      if (!answer.cancelled) useTranscript.setState({ message: `Couldn't transcribe: ${answer.error ?? "unknown error"}` });
      return null;
    }
    if (speechCancelled()) return null;
    const words = wordsOfCaptions(answer.value.captions, range[0]);
    rememberTranscript(asset.id, words, range, answer.value.language, modelId);
    if (words.length === 0) {
      useTranscript.setState({ message: "No speech found." });
      toast("No speech found");
    }
    return words.length;
  } finally {
    endSpeechRun();
  }
}

/**
 * Cut `spans` out of the timeline as one undo step: each is split out of its clip (the clips
 * linked to it are cut there too) and removed, which closes the main track up behind it when
 * the magnet is on. Latest first, so the frames of the ones still to cut stay where they
 * were. Resolves to how many were cut; a locked track's clips are left alone.
 */
export function cutSpans(spans: Span[]): number {
  const store = useClipStore.getState();
  const t = useTranscript.getState().target;
  if (!t) return 0;
  const whole = wholeSpans(spans, store.clips);
  if (whole.length === 0) return 0;
  const piece = (frame: number) =>
    useClipStore
      .getState()
      .clips.find((c) => !c.hidden && c.timelineId === t.timelineId && soundAssetId(c) === t.assetId && (c.startFrame ?? 0) <= frame && frame < (c.endFrame ?? 0));
  const first = piece(whole[0].from);
  if (first && isClipLocked(store.clips, store.timelines, first, useControlsStore.getState().linkage)) {
    useTranscript.setState({ message: "The track is locked." });
    return 0;
  }
  beginStep();
  let cut = 0;
  for (const s of [...whole].reverse()) {
    let c = piece(s.to - 1);
    if (!c) continue;
    if (s.to < (c.endFrame ?? 0)) useClipStore.getState().splitClip(s.to, c.clipId);
    c = piece(s.from);
    if (!c) continue;
    if (s.from > (c.startFrame ?? 0)) useClipStore.getState().splitClip(s.from, c.clipId);
    const middle = piece(s.from);
    if (!middle || middle.startFrame !== s.from || middle.endFrame !== s.to) continue;
    useClipStore.getState().removeClip(middle.clipId);
    cut++;
  }
  const now = useClipStore.getState();
  const left = targetPieces(now.clips, t);
  useControlsStore.getState().setSelectedClipIds(left.length ? [left[0].clipId] : []);
  useTranscript.setState({ preview: null, message: cut ? null : "Nothing was cut." });
  return cut;
}

/** The clip menu's and the media card's Transcript row. */
export const transcriptMenuItems = (clip: AnyClipProps | undefined, selected: number): ContextMenuItem[] => {
  if (selected > 1 || !followable(clip)) return [];
  return [{ id: "transcript", label: "Transcript", action: "custom", run: () => openTranscript(clip!.clipId) }];
};

/** The media card's Transcript: opens the panel on the media's first clip on the timeline. */
export function openTranscriptForPath(path: string): boolean {
  const { clips, getAssetByPath } = useClipStore.getState();
  const asset = getAssetByPath(path);
  const clip = asset && clips.filter((c) => !c.hidden && soundAssetId(c) === asset.id && transcribable(c)).sort((a, b) => (a.startFrame ?? 0) - (b.startFrame ?? 0))[0];
  if (!clip) {
    toast("Add the media to the timeline to transcribe it");
    return false;
  }
  openTranscript(clip.clipId);
  return true;
}
