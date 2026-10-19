// Tests for src/lib/caption-edit.ts and src/lib/text-style-presets.ts: `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boxChange, captionRows, captionsOnTrack, countMatches, isCaption, replaceAllPatches, replaceMatches, rowTime, styleChange, styleOf } from "../src/lib/caption-edit.ts";
import { hasLook, lookPatch, textLookAttributes, isTextStyle, savedAsPreset, LOOK_DEFAULTS } from "../src/lib/text-style-presets.ts";
import { TEXT_PRESETS } from "../src/lib/text-presets.ts";

const box = { x: 100, y: 200, width: 400, height: 60, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 };
const text = (clipId: string, startFrame: number, words: string, extra: Record<string, unknown> = {}) =>
  ({ clipId, type: "text", timelineId: "t1", startFrame, endFrame: startFrame + 24, text: words, transform: { ...box }, ...extra }) as any;

test("a caption is a text on a captions track or one made from speech", () => {
  const timelines = [{ timelineId: "t1", captions: true }, { timelineId: "t2" }] as any;
  assert.ok(isCaption(text("a", 0, "x"), timelines));
  assert.ok(!isCaption({ ...text("a", 0, "x"), timelineId: "t2" }, timelines));
  assert.ok(isCaption({ ...text("a", 0, "x"), timelineId: "t2", autoCaption: true }, timelines));
  assert.ok(!isCaption({ clipId: "v", type: "video", timelineId: "t1" } as any, timelines));
});

test("the list has the track's captions in time order, numbered, filtered by the search", () => {
  const clips = [text("b", 48, "Second caption"), text("a", 0, "First one"), { ...text("z", 0, "elsewhere"), timelineId: "t9" }];
  const caps = captionsOnTrack(clips, "t1");
  assert.deepEqual(caps.map((c) => c.clipId), ["a", "b"]);
  assert.deepEqual(captionRows(caps).map((r) => [r.number, r.text]), [[1, "First one"], [2, "Second caption"]]);
  assert.deepEqual(captionRows(caps, "CAPTION").map((r) => [r.number, r.text]), [[2, "Second caption"]]);
  assert.equal(rowTime(36, 24), "0:01.5");
  assert.equal(rowTime(24 * 65, 24), "1:05.0");
});

test("find and replace is literal, any letter case, every match", () => {
  assert.equal(countMatches("Cat cat CAT concat", "cat"), 4);
  assert.equal(countMatches("aaa", "aa"), 1);
  assert.equal(countMatches("abc", ""), 0);
  assert.equal(replaceMatches("Cat cat. (cat)", "cat", "dog"), "dog dog. (dog)");
  assert.equal(replaceMatches("a.b a.b", ".", "$&"), "a$&b a$&b");
  const caps = [text("a", 0, "one cat"), text("b", 24, "none"), text("c", 48, "Cat, cat")];
  assert.deepEqual(replaceAllPatches(caps, "cat", "dog"), [{ clipId: "a", text: "one dog" }, { clipId: "c", text: "dog, dog" }]);
  assert.deepEqual(replaceAllPatches(caps, "", "x"), []);
});

test("a style edit carries only the look, and a box edit moves the centre", () => {
  const a = text("a", 0, "x", { fontSize: 30, color: "#ffffff" });
  const b = { ...a, fontSize: 44, color: "#ff0000", text: "changed", startFrame: 5 };
  assert.deepEqual(styleChange(a, b), { fontSize: 44, color: "#ff0000" });
  assert.deepEqual(styleOf({ ...a, text: "x" }), { fontSize: 30, color: "#ffffff" });
  assert.equal(boxChange(a, b, text("o", 24, "y")), null);
  // The edited caption's centre moved 50 right and 30 up: another, with a narrower box, follows its centre.
  const moved = { ...a, transform: { ...box, x: 150, y: 170 } };
  const other = text("o", 24, "y", { transform: { ...box, x: 130, y: 210, width: 200 } });
  const patch = boxChange(a, moved, other)!;
  assert.equal(patch.transform!.x + patch.transform!.width / 2, 150 + 200);
  assert.equal(patch.transform!.y + patch.transform!.height / 2, 170 + 30);
  assert.equal(patch.transform!.width, 200);
});

test("a preset's look resets what it doesn't set and keeps the words and the size", () => {
  const label = TEXT_PRESETS.find((p) => p.id === "label")!;
  const patch = lookPatch(label);
  assert.equal(patch.backgroundEnabled, true);
  assert.equal(patch.text, undefined);
  const outline = TEXT_PRESETS.find((p) => p.id === "outline")!;
  const onLabel = { ...(patch as any), clipId: "c", type: "text" };
  // Outline doesn't set a background: it goes back to none.
  const next = { ...onLabel, ...lookPatch(outline) };
  assert.equal(next.backgroundEnabled, false);
  assert.ok(hasLook(next, outline) && !hasLook(next, label));
  assert.equal("fontSize" in lookPatch(TEXT_PRESETS.find((p) => p.id === "plain")!), false);
});

test("a saved text style holds the whole look and adds a text in it", () => {
  const clip = text("a", 0, "words", { fontSize: 50, color: "#00ff00", backgroundEnabled: true, backgroundWidth: 20, textCurve: 40 });
  const attrs = textLookAttributes(clip);
  assert.deepEqual(Object.keys(attrs.groups), ["text"]);
  const f = attrs.groups.text!.fields as any;
  assert.equal(f.fontSize, 50);
  assert.equal(f.textCurve, 40);
  assert.equal(f.backgroundOffsetX, LOOK_DEFAULTS.backgroundOffsetX);
  assert.equal("text" in f, false);
  const preset = { id: "p", name: "Mine", createdAt: 1, source: "text", attrs } as any;
  assert.ok(isTextStyle(preset));
  assert.ok(!isTextStyle({ ...preset, source: "video" }));
  const asText = savedAsPreset(preset, "Hello");
  assert.equal(asText.props.text, "Hello");
  assert.equal(asText.props.textCurve, 40);
});
