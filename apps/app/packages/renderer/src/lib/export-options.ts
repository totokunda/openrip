// What the Export dialog offers and how it turns the choices into numbers: the resolutions,
// bit rates, codecs, formats, frame rates, the GIF and audio options CapCut's dialog lists
// (docs/plan/capcut-ui-spec.md §6.29), the pixel size a resolution gives a project, the
// bit rate each preset means and the size of what an export will write. Pure functions: the
// dialog and lib/export-run.ts use them, and nothing here touches the engine or a file.

export type Choice<T extends string | number> = { value: T; label: string; note?: string };

/** CapCut's resolutions by name; the value is the picture's shorter side in pixels (1080P of a
 * 9:16 project is 1080×1920). */
export const RESOLUTIONS: Choice<number>[] = [
  { value: 480, label: "480P" },
  { value: 720, label: "720P" },
  { value: 1080, label: "1080P" },
  { value: 1440, label: "2K" },
  { value: 2160, label: "4K" },
  { value: 4320, label: "8K" },
];

export type BitrateMode = "lower" | "recommended" | "higher" | "custom";

export const BITRATES: Choice<BitrateMode>[] = [
  { value: "lower", label: "Lower" },
  { value: "recommended", label: "Recommended" },
  { value: "higher", label: "Higher" },
  { value: "custom", label: "Custom" },
];

export type VideoCodec = "h264" | "hevc";

export const CODECS: Choice<VideoCodec>[] = [
  { value: "h264", label: "H.264", note: "The most common compression method" },
  { value: "hevc", label: "HEVC", note: "Efficient compression, saving space" },
];

export type VideoFormat = "mp4" | "mov";

export const FORMATS: Choice<VideoFormat>[] = [
  { value: "mov", label: "mov" },
  { value: "mp4", label: "mp4" },
];

/** CapCut's frame rates (value in frames a second). */
export const FRAME_RATES: Choice<number>[] = [
  { value: 24, label: "24fps" },
  { value: 25, label: "25fps" },
  { value: 30000 / 1001, label: "29.97fps" },
  { value: 30, label: "30fps" },
  { value: 50, label: "50fps" },
  { value: 60000 / 1001, label: "59.94fps" },
  { value: 60, label: "60fps" },
];

export type AudioFormat = "mp3" | "wav" | "aac" | "flac";

export const AUDIO_FORMATS: Choice<AudioFormat>[] = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "aac", label: "AAC" },
  { value: "flac", label: "FLAC" },
];

/** The file extension each audio format is written with. */
export const AUDIO_EXTENSION: Record<AudioFormat, string> = { mp3: "mp3", wav: "wav", aac: "m4a", flac: "flac" };

/** CapCut's GIF sizes (the shorter side). */
export const GIF_RESOLUTIONS: Choice<number>[] = [
  { value: 240, label: "240P" },
  { value: 320, label: "320P" },
  { value: 640, label: "640P" },
];

/** A GIF's frame rate: enough to look smooth, as small as a GIF stays. */
export const GIF_FPS = 15;

export type CaptionFormat = "srt" | "txt";

export const CAPTION_FORMATS: Choice<CaptionFormat>[] = [
  { value: "srt", label: "SRT" },
  { value: "txt", label: "TXT" },
];

/** Whether two frame rates are the same one (29.97 is 30000/1001 however it's written). */
export const sameRate = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** The listed rate closest to `fps` (the project's rate is the dialog's default). */
export const nearestRate = (fps: number): number => FRAME_RATES.reduce((best, r) => (Math.abs(r.value - fps) < Math.abs(best - fps) ? r.value : best), FRAME_RATES[0].value);

/** The size an export of a `ratio` (width / height) project has at `short` pixels on its shorter
 * side: even numbers, as encoders want. */
export function outputSize(short: number, ratio: number): { width: number; height: number } {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return r >= 1 ? { width: even(short * r), height: even(short) } : { width: even(short), height: even(short / r) };
}

/** Kilobits a second for `mode` at a size and frame rate. 1080P at 24 fps is 5 000 (Lower), 8 000
 * (Recommended) and 11 000 (Higher), as CapCut's dialog fills in; other pictures scale with their
 * pixels (a little less than linearly) and frame rate (the square root). */
export function presetKbps(mode: Exclude<BitrateMode, "custom">, width: number, height: number, fps: number): number {
  const base = { lower: 5000, recommended: 8000, higher: 11000 }[mode];
  const pixels = (width * height) / (1920 * 1080);
  const kbps = base * Math.pow(pixels, 0.9) * Math.sqrt(Math.max(1, fps) / 24);
  return Math.max(200, Math.round(kbps / 100) * 100);
}

/** The bit rate of an audio file, in kilobits a second (16-bit stereo PCM at 44.1 kHz for WAV; FLAC is about 60% of that). */
export const audioKbps = (f: AudioFormat) => (f === "wav" ? 1411 : f === "flac" ? 850 : 192);

/** What the video of an export is asked for. */
export type VideoSettings = {
  resolution: number;
  bitrate: BitrateMode;
  /** The Custom field's value, in kilobits a second. */
  customKbps: number;
  codec: VideoCodec;
  format: VideoFormat;
  fps: number;
};

/** The bit rate the video is written at, in bits per second. */
export function videoBitrate(v: VideoSettings, size: { width: number; height: number }): number {
  const kbps = v.bitrate === "custom" ? v.customKbps : presetKbps(v.bitrate, size.width, size.height, v.fps);
  return Math.max(100, Math.round(kbps)) * 1000;
}

/** The sizes of what an export will write, in bytes: the video (with its sound), the sound file,
 * the GIF and the captions. Each is `null` when that part is off. The GIF is a guess from its
 * pixels: GIFs of moving pictures come to about a tenth of a byte a pixel. */
export function estimateBytes(o: {
  seconds: number;
  ratio: number;
  video: VideoSettings | null;
  videoHasAudio: boolean;
  audio: AudioFormat | null;
  gif: number | null;
  captions: boolean;
}): { video: number | null; audio: number | null; gif: number | null; captions: number | null; total: number } {
  const s = Math.max(0, o.seconds);
  const video = o.video ? ((videoBitrate(o.video, outputSize(o.video.resolution, o.ratio)) + (o.videoHasAudio ? 192_000 : 0)) * s) / 8 : null;
  const audio = o.audio ? (audioKbps(o.audio) * 1000 * s) / 8 : null;
  const gifSize = o.gif ? outputSize(o.gif, o.ratio) : null;
  const gif = gifSize ? gifSize.width * gifSize.height * GIF_FPS * s * 0.1 : null;
  const captions = o.captions ? 1024 : null;
  return { video, audio, gif, captions, total: (video ?? 0) + (audio ?? 0) + (gif ?? 0) + (captions ?? 0) };
}

/** "59 MB", "1.2 GB", "340 KB": the footer's size. */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** The time a run still needs, from when it began and how far it is; empty until it has gone far enough to tell. */
export function timeLeftLabel(startedAt: number, ratio: number, now = Date.now()): string {
  if (!startedAt || ratio < 0.03 || ratio >= 1) return "";
  const elapsed = (now - startedAt) / 1000;
  return durationLabel(Math.max(1, (elapsed / ratio) * (1 - ratio)));
}

/** "35s", "1m 05s": the footer's duration. */
export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
