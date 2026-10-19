// Tests for src/lib/transcript-edit.ts: `node --test tests/` in packages/renderer (Node strips
// the types itself).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clipWords,
  covers,
  fillerPositions,
  isFillerText,
  mergeTranscript,
  missingRange,
  paragraphs,
  pauseSpans,
  spansOfWords,
  wholeSpans,
  wordAt,
  wordsOfCaptions,
} from "../src/lib/transcript-edit.ts";
import type { AnyClipProps, Transcript, VideoClipProps } from "../src/lib/types.ts";

const FPS = 30;
const word = (t: string, s: number, e: number) => ({ t, s, e });
// "so um today I am going to uh read a book" at ~0.5 s a word, with a long pause after "going".
const transcript: Transcript = {
  language: "en",
  model: "tiny",
  covered: [[0, 10]],
  words: [
    word("So", 0, 0.4),
    word("um,", 0.5, 0.9),
    word("today", 1.0, 1.5),
    word("I", 1.6, 1.7),
    word("am", 1.8, 2.0),
    word("going", 2.1, 2.6),
    word("to", 5.0, 5.2),
    word("uh", 5.3, 5.6),
    word("read", 5.7, 6.1),
    word("a", 6.2, 6.3),
    word("book.", 6.4, 7.0),
  ],
};

const clip = (patch: Partial<VideoClipProps> = {}): AnyClipProps =>
  ({ clipId: "c1", type: "video", assetId: "a", timelineId: "t", startFrame: 0, endFrame: 300, trimStart: 0, trimEnd: 0, speed: 1, ...patch }) as unknown as AnyClipProps;

test("words land on the timeline through the clip's start", () => {
  const w = clipWords(transcript, clip({ startFrame: 90, endFrame: 390 }), FPS);
  assert.equal(w.length, 11);
  assert.equal(w[0].from, 90);
  assert.equal(Math.round(w[2].from), 90 + 30);
  assert.equal(Math.round(w[10].to), 90 + 210);
});

test("a trimmed clip keeps the words it plays, moved by the trim", () => {
  // Trim 2 s off the front (60 frames) and play 3 s: the media from 2 s to 5 s.
  const c = clip({ trimStart: 60, endFrame: 90 });
  const w = clipWords(transcript, c, FPS);
  assert.deepEqual(
    w.map((x) => x.text),
    ["going"],
  );
  // "going" starts at 2.1 s, 0.1 s into the clip; "am" (1.8 to 2.0 s) is trimmed away.
  assert.equal(Math.round(w[0].from), 3);
});

test("a speed shortens the words' times and the played range grows", () => {
  const c = clip({ speed: 2, endFrame: 150 }); // 5 s of timeline = 10 s of media
  const w = clipWords(transcript, c, FPS);
  assert.equal(w.length, 11);
  assert.equal(Math.round(w[2].from), 15); // today at 1.0 s media: 0.5 s timeline
  // Slowed to half: 5 s of timeline plays 2.5 s of media.
  const slow = clipWords(transcript, clip({ speed: 0.5, endFrame: 150 }), FPS);
  assert.deepEqual(
    slow.map((x) => x.text),
    ["So", "um,", "today", "I", "am", "going"],
  );
  assert.equal(Math.round(slow[2].from), 60); // today at 1.0 s media is 2 s on the timeline
});

test("a reversed clip or a speed curve has no mapped words", () => {
  assert.deepEqual(clipWords(transcript, clip({ reverse: true }), FPS), []);
  assert.deepEqual(clipWords(transcript, clip({ speedCurve: { points: [] } } as never), FPS), []);
});

test("a transcript covers what was listened to, and a trim outwards is missing", () => {
  const heard: Transcript = { ...transcript, covered: [[1, 4]] };
  assert.equal(covers(heard, clip({ trimStart: 30, endFrame: 90 }), FPS), true);
  assert.equal(covers(heard, clip({ trimStart: 0, endFrame: 90 }), FPS), false);
  assert.deepEqual(missingRange(heard, clip({ trimStart: 0, endFrame: 90 }), FPS), [0, 3]);
  assert.equal(missingRange(heard, clip({ trimStart: 30, endFrame: 90 }), FPS), null);
  assert.deepEqual(missingRange(undefined, clip({ endFrame: 60 }), FPS), [0, 2]);
});

