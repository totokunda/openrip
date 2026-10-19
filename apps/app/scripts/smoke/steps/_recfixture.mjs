// Fixtures and helpers for the recording and media steps (record, recorddenied, voiceoveroptions,
// replaceclip, relink): small solid-colour clips with a tone, made with ffmpeg-static, and the
// file facts read back from ffmpeg.
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { ffmpeg } from "./_audio.mjs";

/** A solid `color` clip of `seconds` at 320×240, 30 fps, with a `hz` tone, as `file`. */
export const makeClip = (file, { color, seconds, hz = 440 }) =>
  execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=320x240:d=${seconds}:r=30`, "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${seconds}`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);

/** What ffmpeg says about a file: its video size and codec, whether it has sound, its length. */
export const probe = (file) => {
  const err = spawnSync(ffmpeg, ["-hide_banner", "-i", file]).stderr.toString();
  const video = /Stream #\d+:\d+.*Video: (\w+).*?, (\d+)x(\d+)/.exec(err);
  const d = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(err);
  return {
    codec: video?.[1],
    width: video ? +video[2] : 0,
    height: video ? +video[3] : 0,
    audio: /Stream #\d+:\d+.*Audio:/.test(err),
    seconds: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
  };
};

/** The RGB of the pixel (x, y) of the frame `at` seconds into `file`, decoded by ffmpeg. */
export const pixel = (file, at, x, y, width, height) => {
  const raw = execFileSync(ffmpeg, ["-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 26 });
  const i = (y * width + x) * 3;
  return [raw[i], raw[i + 1], raw[i + 2]];
};

/** The next file pickers (the native dialog) answer with `files`. */
export const pickReturns = (app, files) =>
  app.evaluate(({ ipcMain }, files) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => files);
  }, files);

/** The next folder picker (Link to a folder) answers with `folder`. */
export const folderReturns = (app, folder) =>
  app.evaluate(({ ipcMain }, folder) => {
    ipcMain.removeHandler("settings:pick-folder");
    ipcMain.handle("settings:pick-folder", async () => folder);
  }, folder);

/** The project's media folder inside the profile: the one folder under media/ that holds the symlinks. */
export const mediaDir = (ctx) => {
  const root = path.join(ctx.udDir, "media");
  const sub = ctx.fs.readdirSync(root).filter((n) => /^[0-9a-f-]{36}$/.test(n));
  return path.join(root, sub[0]);
};

/** Drag the media card named `name` onto the empty timeline (as `placeOnTimeline` does for the first import). */
export const dragToEmptyTimeline = async (win, name) => {
  const item = win.locator(`[data-testid=media-card][data-name="${name}"]`);
  await item.waitFor({ timeout: 30000 });
  const drop = win.getByText("Drag and drop media to start creating");
  const a = await item.boundingBox();
  const b = await drop.boundingBox();
  await win.mouse.move(a.x + a.width / 2, a.y + 20);
  await win.mouse.down();
  await win.mouse.move(a.x + a.width / 2 + 10, a.y + 30, { steps: 5 });
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  await win.waitForTimeout(300);
  await win.mouse.up();
  await win.waitForTimeout(3000);
};
