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

A text style is a `text_effect` material attached to the text clip. There are two kinds:

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

### How OpenRip draws declarative styles

The importer reads `effectStyle.json` into the project (`Effect::text_style`). Texture paths point into CapCut's bundle and are loaded at run time. The renderer (`render::text::TextLayout::prepare_effect`) draws:
- the shadows, in order; each one's strokes go under its own body;
- the strokes, last first;
- the fill.

Each layer is drawn glyph by glyph in text order. A stroke covers the glyph grown by its width; its unit is the same provisional unit as plain strokes until calibration session 3.

**Texture mapping.** This follows CapCut's text-style shader, whose GLSL source ships inside its engine library:
- `range` splits the texture into that many vertical strips; character i (counting every character) takes the square around the middle of strip i mod `range`;
- `stretchMode` fits, fills or stretches that square to the character's box, keeping aspect for fit and fill;
- `angle` turns it;
- the texture repeats beyond its edges.

Two things the shader alone doesn't fix were fitted against a CapCut export (a 1080×1920 export of a draft whose captions use the "ART EN PAPER" style):
- **`scale` magnifies the texture** (0.44 makes its pieces 1/0.44 times larger). The shader divides by its scale uniform, so CapCut evidently passes 1/`scale`.
- **The character's box is a square of 0.6 em centred on the glyph.** Neither the glyph's own box (narrow letters then get slivers of paper, where CapCut gives them full pieces) nor the glyph plus its stroke (pieces too large) matches.

Result on that export, at the frames with the styled captions: PSNR +1.5 to +2.8 dB (16.1–18.4 dB before, 18.9–20.0 dB after), and no frame worse. Text with a library style also wraps wider than plain text ([text-wrap.md](text-wrap.md)).

Still approximate:
- gradients are drawn with their first colour;
- the shadow `diffuse` is a box blur of the shadow's body;
- stroke widths use the provisional unit;
- SDF-effect styles (the other kind) aren't drawn yet.

Styled text is slow to draw, so the preview keeps it as per-character pieces and redraws only their opacity while a typing intro runs. On that draft's intro, playback p95 at 540p is 4.7 ms, against 20 ms when it was redrawn each frame.
