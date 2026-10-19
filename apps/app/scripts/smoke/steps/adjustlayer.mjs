// The left panel's Adjustment tab and adjustment layers (after import timeline; CLIP_NAME=IMG_9079
// OPENRIP_ENGINE_MUTE=1, built app, no dev server): the column as CapCut's (Add adjustment, Yours,
// LUT) and its Custom adjustment tile; + adding a layer at the playhead on its own track (⌘Z / ⇧⌘Z);
// its inspector (Adjust with Basic, HSL, Curves, Color wheel and Mask, Save as preset); Exposure
// changing the engine's frame under it, and not before or after it; a text added above it
// keeping its own white; a keyframed slider; a mask limiting the grade; Save as preset and Yours;
// an imported .cube under LUT, previewed with a click and added as a layer; the project reopened
// with the layers there; and an export whose frames are graded (ffmpeg).
// Shots are named after the CapCut references (a1 ↔ 13-left-adjustment/001-add-adjustment, a2 ↔
// 004-custom-hover, a3 ↔ 002-yours, a4 ↔ 003-lut, i1 ↔ 25-inspector-adjustment-layer/001-basic-top,
// i2 ↔ 007-hsl-red, i3 ↔ 015-curves-luma, i4 ↔ 019-color-wheel-primary, i5 ↔ 025-mask-rectangle).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { engineFrame, grab, now, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { at, click, keyCase, open, savedClip, typeIn } from "./_inspector.mjs";
import { undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, app, udDir, shot, outDir, fs } = ctx;
  const { check, report } = checks();
  const saved = () => savedProject(win, udDir);
  const layersIn = async () => (await saved()).timeline.clips.filter((c) => c.type === "filter" && c.adjustment);
  const column = () => win.evaluate(() => [...document.querySelectorAll("nav[aria-label=Sections] button")].map((e) => e.innerText.trim()));
  const section = (id) => win.locator(`[data-testid='assets-section-${id}']`);
  const frame = async () => (await engineFrame(win)).sum;
  const addVia = async (tile) => {
    await tile.hover();
    await settled(win, () => tile.locator("[data-testid=adjustment-add]").click());
  };
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 2);
  const f0 = await frame();
  await grab(win, "v0");
  const l0 = engineFrame(win).then((f) => f.light);
  const n0 = (await layersIn()).length;

  // The tab and its column.
  await win.locator("[data-testid=assets-tab-adjustment]").click();
  await win.waitForTimeout(800);
  const col = await column();
  check("the column: Add adjustment, Yours, LUT", col.join() === "Add adjustment,Yours,LUT", col.join(","));
  const custom = win.locator("[data-testid=adjustment-custom]");
  const box = await custom.boundingBox();
  check("the Custom adjustment tile is an 86 px square carrying its name", Math.abs(box.width - 86) < 1 && Math.abs(box.height - 86) < 1 && (await custom.innerText()).trim() === "Custom adjustment", `${box.width}x${box.height}`);
  await shot("a1-add-adjustment");
  await custom.hover();
  await win.waitForTimeout(300);
  check("hovering it shows a round +", (await custom.locator("[data-testid=adjustment-add]").count()) === 1);
  await shot("a2-custom-hover");
  await section("yours").click();
  await win.waitForTimeout(300);
  check("Yours starts empty with a note", (await win.locator("[data-testid=adjustment-preset]").count()) === 0 && (await win.locator("[data-testid=adjustment-yours-empty]").count()) === 1);
  await section("lut").click();
  await win.waitForTimeout(300);
  await shot("a4-lut");
  await section("add").click();
  await win.waitForTimeout(300);

  // + adds a layer at the playhead.
  await undoCase(ctx, check, "add adjustment layer", () => addVia(custom), { frame: false });
  let layers = await layersIn();
  const a = layers[0];
  check("+ puts an adjustment layer at the playhead on a track of its own", layers.length === n0 + 1 && Math.abs(+a.startTick / 1e6 - 2) < 0.05 && (await saved()).timeline.tracks.some((t) => t.timelineId === a.timelineId && t.type === "filter"), `${a?.name} at ${+a?.startTick / 1e6}s`);
  check("it is named Adjust1, and selected with the Adjust tab open", a.name === "Adjust1" && (await win.locator("[data-testid=inspector] [role=tab]").allInnerTexts()).map((s) => s.trim())[0] === "Adjust");
  const subs = (await win.locator("[data-testid=inspector] [role=tab]").allInnerTexts()).map((s) => s.trim()).join();
  check("its sub-tabs are Basic, HSL, Curves, Color wheel, Mask", subs === "Adjust,Basic,HSL,Curves,Color wheel,Mask", subs);
  check("Save as preset waits for a setting", await win.locator("[data-testid=adjustment-save-preset]").isDisabled());
  check("with nothing set the frame is unchanged", (await frame()) === f0);
  await shot("i1-basic-top");

  // Exposure and Saturation under it: the frame inside changes, before and after it not.
  await undoCase(ctx, check, "Exposure -50", () => typeIn(win, "Exposure", -50));
  await undoCase(ctx, check, "Saturation -30", () => typeIn(win, "Saturation", -30));
  const adj = (await savedClip(ctx, a.clipId)).color?.adjust;
  check("the settings are saved on the layer on CapCut's scale", adj?.exposure === -50 && adj?.saturation === -30, JSON.stringify(adj));
  const darker = (await engineFrame(win)).light;
  check("the engine grades the picture under it", darker < (await l0) - 0.02, `lightness ${(await l0).toFixed(3)} → ${darker.toFixed(3)}`);
  await seek(win, ctx.map, 2.5);
  const during = (await engineFrame(win)).light;
  await seek(win, ctx.map, 1.5);
  const justBefore = (await engineFrame(win)).light;
  check("and not before it starts", Math.abs(justBefore - (await l0)) < 0.03 && during < justBefore - 0.02, `lightness 1.5 s ${justBefore.toFixed(3)}, 2.5 s ${during.toFixed(3)}`);
  const layerEnd = +a.endTick / 1e6;
  await seek(win, ctx.map, Math.min(layerEnd + 0.5, 10));
  const afterL = (await engineFrame(win)).light;
  check("nor after it ends", afterL > during + 0.02 || layerEnd + 0.5 > 10, `lightness ${afterL.toFixed(3)} (layer ends ${layerEnd.toFixed(1)} s)`);

  // A text added above it keeps its own colour: white pixels where the text is, whatever the grade.
  await seek(win, ctx.map, 2.5);
  await grab(win, "noText");
  await (await import("./newtext.mjs")).default(ctx);
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 2.5);
  await win.keyboard.press("Escape");
  await grab(win, "withText");
  const textFrame = await win.evaluate(() => {
    const [a, b] = [window.__grabs.noText.data, window.__grabs.withText.data];
    let changed = 0, white = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 90) {
        changed++;
        if (b[i] >= 235 && b[i + 1] >= 235 && b[i + 2] >= 235) white++;
      }
    }
    return { changed, white };
  });
  check("a text added above the layer is not graded (its pixels stay white)", textFrame.changed > 150 && textFrame.white / textFrame.changed > 0.6, JSON.stringify(textFrame));
  await shot("t1-text-above");

  // The other panels: HSL, Curves, Color wheel (reused from the video's Adjust tab).
  await at(ctx, a.clipId, 2.5);
  await open(win, "Adjust", "HSL");
  await win.waitForTimeout(300);
  check("HSL lists its eight ranges", (await win.locator("[data-testid^=hsl-]").count()) >= 8);
  await shot("i2-hsl");
  await open(win, "Adjust", "Curves");
  await win.waitForTimeout(300);
  check("Curves has its graph", (await win.locator("[data-testid=curve-luma]").count()) === 1);
  await shot("i3-curves");
  await open(win, "Adjust", "Color wheel");
  await win.waitForTimeout(300);
  await shot("i4-color-wheel");
  await open(win, "Adjust", "Basic");

  // Save as preset: it is in Yours.
  await settled(win, () => win.locator("[data-testid=adjustment-save-preset]").click(), { timeout: 1500 }).catch(() => {});
  check("Save as preset says it saved", (await win.locator("[data-testid=adjustment-preset-saved]").count()) === 1);
  await win.locator("[data-testid=assets-tab-adjustment]").click();
  await section("yours").click();
  await win.waitForTimeout(500);
  const presets = await win.locator("[data-testid=adjustment-preset]").count();
  check("the preset is listed under Yours", presets === 1, `${presets}`);
  await shot("a3-yours");
  const preset = win.locator("[data-testid=adjustment-preset]").first();
  await seek(win, ctx.map, 4);
  await undoCase(ctx, check, "add a preset's layer", async () => {
    await preset.hover();
    await settled(win, () => preset.locator("[data-testid=adjustment-add]").click());
  });
  layers = await layersIn();
  const fromPreset = layers.find((c) => c.clipId !== a.clipId);
  check("+ on a preset adds a layer with its settings at the playhead", layers.length === n0 + 2 && fromPreset?.color?.adjust?.exposure === -50 && Math.abs(+fromPreset.startTick / 1e6 - 4) < 0.05, JSON.stringify(fromPreset?.color));

  // A mask on that layer: a rectangle limits the grade to it.
  await open(win, "Adjust", "Mask");
  await win.waitForTimeout(300);
  const before = await frame();
  await shot("i5-mask-before");
  const addMask = win.locator("[data-testid=inspector] button", { hasText: /^Add mask$/ }).first();
  await undoCase(ctx, check, "add a mask", async () => {
    await settled(win, () => addMask.click());
  });
  const masked = await savedClip(ctx, fromPreset.clipId);
  check("a rectangle mask is on the layer and changes the frame", masked.masks?.length === 1 && (await frame()) !== before, `${masked.masks?.length} mask(s)`);
  await shot("i5-mask-rectangle");

  // A keyframed slider on a layer of its own (the LUT's, below).
  // A LUT: an inverting .cube imported under LUT, previewed with a click, added as a layer.
  const cube = path.join(outDir, "adjust-invert.cube");
  let text = "LUT_3D_SIZE 2\n";
  for (const b of [0, 1]) for (const g of [0, 1]) for (const r of [0, 1]) text += `${1 - r} ${1 - g} ${1 - b}\n`;
  fs.writeFileSync(cube, text);
  await app.evaluate(({ ipcMain }, p) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [p]);
  }, cube);
  await seek(win, ctx.map, 8);
  await win.locator("[data-testid=assets-tab-adjustment]").click();
  await section("lut").click();
  await win.waitForTimeout(300);
  await win.locator("[data-testid=adjustment-lut-import]").click();
  await win.waitForTimeout(600);
  const lutTile = win.locator("[data-testid=adjustment-lut]").first();
  check("an imported LUT is listed under LUT", (await lutTile.getAttribute("title")) === "adjust-invert", await lutTile.getAttribute("title").catch(() => "none"));
  await shot("a4-lut-listed");
  const nBefore = (await layersIn()).length;
  const f2 = await frame();
  await settled(win, () => lutTile.click());
  check("a click on it previews the LUT in the player", (await frame()) !== f2 && (await lutTile.getAttribute("aria-pressed")) === "true");
  check("and adds nothing to the saved project", (await layersIn()).length === nBefore);
  await settled(win, () => lutTile.click());
  check("a second click puts the player back", (await frame()) === f2);
  await seek(win, ctx.map, 3);
  await undoCase(ctx, check, "add a LUT layer", () => addVia(lutTile));
  layers = await layersIn();
  const lutLayer = layers.find((c) => c.color?.lut);
  check("+ on a LUT adds a layer with that LUT at the playhead", layers.length === nBefore + 1 && lutLayer?.color.lut.path === cube && Math.abs(+lutLayer.startTick / 1e6 - 3) < 0.05, JSON.stringify(lutLayer?.color));

  // A keyframe on the LUT layer's Exposure: a key at one time, another value at the next.
  const basic = () => open(win, "Adjust", "Basic");
  await keyCase(ctx, check, "adjustment layer exposure", { id: lutLayer.clipId, row: "Exposure", t1: 4, t2: 6, reopen: basic, undoCase, set1: () => typeIn(win, "Exposure", -40), set2: () => typeIn(win, "Exposure", 40) });
  const keyed = await savedClip(ctx, lutLayer.clipId);
  check("the keys are saved on the layer", (keyed.keyframes?.["adjust:exposure"]?.length ?? 0) === 2, JSON.stringify(keyed.keyframes));

  // Reopen: the layers are still there and drawn.
  await seek(win, ctx.map, 2.5);
  const wanted = (await layersIn()).length;
  const name = await win.locator("[data-testid=project-name]").inputValue();
  await (await import("./reopen.mjs")).default({ win, shot });
  const again = await saved();
  const reLayers = again.timeline.clips.filter((c) => c.type === "filter" && c.adjustment);
  check("reopened, the layers, their keys, mask and LUT are there", reLayers.length === wanted && reLayers.some((c) => c.masks?.length === 1) && reLayers.some((c) => c.color?.lut?.path === cube) && reLayers.some((c) => c.keyframes?.["adjust:exposure"]?.length === 2), `${reLayers.length} layers (${name})`);
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 2.5);
  await win.keyboard.press("Escape");
  const reLight = (await engineFrame(win)).light;
  check("and the engine draws them", reLight < (await l0) - 0.02, `lightness ${reLight.toFixed(3)}`);

  // Export: the file's frames are graded across the first layer's start.
  await exportCheck(ctx, check, shot, outDir, fs, +a.startTick / 1e6);
  return report();
};

