// Tests for the new timeline's view, ruler ticks, layout and hit-testing (src/lib/timeline/:
// docs/plan/timeline-rewrite.md): `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frameAt, frameNear, pxPerFrame, viewOf, xOf } from "../src/lib/timeline/view.ts";
import { majorStep, tickLabel, ticksFor } from "../src/lib/timeline/ticks.ts";
import { hitTest, layoutTimeline, trimGrab, OVERLAY_TOP } from "../src/lib/timeline/layout.ts";
import { clipLook, fileName, timecode } from "../src/lib/timeline/appearance.ts";

const track = (timelineId: string, type: string, timelineY: number, timelineHeight = 60, more: object = {}) =>
  ({ timelineId, type, timelineY, timelineHeight, timelinePadding: 50, timelineWidth: 0, muted: false, hidden: false, ...more }) as any;
const clip = (clipId: string, type: string, timelineId: string, startFrame: number, endFrame: number, more: object = {}) =>
  ({ clipId, type, timelineId, startFrame, endFrame, ...more }) as any;

test("the view maps frames to pixels from time 0's column, and back", () => {
  const v = viewOf([0, 240], 1050);
  assert.equal(v.x0, 50);
  assert.equal(pxPerFrame(v), 1000 / 240);
  assert.equal(xOf(v, 0), 50);
  assert.equal(xOf(v, 240), 1050);
  assert.equal(frameAt(v, 550), 120);
  assert.equal(frameNear(v, 10), 0, "nothing before frame 0");
  const scrolled = viewOf([120, 360], 1050);
  assert.equal(xOf(scrolled, 120), 50);
  assert.equal(Math.round(frameAt(scrolled, 1050)), 360);
});

test("ruler labels are as CapCut's: every 5 s at its default zoom, 30 s zoomed out, frames zoomed in", () => {
  // CapCut's default: 37.35 px a second.
  assert.equal(majorStep(viewOf([0, (1000 / 37.35) * 24], 1050), 24), 5 * 24);
  // Zoomed out: about 4 px a second.
  assert.equal(majorStep(viewOf([0, 250 * 24], 1050), 24), 30 * 24);
  // Zoomed all the way in: a few frames across.
  assert.equal(majorStep(viewOf([0, 10], 1050), 24), 1);
  assert.equal(tickLabel(5 * 24, 24), "00:05");
  assert.equal(tickLabel(65 * 24, 24), "01:05");
  assert.equal(tickLabel(3725 * 24, 24), "1:02:05");
  assert.equal(tickLabel(30, 24), "6f");
  const ticks = ticksFor(viewOf([0, 30 * 24], 1050), 24);
  assert.ok(ticks[0].frame === 0 && ticks[0].major && ticks[0].label === "00:00");
  const majors = ticks.filter((t) => t.major);
  assert.ok(majors.every((t, i) => i === 0 || t.x - majors[i - 1].x >= 90), "labels at least 90 px apart");
  assert.ok(ticks.some((t) => !t.major), "minor ticks between them");
  assert.ok(ticksFor(viewOf([-50, 100], 1050), 24).every((t) => t.frame >= 0), "no ticks before 0");
});

test("rows sit where the saved tracks put them, a band the gap shorter, and clips on them", () => {
  const tracks = [track("tx", "text", 0, 32), track("main", "media", 32, 84)];
  const clips = [clip("t", "text", "tx", 0, 48), clip("a", "video", "main", 0, 120), clip("b", "video", "main", 120, 240), clip("far", "video", "main", 2400, 2500)];
  const l = layoutTimeline({ clips, tracks, view: viewOf([0, 240], 1050), width: 1050, height: 400, scrollY: 0 });
  assert.deepEqual(l.rows.map((r) => [r.id, r.top, r.height, r.main]), [["tx", 32, 24, false], ["main", 64, 76, true]]);
  assert.deepEqual(l.clips.map((c) => c.id), ["t", "a", "b"], "the clip far out of view isn't laid out");
  const b = l.clips.find((c) => c.id === "b")!;
  assert.equal(b.x, 550);
  assert.equal(b.w, 500);
  assert.equal(b.y, 64);
  assert.equal(b.h, 76);
});

