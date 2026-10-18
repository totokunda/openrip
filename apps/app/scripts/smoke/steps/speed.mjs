// The speed tools set through the store with lib/speed.ts on the first video clip (after
// `import timeline`), the engine's frames checked, and its sound in an export. The step imports
// the renderer's modules, so it needs its dev server: `npx vite --port 5199` in
// packages/renderer and the session run with MODE=development
// VITE_DEV_SERVER_URL=http://localhost:5199 (CLIP_NAME is unused).
//
// - Reverse (`setReverse`): 1 s into the clip shows the frame 1 s before its end did; the saved
//   clip is reversed with its trims swapped; it plays in real time; ⌘Z puts it back exactly.
// - Curve (`setSpeedCurve`, Flash In): the clip's length is its media over the curve's mean
//   speed, and a frame shows the media `sourceTimeAt` gives; ⌘Z puts it back.
// - Freeze (`freezeFrame` at 2 s): a 3 s still of the frame at 2 s, then the rest of the clip
//   3 s later; the saved project has the still.
// - Sound: an export of the frozen clip is silent through the still, and the sound after it is
//   the clip's from 2 s, 3 s later.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { engineFrame, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";

/** Run `fn` (a page function) as one user action: a key press first starts a new history step. */
const act = async (win, fn, arg) => {
  await win.keyboard.press("Shift");
  let out;
  await settled(win, async () => {
    out = await win.evaluate(fn, arg);
  });
  return out;
};

const clipOf = (win) =>
  win.evaluate(async () => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const fps = useControlsStore.getState().fps || 30;
    const clips = useClipStore.getState().clips.filter((c) => c.type === "video").sort((a, b) => a.startFrame - b.startFrame);
    return { fps, clips: clips.map((c) => ({ id: c.clipId, start: c.startFrame, end: c.endFrame, trimStart: c.trimStart, trimEnd: c.trimEnd, speed: c.speed ?? 1, reverse: !!c.reverse, curve: c.speedCurve ?? null, freeze: c.freeze ?? null, assetId: c.assetId })) };
  });

