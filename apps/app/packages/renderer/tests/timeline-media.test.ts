// Tests for what the new timeline's clips show of their media (src/lib/timeline/thumbs.ts, marks.ts):
// which frames a clip's tiles show through its trim, speed and direction, how the times are
// rounded so a zoom finds tiles it has, the tile store's cap and nearest tile, beat dots and the
// animation lines, and that a trimmed clip's bars stay on the sound.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STEP, MIN_STEP, TICKS_PER_SECOND, TILE_MIN_WIDTH, TileStore, gridStep, planTiles, tickOf, tileWidthFor } from "../src/lib/timeline/thumbs.ts";
import { BADGE_MIN_CLIP, beatDots, beatStep, motionMarks } from "../src/lib/timeline/marks.ts";
import { clipBars, windowRms } from "../src/lib/waveform.ts";

const clip = (more: object = {}) => ({ clipId: "c", type: "video", timelineId: "t", startFrame: 100, endFrame: 340, trimStart: 0, ...more }) as any;
const FPS = 24;

test("a tile is as wide as the picture at the band's height, and no narrower than the minimum", () => {
  assert.equal(tileWidthFor(16 / 9, 36), 64);
  assert.equal(tileWidthFor(9 / 16, 36), TILE_MIN_WIDTH);
  assert.equal(tileWidthFor(NaN, 60), 60);
});

test("a tile's time is rounded to a power of two that doesn't skip a tile, between a frame and a minute", () => {
  assert.equal(gridStep(0.0001), MIN_STEP);
  assert.equal(gridStep(0.3), 0.25);
  assert.equal(gridStep(1), 1);
  assert.equal(gridStep(5), 4);
  assert.equal(gridStep(1e6), MAX_STEP);
  assert.equal(tickOf(1.3, 0.25), 1.25 * TICKS_PER_SECOND);
  assert.equal(tickOf(-3, 0.25), 0);
  assert.ok(Number.isInteger(tickOf(7.77, MIN_STEP)));
});

test("every coarser grid time is a finer grid's too, so a coarse tile stands in for a fine one's place", () => {
  for (const t of [0.3, 1.7, 5.123, 40]) {
    for (let step = 1 / 32; step <= 32; step *= 2) {
      const coarse = tickOf(t, step * 2);
      assert.equal(tickOf(coarse / TICKS_PER_SECOND, step), coarse);
    }
  }
});

test("a scroll asks for the same tiles: a clip's tiles are at fixed places in it, whatever's on screen", () => {
  const c = clip();
  const all = planTiles({ clip: c, fps: FPS, pxPerFrame: 3, tileWidth: 64, fromPx: 0, toPx: 720 });
  const scrolled = planTiles({ clip: c, fps: FPS, pxPerFrame: 3, tileWidth: 64, fromPx: 200, toPx: 500 });
  for (const t of scrolled) assert.equal(t.tick, all[t.i].tick);
});

test("tiles run edge to edge from the clip's left, the first showing its first frame", () => {
  const tiles = planTiles({ clip: clip(), fps: FPS, pxPerFrame: 2, tileWidth: 64, fromPx: 0, toPx: 1000 });
  assert.equal(tiles[0].x, 0);
  assert.equal(tiles[0].tick, 0);
  tiles.forEach((t, i) => assert.equal(t.x, i * 64));
  // 240 frames at 2 px is 480 px: eight tiles cover it (the last partly).
  assert.equal(tiles.length, 8);
  assert.equal(tiles[1].tick, tickOf(32 / 2 / FPS, gridStep(32 / FPS)));
});

test("only the tiles on screen are planned", () => {
  const tiles = planTiles({ clip: clip(), fps: FPS, pxPerFrame: 2, tileWidth: 64, fromPx: 200, toPx: 300 });
  assert.deepEqual(tiles.map((t) => t.i), [3, 4]);
});

test("a trim moves the frames shown: the first tile is the in-point", () => {
  const tiles = planTiles({ clip: clip({ trimStart: 48 }), fps: FPS, pxPerFrame: 2, tileWidth: 64, fromPx: 0, toPx: 64 });
  // 48 frames in at 24 fps: 2 s.
  assert.equal(tiles[0].tick, 2 * TICKS_PER_SECOND);
});

test("speed spreads more media across a tile; a reversed clip shows the end first; a split's range offsets it", () => {
  const fast = planTiles({ clip: clip({ speed: 2 }), fps: FPS, pxPerFrame: 2, tileWidth: 64, fromPx: 64, toPx: 128 });
  const normal = planTiles({ clip: clip(), fps: FPS, pxPerFrame: 2, tileWidth: 64, fromPx: 64, toPx: 128 });
  // The tile's left edge is 16 clip frames in: 2/3 s of media, or twice that at double speed.
  assert.ok(fast[0].tick > normal[0].tick);
  const rev = planTiles({ clip: clip({ reverse: true }), fps: FPS, pxPerFrame: 2, tileWidth: 64, fromPx: 0, toPx: 64, mediaSeconds: 20 });
  assert.ok(rev[0].tick > 15 * TICKS_PER_SECOND, "a reversed clip starts at the media's end");
  const shifted = planTiles({ clip: clip(), fps: FPS, pxPerFrame: 2, tileWidth: 64, fromPx: 0, toPx: 64, mediaStart: 3 });
  assert.equal(shifted[0].tick, 3 * TICKS_PER_SECOND);
});

