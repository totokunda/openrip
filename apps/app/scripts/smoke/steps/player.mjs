// The player as CapCut's (after import timeline): the header menu and each of its items; the
// colour oscilloscope (on, drawn from the engine's frame, changing with it, and playback's
// frame rate with it on); rulers and a guide dragged out of one, a clip snapping to it, saved,
// undone and redone, the guide's menu and Edit guide; Export still frames (the file against the
// engine's frame); zoom from the bottom bar's popover; each quality level's render size while
// playing; the stereo meter moving while playing; full screen; the bar's order. Shots are named
// after the CapCut references they match (16-player/0xx).
import path from "node:path";
import { drag, engineFrame, previewRect, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, clipsWhere, savedProject, select } from "./_anim.mjs";

const menuOpen = async (win) => {
  if (!(await win.locator("[data-testid=player-menu-content]").count())) await win.locator("[data-testid=player-menu]").click();
  await win.waitForTimeout(250);
};
const escape = async (win, n = 1) => {
  for (let i = 0; i < n; i++) await win.keyboard.press("Escape");
  await win.waitForTimeout(200);
};
// Open a submenu of the header menu and click one of its rows.
const subItem = async (win, sub, item) => {
  await menuOpen(win);
  await win.locator(`[data-testid=${sub}]`).hover();
  await win.waitForTimeout(350);
  await win.locator(`[data-testid=${item}]`).click();
  await win.waitForTimeout(300);
};
const box = (win, sel) => win.locator(sel).first().boundingBox();
const store = (win, expr) => win.evaluate(expr);

// The scopes' canvas: how much light is in each panel and the waveform's light-weighted mean
// height (0 bottom … 1 top), from its pixels.
const scopeStats = (win) =>
  win.evaluate(() => {
    const c = document.querySelector("[data-testid=scopes-canvas]");
    if (!c) return null;
    const t = document.createElement("canvas");
    [t.width, t.height] = [c.width, c.height];
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    const cr = c.getBoundingClientRect();
    const panels = [...document.querySelectorAll("[data-testid^=scope-]")].filter((e) => /^scope-(parade|waveform|vectorscope)$/.test(e.dataset.testid));
    const k = t.width / cr.width;
    const out = {};
    let hash = 0;
    for (const p of panels) {
      const r = p.getBoundingClientRect();
      const [x0, y0, x1, y1] = [Math.round((r.left - cr.left) * k), Math.round((r.top - cr.top) * k), Math.round((r.right - cr.left) * k), Math.round((r.bottom - cr.top) * k)];
      let light = 0, wy = 0;
      for (let y = Math.max(0, y0); y < Math.min(t.height, y1); y++)
        for (let x = Math.max(0, x0); x < Math.min(t.width, x1); x++) {
          const i = (y * t.width + x) * 4;
          const v = d[i] + d[i + 1] + d[i + 2];
          light += v;
          wy += v * (1 - (y - y0) / (y1 - y0));
          hash = (hash * 31 + v) % 1000000007;
        }
      out[p.dataset.testid.slice(6)] = { light: Math.round(light / 765), meanY: light ? wy / light : 0 };
    }
    const s = c.__scopes?.stats ?? {};
    return { panels: out, hash, renders: s.renders ?? 0, ms: s.ms ?? 0, samples: s.samples ?? 0 };
  });

// The engine frame's mean of R, G and B together (0 … 1): where the RGB waveform's light sits.
const frameMean = (win) =>
  win.evaluate(() => {
    const c = document.getElementById("openrip-engine-frame");
    const t = document.createElement("canvas");
    [t.width, t.height] = [c.width, c.height];
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s / (d.length / 4) / 765;
  });

// Frames the engine draws from now on, as [time, timeUs, width, height].
const watch = (win) =>
  win.evaluate(() => {
    window.__pf = [];
    if (window.__pfOn) return;
    window.__pfOn = true;
    document.getElementById("openrip-engine-frame").addEventListener("openrip-engine-frame", (e) => window.__pf?.push([performance.now(), e.detail?.timeUs ?? -1, e.detail?.width ?? 0, e.detail?.height ?? 0]));
  });
