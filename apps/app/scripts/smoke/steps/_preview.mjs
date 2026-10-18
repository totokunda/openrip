// From the home screen into the editor, on the project the app had open last (its card is
// marked active), or the first card. Waits until the editor shows. Nothing when it already does.
export const openEditor = async (win) => {
  await win.waitForSelector("[data-testid=home], [data-testid=editor]", { timeout: 60000 });
  if (await win.locator("[data-testid=editor]").count()) return;
  const active = win.locator("[data-testid=project-card][data-active=true] button[title^='Open ']");
  const card = (await active.count()) ? active.first() : win.locator("[data-testid=project-card] button[title^='Open ']").first();
  await card.click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(1500);
};
// Back to the home screen by the top bar's Home button.
export const goHome = async (win) => {
  await win.locator("[data-testid=go-home]").click();
  await win.waitForSelector("[data-testid=home]", { timeout: 20000 });
  await win.waitForTimeout(500);
};
// The preview stage: the largest canvas in the player (in the upper half of the window
// without one; off-screen canvases for thumbnails and text measuring are left out).
export const previewRect = async (win) => win.evaluate(() => {
  const root = document.querySelector("[data-testid=player]") ?? document;
  const cs = [...root.querySelectorAll("canvas")].map((c) => c.getBoundingClientRect()).filter((r) => r.y >= 0 && r.x >= 0 && r.y < window.innerHeight * 0.5 && r.width > 200);
  cs.sort((a, b) => b.width * b.height - a.width * a.height);
  const r = cs[0];
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
// The timeline: the largest canvas in the timeline panel (in the lower part of the window
// without one); its ruler is the top strip.
export const timelineRect = async (win) => win.evaluate(() => {
  const root = document.querySelector("[data-testid=timeline]") ?? document;
  const cs = [...root.querySelectorAll("canvas")].map((c) => c.getBoundingClientRect()).filter((b) => b.x >= 0 && b.y > window.innerHeight * 0.3 && b.width > window.innerWidth * 0.5);
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
// Click one of the inspector's tabs or sub-tabs by its name, if it's there; false if not.
const clickTab = async (win, name) => {
  const at = await win.evaluate((name) => {
    const el = [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].find((e) => (e.innerText || "").trim() === name);
    if (!el) return null;
    el.scrollIntoView({ inline: "center", block: "nearest" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, name);
  if (!at) return false;
  await win.mouse.click(at.x, at.y);
  await win.waitForTimeout(400);
  return true;
};
// Where the panels that steps name by their old tab ("Transform", "Mask") are now: inside the
// clip's first tab (Video, Image, Text, Shape), under a sub-tab.
const NESTED = { Transform: ["Text", "Shape", "Video", "Image"], Mask: ["Video", "Image"], Basic: ["Text", "Shape", "Video", "Image"] };
// Click an inspector tab ("Text", "Animation", "Adjust", …). A tab with sub-tabs opens on its
// first ("Basic"), where its main panel is; "Transform" and "Mask" find their sub-tab
// (a video's transform is in Video ▸ Basic) and "Duration" is a video's Speed.
export const tab = async (win, name) => {
  if (NESTED[name]) {
    for (const parent of NESTED[name]) {
      if (!(await clickTab(win, parent))) continue;
      if (await clickTab(win, name)) return win.waitForTimeout(100);
      if (name === "Transform" && (await clickTab(win, "Basic"))) return win.waitForTimeout(100);
    }
    throw new Error(`no ${name} tab`);
  }
  if (!(await clickTab(win, name)) && !(name === "Duration" && (await clickTab(win, "Speed")))) throw new Error(`no ${name} tab`);
  // Its first sub-tab, where the tab's main panel is.
  await clickTab(win, "Basic");
  await win.waitForTimeout(100);
};
// The timeline toolbar's split button and the player's play button.
export const clickSplit = (win) => win.locator("[data-testid=tool-split]").click();
export const playButton = (win) => win.locator("[data-testid=play]");
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
// The playhead's time in seconds, from the player's time.
export const now = async (win) => {
  const t = win.locator("[data-testid=player-time]");
  return (await t.count()) ? Math.round(+(await t.getAttribute("data-time")) * 1000) / 1000 : NaN;
};
// Seconds to ruler x, measured by clicking the ruler at two places and reading the clock.
// A click lands on the nearest frame, so the two clicks alone leave the map up to half a frame
// off; the x where the frame after s1 begins is half a frame past s1, found to a quarter pixel
// (each probe clicks away first: a click on the playhead's handle doesn't seek).
export const rulerMap = async (win, x1 = 100, x2 = 500) => {
  const tl = await timelineRect(win);
  const y = tl.y + 12;
  const at = async (x, away = true) => {
    if (away) {
      await win.mouse.click(tl.x + x + 40, y);
      await win.waitForTimeout(150);
    }
    await win.mouse.click(tl.x + x, y);
    await win.waitForTimeout(away ? 250 : 500);
    return now(win);
  };
  const s1 = await at(x1, false);
  const s2 = await at(x2, false);
  const pps = (x2 - x1) / (s2 - s1);
  let [lo, hi] = [x1, x1 + 2 * (pps / 24) + 2];
  let next = await at(hi);
  if (!(next > s1)) return { y, pps, x: (s) => tl.x + x1 + (s - s1) * pps };
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2;
    const t = await at(mid);
    if (t > s1) [hi, next] = [mid, Math.min(next, t)];
    else lo = mid;
  }
  const edge = (lo + hi) / 2;
  const half = (s1 + next) / 2;
  return { y, pps, x: (s) => tl.x + edge + (s - half) * pps };
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
