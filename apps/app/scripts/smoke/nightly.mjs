// Every check the app has, in one go, for a run while nobody's at the computer (4 AM): the
// build, the renderer's unit tests and typecheck, the engine's tests, and every smoke step and
// suite on its own fresh profile, on the old timeline and again on the new one
// (docs/plan/timeline-rewrite.md). The app never shows (hidden-electron.mjs, background.ts).
// Writes out/nightly/<date>/summary.md (and results.json, and each case's own output folder).
//   node nightly.mjs                      everything
//   NIGHTLY_ONLY=tl,multisel node …       only the cases named
//   ENGINE=0 node …                       without the engine's tests (they build it, ~15 min)
// The clips are made here with FFmpeg (macOS keeps ~/Downloads from this session): a 12 s 4K
// ProRes test picture with a tone, a photo, and a short red H.264 clip for replace and relink.
// IMG_9079.MOV (speech, a face) is used where a step needs it, when it's somewhere readable
// (NIGHTLY_REAL_CLIP, or ~/Movies/OpenRip test media/IMG_9079.MOV); those steps are skipped
// without it.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const repo = path.resolve(appDir, "../..");
const date = new Date().toISOString().slice(0, 10);
const out = path.resolve(process.env.NIGHTLY_OUT || path.join(here, "out/nightly", date));
const fx = path.join(out, "fixtures");
fs.mkdirSync(fx, { recursive: true });
const only = process.env.NIGHTLY_ONLY ? process.env.NIGHTLY_ONLY.split(",") : null;
const ffmpeg = path.join(appDir, "node_modules/ffmpeg-static/ffmpeg");
const ffprobe = fs.existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "ffprobe";
const results = { date, started: new Date().toISOString(), checks: [], cases: [] };
const log = (s) => {
  fs.appendFileSync(path.join(out, "progress.log"), `${new Date().toISOString().slice(11, 19)} ${s}\n`);
};

