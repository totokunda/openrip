// Video ▸ Basic (after import timeline; a photo's too, CLIP_NAME naming it): each control
// through the panel, undone and redone with the engine's frame and the saved project compared
// (undoCase), then position, scale and opacity keyed at two times (keyCase), the Transform
// header's diamond keying all three, and its reset. CANVAS_IMAGE is the canvas image picked
// (the calibration frame by default).
import fs from "node:fs";
import { drag, previewRect, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { at, choose, click, diamondOn, frame, keyCase, mediaClip, open, pressDiamond, rowNav, savedClip, sectionNav, typeIn } from "./_inspector.mjs";

const CANVAS_IMAGE = process.env.CANVAS_IMAGE || "/Users/tosinkuye/openrip/bench/calibration/out/frames/t1.png";

export default async (ctx) => {
  const { win, app, shot } = ctx;
  const { check, report } = checks();
  const clip = await mediaClip(ctx);
  const id = clip.clipId;
  const reopen = () => open(win, "Video", "Basic");
  const T = 1.5;
  await at(ctx, id, T);
  await reopen();
  await shot("ib-0-basic");

  const cases = [
    ["scale 50%", () => typeIn(win, "Scale", 50)],
    ["position x", () => typeIn(win, "Position", 120)],
    ["position y", () => typeIn(win, "Position", -150, 1)],
    ["align left", () => click(win, "[title='Align left']")],
    // A quarter turn first, so fit, fill and stretch differ even with the clip's own ratio.
    ["rotate 90", () => click(win, "[data-testid=transform-rotate90]")],
    ["fill", () => click(win, "[data-testid=transform-fill]")],
    ["fit", () => click(win, "[data-testid=transform-fit]")],
    ["stretch", () => click(win, "[data-testid=transform-stretch]")],
    ["rotate", () => typeIn(win, "Rotate", 30)],
    ["mirror", () => click(win, "[data-testid=transform-flip-h]")],
    ["flip", () => click(win, "[data-testid=transform-flip-v]")],
    ["scale 60%", () => typeIn(win, "Scale", 60)],
    // Separate sides: the switch off, then the width alone.
    [
      "scale width",
      async () => {
        await win.locator("[data-testid=inspector] [role=switch][aria-label='Uniform scale']").click();
        await typeIn(win, "Scale width", 45);
      },
    ],
    ["canvas on (blur)", () => click(win, "[data-section=Canvas] [role=checkbox]")],
    ["canvas blur 4", () => click(win, "[data-testid=canvas-blur-4]")],
    ["canvas colour", () => choose(win, "Canvas fill", "Color")],
    ["canvas red", () => click(win, "[aria-label='Canvas #e5484d']")],
    ["blend darken", () => choose(win, "Blend mode", "Darken")],
    ["blend screen", () => choose(win, "Blend mode", "Screen")],
    ["opacity", () => typeIn(win, "Opacity", 40)],
  ];
  if (fs.existsSync(CANVAS_IMAGE)) {
    cases.push([
      "canvas image",
      async () => {
        await app.evaluate(({ ipcMain }, p) => {
          ipcMain.removeHandler("dialog:pick-media");
          ipcMain.handle("dialog:pick-media", async () => [p]);
        }, CANVAS_IMAGE);
        await choose(win, "Canvas fill", "Image");
      },
    ]);
  }
  // A square picture on a square canvas (the calibration frame is one) fits, fills and stretches
  // alike: there fit and stretch change nothing after fill, and that's what's checked.
  const doc0 = await savedProject(win, ctx.udDir);
  const box = doc0.timeline.clips.find((c) => c.clipId === id).transform;
  const aspect = doc0.settings.aspectRatio;
  const square = Math.abs(box.width / box.height - 1) < 1e-3 && Math.abs(aspect.width / aspect.height - 1) < 1e-3;
  for (const [name, edit] of cases) {
    if (square && (name === "fit" || name === "stretch")) {
      const before = JSON.stringify((await savedClip(ctx, id)).transform);
      await edit();
      check(`${name}: on a square picture it agrees with fill`, JSON.stringify((await savedClip(ctx, id)).transform) === before);
      continue;
    }
    try {
      const r = await undoCase(ctx, check, name, edit);
      if (!r.ok) await shot(`ib-fail-${name.replace(/\W+/g, "-")}`);
    } catch (e) {
      check(name, false, e.message.split("\n")[0]);
      await shot(`ib-fail-${name.replace(/\W+/g, "-")}`);
    }
  }
  await shot("ib-1-edited");
  const saved = await savedClip(ctx, id);
  check(
    "the saved clip keeps the panel's fields",
    saved.canvas?.type === "image" || saved.canvas?.color === "#e5484d",
    JSON.stringify({ canvas: saved.canvas, blendMode: saved.blendMode, flip: saved.flip, opacity: saved.transform?.opacity }),
  );

  // Keyframes: position, scale and opacity, each keyed at 1 s and 4 s.
  await win.locator("[data-testid=inspector] [role=switch][aria-label='Uniform scale']").click().catch(() => {});
  const keyed = { id, t1: 1, t2: 4, reopen, undoCase };
  await keyCase(ctx, check, "position", { ...keyed, row: "Position", set2: () => typeIn(win, "Position", -60) });
  await keyCase(ctx, check, "scale", { ...keyed, row: "Scale", set2: () => typeIn(win, "Scale", 80) });
  await keyCase(ctx, check, "opacity", { ...keyed, row: "Opacity", set2: () => typeIn(win, "Opacity", 100) });
  const keys = (await savedClip(ctx, id)).keyframes ?? {};
  check("the keys are saved on the clip", ["position", "scale", "opacity"].every((p) => keys[p]?.length === 2), JSON.stringify(Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.map((x) => x.frame)]))));
  await shot("ib-2-keyed");

  // The Transform header's diamond at 2.5 s keys scale, position and rotation at once.
  await at(ctx, id, 2.5);
  await reopen();
  const nav = sectionNav(win, "Transform");
  // Keys at the values shown: the picture stays, the project changes.
  const r = await undoCase(ctx, check, "the Transform diamond", () => pressDiamond(win, nav), { frame: false });
  const all = (await savedClip(ctx, id)).keyframes ?? {};
  const local = Math.round(2.5 * 24) - Math.round((+clip.startTick * 24) / 1e6);
  check(
    "the Transform diamond keys all three",
    r.ok && (await diamondOn(nav)) && ["position", "scale", "rotation"].every((p) => all[p]?.some((k) => Math.abs(k.frame - local) < 0.5)),
    JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.map((x) => x.frame)]))),
  );
  // Reset: back to 100 %, centred, upright and unkeyed.
  const f0 = await frame(win);
  await undoCase(ctx, check, "Transform reset", () => click(win, "[aria-label='Reset Transform']"));
  const reset = await savedClip(ctx, id);
  check("reset leaves no transform keys", !["position", "scale", "rotation"].some((p) => reset.keyframes?.[p]?.length) && (await frame(win)) !== f0);

  // The handles on the canvas follow CapCut's rule too: position keyed at 1 s, then the clip
  // dragged at 4 s sets a key there and leaves the field alone.
  await at(ctx, id, 1);
  await reopen();
  await pressDiamond(win, rowNav(win, "Position"));
  await at(ctx, id, 4);
  await reopen();
  const p = await previewRect(win);
  const mid = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  const before = await savedClip(ctx, id);
  await undoCase(ctx, check, "a keyed clip dragged on the canvas", () => settled(win, () => drag(win, mid.x, mid.y, mid.x + 40, mid.y + 60)));
  const after = await savedClip(ctx, id);
  check(
    "the drag keyed the position at the playhead and left the field",
    after.keyframes?.position?.length === 2 && after.transform.x === before.transform.x && after.transform.y === before.transform.y,
    JSON.stringify({ keys: after.keyframes?.position, field: [after.transform.x, after.transform.y] }),
  );
  return report();
};
