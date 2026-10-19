// Missing media and Link to media (after `import timeline` of a copy of the 3 s red clip made for
// this step, `CLIP_NAME=relink-red.mp4`; the file picker and the folder picker are stubbed):
// - the file is moved away and the app restarted: its card says "Media missing" (and the list says
//   so above the cards), the engine can't draw the clip, the saved project is as it was;
// - the card's menu, Link to media, with the file picked at its new place: the card is whole, the
//   engine draws red again, the project's asset path is the same (the library's link follows the
//   file), the link points at the new place; ⌘Z puts the old link back (missing again) in one
//   step, ⇧⌘Z links it again;
// - the file moved again, deep in a folder: "Link to a folder" finds it by its name;
// - Open file location on a missing card shows where it was.
import fs from "node:fs";
import path from "node:path";
import { engineFrame, openEditor } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { press } from "./_undo.mjs";
import { folderReturns, mediaDir, pickReturns } from "./_recfixture.mjs";

const RED = "r>170&&g<90&&b<90";
const card = (win) => win.locator("[data-testid=media-card]").first();
/** Right-click the first card (its menu opens). */
const rightClick = async (win) => {
  const b = await card(win).boundingBox();
  await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" });
};
const missing = async (win) => (await card(win).getAttribute("data-missing")) === "true";

/** Wait (up to `s` seconds) for the card to be missing (`want`) or whole. */
const until = async (win, want, s = 12) => {
  for (let i = 0; i < s * 5; i++) {
    if ((await missing(win)) === want) return true;
    await win.waitForTimeout(200);
  }
  return false;
};

export default async (ctx) => {
  const { shot, outDir } = ctx;
  let app = ctx.app;
  let { win } = ctx;
  const { check, report } = checks();
  const original = ctx.clipPath;
  const name = path.basename(original);
  const home = path.join(outDir, "moved");
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const link = path.join(mediaDir(ctx), "symlinks", name);

  check("the clip shows red", (await engineFrame(win, RED)).count > 20000);
  check("the card is whole", !(await missing(win)));
  const doc0 = await savedProject(win, ctx.udDir);
  const assetPath = Object.values(doc0.assets)[0].path;

  // ---- the file goes away, the app starts again ----
  const away = path.join(home, name);
  fs.renameSync(original, away);
  ({ app, win } = await ctx.relaunch());
  await openEditor(win);
  await win.waitForTimeout(5000);
  check("the card says Media missing", (await until(win, true)) && (await card(win).locator("[data-testid=media-missing]").count()) === 1 && /Media missing/.test(await card(win).innerText()));
  const bar = await win.locator("[data-testid=media-missing-bar]").innerText().catch(() => "");
  check(`and the list says so ("${bar.replace(/\s+/g, " ")}")`, /1 media file is missing/.test(bar));
  check("the engine can't draw the clip", (await engineFrame(win, RED)).count < 2000);
  check("the project still names the same file", Object.values((await savedProject(win, ctx.udDir)).assets)[0].path === assetPath);
  await shot("rl-1-missing");

  // ---- Link to media ----
  await pickReturns(app, [away]);
  await rightClick(win);
  await win.waitForTimeout(500);
  check("the card menu has Link to media, on", (await win.locator("[data-testid=media-link]").count()) === 1 && !(await win.locator("[data-testid=media-link]").isDisabled()));
  await shot("rl-2-menu");
  await win.locator("[data-testid=media-link]").click();
  check("the card is whole again", await until(win, false));
  await win.waitForTimeout(2500);
  check("the missing list is gone", (await win.locator("[data-testid=media-missing-bar]").count()) === 0);
  check("the engine draws red again", (await engineFrame(win, RED)).count > 20000);
  check(`the project's asset path is the same and its link points at ${fs.readlinkSync(link)}`, Object.values((await savedProject(win, ctx.udDir)).assets)[0].path === assetPath && fs.readlinkSync(link) === away);
  await shot("rl-3-linked");
  await press(win, "Meta+z");
  check("⌘Z makes it missing again, the old link back", (await until(win, true)) && fs.readlinkSync(link) === original);
  await press(win, "Meta+Shift+z");
  check("⇧⌘Z links it again", (await until(win, false)) && fs.readlinkSync(link) === away);
  await win.waitForTimeout(2000);
  check("the engine draws red", (await engineFrame(win, RED)).count > 20000);

  // ---- Link to a folder ----
  const deep = path.join(outDir, "moved-again", "a", "b");
  fs.mkdirSync(deep, { recursive: true });
  fs.renameSync(away, path.join(deep, name));
  await win.evaluate(() => window.dispatchEvent(new Event("focus")));
  check("the card is missing again after the file moves (the window's focus checks)", await until(win, true));
  await app.evaluate(({ ipcMain }) => {
    globalThis.__revealed = [];
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => {
      globalThis.__revealed.push(p);
      return { success: true, data: { path: p } };
    });
  });
  await rightClick(win);
  await win.getByText("Open File Location").click();
  await win.waitForTimeout(800);
  const shown = await app.evaluate(() => globalThis.__revealed);
  check(`Open file location on a missing card shows where it was (${shown.join(", ")})`, shown.length === 1 && shown[0].endsWith(name));
  await folderReturns(app, path.join(outDir, "moved-again"));
  await win.locator("[data-testid=media-link-folder]").click();
  check("Link to a folder finds the file by its name", await until(win, false));
  await win.waitForTimeout(2500);
  check(`the link points into the folder (${fs.readlinkSync(link)})`, fs.readlinkSync(link) === path.join(deep, name));
  check("the engine draws red", (await engineFrame(win, RED)).count > 20000);
  await shot("rl-4-folder");
  return report();
};
