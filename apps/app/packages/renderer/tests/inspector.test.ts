// Tests for the inspector's pure edits: src/lib/inspector-edits.ts (the keyframe navigator,
// several edits at once, the transform at a frame) and src/lib/mask-shapes.ts (mask frames,
// poses and CapCut's keyframe rule for them, shapes, the heart): `node --test tests/*.test.ts`
// in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { editProperties, keyNavOf, toggleKeys, transformAt } from "../src/lib/inspector-edits.ts";
import {
  boundsCentre,
  changeMaskShape,
  editMaskPose,
  heartPoints,
  isMaskKeyed,
  maskFrame,
  maskNav,
  newShapeMask,
  poseAt,
  posesOf,
  timelineFrameOf,
  toggleMaskPose,
} from "../src/lib/mask-shapes.ts";

const transform = { x: 100, y: 50, width: 200, height: 100, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 };
const video = (extra: object = {}): any => ({ clipId: "v", type: "video", startFrame: 24, endFrame: 264, trimStart: 0, transform, masks: [], ...extra });

test("the navigator: keyed, a key at the playhead, the nearest keys either side in timeline frames", () => {
  const clip = video({ keyframes: { opacity: [{ frame: 0, value: 100 }, { frame: 48, value: 0 }], position: [{ frame: 48, value: [0, 0] }] } });
  assert.deepEqual(keyNavOf(clip, ["opacity"], 24), { keyed: true, at: true, prev: undefined, next: 72 });
  assert.deepEqual(keyNavOf(clip, ["opacity"], 50), { keyed: true, at: false, prev: 24, next: 72 });
  // A section's navigator: filled only when every property has a key there.
  assert.equal(keyNavOf(clip, ["opacity", "position"], 72).at, true);
  assert.equal(keyNavOf(clip, ["opacity", "position"], 24).at, false);
  assert.deepEqual(keyNavOf(clip, ["rotation"], 30), { keyed: false, at: false, prev: undefined, next: undefined });
});

test("the diamond over several properties keys them all, then takes them all off", () => {
  const clip = video();
  const on = toggleKeys(clip, ["opacity", "rotation"], 48, 24);
  assert.deepEqual(on.keyframes, { opacity: [{ frame: 24, value: 100 }], rotation: [{ frame: 24, value: 0 }] });
  assert.equal(clip.keyframes, undefined, "the clip given is left alone");
  // With one of them keyed there already, the other gets its key.
  const half = toggleKeys(video({ keyframes: { opacity: [{ frame: 24, value: 50 }] } }), ["opacity", "rotation"], 48, 24);
  assert.deepEqual(half.keyframes?.opacity, [{ frame: 24, value: 50 }]);
  assert.equal(half.keyframes?.rotation?.length, 1);
  assert.deepEqual(toggleKeys({ ...clip, ...on }, ["opacity", "rotation"], 48, 24).keyframes, {});
});

test("several edits at once follow CapCut's rule each, the later ones seeing the earlier", () => {
  const keyed = video({ keyframes: { scale: [{ frame: 0, value: [1, 1] }] } });
  const patch = editProperties(keyed, 72, [
    ["scale", [0.5, 0.5]],
    ["position", [300, 200]],
  ]);
  // Scale is keyed: a key at the playhead; position isn't: the field moves (its centre).
  assert.deepEqual(patch.keyframes?.scale, [{ frame: 0, value: [1, 1] }, { frame: 48, value: [0.5, 0.5] }]);
  assert.deepEqual([patch.transform!.x + 100, patch.transform!.y + 50], [300, 200]);
});

test("the transform at a frame takes its keys' scale, turn, centre and opacity", () => {
  const clip = video({ keyframes: { position: [{ frame: 0, value: [100, 100] }, { frame: 24, value: [300, 100] }], opacity: [{ frame: 0, value: 40 }] } });
  const t = transformAt(clip, 36, 24)!;
  assert.deepEqual([t.x + 100, t.y + 50, t.opacity], [200, 100, 40]);
  assert.equal(transformAt(video(), 36, 24), transform, "unkeyed, the field as it is");
});

test("mask frames: a video's source frames (trim and speed), a photo's clip frames", () => {
  const v = video({ trimStart: 12, speed: 2 });
  assert.equal(maskFrame(v, 36), (36 - 24 + 12) * 2);
  assert.equal(timelineFrameOf(v, 48), 36);
  const p = { ...video(), type: "image" };
  assert.equal(maskFrame(p, 30), 6);
});

