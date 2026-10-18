// The Adjust tab's one-click colour tools and Split scenes, as pure helpers over the engine's
// answers (engine/crates/analysis; docs/plan/capcut-ui-spec.md §6.31). Each returns a patch for
// `updateClip` or plain values; lib/analysis.ts asks the engine and applies them.
//
// - Auto adjust: the engine solves the Basic sliders from the clip's own statistics. Their
//   values go into `adjust`, where the panel shows them and the user can change them; `auto`
//   keeps what was added, so the intensity rescales it and turning it off takes off only that,
//   leaving the user's own changes.
// - Color match: the clip's and a reference clip's Oklab statistics; the engine makes the table
//   that moves one to the other (Reinhard's transfer), drawn before the clip's LUT.
// - Make colors consistent: every main-track clip matched to one reference, as one edit.
// - Split scenes: the engine's cut times (media) as the timeline frames to split the clip at.
import type { AdjustSlider, AnyClipProps, ClipAutoAdjust, ClipColor, ClipColorMatch, ColorMoments, ImageClipProps, TimelineProps, VideoClipProps } from "./types";
import { ADJUST_SLIDERS, colorOf } from "./color.ts";
import { playedRange } from "./audio.ts";
import { frameOfMediaTime } from "./beats.ts";
import { mainTrackOf } from "./timeline-edit.ts";

/** The sliders Auto adjust sets, in the panel's order. */
export const AUTO_SLIDERS: AdjustSlider[] = ["temperature", "tint", "saturation", "brightness", "contrast", "whites", "blacks"];

/** What the engine's Auto adjust answers (preload `engineAutoAdjust`): the panel's values. */
export type AutoValues = Partial<Record<AdjustSlider, number>>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const range = (key: AdjustSlider) => ADJUST_SLIDERS.find((s) => s.key === key)!;
const withColor = (_clip: AnyClipProps, color: ClipColor): Partial<AnyClipProps> => ({ color } as Partial<AnyClipProps>);

/** Whether the clip's colour tools apply (a video or a photo). */
export const hasColorTools = (clip: AnyClipProps | undefined): clip is VideoClipProps | ImageClipProps => clip?.type === "video" || clip?.type === "image";

/** The media range (seconds: start, duration) the engine should read for the clip. */
export const analysisRange = (clip: AnyClipProps, fps: number, mediaSeconds?: number): [number, number] => {
  const freeze = (clip as VideoClipProps).freeze;
  if (freeze) return [freeze.at, 1 / Math.max(1, fps)];
  if (clip.type === "image") return [0, 0];
  return playedRange(clip, fps, mediaSeconds);
};

/** The clip's `adjust` without what Auto adjust added. */
const withoutAuto = (c: ClipColor): Partial<Record<AdjustSlider, number>> => {
  const adjust = { ...(c.adjust ?? {}) };
  for (const [k, v] of Object.entries(c.auto?.applied ?? {}) as [AdjustSlider, number][]) {
    const left = (adjust[k] ?? 0) - v;
    if (left === 0) delete adjust[k];
    else adjust[k] = left;
  }
  return adjust;
};

/**
 * Auto adjust on: `values` (the engine's, at full intensity) at `intensity` (0–100) added to the
 * clip's own slider values, replacing an earlier Auto adjust's. Each slider is kept in its range.
 */
export const applyAutoAdjust = (clip: AnyClipProps, values: AutoValues, intensity = 100, readRange?: [number, number]): Partial<AnyClipProps> => {
  if (!hasColorTools(clip)) return {};
  const c = colorOf(clip);
  const k = clamp(intensity, 0, 100) / 100;
  const adjust = withoutAuto(c);
  const applied: Partial<Record<AdjustSlider, number>> = {};
  for (const key of AUTO_SLIDERS) {
    const add = Math.round((values[key] ?? 0) * k);
    if (!add) continue;
    const { min, max } = range(key);
    const before = adjust[key] ?? 0;
    const after = clamp(before + add, min, max);
    if (after === before) continue;
    applied[key] = after - before;
    if (after === 0) delete adjust[key];
    else adjust[key] = after;
  }
  const auto: ClipAutoAdjust = { intensity: clamp(Math.round(intensity), 0, 100), values: { ...values }, applied, ...(readRange ? { range: readRange } : {}) };
  return withColor(clip, { ...c, adjust, auto });
};

/** Auto adjust's intensity changed (its values rescaled; the user's own changes kept). */
export const setAutoIntensity = (clip: AnyClipProps, intensity: number): Partial<AnyClipProps> => {
  const auto = colorOf(clip).auto;
  return auto ? applyAutoAdjust(clip, auto.values, intensity, auto.range) : {};
};

/** Auto adjust off: what it added taken off the sliders. */
export const removeAutoAdjust = (clip: AnyClipProps): Partial<AnyClipProps> => {
  if (!hasColorTools(clip)) return {};
  const c = colorOf(clip);
  if (!c.auto) return {};
  return withColor(clip, { ...c, adjust: withoutAuto(c), auto: null });
};

export const autoAdjustOf = (clip: AnyClipProps | undefined): ClipAutoAdjust | null => (clip && hasColorTools(clip) ? colorOf(clip).auto ?? null : null);

