// Tests for src/lib/transition-cuts.ts: `node --test tests/*.test.ts` in packages/renderer (Node
// strips the types itself).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cutAtFrame, cutNear, cutsOn, fitTransitions } from "../src/lib/transition-cuts.ts";

const clip = (clipId: string, startFrame: number, endFrame: number, extra: Record<string, unknown> = {}) =>
  ({ clipId, type: "video", timelineId: "main", startFrame, endFrame, ...extra }) as any;

// Test123: one shot split at 3.17 s (frame 76 at 24 fps), a 0.55 s Chessboard on the cut.
const chess = { type: "gl_chessboard", name: "Chessboard", duration: 0.55, params: { grid_num: 10 } };
const test123 = () => [clip("a", 0, 76, { transitionOut: chess }), clip("b", 76, 188)];
const tracks = [{ timelineId: "text", type: "text" }, { timelineId: "main", type: "media" }] as any;

test("a transition stays as it is while its cut has room for it", () => {
  const clips = test123();
  assert.equal(fitTransitions(clips, 24), clips);
});

test("a transition comes off when the clip after it goes", () => {
  const [a] = test123();
  const [fitted] = fitTransitions([a], 24);
  assert.equal((fitted as any).transitionOut, null);
  // Moved away, leaving a gap: no cut either.
  const moved = fitTransitions([a, clip("b", 80, 192)], 24);
  assert.equal((moved[0] as any).transitionOut, null);
  // A clip that's switched off still holds its place: the transition waits for it.
  const off = [a, clip("b", 76, 188, { deactivated: true })];
  assert.equal(fitTransitions(off, 24), off);
});

test("a transition is cut down to fit when a clip at its cut is trimmed shorter", () => {
  // The clip after it trimmed to 6 frames (0.25 s): the transition goes down to 0.25 s.
  const [a] = test123();
  const fitted = fitTransitions([a, clip("b", 76, 82)], 24);
  assert.deepEqual((fitted[0] as any).transitionOut, { ...chess, duration: 0.25 });
  // The clip before it trimmed to 10 frames: 0.41 s (to the hundredth under 0.4167).
  const short = fitTransitions([clip("a", 66, 76, { transitionOut: chess }), clip("b", 76, 188)], 24);
  assert.equal((short[0] as any).transitionOut.duration, 0.41);
  // Never under the shortest a transition can be, and left alone once there.
  const tiny = [clip("a", 0, 76, { transitionOut: { ...chess, duration: 0.1 } }), clip("b", 76, 77)];
  assert.equal(fitTransitions(tiny, 24), tiny);
});

test("a transition dropped over a clip lands on the nearer of its cuts", () => {
  const clips = [clip("a", 0, 76), clip("b", 76, 188), clip("c", 188, 250)];
  // Over b's first half: the cut before it (a's); over its second half: its own.
  assert.equal(cutNear(clips, "main", 100, 4), "a");
  assert.equal(cutNear(clips, "main", 170, 4), "b");
  // The last clip has no cut at its end: anywhere over it is the cut before it.
  assert.equal(cutNear(clips, "main", 245, 4), "b");
  // Between clips (past the end), only near a cut.
  assert.equal(cutNear(clips, "main", 260, 4), null);
  assert.equal(cutNear([clip("a", 0, 76)], "main", 40, 4), null);
  // Another track's clips aren't this track's cuts.
  assert.equal(cutNear(clips, "other", 76, 4), null);
});

test("with nothing selected, + goes to the cut of the main track's clip at the playhead", () => {
  const clips = [...test123(), clip("t", 10, 50, { type: "text", timelineId: "text" })];
  assert.equal(cutAtFrame(clips, tracks, 27), "a");
  // On the second clip (whose end has no cut): the cut before it.
  assert.equal(cutAtFrame(clips, tracks, 120), "a");
  assert.equal(cutAtFrame(clips, tracks, 400), null);
  assert.equal(cutAtFrame([clip("a", 0, 76)], tracks, 27), null);
});

test("a cut is a clip and the one starting on the frame it ends", () => {
  // Frames are whole, and the engine finds a cut where the clips meet within a millisecond:
  // the same frame. A frame apart is a gap to both.
  assert.deepEqual(cutsOn(test123(), "main").map((c) => [c.clip.clipId, c.next.clipId]), [["a", "b"]]);
  assert.deepEqual(cutsOn([clip("a", 0, 76), clip("b", 77, 188)], "main"), []);
});
