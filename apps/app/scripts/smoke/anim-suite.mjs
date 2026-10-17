// The Animation tab end to end: runs session.mjs once per case below, each on a fresh profile
// under out/anim/ (the restarts reuse theirs), and prints every PASS/FAIL line.
//   node anim-suite.mjs <appDir> <standard clip> [case...]
// The CapCut cases take their drafts (by name, in CapCut's projects folder) from the
// environment and are skipped without one:
//   DRAFT_IN      Type 1, Type 2 and Typewriter over 2 s on its first animated texts, 3 s long
//                 from 0, 3 and 6 s
//   DRAFT_KEEP    an In animation the engine doesn't draw
//   DRAFT_WORDS   captions with spoken words, three to a page (two at least)
//   DRAFT_WORDS2  captions whose style the engine doesn't draw
//   DRAFT_TRANS   a White Fade and White Flashes (two at least), no Blink; for its export,
//                 EXPORT_WHITE gives the cuts and EXPORT_PLAIN a time well before each
//   DRAFT_BLINK   Blink transitions, one 0.5 s long, with text, video, sound and effect bars
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [appDir, clip, ...only] = process.argv.slice(2);
const { DRAFT_IN, DRAFT_KEEP, DRAFT_WORDS, DRAFT_WORDS2, DRAFT_TRANS, DRAFT_BLINK, EXPORT_WHITE, EXPORT_PLAIN, ...rest } = process.env;
const persistTimes = { PERSIST_TALL: "1", PERSIST_TIMES: "5,6.5,11.5" };
// [case, env, steps, "restart" to reuse the case's profile]
const CASES = [
  // The app's own clips.
  ["text", {}, "import timeline newtext animtext textcut animundo"],
  ["video", {}, "import timeline animvideo"],
  ["persist", {}, "import timeline newtext animsetup persist reopen persistcheck animexport"],
  ["persist", { REOPEN: "Project 1" }, "reopen persistcheck", "restart"],
  ["quick", { QUICK: "video" }, "import timeline newtext quickset"],
  ["quick", { QUICK: "video", REOPEN: "Project 1" }, "reopen quickcheck", "restart"],
  // Drafts.
  ["in", { CAPCUT_DRAFT: DRAFT_IN }, "capcut capin"],
  ["keep", { CAPCUT_DRAFT: DRAFT_KEEP }, "capcut capkeep"],
  ["words", { CAPCUT_DRAFT: DRAFT_WORDS }, "capcut capwords"],
  ["words2", { CAPCUT_DRAFT: DRAFT_WORDS2 }, "capcut capwords2"],
  ["trans", { CAPCUT_DRAFT: DRAFT_TRANS }, "capcut ticks captrans"],
  ["blink", { CAPCUT_DRAFT: DRAFT_BLINK }, "capcut capblink"],
  ["blinkapp", { CAPCUT_DRAFT: DRAFT_BLINK }, "capcut blinkapp"],
  ["tabs", { CAPCUT_DRAFT: DRAFT_BLINK }, "capcut animtabs"],
  ["tabs2", { CAPCUT_DRAFT: DRAFT_IN }, "capcut animtabs"],
  ["cappersist", { CAPCUT_DRAFT: DRAFT_WORDS, ...persistTimes }, "capcut capedit persist reopen ticks persistcheck"],
  ["cappersist", { REOPEN: DRAFT_WORDS, ...persistTimes }, "reopen persistcheck", "restart"],
  ["capexport", { CAPCUT_DRAFT: EXPORT_WHITE && DRAFT_TRANS, EXPORT_WHITE, EXPORT_PLAIN, EXPORT_TYPED: "" }, "capcut capedit animexport"],
];
for (const [name, env, steps, restart] of CASES) {
  if (only.length && !only.includes(name)) continue;
  if (("CAPCUT_DRAFT" in env && !env.CAPCUT_DRAFT) || ("REOPEN" in env && !env.REOPEN)) {
    console.log(`== ${name}: skipped, no draft given`);
    continue;
  }
  const out = path.join("out/anim", name);
  if (!restart) fs.rmSync(`${out}-profile`, { recursive: true, force: true });
  console.log(`== ${name}${restart ? " (restarted)" : ""}: ${steps}`);
  const r = spawnSync("node", ["session.mjs", appDir, out, `${out}-profile`, clip, ...steps.split(" ")], { env: { ...rest, ...env }, encoding: "utf8" });
  const lines = (r.stdout || "").split("\n").filter((l) => /^STEP|^\s+(PASS|FAIL)/.test(l));
  console.log(lines.join("\n"));
}
