// The Stickers tab, as CapCut's (after `import timeline`; `CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1`,
// built app, no dev server): the column (Favorites, the categories under Stickers, Shapes) and its
// 86 px tiles; categories, the style filter and the search; a click previewing a sticker in the
// player without changing the project; "+" adding a starter sticker (the engine's frame, ⌘Z / ⇧⌘Z)
// with the sticker colour on its bar; the inspector's Stickers, Animation and Tracking tabs; an
// In animation and a keyframe, each undone and redone; an animated starter sticker whose engine
// frame changes between two times; on-demand downloads from a local fixture server standing in
// for the source repositories (OPENRIP_STICKER_MIRROR): a spinner on the tile while it loads, an SVG
// drawn by the engine, an animated WebP changing frames; favourites; a tile dragged onto the
// timeline and onto the player; then a restart (the stickers come back, drawn the same) and an export.
// Shots are named after the CapCut references: `s1-trending` ↔ `08-left-stickers/001-stickers-default`,
// `s2-inspector-transform` ↔ `22-inspector-sticker/001-sticker-transform`, `s3-inspector-animation`
// ↔ `22-inspector-sticker/002-sticker-animation`.
import http from "node:http";
import zlib from "node:zlib";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { drag, engineFrame, openEditor, previewRect, rulerMap, seek, settled, tab, timelineRect, sectionButton } from "./_preview.mjs";
import { bar as barOf, checks, clipsWhere, savedProject, select } from "./_anim.mjs";
import { press, state, undoCase } from "./_undo.mjs";
import { exporter, ffmpeg } from "./_audio.mjs";

const WORLD_H = 600;

// A solid orange PNG with a transparent corner, as a fixture "download".
const png = (size, [r, g, b]) => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set([r, g, b, 255], y * (size * 4 + 1) + 1 + x * 4);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};

// The repositories' hosts, played by one local server: a PNG, an SVG (a green disc on nothing) or a
// real animated WebP (one the app ships as a starter), after a short wait so the spinner shows.
const fixtureServer = async (appDir, fs) => {
  const hits = [];
  const starter = path.join(appDir, "packages/renderer/public/stickers/starter");
  const webp = fs.readdirSync(starter).filter((f) => /^anim-.*\.webp$/.test(f)).sort();
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    setTimeout(() => {
      if (req.url.endsWith(".svg")) {
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#00ff00"/></svg>`);
      } else if (req.url.endsWith(".webp")) {
        // The one the path names, else the first of the starters' (a different emoji's file).
        const file = webp.find((f) => req.url.includes(f.replace(/^anim-|\.webp$/g, "").replace(/-/g, "_"))) ?? webp[webp.length - 1];
        res.writeHead(200, { "Content-Type": "image/webp" });
        res.end(fs.readFileSync(path.join(starter, file)));
      } else {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(png(64, [255, 128, 0]));
      }
    }, 900);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, hits, close: () => server.close() };
};

// One pixel of a PNG buffer's middle, as ffmpeg reads it.
const pixelOf = (png, w, h) => {
  const raw = execFileSync(ffmpeg, ["-v", "error", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: png, maxBuffer: 1 << 26 });
  const i = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 3;
  return [raw[i], raw[i + 1], raw[i + 2]];
};

export default async (ctx) => {
  const server = await fixtureServer(ctx.appDir, ctx.fs);
  try {
    return await run(ctx, server);
  } finally {
    server.close();
  }
};

