// The shader transitions (the gl-transitions collection, drawn by the engine) through the UI
// (after import timeline; the clip is split at 3, 6 and 9 s into four, three cuts):
// - the Transitions tab's twelve categories, each with cards, together 112 (the 12 classics but
//   Blink, 100 shader ones), a shot of four categories (`tl1-…` ↔ 10-left-transitions/001);
// - a card shows real footage with the transition drawn on it by the engine (rendered on first
//   sight, cached), plays its loop when hovered and rests on its still again when left
//   (`tl5-hover` ↔ 018-item-hover.png);
// - three new ones put on the three cuts with the cards' + (Zoom blur fade, Soft circle, Cube
//   turn): saved, undone and redone, the engine's frame at each cut unlike both clips beside it
//   and unchanged outside the window, ahead of and after the cut;
// - the inspector: duration and the transition's own parameters (a slider, a switch), each
//   saved, changing the frame, undone and redone; its credit line; Apply to all;
// - an export (the save dialog isn't opened; Finder isn't): its frame at each cut is the engine's.
// translibcheck (after reopen) reads it all back from the file.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { clickSplit, diff, grab, rulerMap, seek, settled } from "./_preview.mjs";
import { addTransition, checks, openTransitionCard, pickTransition, rowOf, savedClips, savedProject, select, setDuration, transitionName } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { canvasHash, tilesReady } from "./_tiles.mjs";

// Type `value` into the number field of the inspector's slider labelled `label`.
const setParam = async (win, label, value) => {
  const input = win.locator("[data-testid=inspector] [role=tabpanel] label", { hasText: new RegExp(`^${label}$`) }).locator("xpath=..").locator("input");
  await input.click();
  await win.keyboard.press("Meta+A");
  await win.keyboard.type(String(value));
  await settled(win, () => win.keyboard.press("Enter"));
};

const CATEGORIES = ["Basic", "Slide", "Wipe", "Mask", "Pattern", "Camera", "Blur", "Light", "Glitch", "Distortion", "3D", "Overlay"];
// The new transitions put on the cuts: [card type, its name in the tab].
export const PICKS = [
  ["gl_CrossZoom", "Zoom blur fade"],
  ["gl_circleopen", "Soft circle"],
  ["gl_cube", "Cube turn"],
];

