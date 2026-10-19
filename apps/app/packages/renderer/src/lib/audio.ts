// The Audio tab's Basic section on a video or audio clip (lib/types.ts `ClipAudio`), and the
// voiceover's clip: pure helpers returning patches for `updateClip`, and the store calls a
// finished recording needs.
//
// - Normalize loudness, as CapCut's: the clip is turned to −23 LUFS from its EBU R128 loudness
//   over the media range it plays, measured with the engine's meter (CapCut's way of blocking
//   the clip; engine/crates/audio/src/loudness.rs, docs/parity/loudness.md). The measurement is
//   kept on the clip, as CapCut keeps it; a trim makes it stale (`loudnessStale`) and the panel
//   measures again.
// - Reduce noise: the engine's spectral-gating denoiser on or off for the clip (`denoise`).
// - Make volume consistent (the project inspector's Global edits): every clip's loudness measured
//   the same way and Normalize loudness set on all to one target, as one step; the clip's own
//   setting is kept under `loudness.consistent.was` to give back when it's turned off.
// - Fill channel: one side on both, or (OpenRip's own) both mixed to mono.
// - Voiceover: the recording the main process made (preload `voiceoverStop`) as an asset and an
//   audio clip on a new track at the playhead, as CapCut puts a voiceover.
import type { AnyClipProps, Asset, AssetCredit, AudioClipProps, ChannelFill, ClipAudio, ClipLoudness, TimelineProps, VideoClipProps } from "./types";
import { preferences } from "./preferences.ts";

/** CapCut's loudness target, LUFS. */
export const LOUDNESS_TARGET = -23;

/** The target Normalize loudness turns a clip to: Settings › Edit › Target loudness (−23, −14 or −12 LUFS). */
export const targetLoudness = (): number => {
  const v = Number(preferences().targetLoudness);
  return Number.isFinite(v) && v < 0 ? v : LOUDNESS_TARGET;
};

/** The engine's meter for a file's range (preload `engineLoudness`): LUFS (null for silence) and the peak, dBFS. */
export type MeasureLoudness = (path: string, startSec: number, durationSec: number | null) => Promise<{ integrated: number | null; peak: number } | null>;

const hasSound = (clip: AnyClipProps) => clip.type === "video" || clip.type === "audio";
const speedOf = (clip: AnyClipProps) => Math.max(0.1, Number((clip as VideoClipProps).speed || 1));
const lengthOf = (clip: AnyClipProps) => Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));

/**
 * The media range the clip plays, `[start, duration]` in seconds (`mediaSeconds`: the media's
 * length, for a reversed clip, whose trims count from the end).
 */
export const playedRange = (clip: AnyClipProps, fps: number, mediaSeconds?: number): [number, number] => {
  const speed = speedOf(clip);
  const from = (Number(clip.trimStart ?? 0) * speed) / fps;
  const span = (lengthOf(clip) * speed) / fps;
  const start = (clip as VideoClipProps).reverse && mediaSeconds != null ? Math.max(0, mediaSeconds - from - span) : from;
  return [start, span];
};

/**
 * Normalize loudness on: measures the clip's range of `path` with `measure` and returns the
 * patch (the measurement kept on the clip). A silent range measures nothing and changes nothing.
 */
export const normalizeLoudness = async (clip: AnyClipProps, path: string, fps: number, measure: MeasureLoudness, mediaSeconds?: number): Promise<Partial<AnyClipProps>> => {
  if (!hasSound(clip)) return {};
  const range = playedRange(clip, fps, mediaSeconds);
  const m = await measure(path, range[0], range[1]);
  const loudness: ClipLoudness = { enabled: true, target: targetLoudness(), measured: m?.integrated ?? null, peak: m?.peak ?? null, range };
  return { loudness } as Partial<AnyClipProps>;
};

/** Normalize loudness off (the measurement kept, as CapCut keeps it, for turning it back on). */
export const loudnessOff = (clip: AnyClipProps): Partial<AnyClipProps> => {
  const now = (clip as VideoClipProps).loudness;
  return hasSound(clip) && now ? ({ loudness: { ...now, enabled: false } } as Partial<AnyClipProps>) : {};
};

/** Whether the clip's measurement is for another range than it plays now (by more than a frame). */
export const loudnessStale = (clip: AnyClipProps, fps: number, mediaSeconds?: number): boolean => {
  const l = (clip as VideoClipProps).loudness;
  if (!l?.enabled) return false;
  if (!l.range) return true;
  const [s, d] = playedRange(clip, fps, mediaSeconds);
  return Math.abs(s - l.range[0]) > 1 / fps || Math.abs(d - l.range[1]) > 1 / fps;
};

/**
 * The gain normalising applies, dB (as the engine applies it: to the target, held back so the
 * peak stays under full scale); 0 when it's off or unmeasured.
 */
export const loudnessGain = (clip: AnyClipProps): number => {
  const l = (clip as VideoClipProps).loudness;
  if (!l?.enabled || l.measured == null || !Number.isFinite(l.measured) || l.measured <= -70) return 0;
  return Math.min(l.target - l.measured, -Math.min(l.peak ?? 0, 0));
};

/** Whether Reduce noise is on for the clip. */
export const reduceNoiseOn = (clip: AnyClipProps | undefined): boolean => !!clip && hasSound(clip) && !!(clip as ClipAudio).denoise?.enabled;