/** The engine's statistics answer as the moments a match keeps. */
export const momentsOf = (stats: { mean: number[]; std: number[] }): ColorMoments => ({
  mean: [stats.mean[0] ?? 0, stats.mean[1] ?? 0, stats.mean[2] ?? 0],
  std: [stats.std[0] ?? 0, stats.std[1] ?? 0, stats.std[2] ?? 0],
});

/** Color match on: the clip's colours moved to the reference's, at `intensity` (0–100). */
export const applyColorMatch = (
  clip: AnyClipProps,
  source: ColorMoments,
  reference: ColorMoments,
  ref: { clipId: string; name?: string },
  intensity = 100,
  consistent = false,
): Partial<AnyClipProps> => {
  if (!hasColorTools(clip)) return {};
  const match: ClipColorMatch = { intensity: clamp(Math.round(intensity), 0, 100), source, reference, ref, ...(consistent ? { consistent: true } : {}) };
  return withColor(clip, { ...colorOf(clip), match });
};

export const setMatchIntensity = (clip: AnyClipProps, intensity: number): Partial<AnyClipProps> => {
  const m = colorOf(clip).match;
  return m ? withColor(clip, { ...colorOf(clip), match: { ...m, intensity: clamp(Math.round(intensity), 0, 100) } }) : {};
};

export const removeColorMatch = (clip: AnyClipProps): Partial<AnyClipProps> => {
  const c = colorOf(clip);
  return hasColorTools(clip) && c.match ? withColor(clip, { ...c, match: null }) : {};
};

export const colorMatchOf = (clip: AnyClipProps | undefined): ClipColorMatch | null => (clip && hasColorTools(clip) ? colorOf(clip).match ?? null : null);

/** The clip's match as the engine's Auto adjust takes it (so it solves through it), or null. */
export const matchForEngine = (clip: AnyClipProps) => {
  const m = colorMatchOf(clip);
  return m ? { sourceMean: m.source.mean, sourceStd: m.source.std, referenceMean: m.reference.mean, referenceStd: m.reference.std, intensity: m.intensity / 100 } : null;
};

/** The clips Make colors consistent matches: the main track's videos and photos. */
export const mainTrackClips = (clips: AnyClipProps[], timelines: TimelineProps[]): (VideoClipProps | ImageClipProps)[] => {
  const main = mainTrackOf(timelines);
  return clips
    .filter((c): c is VideoClipProps | ImageClipProps => c.timelineId === main?.timelineId && hasColorTools(c) && !c.hidden)
    .sort((a, b) => (a.startFrame ?? 0) - (b.startFrame ?? 0));
};

/** The reference Make colors consistent starts from: the main-track clip at `frame`, else the first. */
export const consistentReference = (clips: AnyClipProps[], timelines: TimelineProps[], frame: number) => {
  const main = mainTrackClips(clips, timelines);
  return main.find((c) => frame >= (c.startFrame ?? 0) && frame < (c.endFrame ?? 0)) ?? main[0];
};

/** Whether Make colors consistent is on: a main-track clip carries a match it made. */
export const consistentOn = (clips: AnyClipProps[], timelines: TimelineProps[]) => mainTrackClips(clips, timelines).some((c) => !!colorOf(c).match?.consistent);

/** The reference Make colors consistent used, if it's on. */
export const consistentReferenceId = (clips: AnyClipProps[], timelines: TimelineProps[]) =>
  mainTrackClips(clips, timelines).map((c) => colorOf(c).match).find((m) => m?.consistent)?.ref.clipId ?? null;

/**
 * Make colors consistent: `[clipId, patch]` matching every main-track clip but the reference to
 * it (`stats` the engine's statistics by clip id; a clip without them is left out).
 */
export const consistentPatches = (
  clips: AnyClipProps[],
  timelines: TimelineProps[],
  referenceId: string,
  stats: Record<string, ColorMoments>,
  referenceName?: string,
): [string, Partial<AnyClipProps>][] => {
  const reference = stats[referenceId];
  if (!reference) return [];
  return mainTrackClips(clips, timelines)
    .filter((c) => c.clipId !== referenceId && stats[c.clipId])
    .map((c) => [c.clipId, applyColorMatch(c, stats[c.clipId], reference, { clipId: referenceId, name: referenceName }, 100, true)]);
};

/** Make colors consistent off: the matches it made taken off. */
export const consistentOffPatches = (clips: AnyClipProps[], timelines: TimelineProps[]): [string, Partial<AnyClipProps>][] =>
  mainTrackClips(clips, timelines)
    .filter((c) => colorOf(c).match?.consistent)
    .map((c) => [c.clipId, removeColorMatch(c)]);

/**
 * Split scenes: the timeline frames to split `clip` at for cuts at media times `timesUs` (each
 * the new shot's first frame), inside the clip, ascending, each at most once. A cut shows from
 * the first frame that plays its media.
 */
export const sceneCutFrames = (clip: AnyClipProps, timesUs: number[], fps: number, mediaSeconds?: number): number[] => {
  const start = clip.startFrame ?? 0;
  const end = clip.endFrame ?? 0;
  const out = new Set<number>();
  for (const t of timesUs) {
    const f = frameOfMediaTime(clip, t / 1e6, fps, mediaSeconds);
    if (f == null) continue;
    const frame = (clip as VideoClipProps).reverse ? Math.floor(f + 1e-6) : Math.ceil(f - 1e-6);
    if (frame > start && frame < end) out.add(frame);
  }
  return [...out].sort((a, b) => a - b);
};
