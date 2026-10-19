// The timeline's editing tools (after import timeline newtext: a text 0-3 s over the video).
// Each edit is undone and redone (undoCase: the saved project, and the engine's frame where
// the picture changes):
//   menu      the selection tool's menu: Select (A), Split (B), Select leftward, Select rightward
//   blade     B, then a click on the main track's clip cuts it at the frame under the mouse; A
//   select    Select leftward from the menu (before the playhead), Select rightward by ]; each
//             followed by Delete to show which clips were selected
//   axis      Preview axis on: hovering the timeline shows that frame in the player, the
//             playhead stays, and the player goes back to the playhead's frame on leave
//   gaps      the text track's empty space: Close gap, Close all gaps, Select, and Close gap
//             greyed where there is no gap
//   deactivate  the clip menu's Deactivate clip: greyed and hatched on the timeline, not drawn
//             by the engine, saved with the clip, V toggles it back
//   fit       Zoom to fit as a toggle: on while the whole timeline is in view, pressed again
//             it goes back to the zoom before
import { engineFrame, now, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { button, doc, dragClip, fpsOf, key, mainClips, mainTrack, rowY } from "./_timeline.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  const at = (s) => seek(win, map, s);
  const tool = () => win.locator("[data-testid=tool-selection]");
  const toolName = () => tool().getAttribute("data-tool");
  const openMenu = async () => {
    await tool().click();
    await win.waitForTimeout(300);
  };
  const live = async () => (await doc(ctx)).timeline.clips.filter((c) => !c.hidden);

  // The selection tool's menu.
  check("the selection tool starts on Select", (await toolName()) === "select");
  await openMenu();
  const names = await Promise.all(["sel-select", "sel-split", "sel-left", "sel-right"].map((id) => win.locator(`[data-testid=${id}]`).innerText()));
  check("its menu has Select, Split, Select leftward and Select rightward with their keys", /Select\s*A/.test(names[0]) && /Split\s*B/.test(names[1]) && /leftward\s*\[/.test(names[2]) && /rightward\s*\]/.test(names[3]), names.join(" | "));
  await ctx.shot("tl-tools-menu");
  await win.keyboard.press("Escape");

  // The blade.
  let d = await doc(ctx);
  const main = mainTrack(d);
  const f = fpsOf(d);
  await at(8);
  await key(win, "b");
  check("B turns the Split blade on", (await toolName()) === "split");
  const y = await rowY(ctx, d, main.timelineId);
  await win.mouse.move(map.x(5), y, { steps: 6 });
  await win.waitForTimeout(400);
  await ctx.shot("tl-tools-blade");
  const n0 = mainClips(d).length;
  await undoCase(ctx, check, "blade click", async () => {
    await settled(win, () => win.mouse.click(map.x(5), y));
  }, { frame: false });
  d = await doc(ctx);
  const cut = mainClips(d);
  check("a blade click cuts the clip under the mouse at that frame", cut.length === n0 + 1 && Math.abs(cut[0].e - 5 * f) <= 1 && cut[1].s === cut[0].e, cut.map((c) => `${c.s}-${c.e}`).join(" "));
  check("the playhead didn't move for it", Math.abs((await now(win)) - 8) < 0.05);
  await key(win, "a");
  check("A goes back to Select", (await toolName()) === "select");

  // Select leftward / rightward, shown by what a Delete takes.
  await at(4);
  await undoCase(ctx, check, "select leftward, Delete", async () => {
    await openMenu();
    await win.locator("[data-testid=sel-left]").click();
    await win.waitForTimeout(400);
    await key(win, "Backspace");
  }, { frame: false });
  let left = await live();
  check("Select leftward took the clips that start before the playhead", left.length === 1 && left[0].type === "video", left.map((c) => c.type).join(","));
  await key(win, "Meta+z");
  await undoCase(ctx, check, "select rightward (]), Delete", async () => {
    await key(win, "BracketRight");
    await key(win, "Backspace");
  }, { frame: false });
  left = await live();
  check("] took the clips that end after the playhead", left.length === 1 && left[0].type === "text", left.map((c) => c.type).join(","));
  await key(win, "Meta+z");

  // Preview axis: hover shows another frame, the playhead stays.
  d = await doc(ctx);
  await at(8);
  await win.mouse.move(10, 10);
  const here = (await engineFrame(win)).sum;
  await button(win, "Preview axis").click();
  check("the preview axis toggle is on", (await button(win, "Preview axis").getAttribute("aria-checked")) === "true");
  await settled(win, () => win.mouse.move(map.x(1.5), y, { steps: 5 }), { timeout: 3000 });
  const hovered = (await engineFrame(win)).sum;
  check("hovering the timeline shows that frame in the player", hovered !== here);
  check("the playhead stays where it was", Math.abs((await now(win)) - 8) < 0.05);
  await ctx.shot("tl-tools-axis");
  await settled(win, () => win.mouse.move(map.x(8), 120, { steps: 5 }), { timeout: 3000 });
  const away = (await engineFrame(win)).sum;
  check("leaving the timeline returns the player to the playhead's frame", away === here);
  await button(win, "Preview axis").click();
  check("the toggle goes off", (await button(win, "Preview axis").getAttribute("aria-checked")) === "false");
  await settled(win, () => win.mouse.move(map.x(1.5), y, { steps: 5 }), { timeout: 3000 });
  check("with it off, hovering changes nothing", (await engineFrame(win)).sum === here);
  await win.mouse.move(10, 10);

  // Gaps on the text track: move the text away from 0 to make one.
  d = await doc(ctx);
  const textTrack = d.timeline.tracks.find((t) => t.type === "text");
  const text = d.timeline.clips.find((c) => c.type === "text");
  const ty = await rowY(ctx, d, textTrack.timelineId);
  const startOf = async () => Math.round((+(await doc(ctx)).timeline.clips.find((c) => c.type === "text").startTick * f) / 1e6);
  await dragClip(ctx, d, { ...text, timelineId: textTrack.timelineId }, 1.5, 5.5);
  const moved = await startOf();
  check("the text track has a gap before the text", moved > f, `starts at ${moved}`);
  const rightClick = async (s) => {
    await win.mouse.click(map.x(s), ty, { button: "right" });
    await win.waitForTimeout(400);
  };
  await rightClick(1);
  const closeGap = win.locator("[data-testid=menu-close-gap]");
  check("right-click on the gap offers Close gap, Close all gaps and Select", (await closeGap.isEnabled()) && (await win.locator("[data-testid=menu-close-all-gaps]").isEnabled()) && (await win.locator("[data-testid=menu-select-track]").isEnabled()));
  await ctx.shot("tl-tools-gaps");
  await win.keyboard.press("Escape");
  await undoCase(ctx, check, "Close gap", async () => {
    await rightClick(1.5);
    await settled(win, () => win.locator("[data-testid=menu-close-gap]").click());
  }, { frame: false });
  check("Close gap moves the text to the start", (await startOf()) === 0, `starts at ${await startOf()}`);
  await rightClick(9);
  // (A right-click moves the playhead, and one on the playhead's own line would grab it: each
  // goes at a different time.)
  check("Close gap and Close all gaps are greyed where there is none", (await closeGap.isDisabled()) && (await win.locator("[data-testid=menu-close-all-gaps]").isDisabled()));
  await win.keyboard.press("Escape");
  await key(win, "Meta+z");
  check("(undone, the gap is back)", (await startOf()) === moved);
  await undoCase(ctx, check, "Close all gaps", async () => {
    await rightClick(2);
    await settled(win, () => win.locator("[data-testid=menu-close-all-gaps]").click());
  }, { frame: false });
  check("Close all gaps closes it too", (await startOf()) === 0);
  await key(win, "Meta+z");
  await undoCase(ctx, check, "Select (the track), Delete", async () => {
    await rightClick(9.5);
    await win.locator("[data-testid=menu-select-track]").click();
    await win.waitForTimeout(400);
    await key(win, "Backspace");
  }, { frame: false });
  check("Select takes the track's clips", !(await live()).some((c) => c.type === "text"));
  await key(win, "Meta+z");

  // Deactivate clip.
  d = await doc(ctx);
  const video = mainClips(d).at(-1);
  await at(8);
  const clipY = await rowY(ctx, d, main.timelineId);
  const lit = await engineFrame(win);
  const r = await undoCase(ctx, check, "Deactivate clip", async () => {
    await select(ctx, d, video.clipId, 10);
    await win.mouse.click(map.x(10), clipY, { button: "right" });
    await win.waitForTimeout(400);
    check("the clip menu offers Deactivate clip (V)", /Deactivate clip\s*V/.test(await win.locator("[data-testid=menu-deactivate]").innerText()));
    await settled(win, () => win.locator("[data-testid=menu-deactivate]").click());
  });
  d = await doc(ctx);
  check("the clip is saved deactivated and stays on the timeline", d.timeline.clips.find((c) => c.clipId === video.clipId)?.deactivated === true);
  const dark = await engineFrame(win);
  check("the engine draws nothing of it", dark.light < 0.02 && lit.light > dark.light + 0.05, `${lit.light.toFixed(3)} -> ${dark.light.toFixed(3)}`);
  await ctx.shot("tl-tools-deactivated");
  await select(ctx, d, video.clipId, 10);
  await win.mouse.click(map.x(10), clipY, { button: "right" });
  await win.waitForTimeout(400);
  check("its menu now says Activate clip", /Activate clip/.test(await win.locator("[data-testid=menu-deactivate]").innerText()));
  await win.keyboard.press("Escape");
  await key(win, "v");
  d = await doc(ctx);
  check("V activates it again", !d.timeline.clips.find((c) => c.clipId === video.clipId)?.deactivated);
  check("and the engine draws it as before", (await engineFrame(win)).sum === lit.sum);
  void r;

  // Zoom to fit as a toggle.
  const fit = () => button(win, "Zoom timeline to fit").getAttribute("aria-checked");
  await key(win, "Meta+Equal");
  await key(win, "Meta+Equal");
  check("zoomed in, Zoom to fit is off", (await fit()) === "false");
  await button(win, "Zoom timeline to fit").click();
  await win.waitForTimeout(500);
  check("Zoom to fit puts the whole timeline in view and shows on", (await fit()) === "true");
  await button(win, "Zoom timeline to fit").click();
  await win.waitForTimeout(500);
  check("pressed again it goes back to the zoom before", (await fit()) === "false");
  await ctx.shot("tl-tools-fit");
  return report();
};
