import { promises as fsp, type Dirent } from "node:fs";
import { join } from "node:path";

/**
 * Where missing files went when a backup or offload tool moved them to another drive keeping
 * their path: `/Volumes/<drive>/<path>`, or `/Volumes/<drive>/<folder>/<path>` (Mac-Offload's
 * `/Volumes/Gina/Mac-Offload/Users/…`). Resolves the file found for each target (the absolute
 * path a library link pointed at) that was found.
 */
export async function findMovedMedia(targets: string[], volumes = "/Volumes"): Promise<Record<string, string>> {
  const list = (dir: string) => fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
  const roots: string[] = [];
  // The start-up disk is a link to / in there, not a folder, so it's left out.
  for (const v of await list(volumes)) {
    if (v.name.startsWith(".") || !v.isDirectory()) continue;
    const drive = join(volumes, v.name);
    roots.push(drive);
    for (const f of await list(drive)) if (!f.name.startsWith(".") && f.isDirectory()) roots.push(join(drive, f.name));
  }
  const found: Record<string, string> = {};
  await Promise.all(
    targets
      .filter((t) => t.startsWith("/") && !t.startsWith(`${volumes}/`))
      .map(async (t) => {
        for (const r of roots) {
          const p = join(r, t);
          if (await fsp.stat(p).then((s) => s.isFile(), () => false)) {
            found[t] = p;
            return;
          }
        }
      }),
  );
  return found;
}
