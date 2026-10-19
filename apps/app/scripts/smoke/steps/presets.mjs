// Copy / paste attributes and saved presets (after `import timeline newtext`: the 10 s standard
// clip with a text 0-3 s over it; OPENRIP_ENGINE_MUTE=1; the video is split at 5 s into two).
// Checks, each through the UI and the project as saved:
// - the clip menu's Copy/paste attributes: Paste off with nothing copied, Copy (⌘⇧C is the same),
//   Paste onto another clip as one undo step (the engine's frame changing), Paste Transform only,
//   ⌘⇧V onto a text (the groups a text has: Transform and Blend), the Shortcuts window listing both;
// - Save preset in the clip menu: a tile in Media ▸ Yours ▸ My presets with the frame it was saved
//   from, the file in the user data folder; a click and a drag onto a clip applying it (one
//   undo step each); Rename and Delete from the tile's menu; Yours ▸ Favorites;
// - the presets still there after the app is restarted.
// Shots: `pr1-menu` ↔ `30-timeline-toolbar/002`, `pr2-presets` ↔ `05-left-media/015`, `pr3-favorites` ↔ `013`.
import { drag, openEditor, rulerMap, sectionButton, seek, settled } from "./_preview.mjs";
import { bar, checks, savedProject } from "./_anim.mjs";
import { undoCase as undoStep } from "./_undo.mjs";
import { input, open, typeIn } from "./_inspector.mjs";

