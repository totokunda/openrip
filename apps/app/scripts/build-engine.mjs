// Build the Rust engine's Node addon and copy it to native/<platform>-<arch>/openrip_node.node,
// where the main process loads it in development and electron-builder picks it up for
// packaging (see electron-builder.cjs).
//
// FFmpeg is linked in statically from a minimal LGPL build (engine/scripts/build-ffmpeg.sh,
// run here the first time for each architecture), so the addon needs no FFmpeg installed.
//
//   node scripts/build-engine.mjs [--arch arm64|x64] [--debug]
//
// On macOS, Linux (x64, arm64) and Windows (x64). Windows needs MSVC's cl.exe on the PATH
// (MSVC's "x64 Native Tools" prompt) and MSYS2 (C:\msys64, or MSYS2_BASH naming its bash.exe)
// with make and nasm, for the FFmpeg build.
//
// Without a Rust toolchain this warns and exits 0: the app then runs on its own preview.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { alignLinkedit } from "./align-linkedit.mjs";

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
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
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

// FFmpeg for this platform and architecture, built once into engine/.ffmpeg/<arch>/ on macOS
// and engine/.ffmpeg/<os>-<arch>/ elsewhere (see build-ffmpeg.sh).
const ffmpegArch = { arm64: "arm64", x64: "x86_64" }[arch];
const ffmpegName = { darwin: ffmpegArch, linux: `linux-${ffmpegArch}`, win32: `windows-${ffmpegArch}` }[process.platform];
const ffmpegScript = join(engineDir, "scripts", "build-ffmpeg.sh");
// On Windows the script runs in MSYS2's bash, a login shell that keeps this PATH (MSVC's tools).
const msysBash = process.env.MSYS2_BASH ?? "C:\\msys64\\usr\\bin\\bash.exe";
const ffmpeg =
  process.platform === "win32"
    ? spawnSync(msysBash, ["-lc", `scripts/build-ffmpeg.sh ${ffmpegArch}`], { cwd: engineDir, stdio: "inherit", env: { ...process.env, MSYSTEM: "MSYS", MSYS2_PATH_TYPE: "inherit", CHERE_INVOKING: "1" } })
    : spawnSync(ffmpegScript, [ffmpegArch], { cwd: engineDir, stdio: "inherit" });
if (ffmpeg.status !== 0) {
  if (ffmpeg.error) console.error(`[build-engine] ${ffmpeg.error.message}${process.platform === "win32" ? " (MSYS2's bash.exe: install MSYS2, or set MSYS2_BASH)" : ""}`);
  console.error("[build-engine] building FFmpeg failed");
  process.exit(ffmpeg.status ?? 1);
}

// Its own target dir: the static-FFmpeg feature would otherwise rebuild the shared one's
// FFmpeg-dependent crates each time the engine's dev tools are built without it.
const targetDir = join(engineDir, "target", "addon");
const hostArch = process.arch;
const crossTarget = arch !== hostArch ? rustTarget : null;
const cargoEnv = { ...process.env, FFMPEG_DIR: join(engineDir, ".ffmpeg", ffmpegName), CARGO_TARGET_DIR: targetDir };
if (process.platform !== "darwin") {
  // whisper.cpp (auto captions) for any CPU of this architecture, not just the build machine's.
  cargoEnv.GGML_NATIVE = "OFF";
}
if (process.platform === "win32") {
  // The static C runtime, as FFmpeg and zlib are built (-MT): Electron ships no VC++ runtime.
  cargoEnv.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = "-C target-feature=+crt-static";
}
const profileArgs = [...(profile === "release" ? ["--release"] : []), ...(crossTarget ? ["--target", crossTarget] : [])];

// Rust bundles a static library into the crate that links it when that crate is compiled, and
// nothing tells cargo the FFmpeg libraries changed: after FFmpeg is rebuilt (a new version, or
// encoders added) ffmpeg-sys-next is cleaned so the addon links the new libraries, not the copy
// cached with the old build.
const ffmpegStamp = readFileSync(join(engineDir, ".ffmpeg", ffmpegName, ".version"), "utf8").trim();
const linkedStamp = join(targetDir, `ffmpeg-${ffmpegName}-${profile}.version`);
if (existsSync(targetDir) && (!existsSync(linkedStamp) || readFileSync(linkedStamp, "utf8").trim() !== ffmpegStamp)) {
  console.log(`[build-engine] FFmpeg is now ${ffmpegStamp}: rebuilding its bindings`);
  spawnSync("cargo", ["clean", "-p", "ffmpeg-sys-next", ...profileArgs], { cwd: engineDir, stdio: "inherit", env: cargoEnv });
}