// ---- Fixtures -----------------------------------------------------------------------------
const make = (name, args) => {
  const file = path.join(fx, name);
  if (!fs.existsSync(file)) execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args, file]);
  return file;
};
const STD = make("STD_4K.mov", ["-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=24:duration=12", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=12", "-c:v", "prores_ks", "-profile:v", "1", "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le", "-shortest"]);
const PHOTO = make("photo.png", ["-f", "lavfi", "-i", "testsrc2=size=1920x1080", "-frames:v", "1"]);
const RED = make("red.mp4", ["-f", "lavfi", "-i", "color=c=red:size=1280x720:rate=24:duration=5", "-f", "lavfi", "-i", "sine=frequency=330:duration=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]);
const realCandidates = [process.env.NIGHTLY_REAL_CLIP, path.join(os.homedir(), "Movies/OpenRip test media/IMG_9079.MOV")].filter(Boolean);
const REAL = realCandidates.find((p) => {
  try {
    fs.closeSync(fs.openSync(p, "r"));
    return true;
  } catch {
    return false;
  }
});
const models = process.env.OPENRIP_MODELS || "/Users/tosinkuye/.claude/jobs/befa5ed4/tmp/autocap/models";

// ---- Checks that aren't the app ------------------------------------------------------------
const check = (name, cmd, args, opts = {}) => {
  log(`check ${name}`);
  const t = Date.now();
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20, ...opts });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  fs.writeFileSync(path.join(out, `${name}.log`), text);
  const entry = { name, ok: r.status === 0, seconds: Math.round((Date.now() - t) / 1000), tail: text.trim().split("\n").slice(-6) };
  results.checks.push(entry);
  return entry;
};

// ---- Cases --------------------------------------------------------------------------------
const V = { CLIP_NAME: "STD_4K" };
const DEV_PORT = 5299;
const dev = { MODE: "development", VITE_DEV_SERVER_URL: `http://localhost:${DEV_PORT}` };
const NEW = { OPENRIP_NEW_TIMELINE: "1" };
// [name, steps, env, clip]. Steps are session.mjs's; a "suite:" name runs a suite script instead.
const CASES = [
  // The basics, export and the player.
  ["std", "import timeline play perf editplay", V],
  ["shell", "import timeline canvastools newtext texttab shell", V],
  ["undo", "import timeline newtext undo play perf", V],
  ["exportui", "import timeline newtext exportui", { ...V, FFPROBE: ffprobe }],
  ["exportcodecs", "import timeline exportcodecs", { ...V, FFPROBE: ffprobe }],
  ["render", "import timeline render", V],
  ["player", "import timeline player", V],
  ["ratios", "import timeline ratios", V],
  ["windows", "import timeline windows", V],
  ["timelines", "import timeline timelines", { ...V, FFPROBE: ffprobe }],
  // Timeline editing.
  ["suite:tl", "tl-suite.mjs", V],
  ["multisel", "import timeline newtext multisel", V],
  ["groups", "import timeline newtext groups", V],
  ["presets", "import timeline newtext presets", V],
  ["compound", "import timeline newtext compound", V],
  ["compoundaudio", "import timeline compoundaudio", V],
  ["compoundenhance", "import compoundenhance", V],
  ["menus", "import timeline menus", V],
  ["duplicate", "import timeline duplicate", V],
  ["zoomrange", "import timeline zoomrange", V],
  ["trimclip", "import timeline trimclip", V],
  ["scrubaudio", "import timeline scrubaudio", V],
  ["shuttle", "import timeline shuttle", V],
  ["arrange", "import timeline arrangelayers reopen arrangelayerscheck", V],
  ["persist", "import timeline persist reopen persistcheck", V],
  // Motion, text and captions.
  ["suite:motion", "motion-suite.mjs", { ...V, MOTION_DEV: `http://localhost:${DEV_PORT}` }],
  ["slowmo", "import timeline slowmo", V],
  ["texttemplates", "import timeline texttemplates", V],
  ["textpresets", "import timeline textpresets", V],
  ["textpresetsave", "import timeline newtext textpresetsave", V],
  ["textbg", "import timeline newtext textbg", V],
  ["textfavs", "import timeline textfavs", V],
  ["fontcheck", "import timeline newtext fontcheck", V],
  ["captionedit", "import timeline captionedit", V],
  ["captionsio", "import timeline captionsio", V],
  ["transcript", "import transcript", { ...V, OPENRIP_MODELS: models }],
  // The inspector, colour and effects.
  ["suite:insp", "insp-suite.mjs", { ...V, PHOTO_NAME: "photo", ...dev }],
  ["canvaspatterns", "import timeline canvaspatterns", V],
  ["particles", "import timeline particles", V],
  ["colorlog", "import timeline colorlog", V],
  ["colormatch", "import colormatch", V],
  ["adjustlayer", "import timeline adjustlayer", V],
  ["filtersui", "import timeline filtersui", V],
  ["effectsui", "import timeline effectsui", V],
  ["stickersui", "import timeline stickersui", V],
  ["shapes", "import timeline shapes", V],
  ["pen", "import timeline pen", V],
  ["legacydraw", "import timeline legacydraw", V],
  ["enhance", "import enhance", V],
  ["scenes", "import scenes", V],
  // Sound.
  ["audioui", "import timeline audioui", V],
  ["audiodsp", "import audiodsp", V],
  ["audiolib", "import timeline audiolib", V],
  ["audiosep", "import timeline audiosep", V],
  ["beatsui", "import timeline newtext beatsui", V],
  ["voiceoverui", "import timeline voiceoverui", { ...V, OPENRIP_FAKE_MIC: "1" }],
  ["voiceoveroptions", "import timeline voiceoveroptions", { ...V, OPENRIP_FAKE_MIC: "1" }],
  ["voiceoverdenied", "import timeline voiceoverdenied", { ...V, OPENRIP_FAKE_MIC: "denied" }],
  ["record", "import record", { ...V, OPENRIP_FAKE_CAPTURE: "1" }],
  ["recorddenied", "import timeline recorddenied", { ...V, OPENRIP_FAKE_CAPTURE: "denied", OPENRIP_FAKE_MIC: "denied" }],
  // Media, libraries, home and settings.
  ["mediacards", "import mediacards", V],
  ["folders", "import folders", V],
  ["favourites", "import timeline favourites", V],
  ["copymedia", "import copymedia", V],
  ["cardexport", "import cardexport", { ...V, FFPROBE: ffprobe }],
  ["replaceclip", "import timeline replaceclip", { CLIP_NAME: "red.mp4" }, RED],
  ["proxy", "import timeline proxy", V],
  ["proxydefault", "import proxydefault", { ...V, AUTO_PROXY: "1" }],
  ["autorender", "import timeline autorender", V],
  ["covereditor", "import timeline covereditor", V],
  ["projectsettings", "import timeline projectsettings reopen projectsettingscheck", { ...V, PS_KEEP: "1" }],
  ["cropui", "import timeline cropui reopen cropuicheck", V],
  ["settings", "import timeline settings", V],
  ["settingsrows", "import settingsrows", V],
  ["shortcuts", "import timeline shortcuts", V],
  ["home", "import timeline home", V],
  ["trash", "import timeline trash", V],
  ["librarypage", "import timeline librarypage", V],
  ["templatespage", "import timeline templatespage", V],
  ["updateindicator", "import timeline updateindicator", V],
  ["walkthrough", "walkthrough", { ...V, WALKTHROUGH: "1" }],
  // The renderer's own modules (its dev server).
  ["keyframes", "import timeline keyframes reopen keyframescheck", { ...V, ...dev }],
  ["transitions", "import timeline transitions", { ...V, ...dev }],
  ["speed", "import timeline speed", { ...V, ...dev }],
  ["compositing", "import timeline compositing", { ...V, ...dev }],
  ["textstyles", "import timeline textstyles", { ...V, ...dev }],
  ["waveformui", "import timeline waveformui", { ...V, ...dev }],
  ["adjmaskhandles", "import timeline adjmaskhandles", { ...V, ...dev }],
  ["effectmask", "import timeline effectmask", { ...V, ...dev }],
  ["audio", "import timeline audio", { ...V, ...dev, OPENRIP_FAKE_MIC: "1" }],
  // On the real clip only: speech and a face.
  ["autocaptions", "import timeline autocaptions", { CLIP_NAME: "IMG_9079", OPENRIP_MODELS: models }, "REAL"],
  ["tracking", "import timeline newtext tracking", { CLIP_NAME: "IMG_9079" }, "REAL"],
  // The new timeline (docs/plan/timeline-rewrite.md).
  ["new:suite:tl", "tl-suite.mjs", { ...V, ...NEW }],
  ["new:multisel", "import timeline newtext multisel", { ...V, ...NEW }],
  ["new:groups", "import timeline newtext groups", { ...V, ...NEW }],
  ["new:compound", "import timeline newtext compound", { ...V, ...NEW }],
  ["new:timelines", "import timeline timelines", { ...V, ...NEW, FFPROBE: ffprobe }],
  ["new:zoomrange", "import timeline zoomrange", { ...V, ...NEW }],
  ["new:std", "import timeline play perf editplay", { ...V, ...NEW }],
  ["new:menus", "import timeline menus", { ...V, ...NEW }],
  ["new:beatsui", "import timeline newtext beatsui", { ...V, ...NEW }],
  ["new:windows", "import timeline windows", { ...V, ...NEW }],
];

/** One case: its own profile, its PASS/FAIL lines kept; a case that hangs is stopped after 20 minutes. */
const runCase = ([name, steps, env, clip]) =>
  new Promise((resolve) => {
    const clipPath = clip === "REAL" ? REAL : clip ?? STD;
    if (clip === "REAL" && !REAL) return resolve({ name, skipped: "no readable IMG_9079.MOV" });
    const tag = name.replace(/[:]/g, "-");
    const caseOut = path.join(out, tag);
    const profile = path.join(out, `${tag}-profile`);
    fs.rmSync(profile, { recursive: true, force: true });
    const suite = name.split(":").includes("suite");
    const args = suite
      ? [path.join(here, steps), appDir, ...(steps === "insp-suite.mjs" ? [clipPath, PHOTO] : [clipPath])]
      : [path.join(here, "session.mjs"), appDir, caseOut, profile, clipPath, ...steps.split(" ")];
    log(`case ${name} start`);
    const t = Date.now();
    // A suite keeps its cases under SUITE_OUT, so the old and new timeline's runs of one don't meet.
    const child = spawn("node", args, { cwd: here, env: { ...process.env, OPENRIP_ENGINE_MUTE: "1", SUITE_OUT: caseOut, ...env } });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 20 * 60 * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.rmSync(profile, { recursive: true, force: true });
      fs.mkdirSync(caseOut, { recursive: true });
      fs.writeFileSync(path.join(caseOut, "output.txt"), text);
      const lines = text.split("\n").filter((l) => /^(STEP|==|\s+FAIL)/.test(l));
      const failed = lines.filter((l) => /FAIL/.test(l) || /^STEP \S+: FAILED/.test(l));
      const passMatches = [...text.matchAll(/ok (\d+)\/(\d+) passed/g)];
      const passed = passMatches.reduce((n, m) => n + +m[1], 0);
      const total = passMatches.reduce((n, m) => n + +m[2], 0);
      const r = { name, ok: code === 0 && failed.length === 0, code, seconds: Math.round((Date.now() - t) / 1000), passed, total, failed: failed.slice(0, 40), steps: lines.filter((l) => l.startsWith("STEP")).length };
      log(`case ${name} ${r.ok ? "ok" : "FAILED"} ${r.seconds}s`);
      resolve(r);
    });
  });

