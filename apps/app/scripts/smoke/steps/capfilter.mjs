// A CapCut filter bar's intensity on an opened draft: its first filter bar (as saved), with
// the playhead inside it. Sets the Filter tab's intensity to 0, then 100, and checks the
// engine's frame after each.
import { engineFrame, tab, pointerTool } from "./_preview.mjs";
import { clipsWhere, focus, savedProject } from "./_anim.mjs";
export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  await pointerTool(win);
  const doc = await savedProject(win, udDir);
  const bar = clipsWhere(doc, (c) => c.type === "filter" && c.draftKind !== "sticker")[0];
  if (!bar) throw new Error("no filter bar");
  await focus(ctx, doc, bar);
  await tab(win, "Filters");
  await shot("f1-filter-tab");
  const panel = await win.locator("[data-testid=inspector] [role=tabpanel]").first().innerText();
  const field = win.locator("[data-testid=inspector] [role=tabpanel] input").first();
  if ((await field.count()) === 0) throw new Error(`no intensity field: ${panel.replace(/\s+/g, " ").slice(0, 200)}`);
  const was = await field.inputValue();
  const set = async (v) => {
    await field.click({ clickCount: 3 });
    await field.fill(String(v));
    await field.press("Enter");
    await win.waitForTimeout(1500);
    return engineFrame(win);
  };
  const before = await engineFrame(win);
  const off = await set(0);
  await shot("f2-filter-off");
  const full = await set(100);
  await shot("f3-filter-full");
  return `${panel.replace(/\s+/g, " ").slice(0, 80)}; intensity ${was}: lightness ${before.light.toFixed(3)}, at 0 ${off.light.toFixed(3)} (changed ${before.sum !== off.sum}), at 100 ${full.light.toFixed(3)} (changed ${off.sum !== full.sum})`;
};
