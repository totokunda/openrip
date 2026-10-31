// Tests for the new timeline's moves and trims (src/lib/timeline/core/edit.ts), each a CapCut
// behaviour: `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitOnTrack, goingWith, moveClips, nearestFree, trimEdge, type Doc } from "../src/lib/timeline/core/edit.ts";
import { resolveOverlapsTimelines } from "../src/lib/timeline/core/tracks.ts";

const track = (timelineId: string, type: string, more: object = {}) => ({ timelineId, type, timelineY: 0, timelineHeight: 0, timelinePadding: 50, timelineWidth: 0, muted: false, hidden: false, ...more }) as any;
const clip = (clipId: string, type: string, timelineId: string, startFrame: number, endFrame: number, more: object = {}) =>
  ({ clipId, type, timelineId, startFrame, endFrame, trimStart: 0, trimEnd: 0, ...more }) as any;
const doc = (clips: any[], tracks: any[]): Doc => ({ clips, tracks: resolveOverlapsTimelines(tracks) });
const at = (d: Doc, id: string) => {
  const c = d.clips.find((x) => x.clipId === id)!;
  return [c.startFrame, c.endFrame, c.timelineId];
};
const magnet = { magnet: true, linkage: true, fps: 24 };
const free = { magnet: false, linkage: true, fps: 24 };
// A 10 s video cut at 4 s on the main track (its media runs 0–240), a text over it, music under.
const base = () =>
  doc(
    [
      clip("A", "video", "main", 0, 96, { trimEnd: -144 }),
      clip("B", "video", "main", 96, 240, { trimStart: 96 }),
      clip("T", "text", "tx", 0, 48, { trimStart: Infinity, trimEnd: -Infinity }),
      clip("M", "audio", "au", 0, 240),
    ],
    [track("tx", "text"), track("main", "media"), track("au", "audio")],
  );

test("a trimmed edge comes back out: from the trim's start, in and out again in one drag", () => {
  const d = base();
  const inward = trimEdge(d, free, "A", "right", -48);
  assert.deepEqual(at(inward.doc, "A"), [0, 48, "main"]);
  assert.equal(inward.doc.clips.find((c) => c.clipId === "A")!.trimEnd, -192);
  // The gesture recomputes from the document at its start: out past where it began is fine
  // while there's media and room.
  const back = trimEdge(inward.doc, free, "A", "right", 24);
  assert.deepEqual(at(back.doc, "A"), [0, 72, "main"]);
  const outThenIn = trimEdge(d, free, "A", "right", -24);
  assert.deepEqual(at(outThenIn.doc, "A"), [0, 72, "main"]);
});

test("off the magnetic main track an edge stops at the clip next to it and at its media", () => {
  const d = base();
  // Magnet off: A can't grow into B.
  assert.equal(trimEdge(d, free, "A", "right", 50).applied, 0);
  const shorter = trimEdge(d, free, "A", "right", -30).doc;
  assert.equal(trimEdge(shorter, free, "A", "right", 50).applied, 30, "back to where B starts");
  // B's left edge can't go past its media's start (trimStart 96) nor into A.
  assert.equal(trimEdge(d, free, "B", "left", -200).applied, 0, "A is right there");
  // The text has no media to run out of, and goes down to a frame long.
  assert.equal(trimEdge(d, free, "T", "right", -100).applied, -47);
});

test("on the magnetic main track a trim ripples the clips after it", () => {
  const d = base();
  const out = trimEdge(d, magnet, "A", "right", -24).doc;
  assert.deepEqual(at(out, "A"), [0, 72, "main"]);
  assert.deepEqual(at(out, "B"), [72, 216, "main"], "B closes up");
  const grow = trimEdge(out, magnet, "A", "right", 24).doc;
  assert.deepEqual(at(grow, "B"), [96, 240, "main"], "and is pushed back out");
  // B's left edge trimmed in: it stays against A, its media starting later, and shortens.
  const left = trimEdge(d, magnet, "B", "left", 24).doc;
  assert.deepEqual(at(left, "B"), [96, 216, "main"]);
  assert.equal(left.clips.find((c) => c.clipId === "B")!.trimStart, 120);
});

test("a trim takes the clip's linked clips with it, linkage on", () => {
  const d = doc(
    [clip("V", "video", "main", 0, 100, { linkId: "L", trimEnd: -50 }), clip("S", "audio", "au", 0, 100, { linkId: "L", trimEnd: -50 })],
    [track("main", "media"), track("au", "audio")],
  );
  const t = trimEdge(d, free, "V", "right", -20).doc;
  assert.deepEqual([at(t, "V")[1], at(t, "S")[1]], [80, 80]);
  const off = trimEdge(d, { ...free, linkage: false }, "V", "right", -20).doc;
  assert.equal(at(off, "S")[1], 100, "linkage off: the sound stays");
  const locked = doc(d.clips, [track("main", "media"), track("au", "audio", { locked: true })]);
  assert.equal(trimEdge(locked, free, "V", "right", -20).applied, 0, "a linked clip on a locked track holds it");
});

