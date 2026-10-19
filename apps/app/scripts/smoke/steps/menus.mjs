// The menu bar's File and Edit items (after `import timeline`), as CapCut's
// (docs/plan/capcut-ui-spec.md §6.1): File ▸ New project, Import and Export, Edit ▸ Split,
// Help ▸ Walkthrough exist with their keys shown; each runs the same action as its key:
//   Split     cuts the main track's clip at the playhead (⌘Z puts it back)
//   Import    opens the Media tab's picker (the picker stubbed and counted)
//   Export    opens the Export dialog
//   New project  makes a second project and opens it (last: the session ends in it)
import { now, rulerMap, seek } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { clickMenu, menuItem } from "./_settings.mjs";
import { doc, mainClips } from "./_timeline.mjs";
import fs from "node:fs";
import path from "node:path";

export default async (ctx) => {
  const { app, win, shot, udDir } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);

  const file = await Promise.all(["New project", "Import", "Export"].map((l) => menuItem(app, l)));
  check(
    "File has New project, Import and Export with their keys, on the mac the items off the editor's keys",
    file.every((i) => i) && file[0].accelerator === "CmdOrCtrl+N" && file[1].accelerator === "CmdOrCtrl+I" && file[2].accelerator === "CmdOrCtrl+E",
    JSON.stringify(file),
  );
  const split = await menuItem(app, "Split");
  check("Edit has Split (⌘B), on in the editor", !!split && split.accelerator === "CmdOrCtrl+B" && split.enabled, JSON.stringify(split));
  const walk = await menuItem(app, "Walkthrough");
  check("Help has Walkthrough, on in the editor", !!walk && walk.enabled, JSON.stringify(walk));

  // Split from the menu.
  const before = mainClips(await doc(ctx)).length;
  await seek(win, ctx.map, 2);
  await clickMenu(app, "Split");
  await win.waitForTimeout(800);
  const after = mainClips(await doc(ctx)).length;
  check("Edit ▸ Split cuts the main track's clip at the playhead", after === before + 1, `${before} -> ${after} clips`);
  await shot("m1-after-split");
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(800);
  check("⌘Z puts the split back", mainClips(await doc(ctx)).length === before);

  // Import from the menu: the media picker opens (stubbed, counted).
  await app.evaluate(({ ipcMain }) => {
    globalThis.__picks = 0;
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => {
      globalThis.__picks++;
      return [];
    });
  });
  await clickMenu(app, "Import");
  await win.waitForTimeout(1500);
  const picks = await app.evaluate(() => globalThis.__picks);
  check("File ▸ Import opens the media picker", picks === 1, `${picks} picks`);

  // Export from the menu.
  await clickMenu(app, "Export");
  const dialog = win.locator("[data-testid=export-dialog]");
  await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check("File ▸ Export opens the Export dialog", await dialog.isVisible());
  await shot("m2-export-from-menu");
  await dialog.locator("[data-testid=export-cancel]").click().catch(() => {});
  await dialog.waitFor({ state: "hidden" }).catch(() => {});

  // New project, last.
  const projects = () => fs.readdirSync(path.join(udDir, "projects-json")).filter((f) => /^project-\d+\.json$/.test(f)).length;
  const n0 = projects();
  await clickMenu(app, "New project");
  await win.waitForTimeout(4000);
  check("File ▸ New project makes a project", projects() === n0 + 1, `${n0} -> ${projects()} files`);
  await shot("m3-new-project");
  void now;
  return report();
};
