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

/** A word of a caption made from speech: its character range in the text and when it's said, seconds from the caption's start. */
export type CueWord = { from: number; to: number; start: number; end: number; keyword?: boolean };

/** A caption: its text (lines joined by "\n") from `start` to `end`, in seconds, and for one made from speech its words' timing. */
export type Cue = { start: number; end: number; text: string; words?: CueWord[] };

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

/** Lines of text in a cue from a file that writes breaks its own way, tidied as SRT's are. */
const tidy = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join("\n");

/** How long the last line of an LRC file shows when nothing says where it ends (s). */
export const LRC_LAST_LINE = 3;

/**
 * Read an LRC (lyrics) file: lines `[mm:ss.xx]words`, a line may carry several time tags
 * (a repeated chorus) and `<mm:ss.xx>` word tags are dropped (the words show whole). Tags
 * like `[ar:Artist]` are passed over except `[offset:±ms]`, which moves every time (positive
 * shows lines earlier, as players apply it). A line ends where the next begins in time; a
 * tag with no words ends the line before it; the last line shows for `LRC_LAST_LINE` seconds.
 * Lines at the same time become one cue of several lines.
 */
export const parseLrc = (source: string): ParsedCaptions => {
  const lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let offset = 0;
  const stamps: { at: number; text: string }[] = [];
  let skipped = 0;
  const TAG = /^\[(\d+:\d{1,2}(?:[.:]\d+)?)\]/;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const meta = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (meta) {
      offset = +meta[1] / 1000;
      continue;
    }
    const tags: number[] = [];
    let rest = line;
    for (let m = rest.match(TAG); m; m = rest.match(TAG)) {
      // "mm:ss:xx" (a colon before the fraction) is read as a fraction too.
      const t = m[1].replace(/^(\d+:\d{1,2}):(\d+)$/, "$1.$2");
      const at = parseTime(t);
      if (Number.isFinite(at)) tags.push(at);
      rest = rest.slice(m[0].length);
    }
    if (!tags.length) {
      // `[ti:Title]` and friends are metadata; anything else that isn't blank is a line we can't place.
      if (!/^\[[a-z]+:.*\]$/i.test(line)) skipped++;
      continue;
    }
    const text = tidy(rest.replace(/<\d+:\d{1,2}(?:[.:]\d+)?>/g, "").replace(/\s+/g, " "));
    for (const at of tags) stamps.push({ at: Math.max(0, at - offset), text });
  }
  stamps.sort((a, b) => a.at - b.at);
  const cues: Cue[] = [];
  for (let k = 0; k < stamps.length; k++) {
    const { at, text } = stamps[k];
    if (!text) continue;
    // To the next stamp at a later time.
    const next = stamps.slice(k + 1).find((s) => s.at > at);
    const end = next ? next.at : at + LRC_LAST_LINE;
    const last = cues[cues.length - 1];
    if (last && last.start === at) last.text += `\n${text}`;
    else cues.push({ start: at, end, text });
  }
  return { cues, skipped };
};

/** An ASS `Format:` line's column names. */
const assColumns = (line: string) => line.slice(line.indexOf(":") + 1).split(",").map((c) => c.trim().toLowerCase());

/**
 * Read an ASS or SSA (Advanced SubStation Alpha) file's dialogue: the `[Events]` section's
 * `Format:` line says which comma-separated column is Start, End and Text (the text is the last
 * column and may hold commas); `Dialogue:` lines become cues, `Comment:` lines are left out.
 * Times are `h:mm:ss.cc`. In the text `\N` and `\n` are line breaks, `\h` a space and
 * `{\…}` override blocks (position, colour, karaoke, fades) are dropped. The styles
 * (`[V4+ Styles]`) are not read: every cue takes the style chosen in the Captions tab.
 */
export const parseAss = (source: string): ParsedCaptions => {
  const lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let inEvents = false;
  let cols = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
  const cues: Cue[] = [];
  let skipped = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inEvents = /^\[events\]$/i.test(line);
      continue;
    }
    if (!inEvents || !line) continue;
    if (/^format\s*:/i.test(line)) {
      cols = assColumns(line);
      continue;
    }
    if (!/^dialogue\s*:/i.test(line)) continue;
    const body = line.slice(line.indexOf(":") + 1).replace(/^\s/, "");
    const textAt = cols.indexOf("text") >= 0 ? cols.indexOf("text") : cols.length - 1;
    // The first `textAt` commas split the columns before the text; the rest is the text.
    const parts: string[] = [];
    let from = 0;
    for (let k = 0; k < textAt; k++) {
      const c = body.indexOf(",", from);
      if (c < 0) break;
      parts.push(body.slice(from, c));
      from = c + 1;
    }
    parts.push(body.slice(from));
    if (parts.length <= textAt) {
      skipped++;
      continue;
    }
    const start = parseTime(parts[cols.indexOf("start")] ?? "");
    const end = parseTime(parts[cols.indexOf("end")] ?? "");
    const text = tidy(
      parts[textAt]
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\[Nn]/g, "\n")
        .replace(/\\h/g, " ")
        .replace(/<[^>]*>/g, ""),
    );
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || text === "") {
      skipped++;
      continue;
    }
    cues.push({ start, end, text });
  }
  cues.sort((x, y) => x.start - y.start);
  return { cues, skipped };
};

