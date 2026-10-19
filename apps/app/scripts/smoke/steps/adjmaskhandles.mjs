// An adjustment layer's mask handles on the player (after import timeline; CLIP_NAME=IMG_9079
// OPENRIP_ENGINE_MUTE=1, the renderer dev server for window.Konva; docs/plan/capcut-ui-spec.md
// §6.23, 25-inspector-adjustment-layer/025-mask-rectangle, 026-rectangle-mask-controls): a layer
// with Exposure down, its Mask tab's Add mask, and the handles CapCut gives a mask drawn over
// the player: the body dragged (move), a corner (size), the rotate knob, the feather knob and the
// round-corner handle, each saved on the layer and changing where the engine grades (read by
// patches); a second mask from "+" with its own handles; the layer deselected, the handles
// gone; undo and redo of each drag (the saved project and the frame compared).
import { drag, previewRect, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { at, click, open, typeIn } from "./_inspector.mjs";
import { undoCase } from "./_undo.mjs";
import { apart, handle, patch } from "./_gaps.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const layerIn = async () => (await savedProject(win, udDir)).timeline.clips.find((c) => c.type === "filter" && c.adjustment);
  const pose = (m) => Object.values(m.keyframes)[0];
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 2);
  const plain = { centre: await patch(win, 0.5, 0.5, 0.03), corner: await patch(win, 0.08, 0.1, 0.05), low: await patch(win, 0.5, 0.82, 0.04) };

  // A layer from the Adjustment tab, Exposure down so its grade shows.
  await win.locator("[data-testid=assets-tab-adjustment]").click();
  await win.waitForTimeout(800);
  const custom = win.locator("[data-testid=adjustment-custom]");
  await custom.hover();
  await settled(win, () => custom.locator("[data-testid=adjustment-add]").click());
  await typeIn(win, "Exposure", -50);
  await open(win, "Adjust", "Mask");
  await win.waitForTimeout(400);
  await undoCase(ctx, check, "layer Add mask", () => click(win, "[data-testid=mask-add]"));
  let layer = await layerIn();
  check("a rectangle mask is on the layer", layer?.masks?.length === 1 && pose(layer.masks[0]).shapeBounds.shapeType === "rectangle");
  const dark = await patch(win, 0.5, 0.5, 0.03);
  check("the grade is inside the mask and not outside it", apart(dark, plain.centre) > 15 && apart(await patch(win, 0.08, 0.1, 0.05), plain.corner) < 6, `${apart(dark, plain.centre).toFixed(0)}`);
  await shot("ah-1-mask");

  // The handles are on the player, as the video mask's.
  const names = ["mask-corner", "mask-feather", "mask-rotate", "mask-round"];
  const found = await Promise.all(names.map((n) => handle(win, n)));
  check("the player shows the corner, feather, rotate and round-corner handles", found.every(Boolean), names.filter((_, i) => !found[i]).join(","));

  const bounds = async () => pose((await layerIn()).masks[0]).shapeBounds;
  const b0 = await bounds();
  const p = await previewRect(win);
  const mid = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  await undoCase(ctx, check, "layer mask moved", () => settled(win, () => drag(win, mid.x, mid.y, mid.x - 30, mid.y - 40)));
  const b1 = await bounds();
  check("dragging the body moves the mask", b1.x !== b0.x && b1.y !== b0.y, `(${b0.x.toFixed(0)}, ${b0.y.toFixed(0)}) → (${b1.x.toFixed(0)}, ${b1.y.toFixed(0)})`);
  const corner = await handle(win, "mask-corner", 2);
  await undoCase(ctx, check, "layer mask sized", () => settled(win, () => drag(win, corner.x, corner.y, corner.x + 40, corner.y + 30)));
  const b2 = await bounds();
  check("a corner handle sizes it", b2.width > b1.width && b2.height > b1.height, `${b1.width.toFixed(0)}×${b1.height.toFixed(0)} → ${b2.width.toFixed(0)}×${b2.height.toFixed(0)}`);
  const rotate = await handle(win, "mask-rotate");
  await undoCase(ctx, check, "layer mask rotated", () => settled(win, () => drag(win, rotate.x, rotate.y, rotate.x - 50, rotate.y - 20)));
  check("the rotate knob turns it", Math.abs((await bounds()).rotation) > 1, `${(await bounds()).rotation}`);
  const feather = await handle(win, "mask-feather");
  await undoCase(ctx, check, "layer mask feathered", () => settled(win, () => drag(win, feather.x, feather.y, feather.x, feather.y - 30)));
  check("the feather knob softens the edge", ((await layerIn()).masks[0].featherAmount ?? 0) > 0, `${(await layerIn()).masks[0].featherAmount}`);
  const round = await handle(win, "mask-round");
  await undoCase(ctx, check, "layer mask rounded", () => settled(win, () => drag(win, round.x, round.y, round.x + 15, round.y + 15)));
  check("the round-corner handle rounds the corners", ((await bounds()).cornerRadius ?? 0) > 0, `${(await bounds()).cornerRadius}`);
  await shot("ah-2-handles");

  // A second mask from "+": two chips, its own handles.
  await undoCase(ctx, check, "layer second mask", () => click(win, "[data-testid=mask-add-more], [aria-label='Add mask']"));
  layer = await layerIn();
  check("a second mask is on the layer", layer.masks.length === 2, `${layer.masks.length}`);
  check("and the player shows its handles", !!(await handle(win, "mask-corner")));

  // Selecting something else hides the handles.
  await win.keyboard.press("Escape");
  await at(ctx, (await layerIn()).clipId, 2.5);
  await open(win, "Adjust", "Basic");
  await win.waitForTimeout(400);
  check("with another sub-tab open the handles are gone", !(await handle(win, "mask-corner")));
  return report();
};
