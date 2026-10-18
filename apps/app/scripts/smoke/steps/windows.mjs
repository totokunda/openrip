// Panels in windows of their own (after `import timeline`; IMG_9079 with CLIP_NAME=IMG_9079 for
// the 4K ProRes rate): the player popped out from its menu shows the engine's frames in its new
// window, follows a seek and plays at 1× there (frames per second counted in that window),
// Space pressed in it pauses and plays, Dock back; the inspector popped out from a right-click
// on its header (a clip's tabs there, its select opening in that window), docked by closing its
// window; the timeline dragged out of the editor by its toolbar (a seek, ←, ⌘B and ⌘Z and Space
// in it), docked by Layout ▸ Reset current layout. Then where the windows were is kept: after a
// restart on the same profile the player left out comes back where it was, the inspector
// popped out again opens where it was, and the timeline's place left off-screen (as if its
// display had gone) comes back on-screen; Home closes them and they come back with the project.
import fs from "node:fs";
import path from "node:path";
import { checks, rowOf, savedClips } from "./_anim.mjs";
import { engineFrame, goHome, openEditor, timelineRect } from "./_preview.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (f, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await f().catch(() => false)) return true;
    await sleep(150);
  }
  return false;
};
// The page of a panel's own window, once it shows its panel.
const panelPage = async (app, id, timeout = 15000) => {
  let page = null;
  await waitFor(async () => {
    for (const p of app.windows()) {
      if (!p.isClosed() && (await p.locator(`[data-testid=panel-window-${id}]`).count().catch(() => 0))) return (page = p);
    }
    return false;
  }, timeout);
  return page;
};
// Panel windows are blank pages the editor renders into; each is titled with its panel's name.
const panelWindows = (app) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.webContents.getURL() === "about:blank")
      .map((w) => ({ title: w.getTitle(), bounds: w.getBounds() })),
  );
const boundsOf = async (app, title) => (await panelWindows(app)).find((w) => w.title.startsWith(title))?.bounds ?? null;
const setBounds = (app, title, b) =>
  app.evaluate(({ BrowserWindow }, [title, b]) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === "about:blank" && w.getTitle().startsWith(title));
    w?.setBounds(b);
    return !!w;
  }, [title, b]);
const closeWindow = (app, title) =>
  app.evaluate(({ BrowserWindow }, title) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === "about:blank" && w.getTitle().startsWith(title))?.close();
  }, title);
const workAreaOf = (app, b) => app.evaluate(({ screen }, b) => screen.getDisplayMatching(b).workArea, b);
const same = (a, b, tol = 2) => !!a && !!b && ["x", "y", "width", "height"].every((k) => Math.abs(a[k] - b[k]) <= tol);
const fmt = (b) => (b ? `${b.x},${b.y} ${b.width}×${b.height}` : "none");

// The picture in a page's player: the middle of the frame (its aspect `aspect`, fitted in the
// largest canvas) as a hash and mean lightness.
const picture = (page, aspect) =>
  page.evaluate((aspect) => {
    const root = document.querySelector("[data-testid=player]");
    const cs = [...(root?.querySelectorAll("canvas") ?? [])].filter((c) => c.width > 100);
    cs.sort((a, b) => b.width * b.height - a.width * a.height);
    const c = cs[0];
    if (!c) return null;
    // Zoomed to fit, with its 10% margin.
    let [fw, fh] = [c.width, c.width / aspect];
    if (fh > c.height) [fw, fh] = [c.height * aspect, c.height];
    [fw, fh] = [fw * 0.9, fh * 0.9];
    const t = document.createElement("canvas");
    t.width = t.height = 64;
    const g = t.getContext("2d");
    g.drawImage(c, (c.width - fw) / 2 + fw * 0.1, (c.height - fh) / 2 + fh * 0.1, fw * 0.8, fh * 0.8, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    let sum = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum = (sum * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) % 1000000007;
      light += (d[i] + d[i + 1] + d[i + 2]) / 765;
    }
    return { sum, light: light / (d.length / 4), w: c.width, h: c.height };
  }, aspect);
