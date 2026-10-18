// Caption files: SubRip (.srt) and WebVTT (.vtt) read into text clips on a captions track, and
// a timeline's text clips written out as .srt (CapCut's Captions ▸ Import, and its caption
// export). No speech-to-text: captions come from a file, or from the timeline's own texts.
//
// Pure functions: nothing here reads files or writes to a store. The caller reads the file
// (the preload's `pickMediaPaths` and `readFileBuffer`), adds the clips with their track through
// the clip store (one undo step), and writes what `writeSrt` returns (`pickSavePath` and
// `writeFileBuffer`). Times in a cue are seconds; on the timeline, frames at the project's
// rate. See docs/plan/app-engine-integration.md ("Text styles and captions").
import type { AnyClipProps, TextClipProps, TimelineProps } from "./types";

/** A caption: its text (lines joined by "\n") from `start` to `end`, in seconds. */
export type Cue = { start: number; end: number; text: string };

/** What reading a file gave: its cues in time order, and the blocks it couldn't read. */
export type ParsedCaptions = { cues: Cue[]; skipped: number };

/**
 * A time as a caption file writes it: `[hh:]mm:ss[,.]fff` (SRT always has hours and a comma,
 * VTT may leave the hours out and has a dot; players accept either). Fewer than three digits
 * of fraction are a decimal fraction ("1,5" is 1.5 s). Hours can run past 99. NaN if it isn't
 * one.
 */
export const parseTime = (s: string): number => {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?$/);
  if (!m) return NaN;
  const [, h, min, sec, frac] = m;
  if (+min > 59 || +sec > 59) return NaN;
  return (h ? +h * 3600 : 0) + +min * 60 + +sec + (frac ? +`0.${frac}` : 0);
};

/** A time in seconds as SRT writes it (`hh:mm:ss,mmm`), rounded to the millisecond. */
export const formatSrtTime = (seconds: number): string => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

/** Markup a cue's text may carry that captions don't show: HTML-ish tags (`<i>`, `<b>`,
 * `<font …>`, VTT's `<v Name>`, `<c.class>`, inline `<00:01.000>` timestamps) and SSA overrides
 * (`{\an8}`). Entities are decoded. */
const plain = (text: string): string =>
  text
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join("\n");

const TIMING = /^\s*(\S+)\s*-->\s*(\S+)/;

/**
 * Read an SRT or VTT file's text (BOM, CRLF and stray spacing tolerated). A cue is a block of
 * lines separated by blank lines: an optional number or identifier, a timing line
 * (`start --> end`, VTT settings after it ignored), then its text. VTT's header, NOTE, STYLE and
 * REGION blocks are passed over. Cues without text, with an unreadable time, or ending at or
 * before their start are skipped (counted in `skipped`). The cues come back sorted by start.
 */
export const parseCaptions = (source: string): ParsedCaptions => {
  const lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: Cue[] = [];
  let skipped = 0;
  let i = 0;
  while (i < lines.length) {
    // The next block.
    while (i < lines.length && lines[i].trim() === "") i++;
    const block: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") block.push(lines[i++]);
    if (!block.length) break;
    const first = block[0].trim();
    if (/^WEBVTT\b/.test(first) || /^(NOTE|STYLE|REGION)\b/.test(first)) continue;
    const t = block.findIndex((l) => TIMING.test(l));
    // A timing line is the first or second line of a cue (after its number or identifier).
    if (t < 0 || t > 1) {
      skipped++;
      continue;
    }
    const [, a, b] = block[t].match(TIMING)!;
    const start = parseTime(a);
    const end = parseTime(b);
    const text = plain(block.slice(t + 1).join("\n"));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || text === "") {
      skipped++;
      continue;
    }
    cues.push({ start, end, text });
  }
  // A stable sort: cues at the same start keep the file's order.
  cues.sort((x, y) => x.start - y.start);
  return { cues, skipped };
};

/** Write cues as SRT: numbered from 1 in time order, `hh:mm:ss,mmm --> hh:mm:ss,mmm`, then the
 * text (blank lines inside it, which would end the cue, dropped). */
export const writeSrt = (cues: Cue[]): string =>
  [...cues]
    .sort((a, b) => a.start - b.start)
    .map((c, k) => {
      const text = c.text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "").join("\n");
      return `${k + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(Math.max(c.end, c.start + 0.001))}\n${text}\n`;
    })
    .join("\n");

/** The text a clip shows, in its letter case (as the engine draws it). */
export const shownText = (clip: TextClipProps): string => {
  const t = clip.text ?? "";
  switch (clip.textTransform) {
    case "uppercase":
      return t.toUpperCase();
    case "lowercase":
      return t.toLowerCase();
    case "capitalize":
      return t.replace(/(^|\s)(\S)/g, (_, s: string, c: string) => s + c.toUpperCase());
    default:
      return t;
  }
};

