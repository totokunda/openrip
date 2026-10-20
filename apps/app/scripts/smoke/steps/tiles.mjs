// The Transitions and Effects tabs' tile pictures: real footage with the transition or effect
// drawn on it by the engine, made the first time a tile is on screen and kept in the rendering
// cache (any editor, OPENRIP_ENGINE_MUTE=1, built app; no import needed):
// - a tile shows a soft loading state, then its picture (footage, not the old drawing); the
//   visible ones are all drawn, the first-render time and the cache's size are reported;
// - scrolling through every category / the whole list draws the rest while frames keep moving;
// - a hovered tile plays its loop, and rests on its still again;
// - the folder is inside the rendering cache Settings counts (its size includes the tiles);
// - after a restart the pictures come from the cache: no file is written again, and they are
//   there at once.
// Shots: `tp1-transitions`, `tp2-effects` (↔ 10-left-transitions/001, 09-left-effects/001).
import path from "node:path";
import { checks } from "./_anim.mjs";
import { openSettingsFromEditor, settingsTab } from "./_settings.mjs";
import { canvasHash, tileCache, tilesReady } from "./_tiles.mjs";

const TABS = [
  { id: "transitions", picture: "[data-testid=transition-picture]", shot: "tp1-transitions" },
  { id: "effects", picture: "[data-testid=effect-picture]", shot: "tp2-effects" },
];

/**
 * Scroll the grid to its end in steps, waiting for each step's tiles to be drawn, while a frame
 * loop records the longest gap between two frames (a stall shows as a long one).
 */
