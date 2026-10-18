// The Shortcuts window (CapCut's: Timeline / Player / Basic / Other, the preset menu, two columns
// of key badges, Reset, Save and Cancel), after `import timeline`: from the top bar's keyboard
// and Help ▸ Shortcuts; each tab's rows; Split moved from ⌘B to ⌘K (the field asks for keys,
// Save turns on), Q refused for it as Delete left's; then in the editor ⌘K splits and ⌘B
// doesn't, and the binding is kept; Reset puts ⌘B back.
import { checks } from "./_anim.mjs";
import { doc, mainClips } from "./_timeline.mjs";
import { rulerMap, seek } from "./_preview.mjs";
import { clickMenu, prefsOf } from "./_settings.mjs";

export default async (ctx) => {
  const { win, app } = ctx;
  const { check, report } = checks();
  const open = () => win.locator("[data-testid=shortcuts-window]");
  const row = (id) => win.locator(`[data-testid=shortcut-row-${id}]`);
  const keysOf = (id) => row(id).getAttribute("data-keys");
  const saveOn = async () => !(await win.locator("[data-testid=shortcuts-save]").isDisabled());
  const settle = () => win.waitForTimeout(400);

  // From the menu bar's Help ▸ Shortcuts, then the top bar's keyboard.
  const viaMenu = await clickMenu(app, "Shortcuts");
  await settle();
  check("Help ▸ Shortcuts opens the Shortcuts window", viaMenu && (await open().count()) === 1, `menu item ${viaMenu}`);
  await win.locator("[data-testid=shortcuts-cancel]").click();
  await settle();
  await win.locator("[data-testid=shortcuts]").click();
  await win.waitForSelector("[data-testid=shortcuts-window]");
  await settle();
  const box = await open().boundingBox();
  check("the top bar's keyboard opens it, 718 wide", Math.abs(box.width - 718) < 2, `${box.width}×${box.height}`);

  // Every tab, two columns of rows with their keys.
  const tabs = {};
  for (const id of ["timeline", "player", "basic", "other"]) {
    await win.locator(`[data-testid=shortcuts-tab-${id}]`).click();
    await win.waitForTimeout(200);
    tabs[id] = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=shortcut-row-]")].map((r) => ({ id: r.getAttribute("data-testid").slice(13), keys: r.getAttribute("data-keys"), missing: r.getAttribute("data-missing") === "true" })));
    await ctx.shot(`sc-1-${id}`);
    if (id === "timeline") {
      // CapCut's list scrolls: a shot further down too.
      await win.locator("[data-testid=shortcuts-list-timeline]").evaluate((e) => (e.scrollTop = e.scrollHeight / 2));
      await ctx.shot("sc-1-timeline-2");
      await win.locator("[data-testid=shortcuts-list-timeline]").evaluate((e) => (e.scrollTop = 0));
    }
  }
  const has = (tab, id, keys) => tabs[tab].some((r) => r.id === id && r.keys === keys);
  check(
    "the tabs hold CapCut's actions with OpenRip's keys",
    has("timeline", "split", "Mod+B") && has("timeline", "deleteLeft", "Q") && has("timeline", "addMarker", "M") && has("player", "playPause", "Space") && has("basic", "undo", "Mod+Z") && has("basic", "copy", "Mod+C") && tabs.other.length > 0,
    Object.entries(tabs).map(([k, v]) => `${k} ${v.length} (${v.filter((r) => r.missing).length} not yet)`).join(", "),
  );
  await win.locator("[data-testid=shortcuts-preset]").click();
  await win.waitForTimeout(200);
  const presets = await win.locator("[data-testid=shortcuts-preset-option]").allInnerTexts();
  await ctx.shot("sc-1-presets");
  await win.keyboard.press("Escape");
  check("the preset menu: Shortcut 1–5", presets.map((p) => p.trim()).join(",") === "Shortcut 1,Shortcut 2,Shortcut 3,Shortcut 4,Shortcut 5", presets.join(","));
  await win.locator("[data-testid=shortcuts-tab-timeline]").click();
  await win.waitForTimeout(200);
  check("Save is off until something changes", !(await saveOn()), "");

  // Split onto ⌘K.
  await row("split").click();
  await win.waitForTimeout(200);
  const field = win.locator("[data-testid=shortcut-field]");
  const tip = await field.getAttribute("title");
  await ctx.shot("sc-2-editing");
  check("a click edits the row: a field asking for keys, × beside it", (await field.count()) === 1 && tip === "Click to modify shortcut" && (await win.locator("[data-testid=shortcut-clear]").count()) === 1, `title "${tip}"`);
  await win.keyboard.press("Meta+k");
  await win.waitForTimeout(200);
  check("⌘K pressed: Split shows it and Save turns on", (await keysOf("split")) === "Mod+K" && (await saveOn()), await keysOf("split"));
  // Q is Delete left's: refused, and said so.
  await row("split").click();
  await win.waitForTimeout(150);
  await win.keyboard.press("q");
  await win.waitForTimeout(200);
  const conflict = await win.locator("[data-testid=shortcut-conflict]").innerText().catch(() => "");
  await ctx.shot("sc-2-conflict");
  check("a key another action has is refused and named", /Already used by .Delete left./.test(conflict) && (await keysOf("split")) === "Mod+K" && (await keysOf("deleteLeft")) === "Q", conflict);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(150);
  check("Escape lets go of the field, the window stays", (await open().count()) === 1 && (await field.count()) === 0, "");
  await win.locator("[data-testid=shortcuts-save]").click();
  await win.waitForSelector("[data-testid=shortcuts-window]", { state: "detached" });
  await settle();
  const p1 = await prefsOf(win);
  check("Save keeps the binding", JSON.stringify(p1.shortcutPresets?.["1"]) === JSON.stringify({ split: ["Mod+K"] }) && p1.shortcutPreset === 1, JSON.stringify(p1.shortcutPresets));

  // In the editor: ⌘K splits, ⌘B doesn't.
  ctx.map ??= await rulerMap(win);
  const count = async () => mainClips(await doc(ctx)).length;
  const n0 = await count();
  await seek(win, ctx.map, 3);
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("Meta+b");
  await win.waitForTimeout(1200);
  const afterB = await count();
  await win.keyboard.press("Meta+k");
  await win.waitForTimeout(1200);
  const afterK = await count();
  check("⌘K splits now, ⌘B doesn't", afterB === n0 && afterK === n0 + 1, `${n0} clips; ⌘B → ${afterB}; ⌘K → ${afterK}`);
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(1200);
  const undone = await count();
  check("⌘Z undoes it (Undo keeps its key)", undone === n0, `${undone}`);
  const accel = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("undo")?.accelerator ?? null);
  check("the menu bar's Undo has the same key", accel === "CmdOrCtrl+Z", String(accel));

  // Reset puts ⌘B back.
  await win.locator("[data-testid=shortcuts]").click();
  await win.waitForSelector("[data-testid=shortcuts-window]");
  await settle();
  await win.locator("[data-testid=shortcuts-reset]").click();
  await win.waitForTimeout(200);
  const resetKeys = await keysOf("split");
  await win.locator("[data-testid=shortcuts-save]").click();
  await win.waitForSelector("[data-testid=shortcuts-window]", { state: "detached" });
  await settle();
  const p2 = await prefsOf(win);
  // A click on the ruler drops the selection (the undone split's half may still be in it).
  await seek(win, ctx.map, 3);
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("Meta+k");
  await win.waitForTimeout(1200);
  const afterK2 = await count();
  await win.keyboard.press("Meta+b");
  await win.waitForTimeout(1200);
  const afterB2 = await count();
  check(
    "Reset: Split back on ⌘B (⌘K does nothing), nothing kept",
    resetKeys === "Mod+B" && Object.keys(p2.shortcutPresets ?? {}).length === 0 && afterK2 === n0 && afterB2 === n0 + 1,
    `${resetKeys}; ⌘K → ${afterK2}; ⌘B → ${afterB2}; kept ${JSON.stringify(p2.shortcutPresets)}`,
  );
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(800);
  return report();
};
