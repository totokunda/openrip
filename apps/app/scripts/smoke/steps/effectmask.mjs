// An effect bar's Mask tab (after import timeline; CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1,
// the renderer dev server for window.Konva's handles; docs/plan/capcut-ui-spec.md §6.22): the
// Invert effect added from the Effects tab, its inspector's Basic and Mask tabs (CapCut's
// 23-inspector-effect/002-fade-in-mask), Add mask giving a rectangle that limits the effect (the
// engine's frame inverted inside it and as it was outside, read by patches), the mask's handles
// on the player (a corner dragged out grows the inverted part), the mask inverted, the mask
// saved on the bar and still there after the project is reopened, and an export whose frames
// have the effect inside the mask only (ffmpeg).
import { drag, engineFrame, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { click, open } from "./_inspector.mjs";
import { undoCase } from "./_undo.mjs";
import { apart, exportProject, filePatch, handle, patch } from "./_gaps.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const saved = () => savedProject(win, udDir);
  const barIn = async () => (await saved()).timeline.clips.find((c) => c.type === "filter" && c.effectId === "invert");
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 2);
  const plain = { centre: await patch(win, 0.5, 0.5, 0.05), corner: await patch(win, 0.08, 0.1, 0.05), side: await patch(win, 0.5, 0.5, 0.05) };

  // The effect bar from the Effects tab.
  await win.locator("[data-testid=assets-tab-effects]").click();
  await win.waitForTimeout(2500);
  const target = win.locator("[data-effect=invert]");
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  await settled(win, () => target.locator("[data-testid=effect-add]").click());
  const bar = await barIn();
  check("the Invert bar is added at the playhead", !!bar && Math.abs(+bar.startTick / 1e6 - 2) < 0.05);
  const whole = { centre: await patch(win, 0.5, 0.5, 0.05), corner: await patch(win, 0.08, 0.1, 0.05) };
  check("with no mask it inverts everything", apart(whole.centre, plain.centre) > 25 && apart(whole.corner, plain.corner) > 25, `centre ${apart(whole.centre, plain.centre).toFixed(0)}, corner ${apart(whole.corner, plain.corner).toFixed(0)}`);

  // The inspector's tabs.
  const tabs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((e) => e.innerText.trim()).join(","));
  check("the inspector is Special effects with Basic and Mask", tabs === "Special effects,Basic,Mask", tabs);
  await open(win, "Special effects", "Mask");
  await win.waitForTimeout(500);
  check("the Mask tab offers Add mask and the shape tiles", (await win.locator("[data-testid=mask-add]").count()) === 1 && (await win.locator("[data-testid=mask-panel] [data-testid^=mask-shape-]").count()) >= 9);
  await shot("em-1-mask-empty");

  // Add mask: a centred rectangle; the effect only inside it.
  await undoCase(ctx, check, "effect Add mask", () => click(win, "[data-testid=mask-add]"));
  let b = await barIn();
  check("a rectangle mask is saved on the bar", b?.masks?.length === 1 && Object.values(b.masks[0].keyframes)[0].shapeBounds?.shapeType === "rectangle", JSON.stringify(b?.masks?.[0]?.keyframes));
  const masked = { centre: await patch(win, 0.5, 0.5, 0.03), corner: await patch(win, 0.08, 0.1, 0.05) };
  check("inside the mask the picture is inverted", apart(masked.centre, plain.centre) > 25, `${apart(masked.centre, plain.centre).toFixed(0)}`);
  check("outside it the picture is as it was", apart(masked.corner, plain.corner) < 8, `${apart(masked.corner, plain.corner).toFixed(1)}`);
  await shot("em-2-mask-rectangle");

  // Handles on the player: its corner dragged out. A patch just outside the mask is plain
  // before and inverted after.
  const before = await engineFrame(win);
  const corner = await handle(win, "mask-corner", 2);
  check("the mask's handles are on the player", !!corner);
  if (corner) {
    await undoCase(ctx, check, "effect mask corner", () => settled(win, () => drag(win, corner.x, corner.y, corner.x + 80, corner.y + 80)));
    b = await barIn();
    const bounds = Object.values(b.masks[0].keyframes)[0].shapeBounds;
    check("the corner handle sized the mask", bounds.width > 0 && (await engineFrame(win)).sum !== before.sum, JSON.stringify(bounds));
  }
  await shot("em-3-handles");

  // Invert: the effect outside, the picture inside.
  await undoCase(ctx, check, "effect mask invert", () => click(win, "[data-testid=mask-invert]"));
  const flipped = { centre: await patch(win, 0.5, 0.5, 0.03), corner: await patch(win, 0.08, 0.1, 0.05) };
  check("inverted, the effect is outside the mask and the picture inside", apart(flipped.centre, plain.centre) < 8 && apart(flipped.corner, plain.corner) > 25, `centre ${apart(flipped.centre, plain.centre).toFixed(1)}, corner ${apart(flipped.corner, plain.corner).toFixed(1)}`);
  await click(win, "[data-testid=mask-invert]");
  await win.waitForTimeout(500);

  // The bar is the only thing with the mask, and reopening keeps it.
  const name = await win.locator("[data-testid=project-name]").inputValue();
  await (await import("./reopen.mjs")).default({ win, shot });
  const again = await barIn();
  check("reopened, the bar still has its mask", again?.masks?.length === 1, `${again?.masks?.length} (${name})`);
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 2.2);
  await win.keyboard.press("Escape");
  const re = { centre: await patch(win, 0.5, 0.5, 0.03), corner: await patch(win, 0.08, 0.1, 0.05) };
  check("and the engine draws it limited to the mask", apart(re.centre, plain.centre) > 25 && apart(re.corner, plain.corner) < 12, `centre ${apart(re.centre, plain.centre).toFixed(0)}, corner ${apart(re.corner, plain.corner).toFixed(1)}`);

  // Export: the same frames in the file.
  const file = await exportProject(ctx, "effectmask-export");
  const [c0, k0, c1, k1] = [filePatch(file, 1.8, 0.5, 0.5), filePatch(file, 1.8, 0.08, 0.1), filePatch(file, 2.3, 0.5, 0.5), filePatch(file, 2.3, 0.08, 0.1)];
  check("the exported frames are inverted inside the mask and not outside it", apart(c0, c1) > 25 && apart(k0, k1) < 14, `centre ${apart(c0, c1).toFixed(0)}, corner ${apart(k0, k1).toFixed(1)}`);
  return report();
};
