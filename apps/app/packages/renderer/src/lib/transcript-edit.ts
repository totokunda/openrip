// Transcript, the pure part: a media's recognized words (lib/types.ts `Transcript`, times in
// the media) put onto the timeline through a clip's trims and speed, the words to cut for
// Delete, Remove filler words and Remove pauses as spans of timeline frames, and merging what a
// later run heard into what is kept. The store side (listening, applying the cuts as one undo
// step) is lib/transcript.ts. Tests: tests/transcript.test.ts.
import { playedRange } from "./audio.ts";
import type { AnyClipProps, Transcript, TranscriptWord, VideoClipProps } from "./types";

/** A recognized word on the timeline: `from` and `to` in frames (they can be fractions). */
export type ClipWord = { clipId: string; /** Its place in the transcript's words. */ index: number; text: string; from: number; to: number };

/** A stretch of the timeline to cut, frames, `from` in and `to` out. */
export type Span = { clipId: string; from: number; to: number };

const startOf = (c: AnyClipProps) => c.startFrame ?? 0;
const endOf = (c: AnyClipProps) => c.endFrame ?? 0;
const speedOf = (c: AnyClipProps) => Math.max(0.1, Number((c as VideoClipProps).speed || 1));

/** Whether a clip's words can be put on the timeline: a video or audio clip played forwards at a steady speed. */
export const transcribable = (clip: AnyClipProps | undefined): clip is VideoClipProps =>
  (clip?.type === "video" || clip?.type === "audio") && !(clip as VideoClipProps).reverse && !(clip as VideoClipProps).speedCurve;

