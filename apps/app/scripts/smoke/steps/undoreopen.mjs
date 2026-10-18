// Undo stays within a project (after edits, then reopen, which goes to a new project and back):
// the reopened project starts with nothing to undo or redo, and ⌘Z leaves it as saved.
import { checks } from "./_anim.mjs";
import { press, state } from "./_undo.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  const enabled = async (title) => !(await win.locator(`[title=${title}]`).getAttribute("class")).includes("not-allowed");
  const can = { undo: await enabled("Undo"), redo: await enabled("Redo") };
  const before = await state(ctx);
  await press(win, "Meta+z");
  await press(win, "Meta+z");
  const after = await state(ctx);
  check("a reopened project has nothing to undo", !can.undo && !can.redo && after.doc === before.doc && after.frame === before.frame, `undo ${can.undo}, redo ${can.redo}; ⌘Z changed the project ${after.doc !== before.doc}, the frame ${after.frame !== before.frame}`);
  return report();
};