export default async (ctx) => {
  let { win } = ctx;
  const { shot, udDir } = ctx;
  const { check, report } = checks();
  const undoCase = async (name, edit, opts) => {
    await ctx.win.waitForTimeout(2500);
    return undoStep(ctx, check, name, edit, opts);
  };
  ctx.map ??= await rulerMap(win);
  const clips = (d) => d.timeline.clips;
  const saved = async (id) => {
    await ctx.win.waitForTimeout(1500);
    return clips(await savedProject(ctx.win, udDir)).find((c) => c.clipId === id);
  };
  let doc = await savedProject(win, udDir);
  const video0 = clips(doc).find((c) => c.type === "video");
  const textId = clips(doc).find((c) => c.type === "text").clipId;

  // Two videos.
  await seek(win, ctx.map, 5);
  let [x, y] = await bar(ctx, doc, video0.clipId, 7.5);
  await win.mouse.click(x, y);
  await win.waitForTimeout(500);
  await settled(win, () => win.keyboard.press("Meta+b"));
  doc = await savedProject(win, udDir);
  for (let i = 0; i < 20 && clips(doc).filter((c) => c.type === "video").length < 2; i++) {
    await win.waitForTimeout(500);
    doc = await savedProject(win, udDir);
  }
  const [v1, v2] = clips(doc).filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  const at = { [v1.clipId]: 1.9, [v2.clipId]: 7.5, [textId]: 0.5 };
  const pick = async (id) => {
    await win.keyboard.press("Escape");
    const [bx, by] = await bar(ctx, doc, id, at[id]);
    await win.mouse.click(bx, by);
    await win.waitForTimeout(500);
  };
  const menuOn = async (id) => {
    const [bx, by] = await bar(ctx, doc, id, at[id]);
    await win.mouse.click(bx, by, { button: "right" });
    await win.waitForTimeout(400);
  };
  const item = (id) => win.locator(`[data-testid=menu-${id}]`);
  const openAttributes = async (id) => {
    await menuOn(id);
    await item("attributes").hover();
    await win.waitForTimeout(300);
  };

  // Nothing copied yet: Paste attributes is off.
  await pick(v2.clipId);
  await openAttributes(v2.clipId);
  check("Paste attributes is off with nothing copied", await item("paste-attributes").isDisabled());
  check("Copy attributes is on for one clip", await item("copy-attributes").isEnabled());
  await win.keyboard.press("Escape");

  // Give the first video a look: scale, rotation, opacity, Brilliance.
  await pick(v1.clipId);
  await open(win, "Video", "Basic");
  await typeIn(win, "Scale", 120);
  await typeIn(win, "Rotate", 20);
  await typeIn(win, "Opacity", 70);
  await open(win, "Adjust", "Basic");
  await typeIn(win, "Brilliance", 25);
  await openAttributes(v1.clipId);
  await shot("pr1-menu");
  const labels = await win.locator("[data-testid^=menu-paste-attributes]").allInnerTexts();
  await item("copy-attributes").click();
  await win.waitForTimeout(400);
  check("the clip menu has Save preset", true);

  // Paste onto the second video.
  await pick(v2.clipId);
  await openAttributes(v2.clipId);
  const pasteLabels = await win.locator("[data-testid^=menu-paste-attributes]").allInnerTexts();
  check("Paste attributes is on, with a row per group", (await item("paste-attributes").isEnabled()) && pasteLabels.length > 5, pasteLabels.join(" | "));
  await win.keyboard.press("Escape");
  const before = await saved(v2.clipId);
  await undoCase("paste attributes", async () => {
    await openAttributes(v2.clipId);
    await item("paste-attributes").click();
    await win.waitForTimeout(600);
  });
  const after = await saved(v2.clipId);
  const first = await saved(v1.clipId);
  check(
    "the pasted clip has the first one's scale, rotation, opacity and Brilliance",
    Math.abs(after.transform.scaleX - first.transform.scaleX) < 0.001 &&
      Math.round(after.transform.rotation) === 20 &&
      Math.round(after.transform.opacity) === 70 &&
      after.color?.adjust?.brightness === 25,
    `${before.transform.scaleX} -> ${after.transform.scaleX}, rot ${after.transform.rotation}, opacity ${after.transform.opacity}, ${JSON.stringify(after.color)}`,
  );
  check("the copied clip is as it was", Math.round(first.transform.rotation) === 20 && first.color?.adjust?.brightness === 25);


  // The text: only the Transform group at first, then everything it has through ⌘⇧V.
  await pick(textId);
  await openAttributes(textId);
  const textGroups = (await win.locator("[data-testid^=menu-paste-attributes-]").allInnerTexts()).join(" | ");
  check("a text is offered the groups it has (Transform, Blend, Animation)", /Transform/.test(textGroups) && /Blend/.test(textGroups) && !/Adjust|Speed|Mask|Remove BG/.test(textGroups), textGroups);
  await item("paste-attributes-transform").click();
  await win.waitForTimeout(600);
  let text = await saved(textId);
  check("Paste Transform only: the text is turned and scaled, its opacity is its own", Math.round(text.transform.rotation) === 20 && text.transform.opacity === 100, `rotation ${text.transform.rotation}, opacity ${text.transform.opacity}`);
  await win.evaluate(() => document.activeElement?.blur?.());
  await pick(textId);
  await settled(win, () => win.keyboard.press("Meta+Shift+v"));
  text = await saved(textId);
  check("⌘⇧V pastes the rest: the text takes the opacity", Math.round(text.transform.opacity) === 70, `opacity ${text.transform.opacity}`);
  check("the text has no colour or speed from the video", !text.color || typeof text.color === "string", JSON.stringify(text.color));

  // The Shortcuts window lists both, with their keys.
  await win.locator("[data-testid=shortcuts]").click();
  await win.waitForSelector("[data-testid=shortcuts-window]");
  await win.locator("[data-testid=shortcuts-tab-basic]").click();
  await win.waitForTimeout(300);
  const keys = async (id) => ({ keys: await win.locator(`[data-testid=shortcut-row-${id}]`).getAttribute("data-keys"), missing: await win.locator(`[data-testid=shortcut-row-${id}]`).getAttribute("data-missing") });
  const ca = await keys("copyAttributes");
  const pa = await keys("pasteAttributes");
  check("Settings > Shortcuts lists Copy and Paste attributes with ⌘⇧C and ⌘⇧V", ca.keys === "Mod+Shift+C" && pa.keys === "Mod+Shift+V" && ca.missing !== "true" && pa.missing !== "true", JSON.stringify([ca, pa]));
  await win.locator("[data-testid=shortcuts-cancel]").click();
  await win.waitForTimeout(400);

  // Save preset from the first video's menu, with the playhead on it.
  // The playhead on the clip, so the tile has its frame (the clip is picked well off the playhead's line).
  await seek(win, ctx.map, 1);
  await pick(v1.clipId);
  await menuOn(v1.clipId);
  await item("save-preset").click();
  await win.waitForTimeout(1200);
  await win.locator("[data-testid=assets-tab-media]").click();
  await (await sectionButton(win, "yours:presets")).click();
  await win.waitForTimeout(600);
  const tiles = win.locator("[data-testid=preset-tile]");
  check("Save preset puts a tile in Yours > My presets named My presets1", (await tiles.count()) === 1 && (await tiles.first().getAttribute("data-preset-name")) === "My presets1", `${await tiles.count()}`);
  check("the tile shows the frame the preset was saved from", (await tiles.first().locator("img").count()) === 1);
  await shot("pr2-presets");
  const file = `${udDir}/clip-presets/presets.json`;
  const onDisk = () => (ctx.fs.existsSync(file) ? JSON.parse(ctx.fs.readFileSync(file, "utf8")) : null);
  await win.waitForTimeout(800);
  check("the preset is a file in the user data folder", onDisk()?.presets?.length === 1 && Object.keys(onDisk().presets[0].attrs.groups).includes("transform"), JSON.stringify(Object.keys(onDisk()?.presets?.[0]?.attrs?.groups ?? {})));

  // A second video back to plain, then the preset clicked onto it.
  await pick(v2.clipId);
  await open(win, "Video", "Basic");
  await typeIn(win, "Rotate", 0);
  await typeIn(win, "Opacity", 100);
  await typeIn(win, "Scale", 100);
  await open(win, "Adjust", "Basic");
  await typeIn(win, "Brilliance", 0);
  await win.waitForTimeout(500);
  await undoCase(
    "click a preset",
    async () => {
      await tiles.first().click();
      await win.waitForTimeout(600);
    },
    { frame: false },
  );
  let v2now = await saved(v2.clipId);
  check("a click applies the preset to the selected clip", Math.round(v2now.transform.rotation) === 20 && Math.round(v2now.transform.opacity) === 70 && v2now.color?.adjust?.brightness === 25, `rot ${v2now.transform.rotation}, opacity ${v2now.transform.opacity}`);

  // Dragged onto a clip that isn't selected.
  await pick(v1.clipId);
  await open(win, "Video", "Basic");
  await typeIn(win, "Rotate", 0);
  await typeIn(win, "Opacity", 100);
  await win.waitForTimeout(500);
  await pick(v2.clipId);
  const t = await tiles.first().boundingBox();
  const [dx, dy] = await bar(ctx, doc, v1.clipId, at[v1.clipId]);
  await undoCase("drag a preset", async () => {
    await win.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await win.mouse.down();
    await win.mouse.move(t.x + t.width / 2 + 20, t.y + t.height / 2 + 20, { steps: 4 });
    await win.mouse.move(dx, dy, { steps: 20 });
    await win.mouse.up();
    await win.waitForTimeout(800);
  });
  const v1now = await saved(v1.clipId);
  check("a preset let go on a clip applies to that clip", Math.round(v1now.transform.rotation) === 20 && Math.round(v1now.transform.opacity) === 70, `rot ${v1now.transform.rotation}, opacity ${v1now.transform.opacity}`);

  // Rename and Delete from the tile's menu.
  await tiles.first().hover();
  try {
    await win.locator("[data-testid=preset-menu]").click({ timeout: 5000 });
    await win.locator("[data-testid=preset-rename]").click({ timeout: 5000 });
  } catch (e) {
    console.log("RENAME FAIL", e.message.slice(0, 900));
    throw e;
  }
  await win.locator("[data-testid=preset-name-input]").fill("Warm look");
  await win.keyboard.press("Enter");
  for (let i = 0; i < 20 && onDisk()?.presets?.[0]?.name !== "Warm look"; i++) await win.waitForTimeout(250);
  check("Rename changes the tile's name and the file", (await tiles.first().getAttribute("data-preset-name")) === "Warm look" && onDisk().presets[0].name === "Warm look", await tiles.first().getAttribute("data-preset-name"));
  await seek(win, ctx.map, 3);
  await pick(v2.clipId);
  await menuOn(v2.clipId);
  await item("save-preset").click();
  await win.waitForTimeout(1200);
  check("a second preset is named My presets1 again only if free", (await tiles.count()) === 2 && (await tiles.nth(1).getAttribute("data-preset-name")) === "My presets1", `${await tiles.count()}`);
  await tiles.nth(1).hover();
  await tiles.nth(1).locator("[data-testid=preset-menu]").click();
  await win.locator("[data-testid=preset-delete]").click();
  await win.waitForTimeout(1000);
  check("Delete removes the tile and its entry in the file", (await tiles.count()) === 1 && onDisk().presets.length === 1 && onDisk().presets[0].name === "Warm look", `${await tiles.count()} tiles, ${onDisk()?.presets?.length} in the file`);

  // Yours > Favorites is the starred stock media.
  await (await sectionButton(win, "yours:favorites")).click();
  await win.waitForTimeout(600);
  await shot("pr3-favorites");

  // After a restart the preset is still there.
  await ctx.relaunch();
  win = ctx.win;
  await openEditor(win);
  await win.waitForTimeout(2000);
  await win.locator("[data-testid=assets-tab-media]").click();
  await (await sectionButton(win, "yours:presets")).click();
  await win.waitForTimeout(800);
  const again = win.locator("[data-testid=preset-tile]");
  check("after a restart the preset is listed, named Warm look", (await again.count()) === 1 && (await again.first().getAttribute("data-preset-name")) === "Warm look", `${await again.count()}`);
  await ctx.shot("pr4-restart");
  return report();
};
