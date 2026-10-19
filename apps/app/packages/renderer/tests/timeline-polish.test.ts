// Tests for the timeline polish: Linkage settings (src/lib/linkage.ts, closeGaps), the range
// (src/lib/range.ts), the pinned track layout (src/lib/timeline-view.ts) and the ruler's frame
// steps (src/lib/zoom.ts): `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { carriedClips, linkKindOf } from "../src/lib/linkage.ts";
import { closeGaps } from "../src/lib/timeline-edit.ts";
import { spanOf, withEnd } from "../src/lib/range.ts";
import { layoutTracks, trackAt, trackDy, trackView } from "../src/lib/timeline-view.ts";
import { getZoomLevelConfig, niceFrameStep } from "../src/lib/zoom.ts";

const track = (timelineId: string, type: string, timelineY: number, locked = false) => ({ timelineId, type, timelineY, timelineHeight: 54, timelinePadding: 0, timelineWidth: 0, muted: false, hidden: false, locked }) as any;
const clip = (clipId: string, type: string, timelineId: string, startFrame: number, endFrame: number, more: object = {}) => ({ clipId, type, timelineId, startFrame, endFrame, ...more }) as any;

const timelines = [track("tx", "text", 0), track("fx", "filter", 54), track("main", "media", 108)];
const clips = [
  clip("a", "video", "main", 0, 100),
  clip("b", "video", "main", 100, 200),
  clip("t1", "text", "tx", 10, 60),
  clip("t2", "text", "tx", 120, 150),
  clip("e1", "filter", "fx", 20, 80, { effectId: "glow" }),
  clip("f1", "filter", "fx", 105, 190),
];

test("a clip's Linkage kind is read from what it is", () => {
  assert.equal(linkKindOf(clip("x", "text", "tx", 0, 1)), "text");
  assert.equal(linkKindOf(clip("x", "sticker", "tx", 0, 1)), "stickers");
  assert.equal(linkKindOf(clip("x", "filter", "tx", 0, 1, { adjustment: true })), "adjust");
  assert.equal(linkKindOf(clip("x", "filter", "tx", 0, 1, { effectId: "glow" })), "effects");
  assert.equal(linkKindOf(clip("x", "filter", "tx", 0, 1)), "filters");
  assert.equal(linkKindOf(clip("x", "video", "o", 0, 1)), "overlay");
  assert.equal(linkKindOf(clip("x", "audio", "o", 0, 1, { assetId: "s" }), { s: { credit: { kind: "sound" } } } as any), "soundEffects");
  assert.equal(linkKindOf(clip("x", "audio", "o", 0, 1, { assetId: "m" })), "audio");
});

test("the main clip carries the on kinds that start over it", () => {
  const [a, b] = clips;
  const ids = (list: any[]) => list.map((c) => c.clipId).sort();
  assert.deepEqual(ids(carriedClips(clips, timelines, "main", [a], [])), ["e1", "t1"]);
  assert.deepEqual(ids(carriedClips(clips, timelines, "main", [b], [])), ["f1", "t2"]);
  // A kind switched off stays.
  assert.deepEqual(ids(carriedClips(clips, timelines, "main", [a], ["text"])), ["e1"]);
  assert.deepEqual(ids(carriedClips(clips, timelines, "main", [a, b], ["text", "effects", "filters"])), []);
  // A locked track's clips stay too.
  const locked = [track("tx", "text", 0, true), ...timelines.slice(1)];
  assert.deepEqual(ids(carriedClips(clips, locked, "main", [a], [])), ["e1"]);
});

test("closing a gap on the main track takes the overlays over its clips, by the kinds on", () => {
  const gapped = clips.map((c) => (c.clipId === "b" ? { ...c, startFrame: 130, endFrame: 230 } : c.clipId === "t2" ? { ...c, startFrame: 150, endFrame: 180 } : c));
  const ranOn = closeGaps(gapped, timelines, "main", null, true, { off: [] });
  const at = (list: any[], id: string) => list.find((c) => c.clipId === id).startFrame;
  assert.equal(at(ranOn, "b"), 100);
  assert.equal(at(ranOn, "t2"), 120);
  const ranOff = closeGaps(gapped, timelines, "main", null, true, { off: ["text"] });
  assert.equal(at(ranOff, "t2"), 150);
  // Without carry (linkage off) the overlays stay.
  assert.equal(at(closeGaps(gapped, timelines, "main", null, true), "t2"), 150);
});

test("In and Out set the ends and the range never crosses", () => {
  assert.deepEqual(withEnd(null, "in", 40, 300), { start: 40, end: 300 });
  assert.deepEqual(withEnd(null, "out", 90, 300), { start: 0, end: 90 });
  assert.deepEqual(withEnd({ start: 40, end: 90 }, "in", 10, 300), { start: 10, end: 90 });
  assert.equal(withEnd({ start: 40, end: 90 }, "in", 95, 300), null);
  assert.equal(withEnd({ start: 40, end: 90 }, "out", 40, 300), null);
  assert.deepEqual(spanOf([clips[1], clips[3]]), { start: 100, end: 200 });
  assert.equal(spanOf([]), null);
});

test("the main track is pinned at the bottom only when the tracks overflow", () => {
  const tracks = Array.from({ length: 8 }, (_, i) => track(`t${i}`, i === 7 ? "media" : "text", i * 54));
  const main = tracks[7];
  const fits = layoutTracks(tracks, main, 900, 0, 48);
  assert.equal(fits.pinned, false);
  assert.equal(fits.maxScroll, 0);
  const tight = layoutTracks(tracks, main, 400, 0, 48);
  assert.equal(tight.pinned, true);
  // The pinned track ends PIN_BOTTOM above the stage's bottom; the overlays scroll within what's above.
  assert.equal(tight.pin, 400 - 12 - (7 * 54 + 54 + 32));
  assert.ok(tight.maxScroll > 0);
  const scrolled = layoutTracks(tracks, main, 400, 50, 48);
  assert.equal(scrolled.over, -50);
  assert.equal(scrolled.pin, tight.pin);
  // A stage too short for any overlay room gives way to one scroll.
  const tiny = layoutTracks(tracks, main, 120, 30, 48);
  assert.equal(tiny.pinned, false);
  assert.equal(tiny.over, tiny.pin);
  // Where a point of the stage lands: the pinned track by its own offset.
  Object.assign(trackView, scrolled);
  assert.equal(trackDy(main), scrolled.pin);
  assert.equal(trackDy(tracks[0]), -50);
  const mainTop = 7 * 54 + 32 + scrolled.pin;
  assert.equal(trackAt(tracks, mainTop + 10)?.timelineId, "t7");
  Object.assign(trackView, { pinned: false, from: Infinity, over: 0, pin: 0 });
});

test("the ruler labels single frames when zoomed in", () => {
  assert.equal(niceFrameStep(1.6), 2);
  assert.equal(niceFrameStep(7), 10);
  assert.equal(niceFrameStep(0.2), 1);
  assert.equal(niceFrameStep(120), 200);
  const c = getZoomLevelConfig(10, [0, 5], 24, 10, 1);
  assert.deepEqual([c.minorTickFormat, c.minorTickInterval, c.majorTickInterval], ["frame", 1, 2]);
});