// ---- Run ----------------------------------------------------------------------------------
const pick = (name) => !only || only.some((o) => name === o || name.startsWith(o + ":") || name.endsWith(":" + o));
log(`nightly ${date} in ${out}`);
check("build", "npm", ["run", "build"], { cwd: appDir });
check("renderer-typecheck", "npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], { cwd: path.join(appDir, "packages/renderer") });
check("renderer-tests", "sh", ["-c", "node --test tests/*.test.ts"], { cwd: path.join(appDir, "packages/renderer") });
if (process.env.ENGINE !== "0") {
  const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` };
  check("engine-tests", "cargo", ["test", "--workspace", "--no-fail-fast"], { cwd: path.join(repo, "engine"), env });
  check("engine-targets", "bash", ["scripts/check-targets.sh"], { cwd: path.join(repo, "engine"), env });
}
// The renderer's dev server, for the cases that drive its modules.
const devServer = spawn("npx", ["vite", "--port", String(DEV_PORT), "--strictPort"], { cwd: path.join(appDir, "packages/renderer"), stdio: "ignore", detached: true });
await new Promise((r) => setTimeout(r, 8000));
// Two lanes at once: each case is slow mostly waiting on the app.
const queue = CASES.filter(([name]) => pick(name));
const lane = async () => {
  while (queue.length) results.cases.push(await runCase(queue.shift()));
};
await Promise.all([lane(), lane()]);
try {
  process.kill(-devServer.pid);
} catch {}

// ---- Report -------------------------------------------------------------------------------
results.finished = new Date().toISOString();
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
const ran = results.cases.filter((c) => !c.skipped);
const md = [
  `# Nightly checks ${date}`,
  "",
  `${results.started.slice(11, 16)}–${results.finished.slice(11, 16)} UTC. Cases: ${ran.filter((c) => c.ok).length} of ${ran.length} passed${results.cases.length > ran.length ? `, ${results.cases.length - ran.length} skipped` : ""}.`,
  "",
  "## Build and tests",
  "",
  ...results.checks.map((c) => `- ${c.ok ? "✅" : "❌"} ${c.name} (${c.seconds} s)${c.ok ? "" : `: ${c.tail.slice(-3).join(" / ")}`}`),
  "",
  "## Failed",
  "",
  ...(ran.filter((c) => !c.ok).flatMap((c) => [`### ${c.name} (${c.seconds} s, exit ${c.code})`, "", ...c.failed.map((l) => `- ${l.trim()}`), ""]) || []),
  "## Passed",
  "",
  ...ran.filter((c) => c.ok).map((c) => `- ${c.name}${c.total ? ` (${c.passed}/${c.total})` : ""}, ${c.seconds} s`),
  "",
  ...(results.cases.some((c) => c.skipped) ? ["## Skipped", "", ...results.cases.filter((c) => c.skipped).map((c) => `- ${c.name}: ${c.skipped}`)] : []),
].join("\n");
fs.writeFileSync(path.join(out, "summary.md"), md + "\n");
log("done");
console.log(path.join(out, "summary.md"));