test("a moved clip goes to the free spot nearest where it's dropped", () => {
  const others = [clip("x", "text", "t", 10, 20), clip("y", "text", "t", 30, 40)];
  assert.equal(nearestFree(others, 22, 5), 22, "it fits where it is");
  assert.equal(nearestFree(others, 25, 8), 22, "nudged into the gap");
  assert.equal(nearestFree(others, 12, 15), 40, "too long for the gaps: after the last");
  assert.equal(nearestFree(others, -5, 4), 0);
  const d = base();
  assert.equal(fitOnTrack(d.clips, "tx", new Set(["T"]), 200, 48), 200);
});

test("with the magnet on, a clip dragged in before another goes in there and the track packs", () => {
  const d = base();
  // B dragged before A: in at frame 0, then A.
  const out = moveClips(d, magnet, { lead: "B", followers: [], delta: -96, track: "main", insertAt: 0 });
  assert.deepEqual(at(out, "B"), [0, 144, "main"]);
  assert.deepEqual(at(out, "A"), [144, 240, "main"]);
  // A dragged onto a new overlay track: the main track closes up behind it.
  const off = moveClips(d, magnet, { lead: "A", followers: [], delta: 0, track: "new", newTrack: { index: 1, type: "media" } });
  assert.deepEqual(at(off, "A"), [0, 96, "new"]);
  assert.deepEqual(at(off, "B"), [0, 144, "main"]);
  assert.deepEqual(off.tracks.map((t) => t.timelineId), ["tx", "new", "main", "au"]);
});

test("what's selected with the dragged clip moves with it, the rest stays", () => {
  const d = base();
  const out = moveClips(d, free, { lead: "B", followers: ["T"], delta: 36, track: "main" });
  assert.deepEqual(at(out, "B"), [132, 276, "main"]);
  assert.deepEqual(at(out, "T"), [36, 84, "tx"]);
  assert.deepEqual(at(out, "A"), [0, 96, "main"]);
  assert.equal(out.clips.find((c) => c.clipId === "A"), d.clips.find((c) => c.clipId === "A"), "untouched clips are the same objects");
  // None go before frame 0: the move stops as soon as one would.
  const left = moveClips(d, free, { lead: "B", followers: ["T"], delta: -500, track: "main" });
  assert.deepEqual(at(left, "T"), [0, 48, "tx"]);
});

test("a clip going along that would land on another goes to the nearest free spot", () => {
  const d = doc(
    [clip("a", "text", "t1", 0, 24), clip("b", "text", "t2", 30, 60), clip("wall", "text", "t2", 60, 90)],
    [track("t1", "text"), track("t2", "text")],
  );
  const out = moveClips(d, free, { lead: "a", followers: ["b"], delta: 20, track: "t1" });
  assert.deepEqual(at(out, "a"), [20, 44, "t1"]);
  // b would be at 50–80, over the wall at 60: the nearest free spot is just before it.
  assert.deepEqual(at(out, "b"), [30, 60, "t2"], "before the clip that stayed");
  assert.deepEqual(at(out, "wall"), [60, 90, "t2"], "which doesn't move");
});

test("group mates go across as many tracks as the dragged clip; linked clips keep their tracks", () => {
  const d = doc(
    [clip("p", "text", "t1", 0, 24, { bundleId: "G" }), clip("q", "text", "t2", 0, 24, { bundleId: "G" }), clip("v", "video", "main", 0, 100, { linkId: "L" }), clip("s", "audio", "au", 0, 100, { linkId: "L" })],
    [track("t0", "text"), track("t1", "text"), track("t2", "text"), track("main", "media"), track("au", "audio")],
  );
  assert.deepEqual(goingWith(d, ["p"], free).sort(), ["p", "q"]);
  assert.deepEqual(goingWith(d, ["v"], free).sort(), ["s", "v"]);
  assert.deepEqual(goingWith(d, ["v"], { ...free, linkage: false }), ["v"]);
  const up = moveClips(d, free, { lead: "q", followers: ["p"], delta: 10, track: "t1" });
  assert.deepEqual(at(up, "q"), [10, 34, "t1"]);
  assert.deepEqual(at(up, "p"), [10, 34, "t0"], "a track up, as q went");
  const withSound = moveClips(d, free, { lead: "v", followers: ["s"], delta: 50, track: "main" });
  assert.deepEqual(at(withSound, "s"), [50, 150, "au"]);
});
