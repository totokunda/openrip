// Tests for src/lib/edge-scroll.ts (the timeline scrolling while the playhead is dragged to its
// edge): `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE_SPEED, EDGE_ZONE, MAX_EDGE_SPEED, edgeScrollFrames, edgeScrollSpeed } from "../src/lib/edge-scroll.ts";

// A 1000 px stage whose visible timeline starts at the Cover column's 50 px; 300 frames wide in
// view, of a 3000-frame timeline.
const [left, right, width, total] = [50, 1000, 1000, 3000];

/** The window after `ticks` animation frames with the pointer held at `x`. */
const held = (x: number, view: [number, number], ticks: number): [number, number] => {
  let carry = 0;
  for (let i = 0; i < ticks; i++) {
    const step = edgeScrollFrames(edgeScrollSpeed(x, left, right), view, width, total, carry);
    view = [view[0] + step.frames, view[1] + step.frames];
    carry = step.carry;
  }
  return view;
};

test("the timeline scrolls near or past an edge, that way, and not between them", () => {
  assert.equal(edgeScrollSpeed(500, left, right), 0);
  assert.equal(edgeScrollSpeed(left + EDGE_ZONE, left, right), 0);
  assert.equal(edgeScrollSpeed(right - EDGE_ZONE, left, right), 0);
  assert.ok(edgeScrollSpeed(left + EDGE_ZONE - 10, left, right) < 0);
  assert.ok(edgeScrollSpeed(right - EDGE_ZONE + 10, left, right) > 0);
  assert.equal(edgeScrollSpeed(left, left, right), -EDGE_SPEED);
  assert.equal(edgeScrollSpeed(right, left, right), EDGE_SPEED);
});

test("the further past the edge, the faster, up to a most", () => {
  const speeds = [left + 20, left, left - 40, left - 100].map((x) => -edgeScrollSpeed(x, left, right));
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1], `${speeds}`);
  assert.equal(edgeScrollSpeed(left - 5000, left, right), -MAX_EDGE_SPEED);
  assert.equal(edgeScrollSpeed(right + 5000, left, right), MAX_EDGE_SPEED);
});

test("held past the left edge, the timeline scrolls back to frame 0 and stops there", () => {
  // The bug: the playhead stuck at the visible edge, frame 300, with the timeline still.
  const view = held(left - 30, [300, 600], 60);
  assert.ok(view[0] < 300, `${view}`);
  assert.deepEqual(held(left - 30, [300, 600], 1000), [0, 300]);
});

test("held past the right edge, it scrolls on to the timeline's end and stops there", () => {
  assert.ok(held(right + 30, [300, 600], 60)[0] > 300);
  assert.deepEqual(held(right + 30, [300, 600], 5000), [total - 300, total]);
});

test("zoomed in to a few frames, the scroll still moves, a frame at a time", () => {
  // 5 frames across 1000 px: well under a frame per animation frame, carried until it adds up.
  const view = held(left, [100, 105], 60);
  assert.ok(view[0] < 100 && view[0] > 90, `${view}`);
});

test("a window that already shows frame 0 or the end doesn't scroll that way", () => {
  assert.deepEqual(held(left - 100, [0, 300], 10), [0, 300]);
  assert.deepEqual(held(right + 100, [total - 300, total], 10), [total - 300, total]);
  // Zoomed out past a short timeline's length, there's nowhere to go.
  assert.deepEqual(held(right + 100, [0, 3600], 10), [0, 3600]);
});