/** The captions in a subtitle file of any supported kind, told by its name's extension or, failing that, its contents. */
export const parseSubtitles = (source: string, name = ""): ParsedCaptions => {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "lrc") return parseLrc(source);
  if (ext === "ass" || ext === "ssa") return parseAss(source);
  if (ext === "srt" || ext === "vtt") return parseCaptions(source);
  if (/^\s*\[(script info|v4\+? styles|events)\]/im.test(source)) return parseAss(source);
  if (/-->/.test(source)) return parseCaptions(source);
  return /^\s*\[\d+:\d{1,2}/m.test(source) ? parseLrc(source) : parseCaptions(source);
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
export const cueFrames = (cues: Cue[], fps: number, offsetFrames = 0): { startFrame: number; endFrame: number; text: string; words?: CueWord[] }[] => {
  const framed: { startFrame: number; endFrame: number; text: string; words?: CueWord[] }[] = [];
  for (const c of [...cues].sort((a, b) => a.start - b.start)) {
    let startFrame = offsetFrames + Math.round(c.start * fps);
    const prev = framed[framed.length - 1];
    // A caption with its words' timing can't take another's lines: it starts a frame later.
    if (prev && prev.startFrame === startFrame && (prev.words || c.words)) startFrame += 1;
    const endFrame = Math.max(startFrame + 1, offsetFrames + Math.round(c.end * fps));
    if (prev && prev.startFrame === startFrame) {
      prev.text += `\n${c.text}`;
      prev.endFrame = Math.max(prev.endFrame, endFrame);
    } else {
      framed.push({ startFrame, endFrame, text: c.text, ...(c.words ? { words: c.words } : {}) });
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
    /** The captions are made from speech (Auto captions): marked so Generate again replaces them. */
    auto?: boolean;
  },
): { timeline: Partial<TimelineProps> & { timelineId: string; type: "text" }; clips: TextClipProps[] } => {
  const timelineId = opts.makeId();
  const style = { ...CAPTION_STYLE, ...(opts.style ?? {}) };
  const fontSize = style.fontSize ?? 32;
  const width = opts.canvas.width * 0.9;
  const lines = (t: string) => t.split("\n").length;
  const clips = cueFrames(cues, opts.fps, opts.offsetFrames ?? 0).map(({ startFrame, endFrame, text, words }): TextClipProps => {
    const height = fontSize * 1.25 * lines(text) + fontSize * 0.4;
    return {
      ...(JSON.parse(JSON.stringify(style)) as Partial<TextClipProps>),
      text,
      ...(words ? { captionWords: words, spokenWords: true, spokenFrom: 0, autoCaption: !!opts.auto } : {}),
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
  return { timeline: { timelineId, type: "text", timelineY: 0, timelineHeight: 40, timelineWidth: 0, muted: false, hidden: false, captions: true }, clips };
};

/** The words of the sample caption the Captions tab's Templates show on the video while there are no captions. */
export const SAMPLE_CAPTION = "Your captions look like this";

/** How long the sample says each of its words (s). */
const SAMPLE_WORD = 0.45;

/**
 * The sample caption: SAMPLE_CAPTION in `style`, where captionClips puts captions, its words said one after another so
 * that at frame `at` (the playhead) the third is being said, for a word-by-word style to show what it does to it. Its
 * speech starts that long before `at` (cut into, from frame 0, near the timeline's start) and it stays a second after
 * its last word. `id` is its track's and its clip's.
 */
export const sampleCaption = (style: Partial<TextClipProps>, opts: { fps: number; canvas: { width: number; height: number }; at: number; id: string }) => {
  let from = 0;
  const words: CueWord[] = SAMPLE_CAPTION.split(" ").map((w, k) => {
    const word = { from, to: from + w.length, start: k * SAMPLE_WORD, end: (k + 1) * SAMPLE_WORD };
    from += w.length + 1;
    return word;
  });
  const speech = opts.at - Math.round(2.5 * SAMPLE_WORD * opts.fps);
  const start = Math.max(0, speech);
  const end = speech + Math.round((words.length * SAMPLE_WORD + 1) * opts.fps);
  const { timeline, clips } = captionClips([{ start: 0, end: (end - start) / opts.fps, text: SAMPLE_CAPTION, words }], {
    fps: opts.fps,
    canvas: opts.canvas,
    style,
    makeId: () => opts.id,
    offsetFrames: start,
  });
  return { timeline, clip: { ...clips[0], spokenFrom: (start - speech) / opts.fps } };
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