/** What a caption's words come to as transcript words (a word's times are from its caption's start): `base` is where the recognized range started in the media, seconds. */
export const wordsOfCaptions = (
  captions: { startUs: number; text: string; words: { rangeStart: number; rangeEnd: number; startUs: number; endUs: number }[] }[],
  base: number,
): TranscriptWord[] => {
  const out: TranscriptWord[] = [];
  for (const c of captions) {
    for (const w of c.words) {
      const t = c.text.slice(w.rangeStart, w.rangeEnd).trim();
      if (t) out.push({ t, s: round3(base + (c.startUs + w.startUs) / 1e6), e: round3(base + (c.startUs + w.endUs) / 1e6) });
    }
  }
  return out.sort((a, b) => a.s - b.s);
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The stretches of `list` (sorted or not) joined where they touch or overlap. */
const union = (list: [number, number][]): [number, number][] => {
  const out: [number, number][] = [];
  for (const r of [...list].filter((r) => r[1] > r[0]).sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
};

/**
 * `old` with a listen to `range` (media seconds) folded in: the words it kept inside the
 * range are replaced by `words`, the rest stay, and the range counts as heard.
 */
export const mergeTranscript = (old: Transcript | undefined, words: TranscriptWord[], range: [number, number], language: string, model: string): Transcript => {
  const mid = (w: TranscriptWord) => (w.s + w.e) / 2;
  const kept = (old?.words ?? []).filter((w) => mid(w) < range[0] || mid(w) >= range[1]);
  return {
    language,
    model,
    words: [...kept, ...words.filter((w) => mid(w) >= range[0] && mid(w) < range[1])].sort((a, b) => a.s - b.s),
    covered: union([...(old?.covered ?? []), range]),
  };
};

/** The media range a clip plays, seconds (a start and a length); null if its words can't be mapped. */
const rangeOf = (clip: AnyClipProps, fps: number): [number, number] | null => (transcribable(clip) ? playedRange(clip, fps) : null);

/** Whether a transcript has listened to everything a clip plays (to within a frame). */
export const covers = (transcript: Transcript | undefined, clip: AnyClipProps, fps: number): boolean => {
  const r = rangeOf(clip, fps);
  if (!transcript || !r) return false;
  const [from, to] = [r[0], r[0] + r[1]];
  const slack = 1 / fps;
  return transcript.covered.some(([a, b]) => a <= from + slack && b >= to - slack);
};

/** The media range of a clip not yet listened to (its whole range if none was), or null when covered or unmappable. */
export const missingRange = (transcript: Transcript | undefined, clip: AnyClipProps, fps: number): [number, number] | null => {
  const r = rangeOf(clip, fps);
  if (!r || covers(transcript, clip, fps)) return null;
  return [r[0], r[0] + r[1]];
};

/**
 * The words a clip plays, where they fall on the timeline: its trim and speed carry a word's
 * media time to a frame. A word is the clip's if its middle is inside the range it plays; its
 * edges are held to the clip's.
 */
export const clipWords = (transcript: Transcript | undefined, clip: AnyClipProps, fps: number): ClipWord[] => {
  const r = rangeOf(clip, fps);
  if (!transcript || !r) return [];
  const [from, span] = r;
  const speed = speedOf(clip);
  const toFrame = (sec: number) => startOf(clip) + ((sec - from) * fps) / speed;
  const out: ClipWord[] = [];
  transcript.words.forEach((w, index) => {
    const m = (w.s + w.e) / 2;
    if (m < from || m >= from + span) return;
    out.push({ clipId: clip.clipId, index, text: w.t, from: Math.max(startOf(clip), toFrame(w.s)), to: Math.min(endOf(clip), toFrame(w.e)) });
  });
  return out;
};

const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
const FILLERS = new Set(["um", "umm", "uhm", "uh", "uhh", "er", "erm", "hm", "hmm", "mm", "mmm", "mhm"]);

/** A word that is no part of the speech: um, uh, er, hmm; or "like" set off by commas (as the engine's captions count them, engine/crates/speech). */
export const isFillerText = (text: string): boolean => {
  const norm = letters(text);
  return FILLERS.has(norm) || (norm === "like" && text.trimEnd().endsWith(","));
};

/** The spans of `words` (a clip's, in order) at the places in `picked` (their positions in the list); neighbours picked together are one span. */
export const spansOfWords = (words: ClipWord[], picked: Set<number>): Span[] => {
  const spans: Span[] = [];
  let run: ClipWord[] = [];
  const flush = () => {
    if (run.length) spans.push({ clipId: run[0].clipId, from: run[0].from, to: run[run.length - 1].to });
    run = [];
  };
  words.forEach((w, i) => {
    if (picked.has(i) && (run.length === 0 || run[run.length - 1].clipId === w.clipId)) run.push(w);
    else {
      flush();
      if (picked.has(i)) run.push(w);
    }
  });
  flush();
  return spans;
};

/** Where the filler words are in `words`. */
export const fillerPositions = (words: ClipWord[]): number[] => words.flatMap((w, i) => (isFillerText(w.text) ? [i] : []));

/**
 * The pauses to cut from a clip: where the speech stops for more than `minSecs` (between two
 * words, before the first and after the last, up to the clip's ends), each cut leaving
 * `keepSecs` of the quiet (half on each side) so the speech doesn't run together. `words` are
 * the clip's own, in order.
 */
export const pauseSpans = (words: ClipWord[], clip: AnyClipProps, fps: number, minSecs: number, keepSecs = 0.2): Span[] => {
  if (words.length === 0) return [];
  const min = minSecs * fps;
  const half = (keepSecs * fps) / 2;
  const spans: Span[] = [];
  const gap = (a: number, b: number) => {
    if (b - a <= min) return;
    const from = Math.ceil(a + half);
    const to = Math.floor(b - half);
    if (to > from) spans.push({ clipId: clip.clipId, from, to });
  };
  // The speed stretches the quiet as much as the words: the frames are the clip's own.
  gap(startOf(clip), words[0].from);
  for (let i = 1; i < words.length; i++) gap(words[i - 1].to, words[i].from);
  gap(words[words.length - 1].to, endOf(clip));
  return spans;
};

/** The spans as whole frames: sorted by where they start, each held to its clip and at least a frame long, those that touch joined. */
export const wholeSpans = (spans: Span[], clips: AnyClipProps[]): Span[] => {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    const clip = clips.find((c) => c.clipId === s.clipId);
    const [lo, hi] = clip ? [startOf(clip), endOf(clip)] : [-Infinity, Infinity];
    const from = Math.max(lo, Math.round(s.from));
    let to = Math.min(hi, Math.round(s.to));
    if (to <= from) to = Math.min(hi, from + 1);
    if (to <= from) continue;
    const last = out[out.length - 1];
    if (last && last.clipId === s.clipId && from <= last.to) last.to = Math.max(last.to, to);
    else out.push({ clipId: s.clipId, from, to });
  }
  return out;
};

/** A paragraph of the panel: the words (positions in the list) and the frame the first starts at. */
export type Paragraph = { from: number; to: number; frame: number };

/**
 * The words broken into paragraphs: after a sentence that has run long enough, or a pause of
 * a second, or where the clip changes (a cut).
 */
export const paragraphs = (words: ClipWord[], fps: number): Paragraph[] => {
  const out: Paragraph[] = [];
  let from = 0;
  words.forEach((w, i) => {
    const next = words[i + 1];
    const sentence = /[.!?…。！？]["'”’)]*$/.test(w.text);
    const count = i - from + 1;
    const stop = !next || next.clipId !== w.clipId || next.from - w.to >= fps || (sentence && count >= 12) || count >= 40;
    if (stop) {
      out.push({ from, to: i, frame: words[from].from });
      from = i + 1;
    }
  });
  return out;
};

/** The position in `words` of the word being spoken at `frame` (the last started, within its clip), or -1. */
export const wordAt = (words: ClipWord[], frame: number): number => {
  let found = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].from <= frame) found = i;
    else break;
  }
  return found >= 0 && frame < words[found].to + 3 ? found : -1;
};
