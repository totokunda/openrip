// Tests for src/lib/edge-scroll.ts (the timeline scrolling while something on it is dragged to
// its edge): `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE_SPEED, EDGE_ZONE, MAX_EDGE_SPEED, edgeScrollFrames, edgeScrollSpeed, startEdgeScroll, type EdgePointer } from "../src/lib/edge-scroll.ts";

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

/**
 * A drag's edge scroll on a timeline whose stage starts at client x 200, in a window whose
 * animation frames run by hand, over a 3000-frame timeline showing `view`.
 */
function drag(view: [number, number]) {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  let next: (() => void) | null = null;
  const win = { requestAnimationFrame: (f: () => void) => ((next = f), 1), cancelAnimationFrame: () => (next = null) };
  const doc = {
    defaultView: win,
    addEventListener: (type: string, f: (e: unknown) => void) => listeners.set(type, (listeners.get(type) ?? new Set()).add(f)),
    removeEventListener: (type: string, f: (e: unknown) => void) => listeners.get(type)?.delete(f),
  };
  const area = { ownerDocument: doc, getBoundingClientRect: () => ({ left: 200 }) } as unknown as HTMLElement;
  const store = {
    timelineDuration: view,
    totalTimelineFrames: total,
    focusFrame: view[0] + 20,
    shiftTimelineDuration: (n: number) => {
      store.timelineDuration = [store.timelineDuration[0] + n, store.timelineDuration[1] + n];
    },
  };
  const followed: EdgePointer[] = [];
  const stop = startEdgeScroll(area, left, width, () => store, (p) => followed.push(p));
  return {
    store,
    followed,
    stop,
    /** The pointer at stage x `x`. */
    move: (x: number) => listeners.get("mousemove")?.forEach((f) => f({ clientX: 200 + x, clientY: 80, metaKey: false })),
    release: () => listeners.get("mouseup")?.forEach((f) => f({})),
    frames: (n: number) => {
      for (let i = 0; i < n && next; i++) {
        const f = next;
        next = null;
        f();
      }
    },
    running: () => next != null,
  };
}

test("a drag held past an edge scrolls the timeline each frame, and what's dragged follows the pointer where it was", () => {
  const d = drag([300, 600]);
  d.frames(5);
  assert.deepEqual(d.store.timelineDuration, [300, 600], "no pointer yet: nothing");
  d.move(500);
  d.frames(5);
  assert.deepEqual(d.store.timelineDuration, [300, 600], "between the edges: nothing");
  assert.equal(d.followed.length, 0);
  d.move(left - 30);
  d.frames(30);
  const [start] = d.store.timelineDuration;
  assert.ok(start < 300, `${d.store.timelineDuration}`);
  // Each frame the window moved, the drag was told, with the pointer as it was: held still.
  assert.ok(d.followed.length > 0 && d.followed.length <= 30);
  assert.ok(d.followed.every((p) => p.clientX === 200 + left - 30));
  d.move(right + 30);
  d.frames(30);
  assert.ok(d.store.timelineDuration[0] > start, `${d.store.timelineDuration}`);
  // The playhead keeps its time, as the timeline's other scrolls have it.
  assert.equal(d.store.focusFrame, 320);
});

test("it stops at frame 0 and at the timeline's end, and the drag isn't told of a scroll that didn't happen", () => {
  const d = drag([30, 330]);
  d.move(left - 100);
  d.frames(200);
  assert.deepEqual(d.store.timelineDuration, [0, 300]);
  const told = d.followed.length;
  d.frames(20);
  assert.equal(d.followed.length, told);
  d.move(right + 100);
  d.frames(2000);
  assert.deepEqual(d.store.timelineDuration, [total - 300, total]);
});

test("let go, or stopped by the drag, it scrolls no more", () => {
  const a = drag([300, 600]);
  a.move(right + 50);
  a.frames(10);
  a.release();
  assert.equal(a.running(), false);
  const view = a.store.timelineDuration;
  a.frames(10);
  assert.deepEqual(a.store.timelineDuration, view);

  const b = drag([300, 600]);
  b.move(right + 50);
  b.frames(10);
  b.stop();
  assert.equal(b.running(), false);
  const at = b.store.timelineDuration;
  b.move(left - 50);
  b.frames(10);
  assert.deepEqual(b.store.timelineDuration, at);
});
