// Export through the engine (after animsetup) and check the file's frames with ffmpeg: white
// at the White Flash cut (5 s), not a second before it; the text hidden at the start of its
// Type 1 and whole after it (bright pixels in the middle band where the text box is). For
// another project, EXPORT_WHITE and EXPORT_PLAIN give the times to compare and EXPORT_TYPED=""
// skips the text. Finder isn't opened.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { checks } from "./_anim.mjs";

export default async ({ app, win, shot, outDir, fs }) => {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const file = path.join(outDir, "anim-export.mp4");
  fs.rmSync(file, { force: true });
  await win.locator("[data-testid=export]").click();
  await win.waitForTimeout(1000);
  const dialog = win.getByRole("dialog");
  await dialog.locator('input[placeholder="My export"]').fill("anim-export");
  await dialog.locator('input[placeholder="/path/to/export"]').fill(outDir);
  await shot("e1-dialog");
  const t0 = Date.now();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  for (let i = 0; i < 240 && !(await win.getByText("Export completed").count()); i++) await win.waitForTimeout(500);
  await shot("e2-exported");
  if (!fs.existsSync(file)) throw new Error("no export file");
  const ffmpeg = createRequire(path.resolve("../../package.json"))("ffmpeg-static");
  // A frame's mean lightness, and the share of near-white pixels in the band 40–60% down.
  const frame = (s) => {
    const raw = execFileSync(ffmpeg, ["-v", "error", "-ss", String(s), "-i", file, "-frames:v", "1", "-vf", "scale=270:480", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
    let light = 0, white = 0, band = 0;
    for (let i = 0; i < raw.length; i += 3) {
      light += (raw[i] + raw[i + 1] + raw[i + 2]) / 765;
      const y = Math.floor(i / 3 / 270);
      if (y > 192 && y < 288) {
        band++;
        if (raw[i] > 235 && raw[i + 1] > 235 && raw[i + 2] > 235) white++;
      }
    }
    return { light: light / (raw.length / 3), white: white / band };
  };
  const { check, report } = checks();
  check("exported", true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const [white, plain] = [process.env.EXPORT_WHITE || "5", process.env.EXPORT_PLAIN || "4"].map((t) => t.split(",").map(Number));
  white.forEach((t, i) => {
    const [cut, before] = [frame(t), frame(plain[i])];
    check(`white at ${t} s, not at ${plain[i]} s`, cut.light > 0.9 && cut.light > before.light + 0.2, `light ${cut.light.toFixed(2)}, ${before.light.toFixed(2)}`);
  });
  const typed = (process.env.EXPORT_TYPED ?? "0.02,1.5").split(",").filter(Boolean).map(Number);
  if (typed.length) {
    const [start, after] = typed.map(frame);
    check("text hidden as it starts typing, whole after", after.white > start.white + 0.002, `white in the band ${(start.white * 100).toFixed(2)}%, ${(after.white * 100).toFixed(2)}%`);
  }
  return report();
};
