// Builds the Stickers tab's manifest from the openly licensed sets' own repositories, and
// fetches the small starter set the app ships.
//
//   node scripts/build-sticker-manifest.mjs [--cache <dir>] [--no-starter]
//
// Sources (each pinned to the commit it read, so the manifest's URLs stay valid):
//   - Microsoft Fluent Emoji (MIT): the 3D (PNG), Color and Flat (SVG) sets, default skin tone.
//     github.com/microsoft/fluentui-emoji, `assets/<name>/{metadata.json,3D,Color,Flat}`.
//   - Google Noto Emoji (Apache-2.0): the 2D set as 512 px PNGs, named by Fluent's metadata
//     (Noto has none) through the emoji's codepoints. github.com/googlefonts/noto-emoji.
//   - Animated Noto Emoji (CC BY 4.0): 512 px animated WebP from Google's font host, listed by
//     googlefonts.github.io/noto-emoji-animation/data/api.json.
//   - OpenMoji (CC BY-SA 4.0) is left out: its share-alike term would reach the videos people
//     make with it.
//
// Writes packages/renderer/public/stickers/manifest.json (committed) and the starter files in
// packages/renderer/public/stickers/starter/ (committed, ~100 files). Everything else is
// downloaded by the app on demand into <userData>/stickers/. The metadata it reads (about 1,600
// small files) is kept in --cache (default: a folder under the OS temp dir) between runs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "packages", "renderer", "public", "stickers");
const args = process.argv.slice(2);
const argOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const cacheDir = argOf("--cache") ?? path.join(os.tmpdir(), "openrip-sticker-sources");
fs.mkdirSync(cacheDir, { recursive: true });

