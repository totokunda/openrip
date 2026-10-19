// The Audio tools as the editor uses them: the inspector's Audio tab, the timeline's beat
// markers, menu and toolbar, and the left panel's Audio tab. They ask the engine through the
// preload (its loudness meter, its beat finder) and put the pure helpers' patches
// (lib/audio.ts, lib/audio-effects.ts, lib/beats.ts) through the clip store's `updateClip`, so a
// store's clip is never written to in place and each action is one undo step.
import { create } from "zustand";
import { toast } from "sonner";
import { engineBeats, engineLoudness } from "@app/preload";
import type { AnyClipProps, Asset, AssetCredit, AudioClipProps } from "./types";
import type { ContextMenuItem } from "./context-menu";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { getMediaInfoCached } from "./media/utils";
import { beginStep } from "./history";
import { consistentVolumeOffPatches, consistentVolumeOn, consistentVolumePatches, loudnessOff, normalizeLoudness, placeVoiceover, playedRange, reduceNoiseOn, setReduceNoise, targetLoudness, type ClipMeasure } from "./audio.ts";
import { beatSnapPoints, beatsOfFile, canHaveBeats, clearBeats, knownBeatsOfFile, setAutoBeats, toggleBeatAtPlayhead, type BeatGrid } from "./beats.ts";

