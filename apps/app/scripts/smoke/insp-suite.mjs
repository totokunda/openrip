// The video and photo inspector end to end: runs session.mjs once per case below, each on a
// fresh profile under out/insp/, and prints every PASS/FAIL line.
//   node insp-suite.mjs <appDir> <video> <photo> [case...]
// CLIP_NAME / PHOTO_NAME name them in the media panel (default: their file names without the
// extension). inspadjust sets the old sliders through the store, so run the renderer's dev
// server and pass MODE=development VITE_DEV_SERVER_URL=… as for `keyframes`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [appDir, video, photo, ...only] = process.argv.slice(2);
const { CLIP_NAME, PHOTO_NAME, ...rest } = process.env;
const nameOf = (p) => path.basename(p).replace(/\.[^.]+$/, "");
const V = { clip: video, CLIP_NAME: CLIP_NAME || nameOf(video) };
const P = { clip: photo, CLIP_NAME: PHOTO_NAME || nameOf(photo) };
// [case, clip, steps]
const CASES = [
  ["basic", V, "import timeline inspbasic"],
  ["adjust", V, "import timeline inspadjust"],
  ["chroma", V, "import timeline inspchroma"],
  ["mask", V, "import timeline inspmask inspsave reopen inspcheck"],
  ["photobasic", P, "import timeline inspbasic"],
  ["photoadjust", P, "import timeline inspadjust"],
  ["photochroma", P, "import timeline inspchroma"],
  ["photomask", P, "import timeline inspmask inspsave reopen inspcheck"],
];
for (const [name, { clip, CLIP_NAME: label }, steps] of CASES) {
  if (only.length && !only.includes(name)) continue;
  if (!clip) {
    console.log(`== ${name}: skipped, no clip given`);
    continue;
  }
  const out = path.join("out/insp", name);
  fs.rmSync(`${out}-profile`, { recursive: true, force: true });
  console.log(`== ${name}: ${steps}`);
  const r = spawnSync("node", ["session.mjs", appDir, out, `${out}-profile`, clip, ...steps.split(" ")], { env: { ...rest, CLIP_NAME: label }, encoding: "utf8" });
  const lines = (r.stdout || "").split("\n").filter((l) => /^STEP|^\s+(PASS|FAIL)/.test(l));
  console.log(lines.join("\n"));
}