test("a later listen replaces the words in its range and joins the covered ranges", () => {
  const next = mergeTranscript(transcript, [word("new", 11, 11.5)], [10, 12], "en", "tiny");
  assert.deepEqual(next.covered, [[0, 12]]);
  assert.equal(next.words.length, 12);
  const redo = mergeTranscript(next, [word("a", 1.0, 1.2)], [0.9, 1.3], "en", "tiny");
  assert.deepEqual(
    redo.words.slice(0, 3).map((w) => w.t),
    ["So", "um,", "a"],
  );
});

test("captions' words come out with times in the media", () => {
  const words = wordsOfCaptions([{ startUs: 1_000_000, text: "Hello there", words: [{ rangeStart: 0, rangeEnd: 5, startUs: 100_000, endUs: 500_000 }, { rangeStart: 6, rangeEnd: 11, startUs: 600_000, endUs: 900_000 }] }], 10);
  assert.deepEqual(words, [word("Hello", 11.1, 11.5), word("there", 11.6, 11.9)]);
});

test("fillers are um, uh and the like, and like only between commas", () => {
  assert.ok(isFillerText("Um,"));
  assert.ok(isFillerText("uh"));
  assert.ok(isFillerText("Hmm."));
  assert.ok(isFillerText("like,"));
  assert.ok(!isFillerText("like"));
  assert.ok(!isFillerText("umbrella"));
  const w = clipWords(transcript, clip(), FPS);
  assert.deepEqual(fillerPositions(w), [1, 7]);
});

test("deleting picked words cuts one span for neighbours and one for each separate run", () => {
  const w = clipWords(transcript, clip(), FPS);
  const spans = spansOfWords(w, new Set([2, 3, 4, 8]));
  assert.equal(spans.length, 2);
  assert.deepEqual(spans.map((s) => [Math.round(s.from), Math.round(s.to)]), [[30, 60], [171, 183]]);
  const cut = wholeSpans(spans, [clip()]);
  assert.deepEqual(cut.map((s) => [s.from, s.to]), [[30, 60], [171, 183]]);
});

test("a span is held to its clip, at least a frame, and touching spans are one", () => {
  const c = clip({ startFrame: 10, endFrame: 100 });
  const cut = wholeSpans(
    [
      { clipId: "c1", from: 0, to: 20.4 },
      { clipId: "c1", from: 20, to: 30 },
      { clipId: "c1", from: 50, to: 50 },
      { clipId: "c1", from: 99.7, to: 120 },
    ],
    [c],
  );
  assert.deepEqual(cut.map((s) => [s.from, s.to]), [[10, 30], [50, 51]]);
});

test("fillers picked with everything else make the cut list the filler words only", () => {
  const w = clipWords(transcript, clip(), FPS);
  const spans = wholeSpans(spansOfWords(w, new Set(fillerPositions(w))), [clip()]);
  assert.deepEqual(spans.map((s) => [s.from, s.to]), [[15, 27], [159, 168]]);
});

test("pauses over the limit are cut, leaving a little quiet", () => {
  const c = clip();
  const w = clipWords(transcript, c, FPS);
  // The gap between "going" (ends 2.6 s) and "to" (5.0 s) is 2.4 s; 7.0 s to the clip's end at 10 s is 3 s.
  const spans = pauseSpans(w, c, FPS, 1, 0.2);
  assert.deepEqual(spans.map((s) => [s.from, s.to]), [[81, 147], [213, 297]]);
  // Under 3 s long only the longer one counts.
  assert.equal(pauseSpans(w, c, FPS, 2.5, 0.2).length, 1);
  // Nothing is that long.
  assert.deepEqual(pauseSpans(w, c, FPS, 4, 0.2), []);
  // Short pauses (0.1 s between words) are never cut at a 0.5 s limit.
  assert.equal(pauseSpans(w, c, FPS, 0.5, 0.2).length, 2);
});

test("a sped-up clip's pauses are as long as they play", () => {
  const c = clip({ speed: 2, endFrame: 150 });
  const w = clipWords(transcript, c, FPS);
  // 2.4 s of media is 1.2 s on the timeline: over 1 s but not over 1.5 s.
  assert.equal(pauseSpans(w, c, FPS, 1, 0.2).filter((s) => s.from > 30 && s.to < 80).length, 1);
  assert.equal(pauseSpans(w, c, FPS, 1.5, 0.2).filter((s) => s.from > 30 && s.to < 80).length, 0);
});

test("paragraphs break at a long pause and the word at a frame is the one spoken", () => {
  const w = clipWords(transcript, clip(), FPS);
  const p = paragraphs(w, FPS);
  assert.deepEqual(p.map((x) => [x.from, x.to]), [[0, 5], [6, 10]]);
  assert.equal(wordAt(w, 31), 2);
  assert.equal(wordAt(w, 100), -1);
});