/** `fetch`, tried again a few times (GitHub's API answers a 500 now and then). */
const fetchRetry = async (url, init) => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init).catch(() => null);
    if (res?.ok || attempt >= 5 || (res && res.status < 500 && res.status !== 429)) {
      if (!res) throw new Error(`${url}: no response`);
      return res;
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
};
const gh = async (url) => {
  const res = await fetchRetry(url, { headers: { "User-Agent": "openrip-manifest", Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};
const raw = async (url, cacheName) => {
  const file = cacheName && path.join(cacheDir, cacheName);
  if (file && fs.existsSync(file)) return fs.readFileSync(file);
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
  }
  return buf;
};
/** Run `fn` over `items`, `n` at a time. */
const pool = async (items, n, fn) => {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
};

/** An emoji's identity across the sets: its codepoints without variation selectors. */
const key = (cps) => cps.split(/[\s_-]+/).map((c) => c.toLowerCase()).filter((c) => c && c !== "fe0f").join("-");
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

// ---- sources -----------------------------------------------------------------------------
const fluentSha = (await gh("https://api.github.com/repos/microsoft/fluentui-emoji/commits/main")).sha;
const notoSha = (await gh("https://api.github.com/repos/googlefonts/noto-emoji/commits/main")).sha;
const fluentTree = (await gh(`https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/${fluentSha}?recursive=1`)).tree.map((t) => t.path);
const notoTree = new Set((await gh(`https://api.github.com/repos/googlefonts/noto-emoji/git/trees/${notoSha}?recursive=1`)).tree.map((t) => t.path));
const anim = JSON.parse((await raw("https://googlefonts.github.io/noto-emoji-animation/data/api.json", "noto-anim-api.json")).toString());
console.log(`fluentui-emoji ${fluentSha.slice(0, 8)}, noto-emoji ${notoSha.slice(0, 8)}, ${anim.icons.length} animated`);

const FLUENT_BASE = `https://raw.githubusercontent.com/microsoft/fluentui-emoji/${fluentSha}/assets/`;
const NOTO_BASE = `https://raw.githubusercontent.com/googlefonts/noto-emoji/${notoSha}/`;
const ANIM_BASE = "https://fonts.gstatic.com/s/e/notoemoji/latest/";

const sets = [
  {
    id: "fluent-3d", name: "Fluent Emoji 3D", style: "3D", format: "png", animated: false, base: FLUENT_BASE,
    license: "MIT", licenseUrl: "https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE",
    attribution: "Fluent Emoji © Microsoft Corporation, MIT licence.",
  },
  {
    id: "fluent-color", name: "Fluent Emoji Color", style: "Color", format: "svg", animated: false, base: FLUENT_BASE,
    license: "MIT", licenseUrl: "https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE",
    attribution: "Fluent Emoji © Microsoft Corporation, MIT licence.",
  },
  {
    id: "fluent-flat", name: "Fluent Emoji Flat", style: "Flat", format: "svg", animated: false, base: FLUENT_BASE,
    license: "MIT", licenseUrl: "https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE",
    attribution: "Fluent Emoji © Microsoft Corporation, MIT licence.",
  },
  {
    id: "noto", name: "Noto Emoji", style: "Noto", format: "png", animated: false, base: NOTO_BASE,
    license: "Apache-2.0", licenseUrl: "https://github.com/googlefonts/noto-emoji/blob/main/LICENSE",
    attribution: "Noto Emoji © Google LLC, Apache License 2.0.",
  },
  {
    id: "noto-animated", name: "Animated Noto Emoji", style: "Animated", format: "webp", animated: true, base: ANIM_BASE,
    license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Animated Noto Emoji © Google LLC, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); the animations are shown as published, unchanged.",
  },
];
const setIndex = Object.fromEntries(sets.map((s, i) => [s.id, i]));

// ---- Fluent: folders, files, metadata ---------------------------------------------------------
/** assets/<name> -> { 3D, Color, Flat } file paths (default skin tone) relative to assets/. */
const folders = new Map();
for (const p of fluentTree) {
  if (!p.startsWith("assets/")) continue;
  const rel = p.slice("assets/".length).split("/");
  const name = rel[0];
  const f = folders.get(name) ?? { name };
  folders.set(name, f);
  if (rel.length === 2 && rel[1] === "metadata.json") f.meta = true;
  // assets/<name>/<style>/<file>, or assets/<name>/Default/<style>/<file> for skin-toned emoji.
  const styled = rel.length === 3 ? [rel[1], rel[2]] : rel.length === 4 && rel[1] === "Default" ? [rel[2], rel[3]] : null;
  if (styled && ["3D", "Color", "Flat"].includes(styled[0]) && /\.(png|svg)$/.test(styled[1])) f[styled[0]] = rel.slice(0, -1).concat(styled[1]).join("/");
}
const emoji = [...folders.values()].filter((f) => f.meta && f["3D"]);
console.log(`${emoji.length} Fluent emoji; reading their metadata`);
await pool(emoji, 24, async (f) => {
  f.metadata = JSON.parse((await raw(`${FLUENT_BASE}${encodePath(f.name)}/metadata.json`, `fluent-meta/${slug(f.name)}.json`)).toString());
});

// ---- Categories ----------------------------------------------------------------------------
const GROUP = {
  "Smileys & Emotion": "Smileys", "People & Body": "People", "Animals & Nature": "Animals & nature", "Food & Drink": "Food & drink",
  "Travel & Places": "Travel", Activities: "Activities", Objects: "Objects", Symbols: "Symbols", Flags: "Flags", Component: "Symbols",
};
const THEMES = [
  ["Love", /\b(heart|hearts|love|kiss|kissing|cupid|rose|couple|wedding|ring|smiling face with hearts|hug|blush)\b/],
  ["Celebration", /\b(party|popper|confetti|balloon|birthday|cake|fireworks|sparkler|sparkles|trophy|medal|champagne|clinking|gift|ribbon|tada|crown|partying|piñata|pinata|carousel)\b/],
  ["Reactions", /\b(thumbs|clapping|ok hand|victory|folded hands|raised hands|waving|fire|100|eyes|crying|loudly|rolling on the floor|face with tears|sob|shrug|facepalm|muscle|flexed|pointing|handshake|fist|rofl|zany|face with|exploding|speak|see-no|hear-no|speak-no|screaming)\b/],
  ["Arrows", /\barrows?\b|\bcurved|\bleftwards?\b|\brightwards?\b|\bupwards?\b|\bdownwards?\b|\bcounterclockwise\b|\bclockwise\b|\bback arrow\b|\bsoon\b|\btop\b|\bon!\b/],
];

// ---- Items ---------------------------------------------------------------------------------
const categories = [];
const cat = (name) => {
  let i = categories.indexOf(name);
  if (i < 0) i = categories.push(name) - 1;
  return i;
};
["Trending", "Emoji", "Animated", "Love", "Celebration", "Reactions", "Arrows", "Smileys", "People", "Animals & nature", "Food & drink", "Travel", "Activities", "Objects", "Symbols", "Flags"].forEach(cat);

/** Words from tags like ":grin-sweat:". */
const tagWords = (t) => t.replace(/:/g, "").replace(/[-_]/g, " ").trim().toLowerCase();

const byKey = new Map();
const items = [];
const add = (item) => items.push(item);

// The animated set's popularity ranks the trending ones; the animated icons' tags enrich the keywords.
const animByKey = new Map(anim.icons.map((i) => [key(i.codepoint), i]));
const maxPop = Math.max(...anim.icons.map((i) => i.popularity));

for (const f of emoji) {
  const m = f.metadata;
  const k = key(m.unicode ?? "");
  const words = new Set([...(m.keywords ?? []), m.cldr ?? "", f.name].map((w) => String(w).toLowerCase()).filter(Boolean));
  const a = animByKey.get(k);
  for (const t of a?.tags ?? []) words.add(tagWords(t));
  const keywords = [...words].join(",");
  const themes = THEMES.filter(([, re]) => re.test(`${f.name.toLowerCase()} ${[...words].join(" ")}`)).map(([t]) => t);
  const group = GROUP[m.group] ?? "Symbols";
  const cats = [...new Set(["Emoji", group, ...themes])].map(cat);
  const rank = a ? a.popularity : 0;
  const entry = { k, name: f.name[0].toUpperCase() + f.name.slice(1), keywords, cats, rank, folder: f };
  byKey.set(k, entry);
  const id = slug(f.name);
  add({ id: `f3d-${id}`, set: "fluent-3d", ...entry, file: f["3D"] });
  if (f.Color) add({ id: `fcolor-${id}`, set: "fluent-color", ...entry, file: f.Color });
  if (f.Flat) add({ id: `fflat-${id}`, set: "fluent-flat", ...entry, file: f.Flat });
  // Noto's 2D picture of it, when the repo has one.
  const notoName = `emoji_u${k.replace(/-/g, "_")}.png`;
  const notoFile = `2D/png/512/${notoName}`;
  if (notoTree.has(notoFile)) add({ id: `noto-${k}`, set: "noto", ...entry, file: notoFile, thumb: `2D/png/128/${notoName}` });
  if (a) {
    const cp = a.codepoint;
    const animCats = [...new Set([...entry.cats, cat("Animated")])];
    add({ id: `anim-${k}`, set: "noto-animated", ...entry, cats: animCats, file: `${cp}/512.webp`, thumb: notoTree.has(`2D/png/128/${notoName}`) ? `@noto:2D/png/128/${notoName}` : undefined });
  }
}

// Trending: the most popular animated emoji and their 3D pictures.
const trendingKeys = new Set([...animByKey.entries()].sort((x, y) => y[1].popularity - x[1].popularity).slice(0, 60).map(([k]) => k));
for (const it of items) if (trendingKeys.has(it.k) && (it.set === "fluent-3d" || it.set === "noto-animated") && !it.cats.includes(cat("Trending"))) it.cats = [...it.cats, cat("Trending")];

// ---- The starter set: about a hundred popular stickers, shipped in the app -----------------------------
const STARTER_STILL = `grinning face|face with tears of joy|smiling face with hearts|smiling face with heart-eyes|star-struck|winking face|face blowing a kiss|smiling face with sunglasses|thinking face|face with rolling eyes|loudly crying face|face screaming in fear|partying face|exploding head|face with open mouth|sleeping face|nerd face|pleading face|smiling face with halo|zany face|red heart|orange heart|yellow heart|green heart|blue heart|purple heart|black heart|sparkling heart|beating heart|broken heart|heart on fire|thumbs up|thumbs down|clapping hands|waving hand|victory hand|ok hand|raised hands|folded hands|flexed biceps|handshake|backhand index pointing right|backhand index pointing up|eyes|fire|hundred points|sparkles|star|glowing star|collision|party popper|confetti ball|balloon|birthday cake|wrapped gift|trophy|1st place medal|crown|rocket|rainbow|sun|crescent moon|snowflake|high voltage|water wave|four leaf clover|rose|cherry blossom|sunflower|dog face|cat face|panda|unicorn|butterfly|pizza|hamburger|cupcake|ice cream|beer mug|clinking glasses|camera|musical note|microphone|musical notes|light bulb|money bag|gem stone|check mark button|cross mark|warning|right arrow|up arrow|curved right arrow|question mark|exclamation mark`.split("|");
const STARTER_ANIMATED = ["1f602", "2764-fe0f", "1f525", "1f973", "1f60d", "1f44d", "1f389", "1f4af"];
const starterIds = new Set();
const starterWanted = new Set(STARTER_STILL.map((n) => n.toLowerCase()));
for (const it of items) {
  if (it.set === "fluent-3d" && starterWanted.has(it.folder.name.toLowerCase())) {
    it.starter = 1;
    it.cats = [...new Set([...it.cats, cat("Trending")])];
    starterIds.add(it.id);
  }
  if (it.set === "noto-animated" && STARTER_ANIMATED.includes(it.k)) {
    it.starter = 1;
    starterIds.add(it.id);
  }
}
console.log(`${starterIds.size} starter stickers (wanted ${STARTER_STILL.length} still + ${STARTER_ANIMATED.length} animated)`);
const missing = STARTER_STILL.filter((n) => ![...items].some((it) => it.set === "fluent-3d" && it.folder.name.toLowerCase() === n.toLowerCase()));
if (missing.length) console.warn(`not in Fluent: ${missing.join(", ")}`);

// ---- Write -------------------------------------------------------------------------------------
// Each item: [id, name, keywords, categories (indices), set (index), file (under the set's base),
// thumbnail file (under the set's base; "@noto:..." under Noto's), trending rank, starter flag].
const rows = items.map((it) => [it.id, it.name, it.keywords, it.cats, setIndex[it.set], it.file, it.thumb ?? 0, it.rank, it.starter ?? 0]);
const manifest = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  sources: { "microsoft/fluentui-emoji": fluentSha, "googlefonts/noto-emoji": notoSha },
  sets,
  categories,
  items: rows,
};
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, "manifest.json"), JSON.stringify(manifest));
const counts = {};
for (const it of items) counts[it.set] = (counts[it.set] ?? 0) + 1;
console.log("items by set", counts, `manifest ${(fs.statSync(path.join(publicDir, "manifest.json")).size / 1024).toFixed(0)} KB`);

if (!args.includes("--no-starter")) {
  const dir = path.join(publicDir, "starter");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const base = (it) => sets[setIndex[it.set]].base;
  const starters = items.filter((it) => it.starter);
  let bytes = 0;
  await pool(starters, 8, async (it) => {
    const ext = it.file.split(".").pop();
    const buf = await raw(base(it) + encodePath(it.file));
    fs.writeFileSync(path.join(dir, `${it.id}.${ext}`), buf);
    bytes += buf.length;
    // An animated sticker's still shows in the tile until it's hovered.
    if (it.thumb) {
      const t = it.thumb.startsWith("@noto:") ? NOTO_BASE + it.thumb.slice(6) : base(it) + it.thumb;
      const tb = await raw(encodeURI(t));
      fs.writeFileSync(path.join(dir, `${it.id}.thumb.png`), tb);
      bytes += tb.length;
    }
  });
  console.log(`starter: ${starters.length} stickers, ${(bytes / 1048576).toFixed(2)} MB in ${path.relative(process.cwd(), dir)}`);
}