test("a tile never asks past the end of the media", () => {
  const tiles = planTiles({ clip: clip({ trimStart: 200 }), fps: FPS, pxPerFrame: 2, tileWidth: 64, fromPx: 0, toPx: 600, mediaSeconds: 12 });
  assert.ok(tiles.every((t) => t.tick <= 12 * TICKS_PER_SECOND));
});

test("a photo's tiles all show the same still", () => {
  const tiles = planTiles({ clip: clip({ type: "image" }), fps: FPS, pxPerFrame: 2, tileWidth: 64, fromPx: 0, toPx: 300, still: true });
  assert.equal(tiles.length, 5);
  assert.ok(tiles.every((t) => t.tick === 0));
});

test("the tile store keeps the recently used under its cap, and closes what it drops", () => {
  const dropped: string[] = [];
  const s = new TileStore<string>(100, (v) => dropped.push(v));
  s.set("a", 0, "a0", 40);
  s.set("a", 1, "a1", 40);
  s.get("a", 0);
  s.set("a", 2, "a2", 40);
  assert.deepEqual(dropped, ["a1"], "the least recently used goes");
  assert.equal(s.bytes, 80);
  assert.equal(s.has("a", 1), false);
  assert.equal(s.get("a", 0), "a0");
  s.set("b", 0, "big", 500);
  assert.equal(s.has("b", 0), true, "the tile just set stays even over the cap");
});

test("the nearest tile of a group stands in for one not fetched yet", () => {
  const s = new TileStore<string>(1000);
  for (const t of [0, 100, 400]) s.set("a", t, `a${t}`, 1);
  s.set("b", 150, "b150", 1);
  assert.equal(s.nearest("a", 140)?.value, "a100");
  assert.equal(s.nearest("a", 300)?.value, "a400");
  assert.equal(s.nearest("a", 50)?.tick, 0, "a tie takes the earlier");
  assert.equal(s.nearest("a", 9999)?.value, "a400");
  assert.equal(s.nearest("c", 1), undefined);
  assert.equal(s.nearest("b", 0)?.value, "b150", "groups don't mix");
  s.clear();
  assert.equal(s.size, 0);
});

test("beat dots are thinned when they'd be closer than 6 px, and kept to the screen", () => {
  assert.equal(beatStep(1000, 10), 1);
  assert.equal(beatStep(100, 100), 6);
  const frames = Array.from({ length: 100 }, (_, i) => 100 + i * 2);
  const all = beatDots(frames, 100, 200, 5, 0, 1000);
  assert.equal(all.length, 100);
  const some = beatDots(frames, 100, 200, 5, 100, 200);
  assert.ok(some.length > 0 && some.every((x) => x >= 96 && x <= 204));
  assert.ok(beatDots(frames, 100, 200, 0.5, 0, 100).length <= 20, "thinned when zoomed out");
});

test("a clip's animations draw lines along its foot and its speed a badge, on a selected one wide enough", () => {
  const v = clip({ animationIn: { duration: 1 }, animationOut: { duration: 0.5 }, speed: 2 });
  const m = motionMarks(v, 300, 54, FPS, true);
  assert.equal(m.arrows.length, 2);
  assert.equal(m.arrows[0].x0, 2);
  assert.ok(m.arrows[0].x1 > m.arrows[0].x0 && m.arrows[1].x1 < m.arrows[1].x0, "the Out line points back from the end");
  assert.equal(m.y, 51);
  assert.equal(m.badge?.label, "2.00x ▸");
  assert.equal(m.badge?.x, 300 - 46 - 4);
  assert.equal(motionMarks(v, 300, 54, FPS, false).badge, null, "only on a selected clip");
  assert.equal(motionMarks(v, BADGE_MIN_CLIP, 54, FPS, true).badge, null, "not on a clip 106 px or narrower");
  assert.equal(motionMarks(clip({ freeze: { at: 1 } }), 300, 54, FPS, true).badge, null, "not on a freeze frame");
  assert.equal(motionMarks(clip({ animationLoop: { duration: 1 } }), 300, 54, FPS, false).dashed, true);
  assert.equal(motionMarks(clip(), 300, 54, FPS, false).dashed, false);
});

test("a trimmed clip's bars stay on its sound: the loud second is where the media plays it", () => {
  // Ten seconds of sound, loud only from 4 s to 5 s.
  const rms = new Float32Array(10 * 200).fill(0.001);
  rms.fill(0.5, 4 * 200, 5 * 200);
  const buckets = { perSecond: 200, rms };
  assert.ok(windowRms(buckets, 4.2, 4.3) > 100 * windowRms(buckets, 1, 1.1));
  const scale = { full: 30.5, line: 13, lag: 0 };
  const loudAt = (trimStart: number) => {
    const c = clip({ type: "audio", startFrame: 0, endFrame: 240, trimStart });
    const bars = clipBars(c, buckets, { fps: FPS, pxPerFrame: 1, fromPx: 0, toPx: 240, scale, max: 30 });
    return bars.reduce((best, b) => (b.h > best.h ? b : best), { x: 0, h: 0 }).x;
  };
  // Untrimmed the loud second is at 4 s: frames 96..120. Trimmed 2 s (48 frames) off the start it's 48 px sooner.
  const before = loudAt(0);
  const after = loudAt(48);
  assert.ok(before >= 96 && before <= 120);
  assert.ok(Math.abs(before - after - 48) <= 2);
});
