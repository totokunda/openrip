// Undo and redo of an Animation tab change (after newtext): Type 1 on the text, then ⌘Z should
// bring back None and ⇧⌘Z Type 1 again.
import { rulerMap, tab } from "./_preview.mjs";
import { checks, choose, selected } from "./_anim.mjs";
import { ROW, textX } from "./animtext.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const { check, report } = checks();
  await win.mouse.click(await textX(win, map), ROW);
  await win.waitForTimeout(600);
  await tab(win, "Animation");
  await choose(win, "Animation", "Type 1");
  await win.mouse.click(await textX(win, map), ROW);
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(800);
  const undone = await selected(win, "Animation");
  await win.keyboard.press("Meta+Shift+z");
  await win.waitForTimeout(800);
  const redone = await selected(win, "Animation");
  check("⌘Z brings back None, ⇧⌘Z Type 1", undone === "None" && redone === "Type 1", `${undone}, then ${redone}`);
  return report();
};