test("a static mask changes its one pose wherever the playhead is; keyed, it gets poses that travel", () => {
  let m = newShapeMask(video(), "rectangle", 0);
  assert.equal(isMaskKeyed(m), false);
  assert.deepEqual(m.keyframes[0].shapeBounds, { x: 75, y: 25, width: 50, height: 50, rotation: 0, scaleX: 1, scaleY: 1, shapeType: "rectangle", cornerRadius: 0 });
  // Static: an edit at frame 30 changes the pose at 0; the feather goes on the mask.
  m = editMaskPose(m, 30, 24, (p) => ({ ...p, shapeBounds: { ...p.shapeBounds!, x: 10 }, featherAmount: 20 }));
  assert.deepEqual(posesOf(m).map(([f]) => f), [0]);
  assert.equal(m.keyframes[0].shapeBounds!.x, 10);
  assert.equal(m.featherAmount, 20);
  assert.equal((m.keyframes[0] as any).featherAmount, undefined);
  // The diamond at 10: keyed, its pose there; an edit at 30 adds a second pose.
  m = toggleMaskPose(m, 10, 24);
  assert.deepEqual([isMaskKeyed(m), posesOf(m).map(([f]) => f)], [true, [10]]);
  m = editMaskPose(m, 30, 24, (p) => ({ ...p, shapeBounds: { ...p.shapeBounds!, x: 110, rotation: 90, cornerRadius: 40 }, featherAmount: 60 }));
  const mid = poseAt(m, 20, 24)!;
  // Halfway: centres, turn, round corners and feather halfway (a rectangle about its centre),
  // to the engine's single precision.
  const [ca, cb] = [boundsCentre(m.keyframes[10].shapeBounds!), boundsCentre(m.keyframes[30].shapeBounds!)];
  const c = boundsCentre(mid.shapeBounds!);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  assert.ok(near(c[0], (ca[0] + cb[0]) / 2) && near(c[1], (ca[1] + cb[1]) / 2), `${c} vs ${ca} ${cb}`);
  assert.ok(near(mid.shapeBounds!.rotation!, 45) && near(mid.shapeBounds!.cornerRadius!, 20) && near(mid.featherAmount!, 40));
  // The navigator, in timeline frames.
  assert.deepEqual(maskNav(m, video(), 24 + 20), { keyed: true, at: false, prev: 34, next: 54 });
  // Off at 30, then at 10: the last pose leaves it static as it was there, its feather on the mask.
  m = toggleMaskPose(toggleMaskPose(m, 30, 24), 10, 24);
  assert.deepEqual([isMaskKeyed(m), posesOf(m).length, m.featherAmount], [false, 1, 20]);
});

test("a shape changed keeps its centre; a lasso becomes the box round its points", () => {
  const m = newShapeMask(video(), "rectangle", 0);
  const turned = editMaskPose(m, 0, 24, (p) => ({ ...p, shapeBounds: { ...p.shapeBounds!, rotation: 30 } }));
  const before = boundsCentre(turned.keyframes[0].shapeBounds!);
  const heart = changeMaskShape(turned, "heart", transform);
  assert.equal(heart.keyframes[0].shapeBounds!.shapeType, "heart");
  const after = boundsCentre(heart.keyframes[0].shapeBounds!);
  assert.ok(Math.abs(after[0] - before[0]) < 1e-9 && Math.abs(after[1] - before[1]) < 1e-9);
  // Split spans the picture.
  assert.equal(changeMaskShape(m, "linear", transform).keyframes[0].shapeBounds!.width, 200);
  const lasso: any = { ...m, tool: "lasso", keyframes: { 0: { lassoPoints: [10, 10, 50, 10, 50, 30] } } };
  const box = changeMaskShape(lasso, "ellipse", transform).keyframes[0] as any;
  assert.deepEqual([box.lassoPoints, box.shapeBounds.x, box.shapeBounds.y, box.shapeBounds.width, box.shapeBounds.height], [undefined, 10, 10, 40, 20]);
});

test("the heart spans its box's width and 0.9 of its height, as the engine draws it", () => {
  const p = heartPoints(100, 50, 200, 100, 0);
  const xs = p.filter((_, i) => i % 2 === 0);
  const ys = p.filter((_, i) => i % 2 === 1);
  assert.equal(p.length, 128);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 200) < 0.5);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 90) < 0.6);
  // Its point at the bottom.
  assert.ok(Math.abs(Math.max(...ys) - 95) < 0.6);
});