/** The file under an asset's path: the halves a detach made (`…#video`, `…#audio`) are the file itself. */
export const fileOf = (path: string | undefined): string => (path ?? "").replace(/#(audio|video)$/, "");

/** The clip's asset (videos and audio clips have one). */
export const assetOfClip = (clip: AnyClipProps | undefined): Asset | undefined => {
  const id = (clip as AudioClipProps | undefined)?.assetId;
  return id ? useClipStore.getState().assets[id] : undefined;
};

/** The length of the clip's media, seconds (for a reversed clip's trims); undefined until known. */
export const mediaSecondsOf = (clip: AnyClipProps | undefined): number | undefined => {
  const asset = assetOfClip(clip);
  if (!asset) return undefined;
  const d = asset.duration || getMediaInfoCached(asset.path)?.duration;
  return d && Number.isFinite(d) ? d : undefined;
};

const fps = () => useControlsStore.getState().fps || 30;

/** A video whose sound was detached to an audio clip (CapCut's "Audio is separated"). */
export const soundSeparated = (clip: AnyClipProps | undefined): boolean => clip?.type === "video" && !!assetOfClip(clip)?.path.endsWith("#video");

// ---- beats ------------------------------------------------------------------------------------

/** Whether the clip's automatic beats are the engine's (Auto beat on, no draft's own beats). */
const wantsEngineBeats = (clip: AnyClipProps) => {
  const b = (clip as AudioClipProps).beats;
  return !!b?.auto && !b.detected?.length;
};

/** The engine's beats for the clip's file, asked once per file (null without sound or engine). */
export const fetchBeatGrid = (clip: AnyClipProps): Promise<BeatGrid | null> => {
  const path = fileOf(assetOfClip(clip)?.path);
  return path ? beatsOfFile(path, engineBeats) : Promise.resolve(null);
};

/** The engine's beats for the clip's file if they've come back (the beat markers ask for them). */
export const knownBeatGrid = (clip: AnyClipProps): BeatGrid | null | undefined => {
  const path = fileOf(assetOfClip(clip)?.path);
  return path ? knownBeatsOfFile(path) : undefined;
};

/**
 * The beat markers of the project's clips as snap points (frames), for `snapPoints`' `beats`:
 * every clip's but those in `exclude` (the clips being moved, whose markers move with them).
 */
export const projectBeatPoints = (clips: AnyClipProps[], exclude: Set<string> = new Set()): number[] =>
  beatSnapPoints(clips, fps(), (c) => (wantsEngineBeats(c) ? knownBeatGrid(c) : null), mediaSecondsOf, exclude);

/** CapCut's Auto beat: off, Beat 1 (bar starts) or Beat 2 (every beat). */
export type AutoBeat = "off" | "beat1" | "beat2";

export const autoBeatOf = (clip: AnyClipProps | undefined): AutoBeat => {
  const b = (clip as AudioClipProps | undefined)?.beats;
  return !b?.auto ? "off" : b.everyBeat ? "beat2" : "beat1";
};

/** Auto beat on the clip; turning it on asks the engine for the file's beats if it hasn't yet. */
export const setAutoBeat = (clipId: string, mode: AutoBeat) => {
  const clip = useClipStore.getState().getClipById(clipId);
  if (!clip || !canHaveBeats(clip)) return;
  useClipStore.getState().updateClip(clipId, setAutoBeats(clip, mode !== "off", mode === "beat2"));
  if (mode !== "off") void fetchBeatGrid(clip);
};

/** Mark beat at the playhead on the clip, or take off the one marked there. */
export const toggleBeatInStore = (clipId: string) => {
  const s = useClipStore.getState();
  const clip = s.getClipById(clipId);
  if (!clip) return;
  const patch = toggleBeatAtPlayhead(clip, useControlsStore.getState().focusFrame, fps(), mediaSecondsOf(clip));
  if (Object.keys(patch).length) s.updateClip(clipId, patch);
};

/** CapCut's Clear beats on the clip. */
export const clearBeatsInStore = (clipId: string) => {
  const clip = useClipStore.getState().getClipById(clipId);
  if (clip && canHaveBeats(clip)) useClipStore.getState().updateClip(clipId, clearBeats(clip));
};

/** The clip with sound the beat tools work on: the last selected one. */
export const selectedSoundClip = (): AnyClipProps | undefined => {
  const ids = useControlsStore.getState().selectedClipIds;
  const clip = useClipStore.getState().getClipById(ids[ids.length - 1]);
  return clip && canHaveBeats(clip) && !soundSeparated(clip) ? clip : undefined;
};

// ---- loudness ---------------------------------------------------------------------------------

/**
 * Normalize loudness on or off for the clip. On, the engine measures the range it plays first
 * (CapCut measures it the same way); the clip's state is read again after, so an edit made
 * meanwhile isn't undone.
 */
export const setNormalize = async (clipId: string, on: boolean): Promise<void> => {
  const clip = useClipStore.getState().getClipById(clipId);
  if (!clip) return;
  if (!on) {
    useClipStore.getState().updateClip(clipId, loudnessOff(clip));
    return;
  }
  const path = fileOf(assetOfClip(clip)?.path);
  if (!path) return;
  const patch = await normalizeLoudness(clip, path, fps(), engineLoudness, mediaSecondsOf(clip));
  if (useClipStore.getState().getClipById(clipId)) useClipStore.getState().updateClip(clipId, patch);
};

// ---- reduce noise -----------------------------------------------------------------------------

/** Reduce noise on or off for the clip: the engine reads the clip's noise itself, so it's one patch. */
export const setReduceNoiseInStore = (clipId: string, on: boolean) => {
  const clip = useClipStore.getState().getClipById(clipId);
  if (!clip) return;
  const patch = setReduceNoise(clip, on);
  if (Object.keys(patch).length) useClipStore.getState().updateClip(clipId, patch);
};

// ---- make volume consistent -------------------------------------------------------------------

/** Make volume consistent while it measures: how many clips are done of how many (null when idle). */
export const useVolumeStore = create<{ running: { done: number; total: number } | null }>(() => ({ running: null }));

/** The project's clips with sound Make volume consistent works on: videos with their sound, and audio clips. */
export const soundClips = (clips: AnyClipProps[]): AnyClipProps[] => clips.filter((c) => canHaveBeats(c) && !soundSeparated(c) && !!fileOf(assetOfClip(c)?.path));

/** Whether Make volume consistent is on. */
export const volumeConsistentOn = (clips: AnyClipProps[]): boolean => consistentVolumeOn(clips);

/**
 * Make volume consistent on: the engine's meter reads each clip's played range (as Normalize
 * loudness does), and every clip with sound is turned to one target (Settings › Target
 * loudness), the clips' own settings kept for turning it off, as one undo step. Does nothing
 * while it's measuring already.
 */
export const makeVolumeConsistent = async (): Promise<number> => {
  if (useVolumeStore.getState().running) return 0;
  const clips = soundClips(useClipStore.getState().clips);
  if (clips.length === 0) return 0;
  useVolumeStore.setState({ running: { done: 0, total: clips.length } });
  try {
    const measures: Record<string, ClipMeasure> = {};
    const seen = new Map<string, Awaited<ReturnType<typeof engineLoudness>>>();
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const path = fileOf(assetOfClip(clip)?.path);
      const range = playedRange(clip, fps(), mediaSecondsOf(clip));
      const key = `${path}|${range[0].toFixed(3)}|${range[1].toFixed(3)}`;
      if (!seen.has(key)) seen.set(key, await engineLoudness(path, range[0], range[1]));
      const m = seen.get(key);
      if (m) measures[clip.clipId] = { integrated: m.integrated, peak: m.peak, range };
      useVolumeStore.setState({ running: { done: i + 1, total: clips.length } });
    }
    // The clips as they are now: an edit made meanwhile isn't undone.
    const now = useClipStore.getState();
    const patches = consistentVolumePatches(now.clips, measures, targetLoudness());
    if (patches.length === 0) {
      toast.message("Nothing to match: the clips are silent.");
      return 0;
    }
    beginStep();
    for (const [id, patch] of patches) useClipStore.getState().updateClip(id, patch);
    return patches.length;
  } finally {
    useVolumeStore.setState({ running: null });
  }
};

