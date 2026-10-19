# Video masks

CapCut's Mask panel cuts a clip down to a shape: rectangle, circle, linear, mirror, heart, star and others, each with a feather, rounded corners (rectangle) and an invert switch. The mask belongs to the clip's own picture, so it moves, turns and scales with the clip.

## In the draft

- `materials.common_mask[]`, referenced from the segment's `extra_material_refs`.
- `resource_type` names the shape (`rectangle` in both local uses), `resource_id` and `path` the bundle (`effect/1068046516/<hash>` for the rectangle).
- `config`:
  - `centerX`, `centerY`: the shape's centre in half-widths and half-heights of the picture from its middle, **+y up** (a positive `centerY` sits above the middle in the draft covers);
  - `width`, `height`: the shape's size as fractions of the picture's width and height (`0.5 × 0.28` on a 9:16 picture is a square; `aspectRatio` is 1 there);
  - `rotation` (degrees), `feather`, `roundCorner`, `invert`, `expansion` (unused by the rectangle).

## How CapCut draws the rectangle

The bundle (`lumi_rectangle_mask`) is GLSL, readable in CapCut's cache. Over the picture, in units of its half-height:

- a pixel's offset from the centre is `((u − ½)·2 − cx)·aspect, (v − ½)·2 − cy` with `v` running up, turned by `360° + rotation`, then folded into one quadrant;
- its gauge is how far out it is relative to the edge along the same ray: `y / height` above the corner's diagonal, `x / (aspect·width)` beside it, and in a rounded corner the scale at which the ray meets the corner's circle (radius `roundCorner` × the shorter half-side);
- coverage is `1 − smoothstep(1 − d − 6·feather, 1 + d + 6·feather, gauge)`, swapped when inverted, where `d = 0.005·decay` and decay grows from 0 at 0° to 1 at 45°. At 0° with no feather it's a hard step at pixel centres.

The result multiplies the clip before it's placed.

## The app's own masks

OpenRip's mask tool (from Apex Studio, where masks fed AI models) draws rectangles, ellipses, triangles, five-pointed stars and lassos on a video or image clip (`components/preview/mask`):

- Each mask keeps keyframes by source frame, each a shape (`shapeBounds`), a lasso (`lassoPoints`) or brush strokes (`brushStrokes`), with an optional easing (`ease`, as the clip keyframes'). Before the first keyframe the first applies.
- Positions are world units from the clip's top-left, at the scale the clip had when the mask was drawn (the mask's `transform`). A rectangle turns about its top-left corner, the other shapes about their centre; the triangle's centroid sits at its box's centre; the star's inner points are at half its radii, stretched to the box.
- Inside shows the mask colour (white by default) or the clip, outside the background colour (black by default) or the clip. Only the first mask paints outside itself. The app's own preview draws hard edges, tested at pixel centres, and ignores the feather and invert it stores; the engine applies both (below).
- A colour comes out of its WebGL canvas as the colour times its opacity at the opacity squared, since the blend applies to alpha too.
- While the mask tool is out, the preview shows clips unmasked.

## OpenRip

`Mask` materials (`openrip-model`) carry the shape, centre (in half-sizes from the picture's middle, +y up), size, rotation, feather, invert, what each side shows (the clip, or a colour, clear for a cut-out) and any keys over time. A CapCut mask's keyframes are the segment's (`KFTypeCommonMask…`, [keyframes.md](keyframes.md)): its centre, size, rotation, feather and rounded corners travel by CapCut's curve. The preview draws each attached mask's coverage over the upright picture (at the picture's size, up to 2048 pixels on its long side), turns it into the stored picture's axes and hands it to the compositor, which paints the clip's pixels inside and outside by it before placing the clip (a background-removal matte is the first such pass). Photos take masks too.

CapCut's rectangle, circle, linear, mirror, heart and star masks are drawn. The pen (`contour`) is imported but not drawn: its one local use has an empty path. In the app's engine mode the mask tool's lasso sends the project without masks, so the clip shows whole while an outline is drawn; with the brush or the pen out the masks are drawn.

### Heart and star (2026-10-18)

The heart's bundle (`effect/1068046512`, `lumi_heart_mask`) draws its shape from a picture, not from the SVG outline beside it (`material.svg`, a star icon):

- **The picture.** `amazingfeature/image/mask.png` is 1024² and holds a distance field. Its shader reads it as `(r·4·256 + g·255)/701`. The outline is at 0.5, and the field rises about 0.004 a texel inward, up to 1.
- **Where it goes.** The vertex shader works in units of the picture's half-height, from the mask's centre (y down). It turns the offset by 360° − rotation and divides by the box size times 1.7 (`boundaryScale`).
  - So the picture spans 1.7 times the box.
  - The heart inside it measures 603 × 541 texels: 1.001 of the box's width and 0.898 of its height.
