// Tests for src/lib/text-styles.ts and src/lib/text-presets.ts: `node --test tests/*.test.ts`
// in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TEXT_STYLES, isCapCutStyle, textEffectOf, textStyleCss } from "../src/lib/text-styles.ts";
import { TEXT_PRESETS, presetTextClip, textPreset } from "../src/lib/text-presets.ts";
import type { TextStylePaint } from "../src/lib/types.ts";

const engine = (path: string) => readFileSync(fileURLToPath(new URL(`../../../../../engine/crates/v1/src/${path}`, import.meta.url)), "utf8");

const paints = (s: (typeof TEXT_STYLES)[number]["style"]): TextStylePaint[] => [
  ...(s.fill ? [s.fill] : []),
  ...(s.strokes ?? []).map((x) => x.paint),
  ...(s.shadows ?? []).map((x) => x.paint),
];

test("every style is well formed", () => {
  assert.equal(new Set(TEXT_STYLES.map((s) => s.id)).size, TEXT_STYLES.length);
  for (const s of TEXT_STYLES) {
    assert.equal(s.style.id, s.id);
    assert.ok(s.id !== "", "an empty id means a CapCut style");
    for (const p of paints(s.style)) {
      if ("color" in p) assert.match(p.color, /^#[0-9a-f]{6}([0-9a-f]{2})?$/i, s.id);
      if ("gradient" in p) {
        assert.ok(p.gradient.colors.length >= 2, s.id);
        if (p.gradient.stops) assert.equal(p.gradient.stops.length, p.gradient.colors.length);
      }
      if (p.opacity != null) assert.ok(p.opacity >= 0 && p.opacity <= 100);
    }
    // Sizes are fractions of the font size.
    for (const o of s.style.strokes ?? []) assert.ok(o.width > 0 && o.width < 0.5, s.id);
    for (const sh of s.style.shadows ?? []) assert.ok(sh.distance >= 0 && sh.distance < 0.5 && sh.blur >= 0, s.id);
  }
});

test("a style goes on a clip as a copy, and none takes it off", () => {
  const a = textEffectOf("neon")!;
  a.strokes![0].width = 9;
  assert.notEqual(textEffectOf("neon")!.strokes![0].width, 9);
  assert.equal(textEffectOf(null), null);
  assert.equal(textEffectOf("no-such-style"), null);
  assert.equal(isCapCutStyle({ id: "", name: "Retro" }), true);
  assert.equal(isCapCutStyle(a), false);
});

test("the engine reads the fields the styles and presets use", () => {
  // The v1 importer's text keys (app.rs) and the style's paint names (text.rs).
  const keys = engine("app.rs").match(/TEXT_STYLE_KEYS: \[&str; \d+\] = \[([^\]]*)\]/)![1];
  for (const k of ["letterSpacing", "lineSpacing", "fillGradient", "moreStrokes", "glowEnabled", "glowColor", "glowIntensity", "glowRange", "glowOffsetX", "glowOffsetY"]) {
    assert.ok(keys.includes(`"${k}"`), k);
  }
  const text = engine("text.rs");
  for (const k of ['"textColor"', '"gradient"', '"opacity"', '"strokes"', '"shadows"', '"intensity"', '"range"', '"span"', '"stops"']) assert.ok(text.includes(k), k);
});

test("tile CSS follows a style", () => {
  const sunset = textStyleCss(textEffectOf("sunset")!, "#ffffff", 20);
  assert.match(String(sunset.backgroundImage), /^linear-gradient\(180deg, #ffb347 0%, #ff4e7a 100%\)$/);
  const outline = textStyleCss(textEffectOf("double_outline")!, "#00ff00", 20);
  assert.equal(outline.color, "rgba(0, 255, 0, 1)");
  assert.match(String(outline.WebkitTextStroke), /^2\.4px rgba\(255, 255, 255, 1\)$/);
  assert.ok(String(outline.textShadow).includes("2.8px 0 0"));
});

test("presets: the shell's eight, and ours, make text clips", () => {
  for (const id of ["plain", "title", "outline", "shadow", "label", "serif", "caps", "yellow"]) assert.ok(textPreset(id), id);
  assert.equal(new Set(TEXT_PRESETS.map((p) => p.id)).size, TEXT_PRESETS.length);
  const canvas = { width: 1066.67, height: 600 };
  for (const p of TEXT_PRESETS) {
    const clip = presetTextClip(p, { clipId: "c", timelineId: "t", startFrame: 30, fps: 30, canvas, totalFrames: 1000 });
    assert.equal(clip.type, "text");
    assert.equal(clip.endFrame - clip.startFrame, 90, p.id);
    assert.ok(clip.text && clip.fontFamily && clip.color, p.id);
    if (clip.textEffect) assert.ok(TEXT_STYLES.some((s) => s.id === clip.textEffect!.id), p.id);
    if (p.animationIn) assert.equal(clip.animationIn?.type, p.animationIn.type, p.id);
    // Centred.
    const t = clip.transform!;
    assert.ok(Math.abs(t.x + t.width / 2 - canvas.width / 2) < 0.01 && Math.abs(t.y + t.height / 2 - canvas.height / 2) < 0.01);
  }
  // A clip's style is its own copy; the end stops before the timeline's end.
  const a = presetTextClip(textPreset("neon")!, { clipId: "a", timelineId: "t", startFrame: 0, fps: 30, canvas });
  a.textEffect!.name = "changed";
  assert.equal(presetTextClip(textPreset("neon")!, { clipId: "b", timelineId: "t", startFrame: 0, fps: 30, canvas }).textEffect!.name, "Neon");
  assert.equal(presetTextClip(textPreset("plain")!, { clipId: "c", timelineId: "t", startFrame: 50, fps: 30, canvas, totalFrames: 60 }).endFrame, 59);
});
