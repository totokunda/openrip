// Tests for src/lib/animations.ts: `node --test tests/*.test.ts` in packages/renderer (Node
// strips the types itself).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  TRANSITIONS,
  animationOf,
  animationsFor,
  maxAnimationDuration,
  maxTransitionDuration,
  transitionOf,
} from "../src/lib/animations.ts";

/** One of the engine's lists of what it draws (engine/crates/v1/src/app.rs). */
const engineList = (name: string): string[] => {
  const src = readFileSync(fileURLToPath(new URL("../../../../../engine/crates/v1/src/app.rs", import.meta.url)), "utf8");
  const m = src.match(new RegExp(`const ${name}: \\[&str; \\d+\\] = \\[([^\\]]*)\\]`));
  assert.ok(m, name);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

const clip = (type: string, frames: number, extra: Record<string, unknown> = {}) =>
  ({ clipId: "c", type, startFrame: 30, endFrame: 30 + frames, ...extra }) as any;

test("the lists are what the engine draws", () => {
  assert.deepEqual(TRANSITIONS.map((t) => t.type).sort(), engineList("BUILTIN_TRANSITION").sort());
  const types = (k: "in" | "out" | "combo" | "loop", c: string) => animationsFor(c as any, k).map((a) => a.type);
  const union = (...lists: string[][]) => [...new Set(lists.flat())].sort();
  assert.deepEqual(union(types("in", "video"), types("in", "text")), engineList("BUILTIN_IN").sort());
  assert.deepEqual(union(types("out", "video"), types("out", "text")), engineList("BUILTIN_OUT").sort());
  assert.deepEqual(types("combo", "image").sort(), engineList("BUILTIN_COMBO").sort());
  assert.deepEqual(types("loop", "text").sort(), engineList("BUILTIN_LOOP").sort());
  // The ones that show both clips are the engine's overlapping ones.
  assert.deepEqual(TRANSITIONS.filter((t) => t.overlap).map((t) => t.type).sort(), engineList("OVERLAPPING").sort());
});

test("each clip type gets its kinds", () => {
  assert.deepEqual(animationsFor("video", "loop"), []);
  assert.deepEqual(animationsFor("text", "combo"), []);
  assert.deepEqual(animationsFor("audio", "in"), []);
  // Text keeps its typing intros first, and takes fades, zooms and slides.
  assert.deepEqual(animationsFor("text", "in").map((a) => a.type), ["type_1", "type_2", "typewriter", "fade_in", "zoom_in", "zoom_out", "slide"]);
  assert.deepEqual(animationsFor("text", "out").map((a) => a.type), ["fade_out", "zoom_in", "zoom_out", "slide"]);
});

test("fields come with their defaults and parameters", () => {
  assert.deepEqual(transitionOf("mix"), { type: "mix", name: "Mix", duration: 0.5 });
  assert.deepEqual(transitionOf("push", { params: { direction: "up" } }), { type: "push", name: "Push", duration: 0.5, params: { direction: "up" } });
  assert.deepEqual(transitionOf("wipe"), { type: "wipe", name: "Wipe", duration: 0.5, params: { direction: "left" } });
  assert.deepEqual(transitionOf("blink", { resource: "/b" }), { type: "blink", name: "Blink", duration: 0.5, resource: "/b" });
  assert.equal(transitionOf("nope"), null);
  const video = clip("video", 120);
  assert.deepEqual(animationOf(video, "in", "slide", { params: { direction: "down" }, duration: 0.8 }), { type: "slide", name: "Slide", duration: 0.8, params: { direction: "down" } });
  // A combo spans the whole clip: 4 s at 30 fps.
  assert.deepEqual(animationOf(video, "combo", "swing", { fps: 30 }), { type: "swing", name: "Swing", duration: 4 });
  // Not for this clip, or this kind.
  assert.equal(animationOf(video, "in", "type_1"), null);
  assert.equal(animationOf(clip("text", 30), "combo", "swing"), null);
});

test("durations fit the clip", () => {
  const video = clip("video", 120, { animationIn: { type: "fade_in", duration: 1.5 } });
  assert.equal(maxAnimationDuration(video, "in", 30), 4);
  assert.equal(maxAnimationDuration(video, "out", 30), 2.5);
  assert.equal(maxTransitionDuration(video, clip("video", 45), 30), 1.5);
  assert.equal(maxTransitionDuration(video, undefined, 30), 0);
});