const cargoArgs = ["build", "-p", "openrip-node", "--features", "static-ffmpeg", ...profileArgs];
console.log(`[build-engine] cargo ${cargoArgs.join(" ")}`);
const built = spawnSync("cargo", cargoArgs, { cwd: engineDir, stdio: "inherit", env: cargoEnv });
if (built.status !== 0) {
  console.error("[build-engine] cargo build failed");
  process.exit(built.status ?? 1);
}
writeFileSync(linkedStamp, `${ffmpegStamp}\n`);

const libName = { darwin: "libopenrip_node.dylib", win32: "openrip_node.dll" }[process.platform] ?? "libopenrip_node.so";
const libPath = join(targetDir, ...(crossTarget ? [crossTarget] : []), profile, libName);
if (!existsSync(libPath)) {
  console.error(`[build-engine] built library not found at ${libPath}`);
  process.exit(1);
}
const dest = join(outDir, "openrip_node.node");
copyFileSync(libPath, dest);
// The loader needs the string table 8-byte aligned, which the linker doesn't always leave.
if (process.platform === "darwin" && alignLinkedit(dest)) console.log("[build-engine] aligned the string table");
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
// Linux: only libraries every desktop Linux has (glibc, the C++ runtime, zlib, ALSA, which
// Electron needs too): nothing a user would have to install.
if (process.platform === "linux") {
  const needed = execFileSync("readelf", ["-d", dest], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.match(/\(NEEDED\).*\[(.+)\]/)?.[1])
    .filter(Boolean);
  const system = /^(libc|libm|libdl|libpthread|librt|libgcc_s|libstdc\+\+|libz|libasound|ld-linux[\w-]*)\.so\.\d+$/;
  const unexpected = needed.filter((l) => !system.test(l));
  if (unexpected.length) {
    console.error(`[build-engine] the addon links libraries a user's Linux may not have:\n  ${unexpected.join("\n  ")}`);
    process.exit(1);
  }
  // Nothing left unresolved but napi's functions (Electron's): a shared object loads with a
  // symbol missing, which then crashes when called (as FFmpeg's zlib calls would have when
  // the linker dropped libz). `ldd -r` resolves them against the libraries it needs.
  const ldd = spawnSync("ldd", ["-r", dest], { encoding: "utf8" });
  const unresolved = `${ldd.stdout}\n${ldd.stderr}`
    .split("\n")
    .map((l) => l.match(/undefined symbol: (\S+)/)?.[1])
    .filter((s) => s && !s.startsWith("napi_"));
  if (unresolved.length) {
    console.error(`[build-engine] the addon leaves symbols unresolved: ${unresolved.slice(0, 20).join(", ")}`);
    process.exit(1);
  }
}
// Windows: no VC++ runtime DLLs (the C runtime is linked in statically), only Windows' own.
if (process.platform === "win32") {
  const dumpbin = spawnSync("dumpbin", ["/nologo", "/dependents", dest], { encoding: "utf8" });
  if (dumpbin.status !== 0) {
    console.warn("[build-engine] dumpbin not found (MSVC's x64 Native Tools prompt has it); the addon's DLLs weren't checked");
  } else {
    const dlls = dumpbin.stdout.split("\n").map((l) => l.trim()).filter((l) => /\.dll$/i.test(l));
    const runtime = dlls.filter((d) => /^(vcruntime|msvcp|api-ms-win-crt-|ucrtbase)/i.test(d));
    if (runtime.length) {
      console.error(`[build-engine] the addon needs the VC++ runtime, which a user's Windows may not have:\n  ${runtime.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`[build-engine] the addon loads ${dlls.join(", ")}`);
  }
}
console.log(`[build-engine] ${dest}`);
