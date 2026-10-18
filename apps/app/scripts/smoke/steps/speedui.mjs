// The Speed tab through its controls (after import timeline, the whole clip at 24 fps):
// - Standard: 2× typed in the field halves the clip's length, and 2 s in shows what 4 s did
//   (⌘Z / ⇧⌘Z); the field stops at 100× and 0.1×; the Duration field sets the speed from a
//   length; Change audio pitch is saved on the clip; Reset puts 1× back;
// - Curve: the presets' cards; Flash In shortens the clip and changes the frame 1 s in (⌘Z /
//   ⇧⌘Z); its editor shows its four points; a point dragged up speeds that part up; + adds a
//   point at the playhead, − takes it away; Reset brings the preset's points back; None takes
//   the curve off at the speed it averaged.
import { drag, engineFrame, rulerMap, seek, settled, tab } from "./_preview.mjs";
import { checks, clipsWhere, pick, savedClips, savedProject } from "./_anim.mjs";
import { press, undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  ctx.map ??= await rulerMap(win);
  const { check, report } = checks();
  const doc = await savedProject(win, udDir);
  const video = clipsWhere(doc, (c) => c.type === "video")[0];
  const fps = doc.settings?.fps || 24;
  const len0 = Math.round(((+video.endTick - +video.startTick) * fps) / 1e6);
  const saved = async () => (await savedClips(win, udDir)).find((c) => c.clipId === video.clipId);
  const lenOf = (c) => Math.round(((+c.endTick - +c.startTick) * fps) / 1e6);
  const frameAt = async (s) => {
    await seek(win, ctx.map, s);
    return (await engineFrame(win)).sum;
  };
  const at4 = await frameAt(4);
  const at1 = await frameAt(1);
  // The tab on a sub-tab, the clip selected (by its bar, away from the playhead).
  const open = async (sub) => {
    await pick(ctx, await savedProject(win, udDir), video.clipId);
    await tab(win, "Speed");
    await win.locator("[data-testid=inspector] [role=tab]", { hasText: new RegExp(`^${sub}$`) }).click();
    await win.waitForTimeout(400);
  };
  const type = async (testId, value) => {
    const input = win.locator(`[data-testid=${testId}]`);
    await input.click();
    await win.keyboard.press("Meta+A");
    await win.keyboard.type(String(value));
    await settled(win, () => win.keyboard.press("Enter"));
  };

  // Standard.
  await open("Standard");
  const subs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tablist]")][1]?.innerText.replace(/\s+/g, ",") ?? "");
  check("sub-tabs Standard and Curve", subs === "Standard,Curve", subs);
  check("1.00x to start", (await win.locator("[data-testid=speed-value]").inputValue()) === "1.00x");
  await shot("s1-standard");
  await seek(win, ctx.map, 2);
  await open("Standard");
  await undoCase(ctx, check, "2× in the field", () => type("speed-value", 2));
  let c = await saved();
  check("2×: saved, half the length", c.speed === 2 && Math.abs(lenOf(c) - len0 / 2) <= 1, `${c.speed}x, ${lenOf(c)} of ${len0} frames`);
  check("2×: 2 s in shows what 4 s did", (await frameAt(2)) === at4);
  // The clip stays selected through these: the fields are its.
  await open("Standard");
  await type("speed-duration", ((len0 / fps) / 4).toFixed(1));
  c = await saved();
  check("Duration sets the speed from a length", Math.abs(c.speed - 4) < 0.05, `${c.speed}x`);
  await win.locator("[data-testid=inspector] [role=switch][aria-label='Change audio pitch']").click();
  await win.waitForTimeout(800);
  check("Change audio pitch saved on the clip", (await saved()).changePitch === true, (await saved()).changePitch);
  await settled(win, () => win.locator("[data-testid=speed-reset]").click());
  c = await saved();
  check("Reset: 1×, the clip's length back", c.speed === 1 && lenOf(c) === len0, `${c.speed}x, ${lenOf(c)} frames`);
  // The ends of the scale, then undone (a length rounds to whole frames, so a trip to 100×
  // and back doesn't give the clip's media back exactly).
  await type("speed-value", 500);
  check("the field stops at 100×", (await saved()).speed === 100, (await saved()).speed);
  await type("speed-value", 0.01);
  check("and at 0.1×", (await saved()).speed === 0.1, (await saved()).speed);
  await press(win, "Meta+z");
  await press(win, "Meta+z");
  c = await saved();
  check("⌘Z twice: 1× and the clip's length back", c.speed === 1 && lenOf(c) === len0, `${c.speed}x, ${lenOf(c)} frames`);
  // The timeline may have zoomed with the clip's length: measure the ruler again.
  ctx.map = await rulerMap(win);

  // Curve.
  await open("Curve");
  const presets = await win.locator("[data-testid=curve-card]").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  check("the presets: None, Custom, Montage, Hero, Bullet, Jump Cut, Flash In, Flash Out", presets.join() === "None,Custom,Montage,Hero,Bullet,Jump Cut,Flash In,Flash Out", presets.join());
  await seek(win, ctx.map, 1);
  await open("Curve");
  await undoCase(ctx, check, "Flash In", () => settled(win, () => win.locator("[data-testid=curve-card][title='Flash In']").click()));
  c = await saved();
  check("Flash In: saved, the clip shorter", c.speedCurve?.preset === "Flash In" && lenOf(c) < len0 * 0.6, `${c.speedCurve?.preset}, ${lenOf(c)} of ${len0} frames`);
  check("Flash In: 1 s in shows other media", (await frameAt(1)) !== at1);
  await open("Curve");
  const points = () => win.locator("[data-testid=curve-point]");
  check("its editor shows its four points", (await points().count()) === 4, await points().count());
  await shot("s2-curve-editor");

  // The third point (x 0.6, 1×) dragged up towards 3×.
  const len1 = lenOf(c);
  {
    await win.locator("[data-testid=curve-graph]").scrollIntoViewIfNeeded();
    const p = await points().nth(2).boundingBox();
    const graph = await win.locator("[data-testid=curve-graph]").boundingBox();
    // 3× on the log scale from 0.1× (bottom, 12 px in) to 10× (top).
    const level = (Math.log10(3) + 1) / 2;
    const y = graph.y + 12 + (1 - level) * (graph.height - 24);
    await settled(win, () => drag(win, p.x + p.width / 2, p.y + p.height / 2, p.x + p.width / 2, y));
    c = await saved();
    const moved = c.speedCurve?.points?.[2];
    check("a point dragged up: faster there, the clip shorter", moved && Math.abs(moved.y - 3) < 0.6 && lenOf(c) < len1, `${JSON.stringify(moved)}, ${lenOf(c)} frames`);
  }
  // + at the playhead (half a second into the clip), then −.
  await seek(win, ctx.map, 0.5);
  await open("Curve");
  await settled(win, () => win.locator("[data-testid=curve-add]").click());
  c = await saved();
  check("+ adds a point at the playhead", c.speedCurve?.points?.length === 5, c.speedCurve?.points?.length);
  await open("Curve");
  await settled(win, () => win.locator("[data-testid=curve-remove]").click());
  c = await saved();
  check("− takes it away", c.speedCurve?.points?.length === 4, c.speedCurve?.points?.length);
  await open("Curve");
  await settled(win, () => win.locator("[data-testid=curve-reset]").click());
  c = await saved();
  check("Reset: the preset's points back", JSON.stringify(c.speedCurve?.points) === JSON.stringify([{ x: 0, y: 5.2 }, { x: 0.4, y: 5.2 }, { x: 0.6, y: 1 }, { x: 1, y: 1 }]), JSON.stringify(c.speedCurve?.points));
  const avg = c.speed;
  await open("Curve");
  await settled(win, () => win.locator("[data-testid=curve-card][title=None]").click());
  c = await saved();
  check("None: no curve, at the speed it averaged", !c.speedCurve && Math.abs(c.speed - avg) < 1e-6, `${JSON.stringify(c.speedCurve)} ${c.speed} vs ${avg}`);
  return report();
};
