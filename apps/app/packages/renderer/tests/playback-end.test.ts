// Tests for src/lib/playback-end.ts (where playback stops, what the player shows there and where
// play starts again): `node --test tests/` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { playsFromStart, shownFrame } from "../src/lib/playback-end.ts";

// Three seconds at 30 fps: frames 0 to 89, and the end (where playback stops) at 90.
const end = 90;

test("play on the end starts again from the beginning, as it does on the last frame, where the engine's clock last stood", () => {
  assert.equal(playsFromStart(end, end), true);
  assert.equal(playsFromStart(end + 12, end), true);
  // Play there used to play that one frame and stop: it looked as if play did nothing.
  assert.equal(playsFromStart(end - 1, end), true);
  assert.equal(playsFromStart(end - 2, end), false);
  assert.equal(playsFromStart(0, end), false);
});

test("the player shows the last frame on the end, where playback stops, not the nothing after it", () => {
  assert.equal(shownFrame(end, end), end - 1);
  assert.equal(shownFrame(end - 1, end), end - 1);
  assert.equal(shownFrame(0, end), 0);
  // Past the end there is nothing to show, and on an empty project there is no last frame.
  assert.equal(shownFrame(end + 5, end), end + 5);
  assert.equal(shownFrame(0, 0), 0);
});
