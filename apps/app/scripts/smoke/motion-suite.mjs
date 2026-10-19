// Motion and timing through the UI end to end: runs session.mjs once per case below, each on a
// fresh profile under out/motion/, and prints every PASS/FAIL line.
//   node motion-suite.mjs <appDir> <clip> [case...]
// CLIP_NAME names the clip in the media panel when it isn't IMG_9019 (the steps want 10 s or
// more, at 24 fps). The keys case drives the renderer's own modules to set keys, so it needs
// the renderer's dev server (`npx vite --port 5199` in packages/renderer): give its URL as
// MOTION_DEV (http://localhost:5199); it's skipped without one.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [appDir, clip, ...only] = process.argv.slice(2);
const { MOTION_DEV, ...rest } = process.env;
const dev = MOTION_DEV ? { MODE: "development", VITE_DEV_SERVER_URL: MOTION_DEV } : null;
// [case, env (null: skipped), steps]
const CASES = [
  ["trans", {}, "import timeline transui"],
  ["translib", {}, "import timeline translib reopen translibcheck"],
  ["clipanim", {}, "import timeline animclip"],
  ["speed", {}, "import timeline speedui"],
  ["freeze", {}, "import timeline freezeui"],
  ["keys", dev, "import timeline keysui"],
];
for (const [name, env, steps] of CASES) {
  if (only.length && !only.includes(name)) continue;
  if (!env) {
    console.log(`== ${name}: skipped, no MOTION_DEV given`);
    continue;
  }
  const out = path.join("out/motion", name);
  fs.rmSync(`${out}-profile`, { recursive: true, force: true });
  console.log(`== ${name}: ${steps}`);
  const r = spawnSync("node", ["session.mjs", appDir, out, `${out}-profile`, clip, ...steps.split(" ")], { env: { ...rest, ...env }, encoding: "utf8" });
  const lines = (r.stdout || "").split("\n").filter((l) => /^STEP|^\s+(PASS|FAIL)/.test(l));
  console.log(lines.join("\n"));
}
