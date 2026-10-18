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

- Each mask keeps keyframes by source frame, each a shape (`shapeBounds`) or a lasso (`lassoPoints`), held until the next; before the first, the first applies.
- Positions are world units from the clip's top-left, at the scale the clip had when the mask was drawn (the mask's `transform`). A rectangle turns about its top-left corner, the other shapes about their centre; the triangle's centroid sits at its box's centre; the star's inner points are at half its radii, stretched to the box.
- Inside shows the mask colour (white by default) or the clip, outside the background colour (black by default) or the clip. Only the first mask paints outside itself. Edges are hard, tested at pixel centres; the feather and invert the app stores aren't used.
- A colour comes out of its WebGL canvas as the colour times its opacity at the opacity squared, since the blend applies to alpha too.
- While the mask tool is out, the preview shows clips unmasked.

## OpenRip

`Mask` materials (`openrip-model`) carry the shape, centre (in half-sizes from the picture's middle, +y up), size, rotation, feather, invert, what each side shows (the clip, or a colour, clear for a cut-out) and any held keys. The preview draws each attached mask's coverage over the upright picture (at the picture's size, up to 2048 pixels on its long side), turns it into the stored picture's axes and hands it to the compositor, which paints the clip's pixels inside and outside by it before placing the clip (a background-removal matte is the first such pass). Photos take masks too.

CapCut's rectangle, circle, linear and mirror masks are drawn. Heart and star draw an SVG outline in their bundles; they are imported, keeping their bundle reference, but leave the picture whole. In the app's engine mode the mask tool sends the project without masks, so the clip shows whole while masks are edited.

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
