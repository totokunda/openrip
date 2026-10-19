// Timeline editing end to end: runs session.mjs once per case below, each on a fresh profile
// under out/tl/, and prints every PASS/FAIL line.
//   node tl-suite.mjs <appDir> <clip> [case...]
// CLIP_NAME names the clip in the media panel when it isn't IMG_9019. The CapCut case takes
// its draft from TL_DRAFT (several clips on its main track) and is skipped without one.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [appDir, clip, ...only] = process.argv.slice(2);
const { TL_DRAFT, ...rest } = process.env;
// [case, env, steps]
const CASES = [
  ["magnet", {}, "import timeline tlmagnet"],
  ["link", {}, "import timeline tllink"],
  ["snap", {}, "import timeline newtext tlsnap"],
  ["markers", {}, "import timeline tlmarkers"],
  ["tracks", {}, "import timeline newtext tltracks"],
  ["handle", {}, "import timeline newtext tlhandle"],
  ["keys", {}, "import timeline newtext tlkeys"],
  ["tools", {}, "import timeline newtext tltools"],
  ["undo", {}, "import timeline newtext undo"],
  ["capcut", { CAPCUT_DRAFT: TL_DRAFT }, "capcut tlcapcut"],
];
for (const [name, env, steps] of CASES) {
  if (only.length && !only.includes(name)) continue;
  if ("CAPCUT_DRAFT" in env && !env.CAPCUT_DRAFT) {
    console.log(`== ${name}: skipped, no draft given`);
    continue;
  }
  const out = path.join("out/tl", name);
  fs.rmSync(`${out}-profile`, { recursive: true, force: true });
  console.log(`== ${name}: ${steps}`);
  const r = spawnSync("node", ["session.mjs", appDir, out, `${out}-profile`, clip, ...steps.split(" ")], { env: { ...rest, ...env }, encoding: "utf8" });
  const lines = (r.stdout || "").split("\n").filter((l) => /^STEP|^\s+(PASS|FAIL)/.test(l));
  console.log(lines.join("\n"));
}
