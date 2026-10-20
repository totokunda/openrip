// Render (pre-rendered chunks of the timeline), after import timeline (CLIP_NAME=IMG_9079
// OPENRIP_ENGINE_MUTE=1, built app, no dev server; run it alone on a fresh profile):
// - the clip menu's Render › Whole timeline, In, Out (both greyed with no range), Delete rendering
//   cache; three effects are put on the clip first, so the preview has real work to do;
// - Whole timeline: the processing pill with a rising percentage and Cancel; when it ends the
//   engine lists the whole timeline as rendered, the cache folder holds chunk files and the
//   ruler shows the thin bar over the rendered part;
// - a rendered frame is the composited one within the intermediate's compression (the engine's
//   frame with chunks and without, mean difference of the 200 px pictures), and takes its
//   pixels from a chunk (the engine counts the hits);
// - playback of the heavy stretch from chunks: the engine's own milliseconds per frame, with and
//   without them;
// - an edit (a fourth effect at 8 s) takes its chunks off the bar and leaves the others; undoing
//   it brings them back (a chunk is keyed by what it shows);
// - Range › In and Out (I and O) then Render › In: only the range's chunks are made; Out makes
//   the rest;
// - Cancel stops a render with the finished chunks kept;
// - Delete rendering cache empties the folder and the bar;
// - after a restart the chunks still valid are rendered still (the index is kept), and Settings ›
//   Performance › Clear (the rendering cache) forgets them and clears the bar.
import path from "node:path";
import { engineFrame, rulerMap, seek, settled, sectionButton, timelineRect, playButton } from "./_preview.mjs";
import { bar, checks, savedProject } from "./_anim.mjs";
import { doc, key, mainClips } from "./_timeline.mjs";

const call = (win, name, ...args) => win.evaluate(({ n, a }) => window[btoa(n)](...a), { n: name, a: args });

// The engine's frame as a grey 200 px picture and as an array of its RGB.
const picture = (win) =>
  win.evaluate(() => {
    const c = document.getElementById("openrip-engine-frame");
    const W = 200;
    const h = Math.round((c.height * W) / c.width);
    const t = document.createElement("canvas");
    t.width = W;
    t.height = h;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0, W, h);
    window.__last = t.toDataURL("image/png");
    return Array.from(g.getImageData(0, 0, W, h).data);
  });
const lastPicture = (win) => win.evaluate(() => window.__last.split(",")[1]);
const meanDiff = (a, b) => {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      s += Math.abs(a[i + k] - b[i + k]);
      n++;
    }
  }
  return s / n;
};

