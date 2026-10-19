// Tests for src/lib/clip-attributes.ts (the groups of a clip's attributes, copy and paste),
// src/lib/clip-preset-data.ts (saved presets as data) and src/lib/align.ts (Align and
// Distribute): `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyAttributes, groupsOf, pasteAttributes, pastableGroups } from "../src/lib/clip-attributes.ts";
import { nextPresetName, parsePresets, serializePresets } from "../src/lib/clip-preset-data.ts";
import { alignOnCanvas, distribute } from "../src/lib/align.ts";
import { centreOf } from "../src/lib/transform-presets.ts";
import type { AnyClipProps } from "../src/lib/types";

const box = (over: Record<string, unknown> = {}) => ({ x: 100, y: 50, width: 400, height: 200, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100, ...over });
const video = (id: string, over: Record<string, unknown> = {}): AnyClipProps =>
  ({ clipId: id, type: "video", startFrame: 0, endFrame: 100, assetId: "a", transform: box(), originalTransform: box(), masks: [], ...over }) as unknown as AnyClipProps;
const text = (id: string, over: Record<string, unknown> = {}): AnyClipProps =>
  ({ clipId: id, type: "text", startFrame: 0, endFrame: 100, text: "hi", transform: box(), originalTransform: box(), ...over }) as unknown as AnyClipProps;

test("each type has its own groups", () => {
  assert.deepEqual(groupsOf(video("v")), ["transform", "blend", "adjust", "chroma", "effects", "animations", "speed", "audio", "mask"]);
  assert.deepEqual(groupsOf(text("t")), ["transform", "blend", "animations", "text"]);
  assert.deepEqual(groupsOf({ clipId: "a", type: "audio" } as AnyClipProps), ["speed", "audio"]);
  assert.deepEqual(groupsOf({ clipId: "f", type: "filter", adjustment: true } as unknown as AnyClipProps), ["adjust", "mask"]);
  // A freeze frame has no speed.
  assert.ok(!groupsOf(video("v", { freeze: { at: 3 } })).includes("speed"));
});

test("transform pastes as a fraction of the fitted size, at the same centre", () => {
  const src = video("s", { transform: box({ scaleX: 2, scaleY: 2, rotation: 30 }) });
  const attrs = copyAttributes(src);
  // The target is a different picture: 100x100, fitted to scale 0.5 (so its 100 % is 0.5).
  const target = video("t", { transform: box({ width: 100, height: 100, scaleX: 0.5, scaleY: 0.5, x: 0, y: 0 }), originalTransform: box({ width: 100, height: 100 }) });
  const { patch } = pasteAttributes(attrs, target, ["transform"])!;
  const t = (patch as any).transform;
  // Source scale 2 of a 400 box is 2x its fitted size; the target's fitted size is 100 at scale 1.
  assert.equal(t.scaleX, 2);
  assert.equal(t.rotation, 30);
  const [cx, cy] = centreOf(t);
  const [sx, sy] = centreOf(src.transform!);
  assert.ok(Math.abs(cx - sx) < 1e-6 && Math.abs(cy - sy) < 1e-6);
});

test("a group replaces the target's, keyframes of its properties included", () => {
  const src = video("s", { transform: box({ opacity: 40 }), blendMode: "multiply", keyframes: { opacity: [{ frame: 0, value: 10 }, { frame: 10, value: 90 }], position: [{ frame: 0, value: [1, 2] }] } });
  const target = video("t", { keyframes: { opacity: [{ frame: 5, value: 5 }], rotation: [{ frame: 0, value: 3 }] } });
  const { patch } = pasteAttributes(copyAttributes(src), target, ["blend"])!;
  assert.equal((patch as any).blendMode, "multiply");
  assert.equal((patch as any).transform.opacity, 40);
  // Opacity keys are the source's; the target's rotation key stays; the source's position key isn't in Blend.
  assert.deepEqual(Object.keys((patch as any).keyframes).sort(), ["opacity", "rotation"]);
  assert.equal((patch as any).keyframes.opacity.length, 2);
});

test("adjust leaves out what belongs to the source clip, and a paste doesn't share objects", () => {
  const color = { adjust: { brightness: 10 }, auto: { applied: true }, match: { table: [1] } };
  const src = video("s", { color });
  const attrs = copyAttributes(src);
  assert.deepEqual(attrs.groups.adjust!.fields.color, { adjust: { brightness: 10 } });
  const { patch } = pasteAttributes(attrs, video("t"), ["adjust"])!;
  assert.deepEqual((patch as any).color, { adjust: { brightness: 10 } });
  (patch as any).color.adjust.brightness = 99;
  assert.equal((attrs.groups.adjust!.fields.color as any).adjust.brightness, 10);
});

test("effects get new ids and keep their keys", () => {
  const fx = { id: "e1", effectId: "glitch", name: "Glitch", intensity: 50, params: { a: 1 } };
  const src = video("s", { effects: [fx], keyframes: { "fx:e1:intensity": [{ frame: 0, value: 5 }] } });
  const { patch } = pasteAttributes(copyAttributes(src), video("t"), ["effects"])!;
  const id = (patch as any).effects[0].id;
  assert.notEqual(id, "e1");
  assert.deepEqual(Object.keys((patch as any).keyframes), [`fx:${id}:intensity`]);
});

test("animations paste only the slots both types have", () => {
  const src = text("s", { animationIn: { type: "fade", duration: 1 }, animationLoop: { type: "pulse", duration: 1 } });
  const { patch } = pasteAttributes(copyAttributes(src), video("t"), ["animations"])!;
  assert.deepEqual(Object.keys(patch).sort(), ["animationIn", "animationOut"]);
  assert.deepEqual((patch as any).animationIn, { type: "fade", duration: 1 });
  assert.equal((patch as any).animationOut, null);
});

