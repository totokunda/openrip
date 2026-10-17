// The preview stage: the largest canvas in the upper half of the window.
export const previewRect = async (win) => win.evaluate(() => {
  const cs = [...document.querySelectorAll("canvas")].map((c) => c.getBoundingClientRect()).filter((r) => r.y < window.innerHeight * 0.5 && r.width > 200);
  cs.sort((a, b) => b.width * b.height - a.width * a.height);
  const r = cs[0];
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
// The timeline: the largest canvas in the lower part of the window; its ruler is the top strip.
export const timelineRect = async (win) => win.evaluate(() => {
  const cs = [...document.querySelectorAll("canvas")].map((c) => c.getBoundingClientRect()).filter((b) => b.y > window.innerHeight * 0.6 && b.width > 300);
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
