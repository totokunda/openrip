// The Adjust tab's controls for CapCut's clarity, vignette, fade, HSL and curves on an opened
// draft whose clip has all of them (scratch draft: calibration session 4's first clip with them
// attached), found as saved: the first clip whose draft adjustments have them all, with the
// playhead inside it. Each slider is set and the engine's frame checked; the HSL range's
// saturation is moved; the curves are taken off; then the draft's are put back.
import { checks, clipsWhere, focus, savedProject } from "./_anim.mjs";
import { engineFrame, tab, pointerTool } from "./_preview.mjs";
const KINDS = ["clarity", "vignette", "fade", "hsl", "curves"];
export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  await pointerTool(win);
  const doc = await savedProject(win, udDir);
  const kinds = (c) => new Set((c.draftAdjustments ?? []).map((a) => a.kind));
  const clip = clipsWhere(doc, (c) => KINDS.every((k) => kinds(c).has(k)))[0] ?? clipsWhere(doc, (c) => c.draftAdjustments?.length)[0];
  if (!clip) throw new Error("no clip with the draft's adjustments");
  await focus(ctx, doc, clip);
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
