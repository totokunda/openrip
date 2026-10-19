// The Media tab's cards (after `import`, nothing on the timeline; CLIP_NAME=IMG_9079
// OPENRIP_ENGINE_MUTE=1, built app, no dev server; FFmpeg from ffmpeg-static makes a photo):
// - the hover "+" adds the card at the playhead (the project as saved, "Added" on the card,
//   one undo step);
// - a click selects a card; a selected video shows In/Out handles, dragged to a part: "+" adds
//   only that part (the clip's length and trim as saved); the handles reset by dragging them back;
// - sort: Time imported, Time created, Name, Type, Duration; Type puts the video before the photo;
// - search with no match shows the empty state, a match filters;
// - the card menu's Split scenes adds the video and runs the scene detection.
// Shots: `mc1-hover` ↔ `05-left-media/005-media-item-hover`, `mc2-range` ↔ `002-prores-imported`,
// `mc3-sort` ↔ `007-media-sort-menu`, `mc4-nomatch` ↔ `32-states/004-media-search-no-match`.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { checks, savedProject } from "./_anim.mjs";

export default async (ctx) => {
  const { win, udDir, shot, outDir, appDir, app } = ctx;
  const { check, report } = checks();
  const require = createRequire(appDir + "/package.json");
  const clips = async () => (await savedProject(win, udDir)).timeline.clips;
  const card = (name) => win.locator(`[data-testid=media-card][data-name^="${name}"]`);
  const names = () => win.locator("[data-testid=media-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-name")));
  const videoName = process.env.CLIP_NAME ?? "IMG_9079";

  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(800);

  // A photo to sort against.
  const png = path.join(outDir, "red-photo.png");
  execFileSync(require("ffmpeg-static"), ["-y", "-f", "lavfi", "-i", "color=c=red:s=320x180", "-frames:v", "1", png], { stdio: "ignore" });
  await app.evaluate(({ ipcMain }, p) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [p]);
  }, png);
  await win.locator("[data-testid=media-import]").first().click();
  for (let i = 0; i < 20 && !(await card("red-photo").count()); i++) await win.waitForTimeout(500);
  check("the photo is imported", (await card("red-photo").count()) === 1, (await names()).join(","));

  // Hover "+": the video at the playhead.
  const v = card(videoName);
  const n0 = (await clips()).length;
  await v.hover();
  const add = v.locator("[data-testid=media-add]");
  check("hovering a card shows its +", await add.isVisible());
  await shot("mc1-hover");
  await add.click();
  await win.waitForTimeout(1500);
  let list = await clips();
  const added = list.filter((c) => c.type === "video");
  check("+ puts the video on the timeline at the playhead", list.length === n0 + 1 && added.length === 1 && +added[0].startTick === 0, `${list.length} clips`);
  const whole = (+added[0].endTick - +added[0].startTick) / 1e6;
  check("the card says Added", (await v.innerText()).includes("Added"));
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(1500);
  check("one undo takes it off", (await clips()).filter((c) => c.type === "video").length === 0);

  // Selecting and the In/Out handles.
  await v.click({ position: { x: 60, y: 40 } });
  await win.waitForTimeout(400);
  check("a click selects the card", (await v.getAttribute("data-selected")) === "true");
  const range = v.locator("[data-testid=media-range]");
  check("a selected video shows In and Out handles", await range.isVisible());
  const box = await v.locator("[data-testid=media-range]").boundingBox();
  const dur = +(await range.getAttribute("data-out"));
  const grab = async (which, frac) => {
    const h = await v.locator(`[data-testid=media-range-${which}]`).boundingBox();
    await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width * frac, h.y + h.height / 2, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(300);
  };
  await grab("out", 0.5);
  await grab("in", 0.25);
  const rin = +(await range.getAttribute("data-in"));
  const rout = +(await range.getAttribute("data-out"));
  check("the handles chose about a quarter to a half of the video", Math.abs(rin / dur - 0.25) < 0.06 && Math.abs(rout / dur - 0.5) < 0.06, `${rin.toFixed(2)}-${rout.toFixed(2)} of ${dur.toFixed(2)}`);
  check("the card shows the part's length", (await v.locator("[data-testid=media-range-length]").count()) === 1);
  await shot("mc2-range");
  await v.hover();
  await add.click();
  await win.waitForTimeout(1500);
  list = await clips();
  const part = list.find((c) => c.type === "video");
  const partLen = (+part.endTick - +part.startTick) / 1e6;
  check("+ added only the chosen part", Math.abs(partLen - (rout - rin)) < 0.1 && partLen < whole * 0.4, `${partLen.toFixed(2)}s of ${whole.toFixed(2)}s`);
  const trimKey = Object.keys(part).find((k) => /trim.*start|source.*start|media.*start/i.test(k));
  check("the part starts where In was in the media", !!trimKey && Math.abs(+part[trimKey] / 1e6 - rin) < 0.15, `${trimKey}=${part[trimKey]}`);
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(1200);
  check("one undo takes the part off", (await clips()).filter((c) => c.type === "video").length === 0);

  // Sort.
  await win.keyboard.press("Escape");
  await win.locator("button[aria-label=Sort]").click();
  const items = await win.locator("[role=menuitemcheckbox]").allInnerTexts();
  check("the sort menu lists Time imported, Time created, Name, Type, Duration", ["Time imported", "Time created", "Name", "Type", "Duration"].every((t) => items.includes(t)), items.join("|"));
  await shot("mc3-sort");
  await win.locator("[data-testid=sort-type]").click();
  await win.waitForTimeout(500);
  const byType = await names();
  check("by Type the video comes before the photo", byType[0]?.startsWith(videoName) && byType[1]?.startsWith("red-photo"), byType.join(","));
  await win.locator("button[aria-label=Sort]").click();
  await win.locator("[data-testid=sort-created]").click();
  await win.waitForTimeout(400);
  check("Time created sorts without losing cards", (await names()).length === 2);
  await win.locator("button[aria-label=Sort]").click();
  await win.locator("[data-testid=sort-name]").click();
  await win.keyboard.press("Escape");

  // Search.
  await win.locator("[data-testid=media-search-open]").click();
  await win.locator("[data-testid=media-search]").fill("zzzqqq");
  await win.waitForTimeout(400);
  check("a search with no match shows the empty state", (await win.locator("[data-testid=media-empty-state]").innerText()).includes("No results found"));
  await shot("mc4-nomatch");
  await win.locator("[data-testid=media-search]").fill("red");
  await win.waitForTimeout(300);
  check("a matching search lists just that card", (await names()).length === 1 && (await names())[0].startsWith("red-photo"));
  await win.locator("[data-testid=media-search]").fill("");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // Split scenes from the card's menu.
  await card(videoName).click({ button: "right", position: { x: 60, y: 40 } });
  await win.waitForTimeout(300);
  check("a video's menu has Split scenes and New folder with selected item", (await win.locator("[data-testid=media-split-scenes]").count()) === 1 && (await win.locator("[data-testid=media-new-folder]").count()) === 1);
  await win.locator("[data-testid=media-split-scenes]").click();
  let vids = [];
  for (let i = 0; i < 60 && vids.length === 0; i++) {
    await win.waitForTimeout(1000);
    vids = (await clips()).filter((c) => c.type === "video");
  }
  check("Split scenes puts the video on the timeline (cut at its shot changes, if it has any)", vids.length >= 1, `${vids.length} parts`);
  await win.waitForTimeout(3000);
  await win.keyboard.press("Meta+z");
  return report();
};