/** Make volume consistent off: each clip's own loudness setting given back, as one step. */
export const volumeConsistentOff = () => {
  const { clips, updateClip } = useClipStore.getState();
  const patches = consistentVolumeOffPatches(clips);
  if (patches.length === 0) return;
  beginStep();
  for (const [id, patch] of patches) updateClip(id, patch);
};

// ---- the clip's menu --------------------------------------------------------------------------

/**
 * The clip menu's audio items, as CapCut's: on an audio clip, Auto mark beats › (Beat 1,
 * Beat 2, Off, then Mark beat at the playhead and Clear beats), Normalize loudness and Reduce noise
 * (ticked while on); on a video with its sound, Enhance audio › Normalize loudness, Reduce noise. None for other clips
 * or a video whose sound was detached.
 */
export const soundMenuItems = (clip: AnyClipProps | undefined): ContextMenuItem[] => {
  if (!clip || !canHaveBeats(clip) || soundSeparated(clip)) return [];
  const id = clip.clipId;
  const on = !!(clip as AudioClipProps).loudness?.enabled;
  const normalize: ContextMenuItem = { id: "normalize", label: "Normalize loudness", action: "custom", checked: on, run: () => void setNormalize(id, !on) };
  const denoise = reduceNoiseOn(clip);
  const reduce: ContextMenuItem = { id: "reduce-noise", label: "Reduce noise", action: "custom", checked: denoise, run: () => setReduceNoiseInStore(id, !denoise) };
  if (clip.type === "video") return [{ id: "enhance-audio", label: "Enhance audio", action: "none", children: [normalize, reduce] }];
  const auto = autoBeatOf(clip);
  const frame = useControlsStore.getState().focusFrame;
  const onClip = frame >= (clip.startFrame ?? 0) && frame <= (clip.endFrame ?? 0);
  const beat = (mode: AutoBeat, label: string): ContextMenuItem => ({ id: `auto-${mode}`, label, action: "custom", checked: auto === mode, run: () => setAutoBeat(id, mode) });
  return [
    {
      id: "auto-beats",
      label: "Auto mark beats",
      action: "none",
      children: [
        beat("beat1", "Beat 1"),
        beat("beat2", "Beat 2"),
        beat("off", "Off"),
        { id: "mark-beat", label: "Mark beat at playhead", action: "custom", disabled: !onClip, run: () => toggleBeatInStore(id) },
        { id: "clear-beats", label: "Clear beats", action: "custom", run: () => clearBeatsInStore(id) },
      ],
    },
    normalize,
    reduce,
  ];
};

// ---- adding sound -----------------------------------------------------------------------------

/**
 * A sound from the left panel's Audio tab on a new audio track at the playhead, as CapCut adds a
 * library item: its file (`url`, e.g. a video's with `#audio` for its sound alone) and length.
 * Selects the new clip.
 */
export const addSoundAtPlayhead = (url: string, durationSec: number, credit?: AssetCredit): AudioClipProps => {
  const clip = placeVoiceover(useClipStore.getState(), { path: url, durationSec, credit }, url, useControlsStore.getState().focusFrame, fps());
  useControlsStore.getState().setSelectedClipIds([clip.clipId]);
  return clip;
};
