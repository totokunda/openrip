// Build the Rust engine's Node addon and copy it to native/<platform>-<arch>/openrip_node.node,
// where the main process loads it in development and electron-builder picks it up for
// packaging (see electron-builder.cjs).
//
// FFmpeg is linked in statically from a minimal LGPL build (engine/scripts/build-ffmpeg.sh,
// run here the first time for each architecture), so the addon needs no FFmpeg installed.
//
//   node scripts/build-engine.mjs [--arch arm64|x64] [--debug]
//
// Without a Rust toolchain this warns and exits 0: the app then runs on its own preview.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const engineDir = join(appDir, "..", "..", "engine");
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const arch = argValue("arch") ?? process.arch;
const profile = args.includes("--debug") ? "debug" : "release";

const rustTarget = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
}[`${process.platform}-${arch}`];
const outDir = join(appDir, "native", `${process.platform}-${arch}`);
mkdirSync(outDir, { recursive: true });

if (!rustTarget) {
  console.warn(`[build-engine] no engine build for ${process.platform}-${arch} yet; the app will use its own preview`);
  process.exit(0);
}

const cargo = spawnSync("cargo", ["--version"], { encoding: "utf8" });
if (cargo.status !== 0) {
  console.warn("[build-engine] cargo not found (install Rust from https://rustup.rs); the app will use its own preview");
  process.exit(0);
}

// FFmpeg for this architecture, built once into engine/.ffmpeg/<arch>/.
const ffmpegArch = { arm64: "arm64", x64: "x86_64" }[arch];
const ffmpeg = spawnSync(join(engineDir, "scripts", "build-ffmpeg.sh"), [ffmpegArch], { cwd: engineDir, stdio: "inherit" });
if (ffmpeg.status !== 0) {
  console.error("[build-engine] building FFmpeg failed");
  process.exit(ffmpeg.status ?? 1);
}

// Its own target dir: the static-FFmpeg feature would otherwise rebuild the shared one's
// FFmpeg-dependent crates each time the engine's dev tools are built without it.
const targetDir = join(engineDir, "target", "addon");
const hostArch = process.arch;
const crossTarget = arch !== hostArch ? rustTarget : null;
const cargoArgs = ["build", "-p", "openrip-node", "--features", "static-ffmpeg"];
if (profile === "release") cargoArgs.push("--release");
if (crossTarget) cargoArgs.push("--target", crossTarget);
console.log(`[build-engine] cargo ${cargoArgs.join(" ")}`);
const built = spawnSync("cargo", cargoArgs, {
  cwd: engineDir,
  stdio: "inherit",
  env: { ...process.env, FFMPEG_DIR: join(engineDir, ".ffmpeg", ffmpegArch), CARGO_TARGET_DIR: targetDir },
});
if (built.status !== 0) {
  console.error("[build-engine] cargo build failed");
  process.exit(built.status ?? 1);
}

const libName = process.platform === "darwin" ? "libopenrip_node.dylib" : "libopenrip_node.so";
const libPath = join(targetDir, ...(crossTarget ? [crossTarget] : []), profile, libName);
if (!existsSync(libPath)) {
  console.error(`[build-engine] built library not found at ${libPath}`);
  process.exit(1);
}
const dest = join(outDir, "openrip_node.node");
copyFileSync(libPath, dest);
// Only system libraries and frameworks: nothing from Homebrew or another local install.
if (process.platform === "darwin") {
  const linked = execFileSync("otool", ["-L", dest], { encoding: "utf8" })
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(" ")[0])
    .filter((l) => l && !l.startsWith("/usr/lib/") && !l.startsWith("/System/Library/") && !l.endsWith("libopenrip_node.dylib"))
    // Swift overlays macOS ships in /usr/lib/swift, found through the addon's rpath there.
    .filter((l) => !(l.startsWith("@rpath/libswift") && execFileSync("otool", ["-l", dest], { encoding: "utf8" }).includes("path /usr/lib/swift ")));
  if (linked.length) {
    console.error(`[build-engine] the addon links libraries a user's Mac won't have:\n  ${linked.join("\n  ")}`);
    process.exit(1);
  }
  // Napi addons link with `-undefined dynamic_lookup`: a compiler builtin left undefined
  // would only fail (crash) when called.
  const undefinedSyms = execFileSync("nm", ["-u", dest], { encoding: "utf8" }).split("\n");
  const builtins = undefinedSyms.filter((s) => s === "___isPlatformVersionAtLeast" || s.startsWith("___clang_") || s.startsWith("___builtin"));
  if (builtins.length) {
    console.error(`[build-engine] the addon leaves compiler builtins undefined: ${builtins.join(", ")}`);
    process.exit(1);
  }
}
console.log(`[build-engine] ${dest}`);
