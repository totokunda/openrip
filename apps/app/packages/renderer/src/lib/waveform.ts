// The timeline's audio waveforms as CapCut draws them (docs/plan/capcut-ui-spec.md §2.3, §4.11),
// measured on 03-editor-overview/003 (an audio clip extracted from IMG_9079) and
// 18-inspector-video/001 (the same video with its sound, in its bottom band):
// - bars 1 px wide every 2 px (on a Retina screen 2 device px on, 2 off), the first 1.5 px into
//   the clip, rising from the bottom edge, drawn to half a pixel;
// - each bar the RMS of 2 px of sound, on a dB scale: full × (1 + dB / 52) px with dB the RMS of
//   the engine's mono mix, full 30.5 px on an audio clip and 13.5 px in a video's 16 px band, the
//   audio clip's bars 2 px after their sound and the band's on it. Fitted to CapCut's own bars
//   from the engine's buckets for the same file: correlation 0.98 and 0.8 px off on average over
//   the audio clip's 212 bars, 0.976 and 0.3 px over the band's;
// - the volume line across at 13 px (6.5 in the band) for 0 dB, moving with the volume;
// - the clip's gain on top: its volume (and its keys) and its fades, in dB, on bars and line.
// The sound is read from the engine's buckets (`engineWaveform`, decoded once and cached) through
// the clip's trim, speed, curve and direction, so the bars stay on the sound through any edit.
// Pure: the timeline's Konva layer draws what these give (components/timeline/clips/Waveform.tsx).
import type { AnyClipProps, Asset, AudioClipProps, VideoClipProps } from "./types";
import { sourceTimeAt } from "./speed.ts";
import { listKeyframes, sampleKeyframes } from "./keyframes.ts";

/** Buckets a second asked of the engine (5 ms: finer than a 2 px bar at any zoom but the deepest). */
export const WAVEFORM_PER_SECOND = 200;

/** A file's sound as the engine gives it: the RMS of the mono mix per bucket (0..1). */
export type WaveformBuckets = { perSecond: number; rms: Float32Array };

/** A bar every 2 px, 1 px wide, the first 1.5 px from the clip's left edge. */
export const BAR_PITCH = 2;
export const BAR_WIDTH = 1;
export const FIRST_BAR = 1.5;

/** How far under full scale (dB of the mono mix's RMS) a bar has no height left. */
export const DB_RANGE = 52;

/**
 * A waveform's scale: a bar's height at 0 dBFS RMS, the volume line's at 0 dB gain, and how far
 * (px) the bars sit after the 2 px of sound they show.
 */
export type WaveScale = { full: number; line: number; lag: number };
/** An audio clip of the default height at waveform size 30% (003: its bars best fit 2 px late). */
export const AUDIO_SCALE: WaveScale = { full: 30.5, line: 13, lag: 2 };
/** A video's 16 px bottom band, the main track's (001). */
export const BAND_SCALE: WaveScale = { full: 13.5, line: 6.5, lag: 0 };

/** The track menu's Audio waveform size: how tall the bars are, 30% being the default. */
export type WaveformSize = 30 | 60 | 100;
export const WAVEFORM_SIZES: WaveformSize[] = [30, 60, 100];

/**
 * A scale for an area `height` px tall whose default is `defaultHeight` (a track's Short or Tall
 * scales it), at waveform size `size`.
 */
export const scaleFor = (base: WaveScale, height: number, defaultHeight: number, size: WaveformSize = 30): WaveScale => {
  const k = (height / Math.max(1, defaultHeight)) * (size / 30);
  return { full: base.full * k, line: base.line * k, lag: base.lag };
};

/** Where a sound came from, which sets its colours on the timeline. */
export type SoundKind = "extracted" | "music" | "voiceover";

/**
 * CapCut's colours by kind: a video's sound keeps the video's teal (003); other sound is the
 * blue of the Linkage legend's Audio (31-dialogs/038), which has no category of its own for a
 * recorded voiceover.
 */
export const SOUND_COLORS: Record<SoundKind, { body: string; chip: string; bar: string }> = {
  extracted: { body: "#1d4950", chip: "#2f5b62", bar: "#33757d" },
  music: { body: "#182f55", chip: "#2e4466", bar: "#3a7faf" },
  voiceover: { body: "#182f55", chip: "#2e4466", bar: "#3a7faf" },
};

/** The volume line: white at 27% (#597f84 over the teal). */
export const LINE_COLOR = "rgba(255,255,255,0.27)";

/** What a clip's sound is, from its asset: a video's (`…#audio`, or the video file itself), a voiceover take, or music. */
export const soundKindOf = (asset: Pick<Asset, "path" | "type"> | undefined): SoundKind => {
  if (!asset) return "music";
  if (asset.type === "video" || /#audio$/.test(asset.path)) return "extracted";
  return /\/voiceover\/[^/]*$/.test(decodeURIComponent(asset.path)) ? "voiceover" : "music";
};

/** The RMS of `b` over media seconds [from, to], at least the bucket at `from`. */
export const windowRms = (b: WaveformBuckets, from: number, to: number): number => {
  const n = b.rms.length;
  let i0 = Math.floor(from * b.perSecond);
  let i1 = Math.ceil(to * b.perSecond);
  if (i1 <= i0) i1 = i0 + 1;
  i0 = Math.max(0, i0);
  i1 = Math.min(n, i1);
  if (i1 <= i0) return 0;
  let e = 0;
  for (let i = i0; i < i1; i++) e += b.rms[i] * b.rms[i];
  return Math.sqrt(e / (i1 - i0));
};

/** A bar's height for an RMS level with `gainDb` on it, to half a pixel (as Retina draws them), at most `max`. */
export const barHeight = (rms: number, gainDb: number, full: number, max: number): number => {
  if (!(rms > 0) || !Number.isFinite(gainDb)) return 0;
  const h = full * (1 + (20 * Math.log10(rms) + gainDb) / DB_RANGE);
  return h <= 0 ? 0 : Math.min(max, Math.round(h * 2) / 2);
};

const lengthOf = (clip: AnyClipProps) => Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));

