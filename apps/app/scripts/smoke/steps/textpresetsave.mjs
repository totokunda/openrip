// Text style presets (after `import timeline newtext`; the text 0-3 s; OPENRIP_ENGINE_MUTE=1).
// Checks, each through the UI, the project as saved and the engine's frame:
// - Text ▸ Basic's preset styles grid: a tile gives the selected text that look (words and box
//   kept, fields the look doesn't set going back to their defaults), one undo step;
// - Save as preset keeps the text's whole look under Text ▸ Yours ▸ Presets (the file is in the
//   user data folder, `clip-presets/presets.json`, as a text style); the tile draws that look;
// - a click on the tile gives the selected text the saved look back (one undo step, the engine
//   redrawing); "+" adds a new text in it at the playhead; double-click renames, × deletes;
// - after the app is restarted the saved style is still listed and still applies.
// Shots: `ps1-grid` ↔ `21-inspector-text/009`, `ps2-yours` ↔ `07-left-text/002`.
import path from "node:path";
import { openEditor, seek, sectionButton, settled } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { openTab, undoCase } from "./_undo.mjs";
import { inkBox } from "./textbg.mjs";

export default async (ctx) => {
  let { win } = ctx;
  const { udDir, shot, fs } = ctx;
  const { check, report } = checks();
  const first = (await savedProject(win, udDir)).timeline.clips.find((c) => c.type === "text");
  const id = first.clipId;
  const texts = async () => {
    await ctx.win.waitForTimeout(1500);
    return (await savedProject(ctx.win, udDir)).timeline.clips.filter((c) => c.type === "text");
  };
  const saved = async () => (await texts()).find((c) => c.clipId === id);
  await seek(win, ctx.map, 1.5);
  await select(ctx, await savedProject(win, udDir), id, 1.5);
  await openTab(win, "Text");
  const q = (sel) => win.locator(`${sel}`).first();
  const color = async (well, hex) => {
    await q(`[data-testid=${well}]`).click();
    const f = q("[data-testid=color-hex]");
    await f.fill(hex);
    await f.press("Enter");
    await win.keyboard.press("Escape");
  };
  const type = async (input, value) => {
    await input.scrollIntoViewIfNeeded();
    await input.click({ clickCount: 3 });
    await input.fill(String(value));
    await input.press("Enter");
  };
  const slider = (section, label) => win.locator(`[data-testid=${section}] label`, { hasText: new RegExp(`^${label}$`) }).first().locator("xpath=..").locator("input").first();

  // The inspector's preset styles.
  const grid = await win.locator("[data-testid=text-preset-styles] button").count();
  check(`the inspector has a grid of preset styles (${grid})`, grid >= 8);
  await q("[data-testid=text-preset-styles]").scrollIntoViewIfNeeded();
  await shot("ps1-grid");
  const before = await saved();
  await undoCase(ctx, check, "a preset style from the inspector (Boxed Caption)", () => settled(win, () => q("[data-testid=text-style-caption_box]").click()));
  let c = await saved();
  check("it took the look and kept the words and the box", c.backgroundEnabled && c.backgroundOpacity === 70 && c.fontWeight === 700 && c.text === before.text && JSON.stringify(c.transform) === JSON.stringify(before.transform), JSON.stringify([c.backgroundEnabled, c.text]));
  await undoCase(ctx, check, "another style (Outline) replacing it", () => settled(win, () => q("[data-testid=text-style-outline]").click()));
  c = await saved();
  check("Outline switched the box off and the stroke on", !c.backgroundEnabled && c.strokeEnabled && c.strokeWidth === 4);

  // Make a look of its own and save it.
  await settled(win, () => color("text-color", "ff8800"));
  await settled(win, () => q("[data-testid=text-curve-on]").click());
  await settled(win, () => type(slider("text-curve", "Strength"), 40));
  await settled(win, () => q("[data-testid=text-background-on]").click());
  await settled(win, () => color("text-background-color", "112233"));
  await win.waitForTimeout(600);
  const look = await saved();
  check("the text has its own look (orange, curved, boxed)", look.color === "#ff8800" && look.textCurve === 40 && look.backgroundEnabled && look.backgroundColor === "#112233");
  const orange = await inkBox(win, "r > 200 && g > 100 && g < 170 && b < 60");
  await q("[data-testid=text-save-preset]").click();
  await win.waitForTimeout(1500);
  const file = path.join(udDir, "clip-presets", "presets.json");
  const onDisk = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).presets : []);
  const preset = onDisk()[0];
  check(
    `Save as preset wrote it to the user data folder as a text style (${preset?.name})`,
    onDisk().length === 1 && preset.source === "text" && preset.attrs.groups.text.fields.color === "#ff8800" && preset.attrs.groups.text.fields.textCurve === 40 && !("text" in preset.attrs.groups.text.fields),
  );

  // Yours ▸ Presets in the Text tab.
  await win.locator("[data-testid=assets-tab-text]").click();
  await (await sectionButton(win, "yours:presets")).click();
  await win.waitForTimeout(600);
  const tiles = win.locator("[data-testid=text-saved-style]");
  check("Text ▸ Yours ▸ Presets lists the saved style", (await tiles.count()) === 1 && (await tiles.first().getAttribute("data-preset-name")) === "Text style 1");
  await shot("ps2-yours");

  // Make the text plain, then a click on the tile gives the look back.
  await settled(win, () => q("[data-testid=text-style-plain]").click());
  c = await saved();
  check("the plain style took the look off", c.color === "#ffffff" && !c.textCurve && !c.backgroundEnabled);
  const f0 = (await inkBox(win, "r > 200 && g > 100 && g < 170 && b < 60")).n;
  await undoCase(ctx, check, "a click on the saved style", () => settled(win, () => tiles.first().click()));
  c = await saved();
  check("the saved look came back (colour, curve, box) on the same text", c.color === "#ff8800" && c.textCurve === 40 && c.backgroundColor === "#112233" && c.text === before.text && c.clipId === id);
  const n = (await inkBox(win, "r > 200 && g > 100 && g < 170 && b < 60")).n;
  check(`the engine draws it again (${f0} → ${n} orange px, was ${orange.n})`, f0 === 0 && n > 100 && Math.abs(n - orange.n) < 5);

  // "+" adds a new text in the style at the playhead.
  const before2 = (await texts()).length;
  await tiles.first().hover();
  await settled(win, () => q("[data-testid=text-saved-add]").click());
  const after = await texts();
  const added = after.find((t) => t.clipId !== id && Math.abs(+t.startTick / 1e6 - 1.5) < 0.05);
  check("the + adds a new text in the style at the playhead", after.length === before2 + 1 && !!added && added.color === "#ff8800" && added.textCurve === 40, `${before2} → ${after.length}`);

  // Rename.
  await win.locator("[data-testid=assets-tab-text]").click();
  await (await sectionButton(win, "yours:presets")).click();
  await q("[data-testid=text-saved-name]").dblclick();
  const input = q("[data-testid=text-saved-name-input]");
  await input.fill("Orange arch");
  await input.press("Enter");
  await win.waitForTimeout(1200);
  check("double-click renames it, in the file too", onDisk()[0]?.name === "Orange arch" && (await q("[data-testid=text-saved-name]").innerText()) === "Orange arch", `${onDisk()[0]?.name}`);

  // After a restart.
  await ctx.relaunch();
  win = ctx.win;
  await openEditor(win);
  await win.waitForTimeout(2000);
  await win.locator("[data-testid=assets-tab-text]").click();
  await (await sectionButton(win, "yours:presets")).click();
  await win.waitForTimeout(800);
  const again = win.locator("[data-testid=text-saved-style]");
  check("after a restart the style is listed, named Orange arch", (await again.count()) === 1 && (await again.first().getAttribute("data-preset-name")) === "Orange arch", `${await again.count()}`);
  await ctx.shot("ps3-restart");

  // Delete.
  await again.first().hover();
  await q("[data-testid=text-saved-delete]").click();
  await win.waitForTimeout(1200);
  check("× deletes it, from the file too", (await win.locator("[data-testid=text-saved-style]").count()) === 0 && onDisk().length === 0 && (await win.locator("[data-testid=text-saved-empty]").count()) === 1);
  return report();
};