- **The edge.** It's `smoothstep(0.49 − d, 0.51 + d)`, with d half the feather, and invert swaps the sides.

The star's bundle (`pentagram`) isn't on this machine. If it's the same kind (a picture and a shader that decodes it), it's drawn the same way: the importer accepts any mask bundle whose shader decodes such a field (`MaskShape::Picture`, pointing at the picture). The preview reads the picture once, at run time from CapCut's cache (nothing is copied into the repo), and samples it bilinearly.

**Checks.** Only the heart's bundle is on this machine, and no local draft uses a heart or a star, so there's no cover or export to compare with. A unit test draws the heart from the bundle when it's there. In a 0.5 × 0.5 box on a square picture, it spans the box's width and 0.9 of its height, centred. It's upright, its lobes at the top and its point at the bottom, and a 90° turn puts the point on the left. Another test draws a synthetic disc field, which comes out as the circle in the box.

### The app's feather, invert, keys and brush (2026-10-18)

- **Feather.** The app's feather (`featherAmount`, 0–100 as CapCut's slider) is CapCut's feather × 100. It softens the edge in the mask's own units, as CapCut's shapes do:
  - the rectangle uses CapCut's rectangle;
  - the ellipse softens around 1 on (x/a)² + (y/b)² by 15 × the feather, as CapCut's circle does;
  - the triangle and star use the rectangle's band (6 × the feather) on a pixel's gauge, its distance from the centre over the outline's along the same ray;
  - a lasso softens across its outline, by 6 × the feather of half its shorter side.
  A feather of 0 is the hard edge as before. New masks start at 0; masks saved earlier carry the old default of 2, a light softening.
- **Invert** swaps inside and out.
- **Keys** of the same shape (or lassos with the same number of points) travel from one pose to the next by the first key's easing: linear by default, or CapCut's curve for the presets and custom handles. Poses of different shapes hold until the next key.
- **The brush.** The app's brush (the Mask tab's Brush, since 2026-10-18) saves its strokes on the selected brush mask or a new one, ⌥ or the tab's Eraser erasing. The data model takes them (`brushStrokes`: points and a width in world units, and whether a stroke erases). The engine draws them as round-ended strokes, unioned in order, with an eraser clearing what's under it, and softened by the feather (6 × the feather of the stroke's half-width).

### CapCut's shapes on the app's clips (2026-10-18)

The inspector's Mask tab offers CapCut's shapes on the app's own clips, and the importer (`v1/src/lib.rs`, `convert_masks`) draws them through the same shapes as a draft's:

- **Split** (`shapeType: "linear"`) is CapCut's linear mask and **Filmstrip** (`"mirror"`) its mirror, about the box's centre, turned by its rotation; Filmstrip's band is the box's height.
- **Heart** is a polygon of the classic heart curve (x = 16 sin³t, y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t, 64 points) across the box's width and 0.9 of its height, as CapCut's heart fills its box; the app draws the same outline on the canvas (lib/mask-shapes.ts). CapCut's own heart (a distance field in its bundle) isn't needed, and keys of the same heart travel point by point.
- **Round corners**: a rectangle's `cornerRadius` (0–100) is CapCut's `roundCorner` (of the shorter half-side); it travels between keys.
- **A keyed feather**: a pose's own `featherAmount` keys the feather with the place (`MaskKey.feather` in the model; the playback mixes it between poses like the rest, a pose without one taking the mask's).

Checked by the v1 crate's test `the_inspectors_mask_shapes_and_keyed_feather` (centres, a heart spanning its box, round corners and feathers per key), the playback test `a_keyed_feather_travels`, and in the app by `insp-suite.mjs`: every shape, feather, round corners, invert and a keyed pose change the engine's frame.

### Text, Pen, Brush, expansion and a draft's masks in the app (2026-10-18)