const run = async (ctx, server) => {
  const { check, report } = checks();
  // The app takes the mirror from its environment: start it again with it, on the same profile.
  process.env.OPENRIP_STICKER_MIRROR = server.url;
  await ctx.relaunch();
  const { shot, udDir } = ctx;
  let win = ctx.win;
  await openEditor(win);
  const doc = () => savedProject(ctx.win, udDir);
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 1);
  // The picture is the stickers' alone on black: the video's track hidden.
  await settled(win, () => win.locator("button[title='Hide track']").first().click());
  const black = (await engineFrame(win, "r + g + b > 60")).count;
  check("the hidden video leaves the engine's frame black", black === 0, `${black}`);

  // ---- The tab's column and tiles ----------------------------------------------------------
  await win.locator("[data-testid=assets-tab-stickers]").click();
  await win.waitForSelector("[data-testid=sticker-tile]", { timeout: 15000 });
  await win.waitForTimeout(800);
  const names = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=assets-section-]")].map((b) => b.innerText.trim()));
  check("the column: Favorites, the categories, Shapes", names[0] === "Favorites" && ["Trending", "Emoji", "Animated", "Love", "Celebration", "Reactions", "Arrows"].every((n) => names.includes(n)) && names[names.length - 1] === "Shapes", JSON.stringify(names));
  check("it opens on Trending", (await win.locator("[data-testid=stickers-heading]").innerText()) === "Trending");
  const tiles = await win.evaluate(() =>
    [...document.querySelectorAll("[data-testid=sticker-tile]")].slice(0, 4).map((t) => {
      const r = t.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), bg: getComputedStyle(t).backgroundColor };
    }),
  );
  check("tiles are 86 px on the raised grey, 16 px apart", tiles.every((t) => t.w === 86 && t.h === 86 && t.bg === "rgb(59, 59, 59)") && tiles[1].x - tiles[0].x === 102, JSON.stringify(tiles.slice(0, 2)));
  check("the first tiles are the starter set (on this machine already)", (await win.locator("[data-testid=sticker-tile][data-ready='1']").count()) >= 3);
  await shot("s1-trending");
  const category = async (name) => {
    await (await sectionButton(win, `cat:${name}`)).click();
    await win.waitForTimeout(500);
    return win.evaluate(() => ({ n: document.querySelectorAll("[data-testid=sticker-tile]").length, animated: [...document.querySelectorAll("[data-testid=sticker-tile]")].every((t) => t.dataset.animated === "1"), heading: document.querySelector("[data-testid=stickers-heading]")?.innerText }));
  };
  const animated = await category("Animated");
  check("Animated lists animated stickers only", animated.n > 20 && animated.animated && animated.heading === "Animated", JSON.stringify(animated));
  for (const c of ["Love", "Celebration", "Reactions", "Arrows", "Emoji"]) {
    const r = await category(c);
    check(`${c} lists stickers`, r.n > 5 && r.heading === c, JSON.stringify(r));
  }
  // The filter beside the search: Flat shows that set's pictures only.
  await win.locator("[data-testid=stickers-style]").click();
  await win.getByRole("option", { name: "Flat" }).click();
  await win.waitForTimeout(500);
  const flat = await win.evaluate(() => [...document.querySelectorAll("[data-testid=sticker-tile]")].map((t) => t.dataset.set));
  check("the Flat filter shows Fluent Flat only", flat.length > 5 && flat.every((s) => s === "fluent-flat"), `${flat.length} ${[...new Set(flat)]}`);
  // Search: every sticker, by name or keyword (through the style filter).
  await win.locator("[data-testid=stickers-search]").fill("heart");
  await win.waitForTimeout(500);
  const found = await win.evaluate(() => [...document.querySelectorAll("[data-testid=sticker-tile]")].map((t) => t.getAttribute("aria-label").toLowerCase()));
  check("search finds hearts by name", found.length >= 3 && found.some((n) => n.includes("heart")), `${found.length} ${found.slice(0, 4)}`);
  await win.locator("[data-testid=stickers-search]").fill("zzqqxx");
  await win.waitForTimeout(400);
  check("a search matching nothing says so", /No stickers match/.test(await win.locator("[data-testid=stickers-empty]").innerText()));
  await win.locator("[data-testid=stickers-search-clear]").click();
  await win.locator("[data-testid=stickers-style]").click();
  await win.getByRole("option", { name: "Recommended" }).click();
  await win.locator("[data-testid=stickers-search]").fill("tears of joy");
  await win.waitForTimeout(500);
  const joy = await win.evaluate(() => [...document.querySelectorAll("[data-testid=sticker-tile]")].map((t) => t.dataset.sticker));
  check("a keyword finds the 3D and the animated one", joy.some((s) => s.startsWith("f3d-")) && joy.some((s) => s.startsWith("anim-")), JSON.stringify(joy));
  await win.locator("[data-testid=stickers-search-clear]").click();
  await (await sectionButton(win, "cat:Trending")).click();
  await win.waitForTimeout(400);

  // ---- A click previews, and adds nothing ------------------------------------------------------
  const clips0 = JSON.stringify((await doc()).timeline.clips.map((c) => c.clipId));
  const player = await previewRect(win);
  const still = () => win.screenshot({ clip: { x: player.x, y: player.y, width: player.w, height: player.h } });
  const before = await still();
  const first = win.locator("[data-testid=sticker-tile][data-ready='1']:not([data-animated='1'])").first();
  const firstId = await first.getAttribute("data-sticker");
  await first.click();
  await win.waitForTimeout(700);
  check("a click previews it (the tile is marked)", (await first.getAttribute("aria-pressed")) === "true");
  check("the player shows it", !before.equals(await still()));
  check("and adds nothing", JSON.stringify((await doc()).timeline.clips.map((c) => c.clipId)) === clips0);
  await shot("s1b-preview");

  // ---- "+" adds a starter sticker -----------------------------------------------------------------
  const addFrom = async (tile) => {
    await win.mouse.move(5, 5);
    await tile.hover();
    await settled(win, () => tile.locator("[data-testid=sticker-add]").click());
    await win.waitForTimeout(500);
  };
  const res = await undoCase(ctx, check, "add a sticker", () => addFrom(first));
  let d = await doc();
  const stickers = () => clipsWhere(d, (c) => c.type === "sticker");
  const added = stickers()[0];
  const canvas = { w: WORLD_H * (d.settings.aspectRatio.width / d.settings.aspectRatio.height), h: WORLD_H };
  check("a sticker clip at the playhead, 3 s, on a sticker track of its own", !!added && Math.abs(+added.startTick / 1e6 - 1) < 0.05 && Math.abs((+added.endTick - +added.startTick) / 1e6 - 3) < 0.05 && d.timeline.tracks.find((t) => t.timelineId === added.timelineId)?.type === "sticker", added ? `${added.startTick} ${added.endTick}` : "none");
  const t = added?.transform;
  check("its box is centred, its longer side 30% of the canvas's shorter", !!t && Math.abs(t.x + t.width / 2 - canvas.w / 2) < 0.5 && Math.abs(Math.max(t.width, t.height) - 0.3 * Math.min(canvas.w, canvas.h)) < 0.5, JSON.stringify(t));
  const file = added?.stickerPath ?? "";
  check("its file is cached in the app data (copied from the shipped starter set)", file.startsWith(udDir) && ctx.fs.existsSync(file) && added.stickerId === firstId, file);
  check("the engine draws it", (await engineFrame(win, "r + g + b > 60")).count > 400);
  // The bar's colour: the sticker colour of lib/timeline-colors.ts.
  ctx.map = await rulerMap(win);
  d = await doc();
  const bar = ctx.fs.existsSync(file) ? await (async () => {
    const tl = await timelineRect(win);
    const track = d.timeline.tracks.find((x) => x.timelineId === added.timelineId);
    const y = tl.y + 27 + track.timelineY + track.timelineHeight / 2;
    const x = ctx.map.x(+added.endTick / 1e6) - 30;
    const buf = await win.screenshot({ clip: { x, y, width: 4, height: 2 } });
    return pixelOf(buf, 8, 4);
  })() : [0, 0, 0];
  check("its bar is the sticker colour", Math.abs(bar[0] - 0xc0) < 24 && Math.abs(bar[1] - 0x8a) < 24 && Math.abs(bar[2] - 0x3e) < 24, JSON.stringify(bar));

  // ---- Its clip menu: Mirror (after Save preset, as CapCut orders it) and Range ----------------------------------
  {
    await seek(win, ctx.map, 1.5);
    await select(ctx, await doc(), added.clipId, 3.5);
    const [bx, by] = await barOf(ctx, await doc(), added.clipId, 3.5);
    const before = (await engineFrame(win, "r + g + b > 60")).sum;
    await undoCase(ctx, check, "sticker menu: Mirror", async () => {
      await win.mouse.click(bx, by, { button: "right" });
      await win.waitForTimeout(400);
      await settled(win, () => win.getByText("Mirror", { exact: true }).click());
    });
    d = await doc();
    const flipped = clipsWhere(d, (c) => c.type === "sticker")[0].flip;
    check("Mirror flips the sticker (saved), and the engine draws it mirrored", flipped?.horizontal === true && (await engineFrame(win, "r + g + b > 60")).sum !== before, JSON.stringify(flipped));
    await win.mouse.click(bx, by, { button: "right" });
    await win.waitForTimeout(400);
    const items = await win.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((t) => t === "Range" || t === "Mirror" || t === "Export selected clips" || t === "Render" || t === "Deactivate clip"));
    check("the sticker's menu has Mirror, Deactivate clip and Range, no Export or Render", ["Mirror", "Deactivate clip", "Range"].every((n) => items.includes(n)) && !items.includes("Render") && !items.includes("Export selected clips"), JSON.stringify(items));
    await win.keyboard.press("Escape");
    await win.mouse.click(bx, by + 60).catch(() => {});
    await select(ctx, await doc(), added.clipId, 3.5);
  }

  // ---- Its inspector: Stickers, Animation, Tracking ---------------------------------------------------------
  const sel = async () => select(ctx, await doc(), added.clipId, 3.5);
  await seek(win, ctx.map, 1.5);
  await sel();
  const tabs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((x) => x.innerText.trim()));
  check("the inspector's tabs are Stickers, Animation, Tracking", JSON.stringify(tabs) === JSON.stringify(["Stickers", "Animation", "Tracking"]), JSON.stringify(tabs));
  check("Stickers holds Transform", (await win.locator("[data-testid=inspector] [data-testid=section-transform]").count()) === 1);
  await shot("s2-inspector-transform");
  await tab(win, "Animation");
  const subs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((x) => x.innerText.trim()));
  check("Animation has In, Out and Loop", ["In", "Out", "Loop"].every((n) => subs.includes(n)), JSON.stringify(subs));
  await shot("s3-inspector-animation");
  await seek(win, ctx.map, 1);
  await sel();
  await tab(win, "Animation");
  await undoCase(ctx, check, "In: Fade In", () => settled(win, () => win.locator("[data-testid=anim-card]").filter({ hasText: "Fade In" }).click()));
  d = await doc();
  check("the Fade In is saved on the sticker", stickers()[0] && clipsWhere(d, (c) => c.type === "sticker")[0].animationIn?.type === "fade_in", JSON.stringify(clipsWhere(d, (c) => c.type === "sticker")[0].animationIn));
  await tab(win, "Tracking");
  check("the Tracking tab is the draft stickers' (Motion tracking)", (await win.locator("[data-testid=inspector] [data-testid^=track]").count()) > 0 || (await win.getByText("Motion tracking").count()) > 0);
  await tab(win, "Stickers");

  // ---- A keyframe: position keyed at 1.5 s, moved at 3 s -----------------------------------------------------
  await seek(win, ctx.map, 1.5);
  await sel();
  const diamond = win.locator("[data-testid=inspector] [data-keyframe=position] button[aria-pressed]");
  await settled(win, () => diamond.click());
  await seek(win, ctx.map, 3);
  await sel();
  const x0 = (await engineFrame(win, "r + g + b > 60")).sum;
  const px = win.locator("[data-testid=inspector] input[aria-label='Position X']");
  await undoCase(ctx, check, "keyframe: Position X moved at 3 s", async () => {
    await px.click({ clickCount: 3 });
    await px.fill("250");
    await settled(win, () => px.press("Enter"));
  });
  d = await doc();
  const keyed = clipsWhere(d, (c) => c.type === "sticker")[0].keyframes?.position ?? [];
  check("the position has two keys and the sticker moved", keyed.length === 2 && (await engineFrame(win, "r + g + b > 60")).sum !== x0, JSON.stringify(keyed));
  await seek(win, ctx.map, 1.5);
  const keyedLeft = (await engineFrame(win, "r + g + b > 60")).sum;
  await seek(win, ctx.map, 3);
  check("the engine's frame follows the keys over time", (await engineFrame(win, "r + g + b > 60")).sum !== keyedLeft);
  await shot("s4-keyframed");

  // ---- An animated starter sticker: its frame changes with time -------------------------------------------------
  await win.locator("[data-testid=assets-tab-stickers]").click();
  await (await sectionButton(win, "cat:Animated")).click();
  await win.waitForTimeout(700);
  const anim = win.locator("[data-testid=sticker-tile][data-ready='1'][data-animated='1']").first();
  await seek(win, ctx.map, 6);
  await addFrom(anim);
  d = await doc();
  const animClip = stickers().concat(clipsWhere(d, (c) => c.type === "sticker")).find((c) => c.stickerAnimated);
  check("an animated sticker is added (its WebP cached)", !!animClip && animClip.stickerPath.endsWith(".webp") && ctx.fs.existsSync(animClip.stickerPath), animClip?.stickerPath);
  const at = async (s) => (await seek(win, ctx.map, s), (await engineFrame(win, "r + g + b > 60")).sum);
  const [f0, f1, f2, f3] = [await at(6.04), await at(6.5), await at(7.0), await at(6.04)];
  check("its frame changes between two times", f0 !== f1 && f1 !== f2, `${f0} ${f1} ${f2}`);
  check("and the same time gives the same frame", f0 === f3);
  await shot("s5-animated");
  await press(win, "Meta+z");
  await state(ctx, Date.now() - 400);

  // ---- On-demand downloads ---------------------------------------------------------------------------------------------
  await win.locator("[data-testid=stickers-style]").click();
  await win.getByRole("option", { name: "Flat" }).click();
  await (await sectionButton(win, "cat:Smileys")).click();
  await win.waitForTimeout(700);
  const remoteId = await win.locator("[data-testid=sticker-tile][data-ready='0']").first().getAttribute("data-sticker");
  // By its id: the tile no longer matches data-ready='0' once it has downloaded.
  const remote = win.locator(`[data-sticker="${remoteId}"]`);
  check("a sticker not on this machine shows the download mark", (await remote.locator("[data-testid=sticker-download]").count()) === 1);
  const hits0 = server.hits.length;
  await remote.locator("[data-testid=sticker-download]").click();
  await win.waitForTimeout(250);
  check("a spinner shows on the tile while it downloads", (await remote.locator("[data-testid=sticker-spinner]").count()) === 1);
  await shot("s6-downloading");
  await win.waitForFunction((id) => document.querySelector(`[data-sticker="${id}"]`)?.dataset.ready === "1", remoteId, { timeout: 15000 });
  check("then it's ready (the mark gone)", (await remote.locator("[data-testid=sticker-spinner]").count()) === 0 && (await remote.locator("[data-testid=sticker-download]").count()) === 0);
  check("fetched once from its source's path", server.hits.length === hits0 + 1 && /\/microsoft\/fluentui-emoji\/[0-9a-f]{40}\/assets\/.+\.svg$/.test(server.hits.at(-1)), server.hits.at(-1));
  check("and kept in the user's app data", ctx.fs.existsSync(`${udDir}/stickers/${remoteId}.svg`));
  // It's drawn by the engine, as an SVG: the fixture's green disc, with nothing around it.
  await seek(win, ctx.map, 9);
  const svgAdd = await undoCase(ctx, check, "add the downloaded SVG sticker", () => addFrom(remote));
  await seek(win, ctx.map, 9.5);
  const green = (await engineFrame(win, "g > 200 && r < 60 && b < 60")).count;
  check("the engine draws the SVG (its green disc)", green > 400, `${green}`);
  await press(win, "Meta+z");
  await state(ctx, Date.now() - 400);

  // Another download: the tile's "+" downloads and adds in one go; an animated WebP from the fixture.
  await win.locator("[data-testid=stickers-style]").click();
  await win.getByRole("option", { name: "Recommended" }).click();
  await (await sectionButton(win, "cat:Animated")).click();
  await win.waitForTimeout(700);
  const remoteAnimId = await win.locator("[data-testid=sticker-tile][data-ready='0'][data-animated='1']").first().getAttribute("data-sticker");
  const remoteAnim = win.locator(`[data-sticker="${remoteAnimId}"]`);
  await seek(win, ctx.map, 6);
  await remoteAnim.hover();
  await remoteAnim.locator("[data-testid=sticker-download]").click();
  await win.waitForFunction((id) => document.querySelector(`[data-sticker="${id}"]`)?.dataset.ready === "1", remoteAnimId, { timeout: 15000 });
  await addFrom(remoteAnim);
  const [g0, g1, g2] = [await at(6.04), await at(6.5), await at(7.0)];
  check("a downloaded animated WebP changes frame between two times", g0 !== g1 && g1 !== g2, `${g0} ${g1} ${g2}`);
  await press(win, "Meta+z");
  await state(ctx, Date.now() - 400);

  // ---- Favourites ----------------------------------------------------------------------------------------------
  await (await sectionButton(win, "cat:Trending")).click();
  await win.waitForTimeout(500);
  const fav = win.locator("[data-testid=sticker-tile]").nth(1);
  const favId = await fav.getAttribute("data-sticker");
  await win.mouse.move(5, 5);
  await fav.hover();
  await fav.locator("[data-testid=sticker-favourite]").click();
  await (await sectionButton(win, "favorites")).click();
  await win.waitForTimeout(500);
  check("a starred sticker is under Favorites", JSON.stringify(await win.evaluate(() => [...document.querySelectorAll("[data-testid=sticker-tile]")].map((x) => x.dataset.sticker))) === JSON.stringify([favId]));
  await win.mouse.move(5, 5);
  await win.locator("[data-testid=sticker-tile]").first().hover();
  await win.locator("[data-testid=sticker-favourite]").click();
  await win.waitForTimeout(300);
  check("un-starring empties it, with its note", /No favorites yet/.test(await win.locator("[data-testid=stickers-empty]").innerText()));

  // ---- A tile dragged onto the timeline and onto the player ------------------------------------------------------
  await (await sectionButton(win, "cat:Trending")).click();
  await win.waitForTimeout(500);
  const tl = await timelineRect(win);
  const tile = await win.locator("[data-testid=sticker-tile]").nth(2).boundingBox();
  const n0 = clipsWhere(await doc(), (c) => c.type === "sticker").length;
  await settled(win, () => drag(win, tile.x + 43, tile.y + 43, ctx.map.x(8), tl.y + tl.h * 0.35));
  d = await doc();
  const dropped = clipsWhere(d, (c) => c.type === "sticker").filter((c) => Math.abs(+c.startTick / 1e6 - 8) < 0.15);
  check("a tile dragged onto the timeline starts where it's let go", dropped.length === 1 && clipsWhere(d, (c) => c.type === "sticker").length === n0 + 1, dropped[0]?.startTick);
  await press(win, "Meta+z");
  await state(ctx, Date.now() - 400);
  const p = await previewRect(win);
  const n1 = clipsWhere(await doc(), (c) => c.type === "sticker").length;
  await seek(win, ctx.map, 9);
  await settled(win, () => drag(win, tile.x + 43, tile.y + 43, p.x + p.w * 0.75, p.y + p.h * 0.5));
  d = await doc();
  const onPlayer = clipsWhere(d, (c) => c.type === "sticker").filter((c) => Math.abs(+c.startTick / 1e6 - 9) < 0.15)[0];
  check("a tile dragged onto the player: at the playhead, right of the middle", !!onPlayer && clipsWhere(d, (c) => c.type === "sticker").length === n1 + 1 && onPlayer.transform.x + onPlayer.transform.width / 2 > canvas.w / 2 + 20, onPlayer ? JSON.stringify(onPlayer.transform) : "none");
  await press(win, "Meta+z");
  await state(ctx, Date.now() - 400);

  // The Shapes section is still there.
  await (await sectionButton(win, "shapes")).click();
  await win.waitForTimeout(400);
  check("Shapes still lists its tiles", (await win.locator("[data-testid=shapes-library] [role=button]").count()) >= 8);

  // ---- Restart: the stickers come back, drawn the same -----------------------------------------------------------------
  d = await doc();
  const count = clipsWhere(d, (c) => c.type === "sticker").length;
  await seek(win, ctx.map, 3);
  const beforeRestart = (await engineFrame(win, "r + g + b > 60")).sum;
  await state(ctx, Date.now() - 400);
  await ctx.relaunch();
  win = ctx.win;
  await openEditor(win);
  ctx.map = await rulerMap(win);
  d = await doc();
  check("after a restart the sticker clips are in the project", clipsWhere(d, (c) => c.type === "sticker").length === count && count >= 1, `${count}`);
  await seek(win, ctx.map, 3);
  await win.waitForTimeout(800);
  check("and the engine draws the same frame", (await engineFrame(win, "r + g + b > 60")).sum === beforeRestart);
  await shot("s7-reopened");

  // ---- Export: the sticker in the file -----------------------------------------------------------------------------------------
  await seek(win, ctx.map, 1);
  const exportAs = await exporter(ctx);
  const file2 = await exportAs("stickers");
  const lit = (s) => {
    const raw = execFileSync(ffmpeg, ["-v", "error", "-ss", String(s), "-i", file2, "-frames:v", "1", "-vf", "scale=135:240", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
    let n = 0;
    for (let i = 0; i < raw.length; i += 3) if (raw[i] + raw[i + 1] + raw[i + 2] > 120) n++;
    return n;
  };
  const [during, after] = [lit(3.5), lit(4.6)];
  check("the exported file shows the sticker while it lasts and not after", during > 200 && after < 20, `${during} lit pixels at 3.5 s, ${after} at 4.6 s`);
  return report();
};
