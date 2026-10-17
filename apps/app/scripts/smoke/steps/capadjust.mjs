// The Adjust tab's "From the CapCut draft" section on an opened draft. CLIP_AT="x,y" is a
// video or photo bar with CapCut adjustments and RULER_Y the ruler's y (CSS px, from
// c2-capcut-opened.png at 2x); the playhead goes 8 px left of it, off the bar's click. Sets
// the first slider the engine draws to ADJUST_VALUE (default 40), removes it, then puts the
// draft's back, and checks the engine's frame after each.
import { engineFrame, tab } from "./_preview.mjs";
export default async ({ win, shot }) => {
  const [x, y] = (process.env.CLIP_AT || "604,830").split(",").map(Number);
  const rulerY = Number(process.env.RULER_Y || 747);
  await win.keyboard.press("v");
  await win.mouse.click(x - 8, rulerY);
  await win.waitForTimeout(900);
  await win.mouse.click(x, y);
  await win.waitForTimeout(600);
  // The properties tabs scroll sideways; bring this one into view first.
  await win.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((e) => e.innerText.trim() === "Adjust")?.scrollIntoView({ inline: "center" }));
  await win.waitForTimeout(300);
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
