// Tests for src/lib/captions.ts: `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { captionClips, clipsToCues, cueFrames, formatSrtTime, parseCaptions, parseTime, writeSrt } from "../src/lib/captions.ts";

test("times read in SRT's and VTT's forms", () => {
  assert.equal(parseTime("00:00:01,000"), 1);
  assert.equal(parseTime("01:02:03.250"), 3723.25);
  // VTT may leave the hours out; hours may pass 99; a short fraction is a decimal fraction.
  assert.equal(parseTime("02:03.5"), 123.5);
  assert.equal(parseTime("123:00:00,000"), 442800);
  assert.equal(parseTime("00:00:01,5"), 1.5);
  assert.equal(parseTime("0:00:07"), 7);
  for (const bad of ["", "1.5", "00:61:00,000", "00:00:60,000", "-00:00:01,000", "aa:bb:cc"]) assert.ok(Number.isNaN(parseTime(bad)), bad);
});

test("times write to the millisecond, carrying over", () => {
  assert.equal(formatSrtTime(0), "00:00:00,000");
  assert.equal(formatSrtTime(3723.25), "01:02:03,250");
  assert.equal(formatSrtTime(59.9996), "00:01:00,000");
  assert.equal(formatSrtTime(3599.9999), "01:00:00,000");
  assert.equal(formatSrtTime(1 / 3), "00:00:00,333");
  assert.equal(formatSrtTime(-2), "00:00:00,000");
  assert.equal(formatSrtTime(360000), "100:00:00,000");
});

test("an SRT file reads into cues, markup and bad blocks left out", () => {
  const srt = [
    "﻿1",
    "00:00:01,000 --> 00:00:02,500",
    "Hello <i>there</i>",
    "second line",
    "",
    "",
    "2",
    "00:00:03,000 --> 00:00:04,000 X1:100 X2:200",
    "{\\an8}<font color=\"#ff0000\">Top</font> &amp; red",
    "",
    "3",
    "00:00:05,000 --> 00:00:05,000",
    "No length",
    "",
    "4",
    "00:00:06,000 --> 00:00:07,000",
    "",
    "garbage block",
    "",
    "5",
    "00:00:08.000 --> 00:00:09.000",
    "Dots work too",
  ].join("\r\n");
  const { cues, skipped } = parseCaptions(srt);
  assert.deepEqual(cues, [
    { start: 1, end: 2.5, text: "Hello there\nsecond line" },
    { start: 3, end: 4, text: "Top & red" },
    { start: 8, end: 9, text: "Dots work too" },
  ]);
  // The zero-length cue, the cue with no text and the block with no timing.
  assert.equal(skipped, 3);
});

test("a VTT file reads too, its header, notes and settings passed over", () => {
  const vtt = [
    "WEBVTT - a file",
    "Kind: captions",
    "",
    "NOTE a note",
    "that runs on",
    "",
    "STYLE",
    "::cue { color: yellow }",
    "",
    "intro",
    "00:01.000 --> 00:02.000 align:start position:10%",
    "<v Ann>Hi <00:01.500>there</v>",
    "",
    "00:00.500 --> 00:00.900",
    "<c.loud>Earlier</c>",
  ].join("\n");
  const { cues, skipped } = parseCaptions(vtt);
  assert.equal(skipped, 0);
  // In time order.
  assert.deepEqual(cues, [
    { start: 0.5, end: 0.9, text: "Earlier" },
    { start: 1, end: 2, text: "Hi there" },
  ]);
});

test("cues fall on frames without overlapping on one track", () => {
  const cues = [
    { start: 0, end: 1.02, text: "a" },
    { start: 1, end: 2, text: "b" }, // overlaps a: a ends where b starts
    { start: 2.004, end: 2.01, text: "c" }, // shorter than a frame: one frame
    { start: 2.004, end: 3, text: "c2" }, // same frame as c: joined to it
    { start: 5, end: 6, text: "d" },
  ];
  assert.deepEqual(cueFrames(cues, 30, 10), [
    { startFrame: 10, endFrame: 40, text: "a" },
    { startFrame: 40, endFrame: 70, text: "b" },
    { startFrame: 70, endFrame: 100, text: "c\nc2" },
    { startFrame: 160, endFrame: 190, text: "d" },
  ]);
});

test("caption clips go on a new track in the chosen style", () => {
  let n = 0;
  const makeId = () => `id${n++}`;
  const { timeline, clips } = captionClips(
    [
      { start: 1, end: 2, text: "one" },
      { start: 2, end: 3.5, text: "two\nlines" },
    ],
    { fps: 24, canvas: { width: 1066.67, height: 600 }, makeId, style: { color: "#ffd84d", fontSize: 40 } },
  );
  assert.equal(timeline.type, "text");
  assert.equal(clips.length, 2);
  assert.ok(clips.every((c) => c.timelineId === timeline.timelineId && c.type === "text"));
  assert.deepEqual(clips.map((c) => [c.startFrame, c.endFrame, c.text]), [[24, 48, "one"], [48, 84, "two\nlines"]]);
  // The style, over the caption look (an outline unless the style turns it off).
  assert.equal(clips[0].color, "#ffd84d");
  assert.equal(clips[0].strokeEnabled, true);
  // Low on the canvas, across 90% of it; a two-line box is taller.
  const t = clips[0].transform!;
  assert.ok(t.y + t.height / 2 > 450 && Math.abs(t.width - 960) < 0.01);
  assert.ok(clips[1].transform!.height > t.height);
  assert.equal(new Set(clips.map((c) => c.clipId)).size, 2);
});

test("text clips write out as SRT and read back the same", () => {
  const clip = (id: string, start: number, end: number, text: string, extra = {}) =>
    ({ clipId: id, type: "text", timelineId: "T", startFrame: start, endFrame: end, text, ...extra }) as any;
  const clips = [
    clip("b", 60, 90, "Second"),
    clip("a", 15, 45, "first line\n\nafter a blank", { textTransform: "uppercase" }),
    clip("h", 100, 120, "Hidden", { hidden: true }),
    clip("e", 130, 140, "   "),
    { clipId: "v", type: "video", startFrame: 0, endFrame: 200 } as any,
    clip("o", 70, 80, "Other track", { timelineId: "U" }),
  ];
  const cues = clipsToCues(clips, 30);
  assert.deepEqual(cues.map((c) => c.text), ["FIRST LINE\n\nAFTER A BLANK", "Second", "Other track"]);
  const srt = writeSrt(cues);
  assert.equal(
    srt,
    "1\n00:00:00,500 --> 00:00:01,500\nFIRST LINE\nAFTER A BLANK\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond\n\n3\n00:00:02,333 --> 00:00:02,667\nOther track\n",
  );
  // One track only.
  assert.deepEqual(clipsToCues(clips, 30, { timelineIds: ["U"] }).map((c) => c.text), ["Other track"]);
  // Back in: the same times to the millisecond.
  const back = parseCaptions(srt).cues;
  assert.deepEqual(back.map((c) => [c.start, c.end]), [[0.5, 1.5], [2, 3], [2.333, 2.667]]);
  // Written at 24 fps from frames, read back onto frames: the same frames.
  const frames = [[0, 37], [37, 61], [61, 1000]];
  const fromFrames = frames.map(([s, e], k) => clip(`f${k}`, s, e, `c${k}`));
  const again = cueFrames(parseCaptions(writeSrt(clipsToCues(fromFrames, 24))).cues, 24);
  assert.deepEqual(again.map((c) => [c.startFrame, c.endFrame]), frames);
});
