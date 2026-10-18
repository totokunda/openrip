// The preview stage: the largest canvas in the upper half of the window.
export const previewRect = async (win) => win.evaluate(() => {
  const cs = [...document.querySelectorAll("canvas")].map((c) => c.getBoundingClientRect()).filter((r) => r.y < window.innerHeight * 0.5 && r.width > 200);
  cs.sort((a, b) => b.width * b.height - a.width * a.height);
  const r = cs[0];
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
// The timeline: the largest canvas in the lower part of the window (as wide as it, unlike the
// preview); its ruler is the top strip.
export const timelineRect = async (win) => win.evaluate(() => {
  const cs = [...document.querySelectorAll("canvas")].map((c) => c.getBoundingClientRect()).filter((b) => b.y > window.innerHeight * 0.3 && b.width > window.innerWidth * 0.75);
  cs.sort((p, q) => q.width * q.height - p.width * p.height);
  const b = cs[0];
  return { x: b.x, y: b.y, w: b.width, h: b.height };
});
export const drag = async (win, x0, y0, x1, y1) => {
  await win.mouse.move(x0, y0);
  await win.mouse.down();
  await win.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 8 });
  await win.mouse.move(x1, y1, { steps: 8 });
  await win.mouse.up();
};
// The engine's current frame: a hash, mean lightness, and a count of pixels `test` accepts.
export const engineFrame = (win, test = "false") => win.evaluate((test) => {
  const c = document.getElementById("openrip-engine-frame");
  const t = document.createElement("canvas");
  t.width = c.width; t.height = c.height;
  const g = t.getContext("2d");
  g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, t.width, t.height).data;
  const pick = new Function("r", "g", "b", `return ${test};`);
  let sum = 0, light = 0, count = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum = (sum * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) % 1000000007;
    light += (d[i] + d[i + 1] + d[i + 2]) / 765;
    if (pick(d[i], d[i + 1], d[i + 2])) count++;
  }
  return { sum, light: light / (d.length / 4), count, w: t.width, h: t.height };
}, test);
// Click a properties tab ("Text", "Animation", …).
export const tab = async (win, name) => {
  const at = await win.evaluate((name) => {
    const el = [...document.querySelectorAll("[role=tab]")].find((e) => (e.innerText || "").trim() === name);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, name);
  if (!at) throw new Error(`no ${name} tab`);
  await win.mouse.click(at.x, at.y);
  await win.waitForTimeout(500);
};
// Make the timeline as tall as the layout allows (its handle dragged up), so deep tracks show.
export const tallTimeline = async (win) => {
  for (let tries = 0; tries < 3; tries++) {
    const h = await win.evaluate(() => {
      const el = [...document.querySelectorAll("[data-panel-resize-handle-id]")].map((e) => e.getBoundingClientRect()).find((r) => r.width > 600);
      return el ? { x: el.x + el.width / 2, y: el.y + el.height / 2 } : null;
    });
    if (!h) throw new Error("no timeline handle");
    await drag(win, h.x, h.y, h.x, 0);
    // Until the timeline stops moving: steps measure it.
    let r;
    for (let last = "", i = 0; i < 20; i++) {
      await win.waitForTimeout(400);
      r = await timelineRect(win);
      if (JSON.stringify(r) === last) break;
      last = JSON.stringify(r);
    }
    // The layout lets it take most of the window (the panels above keep 30%).
    if (r.h > (await win.evaluate(() => innerHeight)) * 0.55) return;
  }
  throw new Error("the timeline didn't grow");
};
// Engine frames as they're drawn: window.__frames gets [time, timeUs] for each.
const watchFrames = (win) => win.evaluate(() => {
  if (window.__frames) return;
  window.__frames = [];
  document.getElementById("openrip-engine-frame").addEventListener("openrip-engine-frame", (e) => window.__frames.push([performance.now(), e.detail?.timeUs ?? -1]));
});
// Do `action`, then wait for the engine's picture to settle: a frame drawn after it, then none
// for `quiet` ms. False if no frame came within `timeout` ms (nothing changed).
export const settled = async (win, action, { quiet = 500, timeout = 4000 } = {}) => {
  await watchFrames(win);
  const t0 = await win.evaluate(() => performance.now());
  await action();
  const start = Date.now();
  for (;;) {
    await win.waitForTimeout(100);
    const s = await win.evaluate((t0) => {
      const f = window.__frames.filter((x) => x[0] > t0);
      return { n: f.length, since: f.length ? performance.now() - f[f.length - 1][0] : 0 };
    }, t0);
    if (s.n && s.since >= quiet) return true;
    if (Date.now() - start > timeout) return s.n > 0;
  }
};
// The playhead's time in seconds, from the clock.
export const now = async (win) => {
  const c = (await win.locator("body").innerText()).match(/(\d\d):(\d\d\.\d\d)\s*\/\s*\d\d:\d\d\.\d\d/);
  return c ? +c[1] * 60 + +c[2] : NaN;
};
// Seconds to ruler x, measured by clicking the ruler at two places and reading the clock.
export const rulerMap = async (win, x1 = 100, x2 = 500) => {
  const tl = await timelineRect(win);
  const y = tl.y + 12;
  await win.mouse.click(tl.x + x1, y);
  await win.waitForTimeout(500);
  const s1 = await now(win);
  await win.mouse.click(tl.x + x2, y);
  await win.waitForTimeout(500);
  const s2 = await now(win);
  const pps = (x2 - x1) / (s2 - s1);
  return { y, pps, x: (s) => tl.x + x1 + (s - s1) * pps };
};
// Move the playhead to `s` seconds (clicking the ruler) and wait for the engine's frame. A
// pixel of ruler can be more than a frame: more than half a frame off (at 24 fps), it steps
// the rest a frame at a time with ← / →. (A second click would land next to the playhead,
// on its line, which takes the click as a grab of the playhead.) Times should fall on frames.
export const seek = async (win, map, s) => {
  if (Math.abs(s - (await now(win))) < 0.022) return;
  await settled(win, () => win.mouse.click(Math.max(map.x(0) - 4, map.x(s)), map.y));
  await win.evaluate(() => document.activeElement?.blur?.());
  for (let i = 0; i < 12; i++) {
    const off = s - (await now(win));
    if (Math.abs(off) < 0.022) return;
    await settled(win, () => win.keyboard.press(off > 0 ? "ArrowRight" : "ArrowLeft"), { quiet: 300, timeout: 2000 });
  }
};
// Keep the engine's current frame under `name`, for `diff`.
export const grab = (win, name) => win.evaluate((name) => {
  const c = document.getElementById("openrip-engine-frame");
  const t = document.createElement("canvas");
  t.width = c.width; t.height = c.height;
  const g = t.getContext("2d");
  g.drawImage(c, 0, 0);
  (window.__grabs ??= {})[name] = g.getImageData(0, 0, t.width, t.height);
}, name);
// How many pixels differ (by more than `tol` in a channel) between two grabbed frames, and
// the mean lightness of the second.
export const diff = (win, a, b, tol = 8) => win.evaluate(({ a, b, tol }) => {
  const [x, y] = [window.__grabs[a].data, window.__grabs[b].data];
  let n = 0, light = 0;
  for (let i = 0; i < x.length; i += 4) {
    if (Math.abs(x[i] - y[i]) > tol || Math.abs(x[i + 1] - y[i + 1]) > tol || Math.abs(x[i + 2] - y[i + 2]) > tol) n++;
    light += (y[i] + y[i + 1] + y[i + 2]) / 765;
  }
  return { n, light: light / (y.length / 4) };
}, { a, b, tol });
