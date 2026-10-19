// Classic video clean-up through its controls (on a fresh project, alone; IMG_9079 with
// CLIP_NAME=IMG_9079). The step makes its own fixture with FFmpeg from the clip (the test clip
// is too steady to measure shake on): 5 s at 30 fps, 720x1280, zoomed in and shaken by a
// jittering crop window, with temporal noise and a flickering brightness, so each effect has a
// measurable cause and the step can see it removed:
// - Video › Basic lists Stabilize, Reduce image noise, Optical flow and Remove flickers, then
//   Motion blur, each off; Stabilize's Level (Recommended, Minimal cut, Most stable);
// - Stabilize ticked: saved on the clip; the engine tracks the clip (progress in the section
//   and the timeline's pill), keeps the result in its cache folder, and the frames from then
//   on shake less (RMS shift between consecutive frames, found by block matching on the
//   engine's own picture); each Level saved and drawn; one undo step; ticked again it is
//   instant (no second analysis);
// - Reduce image noise: saved, the picture changes and has less fine detail, more at a higher
//   strength (typed into its field);
// - Remove flickers: saved, tracked already, no brightness jump added;
// - the clip menu's Enhance visuals and Enhance motion (Motion blur): ticked as the settings
//   are, picking flips them, and the picture changes;
// - an export through the engine with all of them on: its frames read with ffmpeg, as steady
//   as the preview's and closer to the preview with them on than with them off.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { now, rulerMap, seek, settled, tab } from "./_preview.mjs";
import { ffmpegPath, placeOnTimeline } from "./_fixture.mjs";
import { bar, checks, clipsWhere, savedProject, select } from "./_anim.mjs";
import { press, undoCase } from "./_undo.mjs";

// The engine's frame as a grey picture 200 px wide (what the measures below work on).
const WIDTH = 200;
const grayOf = (win) =>
  win.evaluate((W) => {
    const c = document.getElementById("openrip-engine-frame");
    const h = Math.round((c.height * W) / c.width);
    const t = document.createElement("canvas");
    t.width = W;
    t.height = h;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0, W, h);
    const d = g.getImageData(0, 0, W, h).data;
    const out = new Array(W * h);
    for (let i = 0; i < W * h; i++) out[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    return { w: W, h, data: out };
  }, WIDTH);

// A frame read from ffmpeg's raw grey output.
const framesOf = (buf, w, h) => {
  const n = Math.floor(buf.length / (w * h));
  return Array.from({ length: n }, (_, i) => ({ w, h, data: Array.from(buf.subarray(i * w * h, (i + 1) * w * h)) }));
};

// How far `b`'s picture is shifted from `a`'s: the whole-pixel shift (within ±R) with the least
// mean difference over the middle of the picture, refined to a fraction of a pixel by the
// parabola through its neighbours.
const shiftBetween = (a, b, R = 10) => {
  const { w, h } = a;
  const [x0, x1, y0, y1] = [Math.round(w * 0.2), Math.round(w * 0.8), Math.round(h * 0.2), Math.round(h * 0.8)];
  const cost = (dx, dy) => {
    let s = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += Math.abs(a.data[y * w + x] - b.data[(y + dy) * w + x + dx]);
    return s / ((x1 - x0) * (y1 - y0));
  };
  let best = [0, 0, Infinity];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const c = cost(dx, dy);
    if (c < best[2]) best = [dx, dy, c];
  }
  const refine = (c0, c1, c2) => {
    const d = c0 - 2 * c1 + c2;
    return d > 1e-9 ? (c0 - c2) / (2 * d) : 0;
  };
  const [bx, by] = best;
  return [bx + (Math.abs(bx) < R ? refine(cost(bx - 1, by), best[2], cost(bx + 1, by)) : 0), by + (Math.abs(by) < R ? refine(cost(bx, by - 1), best[2], cost(bx, by + 1)) : 0)];
};
// RMS of the frame to frame shifts (pixels at 200 px wide).
const shake = (frames) => {
  const s = frames.slice(1).map((f, i) => shiftBetween(frames[i], f));
  return Math.sqrt(s.reduce((acc, [x, y]) => acc + x * x + y * y, 0) / s.length);
};
// Fine detail: mean absolute Laplacian.
const detail = (f) => {
  let s = 0;
  for (let y = 1; y < f.h - 1; y++) for (let x = 1; x < f.w - 1; x++) {
    const i = y * f.w + x;
    s += Math.abs(4 * f.data[i] - f.data[i - 1] - f.data[i + 1] - f.data[i - f.w] - f.data[i + f.w]);
  }
  return s / ((f.w - 2) * (f.h - 2));
};
const mad = (a, b) => a.data.reduce((s, v, i) => s + Math.abs(v - b.data[i]), 0) / a.data.length;
const mean = (f) => f.data.reduce((s, v) => s + v, 0) / f.data.length;
const sd = (v) => Math.sqrt(v.reduce((s, x) => s + (x - v.reduce((p, q) => p + q, 0) / v.length) ** 2, 0) / v.length);

