// Tests for packages/main/src/modules/engineFiles.ts: `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withFilterTablesOnDisk } from "../../main/src/modules/engineFiles.ts";

const file = (p: string, text: string) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};

test("a filter's table inside the packaged app's app.asar reaches the engine as a copy on disk, in a compound too", () => {
  const root = mkdtempSync(join(tmpdir(), "engine-files-"));
  // Plain Node reads a folder named app.asar as Electron's fs reads the archive.
  const table = join(root, "Resources/app.asar/node_modules/@app/renderer/dist/filters/small/film_simulation/color/kodak/kodak_ektar_100.png");
  file(table, "hald");
  const filter = { clipId: "f", type: "filter", name: "Kodak Ektar 100", smallPath: table, fullPath: table, intensity: 100 };
  const video = { clipId: "v", type: "video", assetId: "a" };
  const doc = { timeline: { clips: [filter, { clipId: "c", type: "video", compound: { clips: [{ ...filter, clipId: "g" }] } }, video] } };
  const dir = join(root, "engine-filters");

  const [f, c, v] = withFilterTablesOnDisk(doc, dir).timeline.clips as any[];
  assert.ok(f.fullPath.startsWith(dir) && f.smallPath === f.fullPath, f.fullPath);
  assert.equal(readFileSync(f.fullPath, "utf8"), "hald");
  assert.equal(c.compound.clips[0].fullPath, f.fullPath);
  assert.equal(v, video);
  // The project keeps its own paths (Electron reads them).
  assert.equal(doc.timeline.clips[0].smallPath, table);
});

test("a filter's table on disk is left as it is", () => {
  const root = mkdtempSync(join(tmpdir(), "engine-files-"));
  const table = join(root, "renderer/public/filters/small/kodak_ektar_100.png");
  file(table, "hald");
  const doc = { timeline: { clips: [{ clipId: "f", type: "filter", smallPath: table, fullPath: table }] } };
  assert.equal(withFilterTablesOnDisk(doc, join(root, "engine-filters")).timeline.clips[0].fullPath, table);
});