const scrollThrough = async (win, picture) => {
  const area = `[...document.querySelectorAll("[data-radix-scroll-area-viewport]")].find((e) => e.scrollHeight > e.clientHeight + 50 && e.closest("[data-testid=assets]"))`;
  const has = await win.evaluate(`(() => {
    const area = ${area};
    if (!area) return false;
    window.__worstGap = 0;
    window.__gapStop = false;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__worstGap = Math.max(window.__worstGap, now - last);
      last = now;
      if (!window.__gapStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
  if (!has) return { scrolled: false, worst: 0, timedOut: false };
  let timedOut = false;
  for (let i = 1; i <= 16; i++) {
    await win.evaluate(`(() => { const area = ${area}; area.scrollTop = ((area.scrollHeight - area.clientHeight) * ${i}) / 16; })()`);
    await win.waitForTimeout(100);
    if ((await tilesReady(win, picture)).timedOut) timedOut = true;
  }
  const worst = await win.evaluate(() => {
    window.__gapStop = true;
    return Math.round(window.__worstGap);
  });
  return { scrolled: true, worst, timedOut };
};

export default async (ctx) => {
  const { fs, udDir } = ctx;
  const { check, report } = checks();
  let win = ctx.win;
  const first = {};

  for (const tab of TABS) {
    await win.locator(`[data-testid=assets-tab-${tab.id}]`).click();
    await win.waitForTimeout(150);
    const loading = await win.locator("[data-testid=tile-loading]").count();
    const ready = await tilesReady(win, tab.picture);
    first[tab.id] = ready;
    check(`${tab.id}: tiles show a loading state, then every visible one is drawn`, loading > 0 && !ready.timedOut, `loading ${loading}; ${JSON.stringify(ready)}`);
    const hashes = [];
    for (let i = 0; i < Math.min(8, ready.total); i++) hashes.push(await canvasHash(win.locator(tab.picture).nth(i)));
    check(`${tab.id}: the tiles hold footage (varied pictures, each its own)`, hashes.every((h) => h.spread > 30) && new Set(hashes.map((h) => h.sum)).size >= 6, JSON.stringify(hashes.map((h) => h.sum)));
    await win.mouse.move(5, 5);
    await win.waitForTimeout(300);
    await ctx.shot(tab.shot);

    // Hover: the loop plays.
    const canvas = win.locator(tab.picture).nth(2);
    const still = await canvasHash(canvas);
    await canvas.hover();
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      seen.add((await canvasHash(canvas)).sum);
      await win.waitForTimeout(40);
    }
    check(`${tab.id}: a hovered tile plays its loop`, seen.size >= 5, `${seen.size} frames`);
    await win.mouse.move(5, 5);
    await win.waitForTimeout(400);
    check(`${tab.id}: left, it rests on its still`, (await canvasHash(canvas)).sum === still.sum);

    // The rest: every category (transitions), or the whole list scrolled (effects).
    let worst = 0;
    let complete = true;
    const t0 = Date.now();
    if (tab.id === "transitions") {
      const ids = (await win.locator("[data-testid=assets] nav[aria-label=Sections] [data-testid^=assets-section-]").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-testid")))).filter((id) => !id.endsWith("favorites"));
      for (const id of ids) {
        await win.locator(`[data-testid="${id}"]`).click();
        await win.waitForTimeout(150);
        const r = await tilesReady(win, tab.picture);
        const s = await scrollThrough(win, tab.picture);
        if (r.timedOut || s.timedOut) complete = false;
        worst = Math.max(worst, s.worst);
      }
    } else {
      const s = await scrollThrough(win, tab.picture);
      complete = s.scrolled && !s.timedOut;
      worst = s.worst;
    }
    first[`${tab.id}All`] = Date.now() - t0;
    check(`${tab.id}: scrolling through all the tiles draws them, frames kept moving`, complete && worst < 250, `${first[`${tab.id}All`]} ms, longest frame gap ${worst} ms`);
  }

  const dir = path.join(udDir, "engine-thumbnails", "tile-previews");
  const cache = tileCache(fs, path, udDir);
  const names = fs.readdirSync(dir);
  check("every tile has its sheet in the rendering cache (one JPEG each)", cache.files >= 190 && names.every((n) => n.endsWith(".jpg")), `${cache.files} files, ${(cache.bytes / 1024).toFixed(0)} KB (${(cache.bytes / cache.files / 1024).toFixed(0)} KB each)`);
  const mtimes = Object.fromEntries(names.map((n) => [n, fs.statSync(path.join(dir, n)).mtimeMs]));

  // Settings' rendering cache size counts them.
  await openSettingsFromEditor(win);
  await settingsTab(win, "performance");
  await win.waitForTimeout(500);
  const bytes = +(await win.locator("[data-testid=settings-render-cache-size]").getAttribute("data-bytes"));
  check("Settings' rendering cache size includes the tiles", bytes >= cache.bytes, `${bytes} >= ${cache.bytes}`);
  await win.locator("[data-testid=settings-cancel]").click();

  // A restart: the pictures come back from the cache, nothing is drawn again.
  const name = await win.locator("[data-testid=project-name]").inputValue();
  ({ win } = await ctx.relaunch());
  await win.locator("[data-testid=project-card]").filter({ has: win.getByText(name, { exact: true }) }).first().locator("button[title^='Open ']").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(2000);
  for (const tab of TABS) {
    await win.locator(`[data-testid=assets-tab-${tab.id}]`).click();
    const ready = await tilesReady(win, tab.picture);
    check(`${tab.id}: after a restart the pictures come from the cache`, !ready.timedOut && ready.ms < Math.max(3000, first[tab.id].ms / 2), `${ready.ms} ms against ${first[tab.id].ms} ms the first time`);
  }
  const rewritten = fs.readdirSync(dir).filter((n) => mtimes[n] !== undefined && fs.statSync(path.join(dir, n)).mtimeMs !== mtimes[n]);
  check("no picture was drawn and written again", rewritten.length === 0, `${rewritten.length} rewritten`);
  return `${report()}; first render of the visible tiles: transitions ${first.transitions.ms} ms (${first.transitions.total}), effects ${first.effects.ms} ms (${first.effects.total}); every tile ${first.transitionsAll} + ${first.effectsAll} ms; cache ${cache.files} files, ${(cache.bytes / 1024).toFixed(0)} KB`;
};