/**
 * The cues of a timeline's text clips, for an SRT export: each visible text clip with text
 * (on `timelineIds` if given, else every track), from its start to its end in seconds at
 * `fps`. Clips on different tracks may overlap; SRT allows it.
 */
export const clipsToCues = (clips: AnyClipProps[], fps: number, opts: { timelineIds?: string[]; hiddenTimelines?: string[] } = {}): Cue[] =>
  clips
    .filter((c): c is TextClipProps => c.type === "text" && !c.hidden)
    .filter((c) => !opts.timelineIds || opts.timelineIds.includes(c.timelineId ?? ""))
    .filter((c) => !opts.hiddenTimelines?.includes(c.timelineId ?? ""))
    .map((c) => ({ start: c.startFrame / fps, end: c.endFrame / fps, text: shownText(c).trim() }))
    .filter((c) => c.text !== "" && c.end > c.start)
    .sort((a, b) => a.start - b.start);

/**
 * Cues on whole frames at `fps`, for one track: each starts on the frame nearest its start and
 * lasts at least a frame. Cues starting on the same frame become one (their lines together,
 * until the last of them ends); one that would overlap the next ends where the next starts (a
 * track can't hold overlapping clips). Frames are counted from `offsetFrames` (where the
 * captions go on the timeline).
 */
export const cueFrames = (cues: Cue[], fps: number, offsetFrames = 0): { startFrame: number; endFrame: number; text: string }[] => {
  const framed: { startFrame: number; endFrame: number; text: string }[] = [];
  for (const c of [...cues].sort((a, b) => a.start - b.start)) {
    const startFrame = offsetFrames + Math.round(c.start * fps);
    const endFrame = Math.max(startFrame + 1, offsetFrames + Math.round(c.end * fps));
    const prev = framed[framed.length - 1];
    if (prev && prev.startFrame === startFrame) {
      prev.text += `\n${c.text}`;
      prev.endFrame = Math.max(prev.endFrame, endFrame);
    } else {
      framed.push({ startFrame, endFrame, text: c.text });
    }
  }
  framed.forEach((c, k) => {
    const next = framed[k + 1];
    if (next) c.endFrame = Math.min(c.endFrame, next.startFrame);
  });
  return framed;
};

/**
 * Text clips for cues, on a new captions track: in `style` (a text clip's look, e.g. a preset's
 * props from lib/text-presets.ts), their boxes across the lower part of a canvas of `canvas`
 * world units (centred, the box's middle `bottom` of the way down: CapCut's captions sit low),
 * from `offsetFrames`. `makeId` gives fresh ids. Returns the track and the clips, for the
 * caller to add.
 */
export const captionClips = (
  cues: Cue[],
  opts: {
    fps: number;
    canvas: { width: number; height: number };
    style?: Partial<TextClipProps>;
    makeId: () => string;
    offsetFrames?: number;
    bottom?: number;
  },
): { timeline: Partial<TimelineProps> & { timelineId: string; type: "text" }; clips: TextClipProps[] } => {
  const timelineId = opts.makeId();
  const style = { ...CAPTION_STYLE, ...(opts.style ?? {}) };
  const fontSize = style.fontSize ?? 32;
  const width = opts.canvas.width * 0.9;
  const lines = (t: string) => t.split("\n").length;
  const clips = cueFrames(cues, opts.fps, opts.offsetFrames ?? 0).map(({ startFrame, endFrame, text }): TextClipProps => {
    const height = fontSize * 1.25 * lines(text) + fontSize * 0.4;
    return {
      ...(JSON.parse(JSON.stringify(style)) as Partial<TextClipProps>),
      text,
      clipId: opts.makeId(),
      type: "text",
      timelineId,
      startFrame,
      endFrame,
      trimEnd: -Infinity,
      trimStart: Infinity,
      transform: {
        x: (opts.canvas.width - width) / 2,
        y: opts.canvas.height * (opts.bottom ?? 0.82) - height / 2,
        width,
        height,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        cornerRadius: 0,
        opacity: 100,
      },
    };
  });
  return { timeline: { timelineId, type: "text", timelineY: 0, timelineHeight: 40, timelineWidth: 0, muted: false, hidden: false }, clips };
};

/** The look captions get when no style is chosen: white bold text with a black outline. */
export const CAPTION_STYLE: Partial<TextClipProps> = {
  fontSize: 30,
  fontWeight: 700,
  fontStyle: "normal",
  fontFamily: "Arial",
  color: "#ffffff",
  colorOpacity: 100,
  textAlign: "center",
  verticalAlign: "middle",
  textTransform: "none",
  textDecoration: "none",
  strokeEnabled: true,
  stroke: "#000000",
  strokeWidth: 3,
  strokeOpacity: 100,
  shadowEnabled: false,
};
