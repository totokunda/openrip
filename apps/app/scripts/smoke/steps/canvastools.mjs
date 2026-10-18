// The canvas tools with no tool row on the player (after import timeline): the player's
// header holds only its name and its menu; the menu's zoom; Stickers ▸ Shapes adding a star at
// the playhead; Stickers ▸ Draw's pen drawing a clip, with the tool chip and Esc; T and V; and
// the Mask tab's picker starting a rectangle mask dragged on the clip.
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

  // The menu's zoom.
  await win.locator("[data-testid=player-menu]").click();
  await win.locator("[data-testid=player-zoom-200]").click();
  await win.waitForTimeout(300);
  await win.locator("[data-testid=player-menu]").click();
  const zoom = (await win.locator("[data-testid=player-zoom]").innerText()).trim();
  check("menu zooms to 200%", zoom === "200%", zoom);
  await shot("ct1-player-menu");
  await win.locator("[data-testid=player-zoom-fit]").click();
  await win.waitForTimeout(300);

  // Stickers ▸ Shapes: a star at the playhead.
  const before = await savedProject(win, udDir);
  const shapes0 = clipsWhere(before, (c) => c.type === "shape").length;
  await win.locator("[data-testid=assets-tab-stickers]").click();
  await win.locator("[data-testid=assets-section-shapes]").click();
  await settled(win, () => win.locator("[data-testid=shape-star]").click());
  let doc = await savedProject(win, udDir);
  const stars = clipsWhere(doc, (c) => c.type === "shape" && c.shapeType === "star");
  check("Shapes adds a star", clipsWhere(doc, (c) => c.type === "shape").length === shapes0 + 1 && stars.length === 1, `${stars.length} star(s)`);
  check("the star starts at the playhead", stars[0] && Math.abs(+stars[0].startTick / 1e6 - 1) < 0.05, stars[0]?.startTick);
  await shot("ct2-shape");

  // Stickers ▸ Draw: the pen, the chip, a stroke, Esc.
  await win.locator("[data-testid=assets-section-draw]").click();
  await win.locator("[data-testid=draw-brush]").click();
  check("Pen turns the draw tool on", (await chipTool()) === "draw", await chipTool());
  const p = await previewRect(win);
  const draws0 = clipsWhere(doc, (c) => c.type === "draw").length;
  await settled(win, () => drag(win, p.x + p.w * 0.3, p.y + p.h * 0.3, p.x + p.w * 0.6, p.y + p.h * 0.5));
  await shot("ct3-draw");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(200);
  check("Esc stops drawing", (await chipTool()) === null, await chipTool());
  doc = await savedProject(win, udDir);
  check("the stroke is a drawing clip", clipsWhere(doc, (c) => c.type === "draw").length >= Math.max(1, draws0), String(clipsWhere(doc, (c) => c.type === "draw").length));

  // T and V still pick text and select.
  await win.keyboard.press("t");
  await win.waitForTimeout(150);
  check("T picks text", (await chipTool()) === "text", await chipTool());
  await win.keyboard.press("v");
  await win.waitForTimeout(150);
  check("V goes back to select", (await chipTool()) === null, await chipTool());

  // The Mask tab's picker: a rectangle dragged on the video.
  const video = clipsWhere(doc, (c) => c.type === "video" || c.type === "image")[0];
  await select(ctx, doc, video.clipId);
  await tab(win, "Mask");
  await win.locator("[data-testid=add-mask-rectangle]").click();
  check("Rectangle turns the mask tool on", (await chipTool()) === "mask", await chipTool());
  await settled(win, () => drag(win, p.x + p.w * 0.35, p.y + p.h * 0.35, p.x + p.w * 0.65, p.y + p.h * 0.65));
  await shot("ct4-mask");
  await win.locator("[data-testid=tool-chip-done]").click();
  await win.waitForTimeout(200);
  check("Done goes back to select", (await chipTool()) === null, await chipTool());
  doc = await savedProject(win, udDir);
  const masks = doc.timeline.clips.find((c) => c.clipId === video.clipId)?.masks ?? [];
  check("the video has a rectangle mask", masks.length >= 1 && masks.some((m) => m.tool === "shape"), JSON.stringify(masks.map((m) => m.tool)));
  return report();
};
