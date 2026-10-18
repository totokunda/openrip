// Tests for the timeline's waveforms: src/lib/waveform.ts. `node --test tests/` in
// packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_SCALE,
  BAND_SCALE,
  BAR_PITCH,
  DB_RANGE,
  FIRST_BAR,
  barHeight,
  clipBars,
  gainDbAt,
  mediaBands,
  scaleFor,
  soundKindOf,
  volumeLine,
  windowRms,
  type WaveformBuckets,
} from "../src/lib/waveform.ts";
import type { AudioClipProps } from "../src/lib/types.ts";

const close = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

const FPS = 30;
/** 10 s of buckets at 200 a second, each `level(t)`. */
const buckets = (level: (t: number) => number, seconds = 10): WaveformBuckets => {
  const rms = new Float32Array(seconds * 200);
  for (let i = 0; i < rms.length; i++) rms[i] = level(i / 200);
  return { perSecond: 200, rms };
};
const clip = (over: Partial<AudioClipProps> = {}): AudioClipProps => ({ clipId: "a", timelineId: "t", type: "audio", assetId: "x", startFrame: 0, endFrame: 300, trimStart: 0, trimEnd: 0, speed: 1, ...over });
const opts = { fps: FPS, pxPerFrame: 1, fromPx: 0, toPx: 1e6, scale: AUDIO_SCALE, max: 50 };
/** A bar's height at `db` of RMS on the audio clip's scale, to half a pixel. */
const expected = (db: number) => Math.round(AUDIO_SCALE.full * (1 + db / DB_RANGE) * 2) / 2;

test("a bar's height is CapCut's dB scale, to half a pixel", () => {
  assert.equal(barHeight(1, 0, AUDIO_SCALE.full, 50), 30.5, "full scale");
  assert.equal(barHeight(0.1, 0, AUDIO_SCALE.full, 50), expected(-20), "−20 dB");
  assert.equal(barHeight(Math.pow(10, -DB_RANGE / 20), 0, AUDIO_SCALE.full, 50), 0, "nothing at the floor");
  assert.equal(barHeight(0, 0, AUDIO_SCALE.full, 50), 0);
  assert.equal(barHeight(0.1, -6, AUDIO_SCALE.full, 50), expected(-26), "the gain counts in dB");
  assert.equal(barHeight(1, 20, AUDIO_SCALE.full, 30), 30, "never past the area");
  assert.equal(barHeight(0.1, -Infinity, AUDIO_SCALE.full, 50), 0, "a fade's end");
});

test("a window's RMS is its buckets' energy, at least one bucket", () => {
  const b = buckets((t) => (t < 1 ? 0.1 : 0.3));
  close(windowRms(b, 0, 0.5), 0.1, 1e-6, "inside the quiet part");
  close(windowRms(b, 0.995, 1.005), Math.sqrt((0.01 + 0.09) / 2), 1e-6, "across the change");
  close(windowRms(b, 2, 2), 0.3, 1e-6, "an empty window reads its bucket");
  assert.equal(windowRms(b, 20, 21), 0, "past the end");
});

test("bars: 1 px every 2 px from 1.5 px, with the clip's volume and fades", () => {
  const steady = buckets(() => 0.1);
  const bars = clipBars(clip(), steady, opts);
  assert.equal(bars[0].x, FIRST_BAR);
  assert.equal(bars[1].x - bars[0].x, BAR_PITCH);
  assert.ok(bars.every((b) => b.h === expected(-20)), "a steady tone, steady bars");
  assert.ok(clipBars(clip({ volume: -6 }), steady, opts).every((b) => b.h === expected(-26)));
  // A 1 s fade in: a sliver at its start, full bars after it.
  const faded = clipBars(clip({ fadeIn: 1 }), steady, opts);
  assert.ok(faded[0].h < 4 && faded.find((b) => b.x > 40)!.h === expected(-20), JSON.stringify(faded.slice(0, 3)));
  // Only what's on screen.
  const some = clipBars(clip(), steady, { ...opts, fromPx: 100, toPx: 120 });
  assert.deepEqual(some.map((b) => b.x), [101.5, 103.5, 105.5, 107.5, 109.5, 111.5, 113.5, 115.5, 117.5, 119.5]);
  assert.deepEqual(clipBars({ ...clip(), freeze: { at: 1, frame: 30 } } as never, steady, opts), [], "a freeze frame is silent");
});

