// Cisco's OpenH264 downloads, installs and loads in the engine addon built for this machine
// (native/<platform>-<arch>/), as the app does the first time an export needs it: CI's check of
// the library loading on Windows (a DLL) and Linux (a .so), where Windows' own encoder or the
// renderer's colour would keep the engine's own tests from reaching it.
//   node scripts/smoke/openh264.mjs
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const engine = createRequire(import.meta.url)(join(appDir, "native", `${process.platform}-${process.arch}`, "openrip_node.node"));
engine.setCodecDir(mkdtempSync(join(tmpdir(), "openrip-codecs-")));
const info = engine.openh264Info();
if (!info.supported || !info.url) throw new Error(`no OpenH264 for this platform: ${JSON.stringify(info)}`);
const res = await fetch(info.url);
if (!res.ok) throw new Error(`${info.url}: ${res.status}`);
await engine.installOpenh264(Buffer.from(await res.arrayBuffer()));
const after = engine.openh264Info();
if (!after.installed || after.error) throw new Error(`OpenH264 didn't load: ${JSON.stringify(after)}`);
console.log(`OpenH264 ${after.version} downloaded from ${new URL(info.url).hostname}, checked and loaded`);
