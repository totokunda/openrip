// Replace clip and Open file location (the clip's menu, More clip actions; after `import timeline`
// of a 3 s red clip, `CLIP_NAME=red`; the file picker is stubbed with a 4 s blue clip and a 1 s
// green one made here):
// - Replace clip with the longer blue file: the clip keeps its place, length and everything else
//   but its media (asset, trim, media size); the engine draws blue; ⌘Z gives the red clip back
//   as it was, ⇧⌘Z the blue;
// - with the shorter green file the clip becomes as long as the file (1 s) and a warning says so;
// - Open file location reveals the file the clip shows (the Finder is stubbed).
import path from "node:path";
import { engineFrame, rulerMap } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { press, state } from "./_undo.mjs";
import { mainTrack, rowY } from "./_timeline.mjs";
import { makeClip, pickReturns } from "./_recfixture.mjs";

const RED = "r>170&&g<90&&b<90";
const BLUE = "b>170&&r<90&&g<90";
const GREEN = "g>100&&r<90&&b<90";

/** The clip's menu opened on its row at `s` seconds, then More clip actions ▸ `item`. */
const choose = async (ctx, item, s = 0.5) => {
  const { win } = ctx;
  const doc = await savedProject(win, ctx.udDir);
  const y = await rowY(ctx, doc, mainTrack(doc).timelineId);
  await win.mouse.click(ctx.map.x(s), y);
  await win.mouse.click(ctx.map.x(s), y, { button: "right" });
  await win.locator("[data-testid=menu-more-actions]").hover();
  await win.locator(`[data-testid=menu-${item}]`).click();
  await win.waitForTimeout(2500);
};

export default async (ctx) => {
  const { app, win, shot, outDir } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const blue = path.join(outDir, "blue.mp4");
  const green = path.join(outDir, "green.mp4");
  makeClip(blue, { color: "blue", seconds: 4, hz: 880 });
  makeClip(green, { color: "green", seconds: 1, hz: 660 });

  const before = await savedProject(win, ctx.udDir);
  const c0 = before.timeline.clips.find((c) => c.type === "video");
  check("the clip shows red", (await engineFrame(win, RED)).count > 20000);
  const s0 = await state(ctx);

  // ---- the longer file ----
  await pickReturns(app, [blue]);
  await win.mouse.click(ctx.map.x(0.5), await rowY(ctx, before, mainTrack(before).timelineId));
  const menuOpen = async () => {
    await win.mouse.click(ctx.map.x(0.5), await rowY(ctx, before, mainTrack(before).timelineId), { button: "right" });
    await win.locator("[data-testid=menu-more-actions]").hover();
    await win.waitForTimeout(400);
  };
  await menuOpen();
  const sub = await win.locator("[data-testid=menu-replace-clip], [data-testid=menu-trim-clip], [data-testid=menu-open-file-location]").allInnerTexts();
  check(`More clip actions lists Replace clip, Trim clip, Open file location (${sub.join(", ")})`, sub.join(",") === "Replace clip,Trim clip,Open file location" && (await win.locator("[data-testid=menu-trim-clip]").isDisabled()));
  await shot("rc-1-menu");
  await win.locator("[data-testid=menu-replace-clip]").click();
  await win.waitForTimeout(3500);
  const s1 = await state(ctx, Date.now() - 400);
  const after = await savedProject(win, ctx.udDir);
  const c1 = after.timeline.clips.find((c) => c.type === "video");
  const path1 = decodeURIComponent(after.assets[c1.assetId]?.path ?? "");
  check(`the clip is on blue.mp4 (${path1.split("/").pop()})`, /symlinks\/blue\.mp4$/.test(path1));
  check(`it keeps its place and length (${c1.startTick}..${c1.endTick} as ${c0.startTick}..${c0.endTick})`, c1.startTick === c0.startTick && c1.endTick === c0.endTick && c1.timelineId === c0.timelineId && c1.clipId === c0.clipId);
  const strip = (c) => {
    const { assetId, assetIdHistory, trimStart, trimEnd, trimStartTick, trimEndTick, mediaWidth, mediaHeight, mediaAspectRatio, ...rest } = c;
    return JSON.stringify(rest);
  };
  const differ = Object.keys({ ...c0, ...c1 }).filter((k) => JSON.stringify(c0[k]) !== JSON.stringify(c1[k]));
  check(`everything else about the clip is as it was (changed: ${differ.join(", ")})`, strip(c1) === strip(c0));
  check("the engine draws blue now", (await engineFrame(win, BLUE)).count > 20000 && (await engineFrame(win, RED)).count < 2000);
  await shot("rc-2-replaced");
  await press(win, "Meta+z");
  const s2 = await state(ctx, Date.now() - 400);
  check("⌘Z gives the red clip back in one step (the project and the engine's frame as before)", s2.doc === s0.doc && s2.frame === s0.frame);
  await press(win, "Meta+Shift+z");
  const s3 = await state(ctx, Date.now() - 400);
  check("⇧⌘Z replaces it again", s3.doc === s1.doc && s3.frame === s1.frame);

  // ---- the shorter file ----
  await pickReturns(app, [green]);
  await choose(ctx, "replace-clip");
  const short = await savedProject(win, ctx.udDir);
  const c2 = short.timeline.clips.find((c) => c.type === "video");
  const len = (+c2.endTick - +c2.startTick) / 1e6;
  check(`a shorter file shortens the clip to the file (${len.toFixed(2)} s from ${(+c0.endTick - +c0.startTick) / 1e6} s)`, c2.startTick === c0.startTick && Math.abs(len - 1) < 0.1 && /green\.mp4$/.test(decodeURIComponent(short.assets[c2.assetId].path)));
  const toast = await win.locator("[data-sonner-toast]").allInnerTexts();
  check(`and says so ("${toast.join(" | ").replace(/\s+/g, " ")}")`, toast.some((t) => /green\.mp4 is shorter than the clip/.test(t)));
  check("the engine draws green", (await engineFrame(win, GREEN)).count > 20000);
  await shot("rc-3-shorter");

  // ---- Open file location ----
  await app.evaluate(({ ipcMain }) => {
    globalThis.__revealed = [];
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => {
      globalThis.__revealed.push(p);
      return { success: true, data: { path: p } };
    });
  });
  await choose(ctx, "open-file-location");
  const shown = await app.evaluate(() => globalThis.__revealed);
  check(`Open file location shows the file itself (${shown.join(", ")})`, shown.length === 1 && shown[0] === green);
  return report();
};
