// Video ▸ Mask (after import timeline; CLIP_NAME for a photo): a rectangle added from its tile
// (the engine draws it), moved by its handles on the canvas, its position, rotation, size,
// feather and round corners typed, inverted, then each of CapCut's other shapes; its pose keyed
// at two times; a second mask from "+"; None taking one off; Pen bringing out the lasso. Each
// edit undone and redone with the engine's frame and the saved project compared (undoCase).
import { drag, previewRect, settled } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { at, click, keyCase, mediaClip, open, savedClip, typeIn } from "./_inspector.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  const clip = await mediaClip(ctx);
  const id = clip.clipId;
  const tab = () => open(win, "Video", "Mask");
  const T = 1.5;
  await at(ctx, id, T);
  await tab();
  const run = async (name, edit, opts) => {
    try {
      const r = await undoCase(ctx, check, name, edit, opts);
      if (!r.ok) await shot(`im-fail-${name.replace(/\W+/g, "-")}`);
    } catch (e) {
      check(name, false, e.message.split("\n")[0]);
      await shot(`im-fail-${name.replace(/\W+/g, "-")}`);
    }
  };
  const masks = async () => (await savedClip(ctx, id)).masks ?? [];
  const pose = (m) => Object.values(m.keyframes)[0];

  await run("rectangle mask added", () => click(win, "[data-testid=mask-shape-rectangle]"));
  const [m0] = await masks();
  check(
    "a static rectangle centred on the picture, the clip inside and nothing outside",
    m0?.tool === "shape" && pose(m0)?.shapeBounds?.shapeType === "rectangle" && Object.keys(m0.keyframes).length === 1 && !m0.maskColorEnabled && m0.backgroundColorEnabled && m0.backgroundOpacity === 0,
    JSON.stringify(m0?.keyframes),
  );
  await shot("im-0-rectangle");

  // Its handles on the canvas: dragged from its middle (the picture's) up and left.
  const p = await previewRect(win);
  const mid = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  await run("mask dragged on the canvas", () => settled(win, () => drag(win, mid.x, mid.y, mid.x - 30, mid.y - 40)));
  const moved = pose((await masks())[0]).shapeBounds;
  check("the drag moved the mask's one pose", moved && (moved.x !== pose(m0).shapeBounds.x || moved.y !== pose(m0).shapeBounds.y) && Object.keys((await masks())[0].keyframes).length === 1, JSON.stringify(moved));

  await run("mask position", () => typeIn(win, "Position", 60));
  await run("mask rotation", () => typeIn(win, "Rotation", 25));
  await run("mask size", () => typeIn(win, "Size", 300));
  await run("mask feather", () => typeIn(win, "Feather", 40));
  await run("round corners", () => typeIn(win, "Round corners", 70));
  await run("invert", () => click(win, "[data-testid=mask-invert]"));
  await shot("im-1-settings");
  const m1 = (await masks())[0];
  check("the settings are saved", m1.featherAmount === 40 && m1.inverted === true && pose(m1).shapeBounds.cornerRadius === 70 && Math.abs(pose(m1).shapeBounds.rotation - 25) < 1e-6, JSON.stringify({ feather: m1.featherAmount, inverted: m1.inverted, bounds: pose(m1).shapeBounds }));
  await run("invert back", () => click(win, "[data-testid=mask-invert]"));

  // CapCut's other shapes, each drawn differently.
  for (const s of ["ellipse", "linear", "mirror", "star", "heart"]) {
    await run(`shape ${s}`, () => click(win, `[data-testid=mask-shape-${s}]`));
    await shot(`im-2-${s}`);
  }

  // The pose keyed at 1 s and moved at 4 s.
  await keyCase(ctx, check, "mask pose", { id, row: "Position", t1: 1, t2: 4, reopen: tab, undoCase, set2: () => typeIn(win, "Position", -80) });
  const keyed = (await masks())[0];
  check("the mask keeps two poses", Object.keys(keyed.keyframes).length === 2 && keyed.keyed === true, JSON.stringify(Object.keys(keyed.keyframes)));

  // A second mask from "+", then None takes it off.
  await at(ctx, id, T);
  await tab();
  // The engine paints outside the first mask only (as the app's masks always did), so a
  // second one changes the project, not the picture.
  await run(
    "a second mask",
    async () => {
      await click(win, "[data-testid=mask-add]");
      await click(win, "[data-testid=mask-shape-ellipse]");
    },
    { frame: false },
  );
  check("two masks, two chips", (await masks()).length === 2 && (await win.locator("[data-testid^=mask-chip-]").count()) === 2);
  await run("None takes the selected mask off", () => click(win, "[data-testid=mask-shape-none]"));
  check("one mask left", (await masks()).length === 1);

  // Pen: the canvas's lasso; an outline drawn round the picture's middle is a new mask, and the
  // pointer comes back with it selected.
  const outline = async (pts) => {
    await win.mouse.move(pts[0][0], pts[0][1]);
    await win.mouse.down();
    for (const [x, y] of pts.slice(1)) await win.mouse.move(x, y, { steps: 6 });
    await win.mouse.up();
  };
  const r = Math.min(p.w, p.h) * 0.12;
  const around = Array.from({ length: 9 }, (_, i) => [mid.x + r * Math.cos((i / 8) * 2 * Math.PI), mid.y + r * Math.sin((i / 8) * 2 * Math.PI)]);
  const tools = () => win.evaluate(async () => {
    const { useViewportStore } = await import("/src/lib/viewport.ts");
    const { useMaskStore } = await import("/src/lib/mask/index.ts");
    return `${useViewportStore.getState().tool}/${useMaskStore.getState().tool}`;
  }).catch(() => "?");
  // (The engine paints outside the first mask only: each starts on a clip without masks.)
  await click(win, "[data-testid=mask-shape-none]");
  await click(win, "[data-testid=mask-shape-lasso]");
  const penTool = await tools();
  await run("a mask drawn with Pen", () => settled(win, () => outline(around)));
  const afterPen = await masks();
  check("Pen draws a lasso mask and the pointer comes back", penTool === "mask/lasso" && afterPen.some((m) => m.tool === "lasso") && (await tools()).startsWith("pointer"), `${penTool} → ${await tools()}; ${afterPen.map((m) => m.tool)}`);

  // Brush: the canvas's brush; a stroke across the middle is a brush mask, a second stroke goes
  // on the same mask; Done brings the pointer back.
  await click(win, "[data-testid=mask-shape-none]");
  await click(win, "[data-testid=mask-shape-brush]");
  const brushTool = await tools();
  await run("a brush stroke", () => settled(win, () => drag(win, mid.x - r, mid.y, mid.x + r, mid.y)));
  await run("a second brush stroke on the same mask", () => settled(win, () => drag(win, mid.x, mid.y - r, mid.x, mid.y + r)));
  const brushed = (await masks()).filter((m) => m.tool === "draw");
  check(
    "Brush paints strokes onto one brush mask",
    brushTool === "mask/draw" && brushed.length === 1 && Object.values(brushed[0].keyframes)[0].brushStrokes?.length === 2,
    `${brushTool}; ${brushed.length} brush masks, ${brushed[0] && Object.values(brushed[0].keyframes)[0].brushStrokes?.length} strokes`,
  );
  // The canvas's tool chip ends the brush.
  await win.locator("[data-testid=tool-chip-done]").click();
  await win.waitForTimeout(300);
  check("Done brings the pointer back", (await tools()).startsWith("pointer"), await tools());
  return report();
};
