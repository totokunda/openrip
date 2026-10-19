// Video ▸ Mask (after import timeline; CLIP_NAME for a photo), as CapCut's: the tiles in its
// order, greyed until there's a mask; Add mask (a rectangle, the engine draws it), moved and
// shaped by its handles on the canvas (body, a corner, the feather knob above, the rotate knob
// below, the round-corner handle), its position, rotation, size, feather and round corners
// typed, inverted, the section's checkbox switching the masks off and on; the tiles giving it
// CapCut's other shapes, Filmstrip's band dragged wider; its pose keyed at two times; a second
// mask from "+" made a circle, each deleted by its chip's ×; a Text mask with its words, bold,
// size and spacing; the Pen tile and a path clicked out and closed, its anchor dragged, its
// feather and expansion; the Brush tile, strokes, the eraser, expansion and Clear. Each edit
// undone and redone with the engine's frame and the saved project compared (undoCase).
import { drag, previewRect, settled } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { at, click, keyCase, mediaClip, open, savedClip, typeIn } from "./_inspector.mjs";

// A mask handle on the player's canvas by its Konva name (MaskHandles), in window pixels: a
// line's middle, else its box's.
const handle = (win, name, i = 0) =>
  win.evaluate(
    ([name, i]) => {
      for (const stage of window.Konva?.stages ?? []) {
        if (!stage.container().closest("[data-testid=player]")) continue;
        const n = stage.find(`.${name}`).filter((x) => x.isVisible())[i];
        if (!n) continue;
        const box = stage.container().getBoundingClientRect();
        let p;
        if (n.getClassName() === "Line") {
          const q = n.points();
          p = n.getAbsoluteTransform().point({ x: (q[0] + q[q.length - 2]) / 2, y: (q[1] + q[q.length - 1]) / 2 });
        } else {
          const r = n.getClientRect({ skipShadow: true, skipStroke: true });
          p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        return { x: box.x + p.x, y: box.y + p.y };
      }
      return null;
    },
    [name, i],
  );

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
  const bounds = async (i = 0) => pose((await masks())[i]).shapeBounds;
  const dragHandle = async (name, dx, dy, i = 0) => {
    const h = await handle(win, name, i);
    if (!h) throw new Error(`no ${name} handle`);
    await settled(win, () => drag(win, h.x, h.y, h.x + dx, h.y + dy));
  };

  // Delete the i-th mask by its chip's ×.
  const remove = async (i) => {
    await win.locator(`[data-testid=mask-chip-${i}]`).hover();
    await settled(win, () => win.locator(`[aria-label="Delete mask ${i + 1}"]`).click());
  };

  const tiles = await win.locator("[data-testid=mask-panel] [data-testid^=mask-shape-]").evaluateAll((els) => els.map((e) => `${e.innerText.trim()}${e.disabled ? "" : "!"}`));
  check("the tiles in CapCut's order, greyed until there's a mask", tiles.join(",") === "Split,Filmstrip,Circle,Rectangle,Stars,Heart,Text,Brush,Pen", tiles.join(","));
  await shot("im-0-empty");

  await run("Add mask", () => click(win, "[data-testid=mask-add]"));
  const [m0] = await masks();
  check(
    "a static rectangle centred on the picture, the clip inside and nothing outside",
    m0?.tool === "shape" && pose(m0)?.shapeBounds?.shapeType === "rectangle" && Object.keys(m0.keyframes).length === 1 && !m0.maskColorEnabled && m0.backgroundColorEnabled && m0.backgroundOpacity === 0,
    JSON.stringify(m0?.keyframes),
  );
  const chip = await win.locator("[data-testid=mask-chip-0]").boundingBox();
  check("the mask's chip is 24 px tall", chip && Math.round(chip.height) === 24, JSON.stringify(chip));
  await shot("im-0-rectangle");

  // CapCut's handles on the canvas: dragged from its middle (the picture's) up and left, then
  // a corner out, the feather knob up, the rotate knob round and the round-corner handle in.
  const p = await previewRect(win);
  const mid = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  await run("mask dragged on the canvas", () => settled(win, () => drag(win, mid.x, mid.y, mid.x - 30, mid.y - 40)));
  const moved = await bounds();
  check("the drag moved the mask's one pose", moved && (moved.x !== pose(m0).shapeBounds.x || moved.y !== pose(m0).shapeBounds.y) && Object.keys((await masks())[0].keyframes).length === 1, JSON.stringify(moved));
  await run("a corner handle dragged out", () => dragHandle("mask-corner", 25, 20, 2));
  const grown = await bounds();
  check("the corner made it bigger", grown.width > moved.width && grown.height > moved.height, `${moved.width}×${moved.height} → ${grown.width}×${grown.height}`);
  await run("the feather knob dragged up", () => dragHandle("mask-feather", 0, -30));
  check("the knob feathered the mask", ((await masks())[0].featherAmount ?? 0) > 0, `feather ${(await masks())[0].featherAmount}`);
  await run("the rotate knob dragged round", async () => {
    const r = await handle(win, "mask-rotate");
    await settled(win, () => drag(win, r.x, r.y, r.x - 40, r.y - 10));
  });
  check("the knob turned the mask", Math.abs((await bounds()).rotation ?? 0) > 1, `rotation ${(await bounds()).rotation}`);
  await shot("im-0-handles");

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
  // The section's checkbox: the masks stay, the engine draws none; then on again.
  await run("masks switched off", () => click(win, "[data-testid=section-mask] [role=checkbox]"));
  check("switched off, the masks stay", (await savedClip(ctx, id)).masksOff === true && (await masks()).length === 1);
  await shot("im-1-off");
  await run("masks switched on", () => click(win, "[data-testid=section-mask] [role=checkbox]"));
  // Round corners: its handle on the canvas, dragged back out toward the corner.
  await run("the round-corner handle dragged", () => dragHandle("mask-round", -15, -15));
  check("the handle changed the round corners", (await bounds()).cornerRadius < 70, `corners ${(await bounds()).cornerRadius}`);

  // CapCut's other shapes, each drawn differently.
  for (const s of ["circle", "linear", "mirror", "star", "heart"]) {
    await run(`shape ${s}`, () => click(win, `[data-testid=mask-shape-${s}]`));
    await shot(`im-2-${s}`);
    if (s === "linear") check("Split has no size", (await win.locator("[data-testid=mask-panel] label", { hasText: /^Size$/ }).count()) === 0);
    if (s === "mirror") {
      const h0 = (await bounds()).height;
      await run("Filmstrip's band dragged wider", () => dragHandle("mask-band", 0, -20, 0));
      check("the band's line widened Filmstrip", (await bounds()).height > h0, `${h0} → ${(await bounds()).height}`);
    }
  }

  // The pose keyed at 1 s and moved at 4 s.
  await keyCase(ctx, check, "mask pose", { id, row: "Position", t1: 1, t2: 4, reopen: tab, undoCase, set2: () => typeIn(win, "Position", -80) });
  const keyed = (await masks())[0];
  check("the mask keeps two poses", Object.keys(keyed.keyframes).length === 2 && keyed.keyed === true, JSON.stringify(Object.keys(keyed.keyframes)));

  // A second mask from "+" (a rectangle; the engine cuts the clip to both), made a circle, then
  // each taken off by its chip's ×.
  await at(ctx, id, T);
  await tab();
  await run("a second mask", () => click(win, "[data-testid=mask-add]"));
  const two = await masks();
  check("two masks, two chips, the new one a rectangle", two.length === 2 && pose(two[1]).shapeBounds?.shapeType === "rectangle" && (await win.locator("[data-testid^=mask-chip-]").count()) === 2);
  await run("the second mask made a circle", async () => {
    await win.locator("[data-testid=mask-chip-1]").click();
    await click(win, "[data-testid=mask-shape-circle]");
  });
  check("the tile shaped the selected (second) mask", pose((await masks())[1]).shapeBounds?.shapeType === "circle" && pose((await masks())[0]).shapeBounds?.shapeType === "heart");
  await shot("im-2-two");
  await run("the second mask deleted", () => remove(1));
  check("one mask left", (await masks()).length === 1);
  await run("the last mask deleted", () => remove(0));
  check("no masks: Add mask again", (await masks()).length === 0 && (await win.locator("[data-testid=mask-add]").innerText()).includes("Add mask"));

  // Text: CapCut's default words cut out of the clip; its words, bold, size and spacing.
  await click(win, "[data-testid=mask-add]");
  await run("a text mask", () => click(win, "[data-testid=mask-shape-text]"));
  const t0 = pose((await masks())[0]);
  check("a text mask with CapCut's default words", t0?.shapeBounds?.shapeType === "text" && t0?.text?.content === "Default text", JSON.stringify(t0?.text));
  await shot("im-3-text");
  // Typed as keys (typing is one step while the keys come less than a second apart).
  await run("the text's words", async () => {
    const box = win.locator("[data-testid=section-mask-text] textarea");
    await box.click();
    await win.keyboard.press("Meta+a");
    await win.keyboard.type("OPEN", { delay: 60 });
    await win.waitForTimeout(800);
  });
  await run("bold", () => click(win, "[data-testid=section-mask-text] button[aria-label=Bold]"));
  await run("font size", () => typeIn(win, "Font size", 160));
  await run("character spacing", () => typeIn(win, "Character", 30));
  await run("the text's feather", () => typeIn(win, "Feather", 30));
  const t1 = pose((await masks())[0]);
  check("the text's style is saved", t1.text.content === "OPEN" && t1.text.bold === true && Math.abs(t1.text.letterSpacing - 0.3) < 1e-9, JSON.stringify(t1.text));
  await shot("im-3-text-edited");
  // Pen: the tile makes the mask an empty pen mask (the clip whole, as CapCut's) and brings out
  // the pen; anchors clicked round the middle (one dragged into a curve), the first clicked
  // again to close: the mask's path, the pointer back.
  const tools = () =>
    win
      .evaluate(async () => {
        const { useViewportStore } = await import("/src/lib/viewport.ts");
        const { useMaskStore } = await import("/src/lib/mask/index.ts");
        return `${useViewportStore.getState().tool}/${useMaskStore.getState().tool}`;
      })
      .catch(() => "?");
  const textId = (await masks())[0].id;
  await run("the Pen tile", () => click(win, "[data-testid=mask-shape-pen]"));
  const empty = (await masks())[0];
  check("an empty pen mask in the text's place", empty.id === textId && empty.tool === "pen" && pose(empty).penPath?.points.length === 0, JSON.stringify(pose(empty)));
  await shot("im-4-pen-empty");
  const penTool = await tools();
  const r = Math.min(p.w, p.h) * 0.15;
  const anchors = [
    [mid.x - r, mid.y - r],
    [mid.x + r, mid.y - r],
    [mid.x + r, mid.y + r],
    [mid.x - r, mid.y + r],
  ];
  await run("a mask drawn with Pen", async () => {
    for (const [i, [x, y]] of anchors.entries()) {
      if (i === 1) await drag(win, x, y, x + r * 0.5, y - r * 0.3);
      else await win.mouse.click(x, y);
      await win.waitForTimeout(120);
    }
    await settled(win, () => win.mouse.click(anchors[0][0], anchors[0][1]));
  });
  const penned = await masks();
  const path = penned[0] && pose(penned[0]).penPath;
  check(
    "Pen closes four anchors into the mask's path, one curved, and the pointer comes back",
    penTool === "mask/pen" && penned.length === 1 && penned[0].id === textId && path?.closed && path.points.length === 4 && path.points[1].ox !== path.points[1].x && (await tools()).startsWith("pointer"),
    `${penTool} → ${await tools()}; ${penned.length} masks, ${JSON.stringify(path?.points?.length)} anchors`,
  );
  await shot("im-4-pen");
  await run("a pen anchor dragged", () => dragHandle("pen-anchor", 20, 15, 2));
  check("the anchor moved", pose((await masks())[0]).penPath.points[2].x !== path.points[2].x);
  await run("the pen's feather", () => typeIn(win, "Feather", 25));
  await run("the pen's expansion", () => typeIn(win, "Expansion", 40));
  const pm = (await masks())[0];
  check("the pen's feather and expansion are saved", pm.featherAmount === 25 && pm.expansion === 40, JSON.stringify({ feather: pm.featherAmount, expansion: pm.expansion }));
  await shot("im-4-pen-settings");

  // Brush: the tile makes the mask an empty brush mask and brings out the brush; a stroke
  // across the middle goes on it, a second stroke too, the eraser takes some away; its
  // expansion; Clear empties it; Done brings the pointer back.
  await run("the Brush tile", () => click(win, "[data-testid=mask-shape-brush]"));
  const brushTool = await tools();
  await run("a brush stroke", () => settled(win, () => drag(win, mid.x - r, mid.y, mid.x + r, mid.y)));
  await run("a second brush stroke on the same mask", () => settled(win, () => drag(win, mid.x, mid.y - r, mid.x, mid.y + r)));
  await click(win, "[data-testid=mask-brush-erase]");
  await run("an eraser stroke", () => settled(win, () => drag(win, mid.x - r * 0.4, mid.y - r * 0.4, mid.x + r * 0.4, mid.y + r * 0.4)));
  const brushed = (await masks()).filter((m) => m.tool === "draw");
  const strokes = brushed[0] && Object.values(brushed[0].keyframes)[0].brushStrokes;
  check(
    "Brush paints strokes onto one brush mask and the eraser takes away",
    brushTool === "mask/draw" && brushed.length === 1 && strokes?.length === 3 && strokes[2].erase === true && !strokes[0].erase,
    `${brushTool}; ${brushed.length} brush masks, ${strokes?.length} strokes`,
  );
  await run("the brush's expansion", () => typeIn(win, "Expansion", 50));
  check("the brush's expansion is saved", (await masks())[0].expansion === 50, `${(await masks())[0].expansion}`);
  await shot("im-5-brush");
  await run("Clear empties the brush mask", () => click(win, "[data-testid=mask-brush-clear]"));
  check("cleared, no strokes", Object.values((await masks())[0].keyframes).every((k) => !k.brushStrokes?.length));
  // The canvas's tool chip ends the brush.
  await win.locator("[data-testid=tool-chip-done]").click();
  await win.waitForTimeout(300);
  check("Done brings the pointer back", (await tools()).startsWith("pointer"), await tools());
  return report();
};
