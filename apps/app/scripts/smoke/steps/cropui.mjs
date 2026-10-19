// The Crop dialog (after `import timeline`; `CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1` on the 4K
// clip), as CapCut's (shots: c01 ↔ 31-dialogs/039-crop-dialog, c02 ↔ 040-crop-ratio-menu).
// The timeline toolbar's crop button opens it on the selected clip; the ratio menu lists Free,
// 1:1, 3:4, 4:3, 16:9, 9:16. A 1:1 crop, then Reset, then a free crop with Rotation 10° (the
// window shrunk with its handles): each is checked in the saved clip, in the engine's frame
// against a picture FFmpeg makes from the source (the picture turned and cut independently,
// _crop.mjs), and undone and redone. The last crop is left on the clip for cropuicheck (after
// `reopen`).
import { rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { compareFrame, expectedPicture, sourcePicture } from "./_crop.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const doc = () => savedProject(win, udDir);
  const video = async () => (await doc()).timeline.clips.filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick)[0];
  const src = sourcePicture(ctx, 0);
  await seek(win, map, 0);
  await select(ctx, await doc(), (await video()).clipId, 6);
  const dialog = win.locator("[data-testid=crop-dialog]");
  const open = async () => {
    await win.locator("[data-testid=tool-crop]").click();
    await dialog.waitFor({ timeout: 5000 });
    await win.locator("[data-testid=crop-picture] canvas, [data-testid=crop-picture] img").first().waitFor({ timeout: 15000 });
    await win.waitForTimeout(500);
  };
  const confirm = async () => {
    await settled(win, () => win.locator("[data-testid=crop-confirm]").click());
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    await win.waitForTimeout(800);
  };
  const frameBox = async () => {
    const [w, h] = (await win.locator("[data-testid=crop-frame]").getAttribute("data-box")).split("x").map(Number);
    return { w, h };
  };
  // A handle dragged by (dx, dy) CSS px.
  const dragHandle = async (name, dx, dy) => {
    const b = await win.locator(`[data-testid=crop-handle-${name}]`).boundingBox();
    const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
    await win.mouse.move(x + dx, y + dy, { steps: 4 });
    await win.mouse.up();
    await win.waitForTimeout(150);
  };
  const cropOf = async () => (await video()).transform?.crop;

  // ---- The dialog as it opens, and its ratio menu ----
  const frame0 = await compareFrame(ctx, expectedPicture(ctx, src, { x: 0, y: 0, width: 1, height: 1 }, (await win.evaluate(() => document.getElementById("openrip-engine-frame").width)), await win.evaluate(() => document.getElementById("openrip-engine-frame").height), "full"));
  check("the engine's frame is the source picture before any crop (FFmpeg's own picture)", frame0.mean < 8, `mean difference ${frame0.mean.toFixed(2)} at ${frame0.w}×${frame0.h}`);
  check("the timeline toolbar has the crop button", (await win.locator("[data-testid=tool-crop]").count()) === 1);
  await open();
  await shot("c01-crop-dialog"); // 031-dialogs/039
  const box = await dialog.boundingBox();
  check("the dialog is 959×639", Math.abs(box.width - 959) < 2 && Math.abs(box.height - 639) < 2, `${box.width}×${box.height}`);
  const parts = ["crop-close", "crop-stage", "crop-frame", "crop-transport", "crop-rotation", "crop-rotation-field", "crop-ratio", "crop-reset", "crop-confirm"];
  const missing = [];
  for (const p of parts) if ((await win.locator(`[data-testid=${p}]`).count()) !== 1) missing.push(p);
  check("it has the close dot, the stage with its frame and transport, Rotation, the Crop ratio, Reset and Confirm", missing.length === 0, missing.join(","));
  const handles = await win.locator("[data-testid^=crop-handle-]").count();
  check("the frame has four corner handles and four side handles", handles === 8, `${handles}`);
  check("Rotation shows 0° and Crop shows Free", (await win.locator("[data-testid=crop-rotation-field]").inputValue()) === "0°" && /Free/.test(await win.locator("[data-testid=crop-ratio]").innerText()));
  await win.locator("[data-testid=crop-ratio]").click();
  await win.waitForTimeout(300);
  const ratios = await win.evaluate(() => [...document.querySelectorAll("[data-testid=crop-ratio-option]")].map((e) => e.innerText.trim()));
  await shot("c02-crop-ratio-menu"); // 040
  check("the ratio menu lists Free, 1:1, 3:4, 4:3, 16:9, 9:16", ratios.join(",") === "Free,1:1,3:4,4:3,16:9,9:16", ratios.join(","));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(200);
  // Closing with the dot changes nothing.
  await win.locator("[data-testid=crop-close]").click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  check("the close dot leaves the clip uncropped", !(await cropOf()) || (await cropOf()).width === 1);

  // ---- A 1:1 crop ----
  await undoCase(ctx, check, "crop 1:1", async () => {
    await open();
    await win.locator("[data-testid=crop-ratio]").click();
    await win.locator("[data-testid=crop-ratio-option][data-value='1:1']").click();
    await win.waitForTimeout(300);
    const b = await frameBox();
    check("1:1 makes the frame square", Math.abs(b.w - b.h) < 1.5, `${b.w}×${b.h}`);
    await shot("c03-crop-square");
    await confirm();
  });
  {
    const c = await cropOf();
    check("the clip's crop is square in the picture's pixels, centred", !!c && Math.abs(c.width * src.sw - c.height * src.sh) < 3 && Math.abs(c.x + c.width / 2 - 0.5) < 0.002 && Math.abs(c.y + c.height / 2 - 0.5) < 0.002 && !c.rotation, JSON.stringify(c));
    const fw = await win.evaluate(() => document.getElementById("openrip-engine-frame").width);
    const fh = await win.evaluate(() => document.getElementById("openrip-engine-frame").height);
    const r = await compareFrame(ctx, expectedPicture(ctx, src, c, fw, fh, "square"));
    check("the engine draws the square cut from the source (FFmpeg's picture)", r.mean < 8, `mean difference ${r.mean.toFixed(2)}, lit box ${JSON.stringify(r.box)} of ${r.w}×${r.h}`);
    const bw = r.box ? r.box[2] - r.box[0] : 0;
    const bh = r.box ? r.box[3] - r.box[1] : 0;
    check("it fills the canvas's width as a square band", Math.abs(bw / bh - 1) < 0.04, `${bw}×${bh}`);
    const v = await video();
    check("the clip's box became the crop's rectangle (a square)", Math.abs(v.transform.width / v.transform.height - 1) < 0.01, `${v.transform.width.toFixed(1)}×${v.transform.height.toFixed(1)}`);
  }

  // ---- Reset, Confirm: the crop is gone ----
  await undoCase(ctx, check, "crop reset", async () => {
    await open();
    check("the dialog opens on the clip's own crop (square)", Math.abs((await frameBox()).w - (await frameBox()).h) < 1.5);
    await win.locator("[data-testid=crop-reset]").click();
    await win.waitForTimeout(250);
    const b = await frameBox();
    check("Reset puts the frame on the whole picture", Math.abs(b.w / b.h - src.sw / src.sh) < 0.01, `${b.w}×${b.h}`);
    await confirm();
  });
  {
    const c = await cropOf();
    check("after Reset and Confirm the clip has no crop", !c || (Math.abs(c.width - 1) < 1e-6 && Math.abs(c.height - 1) < 1e-6 && !c.rotation), JSON.stringify(c));
  }
  // The undo above ended redone: the crop is gone again. Back to the square, to start from a crop and Reset it? No: start the free crop.

  // ---- A free crop with Rotation 10° ----
  await undoCase(ctx, check, "crop rotated 10°", async () => {
    await open();
    const field = win.locator("[data-testid=crop-rotation-field]");
    await field.click({ clickCount: 3 });
    await field.fill("10°");
    await field.press("Enter");
    await win.waitForTimeout(300);
    const turned = await win.locator("[data-testid=crop-picture]").getAttribute("data-rotation");
    check("Rotation 10° turns the picture in the dialog and the slider follows", Number(turned) === 10 && (await win.locator("[data-testid=crop-rotation]").inputValue()) === "10", `${turned}`);
    await dragHandle("l", 50, 0);
    await dragHandle("r", -50, 0);
    await dragHandle("t", 0, 70);
    await dragHandle("b", 0, -70);
    await shot("c04-crop-rotated");
    await confirm();
  });
  {
    const c = await cropOf();
    check("the clip's crop has Rotation 10 and is a free rectangle", !!c && c.rotation === 10 && c.width < 1 && c.height < 1 && Math.abs(c.width * src.sw / (c.height * src.sh) - src.sw / src.sh) > 0.02, JSON.stringify(c));
    const fw = await win.evaluate(() => document.getElementById("openrip-engine-frame").width);
    const fh = await win.evaluate(() => document.getElementById("openrip-engine-frame").height);
    const good = await compareFrame(ctx, expectedPicture(ctx, src, c, fw, fh, "turned"));
    const flipped = await compareFrame(ctx, expectedPicture(ctx, src, { ...c, rotation: -c.rotation }, fw, fh, "turned-other"));
    const none = await compareFrame(ctx, expectedPicture(ctx, src, { ...c, rotation: 0 }, fw, fh, "turned-none"));
    check("the engine draws the straightened cut (the source turned 10° clockwise inside an upright frame)", good.mean < 10 && good.mean < 0.8 * Math.min(flipped.mean, none.mean), `difference ${good.mean.toFixed(2)}; turned the other way ${flipped.mean.toFixed(2)}, not turned ${none.mean.toFixed(2)}`);
    // The cut is an upright rectangle: the lit box is filled.
    check("the cut is upright: the lit area is a rectangle", !!good.box && good.box[2] - good.box[0] > 20, JSON.stringify(good.box));
    const v = await video();
    check("the clip's box is the crop's rectangle", Math.abs(v.transform.width / v.transform.height - (c.width * src.sw) / (c.height * src.sh)) < 0.02, `${v.transform.width.toFixed(1)}×${v.transform.height.toFixed(1)}`);
  }
  // Opening the dialog again shows the crop and its rotation.
  await open();
  const sizes = await win.evaluate(() => ({ f: document.querySelector("[data-testid=crop-frame]").getBoundingClientRect().width, p: document.querySelector("[data-testid=crop-picture]").getBoundingClientRect().width }));
  check("the dialog opens on the saved crop and its rotation", (await win.locator("[data-testid=crop-rotation-field]").inputValue()) === "10°" && sizes.f < 0.6 * sizes.p, `${await win.locator("[data-testid=crop-rotation-field]").inputValue()}, frame ${sizes.f.toFixed(0)} of picture ${sizes.p.toFixed(0)}`);
  await win.locator("[data-testid=crop-close]").click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  return report();
};