export default async (ctx) => {
  const { app, win, shot, udDir, fs } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  const cacheDir = path.join(udDir, "engine-thumbnails", "prerender");
  const chunkFiles = () => (fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.endsWith(".mov")) : []);
  const ranges = async () => (await call(win, "engineRenderedRanges")).map(([a, b]) => [a / 1e6, b / 1e6]);
  const covered = (rs) => rs.reduce((s, [a, b]) => s + (b - a), 0);
  const fps = (await doc(ctx)).settings.fps;
  const clip0 = mainClips(await doc(ctx))[0];
  const duration = (+(await doc(ctx)).timeline.clips.find((c) => c.clipId === clip0.clipId).endTick) / 1e6;

  const row = (name) => win.locator("button", { hasText: new RegExp(`^${name}`) }).filter({ hasText: name }).first();
  const openRenderMenu = async () => {
    const sv = await doc(ctx);
    const c = sv.timeline.clips.find((x) => x.clipId === clip0.clipId);
    const [bx, by] = await bar(ctx, sv, clip0.clipId, (+c.startTick + 3 * +c.endTick) / 4e6);
    await win.mouse.click(bx, by, { button: "right" });
    await win.waitForTimeout(450);
    await row("Render").hover();
    await win.waitForTimeout(300);
  };
  const pick = async (name) => {
    await openRenderMenu();
    await win.locator(`[data-testid=menu-render-${name}]`).click();
  };
  const pill = win.locator("[data-testid=render-pill]");
  const waitRendered = async (timeout = 180000) => {
    await pill.waitFor({ timeout: 15000 }).catch(() => {});
    await pill.waitFor({ state: "detached", timeout });
    await win.waitForTimeout(500);
  };

  // The ruler's blue bar: a pixel the colour of the bar in the ruler's foot at a time.
  const barAt = async (s) => {
    const tl = await timelineRect(win);
    const buf = await win.screenshot({ clip: { x: map.x(s), y: tl.y, width: 2, height: 30 } });
    return win.evaluate(async (b64) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 2] - d[i] > 70 && d[i + 2] > 170 && d[i + 1] > 110) return true;
      return false;
    }, buf.toString("base64"));
  };

  // Three effects on the clip: work for the compositor.
  await win.locator("[data-testid=assets-tab-effects]").click();
  await win.waitForTimeout(2500);
  await seek(win, map, 0.2);
  for (const id of ["sketch", "old_film", "pixel_sort"]) {
    const t = win.locator(`[data-effect=${id}]`);
    await t.scrollIntoViewIfNeeded();
    await t.hover();
    await settled(win, () => t.locator("[data-testid=effect-add]").click());
  }
  await win.waitForTimeout(1500);

  // ---- the menu ----
  await openRenderMenu();
  const names = await win.locator("[data-testid^=menu-render-]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-testid").slice(5), text: e.innerText.trim(), off: e.disabled })));
  check("Render › Whole timeline, In, Out, Delete rendering cache", names.map((n) => n.text).join("|") === "Whole timeline|In|Out|Delete rendering cache", JSON.stringify(names.map((n) => n.text)));
  check("In and Out are greyed with no range", names.find((n) => n.text === "In")?.off && names.find((n) => n.text === "Out")?.off);
  await shot("r1-render-menu");
  await win.keyboard.press("Escape");

  // ---- Whole timeline ----
  check("nothing is rendered at first", (await ranges()).length === 0 && chunkFiles().length === 0);
  await pick("whole");
  // Progress rises while it renders.
  const seen = [];
  await pill.waitFor({ timeout: 15000 });
  for (let i = 0; i < 400 && (await pill.count()); i++) {
    const p = await pill.getAttribute("data-progress").catch(() => null);
    if (p != null) seen.push(+p);
    if (seen.length === 4) await shot("r2-rendering");
    await win.waitForTimeout(150);
  }
  await waitRendered();
  check("the pill showed a rising percentage", seen.length >= 2 && seen.at(-1) > seen[0] && seen.every((p, i) => i === 0 || p >= seen[i - 1]), seen.map((p) => p.toFixed(2)).join(" "));
  let rs = await ranges();
  check("the whole timeline is rendered", rs.length === 1 && rs[0][0] === 0 && Math.abs(rs[0][1] - duration) < 0.2, JSON.stringify(rs));
  const files0 = chunkFiles();
  check("the cache folder holds the chunks", files0.length >= Math.floor(duration / 2) && fs.existsSync(path.join(cacheDir, "index.json")), `${files0.length} files`);
  await win.waitForTimeout(500);
  check("the ruler shows the bar over the rendered part", await barAt(Math.min(3, duration / 2)));
  await shot("r3-rendered-bar");

  // ---- a rendered frame is the composited one ----
  const hitsOf = async () => (await call(win, "engineRenderCacheStats")).hits;
  const frameAt = async (s, other) => {
    await seek(win, map, other);
    await win.waitForTimeout(400);
    await seek(win, map, s);
    await win.waitForTimeout(700);
    return picture(win);
  };
  const h0 = await hitsOf();
  const rendered = await frameAt(2.4, 4.6);
  if (process.env.RENDER_DUMP) fs.writeFileSync(path.join(ctx.outDir, "frame-rendered.png"), Buffer.from(await lastPicture(win), "base64"));
  const h1 = await hitsOf();
  await call(win, "engineSetRenderCacheEnabled", false);
  const composited = await frameAt(2.4, 4.6);
  const h2 = await hitsOf();
  await call(win, "engineSetRenderCacheEnabled", true);
  const diff = meanDiff(rendered, composited);
  if (process.env.RENDER_DUMP) {
    fs.writeFileSync(path.join(ctx.outDir, "frame-composited.png"), Buffer.from(await lastPicture(win), "base64"));
  }
  check("the preview took the frame from a chunk, not the compositor", h1 > h0 && h2 === h1, `${h0} → ${h1} → ${h2}`);
  check("the rendered frame is the composited frame within the intermediate's loss (grain and sharp edges lose a little)", diff < 10, `mean difference ${diff.toFixed(2)} of 255`);

  // ---- playback of the heavy stretch ----
  const play = async (from) => {
    await seek(win, map, from);
    await win.waitForTimeout(600);
    await win.evaluate(() => {
      const c = document.getElementById("openrip-engine-frame");
      window.__render = { ms: [], at: [] };
      window.__renderListener = (e) => {
        window.__render.ms.push(e.detail?.renderMs ?? 0);
        window.__render.at.push(performance.now());
      };
      c.addEventListener("openrip-engine-frame", window.__renderListener);
    });
    const b = await playButton(win).boundingBox();
    await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await win.waitForTimeout(4000);
    await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    const r = await win.evaluate(() => {
      document.getElementById("openrip-engine-frame").removeEventListener("openrip-engine-frame", window.__renderListener);
      return window.__render;
    });
    const ms = r.ms.filter((v) => v > 0);
    const gaps = r.at.slice(1).map((t, i) => t - r.at[i]);
    return { frames: r.ms.length, mean: ms.reduce((s, v) => s + v, 0) / Math.max(1, ms.length), max: Math.max(0, ...ms), late: gaps.filter((g) => g > 100).length };
  };
  const withChunks = await play(0.6);
  await call(win, "engineSetRenderCacheEnabled", false);
  const without = await play(0.6);
  await call(win, "engineSetRenderCacheEnabled", true);
  const fmt = (p) => `${p.frames} frames, engine ${p.mean.toFixed(1)} ms mean / ${p.max.toFixed(0)} ms max, ${p.late} gaps over 100 ms`;
  console.log(`  playback with chunks: ${fmt(withChunks)}\n  playback composited:  ${fmt(without)}`);
  check("playing from the chunks is no slower than compositing", withChunks.mean <= without.mean * 1.1 + 1, `${withChunks.mean.toFixed(1)} ms vs ${without.mean.toFixed(1)} ms`);

  // ---- an edit takes its chunks off the bar ----
  await win.locator("[data-testid=assets-tab-effects]").click();
  await seek(win, map, 8);
  const edit = win.locator("[data-effect=static]");
  await edit.scrollIntoViewIfNeeded();
  await edit.hover();
  await settled(win, () => edit.locator("[data-testid=effect-add]").click());
  await win.waitForTimeout(2500);
  rs = await ranges();
  check("an effect added at 8 s takes the chunks from 8 s off the bar and leaves the rest", rs.length === 1 && rs[0][0] === 0 && rs[0][1] > 5.5 && rs[0][1] <= 8.05, JSON.stringify(rs));
  await shot("r4-edited");
  await key(win, "Meta+z");
  await win.waitForTimeout(2500);
  rs = await ranges();
  check("undoing it brings them back (a chunk is keyed by what it shows)", rs.length === 1 && Math.abs(covered(rs) - duration) < 0.2, JSON.stringify(rs));

  // ---- In and Out ----
  await call(win, "engineDeleteRenderCache");
  await win.waitForTimeout(800);
  await seek(win, map, 3);
  await key(win, "i");
  await seek(win, map, 7);
  await key(win, "o");
  await win.waitForTimeout(500);
  await pick("in");
  await waitRendered();
  rs = await ranges();
  check("Render › In makes the chunks of the range only", rs.length === 1 && rs[0][0] >= 2 && rs[0][0] <= 3 && rs[0][1] >= 7 && rs[0][1] <= 8.05, JSON.stringify(rs));
  await shot("r5-in");
  await pick("out");
  await waitRendered();
  rs = await ranges();
  check("Render › Out makes the rest", rs.length === 1 && rs[0][0] === 0 && Math.abs(rs[0][1] - duration) < 0.2, JSON.stringify(rs));
  await key(win, "Alt+Shift+x");

  // ---- Cancel ----
  await call(win, "engineDeleteRenderCache");
  await win.waitForTimeout(500);
  await pick("whole");
  await pill.waitFor({ timeout: 15000 });
  for (let i = 0; i < 100 && !(await ranges()).length; i++) await win.waitForTimeout(100);
  await win.locator("[data-testid=render-cancel]").click();
  await pill.waitFor({ state: "detached", timeout: 15000 });
  await win.waitForTimeout(600);
  rs = await ranges();
  check("Cancel stops it with the finished chunks kept", rs.length >= 1 && covered(rs) < duration - 1, JSON.stringify(rs));
  check("no unfinished file is left", fs.readdirSync(cacheDir).every((f) => !f.includes(".part")));

  // ---- restart: the index is kept ----
  await pick("whole");
  await waitRendered();
  const before = await ranges();
  const names0 = chunkFiles();
  const reopened = await ctx.relaunch();
  const name = await reopened.win.locator("[data-testid=project-card]").first().innerText().catch(() => "");
  await reopened.win.locator("[data-testid=project-card]").first().locator("button[title^='Open ']").click();
  await reopened.win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await reopened.win.waitForTimeout(6000);
  const win2 = reopened.win;
  const after = (await call(win2, "engineRenderedRanges")).map(([a, b]) => [a / 1e6, b / 1e6]);
  check("after a restart the chunks still valid are rendered", JSON.stringify(after) === JSON.stringify(before) && chunkFiles().length === names0.length, `${JSON.stringify(before)} → ${JSON.stringify(after)} (${name.slice(0, 20)})`);
  await shot("r6-restart");

  // ---- Delete rendering cache, from the menu ----
  ctx.map = await rulerMap(win2);
  const sv = await savedProject(win2, udDir);
  const c = sv.timeline.clips.find((x) => x.clipId === clip0.clipId);
  const [bx, by] = await bar({ ...ctx, win: win2, map: ctx.map }, sv, clip0.clipId, (+c.startTick + 3 * +c.endTick) / 4e6);
  await win2.mouse.click(bx, by, { button: "right" });
  await win2.waitForTimeout(450);
  await win2.locator("button", { hasText: /^Render/ }).first().hover();
  await win2.waitForTimeout(300);
  await win2.locator("[data-testid=menu-render-delete]").click();
  await win2.waitForTimeout(1200);
  const left = (await call(win2, "engineRenderedRanges")).length;
  check("Delete rendering cache clears the folder and the bar", left === 0 && chunkFiles().length === 0, `${left} ranges, ${chunkFiles().length} files`);

  return report();
};
