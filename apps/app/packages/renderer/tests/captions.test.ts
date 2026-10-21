// Tests for src/lib/captions.ts: `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { captionClips, clipsToCues, cueFrames, formatSrtTime, parseAss, parseCaptions, parseLrc, parseSubtitles, parseTime, sampleCaption, SAMPLE_CAPTION, writeSrt } from "../src/lib/captions.ts";
import { CAPTION_PRESETS } from "../src/lib/caption-presets.ts";
import type { TextClipProps } from "../src/lib/types.ts";

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

test("the sample caption is said about the playhead, its third word at the playhead, in the style tried", () => {
  const boxed = CAPTION_PRESETS.find((p) => p.id === "boxed-yellow")!.props;
  const canvas = { width: 1066.67, height: 600 };
  // The word being said at a frame, as the engine times it: clip-local seconds plus how far into its speech the clip starts.
  const said = (clip: TextClipProps, frame: number, fps: number) => {
    const t = (frame - clip.startFrame) / fps + (clip.spokenFrom ?? 0);
    const w = clip.captionWords!.find((w) => w.start <= t && t < w.end);
    return w && clip.text!.slice(w.from, w.to);
  };
  const { timeline, clip } = sampleCaption(boxed, { fps: 24, canvas, at: 100, id: "s" });
  assert.equal(clip.text, SAMPLE_CAPTION);
  assert.deepEqual(clip.captionWords!.map((w) => clip.text!.slice(w.from, w.to)), SAMPLE_CAPTION.split(" "));
  assert.equal(said(clip, 100, 24), "look");
  assert.deepEqual([clip.startFrame, clip.endFrame, clip.spokenFrom], [73, 151, 0]);
  assert.deepEqual([clip.captionStyle, clip.captionColor, clip.strokeEnabled], ["orip_boxed", "#ffe600", true]);
  // On a captions track of its own, its box where captions go.
  assert.deepEqual([timeline.timelineId, timeline.captions, clip.timelineId, clip.clipId], ["s", true, "s", "s"]);
  assert.deepEqual(clip.transform, captionClips([{ start: 0, end: 1, text: SAMPLE_CAPTION }], { fps: 24, canvas, style: boxed, makeId: () => "x" }).clips[0].transform);
  // Near the timeline's start it starts at 0, cut into its speech: the same word at the playhead, and it runs on past it.
  const early = sampleCaption(boxed, { fps: 30, canvas, at: 10, id: "s" }).clip;
  assert.equal(early.startFrame, 0);
  assert.ok(early.spokenFrom! > 0);
  assert.equal(said(early, 10, 30), "look");
  assert.ok(early.endFrame > 10 + 30);
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

test("an LRC file reads: tags, repeated times, offset, word tags, ends at the next line", () => {
  const lrc = [
    "[ti:Song]",
    "[ar:Someone]",
    "[offset:+500]",
    "[00:01.50]First line",
    "[00:04.00]<00:04.00>Second <00:04.50>line",
    "[00:06.00]",
    "[00:08.00][00:20.25]Chorus",
    "[00:30:50]Last, with a colon fraction",
    "not a lyric line",
  ].join("\r\n");
  const { cues, skipped } = parseLrc(lrc);
  assert.equal(skipped, 1);
  assert.deepEqual(
    cues.map((c) => [c.start, c.end, c.text]),
    [
      [1, 3.5, "First line"],
      // An empty line at 6 s ends the one before it (offset 0.5 s earlier: 5.5 s).
      [3.5, 5.5, "Second line"],
      [7.5, 19.75, "Chorus"],
      [19.75, 30, "Chorus"],
      [30, 33, "Last, with a colon fraction"],
    ],
  );
});

test("LRC lines at the same time become one two-line cue", () => {
  const { cues } = parseLrc("[00:01.00]Hello\n[00:01.00]Bonjour\n[00:03.00]Next");
  assert.equal(cues.length, 2);
  assert.deepEqual([cues[0].start, cues[0].end, cues[0].text], [1, 3, "Hello\nBonjour"]);
});

test("an ASS file reads its dialogue by the Format line: commas in text, line breaks, overrides, comments", () => {
  const ass = [
    "[Script Info]",
    "Title: x",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour",
    "Style: Default,Arial,20,&H00FFFFFF",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\an8\\pos(10,10)}Hello, {\\i1}world{\\i0}\\Nsecond line",
    "Comment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,not shown",
    "Dialogue: 0,0:00:00.25,0:00:00.75,Default,,0,0,0,,Earlier\\hone",
    "Dialogue: 0,0:00:09.00,0:00:08.00,Default,,0,0,0,,backwards",
    "Dialogue: 0,0:01:02.50,0:01:03.00,Default,,0,0,0,,",
  ].join("\n");
  const { cues, skipped } = parseAss(ass);
  assert.equal(skipped, 2);
  assert.deepEqual(
    cues.map((c) => [c.start, c.end, c.text]),
    [
      [0.25, 0.75, "Earlier one"],
      [1, 3.5, "Hello, world\nsecond line"],
    ],
  );
});

test("an SSA file with its own column order reads", () => {
  const ssa = ["[Events]", "Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", "Dialogue: Marked=0,0:00:02.00,0:00:04.00,Default,,0,0,0,,Old style"].join("\n");
  assert.deepEqual(parseAss(ssa).cues, [{ start: 2, end: 4, text: "Old style" }]);
});

test("parseSubtitles picks the reader by extension, then by contents", () => {
  assert.equal(parseSubtitles("[00:01.00]a", "x.lrc").cues.length, 1);
  assert.equal(parseSubtitles("[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,,,0,0,0,,a", "x.ass").cues.length, 1);
  assert.equal(parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\na\n", "x.srt").cues.length, 1);
  assert.equal(parseSubtitles("[00:01.00]a\n[00:02.00]b").cues.length, 2);
  assert.equal(parseSubtitles("[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,,,0,0,0,,a").cues.length, 1);
  assert.equal(parseSubtitles("WEBVTT\n\n00:01.000 --> 00:02.000\na\n").cues.length, 1);
});