test("with more tracks than fit, the main track stays pinned at the bottom and the overlays scroll", () => {
  const tracks = [...Array.from({ length: 6 }, (_, i) => track(`o${i}`, "text", i * 32, 32)), track("main", "media", 192, 84)];
  const l = layoutTimeline({ clips: [], tracks, view: viewOf([0, 240], 1050), width: 1050, height: 260, scrollY: 0 });
  const main = l.rows.find((r) => r.main)!;
  assert.ok(l.tracks.pinned && main.pinned);
  assert.ok(main.top + main.height <= 260, "the main track's band is on screen");
  const scrolled = layoutTimeline({ clips: [], tracks, view: viewOf([0, 240], 1050), width: 1050, height: 260, scrollY: 40 });
  assert.equal(scrolled.rows.find((r) => r.main)!.top, main.top, "scrolling leaves the main track where it is");
  assert.equal(scrolled.rows[0].top, l.rows[0].top - Math.min(40, l.tracks.maxScroll), "and moves the overlays");
});

test("a press finds the ruler, a clip and its edges, a track's empty space", () => {
  const tracks = [track("main", "media", 0, 84)];
  const clips = [clip("a", "video", "main", 0, 120), clip("b", "video", "main", 120, 240)];
  const l = layoutTimeline({ clips, tracks, view: viewOf([0, 480], 1050), width: 1050, height: 300, scrollY: 0 });
  const trims = (id: string) => (box: { id: string }) => box.id === id;
  assert.equal(hitTest(l, 300, OVERLAY_TOP - 2, trims("a")).kind, "ruler");
  const body = hitTest(l, 150, 60, trims("a"));
  assert.ok(body.kind === "clip" && body.box.id === "a" && body.edge === null);
  // a's right edge and b's left edge meet at x 300: each grab zone is inside its own clip.
  const aEdge = hitTest(l, 296, 60, trims("a"));
  assert.ok(aEdge.kind === "clip" && aEdge.box.id === "a" && aEdge.edge === "right", "5 px inside a's end takes a's edge");
  const bEdge = hitTest(l, 304, 60, trims("b"));
  assert.ok(bEdge.kind === "clip" && bEdge.box.id === "b" && bEdge.edge === "left");
  const unselected = hitTest(l, 304, 60, trims("a"));
  assert.ok(unselected.kind === "clip" && unselected.edge === null, "an unselected clip's edge doesn't take hold");
  assert.equal(hitTest(l, 700, 60, trims("a")).kind, "row");
  assert.equal(hitTest(l, 700, 250, trims("a")).kind, "none");
  assert.equal(trimGrab(12), 4, "a short clip keeps two thirds of itself to drag by");
});

test("clips look as their kind: media chips with name and length, bars with their words", () => {
  assert.equal(timecode(24 * 65 + 3, 24), "00:01:05:03");
  assert.equal(fileName("file:///a/b/My%20clip.mov#audio"), "My clip.mov");
  const v = clipLook(clip("a", "video", "m", 0, 48), { path: "file:///x/IMG_1.MOV", type: "video" } as any, 24, 76, true);
  assert.deepEqual(v.chips, ["IMG_1.MOV", "00:00:02:00"]);
  assert.ok(v.bands && v.bands.label === 17 && v.bands.sound === 16, "the main track's bands");
  const t = clipLook(clip("t", "text", "x", 0, 48, { text: "Hello\nthere" }), undefined, 24, 24, false);
  assert.deepEqual(t.chips, ["Hello there"]);
  assert.equal(t.chipsOnTop, false);
  const e = clipLook(clip("e", "filter", "x", 0, 48, { effectId: "glow", name: "Glow" }), undefined, 24, 24, false);
  assert.equal(e.glyph, "effect");
});