// The engine's frame, the same middle part.
const enginePicture = (win) =>
  win.evaluate(() => {
    const c = document.getElementById("openrip-engine-frame");
    const t = document.createElement("canvas");
    t.width = t.height = 64;
    const g = t.getContext("2d");
    g.drawImage(c, c.width * 0.1, c.height * 0.1, c.width * 0.8, c.height * 0.8, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    let light = 0;
    for (let i = 0; i < d.length; i += 4) light += (d[i] + d[i + 1] + d[i + 2]) / 765;
    return { light: light / (d.length / 4), w: c.width, h: c.height };
  });
// How often the picture in a page's player changes over `ms`, sampled at that window's display
// rate: the frames it shows per second.
const shownRate = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        const root = document.querySelector("[data-testid=player]");
        const cs = [...root.querySelectorAll("canvas")].filter((c) => c.width > 100);
        cs.sort((a, b) => b.width * b.height - a.width * a.height);
        const c = cs[0];
        const t = document.createElement("canvas");
        t.width = t.height = 48;
        const g = t.getContext("2d", { willReadFrequently: true });
        let last = -1, changes = 0, ticks = 0;
        const t0 = performance.now();
        const step = () => {
          g.drawImage(c, c.width * 0.35, c.height * 0.3, c.width * 0.3, c.height * 0.4, 0, 0, 48, 48);
          const d = g.getImageData(0, 0, 48, 48).data;
          let h = 0;
          for (let i = 0; i < d.length; i += 8) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007;
          if (h !== last) changes++;
          last = h;
          ticks++;
          if (performance.now() - t0 < ms) requestAnimationFrame(step);
          else done({ changes, ticks, secs: (performance.now() - t0) / 1000 });
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
const timeIn = async (page) => {
  const t = page.locator("[data-testid=player-time]");
  return (await t.count()) ? +(await t.getAttribute("data-time")) : NaN;
};
// Frames the engine delivers to the editor's page (counted from now, read back with `delivered`).
const countFrames = (win) =>
  win.evaluate(() => {
    window.__winFrames = [];
    if (window.__winFramesOn) return;
    window.__winFramesOn = true;
    document.getElementById("openrip-engine-frame").addEventListener("openrip-engine-frame", () => window.__winFrames.push(performance.now()));
  });
const delivered = (win) => win.evaluate(() => {
  const f = window.__winFrames;
  const span = f.length > 1 ? (f[f.length - 1] - f[0]) / 1000 : 0;
  return { n: f.length, rate: span ? (f.length - 1) / span : 0 };
});
// Is the playhead moving (in the page that shows the player)?
const moving = async (page) => {
  const a = await timeIn(page);
  await sleep(700);
  return (await timeIn(page)) > a + 0.2;
};

export default async (ctx) => {
  const { check, report } = checks();
  const notes = [];
  let { app, win } = ctx;
  const engine0 = await engineFrame(win);
  const aspect = engine0.w / engine0.h;

  // --- The player, popped out from its menu.
  const box = (id) => win.evaluate((id) => document.querySelector(`[data-testid=${id}]`)?.getBoundingClientRect().width ?? 0, id);
  const widths0 = (await box("assets")) + (await box("inspector"));
  await win.locator("[data-testid=player-menu]").click();
  await win.locator("[data-testid=panel-pop-out]").click();
  let player = await panelPage(app, "player");
  check("Pop out (player menu) opens the player in a window of its own", !!player);
  if (!player) return report();
  await sleep(1500);
  await player.screenshot({ path: `${ctx.outDir}/windows-player.png` });
  await ctx.shot("windows-editor-without-player");
  const widths1 = (await box("assets")) + (await box("inspector"));
  check("the editor closes up the space the player left", (await win.locator("[data-testid=player]").count()) === 0 && widths1 > widths0 + 100, `left panel + inspector ${widths0.toFixed(0)} → ${widths1.toFixed(0)} px`);
  const pb = await boundsOf(app, "Player");
  notes.push(`player window ${fmt(pb)}`);
  const p0 = await picture(player, aspect);
  const e0 = await enginePicture(win);
  check("its window shows the engine's frame", !!p0 && p0.light > 0.05 && Math.abs(p0.light - e0.light) < 0.08, p0 ? `lightness ${p0.light.toFixed(3)}, the engine's ${e0.light.toFixed(3)}` : "no canvas");
  // The preview renders at the size it's shown at: the new window's.
  check("the engine renders at the player window's size", e0.h > 900 || e0.w > 900, `engine frame ${e0.w}×${e0.h} (docked ${engine0.w}×${engine0.h})`);

  // A seek from the editor's timeline: the frame in the player's window changes.
  const tl = await timelineRect(win);
  await win.mouse.click(tl.x + tl.w * 0.35, tl.y + 12);
  await waitFor(async () => (await timeIn(player)) > 1);
  await sleep(1200);
  const t1 = await timeIn(player);
  const p1 = await picture(player, aspect);
  check("a seek in the editor changes the frame in the player's window", t1 > 1 && !!p1 && p1.sum !== p0.sum, `at ${t1.toFixed(2)} s`);

  // Play from its own transport: its clock at about 1×, the frames it shows per second.
  await win.mouse.click(tl.x + 20, tl.y + 12);
  await sleep(1000);
  const c0 = await timeIn(player), w0 = Date.now();
  await player.locator("[data-testid=play]").click();
  await sleep(1000);
  await countFrames(win);
  const shown = await shownRate(player, 5000);
  const del = await delivered(win);
  const c1 = await timeIn(player), w1 = Date.now();
  const rate = (c1 - c0) / ((w1 - w0) / 1000);
  check("it plays at 1× in its window", rate > 0.9 && rate < 1.1, `clock ${rate.toFixed(2)}×`);
  check("it shows the clip's 24 frames a second in its window", shown.changes / shown.secs >= 22.5, `${(shown.changes / shown.secs).toFixed(1)} frames/s shown over ${shown.secs.toFixed(1)} s (${(shown.ticks / shown.secs).toFixed(0)} Hz), ${del.rate.toFixed(1)} frames/s delivered`);
  notes.push(`player window: ${(shown.changes / shown.secs).toFixed(1)} fps shown, ${del.rate.toFixed(1)} fps delivered, ${shown.ticks} samples`);

  // Space, with the player's window in front: pauses, then plays, then pauses.
  await player.bringToFront();
  await sleep(300);
  await player.keyboard.press("Space");
  await sleep(500);
  const paused = !(await moving(player));
  await player.keyboard.press("Space");
  await sleep(500);
  const resumed = await moving(player);
  await player.keyboard.press("Space");
  await sleep(500);
  check("Space in the player's window pauses and plays", paused && resumed, `paused ${paused}, playing again ${resumed}`);

  // Its menu opens in its window (menus portal into the window their panel is in).
  await player.locator("[data-testid=player-menu]").click();
  await sleep(400);
  const menuHere = await player.locator("[role=menu]").count();
  const menuThere = await win.locator("[role=menu]").count();
  const dockItem = await player.locator("[data-testid=panel-dock]").count();
  await player.keyboard.press("Escape");
  await sleep(300);
  check("its menu opens in its window, offering Dock back", menuHere > 0 && menuThere === 0 && dockItem === 1, `menus here ${menuHere}, in the editor ${menuThere}`);

  // Dock back.
  await player.locator("[data-testid=dock-back]").click();
  await waitFor(async () => (await win.locator("[data-testid=player]").count()) === 1 && (await panelWindows(app)).length === 0);
  await sleep(1500);
  const back = await engineFrame(win);
  check("Dock back closes its window and puts the player back, the engine drawing it", (await panelWindows(app)).length === 0 && (await win.locator("[data-testid=player] canvas").count()) > 0 && back.light > 0.05, `engine frame ${back.w}×${back.h}`);

  // --- The inspector, from a right-click on its header; a clip's tabs and a select there.
  const ib = await win.locator("[data-testid=inspector]").boundingBox();
  await win.mouse.click(ib.x + ib.width / 2, ib.y + 20, { button: "right" });
  await win.locator("[data-testid=menu-panel-pop-out]").click();
  const inspector = await panelPage(app, "inspector");
  check("Pop out (right-click on the inspector's header) opens it in a window of its own", !!inspector && (await win.locator("[data-testid=inspector]").count()) === 0);
  if (!inspector) return report();
  // (On the editor's display a full-screen editor leaves full screen for it: its layout moves.)
  await sleep(1500);
  notes.push(`inspector window ${fmt(await boundsOf(app, "Inspector"))}, editor ${await win.evaluate(() => `${innerWidth}×${innerHeight}`)}`);
  // Select the clip in the editor's timeline: its tabs show in the inspector's window.
  ctx.map = null;
  const videoRow = await rowOf(ctx, "video");
  await win.mouse.click(ctx.map.x(8), videoRow);
  await sleep(800);
  const tabs = await inspector.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((e) => e.innerText.trim()));
  check("selecting a clip in the editor shows its tabs in the inspector's window", tabs.includes("Video"), tabs.join(", "));
  // Its opacity slider dragged there changes the clip; ⌘Z pressed there undoes it.
  const opacity = async () => (await savedClips(win, ctx.udDir)).find((c) => c.type === "video")?.transform?.opacity ?? 100;
  const o0 = await opacity();
  const thumb = await inspector.locator("[data-testid=inspector] [role=slider]").first().boundingBox({ timeout: 3000 }).catch(() => null);
  let o1 = NaN, o2 = NaN;
  if (thumb) {
    const [sx, sy] = [thumb.x + thumb.width / 2, thumb.y + thumb.height / 2];
    await inspector.mouse.move(sx, sy);
    await inspector.mouse.down();
    await inspector.mouse.move(sx - 60, sy, { steps: 6 });
    await inspector.mouse.move(sx - 160, sy, { steps: 10 });
    await inspector.mouse.up();
    o1 = await opacity();
    await inspector.keyboard.press("Meta+z");
    o2 = await opacity();
  }
  check("a slider dragged in the inspector's window changes the clip, and ⌘Z there undoes it", o1 < o0 && o2 === o0, `opacity ${o0} → ${o1} → ${o2}`);
  await inspector.screenshot({ path: `${ctx.outDir}/windows-inspector.png` });
  await setBounds(app, "Inspector", { x: 140, y: 90, width: 460, height: 700 });
  await sleep(800);
  const inspectorPlace = await boundsOf(app, "Inspector");
  // Closing its window docks it.
  await closeWindow(app, "Inspector");
  await waitFor(async () => (await win.locator("[data-testid=inspector]").count()) === 1);
  check("closing the inspector's window puts it back in the editor", (await win.locator("[data-testid=inspector]").count()) === 1 && (await panelWindows(app)).length === 0);

  // --- The timeline, dragged out of the editor by its toolbar.
  const bar = await win.locator("[data-testid=timeline-toolbar]").boundingBox();
  const vw = await win.evaluate(() => innerWidth);
  const [gx, gy] = [bar.x + bar.width / 2, bar.y + bar.height / 2];
  await win.mouse.move(gx, gy);
  await win.mouse.down();
  await win.mouse.move(gx + 20, gy - 10, { steps: 4 });
  await win.mouse.move(vw + 60, gy - 200, { steps: 12 });
  await win.mouse.move(vw + 120, gy - 240, { steps: 6 });
  await win.mouse.up();
  const timeline = await panelPage(app, "timeline");
  check("dragging the timeline's toolbar out of the window pulls it into a window of its own", !!timeline && (await win.locator("[data-testid=timeline]").count()) === 0);
  if (!timeline) return report();
  await sleep(1500);
  notes.push(`timeline window ${fmt(await boundsOf(app, "Timeline"))} after the drag`);
  await timeline.screenshot({ path: `${ctx.outDir}/windows-timeline.png` });
  await ctx.shot("windows-editor-without-timeline");
  // A seek on its ruler moves the editor's player; ← in it steps back a frame.
  const ttl = await timeline.evaluate(() => {
    const cs = [...document.querySelectorAll("[data-testid=timeline] canvas")].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 300);
    cs.sort((p, q) => q.width * q.height - p.width * p.height);
    const b = cs[0];
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  await timeline.mouse.click(ttl.x + ttl.w * 0.3, ttl.y + 12);
  await sleep(1000);
  const s1 = await timeIn(win);
  await timeline.keyboard.press("ArrowLeft");
  await sleep(600);
  const s2 = await timeIn(win);
  check("a click on its ruler seeks, and ← in its window steps back a frame", s1 > 0.5 && Math.abs(s1 - s2 - 1 / 24) < 0.01, `${s1.toFixed(3)} → ${s2.toFixed(3)} s`);
  // ⌘B splits at the playhead, ⌘Z undoes it, both pressed in its window.
  const clipCount = async () => (await savedClips(win, ctx.udDir)).length;
  const n0 = await clipCount();
  await timeline.keyboard.press("Meta+b");
  let n1 = n0, n2 = NaN;
  await waitFor(async () => (n1 = await clipCount()) !== n0, 8000);
  await timeline.keyboard.press("Meta+z");
  await waitFor(async () => (n2 = await clipCount()) === n0, 8000);
  check("⌘B and ⌘Z in its window split and undo", n1 === n0 + 1 && n2 === n0, `clips ${n0} → ${n1} → ${n2}`);
  await timeline.keyboard.press("Space");
  await sleep(500);
  const playing = await moving(win);
  await timeline.keyboard.press("Space");
  await sleep(500);
  check("Space in its window plays and pauses", playing && !(await moving(win)));
  // Layout ▸ Reset current layout docks it.
  await win.locator("[data-testid=layout-menu]").click();
  await win.locator("[data-testid=layout-reset]").click();
  await waitFor(async () => (await win.locator("[data-testid=timeline]").count()) === 1 && (await panelWindows(app)).length === 0);
  check("Layout ▸ Reset current layout puts the timeline back", (await win.locator("[data-testid=timeline]").count()) === 1 && (await panelWindows(app)).length === 0);

  // --- The left panel, from a right-click on its tab row; its media dragged from its window
  // onto the editor's timeline (past the clip's end on the main track) is added there.
  const ab = await win.locator("[data-testid=assets]").boundingBox();
  await win.mouse.click(ab.x + ab.width - 24, ab.y + 20, { button: "right" });
  await win.locator("[data-testid=menu-panel-pop-out]").click();
  const assets = await panelPage(app, "assets");
  check("Pop out (right-click on the left panel's tab row) opens it in a window of its own", !!assets && (await win.locator("[data-testid=assets]").count()) === 0);
  if (assets) {
    await sleep(1500);
    ctx.map = null;
    const row = await rowOf(ctx, "video");
    const origin = (page) =>
      page.evaluate(() => {
        const side = Math.max(0, (outerWidth - innerWidth) / 2);
        return { x: screenX + side, y: screenY + Math.max(0, outerHeight - innerHeight - side) };
      });
    const [mo, co] = [await origin(win), await origin(assets)];
    // (The dragged picture's middle, which the drop goes by, is 30 px under the pointer.)
    const [tx, ty] = [ctx.map.x(14) + mo.x - co.x, row - 30 + mo.y - co.y];
    const item = await assets.getByText(process.env.CLIP_NAME || "IMG_9019", { exact: false }).first().boundingBox();
    const m0 = await clipCount();
    await assets.mouse.move(item.x + item.width / 2, item.y - 60);
    await assets.mouse.down();
    const [sx, sy] = [item.x + item.width / 2 + 10, item.y - 50];
    await assets.mouse.move(sx, sy, { steps: 5 });
    // At a hand's pace: moves sent all at once past the window's edge aren't all taken.
    for (let k = 1; k <= 30; k++) {
      await assets.mouse.move(sx + ((tx - sx) * k) / 30, sy + ((ty - sy) * k) / 30);
      await sleep(16);
    }
    await sleep(300);
    await assets.mouse.up();
    let m1 = m0;
    await waitFor(async () => (m1 = await clipCount()) > m0, 8000);
    check("media dragged from its window onto the editor's timeline is added there", m1 === m0 + 1, `clips ${m0} → ${m1}`);
    await ctx.shot("windows-dropped-from-media-window");
    if (m1 > m0) {
      await win.bringToFront();
      await win.keyboard.press("Meta+z");
      await waitFor(async () => (await clipCount()) === m0, 8000);
    }
    await assets.locator("[data-testid=dock-back]").click();
    await waitFor(async () => (await win.locator("[data-testid=assets]").count()) === 1);
    check("…and it docks back", (await win.locator("[data-testid=assets]").count()) === 1 && (await clipCount()) === m0);
  }

  // --- Where they were, after a restart. The player is left out at a known place.
  await win.locator("[data-testid=player-menu]").click();
  await win.locator("[data-testid=panel-pop-out]").click();
  player = await panelPage(app, "player");
  await setBounds(app, "Player", { x: 80, y: 60, width: 900, height: 600 });
  await sleep(800);
  const playerPlace = await boundsOf(app, "Player");
  // While the app is closed, the timeline's place moves off every screen (its display gone).
  const placesFile = path.join(ctx.udDir, "panel-windows.json");
  await app.close();
  const places = JSON.parse(fs.readFileSync(placesFile, "utf8"));
  places.timeline = { x: 30000, y: 20000, width: 1100, height: 420 };
  fs.writeFileSync(placesFile, JSON.stringify(places));
  ({ app, win } = await ctx.relaunch());
  await openEditor(win);
  player = await panelPage(app, "player");
  const playerAgain = await boundsOf(app, "Player");
  check("after a restart the player, left out, comes back in its window where it was", !!player && same(playerAgain, playerPlace), `${fmt(playerPlace)} → ${fmt(playerAgain)}`);
  if (player) {
    await sleep(1500);
    const pr = await picture(player, aspect);
    check("…showing the engine's frame", !!pr && pr.light > 0.05, pr ? `lightness ${pr.light.toFixed(3)}` : "no canvas");
  }
  const ib2 = await win.locator("[data-testid=inspector]").boundingBox();
  await win.mouse.click(ib2.x + ib2.width / 2, ib2.y + 20, { button: "right" });
  await win.locator("[data-testid=menu-panel-pop-out]").click();
  await panelPage(app, "inspector");
  const inspectorAgain = await boundsOf(app, "Inspector");
  check("the inspector popped out again opens where it was", same(inspectorAgain, inspectorPlace), `${fmt(inspectorPlace)} → ${fmt(inspectorAgain)}`);
  const tb = await win.locator("[data-testid=timeline]").boundingBox();
  await win.mouse.click(tb.x + tb.width / 2, tb.y + 16, { button: "right" });
  await win.locator("[data-testid=menu-panel-pop-out]").click();
  await panelPage(app, "timeline");
  const timelineAgain = await boundsOf(app, "Timeline");
  const area = timelineAgain ? await workAreaOf(app, timelineAgain) : null;
  const inside = !!area && timelineAgain.x >= area.x && timelineAgain.y >= area.y && timelineAgain.x + timelineAgain.width <= area.x + area.width && timelineAgain.y + timelineAgain.height <= area.y + area.height;
  check("a place left off-screen comes back on-screen", inside, `saved 30000,20000 → ${fmt(timelineAgain)} on ${fmt(area)}`);
  await ctx.shot("windows-all-out");
  // Home closes them; the project opened again brings them back.
  await goHome(win);
  const atHome = (await panelWindows(app)).length;
  await openEditor(win);
  const reopened = await waitFor(async () => (await panelWindows(app)).length === 3, 10000);
  check("Home closes the panels' windows, and they come back with the project", atHome === 0 && reopened, `${atHome} at home, ${(await panelWindows(app)).length} after`);
  // The editor's page reloaded (View ▸ Reload): its windows go with the old page, none left blank.
  await win.reload();
  await openEditor(win);
  await waitFor(async () => (await panelWindows(app)).length === 3, 10000);
  await sleep(1000);
  check("a reload leaves no blank windows behind (the three come back)", (await panelWindows(app)).length === 3, `${(await panelWindows(app)).length} windows`);
  await win.locator("[data-testid=layout-menu]").click();
  await win.locator("[data-testid=layout-reset]").click();
  await waitFor(async () => (await panelWindows(app)).length === 0);
  check("Reset current layout docks them all", (await panelWindows(app)).length === 0 && (await win.locator("[data-testid=player], [data-testid=inspector], [data-testid=timeline], [data-testid=assets]").count()) === 4);
  return `${report()}\n  ${notes.join("\n  ")}`;
};