test("speed pastes the speed or the curve and says whether to reverse", () => {
  const plainSpeed = pasteAttributes(copyAttributes(video("s", { speed: 2, reverse: true })), video("t"), ["speed"])!;
  assert.equal((plainSpeed.patch as any).speed, 2);
  assert.equal(plainSpeed.reverse, true);
  const curve = { points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] };
  const curved = pasteAttributes(copyAttributes(video("s", { speed: 1.5, speedCurve: curve })), video("t"), ["speed"])!;
  assert.deepEqual((curved.patch as any).speedCurve, curve);
  assert.ok(!("speed" in curved.patch));
});

test("text style goes from text to text only, and leaves the words", () => {
  const src = text("s", { text: "words", fontSize: 40, color: "#ff0000", keyframes: { fontSize: [{ frame: 0, value: 20 }] } });
  const attrs = copyAttributes(src);
  assert.deepEqual(pastableGroups(attrs, video("v")), ["transform", "blend", "animations"]);
  const { patch } = pasteAttributes(attrs, text("t", { text: "mine" }), ["text"])!;
  assert.equal((patch as any).fontSize, 40);
  assert.ok(!("text" in patch));
  assert.equal((patch as any).keyframes.fontSize.length, 1);
});

test("masks are copied as data with new ids", () => {
  const m = new Map([[0, { shape: "circle" }]]);
  const src = video("s", { masks: [{ id: "m1", tool: "shape", featherAmount: 5, keyframes: m }] });
  const attrs = copyAttributes(src);
  // A Map became an object, so it can be saved.
  assert.deepEqual((attrs.groups.mask!.fields.masks as any)[0].keyframes, { 0: { shape: "circle" } });
  const { patch } = pasteAttributes(attrs, video("t"), ["mask"])!;
  assert.notEqual((patch as any).masks[0].id, "m1");
  assert.equal((patch as any).masks[0].featherAmount, 5);
});

test("nothing pastes when no group fits", () => {
  const attrs = copyAttributes(text("s"));
  assert.equal(pasteAttributes(attrs, { clipId: "a", type: "audio" } as AnyClipProps), null);
});

test("presets survive a round trip and a damaged file keeps what it can", () => {
  const attrs = copyAttributes(video("s", { speed: 2 }));
  const list = [{ id: "p1", name: "One", createdAt: 5, source: "video" as const, attrs, thumb: "data:image/jpeg;base64,AA" }];
  const back = parsePresets(serializePresets(list));
  assert.deepEqual(back, list);
  assert.deepEqual(parsePresets("not json"), []);
  const mixed = JSON.stringify({ presets: [{ id: "x" }, { id: "p1", name: "ok", attrs: { source: "text", groups: { text: { fields: { fontSize: 3 } }, bogus: { fields: {} } } } }, null] });
  const got = parsePresets(mixed);
  assert.equal(got.length, 1);
  assert.deepEqual(Object.keys(got[0].attrs.groups), ["text"]);
  assert.equal(nextPresetName([]), "My presets1");
  assert.equal(nextPresetName([{ ...list[0], name: "My presets1" }, { ...list[0], id: "p2", name: "My presets3" }]), "My presets2");
});

const placed = (id: string, cx: number, cy: number, w = 100, h = 100, over: Record<string, unknown> = {}) => ({ id, transform: box({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, ...over }) });

test("align puts clips against the canvas by their bounds", () => {
  const world = { width: 1000, height: 500 };
  const boxes = [placed("a", 300, 100, 100, 100), placed("b", 600, 400, 200, 60)];
  assert.deepEqual([...alignOnCanvas(boxes, "left", world)], [["a", [50, 100]], ["b", [100, 400]]]);
  assert.deepEqual([...alignOnCanvas(boxes, "right", world)], [["a", [950, 100]], ["b", [900, 400]]]);
  assert.deepEqual([...alignOnCanvas(boxes, "center-h", world)], [["a", [500, 100]], ["b", [500, 400]]]);
  assert.deepEqual([...alignOnCanvas(boxes, "top", world)], [["a", [300, 50]], ["b", [600, 30]]]);
  assert.deepEqual([...alignOnCanvas(boxes, "bottom", world)], [["a", [300, 450]], ["b", [600, 470]]]);
  assert.deepEqual([...alignOnCanvas(boxes, "center-v", world)], [["a", [300, 250]], ["b", [600, 250]]]);
  // A clip on its side is bounded by its turned picture.
  const turned = alignOnCanvas([placed("c", 500, 250, 200, 40, { rotation: 90 })], "left", world).get("c")!;
  assert.ok(Math.abs(turned[0] - 20) < 1e-9);
});

test("distribute makes the gaps equal and keeps the ends", () => {
  const boxes = [placed("a", 50, 50, 100, 100), placed("c", 500, 50, 100, 100), placed("b", 900, 50, 200, 100)];
  const out = distribute(boxes, "horizontal");
  // a spans 0-100, b spans 800-1000: 900 - 300 of widths... gaps are (1000 - 400) / 2 = 300.
  assert.deepEqual(out.get("a"), [50, 50]);
  assert.deepEqual(out.get("c"), [450, 50]);
  assert.deepEqual(out.get("b"), [900, 50]);
  assert.equal(distribute(boxes.slice(0, 2), "horizontal").size, 0);
  assert.equal(distribute(boxes, "vertical").get("c")![1], 50);
});