/** The clip's gain (dB) at clip-local frame `local`: its volume, or its volume keys, and its fades (−∞ at a fade's end). */
export const gainDbAt = (clip: AnyClipProps, local: number, fps: number): number => {
  const c = clip as AudioClipProps;
  const keys = listKeyframes(clip.keyframes, "volume");
  const volume = keys.length ? Number(sampleKeyframes(keys, local, "volume", fps) ?? 0) : Number(c.volume ?? 0);
  const t = local / fps;
  const len = lengthOf(clip) / fps;
  let g = 1;
  const fadeIn = Math.max(0, Number(c.fadeIn ?? 0));
  const fadeOut = Math.max(0, Number(c.fadeOut ?? 0));
  if (fadeIn > 0 && t < fadeIn) g *= Math.max(0, t) / fadeIn;
  if (fadeOut > 0 && t > len - fadeOut) g *= Math.max(0, len - t) / fadeOut;
  return g <= 0 ? -Infinity : volume + 20 * Math.log10(g);
};

/** A bar: its x (px from the clip's left edge) and height. */
export type Bar = { x: number; h: number };

export type BarOptions = {
  fps: number;
  /** The timeline's scale. */
  pxPerFrame: number;
  /** The media's length (s), for a reversed clip. */
  mediaSeconds?: number;
  /** The part of the clip to draw, px from its left edge (what's on screen). */
  fromPx: number;
  toPx: number;
  /** The waveform's scale (`scaleFor`) and the area's height, which nothing passes. */
  scale: WaveScale;
  max: number;
};

/**
 * The clip's bars between `fromPx` and `toPx`: each the RMS of the media 2 px play (through its
 * trim, speed, curve and direction), `scale.lag` px before the bar, with the clip's gain there.
 * A freeze frame is silent.
 */
export const clipBars = (clip: AnyClipProps, b: WaveformBuckets, o: BarOptions): Bar[] => {
  if ((clip as VideoClipProps).freeze) return [];
  const out: Bar[] = [];
  const len = lengthOf(clip);
  const width = len * o.pxPerFrame;
  const to = Math.min(o.toPx, width);
  const half = BAR_PITCH / 2;
  for (let i = Math.max(0, Math.ceil((o.fromPx - FIRST_BAR) / BAR_PITCH)); ; i++) {
    const x = FIRST_BAR + i * BAR_PITCH;
    if (x >= to) break;
    const a = Math.min(len, Math.max(0, (x - o.scale.lag - half) / o.pxPerFrame));
    const z = Math.min(len, Math.max(0, (x - o.scale.lag + half) / o.pxPerFrame));
    const m0 = sourceTimeAt(clip, a, o.fps, o.mediaSeconds);
    const m1 = sourceTimeAt(clip, z, o.fps, o.mediaSeconds);
    const h = barHeight(windowRms(b, Math.min(m0, m1), Math.max(m0, m1)), gainDbAt(clip, x / o.pxPerFrame, o.fps), o.scale.full, o.max);
    if (h > 0) out.push({ x, h });
  }
  return out;
};

/**
 * The volume line between `fromPx` and `toPx` as points (x, height over the bottom edge): at
 * `scale.line` for 0 dB, moving with the clip's gain on the bars' scale, flat at a steady volume,
 * otherwise following its keys and fades a bar's pitch at a time.
 */
export const volumeLine = (clip: AnyClipProps, o: Pick<BarOptions, "fps" | "pxPerFrame" | "fromPx" | "toPx" | "scale" | "max">): Bar[] => {
  const width = lengthOf(clip) * o.pxPerFrame;
  const from = Math.max(0, o.fromPx);
  const to = Math.min(width, o.toPx);
  if (to <= from) return [];
  const at = (x: number): Bar => {
    const g = gainDbAt(clip, x / o.pxPerFrame, o.fps);
    const h = Number.isFinite(g) ? o.scale.line + (g * o.scale.full) / DB_RANGE : 0;
    return { x, h: Math.max(0, Math.min(o.max, h)) };
  };
  const c = clip as AudioClipProps;
  const varies = listKeyframes(clip.keyframes, "volume").length > 0 || Number(c.fadeIn ?? 0) > 0 || Number(c.fadeOut ?? 0) > 0;
  if (!varies) return [at(from), at(to)];
  const out: Bar[] = [];
  for (let x = from; x < to; x += BAR_PITCH) out.push(at(x));
  out.push(at(to));
  return out;
};

/**
 * A media clip's bands, top to bottom (CapCut's §4.11): the label band (its name and length
 * chips), the thumbnails, and the band with its own sound's waveform: 17, the rest and 16 px on
 * the main track; 18, the rest and 13 on an overlay track. A taller or shorter track scales the
 * thumbnails and the sound's band.
 */
export const mediaBands = (height: number, main: boolean): { label: number; thumbs: number; sound: number } => {
  const base = main ? 76 : 52;
  const label = Math.min(main ? 17 : 18, Math.round(height * 0.4));
  const sound = Math.round(((main ? 16 : 13) * height) / base);
  return { label, thumbs: Math.max(0, height - label - sound), sound };
};
