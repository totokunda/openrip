// Smooth slow-mo and Optical flow through their controls (after import timeline; IMG_9079 with
// CLIP_NAME=IMG_9079, 4K ProRes at 24 fps):
// - Speed › Standard: Smooth slow-mo greyed with CapCut's note at 1×; at 0.25× it can be ticked
//   (saved as optical flow), its mode under the arrow (Frame blending, saved), ⌘Z / ⇧⌘Z;
// - the engine's frames: stepping frame by frame at 0.25×, held frames repeat (three in four)
//   without it; with it every frame differs from the one before, by the motion between source
//   frames (the made frame lies between its neighbours);
// - playback: frames drawn per second while playing with it on;
// - Video › Basic › Optical flow: ticked and saved, Apply to all;
// - an export through the engine with Smooth slow-mo: its frames read with ffmpeg, no frame a
//   repeat of the one before.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { engineFrame, grab, diff, now, playButton, rulerMap, seek, settled, tab } from "./_preview.mjs";
import { checks, clipsWhere, savedProject, select } from "./_anim.mjs";
import { press, undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { app, win, shot, udDir, outDir, fs } = ctx;
  ctx.map ??= await rulerMap(win);
  const { check, report } = checks();
  let doc = await savedProject(win, udDir);
  const video = clipsWhere(doc, (c) => c.type === "video")[0];
  const fps = doc.settings?.fps || 24;
  const saved = async () => (await savedProject(win, udDir)).timeline.clips.find((c) => c.clipId === video.clipId);
  const open = async (name, sub) => {
    // By its bar a little after the playhead (the clip may run off the timeline's view).
    const head = await now(win);
    await select(ctx, await savedProject(win, udDir), video.clipId, head < 4 ? head + 2 : 1);
    await tab(win, name);
    if (sub) await win.locator("[data-testid=inspector] [role=tab]", { hasText: new RegExp(`^${sub}$`) }).click();
    await win.waitForTimeout(400);
  };
  const type = async (testId, value) => {
    const input = win.locator(`[data-testid=${testId}]`);
    await input.click();
    await win.keyboard.press("Meta+A");
    await win.keyboard.type(String(value));
    await settled(win, () => win.keyboard.press("Enter"));
  };

  // At 1× it's greyed, with CapCut's note.
  await open("Speed", "Standard");
  const row = win.locator("[data-testid=smooth-slowmo]");
  check("Smooth slow-mo greyed at 1×, with the note", (await row.getAttribute("data-enabled")) === "false" && (await row.innerText()).includes("Only slow-speed videos are supported."), await row.innerText());
  await shot("sm1-speed-1x");
  await type("speed-value", 0.25);
  let c = await saved();
  check("0.25× saved", c.speed === 0.25, c.speed);
  // The timeline may have zoomed with the clip's length.
  ctx.map = await rulerMap(win);
  await open("Speed", "Standard");
  check("at 0.25× it can be ticked", (await row.getAttribute("data-enabled")) === "true" && !(await win.locator("[data-testid=smooth-slowmo-toggle]").isDisabled()));

  // Frame by frame without it: held frames.
  const step = async (n) => {
    const sums = [];
    for (let i = 0; i < n; i++) {
      await settled(win, () => win.keyboard.press("ArrowRight"), { timeout: 3000 });
      sums.push((await engineFrame(win)).sum);
    }
    return sums;
  };
  const repeats = (sums) => sums.slice(1).filter((s, i) => s === sums[i]).length;
  const from = 2;
  await seek(win, ctx.map, from);
  await win.evaluate(() => document.activeElement?.blur?.());
  const held = await step(12);
  check("without it, held frames repeat", repeats(held) >= 8, `${repeats(held)} of 11`);

  // Ticked: optical flow, one undo step.
  await open("Speed", "Standard");
  await seek(win, ctx.map, from + 0.1);
  await open("Speed", "Standard");
  await undoCase(ctx, check, "Smooth slow-mo", () => settled(win, () => win.locator("[data-testid=smooth-slowmo-toggle]").click()));
  c = await saved();
  check("ticked: saved as optical flow", c.smoothSlowMo?.mode === "optical_flow", JSON.stringify(c.smoothSlowMo));
  await shot("sm2-smooth-slowmo");
  await seek(win, ctx.map, from);
  await win.evaluate(() => document.activeElement?.blur?.());
  const smooth = await step(12);
  check("with it, no frame repeats the one before", repeats(smooth) === 0, `${repeats(smooth)} of 11`);
  // A made frame lies between its neighbours: closer to each than they are to each other.
  await seek(win, ctx.map, from);
  await grab(win, "a");
  await settled(win, () => win.keyboard.press("ArrowRight"), { timeout: 3000 });
  await settled(win, () => win.keyboard.press("ArrowRight"), { timeout: 3000 });
  await grab(win, "m");
  await settled(win, () => win.keyboard.press("ArrowRight"), { timeout: 3000 });
  await settled(win, () => win.keyboard.press("ArrowRight"), { timeout: 3000 });
  await grab(win, "b");
  const [am, mb, ab] = [await diff(win, "a", "m", 4), await diff(win, "m", "b", 4), await diff(win, "a", "b", 4)];
  check("a made frame lies between its neighbours (pixels that differ)", am.n < ab.n && mb.n < ab.n && am.n > 0 && mb.n > 0, `${am.n} and ${mb.n} against ${ab.n}`);

  // Its mode under the arrow.
  await open("Speed", "Standard");
  await win.locator("[data-testid=smooth-slowmo] button[aria-label='Show options']").click();
  await win.locator("[data-testid=smooth-slowmo-mode]").click();
  await win.getByRole("option", { name: "Frame blending" }).click();
  await win.waitForTimeout(800);
  c = await saved();
  check("Frame blending saved", c.smoothSlowMo?.mode === "frame_blending", JSON.stringify(c.smoothSlowMo));
  await shot("sm3-mode");
  await press(win, "Meta+z");
  c = await saved();
  check("⌘Z: optical flow again", c.smoothSlowMo?.mode === "optical_flow", JSON.stringify(c.smoothSlowMo));

  // Playback with it on: frames drawn a second.
  await seek(win, ctx.map, 0.5);
  await win.evaluate(() => {
    window.__shown = [];
    document.getElementById("openrip-engine-frame").addEventListener("openrip-engine-frame", (e) => window.__shown.push([performance.now(), e.detail?.timeUs ?? -1]));
  });
  const b = await playButton(win).boundingBox();
  await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await win.waitForTimeout(5000);
  await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const shown = await win.evaluate(() => window.__shown);
  const span = shown.length > 1 ? (shown[shown.length - 1][0] - shown[0][0]) / 1000 : 1;
  const distinct = new Set(shown.map((s) => s[1])).size;
  const rate = (shown.length - 1) / span;
  check("playback with Smooth slow-mo", rate > 20, `${rate.toFixed(1)} frames/s drawn over ${span.toFixed(1)} s (${distinct} distinct times; the project is ${fps} fps)`);
  ctx.fs.writeFileSync(`${outDir}/slowmo-playback.txt`, `frames drawn ${shown.length}, ${rate.toFixed(2)}/s over ${span.toFixed(2)} s, ${distinct} distinct\n`);

  // Video › Basic › Optical flow.
  await open("Video", "Basic");
  const flowBox = win.locator("[data-testid=optical-flow]");
  await flowBox.scrollIntoViewIfNeeded();
  check("Video › Basic shows Optical flow, off", (await flowBox.count()) === 1 && (await win.locator("[data-testid=optical-flow-toggle]").getAttribute("data-state")) === "unchecked");
  await shot("sm4-optical-flow");
  await settled(win, () => win.locator("[data-testid=optical-flow-toggle]").click(), { timeout: 2000 });
  c = await saved();
  check("Optical flow saved at 60 fps", c.opticalFlow?.fps === 60, JSON.stringify(c.opticalFlow));
  await win.locator("[data-testid=optical-flow-apply-all]").click();
  await win.waitForTimeout(500);
  await press(win, "Meta+z");
  await win.waitForTimeout(500);
  c = await saved();
  check("⌘Z: off again", !c.opticalFlow, JSON.stringify(c.opticalFlow));

  // An export with Smooth slow-mo, 2 s from 2 s in at the project's rate.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const file = path.join(outDir, "slowmo-export.mp4");
  fs.rmSync(file, { force: true });
  await win.locator("[data-testid=export]").click();
  await win.waitForTimeout(1000);
  const dialog = win.getByRole("dialog");
  await dialog.locator('input[placeholder="My export"]').fill("slowmo-export");
  await dialog.locator('input[placeholder="/path/to/export"]').fill(outDir);
  const t0 = Date.now();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  for (let i = 0; i < 1200 && !(await win.getByText("Export completed").count()); i++) await win.waitForTimeout(500);
  const took = (Date.now() - t0) / 1000;
  check("exported", fs.existsSync(file), `${took.toFixed(1)} s`);
  if (fs.existsSync(file)) {
    const ffmpeg = createRequire(path.resolve("../../package.json"))("ffmpeg-static");
    // Frame hashes of 2 s from 2 s in, small.
    const out = execFileSync(ffmpeg, ["-v", "error", "-ss", "2", "-t", "2", "-i", file, "-an", "-vf", "scale=180:-2", "-f", "framemd5", "-"], { maxBuffer: 1 << 24 }).toString();
    const hashes = out.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop().trim());
    check("the export's frames: none a repeat of the one before", hashes.length > 20 && repeats(hashes) === 0, `${repeats(hashes)} of ${hashes.length - 1}`);
  }
  await shot("sm5-exported");
  return report();
};
