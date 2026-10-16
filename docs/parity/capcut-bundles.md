# CapCut effect bundles

CapCut downloads each effect, filter, text style, sticker and animation as a bundle under `~/Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Cache/effect/<id>/<hash>/`; a draft material's `path` points there. Bundles mix readable files (Lua, GLSL, JSON, PNG, `.vf` LUTs; see [adjust.md](adjust.md)) with binary files in AmazingEngine's **%SerializedFormat%**: scenes, prefabs, materials, shaders, render targets and texture settings.

OpenRip reads bundles for the parameters CapCut's rendering uses and reimplements the rendering; nothing from a bundle is copied into the repo.

## %SerializedFormat%

`bench/capcut/amg_decode.py <file>...` prints any of these files as JSON. It decodes 97% of the 10,475 such files in this machine's cache with no error; what remains is two rare value kinds. Worked out from the files themselves, checked against field names that make sense (sizes, colours, paths); nothing was disassembled.

**Names.** Every class, type and property is stored as the **djb2 hash** (`h = h * 33 + byte`, from 5381, 32-bit) of its name: `name` = `0x7c9b0c46`, `Material` = `0xcc4bb974`. The decoder hashes candidate words to name them: identifiers in CapCut's engine library (`libcccreator.dylib`, read at run time and cached in `~/Library/Caches/openrip/`) and in the bundle's own shaders and scripts.

**Layout.** All integers are little-endian.

- **Header:** `%SerializedFormat%@\n`, then header words up to offset 0x40, then the number of root objects. Each root object is its class hash, a byte size, and the object.
- **Values:** every value is `type hash, kind (u32), payload`. The kinds are:

| Kind | Payload |
|---|---|
| 0 string | u32 length, UTF-8 bytes |
| 1 / 3 int32 / int64 (enums use 1) | 4 / 8 bytes |
| 2 object | u32 property count, then per property: name hash, u32 byte size, value |
| 4 bool | 1 byte |
| 5 double | 8 bytes |
| 6 / 7 / 8 vec2 / vec3 / vec4 | float32 × 2 / 3 / 4 |
| 0xA mat4 | float32 × 16 |
| 0xB bitset | u32 word count, u32 words |
| 0xC rect, 0xD colour | float32 × 4 |
| 0x10 AABB | float32 × 6 |
| 0x12 / 0x15 / 0x16 / 0x17 / 0x18 / 0x1A arrays | u32 count, then i16 / u8 / u16 / u32 / float32 / vec2 items |
| 0x1F string array | u32 count, then strings (u32 length + bytes) |
| 0x20 object reference | u32 object id (0 = none). The object follows in place where it is first written; afterwards, or when it is kept elsewhere in the file, the id alone. |
| 0x21 file reference | u32 present flag, then class hash, u32, u32 length + path relative to the bundle, u32 |
| 0x22 array | u32 count, values |
| 0x23 map | u32 count, then per entry: u16 length + key bytes, value |
| 0x24 GUID | 16 bytes |

Because each object property carries its byte size, an unknown kind costs only that property.

## Text styles ("text_effect" materials)

There are two kinds of library text style:

- **Declarative.** An `effectStyle.json` holds a `fill`, `strokes` and `shadows`, in the same schema a draft's own text styles use, plus textures (PNG) for fills and strokes. ART EN PAPER-style looks are this kind.
- **SDF effect.** An `SDFText` component in `effect.prefab` holds an `effectTextParam` with a stack of `effectLayers`, which `xshader/effect.frag` draws over a signed-distance glyph atlas. Each layer has:
  - a `grad` (one to three `ColorChange` stops along an angle; each stop is the text colour shifted by an `hsbOffset`);
  - an outline `scale` (0 = the glyph itself);
  - an `offset` (a shadow or extrusion step);
  - `smoothing` (softness);
  - an optional texture overlay (`textureLevel`, `texture`) and an inner shadow.

  For example, "grey-white gradient + black outline" is six layers:
  1. the text colour;
  2. a vertical gradient from the text colour (at 33%) to it shifted −165° hue, −0.2 saturation, −0.44 brightness (at 66%), under a paper texture, with an inner shadow;
  3. three near-black outlines of 0.04 at offsets (0, 0), (0.02, −0.02) and (0.04, −0.04), forming a 3D extrusion;
  4. a soft shadow, 59% opaque, smoothing 0.19, at (0.03, −0.03).
