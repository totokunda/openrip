// Freeze, Reverse and the other transform tools, through the toolbar's menu and the clip menu's
// Edit › (after import timeline, the whole clip at 24 fps):
// - with nothing selected and the playhead at 2 s, Freeze freezes the main track's video there:
//   a 3 s still of the frame at 2 s, selected, the rest of the clip 3 s later (⌘Z / ⇧⌘Z);
// - the menu's Freeze is off with the playhead on the still;
// - Reverse (the menu) on the last part: saved, another frame, again puts it back exactly;
// - Edit › Reverse from the clip's right-click menu does the same; Edit › Freeze freezes there;
// - Mirror flips the clip (⌘Z / ⇧⌘Z).
import { engineFrame, rulerMap, seek, settled } from "./_preview.mjs";
import { bar, checks, savedClips, savedProject, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  ctx.map ??= await rulerMap(win);
  const { check, report } = checks();
  const fps = (await savedProject(win, udDir)).settings?.fps || 24;
  const videos = async () => (await savedClips(win, udDir)).filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  const frames = (c) => [Math.round((+c.startTick * fps) / 1e6), Math.round((+c.endTick * fps) / 1e6)];
  const frameAt = async (s) => {
    await seek(win, ctx.map, s);
    return (await engineFrame(win)).sum;
  };
  const original = { 2: await frameAt(2), 3: await frameAt(3), 6: await frameAt(6) };
  let shown = false;
  const menu = async (item) => {
    await win.evaluate(() => document.activeElement?.blur?.());
    await win.locator("[data-testid=tool-transform]").click();
    await win.waitForTimeout(300);
    if (!shown) {
      shown = true;
      await shot("f0-transform-menu");
    }
    const el = win.locator(`[data-testid=tool-${item}]`);
    const disabled = (await el.getAttribute("data-disabled")) !== null;
    if (disabled) {
      await win.keyboard.press("Escape");
      return false;
    }
    await settled(win, () => el.click());
    return true;
  };

  // Freeze at 2 s with nothing selected: the main track's video.
  await seek(win, ctx.map, 2);
  await undoCase(ctx, check, "Freeze from the menu", () => menu("freeze"), { frame: false });
  let v = await videos();
  const still = v.find((c) => c.freeze);
  check("three parts, a 3 s still at 2 s between", v.length === 3 && !!still && frames(still).join() === `${2 * fps},${5 * fps}` && Math.abs(still.freeze.at - 2) < 0.01, v.map((c) => `${frames(c).join("-")}${c.freeze ? `@${c.freeze.at.toFixed(3)}` : ""}`).join(" "));
  check("the still is selected", (await win.locator("[data-testid=inspector] [role=tab]", { hasText: /^Video$/ }).count()) === 1);
  check("the engine: the still holds the frame at 2 s; the rest is 3 s later", (await frameAt(3.5)) === original[2] && (await frameAt(6)) === original[3], "");
  await shot("f1-frozen");
  await seek(win, ctx.map, 3.5);
  await select(ctx, await savedProject(win, udDir), still.clipId, 4.5);
  const offOnStill = !(await menu("freeze"));
  check("Freeze is off on a still", offOnStill && (await videos()).length === 3);

  // Reverse from the menu, on the last part (5 s on).
  v = await videos();
  const last = v[2];
  await seek(win, ctx.map, 6);
  await select(ctx, await savedProject(win, udDir), last.clipId, 9);
  await menu("reverse");
  v = await videos();
  const reversedFrame = await frameAt(6);
  check("Reverse: saved, another frame", v[2].reverse === true && reversedFrame !== original[3], `reverse ${v[2].reverse}`);
  await select(ctx, await savedProject(win, udDir), last.clipId, 9);
  await menu("reverse");
  v = await videos();
  check("again: put back exactly", v[2].reverse === false && (await frameAt(6)) === original[3], `reverse ${v[2].reverse}`);

  // The clip menu's Edit ›.
  const edit = async (item) => {
    const [x, y] = await bar(ctx, await savedProject(win, udDir), last.clipId, 9);
    await win.mouse.click(x, y, { button: "right" });
    await win.waitForTimeout(400);
    await win.locator("[data-testid=menu-edit]").hover();
    await win.waitForTimeout(300);
    await shot(`f2-edit-${item}`);
    await settled(win, () => win.locator(`[data-testid=menu-${item}]`).click());
  };
  await edit("reverse");
  v = await videos();
  check("Edit › Reverse", v[2].reverse === true && (await frameAt(6)) === reversedFrame, `reverse ${v[2].reverse}`);
  await edit("reverse");
  await seek(win, ctx.map, 7);
  await edit("freeze");
  // The split, the still and the shift save as one edit a moment later than the menu closes.
  v = await videos();
  for (let i = 0; i < 4 && v.length !== 5; i++) v = await videos();
  check("Edit › Freeze at the playhead", v.length === 5 && v.filter((c) => c.freeze).length === 2, v.map((c) => frames(c).join("-")).join(" "));

  // Mirror.
  await seek(win, ctx.map, 1);
  await select(ctx, await savedProject(win, udDir), v[0].clipId, 0.5);
  await undoCase(ctx, check, "Mirror", () => menu("mirror"));
  v = await videos();
  check("Mirror: flipped", v[0].flip?.horizontal === true, JSON.stringify(v[0].flip));
  return report();
};