export default async (ctx) => {
  const { win, shot, udDir, app, outDir, fs } = ctx;
  const map = (ctx.map ??= await rulerMap(win));
  const ROW = await rowOf(ctx, "video");
  const { check, report } = checks();
  const doc = () => savedProject(win, udDir);
  const videos = async () => (await savedClips(win, udDir)).filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  const types = (v) => v.map((c) => c.transitionOut?.type ?? "-").join(",");
  const at = async (s, name) => {
    await seek(win, map, s);
    await grab(win, name);
  };

  // Four clips.
  for (const [cut, inside] of [[3, 1], [6, 4], [9, 7]]) {
    await seek(win, map, cut);
    await win.mouse.click(map.x(inside), ROW);
    await win.waitForTimeout(600);
    await settled(win, () => clickSplit(win));
  }
  let v = await videos();
  check("split into four at 3, 6 and 9 s", v.length === 4 && [3, 6, 9].every((s, i) => Math.abs(+v[i].endTick / 1e6 - s) < 0.05), v.map((c) => `${c.startTick}-${c.endTick}`).join());
  const cuts = v.slice(0, 3).map((c) => +c.endTick / 1e6);
  // The frames with no transition: just before each cut (the outgoing clip's last), at it (the
  // incoming clip's first), and outside the window on both sides.
  const frame = 1 / 24;
  for (const [i, c] of cuts.entries()) {
    await at(c - 0.5, `none${i}@-0.5`);
    await at(c - frame, `none${i}@-1`);
    await at(c, `none${i}@0`);
    await at(c + 0.5, `none${i}@+0.5`);
    await at(c - 0.3, `none${i}@-0.3`);
  }

  // The tab: its categories and cards.
  await win.locator("[data-testid=assets-tab-transitions]").click();
  await win.waitForTimeout(500);
  const sectionButtons = () => win.locator("[data-testid=assets] nav[aria-label=Sections] [data-testid^=assets-section-]");
  const sections = (await sectionButtons().allInnerTexts()).map((s) => s.trim());
  check("its column: Favorites, then the twelve categories, in order", sections.join() === ["Favorites", ...CATEGORIES].join(), sections.join());
  const counts = {};
  const names = new Set();
  for (const [i, s] of (await sectionButtons().all()).entries()) {
    await s.click();
    await win.waitForTimeout(350);
    const titles = await win.locator("[data-testid^=transition-card-] [title]").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
    counts[sections[i]] = titles.length;
    titles.forEach((t) => names.add(t));
    if (["Basic", "Camera", "Glitch", "3D"].includes(sections[i])) await shot(`tl1-${sections[i].toLowerCase()}`);
  }
  check("every category has cards", CATEGORIES.every((c) => counts[c] > 0), JSON.stringify(counts));
  check("112 cards in all, each with a name of its own", names.size === 112 && Object.values(counts).reduce((a, b) => a + b, 0) === 112, `${names.size}; ${JSON.stringify(counts)}`);
  check("a shader card's name describes it (no CapCut names)", ["Zoom blur fade", "Soft circle", "Cube turn", "Datamosh strips", "Page curl"].every((n) => names.has(n)));

  // A hovered card plays the engine's frames.
  {
    const card = await openTransitionCard(win, "gl_cube");
    await card.scrollIntoViewIfNeeded();
    const preview = card.locator("[data-testid=transition-picture]");
    const ready = await tilesReady(win, "[data-testid=transition-picture]");
    check("the visible cards' pictures are rendered, not the old drawing", !ready.timedOut && (await win.locator("[data-testid=gl-preview]").count()) === 0, JSON.stringify(ready));
    const rest = await canvasHash(preview);
    check("a resting card shows footage (a real picture, not flat)", rest.spread > 40, JSON.stringify(rest));
    await card.hover();
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      seen.add((await canvasHash(preview)).sum);
      await win.waitForTimeout(40);
    }
    check("a hovered card plays its loop: at least six different frames", seen.size >= 6, `${seen.size}`);
    await win.waitForTimeout(250);
    await shot("tl5-hover");
    await win.mouse.move(5, 5);
    await win.waitForTimeout(500);
    check("left, the card rests on its still again", (await canvasHash(preview)).sum === rest.sum);
  }

  // Three of them on the three cuts, by +.
  for (const [i, [type, name]] of PICKS.entries()) {
    await select(ctx, await doc(), v[i].clipId, cuts[i] - 1);
    await undoCase(ctx, check, `${name} by its +`, () => addTransition(win, type), { frame: false });
    v = await videos();
    check(`${name}: saved on clip ${i + 1}, selected (its inspector shows its name)`, v[i].transitionOut?.type === type && (await transitionName(win)) === name, `${v[i].transitionOut?.type}; ${await transitionName(win)}`);
    await shot(`tl6-${type}-inspector`);
  }
  check("the three are on the three cuts", types(v) === `${PICKS[0][0]},${PICKS[1][0]},${PICKS[2][0]},-`, types(v));
  check("saved with 0.8 s each, centred on the cut", v.slice(0, 3).every((c) => c.transitionOut.duration === 0.8), v.map((c) => c.transitionOut?.duration).join());

  // The engine's frame at each cut is neither clip's, and the window is where it says.
  for (const [i, c] of cuts.entries()) {
    await at(c, `with${i}@0`);
    await at(c - 0.25, `with${i}@-0.25`);
    // At the cut, or a quarter of a second before it for the ones (a circle opening) that
    // have shown the whole incoming clip by half way.
    const unlike = async (name) => Math.min((await diff(win, `none${i}@-1`, name)).n, (await diff(win, `none${i}@0`, name)).n);
    const a = { n: Math.max(await unlike(`with${i}@0`), await unlike(`with${i}@-0.25`)) };
    const b = a;
    await at(c - 0.5, `with${i}@-0.5`);
    await at(c + 0.5, `with${i}@+0.5`);
    const [out1, out2] = [(await diff(win, `none${i}@-0.5`, `with${i}@-0.5`)).n, (await diff(win, `none${i}@+0.5`, `with${i}@+0.5`)).n];
    check(`${PICKS[i][1]}: at the cut the frame is unlike both clips beside it at some point in the window (${a.n} pixels)`, a.n > 1500);
    check(`${PICKS[i][1]}: nothing changed half a second either side of the cut (0.4 s window)`, out1 === 0 && out2 === 0, `${out1}, ${out2}`);
  }
  await seek(win, map, cuts[0]);
  await shot("tl7-cut1-zoomblur");

  // Parameters: a slider (Zoom blur fade's Blur strength), a switch (Soft circle's Opening), a
  // duration; each saved, changing the frame, undone and redone.
  {
    // A click on the ruler (a seek) drops the selection: seek first, then pick the marker.
    await at(cuts[0] - 0.1, "zoom@default");
    await pickTransition(ctx, await doc(), v[0].clipId);
    const credit = await win.locator("[data-testid=transition-credit]").innerText();
    check("the inspector credits the collection and the author", /gl-transitions collection by rectalogic \(MIT\)/.test(credit), credit);
    // (The playhead is off the window while the marker is picked: the frame isn't compared.)
    const r = await undoCase(ctx, check, "Strength 1", async () => {
      await setParam(win, "Strength", 1);
    }, { frame: false });
    v = await videos();
    check("Zoom blur fade: Strength saved as a parameter", v[0].transitionOut?.params?.strength === 1, JSON.stringify(v[0].transitionOut?.params));
    await at(cuts[0] - 0.1, "zoom@1");
    check("…and the engine's frame follows it", (await diff(win, "zoom@default", "zoom@1")).n > 200);
    await shot("tl8-params-slider");
    void r;
    await pickTransition(ctx, await doc(), v[0].clipId);
    await setDuration(win, 0.4);
    v = await videos();
    await at(cuts[0] - 0.3, "zoom@short-out");
    await at(cuts[0] - 0.1, "zoom@short-in");
    check("duration 0.4 s: saved, and the window shrinks (nothing 0.3 s before the cut)", v[0].transitionOut?.duration === 0.4 && (await diff(win, `none0@-0.3`, "zoom@short-out")).n === 0 && (await diff(win, "zoom@1", "zoom@short-in")).n > 50, JSON.stringify(v[0].transitionOut));
    await pickTransition(ctx, await doc(), v[0].clipId);
    await setDuration(win, 0.8);

    await at(cuts[1] - 0.1, "circle@open");
    await pickTransition(ctx, await doc(), v[1].clipId);
    await undoCase(ctx, check, "Soft circle's Opening off", () => settled(win, () => win.locator("[data-testid=transition-param-opening] [role=switch]").click()), { frame: false });
    v = await videos();
    check("Soft circle: Opening saved as off", v[1].transitionOut?.params?.opening === false, JSON.stringify(v[1].transitionOut?.params));
    // (The two clips are halves of one video, so a circle between them barely shows: the
    // switch's effect on the picture is in the engine's playback test.)
    await shot("tl9-params-switch");

    await seek(win, map, cuts[2] - 0.1);
    await pickTransition(ctx, await doc(), v[2].clipId);
    const rows = await win.locator("[data-testid=inspector] [role=tabpanel] label").allInnerTexts();
    check("Cube turn lists its own parameters", ["Persp", "Unzoom", "Reflection", "Floating"].every((p) => rows.includes(p)), rows.join());
  }

  // Apply to all: the cube's settings on every cut of the track.
  await undoCase(ctx, check, "Apply to all", () => settled(win, () => win.locator("[data-testid=transition-apply-all]").click()), { frame: false });
  v = await videos();
  check("Apply to all: Cube turn on all three cuts", types(v) === "gl_cube,gl_cube,gl_cube,-", types(v));
  // Put the three back for the export and the reopen.
  for (const [i, [type]] of PICKS.entries()) {
    await select(ctx, await doc(), v[i].clipId, cuts[i] - 1);
    await addTransition(win, type);
  }
  v = await videos();
  check("the three picks back on the cuts", types(v) === `${PICKS[0][0]},${PICKS[1][0]},${PICKS[2][0]},-`, types(v));
  // Two parameters set again for the file and the reload.
  await seek(win, map, 1);
  await pickTransition(ctx, await doc(), v[0].clipId);
  await setParam(win, "Strength", 0.9);
  await pickTransition(ctx, await doc(), v[1].clipId);
  await settled(win, () => win.locator("[data-testid=transition-param-opening] [role=switch]").click());
  v = await videos();
  check("Strength 0.9 and Opening off kept on the cuts", v[0].transitionOut?.params?.strength === 0.9 && v[1].transitionOut?.params?.opening === false, JSON.stringify([v[0].transitionOut?.params, v[1].transitionOut?.params]));

  // Export: the file's frame at each cut is the engine's.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const engine = [];
  for (const [i, c] of cuts.entries()) {
    await at(c, `final${i}@0`);
    engine.push(await win.evaluate((name) => ({ w: window.__grabs[name].width, h: window.__grabs[name].height, data: [...window.__grabs[name].data] }), `final${i}@0`));
  }
  const file = path.join(outDir, "translib-export.mp4");
  fs.rmSync(file, { force: true });
  await win.locator("[data-testid=export]").click();
  const dialog = win.locator("[data-testid=export-dialog]");
  await dialog.waitFor({ state: "visible" });
  await win.waitForTimeout(500);
  await dialog.locator("[data-testid=export-name]").fill("translib-export");
  await dialog.locator("[data-testid=export-path]").fill(outDir);
  await dialog.locator("[data-testid=export-submit]").click();
  for (let i = 0; i < 600; i++) {
    const phase = await dialog.locator("[data-testid=export-run]").getAttribute("data-phase").catch(() => null);
    if (phase && phase !== "running") break;
    await win.waitForTimeout(500);
  }
  await shot("tl10-exported");
  await dialog.locator("[data-testid=export-run-done]").click();
  await dialog.waitFor({ state: "hidden" });
  if (!fs.existsSync(file)) throw new Error("no export file");
  const ffmpeg = createRequire(path.resolve("../../package.json"))("ffmpeg-static");
  const grabFile = (s, w, h) => execFileSync(ffmpeg, ["-v", "error", "-ss", String(s), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 26 });
  const mad = (a, b) => {
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++, n++) s += Math.abs(a[i + k] - b[i + k]);
    return s / n / 255;
  };
  for (const [i, c] of cuts.entries()) {
    const { w, h, data } = engine[i];
    const mine = grabFile(c, w, h);
    const after = grabFile(c + 0.6, w, h);
    const [same, other] = [mad(mine, data), mad(mine, after)];
    check(`${PICKS[i][1]}: the export's frame at ${c.toFixed(1)} s is the engine's (${same.toFixed(3)}) and not the clip after the window (${other.toFixed(3)})`, same < 0.06 && other > same * 1.5, `${same.toFixed(3)} vs ${other.toFixed(3)}`);
  }
  return report();
};
