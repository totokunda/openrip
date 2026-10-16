// Build the Rust engine's Node addon and copy it to native/<platform>-<arch>/openrip_node.node,
// where the main process loads it in development and electron-builder picks it up for
// packaging (see electron-builder.cjs).
//
//   node scripts/build-engine.mjs [--arch arm64|x64] [--debug]
//
// Without a Rust toolchain this warns and exits 0: the app then runs on its own preview.
import { spawnSync } from "node:child_process";
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

// Build for the host's own target without --target, so the shared target dir stays warm
// for the engine's other crates.
const hostArch = process.arch;
const crossTarget = arch !== hostArch ? rustTarget : null;
const cargoArgs = ["build", "-p", "openrip-node"];
if (profile === "release") cargoArgs.push("--release");
if (crossTarget) cargoArgs.push("--target", crossTarget);
console.log(`[build-engine] cargo ${cargoArgs.join(" ")}`);
const built = spawnSync("cargo", cargoArgs, { cwd: engineDir, stdio: "inherit" });
if (built.status !== 0) {
  console.error("[build-engine] cargo build failed");
  process.exit(built.status ?? 1);
}

const libName = process.platform === "darwin" ? "libopenrip_node.dylib" : "libopenrip_node.so";
const libPath = join(engineDir, "target", ...(crossTarget ? [crossTarget] : []), profile, libName);
if (!existsSync(libPath)) {
  console.error(`[build-engine] built library not found at ${libPath}`);
  process.exit(1);
}
const dest = join(outDir, "openrip_node.node");
copyFileSync(libPath, dest);
console.log(`[build-engine] ${dest}`);
