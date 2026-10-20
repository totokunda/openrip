// The timeline's zoom range (after `import timeline`; `~/Downloads/IMG_9079.MOV` with
// CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1; docs/plan/capcut-ui-spec.md §6.26, shots
// `30-timeline-toolbar/035-timeline-zoom-minimum.png` and `036-timeline-zoom-maximum.png`):
// - ⇧Z (zoom to fit) puts the whole timeline in view, the clip about 60% of it; the fit button is on;
// - zoomed all the way out (⌘− nine times) about two minutes fill the view (CapCut's minimum shows
//   2:00 over a short project), wider than the fit; the fit button is off; zoom out is greyed;
// - zoomed all the way in (⌘= nine times) a few frames fill the view: one frame is more than 150 px
//   wide (CapCut's closest view has about 6.6 frames across; ours 5), and the ruler's labels are frames;
// - ⇧Z from there is the fit again (the button on); pressed again, back to the zoom it was;
// - Extend / Reduce timeline (the toolbar's ladder buttons) only act while the whole timeline is in view.
// Shots: `zr1-fit`, `zr2-min` ↔ 035, `zr3-max` ↔ 036.
import { rulerMap, timelineRect, seek } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { key } from "./_timeline.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const doc = await savedProject(win, udDir);
  const fps = doc.settings?.fps || 24;
  const clipS = Math.max(...doc.timeline.clips.map((c) => +c.endTick / 1e6));
  const width = (await timelineRect(win)).w;
  const fitOn = async () => (await win.locator('[role=switch][title^="Zoom timeline to fit"]').getAttribute("aria-checked")) === "true";
  const seconds = async () => {
    const m = await rulerMap(win);
    return { m, s: (width - 0) / m.pps };
  };

  await seek(win, ctx.map ?? (ctx.map = await rulerMap(win)), 0);
  await key(win, "Shift+z");
  const fit = await seconds();
  check("zoom to fit shows the whole timeline, the clip about 60% of it", Math.abs(fit.s - (clipS * 5) / 3) < 2.5, `${fit.s.toFixed(1)} s across for a ${clipS.toFixed(1)} s clip`);
  await shot("zr1-fit");
  check("the fit button is on", await fitOn());

  // All the way out.
  for (let i = 0; i < 9; i++) await key(win, "Meta+-");
  await win.waitForTimeout(500);
  const min = await seconds();
  check("zoomed all the way out, about two minutes fill the view", min.s > 105 && min.s < 135, `${min.s.toFixed(1)} s across`);
  check("that's wider than the fit and the fit button is off", min.s > fit.s * 2 && !(await fitOn()), `${min.s.toFixed(1)} vs ${fit.s.toFixed(1)}`);
  await shot("zr2-min"); // 035

  // All the way in.
  for (let i = 0; i < 9; i++) await key(win, "Meta+=");
  await win.waitForTimeout(500);
  await seek(win, min.m, 0).catch(() => {});
  const max = await seconds();
  const framesAcross = max.s * fps;
  check("zoomed all the way in, a few frames fill the view (one frame over 150 px)", framesAcross < 8 && framesAcross > 3 && width / framesAcross > 150, `${framesAcross.toFixed(1)} frames across, ${(width / framesAcross).toFixed(0)} px a frame`);
  await shot("zr3-max"); // 036

  // Fit, and back.
  await key(win, "Shift+z");
  const fit2 = await seconds();
  check("⇧Z from there is the fit again", Math.abs(fit2.s - fit.s) < 1.5, `${fit2.s.toFixed(1)} s`);
  check("and the fit button is on", await fitOn());
  await key(win, "Shift+z");
  const back = await seconds();
  check("⇧Z again goes back to the zoom it was (all the way in)", back.s * fps < 8, `${(back.s * fps).toFixed(1)} frames across`);
  await key(win, "Shift+z");
  ctx.map = await rulerMap(win);
  return report();
};
