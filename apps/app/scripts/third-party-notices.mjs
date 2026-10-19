// The open-source notices the app shows (home ▸ gear ▸ Third-party copyright, the menu bar's
// More ▸ Third-party Copyright), made from OpenRip's own lockfiles when the app is built:
// - npm: every package in apps/app/package-lock.json that ships (not dev-only), with its
//   licence from the lockfile and its licence files from node_modules;
// - Cargo: every crate the engine's addon (openrip-node) depends on for this platform
//   (`cargo metadata`, normal and build dependencies), with its licence files from Cargo's
//   registry. OpenRip's own crates and workspaces are left out.
// - Bundled sources: code copied into the engine rather than depended on (the gl-transitions
//   shaders, engine/crates/render/src/glt), with the licence texts kept beside it.
// Each distinct licence text is kept once, with the packages it covers.
//
//   node scripts/third-party-notices.mjs [out.json]   (default: packages/main/dist/third-party-notices.json)
//
// Without cargo (or its registry) the crates are listed from engine/Cargo.lock without texts.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");
const engineDir = path.join(appDir, "..", "..", "engine");
const out = path.resolve(process.argv[2] ?? path.join(appDir, "packages", "main", "dist", "third-party-notices.json"));

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i;
const MAX_TEXT = 40_000;

/** The licence files in a package's folder, joined (largest first is not needed: name order). */
function licenseText(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => LICENSE_FILE.test(n)).sort();
  } catch {
    return "";
  }
  const texts = [];
  for (const n of names) {
    try {
      const p = path.join(dir, n);
      if (!fs.statSync(p).isFile()) continue;
      texts.push(fs.readFileSync(p, "utf8").slice(0, MAX_TEXT).trim());
    } catch {
      // unreadable: skip
    }
  }
  return texts.filter(Boolean).join("\n\n");
}

const packages = [];

// ---- npm ----
const lock = JSON.parse(fs.readFileSync(path.join(appDir, "package-lock.json"), "utf8"));
for (const [key, entry] of Object.entries(lock.packages ?? {})) {
  if (!key.includes("node_modules/") || entry.dev || entry.devOptional || entry.link) continue;
  const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
  if (name.startsWith("@app/")) continue;
  const dir = path.join(appDir, key);
  if (!fs.existsSync(dir)) continue; // an optional package for another platform
  let license = entry.license;
  if (!license) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      license = typeof pj.license === "string" ? pj.license : pj.license?.type;
    } catch {
      // no package.json
    }
  }
  packages.push({ name, version: entry.version ?? "", source: "npm", license: license || "UNKNOWN", text: licenseText(dir) });
}

// ---- Cargo ----
let crates = 0;
try {
  const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
  const args = ["metadata", "--format-version", "1", "--locked", "--offline", "--manifest-path", path.join(engineDir, "Cargo.toml")];
  if (host) args.push("--filter-platform", host);
  const meta = JSON.parse(execFileSync("cargo", args, { encoding: "utf8", maxBuffer: 256 << 20 }));
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const root = meta.packages.find((p) => p.name === "openrip-node");
  const seen = new Set();
  const queue = root ? [root.id] : [];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of nodes.get(id)?.deps ?? []) {
      if ((d.dep_kinds ?? []).some((k) => k.kind !== "dev")) queue.push(d.pkg);
    }
  }
  for (const id of seen) {
    const p = byId.get(id);
    if (!p || !p.source) continue; // OpenRip's own crates
    packages.push({ name: p.name, version: p.version, source: "cargo", license: p.license || (p.license_file ? "see licence file" : "UNKNOWN"), text: licenseText(path.dirname(p.manifest_path)) });
    crates++;
  }
} catch (e) {
  console.warn(`[third-party-notices] cargo metadata failed (${String(e.message ?? e).split("\n")[0]}); listing engine/Cargo.lock without texts`);
  try {
    const lockText = fs.readFileSync(path.join(engineDir, "Cargo.lock"), "utf8");
    for (const block of lockText.split("[[package]]").slice(1)) {
      const name = /name = "([^"]+)"/.exec(block)?.[1];
      const version = /version = "([^"]+)"/.exec(block)?.[1];
      if (!name || !/source = /.test(block)) continue;
      packages.push({ name, version: version ?? "", source: "cargo", license: "see the crate", text: "" });
      crates++;
    }
  } catch {
    // no Cargo.lock
  }
}

// ---- Stickers (the Stickers tab's sets: the starter ones ship, the rest download on demand) ----
// Each set's licence and attribution come from the manifest scripts/build-sticker-manifest.mjs
// wrote; the licence texts are kept in scripts/sticker-licenses/.
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, "packages", "renderer", "public", "stickers", "manifest.json"), "utf8"));
  const TEXTS = { MIT: "fluentui-emoji-MIT.txt", "Apache-2.0": "noto-emoji-Apache-2.0.txt", "CC-BY-4.0": "noto-animated-CC-BY-4.0.txt" };
  for (const set of manifest.sets) {
    const file = TEXTS[set.license];
    const text = file ? fs.readFileSync(path.join(here, "sticker-licenses", file), "utf8").trim() : "";
    packages.push({ name: `${set.name} (stickers)`, version: manifest.generated, source: "assets", license: set.license, text: `${set.attribution}\n${set.licenseUrl}\n\n${text}` });
  }
} catch (e) {
  console.warn(`[third-party-notices] sticker manifest not read (${String(e.message ?? e).split("\n")[0]})`);
}

// ---- Bundled sources ----
// The shader transitions are the gl-transitions collection (MIT, two BSD): their notices are in
// the folder with the shaders.
try {
  const glt = path.join(engineDir, "crates", "render", "src", "glt");
  const text = fs.readFileSync(path.join(glt, "LICENSES.txt"), "utf8");
  packages.push({ name: "gl-transitions (shader transitions)", version: "1.76", source: "bundled", license: "MIT / BSD-2-Clause / BSD-3-Clause", text });
} catch {
  console.warn("[third-party-notices] the gl-transitions licences (engine/crates/render/src/glt/LICENSES.txt) weren't found");
}

// ---- Group by text ----
const norm = (s) => s.replace(/\s+/g, " ").trim();
const groups = new Map();
for (const p of packages) {
  const key = p.text ? `t:${norm(p.text)}` : `l:${p.license}`;
  const g = groups.get(key) ?? { ids: new Set(), text: p.text, packages: [] };
  g.ids.add(p.license);
  g.packages.push({ name: p.name, version: p.version, source: p.source });
  groups.set(key, g);
}
const licenses = [...groups.values()]
  .map((g) => ({ id: [...g.ids].sort().join(" / "), text: g.text, packages: g.packages.sort((a, b) => a.name.localeCompare(b.name)) }))
  .sort((a, b) => a.id.localeCompare(b.id) || a.packages[0].name.localeCompare(b.packages[0].name));

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), licenses }));
const npm = packages.filter((p) => p.source === "npm").length;
console.log(`[third-party-notices] ${npm} npm packages, ${crates} crates, ${licenses.length} licence texts → ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
