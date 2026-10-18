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
  defaultText,
  editAllPoses,
  MASK_SHAPES,
  isEmptyMask,
  newBrushMask,
  newEmptyMask,
  remakeMask,
  newPenMask,
  poseBox,
  textBox,
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

test("the tiles are CapCut's, in its order", () => {
  assert.deepEqual(
    MASK_SHAPES.map((s) => s.name),
    ["Split", "Filmstrip", "Circle", "Rectangle", "Stars", "Heart", "Text", "Brush", "Pen"],
  );
});

test("a text mask: CapCut's default words, its box round them, re-measured with its style", () => {
  const m = newShapeMask(video(), "text", 0);
  const pose = m.keyframes[0];
  assert.deepEqual(pose.text, defaultText(transform));
  assert.equal(pose.text!.content, "Default text");
  const sized = textBox(pose.text!);
  assert.deepEqual([pose.shapeBounds!.width, pose.shapeBounds!.height], [sized.width, sized.height]);
  // Centred on the picture.
  const c = boundsCentre(pose.shapeBounds!);
  assert.ok(Math.abs(c[0] - 100) < 1e-9 && Math.abs(c[1] - 50) < 1e-9);
  // Two lines with line spacing are taller; letter spacing widens.
  const two = textBox({ ...pose.text!, content: "a\nb", lineSpacing: 0.5 });
  assert.ok(Math.abs(two.height - (2 * 1.2 + 0.5) * pose.text!.size) < 1e-9);
  assert.ok(textBox({ ...pose.text!, letterSpacing: 1 }).width > sized.width);
  // Words go on every pose.
  const keyed = editMaskPose(toggleMaskPose(m, 0, 24), 30, 24, (p) => ({ ...p, shapeBounds: { ...p.shapeBounds!, rotation: 20 } }));
  assert.equal(posesOf(keyed).length, 2);
  const worded = editAllPoses(keyed, (p) => ({ ...p, text: { ...p.text!, content: "Hi" } }));
  assert.ok(posesOf(worded).every(([, d]) => d.text!.content === "Hi"));
});

test("a pen mask: a closed path, its box round its anchors and handles, poses that travel", () => {
  const pts = [
    { x: 10, y: 10, ix: 10, iy: 10, ox: 10, oy: 10 },
    { x: 50, y: 10, ix: 40, iy: 0, ox: 60, oy: 20 },
    { x: 30, y: 40, ix: 30, iy: 40, ox: 30, oy: 40 },
  ];
  let m = newPenMask(video(), pts, 0);
  assert.equal(m.tool, "pen");
  assert.deepEqual(m.keyframes[0].penPath, { points: pts, closed: true });
  const box = poseBox(m.keyframes[0]);
  assert.deepEqual([box.x, box.y, box.width, box.height], [10, 0, 50, 40]);
  // Keyed: halfway, the anchors are halfway; the expansion too.
  m = toggleMaskPose(m, 0, 24);
  m = editMaskPose(m, 20, 24, (p) => ({ ...p, penPath: { closed: true, points: p.penPath!.points.map((a) => ({ ...a, x: a.x + 20, ix: a.ix + 20, ox: a.ox + 20 })) }, expansion: 40 }));
  const mid = poseAt(m, 10, 24)!;
  assert.deepEqual(mid.penPath!.points.map((a) => Math.round(a.x * 1e3) / 1e3), [20, 60, 40]);
  assert.ok(Math.abs(mid.expansion! - 20) < 1e-3);
  // A pen changed to a shape is the box round it.
  const rect = changeMaskShape(newPenMask(video(), pts, 0), "rectangle", transform).keyframes[0];
  assert.deepEqual([rect.penPath, rect.shapeBounds!.width, rect.shapeBounds!.height], [undefined, 50, 40]);
});

test("a brush mask: its first stroke, the feather and expansion on the mask while static", () => {
  let m = newBrushMask(video(), { points: [0, 0, 10, 10], size: 20 }, 0);
  assert.equal(m.tool, "draw");
  m = editMaskPose(m, 30, 24, (p) => ({ ...p, expansion: -30, featherAmount: 10 }));
  assert.deepEqual([m.expansion, m.featherAmount, (m.keyframes[0] as any).expansion], [-30, 10, undefined]);
  assert.equal(poseAt(m, 0, 24)!.expansion, -30);
});

test("the Pen and Brush tiles make the selected mask an empty one, keeping its place and settings", () => {
  let rect = newShapeMask(video(), "rectangle", 0);
  rect = editMaskPose(toggleMaskPose(rect, 0, 24), 30, 24, (p) => ({ ...p, shapeBounds: { ...p.shapeBounds!, x: 5 } }));
  rect = { ...rect, inverted: true, featherAmount: 30 };
  const pen = remakeMask(rect, newEmptyMask(video(), "pen", 12));
  assert.deepEqual([pen.id, pen.tool, pen.inverted, pen.featherAmount, pen.keyed, Object.keys(pen.keyframes)], [rect.id, "pen", true, 30, false, ["12"]]);
  assert.equal(isEmptyMask(pen), true);
  assert.equal(isEmptyMask(newEmptyMask(video(), "draw", 0)), true);
  assert.equal(isEmptyMask(newBrushMask(video(), { points: [0, 0], size: 4 }, 0)), false);
  assert.equal(isEmptyMask(rect), false);
});
