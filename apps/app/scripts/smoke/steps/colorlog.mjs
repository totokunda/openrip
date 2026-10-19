// Adjust ▸ Color wheel's Log mode (after import timeline; CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1,
// built app; docs/plan/capcut-ui-spec.md §6.23, 25-inspector-adjustment-layer/021-color-wheel-
// mode-dropdown, 022-color-wheel-log): the mode dropdown (Primary, Log), the Log wheels named
// Shadow, Middle tone, Highlight and Offset, each wheel's luma arc and R, G, B fields, the
// engine's picture changing as Log's maths shift it (the highlight wheel moves a light patch
// far more than a dark one; the offset wheel tints it), Primary and Log keeping their own
// values (back to Primary the picture is as it was), the values saved as `wheels.log`, reopened
// and drawn again, and an export whose frames carry the grade (ffmpeg).
import { engineFrame, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { at, choose, mediaClip, open, savedClip } from "./_inspector.mjs";
import { undoCase } from "./_undo.mjs";
import { apart, exportProject, filePatch, patch } from "./_gaps.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const clip = await mediaClip(ctx);
  const id = clip.clipId;
  const T = 1.5;
  await at(ctx, id, T);
  await open(win, "Adjust", "Color wheel");
  await win.waitForTimeout(500);
  const labels = () => win.locator("[data-testid^=wheel-] span.text-brand-light").allInnerTexts();
  // The lightest and darkest of a grid of patches: the Highlight wheel is judged on the one, Shadow's partner on the other.
  const lum = (c) => (c[0] + c[1] + c[2]) / 3;
  const grid = [];
  for (const y of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) for (const x of [0.38, 0.5, 0.62]) grid.push({ x, y, c: await patch(win, x, y, 0.03) });
  const lightest = grid.reduce((a, b) => (lum(b.c) > lum(a.c) ? b : a));
  const darkest = grid.reduce((a, b) => (lum(b.c) < lum(a.c) ? b : a));
  const plainLight = lightest.c;
  const plainDark = darkest.c;
  const plainMid = await patch(win, 0.5, 0.55, 0.04);
  await shot("cl-1-primary");
  const mode = win.locator('[aria-label="Color wheel mode"]');
  check("a mode dropdown sits over Intensity, on Primary", (await mode.count()) === 1 && /Primary/.test(await mode.innerText()), await mode.innerText());
  check("Primary's wheels: Shadows, Middle grey, Highlights, Offset", (await win.locator("[data-testid=wheels-names], [data-testid^=wheel-]").count()) === 4 && (await win.locator("[data-mode=primary]").innerText()).includes("Middle grey"));
  await win.locator('[aria-label="Color wheel mode"]').click();
  const options = await win.getByRole("option").allInnerTexts();
  check("the dropdown offers Primary and Log", options.map((s) => s.trim()).join() === "Primary,Log", options.join());
  await win.keyboard.press("Escape");

  await undoCase(ctx, check, "wheel mode Log", () => choose(win, "Color wheel mode", "Log"), { frame: false });
  const names = await win.locator("[data-mode=log]").innerText();
  check("Log's wheels: Shadow, Middle tone, Highlight, Offset", ["Shadow", "Middle tone", "Highlight", "Offset"].every((n) => names.includes(n)) && !names.includes("Shadows"), names.replace(/\s+/g, " "));
  check("Log with nothing set draws the same picture", apart(await patch(win, lightest.x, lightest.y, 0.03), plainLight) < 3);
  await shot("cl-2-log");

  // The Highlight wheel's luma raised (a click near the top of its arc), the Offset wheel's red typed.
  const arc = win.locator('[data-testid=wheel-gain] [aria-label="Highlight luma"]');
  const box = await arc.boundingBox();
  await undoCase(ctx, check, "log highlight luma", async () => {
    await settled(win, async () => {
      await win.mouse.click(box.x + box.width / 2, box.y + box.height * 0.1);
      await win.waitForTimeout(200);
    });
  });
  const saved1 = await savedClip(ctx, id);
  check("the highlight wheel's luma is saved under wheels.log.gain", (saved1.color?.wheels?.log?.gain?.luma ?? 0) > 0.5 && saved1.color.wheels.mode === "log" && !saved1.color.wheels.gain, JSON.stringify(saved1.color?.wheels));
  const liftedLight = await patch(win, lightest.x, lightest.y, 0.03);
  const liftedDark = await patch(win, darkest.x, darkest.y, 0.03);
  check("the engine shifts the light patch far more than the dark one", lum(liftedLight) - lum(plainLight) > 6 && lum(liftedLight) - lum(plainLight) > 2 * Math.max(1, lum(liftedDark) - lum(plainDark)), `light ${lum(plainLight).toFixed(0)} +${(lum(liftedLight) - lum(plainLight)).toFixed(1)}, dark ${lum(plainDark).toFixed(0)} +${(lum(liftedDark) - lum(plainDark)).toFixed(1)}`);
  const redField = win.locator('input[aria-label="Offset red"]');
  await undoCase(ctx, check, "log offset red", async () => {
    await redField.fill("0.6");
    await settled(win, () => redField.press("Enter"));
    await win.evaluate(() => document.activeElement?.blur?.());
  });
  const tinted = await patch(win, 0.5, 0.55, 0.04);
  check("the offset wheel's red tints the middle", tinted[0] - plainMid[0] > 10 && tinted[0] - plainMid[0] > tinted[2] - plainMid[2] + 6, `${plainMid.map((v) => v.toFixed(0))} → ${tinted.map((v) => v.toFixed(0))}`);
  await shot("cl-3-log-set");

  // Intensity: at 0 the Log grade is off.
  await undoCase(ctx, check, "log intensity 0", async () => {
    const input = win.locator("[data-testid=section-wheels] input").first();
    await input.click({ clickCount: 3 });
    await input.fill("0");
    await settled(win, () => input.press("Enter"));
    await win.evaluate(() => document.activeElement?.blur?.());
  });
  check("Intensity 0 turns the Log wheels off", apart(await patch(win, 0.5, 0.55, 0.04), plainMid) < 3);
  await undoCase(ctx, check, "log intensity back", async () => {
    const input = win.locator("[data-testid=section-wheels] input").first();
    await input.click({ clickCount: 3 });
    await input.fill("100");
    await settled(win, () => input.press("Enter"));
    await win.evaluate(() => document.activeElement?.blur?.());
  });

  // Back to Primary: its own (empty) wheels, the picture as it was; and Log again keeps its values.
  await undoCase(ctx, check, "wheel mode Primary", () => choose(win, "Color wheel mode", "Primary"));
  check("back on Primary the picture is as it was, its wheels are untouched", apart(await patch(win, 0.5, 0.55, 0.04), plainMid) < 3 && (await win.locator("[data-mode=primary]").count()) === 1);
  await choose(win, "Color wheel mode", "Log");
  check("and Log keeps its values", (await win.locator('input[aria-label="Offset red"]').inputValue()) === "0.60");

  // Reopen: saved and drawn.
  const name = await win.locator("[data-testid=project-name]").inputValue();
  await win.waitForTimeout(800);
  await (await import("./reopen.mjs")).default({ win, shot });
  const again = await savedClip(ctx, id);
  check("reopened, the Log wheels are saved", again.color?.wheels?.mode === "log" && again.color.wheels.log?.offset?.red === 0.6 && again.color.wheels.log.gain?.luma > 0.5, `${JSON.stringify(again.color?.wheels)} (${name})`);
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, T);
  await win.keyboard.press("Escape");
  const re = await patch(win, 0.5, 0.55, 0.04);
  check("and the engine draws them", re[0] - plainMid[0] > 10, `${plainMid.map((v) => v.toFixed(0))} → ${re.map((v) => v.toFixed(0))}`);

  // Export: the file's frames have the grade (a patch redder than the picture's).
  const file = await exportProject(ctx, "colorlog-export");
  const exported = filePatch(file, T, 0.5, 0.55);
  check("the exported frame is graded as the player's is", exported[0] - exported[2] > re[0] - re[2] - 12 && exported[0] - exported[2] > plainMid[0] - plainMid[2] + 8, `exported ${exported.map((v) => v.toFixed(0))}, player ${re.map((v) => v.toFixed(0))}`);
  return report();
};
