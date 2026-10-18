// The Adjust tab's controls for CapCut's clarity, vignette, fade, HSL and curves on an opened
// draft whose clip has all of them (scratch draft: calibration session 4's first clip with them
// attached). CLIP_AT="x,y" is the clip's bar and RULER_Y the ruler's y (CSS px, from
// c2-capcut-opened.png at 2x). Each slider is set and the engine's frame checked; the HSL
// range's saturation is moved; the curves are taken off; then the draft's are put back.
import { checks } from "./_anim.mjs";
import { engineFrame, tab } from "./_preview.mjs";
export default async ({ win, shot }) => {
  const { check, report } = checks();
  const [x, y] = (process.env.CLIP_AT || "604,830").split(",").map(Number);
  const rulerY = Number(process.env.RULER_Y || 747);
  await win.keyboard.press("v");
  await win.mouse.click(x - 8, rulerY);
  await win.waitForTimeout(900);
  await win.mouse.click(x, y);
  await win.waitForTimeout(600);
  await win.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((e) => e.innerText.trim() === "Adjust")?.scrollIntoView({ inline: "center" }));
  await win.waitForTimeout(300);
  await tab(win, "Adjust");
  await shot("k1-adjust-tab");
  const row = (kind) => win.locator(`[data-draft-adjustment="${kind}"]`).first();
  const text = async (kind) => ((await row(kind).count()) ? (await row(kind).innerText()).replace(/\s+/g, " ").trim() : "");
  for (const kind of ["clarity", "vignette", "fade", "hsl", "curves"]) {
    const t = await text(kind);
    check(`${kind} listed and drawn`, t !== "" && !t.includes("not drawn yet"), t);
  }
  const first = await engineFrame(win);
  let last = first;
  // Each slider to a new value: the frame changes.
  const set = async (input, value) => {
    await input.scrollIntoViewIfNeeded();
    await input.click({ clickCount: 3 });
    await input.fill(String(value));
    await input.press("Enter");
    await win.waitForTimeout(1500);
    const now = await engineFrame(win);
    const changed = now.sum !== last.sum;
    last = now;
    return { changed, light: now.light };
  };
  for (const [kind, value] of [["clarity", 100], ["vignette", 100], ["fade", 100]]) {
    const input = row(kind).locator("input").first();
    const was = (await input.count()) ? await input.inputValue() : "";
    const r = (await input.count()) ? await set(input, value) : { changed: false, light: 0 };
    check(`${kind} ${was} → ${value} changes the picture`, r.changed, `lightness ${r.light.toFixed(3)}`);
  }
  // HSL: the red range's saturation, −100 back to 0.
  const sat = row("hsl").locator("[data-draft-adjustment-part=saturation] input").first();
  const satWas = (await sat.count()) ? await sat.inputValue() : "";
  const r = (await sat.count()) ? await set(sat, 0) : { changed: false, light: 0 };
  check(`HSL saturation ${satWas} → 0 changes the picture`, r.changed);
  await shot("k2-adjust-edited");
  // Curves off.
  const curves = row("curves").locator("button[aria-label^='Remove']");
  if (await curves.count()) {
    await curves.click();
    await win.waitForTimeout(1500);
    const now = await engineFrame(win);
    check("taking the curves off changes the picture", now.sum !== last.sum);
    last = now;
  } else check("curves can be removed", false);
  // The draft's back: the first frame again.
  await win.locator("[title=\"Put back the draft's adjustments\"]").click();
  await win.waitForTimeout(1500);
  const restored = await engineFrame(win);
  await shot("k3-adjust-restored");
  check("putting the draft's back restores its picture", restored.sum === first.sum, `lightness ${first.light.toFixed(3)} / ${restored.light.toFixed(3)}`);
  return report();
};
