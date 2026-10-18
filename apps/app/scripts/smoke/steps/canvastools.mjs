// The canvas tools with no tool row on the player (after import timeline): the player's
// header holds only its name and its menu; the zoom popover; Stickers ▸ Shapes adding a
// rectangle at the playhead; no freehand drawing (CapCut has none: no Draw section, D does
// nothing); T and V; and the Mask tab's Rectangle
// adding a mask and its Brush painting one, ended by the chip.
import { drag, previewRect, rulerMap, seek, settled, tab } from "./_preview.mjs";
import { checks, clipsWhere, savedProject, select } from "./_anim.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  const chip = () => win.locator("[data-testid=tool-chip]");
  const chipTool = async () => ((await chip().count()) ? await chip().getAttribute("data-tool") : null);
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 1);

  // The header: the name and the menu, nothing else to click.
  const headerButtons = await win.evaluate(() => {
    const player = document.querySelector("[data-testid=player]");
    const header = player?.firstElementChild;
    return header ? [...header.querySelectorAll("button")].map((b) => b.getAttribute("data-testid") || b.title || b.innerText) : null;
  });
  check("player header has only its menu", JSON.stringify(headerButtons) === JSON.stringify(["player-menu"]), JSON.stringify(headerButtons));

  // The zoom popover under the player (CapCut's; the header menu has no zoom).
  const zoom = async () => +(await win.locator("[data-testid=zoom-slider]").getAttribute("data-zoom"));
  await win.locator("[data-testid=zoom-button]").click();
  await win.waitForTimeout(300);
  for (let i = 0; i < 5; i++) await win.locator("[data-testid=zoom-in]").click();
  await win.waitForTimeout(300);
  check("the zoom popover zooms to 150% of fit", Math.abs((await zoom()) - 1.5) < 0.01, String(await zoom()));
  await shot("ct1-player-zoom");
  for (let i = 0; i < 5; i++) await win.locator("[data-testid=zoom-out]").click();
  await win.waitForTimeout(300);
  check("and back to fit", Math.abs((await zoom()) - 1) < 0.01, String(await zoom()));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(200);

  // Stickers ▸ Shapes: a rectangle at the playhead (the tile's +).
  const before = await savedProject(win, udDir);
  const shapes0 = clipsWhere(before, (c) => c.type === "shape").length;
  await win.locator("[data-testid=assets-tab-stickers]").click();
  check("no Draw section in the Stickers tab", (await win.locator("[data-testid=assets-section-draw]").count()) === 0);
  await win.locator("[data-testid=assets-section-shapes]").click();
  await win.mouse.move(5, 5);
  await win.locator("[data-testid=shape-rectangle]").hover();
  await settled(win, () => win.locator("[data-testid=shape-add-rectangle]").click());
  let doc = await savedProject(win, udDir);
  const known = new Set(clipsWhere(before, (c) => c.type === "shape").map((c) => c.clipId));
  const rects = clipsWhere(doc, (c) => c.type === "shape" && c.shapeType === "rectangle" && !known.has(c.clipId));
  check("Shapes adds a rectangle", clipsWhere(doc, (c) => c.type === "shape").length === shapes0 + 1 && rects.length === 1, `${rects.length} new rectangle(s)`);
  check("the rectangle starts at the playhead", rects[0] && Math.abs(+rects[0].startTick / 1e6 - 1) < 0.05, rects[0]?.startTick);
  await shot("ct2-shape");

  // No freehand drawing: D turns nothing on.
  const p = await previewRect(win);
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("d");
  await win.waitForTimeout(200);
  check("D turns no tool on", (await chipTool()) === null, await chipTool());
  doc = await savedProject(win, udDir);
  check("there are no drawing clips", clipsWhere(doc, (c) => c.type === "draw").length === 0, String(clipsWhere(doc, (c) => c.type === "draw").length));

  // T and V still pick text and select.
  await win.keyboard.press("t");
  await win.waitForTimeout(150);
  check("T picks text", (await chipTool()) === "text", await chipTool());
  await win.keyboard.press("v");
  await win.waitForTimeout(150);
  check("V goes back to select", (await chipTool()) === null, await chipTool());

  // The Mask tab: Add mask puts a rectangle mask on the video at once (as CapCut's); "+" adds
  // a second, whose Brush tile turns the canvas's mask brush on, a stroke is painted, the
  // chip's Done ends it.
  const video = clipsWhere(doc, (c) => c.type === "video" || c.type === "image")[0];
  await select(ctx, doc, video.clipId);
  await tab(win, "Mask");
  await settled(win, () => win.locator("[data-testid=mask-add]").click());
  check("Add mask adds a mask without a tool", (await chipTool()) === null, await chipTool());
  await settled(win, () => win.locator("[data-testid=mask-add]").click());
  await win.locator("[data-testid=mask-shape-brush]").click();
  await win.waitForTimeout(200);
  check("Brush turns the mask tool on", (await chipTool()) === "mask", await chipTool());
  await settled(win, () => drag(win, p.x + p.w * 0.35, p.y + p.h * 0.35, p.x + p.w * 0.65, p.y + p.h * 0.65));
  await shot("ct4-mask");
  await win.locator("[data-testid=tool-chip-done]").click();
  await win.waitForTimeout(200);
  check("Done goes back to select", (await chipTool()) === null, await chipTool());
  doc = await savedProject(win, udDir);
  const masks = doc.timeline.clips.find((c) => c.clipId === video.clipId)?.masks ?? [];
  check("the video has a rectangle mask and a brush mask", masks.some((m) => m.tool === "shape") && masks.some((m) => m.tool === "draw"), JSON.stringify(masks.map((m) => m.tool)));
  return report();
};
