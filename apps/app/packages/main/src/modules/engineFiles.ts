/**
 * Files the engine reads by path, where it can read them: the part of EngineModule that needs no
 * Electron (so the unit tests in packages/renderer/tests/engine-files.test.ts run it).
 *
 * A packaged app's own files are inside app.asar, which only Electron's fs reads. A filter clip
 * keeps the path of its look table there (the Filters tab lists the bundled ones), and the engine,
 * reading it with its own fs, gets "Not a directory" and draws the picture without the filter, in
 * the player and in an export. So the engine's copy of the project points at a copy of the table
 * made once in the user data folder, as `fontFile` does with the bundled fonts; the project keeps
 * its own paths.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const IN_ASAR = /\.asar[\\/]/;

/** `path`, or for one inside an asar archive its copy in `dir` (made the first time); itself if it can't be read. */
function onDisk(path: string, dir: string): string {
  const at = path.search(IN_ASAR);
  if (at < 0) return path;
  const file = join(dir, path.slice(at + ".asar/".length).replace(/[^\w.-]+/g, "_"));
  try {
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true });
      // Whole or not at all: a copy cut short would stay.
      writeFileSync(`${file}.tmp`, readFileSync(path));
      renameSync(`${file}.tmp`, file);
    }
    return file;
  } catch {
    return path;
  }
}

/** The project (as saved) with each filter clip's table, in compounds too, on disk (copied into `dir`). */
export function withFilterTablesOnDisk<T>(doc: T, dir: string): T {
  const mapped = (clips: any[]): any[] =>
    clips.map((c) => {
      let out = c;
      if (c?.type === "filter") {
        for (const key of ["fullPath", "smallPath"]) {
          if (typeof c[key] === "string" && IN_ASAR.test(c[key])) out = { ...out, [key]: onDisk(c[key], dir) };
        }
      }
      if (Array.isArray(c?.compound?.clips)) out = { ...out, compound: { ...c.compound, clips: mapped(c.compound.clips) } };
      return out;
    });
  const d = doc as any;
  return Array.isArray(d?.timeline?.clips) ? ({ ...d, timeline: { ...d.timeline, clips: mapped(d.timeline.clips) } } as T) : doc;
}