async function exportCheck(ctx, check, shot, outDir, fs, start) {
  const { app, win } = ctx;
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const file = path.join(outDir, "adjust-export.mp4");
  fs.rmSync(file, { force: true });
  await win.locator("[data-testid=export]").click();
  await win.waitForTimeout(1000);
  const dialog = win.getByRole("dialog");
  await dialog.locator('input[placeholder="My export"]').fill("adjust-export");
  await dialog.locator('input[placeholder="/path/to/export"]').fill(outDir);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  for (let i = 0; i < 240 && !(await win.getByText("Export completed").count()); i++) await win.waitForTimeout(500);
  await shot("x1-exported");
  if (!fs.existsSync(file)) throw new Error("no export file");
  check("exported", true, `${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
  const ffmpeg = createRequire(path.resolve("../../package.json"))("ffmpeg-static");
  const mean = (s) => {
    const raw = execFileSync(ffmpeg, ["-v", "error", "-ss", String(s), "-i", file, "-frames:v", "1", "-vf", "scale=96:54", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
    return [...raw].reduce((x, v) => x + v, 0) / raw.length;
  };
  const [a, b, c] = [mean(start - 0.5), mean(start - 0.1), mean(start + 0.1)];
  check("the exported frames are darker once the layer starts", b - c > 8 && Math.abs(a - b) < b - c, `lightness ${a.toFixed(1)} → ${b.toFixed(1)} → ${c.toFixed(1)} across ${start} s`);
}