/** The fixture: the clip's picture shaken, noisy and flickering (the faults the clean-up removes). */
const shakyFixture = (ctx) => {
  const file = path.join(ctx.outDir, "enhance-fixture.mp4");
  const vf = [
    "fps=30,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,scale=864:1536",
    "crop=720:1280:x='72+0.3*n+8*sin(n*2.3)+4*sin(n*5.1+1)':y='128+0.15*n+6*sin(n*1.7+2)+3*sin(n*4.3)'",
    "noise=alls=16:allf=t",
    "eq=brightness='0.06*sin(n*2.1)+0.04*sin(n*3.9)':eval=frame",
    "format=yuv420p",
  ].join(",");
  execFileSync(ffmpegPath(), ["-v", "error", "-y", "-ss", "2", "-t", "5.5", "-i", ctx.clipPath, "-vf", vf, "-frames:v", "150", "-c:v", "libx264", "-crf", "12", "-preset", "veryfast", "-an", file]);
  return file;
};

export default async (ctx) => {
  const { app, win, shot, udDir, outDir, fs } = ctx;
  const { check, report } = checks();
  await placeOnTimeline(ctx, shakyFixture(ctx), "enhance-fixture");
  ctx.map = await rulerMap(win);
  const doc0 = await savedProject(win, udDir);
  const video = clipsWhere(doc0, (c) => c.type === "video")[0];
  const saved = async () => (await savedProject(win, udDir)).timeline.clips.find((c) => c.clipId === video.clipId);
  const open = async () => {
    // A click on a clip that is already selected can deselect it: click again if the tabs are gone.
    for (const off of [2, -1.5, 1.2]) {
      const head = await now(win);
      await select(ctx, await savedProject(win, udDir), video.clipId, Math.min(4.6, Math.max(0.4, head + off)));
      if (await win.locator("[data-testid=inspector] [role=tab]", { hasText: /^Video$/ }).count()) break;
    }
    await tab(win, "Video");
    await win.locator("[data-testid=inspector] [role=tab]", { hasText: /^Basic$/ }).click();
    await win.waitForTimeout(400);
  };
  const section = (name) => win.locator(`[data-testid=section-${name}]`);
  const box = (name) => section(name).locator("[role=checkbox]");
  const tick = async (name) => {
    // Seeking can leave the clip unselected.
    if (!(await section(name).count())) await open();
    await section(name).scrollIntoViewIfNeeded();
    await settled(win, () => box(name).click(), { timeout: 3000 });
  };
  const isOn = async (name) => (await box(name).getAttribute("aria-checked")) === "true";
  // Frame by frame from `from` s: the grey pictures.
  const FRAMES = 11;
  const sequence = async (from) => {
    await seek(win, ctx.map, from);
    await win.evaluate(() => document.activeElement?.blur?.());
    const out = [await grayOf(win)];
    for (let i = 1; i < FRAMES; i++) {
      await settled(win, () => win.keyboard.press("ArrowRight"), { timeout: 3000 });
      out.push(await grayOf(win));
    }
    return out;
  };
  const FROM = 1;
  const at = async (s) => {
    await seek(win, ctx.map, s);
    return grayOf(win);
  };

  // The sections, all off.
  await open();
  const names = ["stabilize", "denoise", "deflicker", "motion-blur"];
  for (const n of names) await section(n).scrollIntoViewIfNeeded();
  const titles = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tabpanel] section h4")].map((h) => h.innerText.trim()));
  const order = ["Stabilize", "Reduce image noise", "Optical flow", "Remove flickers", "Motion blur"].filter((t) => t !== "Optical flow");
  check("Video › Basic lists the clean-up sections in CapCut's order", order.every((t, i) => titles.indexOf(t) > (i ? titles.indexOf(order[i - 1]) : -1)), titles.join(" | "));
  check("all off", (await Promise.all(names.map(isOn))).every((v) => !v));
  let c = await saved();
  check("nothing saved on the clip", !c.enhance, JSON.stringify(c.enhance));
  await section("stabilize").scrollIntoViewIfNeeded();
  await shot("en1-sections");

  // Baseline: the picture and its shake with everything off.
  const plain = await sequence(FROM);
  const plainShake = shake(plain);
  const plainDetail = detail(plain[0]);
  const plainAt3 = await at(3);

  // Stabilize on: saved; the engine tracks the clip with progress, then the picture steadies.
  await open();
  await tick("stabilize");
  c = await saved();
  check("Stabilize saved with Recommended", c.enhance?.stabilize?.level === "recommended", JSON.stringify(c.enhance));
  let sawProgress = false;
  let pill = false;
  let maxShare = 0;
  const began = Date.now();
  let ended = 0;
  for (let i = 0; i < 3000; i++) {
    const p = await win.locator("[data-testid=analysing]").count();
    if (p) {
      sawProgress = true;
      if (!maxShare) await shot("en2-analysing");
      const text = await win.evaluate(() => document.querySelector("[data-testid=analysing]")?.textContent ?? "");
      maxShare = Math.max(maxShare, Number(text.match(/(\d+)%/)?.[1] ?? 0));
    }
    pill ||= (await win.locator("[data-testid=analysis-pill]").count()) > 0;
    if (!p && !(await win.locator("[data-testid=analysis-pill]").count()) && (sawProgress || pill || i > 100)) {
      ended = Date.now();
      break;
    }
    await win.waitForTimeout(40);
  }
  // A short clip can be tracked before the pill is up: it is required of runs over a second.
  const tracked = (ended - began) / 1000;
  check("tracking showed its progress in the section and the timeline's pill", sawProgress && (pill || tracked < 1.5), `section ${sawProgress}, pill ${pill}, up to ${maxShare}%, ${tracked.toFixed(1)} s`);
  await win.waitForTimeout(1500);
  const cached = fs.readdirSync(`${udDir}/engine-thumbnails`, { recursive: true }).filter((f) => String(f).endsWith("motion-v1.json"));
  check("the engine kept what it tracked in its cache folder", cached.length >= 1, cached.join(", "));
  await open();
  await seek(win, ctx.map, FROM);
  const steady = await sequence(FROM);
  const steadyShake = shake(steady);
  const shifts = (f) => f.slice(1).map((g, i) => shiftBetween(f[i], g).map((v) => +v.toFixed(2)));
  fs.writeFileSync(`${outDir}/enhance-shifts.json`, JSON.stringify({ plain: shifts(plain), steady: shifts(steady) }));
  check("stabilized: frame to frame shake drops by half", steadyShake < plainShake * 0.5, `${steadyShake.toFixed(2)} px against ${plainShake.toFixed(2)} px (RMS at ${WIDTH} px wide)`);
  const zoomed = mad(steady[0], plain[0]);
  check("the picture changed (moved and zoomed)", zoomed > 1, `mean difference ${zoomed.toFixed(1)}`);
  await open();
  await section("stabilize").scrollIntoViewIfNeeded();
  await shot("en3-stabilize-on");

  // One undo step; ticked again, no second analysis.
  await undoCase(ctx, check, "Stabilize", () => box("stabilize").click());
  await open();
  check("redone: off", !(await isOn("stabilize")));
  let again = false;
  await box("stabilize").click();
  for (let i = 0; i < 12; i++) {
    again ||= (await win.locator("[data-testid=analysing]").count()) > 0 || (await win.locator("[data-testid=analysis-pill]").count()) > 0;
    await win.waitForTimeout(200);
  }
  check("ticked again: nothing tracked a second time", !again && (await isOn("stabilize")));
  await win.waitForTimeout(1200);

  // Levels: each saved and drawn; Most stable steadier than Minimal cut.
  const levelNamed = async (label) => {
    await open();
    await section("stabilize").scrollIntoViewIfNeeded();
    await win.locator("[data-testid=stabilize-level]").click();
    await settled(win, () => win.getByRole("option", { name: label, exact: true }).click(), { timeout: 3000 });
    return (await saved()).enhance?.stabilize?.level;
  };
  const shakes = {};
  for (const [label, value] of [["Minimal cut", "minimal_cut"], ["Most stable", "most_stable"], ["Recommended", "recommended"]]) {
    const got = await levelNamed(label);
    check(`Level ${label} saved`, got === value, got);
    shakes[value] = shake(await sequence(FROM));
  }
  check("Most stable is steadier than Minimal cut", shakes.most_stable < shakes.minimal_cut, `${shakes.most_stable.toFixed(2)} against ${shakes.minimal_cut.toFixed(2)} px`);
  check("Minimal cut still steadier than plain", shakes.minimal_cut < plainShake, `${shakes.minimal_cut.toFixed(2)} against ${plainShake.toFixed(2)} px`);
  await open();
  await shot("en4-level");

  // Reduce image noise.
  await open();
  const before = await at(FROM + 1);
  await tick("denoise");
  c = await saved();
  check("Reduce image noise saved at 50", c.enhance?.denoise?.strength === 50, JSON.stringify(c.enhance?.denoise));
  const after50 = await at(FROM + 1);
  check("the picture changed", mad(before, after50) > 0.05, `mean difference ${mad(before, after50).toFixed(3)}`);
  check("fine detail drops (noise reduced)", detail(after50) < detail(before) * 0.85, `${detail(after50).toFixed(3)} against ${detail(before).toFixed(3)}`);
  await open();
  await open();
  const field = section("denoise").locator("input").first();
  await field.click();
  await win.keyboard.press("Meta+A");
  await win.keyboard.type("100");
  await settled(win, () => win.keyboard.press("Enter"), { timeout: 3000 });
  c = await saved();
  check("strength 100 saved", c.enhance?.denoise?.strength === 100, JSON.stringify(c.enhance?.denoise));
  const after100 = await at(FROM + 1);
  check("a higher strength removes more", detail(after100) < detail(after50), `${detail(after100).toFixed(3)} against ${detail(after50).toFixed(3)}`);
  await shot("en5-denoise");
  await undoCase(ctx, check, "Reduce image noise", async () => {
    await open();
    await section("denoise").scrollIntoViewIfNeeded();
    await box("denoise").click();
  });
  await open();
  await tick("denoise");

  // Remove flickers: tracked with the clip already, so it is instant.
  await open();
  const lightBefore = [];
  const flicker = async () => {
    const f = await sequence(FROM);
    const means = f.map(mean);
    return sd(means.slice(1).map((m, i) => m - means[i]));
  };
  const flickerOff = await flicker();
  await open();
  await tick("deflicker");
  c = await saved();
  check("Remove flickers saved", c.enhance?.deflicker === true, JSON.stringify(c.enhance));
  const flickerOn = await flicker();
  check("the flicker evens out", flickerOn < flickerOff * 0.5, `${flickerOn.toFixed(2)} against ${flickerOff.toFixed(2)} (spread of frame to frame brightness changes, 0–255)`);
  void lightBefore;
  await open();
  await shot("en6-deflicker");

  // The clip menu: Enhance visuals and Enhance motion.
  const beforeBlur = await at(FROM + 1);
  await settled(win, async () => {
    const [x, y] = await bar(ctx, await savedProject(win, udDir), video.clipId, 4.3);
    await win.mouse.click(x, y, { button: "right" });
  }, { timeout: 1500 });
  await win.waitForTimeout(400);
  await win.locator("[data-testid=menu-enhance-visuals]").hover();
  await win.waitForTimeout(300);
  const tickOf = async (id) => (await win.locator(`[data-testid=menu-${id}]`).getAttribute("class"))?.length ?? 0;
  const visuals = await win.locator("[data-testid=menu-enhance-visuals]").locator("xpath=..").innerText();
  check("Enhance visuals lists Stabilize, Reduce image noise, Remove flickers", ["Stabilize", "Reduce image noise", "Remove flickers"].every((t) => visuals.includes(t)), visuals.replace(/\n/g, " | "));
  await shot("en7-menu-visuals");
  await win.locator("[data-testid=menu-enhance-motion]").hover();
  await win.waitForTimeout(300);
  check("Enhance motion lists Motion blur", (await win.locator("[data-testid=menu-enhance-motion-blur]").count()) === 1);
  await shot("en8-menu-motion");
  await settled(win, () => win.locator("[data-testid=menu-enhance-motion-blur]").click(), { timeout: 3000 });
  void tickOf;
  c = await saved();
  check("Motion blur from the menu saved at 50", c.enhance?.motionBlur?.amount === 50, JSON.stringify(c.enhance));
  await win.waitForTimeout(500);
  const withBlur = await at(FROM + 1);
  check("the picture changed", mad(beforeBlur, withBlur) > 0.05, `mean difference ${mad(beforeBlur, withBlur).toFixed(3)}`);
  await open();
  await section("motion-blur").scrollIntoViewIfNeeded();
  check("the inspector's Motion blur section is ticked", await isOn("motion-blur"));
  await shot("en9-motion-blur");
  // Flip it from the menu.
  const [bx, by] = await bar(ctx, await savedProject(win, udDir), video.clipId, 4.3);
  await win.mouse.click(bx, by, { button: "right" });
  await win.waitForTimeout(400);
  await win.locator("[data-testid=menu-enhance-motion]").hover();
  await win.waitForTimeout(300);
  await settled(win, () => win.locator("[data-testid=menu-enhance-motion-blur]").click(), { timeout: 3000 });
  c = await saved();
  check("picked again: off", !c.enhance?.motionBlur, JSON.stringify(c.enhance));
  await press(win, "Meta+z");
  c = await saved();
  check("⌘Z: Motion blur back on", c.enhance?.motionBlur?.amount === 50, JSON.stringify(c.enhance));

  // Everything on for the export: what the preview shows at 3 s with it on.
  c = await saved();
  check("all four on the clip", !!c.enhance?.stabilize && !!c.enhance?.denoise && c.enhance?.deflicker === true && !!c.enhance?.motionBlur, JSON.stringify(c.enhance));
  const previewOn = await at(3);
  // An export through the engine.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const file = path.join(outDir, "enhance-export.mp4");
  fs.rmSync(file, { force: true });
  await win.locator("[data-testid=export]").click();
  await win.waitForTimeout(1000);
  const dialog = win.getByRole("dialog");
  await dialog.locator('input[placeholder="My export"]').fill("enhance-export");
  await dialog.locator('input[placeholder="/path/to/export"]').fill(outDir);
  const t0 = Date.now();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  for (let i = 0; i < 1800 && !(await win.getByText("Export completed").count()); i++) await win.waitForTimeout(500);
  const took = (Date.now() - t0) / 1000;
  check("exported", fs.existsSync(file), `${took.toFixed(1)} s`);
  if (fs.existsSync(file)) {
    const ffmpeg = createRequire(path.resolve("../../package.json"))("ffmpeg-static");
    // Grey frames at 200 px wide, from 2 s in and at 3 s.
    const raw = (ss, n) =>
      execFileSync(ffmpeg, ["-v", "error", "-ss", String(ss), "-i", file, "-an", "-frames:v", String(n), "-vf", `scale=${WIDTH}:${plainAt3.h}:flags=area,format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
    const run = framesOf(raw(FROM, FRAMES), WIDTH, plainAt3.h);
    const exportedShake = shake(run);
    check("the export's frames shake less than the unstabilized preview's", run.length === FRAMES && exportedShake < plainShake * 0.5, `${exportedShake.toFixed(2)} px against ${plainShake.toFixed(2)} px`);
    check("fine detail in the export is below the plain picture's", detail(run[0]) < plainDetail, `${detail(run[0]).toFixed(3)} against ${plainDetail.toFixed(3)}`);
    const exportAt3 = framesOf(raw(3, 1), WIDTH, plainAt3.h)[0];
    const [toOn, toOff] = [mad(exportAt3, previewOn), mad(exportAt3, plainAt3)];
    check("at 3 s the export is closer to the preview with the clean-up on than off", toOn < toOff, `${toOn.toFixed(2)} from the on preview, ${toOff.toFixed(2)} from the off one`);
  }
  await shot("en10-exported");
  return report();
};
