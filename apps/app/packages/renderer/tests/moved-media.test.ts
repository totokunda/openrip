// Tests for packages/preload/src/media/moved.ts: `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findMovedMedia } from "../../preload/src/media/moved.ts";

const file = (p: string) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "");
};

test("a file moved to a drive under the same path, or under a folder on it, is found", async () => {
  const volumes = mkdtempSync(join(tmpdir(), "volumes-"));
  file(join(volumes, "Gina/Mac-Offload/Users/me/Downloads/IMG_9019.MOV"));
  file(join(volumes, "Backup/Users/me/Movies/b.mov"));
  symlinkSync("/", join(volumes, "Macintosh HD"));
  const found = await findMovedMedia(
    ["/Users/me/Downloads/IMG_9019.MOV", "/Users/me/Movies/b.mov", "/Users/me/gone.mov", `${volumes}/Gina/x.mov`],
    volumes,
  );
  assert.deepEqual(found, {
    "/Users/me/Downloads/IMG_9019.MOV": join(volumes, "Gina/Mac-Offload/Users/me/Downloads/IMG_9019.MOV"),
    "/Users/me/Movies/b.mov": join(volumes, "Backup/Users/me/Movies/b.mov"),
  });
});

test("no drives, nothing found", async () => {
  assert.deepEqual(await findMovedMedia(["/Users/me/a.mov"], join(tmpdir(), "no-such-volumes")), {});
});
