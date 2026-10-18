// CapCut's other timeline keys (after import timeline newtext: the text 0–3 s over the clip):
// ← / → a frame, ⇧ ten; Home / End; ↓ / ↑ the next and previous edit; Space plays and pauses;
// ⌘= zooms the timeline in (not the page), ⇧Z back to fit; the playhead's handle let go stays
// on its frame at every zoom; ] selects what ends after the playhead, ⌘A everything (each
// checked by deleting it, then undone).
import { now, rulerMap, seek } from "./_preview.mjs";
import { checks, select } from "./_anim.mjs";
import { openTab, typeInto } from "./_undo.mjs";
import { doc, fpsOf, key } from "./_timeline.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  const d = await doc(ctx);
  const fps = fpsOf(d);
  const close = (a, b) => Math.abs(a - b) < 0.011;

  await seek(win, map, 2);
  await key(win, "ArrowRight");
  const a = await now(win);
  await key(win, "ArrowLeft");
  const b = await now(win);
  await key(win, "Shift+ArrowRight");
  const c = await now(win);
  check("← / → step a frame, ⇧→ ten", close(a, 2 + 1 / fps) && close(b, 2) && close(c, 2 + 10 / fps), `${a}, ${b}, ${c}`);

  await key(win, "End");
  const end = await now(win);
  await key(win, "Home");
  const home = await now(win);
  check("Home and End go to the start and the end", home === 0 && end > 11, `${home}, ${end}`);

  await key(win, "ArrowDown");
  const e1 = await now(win);
  await key(win, "ArrowDown");
  const e2 = await now(win);
  await key(win, "ArrowUp");
  const e3 = await now(win);
  check("↓ / ↑ go to the next and previous edit", e1 === 3 && e2 > 11 && e3 === 3, `${e1}, ${e2}, ${e3}`);

  await seek(win, map, 0);
  await win.keyboard.press("Space");
  await win.waitForTimeout(1500);
  await win.keyboard.press("Space");
  await win.waitForTimeout(500);
  const played = await now(win);
  await win.waitForTimeout(500);
  check("Space plays and pauses", played > 0.5 && (await now(win)) === played, `at ${played} s`);

  // Zoom: the ruler's scale, and the page's.
  const dpr = await win.evaluate(() => devicePixelRatio);
  await key(win, "Meta+=");
  await key(win, "Meta+=");
  const zoomed = await rulerMap(win);
  check("⌘= zooms the timeline in, not the page", zoomed.pps > map.pps * 1.2 && (await win.evaluate(() => devicePixelRatio)) === dpr, `${map.pps.toFixed(1)} → ${zoomed.pps.toFixed(1)} px/s`);
  await key(win, "Shift+z");
  const fit = await rulerMap(win);
  check("⇧Z zooms the timeline to fit", Math.abs(fit.pps - map.pps) < 1, `${fit.pps.toFixed(1)} px/s`);
  ctx.map = fit;

  // ] at 5 s: only the video ends after it.
  await seek(win, fit, 5);
  await key(win, "]");
  await key(win, "Backspace");
  let left = (await doc(ctx)).timeline.clips.map((c) => c.type);
  check("] selects the clips ending after the playhead", left.join(",") === "text", left.join(","));
  await key(win, "Meta+z");
  await key(win, "Meta+a");
  await key(win, "Backspace");
  left = (await doc(ctx)).timeline.clips.map((c) => c.type);
  check("⌘A selects every clip", left.length === 0, left.join(","));
  await key(win, "Meta+z");

  // The playhead's handle pressed and let go without moving stays on its frame at every zoom.
  // It used to jump to the ruler's tick grid, which on a long timeline is two frames or more
  // apart when zoomed in: so first a long one (the clip at 0.1x, pasted four more times, about
  // 10 minutes).
  let d2 = await doc(ctx);
  const video = d2.timeline.clips.find((c) => c.type === "video");
  await select(ctx, d2, video.clipId, 1);
  await openTab(win, "Duration");
  await typeInto(win, "Speed", 0.1);
  await key(win, "Meta+c");
  for (let i = 0; i < 4; i++) {
    await key(win, "End");
    await key(win, "Meta+v");
  }
  await key(win, "Shift+z");
  d2 = await doc(ctx);
  const long = Math.max(...d2.timeline.clips.map((c) => +c.endTick)) / 1e6;
  const handle = () =>
    win.evaluate(() => {
      const el = document.querySelector("[data-testid=playhead-handle]");
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
  const moved = [];
  await key(win, "Home");
  for (let i = 0; i < 48; i++) await win.keyboard.press("ArrowRight");
  // Three frames in a row at each level: on a grid of two, one at least is off it.
  for (let level = 2; level <= 10; level++) {
    await key(win, "Meta+=");
    for (let k = 0; k < 3; k++) {
      await key(win, "ArrowRight");
      const before = await now(win);
      const h = await handle();
      await win.mouse.move(h.x, h.y);
      await win.mouse.down();
      await win.mouse.up();
      await win.waitForTimeout(400);
      const after = await now(win);
      if (after !== before) moved.push(`level ${level}: ${before} → ${after}`);
    }
  }
  check("the playhead's handle let go stays on its frame at every zoom", long > 500 && moved.length === 0, `${long.toFixed(0)} s long; ${moved.join(", ") || "27 presses at 9 levels"}`);
  await key(win, "Shift+z");
  return report();
};
