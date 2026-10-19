// Helpers for the inspector-gap steps (effectmask, adjmaskhandles, colorlog, canvaspatterns):
// the engine's frame read by patches, a mask handle's place on the player, and an export read
// back with ffmpeg.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

/** The mean colour of a patch of the engine's frame: centre (x, y) and half-size r, all fractions of the frame. */
export const patch = (win, x, y, r = 0.04) =>
  win.evaluate(
    ([x, y, r]) => {
      const c = document.getElementById("openrip-engine-frame");
      const t = document.createElement("canvas");
      t.width = c.width;
      t.height = c.height;
      const g = t.getContext("2d");
      g.drawImage(c, 0, 0);
      const [x0, y0, w, h] = [Math.round((x - r) * c.width), Math.round((y - r) * c.height), Math.max(1, Math.round(2 * r * c.width)), Math.max(1, Math.round(2 * r * c.height))];
      const d = g.getImageData(x0, y0, w, h).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
      return sum.map((v) => v / (d.length / 4));
    },
    [x, y, r],
  );

/** How far apart two colours are: the mean difference of their channels. */
export const apart = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;

/** The standard deviation of the lightness over a patch (grain shows as a spread). */
export const spread = (win, x, y, r = 0.1) =>
  win.evaluate(
    ([x, y, r]) => {
      const c = document.getElementById("openrip-engine-frame");
      const t = document.createElement("canvas");
      t.width = c.width;
      t.height = c.height;
      const g = t.getContext("2d");
      g.drawImage(c, 0, 0);
      const d = g.getImageData(Math.round((x - r) * c.width), Math.round((y - r) * c.height), Math.round(2 * r * c.width), Math.round(2 * r * c.height)).data;
      // Differences between neighbouring pixels: smooth picture detail cancels, grain does not.
      let sum = 0;
      let n = 0;
      for (let i = 4; i < d.length; i += 4) {
        sum += Math.abs(d[i] - d[i - 4]) + Math.abs(d[i + 1] - d[i - 3]) + Math.abs(d[i + 2] - d[i - 2]);
        n += 3;
      }
      return sum / n;
    },
    [x, y, r],
  );

/** A mask handle on the player's canvas by its Konva name (MaskHandles), in window pixels. */
export const handle = (win, name, i = 0) =>
  win.evaluate(
    ([name, i]) => {
      for (const stage of window.Konva?.stages ?? []) {
        if (!stage.container().closest("[data-testid=player]")) continue;
        const n = stage.find(`.${name}`).filter((x) => x.isVisible())[i];
        if (!n) continue;
        const box = stage.container().getBoundingClientRect();
        let p;
        if (n.getClassName() === "Line") {
          const q = n.points();
          p = n.getAbsoluteTransform().point({ x: (q[0] + q[q.length - 2]) / 2, y: (q[1] + q[q.length - 1]) / 2 });
        } else {
          const r = n.getClientRect({ skipShadow: true, skipStroke: true });
          p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        return { x: box.x + p.x, y: box.y + p.y };
      }
      return null;
    },
    [name, i],
  );

/** The mean colour of a patch of the frame at second `s` of an exported file (ffmpeg from the app's ffmpeg-static). */
export const filePatch = (file, s, x, y, r = 0.04) => {
  const ffmpeg = createRequire(path.resolve("../../package.json"))("ffmpeg-static");
  const [W, H] = [160, 90];
  const raw = execFileSync(ffmpeg, ["-v", "error", "-ss", String(s), "-i", file, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
  const sum = [0, 0, 0];
  let n = 0;
  for (let py = Math.round((y - r) * H); py < Math.round((y + r) * H); py++) {
    for (let px = Math.round((x - r) * W); px < Math.round((x + r) * W); px++) {
      for (let k = 0; k < 3; k++) sum[k] += raw[(py * W + px) * 3 + k];
      n++;
    }
  }
  return sum.map((v) => v / n);
};

/** Export the project to `outDir/<name>.mp4` through the dialog; resolves to the file's path. */
export const exportProject = async (ctx, name) => {
  const { app, win, outDir, fs, shot } = ctx;
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const file = path.join(outDir, `${name}.mp4`);
  fs.rmSync(file, { force: true });
  await win.locator("[data-testid=export]").click();
  await win.waitForTimeout(1000);
  const dialog = win.getByRole("dialog");
  await dialog.locator('input[placeholder="My export"]').fill(name);
  await dialog.locator('input[placeholder="/path/to/export"]').fill(outDir);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  for (let i = 0; i < 240 && !(await win.getByText("Export completed").count()); i++) await win.waitForTimeout(500);
  await shot(`${name}-exported`);
  if (!fs.existsSync(file)) throw new Error("no export file");
  return file;
};
