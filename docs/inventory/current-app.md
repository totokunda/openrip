# OpenRip: current-app feature inventory (engine parity checklist)

This document covers OpenRip **0.1.2** (`apps/app/package.json`) on `main` as of 2026-10-15. It lists the engine-relevant behaviour of the Electron + React editor and serves as the parity checklist for the Rust engine rewrite. AI features have been removed and are ignored here. Everything was taken from reading the code. Items marked *(inferred)* were reasoned out from the code, not observed running.

**Citations**

- `path:line` is relative to `apps/app/packages/`. Ranges are `a-b`, and `:n` means a line in the file cited just before it.
- Bare file names use the file key below.
- Konva internals (`Text.js`, `Shape.js`, `Line.js`) are in `apps/app/node_modules/konva/lib/` (konva 9.3.22).

**Processes and packages**

| Package | Role | Key tech |
|---|---|---|
| `main/` | Electron main process: window, `app://` protocol, JSON persistence, settings, auto-update | Electron ^38.1.2 |
| `preload/` | Node bridge: ffmpeg/ffprobe spawning, symlink media library, proxies, export encode, filter-pack scan | ffmpeg-static ^5.3.0, ffprobe-static ^3.1.0 |
| `renderer/` | UI, Konva preview canvas, WebGL effects, WebCodecs decode, timeline, zustand stores | React 19, konva ^9.3.22, mediabunny ^1.14.1, zustand ^5 |
| `export-renderer/` | Off-screen Konva compositor, bundled into the renderer and run in the same window | konva |

**Global constants** (renderer/src/lib/settings.ts:1-45): `MIN_DURATION=5` frames (zoom floor), `BASE_LONG_SIDE=600` world units, `TIMELINE_DURATION_SECONDS=60`, `DEFAULT_FPS=24`, `MAX_DURATION=1440` frames, `FRAMES_CACHE_MAX_BYTES=512 MiB`, `DECODER_STALE_MS=30000`, `PREFETCH_BACK=PREFETCH_AHEAD=32`.

**File key** (bare names → path under `apps/app/packages/`):

| Directory | Files |
|---|---|
| `renderer/src/lib/` | `types.ts`, `clip.ts`, `control.ts`, `clipOrdering.ts`, `applicator-utils.ts`, `prepareExportClips.ts`, `viewport.ts`, `polygon.ts`, `eraser-utils.ts`, `drawing.ts`, `projects.ts`; `middlewares/json-persistence.ts` (also "JP"); `mask/{index,keyframeUtils,transformUtils,clipTransformUtils}.ts` |
| `renderer/src/lib/media/` | `utils.ts`, `audio.ts`, `audio-decoder.worker.ts` (also "worker" in §7), `video.ts`, `video-decoder.ts`, `video-decoder.worker.ts` (also "worker" in §8–9), `cache.ts`, `canvas.ts`, `image.ts`, `timeline.ts` |
| `renderer/src/components/preview/` | `Preview.tsx`, `FullscreenPreview.tsx`; `mask/{base,shape,lasso,crop,useWebGLMask}.ts`; `webgl-filters/*.ts` (`WebGLFilterBase`, `useWebGLFilters`, `hald-clut`, `brightness`, `contrast`, `hue-saturation`, `blur`, `sharpness`, `noise`, `vignette`, `useWebGLHaldClut`) |
| `renderer/src/components/preview/clips/` | `VideoPreview`, `ImagePreview`, `AudioPreview`, `TextPreview`, `ShapePreview`, `DrawingPreview`, `MaskPreview`, `LassoMaskPreview`, `ShapeMaskPreview`, `DrawMaskPreview` (`.tsx`); `apply/{base,filter}.ts`; `custom/{DrawingLine,RoundedRegularPolygon,ApplicatorFilter}.tsx` |
| `renderer/src/components/properties/` | `AppearanceProperties`, `AudioProperties`, `ColorCorrectionProperties`, `EffectsProperties`, `FilterProperties`, `DurationProperties`, `LayoutProperties`, `PositionProperties`, `TextProperties`, `TextStrokeSection`, `TextShadowSection`, `TextBackgroundSection`, `LineProperties`, `ColorInput`, `Combobox`, `Input` (`.tsx`); `mask/*.tsx` |
| `renderer/src/components/` (other) | `GlobalContextMenu.tsx`, `App.tsx`, `bars/Topbar.tsx`, `controls/{Controls,Buttons}.tsx`, `dialogs/{ExportModal,ClipExportModal,MediaDialog,SettingsModal}.tsx`, `menus/{MediaMenu,FilterMenu}.tsx`, `media/Item.tsx`, `timeline/{TimelineEditor,Timeline,TimelineSidebar,Scrubber}.tsx`, `timeline/clips/{TimelineClip,MaskKeyframes}.tsx`, `timeline/clips/thumbnails/generateTimelineThumbnail*.ts` |
| `export-renderer/src/` | `export.ts` (`KonvaExportRenderer`), `exporter.ts`, `ffmpegEncoder.ts`, `blit.ts`, `prepare.ts`; `masks/apply.ts`; `webgl-filters/{apply,hald-clut-singleton}.ts`; `applicators/utils.ts` |
| `preload/src/` | `media/{previews,library,fileExts,ffmpegBin,renameDelete,links,process,ffmpeg,probe,paths,root}.ts`, `exportCache.ts`, `core/ipc.ts`, `filters/fetch.ts` |
| `main/src/modules/` | `JSONPersistenceModule.ts` (also "JPM"), `AppDirProtocol.ts`, `SettingsModule.ts`, `WindowManager.ts`, `CoreIpc.ts`, `NativeFileDialog.ts` |

**Ambiguous names**

| Bare name | Default path | Other path(s) |
|---|---|---|
| `types.ts` | `renderer/src/lib/types.ts` | — |
| `utils.ts` | `renderer/src/lib/media/utils.ts` | `export-renderer/src/applicators/utils.ts` when it appears alongside export code |
| `library.ts` | `preload/src/media/library.ts` | — |
| `apply.ts` | `export-renderer/src/webgl-filters/apply.ts` in §3 | `export-renderer/src/masks/apply.ts` in §4 |
| `base.ts` | `preview/mask/base.ts` in §4 | `preview/clips/apply/base.ts` in §2–3 |

**Contents:** 1 Clip types · 2 Rendering semantics · 3 Effects · 4 Masks · 5 Text · 6 Shapes & drawing · 7 Audio · 8 Media pipeline · 9 Playback · 10 Export · 11 Project model & persistence · 12 Editing operations · 13 UI features · 14 Known gaps / bugs

## 1. Clip types and persisted properties

`ClipType = video | image | audio | text | shape | draw | filter | group` (renderer/src/lib/types.ts:10-18). Track (`TimelineType`) kinds: `media | audio | text | shape | draw | filter` (types.ts:19-25). Video, image and group clips live on `media` tracks; every other clip type needs a track of its own type (renderer/src/lib/clip.ts:211-238). Default track heights are media/group 72 px, audio 54 px, others 36 px (clip.ts:240-257). These are UI-only.

**Time unit.** In memory, every clip time is an **integer frame index at the project fps** (`startFrame`, `endFrame`, `trimStart`, `trimEnd`). On disk the same values are stored as **ticks** (1,000,000 per second; §11.2). There is no rational time base. Changing fps rescales the stored frames (§2.6). `DEFAULT_FPS = 24` and `BASE_LONG_SIDE = 600` world units (renderer/src/lib/settings.ts:2-4).

### 1.1 Base `ClipProps` (all types) — types.ts:61-77

| Field | Type | Default / set by | Semantics |
|---|---|---|---|
| `clipId` | string (uuid v4) | creator | Primary key. |
| `type` | ClipType | creator | Discriminant. |
| `timelineId` | string? | drop target / auto-created track | Owning track. Group children keep their original track id. |
| `startFrame` | int | drop position | First frame on the timeline. `clipWithinFrame` uses **inclusive** bounds `start <= f <= end` (clip.ts:1904-1917). |
| `endFrame` | int | `start + len` | End frame (inclusive in `clipWithinFrame`). |
| `trimStart` | number? | media: 0; image/filter/text/shape/draw: `+Infinity` | Frames trimmed off the head, always ≥ 0. A left-edge resize by Δ sets `startFrame += Δ` and `trimStart += Δ`, and is rejected when `trimStart + Δ < 0` (clip.ts:1124-1146). `Infinity` means unbounded (no source limit). |
| `trimEnd` | number? | media: 0; others: `-Infinity` | Frames trimmed off the tail, stored **≤ 0**. A right-edge resize by Δ sets `trimEnd += Δ` and is rejected when the result is > 0 (clip.ts:1103-1120). |
| `clipPadding` | number? | — | Persisted and round-tripped (renderer/src/lib/middlewares/json-persistence.ts:250-291) but never read by rendering. |
| `groupId` | string? | `groupClips` | Parent group id. When set, the clip also has `hidden: true` (clip.ts:1311). |
| `hidden` | boolean? | — | **Only** marks group membership. The clip is excluded from track lists (clip.ts:804) and from `resolveOverlaps` (clip.ts:264-299). This is not a user "hide clip" toggle. |
| `transform` | `ClipTransform?` | set on first canvas layout or by creator | See §1.2 and §2. |
| `originalTransform` | `ClipTransform?` | copy of the first transform with w,h > 0, x=y=0 (clip.ts:743-745) | Base for scale display and for the Layout "reset" (renderer/src/components/properties/LayoutProperties.tsx:25-70). |

### 1.2 `ClipTransform` — types.ts:43-59

| Field | Units / range | UI | Notes |
|---|---|---|---|
| `x`, `y` | world units, top-left of the unrotated box (§2.1) | Position X/Y inputs, no clamp (renderer/src/components/properties/PositionProperties.tsx:192-213) | Alignment buttons snap to 0, centre or far edge of `contentBounds` (PositionProperties.tsx:66-103). |
| `width`, `height` | world units, > 0 | W/H inputs for shapes only (LayoutProperties.tsx:72-86) | For image and video, "Scale X/Y" (min 0.1, step 0.1) **rewrites width/height = base × s and keeps scaleX/Y = 1** (LayoutProperties.tsx:89-171). |
| `scaleX`, `scaleY` | multiplier, default 1 | Konva transformer only | Effective size is `width·scaleX` × `height·scaleY` (PositionProperties.tsx:43-44). |
| `rotation` | **degrees**, clockwise (Konva) | Rotation input | The panel keeps the visual centre fixed: `P' = P + R(r0)v − R(r1)v` with `v = (w·sx/2, h·sy/2)` (PositionProperties.tsx:29-64). |
| `cornerRadius` | world units, UI clamp 0–100 | image, video, shape rect/polygon (renderer/src/components/properties/AppearanceProperties.tsx:38-113) | Further clamped by `sanitizeCornerRadius` (§2). |
| `opacity` | **0–100 percent**, default 100 | Opacity slider, step 1 (AppearanceProperties.tsx:29-87) | |
| `crop` | `{x,y,width,height}` **normalised 0–1 of native media** | Crop dialog (renderer/src/components/dialogs/MediaDialog.tsx:606-730) | On confirm, `width/height = native × crop × currentScale` and x/y shift by `Δcrop × native × currentScale` so the visible pixels stay in place (MediaDialog.tsx:677-715). It is applied with `setClipTransform(..., applyToMasks=true)` (renderer/src/components/controls/Buttons.tsx:404-421). The uncropped box is `width/crop.width` (clip.ts:689-707). |

### 1.3 Type-specific properties

