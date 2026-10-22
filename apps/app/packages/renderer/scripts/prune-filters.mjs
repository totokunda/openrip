import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The filter pack (public/filters, the clut-filters submodule) as Vite copies it to dist/: the
// app reads only its look tables in `filters/small` (the engine, and the Filters tab's tiles,
// which draw public/filter-photos through each table). The rest doesn't ship: `examples/` (a
// photo per filter that nothing shows), the pack's README, script and sample image, and `full/`
// (the large tables), which an internal build can keep with APEX_BUNDLE_FILTERS_FULL=1.
const bundleFull = process.env.APEX_BUNDLE_FILTERS_FULL === "1";

const distFilters = path.resolve(__dirname, "..", "dist", "filters");
if (!fs.existsSync(distFilters)) {
  process.stdout.write(`[renderer:postbuild] No dist/filters found at ${distFilters}\n`);
  process.exit(0);
}

const keep = bundleFull ? ["small", "full"] : ["small"];
for (const name of fs.readdirSync(distFilters)) {
  if (keep.includes(name)) continue;
  process.stdout.write(`[renderer:postbuild] Removing dist/filters/${name}\n`);
  fs.rmSync(path.join(distFilters, name), { recursive: true, force: true });
}
