// Edit ▸ Undo and Redo in the menu bar (main's AppMenu): with a caption's Text tab open
// (selcaption), uppercase it, then choose Undo and Redo from the menu; the engine's frame
// goes back and forth.
import { engineFrame } from "./_preview.mjs";
import { textCase } from "./_undo.mjs";
export default async ({ app, win }) => {
  const choose = (id) =>
    app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item) return false;
      item.click();
      return true;
    }, id);
  const f0 = await engineFrame(win);
  await textCase(win, "uppercase");
  await win.waitForTimeout(500);
  const f1 = await engineFrame(win);
  await win.evaluate(() => document.activeElement?.blur?.());
  const found = await choose("undo");
  await win.waitForTimeout(1500);
  const f2 = await engineFrame(win);
  await choose("redo");
  await win.waitForTimeout(1500);
  const f3 = await engineFrame(win);
  const ok = found && f1.sum !== f0.sum && f2.sum === f0.sum && f3.sum === f1.sum;
  const line = `menu items ${found}; edit changed the frame ${f1.sum !== f0.sum}; Undo gave it back ${f2.sum === f0.sum}; Redo again ${f3.sum === f1.sum}`;
  if (!ok) throw new Error(line);
  return line;
};
