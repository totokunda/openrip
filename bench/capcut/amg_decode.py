"""Decode a CapCut effect-bundle file in AmazingEngine's binary "%SerializedFormat%" to JSON.

    python3 amg_decode.py <file>... [--names <words.txt>]...

Bundles keep their scene, prefab, material and texture settings in this format
(docs/parity/capcut-bundles.md). Every class, type and property is named by the djb2
hash of its name, so names are recovered by hashing candidate words: by default every
identifier in the installed CapCut's engine library plus the words in the file's own
bundle (shaders, Lua). Nothing CapCut owns is copied; the dictionary is built at run time.
Unresolved names print as "#<hash>".
"""
import argparse
import json
import re
import struct
import sys
from pathlib import Path

ENGINE_LIB = Path("/Applications/CapCut.app/Contents/Frameworks/libcccreator.dylib")
WORDS_CACHE = Path.home() / "Library" / "Caches" / "openrip" / "amg-engine-words.txt"
MAGIC = b"%SerializedFormat%@\n"

# Value kinds: the u32 after each value's type hash.
STRING, INT32, OBJECT, INT64, BOOL, DOUBLE = 0, 1, 2, 3, 4, 5
FIXED = {INT32: ("i", 4), INT64: ("q", 8), BOOL: ("?", 1), DOUBLE: ("d", 8),
         6: ("2f", 8), 7: ("3f", 12), 8: ("4f", 16), 0xA: ("16f", 64), 0xC: ("4f", 16), 0xD: ("4f", 16),
         0x10: ("6f", 24)}  # vec2/3/4, mat4, rect, colour, AABB
ARRAYS = {0x12: ("h", 2), 0x16: ("H", 2), 0x17: ("I", 4), 0x18: ("f", 4), 0x1A: ("2f", 8)}  # i16/u16/u32/float/vec2 vectors
BITSET, UINT8_VECTOR, STRING_VECTOR = 0xB, 0x15, 0x1F
LOCAL_REF, EXTERNAL_REF, VECTOR, MAP, GUID = 0x20, 0x21, 0x22, 0x23, 0x24


def djb2(s: str) -> int:
    h = 5381
    for c in s.encode():
        h = (h * 33 + c) & 0xFFFFFFFF
    return h


class Names(dict):
    def add_words(self, text: str):
        for w in re.findall(r"[A-Za-z_][A-Za-z0-9_:]{0,80}", text):
            for v in (w, w.rsplit("::", 1)[-1]):
                self.setdefault(djb2(v), v)

    def __call__(self, h: int) -> str:
        return self.get(h, f"#{h:08x}")


def engine_words() -> str:
    """Identifiers in CapCut's engine library, cached until the library changes."""
    stamp = f"{ENGINE_LIB.stat().st_mtime_ns}\n"
    try:
        cached = WORDS_CACHE.read_text()
        if cached.startswith(stamp):
            return cached
    except OSError:
        pass
    found = sorted({m.decode() for m in re.findall(rb"[A-Za-z_][A-Za-z0-9_:]{1,80}", ENGINE_LIB.read_bytes())})
    text = stamp + "\n".join(found)
    WORDS_CACHE.parent.mkdir(parents=True, exist_ok=True)
    WORDS_CACHE.write_text(text)
    return text