| Type | Field | Type / units | Default | Range (UI) | Effect | Cite |
|---|---|---|---|---|---|---|
| video, image | `assetId` | string | from `addAsset({path})` on drop | — | Points to `assets[id].path` | types.ts:106; renderer/src/components/timeline/TimelineEditor.tsx:859-878 |
| video, image | `assetIdHistory` | string[] | never written | — | Only read by asset pruning | clip.ts:162-188 |
| video, image | `mediaWidth/mediaHeight/mediaAspectRatio` | px, w/h | probe `displayWidth/Height` (video) or image w/h | — | Intrinsic size for fit and crop | TimelineEditor.tsx:880-891 |
| video, image | `masks` | `MaskClipProps[]` | `[]` | — | §4 | TimelineEditor.tsx:912-914 |
| video, image | `brightness, contrast, hue, saturation` | number | undefined → 0 | −100…100, step 1 | §3 | renderer/src/components/properties/ColorCorrectionProperties.tsx:33-63 |
| video, image | `sharpness, noise, blur, vignette` | number | undefined → 0 | 0…100, step 1 | §3 | renderer/src/components/properties/EffectsProperties.tsx:30-60 |
| video, image | `exposure` | number | — | **no UI, never read** | none | types.ts:33 |
| video, audio | `volume` | **dB** | undefined → 0 | −60…+20, step 1 | gain (§7) | renderer/src/components/properties/AudioProperties.tsx:60-68 |
| video, audio | `fadeIn`, `fadeOut` | **seconds** | 0 | 0…asset duration, step 0.1 | §7 | AudioProperties.tsx:69-86 |
| video, audio | `speed` | multiplier | 1.0 (set on drop) | 0.1…100 (CapCut's; the Speed tab's slider on its marks 0.1, 1, 2, 5, 10, 100×); with a curve, the curve's mean speed | §2.6, §7 | renderer/src/components/properties/SpeedProperties.tsx; TimelineEditor.tsx:874; lib/speed.ts `speedPatch` |
| video, audio | `speedCurve` | `{ preset?, points: [{x, y}] }` or null | none | x 0…1 (media progress as played), y 0.1…10 | the engine's remap (docs/parity/speed.md) | types.ts `SpeedCurve`; lib/speed.ts |
| video, audio | `reverse` | boolean | false | — (trims then count from the media's end) | the engine plays it backward | types.ts `SpeedProps`; lib/speed.ts `reversePatch` |
| video | `freeze` | `{ at }` (s into the asset) or null | none | — | a still of that frame, no sound | types.ts `FreezeFrame`; lib/speed.ts `freezeFrame` |
| video, audio | `changePitch` | boolean | false | — | the sound resampled with the speed (its pitch follows it) instead of time-stretched; a curve's always follows | types.ts `SpeedProps`; engine v1 `change_pitch` |
| image | duration | — | `fps × defaultClipLength` (5 s) | unbounded (trims ±∞) | — | TimelineEditor.tsx:726-731; renderer/src/lib/control.ts:244 |
| audio | `assetId`, `volume`, `fadeIn`, `fadeOut`, `speed` | as above | — | — | Audio-only track | types.ts:132-139 |
| shape | `shapeType` (`rectangle\|ellipse\|polygon\|line\|star`), `fill`/`stroke` (hex, created `#E3E3E3`), `fillOpacity`/`strokeOpacity` (0–100 %, unset→100), `strokeWidth` (world units, created 1), `sides` (polygon, 3–12, created 3), `points` (star, unset→5, effective 4–12) | | | | full table §6.1 | types.ts:141-159; Preview.tsx:1900-1918; AppearanceProperties.tsx:116-149; LayoutProperties.tsx:43-54 |
| text | 26 props: `text`, font (`fontSize` 10–256 px, `fontWeight` 400/700, `fontStyle`, `fontFamily`), `color`/`colorOpacity`, `textAlign`, `verticalAlign`, `textTransform`, `textDecoration`, stroke ×4, shadow ×7, background ×4 | | | | full table §5.1 | types.ts:161-192; Preview.tsx:1782-1825 |
| draw | `lines: DrawingLine[]`: `{lineId, tool: brush\|highlighter\|eraser, points:[x,y…], stroke, strokeWidth, opacity 0–100, smoothing 0–1, transform{x,y,scaleX,scaleY,rotation,opacity}}` | | | | §6.2 | types.ts:205-228; Preview.tsx:1661-1677 |
| filter | `name, smallPath, fullPath, category, examplePath, exampleAssetUrl` | strings | copied from the filter catalog on drop | — | LUT source (§3) | TimelineEditor.tsx:893-910 |
| filter | `intensity` | **0–100 %** | undefined → 100 | 0–100, step 1 | LUT mix | renderer/src/components/properties/FilterProperties.tsx:18-30 |
| filter | duration | — | `fps × defaultClipLength` (5 s), trims ±∞ | — | | TimelineEditor.tsx:733-739 |
| group | `children: string[][]` | clipIds, nested per source track (ordered by track Y, then by startFrame) | — | — | §2.5 | clip.ts:1279-1304 |

**Creation defaults for canvas-drawn clips.** Text, shape and draw clips last `3 * DEFAULT_FPS` = 72 frames whatever the project fps, capped at `totalTimelineFrames-1` (Preview.tsx:1703,1781,1887). Every new text and shape clip creates a **new track** at index −1 (Preview.tsx:1770-1779,1874-1884). A draw stroke is appended to the existing draw clip under the playhead if there is one, and otherwise creates a draw track and clip that shortens to the next clip on that track (Preview.tsx:1656-1729). Shapes smaller than 5×5 world units are discarded. A star is forced square. A polygon is forced to aspect ratio 1.1543665517482078 (Preview.tsx:1854-1872).

**Properties panel tabs per type** (renderer/src/components/panels/ClipPropertiesPanel.tsx:43-98):

| Tab | Clip types |
|---|---|
| Line | draw, when a line is selected |
| Text | text |
| Transform | image, video, shape, text |
| Mask | video, image |
| Audio | audio, or video whose probe has an audio track |
| Duration / Filter | every type (the Filter tab adds Intensity) |
| Adjust | image, video |
| Appearance | image, video, shape, text |

## 2. Rendering semantics

"Preview" = Konva stage in `renderer`; "export" = `export-renderer` (`KonvaExportRenderer` in `export.ts`, driven by `exporter.ts`). The free functions in `export-renderer/src/blit.ts` (`blitImage`/`blitVideo`/`blitText`/...) are exported from the package but no caller uses them. Only their types and the no-op `cleanupVideoDecoders` are used (`export-renderer/src/exporter.ts:1-8`, `blit.ts:1040`).

### 2.1 Coordinate space ("world units")

| Item | Behavior | Ref |
|---|---|---|
| `BASE_LONG_SIDE` | `600` world units. Despite the name, it fixes the **height** (short side for landscape, long side for portrait). | `renderer/src/lib/settings.ts:2` |
| Project rect | `rectHeight = 600`, `rectWidth = 600 * (ar.w / ar.h)` (16:9 gives 1066.67×600, 9:16 gives 337.5×600). Origin is top-left (0,0), +x right, +y down. | `renderer/src/components/preview/Preview.tsx:501-510` |
| Aspect ratio | `{width,height,id}`, default 16:9. Presets are 16:9, 9:16, 1:1, 4:3, 4:5, 21:9 and 2:3. Dragging the rect edge produces a "custom" ratio, reduced by gcd from `round(ratio*1000):1000`. | `lib/viewport.ts:59`, `components/bars/Topbar.tsx:704-710`, `Preview.tsx:2602-2624` |
| First media sets AR | Dropping the first image or video sets the AR to the media's pixel w:h. | `components/timeline/TimelineEditor.tsx:774-798` |
| AR change side effect | Every clip's `x,y` is reset to `max(0,(rectW-w)/2), max(0,(rectH-h)/2)`. This applies to all clips, including audio, filter and draw clips. Clips with no transform get a default transform with w=h=0. | `Preview.tsx:513-526`, `Preview.tsx:583-595`, `lib/clip.ts:714-725` |
| Preview → screen | Konva `Group` with `x/y = viewport.position` and `scaleX/Y = viewport.scale` (default 0.75, clamped 0.1–4). Zoom is anchored at the cursor or the viewport center. Zoom-to-fit pads by 0.9. The rect is re-centered when the container resizes. | `Preview.tsx:2552-2559`, `lib/viewport.ts:46-50,120-135,172-199`, `Preview.tsx:529-553` |
| Fullscreen | `scale = min(W/rectW, H/rectH)`, letterboxed and centered. | `components/preview/FullscreenPreview.tsx:192-219` |
| Canvas background | Black `Rect` (`rgb(0,0,0)`) under all clips. Every visual clip is wrapped in a `Group` clipped to the project rect (`clipX/Y/Width/Height`). | `Preview.tsx:2560-2568`, `clips/VideoPreview.tsx:1883-1889`, `clips/ImagePreview.tsx:991-997`, `clips/ShapePreview.tsx:841-847`, `clips/TextPreview.tsx:2203-2209`, `clips/DrawingPreview.tsx:262-268` |
| Export output size | `heightPx = resolution`, `widthPx = round(resolution * ar.w/ar.h)`. Background is `#000000`, or transparent when `preserveAlpha` is set. With no width/height, the fallback is 1920×1080. | `components/bars/Topbar.tsx:240-247,321`, `export-renderer/src/exporter.ts:460-478` |
| World → export px | `prepareExportClipsForValue` (`dimensionsFrom:"aspect"`) stores `normalizedTransform = {x/rectW, y/600, width/rectW, height/600}` without clamping. The export maps it back as `x*outW, y*outH, w*outW, h*outH`. `scaleX/Y`, `rotation`, `cornerRadius` and `opacity` are passed through unchanged. | `renderer/src/lib/prepareExportClips.ts:132-157,300-310,581-591`, `export-renderer/src/export.ts:1015-1051` |
| Size-like props in export | Text scales `fontSize`, `strokeWidth`, `shadowBlur`, `shadowOffset` and `backgroundCornerRadius` by `outH/600`. Drawings are put in a Group scaled by `min(outW/rectW, outH/600)` and centered. Media/shape `cornerRadius` and shape `strokeWidth` are **not** scaled. | `export.ts:803-850,867`, `export.ts:252-277`, `export.ts:661-668,687,708` |

### 2.2 Transform model (`ClipTransform`)

`ClipTransform = {x,y,width,height,scaleX,scaleY,rotation,cornerRadius,opacity,crop?}` (`renderer/src/lib/types.ts:43-59`). The store default for a missing transform is `{0,0,0,0,1,1,0,0,100,crop:{0,0,1,1}}` (`lib/clip.ts:714-725`). `originalTransform` is set once, the first time the transform gets a positive w/h, as `{...t, x:0, y:0}` (`lib/clip.ts:744-746`). It is used by Reset Size (`components/properties/LayoutProperties.tsx:56-64`), by scale input (`LayoutProperties.tsx:96-121`) and by single-clip export (`prepareExportClips.ts:605-610`).

| Field | Units / range | Semantics | Ref |
|---|---|---|---|
| `x`,`y` | world units | Top-left of the **unrotated** box. This is the Konva node origin, with no `offsetX/Y` set on any clip node. For ellipse, polygon and star the node is placed at the center `(x + w*sx/2, y + h*sy/2)`, but `x,y` are still stored as the top-left. | `clips/VideoPreview.tsx:1899-1900`, `clips/ShapePreview.tsx:736-750,559-560` |
| `width`,`height` | world units, >0 | Display box size. For media it is the **cropped** visible size. Video and image enforce >0 (fallback is the display size). | `clips/VideoPreview.tsx:723-758,1852-1865`, `lib/clip.ts:689-707` |
| `scaleX`,`scaleY` | multiplier | Video, image, text, rect, ellipse and line bake scale into w/h on transform end, so scale stays 1. Polygon and star keep a non-1 scale. Text always renders at scale 1. The scale inputs for media multiply `originalTransform` w/h. No flip is supported (no negative-scale path). | `clips/VideoPreview.tsx:1740-1757`, `clips/ShapePreview.tsx:562-602`, `clips/TextPreview.tsx:2267-2268,2283-2290`, `LayoutProperties.tsx:89-129` |
| `rotation` | degrees, clockwise (y-down), unbounded | Pivot is the node origin: top-left for media, text, rect and line, and the center for ellipse, polygon and star. The transformer snaps to multiples of 45°. Typing a rotation in the panel adjusts `x,y` so the visual center stays fixed. This assumes a top-left pivot and is applied to center-pivot shapes too. | `clips/VideoPreview.tsx:1905,2028`, `components/properties/PositionProperties.tsx:28-64` |
| `cornerRadius` | world units, UI 0–100 | Clamped to `[0, min(w,h)/2]` at render time. Applies to the media image, the rect shape and the polygon (rounded). The export clamps nothing and passes the raw value to Konva. | `lib/konva/sanitizeCornerRadius.ts:11-32`, `components/properties/AppearanceProperties.tsx:109-111`, `export.ts:496,624,687` |
| `opacity` | 0–100 (UI step 1) | Konva node opacity = `opacity/100`. Text background opacity = `bgOpacity/100 * opacity/100`. | `AppearanceProperties.tsx:83-85`, `clips/VideoPreview.tsx:1907`, `clips/TextPreview.tsx:2221-2224` |
| `crop` | normalized 0–1 of the source frame `{x,y,width,height}` | Set by the crop dialog, clamped to [0,1]. Confirming recomputes w/h to keep the current px-per-source-px scale and shifts x/y so the visible content stays in place. Preview crop px = `crop * displayW/H` (aspect-fit backing canvas). Export crop px = `crop * native texture size`. | `components/dialogs/MediaDialog.tsx:633-724`, `components/controls/Buttons.tsx:405-421`, `clips/VideoPreview.tsx:1841-1850`, `export.ts:475-484,603-612` |

**Object-fit:** video and image use *contain*. The display size is `min-fit(mediaW/H → rectW/H)`, centered. It initializes the transform when the transform is missing or zero-sized. Video uses mediabunny `displayWidth/Height`; image uses decoded `width/height` (`clips/VideoPreview.tsx:59-80,693-711`, `clips/ImagePreview.tsx:457-500`). The export applies the same fit when a clip has no transform (`prepareExportClips.ts:422-469`). After that, the box is stretched to `width×height`; no aspect is enforced.

**Per-clip pixel pipeline (preview):**
1. Decode the frame.
2. Draw it into a backing canvas of `floor(displayW)×floor(displayH)` world units. This is a fixed resolution, independent of zoom or DPR.
3. Apply masks. They are skipped while the mask tool is active.
4. Apply clip adjustments (WebGL filters).
5. Apply applicator filter clips.
6. Draw into a Konva `Image` with crop, transform and opacity.

Refs: `clips/VideoPreview.tsx:760-771,858-934`, `clips/ImagePreview.tsx:551-562,614-680`. The export runs the same order on a canvas at the **native source resolution** (`export.ts:414-505,531-633`). Pixel-radius effects (blur, sharpen, noise) therefore act on different pixel grids in preview and export. Vignette uses normalised UV, so it does not. Shapes and text are cached by Konva at `pixelRatio:2` before filters run (`clips/ShapePreview.tsx:407-415`, `clips/TextPreview.tsx:1587`).

**Draw clips** ignore `clip.transform`. Each `DrawingLine` carries its own `{x,y,scaleX,scaleY,rotation}`, with the pivot at the line's local origin (`clips/custom/DrawingLine.tsx:596-600`, `clips/DrawingPreview.tsx:110-131`).

### 2.3 Z-order / stacking

| Rule | Detail | Ref |
|---|---|---|
| Track Y | `timelineY` is cumulative, in timeline array order (index 0 has y=0 and is the top row). Heights: media 72, audio 54, others 36. New text, shape and draw tracks are inserted at index 0 (`addTimeline(..., -1)`), so they become the front-most layer. | `lib/clip.ts:240-257,315-340,757-779`, `Preview.tsx:1779` |
| `sortClipsForStacking` | Builds units: each group is one unit (group track Y, group start), and each non-child clip is one unit. Sorts by **Y descending** (bottom track first), then `startFrame` ascending. Groups expand to their children in reversed flattened `children` order, so the last subarray (the lowest original track) is drawn first. Draw order = array order, later is on top. | `lib/clipOrdering.ts:16-84`, `Preview.tsx:2627-2699` |
| Same-track ties | A later `startFrame` is drawn above. Because visibility is inclusive (§2.6), on a cut frame both adjacent clips render and the right-hand clip covers the left. | `clipOrdering.ts:67-70`, `lib/clip.ts:1904-1917` |
| Non-visual types | `audio`, `filter` and `group` render no node (`default: null`). Audio is rendered by a separate `AudioPreview` loop. | `Preview.tsx:2696-2697,2839-2855` |
| Export order | Topbar sorts with the same `sortClipsForStacking`, drops clips on hidden timelines and filter clips, and the exporter draws in that order. | `components/bars/Topbar.tsx:258-289`, `export-renderer/src/exporter.ts:653-656` (draws `active` in incoming order) |
| `getClipPositionScore` | `timelineIndex*1e9 + layerRank*1e6 + endFrame`. `timelineIndex` comes from sorting by `timelineY` ascending (top = 0, so lower tracks score higher). `layerRank`: a group child uses the index of its `children` subarray. A group uses `lastIdx + 0.75`. A non-group clip on a track that has groups uses the max over those groups of (`lastIdx - 0.5` if `clipEnd <= groupEnd`, else `lastIdx + 1`); otherwise it is 0. Its **only** consumer is export filter attachment. | `lib/clip.ts:1962-2025`, `prepareExportClips.ts:377-416` |

### 2.4 Filter clips ("applicators") on clips beneath

| | Preview | Export (Topbar timeline export) |
|---|---|---|
| Which filters apply | Only `type:"filter"` clips (`APPLICATOR_CLIP_TYPES`), and only those whose *effective* track Y is **strictly less** than the target's (a visually higher row), or that are earlier siblings in the same group. The effective Y is the clip's own track Y, falling back to the group's track only if its own track is missing. Filters on hidden tracks are excluded. | `getClipPositionScore(filter) < getClipPositionScore(clip)`. Hidden tracks are **not** checked; `getClipsByType("filter")` returns all filters. |
| Time test | The filter is active only if `focusFrame ∈ [start,end]` (inclusive), checked both at collection and in `apply()`. | Per frame, `frame ∈ [a.startFrame,a.endFrame]`. The filter frames are first shifted by `offsetStart` (= the target clip's `startFrame` for non-group clips). |
| Chain order | Sorted by effective Y ascending, so the **top-most filter is applied first**. Ties: group child index, then start. | Store array order (no sort). Duplicates are removed by `clipId`. |
| Strength | `intensity/100` clamped to [0,1]. Undefined means 1.0. The LUT path is `fullPath ‖ smallPath`. | Same factory logic. |
| Where applied | Video and image: on the clip's backing canvas, after masks and adjustments. Shape, text and draw: through the Konva filter `Applicator` on the node's cached bitmap. | Video and image: on the native-resolution texture. Shape and text: a full-canvas raster of the node is filtered and composited. Draw: filtered per line. |

Refs: `renderer/src/lib/applicator-utils.ts:11,22-124,143-165`, `components/preview/clips/apply/base.ts:41-49`, `clips/apply/filter.ts:71-126`, `clips/custom/ApplicatorFilter.tsx:8-30`, `prepareExportClips.ts:377-416`, `export-renderer/src/exporter.ts:657-678`, `export-renderer/src/applicators/utils.ts:21-60`, `export.ts:282-350,752-787,918-953`. A filter never modifies the composite of the layers below it. It modifies each lower clip's own pixels separately before compositing, so filter output stays inside each clip's alpha.

### 2.5 Group clips

| Aspect | Behavior | Ref |
|---|---|---|
| Create | Group span is `[min child start, max child end]`. The group is placed on the top-most media track that has a free span, or a new media track is created. `children: string[][]` holds one subarray per source track, ordered by track Y (top first), each sorted by start. | `lib/clip.ts:1198-1304` |
| Children | Children keep their own `timelineId` and absolute frames, and get `groupId` and `hidden:true`. Clip-level `hidden` only removes a clip from the timeline UI, `resolveOverlaps` and `getClipsForTimeline`. It does not affect rendering. | `lib/clip.ts:1308-1313,265-266,802-805`, `components/timeline/Timeline.tsx:54` |
| Move | Changing the group's `startFrame`/`timelineId` shifts every child by the same delta and reassigns the child `timelineId` when the track changes. Groups cannot be resized. | `lib/clip.ts:928-960,1099-1101` |
| Transform | None. There is no group-level transform or opacity, and the group renders no node. Children are drawn individually at the group's stack slot. | `Preview.tsx:2696-2697`, `clipOrdering.ts:74-80` |
| Visibility | Preview uses the **group's** track hidden/muted state for its children and ignores the children's own tracks. Timeline export filters children by their **own** `timelineId` hidden state. | `Preview.tsx:375-416`, `Topbar.tsx:263-268` |
| Group export | `prepareExportClipsForValue(group)` rebases children to group-local frames (`start - groupStart`). Only single-clip export uses this path; Topbar never passes a group clip, because `sortClipsForStacking` already expands groups. | `prepareExportClips.ts:316-357` |

### 2.6 Time mapping

| Item | Rule | Ref |
|---|---|---|
| Units | In memory, every timeline value is an integer **project frame** at `fps` (default 24). On disk, values are **ticks** of 1/1,000,000 s. `tick = floor(frame*1e6 / round(fps))`, `frame = floor(tick*round(fps)/1e6)`, computed with BigInt. Sentinel ticks: `1n` = +∞, `2n` = −∞. | `lib/settings.ts:4`, `lib/middlewares/json-persistence.ts:74-117` |
| Visibility window | `startFrame ≤ f ≤ endFrame` (inclusive), in both preview and export. Duration = `end - start`. The project end is `max(endFrame)`. The export loops `f ∈ [start, end)`. | `lib/clip.ts:145-148,1904-1917`, `exporter.ts:451-457,647-651,1008` |
| `trimStart` | ≥0. Leading frames cut from the source, in timeline-frame units (pre-speed). Left-resize changes `startFrame` and `trimStart` by the same delta and is refused if `trimStart` would go below 0. | `lib/clip.ts:1125-1152,1078-1087` |
| `trimEnd` | ≤0. Negative "give" at the tail. Right-resize adds the end delta and is refused if the result would be > 0, so a clip cannot extend past the source end. | `lib/clip.ts:1104-1123,1069-1077` |
| Unbounded clips | Image, filter, text, shape and draw clips are created with `trimStart=+∞` and `trimEnd=−∞`, so they have no extension limit. On save, non-finite values are written as 0. On load, every type except audio, video and group is forced back to ±∞. | `TimelineEditor.tsx:727-736`, `Preview.tsx:1724-1725`, `json-persistence.ts:260-267,683-690` |
| Default durations | Video and audio: `round(durationSec * fps)` (the drag ghost uses `ceil` via `convertFrameRange`). Image and filter: `fps * defaultClipLength` (default 5 s). Text, shape and draw: `3 * DEFAULT_FPS` = 72 frames whatever the project fps, clamped to `totalTimelineFrames - 1`. | `TimelineEditor.tsx:717-739,320-341`, `lib/control.ts:244`, `Preview.tsx:1703,1781-1790,1887` |
| Speed | Video and audio only, clamped to [0.1, 100]. A speed change keeps `startFrame` and sets `end = start + round(oldDur * oldSpeed/newSpeed)`; since 2026-10-18 the trims scale by oldSpeed/newSpeed so the in-point stays (they didn't), keys stay on the media, a constant speed drops a curve, and linked clips take it. Curves, reverse and freeze: `lib/speed.ts`, docs/plan/app-engine-integration.md ("Speed tools"). | `lib/clip.ts:899-922`, `components/properties/SpeedProperties.tsx`, `clips/VideoPreview.tsx:244-247` |
| Preview source frame | `L = max(0, f - start + trimStart)`, `srcIdx = floor((L*speed / projectFps) * clipFps + 1e-4) + round(mediaInfo.startFrame/projectFps*clipFps)`. `clipFps` is the stream's `averagePacketRate`. | `clips/VideoPreview.tsx:1346-1373,27-57` |
| Export source frame | `srcIdx = trimStart + srcStartFrame + floor((f - start)*speed)`, in project-fps units. The iterator is called with `speed:1` and target `srcIdx/projectFps`. It yields the latest decoded frame with `ts < target` (strictly less), otherwise the next frame, and holds the last frame past the end. **This differs from preview whenever `speed≠1` and `trimStart>0`**, because here `trimStart` is not multiplied by speed. | `exporter.ts:706-763`, `renderer/src/lib/media/video.ts:151-224` |
| Split | Left part: `end = cut`, `trimEnd += cut - oldEnd`. Right part: `start = cut`, `trimStart += cut - oldStart`. Infinite trims are first treated as 0, so a split image or text clip gets finite trims until the project is reloaded. Mask keyframes are partitioned at `cut - start + trimStart`. | `lib/clip.ts:1579-1625` |
| FPS change | `rescaleForFpsChange`: `start`, `end` and trims become `round(frame/oldFps*newFps)`. Non-finite **and negative** values are skipped. The view range and playhead are scaled by the same ratio. | `lib/clip.ts:150-159,2026-2050`, `lib/control.ts:210-243` |

### 2.7 Hidden / muted tracks

| | Preview | Export |
|---|---|---|
| Hidden track | Visuals and audio of its clips are removed. Group children follow the group's track. | Clips are dropped by their own `timelineId` (`Topbar.tsx:263-268`). Filters on hidden tracks still attach. |
| Muted track | Audio previews are skipped (`filterClips(clips, true)`). Visuals still render. | **Ignored.** Audio from muted tracks is mixed. |
| Refs | `Preview.tsx:375-416,2839-2852`, `lib/clip.ts:539-586` | `Topbar.tsx:258-289`, `exporter.ts:866-996` |

## 3. Effects

The `clut-filters` submodule (`renderer/public/filters`) is **not checked out** in this tree. Actual LUT categories and image sizes could not be enumerated; everything below about packs comes from the code.

### 3.1 Per-clip adjustments (video and image clips only)

**Where they apply and in what order**
- **Fields:** optional numbers in `MediaAdjustments` (renderer/src/lib/types.ts:29-41). A missing field counts as 0.
- **Which clips:** the Adjust tab exists only for image and video clips. Text, shape and draw clips receive filter-clip applicators only (§3.3).
- **Fixed pass order:** brightness → contrast → hue/saturation (one pass) → blur → sharpness → noise → vignette. Preview: renderer/src/components/preview/webgl-filters/useWebGLFilters.ts:51-181. Export: export-renderer/src/webgl-filters/apply.ts:32-130.

**GPU path and precision**
- **Per-pass round trip:** each pass renders into one shared, refcounted WebGL1 canvas (`"preview-webgl-filter"`, `premultipliedAlpha:false`, `preserveDrawingBuffer:true`; WebGLFilterBase.ts:23-36). The result is copied back into the 2D source canvas with a vertical flip (`ctx.scale(1,-1)`), so **every pass is quantised to 8-bit RGBA** (useWebGLFilters.ts:62-67). Textures use CLAMP_TO_EDGE and LINEAR filtering. Context loss and restore are handled in renderer/src/components/preview/webgl/WebGLContextManager.ts:87-219.
- **Precision:** all maths runs on **gamma-encoded sRGB with straight alpha**, at `mediump`, with no explicit clamp.

**Parameters**

| Prop | UI range / step / default | Uniform | Shader maths | No-op when |
|---|---|---|---|---|
| `brightness` | −100..100 / 1 / 0 (ColorCorrectionProperties.tsx:89-97) | `b = v/100` | `rgb += b` (webgl-filters/brightness.ts:27-35) | 0 |
| `contrast` | −100..100 / 1 / 0 | `c = v/100` (contrast.ts:88-92) | `rgb = (rgb−0.5)·(1+c)+0.5`. At −100 the result is flat 0.5 grey (contrast.ts:33-34) | 0 |
| `hue` | −100..100 / 1 / 0 | `u_hue = v/100` turns (hue-saturation.ts:151-155) | RGB→HSL; `h = mod(h+u_hue, 1)`; HSL→RGB (:29-90). ±100 is a full 360° turn, i.e. identity | hue = sat = 0 |
| `saturation` | −100..100 / 1 / 0 | `s = v/100` | `S = clamp(S·(1+s), 0, 1)` in HSL (:93) | same pass as hue |
| `blur` | 0..100 / 1 / 0 (EffectsProperties.tsx:104-112) | radius `r = v/10` px (useWebGLFilters.ts:118) | Separable Gaussian in 2 passes (H into an FBO, then V). Integer taps x∈[−10,10] with `\|x\| ≤ r`, weight `w = exp(−0.5x²/(0.15r²))`, normalised, applied to RGBA **including alpha** (blur.ts:37-77,229-235). Because r < 1 below v = 10, values 1–9 do nothing | r ≤ 0 |
| `sharpness` | 0..100 / 1 / 0 | `k = v/100` | Unsharp mask: `B = [1 2 1; 2 4 2; 1 2 1]/16` at 1-texel offsets, `rgb = c + 5k·(c − B)`, alpha unchanged (sharpness.ts:28-56) | ≤ 0 |
| `noise` | 0..100 / 1 / 0 | `n = v/100`, `seed = Math.random()·1000` **on every call** (noise.ts:92-99) | `rgb += (fract(sin(dot(uv,(12.9898,78.233))+seed)·43758.5453) − 0.5)·n`, monochrome (:29-42) | ≤ 0 |
| `vignette` | 0..100 / 1 / 0 | `v/100` | `d = \|uv − 0.5\|/0.7071`, `rgb *= clamp(1 − d³·2v, 0, 1)`. Not aspect-corrected, so the falloff is elliptical; computed on the uncropped frame (vignette.ts:30-45) | ≤ 0 |
| `exposure` | — | — | Declared only (types.ts:33) | — |

**Pipeline position:** effects run on the **full frame before crop**, in both preview and export.
- VideoPreview:
  1. Decode, drawn at clip display size (VideoPreview.tsx:760-771).
  2. Masks, skipped while the mask tool is active (:893-895).
  3. Adjustments (:911).
  4. Applicators (:913-929).
  5. `Konva.Image` applies crop, transform, opacity and radius (:934, crop :1840-1850).
  - While paused, steps 2–5 re-run from a cached original frame (:1480-1566).
- ImagePreview: same order (ImagePreview.tsx:663-724).
- Timeline thumbnails apply adjustments too (generateTimelineThumbnailVideo.ts:326-338; …Image.ts:92-103).

### 3.2 LUT filters (Hald CLUT) and packs

**Filter clips:**
- Store **absolute** pack paths, copied when dropped (TimelineEditor.tsx:893-910).
- `intensity` is 0..100; unset means 100 (FilterProperties.tsx:18-46).
- **Render nothing themselves:** Preview has no `filter` case (Preview.tsx:2637-2697), and export skips them (Topbar.tsx:271).
- Shown on the timeline as a solid `#02ace6` bar.

**Loading** (renderer/src/components/preview/webgl-filters/hald-clut.ts):
- The PNG is read through preload `readFileBuffer`, which accepts `app://`, http(s), `file://` and plain paths (preload/src/core/ipc.ts:66-104).
- It then becomes a Blob URL, an `<img>`, and is `decode()`d (:181-222).
- Decoded images go into a never-evicted `clutImageCache` (:12-16).
- Upload is **RGB8** (alpha dropped), **NEAREST**, CLAMP_TO_EDGE (:267-283).

**Level detection** (:252-258): `len = min(w,h)`; take the smallest `l ≥ 2` with `l³ ≥ len`; `level = l²`. Examples: 512² → level 64; 4096² → 256.

**Shader** (WebGL2 `highp`, :66-143):
1. `c = clamp(rgb,0,1)·(level−1)`, `base = floor(c)`, `next = min(base+1, level−1)`, `f = c − base`.
2. Eight lattice fetches at `offset = r + level·g + level²·b`, `x = mod(offset, W)`, `y = floor(offset/W)` (this **assumes a square image**), sampled at `uv = ((x,y)+0.5)/W`.
3. Manual trilinear interpolation over R, then G, then B (:80-125).
4. `out.rgb = mix(src, lut, intensity)` in sRGB; `a = src.a` (:134-138).

**Context and fallbacks:**
- Own context `"preview-webgl-filter-hald"`. Without WebGL2, or when the CLUT is not yet preloaded, the filter passes the image through (:28,49-53,306-323).
- Re-uploads all CLUTs after a context restore (:159-179).
- Singletons: preview `useWebGLHaldClut.ts:10-53`; export `export-renderer/src/webgl-filters/hald-clut-singleton.ts:3-22`.

**Which file is used:**
- The applicator uses `fullPath || smallPath` (renderer/src/components/preview/clips/apply/filter.ts:39,53,90).
- Strength is `clamp(intensity/100, 0, 1)`; undefined means 1.0 (renderer/src/lib/applicator-utils.ts:159-163).

**Packs:**
- **Source:** git submodule `clut-filters` at `apps/app/packages/renderer/public/filters` (repo `.gitmodules`). About 900 MB, mostly the `full` pack, and optional (repo `BUILDING.md:12`).
- **Layout:** `filters/{small,full,examples}/<category_dir>/<name>.<ext>`.
- **Scan** (`fetchFilters`, preload/src/filters/fetch.ts:107-190): `small` (PNG, recursive) is the canonical list. `id` is the basename, which is **not unique across categories**. `name` is the Title Case of the basename, and `category` is the Title Case of the parent directory. `fullPath` is the matching file in `full/`, falling back to `smallPath`. The example image is matched by basename (.jpg, .jpeg, .png, .webp), falling back to the small PNG (:71-176).
- **Packaging:** the renderer postbuild runs renderer/scripts/prune-filters.mjs:8-30, which deletes `dist/filters/full` unless `APEX_BUNDLE_FILTERS_FULL=1`. electron-builder also excludes it (apps/app/electron-builder.cjs:18,80-81). So **in packaged builds `fullPath === smallPath`**.
- **Menu:** `FilterMenu` loads through react-query `["filters"]` (staleTime ∞). It offers search over name and category, per-category carousels and "View all", and drags `{type:"filter", fillCanvas:true}` (renderer/src/components/menus/FilterMenu.tsx:15-26,226-268).

### 3.3 Applicator mechanics

Selection rules (which filters apply, their order, and preview vs export differences) are in §2.4.
- **Per-clip, not a composite adjustment layer.** Each target clip's own raster is graded before compositing: partially transparent overlaps are graded per layer. The background colour is never graded. A filter on a lower track has no effect.
- **Text, shape and draw clips** use the custom Konva filter `Konva.Filters.Applicator`. It converts ImageData to a canvas, runs the applicators, and writes the result back (renderer/src/components/preview/clips/custom/ApplicatorFilter.tsx:8-30). It runs on the node cache at `pixelRatio:2` (TextPreview.tsx:1587; ShapePreview.tsx:414; custom/DrawingLine.tsx:188). Drawings are filtered **per line**.
- **Export, video and image:** `ensureResources()`, then `apply()`, on the native-resolution texture (export-renderer/src/export.ts:454-472,583-600).
- **Export, shape and text:** rendered onto a temp Layer, then `toCanvas({pixelRatio:1})` at full output size, then apply, then composite (:752-788,918-950).
- **Export, drawing:** the same per line, accumulated with each line's composite op (:282-391).
- **Export CLUT lifetime:** acquired once per export (exporter.ts:617-618,1046).

### 3.4 Preview vs export (effects)

| Aspect | Preview | Export |
|---|---|---|
| Shader code | webgl-filters/*.ts | **Same classes**, imported by relative path (export-renderer/src/webgl-filters/apply.ts:1-7), so the maths is identical |
| Instance lifetime | Lazy, one per component | New instance per pass, per clip, per frame (apply.ts:34-35,133-135) |
| Raster resolution | Clip display size, at most ~1067×600 (VideoPreview.tsx:760-771); Konva nodes cached at 2× | **Native media resolution** before crop (export.ts:415-427,532-543); text, shape and draw at 1× output size |
| Resolution-dependent effects | blur (≤10 texel radius), sharpness (1-texel kernel) and noise **differ** between the two paths | Colour ops, vignette and LUT match |
| Masks while the mask tool is active | Skipped for video | Always applied |
| Noise seed | Random on every redraw | Random per frame, so export is non-deterministic |

## 4. Masks

Masks exist only on `video` and `image` clips (`clip.masks: MaskClipProps[]`, renderer/src/lib/types.ts:117, :129). New media clips start with `masks = []` (renderer/src/components/timeline/TimelineEditor.tsx:912-914). Masks are applied per clip to the **full, uncropped source frame** *before* WebGL filters and applicators (preview: renderer/src/components/preview/clips/VideoPreview.tsx:893-895, ImagePreview.tsx:661-663 then :679; export: export-renderer/src/export.ts:430-438 then :441, :547-567).

### 4.1 Data model (persisted)

| Field | Type | Default at creation | Units / notes | Cite |
|---|---|---|---|---|
| `id` | string | uuidv4 | | types.ts:261; Preview.tsx:1207 |
| `clipId` | string? | owning clip id | Not rewritten by paste (see §14.3) | types.ts:262 |
| `tool` | `"lasso" \| "shape" \| "draw"` | creating tool | Only `lasso`/`shape` render; legacy `"rectangle"` accepted by overlay only | types.ts:232,263; MaskPreview.tsx:238 |
| `featherAmount` | number | mask store value, default `2` | **Stored, never read by any renderer** | types.ts:264; lib/mask/index.ts:27 |
| `brushSize` | number? | not set | Never written on a mask | types.ts:265 |
| `keyframes` | `Record<number, MaskData>` (Map allowed at runtime) | `{ [localFrame]: data }` | Key = clip-local frame int; images always `0` | types.ts:267; Preview.tsx:1195-1198,1410-1413 |
| `transform` | `ClipTransform` snapshot | clip transform at creation | Reference space for scale ratios | types.ts:269; Preview.tsx:1224,1442 |
| `createdAt`/`lastModified` | ms epoch | `Date.now()` | | types.ts:271-272 |
| `inverted` | boolean? | unset | **Stored + in signature, never read by renderers; no UI writes it** | types.ts:274,591 |
| `maskColor` / `maskOpacity` / `maskColorEnabled` | hex `#RRGGBB` / 0–100 % / bool | `#FFFFFF` / 100 / true | Fill *inside* region | types.ts:278-280; Preview.tsx:1218-1220 |
| `backgroundColor` / `backgroundOpacity` / `backgroundColorEnabled` | hex / 0–100 % / bool | `#000000` / 100 / true | Fill *outside* region | types.ts:275-277; Preview.tsx:1221-1223 |

`MaskData` (renderer/src/lib/types.ts:235-258): `lassoPoints?: number[]` (flat `[x0,y0,x1,y1,…]`), `lassoPointsBinPath?: string` (persistence only), `shapeBounds?: { x, y, width, height, rotation? (deg), shapeType?, scaleX?, scaleY? (default 1, no UI sets ≠1 except Reset→1), renderOnce? (written for polygon/star at Preview.tsx:1430, never read) }`. Export-side mirror types: export-renderer/src/masks/apply.ts:18-43, export-renderer/src/blit.ts:107-131. Legacy key `rectangleBounds` is still read as a fallback (ShapeMaskPreview.tsx:124, ShapeMaskTransformProperties.tsx:73, Preview.tsx:1498).

Transient tool state (not persisted): `useMaskStore` `{ tool: "lasso", shape: "rectangle", brushSize: 10, featherAmount: 2, activeMaskId, isMaskDragging, isOverMask }` (renderer/src/lib/mask/index.ts:6-38). Selected mask id lives in controls store (renderer/src/lib/control.ts:90,330-331).

### 4.2 Tools and creation rules

| Tool | Input | Creation rule | Cite |
|---|---|---|---|
| Lasso | Free path; one point per mousemove, no decimation/simplification | Needs ≥3 points; points normalized to clip-local space; target = last selected clip, else topmost visible video/image clip at focus frame on a non-hidden track | Preview.tsx:631-647, 813-826, 1176-1326, 419-457 |
| Lasso overlap handling | vs. existing lasso masks at their active keyframe | Containment (all vertices inside, polygon.ts:38-52): existing kept if larger, else removed; **new mask is always added** (comment says "discard new" but `push` is unconditional). Edge intersection (polygon.ts:75-105): existing removed, points merged as **convex hull** (Graham scan, polygon.ts:108-181) into the new mask | Preview.tsx:1238-1312 |
| Shape: rectangle / ellipse | Drag box (rotation-aware: corners normalized into clip-local space, AABB taken) | Discarded if width or height ≤ 5 units; `rotation: 0` | Preview.tsx:649-684, 828-933, 1336-1440, 1390 |
| Shape: polygon | Same; aspect forced to w/h = 1.1543665517482078 (=2/√3) | Upward equilateral triangle, fixed 3 sides | Preview.tsx:872-895, 1401-1407 |
| Shape: star | Same; forced square | 5 points, inner radius = 0.5 × outer | Preview.tsx:862-871, 1397-1400 |
| Shape overlap handling | AABB containment only (ignores rotation/shape type) | Existing contained shapes removed unless larger; new shape not added if it sits inside a larger existing shape | Preview.tsx:1447-1572 |
| Draw (brush) | Key `3` in mask mode, or Brush in the Mask tab's picker (AddMaskTools.tsx) | **Stub**: strokes drawn as a 40%-opacity blue Konva line, never committed to a mask | Controls.tsx:472-475; Preview.tsx:686-700, 936-963, 2245-2261 |

Shape kinds have **no** sides/points/corner-radius parameters: triangle and 5-point star are hard-coded in shader and overlay (shape.ts:35, 128-166; ShapeMaskPreview.tsx:552-567). Overlay transformer: star/polygon corner anchors only, rect/ellipse 8 anchors, rotation snaps every 45° (ShapeMaskPreview.tsx:607-632).

### 4.3 Coordinate space and transform remapping

| Stage | Formula / behavior | Cite |
|---|---|---|
| Store (world → mask) | `p_mask = R(−θ)·(p_world − (clip.x, clip.y)) + cropOff`, `cropOff = (width/crop.w·crop.x, height/crop.h·crop.y)` (pre-scale width/height). Origin = top-left of the *uncropped* media at display size, un-rotated, editor world units | Preview.tsx:70-139, 141-163; crop.ts:3-38 |
| Overlay (mask → world) | Konva outer group `{x, y, rotation}` of clip, inner group offset `−cropOff` | MaskPreview.tsx:45-74, 222-263 |
| Render (mask → source-canvas px) | `x' = [crop.x·dispW + (x − orig.x − maskCropOff.x)·(clip.sX/mask.sX)·crop.w] · canvasW/(clip.width·clip.sX)`, `dispW = abs(clip.width·clip.sX)`, `orig = clip.originalTransform` (`x=y=0` by construction, clip.ts:744-746); width scaled by `(clip.sX/mask.sX)·crop.w·canvasW/dispW`; identical for y. Lasso uses the same mapping per point | shape.ts:205-298, 418-432; lasso.ts:108-216, 348-366 |
| Clip resized/rotated via Konva transformer | `setClipTransform(…, applyToMasks=true, remapMasks=true)`: every keyframe scaled by uncropped `toW/fromW`, `toH/fromH` (x, y, width, height, lasso points); `shapeBounds.rotation += normalize(to.rot − from.rot)` (lasso points are not rotated); `mask.transform := new transform` | VideoPreview.tsx:1740-1753; ImagePreview.tsx:852-866; clip.ts:730-742; clipTransformUtils.ts:23-144; transformUtils.ts:136-187 |
| Clip moved (x/y only) | No mask change (masks are clip-relative) | — |
| Export of a single clip (`useOriginalTransform`) | Masks remapped via `remapMaskForMediaDialog` (relative position × size ratio, rotation delta) into a target-canvas transform | prepareExportClips.ts:627-736; transformUtils.ts:291-417 |
| Media dialog preview | Two-step proportional remap current→native→override | MediaDialog.tsx:300-336 |

### 4.4 Rasterization (WebGL, shared by preview and export)

Both mask kinds draw a full-screen quad into a shared WebGL1 canvas (`premultipliedAlpha:false`, `preserveDrawingBuffer:true`; base.ts:25-34) with hard binary inside/outside tests — **no anti-aliasing, no feather**.

| Item | Shape mask (shape.ts) | Lasso mask (lasso.ts) |
|---|---|---|
| Inside test | Rect: rotate about **top-left** `(x,y)`, `0≤u≤w, 0≤v≤h` (:96-106). Ellipse: rotate about center, `(u/rx)²+(v/ry)²≤1` (:107-123). Triangle: apex `(0,−h/2−h/6)`, base `(±w/2, h/2−h/6)`, barycentric (:128-132). Star: 10 alternating vertices `r·(sin a, −cos a)`, `a=iπ/5`, inner = 0.5·outer per axis, even-odd (:135-166). Rotation = `shapeBounds.rotation` deg→rad, applied as `R(−θ)` to the pixel offset (:88-89, 562-570); `w,h` multiplied by `shapeBounds.scaleX/Y` (:80-86, 572-579) | Even-odd ray casting over points (:55-79). Points clamped to `[0,W]×[0,H]`, normalized and quantized to 16 bits per axis, packed RGBA8 (x hi/lo, y hi/lo) into a `numPoints×1` NEAREST texture (:415-472); decoded in shader (:43-53). Loop cap `MAX_POINTS = 4096` (:64); `<3` points → no-op (:368-369) |
| Pixel origin | `gl_FragCoord` flipped to top-left (:71) | same (:83) |

Compositing per pixel (shape.ts:171-190; lasso.ts:87-104):
`out = inside ? (maskEnabled ? (maskRGB, maskOpacity/100) : src) : (bgEnabled ? (bgRGB, bgOpacity/100) : src)`; opacities clamped to [0,1] (shape.ts:438-448). Undefined colors fall back to mask `#ffffff`, bg `#000000`; undefined enable flags → **false** (shape.ts:435-448; lasso.ts:386-399). Hex parse accepts only 6-digit hex, otherwise black (shape.ts:360-369). The draw uses `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)` (single-func, applies to alpha too) onto a target cleared to `(0,0,0,0)` (shape.ts:598-604; lasso.ts:566-572), so the stored straight-alpha pixel is `(rgb·a, a²)`; only `a=1` pixels pass through unchanged.

Multiple masks (useWebGLMask.ts:88-140; export masks/apply.ts:109-146): applied sequentially in array order, each pass reading the previous pass's output; for every mask after index 0 `backgroundColorEnabled` is forced `false`. With the creation defaults (white-in/black-out) the result is a binary **union** matte. A freshly created mask therefore replaces the clip pixels with a white-on-black matte until the user changes operations.

Operation presets (MaskOperationsProperties.tsx:38-94) — exact field writes:

| Button | maskColor/opacity/enabled | bgColor/opacity/enabled |
|---|---|---|
| Binary | `#ffffff`/100/true | `#000000`/100/true |
| Transparent Foreground | –/–/**false** | –/–/true |
| Transparent Background | –/–/true | –/–/**false** |
| Gray | `#808080`/100/true | `#000000`/100/true |
| Binary Inverted | `#000000`/100/true | `#ffffff`/100/true |
| Semi-Transparent | `#ffffff`/50/true | `#000000`/100/true |

None of the presets sets an opacity to 0; true transparency requires setting a ColorInput percent to 0 (ColorInput.tsx:140-160). Per-mask "Invert" is only the color-swap preset; the `inverted` flag does nothing.

### 4.5 Keyframes

| Aspect | Behavior | Cite |
|---|---|---|
| Keyed data | Only geometry (`lassoPoints` or `shapeBounds`); colors/opacity/feather are per mask | types.ts:235-281 |
| Interpolation | **None (step/hold)**: 1 key → always that key; `frame < first` → first key; else greatest key ≤ frame | shape.ts:392-415; lasso.ts:322-345; MaskPreview.tsx:132-141 |
| Write key (edit/create) | Video: `round(focus − startFrame − trimStart)` (`getLocalFrame`); image: `0`. Edits upsert a key at that frame, cloning data from the nearest key ≤ target | keyframeUtils.ts:51-101; clip.ts:2093-2098; LassoMaskPreview.tsx:151-203; ShapeMaskPreview.tsx:204-222 |
| Render lookup frame (preview & export, video) | `floor(max(0, focus − startFrame + trimStart) · max(0.1, speed))` | VideoPreview.tsx:328-349, 1391-1410; export.ts:549-566; blit.ts:972-990 |
| Render lookup (image) | Preview passes global `focusFrame`; export uses `0`; both resolve to key `0` | ImagePreview.tsx:663; masks/apply.ts:79-88 |
| Overlay / property-panel lookup | `focus − (startFrame + trimStart)` with nearest-key rule | MaskPreview.tsx:125-141; MaskPropertiesPanel.tsx:48-64 |
| Timeline UI | Diamonds only for the selected **video** clip in mask mode; drag snaps to integer local frames clamped `[0, clipDuration]`, overwrites a key already at the target; click seeks to `local + startFrame + trimStart`; Delete/Backspace (capture phase) removes key; removing the last key removes the mask; display decimation min spacing 4 px | TimelineClip.tsx:333-340, 2074-2084; MaskKeyframes.tsx:164-169, 357-389, 416-541, 547-579; clip.ts:2100-2105 |
| Split | Keys `< cutLocal` go left, rest go right, keys not re-based; `cutLocal = cutFrame − startFrame + trimStart`; image masks copied to both | clip.ts:1607-1712 |
| FPS change | Clip frames rescaled; mask keyframe keys **not** rescaled | clip.ts:2026-2050 |

### 4.6 Editing UI (TS-side, brief)

Overlays render only while `tool === "mask"` (MaskPreview.tsx:200), with marching ants (white stroke + black dash `[4.5,4.5]`, offset +0.5/frame mod 20, fill `rgba(0,127,245,0.4)`) (MaskPreview.tsx:165-179; LassoMaskPreview.tsx:339-361). While in mask mode the masks are **not** applied to preview pixels (useWebGLMask `disabled` + tool check; VideoPreview.tsx:287-292, 895). Lasso: drag-to-translate only, no anchors (LassoMaskPreview.tsx:100-215, 364-372); property panel edits bbox-center X/Y (LassoMaskTransformProperties.tsx:120-136). Shape: drag/resize/rotate via transformer (ShapeMaskPreview.tsx:88-241, 292-395); panel edits X, Y, Rotation, W/H (rect/ellipse) or single Size setting W=H (polygon/star), Reset sets rotation 0, scale 1 (ShapeMaskTransformProperties.tsx:82-125, 156-215). Mask list chips with remove (MaskPropertiesPanel.tsx:75-80, 112-138). Delete key removes the selected mask in mask mode (Controls.tsx:290-311); mask sub-tool shortcuts 1/2/3 (Controls.tsx:459-476).

### 4.7 Preview vs export

| Aspect | Preview | Export | Cite |
|---|---|---|---|
| Engine | `ShapeMask`/`LassoMask` classes | Same classes imported from renderer | masks/apply.ts:1-2 |
| GL context | One per preview instance, reused | New `ShapeMask`+`LassoMask` created and disposed on **every** `applyMasksToCanvas` call (per clip per frame) | useWebGLMask.ts:25-38; masks/apply.ts:103-105, 154-161 |
| Target canvas | Preview frame canvas | Source natural size (image) / decoded frame size (video), crop applied afterwards by Konva | export.ts:415-428, 475-484, 532-546 |
| `originalTransform` | Passed (`useOriginalTransform=true` default) | Passed | useWebGLMask.ts:22, 102; masks/apply.ts:124 |
| ffmpeg fast path | n/a | Disabled when any mask exists | exporter.ts:375 |
| Video poster (pre-decode) | Masks applied with shifted args (`clipTransform=undefined`, `mask.transform` in the `originalClipTransform` slot → no coordinate mapping), then masked again by `drawWrappedCanvas` | n/a | renderer/src/lib/media/timeline.ts:850-901; VideoPreview.tsx:1036-1068 |

### 4.8 Binary `.bin` persistence

- Renderer serializes `keyframes` Map→Record keyed by frame number (frames, **not ticks**) (renderer/src/lib/middlewares/json-persistence.ts:169-199, 278-309); on load drops legacy `tool:"touch"` masks (:735-746).
- Main process, on every `projects:save-json`, moves each mask's `lassoPoints` into one file per mask and replaces them with `lassoPointsBinPath` (main/src/modules/JSONPersistenceModule.ts:815-857, 317-426). `shapeBounds` stay inline in JSON.
- Path (relative to `<userData>/projects-json/`): `local/mask/project-<projectId>/mask-<clipId>-<maskId>-lasso.f32.bin`, ids sanitized `[^a-zA-Z0-9_-]→_` (JSONPersistenceModule.ts:213-214, 276-315).
- Layout: Float32Array, platform-native byte order: `[k, frame₀, len₀, …, frame_{k−1}, len_{k−1}, values₀…, values_{k−1}…]`, `len` = float count (2×points); non-finite → 0 (:381-405).
- Load (`hydrateDocWithMaskBinaries`, :546-811; called at :912): reads the first `lassoPointsBinPath` per mask, rebuilds `lassoPoints` for each keyed frame. Legacy per-keyframe files (numeric segment before `lasso` in the filename) are read as a single raw point array applied to every keyframe sharing that path (:596-608, 669-679). Missing/invalid file → `lassoPoints` left undefined (mask silently not rendered).
- A parallel `contours` / `contoursBinPath` codepath (`…-contours.f32.bin`, layout `[k, frame, nContours, len…, values…]`) exists for a field not in `MaskData` (:428-541).
- Files are overwritten on each save and **never deleted** (not on mask removal, nor on project delete, which removes only the JSON and `<userData>/media/<folderUuid>`; :1165-1214).

## 5. Text

Konva is `konva@9.3.22` (`apps/app/node_modules/konva`). World units = preview rect, whose height is always `BASE_LONG_SIDE = 600` and width is `600 × aspect` (`renderer/src/lib/settings.ts:2`, `renderer/src/components/preview/Preview.tsx:501-510`).

### 5.1 Persisted `TextClipProps` (`renderer/src/lib/types.ts:161-192`)

| Prop | Type / units | Creation value (`Preview.tsx:1782-1826`) | Render fallback | UI range | Rendering effect |
|---|---|---|---|---|---|
| `text` | string; may contain `\n` | `"Default Text"` | `"Double-click to edit"` (`TextPreview.tsx:164`); export `""` (`export-renderer/src/export.ts:819`) | textarea (`TextProperties.tsx:173-177`) or in-canvas editing | Konva.Text content after `textTransform` |
| `fontSize` | number, world px | 32 | 48 (`TextPreview.tsx:165`, `export.ts:822`); panel shows 16 if unset (`TextProperties.tsx:191`) | slider 10-256, step 1 (`TextProperties.tsx:189-198`) | Font size. Export multiplies it by `exportH/600` |
| `fontWeight` | number | 400 | 400 | Bold toggles 400↔700 (`TextProperties.tsx:148-151`) | Only `>=700` counts: font style becomes `"<fontStyle> bold"`, else `"<fontStyle> normal"` (`TextPreview.tsx:2241`, `export.ts:885-886`) |
| `fontStyle` | `"normal"\|"italic"` | normal | normal | Italic toggle (`TextProperties.tsx:153-158`) | CSS font style |
| `fontFamily` | string | `"Arial"` | `"Arial"` | Combobox, 20 fonts (§5.2) | CSS font family |
| `color` | hex string | `"#ffffff"` | `"#000000"` (`TextPreview.tsx:169`, `export.ts:887`) | ColorInput (§5.6) | Konva `fill` |
| `colorOpacity` | 0-100 | 100 | 100 | ColorInput % | Passed as Konva `fillOpacity`, which Konva 9.3.22 does not have, so it has **no effect** (only the caret uses it, `TextPreview.tsx:2458`) |
| `textAlign` | `left\|center\|right` | left | left | buttons (`TextProperties.tsx:236-245`) | Konva `align`: per-line x offset `(W−lineW)/2` or `W−lineW` |
| `verticalAlign` | `top\|middle\|bottom` | top | top | buttons (`:246-255`) | Konva: `alignY = (H − nLines·lineHeightPx)/2` or `H − nLines·lineHeightPx` (`Text.js:122-127`) |
| `textTransform` | `none\|uppercase\|lowercase\|capitalize` | none | none | buttons (`:256-265`) | Applied when rendering (`TextPreview.tsx:26-41`, `export.ts:1000-1013`). `capitalize` splits on `" "` and uppercases the first character of each word. The panel also **rewrites the stored `text`** (`TextProperties.tsx:141-146`) |
| `textDecoration` | `none\|underline\|overline\|line-through` | none | none | the panel can toggle only underline (`:160-165`) | Konva draws underline and line-through only. Line width is `fontSize/15`. With `_fixTextRendering`, the y offset is `+round(fontSize/4)` for underline and `−round(fontSize/4)` for line-through (`Text.js:140-165`) |
| `strokeEnabled`, `stroke`, `strokeWidth` | bool, hex, world px | false, `#000000`, 2 | same (`TextPreview.tsx:176-178`) | width 1-20, step 0.5 (`TextStrokeSection.tsx:44-53`) | Konva text stroke, centered on the glyph outline and drawn after the fill (`fillAfterStrokeEnabled=false`, `Shape.js:459`). Export scales the width by `H/600` |
| `strokeOpacity` | 0-100 | 100 | 100 | ColorInput % (`TextStrokeSection.tsx:35-43`) | **Never read** by preview or export |
| `shadowEnabled`, `shadowColor`, `shadowOpacity` | bool, hex, 0-100 | false, `#000000`, 75 | same (`TextPreview.tsx:181-186`) | ColorInput (`TextShadowSection.tsx:57-65`) | Canvas shadow, opacity `/100` |
| `shadowBlur` | world px | 4 | 4 | 0-50, step 1 (`TextShadowSection.tsx:66-75`) | Canvas `shadowBlur`. Export scales it by `H/600` |
| `shadowOffsetX/Y` | world px | 2 / 2 | 2 / 2 | inputs with min 0.1, step 0.1 (`:100-115`) | Shadow offset. Export scales it by `H/600` |
| `shadowOffsetLocked` | bool | true | panel treats unset as true (`:25`) | lock button | When locked, an edit to X or Y writes both (`:27-41`). UI only |
| `backgroundEnabled`, `backgroundColor`, `backgroundOpacity`, `backgroundCornerRadius` | bool, hex, 0-100, world px | not set (undefined) | false, `#000000`, 100, 0 (`TextPreview.tsx:189-192`) | radius 0-50 (`TextBackgroundSection.tsx:46-57`) | A separate Rect (§5.3) |
| `transform` | `ClipTransform` | box dragged with the text tool, `scaleX/Y=1`, `rotation 0`, `opacity 100` | 400×100 centered in the rect if missing (`TextPreview.tsx:376-393`, `prepareExportClips.ts:501-525`) | Position panel | x, y, w, h define the text box. Rotation is in degrees about the top-left. Opacity is 0-100 |

These are **not supported**: letter spacing, line height, padding, wrap mode, ellipsis, and per-run styling. Konva defaults apply: `padding 0`, `lineHeight 1`, `wrap "word"`, `ellipsis false`, `letterSpacing 0` (`Text.js:431-437`).

### 5.2 Fonts (`TextProperties.tsx:34-75`; loaded in `renderer/src/main.tsx:9-94`)

| Source | Families | How loaded |
|---|---|---|
| OS system fonts (not bundled) | Arial, Helvetica, Times New Roman, Georgia, Verdana, Courier New, Comic Sans MS, Impact, Trebuchet MS | Whatever the OS has installed |
| `@fontsource/*` npm packages, bundled `@font-face` CSS | Poppins, Montserrat, Roboto, Open Sans, Raleway, Merriweather, Playfair Display, Nunito (400/500/600/700, each with italic); Lato and PT Sans (400/700, each with italic); Oswald (400/500/600/700, **no italic** files) | Side-effect CSS imports in `main.tsx`, 76 imports in total |

The `isPremium`/`isDownloaded` flags are UI only (`Combobox.tsx:22-23,145`). Weights 500 and 600 are loaded but cannot be selected. Nothing anywhere waits on `document.fonts`.

### 5.3 Layout and rasterization (preview: `renderer/src/components/preview/clips/TextPreview.tsx`)

- **Box model.** `Konva.Text` sits at `(x,y)` with `width/height = transform.width/height`, `scaleX = scaleY = 1` (forced), and rotation about the top-left (`:2231-2299`). A resize via the Transformer turns scale into width/height, so the text reflows and the font size stays the same (`:1708-1748`, inline handler at `:2283-2299`).
- **Wrapping and overflow.** Konva wraps at word boundaries within the width and breaks words longer than the width by character. With a fixed height, lines that don't fit are **dropped** (`Text.js:284-381`). Auto-grow happens only during in-canvas editing: height becomes `max(height, ceil(textHeight + 20))`, and it never shrinks (`:1904-1928`).
- **Baseline.** `Konva._fixTextRendering = true` (`:24`, and `export-renderer/src/blit.ts:16`). The baseline is `alphabetic`, and line y is `(ascent − descent)/2 + lineHeightPx/2` using `measureSize('M')` font-box metrics (`Text.js:107-114`).
- **Background.** A separate `Konva.Rect` with the same x, y, w, h and rotation. Its opacity is `bgOpacity/100 × transform.opacity/100`. Its corner radius is clamped to `[0, min(w,h)/2]` (`TextPreview.tsx:2187-2194`, `:2210-2229`, `lib/konva/sanitizeCornerRadius.ts:11-32`). The text node's own opacity is `transform.opacity/100`.
- **Caching and filters.** The Text node and the background are each rasterized with `cache({pixelRatio: 2})` when the user is not interacting or editing (`:1580-1622`, `:1647-1677`). Filter-clip applicators run on that cached bitmap through `Konva.Filters.Applicator` (`:21`, `:1531-1538`). While editing, the cache is cleared and filters are disabled (`:1624-1645`, `:2217`, `:2282`).
- **Visibility.** The text renders only when `startFrame ≤ focusFrame ≤ endFrame` (inclusive, shifted by the group start in input mode, `:92-105`). It is clipped to the canvas rect (`:2203-2208`).
- **Snapping.** The threshold is 4 screen px (`:144`). Targets are the center, 25% and 75% lines, and the edges, for both drag (`:208-290`) and resize (`:292-362`). The Transformer has 8 anchors, `keepRatio=false`, rotation snaps every 45°, and rotation is off while editing (`:2488-2516`).

### 5.4 In-canvas editing (preview only, but it changes the persisted `text`)

- **Entering edit mode:** double-click with the pointer tool. In edit mode, double-click selects a word and triple-click selects all (500 ms / 10 px window) (`:1440-1505`).
- **Input:** a hidden `<input>` inside `react-konva-utils <Html>` captures Mod+A/C/X/V, Escape, Home/End, arrows, Delete/Backspace, Enter and printable characters (`:665-1130,2464-2485`).
- **Caret and selection:** hit-testing uses an off-screen `pre-wrap` div and the Range API (`:466-605`). Store writes are batched to one per rAF (`:641-662`).
- **Line breaks:** Enter inserts `"\n"+U+200B`, and all U+200B are stripped when editing ends (`:1091-1124,1857-1881`).
- **Exit:** Escape, a click outside, deselection, or the playhead leaving the clip (`:199-206,1814-1890`).

### 5.5 Creation, export and thumbnail

- **Creation** (`Preview.tsx:1733-1828`). The text tool (key `T`, `Controls.tsx:514-518`) drags a box, which must be at least 5×5 world units. It **always creates a new `"text"` track** with `addTimeline(..., -1)`. The clip spans `focusFrame … min(focusFrame + 3·DEFAULT_FPS (=72), totalFrames−1)`.
- **Export** (`export-renderer/src/export.ts:790-954`, called from `exporter.ts:765-769` and `:1404-1408`): The transform is mapped through `normalizedTransform` = `transform / (worldW, worldH)` (`prepareExportClips.ts:132-157`, `:578-603`), then multiplied by the export pixel size (`export.ts:1015-1051`). `canvasScale = exportH / 600` (`:807`) scales `fontSize`, `strokeWidth`, `shadowBlur`, `shadowOffsetX/Y` and `backgroundCornerRadius` (`:823-867`). `scaleX/scaleY` come from the transform, and they are always 1 for text. `shadowForStrokeEnabled: false` in export (`:905`). The preview leaves Konva's default of `true`, so in the preview the stroke also casts a shadow. The background radius is not clamped in export. With applicators, the nodes go to a temporary layer, are rasterized with `toCanvas({pixelRatio: 1})` at full canvas size, run through the applicators, and come back as a `KonvaImage` (`:918-952`). Export runs inside the renderer document (`@app/export-renderer` is imported by `Topbar.tsx:42`, `GlobalContextMenu.tsx:11` and `json-persistence.ts:29`), so the `@fontsource` faces are available to it.
- **Thumbnail.** A solid `#E3E3E3` fill (`generateTimelineThumbnailText.ts:11-12`). The clip label shows the text with only the first `\n` replaced by a space (`TimelineClip.tsx:1988-2004`).

### 5.6 Color values (shared by text, shapes and drawing)

Colors are stored as hex `#RRGGBB`. Opacity is stored separately as 0-100. When the user types a color, ColorInput accepts `#RGB`/`#RRGGBB` as typed, or any CSS color that it converts through a 2D context to `#rrggbb` (`ColorInput.tsx:55-90`). The picker writes `Color(...).hex()` plus `round(alpha·100)` (`:254-270`).

## 6. Shapes and freehand drawing

### 6.1 Shape clip props (`types.ts:141-159`)

| Prop | Type / units | Creation (`Preview.tsx:1888-1918`) | Fallback (`ShapePreview.tsx:159-168`, `export.ts:651-655`) | UI | Notes |
|---|---|---|---|---|---|
| `shapeType` | `rectangle\|ellipse\|polygon\|line\|star` | `viewport.shape` | rectangle | The Stickers tab's Shapes section (`CanvasToolsMenu.tsx`, `lib/shape-presets.ts`) adds any of the five at the playhead. Keys 1-5 in shape mode select rectangle, ellipse, polygon, line, star (`Controls.tsx:429-456`) | Fixed after creation |
| `fill` / `fillOpacity` | hex / 0-100 | `#E3E3E3` / unset | `#3b82f6` / 100 | ColorInput (`AppearanceProperties.tsx:121-129`) | Converted to `rgba(r,g,b,op/100)` by `hexToRgba`, which assumes 6-digit hex (`ShapePreview.tsx:693-709`, `export.ts:1053-1059`) |
| `stroke` / `strokeOpacity` | hex / 0-100 | `#E3E3E3` / unset | `#1e40af` / 100 | ColorInput (`:130-138`) | Same `rgba` conversion |
| `strokeWidth` | world px | 1 | 2 | Input, step 1, min 0 (`:139-149`) | Konva stroke, centered. It scales with the node's scale (`strokeScaleEnabled` default) |
| `sides` (polygon) | int | 3 | 3 | 3-12 (`LayoutProperties.tsx:43-47`, `:250-261`) | |
| `points` (star) | int | not set | 5 | Input min 3 / max 12, but the setter rejects values below 4 or above 100 (`LayoutProperties.tsx:49-54`, `:263-274`) | |
| `transform.cornerRadius` | world px | 0 | 0 | 0-100, rectangle and polygon only (`AppearanceProperties.tsx:38-45`, `:90-112`) | Preview clamps it to `[0, min(w,h)/2]` (`ShapePreview.tsx:712-716`) |
| `transform.opacity` | 0-100 | 100 | 100 | slider (`AppearanceProperties.tsx:79-86`) | Node opacity `/100` (`ShapePreview.tsx:727`) |

**Geometry.** Preview is `ShapePreview.tsx:700-842` and export is `export.ts:679-741`; they are identical. Here `w`, `h`, `sx`, `sy` come from the transform.

| Type | Konva node | Anchor / rotation pivot | Geometry |
|---|---|---|---|
| rectangle | `Rect` | top-left `(x,y)` | `w×h`, `cornerRadius` |
| ellipse | `Ellipse` | center `(x + w·sx/2, y + h·sy/2)` | `radiusX = w/2`, `radiusY = h/2` |
| polygon | custom `RoundedRegularPolygon` (`custom/RoundedRegularPolygon.tsx:52-121`; export `export.ts:1061+`) | center | `R = min(w/√3, h/1.5)`. Vertex n is `(R·sin(2πn/s), −R·cos(2πn/s))`, so the first vertex is at the top. Each rounded corner is a `quadraticCurveTo` with the vertex as control point and endpoints moved `min(cornerRadius, min(adjacent edge)/2)` along each edge |
| line | `Line` | `(x,y)` | `points [0,0,w,0]`, so the line is always horizontal and `h` and `fill` are ignored |
| star | `Star` | center | `outerRadius = min(w,h)/2`, `innerRadius = outer/2`. Preview writes this as `min/4` (`ShapePreview.tsx:813`); the value is the same |

**Transform persistence** (`ShapePreview.tsx:541-600`). For rectangle, ellipse and line, scale is baked into `width/height` and `scale` is reset to 1. For polygon and star, `scaleX/Y` are kept and `w/h` don't change. For centered types, the stored `x,y` is `center − (w·sx/2, h·sy/2)`.

**Preview rendering.** The node is cached with `cache({pixelRatio: 2})` (`:404-430`) and uses the `Applicator` filter. It sets `perfectDrawEnabled: false` and `shadowForStrokeEnabled: false` (`:732-733`) and is clipped to the canvas rect. Snapping and the Transformer work the same as for text (4 px, 45° snaps, 8 anchors, `:948-978`).

**Creation** (`Preview.tsx:1831-1924`). The shape tool (key `S`, `Controls.tsx:525-529`) drags a box in world coordinates:
- A star is forced square: `size = max(w,h)`.
- A polygon's aspect is forced to `w/h = 1.1543665517482078`, which is approximately `√3/1.5`.
- The box must satisfy `w > 5 && h > 5`.
- Each shape gets **a new `"shape"` track**. The clip is 72 frames long, and a polygon gets `sides = 3`.

**Export** (`export.ts:635-788`). Same geometry as the preview, with x, y, w, h taken from `normalizedTransform`. `strokeWidth` and `cornerRadius` are **not** multiplied by `H/600`, unlike text, and the corner radius is not clamped. With applicators, the shape is rasterized on a temporary layer, run through the applicators, and added as a `KonvaImage` (`:752-786`). The timeline thumbnail is a solid `#894c30` fill (`generateTimelineThumbnailShape.ts:11-12`).

### 6.2 Freehand drawing (`DrawingClipProps`, `types.ts:205-228`)

**Drawing tools.** The store is `renderer/src/lib/drawing.ts:29-62`. The tool UI is the Stickers tab's Draw section (`CanvasToolsMenu.tsx`). Keys: `D` selects the draw tool, then `1`/`2`/`3` select brush, highlighter and eraser (`Controls.tsx:479-495`, `:509-513`).

| Tool | Default size (world px) | Size UI | Stored stroke / opacity | Tension | Cap / join | Composite |
|---|---|---|---|---|---|---|
| brush | 8 | slider 1-30 (`CanvasToolsMenu.tsx`) | `color` (default `#FF0000`) / `opacity` (default 100) from the pen's ColorInput | `smoothing`: slider 0-100 → 0-1, default 0.5 | round / round | source-over |
| highlighter | 20 | 1-50 | **forced** `#FFFF00` / **50** (`Preview.tsx:775-781`) | 0 | square / bevel | `multiply`: computed in `DrawingLine.tsx:61-67` and applied **only in export** (§6.3) |
| eraser | 10 | 1-100 | not stored; geometric erase | n/a | n/a | n/a |

**Line schema.** `DrawingLine = {lineId, tool, points: number[] (flat x,y), stroke, strokeWidth, opacity 0-100, smoothing 0-1, transform {x, y, scaleX, scaleY, rotation, opacity}}`.
- Points are in line-local coordinates. At creation they are world coordinates, because the transform starts as identity (`Preview.tsx:1661-1677`).
- Rendering is `world = T(x,y)·R(rotation)·S(sx,sy)·p` (`DrawingLine.tsx:590-610`).
- Tension greater than 0 with more than 2 points uses a Konva cardinal spline. For each interior point p1 with neighbours p0 and p2: `fa = t·d01/(d01+d12)`, `fb = t·d12/(d01+d12)`, `cp1 = p1 − fa·(p2−p0)`, `cp2 = p1 + fb·(p2−p0)`. The first and last segments are drawn as quadratics, the rest as béziers (`konva/lib/shapes/Line.js:8-26`, `:43-55`).
- Opacity is `line.opacity/100`, or 1 for the eraser tool (`DrawingLine.tsx:99`).
- `transform.opacity` is unused.
- The **draw clip has no clip-level transform or opacity** (`DrawingPreview.tsx:261-290`, `Preview.tsx:2681-2694`).
- Each line is cached with `cache({pixelRatio: 2})` and the Applicator filter (`DrawingLine.tsx:182-201`).

**Capture** (`Preview.tsx:735-784`, `:1142-1145`, `:1645-1730`).
- Point space: `world = (pointer − stagePos)/viewportScale`.
- Every mousemove appends a raw point. There is no decimation, simplification or pressure.
- On mouse up: The line is appended to the **first draw clip in `clips` that covers `focusFrame`**, on any track. If no such clip exists, a new clip goes on the first `"draw"` track, and that track is created if missing. The clip is 72 frames long, truncated at the next clip on that track, with a minimum of 1 frame.
- While drawing, the in-progress line is always shown with round caps and tension = smoothing (`:2263-2283`).

**Eraser algorithm** (`renderer/src/lib/eraser-utils.ts`; driver at `Preview.tsx:1070-1140` and `:1592-1643`).
1. It needs a draw clip at the current frame (`Preview.tsx:756-767`). Samples are the pointer positions, with extra samples inserted every 2 world units when the pointer moves more than 2 units (`:1072-1091`).
2. It runs for each `brush`/`highlighter` line. The radius is `eraserSize/2 + strokeWidth/2`. Samples are mapped to line-local space by the inverse translate→rotate→scale (`eraser-utils.ts:17-34`), and the local radius is `r / ((sx+sy)/2)` (`:40-53`).
3. Each segment AB is split at every intersection with a sample circle, found by solving the quadratic (`:81-110`). A sub-interval is kept when its midpoint lies outside all circles (`:116-143`).
4. Contiguous kept pieces are stitched together, the line breaks at gaps, and duplicate points within 1e-6 are removed (`:154-225`). Each piece with at least 2 points becomes a new line with a new `lineId` (`Preview.tsx:1621-1629`).
5. `mergeConnectedLines` then joins lines that have identical style and transform and endpoints within `tolerance = strokeWidth`, using 4 end-to-end orientations. It does 1 pass for the live preview and up to 10 passes on commit (`eraser-utils.ts:285-384`, `Preview.tsx:1135`, `:1601`, `:1633`).
6. The live preview of the result is `tempErased`, which is persisted on mouse up. A draw clip left with no lines is deleted (`DrawingPreview.tsx:246-253`).

**Per-line editing.**
- In pointer mode, a click selects a line (`DrawingPreview.tsx:86-107`).
- The line is transformed through an invisible proxy Rect. The Rect covers the points' bounding box plus half the stroke width (`DrawingLine.tsx:216-262`, `:443-477`), with a Transformer that has 8 anchors and 45° rotation snaps (`:735-760`).
- The result is written to `line.transform` (`DrawingPreview.tsx:109-182`).
- LineProperties offers x, y, rotation, scale X/Y (min 0.1), opacity, and reset (`LineProperties.tsx:30-51`, `:131-190`). The opacity it edits is `transform.opacity`, which has no effect.
- Delete or Backspace removes the selected line (`Controls.tsx:314-331`).

### 6.3 Drawing export (`export.ts:242-392`, `:956-998`)

- **Mapping.** All lines go into a group with `scale = min(W/(600·W/H), H/600)`, which equals `H/600`, centered with offset `((W − rectW·s)/2, (H − 600·s)/2)` (`:251-266`). The line transforms are applied inside that group.
- **Line nodes.** Cap, join and tension are the same as in the preview. The composite operation is `multiply` for the highlighter and `destination-out` for `tool: "eraser"` lines, with `perfectDrawEnabled: false`.
- **With applicators.** Each line is rasterized on its own with `toCanvas({pixelRatio: 1})` and run through the applicators. It is then composited into an accumulation canvas using its own composite operation, and the accumulated result is added as a `KonvaImage` (`:282-391`). In this path, the highlighter's multiply blends only against other lines, not against the underlying video.
- **Thumbnail.** A solid `#9B59B6` fill (`generateTimelineThumbnailDrawing.ts:11-12`).

## 7. Audio

### 7.1 Persisted audio fields

| Field | Clip types | Units | Default | UI range | Cite |
|---|---|---|---|---|---|
| `volume` | audio, video | **dB**; gain = 10^(dB/20) | 0 dB (never written on create) | −60…+20, step 1 | types.ts:113,135; AudioProperties.tsx:60-68; renderer/src/components/preview/clips/AudioPreview.tsx:41,281 |
| `fadeIn` / `fadeOut` | audio, video | **seconds** | 0 | 0…**source asset duration** (not clip length), step 0.1 | AudioProperties.tsx:30-34,69-86 |
| `speed` | audio, video | multiplier | 1 | 0.1…5, step 0.1 | DurationProperties.tsx:32-45 |
| `TimelineProps.muted` | track | bool | false | track header | types.ts:86; clip.ts:545-565 |

- There is **no per-clip mute**.
- Changing speed pauses playback and re-lengthens the clip from the left edge: `endFrame = start + round(oldDur·oldSpeed/newSpeed)`. The trims scale with it so the in-point stays (since 2026-10-18; `speedPatch` in renderer/src/lib/speed.ts).

### 7.2 Decode pipeline (preview + timeline waveform)

| Stage | Behaviour | Cite |
|---|---|---|
| Workers | **One Web Worker per asset URL**, `#audio`/`#video` hash included. Workers are never terminated; the dispose functions have no callers. | renderer/src/lib/media/audio.ts:13-14,51-60,197-218 |
| Open | mediabunny `Input(ALL_FORMATS, UrlSource("app://user-data/<path>"))` → primary audio track → `EncodedPacketSink`. A HEAD request checks for 404 first. Configure times out after 10 s. | renderer/src/lib/media/audio-decoder.worker.ts:90-98,253-307; audio.ts:273-277 |
| Iterate | A new WebCodecs `AudioDecoder` per iterate. Seeks with `getKeyPacket(start)`, reusing the pre-seek if it is within 0.5 s. Decodes until `packet.ts > end+1.0`. Drops samples outside `[start−0.1, end+0.1]`. Posts f32-planar transferables. | worker:344-448,372-403 |
| Flow control | At most 8 un-acked buffers; decode queue of 50. | worker:117-118,432-443 |
| Main thread | Rebuilds an `AudioBuffer` at the **source** sample rate. With fps set, `startTime = startIndex/fps`. | audio.ts:89-115,375-394 |
| Paused | Fire-and-forget pre-seek, skipped if the target moved less than 0.1 s. | AudioPreview.tsx:315-327 |
| Hash filtering | `#audio` → `video:null`; `#video` → `audio:null`. If `canDecode()` is false, audio is treated as null and the clip plays silent. | renderer/src/lib/media/utils.ts:175-205,346-360 |

### 7.3 Preview graph and scheduling (`AudioPreview`; renders nothing)

- **Mounting.** Every audio and video clip on a track that is neither **muted nor hidden** is mounted. Group children follow the group's track (renderer/src/components/preview/Preview.tsx:375-416,2839-2852).
- **Graph** (AudioPreview.tsx:160-251,450-461,671-695):
  `AudioBufferSourceNode(playbackRate=speed)` → per-buffer `GainNode` (volume/fades) → `AudioWorkletNode "soundtouch-processor"` (2 ch) → clip `GainNode` (prebuffer mute, 10 ms ramp) → `AnalyserNode` (fft 512) → `destination`.
  If the worklet fails to load, the source connects straight to the clip gain.
- **Context.** One `AudioContext` per mounted clip, `latencyHint:"interactive"`, at the device default sample rate (:167).
- **Active window.** `start−5 ≤ focusFrame ≤ end` (:45,87-97).
- **Source position.** `mediaFrameIndex = floor((focus − start + trimStart)·speed) + mediaInfo.startFrame` (:106-108,565-575). In preview, **trimStart is scaled by speed**.
- **Scheduling.** Anchor: `startTime = ctx.currentTime − setupDelay`. Each buffer plays at `startTime + (ts − mediaTimeAtStart)/speed − (outputLatency+baseLatency)` (:543,584-633). Buffers are cut at the clip end (:637-663). A start time in the past begins at offset `(now−start)·speed` (:784-798). Look-ahead is 2 s, refilled when less than 1.5 s remains (:810-827).
- **Stopping.** Pause or leaving the range stops queued nodes (:355-384,868-879). Unmount only disconnects SoundTouch (:882-899).

### 7.4 Volume and fades: preview vs export (they differ)

| | Preview (AudioPreview.tsx:697-782) | Export mix (preload/src/media/previews.ts:720-725) | Timeline waveform |
|---|---|---|---|
| Gain | `10^(dB/20)` on the per-buffer gain | ffmpeg `volume=<dB>dB` (omitted when 0) | bar height × gain |
| Fade-in reference | **Source media timestamp** (`ts < fadeIn`). Only heard if the clip starts within the first `fadeIn` s of the file. | Start of the visible segment (`afade=t=in:st=0`) | Left edge |
| Fade-out reference | **Full source duration** (`duration − fadeOut`) | End of the visible segment | Right edge |
| Curve | Linear ramp per buffer; fade-in and fade-out are mutually exclusive per buffer | `afade` default (`tri`, i.e. linear) | Linear |

### 7.5 Speed and time-stretch

- **Preview.** `playbackRate = speed` resamples. The SoundTouch worklet then restores pitch with `pitch = 1/speed`, `tempo = rate = 1`. Ratios outside [0.25, 4] are split into `pitchSemitones` (±24) (AudioPreview.tsx:472-525,673-674). The no-worklet fallback sets `preservesPitch` on an `AudioBufferSourceNode`, which does not have that property (:675-679).
- **Worklet.** Vendored `renderer/public/soundtouch-worklet.js`, "SoundTouch Audio Worklet v0.2.1" (SoundTouchJS port, LGPL-2.1, :1-23). Params: `rate`/`tempo`/`pitch` in [0.25, 4]; `pitchSemitones` in [−24, 24] (:1485-1512). Processes 128-frame stereo blocks. The stretch stage is initialised at **44100 Hz** whatever the context rate (:665-714). The npm `soundtouchjs` and `@soundtouchjs/audio-worklet` dependencies are **never imported**.
- **Export.** ffmpeg `atempo` chain, each stage clamped to [0.5, 2]. For example 5× → `2.0,2.0,1.25` and 0.1× → `0.5,0.5,0.5,0.8` (previews.ts:72-96). SoundTouch and atempo are different algorithms, so output is not sample-identical.

### 7.6 Detach audio (`separateClip`, clip.ts:969-1057)

- **Applies to** video clips only.
- **New track.** An `audio` track (54 px) is inserted directly below the source track (:984-994).
- **New assets.** Two assets: `<url>#video` and `<url>#audio` (:997-1015).
- **Clip changes.** The original clip is repointed to `#video`. A full copy of it (transform, masks, adjustments, volume, fades, speed, trims) becomes `type:"audio"` with a new id, on the new track. A converted CapCut clip's `engine` payload stays with the video only.
- **Linked.** Both halves get the same new `linkId` (renderer/src/lib/types.ts `ClipProps.linkId`), CapCut's link: they move, trim, split and delete together while linkage is on, until unlinked (§12, Links). The `#video` half is silent in preview and export.
- **Engine.** The engine's copy of the project reads both halves from the file itself, the `#…` taken off the path, and plays the `#video` half silent (`withOriginalMedia`, renderer/src/lib/engine-preview.ts). Before, the fragment stayed in the path and the engine drew nothing for a detached video.
- **Entry points.** ⇧⌘S (CapCut's Extract audio) on a selected video; the context menu "Detach Audio" is disabled for `#video` clips (renderer/src/components/timeline/clips/TimelineClip.tsx). The toolbar `SeparateButton` checks that audio exists but not that the clip is already detached (renderer/src/components/controls/Buttons.tsx).

### 7.7 Waveforms

- **Timeline clips** (renderer/src/components/timeline/clips/thumbnails/generateTimelineThumbnailAudio.ts): Streams PCM through the per-asset worker (:99-104,407-412). Bars are 2 px wide with a 1 px gap. Each bar is the max over buffers of an RMS sampled at stride `span/64`, averaged across channels (:69-72,447-477). Bar height maps −60…0 dBFS to 0–100 % of the track height; colour `#7791C4` (:76-97,270-283). Redraws progressively, at most every 50 ms. **Not cached.**
- **Library / group thumbnails** (`generateAudioWaveformCanvas`, renderer/src/lib/media/timeline.ts:132-166,278-377): Decodes the whole file with `decodeAudioData` and mixes to mono. Each call creates a new `AudioContext` that is never closed. Amplitudes are cached in FramesCache under `amplitude:<path>`.

### 7.8 Export audio mix (`renderAudioMixWithFfmpeg`, preload/src/media/previews.ts:609-794)

```
ffmpeg -y -i <src_0> … -filter_complex "
 anullsrc=r=48000:cl=stereo:d=<D>[base];
 [i:a]aresample=async=1,atrim=start=<ms0>,asetpts=PTS-STARTPTS[,atempo=<r>…]
      ,atrim=end=<dur>,asetpts=PTS-STARTPTS[,afade=t=in:st=0:d=<fi>]
      [,afade=t=out:st=<dur-fo>:d=<fo>][,volume=<dB>dB],adelay=<ms>|<ms>[a<i>];
 [base][a0]…amix=inputs=<n+1>:normalize=0:duration=longest[amix];
 [amix]atrim=end=<D>,asetpts=PTS-STARTPTS[aout]"
 -map [aout] -ar 48000 (-c:a pcm_s16le | -c:a libmp3lame -b:a 192k) <out>
```

**Variables** (:621-706):
- `fps = trunc(fps)`
- `D = (exportEnd−exportStart)/fps`
- `ms0 = (visibleStart − clipStart + trimStart)/fps`. **trimStart is not speed-scaled.**
- `dur = (visibleEnd−visibleStart)/fps`
- `adelay = round((visibleStart−exportStart)/fps·1000)`

`amix normalize=0` sums the inputs, with no scaling. No `-ac` is set. Each source is probed with ffprobe and skipped if it has no audio stream; if the probe errors, the source is assumed to have audio (:498-538).

| Caller | Behaviour | Cite |
|---|---|---|
| `exportSequence` | Mixes audio clips (volume, fades, speed) plus video clips with `audioSrc`, the latter with **volume and fades forced to 0**. Writes a temp file to `<mediaRoot>/previews`, muxes it, then deletes it. | export-renderer/src/exporter.ts:866-996,1040 |
| All clips are audio | The mix is the output file itself. | exporter.ts:878-932 |
| `exportClip` | Mixes the one clip **with** its volume, fades and speed. | exporter.ts:1424-1552 |
| Mux | mp4/mov → `aac 192k 48k`; webm/mkv → `libopus 128k 48k`. | previews.ts:1002-1010 |
| Fast path | `atrim + atempo` only; volume and fades are ignored. | previews.ts:323-349 |

**Format and rate defaults:**
- ExportModal's audio format (wav default, or mp3) is only the **intermediate** mix format. ClipExportModal defaults to mp3.
- Proxies use `aac 128k -ar 48000` (preload/src/media/library.ts:406-411).
- Preview runs at the device-default sample rate.
- **Mute in export:** the timeline export drops only *hidden* tracks (renderer/src/components/bars/Topbar.tsx:263-268), so **muted tracks are still mixed**.

## 8. Media pipeline

### 8.1 Import, binaries, library

**Supported extensions.** Matched case-insensitively after stripping `?query` and `#hash` (preload/src/media/fileExts.ts:39-45). The type is decided **by extension only** (preload/src/media/library.ts:224-230). Whether the file really decodes is checked later with mediabunny/WebCodecs `canDecode()` (renderer/src/lib/media/utils.ts:346-352). The renderer keeps its own unsynced copy of these lists (renderer/src/lib/settings.ts:8-42).

| Type | Extensions | Cite |
|---|---|---|
| video | mp4, mov, avi, mkv, webm, flv, wmv, mpg, mpeg, m4v | fileExts.ts:1-12 |
| image | jpg, jpeg, png, gif, bmp, tiff, ico, webp, avif | fileExts.ts:14-24 |
| audio | mp3, wav, ogg, m4a, aac, flac, wma, m4b, m4r, m4p | fileExts.ts:26-37 |

**Binary lookup** (preload/src/media/ffmpegBin.ts:32-50). The first match wins:
1. env `APEX_FFMPEG_PATH` / `FFMPEG_PATH` (and the `…FFPROBE…` equivalents);
2. `<resources>/ffmpeg/<exe>` when packaged (apps/app/electron-builder.cjs:46-56);
3. `ffmpeg-static` / `ffprobe-static`;
4. `PATH`.

Import itself **transcodes nothing**. At import time ffmpeg is used only to build proxies.

**Media library layout** (under `userData/media/`):

| Path | Content | Cite |
|---|---|---|
| `<folderUuid>/symlinks/<name>` | Symlink to the original file, or a copy if symlinking fails | library.ts:266-298 |
| `<folderUuid>/proxy/<stem>_proxy.mp4` | Proxy files | library.ts:351-373 |
| `.proxy-index.json` | **Global** `{symlinkName: proxyFileName}` map | library.ts:65-82 |
| `symlinks/`, `proxy/` | Fallback when there is no folderUuid | library.ts:84-97 |
| `previews/` | Scratch space for export audio mixes | preload/src/media/previews.ts:11-19 |

**Library operations:**
- **Import** comes from the native picker (main/src/modules/NativeFileDialog.ts:20-35) or an OS drop through `webUtils.getPathForFile` (renderer/src/components/menus/MediaMenu.tsx:353-380). It filters by extension, makes names unique as `name (n).ext`, then symlinks (library.ts:257-302; preload/src/media/links.ts:89-104).
- **List** deletes broken links and their proxies, substitutes the proxy path when a proxy exists, and uses birthtime (falling back to mtime) as `dateAdded` (library.ts:141-255). The renderer drops items that fail to probe (MediaMenu.tsx:180-228).
- **Rename** sanitises `[\\/:*?"<>|]`→`-` and calls `fs.rename` on the symlink (preload/src/media/renameDelete.ts:6-39).
- **Delete** removes the symlink and its proxy and never touches the original (:41-78).
- **Dropping onto the timeline** stores the asset `path` as a `file://` URL **frozen at drop time**. If a proxy existed then, the path is the proxy's (renderer/src/components/timeline/TimelineEditor.tsx:860-862).

### 8.2 Probing and `app://`

**Probing** (`getMediaInfo`, utils.ts:135-417):
- Opens a mediabunny `Input` over `UrlSource("app://user-data/<abs>")`. If that fails it reads the whole file into a `BlobSource` (:261-333).
- Extracts the primary video and audio tracks, `PacketStats` (first 100 packets in quick mode, otherwise all), duration, tags, mime type, format, decoder config, and the audio `sampleSize` (:273-308). Full stats are computed in the background (:393-445).
- **Clip fps = `stats.video.averagePacketRate`.** VFR sources are therefore treated as CFR at their average rate.
- Images go through `readImageMetadataFast` (renderer/src/lib/media/image.ts:121-196): magic-byte sniff, then `ImageDecoder`, falling back to `createImageBitmap` and then `<img>`. It records EXIF orientation and `animated`, but **neither is ever used**.
- Results are cached in `MediaCache.media` by URL. Lookups also accept an asset id or an `app://` URL (renderer/src/lib/media/cache.ts:17-28; utils.ts:43-65).

**The `app://` scheme** (main/src/modules/AppDirProtocol.ts) is privileged (standard, secure, stream, fetch, CORS; :77-88).
- `app://renderer/*` serves the renderer build with an SPA fallback (:177-236).
- **Any other host is treated as an absolute local path** (:263-316): supports HTTP Range (`a-b`, `a-`, `-n`) with 206 responses (:10-34); sends a one-year `immutable` cache header; remaps `/projects-json/covers/` into userData (:92-98); answers OPTIONS with 204 and anything other than GET/HEAD with 405 (:357-366).

### 8.3 Proxies (`createProxy`, library.ts:341-438)

- **Trigger:** manual only, from the video item menu "Create File Proxy", and always called with `"480p"` (renderer/src/components/media/Item.tsx:427-448; MediaMenu.tsx:628).
- **ffmpeg command** (:387-414):
  `-i <realpath(symlink)> -vf scale=-2:<H> -r 24 -g 1 -keyint_min 1 -sc_threshold 0 -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k -ar 48000 -y <out>`
  This produces **all-intra, constant 24 fps** output.
- **Height H:** `720/720p/hd`→720, `1080/1080p`→1080, `<n>p`→n, anything else→480 (:375-382).
- **Index update:** only when ffmpeg exits 0 (:423-428).
- **Export uses the originals** via `useOriginal:true` (export-renderer/src/exporter.ts:736-741). `resolveOriginalPath` maps proxy paths back through the global index (library.ts:475-507).

### 8.4 Decoders

| Use | Thread / API | Instances / keys | Cite |
|---|---|---|---|
| Preview video (timeline + fullscreen) | **One shared Worker**: mediabunny `EncodedPacketSink` → WebCodecs `VideoDecoder` | One manager per app; one logical decoder per clip, `${assetId}::${clipId}` | renderer/src/lib/media/VideoDecoderManagerContext.tsx:26-50; renderer/src/lib/media/video-decoder.ts:341-786; VideoPreview.tsx:271-280 |
| Thumbnails / posters | Main thread, mediabunny `CanvasSink` (`fit:"fill"`) | `${path}#canvas@WxH`, pruned after 30 s idle | renderer/src/lib/media/canvas.ts:10-62; utils.ts:447-473 |
| Export video | Main thread, `CanvasSink` (poolSize 2, `fit:"contain"`) | `${path}#video[#iso]` | renderer/src/lib/media/video.ts:9-58,103-231 |
| Preview audio | One Worker per path, WebCodecs `AudioDecoder` | path | §7.2 |

**Video worker protocol** (renderer/src/lib/media/video-decoder.worker.ts:18-80):
- **In:** `configure`, `seek{timestamp, forceAccurate, requestId}`, `iterate{startTime,endTime}`, `ack`, `dispose`.
- **Out:** `frame` (a transferred `VideoFrame` plus ts and duration in seconds), `ready`, `seekDone`, `iterateDone`, `error`, `debug`.
- The main thread drops frames from stale requests and closes every frame (video-decoder.ts:418-479).

**Configure** (worker:827-909): a HEAD request first, then `optimizeForLatency:true` with `alpha:"keep"`, retrying without alpha if that fails. The coded-size hint is short side ≤720 (even), but it is only a hint (video-decoder.ts:463-487). No hardware-acceleration preference is set; Chromium GPU acceleration is on (main/src/index.ts:36).

**Alpha** (worker:250-401): packets with a side alpha plane go to a second decoder. Frames are paired by timestamp, and the alpha frame's R channel becomes the alpha via OffscreenCanvas `getImageData`. The pairing queue is capped at 120.

### 8.5 Seeking (`handleSeek`, worker:911-1090)

1. **Cache hit:** return a cached frame within **±50 ms** of the target (:459-464).
2. **Find a keyframe:** the verified key packet at the target, else the next key packet, else the first packet (:632-656). Reset, reconfigure and decode it, retrying the next keyframe up to 4 times (:672-708,995-1053).
3. **Fast scrub:** if the seek is not forced accurate, the previous seek was under 150 ms ago and the jump is over 0.5 s, post the keyframe and sleep 80 ms (:949,1015-1020).
4. **Decode forward** until the first packet past `target+0.1 s`. Accept the first frame with `ts ≥ target−0.04 s`; if none qualifies, take the closest frame. A forced-accurate seek also flushes (:444,1033,1055-1083).
5. **Backpressure:** while the decode queue is over 8, wait up to 500 ms (:595-614).

**Caller side:**
- A seek is forced accurate when it jumps more than 8 source frames, or when the "accurate seek" flag is set. The flag is false while the scrubber is being dragged (VideoPreview.tsx:1098-1100; renderer/src/components/timeline/Scrubber.tsx:41,139).
- Returned frames more than 2 frames off target are ignored (VideoPreview.tsx:822-830).
- Until a frame decodes, a `CanvasSink` poster is shown (:996-1080).

### 8.6 Frame caches

| Cache | Key | Limit | Cite |
|---|---|---|---|
| Worker decoded frames | Per decoder, timestamp in seconds | 240 frames, FIFO; ±50 ms match | worker:161,459-479 |
| `FramesCache` LRU | `${path}@WxH#frame#canvas\|video`, `…#image`, `…@audio#i` | **512 MiB** (min 16 MiB). Size counts w·h·4 or the allocation size. Evicted samples are closed when no longer referenced | renderer/src/lib/settings.ts:6; renderer/src/lib/media/cache.ts:36-186 |
| `MediaCache` | URL; waveform key `waveform_data:<path>#fps<n>` | Unbounded | cache.ts:17-28 |
| Media panel posters / waveforms | assetUrl | Unbounded | renderer/src/components/media/Item.tsx:45-48 |

- Each canvas sample is stored under both the requested index and `round(ts·fps)` (canvas.ts:172-180).
- A ±32-frame prefetch exists but is never enabled (canvas.ts:64-109).

### 8.7 Thumbnails and posters

- **Poster** (renderer/src/lib/media/timeline.ts:836-986): images are cover-cropped; video uses frame `floor(0.1·duration·fps)`; clip masks are applied when given.
- **Media panel:** a 16:9 canvas at `cssWidth·floor(DPR)` (Item.tsx:200-262).
- **Timeline video** (renderer/src/components/timeline/clips/thumbnails/generateTimelineThumbnailVideo.ts): tile width = `max(trackH·aspect, 36)`; tile source frame = `round(((t − start + trimStart)·speed/projFps)·clipFps)` (:9,43,120-145); the nearest cached frame within ±64 is drawn first; exact frames are then batch-fetched after a 0–100 ms debounce, with masks and filters applied per tile (:183,344-409).
- **Timeline image:** one tile, repeated (generateTimelineThumbnailImage.ts:37-103).
- **Group:** posters of the first 3 children (TimelineClip.tsx:1544-1562).
- **Preview image decode:** `fetchImage` uses `<img>.decode()` into a canvas cached under `#image` (image.ts:198-243). **Animated GIF/WebP show only the first frame.**

## 9. Playback

### 9.1 Clock, transport, fps

**Clock** (renderer/src/lib/control.ts:11-48): a `requestAnimationFrame` loop adds `dt·fps` to an accumulator and advances `focusFrame` by its whole-frame part. A late tick therefore **skips** frames rather than stalling, and the first tick only initialises.

**Transport:**
- Playback stops at `clipDuration`, the max `endFrame` (clip.ts:145-148). `play()` at the end restarts from 0, and with no clips it does nothing (control.ts:302-316). There is **no loop mode**.
- Seeking during playback pauses, sets the frame, and resumes on the next tick (control.ts:249-265).
- Buttons: Play/Pause, go to start, ±5 s (renderer/src/components/controls/Buttons.tsx:23-101,331-345).
- **Space is swallowed, not bound to play** (renderer/src/components/App.tsx:42-55).
- The readout is `MM:SS.ss`, or `HH:MM:SS.ss` past one hour (Controls.tsx:216-237).

**FPS:** project fps is one of 24/25/30/48/60, integers only, default 24 (renderer/src/components/dialogs/SettingsModal.tsx:240-256). Source fps is the average packet rate. Speed is clamped to 0.1–5 (VideoPreview.tsx:244-247).

Timeline frame → source frame mapping is given in §2.6. Preview and export differ: export does not speed-scale `trimStart`. Timeline thumbnails use the preview formula with `round` instead of `floor` (generateTimelineThumbnailVideo.ts:130).

### 9.2 Playback rendering and A/V sync

**Video** (`startRendering`, VideoPreview.tsx:1262-1440):
1. Compute the source range (:27-57).
2. Accurate-seek to the range start.
3. The worker iterates frames, with at most 4 un-acked (worker:162).
4. A frame more than one source frame **behind** the clock is dropped (:1378-1381).
5. A frame **ahead** of the clock is held in a rAF wait (:1383-1388).

Iteration restarts on a backward jump (:1463+). The worker also drops frames outside `[start, end+0.05 s]` (worker:1133).

**A/V sync:**
- The video clock is the rAF counter. Each audio clip uses its own `AudioContext` and is anchored only when play starts (§7.3).
- **No drift correction:** `lastResyncTimeRef` is written but never read (AudioPreview.tsx:118,609).
- Scrubbing while paused only pre-seeks the audio; nothing is heard.

### 9.3 Preview viewport and resolution

- **World rect:** the height is **always 600** (`BASE_LONG_SIDE`) and the width is `600·aspect`; the default aspect is 16:9 (Preview.tsx:501-509; renderer/src/lib/viewport.ts:59). When the rect size changes, **every clip is re-centred** (Preview.tsx:513-595).
- **Stage:** follows its container through a ResizeObserver throttled to 16 ms (:465-473).
- **Zoom:** scale defaults to 0.75 and is clamped to 0.1–4 (viewport.ts:47-49); Ctrl/Cmd+wheel zooms around the cursor by `1 − deltaY·0.0015`; a plain wheel pans, Shift+wheel pans horizontally (Preview.tsx:597-614); presets: Fit (0.90 padding, viewport.ts:172-199), 50/100/200 %, and a 10–400 % slider.
- **Video raster:** decoded into a canvas that fits the world rect, at most about 1067×600 at 16:9, **at any zoom**. Konva scales it from there (VideoPreview.tsx:59-80,845-855).
- **Fullscreen** (renderer/src/components/preview/FullscreenPreview.tsx) is an in-window overlay, not OS fullscreen (:338): fit with no padding; controls auto-hide after 3 s, and Esc exits; has its own scrubber and play control, and preloads LUTs (:59-78,202-245,324-333).

## 10. Export

Export uses **integer project frames** only (ticks never reach the exporter). Project FPS options are 24/25/30/48/60 (`renderer/src/components/dialogs/SettingsModal.tsx:243-257`). The modal has no FPS override, so export always uses the project FPS (`renderer/src/components/bars/Topbar.tsx:297`).

### 10.1 Hosting / process model
- **There is no hidden window and no worker.** Export runs inside the single editor `BrowserWindow` (`main/src/modules/WindowManager.ts:88-111`; `contextIsolation:true`, `sandbox:false`, `nodeIntegration:false`). `@app/export-renderer` is source-aliased into the renderer bundle (`renderer/vite.config.ts:16-19`). Its own lib build externalizes `@app/preload` (`export-renderer/vite.config.js:13-22`).
- Compositing uses a Konva `Stage` in an off-screen `<div>` at `left/top:-99999px` that is appended to `document.body` (`export-renderer/src/export.ts:154-177`), with `pixelRatio=1`.
- ffmpeg/ffprobe are spawned from **preload** (Node runs in the renderer process). The preload exports reach the page through `contextBridge.exposeInMainWorld(btoa(name), fn)` (`preload/src/exposed.ts:7-11`) and the `@app/preload` virtual module (`preload/vite.config.js:205-216`). Each frame buffer crosses the context bridge as a `Uint8Array` copy.

### 10.2 ExportModal (project export, `renderer/src/components/dialogs/ExportModal.tsx`)
| Option | Values (exact) | Default | Notes / cite |
|---|---|---|---|
| Kind | `video`, `image` | video | `:34`, `:157`, select `:439-460` |
| Name | free text, trimmed | `"Export"` | `:148`. Not sanitized. Path is `${path}/${name}.${ext}` (`Topbar.tsx:229-233`) |
| Path | folder text, `~` expanded by `resolvePath` | `"~/Downloads"` | `:149`, `:377`. Browse uses `pickMediaPaths({directory:true})` (`:496-516`). `resolvePath` is at `preload/src/core/ipc.ts:16-22` |
| Resolution (sets **output height**) | 480P=480, 720P=720, 1080P=1080, 2K=2048, 4K=4096 | **480** (index 0) | `:101-107`, `:160-162` |
| Bitrate (video) | Low `5M`, Medium `10M`, High `20M` | `10M` | `:109-113`, `:163-165` |
| Codec (video) | `h264`, `hevc`, `vp9`, `av1`, `prores` | h264 | `:115-121` |
| Container (video) | `mp4`, `mov`, `webm`, `mkv` | mp4 | `:123-128` |
| Include audio (video) | bool | `true` if any visible audio clip, or any video clip whose `mediaInfo.audio !== null`, exists; re-evaluated on every open | `:207-230`. Checkbox is disabled when there is no audio (`:762-785`) |
| Audio format (video) | `wav`, `mp3` | **wav** (index 0) | `:136-139`, `:173-175`. Only sets the *intermediate* mix file; the muxer re-encodes it (10.5) |
| Image format | `png`, `jpeg`, `webp` | png | `:130-134`. MIME is mapped at `Topbar.tsx:314-319`. No quality is passed, so the browser default applies (`export.ts:194-206`). Extension is `.jpeg` |
| Image frame | 0-based project frame, clamped to `[0, clipDuration-1]` | current playhead (clamped) | `:198-205`, `:249-252`, picker `:677-735` |
| Preserve Alpha | bool | false | `:182`, `:739-760`. Disabled for JPEG (`:279-284`, `:744`) |
- **Alpha coercion:** when alpha is on, the UI treats format∈{mov,webm,mkv} together with codec∈{prores,vp9,av1} as valid. Any other combination is forced to `mov`+`prores` (`:261-276`).
- **Pixel size** (`Topbar.tsx:240-247`): `h = resolution`, `w = round(resolution × aspect.w/aspect.h)`. Resolution is the height for every aspect ratio. Examples at 16:9: 853×480, 1280×720, 1920×1080, 3641×2048, 7282×4096. At 9:16: 270×480, 405×720, 608×1080. For any codec other than ProRes, the encoder then floors both dimensions to even and adds a lanczos scale (10.5).
- Background is `#000000` unless alpha is on, in which case it is `undefined`, so the canvas stays transparent (`Topbar.tsx:321`).
- Duration label = `clipDuration/fps` (`:232-247`). ETA = `elapsed/progress − elapsed` (`:309-372`). The Cancel button appears only while exporting (`:893-913`).
- Export button gating, `canExport` (`Topbar.tsx:404-444`): at least one image/audio/video clip with `assetId`, or one text/shape/draw clip, on a non-hidden timeline. A group counts if any of its children qualify.

### 10.3 ClipExportModal (context-menu "Export" on a single clip)
| Clip type → kind | Options | Behaviour (`renderer/src/components/GlobalContextMenu.tsx`) |
|---|---|---|
| video → `video` | Name (default: asset file stem, else `"export"`, `:41-55`), Path (`~/Downloads`), Resolution 480p/720p/1080p/2K=2048/4K=4096 (**default 1080**), Format mp4/mov/webm/mkv (default mp4) | `h=res`, `w=round(h × native displayW/H)`, falling back to project aspect (`:147-173`). Codec is **forced**: `vp9` if webm, otherwise `h264`. Bitrate is fixed at `"8000k"`, `resolution={w,h}` (`:197-202`). Uses `prepareExportClipsForValue(..., {applyCentering:true, useOriginalTransform:true, dimensionsFrom:"clip", target})` (`:175-192`), then `exportClip` (one clip) or `exportSequence` (`:204-232`). Background is `#000000`, no alpha, no audio-format choice |
| image → `image` | Name, Path, Resolution, Format png/jpeg/webp | Same sizing. `imageFrame = clip.selectedFrame ?? 0` for video/group, otherwise 0 (`:283-286`). The file is written with `saveImageToPath` and the extension `jpg` for JPEG (`:117-126`, `:307-327`) |
| audio → `audio` | Name, Path, Format wav/mp3 (default mp3) | `exportSequence({mode:"audio", clips:[rawStoreClip]})` (`:132-145`) |
| group/text/shape/draw/filter | — | Not exportable: `kind` stays null (`:403-407`) |
- Defaults are at `renderer/src/components/dialogs/ClipExportModal.tsx:52-98`. The submit handler is at `:127-142`. There is no cancel path: no token, and Cancel is disabled while exporting (`:338-347`).

### 10.4 Pipeline (Topbar project export), step by step
1. `sortClipsForStacking(clips, timelines)` flattens groups into children and orders the result **bottom→top**. Ordering is by `timelineY` descending, then `startFrame` ascending (`renderer/src/lib/clipOrdering.ts:16-84`). Clips whose own `timelineId` is hidden are then dropped (`Topbar.tsx:258-268`).
2. Every non-filter clip goes through `prepareExportClipsForValue` with `{clearMasks:false, applyCentering:false, dimensionsFrom:"aspect"}` (`Topbar.tsx:270-289`). This step:
   - sets `src = asset.path`. For video it also sets `audioSrc = asset.path` when `mediaInfo.audio !== null` (`renderer/src/lib/prepareExportClips.ts:159-163,361-373`).
   - sets the editor rect to `600·ratio × 600` (`BASE_LONG_SIDE=600`, `renderer/src/lib/settings.ts:2`; `prepareExportClips.ts:300-310`).
   - attaches **every** filter clip with `getClipPositionScore(filter) < score(clip)` as an `applicator`, with frames shifted by `offsetStart` and the list deduped by `clipId` (`:377-416`).
   - gives image/video clips with a missing transform an aspect-fit init, and gives text a default centred 400×100 rect (`:422-527`).
   - attaches `normalizedTransform = transform / (rectW, rectH)`, unclamped (`:132-157,581-603`).
3. `exportSequenceCancellable` (`export-renderer/src/exporter.ts:410-419`) wraps `exportSequence` with a `{cancelled}` token.
4. `exportSequence` (`exporter.ts:421-1048`):
   - **Range:** `start = max(0, min(clip.startFrame…, 0))`, which is always 0. `end = max(clip.endFrame…)`. `total = end − start` (`:451-457`).
   - **Size:** `opts.width/height`, otherwise the maximum transform size, otherwise 1920×1080 (`:459-478`).
   - **Cache probe** (10.7), then the **fast path** (10.6).
   - Creates a `KonvaExportRenderer(w,h)` and calls `acquireHaldClut()` once (`:612-618`).
   - If any audio is requested, renders the audio mix into a temp file first (10.5; `:934-996`). It then opens `FfmpegFrameEncoder.start({w,h,fps,audioPath})` (`:998-1006`, `export-renderer/src/ffmpegEncoder.ts:40-63`).
   - **Frame loop** `for f in [start,end)`: `drawFrame(f)`, then `stage.toBlob("image/png")`, then `Uint8Array`, then `exportVideoAppend` (stdin write), then `onProgress((f−start+1)/total)` (`exporter.ts:1008-1024`).
   - `finalize()` calls `exportVideoClose` (closes stdin and awaits exit code 0). The result path then goes into the cache, `onDone` fires (toast + reveal in folder, `Topbar.tsx:328-339`), and `finally` deletes the temp audio, calls `cleanupVideoDecoders()`, destroys the stage and releases the CLUT (`exporter.ts:1026-1047`).
5. **drawFrame(f)** (`exporter.ts:628-783`):
   - Clears the stage and adds a full-size bg `Rect` if `backgroundColor` is set.
   - A clip is active when `startFrame ≤ f ≤ endFrame`, inclusive at both ends (`:647-651`, same as the store at `renderer/src/lib/clip.ts:1916`).
   - Clips are drawn in the incoming order. Per clip, applicators active at `f` (inclusive) are built with `createApplicatorFromClip(a,{haldClutInstance, focusFrameOverride:f})` (`:658-682`).
   - Per-type blit: image/video/text/shape/draw (`:684-781`). Audio and filter clips draw nothing.
   - Video order of operations: decode, then masks, then the clip's own adjustments (`applyWebGLFilters`), then applicators in sequence, then a normalized crop converted to texture px, then a `Konva.Image` built from the resolved transform (`export-renderer/src/export.ts:507-633`). The transform is resolved as normalized × canvas px for x/y/w/h, with scale/rotation/opacity/cornerRadius copied raw (`export.ts:1015-1051`).
6. **Image mode:** a single `drawFrame(imageFrame)` and `toBlob(imageMimeType)` (`exporter.ts:845-863`). Topbar writes the blob with `writeFileBuffer` and reveals it (`Topbar.tsx:348-359`, `preload/src/core/ipc.ts:44-63`). Not cached.
7. The project cover reuses this path: `exportSequence({mode:"image", imageFrame:0, height:720, bg:#000})`, re-encoded to JPEG q=0.85 (`renderer/src/lib/middlewares/json-persistence.ts:531-532,589-611`).

**Frame → source mapping:** see §2.6.
- One `getVideoFrameIterator` per clip, decoding the **original** file rather than the proxy.
- The iterator is reused while its key `src|speed|fps|spanStart|spanEnd` is unchanged, and advanced with `next()` (exporter.ts:726-755).
- Mask keyframe frame is `floor((f − start + trimStart) × speed)` (export.ts:550-559). This differs from `srcIdx` when trim ≠ 0 and speed ≠ 1.

### 10.5 ffmpeg invocations (`preload/src/media/previews.ts`)
**A. Streaming encoder, `exportVideoOpen`** (`:821-1087`). This is the normal path.
```
ffmpeg -y -f image2pipe -framerate <trunc(fps)> -vcodec png -i pipe:0 [-i <audioMix>]
       <codec args> [-vf scale=W:H:flags=lanczos] [-movflags +faststart]
       [<audio args>] -f <mp4|mov|webm|matroska> <out>
```
- Input frames are 8-bit RGBA **PNG** (encoded by Chromium `toBlob`), written one at a time to stdin. Each write awaits its callback or `drain` (`:1089-1144`).
- No `-map` and no `-shortest`; ffmpeg's default stream selection applies. The audio mix is pre-trimmed to the exact duration (below).
- Even dimensions: for non-ProRes, `W&~1, H&~1`. A scale filter is added only if the size changed (`:991-996`).
- `+faststart` is added for mp4/mov without alpha, and a second time inside the h264 branch (`:921-923`, `:998-1000`).
- Audio codec (`:1002-1010`): mp4/mov → `-c:a aac -b:a 192k -ar 48000`. webm/mkv → `-c:a libopus -b:a 128k -ar 48000`.
- Readiness: waits for `"Input #0"|"image2pipe"|"pipe:0"` on stderr, otherwise a **250 ms timeout** (`:1054-1084`).
- `exportVideoClose` ends stdin and resolves on exit code 0. If the process had already exited, it returns success without checking the code (`:1146-1174`). `exportVideoAbort` destroys stdin, sends SIGKILL and unlinks the output (`:1176-1195`).

Codec argument table. The same table is used for the transcode in B (`:353-445`, `:893-989`). `crf` and `preset` are never set by the UI, so `preset=medium`.

| codec | encoder | bitrate given (UI always gives one) | no bitrate/crf | pix_fmt (alpha) |
|---|---|---|---|---|
| h264 | `libx264 -preset medium` | `-b:v B -maxrate B -bufsize B` | `-crf 18` | yuv420p (alpha → throws) |
| hevc | `libx265 -preset medium` + `-tag:v hvc1` (mp4/mov) | `-b:v B` | `-crf 20` | yuv420p (alpha → throws) |
| prores | `prores_ks -profile:v 3` (alpha: `-profile:v 4`) | `-b:v B` | — | yuv422p10le (`yuva444p10le`) |
| vp9 | `libvpx-vp9 -row-mt 1` | `-b:v B` | `-crf 32 -b:v 0` | yuv420p (`yuva420p`) |
| av1 | `libaom-av1 -cpu-used 6` | `-b:v B` | `-crf 28 -b:v 0` | yuv420p (`yuva420p`) |

Encoder-side alpha validation (`:849-866`). Each of these combinations throws:
- h264 or hevc with alpha
- prores with alpha outside mov
- vp9 with alpha outside webm/mkv
- av1 with alpha in mp4/mov

Defaults when the caller omits a value: container comes from the file extension, codec is `vp9` for webm and `h264` otherwise (`:841-846`).

**B. Fast-path transcode, `exportVideoTranscodeWithFfmpeg`** (`:214-493`):
```
ffmpeg -y -i <video> [-i <audioSrc>] -filter_complex
  "[0:v]trim=start=S:duration=D,setpts=PTS-STARTPTS[,setpts=PTS/speed][,crop=iw*cw:ih*ch:iw*cx:ih*cy][,scale=W:H:flags=lanczos],fps=<fps>[vout];
   [a]atrim=start=S:duration=D,asetpts=PTS-STARTPTS[,atempo=…][aout]"
  -map [vout] (-map [aout] | -an) <codec args> [-movflags +faststart] [aac 192k|libopus 128k @48k] -f <container> <out>
```
- `S` = source start in seconds, `D` = source duration in seconds, both taken **before** speed is applied (`:284-291`).
- Embedded audio is detected with a strict ffprobe check: an ffprobe failure counts as no audio (`:545-585`).
- The call is rejected if the input path equals the output path (`:233-242`).
- `atempo` chain: each stage is limited to 0.5–2.0 and stages are chained (2.0×… or 0.5×…). Overall speed is clamped to 0.1–5 (`:72-96`).

**C. Audio mix, `renderAudioMixWithFfmpeg`** (`:609-779`). The full filter graph is in §7.8.
- **Used by:** sequence audio, the audio-only export, and clip audio.
- **Output:** 48 kHz, written as `pcm_s16le` (wav) or `libmp3lame 192k` (mp3).
- **Temp file:** `<mediaRoot>/previews/<sanitised hint>.<fmt>`, with a `_N` suffix on collision (`:629-649`). It is deleted in `finally` (`exporter.ts:1040`).
- **Source resolution:** each source goes through mediabunny's private `audio.input.source._url` (`exporter.ts:311-317`). `app://` URLs are then resolved via IPC `appdir:resolve-path` (`previews.ts:587-607`).

### 10.6 Fast path (`exporter.ts:368-408`, `:528-610`; `exportClip` `:1193-1272`)
Predicate (all of these must hold):
- `mode==="video"`, exactly one clip, of type video.
- no `normalizedTransform`, all 8 adjustments equal 0 (`:355-366`), no masks, no applicators.
- `rotation==0`, `scaleX==scaleY==1`, `x==y==0`, `opacity==100`, `cornerRadius` 0 or unset, and `crop` (if present) finite.
- `exportSequence` additionally requires **no** `backgroundColor`. `exportClip` also allows `"#000000"`.

What it does: a single ffmpeg re-encode via B. It is **not** a stream copy. The predicate also does not check the clip's own `cornerRadius` property or `volume`/fades.
- `srcStartFrames = trimStart + srcStartFrame + floor(localStart × speed)`
- `srcDurationFrames = floor(len × speed)`
- Both are converted to seconds as `/fps`.
- `exportSequence` muxes embedded audio only if `audioSrc` is set. `exportClip` always allows embedded audio (`:569`, `:1231`).

Progress jumps straight to 1.0 when the path finishes.

### 10.7 Export cache (`preload/src/exportCache.ts`)
- **Key:** `sha256(stableStringify({v:1, fn, mode, fps, includeAudio, range, imageFrame, width, height, backgroundColor, encoderOptions, audioOptions, clips|clip}))`, with sorted keys and functions/undefined dropped (`exporter.ts:271-308,493-508,1157-1172`). The key does **not** include the output filename or the source file's mtime or size.
- **Scope:** `video`/`audio` modes with a filename only (`:482-484`). Image exports are never cached.
- **Storage:** an electron-store index `apex-export-cache-v1` plus files at `userData/apex-export-cache/<hash>.<ext>`. LRU by `lastAccessAt`, capped at 256 entries, with no byte cap (`exportCache.ts:18-36,72-96`).
- **Get:** a missing file prunes its entry.
- **Materialize:** hardlinks to the target, falling back to a copy. If the target already exists it is left untouched but still counts as a hit (`:55-70,102-142`).
- **Put:** after every successful video/audio export (`:149-195`).
- **Delete/clear:** `exportCacheDelete`/`exportCacheClear` exist but are never called (`:197-235`).

### 10.8 Progress, cancel, errors
- Progress is reported per frame after the append. Cache hits, the fast path and audio-only exports emit a single `ratio:1` (`exporter.ts:516-519,594-596,918-920`). The Topbar shows the percentage in a button (`Topbar.tsx:860-883`).
- Cancel is cooperative: `checkCancelled()` runs at each frame and inside `drawFrame`, and throws `ExportCancelledError` (`exporter.ts:444-448,1009`). Topbar ignores that error (`Topbar.tsx:361-365`).
- Errors other than cancel are only `console.error`'d, with no toast (`Topbar.tsx:366-370`; `GlobalContextMenu.tsx:330-332`). Audio-mix failures are swallowed and the export continues without audio (`exporter.ts:837-840`).

## 11. Project model & persistence

Two files do almost all of the work: the renderer-side middleware `renderer/src/lib/middlewares/json-persistence.ts` (abbreviated **JP**) and the main-process module `main/src/modules/JSONPersistenceModule.ts` (abbreviated **JPM**). There is no zustand `persist` on the clip, controls or viewport stores. All project state goes through JP → IPC → JPM. The only `persist` store is the UI layout (see 11.6).

### 11.1 On-disk layout

```
<userData>/        app.getPath("userData"); app name "OpenRip" (main/src/index.ts:19)
├── config.json                    electron-store, no name → default file; key activeProjectId (main/src/modules/SettingsModule.ts:7-9,19)
├── apex-export-cache-v1.json      electron-store {exports:{hash→{path,createdAt,lastAccessAt,sizeBytes}}} (preload/src/exportCache.ts:7-24)
├── apex-export-cache/             materialized export outputs, max 256 entries (preload/src/exportCache.ts:19,26-36)
├── projects-json/                 created on enable (JPM:213-221)
│   ├── project-<N>.json           N = integer ≥1 (JPM:268-270)
│   ├── covers/project-<N>.jpg     (JPM:272-274)
│   └── local/mask/project-<N>/mask-<clipId>-<maskId>-<lasso|contours>.f32.bin   (JPM:276-311)
└── media/
    ├── .proxy-index.json          GLOBAL {symlinkName: proxyFileName} (preload/src/media/library.ts:65-82)
    ├── previews/                  ffmpeg audio-mix outputs (preload/src/media/previews.ts:11-19,629-649)
    ├── symlinks/, proxy/          fallback when no folderUuid is given (preload/src/media/library.ts:84-97)
    └── <folderUuid>/              per project; folderUuid = meta.id (UUID) (preload/src/media/library.ts:141-163)
        ├── symlinks/<uniqueName>  symlink to the user's original; copyFile if symlink fails (preload/src/media/library.ts:257-301)
        └── proxy/<file>           proxy transcodes (preload/src/media/library.ts:341+)
```
- Preload resolves userData on its own (it does not ask main) for `getMediaRootAbsolute`. The order is: env `APEX_USER_DATA_DIR`, then `APEX_MEDIA_ROOT`, then the first of `OpenRip`/`openrip` that exists under the platform app-data dir (preload/src/media/root.ts:5-40). Other preload code asks main through `config:get-user-data-path` (main/src/modules/CoreIpc.ts:17-29; preload/src/config.ts:4-8).
- `app://` serves `/projects-json/covers/*` from userData and any other absolute local path, with HTTP Range support (main/src/modules/AppDirProtocol.ts:92-98,263-300).
- `Asset.path` holds an absolute `file://` URL to the per-project symlink, or to the proxy if one existed when the item was dropped (preload/src/media/library.ts:201-223; renderer/src/components/timeline/TimelineEditor.tsx:861). Because of this, projects are not portable between machines or userData dirs.

### 11.2 JSON v1 schema (as written to `project-<N>.json`)

```ts
// written by JP buildProjectJsonSnapshot (JP:201-386), normalized by JPM ensureProjectJson (JPM:36-117), pretty-printed with 2-space indent (JPM:852-856)
type ProjectFile = {
  version: "1.0.0";                       // always this string; no version-keyed migration exists (JP:337, JPM:42)
  meta: { id: string;                     // folderUuid (UUID) || `project-${N}` (JP:339-341)
          name: string;                   // default "Untitled Project" (JPM:49-52)
          createdAt: number; lastModified: number;   // epoch ms
          appVersion?: string;            // app.getVersion(), set by main on every save (JPM:103-110,224)
          projectId: number };            // = N from filename (JPM:109)
  settings: { fps: number;                // default 24 (JPM:62-69)
              aspectRatio?: { width: number; height: number; id: string };  // from viewport store (JP:349)
              defaultClipLength: number;  // seconds (JP:350; used as fps*len in TimelineEditor.tsx:322,728)
              mainTrackMagnet?: boolean;  // the main track magnet (clip store `magnet`); a CapCut draft's config.maintrack_adsorb
              [k: string]: unknown };
  editorState: { duration: number;        // frames = clipStore.clipDuration
                 zoomLevel: number; scrollX: 0; scrollY: 0;   // scroll is always 0 and never read
                 playheadPosition: number;              // frames (controls.focusFrame)
                 snapGuideX: number | null;
                 position: {x,y}; scale: number; tool: ViewTool; shape: ShapeTool;
                 viewportSize: {width,height}; contentBounds: {x,y,width,height} | null;
                 timelineWindow: [startFrame, endFrame];   // controls.timelineDuration (JP:352-371)
                 snapping?: boolean; linkage?: boolean };   // Auto snapping and linkage (controls store); default true
  assets: Record<assetId, { id; type: "video"|"image"|"audio"; path: string /*file:// URL*/;
                            width?; height?; duration: number; thumbnail? }>;   // renderer/src/lib/types.ts:93-101
  timeline: {
    tracks: TimelineProps[];   // verbatim: {type, timelineId, timelineWidth, timelineY, timelineHeight,
                               //  timelinePadding, muted, hidden, locked?} — UI pixel geometry is persisted (types.ts)
    clips: Array<ClipJson>;    // a clip may carry linkId (§7.6, §12 Links)
    markers?: Array<{ id: string; frame: number; color: string; note: string }>;  // frames, like the playhead;
                               //  kept by JPM; a CapCut draft's time_marks.mark_items on import
  };
  inputControls: { selectedRangeByInputId:{}, selectedInputClipIdByInputId:{}, totalTimelineFramesByInputId:{},
                   timelineDurationByInputId:{}, fpsByInputId:{}, focusFrameByInputId:{},
                   focusAnchorRatioByInputId:{}, zoomLevelByInputId:{}, isPlayingByInputId:{} };  // injected by JPM:88-98, never read by renderer
};
type ClipJson = Omit<AnyClipProps, "startFrame"|"endFrame"|"trimStart"|"trimEnd"|"masks"> & {
  clipId: string; timelineId: string; clipPadding: number /*default 24*/;
  startTick: string; endTick: string; trimStartTick: string; trimEndTick: string;  // decimal BigInt strings
  masks?: Array<Omit<MaskClipProps,"keyframes"> & { keyframes: Record<localFrame:number, MaskData> }>;  // video/image only
};
```

**Time encoding (ticks).**

| Item | Rule | Cite |
|---|---|---|
| Tick rate | `1_000_000n` ticks per second, BigInt | JP:74 |
| frame→tick | `BigInt(round(frame)) * 1e6 / BigInt(max(1, round(fps)))`. BigInt division truncates. fps is rounded to an integer | JP:78-96 |
| tick→frame | `tick * fps / 1e6`, truncated | JP:98-117 |
| ±Infinity | tick `1n` means +∞ and `2n` means −∞. This is unreachable for clip fields, because non-finite frames are coerced to 0 before encoding | JP:75-76,252-267 |
| Units elsewhere | Mask keyframe keys, `editorState.playheadPosition`, `duration` and `timelineWindow` stay in **frames**, not ticks | JP:169-189,352-371 |

**Clip serialization.**
- The whole in-memory clip object is spread verbatim (every type-specific prop). Then `startFrame`, `endFrame`, `trimStart`, `trimEnd` and `masks` are deleted and replaced by the tick strings and the JSON masks (JP:287-310).
- Mask `keyframes` can be a `Map` in memory. They are written as a plain object keyed by numeric frame. Masks are kept only for `video` and `image` clips (JP:169-199).

**Load-time transforms** (`hydrateStoresFromProjectJson`, JP:639-854):
- **Ticks → frames.** Legacy files that store `startFrame`/`endFrame` instead of ticks are still read (JP:675-682).
- **Trims.** `trimStart`/`trimEnd` are forced to `±Infinity` for every type except audio, video and group (JP:683-690).
- **Other clip fields.** `clipPadding` defaults to 24. A legacy `props` bag is merged as `{...props, ...base}`. Removed-feature leftovers are dropped (JP:673-752).
- **Assets.** Every asset is probed with `getMediaInfo`, and loading waits for all probes (JP:760-767).
- **Derived values.** `clipDuration = max(max endFrame, editorState.duration)`, and `totalTimelineFrames = max(timelineWindow[1], clipDuration)` (JP:769-844).
- **Viewport.** It is restored **only if `editorState` has at least one key** (JP:794-810).
- **Magnet.** `settings.mainTrackMagnet` (true when missing), but only over a main track already gapless from 0 (`isMainTrackPacked`, renderer/src/lib/timeline-edit.ts): opening a project never moves its clips. Markers come back in time order; snapping and linkage default to on.

**Main-process normalization.** `ensureProjectJson` fills in missing `meta`, `settings.fps`, `editorState`, `assets`, `timeline` and `inputControls`, and keeps any other `settings` keys (JPM:36-117). It runs on save, load and list. A file that fails to parse returns `{success:false}` on load and is skipped by list (JPM:897-905,1033-1039).

### 11.3 Mask `.bin` sidecars and covers

- **Mask sidecars.** Main rewrites all mask sidecars on **every** `projects:save-json`, before writing the JSON. Inline `lassoPoints` are replaced by `lassoPointsBinPath`, which is relative to `projects-json/` (JPM:317-544,842). Binary layout, load path and the legacy-format check are covered in §4.8. A parallel `contours`/`contoursBinPath` path also exists (`…-contours.f32.bin`), but `MaskData` has no `contours` field, so it is a leftover (JPM:428-541).
- **Covers.** *Trigger.* A clip-store change where the clip signature changes but tracks and assets do not, debounced 1000 ms (JP:481-510,947-952). *Render.* Uses the export pipeline: `sortClipsForStacking`, drop hidden tracks, skip filter clips, `prepareExportClipsForValue({clearMasks:false, applyCentering:false, dimensionsFrom:"aspect"})`, then `exportSequence({mode:"image", imageFrame:0, height:720, backgroundColor:"#000000"})`. The result is re-encoded to JPEG at q=0.85 (JP:527-615). *Storage.* Saved as `covers/project-<N>.jpg` via `projects:save-cover` (JPM:927-947). The cover is cleared when there are no clips (JPM:949-976). **Covers are never displayed anywhere in the UI.**

### 11.4 Autosave

| Source store | Fields watched | Cite |
|---|---|---|
| `useClipStore` | A JSON signature of each clip's `{clipId,type,timelineId,groupId,hidden,assetId,startFrame,endFrame,trimStart,trimEnd,transform,originalTransform,children}`, each track's `{timelineId,hidden,timelineY,muted,locked}`, and each asset's `[id,type,path]`; also any new `clips`, `markers` or `magnet` | JP:421-479,917-945 |
| `useViewportStore` | `aspectRatio, scale, position, tool, shape, viewportSize, contentBounds` compared with `_.isEqual` | JP:960-973 |
| `useControlsStore` | `fps`, `timelineDuration` (by reference), `zoomLevel`, `focusFrame`, `snapping`, `linkage`. Playback changes `focusFrame` every rAF step (renderer/src/lib/control.ts:28-37), so a save lands 500 ms after playback stops | JP:981-991 |
| `useProjectsStore` | Any change to the `projects` array reference (create, rename, delete, cover update) | JP:1267-1273 |

- **Debounce.** A trailing 500 ms `setTimeout` with a generation counter (JP:856-909).
- **Guards.** A save is skipped or aborted in any of these cases (JP:864-899): `isHydratingFromJson` is set. The active id ≠ `currentHydratedProjectId`. `projectsLoaded === false`. The active project changed after the save was scheduled.
- **Project switch:** when `activeProjectId` changes (JP:1226-1265):
  1. The pending cover is cancelled.
  2. The previous project is saved immediately, if the stores still hold it.
  3. The pending autosave is cancelled.
  4. `loadActiveProjectFromJson(newId)` runs.
- **Edits that do not trigger a save.** Property-only edits are absent from the signatures above: text and style, adjustments and filter intensity, volume and fades, masks, drawing lines, shape fill and stroke, and `defaultClipLength`. These edits are saved only when some other watched field changes later.
- **Quit and close.** Nothing flushes on exit: there is no `beforeunload`, `before-quit` or `will-quit` handler anywhere (grep over renderer/src, main/src, preload/src). A pending save, up to 500 ms old, is lost on quit.
- **Write.** A plain `fs.writeFile` of the whole document, not atomic (no temp file plus rename). `meta.lastModified` is set to `Date.now()` (JPM:844-856).

### 11.5 Projects list, create, switch, rename, delete

| Operation | Behavior | Cite |
|---|---|---|
| Where | The home screen (renderer/src/components/home/HomeScreen.tsx; actions in renderer/src/lib/project-actions.ts), which the app opens on. The editor's top bar has Home, and Menu ▸ New project / Open a CapCut project…. Since the Phase 4 shell (2026-10-17) | — |
| Store | zustand `useProjectsStore`: `{projects: ProjectSettings[], activeProjectId, projectsLoaded}`. `ProjectSettings = {id, name, fps, folderUuid, aspectRatio, createdAt?, lastModified?, coverPath?}`. The JP middleware wraps it | renderer/src/lib/projects.ts:4-72 |
| Active id | Persisted only in electron-store `activeProjectId`, through IPC `settings:get/set-active-project-id` | main/src/modules/SettingsModule.ts:30-54; preload/src/settings.ts:3-9 |
| First run | Main creates "Project 1" at 24 fps if there is no active id and no `project-*.json`. The renderer creates the same as a fallback when the list is empty | JPM:226-256; JP:1073-1112 |
| List | `projects:list-json` reads every `project-<N>.json` and returns `{id,name,fps,folderUuid,aspectRatio,createdAt,lastModified,coverPath,filePath,sizeBytes,durationUs}` (the length is the last clip's end), sorted by `lastModified` descending. The home screen shows them as cards (a square cover, the name cut in the middle, "size \| length") or rows (with ratio and when edited), sorted by last edited (or newest, or name), with a name search; it reads the list again on each visit for lengths, sizes and covers. Library (its sidebar) lists them with their files | JPM:979-1104; HomeScreen.tsx |
| Create | Name is `Project <k>` with k the smallest unused integer, at the current fps. From the home screen's Create project (16:9) or a size under it (16:9, 9:16, 1:1, 4:3, 4:5, 21:9, 2:3), passed to `projects:create-json` as `aspectRatio`. Main allocates id = max existing N + 1 and writes a doc with that `aspectRatio` (16:9 when none) and `defaultClipLength 5`. The renderer calls `addProject`, `setActiveProjectId` and opens the editor. The first video or photo dropped on an empty timeline still sets the canvas to its own ratio, whatever the project was created at (TimelineEditor.tsx:774-799) | project-actions.ts; JPM:119-205,1107-1151 |
| Switch | Click a card → `setActiveProjectId` (if it isn't the loaded one) → the switch flow in 11.4, and the editor shows. The loader persists the id to electron-store, loads the JSON and hydrates the stores. `projectsLoaded` is set to `true` 1000 ms after the load finishes; the window shows "Preparing workspace" until the first load, then the home screen; opening another project shows "Opening project" until it's loaded. The last project opened is loaded at start-up behind the home screen and marked on its card | project-actions.ts; JP:1013-1220; renderer/src/components/App.tsx |
| Home and covers | The top bar's Home pauses playback and saves the engine's frame at the playhead as the project's cover (`projects:save-cover`, JPEG ≤ 720 px tall), so drafts and ProRes projects get covers too. The cover is also still made from frame 0 by the old export path 1 s after clips change (JP:486-640) | project-actions.ts |
| Missing JSON | A missing `project-<N>.json` loads as blank stores: viewport reset to scale 0.75 with the pointer tool, `focusFrame` 0 | JP:1122-1203 |
| Rename | The open project: the name field in the middle of the top bar; commits on blur or Enter. `updateProject({name})` triggers an autosave, which writes `meta.name`. Any project: a card's ⋯ ▸ Rename; one that isn't loaded is read with `projects:load-json`, given the name and written with `projects:save-json` (only the loaded project is autosaved). There is no rename IPC | Topbar.tsx; project-actions.ts |
| Delete | A card's ⋯ ▸ Delete, behind a confirmation dialog. The loaded project is first swapped for the most recent other one (or a new empty one), so the switch's save of the outgoing project can't write it back. `projects:delete-json` unlinks the JSON and runs `rm -rf <userData>/media/<sanitized folderUuid>`, which removes only symlinks and proxies, not the user's originals. The store then calls `removeProject` | project-actions.ts; JPM:1154-1233; projects.ts:52-60 |

### 11.6 Settings

| Key | Scope / storage | Type | Default | Options / notes | Cite |
|---|---|---|---|---|---|
| `activeProjectId` | app, electron-store `config.json` | `string\|number\|null` | unset | Only key in `Settings` | SettingsModule.ts:7-9 |
| `settings.fps` | project JSON | number | 24 | Select 24/25/30/48/60. Save calls `setFpsWithRescale`, which rescales clip start, end and trim by `round(f/old*new)` and then runs `resolveOverlaps` | SettingsModal.tsx:225-258,389-394; control.ts:210-243; clip.ts:150-160,2026-2047 |
| `settings.defaultClipLength` | project JSON | number, seconds | 5 | Select 3/5/10/15/30. Clamped to `max(1, round(x))` | SettingsModal.tsx:264-296,395-398; control.ts:244-246 |
| `settings.aspectRatio` | project JSON | `{width,height,id}` | 16:9 | From the viewport store | JPM:160-164; viewport.ts:59 |
| `layout` | renderer localStorage `openrip:layout-config` (zustand `persist`) | `"default"\|"media"\|"properties"` | `default` | UI only; the top bar's layout toggles call them Default, Media and Inspector | renderer/src/lib/layout-config.ts:4-19 |
| Panel sizes | renderer localStorage `react-resizable-panels:openrip:layout:<layout>[:<group>]` | panel sizes per group | the layout's defaults | Each layout's groups keep their own sizes (`autoSaveId`) | renderer/src/components/App.tsx |
| Player | renderer localStorage `openrip:player` (zustand `persist`); the bar's guides button and the header menu set the guides | `{quality: 1\|0.5\|0.25, guides}` | Full, no guides | The preview's quality (the engine renders at that fraction of the canvas's size on screen) and safe-area guides | renderer/src/lib/player.ts |
| Home and media views | renderer localStorage `openrip:home-view`, `openrip:media-layout` | `"grid"\|"list"` | grid | The projects' and the media library's grid or list | HomeScreen.tsx; MediaMenu.tsx |
| Sidebar collapsed | localStorage `CategorySidebar:<title>` / `sidebar:filter` | `"1"\|"0"` | expanded | UI only | renderer/src/components/menus/CategorySidebar.tsx:25-42; FilterMenu.tsx:420 |
| Update toast | localStorage `apex:lastShown:app-update` | epoch ms string | none | Remind every 24 h | renderer/src/hooks/use-update-toasts.ts:20,152 |

There is no persisted window state. The window opens fullscreen on macOS and Linux, and maximized on Windows (main/src/modules/WindowManager.ts:87-147).

## 12. Editing operations

**Common post-processing.** Every store edit lives in `useClipStore`, and almost every one ends the same way (renderer/src/lib/clip.ts):
- runs `resolveOverlaps`;
- sets `clipDuration = max(endFrame)` (clip.ts:145-148);
- prunes unreferenced assets with `pruneAssetsForClips` (clip.ts:162-209);
- re-baselines timeline zoom with `_updateZoomLevel` (clip.ts:593-668).

Every edit the store makes then follows the timeline's rules (`withTimelineRules`/`followRules` in clip.ts, the rules in renderer/src/lib/timeline-edit.ts): a track the edit left empty goes (the main track stays while anything is on the timeline; a track added empty stays until it's used), and with the magnet on the main track closes up. States put back by undo or loaded from a file come in through `setState` and are left as they were. Before, an effect in TimelineEditor removed every empty track after each clip change, as a second change.

**Undo/redo** exists since 2026-10-17 (renderer/src/lib/history.ts; docs/plan/app-engine-integration.md). Each edit below is one step; markers, track locks and the magnet are in what it keeps.

| Op | Entry points | Exact rules |
|---|---|---|
| **Split** | ⌘B and the Split button (`splitAtPlayhead`); ⇧⌘B splits every track; clip menu "Split at Playhead" | Always cuts at `focusFrame`: the selected clips under the playhead, or with none selected the main track's clip there, as CapCut does. Clips on locked tracks are left; a clip's linked clips are cut with it, the left halves linked to each other and the right halves. `splitClip` needs `start < cut < end` (clip.ts:1553-1562). **Infinite trims become 0 first** (:1581-1586). Left half: `endFrame=cut`, `trimEnd += cut−oldEnd` (:1590-1596). Right half: `startFrame=cut`, `trimStart += cut−oldStart` (:1599-1605). Masks split at `cutLocal = cut − start + trimStart`: keyframes `<cutLocal` go left, the rest go right, and indices are unchanged. Image clips copy keyframe 0 to both halves (:1608-1716). Both halves get new uuids and are selected. |
| **Merge** | `mergeClips` (clip.ts:1724-1767). **No UI**: `MergeButton` is never rendered (Buttons.tsx:301-329). | Needs ≥2 clips whose sorted `end == next.start`. The result is the first clip with `[min,max]`. Track, type and asset are not checked. |
| **Group** | Mod+G (renderer/src/components/controls/Controls.tsx:395-404); clip menu | Needs ≥2 non-group clips. The group gets `[min start, max end]`. `children` is one id list per source track, top→bottom by `timelineY`, each sorted by start (clip.ts:1276-1302). Children get `groupId` and `hidden:true` but **keep their own `timelineId` and frames** (:1306-1313). The group goes on the top-most `media` track that is free over the span, otherwise on a new 72 px media track (:1222-1274). |
| **Group move / resize** | drag | Groups **cannot be resized** (clip.ts:1099-1101). Moving one shifts every child by the same delta. If the group changes track, the children's `timelineId` changes to the group's track (clip.ts:928-959). |
| **Ungroup** | Mod+Shift+G (Controls.tsx:372-394); clip menu | The bottom children list goes first and prefers the group's track when its type matches and it is free. The other lists search upward for a free track of the right type, otherwise a new track is inserted at the group's index (clip.ts:1437-1484). Children are un-hidden, `groupId` is removed, and the group is deleted (:1509-1536). |
| **Copy / Cut / Paste** | Mod+C/X/V (Controls.tsx); clip menu; track menu "Paste at Playhead" (renderer/src/components/timeline/Timeline.tsx) | The clipboard is in memory (`clipboard: AnyClipProps[]`, shallow copies). It is not the OS clipboard. Paste places clips at `focusFrame`, keeping their relative offsets. Target track: the explicit one (no type check) unless locked, else the first unlocked track of the matching type, else a new one; onto the main track with the magnet on, in at the clip boundary nearest the playhead. Pasted clips get **new uuids and `trimStart=trimEnd=0`**; copies of linked clips are linked to each other, not to the originals. The timeline's zoom range follows the longer project, as after an add (it didn't). Cut skips locked tracks and takes linked clips along. |
| **Delete** | Delete/Backspace (Controls.tsx); Trash button; menu | **A ripple delete on the main track with the magnet on**: the clips after close up (followRules). Overlay tracks, and the main track with the magnet off, keep the gap, as in CapCut. A clip's linked clips go with it; clips on locked tracks stay. Deleting a group removes the group and all its children. Deleting a child removes it from `children`, and if ≤1 child remains the group is ungrouped. Key priority: the selected mask (mask tool) > the selected draw line > a marker selected on the ruler (no clips selected) > the clips. |
| **Magnetic main track** | toolbar Main track magnet, P (`magnet` in the clip store, saved as `settings.mainTrackMagnet`; on for a new project) | The main track is the lowest video track (`mainTrackOf`). With the magnet on its clips run end to end from 0 in time order (`packMainTrack`): a clip dropped, dragged or pasted onto it goes in before the clip under the pointer when in its first half, else after it, the rest making room (shown during the drag: its clips move aside, `mainPreview`); a clip deleted, trimmed or dragged off closes up. A left edge trimmed stays where the clip before ends and the clip after moves up; trimmed outwards, the clip grows and pushes the rest. What a moved clip carries moves with it: a group's children, and its linked clips while linkage is on (not on locked tracks). Turning the magnet on closes the track up. A locked main track isn't changed, and CapCut doesn't change the magnet then. The main track stays the lowest video track: a video dropped below it goes onto it (magnet on) or onto a new track just above it; a group made of its clips stays on it; a video track can't be dragged below it; it can't be deleted while another video track exists. |
| **Delete left / right** | Q / W; toolbar buttons (`trimToPlayhead`) | CapCut's: the part of the selected clips before (Q) or after (W) the playhead goes; with none selected, the main track's clip under the playhead. Linked clips are trimmed with it. With the magnet on the main track closes up, and after Q the playhead goes to where the clip now starts. |
| **Links** | ⇧⌘S / Detach Audio make one (§7.6); clip menu Link (two clips or more) and Unlink; toolbar Linkage, ` (controls `linkage`, saved in `editorState`) | Clips sharing a `linkId` move (on their own tracks) and take a speed change together; a trim moves the same edge of each by the same amount, only as far as all of them can; a split cuts all of them; a delete or cut takes all of them. A clip whose linked clip is on a locked track can't be edited. With linkage off each clip is edited alone and the links stay. |
| **Markers** | M (at the playhead), toolbar Add marker; tags under the ruler (renderer/src/components/timeline/Markers.tsx); ⌥← / ⌥→ | `{id, frame, color, note}` in the clip store, saved as `timeline.markers`. A new one gets the accent colour and CapCut's name, "Marker 01", "Marker 02"…; M on an existing one selects it. Drawn as CapCut's tag (10 px, pointed below, hanging from the ruler's foot; a white edge when selected). A click goes to it and selects it (Delete removes it); a drag moves it, snapping like a clip; a double-click or its menu's Edit marker opens CapCut's box above the ruler: name and time (HH:MM:SS:FF) fields, saved on Done or Enter, five colours (CapCut's hues, the accent in place of its cyan, which comes last), Delete and Done. Its menu also has Delete marker and Delete all markers in timeline. CapCut drafts' timeline markers are imported with their colours (main/src/modules/CapCutImportModule.ts). |
| **Separate (detach) audio** | `SeparateButton` (Buttons.tsx:349-381); menu "Detach Audio" | §7.6. |
| **Timeline snapping** | clip drag and edge resize (TimelineClip.tsx); marker drag; toolbar Auto snapping, N (controls `snapping`, saved in `editorState`) | `SNAP_PX = 6` screen px (renderer/src/lib/timeline-edit.ts). Either edge of a dragged clip, or a dragged edge, snaps to the playhead, the markers and the edges of every clip on every track, except the clip's own linked clips; the dashed guide line shows while snapped. Held ⌘ skips it. A drag onto the main track with the magnet on goes in between clips instead. |
| **Playhead** | its handle (renderer/src/components/timeline/Scrubber.tsx); ruler clicks; ← / →, ↑ / ↓, Home / End | Dragged, the handle sits on the frame under the pointer, or on a marker or clip edge within reach (snapping, N; held ⌘ skips it); let go, it stays on that frame. Before, letting go moved it to the ruler's minor tick grid, which on a long timeline zoomed in is two frames or more apart. |
| **Canvas snapping** | `updateGuidesAndMaybeSnap` (renderer/src/components/preview/clips/ImagePreview.tsx:242-290; also VideoPreview.tsx:364, TextPreview.tsx:144, ShapePreview.tsx:121) | 4 screen px / viewport scale. The bbox centre snaps to the canvas centre and to the 25 % / 75 % lines; the bbox edges snap to the canvas edges. Disabled while rotating. |
| **Move between tracks** | Konva drag (TimelineClip.tsx) | Targets the nearest track centre that passes `isValidTimelineForClip` and isn't locked. Within 16 px of the dashed line between tracks, a new track is created (never a video track under the main track). The drop position is used if it is free; otherwise the clip snaps into the containing or nearest free gap in the visible window. Onto the main track with the magnet on, see Magnetic main track. Its linked clips move by the same amount on their own tracks. |
| **Library drop** | dnd-kit (renderer/src/components/timeline/TimelineEditor.tsx) | Length: video/audio `round(duration·fps)`; image/filter `fps·defaultClipLength`. The clip is pushed right past overlaps; onto the main track with the magnet on it goes in between clips (Magnetic main track). Not onto a locked track. The **first image or video sets the project aspect ratio** to the media's reduced W:H. |
| **Resize / trim** | edge handles; Start/End inputs (renderer/src/components/properties/DurationProperties.tsx) | An edge goes as far as the clip's media allows (`clampEdgeDelta` in clip.ts): a right edge keeps `end ≥ start+1` and `trimEnd ≤ 0`, a left edge `start ≤ end−1`, `start ≥ 0` and `trimStart ≥ 0`; the trim follows the edge. Before, an edge past the media was refused (the clip stopped at the last accepted mouse move). Unbounded (±∞) clips have no limit. Linked clips take the same change. The Start/End inputs still refuse a value past the media (`isValidResize`). Neighbours are not checked; `resolveOverlaps` pushes them, and with the magnet on the main track closes up. A drag follows the pointer from where it began, so the main track closing up under a left edge doesn't move the mark. A press on a handle no longer reorders the store's clips (`moveClipToEnd`, gone: it was an invisible change undo recorded); the clip is raised in Konva instead. |
| **Speed change** | Speed tab (renderer/src/components/properties/SpeedProperties.tsx): Standard and Curve | `speedPatch` (lib/speed.ts): `end = start + round(media/newSpeed)`, the trims scaled so the in-point stays, keys kept on the media, linked clips along. Standard: the speed (0.1–100× on CapCut's slider, or typed), the length typed (the speed from it), Change audio pitch (`changePitch`, also on linked clips), Reset (1×). Curve: None, Custom and CapCut's six presets as cards with their curves drawn; the editor plots the speed (0.1–10×, log) over the clip's media with the points as handles (dragged up and down, and along between their neighbours), the playhead, + / − (a point at the playhead, or that point taken away; also ⌫ on a picked point) and Reset (the preset's points); `setSpeedCurve`. A length rounds to whole frames, so a trip to 100× and back can change the media a clip spans by up to half a frame at that speed. |
| **Transitions** | the Transitions tab's cards (+, a click, or dragged onto a cut); the marker on a cut (renderer/src/components/timeline/clips/TransitionMarkers.tsx); its inspector (renderer/src/components/properties/TransitionProperties.tsx); lib/transitions.ts | A transition goes on a cut: a video or photo with a clip starting where it ends on its track (`transitionOut` on the first). + gives it to the selected clip's end, or to the cut before it when nothing follows; it keeps the cut's duration and direction where it can, and is selected (`selectedTransitionId` in the controls store, which a clip's selection drops). Its marker is a translucent handle over the cut as wide as it is long; a click selects it, ⌫ or right-click ▸ Delete removes it, the selected one's sides drag its duration. The inspector: name, duration (0.1 s to the shorter clip), the direction for Slide, Push and Wipe, a reset, Apply to all (the same on every cut of the track, one step). A draft's transition the engine doesn't draw is named and kept. |
| **Freeze, Reverse** | the toolbar's transform tools ▾ (Freeze, Reverse, Mirror, Rotate; renderer/src/components/timeline/TimelineTools.tsx); the clip menu's Edit › Freeze, Reverse; lib/timeline-motion.ts | Freeze at the playhead on a selected video under it, else the main track's: `freezeFrame` (a 3 s still between the halves, the rest of the track later; the still selected); off on a still. Reverse toggles the selected video or audio (`setReverse`), ticked in the menu while reversed. Mirror and Rotate: `toggleFlip`, `rotate90`. |
| **Keyframes on the timeline** | the selected clip's bar (renderer/src/components/timeline/clips/ClipKeyframes.tsx); the keyframe graph, ⌥K (renderer/src/components/timeline/KeyframeGraph.tsx); lib/timeline-keyframes.ts | A 9 px accent diamond at each keyed frame (one for every property keyed there), ringed white under the playhead. A click puts the playhead on it; a drag moves its keys (whole frames); right-click: Linear, Ease in, Ease out, Ease in and out, Hold (the current ticked), Keyframe graph, Delete keyframe. The graph opens over the selected clip's bar (above it, an overlay rather than CapCut's taller clip): the property (its keyed numeric ones), four curve shapes for the span at the playhead, ‹ ◆ ›, and a 100 px plot of the value with its keys and that span's two bezier handles, dragged into a custom ease (`setKeyframeEase`). |
| **`resolveOverlaps`** | after almost every edit (clip.ts:260-302) | Hidden clips (group children) are passed through. Visible clips are sorted by `startFrame` **across all tracks**. Each clip is compared **only with the previous resolved clip**: if both are on the same track and `start < prev.end`, the clip shifts to `[prev.end, prev.end+dur)`. It cascades and never trims. |
| **Tracks** | `TimelineProps` (types.ts); track headers (renderer/src/components/timeline/TimelineSidebar.tsx, controls in TrackControls.tsx) | Tracks are created by drop, drag to a dashed line, group, ungroup, paste, detach, and canvas text/shape creation (always a new track at the top) or draw (reuses the first `draw` track), and by the headers' + (Video, Audio, Text or Filter track: audio at the bottom, the rest on top). `addTimeline(t, i)` inserts **after** `i`, so −1 means top. `timelineY` is the running sum of heights. A track an edit empties is removed in that edit (followRules); one added empty stays. Track heights are CapCut's rows for the kind plus the 8 px gap (`trackHeightFor`; docs/plan/capcut-ui-spec.md §4.11): the main track 76 px, overlay video 52, audio 50, the rest 24; tracks are laid out again on every change and on load. Headers (open by default at CapCut's 123 px; the rail folds them to the kinds) show CapCut's columns, 24 px apart: kind, lock, hide (not audio), mute and a "…" menu (video and audio tracks); right-click on a header or a track's row opens the menu (Lock/Unlock track, Delete track). A header dragged up or down moves its track (`moveTrack`). Delete takes the track's clips (their linked clips elsewhere are unlinked); not a locked track, nor the main track while another video track exists. A locked track (`locked`, saved) is dimmed; its clips can't be selected, dragged, trimmed, split, deleted or moved onto, and its clips leave the selection when it's locked. |
| **FPS change** | `setFpsWithRescale` (renderer/src/lib/control.ts:210-243) → `rescaleForFpsChange` (clip.ts:2026-2050) | `startFrame`, `endFrame`, `trimStart` and `trimEnd` become `round(f/old·new)`. Non-finite or **negative** values are left unchanged (clip.ts:150-160), so **`trimEnd` (≤0) is never rescaled**. The window, `totalTimelineFrames` and `focusFrame` are scaled too. Mask keyframe indices and speed are not. The only caller is SettingsModal. |
| **Timeline zoom / pan** | slider and ± buttons (Controls.tsx:22-208); wheel/ruler (TimelineEditor.tsx:1024-1105) | Integer levels 1..10. The window width at level i is `round(T·(5/T)^((i−1)/9))`, with `T = totalTimelineFrames`, anchored at `focusFrame`. Baseline `T = max(5, round(maxEnd·5/3))`, so the content fills 60 % at level 1 (clip.ts:593-668). The wheel only pans (Shift ×3); there is no wheel zoom. Playback follow jumps a page at a time. Ticks are frame-based at levels 8–10 (renderer/src/lib/zoom.ts:29-36). |
| **Selection** | click / Shift+click (control.ts:281-300) | Shift toggles. There is no marquee and no select-all. The properties panel shows the **last** selected clip. |
| **Crop** | Crop button → MediaDialog (Buttons.tsx:383-444) | See §1.2. Aspect presets: Original, 1:1, 16:9, 9:16, 4:3, 3:4, Custom (renderer/src/components/dialogs/MediaDialog.tsx:65-73). The dialog's `rotation` is ignored on confirm. |

## 13. UI-level features (brief; UI stays in TS)

**Shell (Phase 4, 2026-10-17).** The app opens on a home screen (§11.5); the editor is laid out as CapCut's, to the measurements in docs/plan/capcut-ui-spec.md: a 35 px top bar on the window's surface, then a left panel, the player in the middle, the inspector on the right and the timeline across the bottom, 8 px from the window's edges with 7 px gaps between columns and 6 px between rows (the gaps are the resize handles). Panels have 8 px corners and a 42 px header strip with a hairline under it. The surfaces are CapCut's grey ramp as theme tokens: window `brand-background-dark` #141414, panels and dialogs `brand-background` #262626, header strips and menus `brand-header` #303030, fields `brand` #1c1c1c, raised controls `brand-background-light` #3b3b3b, `brand-hover` #404040, `brand-button` #4f4f4f, `brand-hairline` #070709, `brand-divider` #373737; the accent stays the app's lavender (selected tabs and items, the current time, primary buttons). Menus are #303030 with 32 px rows and a #404040 hover; dialogs have 12 px corners over a 60 % scrim. The UI's type is the system's (`--font-ui`: SF Pro on macOS, Segoe UI on Windows) at 11–13 px, tabular figures for times; `font-poppins` now gives it too, and the timeline's canvas labels use it. Poppins and the other web fonts stay loaded for text clips. Icons are react-icons (Lucide).

**Home screen** (renderer/src/components/home/HomeScreen.tsx): on a dark background tinted with the accent, a 216 px sidebar with Home, Templates (what's coming) and, under Management, Library (every project with its file); Settings at the top right. Home has a 143 px banner with Create project and the sizes under it, quick starts as 188×136 cards (Open a CapCut project; Import media, a new project whose media picker opens at once; Continue the last project), and Projects: a search that opens a field, a grid or list menu and sort; 124×123 covers on a 146 px pitch with the name and "size | length" under them, or 46 px rows.

**Layouts:** four presets, CapCut's, persisted in localStorage `openrip:layout-config` (renderer/src/lib/layout-config.ts; renderer/src/components/App.tsx), each keeping its panels' sizes (§11.6); Reset current layout in the menu clears them:
- `default` (Default): left panel | player | inspector on top (34.6/38.4/27 %, 55 % of the height), timeline below
- `media` (Media): the left panel full height on the left (32.5 %)
- `properties` (Inspector): the inspector full height on the right (24.6 %)
- `vertical` (Vertical): the player full height on the right (26.6 %), for 9:16 work

**Top bar** (renderer/src/components/bars/Topbar.tsx): Home (back to the projects; disabled while exporting) and Menu (New project, Open a CapCut project…, Settings…) on the left; the project's name in the middle (13 px semibold), renamed in place; the layout menu, the shortcuts list, Settings and Export (22 px, accent) on the right, with the export's progress in Export's place while it runs.

**Left panel** (renderer/src/components/panels/MediaModelPanel.tsx): a row of tabs, Media, Audio, Text, Stickers, Effects, Transitions, Captions, Filters, Adjustment, Templates (`SidebarSection`, types.ts), on the header strip (icon over a 12 px label, the selected one in the accent, scroll buttons when they don't fit), each with a 120 px column of filled sections beside its library (Media: Import > Media, Library; Text: Add text, Animations; Filters keeps its categories column). Media is the media library: with nothing imported, a dashed drop zone that imports on a click; then Import (files or a folder), Record (not yet), and search, grid or list, sort and filter on the right; the media under "All" as 120×80 cards (the name cut in the middle, the length top-right, "Added" while a clip uses it). Filters is the LUT packs. Text adds a text at the playhead (3 s, centred, on a new top track, selected on its Text tab) in one of eight styles made of the text panel's own settings (renderer/src/lib/text-presets.ts), and gives the selected text one of the Animation tab's In animations. Transitions lists the engine's transitions in CapCut's grid, a category at a time (its column: Classic, Basic with Blink's images on hand, Slide, Mask, Movement, under a Transitions heading): 86 px cards showing two shots meeting through the transition (drawn by the app, played while hovered; renderer/src/components/motion/Previews.tsx), the name under them, a round + on hover; the card of the selected cut's transition is outlined. + (or a click) gives it to the selected clip's cut, a card dragged onto a cut on the timeline puts it there (the cut lights up on the way; lib/transitions.ts). Audio, Stickers, Effects, Captions, Adjustment, Templates and Media's Library say what's coming and what to use meanwhile (renderer/src/components/menus/PendingMenu.tsx).

**Player** (renderer/src/components/panels/PreviewPanel.tsx): a header with its name and the project's and a menu (safe-area guides, the canvas's zoom: fit, 50, 100 and 200 %, and full screen), with no tool row, as CapCut's has none; the canvas (Preview); and a 44 px bar under it (renderer/src/components/preview/PlayerBar.tsx) with the time as `HH:MM:SS:FF / HH:MM:SS:FF` (the current one in the accent), play (go to start and ±5 s beside it, hidden when the player is narrow), and safe areas, the preview's quality (a boxed "Full", two-line menu: Full, Half, Quarter), zoom to fit, the ratio (boxed; Custom and the presets with their shapes; RatioMenu.tsx) and full screen. The guides are the action- and title-safe boxes (SafeAreaGuides.tsx).

**Inspector** (renderer/src/components/panels/ClipPropertiesPanel.tsx): the selected clip's tabs, grouped as CapCut groups them, each a set of the existing property panels; the tab stays from one clip to the next (renderer/src/lib/inspector.ts). Its tabs are 13 px semibold labels on the header strip, the selected one in the accent; sub-tabs are a 24 px segmented control. Rows have a 112 px label column and 22 px fields (PropertyRow; Input and PropertiesSlider restyled: sunken fields, raised steppers, a 2 px white-filled slider). With nothing selected it shows the project's Details (name, path, how media are kept, media used; ratio, resolution, frame rate, length, clips) and Modify, which opens the project settings.

| Clip | Tabs (sub-tabs) |
|---|---|
| video / image | Video or Image (Basic: Position, Layout, Appearance; Mask), Audio (video with sound), Speed (video: Standard, Curve) or Duration, Animation (In, Out, Combo), Adjust |
| text | Text (Basic: the text panel; Transform: Position, Layout, Appearance), Animation (In, Out, Loop), Duration |
| shape | Shape (Basic: Appearance; Transform: Position, Layout), Duration |
| audio | Audio, Speed (Standard) |
| a transition (selected on the timeline) | Transition (its parameters; Apply to all) |
| filter (and a draft's filters and stickers) | Filter (the filter panel and Duration) |
| drawing | Line (with a line selected), Duration |

A selected mask opens Video ▸ Mask; a selected line opens Line.

The Animation tab (renderer/src/components/properties/AnimationProperties.tsx) is CapCut's: each sub-tab a grid of 62 px cards on a 78 px pitch, None first, each card's preview played while hovered (and while chosen), the chosen one outlined in the accent, and the chosen animation's duration in a 36 px footer (field, stepper, slider; at most the clip, an Out what the In leaves; a Combo spans the clip). A Combo replaces the In and Out and they replace it. A draft's animation the engine doesn't draw has a card of its own after None ("name (CapCut)") with a note; a caption with spoken words also has its Words select (how it pages its words) above the cards.

**Timeline toolbar** (renderer/src/components/controls/Controls.tsx): 32 px with a hairline under it, 28 px buttons on a 36 px pitch, in CapCut's order: Undo, Redo, Split (right after Redo), Delete left, Delete right, Delete, Add marker, Crop, the transform tools ▾ (a 238 px menu of 36 px rows: Freeze, Reverse, Mirror, Rotate) and Detach audio on the left; Record a voiceover (not yet), Main track magnet, Auto snapping and Linkage (toggles: on, the glyph in the accent on a dark 24×23 chip), a divider, Zoom to fit and the zoom slider on the right. The timeline's buttons and toggles are standalone components in renderer/src/components/timeline/TimelineTools.tsx, each tooltip naming its shortcut. The transport moved under the player.

**Ruler, playhead and clip colours** (renderer/src/components/timeline/TimelineEditor.tsx, Scrubber.tsx, clips/thumbnails/): CapCut's 18 px ruler (10.5 px major ticks #727272 with their MM:SS label beside them in #6c6c6c, 5.5 px minor ticks #404040). Time 0 sits 50 px into the timeline (`TIME_ZERO_X`, renderer/src/lib/timeline-geometry.ts), leaving CapCut's Cover column; every track uses it, whatever padding a project saved. The main track's Cover tile is drawn there, dimmed and letting clicks through (no cover editor yet). The playhead is a hollow white 10×14 shield over a 1 px line. Clips take CapCut's colours: video #1e4c51 under its thumbnails, audio #182f55 (#1d4950 with a teal waveform when it comes from a video), text #924e3c, a draft's filter, effect, sticker and adjustment bars #464186, #6e4c7f, #cc9641 and #a58744 (the app's shapes and drawings keep theirs); text and filter labels sit on a chip of the clip's colour with 9% white, in #e0e0e0.

**Tools:** there is no tool row. Text comes from the Text tab (Add text, or T then a click); drawing (pen, highlighter, eraser, with size, smoothing and colour) and shapes (added at the playhead, or S then a drag) from the Stickers tab's Draw and Shapes sections (renderer/src/components/menus/CanvasToolsMenu.tsx, renderer/src/lib/shape-presets.ts); masks from the Mask tab's picker (renderer/src/components/properties/mask/AddMaskTools.tsx). While one is on, a chip at the top of the canvas says what a drag does, with Done; Esc or V goes back to selecting (renderer/src/components/preview/ToolChip.tsx).
- `ViewTool`: pointer, hand, mask, draw, shape, text (keys V, H, D, S, T)
- shape sub-tools: rect, ellipse, polygon, line, star (keys 1–5 after S)
- mask sub-tools: lasso, shape, draw
- draw sub-tools: brush, highlighter, eraser (keys 1–3 after D)
- preview zoom: 0.1–4 (viewport.ts:48-49), with Fit, 50, 100 and 200 % in the player's menu

**Transport:** under the player: go to start, ±5 s (`fps·5` frames), and play/pause, which restarts from 0 when at the end (Buttons.tsx:23-101; control.ts:302-316). Time is shown as `HH:MM:SS:FF`. `ExtendTimelineButton` and `ReduceTimelineButton` exist but are never rendered.

**Keyboard shortcuts.** The `document` keydown handler is in Controls.tsx; it passes keys to the timeline's handler (`handleTimelineKey`, renderer/src/lib/timeline-shortcuts.ts) first. It is ignored while focus is in an input, textarea or contentEditable. "Mod" means ⌘ or Ctrl. The Shortcuts menu lists them from renderer/src/lib/shortcuts.ts.

| Keys | Action | Cite |
|---|---|---|
| Mod+Z / Mod+Shift+Z, Mod+Y | undo / redo | Controls.tsx; lib/history.ts |
| Delete / Backspace | delete selected mask (mask tool) > selected draw line > selected transition > selected marker > selected clips (a picked speed-curve point first, while the Curve editor has one) | Controls.tsx; SpeedProperties.tsx |
| Space | play / pause | timeline-shortcuts.ts |
| Mod+B / Mod+Shift+B | split at the playhead (selected clips, else the main track's) / every track | timeline-shortcuts.ts |
| Q / W | delete left / right of the playhead | timeline-shortcuts.ts |
| M; Alt+← / Alt+→ | add marker at the playhead; previous / next marker | timeline-shortcuts.ts |
| P / N / ` | main track magnet / auto snapping / linkage | timeline-shortcuts.ts |
| ← / →, Shift+← / Shift+→ | a frame back / forward; 10 frames | timeline-shortcuts.ts |
| ↑ / ↓; Home / End | previous / next edit (a clip's start or end); start / end | timeline-shortcuts.ts |
| [ / ] | select the clips left (starting before) / right (ending after) of the playhead | timeline-shortcuts.ts |
| Mod+A | select every clip not on a locked track | timeline-shortcuts.ts |
| Mod+Shift+S | extract the selected video's audio | timeline-shortcuts.ts |
| Mod+= / Mod+−; Shift+Z | timeline zoom in / out; zoom timeline to fit | timeline-shortcuts.ts |
| Alt+K | the selected clip's keyframe graph | timeline-shortcuts.ts |
| Delete / Backspace on a selected mask keyframe | delete the keyframe (capture phase) | renderer/src/components/timeline/clips/MaskKeyframes.tsx:516-541 |
| Mod+C / Mod+X / Mod+V | copy / cut / paste at playhead | Controls.tsx:341-367 |
| Mod+G / Mod+Shift+G | group / ungroup | Controls.tsx:370-406 |
| Mod+0 / 5 / 1 / 2 | preview zoom fit / 50 % / 100 % / 200 % | Controls.tsx:415-427 |
| 1–5 (shape tool) | rect / ellipse / polygon / line / star | Controls.tsx:431-457 |
| 1–3 (mask tool) | lasso / shape / draw | Controls.tsx:460-477 |
| 1–3 (draw tool) | brush / highlighter / eraser | Controls.tsx:480-496 |
| V H D T S | pointer / hand / draw / text / shape (M is now Add marker, as in CapCut; the mask tool is in the preview's toolbar) | Controls.tsx |
| Escape | close context menu; exit fullscreen; leave text edit | GlobalContextMenu.tsx:68-70; FullscreenPreview.tsx:327; TextPreview.tsx:788-797 |
| Text-edit keys (Mod+A/C/X/V, Home, End, arrows, Delete, Backspace, Enter) | in-canvas text editor, entered by double-click | TextPreview.tsx:698-1092 |

Shortcuts that do **not** exist: J/K/L, CapCut's select/split modes (A/B), enable/disable clip (V is the pointer tool).

**Context menus** (dispatch: renderer/src/components/GlobalContextMenu.tsx:352-421):
- **Clip** (TimelineClip.tsx): Copy, Cut, Paste, Delete, Edit › (Freeze, Reverse; a video or audio), Split at Playhead, Detach Audio, Link / Unlink, Export as Image/Video/Audio (ClipExportModal), Group…/Ungroup. None on a locked track. Rows can tick a choice and open a submenu beside them.
- **Transition** (its marker): Delete.
- **Keyframe** (a diamond on the selected clip): the ease presets (the current one ticked), Keyframe graph, Delete keyframe.
- **Track background:** Paste at Playhead, Lock/Unlock track, Delete track.
- **Track header** (right-click or "…"): Lock/Unlock track, Delete track.
- **Marker** (right-click its flag): Edit marker, Delete marker, Delete all markers in timeline.
- **Selected DOM text:** Copy.

**Media library** (renderer/src/components/menus/MediaMenu.tsx; renderer/src/components/media/Item.tsx):
- Import a file or a folder, or drop files from the OS
- type filter; sort by name, duration or date
- item menu: Create/Remove Proxy (video only), Rename, Open File Location, Delete (Item.tsx:425-482)

**Settings modal** (renderer/src/components/dialogs/SettingsModal.tsx): FPS 24/25/30/48/60, default clip length 3/5/10/15/30 s, the engine preview switch and an Updates tab. Opened from the top bar's gear or Menu ▸ Settings….

## 14. Known gaps / bugs noticed (facts only)

These were found by reading the code; none were reproduced by running the app. Entries marked *(inferred)* were derived from the code without being exercised.

### 14.1 Time model and persistence
- **Frames drift on save/load.** Frame→tick→frame conversion truncates in both directions. At 24/30/48/60 fps, any frame with `f·1e6 mod fps ≠ 0` reloads as `f−1` (e.g. 1→0, 2→1, 4→3, 5→4), so clip start, end and trim values creep down on every save/load cycle. 25 fps is exact. (json-persistence.ts:78-117)
- **FPS rescale is incomplete.** `rescaleFrame` skips negative values, so `trimEnd` (always ≤ 0) is never rescaled. Mask keyframe keys and speed are not rescaled either. (clip.ts:150-160,2026-2050)
- **Speed change leaves trims in old units.** It does not rescale `trimStart`/`trimEnd`. (clip.ts:899-922)
- **`resolveOverlaps` misses some overlaps.** It compares each clip only with the previous clip in a start-sorted list that spans all tracks. Two same-track overlaps separated in that list by a clip from another track are never resolved. (clip.ts:260-302)
- **Canvas-created clips ignore project settings.** Text, shape and draw clips last `3·DEFAULT_FPS` = 72 frames regardless of project fps or `defaultClipLength`. (Preview.tsx:1703,1781,1887)
- **Autosave misses most property edits.** It watches only timing, transform, grouping, track and asset fields. Edits to text, adjustments, filter intensity, volume, fades, masks, drawings and shape style are persisted only when some watched field changes later. (json-persistence.ts:421-479)
- **Saves can be lost or corrupted.** There is no flush on quit, so up to 500 ms of edits can be lost. The JSON write is not atomic. (JSONPersistenceModule.ts:844-856)
- **`meta.createdAt`** is overwritten on every save. (json-persistence.ts:343-344)
- **Mask `.bin` legacy-format check misfires.** Any file whose second-to-last `-` segment is all digits is treated as legacy. A uuid's last group is all digits about 0.35 % of the time, and such a mask is then read wrongly. (JSONPersistenceModule.ts:596-609)
- **Project deletion leaves files behind.** Covers and mask `.bin` files remain. Project ids are reused (max+1), so a new project can show a stale cover. (JSONPersistenceModule.ts:1154-1233)
- **New projects inherit the previous project's state.** With `editorState:{}`, the viewport, aspect ratio, playhead and zoom carry over. (json-persistence.ts:794-840)
- **Startup issues.** A stale `activeProjectId` while other projects exist can leave the app stuck on "Preparing workspace" *(inferred)*. The first load hydrates twice. Edits in the first second after load are not saved by themselves. (json-persistence.ts:1062-1218)
- **Stored but unused.** Covers are generated but never displayed. `editorState.scrollX/Y` is always 0 and `inputControls` is never read. There is no schema migration (`version` is always `"1.0.0"`).
- **No undo/redo** exists anywhere.

### 14.2 Rendering, compositing and export parity
- **Speed and trimStart map differently in preview and export.** Preview video, audio and mask use `(f − start + trimStart)·speed`. Export video and the audio mix use `trimStart + (f − start)·speed`, so split or trimmed clips with speed ≠ 1 export different source frames. (VideoPreview.tsx:965-994; AudioPreview.tsx:106-108; exporter.ts:706-724; previews.ts:692-706)
- **Mask keyframe frame spaces disagree.** Keys are written at `round(focus − start − trimStart)` (`getLocalFrame`). They are read at `floor((focus − start + trimStart)·speed)`. Split partitions at `cut − start + trimStart` and does not re-base the right half's keys. (keyframeUtils.ts:69-73; clip.ts:1619,1687-1708,2093-2098)
- **Export shifts filters to the wrong frames.** Filter applicator frames are shifted by the target clip's `startFrame` (`offsetStart`) while the clip itself is not shifted, so a filter over a clip that starts after 0 activates at the wrong frames. (prepareExportClips.ts:359-360,409-411)
- **Export filter selection differs from preview.** Filters on hidden tracks are still applied. Stacked filters run in store-array order, not top→bottom Y. "Above" is decided by `getClipPositionScore` rather than track Y. (prepareExportClips.ts:377-416; applicator-utils.ts:22-124)
- **Hidden-track logic differs for group children.** Preview uses the group's track; export uses each child's own track. (Preview.tsx:375-416; Topbar.tsx:263-268)
- **Muted tracks are still mixed into export audio.** (Topbar.tsx:263-268; no `muted` reference in export code)
- **Video-clip volume and fades are ignored** by `exportSequence` (forced to 0) and by the ffmpeg fast path. (exporter.ts:960-983)
- **Fade semantics differ.** Preview fades are relative to the source file (start of file, full duration). Export fades are relative to the visible segment. (AudioPreview.tsx:697-782; previews.ts:720-725)
- **Some sizes are not scaled in export.** Media and shape `cornerRadius` and shape `strokeWidth` are not scaled by `outH/600` and not clamped, whereas text sizes are scaled. Corners and strokes therefore come out relatively smaller at large export sizes. (export.ts:496,624,661-668,687)
- **Effects run at different resolutions.** Preview effects run at display resolution (≤ ~1067×600); export runs at native media resolution. Blur, sharpness and noise therefore look different. The noise seed is random per frame. (§3.4)
- **Export may duplicate frames** *(inferred)*. The iterator picks the latest frame with `ts < target` (strict), so CFR sources with exact timestamps can show source frame i−1 at output frame i. (video.ts:197-219)
- **Aspect-ratio change re-centres every clip**, discarding positions. (Preview.tsx:513-595)
- **Panel rotation input pivots wrongly for some shapes.** It keeps the centre fixed assuming a top-left pivot, so ellipse, polygon and star shapes (which pivot on their centre) shift. (PositionProperties.tsx:28-64)
- **Crop dialog `rotation` and `aspectRatio` outputs are ignored.** (Buttons.tsx:405-421)
- **`ImagePreview` swaps width and height** when calling `fetchImage(path, height, width)`. (ImagePreview.tsx:621-627 vs image.ts:198-203)

### 14.3 Effects, masks, text, shapes, drawing
- **Declared but never read:** `exposure`; mask `featherAmount`, `inverted` and `brushSize`; text `strokeOpacity`; `DrawingLine.transform.opacity` (editable in LineProperties); `clipPadding`. `assetIdHistory` is read for pruning but never written.
- **Text `colorOpacity` has no effect.** It is sent as Konva `fillOpacity`, which Konva 9.3.22 does not support. (TextPreview.tsx:2244; export.ts:888)
- **The mask "draw" tool is a stub.** It is reachable only via key `3`. Strokes are never committed, and the stroke flag resets only on mouse-leave. `DrawMaskPreview.tsx` renders an empty Group and is never imported. (Preview.tsx:936-963; DrawMaskPreview.tsx:13-25)
- **New masks render as a matte.** Defaults are white inside and black outside, so a fresh mask replaces the clip pixels with a white-on-black matte. Masks after the first have their background forced off. Opacity < 1 pixels are stored as `(rgb·a, a²)` because of a single-func blend. UI and shader defaults also differ for undefined fields. (useWebGLMask.ts:88-140; shape.ts:435-448,598-604; MaskOperationsProperties.tsx:159-205)
- **Mask remapping is inconsistent.** The proportional remap adds the clip's rotation delta to `shapeBounds.rotation`, even though mask space is already unrotated. Layout-panel W/H/scale edits don't remap masks at all. The polygon mask "Size" field breaks the 2/√3 ratio. (clipTransformUtils.ts:45; LayoutProperties.tsx:77-169; ShapeMaskTransformProperties.tsx:201-213)
- **Lasso limits.** A new lasso drawn inside a larger one is still added. The lasso shader caps at 4096 points, with no point simplification. (Preview.tsx:1286-1312; lasso.ts:64)
- **Mask preview is incomplete during editing.** While the mask tool is active, masks are not applied to video in preview. (VideoPreview.tsx:895)
- **Effects gaps.** Blur 1–9 is a no-op. Hue ±100 is the identity. CLUT level detection assumes a square cubic image. Dropping a filter preloads `smallPath`, but `fullPath` is what gets applied. Filter LUT paths are absolute machine paths. Text and shape caches ignore filter intensity and CLUT load state. (useWebGLFilters.ts:118; hald-clut.ts:86,252-258; TimelineEditor.tsx:738; ShapePreview.tsx:111-119; TextPreview.tsx:1542-1626)
- **Polygon opacity is ignored in preview.** `RoundedRegularPolygon` never forwards `opacity`, so it applies only in export. (custom/RoundedRegularPolygon.tsx:31-50,138-160)
- **Highlighter `multiply` blend applies only in export.** The preview computes it but never passes it to `KonvaLine`. In export with applicators, the multiply blends only against other lines. (DrawingLine.tsx:52-84 vs :590-610; export.ts:282-391)
- **Text box and shadow inconsistencies.** Text overflowing the box height is silently dropped; auto-grow happens only during in-canvas typing. `overline` cannot render. Case buttons rewrite the stored text, so the original casing cannot be restored. The stroke casts a shadow in preview but not in export. (export.ts:905)
- **Shape and colour edge cases.** `hexToRgba` breaks on the 3-digit `#RGB` that ColorInput accepts. The `line` shape is reachable only via key `4`. The star points input allows 3–12 but the setter rejects values below 4.
- **Fonts are not guaranteed.** The 9 system fonts are not bundled, and nothing awaits `document.fonts` before export. Oswald italic is synthesised.
- **Draw and eraser scope.** They act only on the first draw clip found at the current frame. The eraser `tool:"eraser"` line variant is never created.

### 14.4 Audio, media, playback
- **Clip-level "Export as Audio" fails silently.** It passes the raw store clip, which has no `src`. (GlobalContextMenu.tsx:131-145; exporter.ts:311-317)
- **`exportClip` misaligns audio.** It renders the clip-local range but mixes using absolute clip frames. Its fast path keeps embedded audio, even for detached `#video` clips. (exporter.ts:1145-1155,1230-1231,1449-1455)
- **`adelay=<ms>|<ms>` only delays 2 channels.** (previews.ts:726)
- **Audio worker and context issues.** One audio worker per asset tracks a single `currentRequestId`, so concurrent iterations on the same asset abort each other. Per-clip `AudioContext`s are never closed. There is no A/V drift correction. The `preservesPitch` fallback targets the wrong node type. The SoundTouch stretch stage is fixed at 44.1 kHz.
- **Proxy index paths are inconsistent.** Rename and delete read a per-project `.proxy-index.json`, while create, list and remove use the global one. As a result, rename loses the proxy link and delete leaves proxy files behind.
- **Proxy names collide.** `a.mov` and `a.mp4` share `a_proxy.mp4`, across all projects.
- **Asset paths are frozen at drop time.** Removing a proxy breaks clips dropped while it existed. (library.ts:65-82,371-373,465-471; renameDelete.ts:21,54)
- **"Upload Directory" imports nothing.** (MediaMenu.tsx:79; library.ts:278-282)
- **Decodability check skips video.** When audio cannot be decoded, the `canDecode` video check is skipped. (utils.ts:346-352)
- **Decoder tolerances exceed one frame.** The ±50 ms cache match and −40 ms seek acceptance are both wider than 1 frame at 24 fps. (video-decoder.worker.ts:444,461)
- **Caches and `app://` are unbounded.** `FramesCache.get()` writes to zustand on every call. Caches are never cleared on project switch. `app://` serves any absolute path with a one-year immutable cache header.
- **Missing playback controls.** There is no space-to-play, no loop, and no OS fullscreen. Animated GIF/WebP show only the first frame.

### 14.5 Export
- **Cancel leaks the encode.** On `ExportCancelledError`, `exportVideoAbort` is never called, so ffmpeg keeps running and the partial file remains. (ffmpegEncoder.ts:74-85; exporter.ts:1038-1047)
- **The fast path is unreachable from Topbar export.** Prepared clips always carry `normalizedTransform`, and the background is `#000000` unless alpha is enabled. It is a re-encode, not a stream copy. (exporter.ts:368-408; prepareExportClips.ts:581-591)
- **Resolution labels set the output *height*.** "4K" at 16:9 is therefore 7282×4096. (ExportModal.tsx:101-107; Topbar.tsx:240-247)
- **Codec and container are not validated in the UI.** The alpha check accepts vp9+mov, av1+mov, prores+webm and prores+mkv, which the encoder then rejects (error only logged). Codec and container are not cross-checked otherwise (e.g. webm+h264). (ExportModal.tsx:115-128,261-276; previews.ts:849-866)
- **The audio format choice only affects the intermediate mix.** Choosing mp3 leads to double lossy encoding. (exporter.ts:986-993; previews.ts:1002-1010)
- **Errors are only logged.** Export errors never reach a toast. (Topbar.tsx:366-370)
- **Export cache can return stale output.** The key ignores source mtime and size. Hard-linked cache entries can be overwritten by a later export to the same path *(inferred)*. An existing target counts as a hit. Delete/clear are never called. (exportCache.ts:55-142,197-235)
- **`exportClip` leaks its stage** on the cache-hit and fast-path returns. `exportVideoClose` reports success without checking the exit code if ffmpeg already exited. The `range` offset has a precedence bug (`c.startFrame ?? 0 - …`). (exporter.ts:648-649,1141-1144,1271; previews.ts:1149-1152)
- **Clip image export always renders frame 0.** `selectedFrame` is never written. (GlobalContextMenu.tsx:283-286)

### 14.6 Editing and UI
- **The Settings modal is unreachable.** `setSettingsOpen(true)` is never called, so FPS change and default clip length have no UI path. It also always shows "5" for clip length. (Topbar.tsx:384,451; SettingsModal.tsx:97)
- **Merge has no UI.** `MergeButton` is never rendered, and `mergeClips` checks only adjacency. (clip.ts:1724-1767)
- **Split makes unbounded clips finite.** It turns ±∞ trims into finite values, so a split image, text, shape, draw or filter clip can no longer be extended past the cut until the project is reloaded. (clip.ts:1581-1605)
- **Paste problems.** Paste resets trims to 0, so a trimmed video restarts at source frame 0. Targeted paste skips the track type check. Pasting a group copies only the container, sharing `children` ids. `cutClips` leaves a dangling `groupId`. (clip.ts:1804-1871)
- **Deleting a group child can be overwritten.** `removeClip` calls `ungroupClips` inside its own `set()`, then returns the pre-ungroup clip array. (clip.ts:870-889)
- **End Frame input collapses non-media clips.** `endFrameMax` evaluates to 0, so the input collapses the clip to `start+1`. (DurationProperties.tsx:65-74)
- **The "already separated" check is dead code.** (TimelineClip.tsx:1117-1133)

### 14.7 Dead / unused code (an engine port can drop it)
- **Export renderer:** the `export-renderer/src/blit.ts` free functions (`blitImage/Video/Text/Shape/Drawing`) and the no-op `cleanupVideoDecoders`; `export-renderer/src/prepare.ts`; `getApplicatorsForClipExport`.
- **Filters:** `WebGLFilterEngine`, `useFiltersStore`.
- **Legacy 24 fps pipeline:** `processMediaTo24`; `preload/src/media/{process,ffmpeg,probe,links,paths}.ts`; `convertMediaTo24Fps`; and `?startFrame=&endFrame=` src-window parsing. Nothing generates these URLs anymore (renderer/src/lib/media/utils.ts:244-259; exporter.ts:319-353). The `#audio`/`#video` hash parsing is still live because detach-audio builds those URLs.
- **Decoders:** `VideoFrameDecoder` class, `getVideoIterator`, the canvas prefetch, `cacheKeyPackets`.
- **Masks:** `updateMaskKeyframes`, `remapMaskWithClipTransform`, mask `contours` handling.
- **UI:** `useLayoutStore`, `RightSidebar.tsx` (0 bytes), `Homebar.tsx`, `ExtendTimelineButton`/`ReduceTimelineButton`, the templates/transitions/effects sidebar sections, `cursors.ts`, the audio analysers (`__apexAudioAnalysers`), and the npm soundtouch packages.
- **Misuse:** `convertFrameToProjectSeconds` calls a React hook outside a component. (clip.ts:2107-2111)
