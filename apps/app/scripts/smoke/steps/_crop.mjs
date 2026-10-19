// Helpers for the crop steps: the clip's source picture and the picture a crop should give,
// both made with FFmpeg (an independent turn and cut of the source, not the app's or the engine's
// maths), and the engine's frame compared with it.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ffmpegPath } from "./_fixture.mjs";

const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

/** The clip's picture at media time `at` seconds, upright, as a PNG in the output folder. */
export const sourcePicture = (ctx, at = 0) => {
  const file = path.join(ctx.outDir, "crop-source.png");
  execFileSync(ffmpegPath(), ["-v", "error", "-y", "-ss", String(at), "-i", ctx.clipPath, "-frames:v", "1", file]);
  const [sw, sh] = pngSize(ctx.fs.readFileSync(file));
  return { file, sw, sh };
};

/** A crop (normalised, with its rotation) as the window the dialog shows: edges from the picture's centre, in picture pixels. */
export const windowOf = (crop, sw, sh) => {
  const theta = ((crop.rotation ?? 0) * Math.PI) / 180;
  const [cx, cy] = [(crop.x + crop.width / 2) * sw - sw / 2, (crop.y + crop.height / 2) * sh - sh / 2];
  const [dx, dy] = [Math.cos(theta) * cx - Math.sin(theta) * cy, Math.sin(theta) * cx + Math.cos(theta) * cy];
  const [hw, hh] = [(crop.width * sw) / 2, (crop.height * sh) / 2];
  return { l: dx - hw, t: dy - hh, r: dx + hw, b: dy + hh };
};

/**
 * The picture a crop gives on a canvas of `fw`×`fh`: the source turned `rotation` degrees
 * clockwise, the window cut from it at the whole picture's scale (as fitted to the canvas), on black. `at` places the
 * window's middle on the canvas (its pixel centre); default the canvas's middle.
 */
export const expectedPicture = (ctx, src, crop, fw, fh, name, at) => {
  const win = windowOf(crop, src.sw, src.sh);
  const [wp, hp] = [Math.round(win.r - win.l), Math.round(win.b - win.t)];
  const n = 2 * Math.ceil(Math.hypot(src.sw, src.sh) / 2) + 2;
  // The window keeps the picture's own scale (the clip's box shrinks to it; the picture stays put).
  const fit = Math.min(fw / src.sw, fh / src.sh);
  const [w2, h2] = [Math.round(wp * fit), Math.round(hp * fit)];
  const [cx, cy] = at ?? [fw / 2, fh / 2];
  const rot = crop.rotation ? `rotate=${(crop.rotation * Math.PI) / 180}:ow=${n}:oh=${n}:c=black,` : "";
  const vf = [
    `pad=${n}:${n}:(ow-iw)/2:(oh-ih)/2:black`,
    ...(rot ? [rot.slice(0, -1)] : []),
    `crop=${wp}:${hp}:${Math.round(n / 2 + win.l)}:${Math.round(n / 2 + win.t)}`,
    `scale=${w2}:${h2}:flags=area`,
    `pad=${fw}:${fh}:${Math.round(cx - w2 / 2)}:${Math.round(cy - h2 / 2)}:black`,
  ].join(",");
  const file = path.join(ctx.outDir, `crop-expected-${name}.png`);
  execFileSync(ffmpegPath(), ["-v", "error", "-y", "-i", src.file, "-vf", vf, "-frames:v", "1", file]);
  return file;
};

/** The engine's frame canvas: its size and bytes. */
export const engineBytes = (win) =>
  win.evaluate(() => {
    const c = document.getElementById("openrip-engine-frame");
    const t = document.createElement("canvas");
    [t.width, t.height] = [c.width, c.height];
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    return { w: t.width, h: t.height, rgba: Array.from(g.getImageData(0, 0, t.width, t.height).data) };
  });

/** Mean difference (0–255) between the engine's frame and a PNG of the same size, and the picture's non-black box. */
export const compareFrame = async (ctx, file) => {
  const { app, win } = ctx;
  const eng = await engineBytes(win);
  const bgra = await app.evaluate(({ nativeImage }, { f, w, h }) => Array.from(nativeImage.createFromPath(f).resize({ width: w, height: h, quality: "best" }).toBitmap()), { f: file, w: eng.w, h: eng.h });
  let diff = 0;
  let n = 0;
  for (let i = 0; i < eng.rgba.length && i + 2 < bgra.length; i += 4) {
    diff += Math.abs(eng.rgba[i] - bgra[i + 2]) + Math.abs(eng.rgba[i + 1] - bgra[i + 1]) + Math.abs(eng.rgba[i + 2] - bgra[i]);
    n += 3;
  }
  return { mean: n ? diff / n : 255, w: eng.w, h: eng.h, box: litBox(eng) };
};

/** The box (x0, y0, x1, y1) of the frame's pixels that aren't black (rows and columns with more than 2% lit), or null. */
export const litBox = ({ w, h, rgba }) => {
  const lit = (i) => rgba[i] + rgba[i + 1] + rgba[i + 2] > 36;
  const rows = new Array(h).fill(0);
  const cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lit((y * w + x) * 4)) (rows[y]++, cols[x]++);
  const rs = rows.map((c, y) => (c > w * 0.02 ? y : -1)).filter((y) => y >= 0);
  const cs = cols.map((c, x) => (c > h * 0.02 ? x : -1)).filter((x) => x >= 0);
  return rs.length && cs.length ? [cs[0], rs[0], cs[cs.length - 1] + 1, rs[rs.length - 1] + 1] : null;
};