/** A patch turning the clip's Reduce noise on or off (its strength, if set, kept). */
export const setReduceNoise = (clip: AnyClipProps, on: boolean): Partial<AnyClipProps> => {
  if (!hasSound(clip)) return {};
  const now = (clip as ClipAudio).denoise;
  return on || now ? ({ denoise: { ...now, enabled: on } } as Partial<AnyClipProps>) : {};
};

/** What the engine's meter read over a clip's played range (the range as `playedRange`). */
export type ClipMeasure = { integrated: number | null; peak: number; range: [number, number] };

/** How far under the preferred target Make volume consistent may go to keep a peaky clip's peak under full scale, dB. */
export const CONSISTENT_HEADROOM = 6;

/** Whether Make volume consistent is on: a clip carries a setting it made. */
export const consistentVolumeOn = (clips: AnyClipProps[]): boolean => clips.some((c) => hasSound(c) && !!(c as ClipAudio).loudness?.consistent);

/**
 * The one loudness Make volume consistent turns every measured clip to: the preferred target,
 * or lower (by at most `CONSISTENT_HEADROOM`) where the engine's gain would otherwise stop a
 * peaky clip short of it, so the clips still land together. Null if nothing was measured.
 */
export const consistentTarget = (measures: Record<string, ClipMeasure>, preferred: number): number | null => {
  const reads = Object.values(measures).filter((m) => m.integrated != null && Number.isFinite(m.integrated) && m.integrated > -70);
  if (reads.length === 0) return null;
  const reach = Math.min(...reads.map((m) => m.integrated! - Math.min(m.peak ?? 0, 0)));
  return Math.max(preferred - CONSISTENT_HEADROOM, Math.min(preferred, reach));
};

/**
 * Make volume consistent: `[clipId, patch]` for each clip measured (`measures` by clip id; a
 * clip without sound there is left out), all turned to one target. The clip's own loudness
 * setting is kept to give back (a second run keeps the first's).
 */
export const consistentVolumePatches = (clips: AnyClipProps[], measures: Record<string, ClipMeasure>, preferred: number): [string, Partial<AnyClipProps>][] => {
  const target = consistentTarget(measures, preferred);
  if (target == null) return [];
  const out: [string, Partial<AnyClipProps>][] = [];
  for (const clip of clips) {
    const m = measures[clip.clipId];
    if (!hasSound(clip) || !m || m.integrated == null || !(m.integrated > -70)) continue;
    const now = (clip as ClipAudio).loudness ?? null;
    const was = now?.consistent ? now.consistent.was : now;
    const loudness: ClipLoudness = { enabled: true, target, measured: m.integrated, peak: m.peak, range: m.range, consistent: { was } };
    out.push([clip.clipId, { loudness } as Partial<AnyClipProps>]);
  }
  return out;
};

/** Make volume consistent off: each clip's own loudness setting given back. */
export const consistentVolumeOffPatches = (clips: AnyClipProps[]): [string, Partial<AnyClipProps>][] =>
  clips.filter((c) => hasSound(c) && (c as ClipAudio).loudness?.consistent).map((c) => [c.clipId, { loudness: (c as ClipAudio).loudness!.consistent!.was } as Partial<AnyClipProps>]);

/** Fill channel's menu, CapCut's names first. */
export const CHANNEL_FILLS: { id: ChannelFill; name: string }[] = [
  { id: "none", name: "None" },
  { id: "left", name: "Fill right with left" },
  { id: "right", name: "Fill left with right" },
  { id: "mono", name: "Mono" },
];

/** A patch setting the clip's channel fill. */
export const setChannelFill = (clip: AnyClipProps, fill: ChannelFill): Partial<AnyClipProps> => (hasSound(clip) ? ({ channel: fill } as Partial<AnyClipProps>) : {});

/** A finished voiceover (preload `voiceoverStop`): the file and its length. */
export type Voiceover = { path: string; durationSec: number; /** A library track's credit, kept on its asset. */ credit?: AssetCredit };

/** A voiceover's audio clip: on `timelineId` from frame `startFrame`, as long as the recording. */
export const voiceoverClip = (v: Voiceover, assetId: string, timelineId: string, startFrame: number, fps: number, clipId: string): AudioClipProps => ({
  clipId,
  timelineId,
  type: "audio",
  assetId,
  startFrame,
  endFrame: startFrame + Math.max(1, Math.round(v.durationSec * fps)),
  trimStart: 0,
  trimEnd: 0,
  speed: 1,
});

/** The clip store's calls `placeVoiceover` needs (lib/clip.ts). */
export type VoiceoverStore = {
  addAsset: (asset: Partial<Asset> | string) => Asset;
  addTimeline: (timeline: Partial<TimelineProps>, index?: number) => void;
  addClip: (clip: AnyClipProps) => void;
};

/**
 * Put a finished voiceover on the timeline: its file as an asset (`url`: the path as the app's
 * assets name files, e.g. a file:// URL) and an audio clip on a new audio track at the bottom,
 * from timeline frame `frame`. Returns the clip.
 */
export const placeVoiceover = (store: VoiceoverStore, v: Voiceover, url: string, frame: number, fps: number, newId: () => string = () => crypto.randomUUID()): AudioClipProps => {
  const asset = store.addAsset({ path: url, type: "audio", duration: v.durationSec, ...(v.credit ? { credit: v.credit } : {}) });
  const timelineId = newId();
  store.addTimeline({ timelineId, type: "audio", timelineHeight: 54 });
  const clip = voiceoverClip(v, asset.id, timelineId, Math.max(0, Math.round(frame)), fps, newId());
  store.addClip(clip);
  return clip;
};
