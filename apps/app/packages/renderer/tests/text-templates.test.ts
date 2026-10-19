// Tests for src/lib/text-templates.ts: `node --test tests/*.test.ts` in packages/renderer. Every
// template is valid data and lays out into clips the app and the engine take.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TEMPLATE_CATEGORIES, TEXT_TEMPLATES, DESIGN_CANVAS, templateFields, templateLayout, templateMatches, templatePlacement, templatesIn, textTemplate, type TextLayer, type TextTemplate } from "../src/lib/text-templates.ts";
import { animationsFor } from "../src/lib/animations.ts";
import { textStyle } from "../src/lib/text-styles.ts";
import type { AnyClipProps, ShapeClipProps, TextClipProps } from "../src/lib/types.ts";

const main = readFileSync(fileURLToPath(new URL("../src/main.tsx", import.meta.url)), "utf8");
/** The bundled fonts' families, from the @fontsource imports (poppins → Poppins, pt-sans → PT Sans). */
const bundled = new Set(
  [...main.matchAll(/@fontsource\/([a-z-]+)\//g)].map((m) => m[1]).map((slug) => (slug === "pt-sans" ? "PT Sans" : slug === "open-sans" ? "Open Sans" : slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "))),
);

const canvases = [
  { name: "16:9", width: 1066.6666666666667, height: 600 },
  { name: "9:16", width: 337.5, height: 600 },
  { name: "1:1", width: 600, height: 600 },
  { name: "4:3", width: 800, height: 600 },
];

const layout = (t: TextTemplate, canvas = canvases[0], startFrame = 48) => {
  let n = 0;
  return templateLayout(t, { fps: 24, canvas, startFrame, ids: () => ({ clipId: `${t.id}-c${n}`, timelineId: `${t.id}-t${n++}` }) });
};

test("there are about fifty templates in all the categories, each with a unique id and name", () => {
  assert.ok(TEXT_TEMPLATES.length >= 50, `${TEXT_TEMPLATES.length}`);
  assert.equal(new Set(TEXT_TEMPLATES.map((t) => t.id)).size, TEXT_TEMPLATES.length);
  assert.equal(new Set(TEXT_TEMPLATES.map((t) => t.name.toLowerCase())).size, TEXT_TEMPLATES.length);
  for (const c of TEMPLATE_CATEGORIES) assert.ok(templatesIn(c).length >= 5, c);
  assert.equal(templatesIn("All").length, TEXT_TEMPLATES.length);
  assert.ok(TEXT_TEMPLATES.every((t) => TEMPLATE_CATEGORIES.includes(t.category)));
});

test("none carries another product's name", () => {
  const all = JSON.stringify(TEXT_TEMPLATES).toLowerCase();
  assert.ok(!all.includes("capcut"));
});

test("every template is well formed", () => {
  for (const t of TEXT_TEMPLATES) {
    assert.match(t.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, t.id);
    assert.ok(t.name.length > 0 && t.seconds > 0 && t.seconds <= 8, t.id);
    assert.ok(t.size[0] > 0 && t.size[1] > 0, t.id);
    assert.ok(t.layers.length >= 1, t.id);
    assert.ok(t.layers.some((l) => l.kind === "text"), `${t.id} has words to edit`);
    for (const l of t.layers) {
      const [x, y, w, h] = l.box;
      // Inside the block (a few units of slack for strokes and glows).
      assert.ok(w > 0 && h > 0, `${t.id} box`);
      assert.ok(x >= -4 && y >= -4 && x + w <= t.size[0] + 4 && y + h <= t.size[1] + 4, `${t.id} layer box ${l.box} outside ${t.size}`);
      assert.ok((l.from ?? 0) >= 0 && (l.to ?? t.seconds) <= t.seconds && (l.from ?? 0) < (l.to ?? t.seconds), `${t.id} timing`);
    }
  }
});

test("the text uses only the bundled fonts, text styles and animations that exist", () => {
  assert.ok(bundled.has("Montserrat") && bundled.has("Oswald") && bundled.has("Playfair Display") && bundled.has("Raleway") && bundled.has("Roboto"), [...bundled].join(","));
  const fakeText = { type: "text" } as AnyClipProps;
  for (const t of TEXT_TEMPLATES) {
    for (const l of t.layers.filter((x): x is TextLayer => x.kind === "text")) {
      assert.ok(bundled.has(l.props?.fontFamily ?? ""), `${t.id}: ${l.props?.fontFamily}`);
      if (l.style) assert.ok(textStyle(l.style), `${t.id}: style ${l.style}`);
      for (const [kind, spec] of [["in", l.in], ["out", l.out], ["loop", l.loop]] as const) {
        if (spec) assert.ok(animationsFor(fakeText.type, kind).some((a) => a.type === spec.type), `${t.id}: ${kind} ${spec.type}`);
      }
    }
  }
});

test("every template lays out into valid clips on every canvas", () => {
  for (const t of TEXT_TEMPLATES) {
    for (const canvas of canvases) {
      const clips = layout(t, canvas);
      assert.equal(clips.length, t.layers.length, t.id);
      assert.equal(new Set(clips.map((c) => c.clip.clipId)).size, clips.length);
      assert.equal(new Set(clips.map((c) => c.clip.timelineId)).size, clips.length, "a track for each layer");
      const { x, y, width, height } = templatePlacement(t, canvas);
      for (const { clip, layer } of clips) {
        const where = `${t.id} on ${canvas.name}`;
        assert.ok(clip.type === "text" || clip.type === "shape", where);
        assert.equal(clip.type, layer.kind, where);
        assert.ok(Number.isInteger(clip.startFrame) && Number.isInteger(clip.endFrame) && clip.startFrame >= 48 && clip.endFrame > clip.startFrame, `${where} frames`);
        assert.ok(clip.endFrame <= 48 + Math.round(t.seconds * 24), `${where} ends with the template`);
        const tr = clip.transform!;
        for (const v of [tr.x, tr.y, tr.width, tr.height, tr.rotation, tr.opacity, tr.cornerRadius]) assert.ok(Number.isFinite(v), where);
        assert.ok(tr.width > 0 && tr.height > 0, where);
        // The block fits the canvas.
        assert.ok(width <= canvas.width + 0.01 && height <= canvas.height + 0.01, `${where} block ${width}x${height}`);
        assert.ok(tr.x >= x - 4 && tr.y >= y - 4 && tr.x + tr.width <= x + width + 4 && tr.y + tr.height <= y + height + 4, `${where} in its block`);
        for (const [prop, list] of Object.entries(clip.keyframes ?? {})) {
          assert.ok(list!.length >= 1, `${where} ${prop}`);
          const frames = list!.map((k) => k.frame);
          assert.deepEqual([...frames].sort((a, b) => a - b), frames, `${where} ${prop} sorted`);
          assert.equal(new Set(frames).size, frames.length, `${where} ${prop} one key a frame`);
          for (const k of list!) {
            assert.ok(Number.isFinite(k.frame) && k.frame >= 0 && k.frame <= clip.endFrame - clip.startFrame + 1, `${where} ${prop} frame`);
            const v = k.value;
            if (Array.isArray(v)) assert.ok(v.every(Number.isFinite), `${where} ${prop}`);
            else if (typeof v === "number") assert.ok(Number.isFinite(v), `${where} ${prop}`);
            else assert.match(v, /^#[0-9a-f]{6}$/i);
          }
        }
        if (clip.type === "text") {
          const text = clip as TextClipProps;
          assert.ok(typeof text.text === "string" && text.text.length > 0, where);
          assert.ok((text.fontSize ?? 0) > 0, where);
          for (const a of [text.animationIn, text.animationOut, text.animationLoop]) if (a) assert.ok(a.duration > 0 && a.duration <= (clip.endFrame - clip.startFrame) / 24 + 1e-9, `${where} animation ${a.type}`);
        } else {
          const shape = clip as ShapeClipProps;
          if (shape.shapeType === "path") assert.ok(shape.path!.length >= 3 && shape.path!.every((p) => p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05), `${where} path`);
          assert.match(shape.fill ?? "#000000", /^#[0-9a-f]{6}$/i);
        }
      }
    }
  }
});

test("a template keeps its look at any start frame and scales with the canvas", () => {
  const t = textTemplate("clean-bar")!;
  const a = layout(t, canvases[0], 0);
  const b = layout(t, canvases[0], 120);
  assert.deepEqual(a.map((c) => c.clip.endFrame - c.clip.startFrame), b.map((c) => c.clip.endFrame - c.clip.startFrame));
  assert.equal(b[0].clip.startFrame - a[0].clip.startFrame, 120);
  const small = layout(t, canvases[1]).find((c) => c.clip.type === "text")!.clip as TextClipProps;
  const big = layout(t, canvases[0]).find((c) => c.clip.type === "text")!.clip as TextClipProps;
  assert.ok(small.fontSize! < big.fontSize!);
});

test("a block sits where its template says", () => {
  const c = canvases[0];
  const bottomLeft = templatePlacement(textTemplate("clean-bar")!, c);
  assert.ok(bottomLeft.x < c.width / 4 && bottomLeft.y + bottomLeft.height > c.height * 0.8);
  const middle = templatePlacement(textTemplate("bold-opener")!, c);
  assert.ok(Math.abs(middle.x + middle.width / 2 - c.width / 2) < 0.01 && Math.abs(middle.y + middle.height / 2 - c.height / 2) < 0.01);
  assert.equal(DESIGN_CANVAS.height, 600);
});

test("the words of a template are fields with names", () => {
  for (const t of TEXT_TEMPLATES) {
    const fields = templateFields(t);
    assert.equal(fields.length, t.layers.filter((l) => l.kind === "text").length);
    assert.equal(new Set(fields.map((f) => f.label)).size, fields.length, `${t.id} field names`);
  }
});

test("search finds templates by name, category, keyword and words", () => {
  const find = (q: string) => TEXT_TEMPLATES.filter((t) => templateMatches(t, q)).map((t) => t.id);
  assert.ok(find("subscribe").includes("subscribe-button"));
  assert.ok(find("lower").length === 0 || find("lower").every((id) => textTemplate(id)));
  assert.ok(find("lower thirds").includes("clean-bar"));
  assert.ok(find("COUNTDOWN").includes("countdown-321"));
  assert.ok(find("zzzz").length === 0);
  assert.equal(find("").length, TEXT_TEMPLATES.length);
});
