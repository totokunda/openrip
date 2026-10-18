// A CapCut sticker bar on an opened draft (scratch draft: calibration session 6 with its
// sticker track shown): its first sticker bar (as saved), with the playhead inside it. Checks
// the engine draws the sticker, the Filter tab shows its opacity, and setting it to
// STICKER_OPACITY (default 30) fades the sticker.
import { checks, clipsWhere, focus, savedProject } from "./_anim.mjs";
import { engineFrame, tab } from "./_preview.mjs";
export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  const bright = "r + g + b > 200";
  await win.keyboard.press("v");
  const doc = await savedProject(win, udDir);
  const sticker = clipsWhere(doc, (c) => c.draftKind === "sticker")[0];
  if (!sticker) throw new Error("no sticker bar");
  await focus(ctx, doc, sticker);
  await win.waitForTimeout(900);
  const drawn = await engineFrame(win, bright);
  check("the sticker is drawn", drawn.count > 0, `${drawn.count} bright pixels`);
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
