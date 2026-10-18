// Colour and compositing set through the store with lib/color.ts, lib/compositing.ts and
// lib/transform-presets.ts on the first video or photo clip (after `import timeline`), and the
// engine's frames checked. The step imports the renderer's modules, so it needs the renderer
// from its dev server (as `keyframes`): `npx vite --port 5199` in packages/renderer and the
// session with MODE=development VITE_DEV_SERVER_URL=http://localhost:5199. `CANVAS_IMAGE` is an
// image for the canvas fill (default the calibration frame bench/calibration/out/frames/t1.png).
//
// Checks: the clip scaled to half, its canvas fill red around it, then a blur of itself, then
// an image; Darken and Screen against the red canvas; a mirror (the frame mirrored); exposure,
// HSL and a .cube LUT; a chroma key on the clip's own middle colour and its intensity keyframed;
// the old contrast slider moved onto CapCut's with the picture about the same; the saved
// project keeps the fields.
import fs from "node:fs";
import path from "node:path";
import { rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";

const CANVAS_IMAGE = process.env.CANVAS_IMAGE || "/Users/tosinkuye/openrip/bench/calibration/out/frames/t1.png";

// Mean colour (0–1) of a region of the engine's frame, in fractions of its size, and the share
// of its pixels close to pure red.
const region = (win, [x0, y0, x1, y1]) => win.evaluate(({ x0, y0, x1, y1 }) => {
  const c = document.getElementById("openrip-engine-frame");
  const t = document.createElement("canvas");
  t.width = c.width; t.height = c.height;
  const g = t.getContext("2d");
  g.drawImage(c, 0, 0);
  const [X0, Y0, X1, Y1] = [Math.floor(x0 * t.width), Math.floor(y0 * t.height), Math.ceil(x1 * t.width), Math.ceil(y1 * t.height)];
  const d = g.getImageData(X0, Y0, X1 - X0, Y1 - Y0).data;
  let r = 0, gr = 0, b = 0, red = 0, sat = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]; gr += d[i + 1]; b += d[i + 2];
    if (d[i] > 230 && d[i + 1] < 30 && d[i + 2] < 30) red++;
    sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
  }
  const n = d.length / 4;
  return { r: r / n / 255, g: gr / n / 255, b: b / n / 255, light: (r + gr + b) / n / 765, red: red / n, sat: sat / n / 255 };
}, { x0, y0, x1, y1 });

// The frame kept for comparing against later (by name), and how far a later frame is from it,
// as it is and mirrored left to right (mean absolute difference per channel, 0–1).
const keep = (win, name) => win.evaluate((name) => {
  const c = document.getElementById("openrip-engine-frame");
  const t = document.createElement("canvas");
  t.width = c.width; t.height = c.height;
  t.getContext("2d").drawImage(c, 0, 0);
  (window.__kept ??= {})[name] = t.getContext("2d").getImageData(0, 0, t.width, t.height);
}, name);
const against = (win, name) => win.evaluate((name) => {
  const a = window.__kept[name];
  const c = document.getElementById("openrip-engine-frame");
  const t = document.createElement("canvas");
  t.width = c.width; t.height = c.height;
  t.getContext("2d").drawImage(c, 0, 0);
  const b = t.getContext("2d").getImageData(0, 0, t.width, t.height);
  if (a.width !== b.width || a.height !== b.height) return { same: 1, mirrored: 1 };
  let same = 0, mirrored = 0;
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const i = (y * b.width + x) * 4, j = (y * b.width + (b.width - 1 - x)) * 4;
      for (let k = 0; k < 3; k++) {
        same += Math.abs(a.data[i + k] - b.data[i + k]);
        mirrored += Math.abs(a.data[j + k] - b.data[i + k]);
      }
    }
  }
  const n = b.width * b.height * 3 * 255;
  return { same: same / n, mirrored: mirrored / n };
}, name);

// Apply a patch a library function makes for the clip (`lib` its path under /src/lib, `fn`
// its name, `args` after the clip), and wait for the engine's picture.
const apply = (win, id, lib, fn, ...args) =>
  settled(win, () => win.evaluate(async ({ id, lib, fn, args }) => {
    const m = await import(`/src/lib/${lib}`);
    const { useClipStore } = await import("/src/lib/clip.ts");
    const clip = useClipStore.getState().clips.find((c) => c.clipId === id);
    useClipStore.getState().updateClip(id, m[fn](clip, ...args));
  }, { id, lib, fn, args }));
