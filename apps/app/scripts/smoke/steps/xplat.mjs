// The Windows and Linux builds' check in CI (.github/workflows/cross-platform.yml), after
// `import timeline` on a short test clip (CLIP_NAME), on the packaged app (EXE=): the engine
// addon loaded; the engine draws the preview (on these platforms its frames come as pixels,
// not shared textures), a frame of the clip and not black; playing draws more frames; then
// an export through the Export dialog: a 480P H.264 MP4 when the engine has a video encoder
// (read back with ffprobe when FFPROBE= says where it is), else the dialog says there is
// none, its Video section is off, and a GIF exports instead.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { playButton } from "./_preview.mjs";

// The engine's canvas: its size, mean lightness and a hash of its pixels; null before it has a frame.
const engineFrame = (win) =>
  win.evaluate(() => {
    const c = document.getElementById("openrip-engine-frame");
    if (!c || c.width < 4 || c.height < 4) return null;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let sum = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum = (sum * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) % 1000000007;
      light += (d[i] + d[i + 1] + d[i + 2]) / 765;
    }
    return { w: t.width, h: t.height, sum, light: light / (d.length / 4) };
  });

export default async ({ win, shot, outDir, fs }) => {
  const done = [];
  const info = await win.evaluate(() => window[btoa("engineInfo")]());
  if (!info.available) throw new Error(`the engine didn't load: ${info.error} (${info.path})`);
  done.push(`engine ${info.version} loaded`);

  // The engine's frame of the clip: drawn, and not black.
  let first = null;
  for (let i = 0; i < 60 && !(first?.light > 0.05); i++) {
    first = await engineFrame(win);
    if (!(first?.light > 0.05)) await win.waitForTimeout(1000);
  }
  await shot("xplat-1-frame");
  if (!(first?.light > 0.05)) throw new Error(`the engine drew no frame of the clip (${JSON.stringify(first)})`);
  done.push(`a ${first.w}x${first.h} frame (lightness ${first.light.toFixed(2)})`);

  // Playing draws more frames (by the wall clock where there's no sound device).
  await win.evaluate(() => {
    window.__xplatFrames = 0;
    document.getElementById("openrip-engine-frame").addEventListener("openrip-engine-frame", () => window.__xplatFrames++);
  });
  await playButton(win).click();
  await win.waitForTimeout(2500);
  await playButton(win).click();
  await win.waitForTimeout(500);
  const played = await win.evaluate(() => window.__xplatFrames);
  const after = await engineFrame(win);
  await shot("xplat-2-played");
  if (played < 2 || after?.sum === first.sum) throw new Error(`playing drew ${played} frames (the picture ${after?.sum === first.sum ? "didn't change" : "changed"})`);
  done.push(`playing drew ${played} frames`);

  // An export, through the Export dialog.
  const codecs = await win.evaluate(() => window[btoa("engineExportCodecs")]());
  const dialog = win.locator("[data-testid=export-dialog]");
  const T = (id) => dialog.locator(`[data-testid=${id}]`);
  const setCheck = async (id, on) => {
    const box = T(`export-${id}-check`);
    if ((await box.count()) === 0 || (await box.isDisabled())) return;
    await box.scrollIntoViewIfNeeded();
    if (((await box.getAttribute("data-checked")) === "true") !== on) await box.click();
    await win.waitForTimeout(100);
  };
  await win.locator("[data-testid=export]").click();
  await dialog.waitFor({ state: "visible" });
  await win.waitForTimeout(800);
  const video = codecs.length > 0;
  if (video) {
    await setCheck("video", true);
    await T("export-resolution").click();
    await win.locator("[data-testid=export-resolution-option]").filter({ hasText: "480P" }).first().click();
  } else {
    // No encoder yet: the dialog says so and leaves its Video section off.
    if (!(await T("export-no-encoder").isVisible())) throw new Error("the engine has no video encoder, and the Export dialog doesn't say so");
    if ((await T("export-video-check").getAttribute("data-checked")) === "true") throw new Error("the Video section is on without an encoder");
    done.push("no video encoder: the Export dialog says so");
  }
  await setCheck("audio", false);
  await setCheck("gif", !video);
  await setCheck("captions", false);
  await T("export-name").fill("xplat");
  await T("export-path").fill(outDir);
  await shot("xplat-3-export");
  await T("export-submit").click();
  let phase = null;
  for (let i = 0; i < 600 && (!phase || phase === "running"); i++) {
    await win.waitForTimeout(500);
    phase = await T("export-run").getAttribute("data-phase").catch(() => null);
  }
  await shot("xplat-4-exported");
  const file = path.join(outDir, video ? "xplat.mp4" : "xplat.gif");
  if (phase !== "done" || !fs.existsSync(file)) {
    const why = await T("export-error").innerText().catch(() => "");
    throw new Error(`the export ended ${phase} ${why} (${file} ${fs.existsSync(file) ? "written" : "missing"})`);
  }
  let probed = "";
  if (video && process.env.FFPROBE) {
    const s = JSON.parse(execFileSync(process.env.FFPROBE, ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_streams", "-of", "json", file]).toString()).streams[0];
    if (!(s?.nb_read_frames > 0)) throw new Error(`the export has no video frames (${JSON.stringify(s)})`);
    probed = `, ${s.codec_name} ${s.width}x${s.height}, ${s.nb_read_frames} frames`;
  }
  done.push(`exported ${path.basename(file)} (${fs.statSync(file).size} bytes${probed})`);
  return done.join("; ");
};
