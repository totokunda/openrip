// Pad a thin 64-bit Mach-O library so its string table starts on an 8-byte boundary.
//
// macOS's loader refuses a library whose __LINKEDIT string pool isn't 8-byte aligned ("mis-aligned
// LINKEDIT string pool"). The linker leaves it on 4 when the number of indirect symbols is odd,
// which depends on what the addon links (the speech recognizer's C++ made it odd). The string
// table is the last thing before the code signature, which starts on a 16-byte boundary and so
// leaves a few spare bytes after it: the table slides forward into them, and the library is
// signed again (ad hoc, as the linker did).
//
//   node scripts/align-linkedit.mjs <library>      (also exported as `alignLinkedit`)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MH_MAGIC_64 = 0xfeedfacf;
const LC_SEGMENT_64 = 0x19;
const LC_SYMTAB = 0x2;
const LC_CODE_SIGNATURE = 0x1d;

/** Returns true if the file was changed. */
export function alignLinkedit(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== MH_MAGIC_64) return false;
  const ncmds = buf.readUInt32LE(16);
  let linkedit = -1;
  let symtab = -1;
  let signature = -1;
  for (let i = 0, at = 32; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(at);
    if (cmd === LC_SEGMENT_64 && buf.toString("latin1", at + 8, at + 24).replace(/\0+$/, "") === "__LINKEDIT") linkedit = at;
    if (cmd === LC_SYMTAB) symtab = at;
    if (cmd === LC_CODE_SIGNATURE) signature = at;
    at += buf.readUInt32LE(at + 4);
  }
  if (linkedit < 0 || symtab < 0) return false;
  const stroff = buf.readUInt32LE(symtab + 16);
  const pad = (8 - (stroff % 8)) % 8;
  if (pad === 0) return false;
  // The table ends a few bytes short of the (16-aligned) signature: slide it forward into that gap.
  const strsize = buf.readUInt32LE(symtab + 20);
  const end = signature >= 0 ? buf.readUInt32LE(signature + 8) : buf.length;
  if (stroff + strsize + pad > end) throw new Error("no room to align the string table");
  const out = Buffer.from(buf);
  buf.copy(out, stroff + pad, stroff, stroff + strsize);
  out.fill(0, stroff, stroff + pad);
  out.writeUInt32LE(stroff + pad, symtab + 16);
  writeFileSync(file, out);
  if (process.platform === "darwin") execFileSync("codesign", ["--force", "--sign", "-", file], { stdio: "ignore" });
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(alignLinkedit(process.argv[2]) ? "padded" : "already aligned");
}
