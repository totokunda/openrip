// Helpers for the audio steps: an export through the Export dialog, and the sound read back
// from it with ffmpeg (ffmpeg-static; ffprobe-static's binary doesn't run on this Mac).
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { settled } from "./_preview.mjs";

export const ffmpeg = createRequire(path.resolve("../../package.json"))("ffmpeg-static");

/** The sample rate the checks read exports at. */
export const RATE = 16000;

/** Run `fn` (a page function) as one user action: a key press first starts a new history step. */
export const act = async (win, fn, arg) => {
  await win.keyboard.press("Shift");
  let out;
  await settled(win, async () => {
    out = await win.evaluate(fn, arg);
  });
  return out;
};

/**
 * `exportAs(name)`: the project exported through the Export dialog into `outDir/<name>.mp4`,
 * waited for until ffmpeg reads it whole. Revealing the file afterwards is stubbed out.
 */
export const exporter = async ({ app, win, outDir, fs }) => {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  return async (name) => {
    const file = path.join(outDir, `${name}.mp4`);
    fs.rmSync(file, { force: true });
    await win.getByText("Export", { exact: true }).first().click();
    await win.waitForTimeout(1000);
    const dialog = win.getByRole("dialog").filter({ has: win.locator('input[placeholder="My export"]') });
    await dialog.locator('input[placeholder="My export"]').fill(name);
    await dialog.locator('input[placeholder="/path/to/export"]').fill(outDir);
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    // Done when ffmpeg reads the file whole (the dialog may still say the last export completed).
    const whole = () => spawnSync(ffmpeg, ["-v", "error", "-i", file, "-t", "0.1", "-f", "null", "-"]).status === 0;
    for (let i = 0; i < 240 && !(fs.existsSync(file) && (await win.getByText("Export completed").count()) && whole()); i++) await win.waitForTimeout(500);
    await win.keyboard.press("Escape");
    await win.waitForTimeout(500);
    if (!fs.existsSync(file) || !whole()) throw new Error(`no export ${name}`);
    return file;
  };
};

/** Interleaved stereo from `from` s for `seconds`, at RATE. */
export const pcm = (src, from, seconds) =>
  new Float32Array(new Uint8Array(execFileSync(ffmpeg, ["-v", "error", "-ss", String(from), "-t", String(seconds), "-i", src, "-vn", "-ac", "2", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 27 })).buffer);

/** One channel (0 left, 1 right) of interleaved stereo. */
export const side = (x, c) => x.filter((_, i) => i % 2 === c);

export const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length));

/** How far the two channels of interleaved stereo differ: the rms of L − R against the level. */
export const channelDifference = (x) => {
  const d = new Float32Array(x.length >> 1);
  for (let i = 0; i < d.length; i++) d[i] = x[2 * i] - x[2 * i + 1];
  return rms(d) / Math.max(1e-12, rms(x));
};

/** The level of `x` in dB against `ref`. */
export const dbOf = (x, ref) => 20 * Math.log10(rms(x) / Math.max(1e-12, rms(ref)));

/** Energy in [lo, hi) Hz of mono `x`, summed over 60 frequencies across the band (a slow DFT). */
export const band = (x, lo, hi) => {
  let e = 0;
  for (let f = lo; f < hi; f += (hi - lo) / 60) {
    let re = 0, im = 0;
    for (let i = 0; i < x.length; i++) {
      const w = (2 * Math.PI * f * i) / RATE;
      re += x[i] * Math.cos(w);
      im += x[i] * Math.sin(w);
    }
    e += re * re + im * im;
  }
  return e;
};

/** The integrated loudness (LUFS) of `seconds` from `begin` s of a file, by ffmpeg's ebur128 (its summary, on stderr). */
export const integrated = (file, begin, seconds) => {
  const err = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-ss", String(begin), "-t", String(seconds), "-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr ?? "";
  const all = [...err.matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  return all.length ? Number(all[all.length - 1][1]) : NaN;
};

/** How far `b` is from `a` (interleaved samples), as a fraction of `a`'s energy. */
export const residual = (a, b) => {
  let num = 0, den = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    num += (b[i] - a[i]) ** 2;
    den += a[i] ** 2;
  }
  return num / Math.max(1e-12, den);
};

/** The lows (60–200 Hz) and highs (5–7 kHz) against the middle (0.8–2 kHz), in the first 2 s of the left channel. */
export const spectralShape = (x) => {
  const m = side(x, 0).slice(0, RATE * 2);
  const mid = band(m, 800, 2000);
  return { low: band(m, 60, 200) / mid, high: band(m, 5000, 7000) / mid };
};
