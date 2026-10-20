// The clean-up tools on a compound clip (on a fresh project, alone, after `import`; IMG_9079 with
// CLIP_NAME=IMG_9079, needs ffmpeg). A compound has no media file, so the first time a tool that
// reads one is switched on the compound is pre-processed: rendered by the engine to a file (progress
// and Cancel in its Video tab), kept on the clip, and made again when its content changes. The step
// makes the same shaky, noisy, flickering fixture as `enhance`, makes it a compound (⌥G), and checks:
// - Video › Basic of the compound lists Stabilize, Reduce image noise, Remove flickers, Motion blur;
// - Stabilize ticked: the compound is pre-processed (the note with its progress), the engine tracks
//   the rendered file, the clip keeps `renderedAssetId` / `renderedKey` and the file is in the data
//   folder, and the picture shakes less than before;
// - Reduce image noise ticked later is instant (no second render) and takes detail out;
// - the clip menu's Enhance visuals, Adjust color and Enhance motion rows are live on it;
// - a change inside the compound makes the file stale and it is rendered again (a new asset), the
//   picture still steadied;
import { execFileSync } from "node:child_process";
import path from "node:path";
import { now, rulerMap, seek, settled, tab } from "./_preview.mjs";
import { ffmpegPath, placeOnTimeline } from "./_fixture.mjs";
import { bar, checks, clipsWhere, savedProject } from "./_anim.mjs";
import { press } from "./_undo.mjs";
import { input, open as openTab, typeIn } from "./_inspector.mjs";

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
  return [best[0], best[1]];
};
const shake = (frames) => {
  const s = frames.slice(1).map((f, i) => shiftBetween(frames[i], f));
  return Math.sqrt(s.reduce((acc, [x, y]) => acc + x * x + y * y, 0) / s.length);
};
const detail = (f) => {
  let s = 0;
  for (let y = 1; y < f.h - 1; y++) for (let x = 1; x < f.w - 1; x++) {
    const i = y * f.w + x;
    s += Math.abs(4 * f.data[i] - f.data[i - 1] - f.data[i + 1] - f.data[i - f.w] - f.data[i + f.w]);
  }
  return s / ((f.w - 2) * (f.h - 2));
};

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
  const { win, shot, udDir, fs } = ctx;
  const { check, report } = checks();
  await placeOnTimeline(ctx, shakyFixture(ctx), "enhance-fixture");
  ctx.map = await rulerMap(win);
  const saved = async () => {
    await win.waitForTimeout(1800);
    return savedProject(win, udDir);
  };
  let doc = await saved();
  const video = clipsWhere(doc, (c) => c.type === "video")[0];
  const compound = (d) => d.timeline.clips.find((c) => c.compound);
  const renders = () => fs.readdirSync(udDir).filter((f) => /^compound-render-.*\.mp4$/.test(f));

  // The fixture as a compound.
  const [bx, by] = await bar(ctx, doc, video.clipId, 2.5);
  await win.mouse.click(bx, by);
  await win.waitForTimeout(500);
  await win.evaluate(() => document.activeElement?.blur?.());
  await settled(win, () => win.keyboard.press("Alt+g"));
  doc = await saved();
  let comp = compound(doc);
  check("the fixture is a compound clip", !!comp, "");
  const select = async () => {
    doc = await saved();
    comp = compound(doc);
    const head = await now(win);
    const [x, y] = await bar(ctx, doc, comp.clipId, Math.min(4.6, Math.max(0.4, head + 2)));
    await win.mouse.click(x, y);
    await win.waitForTimeout(500);
    await tab(win, "Video");
    await win.locator("[data-testid=inspector] [role=tab]", { hasText: /^Basic$/ }).click();
    await win.waitForTimeout(400);
  };
  const section = (name) => win.locator(`[data-testid=section-${name}]`);
  const box = (name) => section(name).locator("[role=checkbox]");
  const tick = async (name) => {
    if (!(await section(name).count())) await select();
    await section(name).scrollIntoViewIfNeeded();
    await settled(win, () => box(name).click(), { timeout: 3000 });
  };
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
  const waitRendered = async (label) => {
    // The note while it renders, then the engine tracking the file; done when both are gone.
    let sawNote = false;
    let maxRatio = 0;
    for (let i = 0; i < 3000; i++) {
      const note = await win.locator("[data-testid=compound-render-note]").count();
      if (note) {
        sawNote = true;
        maxRatio = Math.max(maxRatio, Number(await win.locator("[data-testid=compound-render-note]").first().getAttribute("data-ratio").catch(() => "0")));
      }
      const busy = note + (await win.locator("[data-testid=analysing]").count()) + (await win.locator("[data-testid=analysis-pill]").count());
      if (!busy && (sawNote || i > 150)) break;
      await win.waitForTimeout(100);
    }
    await win.waitForTimeout(1500);
    return { sawNote, maxRatio, label };
  };

  // Its Video tab.
  await select();
  const titles = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tabpanel] section h4")].map((h) => h.innerText.trim()));
  const order = ["Stabilize", "Reduce image noise", "Remove flickers", "Motion blur"];
  check("the compound's Video › Basic lists Stabilize, Reduce image noise, Remove flickers and Motion blur", order.every((t) => titles.includes(t)), titles.join(" | "));
  check("nothing is rendered yet", renders().length === 0 && !compound(await saved()).renderedAssetId);

  const open1 = await win.locator("[data-testid=compound-bar]").count();
  const FROM = 1;
  const plain = await sequence(FROM);
  check("the compound stayed closed while measuring", open1 === 0 && (await win.locator("[data-testid=compound-bar]").count()) === 0);
  const plainShake = shake(plain);
  const plainDetail = detail(plain[0]);

  // Stabilize: the compound is pre-processed first.
  await select();
  await tick("stabilize");
  check("and after ticking Stabilize", (await win.locator("[data-testid=compound-bar]").count()) === 0);
  const r1 = await waitRendered("stabilize");
  doc = await saved();
  comp = compound(doc);
  check("Stabilize saved on the compound", comp.enhance?.stabilize?.level === "recommended", JSON.stringify(comp.enhance));
  check(`it was pre-processed, with progress shown (${r1.maxRatio.toFixed(2)})`, r1.sawNote, "");
  check("the compound keeps its rendered file (asset and key) and the file is in the data folder", !!comp.renderedAssetId && !!comp.renderedKey && renders().length === 1 && /compound-render/.test(doc.assets?.[comp.renderedAssetId]?.path ?? ""), `${renders().join(",")}`);
  const steady = await sequence(FROM);
  const steadyShake = shake(steady);
  check(`the picture shakes less (${plainShake.toFixed(2)} → ${steadyShake.toFixed(2)} px)`, steadyShake < plainShake * 0.75);
  await shot("ce1-stabilized");

  // Reduce image noise: instant, no second render.
  const firstFile = renders()[0];
  await select();
  await tick("denoise");
  await win.waitForTimeout(2500);
  doc = await saved();
  comp = compound(doc);
  check("Reduce image noise saved, with no new render", comp.enhance?.denoise?.strength > 0 && renders().length === 1 && renders()[0] === firstFile, `${renders().length} files`);
  const denoised = await sequence(FROM);
  check(`it takes fine detail out (${plainDetail.toFixed(2)} → ${detail(denoised[0]).toFixed(2)})`, detail(denoised[0]) < plainDetail * 0.95);

  // The menu rows are live.
  doc = await saved();
  const [mx, my] = await bar(ctx, doc, compound(doc).clipId, 2.5);
  await win.mouse.click(mx, my, { button: "right" });
  await win.waitForTimeout(500);
  const rows = await win.evaluate(() => ["menu-enhance-audio", "menu-enhance-visuals", "menu-adjust-color", "menu-enhance-motion"].map((id) => !!document.querySelector(`[data-testid=${id}]`) && !document.querySelector(`[data-testid=${id}]`).disabled));
  check("Enhance audio, Enhance visuals, Adjust color and Enhance motion are live in the compound's menu", rows.every(Boolean), rows.join(","));
  await win.locator("[data-testid=menu-enhance-visuals]").hover();
  await win.waitForTimeout(300);
  const ticks = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=menu-enhance-]")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).join(" | "));
  check("Enhance visuals lists Stabilize, Reduce image noise and Remove flickers", /Stabilize/.test(ticks) && /Reduce image noise/.test(ticks) && /Remove flickers/.test(ticks), ticks);
  await win.keyboard.press("Escape");

  // A change inside makes the file stale: rendered again.
  doc = await saved();
  await win.mouse.dblclick(mx, my);
  await win.waitForTimeout(1500);
  doc = await saved();
  const inner = compound(doc).compound.clips.find((c) => c.type === "video");
  const innerBar = await bar(ctx, { timeline: { clips: compound(doc).compound.clips, tracks: compound(doc).compound.tracks } }, inner.clipId, 2.5);
  await win.mouse.click(innerBar[0], innerBar[1]);
  await win.waitForTimeout(500);
  await openTab(win, "Video", "Basic");
  await typeIn(win, "Scale", 80);
  await win.waitForTimeout(1500);
  await win.locator("[data-testid=compound-back]").click();
  const r2 = await waitRendered("after an edit inside");
  doc = await saved();
  const after = compound(doc);
  check("an edit inside made the file stale: it was rendered again (a new asset and key)", r2.sawNote && after.renderedAssetId !== comp.renderedAssetId && after.renderedKey !== comp.renderedKey && renders().length === 2, `${renders().length} files, ${after.renderedAssetId?.slice(0, 6)} vs ${comp.renderedAssetId?.slice(0, 6)}`);
  await shot("ce2-rendered-again");

  void input;
  void press;
  return report();
}
