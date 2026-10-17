// Measure the open project: playhead seeks and a scrub drag, playback smoothness, and how long
// an edit takes to reach the picture, with the renderer's long tasks (stalls over 50 ms).
import { previewRect, timelineRect, drag } from "./_preview.mjs";

const stats = (xs) => {
  if (!xs.length) return "n/a";
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `p50 ${q(0.5).toFixed(0)} p95 ${q(0.95).toFixed(0)} max ${s[s.length - 1].toFixed(0)}`;
};

export default async ({ win, outDir, fs }) => {
  await win.evaluate(() => {
    const w = window;
    w.__perf = { frames: [], longtasks: [] };
    const c = document.getElementById("openrip-engine-frame");
    c.addEventListener("openrip-engine-frame", (e) => w.__perf.frames.push([performance.now(), e.detail?.timeUs ?? -1]));
    new PerformanceObserver((l) => l.getEntries().forEach((en) => w.__perf.longtasks.push([en.startTime, en.duration]))).observe({ entryTypes: ["longtask"] });
  });
  const now = () => win.evaluate(() => performance.now());
  const since = (t0) => win.evaluate((t0) => ({ frames: window.__perf.frames.filter((f) => f[0] >= t0), long: window.__perf.longtasks.filter((l) => l[0] >= t0) }), t0);
  const blocked = (long) => long.reduce((a, l) => a + l[1], 0);
  const out = {};
  const tl = await timelineRect(win);
  const rulerY = tl.y + 12;

  // Seeks: click the ruler at eight places; time from the click to the first new frame.
  const seekLat = [];
  for (let i = 0; i < 8; i++) {
    const x = tl.x + 40 + ((i * 0.37) % 1) * (tl.w * 0.85);
    const t0 = await now();
    await win.mouse.click(x, rulerY);
    let lat = null;
    for (let k = 0; k < 60 && lat === null; k++) {
      await win.waitForTimeout(25);
      const f = (await since(t0)).frames;
      if (f.length) lat = f[0][0] - t0;
    }
    seekLat.push(lat ?? 1500);
    await win.waitForTimeout(300);
  }
  out.seek = `click → frame ms ${stats(seekLat)}`;

  // Scrub: playhead near the start, then drag its handle across 80% of the timeline in 2 s.
  {
    await win.mouse.click(tl.x + 40, rulerY);
    await win.waitForTimeout(800);
    const h = await win.evaluate(() => {
      const el = [...document.querySelectorAll("div.cursor-col-resize")].find((d) => d.className.includes("z-50"));
      const r = el.firstElementChild.firstElementChild.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await win.mouse.move(h.x, h.y);
    await win.mouse.down();
    const t0 = await now();
    // Moves at the display's rate, as a hand drags (Playwright's own moves are slow).
    await win.evaluate(({ x0, y, dx }) => new Promise((done) => {
      const start = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - start) / 2000);
        document.dispatchEvent(new MouseEvent("mousemove", { clientX: x0 + p * dx, clientY: y, bubbles: true }));
        if (p < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    }), { x0: h.x, y: h.y, dx: tl.w * 0.8 });
    await win.mouse.move(h.x + tl.w * 0.8, h.y);
    await win.mouse.up();
    await win.waitForTimeout(800);
    const { frames, long } = await since(t0);
    const dur = (frames.length ? frames[frames.length - 1][0] : t0) - t0;
    const gaps = frames.slice(1).map((f, i) => f[0] - frames[i][0]);
    out.scrub = `${frames.length} frames over ${(dur / 1000).toFixed(1)} s (${(frames.length / Math.max(dur / 1000, 0.001)).toFixed(0)}/s), gaps ms ${stats(gaps)}, renderer blocked ${blocked(long).toFixed(0)} ms in ${long.length} long tasks`;
  }

  // Playback from the start for 8 s.
  {
    await win.mouse.click(tl.x + 20, rulerY);
    await win.waitForTimeout(800);
    const play = (await win.evaluate(() => [...document.querySelectorAll("svg")].filter((el) => (el.getAttribute("class") || "").includes("text-brand-light/70 h-7 w-7")).map((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })))[0];
    const t0 = await now();
    await win.mouse.click(play.x, play.y);
    await win.waitForTimeout(8000);
    await win.mouse.click(play.x, play.y);
    const { frames, long } = await since(t0);
    const settled = frames.filter((f) => f[0] > t0 + 500);
    const gaps = settled.slice(1).map((f, i) => f[0] - settled[i][0]);
    const span = settled.length > 1 ? (settled[settled.length - 1][0] - settled[0][0]) / 1000 : 0;
    const mediaSpan = settled.length > 1 ? (settled[settled.length - 1][1] - settled[0][1]) / 1e6 : 0;
    out.play = `${(settled.length / Math.max(span, 0.001)).toFixed(1)} frames/s shown, media ${mediaSpan.toFixed(2)} s in ${span.toFixed(2)} s, gaps ms ${stats(gaps)}, ${gaps.filter((g) => g > 100).length} gaps over 100 ms, renderer blocked ${blocked(long).toFixed(0)} ms in ${long.length} long tasks`;
  }

  // Edit: drag whatever is in the middle of the preview; time from mouse-up to the next frame.
  {
    await win.mouse.click(tl.x + 20 + tl.w * 0.1, rulerY);
    await win.waitForTimeout(800);
    const r = await previewRect(win);
    await win.keyboard.press("v");
    await drag(win, r.x + r.w * 0.5, r.y + r.h * 0.6, r.x + r.w * 0.58, r.y + r.h * 0.6);
    const t0 = await now();
    let lat = null;
    for (let k = 0; k < 120 && lat === null; k++) {
      await win.waitForTimeout(25);
      const f = (await since(t0)).frames;
      if (f.length) lat = f[0][0] - t0;
    }
    await win.waitForTimeout(1500);
    const { long } = await since(t0);
    out.edit = `mouse-up → frame ${lat === null ? "none in 3 s" : lat.toFixed(0) + " ms"}, renderer blocked ${blocked(long).toFixed(0)} ms after`;
    await win.keyboard.press("Meta+z");
  }

  fs.writeFileSync(`${outDir}/perf.json`, JSON.stringify(out, null, 2));
  return "\n  " + Object.entries(out).map(([k, v]) => `${k}: ${v}`).join("\n  ");
};
