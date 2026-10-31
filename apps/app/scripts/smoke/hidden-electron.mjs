// The app the smoke harness runs, made so it can never come to the front on macOS: a copy of the
// app bundle (an APFS clone, so it costs no disk) marked as an agent app (LSUIElement). macOS
// doesn't activate an agent app when it launches, gives it no Dock icon and no menu bar, so a test
// run can't take the user's keyboard focus or put anything in front of their work. With the
// windows shown inactive and fully transparent (main/src/modules/background.ts), nothing of a run
// is seen at all. Elsewhere than macOS the binary is used as it is.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The hidden copy's binary for `binary` (inside an .app bundle), made once per bundle. */
export function hiddenApp(binary) {
  if (process.platform !== "darwin") return binary;
  const m = binary.match(/^(.*\.app)\/Contents\/MacOS\/([^/]+)$/);
  if (!m) return binary;
  const [, bundle, exe] = m;
  const plist = path.join(bundle, "Contents", "Info.plist");
  const stat = fs.statSync(plist);
  const key = crypto.createHash("sha1").update(`${bundle}:${stat.size}:${stat.mtimeMs}:${fs.statSync(binary).mtimeMs}`).digest("hex").slice(0, 12);
  const root = path.join(os.tmpdir(), "openrip-hidden-app", key);
  const copy = path.join(root, path.basename(bundle));
  const ready = path.join(root, "ready");
  if (!fs.existsSync(ready)) {
    // Made beside where it goes and moved in whole, so runs started together don't see half of it.
    const work = `${root}.${process.pid}`;
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const workCopy = path.join(work, path.basename(bundle));
    execFileSync("cp", ["-cR", bundle, workCopy]);
    execFileSync("plutil", ["-replace", "LSUIElement", "-bool", "YES", path.join(workCopy, "Contents", "Info.plist")]);
    // The changed Info.plist is part of the bundle's seal: sign it again (ad hoc).
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", workCopy], { stdio: "ignore" });
    fs.writeFileSync(path.join(work, "ready"), "");
    try {
      fs.renameSync(work, root);
    } catch {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  return path.join(copy, "Contents", "MacOS", exe);
}
