// A CapCut filter bar's intensity on an opened draft. FILTER_AT="x,y" is the bar and RULER_Y
// the ruler's y (CSS px, from c2-capcut-opened.png at 2x); the playhead goes 8 px left of it.
// Sets the Filter tab's intensity to 0, then 100, and checks the engine's frame after each.
import { engineFrame, tab } from "./_preview.mjs";
export default async ({ win, shot }) => {
  const [x, y] = (process.env.FILTER_AT || "300,700").split(",").map(Number);
  const rulerY = Number(process.env.RULER_Y || 747);
  await win.keyboard.press("v");
  await win.mouse.click(x - 8, rulerY);
  await win.waitForTimeout(900);
  await win.mouse.click(x, y);
  await win.waitForTimeout(600);
  // The properties tabs scroll sideways; bring this one into view first.
  await win.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((e) => e.innerText.trim() === "Filter")?.scrollIntoView({ inline: "center" }));
  await win.waitForTimeout(300);
  await tab(win, "Filter");
  await shot("f1-filter-tab");
  const panel = await win.locator("[role=tabpanel]").first().innerText();
  const field = win.locator("[role=tabpanel] input").first();
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