The Mask tab now works as CapCut 9.5's (18-inspector-video 013–017): the section's checkbox, "Add mask" (a rectangle centred on the picture), chips with "+", and tiles that shape the selected mask (Split, Filmstrip, Circle, Rectangle, Stars, Heart, Text, Brush, Pen; there's no None tile, a mask is deleted from its chip). The canvas has CapCut's handles (components/preview/clips/MaskHandles.tsx): the dashed box with a dot at each corner, the feather knob above it (drag up), the rotate knob below, a rectangle's round-corner dot inside its top-left corner, Split's line and Filmstrip's two lines, a pen path's anchors and curve handles.

- **Text** (`shapeType: "text"`, `text: {content, font, size, bold, italic, underline, letterSpacing, lineSpacing, align}` on each pose): the engine lays the words out with the text renderer (the system font by name, else the app's default; an underline at the font's own position), fills the glyphs as the mask's coverage about the box's centre, turned with it; the feather blurs the coverage. New text masks read CapCut's "Default text" at a sixteenth of the picture's height, about as wide as CapCut's on a 9:16 picture. A corner handle scales the font.
- **Pen** (`tool: "pen"`, `penPath: {points: [{x, y, ix, iy, ox, oy}], closed}`): a closed path of cubic beziers through its anchors, each with the handles it arrives and leaves by. The engine draws the curve as a polygon (16 points a span); with a feather, a polygon's soft edge is measured every few pixels (up to 4) and filled in between, within a few levels of measuring every pixel and fast enough to drag. Clicks add anchors, a drag pulls out a curve handle (the other mirrors it), and a click on the first anchor or Enter closes it. The Pen tile first makes the mask an empty pen mask, which the engine skips, so the clip shows whole until the path closes, as in CapCut's 017. Poses with as many anchors travel anchor by anchor.
- **Brush**: the Brush tile makes the mask an empty brush mask (the clip whole, as in 016) and strokes go on it; the eraser clears under its strokes; Clear empties it.
- **Expansion** (`expansion`, −100…100 as CapCut's slider, per pose when keyed, on the brush and the pen): grows or shrinks the coverage by up to a tenth of the picture's height before the feather (`MaskKey.expansion`; a polygon's outline moves out along its normals, brush strokes widen). CapCut's draft field is `config.expansion`; the importer reads it on the same scale. The scale is a guess: no local draft or export uses it.
- **The checkbox** (`masksOff` on the clip): unticked, the masks stay but the engine draws none (a converted draft's own masks included).
- **A draft's masks** show in the tab: the app lists a converted CapCut segment's masks in `masks` (`draftMask` naming the material, `keyed` when it has keys; `app.rs`, `draft_masks`). Unedited they stay CapCut's materials as imported; edited, the app's replace the ones it listed. Pen paths (`penPath`) become pen masks, a draft's heart or star with its picture keeps it (`shapeBounds.picture`).
- **Several masks**: each cuts the clip, wherever it is in the list (a mask with a clear outside), so their coverage multiplies, an intersection. Whether CapCut combines them the same way isn't checked: no local draft has two.

Checked by the v1 tests (pen, text, circle, expansion, `masksOff`), the playback mask tests (expansion, text coverage), the renderer's unit tests (tiles, text box, pen poses, empty masks) and `inspmask` in the app, where every tile, handle and row changes the engine's frame and undoes.

### Masks on adjustment layers

CapCut masks adjustment layers too: a local draft's adjustment layer has a rectangle mask (category `adjust`). The engine doesn't draw adjustment layers yet, so their masks aren't drawn either. Effects in CapCut 9.5.0 take masks the same way (the Effect inspector's Mask tab), and aren't drawn for the same reason.

### Circle, linear and mirror (2026-10-17)

Read from their bundles (`lumi_circle_mask`, `lumi_linear_mask`, `lumi_mirror_mask`, in `effect/1068046517`, `…514` and `…513`). They use the same offsets as the rectangle: half-heights from the centre, v up.

- **Circle:**
  - The offset is turned by 360° plus the rotation, as for the rectangle.
  - Coverage is 1 − smoothstep(1 − s, 1 + s, (x/a)² + (y/b)²), where a and b are the box's half-sizes. The edge softness s is 15 × feather, plus up to 0.05 more for long thin ellipses: ((r − 1)/10)² × 0.05, where r is the longer side over the shorter, clamped to 1–11.
- **Linear:**
  - d is the offset's distance along (−sin θ, cos θ), where θ = −rotation.
  - Coverage is smoothstep(−0.005·decay − feather, feather, d), so it keeps the side the rotation turns "up" to.
- **Mirror:**
  - d is the same distance, without its sign.
  - Coverage is 1 − smoothstep(h − 0.005·decay − feather, h + 0.005·decay + feather, d), where h is the box's height. It keeps a band as tall as the box; its width doesn't apply.
- **Invert** swaps coverage, as for the rectangle.

The importer recognises a shape by its `resource_type`, its name, or its bundle's folder. No local draft uses these three, so they follow the bundles but are unchecked against CapCut. A calibration draft (like session 6, with these shapes) would confirm them.

## Checks

App masks: a rectangle and a lasso drawn in the app, with its default colours, cover the same pixels in the engine's preview as in the app's own (0.13% of the clip's pixels differ, all on edges).

CapCut: both local uses start at 0 s, so the draft covers show them (results/2026-10-16-masks.md): the mask edges land on the same pixel rows and columns as CapCut's. Rotation, feather and rounded corners follow the bundle but have no local example yet; a calibration draft would confirm them.