test("bars follow the media through trims, speed and reverse, the audio clip's 2 px late and the band's on time", () => {
  // Loud only between 4 and 5 s of the media.
  const b = buckets((t) => (t >= 4 && t < 5 ? 0.5 : 0.001));
  const loudAt = (c: AudioClipProps, scale = AUDIO_SCALE) => {
    const bars = clipBars(c, b, { ...opts, scale }).filter((x) => x.h > 10);
    return [bars[0].x / FPS, bars[bars.length - 1].x / FPS];
  };
  const lag = AUDIO_SCALE.lag / FPS;
  const [s0, e0] = loudAt(clip());
  close(s0, 4 + lag, 0.05, "as it plays, 2 px late");
  close(e0, 5 + lag, 0.05, "as it plays, 2 px late");
  const [s4] = loudAt(clip(), BAND_SCALE);
  close(s4, 4, 0.05, "the band's on time");
  const [s1] = loudAt(clip({ trimStart: 60 }));
  close(s1, 2 + lag, 0.05, "trimmed 2 s, the loud part 2 s earlier");
  const [s2, e2] = loudAt(clip({ speed: 2, endFrame: 150 }));
  close(s2, 2 + lag, 0.05, "twice as fast");
  close(e2, 2.5 + lag, 0.05, "twice as fast");
  const [s3] = loudAt(clip({ reverse: true }));
  close(s3, 5 + lag, 0.05, "backward, the loud part 10 − 5 s in");
});

test("the volume line: 13 px at 0 dB, with the volume on the bars' scale, down through the fades", () => {
  const flat = volumeLine(clip(), opts);
  assert.equal(flat.length, 2);
  assert.equal(flat[0].h, 13);
  close(volumeLine(clip({ volume: 6 }), opts)[0].h, 13 + (6 * AUDIO_SCALE.full) / DB_RANGE, 1e-9, "a louder clip's line higher");
  const faded = volumeLine(clip({ fadeIn: 1, fadeOut: 1 }), opts);
  assert.equal(faded[0].h, 0, "a fade starts it at the bottom");
  assert.equal(faded[faded.length - 1].h, 0, "and ends it there");
  close(faded.find((p) => p.x > 60)!.h, 13, 1e-9, "level between them");
  close(gainDbAt(clip({ fadeIn: 1 }), 15, FPS), 20 * Math.log10(0.5), 1e-9, "halfway through a fade, −6 dB");
  assert.equal(volumeLine(clip(), { ...opts, scale: BAND_SCALE })[0].h, 6.5, "6.5 px in a video's band");
});

test("media bands, kinds and sizes", () => {
  assert.deepEqual(mediaBands(76, true), { label: 17, thumbs: 43, sound: 16 });
  assert.deepEqual(mediaBands(52, false), { label: 18, thumbs: 21, sound: 13 });
  assert.equal(soundKindOf({ path: "file:///m/IMG_1.MOV#audio", type: "audio" }), "extracted");
  assert.equal(soundKindOf({ path: "file:///m/IMG_1.MOV", type: "video" }), "extracted");
  assert.equal(soundKindOf({ path: "file:///u/media/p/voiceover/Voiceover%201.wav", type: "audio" }), "voiceover");
  assert.equal(soundKindOf({ path: "file:///Music/song.mp3", type: "audio" }), "music");
  assert.deepEqual(scaleFor(AUDIO_SCALE, 50, 50, 30), AUDIO_SCALE);
  assert.deepEqual(scaleFor(AUDIO_SCALE, 50, 50, 60), { full: 61, line: 26, lag: 2 }, "60% doubles bars and line");
  assert.deepEqual(scaleFor(AUDIO_SCALE, 70, 50, 30), { full: 30.5 * 1.4, line: 13 * 1.4, lag: 2 }, "Tall");
});
