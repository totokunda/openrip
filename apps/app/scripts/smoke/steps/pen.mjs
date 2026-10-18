// The Stickers tab's Pen, CapCut's custom shape (after import timeline): the Pen tile starts a
// "Shape to draw" (CapCut's dimmed canvas and "Click to start drawing", the inspector's note);
// three clicks and a press dragged into a smooth point, then a click on the first point,
// close the path (saved points and handles, the engine's frame, ⌘Z / ⇧⌘Z taking the whole
// shape away and back); a double-click shows its points: one dragged, one added on the
// outline, one deleted, each undone and redone; a second path finished open by a
// double-click gets an arrow at its end from the inspector's Cap; Esc with one point leaves
// nothing.
import { drag, engineFrame, previewRect, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, clipsWhere, savedProject } from "./_anim.mjs";
import { press, state, undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  const doc = () => savedProject(win, udDir);
  const pens = (d) => clipsWhere(d, (c) => c.type === "shape" && c.shapeType === "path");
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 1);
  await win.locator("[data-testid=assets-tab-stickers]").click();
  await win.locator("[data-testid=assets-section-shapes]").click();
  const p = await previewRect(win);
  const at = (fx, fy) => [p.x + p.w * fx, p.y + p.h * fy];
  const toast = win.locator("[data-testid=pen-toast]");

  // The Pen tile: the shape to draw, CapCut's prompt and the inspector's note.
  const s0 = await state(ctx);
  await win.locator("[data-testid=shape-pen]").click();
  await win.waitForTimeout(600);
  check("the Pen dims the canvas and says Click to start drawing", (await toast.count()) === 1 && /Click to start drawing/.test(await toast.innerText()), (await toast.count()) ? await toast.innerText() : "no toast");
  check("the inspector says the shape is being drawn", /Double-click the preview area to finish drawing/.test(await win.locator("[data-testid=shape-drawing]").innerText().catch(() => "")));
  let d = await doc();
  check("a Shape to draw is on the timeline", pens(d).some((c) => c.penDrawing), JSON.stringify(pens(d).map((c) => c.penDrawing)));
  await shot("pen1-start");

  // Three corners, a smooth point pulled out by a drag, then a click on the first point.
  const pts = [at(0.35, 0.3), at(0.65, 0.32), at(0.62, 0.62)];
  for (const [x, y] of pts) {
    await win.mouse.click(x, y);
    await win.waitForTimeout(450);
  }
  check("the prompt goes with the first point", (await toast.getAttribute("data-started")) === "1");
  const [sx, sy] = at(0.36, 0.6);
  await drag(win, sx, sy, sx - p.w * 0.08, sy - p.h * 0.05);
  await win.waitForTimeout(450);
  await shot("pen2-drawing");
  await settled(win, () => win.mouse.click(pts[0][0], pts[0][1]));
  const s1 = await state(ctx, Date.now() - 400);
  d = await doc();
  const shape = pens(d)[0];
  check(
    "a click on the first point closes the path: four points, the last smooth",
    shape && !shape.penDrawing && shape.pathClosed === true && shape.path?.length === 4 && !!(shape.path[3].outX || shape.path[3].outY) && !(shape.path[0].outX || shape.path[0].inX),
    JSON.stringify(shape?.path),
  );
  check("the finished shape: a #CCCCCC stroke, its fill off (CapCut's pen)", shape?.strokeEnabled === true && shape?.stroke === "#CCCCCC" && shape?.fillEnabled === false);
  check("the engine draws it", s1.frame !== s0.frame);
  check("the pen's prompt and note are gone", (await toast.count()) === 0 && (await win.locator("[data-testid=shape-drawing]").count()) === 0);
  await shot("pen3-closed");
  // The whole shape is one step: ⌘Z takes it away, ⇧⌘Z brings it back.
  await press(win, "Meta+z");
  const s2 = await state(ctx, Date.now() - 400);
  await press(win, "Meta+Shift+z");
  const s3 = await state(ctx, Date.now() - 400);
  check("⌘Z takes the drawn shape away, ⇧⌘Z brings it back", s2.doc === s0.doc && s2.frame === s0.frame && s3.doc === s1.doc && s3.frame === s1.frame, `undo ${s2.doc === s0.doc}/${s2.frame === s0.frame}, redo ${s3.doc === s1.doc}/${s3.frame === s1.frame}`);

  // A double-click on it shows its points; the first dragged, a point added on the first edge,
  // the added one deleted.
  const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
  const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
  await win.mouse.dblclick(cx, cy);
  await win.waitForTimeout(500);
  const editing = () => win.locator("[data-testid=pen-editing]").count();
  check("a double-click on the pen shape shows its points", (await editing()) === 1);
  await shot("pen4-editing");
  const path0 = (await doc()) && pens(await doc())[0].path;
  await undoCase(ctx, check, "a point dragged", () => settled(win, () => drag(win, pts[0][0], pts[0][1], pts[0][0] - p.w * 0.06, pts[0][1] - p.h * 0.04)));
  d = await doc();
  check("the dragged point moved, the others stayed", pens(d)[0].path.length === 4 && JSON.stringify(pens(d)[0].path) !== JSON.stringify(path0));
  check("its points still show after ⌘Z and ⇧⌘Z", (await editing()) === 1);
  await shot("pen4b-dragged");
  // The first edge is now from the moved point to the second: a click on its middle.
  const moved = [pts[0][0] - p.w * 0.06, pts[0][1] - p.h * 0.04];
  await undoCase(ctx, check, "a point added on the outline", () => settled(win, () => win.mouse.click((moved[0] + pts[1][0]) / 2, (moved[1] + pts[1][1]) / 2)));
  d = await doc();
  check("the outline has five points", pens(d)[0].path.length === 5, String(pens(d)[0].path.length));
  await undoCase(ctx, check, "the selected point deleted", () => press(win, "Delete"));
  d = await doc();
  check("Delete leaves four points and the shape", pens(d).length === 1 && pens(d)[0].path.length === 4, String(pens(d)[0]?.path?.length));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // A second path finished open by a double-click; an arrow at its end from the inspector.
  await win.locator("[data-testid=shape-pen]").click();
  await win.waitForTimeout(500);
  const open = [at(0.3, 0.75), at(0.5, 0.7)];
  for (const [x, y] of open) {
    await win.mouse.click(x, y);
    await win.waitForTimeout(450);
  }
  const [ex, ey] = at(0.7, 0.78);
  await settled(win, () => win.mouse.dblclick(ex, ey));
  await state(ctx, Date.now() - 400);
  d = await doc();
  const second = pens(d).find((c) => c.clipId !== shape.clipId);
  check("a double-click finishes the path open", second && second.pathClosed === false && second.path.length === 3 && !second.penDrawing, JSON.stringify({ closed: second?.pathClosed, n: second?.path?.length }));
  check("an open path has Start and End caps", (await win.locator("[data-testid=shape-cap-end]").count()) === 1);
  await undoCase(ctx, check, "the open path's end cap Arrow", async () => {
    await win.locator("[data-testid=shape-cap-end]").click();
    await win.waitForTimeout(200);
    await settled(win, () => win.getByRole("option", { name: "Arrow" }).click());
  });
  await shot("pen5-open-arrow");

  // Esc with a single point: nothing is left.
  const before = await state(ctx);
  await win.locator("[data-testid=shape-pen]").click();
  await win.waitForTimeout(500);
  const [ox, oy] = at(0.5, 0.5);
  await win.mouse.click(ox, oy);
  await win.waitForTimeout(400);
  await win.keyboard.press("Escape");
  const after = await state(ctx, Date.now() - 400);
  check("Esc with one point leaves nothing", after.doc === before.doc && (await toast.count()) === 0);
  check("the engine still draws", (await engineFrame(win)).w > 16);
  return report();
};