class Reader:
    def __init__(self, b: bytes, o: int, end: int, names: Names, seen=None):
        self.b, self.o, self.end, self.names = b, o, end, names
        self.seen = {1} if seen is None else seen  # object ids already written; 1 is the root

    def u32(self) -> int:
        v = struct.unpack_from("<I", self.b, self.o)[0]
        self.o += 4
        return v

    def take(self, n: int) -> bytes:
        v = self.b[self.o:self.o + n]
        self.o += n
        return v

    def value(self):
        th, kind = self.u32(), self.u32()
        t = self.names(th)
        if kind in FIXED:
            fmt, n = FIXED[kind]
            v = struct.unpack("<" + fmt, self.take(n))
            v = v[0] if len(v) == 1 else [round(x, 6) for x in v]
            return v if kind in (BOOL, DOUBLE) else {"@" + t: v}
        if kind == STRING:
            return self.take(self.u32()).decode("utf-8", "replace")
        if kind == GUID:
            return {"@guid": self.take(16).hex()}
        if kind == OBJECT:
            obj = {"@class": t}
            for _ in range(self.u32()):
                key, size = self.u32(), self.u32()
                end = self.o + size
                try:
                    obj[self.names(key)] = Reader(self.b, self.o, end, self.names, self.seen).value()
                except (ValueError, struct.error) as e:
                    obj[self.names(key)] = {"@raw": self.b[self.o:end].hex(), "@error": str(e)}
                self.o = end
            return obj
        if kind == LOCAL_REF:
            # An object id, followed by the object where it is first written in place. Objects
            # kept elsewhere in the file (or already written) are referenced by id alone.
            oid = self.u32()
            if oid == 0:
                return None
            inline = oid not in self.seen and self.end - self.o >= 8 and struct.unpack_from("<I", self.b, self.o + 4)[0] <= GUID
            if not inline:
                return {"@object": oid}
            self.seen.add(oid)
            return {"@id": oid} | self.value()
        if kind == EXTERNAL_REF:
            if not self.u32():
                return None
            cls = self.u32()
            self.u32()
            path = self.take(self.u32()).decode("utf-8", "replace")
            self.u32()
            return {"@ref": self.names(cls), "path": path}
        if kind == VECTOR:
            out = []
            for _ in range(self.u32()):
                if self.o >= self.end:
                    break
                out.append(self.value())
            return out
        if kind == MAP:  # keys are strings with a u16 length
            out = {}
            for _ in range(self.u32()):
                key = self.take(struct.unpack("<H", self.take(2))[0]).decode("utf-8", "replace")
                out[key] = self.value()
            return out
        if kind == STRING_VECTOR:
            return [self.take(self.u32()).decode("utf-8", "replace") for _ in range(self.u32())]
        if kind in ARRAYS:
            fmt, n = ARRAYS[kind]
            count = self.u32()
            v = struct.unpack(f"<{count * int(fmt[:-1] or 1)}{fmt[-1]}", self.take(count * n))
            return {"@" + t: list(v) if count <= 64 else f"{count} items"}
        if kind == UINT8_VECTOR:
            return {"@bytes": self.take(self.u32()).hex()}
        if kind == BITSET:
            return {"@bits": [self.u32() for _ in range(self.u32())]}
        raise ValueError(f"unknown kind {kind:#x} (type {t}) at {self.o - 8:#x}")


def decode(path: Path, names: Names):
    b = path.read_bytes()
    if not b.startswith(MAGIC):
        return {"@error": "not a %SerializedFormat% file"}
    o = 0x40
    count = struct.unpack_from("<I", b, o)[0]
    o += 4
    out = []
    for _ in range(count):
        cls, size = struct.unpack_from("<II", b, o)
        o += 8
        end = o + size
        r = Reader(b, o, end, names)
        # The root object starts at its class hash followed by the object kind.
        while r.o < end - 8 and struct.unpack_from("<II", b, r.o) != (cls, OBJECT):
            r.o += 4
        out.append(r.value())
        o = end
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", type=Path, nargs="+")
    ap.add_argument("--names", type=Path, action="append", default=[], help="extra word list")
    a = ap.parse_args()
    names = Names()
    for w in ("String", "Guid", "Map", "Vector", "Int64", "Int32", "Double", "Bool", "Color",
              "Vector2f", "Vector3f", "Vector4f", "Rect", "Quaternionf"):
        names.add_words(w)
    if ENGINE_LIB.exists():
        names.add_words(engine_words())
    for f in a.names:
        names.add_words(f.read_text(errors="ignore"))
    bundles = set()
    for file in a.files:
        bundle = file.resolve().parent
        while bundle.parent != bundle and not (bundle / "config.json").exists():
            bundle = bundle.parent
        if bundle not in bundles:
            bundles.add(bundle)
            for f in bundle.rglob("*"):
                if f.suffix in (".frag", ".vert", ".lua", ".glsl", ".json"):
                    names.add_words(f.read_text(errors="ignore"))
        if len(a.files) > 1:
            print(f"== {file}")
        try:
            out = decode(file, names)
        except (ValueError, struct.error) as e:
            out = {"@error": str(e)}
        json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
        print()


if __name__ == "__main__":
    main()
