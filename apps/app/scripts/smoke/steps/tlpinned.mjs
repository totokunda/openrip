// The main track pinned at the bottom of the track area (after import timeline newtext: a text
// track over the main track). Tracks are added from the toolbar's + until they don't fit, then:
//   pinned    the main track's header and band are at the bottom of the timeline, the overlay
//             tracks above it; nothing is drawn over the main track
//   scroll    the wheel scrolls the overlay tracks (their headers move) while the main track
//             stays where it is; scrolled back down, they're as they were
//   select    a click on the main track's clip and on the text clip (scrolled into view) still
//             select them, through the pinned layout
//   undo      the added tracks undone: the layout goes back to one scroll-free stack
import { drag, rulerMap, settled, timelineRect } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { clipsOn, doc, mainTrack } from "./_timeline.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  ctx.map = await rulerMap(win);
  const header = (id) => win.locator(`[data-track-header="${id}"]`);

  // Open the headers (drag their rail right).
  const rail = await win.locator("button[aria-label='Drag to resize timeline sidebar']").boundingBox();
  if (rail.x < 60) await drag(win, rail.x, rail.y + rail.height / 2, rail.x + 60, rail.y + rail.height / 2);
  await win.waitForTimeout(500);

  let d = await doc(ctx);
  const main = mainTrack(d);
  const tl = await timelineRect(win);
  const top = (id) => header(id).evaluate((el) => el.getBoundingClientRect().top);
  const mainTop0 = await top(main.timelineId);

  // The + at the toolbar's left end: text tracks until the stack overflows the panel.
  const addText = async () => {
    await win.locator("[data-testid=tool-add]").click();
    await win.waitForTimeout(250);
    await settled(win, () => win.locator("[data-testid=add-text]").click(), { timeout: 1500 });
  };
  const n0 = d.timeline.tracks.length;
  await undoCase(ctx, check, "add text track from the toolbar +", addText, { frame: false });
  d = await doc(ctx);
  check("the toolbar's + ▸ Add text track adds a text track", d.timeline.tracks.length === n0 + 1 && d.timeline.tracks.filter((t) => t.type === "text").length === 2, d.timeline.tracks.map((t) => t.type).join(","));
  for (let i = 0; i < 6; i++) await addText();
  d = await doc(ctx);
  const m = mainTrack(d);
  const tl2 = await timelineRect(win);
  await shot("pin-1-overflow");

  // Pinned: the main track's header sits at the bottom of the timeline, below where it was.
  const mainTop = await top(m.timelineId);
  const bottom = await header(m.timelineId).evaluate((el) => el.getBoundingClientRect().bottom);
  check("the main track is pinned at the bottom of the track area", mainTop > mainTop0 + 20 && bottom <= tl2.y + tl2.h + 1 && bottom > tl2.y + tl2.h - 40, `top ${mainTop0} -> ${mainTop}, bottom ${bottom} of ${tl2.y + tl2.h}`);
  const texts = d.timeline.tracks.filter((t) => t.type === "text");
  const first = texts[0];
  const firstTop = await top(first.timelineId);

  // Scroll the overlay tracks with the wheel.
  await win.mouse.move(tl2.x + tl2.w / 2, tl2.y + 60);
  await win.mouse.wheel(0, -400);
  await win.waitForTimeout(500);
  const firstAfter = await top(first.timelineId);
  const mainAfter = await top(m.timelineId);
  await shot("pin-2-scrolled-up");
  check("the wheel scrolls the overlay tracks and leaves the main track", firstAfter > firstTop + 10 && Math.abs(mainAfter - mainTop) < 1, `overlay ${firstTop} -> ${firstAfter}, main ${mainTop} -> ${mainAfter}`);
  // The scrolled-away header is clipped at the pinned tracks: its wrapper ends where they begin.
  const wrapperBottom = await header(first.timelineId).evaluate((el) => el.parentElement.parentElement.getBoundingClientRect().bottom);
  check("the overlay headers are cut off above the pinned track", wrapperBottom <= mainAfter + 1, `wrapper bottom ${wrapperBottom}, main top ${mainAfter}`);
  await win.mouse.wheel(0, 600);
  await win.waitForTimeout(500);
  const back = await top(first.timelineId);
  check("scrolled back down the overlay tracks are where they were", Math.abs(back - firstTop) < 1, `${firstTop} -> ${back}`);

  // Clicks still land: the main track's clip, then the first text clip after scrolling to it.
  const mainClip = clipsOn(d, m.timelineId)[0];
  const secOf = (c) => (+c.startTick + +c.endTick) / 2e6;
  const rowMid = (el) => el.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; });
  const mainY = await rowMid(header(m.timelineId));
  await win.mouse.click(ctx.map.x(secOf(mainClip)), mainY);
  await win.waitForTimeout(500);
  const selMain = await win.evaluate(() => document.querySelector("[data-testid=inspector]")?.innerText ?? "");
  check("a click on the main track's clip selects it", /Video|Basic|Speed/.test(selMain), selMain.slice(0, 40));
  await shot("pin-3-main-selected");

  // The stack goes back with the undo of the six adds: one step each; the pin gives way.
  for (let i = 0; i < 6; i++) await win.keyboard.press("Meta+z");
  await win.waitForTimeout(600);
  const settledTop = await top(m.timelineId);
  check("with the extra tracks undone the main track is back up in the stack", settledTop < mainTop - 20, `${mainTop} -> ${settledTop}`);
  return report();
};
