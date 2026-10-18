// Fixtures made from the session's clip with FFmpeg (ffmpeg-static, or FFMPEG): shots cut from
// it, each changed so it looks like another shot, joined by hard cuts at known frames; and
// putting a file on an empty timeline (the import dialog stubbed, its media dragged on).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const FIXTURE_FPS = 30;
const [W, H] = [720, 1280];

export const ffmpegPath = () => process.env.FFMPEG || createRequire(path.resolve("../../package.json"))("ffmpeg-static");

/**
 * `segments` ({ from: seconds into the clip, frames, vf: extra filters }) joined by hard cuts
 * into `name` in the output folder, 720×1280 at 30 fps. Returns the file and where each shot
 * after the first starts (seconds).
 */
export const buildFixture = (ctx, name, segments) => {
  const file = path.join(ctx.outDir, name);
  const inputs = [];
  const chains = [];
  segments.forEach((s, i) => {
    inputs.push("-ss", String(s.from), "-t", String(s.frames / FIXTURE_FPS + 0.5), "-i", ctx.clipPath);
    const look = s.vf ? `,${s.vf}` : "";
    chains.push(`[${i}:v]setpts=PTS-STARTPTS,fps=${FIXTURE_FPS},trim=end_frame=${s.frames},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}${look},setsar=1,format=yuv420p,settb=1/${FIXTURE_FPS}[s${i}]`);
  });
  chains.push(`${segments.map((_, i) => `[s${i}]`).join("")}concat=n=${segments.length}:v=1:a=0[out]`);
  execFileSync(ffmpegPath(), ["-v", "error", "-y", ...inputs, "-filter_complex", chains.join(";"), "-map", "[out]", "-r", String(FIXTURE_FPS), "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-an", file]);
  const cuts = [];
  let at = 0;
  for (const s of segments.slice(0, -1)) {
    at += s.frames;
    cuts.push(at / FIXTURE_FPS);
  }
  return { file, cuts, seconds: segments.reduce((a, s) => a + s.frames, 0) / FIXTURE_FPS };
};

/** Import `file` (the picker stubbed) and drag its media item (found by `label`) onto the empty timeline. */
export const placeOnTimeline = async (ctx, file, label) => {
  const { app, win } = ctx;
  await app.evaluate(({ ipcMain }, p) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [p]);
  }, file);
  await win.locator("[data-testid=media-import]").click();
  const item = win.getByText(label, { exact: false }).first();
  await item.waitFor({ timeout: 30000 });
  await win.waitForTimeout(1500);
  const drop = win.getByText("Drag and drop media to start creating");
  const a = await item.boundingBox();
  const b = await drop.boundingBox();
  await win.mouse.move(a.x + a.width / 2, a.y - 60);
  await win.mouse.down();
  await win.mouse.move(a.x + a.width / 2 + 10, a.y - 50, { steps: 5 });
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  await win.waitForTimeout(300);
  await win.mouse.up();
  await win.waitForTimeout(3000);
};

/** Wait for the analysis started just now to finish (its processing pill shown, then gone). */
export const analysed = async (win, { timeout = 120000 } = {}) => {
  const pill = win.locator("[data-testid=analysis-pill]");
  await pill.waitFor({ state: "attached", timeout: 3000 }).catch(() => {});
  await pill.waitFor({ state: "detached", timeout });
  await win.waitForTimeout(600);
};

/** The engine frame's mean red, green and blue (0–255). */
export const frameMeans = (win) =>
  win.evaluate(() => {
    const c = document.getElementById("openrip-engine-frame");
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    const s = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      s[0] += d[i];
      s[1] += d[i + 1];
      s[2] += d[i + 2];
    }
    const n = d.length / 4;
    return s.map((v) => v / n);
  });

export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
