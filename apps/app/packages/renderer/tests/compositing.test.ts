// Tests for src/lib/color.ts, compositing.ts and transform-presets.ts: `node --test
// tests/*.test.ts` in packages/renderer (Node strips the types itself).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ADJUST_SLIDERS,
  COLOR_PROPERTIES,
  HSL_RANGES,
  hasLegacyAdjustments,
  isNeutralColor,
  migrateLegacyAdjustments,
  setAdjust,
  setCurve,
  setHsl,
  setLut,
} from "../src/lib/color.ts";
import { BLEND_MODES, applyCanvasToAll, canvasBlur, fillsCanvas, setBlendMode, setChroma } from "../src/lib/compositing.ts";
import { applyScalePreset, centreOf, rotate90, scalePreset, toggleFlip, worldOf } from "../src/lib/transform-presets.ts";
import { editProperty, keyframeableProperties, propertyValue, toggleKeyframe, valueAt } from "../src/lib/keyframes.ts";

/** A file of the engine's, as text. */
const engine = (path: string) => readFileSync(fileURLToPath(new URL(`../../../../../engine/crates/${path}`, import.meta.url)), "utf8");
const strings = (src: string, pattern: RegExp): string[] => {
  const m = src.match(pattern);
  assert.ok(m, String(pattern));
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

const transform = { x: 0, y: 0, width: 1066.6666666666667, height: 600, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 };
const video = (extra: Record<string, unknown> = {}) => ({ clipId: "v", type: "video", startFrame: 0, endFrame: 48, transform, ...extra }) as any;

test("the lists are the engine's", () => {
  assert.deepEqual(ADJUST_SLIDERS.map((s) => s.key).sort(), strings(engine("v1/src/color.rs"), /const SLIDERS: \[&str; \d+\] = \[([^\]]*)\]/).sort());
  assert.deepEqual(HSL_RANGES.map((r) => r.key), strings(engine("v1/src/color.rs"), /const HSL_RANGES: \[&str; \d+\] = \[([^\]]*)\]/));
  // Every blend mode the model names, and CapCut's eleven in its menu.
  const names = [...engine("model/src/material.rs").matchAll(/BlendMode::\w+ => "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(BLEND_MODES.map((m) => m.id).sort(), names.sort());
  assert.equal(BLEND_MODES.length, 11);
  assert.deepEqual(BLEND_MODES.map((m) => m.name).slice(0, 3), ["Default", "Color dodge", "Linear burn"]);
});

test("colour patches are new objects within their ranges", () => {
  const clip = video();
  const p = setAdjust(clip, "exposure", 80) as any;
  assert.deepEqual(p.color.adjust, { exposure: 50 });
  assert.equal(clip.color, undefined);
  const q = setAdjust({ ...clip, ...p }, "exposure", 0) as any;
  assert.deepEqual(q.color.adjust, {});
  assert.deepEqual((setAdjust(clip, "sharpen", -5) as any).color.adjust, {});
  assert.deepEqual((setHsl(clip, "blue", "saturation", -150) as any).color.hsl, { blue: { saturation: -100 } });
  assert.deepEqual((setCurve(clip, "luma", [[1, 0.9], [0, 0.1]]) as any).color.curves.luma, [[0, 0.1], [1, 0.9]]);
  assert.equal((setLut(clip, { path: "/a.cube", intensity: 140 }) as any).color.lut.intensity, 100);
  assert.ok(isNeutralColor({ adjust: { exposure: 0 }, curves: { luma: [[0, 0], [1, 1]] }, wheels: { intensity: 50 } }));
  assert.ok(!isNeutralColor({ hsl: { red: { hue: 5 } } }));
  assert.ok(!isNeutralColor({ lut: { path: "/a.cube" } }));
});

test("the colour tools and the chroma key are keyframeable, edited as CapCut edits", () => {
  const clip = video({ color: { adjust: { contrast: 10 } } });
  const props = keyframeableProperties(clip);
  for (const p of [...COLOR_PROPERTIES, "chroma:intensity"]) assert.ok(props.includes(p as any), p);
  assert.equal(propertyValue(clip, "adjust:contrast"), 10);
  assert.equal(propertyValue(clip, "hsl:red:hue"), 0);
  assert.equal(propertyValue(clip, "wheels:intensity"), 100);
  assert.equal(propertyValue(clip, "lut:intensity"), undefined);
  // Unkeyed, an edit sets the field.
  assert.deepEqual((editProperty(clip, "adjust:contrast", 0, 25) as any).color.adjust, { contrast: 25 });
  assert.deepEqual((editProperty(clip, "chroma:spill", 0, 40) as any).chroma, { color: "#00ff00", intensity: 0, shadow: 0, edgeSmooth: 0, spill: 40 });
  // Keyed, the value travels between keys and an edit sets a key.
  const keyed = { ...clip, ...toggleKeyframe(clip, "adjust:contrast", 0, 24) };
  const later = { ...keyed, ...editProperty(keyed, "adjust:contrast", 24, 30) };
  assert.equal(valueAt(later, "adjust:contrast", 12, 24), 20);
  assert.equal(later.color.adjust.contrast, 10);
});

test("blend, chroma and canvas patches", () => {
  assert.deepEqual(setBlendMode(video(), "screen"), { blendMode: "screen" });
  assert.deepEqual(setBlendMode({ clipId: "a", type: "audio" } as any, "screen"), {});
  assert.deepEqual(setBlendMode({ clipId: "t", type: "text" } as any, "multiply"), { blendMode: "multiply" });
  const keyed = setChroma(video(), "color", "#0a8f2c") as any;
  assert.deepEqual(keyed.chroma, { color: "#0a8f2c", intensity: 0, shadow: 0, edgeSmooth: 0, spill: 0 });
  assert.equal((setChroma(video(keyed), "intensity", 250) as any).chroma.intensity, 100);
  const timelines = [{ timelineId: "over", type: "media" }, { timelineId: "main", type: "media" }, { timelineId: "a", type: "audio" }] as any;
  const clips = [video({ clipId: "m1", timelineId: "main" }), video({ clipId: "m2", timelineId: "main" }), video({ clipId: "o", timelineId: "over" })];
  assert.deepEqual(applyCanvasToAll(clips, timelines, canvasBlur(0.75)), [["m1", { canvas: { type: "blur", blur: 0.75 } }], ["m2", { canvas: { type: "blur", blur: 0.75 } }]]);
  assert.ok(fillsCanvas(clips[0], timelines) && !fillsCanvas(clips[2], timelines));
});

test("the old sliders move onto CapCut's where they have a counterpart", () => {
  const clip = video({ contrast: 25, saturation: -50, brightness: 30, hue: 10, sharpness: 50, color: { adjust: { exposure: 5 } } });
  const p = migrateLegacyAdjustments(clip) as any;
  assert.deepEqual(p.color.adjust, { exposure: 5, contrast: 25, saturation: -19, sharpen: 56 });
  assert.deepEqual([p.contrast, p.saturation, p.sharpness, p.brightness, p.hue], [0, 0, 0, undefined, undefined]);
  // Keyframed ones and ones already set in `color` stay; nothing to move gives nothing.
  const keyed = video({ vignette: 50, keyframes: { vignette: [{ frame: 0, value: 50 }] } });
  assert.deepEqual(migrateLegacyAdjustments(keyed), {});
  assert.ok(!hasLegacyAdjustments(video({ brightness: 40 })));
  assert.deepEqual(migrateLegacyAdjustments(video({ contrast: 25, color: { adjust: { contrast: -3 } } })), {});
});

test("fit, fill and stretch scale the picture to the canvas, centred", () => {
  const world = worldOf(9 / 16);
  // A 16:9 picture (its box 600 wide at scale 1, 337.5 tall) on a 9:16 canvas.
  const t = { ...transform, x: 40, y: 50, width: 337.5, height: 189.84375, scaleX: 1.3, scaleY: 1.3 };
  const fit = scalePreset(t, world, "fit");
  assert.ok(Math.abs(fit.width * fit.scaleX - world.width) < 1e-9 && fit.scaleX === fit.scaleY);
  assert.deepEqual(centreOf(fit).map((v) => +v.toFixed(9)), [world.width / 2, world.height / 2]);
  const fill = scalePreset(t, world, "fill");
  assert.ok(Math.abs(fill.height * fill.scaleY - world.height) < 1e-9 && fill.width * fill.scaleX > world.width);
  const stretch = scalePreset(t, world, "stretch");
  assert.ok(Math.abs(stretch.width * stretch.scaleX - world.width) < 1e-9 && Math.abs(stretch.height * stretch.scaleY - world.height) < 1e-9);
  // Turned a quarter, it fits by its turned size.
  const turned = scalePreset({ ...t, rotation: 90 }, world, "fit");
  assert.ok(Math.abs(turned.width * turned.scaleX - world.height) < 1e-9 || Math.abs(turned.height * turned.scaleY - world.width) < 1e-9);
  assert.deepEqual(applyScalePreset({ clipId: "t", type: "text", transform: t } as any, world, "fit"), {});
});

test("a quarter turn keeps the centre; flips toggle", () => {
  const clip = video({ transform: { ...transform, x: 100, y: 50, width: 200, height: 100 } });
  const p = rotate90(clip) as any;
  assert.equal(p.transform.rotation, 90);
  assert.deepEqual(centreOf(p.transform).map((v) => +v.toFixed(9)), centreOf(clip.transform).map((v) => +v.toFixed(9)));
  assert.equal((rotate90({ ...clip, ...p }, -1) as any).transform.rotation, 0);
  const f = toggleFlip(clip, "horizontal") as any;
  assert.deepEqual(f.flip, { horizontal: true, vertical: false });
  assert.deepEqual((toggleFlip({ ...clip, ...f }, "horizontal") as any).flip, { horizontal: false, vertical: false });
});

test("canvas patterns are the engine's, and each draws both its colours", async () => {
  const { CANVAS_PATTERNS, onShape } = await import("../src/lib/canvas-patterns.ts");
  const ids = [...engine("playback/src/pattern.rs").matchAll(/Pattern \{ id: "(\w+)", back: \[([^\]]*)\], shape: \[([^\]]*)\] \}/g)];
  assert.deepEqual(CANVAS_PATTERNS.map((p) => p.id), ids.map((m) => m[1]));
  const hex = (list: string) => "#" + list.split(",").map((v) => Number(v.trim()).toString(16).padStart(2, "0")).join("");
  assert.deepEqual(CANVAS_PATTERNS.map((p) => [p.back, p.shape]), ids.map((m) => [hex(m[2]), hex(m[3])]));
  for (const p of CANVAS_PATTERNS) {
    const hits = new Set<boolean>();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) hits.add(onShape(p.id, (x + 0.5) / 20, (y + 0.5) / 20));
    assert.equal(hits.size, 2, p.id);
  }
});

test("the colour wheels keep Primary and Log values apart", async () => {
  const { setWheel, setWheelMode, wheelOf, wheelMode, isNeutralColor } = await import("../src/lib/color.ts");
  let clip = video({ color: {} });
  clip = { ...clip, ...setWheel(clip, "lift", { red: 0.5 }) };
  clip = { ...clip, ...setWheelMode(clip, "log") };
  assert.equal(wheelMode(clip.color), "log");
  assert.deepEqual(wheelOf(clip.color, "lift"), {});
  clip = { ...clip, ...setWheel(clip, "lift", { luma: 0.3 }) };
  assert.deepEqual(clip.color.wheels.log.lift, { luma: 0.3 });
  assert.deepEqual(clip.color.wheels.lift, { red: 0.5 });
  clip = { ...clip, ...setWheelMode(clip, "primary") };
  assert.deepEqual(wheelOf(clip.color, "lift"), { red: 0.5 });
  assert.equal(isNeutralColor({ wheels: { mode: "log", lift: { red: 1 } } }), true);
  assert.equal(isNeutralColor({ wheels: { mode: "log", log: { gain: { blue: 0.2 } } } }), false);
});
