// Linkage settings (after import timeline newtext: a text clip 0-3 s over the main track's
// clip). ⌘B at 3 s cuts the main track into A (0-3 s, under the text) and B. Then:
//   default   every kind is on: deleting A takes the text clip with it, B closing up to 0 (undone
//             and redone, the engine's frame and the saved project exact)
//   dialog    the Linkage toggle's menu opens Linkage settings: eight kinds, all ticked; Select
//             all ticks them; Cancel saves nothing
//   saved     Text unticked and Done: the project's preference file lists "text" as off
//   follows   deleting A now leaves the text clip, where it was
//   all       Select all and Done: nothing off; with the magnet off, deleting A still takes the text
//   off       linkage toggled off: deleting A leaves the text clip whatever the boxes say
import { rulerMap, seek } from "./_preview.mjs";
import { checks, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { button, doc, key, mainClips, packed } from "./_timeline.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  const textClips = (d) => d.timeline.clips.filter((c) => c.type === "text");
  const prefs = () => {
    try {
      return JSON.parse(ctx.fs.readFileSync(`${ctx.udDir}/config.json`, "utf8")).preferences ?? {};
    } catch {
      return {};
    }
  };

  await seek(win, map, 3);
  await key(win, "Meta+b");
  let d = await doc(ctx);
  let [A, B] = mainClips(d);
  check("the main track is cut at 3 s, a text clip over A", mainClips(d).length === 2 && textClips(d).length === 1, `${mainClips(d).length} main clips, ${textClips(d).length} text`);
  const text0 = textClips(d)[0];

  // Default: all kinds on, the text goes with A.
  const del = async (clip) => {
    await select(ctx, d, clip.clipId, 1.5);
    await key(win, "Backspace");
  };
  const r = await undoCase(ctx, check, "delete A with Text linked", () => del(A), { frame: true });
  d = await doc(ctx);
  check("deleting A on the main track deletes the text clip over it, and B closes up to 0", r.ok && textClips(d).length === 0 && mainClips(d).length === 1 && mainClips(d)[0].s === 0, `${textClips(d).length} text, main ${mainClips(d).map((c) => `${c.s}-${c.e}`)}`);
  await key(win, "Meta+z");

  // The dialog.
  await win.locator("[data-testid=tool-linkage-menu]").click();
  await win.waitForTimeout(250);
  await win.locator("[data-testid=linkage-settings]").click();
  await win.waitForTimeout(400);
  const boxes = win.locator("[data-testid=linkage-dialog] button[role=checkbox][data-testid^=linkage-]:not([data-testid=linkage-all])");
  const states = async () => boxes.evaluateAll((els) => els.map((e) => e.getAttribute("aria-checked")));
  const kinds = await states();
  check("Linkage settings lists eight kinds, all ticked", kinds.length === 8 && kinds.every((s) => s === "true"), kinds.join(","));
  await shot("link-1-dialog");
  await win.locator("[data-testid=linkage-text]").click();
  check("unticking Text unticks Select all", (await win.locator("[data-testid=linkage-all]").getAttribute("aria-checked")) === "false");
  await win.locator("[data-testid=linkage-cancel]").click();
  await win.waitForTimeout(400);
  check("Cancel saves nothing", !(prefs().linkageOff ?? []).length, JSON.stringify(prefs().linkageOff));

  // Text off, saved.
  await win.locator("[data-testid=tool-linkage-menu]").click();
  await win.waitForTimeout(250);
  await win.locator("[data-testid=linkage-settings]").click();
  await win.waitForTimeout(400);
  check("the dialog opens ticked again after Cancel", (await states()).every((s) => s === "true"));
  await win.locator("[data-testid=linkage-text]").click();
  await shot("link-2-text-off");
  await win.locator("[data-testid=linkage-done]").click();
  await win.waitForTimeout(800);
  check("Done saves Text as off in the preferences", JSON.stringify(prefs().linkageOff) === '["text"]', JSON.stringify(prefs().linkageOff));

  // Follows: A deleted, the text stays.
  d = await doc(ctx);
  await undoCase(ctx, check, "delete A with Text unlinked", () => del(A), { frame: false });
  d = await doc(ctx);
  check("with Text off, deleting A leaves the text clip where it was", textClips(d).length === 1 && textClips(d)[0].startTick === text0.startTick && mainClips(d).length === 1, `${textClips(d).length} text`);
  await key(win, "Meta+z");

  // Text on again; the magnet off: deleting A leaves a gap, Close gap takes the text along.
  await win.locator("[data-testid=tool-linkage-menu]").click();
  await win.waitForTimeout(250);
  await win.locator("[data-testid=linkage-settings]").click();
  await win.waitForTimeout(400);
  await win.locator("[data-testid=linkage-all]").click();
  await win.locator("[data-testid=linkage-done]").click();
  await win.waitForTimeout(800);
  check("Select all then Done saves nothing off", !(prefs().linkageOff ?? []).length, JSON.stringify(prefs().linkageOff));
  await button(win, "Main track magnet").click();
  await win.waitForTimeout(500);
  d = await doc(ctx);
  [A, B] = mainClips(d);
  await select(ctx, d, A.clipId, 1.5);
  await key(win, "Backspace");
  d = await doc(ctx);
  const t1 = textClips(d);
  check("with the magnet off, deleting A still takes the text clip over it, leaving a gap", t1.length === 0 && mainClips(d)[0].s === B.s, `${t1.length} text, main ${mainClips(d).map((c) => `${c.s}-${c.e}`)}`);
  await key(win, "Meta+z");
  await button(win, "Main track magnet").click();
  await win.waitForTimeout(500);

  // Linkage off: nothing goes along.
  await button(win, "Linkage").click();
  await win.waitForTimeout(400);
  d = await doc(ctx);
  [A] = mainClips(d);
  await select(ctx, d, A.clipId, 1.5);
  await key(win, "Backspace");
  d = await doc(ctx);
  check("with Linkage off, deleting A leaves the text clip", textClips(d).length === 1, `${textClips(d).length} text`);
  await key(win, "Meta+z");
  await button(win, "Linkage").click();
  return report();
};
