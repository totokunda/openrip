// The video's Canvas ▸ Pattern (after import timeline; CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1,
// built app; docs/plan/capcut-ui-spec.md §6.17, 18-inspector-video/008-canvas-type-menu, 011-canvas-
// pattern-options): the clip scaled down so the canvas shows round it, the Canvas fill dropdown's
// Pattern (None, Color, Blur, Pattern, Image), OpenRip's own twelve pattern tiles drawn in code
// (each swatch has both its colours), each pattern clicked and the engine's canvas corner read:
// it is the swatch's colour at the same place (the app's swatch and the engine tile the same
// shapes), the pattern saved on the clip as `canvas: {type: "pattern", pattern}`, undone and
// redone, the project reopened and an export whose frames have the pattern round the clip (ffmpeg).
import { engineFrame, rulerMap, seek } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { at, choose, mediaClip, open, savedClip, typeIn } from "./_inspector.mjs";
import { undoCase } from "./_undo.mjs";
import { apart, exportProject, filePatch, patch } from "./_gaps.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  const clip = await mediaClip(ctx);
  const id = clip.clipId;
  const T = 1.5;
  await at(ctx, id, T);
  await open(win, "Video", "Basic");
  await win.waitForTimeout(400);
  await typeIn(win, "Scale", 50);
  const bare = await patch(win, 0.02, 0.02, 0.01);
  check("with no canvas fill the corner is black", bare[0] + bare[1] + bare[2] < 30, bare.map((v) => v.toFixed(0)).join());

  const section = win.locator("[data-testid=section-canvas]");
  await section.scrollIntoViewIfNeeded();
  await section.locator("[role=checkbox]").first().click();
  await win.waitForTimeout(500);
  await win.locator('[aria-label="Canvas fill"]').click();
  const options = (await win.getByRole("option").allInnerTexts()).map((s) => s.trim());
  check("the Canvas fill menu: None, Color, Blur, Pattern, Image", options.join() === "None,Color,Blur,Pattern,Image", options.join());
  await win.keyboard.press("Escape");
  await undoCase(ctx, check, "canvas Pattern", () => choose(win, "Canvas fill", "Pattern"));
  const tiles = await win.locator("[data-testid=canvas-patterns] [data-testid^=canvas-pattern-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("canvas-pattern-", "")));
  check("twelve pattern tiles", tiles.length === 12, tiles.join());
  const swatches = await win.locator("[data-testid=canvas-patterns] canvas").evaluateAll((cs) =>
    cs.map((c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const colours = new Set();
      for (let i = 0; i < d.length; i += 4) colours.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      const first = [...d.slice(4 * (c.width + 1), 4 * (c.width + 1) + 3)];
      return { colours: colours.size, first };
    }),
  );
  check("each swatch is drawn with both its colours", swatches.every((s) => s.colours >= 2), swatches.map((s) => s.colours).join());
  await shot("cp-1-patterns");
  check("the first pattern is selected and saved", (await savedClip(ctx, id)).canvas?.type === "pattern" && (await savedClip(ctx, id)).canvas.pattern === tiles[0]);

  // Each pattern: the engine's canvas corner is its swatch's colour there.
  const results = [];
  for (const [i, name] of tiles.entries()) {
    await win.locator(`[data-testid=canvas-pattern-${name}]`).click();
    await win.waitForTimeout(700);
    const [corner, again] = [await patch(win, 0.004, 0.004, 0.003), swatches[i].first];
    results.push({ name, off: apart(corner, again), saved: (await savedClip(ctx, id)).canvas?.pattern });
  }
  check("every pattern's corner is the swatch's colour at the same place", results.every((r) => r.off < 14 && r.saved === r.name), results.map((r) => `${r.name} ${r.off.toFixed(0)}`).join(", "));
  await shot("cp-2-last");
  const hashes = new Set();
  for (const name of ["dots", "stripes", "checks"]) {
    await win.locator(`[data-testid=canvas-pattern-${name}]`).click();
    await win.waitForTimeout(600);
    hashes.add((await engineFrame(win)).sum);
  }
  check("the patterns draw different canvases", hashes.size === 3);

  // Reopen: saved and drawn.
  await win.locator("[data-testid=canvas-pattern-checks]").click();
  await win.waitForTimeout(800);
  const corner0 = await patch(win, 0.004, 0.004, 0.003);
  const name = await win.locator("[data-testid=project-name]").inputValue();
  await (await import("./reopen.mjs")).default({ win, shot });
  const again = await savedClip(ctx, id);
  check("reopened, the pattern is on the clip", again.canvas?.type === "pattern" && again.canvas.pattern === "checks", `${JSON.stringify(again.canvas)} (${name})`);
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, T);
  await win.keyboard.press("Escape");
  check("and the engine draws it", apart(await patch(win, 0.004, 0.004, 0.003), corner0) < 6);

  // Export: the pattern round the clip in the file.
  const file = await exportProject(ctx, "canvaspatterns-export");
  const [c, middle] = [filePatch(file, T, 0.015, 0.015, 0.01), filePatch(file, T, 0.5, 0.5, 0.03)];
  check("the exported frame has the pattern at the corner (checks' dark tile) and the clip in the middle", c[0] < 90 && Math.abs(c[0] - 0x2b) < 25 && apart(c, middle) > 20, `corner ${c.map((v) => v.toFixed(0))}, middle ${middle.map((v) => v.toFixed(0))}`);
  return report();
};
