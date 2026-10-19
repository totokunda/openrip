// Project settings > Imported media: Copy media to project (after `import`; CLIP_NAME=IMG_9079
// OPENRIP_ENGINE_MUTE=1, built app; FFmpeg from ffmpeg-static makes a photo): imported as it is
// by default (the library holds a link to the file); Copy media to project chosen and saved turns
// the links already imported into real copies in the project's media folder (the card and its
// path stay, the original is untouched); a file imported afterwards is copied too; Stay in
// original location goes back to links for new imports; the choice is in the Details panel, in
// the user data folder's store, and still there after a restart.
// Shot: `cm1-dialog` ↔ `17-inspector-project/001-project-settings-details`.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { checks } from "./_anim.mjs";
import { openEditor } from "./_preview.mjs";

export default async (ctx) => {
  let { win } = ctx;
  const { shot, udDir, outDir, appDir, fs, clipPath } = ctx;
  const { check, report } = checks();
  const require = createRequire(appDir + "/package.json");
  const links = () => {
    const root = path.join(udDir, "media");
    const project = fs.readdirSync(root).find((d) => fs.existsSync(path.join(root, d, "symlinks")));
    return path.join(root, project, "symlinks");
  };
  const kind = (name) => {
    const st = fs.lstatSync(path.join(links(), name));
    return st.isSymbolicLink() ? "link" : st.isFile() ? "copy" : "?";
  };
  const photo = (name, color) => {
    const f = path.join(outDir, name);
    execFileSync(require("ffmpeg-static"), ["-y", "-f", "lavfi", "-i", `color=c=${color}:s=320x180`, "-frames:v", "1", f], { stdio: "ignore" });
    return f;
  };
  const importFile = async (file, name) => {
    await ctx.app.evaluate(({ ipcMain }, p) => {
      ipcMain.removeHandler("dialog:pick-media");
      ipcMain.handle("dialog:pick-media", async () => [p]);
    }, file);
    await win.locator("[data-testid=media-import]").first().click();
    for (let i = 0; i < 20 && !(await win.locator(`[data-testid=media-card][data-name="${name}"]`).count()); i++) await win.waitForTimeout(500);
  };
  const openDialog = async () => {
    await win.locator("[data-testid=project-modify]").click();
    await win.locator("[data-testid=ps-copy-media]").waitFor({ timeout: 5000 });
    await win.waitForTimeout(400);
  };
  const choose = async (id) => {
    await openDialog();
    await win.locator(`[data-testid=${id}]`).click();
    await shot("cm1-dialog");
    await win.locator("[data-testid=ps-save]").click();
    await win.waitForTimeout(1500);
  };

  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(800);
  const clipName = path.basename(clipPath);
  check("imported as a link by default", kind(clipName) === "link");
  await openDialog();
  check("both choices are enabled, Stay in original location chosen", !(await win.locator("[data-testid=ps-copy-media]").isDisabled()) && (await win.locator("[data-testid=ps-stay-media]").getAttribute("aria-checked")) !== "false");
  await win.locator("[data-testid=ps-cancel]").click();
  await win.waitForTimeout(400);

  await choose("ps-copy-media");
  // The dialog stays until the copying is done (a big file takes a while).
  for (let i = 0; i < 120 && kind(clipName) !== "copy"; i++) await win.waitForTimeout(1000);
  check("Copy turns the imported link into a real copy", kind(clipName) === "copy" && fs.statSync(path.join(links(), clipName)).size === fs.statSync(clipPath).size);
  check("the original file is untouched", fs.existsSync(clipPath));
  check("the card is still there (same name)", (await win.locator(`[data-testid=media-card][data-name="${clipName}"]`).count()) === 1);
  await importFile(photo("copied.png", "green"), "copied.png");
  check("a file imported now is copied", kind("copied.png") === "copy");
  const saved = JSON.parse(fs.readFileSync(path.join(udDir, "user-store", "store.json"), "utf8"))["copy-media"];
  check("the choice is in the user data folder", saved && Object.values(saved).includes(true), JSON.stringify(saved));
  check("the Details panel says so", (await win.locator("[data-testid=inspector-project]").innerText()).includes("Copy media to project"));

  ({ win } = await ctx.relaunch());
  await openEditor(win);
  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(1000);
  check("after a restart the Details panel still says Copy", (await win.locator("[data-testid=inspector-project]").innerText()).includes("Copy media to project"));

  await choose("ps-stay-media");
  await importFile(photo("linked.png", "yellow"), "linked.png");
  check("Stay in original location links new imports again", kind("linked.png") === "link" && kind("copied.png") === "copy");
  return report();
};
