// The clip menu's Edit and Range submenus and the range itself (after import timeline newtext;
// `CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1`). ⌘B at 3 s and 7 s cuts the main track into A, B, C.
//   menu      B's menu: Edit › Freeze, Reverse, Mirror, Rotate, Crop; Export selected clips;
//             Range › Select by clip (⇧X), Deselect (greyed with no range); Render (its items are
//             checked in the render step)
//   edit      Edit › Mirror flips B (saved `flip`, the engine's frame changes), Rotate turns it
//             90°, each undone and redone; Crop opens the crop dialog on it
//   range     Range › Select by clip: the ruler shows a band over B's span, Deselect clears it;
//             ⇧X does the first and ⌥⇧X the second; I and O at 2 s and 5 s set the ends
//   export    Range › Export range writes 3 s (2 to 5 s) with ffprobe, the dialog saying "Range";
//             A and B selected: Export selected clips writes their 7 s together, the dialog
//             saying "Selected clips"; B alone writes its own 4 s, from 0
import { execFileSync } from "node:child_process";
import path from "node:path";
import { engineFrame, rulerMap, seek, timelineRect } from "./_preview.mjs";
import { bar, checks, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { doc, key, mainClips } from "./_timeline.mjs";

const FFPROBE = process.env.FFPROBE || "/opt/homebrew/bin/ffprobe";
const duration = (file) => +JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_format", "-of", "json", file]).toString()).format.duration;

export default async (ctx) => {
  const { app, win, shot, outDir, fs } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });

  await seek(win, map, 3);
  await key(win, "Meta+b");
  await seek(win, map, 7);
  await key(win, "Meta+b");
  let d = await doc(ctx);
  for (let i = 0; i < 40 && mainClips(d).length < 3; i++) {
    await win.waitForTimeout(250);
    d = await doc(ctx);
  }
  const [A, B, C] = mainClips(d);
  check("the main track is cut into three", !!C, `${mainClips(d).length}`);
  const fps = d.settings.fps;
  const secs = (c) => [c.s / fps, c.e / fps];

  // The ruler's colour at a time, for the range's band (its lavender over the grey).
  const rulerAt = async (s) => {
    const tl = await timelineRect(win);
    const buf = await win.screenshot({ clip: { x: map.x(s), y: tl.y + 8, width: 2, height: 2 } });
    return win.evaluate(async (b64) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const p = g.getImageData(1, 1, 1, 1).data;
      return [p[0], p[1], p[2]];
    }, buf.toString("base64"));
  };
  const lit = ([r, g, b]) => b - g > 14;
  const bandAt = async (s) => lit(await rulerAt(s));

  // The saved project, once it holds the clip (the autosave can be a few seconds behind).
  const saved = async (clip) => {
    for (let i = 0; i < 40; i++) {
      const s = await doc(ctx);
      if (s.timeline.clips.some((c) => c.clipId === clip.clipId)) return s;
      await win.waitForTimeout(250);
    }
    return doc(ctx);
  };
  const openMenu = async (clip) => {
    // Off the playhead's line: a quarter of the way in from the clip's end.
    const sv = await saved(clip);
    const c = sv.timeline.clips.find((x) => x.clipId === clip.clipId);
    const [bx, by] = await bar(ctx, sv, clip.clipId, (+c.startTick + 3 * +c.endTick) / 4e6);
    await win.mouse.click(bx, by, { button: "right" });
    await win.waitForTimeout(450);
  };
  const row = (name) => win.locator("button", { hasText: new RegExp(`^${name}`) }).filter({ hasText: name }).first();
  const rows = () => win.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()));
  const hover = async (name) => {
    await row(name).hover();
    await win.waitForTimeout(350);
  };

  // ---- the menu --------------------------------------------------------------------------------
  await seek(win, map, 5);
  await select(ctx, await saved(B), B.clipId, 5.5);
  await openMenu(B);
  let all = await rows();
  check("B's menu has Export selected clips, Range, Render and Edit", ["Export selected clips", "Range", "Render", "Edit"].every((n) => all.includes(n)) && !all.some((t) => /^Export as/.test(t)), JSON.stringify(all.filter((t) => t.length < 40).slice(0, 40)));
  await hover("Edit");
  all = await rows();
  check("Edit has Freeze, Reverse, Mirror, Rotate, Crop", ["Freeze", "Reverse", "Mirror", "Rotate", "Crop"].every((n) => all.includes(n)), JSON.stringify(all.filter((t) => ["Freeze", "Reverse", "Mirror", "Rotate", "Crop"].includes(t))));
  await shot("menu-1-edit");
  await hover("Range");
  all = await rows();
  const deselect = win.locator("button", { hasText: /^Deselect$/ });
  check("Range has Select by clip (⇧X) and Deselect, greyed with no range", all.some((t) => /^Select by clip/.test(t)) && (await deselect.isDisabled()), JSON.stringify(all.filter((t) => /Select|Deselect/.test(t))));
  await shot("menu-2-range");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // ---- Edit: Mirror, Rotate, Crop ------------------------------------------------------------------
  const before = (await engineFrame(win)).sum;
  await undoCase(ctx, check, "Edit › Mirror", async () => {
    await openMenu(B);
    await hover("Edit");
    await row("Mirror").click();
    await win.waitForTimeout(500);
  });
  d = await doc(ctx);
  const flipped = d.timeline.clips.find((c) => c.clipId === B.clipId);
  check("Mirror flips B left to right (saved) and the engine's frame changes", flipped.flip?.horizontal === true && (await engineFrame(win)).sum !== before, JSON.stringify(flipped.flip));
  await key(win, "Meta+z");
  await undoCase(ctx, check, "Edit › Rotate", async () => {
    await openMenu(B);
    await hover("Edit");
    await row("Rotate").click();
    await win.waitForTimeout(500);
  });
  d = await doc(ctx);
  const turned = d.timeline.clips.find((c) => c.clipId === B.clipId);
  check("Rotate turns B a quarter", Math.abs(((turned.transform?.rotation ?? 0) + 360) % 360 - 90) < 0.5, `${turned.transform?.rotation}`);
  await key(win, "Meta+z");
  await openMenu(B);
  await hover("Edit");
  await row("Crop").click();
  await win.waitForTimeout(800);
  const cropOpen = (await win.getByText("Confirm", { exact: true }).count()) > 0 && (await win.getByText("Rotation", { exact: true }).count()) > 0;
  check("Edit › Crop opens the crop dialog", cropOpen);
  await shot("menu-3-crop");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(500);

  // ---- Range ---------------------------------------------------------------------------------------
  await select(ctx, await saved(B), B.clipId, 5.5);
  const [b0, b1] = secs(B);
  check("no range at first: the ruler is plain over B", !(await bandAt((b0 + b1) / 2)));
  await openMenu(B);
  await hover("Range");
  await win.getByText("Select by clip", { exact: false }).click();
  await win.waitForTimeout(500);
  check("Range › Select by clip lights the ruler over B and not outside", (await bandAt((b0 + b1) / 2)) && !(await bandAt(b0 / 2)) && !(await bandAt((b1 + secs(C)[1]) / 2)));
  await shot("range-1-by-clip");
  await openMenu(B);
  await hover("Range");
  check("with a range, Deselect is available", !(await deselect.isDisabled()) && (await win.getByText("Export range", { exact: true }).count()) === 1);
  await deselect.click();
  await win.waitForTimeout(400);
  check("Deselect clears the band", !(await bandAt((b0 + b1) / 2)));
  await select(ctx, await saved(B), B.clipId, 5.5);
  await key(win, "Shift+x");
  check("⇧X selects by clip", await bandAt((b0 + b1) / 2));
  await key(win, "Alt+Shift+x");
  check("⌥⇧X deselects", !(await bandAt((b0 + b1) / 2)));
  await seek(win, map, 2);
  await key(win, "i");
  await seek(win, map, 5);
  await key(win, "o");
  check("I at 2 s and O at 5 s make a range of 2 to 5 s", (await bandAt(3.5)) && !(await bandAt(1)) && !(await bandAt(6)));
  await shot("range-2-in-out");

  // ---- Export range, Export selected clips ---------------------------------------------------------------
  const dialog = win.locator("[data-testid=export-dialog]");
  const T = (id) => dialog.locator(`[data-testid=${id}]`);
  const run = async (name, label) => {
    await dialog.waitFor({ state: "visible" });
    await win.waitForTimeout(500);
    check(`the dialog says ${label}`, new RegExp(label).test(await T("export-settings").innerText()), await T("export-settings").innerText());
    const box = T("export-gif-check");
    if (((await box.getAttribute("data-checked")) === "true")) await box.click();
    await T("export-resolution").click();
    await win.locator("[data-testid=export-resolution-option]").filter({ hasText: "480P" }).first().click();
    await T("export-name").fill(name);
    await T("export-path").fill(outDir);
    await T("export-submit").click();
    let phase = "";
    for (let i = 0; i < 240 && (!phase || phase === "running"); i++) {
      phase = (await T("export-run").getAttribute("data-phase").catch(() => null)) ?? "";
      await win.waitForTimeout(500);
    }
    await T("export-run-done").click();
    await dialog.waitFor({ state: "hidden" });
    return phase;
  };
  fs.rmSync(path.join(outDir, "range.mp4"), { force: true });
  fs.rmSync(path.join(outDir, "picked.mp4"), { force: true });
  await openMenu(B);
  await hover("Range");
  await win.getByText("Export range", { exact: true }).click();
  const p1 = await run("range", "Range");
  const f1 = path.join(outDir, "range.mp4");
  check(`Export range writes the 3 s between In and Out (${fs.existsSync(f1) ? duration(f1).toFixed(2) : "none"} s)`, p1 === "done" && fs.existsSync(f1) && Math.abs(duration(f1) - 3) < 0.25);

  // A and B selected (shift-click): Export selected clips writes their 7 s.
  d = await saved(A);
  await select(ctx, d, A.clipId, 1);
  await win.keyboard.down("Shift");
  await win.mouse.click(...(await bar(ctx, d, B.clipId, 5.5)));
  await win.keyboard.up("Shift");
  await win.waitForTimeout(300);
  const [bx, by] = await bar(ctx, d, B.clipId, 5.5);
  await win.mouse.click(bx, by, { button: "right" });
  await win.waitForTimeout(450);
  await win.getByText("Export selected clips", { exact: true }).click();
  const p2 = await run("picked", "Selected clips");
  const f2 = path.join(outDir, "picked.mp4");
  const want = (B.e - A.s) / fps;
  check(`Export selected clips writes A and B together (${fs.existsSync(f2) ? duration(f2).toFixed(2) : "none"} s of ${want.toFixed(2)} s)`, p2 === "done" && fs.existsSync(f2) && Math.abs(duration(f2) - want) < 0.4);

  // One clip from the middle of the track starts its file at 0: B alone is 4 s, not 7.
  fs.rmSync(path.join(outDir, "alone.mp4"), { force: true });
  d = await saved(B);
  await select(ctx, d, B.clipId, 6);
  const [cx, cy] = await bar(ctx, d, B.clipId, 6);
  await win.mouse.click(cx, cy, { button: "right" });
  await win.waitForTimeout(450);
  await win.getByText("Export selected clips", { exact: true }).click();
  const p3 = await run("alone", "Selected clip");
  const f3 = path.join(outDir, "alone.mp4");
  check(`Export selected clips of B alone writes its own 4 s (${fs.existsSync(f3) ? duration(f3).toFixed(2) : "none"} s)`, p3 === "done" && fs.existsSync(f3) && Math.abs(duration(f3) - (B.e - B.s) / fps) < 0.3);
  return report();
};
