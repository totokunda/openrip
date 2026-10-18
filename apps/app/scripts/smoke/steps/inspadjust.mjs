// The Adjust tab (after import timeline; CLIP_NAME for a photo): a .cube LUT imported and its
// intensity, each of the fourteen Basic sliders, an HSL range, the luma and red curves edited
// on their graphs, a colour wheel's puck and luma, and the old sliders moved onto CapCut's;
// each undone and redone with the engine's frame and the saved project compared (undoCase).
// Exposure, an HSL saturation and the wheels' intensity keyed at two times (keyCase). The old
// sliders are set through the store, so the step needs the renderer's dev server (as
// `keyframes`).
import path from "node:path";
import fs from "node:fs";
import { drag, settled } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { at, choose, click, keyCase, mediaClip, open, savedClip, typeIn } from "./_inspector.mjs";

const SLIDERS = [
  ["Temp", 40],
  ["Tint", -40],
  ["Saturation", -45],
  ["Exposure", 35],
  ["Contrast", 40],
  ["Highlight", -40],
  ["Shadow", 40],
  ["Whites", 40],
  ["Blacks", -40],
  ["Brilliance", 40],
  ["Sharpen", 90],
  ["Clarity", 90],
  ["Fade", 80],
  ["Vignette", 70],
];

