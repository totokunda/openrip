// Stickers ▸ Shapes, as CapCut's (after import timeline): the tab's column (Stickers, Shapes;
// no Draw), the library's eight tiles in CapCut's order; each shape added by a click at the
// playhead with CapCut's look (saved fields, the engine's frame, ⌘Z / ⇧⌘Z); a tile dragged
// onto the timeline (at that time) and onto the player (at the playhead, where it was let go);
// the shape's inspector (CapCut's groups; Stroke, Shadow, a dashed style and an arrow cap
// changing the frame, each undone and redone); and S with a number key dragging out a
// triangle.
import { drag, engineFrame, previewRect, rulerMap, seek, settled, tab, timelineRect } from "./_preview.mjs";
import { checks, clipsWhere, savedProject, select } from "./_anim.mjs";
import { press, state, undoCase } from "./_undo.mjs";

const ORDER = ["rectangle", "ellipse", "triangle", "parallelogram", "trapezoid", "line", "arrow", "pen"];
const WORLD_H = 600;

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  const doc = () => savedProject(win, udDir);
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 1);

  // The Stickers tab's column: Stickers and Shapes (CapCut's without Yours and GIPHY).
  await win.locator("[data-testid=assets-tab-stickers]").click();
  const column = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=assets-section-]")].map((b) => b.innerText.trim()));
  check("the column is Stickers, Shapes", JSON.stringify(column) === JSON.stringify(["Stickers", "Shapes"]), JSON.stringify(column));
  await win.locator("[data-testid=assets-section-shapes]").click();
  await win.waitForTimeout(300);
  const tiles = await win.evaluate(() =>
    [...document.querySelectorAll("[data-testid=shapes-library] [data-testid^=shape-]")].map((t) => {
      const r = t.getBoundingClientRect();
      return { id: t.getAttribute("data-testid").slice(6), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), bg: getComputedStyle(t).backgroundColor };
    }),
  );
  check("eight tiles in CapCut's order", JSON.stringify(tiles.map((t) => t.id)) === JSON.stringify(ORDER), JSON.stringify(tiles.map((t) => t.id)));
  check("tiles are 86 px, #3b3b3b, 16 px apart", tiles.every((t) => t.w === 86 && t.h === 86 && t.bg === "rgb(59, 59, 59)") && tiles[1].x - tiles[0].x === 102, JSON.stringify(tiles.slice(0, 2)));
  check("rows are 30 px apart", tiles[3] && tiles[3].y - tiles[0].y === 116, `${tiles[3]?.y - tiles[0].y}`);
  await shot("sh1-library");

  // Each shape: a click adds it at the playhead, three seconds long, CapCut's look.
  const before = await doc();
  const canvas = { w: WORLD_H * (before.settings.aspectRatio.width / before.settings.aspectRatio.height), h: WORLD_H };
  const k = Math.min(canvas.w, canvas.h) / 1080;
  for (const id of ORDER.slice(0, 7)) {
    const res = await undoCase(ctx, check, `add ${id}`, () => settled(win, () => win.locator(`[data-testid=shape-${id}]`).click()));
    const added = clipsWhere({ timeline: { clips: JSON.parse(res.after.doc).clips } }, (c) => c.type === "shape" && c.shapeType === id)[0];
    if (added) {
      const t = added.transform;
      const line = id === "line" || id === "arrow";
      const side = (230400 / (canvas.w / k)) * k;
      check(
        `${id}: at the playhead, 3 s, CapCut's size in the middle`,
        Math.abs(+added.startTick / 1e6 - 1) < 0.05 && Math.abs((+added.endTick - +added.startTick) / 1e6 - 3) < 0.05 && Math.abs(t.width - side) < 0.5 && (line || Math.abs(t.height - side) < 0.5) &&
          Math.abs(t.x + t.width / 2 - canvas.w / 2) < 0.5 && Math.abs(t.y + t.height / 2 - canvas.h / 2) < 0.5,
        `${added.startTick} ${added.endTick} ${JSON.stringify(t)}`,
      );
      check(
        `${id}: CapCut's colours (${line ? "a #949494 stroke 4 px" : "a #949494 fill, stroke off"})`,
        line
          ? added.strokeEnabled === true && added.stroke === "#949494" && Math.abs(added.strokeWidth - 4 * k) < 1e-6 && added.fillEnabled === false && (id !== "arrow" || added.capEnd === "arrow")
          : added.fillEnabled === true && added.fill === "#949494" && added.strokeEnabled === false && added.shadowEnabled === false,
        JSON.stringify({ fill: added.fill, fe: added.fillEnabled, se: added.strokeEnabled, s: added.stroke, w: added.strokeWidth, cap: added.capEnd }),
      );
    } else check(`${id}: added`, false);
    if (id === "parallelogram" || id === "arrow") await shot(`sh2-${id}`);
    // Take it away again, so the next shape changes the frame on its own.
    await press(win, "Meta+z");
    await state(ctx, Date.now() - 400);
  }

  // A tile dragged onto the timeline: at the time it's let go.
  const tl = await timelineRect(win);
  const arrowTile = await win.locator("[data-testid=shape-arrow]").boundingBox();
  const shapes0 = clipsWhere(await doc(), (c) => c.type === "shape").length;
  await settled(win, () => drag(win, arrowTile.x + 43, arrowTile.y + 43, ctx.map.x(2), tl.y + tl.h * 0.35));
  let d = await doc();
  const dropped = clipsWhere(d, (c) => c.type === "shape" && c.shapeType === "arrow");
  check("an arrow dragged onto the timeline starts where it's let go", dropped.length === 1 && Math.abs(+dropped[0].startTick / 1e6 - 2) < 0.1 && clipsWhere(d, (c) => c.type === "shape").length === shapes0 + 1, dropped[0]?.startTick);
  await press(win, "Meta+z");
  await state(ctx, Date.now() - 400);

  // A tile dragged onto the player: at the playhead, its middle where it's let go.
  const p = await previewRect(win);
  const rectTile = await win.locator("[data-testid=shape-rectangle]").boundingBox();
  const rectsBefore = new Set(clipsWhere(await doc(), (c) => c.shapeType === "rectangle").map((c) => c.clipId));
  await settled(win, () => drag(win, rectTile.x + 43, rectTile.y + 43, p.x + p.w * 0.7, p.y + p.h * 0.5));
  d = await doc();
  const onPlayer = clipsWhere(d, (c) => c.type === "shape" && c.shapeType === "rectangle" && !rectsBefore.has(c.clipId))[0];
  check(
    "a rectangle dragged onto the player: at the playhead, right of the middle",
    onPlayer && Math.abs(+onPlayer.startTick / 1e6 - 1) < 0.05 && onPlayer.transform.x + onPlayer.transform.width / 2 > canvas.w / 2 + 20,
    onPlayer ? `${onPlayer.startTick} ${JSON.stringify(onPlayer.transform)}` : "none",
  );
  await shot("sh3-dropped-on-player");

  // Its inspector: CapCut's Shapes tab and groups.
  await select(ctx, d, onPlayer.clipId);
  const tabs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((t) => t.innerText.trim()));
  check("a shape's inspector has CapCut's Shapes tab", tabs[0] === "Shapes", JSON.stringify(tabs));
  const groups = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=shape-group-]")].map((g) => g.getAttribute("data-testid").slice(12)));
  check("groups: Transform, Fill, Stroke, Corner radius, Shadow", JSON.stringify(groups) === JSON.stringify(["transform", "fill", "stroke", "corner", "shadow"]), JSON.stringify(groups));
  await shot("sh4-inspector");
  await undoCase(ctx, check, "Stroke on", () => settled(win, () => win.locator("[data-testid=shape-check-stroke]").click()));
  d = await doc();
  check("the stroke is saved on", clipsWhere(d, (c) => c.clipId === onPlayer.clipId)[0]?.strokeEnabled === true);
  await undoCase(ctx, check, "dashed stroke", async () => {
    await win.locator("[data-testid=shape-stroke-style]").click();
    await win.waitForTimeout(200);
    await settled(win, () => win.getByRole("option", { name: "Dashed" }).click());
  });
  await undoCase(ctx, check, "Shadow on", () => settled(win, () => win.locator("[data-testid=shape-check-shadow]").scrollIntoViewIfNeeded().then(() => win.locator("[data-testid=shape-check-shadow]").click())));
  await undoCase(ctx, check, "Corner radius on", () => settled(win, () => win.locator("[data-testid=shape-check-corner]").scrollIntoViewIfNeeded().then(() => win.locator("[data-testid=shape-check-corner]").click())));
  d = await doc();
  const styled = clipsWhere(d, (c) => c.clipId === onPlayer.clipId)[0];
  check("dashes, shadow and corners saved", styled?.strokeStyle === "dashed" && styled?.shadowEnabled === true && styled?.transform.cornerRadius > 0, JSON.stringify({ s: styled?.strokeStyle, sh: styled?.shadowEnabled, r: styled?.transform.cornerRadius }));
  await shot("sh5-styled");

  // A line's inspector: no Fill, its caps; an arrow at its end.
  await win.locator("[data-testid=assets-tab-stickers]").click();
  await win.locator("[data-testid=assets-section-shapes]").click();
  await settled(win, () => win.locator("[data-testid=shape-line]").click());
  await win.waitForTimeout(500);
  const lineGroups = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=shape-group-]")].map((g) => g.getAttribute("data-testid").slice(12)));
  check("a line has no Fill or Corner radius", JSON.stringify(lineGroups) === JSON.stringify(["transform", "stroke", "shadow"]), JSON.stringify(lineGroups));
  check("a line has Start and End caps", (await win.locator("[data-testid=shape-cap-start]").count()) === 1 && (await win.locator("[data-testid=shape-cap-end]").count()) === 1);
  await undoCase(ctx, check, "line's end cap Arrow", async () => {
    await win.locator("[data-testid=shape-cap-end]").click();
    await win.waitForTimeout(200);
    await settled(win, () => win.getByRole("option", { name: "Arrow" }).click());
  });
  await shot("sh6-line-arrow-cap");

  // S, then 3: the triangle dragged out on the canvas.
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("s");
  await win.keyboard.press("3");
  await win.waitForTimeout(200);
  const chip = (await win.locator("[data-testid=tool-chip]").count()) ? await win.locator("[data-testid=tool-chip]").innerText() : "";
  check("S then 3 picks the triangle", /triangle/.test(chip), chip);
  const tri0 = clipsWhere(await doc(), (c) => c.shapeType === "triangle").length;
  await settled(win, () => drag(win, p.x + p.w * 0.25, p.y + p.h * 0.25, p.x + p.w * 0.4, p.y + p.h * 0.45));
  await win.keyboard.press("v");
  d = await doc();
  check("the drag makes a triangle", clipsWhere(d, (c) => c.shapeType === "triangle").length === tri0 + 1);
  check("the engine draws the shapes", (await engineFrame(win)).w > 16);
  await shot("sh7-s-tool");
  return report();
};