const update = (win, id, fields) =>
  settled(win, () => win.evaluate(async ({ id, fields }) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    useClipStore.getState().updateClip(id, fields);
  }, { id, fields }));

export default async (ctx) => {
  const { win, udDir, outDir, shot } = ctx;
  const { check, report } = checks();
  const map = (ctx.map = await rulerMap(win));
  const clip = await win.evaluate(async () => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const c = useClipStore.getState().clips.find((c) => c.type === "video" || c.type === "image");
    if (!c) throw new Error("no video or photo clip");
    return { id: c.clipId, start: c.startFrame, end: c.endFrame, fps: useControlsStore.getState().fps || 30 };
  });
  const { id } = clip;
  const mid = Math.round((clip.start + clip.end) / 2) / clip.fps;
  await seek(win, map, mid);
  const corner = [0, 0, 0.12, 0.08];
  const centre = [0.4, 0.4, 0.6, 0.6];

  // Half size, centred; a red canvas around it.
  await settled(win, () => win.evaluate(async (id) => {
    const k = await import("/src/lib/keyframes.ts");
    const { useClipStore } = await import("/src/lib/clip.ts");
    const c = useClipStore.getState().clips.find((c) => c.clipId === id);
    useClipStore.getState().updateClip(id, k.editProperty(c, "scale", c.startFrame, [c.transform.scaleX * 0.5, c.transform.scaleY * 0.5]));
  }, id));
  const plain = await region(win, corner);
  check(`with no canvas fill the corner is black (${plain.light.toFixed(3)})`, plain.light < 0.02);
  await apply(win, id, "compositing.ts", "setCanvas", { type: "color", color: "#ff0000" });
  const red = await region(win, corner);
  check(`a red canvas fills the corner (${JSON.stringify([red.r, red.g, red.b].map((v) => +v.toFixed(3)))})`, red.r > 0.95 && red.g < 0.05 && red.b < 0.05);
  await shot("cmp1-canvas-red");
  await apply(win, id, "compositing.ts", "setCanvas", { type: "blur", blur: 0.375 });
  const blur = await region(win, corner);
  check(`a blur canvas is the clip blurred (corner ${blur.light.toFixed(3)}, red share ${blur.red.toFixed(2)})`, blur.light > 0.05 && blur.red < 0.05);
  await shot("cmp2-canvas-blur");
  if (fs.existsSync(CANVAS_IMAGE)) {
    await apply(win, id, "compositing.ts", "setCanvas", { type: "image", image: CANVAS_IMAGE });
    const image = await region(win, [0, 0, 1, 0.2]);
    const blurTop = blur.light;
    check(`an image canvas covers it (top strip ${image.light.toFixed(3)} vs the blur's corner ${blurTop.toFixed(3)})`, Math.abs(image.light - blurTop) > 0.01 || image.red > 0.01);
    await shot("cmp3-canvas-image");
  }

  // Blend modes against the red canvas: Darken keeps the clip's red at most and no green or
  // blue; Screen brings red up to full.
  await apply(win, id, "compositing.ts", "setCanvas", { type: "color", color: "#ff0000" });
  const normal = await region(win, centre);
  await apply(win, id, "compositing.ts", "setBlendMode", "darken");
  const dark = await region(win, centre);
  check(`Darken over red leaves no green or blue (${JSON.stringify([dark.r, dark.g, dark.b].map((v) => +v.toFixed(3)))})`, dark.g < 0.02 && dark.b < 0.02 && dark.r > 0.05);
  await apply(win, id, "compositing.ts", "setBlendMode", "screen");
  const screen = await region(win, centre);
  check(`Screen over red brings red to full (${screen.r.toFixed(3)}; green as the clip's ${screen.g.toFixed(3)} ~ ${normal.g.toFixed(3)})`, screen.r > 0.97 && Math.abs(screen.g - normal.g) < 0.03);
  await shot("cmp4-screen");
  await apply(win, id, "compositing.ts", "setBlendMode", "normal");
  const back = await region(win, centre);
  check("Default draws the clip as before", Math.abs(back.light - normal.light) < 0.005);

  // Mirror: the frame mirrored left to right (the canvas red all round stays).
  await keep(win, "unflipped");
  await apply(win, id, "transform-presets.ts", "toggleFlip", "horizontal");
  const flipped = await against(win, "unflipped");
  check(`the mirror mirrors the frame (difference ${flipped.same.toFixed(3)} as it is, ${flipped.mirrored.toFixed(3)} mirrored)`, flipped.mirrored < 0.02 && flipped.same > flipped.mirrored * 2);
  await shot("cmp5-mirror");
  await apply(win, id, "transform-presets.ts", "toggleFlip", "horizontal");

  // Colour: exposure lightens; HSL saturation down on every range greys it; an inverting LUT
  // inverts it.
  const before = await region(win, centre);
  await apply(win, id, "color.ts", "setAdjust", "exposure", 40);
  const exposed = await region(win, centre);
  check(`exposure +40 lightens the clip (${before.light.toFixed(3)} → ${exposed.light.toFixed(3)})`, exposed.light > before.light + 0.03);
  await update(win, id, { color: { hsl: Object.fromEntries(["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta"].map((r) => [r, { saturation: -100 }])) } });
  const grey = await region(win, centre);
  check(`HSL saturation −100 on every range greys it (saturation ${before.sat.toFixed(3)} → ${grey.sat.toFixed(3)})`, grey.sat < before.sat * 0.6);
  const cube = path.join(outDir, "invert.cube");
  let text = "LUT_3D_SIZE 2\n";
  for (const b of [0, 1]) for (const g of [0, 1]) for (const r of [0, 1]) text += `${1 - r} ${1 - g} ${1 - b}\n`;
  fs.writeFileSync(cube, text);
  await update(win, id, { color: { lut: { path: cube, name: "invert", intensity: 100 } } });
  const inverted = await region(win, centre);
  check(`an inverting .cube LUT inverts it (${before.light.toFixed(3)} → ${inverted.light.toFixed(3)})`, Math.abs(inverted.light - (1 - before.light)) < 0.06);
  await shot("cmp6-lut");
  await update(win, id, { color: null });

  // Chroma key on the clip's own middle colour: the red canvas shows through where it's keyed.
  const hex = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  const key = `#${hex(before.r)}${hex(before.g)}${hex(before.b)}`;
  await update(win, id, { chroma: { color: key, intensity: 70, shadow: 0, edgeSmooth: 0, spill: 0 } });
  const keyed = await region(win, centre);
  check(`a chroma key on ${key} lets the red canvas through (${before.red.toFixed(2)} → ${keyed.red.toFixed(2)} of the middle red)`, keyed.red > before.red + 0.1);
  await shot("cmp7-chroma");
  // Its intensity keyed from 0 at the clip's start to 100 at its end.
  const local = clip.end - clip.start;
  await update(win, id, { keyframes: { "chroma:intensity": [{ frame: 0, value: 0 }, { frame: local, value: 100 }] } });
  await seek(win, map, (clip.start + 2) / clip.fps);
  const early = await region(win, centre);
  await seek(win, map, (clip.end - 2) / clip.fps);
  const late = await region(win, centre);
  check(`keyed intensity keys more over time (${early.red.toFixed(2)} → ${late.red.toFixed(2)})`, late.red > early.red + 0.1);
  await update(win, id, { keyframes: {}, chroma: null });
  await seek(win, map, mid);

  // The old contrast slider moved onto CapCut's: about the same picture.
  await update(win, id, { contrast: 25 });
  const legacy = await region(win, centre);
  await apply(win, id, "color.ts", "migrateLegacyAdjustments");
  const moved = await region(win, centre);
  const fields = await win.evaluate(async (id) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const c = useClipStore.getState().clips.find((c) => c.clipId === id);
    return { contrast: c.contrast, color: c.color };
  }, id);
  check(`the old contrast moves onto CapCut's (${JSON.stringify(fields)}; light ${legacy.light.toFixed(3)} → ${moved.light.toFixed(3)})`, fields.contrast === 0 && fields.color?.adjust?.contrast === 25 && Math.abs(moved.light - legacy.light) < 0.03);

  // The saved project keeps the fields.
  await apply(win, id, "compositing.ts", "setBlendMode", "overlay");
  await apply(win, id, "transform-presets.ts", "toggleFlip", "vertical");
  const doc = await savedProject(win, udDir);
  const saved = doc.timeline.clips.find((c) => c.clipId === id);
  check("the saved project keeps the fields", saved?.canvas?.color === "#ff0000" && saved?.blendMode === "overlay" && saved?.flip?.vertical === true && saved?.color?.adjust?.contrast === 25, JSON.stringify({ canvas: saved?.canvas, blendMode: saved?.blendMode, flip: saved?.flip, color: saved?.color }));
  return report();
};
