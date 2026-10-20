// Arrange layers (after `import timeline`; CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1, built app,
// no dev server). CapCut's switch (Settings > Edit "Layers can be reordered in every new project
// by default", Project settings > Arrange layers "Cannot be turned off after turned on"): on,
// tracks go in any order; off (the legacy way) they stay in bands by kind, top to bottom: text,
// stickers, effects and filters, overlay video, the main track, audio.
// - a project made with the default has it on (saved as `settings.arrangeLayers`, Details says
//   "Turned on"), and an effect, text and sticker added in turn stack in the order they came;
// - Settings > Edit's row is a live checkbox; unchecked and saved, the preference is off;
// - a new project made after that has it off (Details "Turned off", the file says false), and the
//   same three adds end in bands, text over sticker over effect over the main track, the sticker's
//   add (with its track move) one undo step;
// `arrangelayerscheck` (after `reopen`) reads the off project back and turns it on.
// Shots: `al1-on-details` ↔ `17-inspector-project/010`, `al2-settings` ↔ `02-settings/005-edit`,
// `al3-banded` (the timeline in bands).
import { checks, savedProject } from "./_anim.mjs";
import { goHome, rulerMap, seek, settled, sectionButton, pointerTool } from "./_preview.mjs";
import { openSettingsFromEditor, settingsTab, saveSettings, prefsOf } from "./_settings.mjs";
import { undoCase } from "./_undo.mjs";
import importStep from "./import.mjs";
import timelineStep from "./timeline.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const types = async () => (await savedProject(win, udDir)).timeline.tracks.map((t) => t.type);
  const arranged = (list) => {
    const band = { text: 0, sticker: 1, shape: 1, draw: 1, filter: 2, media: 3, audio: 4 };
    return list.every((t, i) => i === 0 || band[list[i - 1]] <= band[t]);
  };
  ctx.map = await rulerMap(win);

  const addEffect = async () => {
    await win.locator("[data-testid=assets-tab-effects]").click();
    await win.waitForTimeout(500);
    const tile = win.locator("[data-testid=effect-tile]").first();
    await win.mouse.move(5, 5);
    await tile.hover();
    await settled(win, () => tile.locator("[data-testid=effect-add]").click());
    await win.waitForTimeout(600);
  };
  const addText = async () => {
    await win.locator("[data-testid=assets-tab-text]").click();
    await win.waitForTimeout(400);
    await (await sectionButton(win, "add")).click();
    await settled(win, () => win.locator("[data-testid=add-text]").click());
    await win.waitForTimeout(600);
  };
  const addSticker = async () => {
    await win.locator("[data-testid=assets-tab-stickers]").click();
    await win.waitForSelector("[data-testid=sticker-tile][data-ready='1']", { timeout: 15000 });
    const tile = win.locator("[data-testid=sticker-tile][data-ready='1']").first();
    await win.mouse.move(5, 5);
    await tile.hover();
    await settled(win, () => tile.locator("[data-testid=sticker-add]").click());
    await win.waitForTimeout(600);
  };

  // ---- the default: on --------------------------------------------------------------------
  let doc = await savedProject(win, udDir);
  check("a project made with the default has Arrange layers on in its file", doc.settings.arrangeLayers === true, String(doc.settings.arrangeLayers));
  await win.mouse.click(ctx.map.x(0.5), ctx.map.y);
  await win.waitForTimeout(400);
  await win.locator("[data-testid=project-tab-details]").click();
  await win.waitForTimeout(300);
  await shot("al1-on-details");
  check("Details says Arrange layers: Turned on", /Arrange layers:\s*Turned on/.test((await win.locator("[data-testid=inspector-project]").innerText()).replace(/\s+/g, " ")));
  await seek(win, ctx.map, 1);
  await addEffect();
  await seek(win, ctx.map, 1);
  await addText();
  await pointerTool(win);
  await addSticker();
  const free = await types();
  check("with it on the tracks stack in the order they were made (sticker, text, effect, video)", free.join() === "sticker,text,filter,media", free.join());

  // ---- Settings: the default for new projects --------------------------------------------------
  await openSettingsFromEditor(win);
  await settingsTab(win, "edit");
  const row = win.locator("[data-testid=settings-row-arrangeLayers]");
  check("Settings > Edit's Arrange layers row is live, with CapCut's words", (await row.getAttribute("data-disabled")) !== "true" && /Layers can be reordered in every new project by default\./.test(await row.innerText()));
  const box = win.locator("[data-testid=settings-arrange-layers]");
  check("it starts checked", (await box.getAttribute("aria-checked")) === "true");
  await box.click();
  await win.waitForTimeout(200);
  await shot("al2-settings");
  await saveSettings(win);
  check("saved, the preference is off", (await prefsOf(win)).arrangeLayers === false);
  check("and this project keeps it on", (await savedProject(win, udDir)).settings.arrangeLayers === true);

  // ---- a new project: off ---------------------------------------------------------------------
  await goHome(win);
  await win.locator("[data-testid=new-project]").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(3000);
  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(500);
  await importStep(ctx);
  await timelineStep(ctx);
  ctx.map = await rulerMap(win);
  await win.waitForTimeout(2500);
  doc = await savedProject(win, udDir);
  check("the new project has Arrange layers off in its file", doc.settings.arrangeLayers === false, String(doc.settings.arrangeLayers));
  await win.mouse.click(ctx.map.x(0.5), ctx.map.y);
  await win.waitForTimeout(400);
  await win.locator("[data-testid=project-tab-details]").click();
  await win.waitForTimeout(300);
  check("Details says Arrange layers: Turned off", /Arrange layers:\s*Turned off/.test((await win.locator("[data-testid=inspector-project]").innerText()).replace(/\s+/g, " ")));
  await seek(win, ctx.map, 1);
  await addEffect();
  check("an effect's track goes above the video", (await types()).join() === "filter,media", (await types()).join());
  await seek(win, ctx.map, 1);
  await addText();
  await pointerTool(win);
  check("text goes to the top", (await types()).join() === "text,filter,media", (await types()).join());
  await undoCase(ctx, check, "sticker add into a band", () => addSticker());
  const banded = await types();
  check("a sticker lands under the text and over the effect (text, sticker, effect, video)", banded.join() === "text,sticker,filter,media", banded.join());
  check("every track is in its band", arranged(banded));
  await shot("al3-banded");

  return report();
};
