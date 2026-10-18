// A CapCut sticker bar on an opened draft (scratch draft: calibration session 6 with its
// sticker track shown). CLIP_AT="x,y" is the sticker's bar and RULER_Y the ruler's y (CSS px,
// from c2-capcut-opened.png at 2x); the playhead goes 16 px left of it, off the bar's click. Checks
// the engine draws the sticker, the Filter tab shows its opacity, and setting it to
// STICKER_OPACITY (default 30) fades the sticker.
import { checks } from "./_anim.mjs";
import { engineFrame, tab } from "./_preview.mjs";
export default async ({ win, shot }) => {
  const { check, report } = checks();
  const [x, y] = (process.env.CLIP_AT || "604,830").split(",").map(Number);
  const rulerY = Number(process.env.RULER_Y || 747);
  const bright = "r + g + b > 200";
  await win.keyboard.press("v");
  await win.mouse.click(x - 16, rulerY);
  await win.waitForTimeout(1500);
  const drawn = await engineFrame(win, bright);
  check("the sticker is drawn", drawn.count > 0, `${drawn.count} bright pixels`);
  await win.mouse.click(x, y);
  await win.waitForTimeout(600);
  await win.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((e) => e.innerText.trim() === "Filter")?.scrollIntoView({ inline: "center" }));
  await tab(win, "Filter").catch(() => {});
  await shot("s1-sticker-tab");
  const body = await win.locator("body").innerText();
  check("the bar is a drawn sticker", body.includes("Sticker") && !body.includes("doesn't draw this yet"));
  const opacity = win.getByText("Opacity", { exact: true });
  check("its opacity is shown", (await opacity.count()) > 0);
  const input = opacity.locator("xpath=ancestor::*[.//input][1]").locator("input").first();
  const was = (await input.count()) ? await input.inputValue() : "";
  if (await input.count()) {
    await input.click({ clickCount: 3 });
    await input.fill(process.env.STICKER_OPACITY || "30");
    await input.press("Enter");
    await win.waitForTimeout(1500);
  }
  const faded = await engineFrame(win, bright);
  await shot("s2-sticker-faded");
  check(`opacity ${was} → ${process.env.STICKER_OPACITY || "30"} fades the sticker`, faded.sum !== drawn.sum && faded.light < drawn.light, `lightness ${drawn.light.toFixed(4)} → ${faded.light.toFixed(4)}`);
  return report();
};
