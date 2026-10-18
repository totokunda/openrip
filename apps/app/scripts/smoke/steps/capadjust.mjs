// The Adjust tab's "From the CapCut draft" section on an opened draft: the first video or
// photo with CapCut adjustments (as saved), with the playhead inside it. Sets the first slider
// the engine draws to ADJUST_VALUE (default 40), removes it, then puts the draft's back, and
// checks the engine's frame after each.
import { engineFrame, tab } from "./_preview.mjs";
import { clipsWhere, focus, savedProject } from "./_anim.mjs";
export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  await win.keyboard.press("v");
  const doc = await savedProject(win, udDir);
  const clip = clipsWhere(doc, (c) => c.draftAdjustments?.length)[0];
  if (!clip) throw new Error("no clip with the draft's adjustments");
  await focus(ctx, doc, clip);
  await tab(win, "Adjust");
  await shot("j1-adjust-tab");
  const rows = await win.locator("[data-draft-adjustment]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-draft-adjustment")}:${e.innerText.replace(/\s+/g, " ").trim()}`));
  if (rows.length === 0) throw new Error("no draft adjustments listed");
  const before = await engineFrame(win);
  // The first slider: its number field.
  const field = win.locator("[data-draft-adjustment] input").first();
  if ((await field.count()) === 0) throw new Error(`no slider among: ${rows.join(" | ")}`);
  const was = await field.inputValue();
  await field.scrollIntoViewIfNeeded();
  await field.click({ clickCount: 3 });
  await field.fill(process.env.ADJUST_VALUE || "40");
  await field.press("Enter");
  await win.waitForTimeout(1500);
  const edited = await engineFrame(win);
  await shot("j2-adjust-edited");
  // Remove it.
  const row = win.locator("[data-draft-adjustment]").filter({ has: win.locator("input") }).first();
  await row.locator("button[aria-label^='Remove']").click();
  await win.waitForTimeout(1500);
  const removed = await engineFrame(win);
  const left = await win.locator("[data-draft-adjustment]").count();
  await shot("j3-adjust-removed");
  // Put back the draft's.
  await win.locator("[title=\"Put back the draft's adjustments\"]").click();
  await win.waitForTimeout(1500);
  const restored = await engineFrame(win);
  await shot("j4-adjust-restored");
  return [
    `listed: ${rows.join(" | ")}`,
    `slider ${was} → ${process.env.ADJUST_VALUE || "40"}: lightness ${before.light.toFixed(3)} → ${edited.light.toFixed(3)} (changed ${before.sum !== edited.sum})`,
    `removed: ${rows.length} → ${left} rows, lightness ${removed.light.toFixed(3)} (changed ${edited.sum !== removed.sum})`,
    `restored: same frame as before ${restored.sum === before.sum} (lightness ${restored.light.toFixed(3)})`,
  ].join("; ");
};