const watched = (win) => win.evaluate(() => window.__pf ?? []);

export default async (ctx) => {
  const { win, app, shot, udDir, outDir } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 2);
  const doc = () => savedProject(win, udDir);

  ctx.logs.push("[player] The bottom bar, in CapCut's order: time, meter | play | safe areas, quality, zoom, ratio, full screen.");
  // ---- The bottom bar, in CapCut's order: time, meter | play | safe areas, quality, zoom, ratio, full screen.
  const order = await win.evaluate(() => {
    const bar = document.querySelector("[data-testid=player-bar]");
    const ids = ["player-time", "audio-meter", "play", "safe-areas-button", "preview-quality", "zoom-button", "ratio-menu", "fullscreen"];
    return ids.map((id) => [id, bar?.querySelector(`[data-testid=${id}]`)?.getBoundingClientRect().x ?? -1]);
  });
  const xs = order.map(([, x]) => x);
  check("bottom bar in CapCut's order", xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1])), order.map(([id, x]) => `${id}@${Math.round(x)}`).join(" "));
  const labels = await win.evaluate(() => [document.querySelector("[data-testid=preview-quality]")?.innerText.trim(), document.querySelector("[data-testid=ratio-menu]")?.innerText.trim()]);
  check("boxed labels Full and Ratio", labels[0] === "Full" && labels[1] === "Ratio", labels.join(","));
  await shot("p00-bar");

  ctx.logs.push("[player] The header menu: CapCut's three items, 200 wide, 32 px rows.");
  // ---- The header menu: CapCut's three items, 200 wide, 32 px rows.
  await menuOpen(win);
  const items = await win.evaluate(() => [...document.querySelectorAll("[data-testid=player-menu-content] [role=menuitem]")].map((e) => e.innerText.trim()));
  // (After a separator, OpenRip's own Pop out: the player in a window of its own.)
  check("header menu: Color oscilloscope, Guides and rulers, Export still frames (then Pop out)", JSON.stringify(items) === JSON.stringify(["Color oscilloscope", "Guides and rulers", "Export still frames", "Pop out"]), JSON.stringify(items));
  const menuBox = await box(win, "[data-testid=player-menu-content]");
  const rows = await win.evaluate(() => [...document.querySelectorAll("[data-testid=player-menu-content] [role=menuitem]")].map((e) => e.getBoundingClientRect().y));
  check("header menu 200 wide, rows 32 px apart", Math.abs(menuBox.width - 200) < 2 && rows.length === 4 && Math.abs(rows[1] - rows[0] - 32) < 1.5 && Math.abs(rows[2] - rows[1] - 32) < 1.5, `${menuBox.width}×${menuBox.height}, rows ${rows.map((y) => y.toFixed(1)).join(",")}`);
  await shot("p01-header-menu"); // 001-header-menu
  await win.locator("[data-testid=menu-guides]").hover();
  await win.waitForTimeout(400);
  const guideItems = await win.evaluate(() => [...document.querySelectorAll("[data-testid=guides-menu] [role^=menuitem]")].map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  check("Guides and rulers submenu", guideItems.length >= 4 && guideItems[0].startsWith("Show rulers") && guideItems.some((t) => t.startsWith("Add horizontal guide")), JSON.stringify(guideItems));
  await shot("p02-guides-rulers-menu"); // 002-guides-rulers-menu
  await win.locator("[data-testid=menu-oscilloscope]").hover();
  await win.waitForTimeout(400);
  const scopeItems = await win.evaluate(() => [...document.querySelectorAll("[data-testid=oscilloscope-menu] [role^=menuitem]")].map((e) => e.innerText.trim()));
  check("Color oscilloscope submenu", scopeItems[0] === "Show" && scopeItems.length === 4, JSON.stringify(scopeItems));
  await escape(win, 2);

  ctx.logs.push("[player] The oscilloscope: on, drawn, under a smaller canvas, changing with the frame.");
  // ---- The oscilloscope: on, drawn, under a smaller canvas, changing with the frame.
  const canvasBefore = await previewRect(win);
  await subItem(win, "menu-oscilloscope", "scopes-show");
  await escape(win, 2);
  await win.waitForTimeout(800);
  const scopes = await box(win, "[data-testid=scopes]");
  const panels = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=scope-]")].filter((e) => /^scope-(parade|waveform|vectorscope)$/.test(e.dataset.testid)).map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.testid.slice(6), Math.round(r.width), Math.round(r.height)]; }));
  check("scopes: RGB parade, waveform, vectorscope in a row", panels.map((p) => p[0]).join(",") === "parade,waveform,vectorscope", JSON.stringify(panels));
  check("scope panels keep CapCut's 182×127 shape", panels.every((p) => Math.abs(p[2] / p[1] - 127 / 182) < 0.03), JSON.stringify(panels));
  const canvasAfter = await previewRect(win);
  const frameAfter = await engineFrame(win);
  check("the canvas shrinks above the scopes and the frame refits", scopes && canvasAfter.h < canvasBefore.h - 40, `${Math.round(canvasBefore.h)} → ${Math.round(canvasAfter.h)} px tall; frame ${frameAfter.w}×${frameAfter.h}`);
  let s1 = await scopeStats(win);
  check("scopes drawn from the engine's frame", s1 && Object.values(s1.panels).every((p) => p.light > 50), JSON.stringify(s1?.panels));
  const mean = await frameMean(win);
  check("the RGB waveform's light sits at the frame's level", s1 && Math.abs(s1.panels.waveform.meanY - mean) < 0.12, `waveform mean height ${s1?.panels.waveform.meanY.toFixed(3)}, frame mean ${mean.toFixed(3)}`);
  await shot("p09-color-oscilloscope"); // 009-color-oscilloscope
  await settled(win, () => seek(win, ctx.map, 8));
  await win.waitForTimeout(400);
  const s2 = await scopeStats(win);
  check("scopes change with the frame", s2 && s2.hash !== s1.hash && s2.renders > s1.renders, `renders ${s1?.renders} → ${s2?.renders}`);

  // Playback with the scopes on: frames shown a second, and scope draws.
  {
    await seek(win, ctx.map, 0.5);
    await watch(win);
    const r0 = (await scopeStats(win)).renders;
    const t0 = Date.now();
    await win.locator("[data-testid=play]").click();
    await win.waitForTimeout(6000);
    await win.locator("[data-testid=play]").click();
    const secs = (Date.now() - t0) / 1000;
    const f = (await watched(win)).filter((x) => x[0] > 0);
    const settledF = f.slice(Math.floor(f.length * 0.1));
    const span = settledF.length > 1 ? (settledF[settledF.length - 1][0] - settledF[0][0]) / 1000 : 0;
    const fps = settledF.length > 1 ? (settledF.length - 1) / span : 0;
    const r1 = (await scopeStats(win)).renders;
    const sps = (r1 - r0) / secs;
    ctx.scopeFps = fps;
    check("playback keeps 24 fps with the scopes on", fps >= 23, `${fps.toFixed(1)} frames/s shown, scopes drawn ${sps.toFixed(1)}/s, last draw ${(await scopeStats(win)).ms.toFixed(2)} ms CPU`);
    check("the scopes follow every frame played", r1 - r0 >= f.length * 0.95, `${r1 - r0} draws for ${f.length} frames`);
  }
  await subItem(win, "menu-oscilloscope", "scopes-show");
  await escape(win, 2);
  check("scopes hidden again", (await win.locator("[data-testid=scopes]").count()) === 0);

  ctx.logs.push("[player] Rulers (⌘⌥R) and guides.");
  // ---- Rulers (⌘⌥R) and guides.
  await win.keyboard.press("Meta+Alt+r");
  await win.waitForTimeout(600);
  const rx = await box(win, "[data-testid=ruler-x]");
  const ry = await box(win, "[data-testid=ruler-y]");
  const area = await box(win, "[data-testid=player-canvas-area]");
  check("⌘⌥R shows 16 px rulers along the top and left", rx && ry && Math.round(rx.height) === 16 && Math.round(ry.width) === 16 && Math.abs(area.y - rx.y - 16) < 1 && Math.abs(rx.width - area.width) < 1 && Math.abs(ry.height - area.height) < 1, `${rx?.width}×${rx?.height}, ${ry?.width}×${ry?.height}`);
  await shot("p10-rulers-visible"); // 010-rulers-visible
  // The frame on screen (the player's empty box over it), and the canvas's shape.
  const frameOn = async () => {
    const r = await box(win, "[data-testid=player-frame]");
    return { fleft: r.x, ftop: r.y, fw: r.width, fh: r.height };
  };
  const fb = await win.evaluate(() => {
    const c = document.getElementById("openrip-engine-frame");
    return { w: c.width, h: c.height };
  });
  const { fleft, ftop, fw, fh } = await frameOn();
  check("the frame fills the canvas area's height, as CapCut's", Math.abs(fh - area.height) < 1.5, `frame ${fw.toFixed(1)}×${fh.toFixed(1)} in an area ${area.width.toFixed(1)}×${area.height.toFixed(1)}`);
  // A guide dragged down out of the top ruler to 30% of the way down the frame.
  const guideY = ftop + fh * 0.3;
  await drag(win, rx.x + rx.width / 2, rx.y + 8, rx.x + rx.width / 2, guideY);
  await win.waitForTimeout(500);
  let d = await doc();
  let guides = d.settings?.guides ?? [];
  check("a guide dragged out of the top ruler is horizontal, where it was let go, and saved", guides.length === 1 && guides[0].axis === "y" && Math.abs(guides[0].at - 0.3) < 0.02, JSON.stringify(guides));
  const guideAt = guides[0]?.at ?? 0.3;
  const lineBox = await box(win, "[data-testid=player-guide]");
  check("the guide is drawn across the canvas area", lineBox && Math.abs(lineBox.y + lineBox.height / 2 - guideY) < 2 && lineBox.width >= area.width - 1, JSON.stringify(lineBox));
  await shot("p03-guide-from-ruler");

  // The video dragged down so its top edge comes 2 px short of the guide: it snaps onto it.
  const video = clipsWhere(d, (c) => c.type === "video")[0];
  await select(ctx, d, video.clipId, 2);
  await win.keyboard.press("v");
  const y0 = video.transform?.y ?? 0;
  const dy = guideAt * fh - 2;
  await settled(win, () => drag(win, fleft + fw * 0.5, ftop + fh * 0.6, fleft + fw * 0.5, ftop + fh * 0.6 + dy));
  d = await doc();
  const yOf = (dd) => dd.timeline.clips.find((c) => c.clipId === video.clipId).transform?.y ?? 0;
  const worldH = 600;
  check("the clip's top edge snaps onto the guide", Math.abs(yOf(d) - guideAt * worldH) < 0.6, `top ${yOf(d).toFixed(2)} world, guide at ${(guideAt * worldH).toFixed(2)} (from ${y0})`);
  await shot("p03-snapped");
  // Undo: the move, then the guide; redo both.
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(600);
  d = await doc();
  check("⌘Z puts the clip back", Math.abs(yOf(d) - y0) < 0.01 && (d.settings?.guides ?? []).length === 1, `top ${yOf(d)}`);
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(600);
  d = await doc();
  check("⌘Z again takes the guide away", (d.settings?.guides ?? []).length === 0 && (await win.locator("[data-testid=player-guide]").count()) === 0, JSON.stringify(d.settings?.guides));
  await win.keyboard.press("Meta+Shift+z");
  await win.waitForTimeout(400);
  await win.keyboard.press("Meta+Shift+z");
  await win.waitForTimeout(600);
  d = await doc();
  check("⇧⌘Z twice brings the guide and the move back", (d.settings?.guides ?? []).length === 1 && Math.abs(yOf(d) - guideAt * worldH) < 0.6, `${JSON.stringify(d.settings?.guides)} top ${yOf(d)}`);

  // ⌘; hides the guides; again shows them.
  await win.keyboard.press("Meta+;");
  await win.waitForTimeout(300);
  check("⌘; hides the guides", (await win.locator("[data-testid=player-guide]").count()) === 0);
  await win.keyboard.press("Meta+;");
  await win.waitForTimeout(300);
  check("⌘; shows them again", (await win.locator("[data-testid=player-guide]").count()) === 1);

  // The guide's right-click menu, and Edit guide: 0 px puts it in the canvas's middle.
  await win.keyboard.press("Meta+z"); // the clip back where it was, for the shots
  await win.waitForTimeout(500);
  const gl = await box(win, "[data-testid=player-guide]");
  await win.mouse.click(gl.x + gl.width * 0.55, gl.y + gl.height / 2, { button: "right" });
  await win.waitForTimeout(400);
  const gItems = await win.evaluate(() => [...document.querySelectorAll("[data-testid=guide-menu] [role=menuitem]")].map((e) => e.innerText.trim()));
  check("a guide's menu: Edit guide, Delete guide", JSON.stringify(gItems) === JSON.stringify(["Edit guide", "Delete guide"]), JSON.stringify(gItems));
  await shot("p08-guide-context-menu"); // 008-guide-context-menu
  await win.locator("[data-testid=guide-edit]").click();
  await win.waitForTimeout(400);
  const shownPx = await win.locator("[data-testid=guide-position]").inputValue();
  const expectPx = Math.round((0.5 - guideAt) * 3840);
  check("Edit guide shows its place in pixels from the middle, y up", Math.abs(+shownPx - expectPx) <= 2, `${shownPx} px, expected ${expectPx}`);
  await shot("p31-014-edit-guide-dialog"); // 31-dialogs/014-edit-guide-dialog
  await win.locator("[data-testid=guide-units]").click();
  await win.waitForTimeout(300);
  await shot("p31-015-guide-units-menu"); // 31-dialogs/015-guide-units-menu
  await win.locator("[data-testid=guide-units-pixels]").click();
  await win.waitForTimeout(200);
  await win.locator("[data-testid=guide-position]").fill("0");
  await win.locator("[data-testid=guide-ok]").click();
  await win.waitForTimeout(600);
  d = await doc();
  check("Edit guide to Y 0 puts it in the middle", Math.abs((d.settings?.guides?.[0]?.at ?? 0) - 0.5) < 1e-6, JSON.stringify(d.settings?.guides));
  await win.keyboard.press("Meta+Alt+r");
  await win.waitForTimeout(500);
  check("⌘⌥R hides the rulers", (await win.locator("[data-testid=ruler-x]").count()) === 0);
  await shot("p03-horizontal-guide"); // 003-horizontal-guide
  const gl2 = await box(win, "[data-testid=player-guide]");
  await win.mouse.click(gl2.x + gl2.width * 0.55, gl2.y + gl2.height / 2, { button: "right" });
  await win.waitForTimeout(300);
  await win.locator("[data-testid=guide-delete]").click();
  await win.waitForTimeout(600);
  d = await doc();
  check("Delete guide", (d.settings?.guides ?? []).length === 0 && (await win.locator("[data-testid=player-guide]").count()) === 0);
  // The menu's Add vertical guide: one down the middle; Clear guides.
  await subItem(win, "menu-guides", "guide-add-vertical");
  await escape(win, 2);
  d = await doc();
  check("Add vertical guide puts one down the middle", (d.settings?.guides ?? []).length === 1 && d.settings.guides[0].axis === "x" && d.settings.guides[0].at === 0.5);
  // A transform snaps too: the guide moved to X 648 px (80% across), the video's bottom-right
  // handle dragged in to 2 px short of it.
  {
    const vg = await box(win, "[data-testid=player-guide]");
    await win.mouse.click(vg.x + vg.width / 2, vg.y + vg.height * 0.3, { button: "right" });
    await win.waitForTimeout(300);
    await win.locator("[data-testid=guide-edit]").click();
    await win.waitForTimeout(300);
    await win.locator("[data-testid=guide-position]").fill("648");
    await win.locator("[data-testid=guide-ok]").click();
    await win.waitForTimeout(500);
    d = await doc();
    check("Edit guide moves a vertical guide to X 648 px (80%)", Math.abs((d.settings?.guides?.[0]?.at ?? 0) - 0.8) < 1e-6, JSON.stringify(d.settings?.guides));
    const { fleft: gx, ftop: gy, fw: gw, fh: gh } = await frameOn();
    await select(ctx, d, video.clipId, 3);
    await win.keyboard.press("v");
    await settled(win, () => drag(win, gx + gw - 0.5, gy + gh - 0.5, gx + gw * 0.8 + 2, gy + gh * 0.8 + 2));
    d = await doc();
    const t = d.timeline.clips.find((c) => c.clipId === video.clipId).transform ?? {};
    const right = (t.x ?? 0) + (t.width ?? 0) * (t.scaleX ?? 1);
    const rectW = (600 * fb.w) / fb.h;
    check("resizing snaps the moving edge onto the guide", Math.abs(right - 0.8 * rectW) < 0.6, `right edge ${right.toFixed(2)} world, guide at ${(0.8 * rectW).toFixed(2)}`);
    await shot("p03-resize-snapped");
    await win.keyboard.press("Meta+z");
    await win.waitForTimeout(500);
  }
  await subItem(win, "menu-guides", "guides-clear");
  await escape(win, 2);
  d = await doc();
  check("Clear guides", (d.settings?.guides ?? []).length === 0);

  ctx.logs.push("[player] Export still frames: the frame at the playhead at the project's size, as a PNG.");
  // ---- Export still frames: the frame at the playhead at the project's size, as a PNG.
  {
    const file = path.join(outDir, "still.png");
    ctx.fs.rmSync(file, { force: true });
    await app.evaluate(({ ipcMain }, f) => {
      ipcMain.removeHandler("dialog:pick-save-path");
      ipcMain.handle("dialog:pick-save-path", async () => f);
    }, file);
    await seek(win, ctx.map, 3);
    await menuOpen(win);
    await win.locator("[data-testid=export-still]").hover();
    await win.waitForTimeout(200);
    await shot("p01-export-still-frames");
    await win.locator("[data-testid=export-still]").click();
    const t0 = Date.now();
    for (let i = 0; i < 120 && !ctx.fs.existsSync(file); i++) await win.waitForTimeout(250);
    const took = Date.now() - t0;
    await win.waitForTimeout(800);
    const ok = ctx.fs.existsSync(file);
    const buf = ok ? ctx.fs.readFileSync(file) : Buffer.alloc(0);
    const [pw, ph] = ok ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : [0, 0];
    check("Export still frames writes a PNG at the project's size", ok && buf.subarray(1, 4).toString() === "PNG" && pw === 2160 && ph === 3840, `${pw}×${ph}, ${(buf.length / 1e6).toFixed(1)} MB, written ${(took / 1000).toFixed(1)} s after the click`);
    // Against the engine's frame: the still scaled to the frame canvas's size.
    const fsz = await win.evaluate(() => {
      const c = document.getElementById("openrip-engine-frame");
      return { w: c.width, h: c.height };
    });
    const bgra = await app.evaluate(({ nativeImage }, { f, w, h }) => Array.from(nativeImage.createFromPath(f).resize({ width: w, height: h, quality: "best" }).toBitmap()), { f: file, w: fsz.w, h: fsz.h });
    const cmp = await win.evaluate(({ bgra }) => {
      const c = document.getElementById("openrip-engine-frame");
      const t = document.createElement("canvas");
      [t.width, t.height] = [c.width, c.height];
      const g = t.getContext("2d");
      g.drawImage(c, 0, 0);
      const px = g.getImageData(0, 0, t.width, t.height).data;
      let diff = 0, n = 0;
      for (let i = 0; i < px.length && i + 2 < bgra.length; i += 4) {
        diff += Math.abs(px[i] - bgra[i + 2]) + Math.abs(px[i + 1] - bgra[i + 1]) + Math.abs(px[i + 2] - bgra[i]);
        n += 3;
      }
      return { mean: n ? diff / n : 255, w: t.width, h: t.height };
    }, { bgra });
    check("the still matches the engine's frame", cmp.mean < 6, `mean difference ${cmp.mean.toFixed(2)} / 255 at ${cmp.w}×${cmp.h}`);
  }

  ctx.logs.push("[player] Zoom from the bottom bar's popover.");
  // ---- Zoom from the bottom bar's popover.
  {
    const zoom = async () => +(await win.locator("[data-testid=zoom-slider]").getAttribute("data-zoom"));
    await win.locator("[data-testid=zoom-button]").click();
    await win.waitForTimeout(400);
    const pop = await box(win, "[data-testid=zoom-popover]");
    check("the zoom button opens a 180×37 popover with −, slider, +", pop && Math.abs(pop.width - 180) < 2 && Math.abs(pop.height - 37) < 2 && (await win.locator("[data-testid=zoom-out]").count()) === 1 && (await win.locator("[data-testid=zoom-in]").count()) === 1, JSON.stringify(pop));
    const z0 = await zoom();
    const f0 = await engineFrame(win);
    await win.locator("[data-testid=zoom-in]").click();
    await win.locator("[data-testid=zoom-in]").click();
    await win.waitForTimeout(800);
    const z1 = await zoom();
    const f1 = await engineFrame(win);
    check("+ twice zooms to 120% of fit, the engine renders bigger", Math.abs(z0 - 1) < 0.01 && Math.abs(z1 - 1.2) < 0.01 && f1.h > f0.h, `${z0} → ${z1}; frame ${f0.w}×${f0.h} → ${f1.w}×${f1.h}`);
    const sl = await box(win, "[data-testid=zoom-slider]");
    await win.mouse.click(sl.x + sl.width * 0.5, sl.y + sl.height / 2);
    await win.waitForTimeout(800);
    const z2 = await zoom();
    check("the slider's middle is about 225% of fit, and the navigator shows", Math.abs(z2 - 2.25) < 0.1 && (await win.locator("[data-testid=zoom-navigator]").count()) === 1, `${z2}`);
    await shot("p05-zoom-popover"); // 005-zoom-popover
    await win.locator("[data-testid=zoom-out]").click();
    await win.waitForTimeout(300);
    const z3 = await zoom();
    check("− steps back 10%", Math.abs(z3 - Math.round((z2 - 0.1) * 10) / 10) < 0.011, `${z2} → ${z3}`);
    await escape(win);
    await win.keyboard.press("Alt+Shift+z");
    await win.waitForTimeout(500);
    await win.locator("[data-testid=zoom-button]").click();
    await win.waitForTimeout(300);
    const z4 = await zoom();
    check("⌥⇧Z fits again, no navigator", Math.abs(z4 - 1) < 0.01 && (await win.locator("[data-testid=zoom-navigator]").count()) === 0, `${z4}`);
    await escape(win);
    await menuOpen(win);
    const menuZoom = await win.evaluate(() => document.querySelector("[data-testid=player-menu-content]")?.innerText ?? "");
    check("no zoom items left in the header menu", !/zoom/i.test(menuZoom), menuZoom.replace(/\s+/g, " "));
    await escape(win);
  }

  ctx.logs.push("[player] Quality: each level's playback render size, and the meter while playing.");
  // ---- Quality: each level's playback render size, and the meter while playing.
  {
    await seek(win, ctx.map, 1);
    const pausedFrame = await engineFrame(win);
    const sizes = {};
    let meterMax = 0, meterSeen = "";
    for (const q of ["full", "high", "medium", "low"]) {
      await win.locator("[data-testid=preview-quality]").click();
      await win.waitForTimeout(300);
      if (q === "high") await shot("p04-quality-menu"); // 004-quality-menu
      await win.locator(`[data-testid=quality-${q}]`).click();
      await win.waitForTimeout(300);
      await watch(win);
      await win.locator("[data-testid=play]").click();
      for (let i = 0; i < 10; i++) {
        await win.waitForTimeout(200);
        const lit = (await win.locator("[data-testid=audio-meter]").getAttribute("data-lit")).split(",").map(Number);
        if (lit[0] + lit[1] > meterMax) {
          meterMax = lit[0] + lit[1];
          meterSeen = lit.join(",");
          if (q === "full") await shot("p02-meter-playing");
        }
      }
      await win.locator("[data-testid=play]").click();
      await win.waitForTimeout(600);
      const f = (await watched(win)).filter((x) => x[2] > 0);
      const mid = f[Math.floor(f.length / 2)];
      sizes[q] = mid ? `${mid[2]}x${mid[3]}` : "none";
      await seek(win, ctx.map, 1);
    }
    const w = (q) => +sizes[q].split("x")[0];
    const expect = { full: 1, high: 0.75, medium: 0.5, low: 0.25 };
    const okSizes = Object.entries(expect).every(([q, k]) => Math.abs(w(q) / w("full") - k) < 0.03);
    check("each quality renders playback at its fraction (1, ¾, ½, ¼)", okSizes && Math.abs(w("full") - pausedFrame.w) <= 2, `paused ${pausedFrame.w}x${pausedFrame.h}; ${JSON.stringify(sizes)}`);
    const after = await engineFrame(win);
    check("paused frames stay full size at Low", Math.abs(after.w - pausedFrame.w) <= 2, `${after.w}x${after.h}`);
    check("the meter lights green while playing", meterMax >= 2, `most bars lit ${meterSeen || "0,0"}`);
    const idle = await win.locator("[data-testid=audio-meter]").getAttribute("data-lit");
    check("the meter is grey when paused", idle === "0,0", idle);
    await win.locator("[data-testid=preview-quality]").click();
    await win.waitForTimeout(200);
    await win.locator("[data-testid=quality-full]").click();
    await win.waitForTimeout(300);
  }

  ctx.logs.push("[player] Safe areas (the bar's first button on the right), and full screen.");
  // ---- Safe areas (the bar's first button on the right), and full screen.
  await win.locator("[data-testid=safe-areas-button]").click();
  await win.waitForTimeout(300);
  check("the safe-area button draws the safe areas", (await win.locator("[data-testid=safe-area-guides]").count()) === 1);
  await win.locator("[data-testid=safe-areas-button]").click();
  await win.waitForTimeout(300);
  {
    await win.keyboard.press("Meta+Shift+f");
    await win.waitForTimeout(2500);
    const fsOn = (await win.locator("[data-testid=fullscreen-preview]").count()) === 1;
    const fsFrame = await win.evaluate(() => {
      const c = document.querySelector("[data-testid=fullscreen-frame]");
      if (!c) return null;
      const t = document.createElement("canvas");
      [t.width, t.height] = [c.width, c.height];
      const g = t.getContext("2d");
      g.drawImage(c, 0, 0);
      const px = g.getImageData(0, 0, t.width, t.height).data;
      let light = 0;
      for (let i = 0; i < px.length; i += 4) light += (px[i] + px[i + 1] + px[i + 2]) / 765;
      const r = c.getBoundingClientRect();
      return { w: c.width, h: c.height, cssH: Math.round(r.height), screenH: innerHeight, fullscreen: !!document.fullscreenElement, light: light / (px.length / 4) };
    });
    const barBox = await box(win, "[data-testid=fullscreen-bar]");
    check("⌘⇧F: full screen with the engine's frame, fitted", fsOn && fsFrame && fsFrame.light > 0.1 && Math.abs(fsFrame.cssH - fsFrame.screenH) < 2, JSON.stringify(fsFrame));
    check("full screen's bar is 556×44", barBox && Math.abs(barBox.width - 556) < 2 && Math.abs(barBox.height - 44) < 2, JSON.stringify(barBox));
    await shot("p07-fullscreen-preview"); // 007-fullscreen-preview
    await win.keyboard.press("Escape");
    await win.waitForTimeout(2500);
    check("Esc leaves full screen", (await win.locator("[data-testid=fullscreen-preview]").count()) === 0);
    const back = await engineFrame(win);
    check("the player draws again after full screen", back.light > 0.1 && back.w > 100, JSON.stringify(back));
  }

  return report();
};
