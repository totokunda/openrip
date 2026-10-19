// The Media tab's folders (after `import`; CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1, built app, no
// dev server; FFmpeg from ffmpeg-static makes a photo): the card menu's "New folder with selected
// item" (a folder named in place, the card leaving the top level, a count on the folder); the
// folder opened with its breadcrumb (Media > name) showing only its cards; a card dragged onto
// the Media crumb back to the top level; a card dragged onto a folder into it; the folders kept
// in the user data folder and still there after the app is restarted; Rename and Delete from the
// folder's menu (Delete gives the cards back, deletes no file).
// Shots: `fo1-folder` ↔ `05-left-media/006-media-item-context-menu` (the menu), `fo2-open`.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { checks } from "./_anim.mjs";
import { openEditor } from "./_preview.mjs";

export default async (ctx) => {
  let { win } = ctx;
  const { udDir, shot, outDir, appDir, app } = ctx;
  const { check, report } = checks();
  const require = createRequire(appDir + "/package.json");
  const card = (name) => win.locator(`[data-testid=media-card][data-name^="${name}"]`);
  const names = () => win.locator("[data-testid=media-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-name")));
  const folder = (name) => win.locator(`[data-testid=media-folder][data-name="${name}"]`);
  const videoName = process.env.CLIP_NAME ?? "IMG_9079";
  const storeFile = path.join(udDir, "user-store", "store.json");
  const store = () => {
    try {
      return JSON.parse(ctx.fs.readFileSync(storeFile, "utf8"));
    } catch {
      return {};
    }
  };
  const dragTo = async (from, to) => {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await win.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await win.mouse.down();
    await win.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
    await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await win.waitForTimeout(200);
    await win.mouse.up();
    await win.waitForTimeout(500);
  };

  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(800);
  const png = path.join(outDir, "blue-photo.png");
  execFileSync(require("ffmpeg-static"), ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180", "-frames:v", "1", png], { stdio: "ignore" });
  await app.evaluate(({ ipcMain }, p) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [p]);
  }, png);
  await win.locator("[data-testid=media-import]").first().click();
  for (let i = 0; i < 20 && !(await card("blue-photo").count()); i++) await win.waitForTimeout(500);
  check("two cards to work with", (await names()).length === 2, (await names()).join(","));

  // New folder with selected item.
  await card(videoName).click({ position: { x: 60, y: 40 } });
  await card(videoName).click({ button: "right", position: { x: 60, y: 40 } });
  await win.waitForTimeout(300);
  await shot("fo1-folder");
  await win.locator("[data-testid=media-new-folder]").click();
  await win.waitForTimeout(500);
  const input = win.locator("[data-testid=media-folder-name]");
  check("the new folder asks for its name", (await input.count()) === 1 && (await input.inputValue()) === "New folder");
  await input.fill("Bin A");
  await input.press("Enter");
  await win.waitForTimeout(500);
  check("the folder is named Bin A, holding one card", (await folder("Bin A").count()) === 1 && (await folder("Bin A").locator("[data-testid=media-folder-count]").innerText()) === "1");
  check("the card left the top level", (await names()).join(",").startsWith("blue-photo") && (await names()).length === 1, (await names()).join(","));

  // Open it.
  await folder("Bin A").locator("[data-testid=media-folder-open]").click();
  await win.waitForTimeout(400);
  check("the breadcrumb reads Media > Bin A", (await win.locator("[data-testid=media-folder-title]").innerText()) === "Bin A" && (await win.locator("[data-testid=media-folder-up]").count()) === 1);
  check("the open folder lists only its card", (await names()).length === 1 && (await names())[0].startsWith(videoName), (await names()).join(","));
  await shot("fo2-open");

  // Drag it out onto the Media crumb.
  await dragTo(card(videoName), win.locator("[data-testid=media-folder-up]"));
  await win.waitForTimeout(300);
  check("the folder is empty after the card is dragged out", (await win.locator("[data-testid=media-empty-state]").innerText()).includes("empty"));
  await win.locator("[data-testid=media-folder-up]").click();
  await win.waitForTimeout(400);
  check("back at the top level both cards show, the folder at zero", (await names()).length === 2 && (await folder("Bin A").locator("[data-testid=media-folder-count]").innerText()) === "0", (await names()).join(","));

  // Drag the photo into the folder.
  await dragTo(card("blue-photo"), folder("Bin A").locator("[data-testid=media-folder-open]"));
  check("a card dragged onto the folder goes into it", (await names()).length === 1 && (await names())[0].startsWith(videoName) && (await folder("Bin A").locator("[data-testid=media-folder-count]").innerText()) === "1", (await names()).join(","));
  check("no clip was added to the timeline by that drop", (await win.locator("[data-testid=media-card] >> text=Added").count()) === 0);

  // Kept in the user data folder, and across a restart.
  await win.waitForTimeout(800);
  const saved = Object.entries(store()).find(([k]) => k.startsWith("media-folders."));
  check("the folders are in the user data folder's store", !!saved && saved[1][0]?.name === "Bin A" && saved[1][0].items.length === 1, JSON.stringify(saved));
  ({ win } = await ctx.relaunch());
  await openEditor(win);
  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(1500);
  check("after a restart the folder is still there with its card", (await folder("Bin A").count()) === 1 && (await folder("Bin A").locator("[data-testid=media-folder-count]").innerText()) === "1");

  // Rename, then Delete.
  await folder("Bin A").hover();
  await folder("Bin A").locator("button[title=Actions], [title=Actions] button").first().click();
  await win.locator("[data-testid=media-folder-rename]").click();
  const rn = win.locator("[data-testid=media-folder-name]");
  await rn.fill("Bin B");
  await rn.press("Enter");
  await win.waitForTimeout(400);
  check("Rename gives it a new name", (await folder("Bin B").count()) === 1 && (await folder("Bin A").count()) === 0);
  await folder("Bin B").hover();
  await folder("Bin B").locator("[title=Actions] button").first().click();
  await win.locator("[data-testid=media-folder-delete]").click();
  await win.waitForTimeout(500);
  check("Delete removes the folder and gives the card back", (await win.locator("[data-testid=media-folder]").count()) === 0 && (await names()).length === 2, (await names()).join(","));
  return report();
};