export default async (ctx) => {
  const { app, win, udDir, outDir, shot, fs } = ctx;
  const { check, report } = checks();
  const map = await rulerMap(win);
  let { fps, clips } = await clipOf(win);
  const clip = clips[0];
  if (!clip) throw new Error("no video clip");
  const len = (clip.end - clip.start) / fps;
  const at = (s) => clip.start / fps + s;
  // Frames of the clip as imported, by frame number from its start.
  const original = {};
  const frameAt = async (s) => {
    await seek(win, map, at(s));
    return (await engineFrame(win)).sum;
  };
  const near = async (s) => {
    const out = [];
    for (const d of [-1, 0, 1]) out.push(await frameAt(s + d / fps));
    return out;
  };
  original.one = await frameAt(1);
  original.endMinusOne = await near(len - 1);
  original.two = await frameAt(2);
  original.twoHalf = await frameAt(2.5);

  // ---- reverse ----
  await act(win, async (id) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    useClipStore.getState().setReverse(id, true);
  }, clip.id);
  const reversed = await frameAt(1);
  await shot("s1-reversed");
  check("reversed: 1 s in shows the frame 1 s before the end did", original.endMinusOne.includes(reversed), `${reversed} in ${original.endMinusOne}`);
  let saved = (await savedProject(win, udDir)).timeline.clips.find((c) => c.clipId === clip.id);
  check("the saved clip is reversed, its trims swapped", saved?.reverse === true && saved.trimStartTick !== undefined, JSON.stringify({ reverse: saved?.reverse, trimStartTick: saved?.trimStartTick, trimEndTick: saved?.trimEndTick }));
  // Real time: frames drawn over 2 s of playback.
  await seek(win, map, at(0.5));
  const n0 = await win.evaluate(() => window.__frames.length);
  await win.keyboard.press("Space");
  await win.waitForTimeout(2000);
  await win.keyboard.press("Space");
  const drawn = { n: (await win.evaluate(() => window.__frames.length)) - n0 };
  await win.waitForTimeout(500);
  check(`reversed, it plays in real time (${drawn.n} frames in 2 s at ${fps} fps)`, drawn.n >= 2 * fps * 0.85, JSON.stringify(drawn));
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(1500);
  ({ clips } = await clipOf(win));
  check("⌘Z puts it back", !clips[0].reverse && clips[0].trimStart === clip.trimStart, JSON.stringify(clips[0]));
  check("…and its frames", (await frameAt(1)) === original.one);

  // ---- curve ----
  const curved = await act(win, async (id) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const speed = await import("/src/lib/speed.ts");
    const s = useClipStore.getState();
    s.setSpeedCurve(id, speed.presetCurve("Flash In"));
    const c = useClipStore.getState().clips.find((x) => x.clipId === id);
    const { useControlsStore } = await import("/src/lib/control.ts");
    const fps = useControlsStore.getState().fps || 30;
    return { length: c.endFrame - c.startFrame, speed: c.speed, avg: speed.curveAverage(c.speedCurve.points), source: speed.sourceTimeAt(c, Math.round(0.5 * fps), fps) };
  }, clip.id);
  const wantLength = Math.round((clip.end - clip.start) / curved.avg);
  check(`curved: its length is its media over the mean speed (${curved.length} frames)`, Math.abs(curved.length - wantLength) <= 1 && curved.speed === curved.avg, JSON.stringify(curved));
  // The media at 0.5 s through the curve: the frame the clip showed at that media time before.
  const shownCurved = await frameAt(Math.round(0.5 * fps) / fps);
  ({ clips } = await clipOf(win));
  await act(win, async (id) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    useClipStore.getState().setSpeedCurve(id, null);
  }, clip.id);
  ({ clips } = await clipOf(win));
  // Without the curve (the plain speed it averaged), media time m shows at m / speed.
  const plainSpeed = clips[0].speed;
  const media = curved.source - ((clip.trimStart ?? 0) * clip.speed) / fps;
  const refs = await near(media / plainSpeed);
  check(`a curved frame shows the media the remap gives (${curved.source.toFixed(3)} s)`, refs.includes(shownCurved), `${shownCurved} in ${refs}`);
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(1000);
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(1500);
  ({ clips } = await clipOf(win));
  check("⌘Z twice puts back the clip as imported", clips[0].end === clip.end && !clips[0].curve && clips[0].speed === clip.speed, JSON.stringify(clips[0]));

  // ---- freeze ----
  const freeze = await act(win, async ({ id, frame }) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    return useClipStore.getState().freezeFrame(id, frame);
  }, { id: clip.id, frame: clip.start + 2 * fps });
  check("a freeze frame was made", typeof freeze === "string");
  await win.waitForTimeout(1000);
  const still = [await frameAt(2.5), await frameAt(3.5), await frameAt(4.75)];
  await shot("s2-frozen");
  check("the still holds the frame at 2 s for 3 s", still.every((s) => s === original.two), `${still} vs ${original.two}`);
  check("the rest of the clip follows 3 s later", (await frameAt(5.5)) === original.twoHalf);
  saved = (await savedProject(win, udDir)).timeline.clips.filter((c) => c.type === "video");
  const savedStill = saved.find((c) => c.freeze);
  check(`the saved project has the still, of the frame at 2 s (${savedStill?.freeze?.at})`, saved.length === 3 && Math.abs((savedStill?.freeze?.at ?? 0) - (2 + ((clip.trimStart ?? 0) * clip.speed) / fps)) < 0.002);

  // ---- sound, in an export ----
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const file = path.join(outDir, "speed-export.mp4");
  fs.rmSync(file, { force: true });
  await win.getByText("Export", { exact: true }).first().click();
  await win.waitForTimeout(1000);
  const dialog = win.getByRole("dialog");
  await dialog.locator('input[placeholder="My export"]').fill("speed-export");
  await dialog.locator('input[placeholder="/path/to/export"]').fill(outDir);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  for (let i = 0; i < 240 && !(await win.getByText("Export completed").count()); i++) await win.waitForTimeout(500);
  if (!fs.existsSync(file)) throw new Error("no export file");
  const ffmpeg = createRequire(path.resolve("../../package.json"))("ffmpeg-static");
  const RATE = 8000;
  const pcm = (src, from, seconds) =>
    new Float32Array(new Uint8Array(execFileSync(ffmpeg, ["-v", "error", "-ss", String(from), "-t", String(seconds), "-i", src, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 26 })).buffer);
  const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length));
  const begin = clip.start / fps;
  const [before, during, after] = [pcm(file, begin + 0.5, 1), pcm(file, begin + 2.3, 2.4), pcm(file, begin + 5.5, 1.5)];
  check(`silent through the still (rms ${rms(during).toExponential(1)}, ${rms(before).toFixed(4)} before, ${rms(after).toFixed(4)} after)`, rms(during) < 0.05 * Math.min(rms(before), rms(after)));
  // The sound after the still is the clip's from 2 s: the lag that best lines them up.
  const source = pcm(ctx.clipPath, ((clip.trimStart ?? 0) * clip.speed) / fps + 2.0, 2.5);
  const out = pcm(file, begin + 5.0, 2.5);
  let best = { lag: 0, c: -Infinity };
  for (let lag = -400; lag <= 400; lag += 2) {
    let c = 0;
    for (let i = 1000; i < 15000; i += 3) c += out[i] * (source[i + lag] ?? 0);
    if (c > best.c) best = { lag, c };
  }
  check(`the sound after the still is the clip's from 2 s, 3 s later (off by ${((best.lag / RATE) * 1000).toFixed(1)} ms)`, Math.abs(best.lag / RATE) <= 0.012);
  return report();
};
