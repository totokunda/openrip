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

Each layer is drawn glyph by glyph in text order. A stroke covers everything within its width of the glyph, measured by a distance transform: stroking the outline instead leaves holes in the middle of round letters at wide widths. Its unit is the plain strokes' unit, reach = width × em (calibration session 3). Calibration also checked a style-only factor: 1.5, 2 and 3 times that unit all score worse.

Every layer of a declarative style fades out over 2.5 px beyond its shape. CapCut's text-style vertex shader pushes each mesh's outer fringe vertices 2.5 px out at zero alpha, which makes its styled letters look about a pixel bolder than plain ones. This added 0.3 dB on every styled frame of the export below. SDF effects are drawn by another shader and keep sharp edges (`TextEffect::sharp_edges`).

**Texture mapping.** This follows CapCut's text-style shader, whose GLSL source ships inside its engine library:
- `range` splits the texture into that many vertical strips; character i (counting every character) takes the square around the middle of strip i mod `range`;
- `stretchMode` fits, fills or stretches that square to the character's box, keeping aspect for fit and fill;
- `angle` turns it;
- the texture repeats beyond its edges.

Two things the shader alone doesn't fix were fitted against a CapCut export (a 1080×1920 export of a draft whose captions use the "ART EN PAPER" style):
- **`scale` magnifies the texture** (0.44 makes its pieces 1/0.44 times larger). The shader divides by its scale uniform, so CapCut evidently passes 1/`scale`.
- **The character's box is a square of 0.6 em centred on the glyph.** Neither the glyph's own box (narrow letters then get slivers of paper, where CapCut gives them full pieces) nor the glyph plus its stroke (pieces too large) matches.

Result on that export, at the frames with the styled captions: PSNR +1.9 to +3.1 dB (16.1–18.4 dB before, 19.0–20.3 dB after), and no frame worse. Text with a library style also wraps wider than plain text ([text-wrap.md](text-wrap.md)).

Still approximate:
- gradients are drawn with their first colour;
- a box blur of the shadow's body stands in for its `diffuse`.

Styled text is slow to draw, so the preview keeps it as per-character pieces and redraws only their opacity while a typing intro runs. On that draft's intro, playback p95 at 540p is 4.7 ms, against 20 ms when it was redrawn each frame.

### How OpenRip draws SDF-effect styles

The importer decodes `effect.prefab` with a Rust port of the format reader (`openrip_capcut::amg`) and finds the `SDFText` component's `effectLayers`. The first layer is drawn in front: in the measured style, layer 1's grey gradient sits entirely under layer 0's plain fill, and CapCut's export shows only the plain fill. So layer 0 becomes the fill and the rest, back to front, become shadows. Each layer is:
- the glyphs grown by its outline `scale`, at **1.5 em per unit**, with sharp edges (the growth is measured at 3× resolution, so the outline's edge is smooth rather than stepped);
- painted in the text's own colour, shifted by the layer's `hsbOffset`, with the stop colour's alpha. The default colour in the file is not used: a caption coloured white or yellow keeps that colour.

The units were fitted on a 1080×1920 CapCut export with 50 captions in the "grey-white gradient + black outline" style. At size 11 (em 68.8 px), the outline crosses mid-grey about 5.4 px from the fill in both CapCut and OpenRip. Left/right are 5.43/5.38 px in CapCut and 5.36/5.45 px in OpenRip; up is 5.74 px in both.

The same export shows that the other parameters move nothing visibly:
- **Offsets.** The layers' offsets (0.02 and 0.04 down-right) make no extrusion: left and right reach match within 0.1 px.
- **The soft shadow.** Compared with a frame from just before the caption, nothing changes past about 4 px from the letters, so there is no halo.

OpenRip therefore leaves offsets and smoothing out. A slight softness had shown as a dark fringe that CapCut doesn't have. Gradients beyond the first stop, texture overlays and inner shadows are left out; in the measured style they all sit under the fill.
