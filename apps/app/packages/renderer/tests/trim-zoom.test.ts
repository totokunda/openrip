// Tests for src/lib/trim-clip.ts (Trim clip) and src/lib/zoom.ts (the zoom range): `node --test tests/`
// in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canTrimClip, sourceSecondsAt, trimExtent, trimPatch } from "../src/lib/trim-clip.ts";
import { OVERVIEW_SECONDS, zoomDuration, zoomLevelFor } from "../src/lib/zoom.ts";

const clip = (over: Record<string, unknown> = {}) =>
  ({ clipId: "c", type: "video", assetId: "a", startFrame: 100, endFrame: 200, trimStart: 20, trimEnd: -30, ...over }) as any;

test("trimExtent puts the whole source on the timeline's scale", () => {
  assert.deepEqual(trimExtent(clip()), { total: 150, start: 20, end: 120 });
  assert.deepEqual(trimExtent(clip({ trimStart: undefined, trimEnd: undefined })), { total: 100, start: 0, end: 100 });
});

test("trimPatch sets the in and out, keeps the clip's start, and moves the keys with the content", () => {
  const c = clip({ keyframes: { opacity: [{ frame: 50, value: 1 }] } });
  const p = trimPatch(c, 30, 90) as any;
  assert.equal(p.trimStart, 30);
  assert.equal(p.trimEnd, -60);
  assert.equal(p.endFrame, 100 + 60);
  assert.equal(p.keyframes.opacity[0].frame, 40);
});

test("trimPatch keeps at least a frame and stays inside the source", () => {
  const p = trimPatch(clip(), -10, 5000) as any;
  assert.equal(p.trimStart, 0);
  assert.equal(p.trimEnd, 0);
  assert.equal(p.endFrame, 100 + 150);
  const q = trimPatch(clip(), 100, 100) as any;
  assert.equal(q.endFrame - 100, 1);
});

test("Trim clip applies to video and sound clips without a freeze or a speed curve", () => {
  assert.equal(canTrimClip(clip()), true);
  assert.equal(canTrimClip(clip({ type: "image" })), false);
  assert.equal(canTrimClip(clip({ freeze: { at: 1 } })), false);
  assert.equal(canTrimClip(clip({ speedCurve: { points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] } })), false);
});

test("sourceSecondsAt follows the speed and the direction", () => {
  assert.equal(sourceSecondsAt(clip({ speed: 2 }), 24, 24, 10), 2);
  assert.equal(sourceSecondsAt(clip({ reverse: true }), 24, 24, 10), 9);
});

test("the zoom runs from two minutes (or the whole timeline when longer) down to a few frames", () => {
  const fps = 24;
  const short = 34 * fps;
  assert.equal(zoomDuration(1, 1, 10, short, fps), OVERVIEW_SECONDS * fps);
  assert.equal(zoomDuration(10, 1, 10, short, fps), 5);
  const long = 600 * fps;
  assert.equal(zoomDuration(1, 1, 10, long, fps), long);
  let prev = Infinity;
  for (let l = 1; l <= 10; l++) {
    const d = zoomDuration(l, 1, 10, short, fps);
    assert.ok(d < prev);
    prev = d;
  }
  assert.equal(zoomLevelFor(short, 1, 10, short, fps) > 1, true);
  assert.equal(zoomLevelFor(OVERVIEW_SECONDS * fps, 1, 10, short, fps), 1);
});
