// How smoothly the timeline keeps up with a hand (after `import timeline`; either timeline): the
// clip is cut into about 140 pieces (⌘B every two frames), the whole timeline fitted in view,
// then the page's own animation frames are timed while a clip is dragged across, a marquee drawn
// over many clips, and the timeline scrolled with the wheel. Reports, for each, the median and
// 95th-percentile frame time and how many frames took longer than 50 ms (a visible stutter).
import { rulerMap, settled, timelineRect } from "./_preview.mjs";
import { doc, key, mainClips, rowY } from "./_timeline.mjs";

/** Times the page's animation frames while `act` runs: { p50, p95, max, slow } in ms. */
const timed = async (win, act) => {
  await win.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      if (window.__framesOn) requestAnimationFrame(tick);
    };
    window.__framesOn = true;
    requestAnimationFrame(tick);
  });
  await act();
  const frames = await win.evaluate(() => {
    window.__framesOn = false;
    return window.__frames.slice(1);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { frames: frames.length, p50: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), max: +(sorted[sorted.length - 1] ?? 0).toFixed(1), slow: frames.filter((f) => f > 50).length };
};

export default async (ctx) => {
  const { win } = ctx;
  ctx.map ??= await rulerMap(win);
  await key(win, "Home");
  for (let i = 0; i < 140; i++) {
    await win.keyboard.press("ArrowRight");
    await win.keyboard.press("ArrowRight");
    await win.keyboard.press("Meta+b");
  }
  await win.waitForTimeout(1500);
  await key(win, "Shift+z");
  await win.waitForTimeout(1500);
  ctx.map = await rulerMap(win);
  const d = await doc(ctx);
  const clips = mainClips(d);
  const y = await rowY(ctx, d, clips[0].timelineId);
  const tl = await timelineRect(win);
  const fps = d.settings?.fps || 24;
  const mid = clips[Math.floor(clips.length / 2)];
  const midX = ctx.map.x((mid.s + mid.e) / 2 / fps);

  // TLPERF_PROFILE=1: a CPU profile of the drag alone (build the renderer with --minify false for names).
  if (process.env.TLPERF_PROFILE) {
    globalThis.__cdp = await win.context().newCDPSession(win);
    await globalThis.__cdp.send("Profiler.enable");
    await globalThis.__cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await globalThis.__cdp.send("Profiler.start");
  }
  const drag = await timed(win, async () => {
    await win.mouse.move(midX, y);
    await win.mouse.down();
    for (let i = 1; i <= 90; i++) await win.mouse.move(midX + i * 4, y + (i % 20) - 10);
    await win.keyboard.press("Escape");
    await win.mouse.up();
  });
  let profile = "";
  if (process.env.TLPERF_PROFILE) profile = await (await import("./profstop.mjs")).default(ctx);
  const marquee = await timed(win, async () => {
    const x0 = tl.x + 80;
    const y0 = tl.y + tl.h - 20;
    await win.mouse.move(x0, y0);
    await win.mouse.down();
    for (let i = 1; i <= 90; i++) await win.mouse.move(x0 + i * 8, y0 - Math.min(80, i * 2));
    await win.mouse.up();
    await key(win, "Escape");
  });
  const scroll = await timed(win, async () => {
    await win.mouse.move(tl.x + tl.w / 2, y);
    for (let i = 0; i < 60; i++) await win.mouse.wheel(i < 30 ? 25 : -25, 0);
    await win.waitForTimeout(300);
  });
  await settled(win, () => key(win, "Shift+z"));
  const line = (name, r) => `${name}: ${r.frames} frames, median ${r.p50} ms, 95% ${r.p95} ms, longest ${r.max} ms, ${r.slow} over 50 ms`;
  return `${clips.length} clips. ${line("drag", drag)}; ${line("marquee", marquee)}; ${line("scroll", scroll)}${profile}`;
};