export default async (ctx) => {
  const { win, app, shot, outDir } = ctx;
  const { check, report } = checks();
  const clip = await mediaClip(ctx);
  const id = clip.clipId;
  const T = 1.5;
  const basic = () => open(win, "Adjust", "Basic");
  await at(ctx, id, T);
  await basic();
  await shot("ia-0-basic");
  const run = async (name, edit, opts) => {
    try {
      const r = await undoCase(ctx, check, name, edit, opts);
      if (!r.ok) await shot(`ia-fail-${name.replace(/\W+/g, "-")}`);
      return r.ok;
    } catch (e) {
      check(name, false, e.message.split("\n")[0]);
      await shot(`ia-fail-${name.replace(/\W+/g, "-")}`);
      return false;
    }
  };

  // A LUT: an inverting .cube picked from Import…, then its intensity.
  const cube = path.join(outDir, "invert.cube");
  let text = "LUT_3D_SIZE 2\n";
  for (const b of [0, 1]) for (const g of [0, 1]) for (const r of [0, 1]) text += `${1 - r} ${1 - g} ${1 - b}\n`;
  fs.writeFileSync(cube, text);
  await app.evaluate(({ ipcMain }, p) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [p]);
  }, cube);
  await run("LUT imported", () => choose(win, "LUT", "Import…"));
  await run("LUT intensity", () => typeIn(win, "Intensity", 50));
  const lut = (await savedClip(ctx, id)).color?.lut;
  check("the LUT is on the clip", lut?.path === cube && lut?.intensity === 50, JSON.stringify(lut));
  await run("LUT off", () => choose(win, "LUT", "None"));

  // The fourteen sliders, in CapCut's order.
  for (const [name, v] of SLIDERS) await run(`${name} ${v}`, () => typeIn(win, name, v));
  const adjust = (await savedClip(ctx, id)).color?.adjust ?? {};
  check("all fourteen are saved on CapCut's scale", Object.keys(adjust).length === 14, JSON.stringify(adjust));
  await shot("ia-1-sliders");
  await run("Adjust reset", () => click(win, "[aria-label='Reset Adjust']"));
  await keyCase(ctx, check, "exposure", { id, row: "Exposure", t1: 1, t2: 4, reopen: basic, undoCase, set1: () => typeIn(win, "Exposure", -30), set2: () => typeIn(win, "Exposure", 40) });

  // HSL: orange (skin and warm tones) shifted.
  const hsl = () => open(win, "Adjust", "HSL");
  await at(ctx, id, T);
  await hsl();
  await click(win, "[data-testid=hsl-orange]");
  await run("HSL orange hue", () => typeIn(win, "Hue", 80));
  await run("HSL orange saturation", () => typeIn(win, "Saturation", -100));
  await run("HSL orange brightness", () => typeIn(win, "Brightness", 60));
  await shot("ia-2-hsl");
  await keyCase(ctx, check, "HSL saturation", {
    id,
    row: "Saturation",
    t1: 1,
    t2: 4,
    undoCase,
    reopen: async () => {
      await hsl();
      await click(win, "[data-testid=hsl-orange]");
    },
    set1: () => typeIn(win, "Saturation", 100),
    set2: () => typeIn(win, "Saturation", -100),
  });

  // Curves: a point added in the middle of the luma graph and lifted; then taken out again by a
  // double-click; the red curve's end lowered.
  const curves = () => open(win, "Adjust", "Curves");
  await at(ctx, id, T);
  await curves();
  const graph = async (ch) => {
    const el = win.locator(`[data-testid=curve-${ch}]`);
    await el.scrollIntoViewIfNeeded();
    return el.boundingBox();
  };
  let g = await graph("luma");
  await run("luma curve lifted", () => settled(win, () => drag(win, g.x + g.width / 2, g.y + g.height / 2, g.x + g.width / 2, g.y + g.height * 0.2)));
  g = await graph("luma");
  await run("luma point taken out", () => settled(win, () => win.mouse.dblclick(g.x + g.width / 2, g.y + g.height * 0.2)));
  g = await graph("red");
  await run("red curve's white end lowered", () => settled(win, () => drag(win, g.x + g.width - 1, g.y + 1, g.x + g.width - 1, g.y + g.height * 0.5)));
  await shot("ia-3-curves");

  // Colour wheels: the shadows' puck pushed to the rim, the highlights' luma raised, then the
  // wheels' intensity.
  const wheels = () => open(win, "Adjust", "Color wheel");
  await at(ctx, id, T);
  await wheels();
  const ring = async (w, part) => {
    const el = win.locator(`[data-testid=wheel-${w}] [aria-label$="${part}"]`).first();
    await el.scrollIntoViewIfNeeded();
    return el.boundingBox();
  };
  let r = await ring("gamma", "colour");
  await run("middle grey's puck", () => settled(win, () => drag(win, r.x + r.width / 2, r.y + r.height / 2, r.x + r.width * 0.85, r.y + r.height * 0.3)));
  r = await ring("gain", "luma");
  await run("highlights' luma", () => settled(win, () => drag(win, r.x + r.width / 2, r.y + r.height / 2, r.x + r.width / 2, r.y + 2)));
  await run("wheels' intensity", () => typeIn(win, "Intensity", 40));
  await shot("ia-4-wheels");
  await keyCase(ctx, check, "wheels' intensity", { id, row: "Intensity", t1: 1, t2: 4, reopen: wheels, undoCase, set1: () => typeIn(win, "Intensity", 0), set2: () => typeIn(win, "Intensity", 100) });
  const saved = await savedClip(ctx, id);
  check("curves and wheels are saved", (saved.color?.curves?.red?.length ?? 0) >= 2 && Math.abs(saved.color?.wheels?.gamma?.red ?? 0) + Math.abs(saved.color?.wheels?.gamma?.blue ?? 0) > 0.2, JSON.stringify({ curves: saved.color?.curves, wheels: saved.color?.wheels }));

  // The old sliders: contrast and blur set as an older project has them; the Basic tab shows
  // them and moves contrast onto CapCut's (blur has no counterpart and stays).
  await win.evaluate(async (id) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const c = useClipStore.getState().clips.find((c) => c.clipId === id);
    useClipStore.getState().updateClip(id, { contrast: 25, blur: 10, color: { ...(c.color ?? {}), adjust: {} } });
  }, id);
  await at(ctx, id, T);
  await basic();
  const shown = await win.locator("[data-testid=section-legacy]").count();
  await shot("ia-5-legacy");
  await run("Update to the new adjustments", () => click(win, "[data-testid=legacy-update]"), { frame: false });
  const moved = await savedClip(ctx, id);
  check(
    "the old contrast moved onto CapCut's, blur stays, the button goes",
    shown === 1 && moved.contrast === 0 && moved.color?.adjust?.contrast === 25 && moved.blur === 10 && (await win.locator("[data-testid=legacy-update]").count()) === 0,
    JSON.stringify({ shown, contrast: moved.contrast, blur: moved.blur, adjust: moved.color?.adjust }),
  );
  return report();
};
