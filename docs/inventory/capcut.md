# CapCut Desktop (macOS): engine-focused feature inventory

**Purpose.** This inventory defines the parity target for OpenRip's Rust engine. It covers the data model, rendering, codecs and performance needed to match CapCut Desktop's non-AI editing features. It lists features by name only. OpenRip must not use CapCut's effects, LUTs, fonts, music, stickers, shaders or other bundled content. See the legal line in [ROADMAP.md](../../ROADMAP.md).

**Reference build.** CapCut 9.5.0 for macOS (`com.lemon.lvoverseas`, minimum macOS 10.14), inspected read-only at `/Applications/CapCut.app` on 2026-10-15.

**Confidence tags**

| Tag | Meaning |
|---|---|
| `[bundle]` | Evidenced in the installed app: folder or file names, JSON or plist config, shader parameter names, or UI strings in `Contents/Resources/po/en.po` |
| `[known]` | Well-established public knowledge, such as official help pages, widely documented behaviour, or public community reverse-engineering of the draft format |
| `[unsure]` | Plausible but not confirmed. Verify before building against it. |

**How the evidence was gathered.** I listed directories and read `Info.plist`, JSON configs and the English localization catalogue (about 16,700 strings). I also read shader *parameter names* from the text shader sources, without copying the code. I did not launch, modify, copy or disassemble anything.

**Scope.** Anything AI/ML- or cloud-based is excluded from the main body. Those features are listed only in [Appendix A](#appendix-a-out-of-scope-aicloud). Where CapCut uses ML but a classical method exists (for example stabilization, frame blending or DSP noise reduction), the classical version is listed as a possible OpenRip feature.

---

## 0. Architecture observations (what CapCut's engine is made of)

These are not user features, but they show what a CapCut-class engine has to do.

- **Engine stack** `[bundle]`
  - `libvideoeditor`, `libVECreator` and `libclipflow_sdk` (ByteDance "VE" editing SDK)
  - `libAGFX` (graphics), `libLumiGeneRuntime` (effects runtime) and `libEffectPlatform` (downloads effects on demand)
  - `libsamicore` (audio), `libbytenn` and `libfastcv` (on-device NN and computer vision)
- **Decode** `[bundle]`
  - FFmpeg libraries (`libavcodec`, `libavformat`, `libavfilter`, `libswscale`, `libswresample`, `libavdevice`)
  - `libdav1d` (AV1), `libByteVC1_dec` (ByteDance's HEVC-family codec) and `libmp3lame` (MP3 encoding)
  - Hardware decode and encode toggles in Settings, presumably VideoToolbox
- **GPU** `[bundle]`
  - `libEGL.dylib` and `libGLESv2.dylib`: the ANGLE pattern, in which effect shaders are written for GLES and translated to Metal.
  - `VEMetalBinary_Mac.bundle` holds precompiled Metal kernels for YCbCr 4:2:0 to RGBA conversion. Their names cover SDR↔PQ, SDR↔HLG and PQ↔HLG transfer conversions, with "4×4" and "area" (downscaling) sampling variants. HDR handling therefore happens at decode-to-texture time.
  - `vhdr.metallib` (probably SDR→HDR conversion) `[unsure]` and `vmb.metallib` (purpose unknown) `[unsure]`.
- **Effect package format** `[bundle]`. Every visual feature (blend modes, chroma key, curves, colour wheels, masks, adjustments, animations, stickers, watermark) is a data-driven package. A package contains:
  - `config.json`, which links one or more parts (`AmazingFeature`, `AmazingFilter`, `InfoSticker` or `ScriptInfoSticker`) with a `zorder` and an `alphaState`
  - `main.scene` (a scene graph), `mesh/quad.mesh`, `material/*.material` and `xshader/*.vert|*.frag` (multi-pass shaders)
  - `rt/*.rt` (intermediate render targets)
  - `lua/SeekModeScript.lua` (scripted, seek-deterministic animation)
  - `ImageBusinessSlider.json` / `.lua` (which parameters the UI exposes as sliders)

  **Engine implication.** OpenRip needs an *effect graph* abstraction: a declarative multi-pass shader DAG with intermediate textures, a typed parameter schema for UI sliders and keyframes, and a pure function of (time, params). Arbitrary scrubbing must render identically to linear playback.
- **Built-in colour tools ship locally** `[bundle]`. The `Resources/` folder holds `Curves`, `PrimaryWheel` (v0/v1), `LogWheel` (v0/v1), `Chroma` / `Chroma2`, `MixMode` (blend modes), `DefaultAdjustBundle` (per-slider adjustment packages, versioned), `lut` and `lumi_js_resources` (`featureMask`, `featureBlend`, `featureBlit`). Most filters, effects, transitions, animations and stickers are downloaded from the cloud catalogue.
- **Device benchmarking** `[bundle]`. `libByteBenchMac.dylib` with `bench/score.dat`, plus `gpu_driver_bug_list.json`, implies that CapCut picks defaults per performance tier and works around known GPU driver bugs.
- **UI stack** `[bundle]`. Qt 6 / QML (Qt Quick, Shapes, Particles, Lottie via `QtBodymovin`), Chromium Embedded Framework and Lynx for web-style panels, and Sparkle for updates.
- **Project file** `[known]`. A project is a "draft" folder containing a JSON document (`draft_content.json`, or `draft_info.json` in newer builds). It holds:
  - a `materials` table: videos, audios, texts, stickers, effects, transitions, speeds, canvases, animations, masks, audio fades, beats and more
  - a `tracks` list of typed tracks. Each track holds `segments`, and each segment has a `source_timerange` and a `target_timerange` in **microseconds**, plus a `render_index`, `clip` transform values, `extra_material_refs` and per-property `common_keyframes`.

  The UI shows a "Draft Schema Version" `[bundle]`. Newer builds may encrypt the draft JSON `[unsure]`; `libvecryptor` is present `[bundle]`.

---

## 1. Media formats and decode

### 1.1 Import

| Item | Detail | Tag |
|---|---|---|
| Import entry points | Import button, drag-and-drop, import folder, "Import to timeline", right-click quick import | `[bundle]` |
| Importer MIME allow-list | `image`, `audio`, `video`, zip / octet-stream | `[bundle]` (`importer/monitor/allowtypes.json`) |
| Video containers | MP4, MOV `[known]`; AVI `[bundle]`; MKV `[known]`; M4V, FLV, MTS/M2TS, MXF, WebM | AVI `[bundle]`; MKV `[known]`; the rest `[unsure]` |
| Video codecs | H.264 and HEVC (8/10-bit) `[known]`; ProRes, including 4444 with alpha `[known]`; AV1 (dav1d is bundled) `[bundle]`; VP9 and MPEG-2/4 through FFmpeg | VP9, MPEG-2/4 `[unsure]` |
| Still images | JPG, PNG `[known]`. The Qt image plugins cover GIF, HEIC (`libqmacheif`), JPEG 2000, SVG, TGA, TIFF, WBMP, WebP and ICO/ICNS `[bundle]`, but these may serve only the UI layer, so engine import of HEIC, WebP and TIFF is `[unsure]`. RAW/DNG `[unsure]`, probably not supported. | mixed |
| Animated images | GIF imports as media. Mask tracking and relight are blocked on GIF. | `[bundle]` |
| Audio | MP3, WAV, M4A, AAC (and audio from MP4/MOV) `[bundle]`; FLAC, OGG | FLAC, OGG `[unsure]` |
| Multi-stream audio | Clips with several audio streams; the user chooses which stream to use | `[bundle]` |
| Alpha video | Exported with alpha (ProRes 4444, HEVC alpha, RLE); importing alpha video and keeping transparency | export `[bundle]`, import `[unsure]` |
| Image sequences | Only as "frame-sequence stickers": 3–49 images in one format and size, ≤ 800×800 px, ≤ 20 MB, 1–50 fps, play once or loop | `[bundle]` |
| Missing media | Detect missing or damaged files, relink one file or all, "Copy media to project" (consolidate) | `[bundle]` |
| Timeline interchange import | AAF, XML and FCPXML ("Import AAF, XML, and FCPXML files") | `[bundle]` |
| Caption import | SRT, LRC and ASS; ≤ 3 MB; one file at a time | `[bundle]` |
| LUT import | `.cube` and `.3dl`, with a per-batch limit | `[bundle]` |
| Font import | User fonts ("My fonts") and fonts installed on the system | `[bundle]` |

### 1.2 HDR, bit depth and colour

- **HDR clip detection and conversion** `[bundle]`. CapCut detects HLG and PQ clips. It offers to adapt clips to the project colour space (HLG→PQ, PQ→HLG, HDR→SDR, SDR→HDR) and has a per-clip "Color space conversion" option.
- **Supported colour spaces** `[bundle]`: Rec. 709 SDR, Rec. 2020 SDR, Rec. 2100 HLG and Rec. 2100 PQ, plus all conversions between them.
- **HDR monitor detection** `[bundle]`. CapCut falls back to SDR preview when the display can't show HDR ("preview colour may differ from export").
- **Bit depth and precision** `[bundle]`. Colour depth is 8-bit or 10-bit. A separate "Floating-point" processing option "preserves color detail and reduces banding, with higher performance needs".
- **Engine implication.** Ingest as YCbCr textures with an explicit transfer function and primaries, convert in a shader to a linear working space, and keep float16 or float32 intermediates. The project colour space decides the output transform. Tag every asset with its colour metadata on probe.

### 1.3 Resolution, frame rate, VFR

| Item | Detail | Tag |
|---|---|---|
| Project and export frame rates | 24, 25, 29.97, 30, 50, 59.94 and 60 fps | `[bundle]` |
| Higher frame rates | 120 fps and above source media decodes and is conformed to the project rate. Export above 60 fps is not offered. | decode `[known]`, export limit `[bundle]` (no higher option string) |
| Export resolutions | 480p, 720p, 1080p, 2K and 4K `[known]`; 8K `[bundle]` | mixed |
| Custom project resolution | "Details > Resolution in the project panel" | `[bundle]` |
| Variable frame rate (phone footage) | Conformed to the project frame rate on the timeline. "Auto remux" rewrites problem files to MOV to fix lag. | conform `[known]`, remux `[bundle]` |
| Live Photo | "Apply as a LIVE photo" option | `[bundle]` (exact scope `[unsure]`) |

**Engine implication.** The timeline uses a rational project time base. Each source keeps its own timestamps, and the frame for a given project time is chosen by PTS lookup rather than frame index, so VFR works. A remux path (copy streams into an MOV/MP4 with a clean index) is cheap insurance against containers that seek badly.

### 1.4 Proxies and optimized media

See [§10](#10-performance-features). Proxies are per-asset transcodes at a chosen resolution, stored in a configurable location. They can be limited to media above the proxy resolution, and they never affect export resolution `[bundle]`.

---

## 2. Timeline model

### 2.1 Tracks

| Track type | Notes | Tag |
|---|---|---|
| **Main track** (video) | Magnetic (gapless) when "Main track magnet" is on (shortcut P). Deleting a clip ripples the gap closed. Cannot be emptied while other content depends on it ("Main track cannot be empty"). | `[bundle]` |
| **Overlay video tracks** | Picture-in-picture layers above the main track. Clips are free-positioned in time and can be dragged to and from the main track. Transitions are allowed between adjacent overlay clips. | `[bundle]` |
| **Audio tracks** | Music, sound effects, voiceover and extracted audio. Multiple tracks. | `[known]` |
| **Text tracks** | Text, captions and text templates | `[known]` |
| **Sticker tracks** | Stickers, emoji, GIFs and shapes | `[known]` |
| **Effect tracks** | Timed video effects with a target object: main video, overlay, or global ("both") | `[bundle]` |
| **Filter tracks** | Timed filters affecting the layers below | `[known]` |
| **Adjustment tracks** | Timed adjustment layers, with optional adjustment masks | `[known]` / masks `[bundle]` |
| Per-track state | Lock, hide, mute; track height Short / Default / Tall | `[bundle]` |
| Layer ordering | The "Arrange layers" project option allows free layer re-ordering instead of a fixed order by track type | `[bundle]` |

### 2.2 Clip relationships

- **Linkage** `[bundle]`. Items on other tracks can follow main-track clips. When a main clip moves or is deleted, linked items move or delete with it. Linkage is set per item type: Adjust, Effects, Filters, Audio, Sound effects, Stickers, Text, TTS and Overlay. The global toggle is the `~` key.
- **Audio/video link** `[known]`. Embedded audio belongs to the video clip until "Extract audio" (Cmd+Shift+S) detaches it to an audio track. "Separate audio from the track" splits out embedded streams `[bundle]`.
- **Group / Ungroup** (Cmd+G / Cmd+Shift+G) `[bundle]`/`[known]`.
- **Compound clips ("subprojects")** `[bundle]`
  - A compound clip is a nested timeline you can open and edit. CapCut caps the nesting depth ("Can't nest more compound clips").
  - "Pre-process compound clip" renders it into a cache.
  - Some features need a pre-processed compound: motion blur and adjustment masks.
  - Compound clips can be saved as presets.
  - Undo compound clip (Option+G / Option+Shift+G) `[known]`.
- **Multi-camera clips** `[bundle]`
  - 4 or 9 camera angles
  - sync by audio, timecode or first marker
  - per-angle "Color correction" (auto colour matching — `[unsure]` whether this is ML)
  - multi-camera view, "Move to" angle, flatten back to a plain video, re-enable

### 2.3 Edit operations

| Operation | Detail | Tag |
|---|---|---|
| Split | At the playhead (Cmd+B); split all tracks (Cmd+Shift+B); split mode B, select mode A | `[known]` / `[bundle]` (modes) |
| Trim | Edge drag; trim several clips together | `[bundle]` (multi-trim) |
| Delete left / right of playhead | Q / W. Ripples when the magnet is on. | `[bundle]` (`main_quick_cut_keep`) |
| Ripple delete / gap close | Implicit on the main track. Overlay tracks keep gaps. | `[known]` |
| Select left / right of playhead | `[` / `]` | `[known]` |
| Enable / disable clip | V | `[known]` |
| Freeze frame | Inserts a still segment (default 3 s `[known]`) at the playhead, splitting the clip | `[bundle]` |
| Reverse | Whole-clip reverse, processed as a job ("Couldn't cancel reverse") | `[bundle]` |
| Mirror / rotate / crop | Toolbar shortcuts | `[bundle]` |
| Copy / paste attributes | Animation, adjust, audio and speed attributes. Not available on compound clips or images (audio and speed). | `[bundle]` |
| Match cut | Cmd+J | `[known]` |
| Mark in / out, range select | I / O, "Select area by clip" (Shift+X) | `[known]` |
| Duplicate | Option-drag ("Drag to duplicate") | `[bundle]` |
| Minimum clip length | 0.1 s after speed ramping | `[bundle]` |
| Undo / redo | Includes media import and delete in the library | `[bundle]` |

### 2.4 Markers, snapping and navigation

- **Markers** `[bundle]`. Timeline markers and clip markers, with colours, an edit dialog, next/previous navigation, "Delete all markers in clip" and "Delete all markers in timeline".
- **Beat markers** `[bundle]`. Add or clear beats manually, or generate them automatically ("Auto beat"; "Beat 1" and "Beat 2" densities). "Mark beats" lets you drop files to snap them to beat markers.
- **Snapping** `[bundle]`. "Auto snapping" (N) snaps to clip edges, the playhead, markers and beats. Holding Cmd temporarily ignores alignment guides `[known]`.
- **Preview axis** (S) `[bundle]`. A hover-scrub playhead separate from the main playhead.
- **Navigation** `[known]`/`[bundle]`
  - frame step: ← / →, or many frames with Shift
  - previous/next edit: ↑ / ↓
  - Home / End
  - shuttle J/K/L ("Shuttle left/right/stop")
  - timeline zoom and zoom-to-fit (Shift+Z)

### 2.5 Engine implications (timeline)

- Use a rational time base. CapCut uses integer microseconds; OpenRip can use ticks.
- Store each segment's source range and target range, plus a separate time-remap function for speed, reverse and freeze.
- Implement ripple, magnet and linkage as pure model transforms on the command stack, not as UI logic.
- Compound clips are first-class nested `Timeline`s with a cached render. Cache invalidation needs a content hash of the nested graph.
- A transition is an object between two adjacent segments with an overlap or no-overlap mode (see [§5.3](#53-transitions)).

---

## 3. Per-clip video properties

### 3.1 Transform, crop and canvas

| Property | Detail | Tag |
|---|---|---|
| Position X/Y | Pixel units relative to the canvas, with on-canvas drag and alignment snapping | `[known]` |
| Scale | Uniform by default ("Uniform scale" toggle); separate W/H when off | `[bundle]` |
| Rotation | Degrees; on-canvas handle | `[known]` |
| Flip | Mirror horizontally (toolbar "Mirror") and vertically | `[bundle]` (Mirror) / vertical `[unsure]` |
| Fit | "Fit canvas" (contain) or fill (cover) for media that doesn't match the project ratio | `[bundle]` |
| Crop | Free crop, preset ratios (likely the same list as the project ratios; see [§11](#11-projectworkspace)), reset | free `[bundle]`, ratio list `[unsure]` |
| Opacity | 0–100 % | `[bundle]` |
| Blend mode | 11 modes (see [§3.2](#32-blend-modes)) | `[bundle]` |
| Canvas (background) | Shows where the main-track clip doesn't fill the frame. Options: solid colour, blur ("Blur canvas", several strength levels), pattern or image (built-in or uploaded). Apply to all. | `[bundle]` / levels `[known]` |
| Player guides | Rulers and guides (editable position), alignment and distribution of selected objects | `[bundle]` |

### 3.2 Blend modes

There are 11 blend modes: Normal plus 10 from `MixMode/MixMode.json` `[bundle]`. The mapping from the internal IDs is inferred from the Chinese-origin names:

| Internal ID | UI name |
|---|---|
| `dark_en` | Darken |
| `color_filter` | Screen |
| `over_lay` | Overlay |
| `multiply_blend_mode` | Multiply |
| `bright_en` | Lighten |
| `glare_pc` | Hard light |
| `soft_light` | Soft light |
| `linear_deepening` | Linear burn |
| `darken_color` | Color burn |
| `color_dodge` | Color dodge |

Each mode is an effect package linked as an `InfoSticker` pass. **Engine implication:** blending reads the composite of *all lower layers*, so it can't be a pairwise clip-to-clip operation. The compositor needs a running accumulation buffer, and that buffer must be in linear or float space for predictable results.

### 3.3 Keyframes

- **Animatable properties** `[known]`/`[bundle]`
  - position, scale (uniform or W/H), rotation, opacity
  - mask parameters
  - adjustment sliders (each one), filter intensity
  - volume (audio)
  - effect parameters ("Try keyframes on effects!" `[bundle]`)
  - text transform and opacity
  - shape fill colour (solid and gradient only), shape scale and position, shape corner radius `[bundle]`
  - chroma key and canvas parameters `[unsure]`
- **Interpolation** `[bundle]`. Preset curves are Linear, Ease in, Ease out and Easing, with "Show all presets" for more. Keyframes can be moved on the track. "Advanced keyframe value graphs" exist ("Show/Hide keyframe graphs"). A keyframe panel can be toggled with Option+K `[known]`.
- **Curved motion paths** `[unsure]`. Position paths are probably linear in space.
- Keyframes block "Apply to all" when other clips are keyframed `[bundle]`.
- **Engine implication.** Every animatable parameter is `Animated<T>`: a constant, or a sorted keyframe list with per-segment interpolation (linear, hold, or cubic-bezier easing with editable handles). Use one evaluator for every property, including effect parameters and colours (interpolate colours in linear or OKLab space).

### 3.4 Masks

| Item | Detail | Tag |
|---|---|---|
| Shapes | None, Line ("Split"/"Linear"), Mirror (band), Circle, Rectangle, Heart, Star | `[bundle]` |
| Custom mask | Pen-drawn path on adjustment masks ("Custom"). On video masks it's `[unsure]`. | `[bundle]` |
| Parameters | Position, rotation, size (W/H), feather, round corners (rectangle), invert | `[bundle]` |
| Where masks apply | Video and overlay clips, "Adjustment mask" (several masks per adjustment: "Mask %d (%s)"), "Effect mask" | `[bundle]` |
| Keyframable | Yes | `[known]` |
| Mask tracking | ML. Out of scope ([Appendix A](#appendix-a-out-of-scope-aicloud)). | `[bundle]` |

**Engine implication.** Implement shapes as analytic SDFs (line, band, ellipse, rounded rectangle, star polygon, heart curve) and custom paths as tessellated or SDF Béziers. Feather = smoothstep on the SDF. Invert and combine masks into an alpha the compositor and effect passes can use. The same mask type must also gate adjustments and effects.

### 3.5 Chroma key

Parameters come from the shader parameter names `[bundle]`:

- key colour (colour picker, including picking from anywhere on screen)
- intensity
- shadow
- edge smoothing/feather (a separable smooth pass on the alpha)
- spill suppression

The UI shows Intensity and Shadow (plus newer edge controls) `[known]`.

**Engine implication.** A chroma-distance key in YCbCr or a perceptual space, then an alpha blur (two separable passes), then despill. The resulting alpha flows into blending.

### 3.6 Stabilization

- **Stabilize** `[bundle]`. Levels are Recommended, Most stable and Minimum cut. It runs as a background analysis job ("Video stabilization completed/canceled") and can turn on automatically.
- **Engine implication** (classical). Track features (KLT/ORB), estimate per-frame similarity or homography, smooth the path, then crop or zoom to hide borders. The "Minimum cut" level trades smoothness for less crop. Cache the analysis per asset and range.

### 3.7 Animations (video clips)

- **In, Out and Combo** animation groups, each with a duration slider `[bundle]`. In and Out can coexist on one clip `[bundle]`. Whether Combo excludes In/Out is `[unsure]`. If the clip is too short, the animation is shortened or refused `[bundle]`.
- The catalogue (fade, zoom, slide, rotate, shake and so on) is downloaded from the cloud `[known]`.
- **Engine implication.** An animation is a time-normalized effect, t∈[0,1] over its duration, anchored to the clip's start or end. It can drive transform, opacity and shader parameters, and it composes with keyframes. Decide the order explicitly; CapCut applies animation on top of keyframed transform `[unsure]`.

### 3.8 Speed

| Item | Detail | Tag |
|---|---|---|
| Normal speed | 0.1×–100× (the 0.1× label is in the bundle); editing the duration sets the speed | `[known]` / `[bundle]` |
| Pitch | "Change audio pitch" toggle; pitch is preserved by default. Some speeds can't turn off pitch correction. | `[bundle]` |
| Curve speed | Presets Montage, Hero, Bullet, Jump cut, Flash in, Flash out, plus Custom. Each curve has editable speed points ("beats"). Speed panel: Cmd+R; curve speed: Shift+B. | `[bundle]` / `[known]` (keys) |
| Variable-speed animation | Keyframe-driven speed ramps ("Right-click the keyframe to create variable speed animations") | `[bundle]` |
| Smooth slow-mo | Frame blending (classical) or optical flow (CapCut uses an ML interpolation model) | `[bundle]` |
| Speed on multiple clips | Speed ramping can't be applied to several clips at once | `[bundle]` |

**Engine implication.** Each segment's time-remap is a monotonic function (constant, piecewise-cubic curve, or reverse) mapping target time to source time. Its integral defines the segment duration. Audio needs a time-stretcher (WSOLA or a phase vocoder) with an optional pitch shift, driven by the same function. Slow-motion gap filling is pluggable: nearest frame, frame blend, or optical flow.

---

## 4. Color

### 4.1 Adjust panel ("Basic")

These come from `DefaultAdjustBundle/` package names and UI strings `[bundle]`:

| Group | Sliders |
|---|---|
| Color | Temperature ("Temp"), Tint, Saturation, Hue `[bundle]` |
| Lightness | Exposure, Brightness, Contrast, Highlights, Shadows, Whites, Blacks, Brilliance `[bundle]` |
| Effects | Sharpen, Clarity, Texture, Dehaze, Fade, Vignette, Grain ("Particles") `[bundle]` |
| LUT | Apply an imported `.cube`/`.3dl` LUT, with intensity `[bundle]`. "Protect skin tone" is ML (Appendix A). |
| Other | Black & white (package name), "Convert to HDR" `[bundle]` (`[unsure]` whether ML); Auto adjust is ML (Appendix A) |

Adjustments save as presets ("My presets"), apply to all, apply per clip or as an adjustment-track layer, and can be limited by adjustment masks `[bundle]`. The versioned packages (`contrast_v1..v3`, `shadow_highlight_v2_gles2/3`, `merge_all_adjust_color`) show that CapCut merges all sliders into one combined shader at render time `[bundle]`.

**Engine implication.** Compile the active sliders into one fused colour pass per layer (an uber-shader with uniform flags), applied in a defined order in linear light. Spatial operations (sharpen, clarity, texture, dehaze, grain, vignette) need neighbourhood or extra passes and come after the per-pixel ops.

### 4.2 HSL

- Hue, Saturation and Lightness per colour range `[bundle]`. The eight ranges (Red, Orange, Yellow, Green, Cyan, Blue, Purple, Magenta) are `[known]`.
- **Engine implication.** Hue-sector weighting with soft falloff between sectors, done in a perceptual space.

### 4.3 Curves

- Luma (Y), Red, Green and Blue curves, each with control points `[bundle]` (`Curves/` builds one 1D LUT per channel).
- **Engine implication.** Spline (monotone cubic) to 1D LUT textures (256 or 1024 entries) on the CPU when a point changes. The shader samples the LUTs.

### 4.4 Color wheels

- **Primary wheels** `[bundle]`. Lift, Gamma, Gain and Offset, each with RGB plus a luma component, a "Luma mix" control and overall Intensity.
- **Log wheels** `[bundle]`. Shadows, Midtones, Highlights and Offset, with adjustable range bounds (low/high).
- Mouse drag adjusts the wheels; double-click resets `[bundle]`.
- **Engine implication.** Standard ASC-CDL-style maths for the primary wheels, and range-weighted log-space grading for the log wheels. Both are per-pixel and can fold into the fused colour pass.

### 4.5 Filters

- Filters are cloud-catalogue items with an intensity slider, searchable, applied per clip or as a timed filter track `[bundle]`/`[known]`. Categories (for example Featured, Life, Scenery, Movies, Retro, Black & White, Food, Night, Style) come from the server and change over time `[known]`.
- Technically a filter is a LUT, often with skin protection, plus an optional shader package (`lut-filter`, `lut/config.json` → `AmazingFilter`) `[bundle]`.
- **Engine implication.** A filter = a 3D LUT (and optional parameterized shader) plus an intensity mix. OpenRip ships its own CC0 LUT set.

### 4.6 Scopes and colour management

- A video scope exists ("Color oscilloscope") `[bundle]`. Which scope types it offers (waveform, vectorscope, histogram, RGB parade) is `[unsure]`.
- Per-clip colour space conversion and project colour space are covered in [§1.2](#12-hdr-bit-depth-and-colour) `[bundle]`.

---

## 5. Effects and transitions

### 5.1 Video effects

- **Catalogue** `[known]`. Downloaded categories such as Trending, Basic, Party, Lens, Retro, Split-screen, Distortion, Bling, Light, Motion, Comic, Nature and Dreamy. Includes effects like 3D mirror movement and 3D photo `[bundle]`, the latter possibly depth-ML-based `[unsure]`.
- **Placement** `[bundle]`/`[known]`. Effects go on an effect track with a duration, or are attached to a clip. The target object is Main video, Overlay or Global (all layers below). Effects can be searched and favourited.
- **Parameter vocabulary** `[bundle]` (shared slider names across effects): Amount, Intensity, Speed, Range, Rotate, Horizontal, Vertical, Noise, Texture, Sharpen, Glow, Soft light, Twist, Filters, Atmosphere, Lateral chromatic aberration and Longitudinal chromatic aberration.
- Effect keyframes and effect masks are supported `[bundle]`.
- **Body effects** are ML (Appendix A).
- **Engine implication.** Use a typed parameter schema per effect: float, int, colour, enum, point, angle. Effects are evaluated as graph nodes over (input texture(s), time, params), with an optional mask input. OpenRip needs its own effect library, starting with blur, glitch/RGB split, shake, zoom, vignette, film grain, light leak, mosaic/pixelate, mirror/kaleidoscope, split-screen and chromatic aberration.

### 5.2 Other "effect-like" tools

| Tool | Detail | Tag |
|---|---|---|
| Motion blur | Blur, Blend, Direction (Forward / Backward / Both), Times (1, 2, 4, 6). Uses optical flow; on multiple clips, needs a compound clip. | `[bundle]` |
| Lights ("add additional lights") | Brightness, colour, distance, blinking and moving-speed parameters. Relight itself uses ML depth/normal models (Appendix A). | `[bundle]` / classification `[unsure]` |
| Face mosaic / blur stickers | Gaussian blur, mosaic, white circle and white heart patterns, but they rely on face detection (ML) | `[bundle]` |
| Manual area blur / mosaic | A classical mosaic or blur effect plus a mask (no tracking) is possible | `[unsure]` as a separate CapCut feature |

### 5.3 Transitions

- **Placement** `[bundle]`. Between two *adjacent* clips on the main track or on an overlay track. Transitions need continuous clips ("There are no continuous clips at current position"), need at least two main-track clips, and can't be split ("Transitions cannot be split").
- **Catalogue** `[known]`. Cloud-downloaded and searchable `[bundle]`. Categories include Trending, Basic (dissolve, fade to black/white), Camera, Effects, MG, Glitch, Slide, Wipe, Light, Blur and Distortion. "Apply to all" exists.
- **Duration** `[known]`. Adjustable (default about 0.5 s). The maximum is limited by the shorter adjacent clip's available media.
- **Overlap semantics** `[known]`/`[bundle]`
  - Transitions carry an `is_overlap` flag `[known]`, from public reverse-engineering of the draft format.
  - Overlapping transitions (cross-dissolve type) consume handle frames from both clips. Non-overlapping transitions (for example flash or dip types) play across the cut without overlapping.
  - When clips are too short, CapCut offers to "create duplicate frames for transition" so the original clip lengths stay the same `[bundle]`.
- **Engine implication.** A transition is a two-input node `T(a, b, progress, params)` evaluated over the transition window. The model must track *available handles* (source media beyond each cut). Choose between three rules: shorten the timeline (overlap), keep the timeline length and borrow handles, or pad with freeze frames. Evaluate dissolves in linear light. AI transitions are out of scope.

---

## 6. Text

### 6.1 Text clip properties

| Property | Detail | Tag |
|---|---|---|
| Content | Multi-line, resizable text box (Option-drag resizes from the centre) with wrapping | `[bundle]` / `[known]` |
| Font | Bundled system fonts (Noto, CJK, Thai, Arabic, Hebrew, Bengali, Khmer, Myanmar and more), downloadable fonts, fonts installed on the machine, imported "My fonts". Warns when a project font is missing. | `[bundle]` |
| Emoji | Colour emoji font bundled for text (Segoe UI Emoji); "Emojis" tab | `[bundle]` |
| Size, colour | Font size, font colour | `[bundle]` |
| Style flags | Bold `[bundle]`, italic `[known]`, underline `[bundle]` (implied by "Text with underline can't be curved") | mixed |
| Case | Uppercase, lowercase, title case | `[bundle]` |
| Spacing | Character spacing, line spacing | `[bundle]` |
| Alignment | Left, centre, right `[bundle]`; vertical text `[unsure]` | mixed |
| Stroke / border | Colour and thickness | `[bundle]` / `[known]` |
| Background | Colour, opacity, corner radius, height/width padding, offset | `[known]` |
| Shadow | Colour, opacity, blur, distance, angle | `[known]` (`[bundle]` for the shape shadow with the same fields) |
| Glow | Inward, outward, or both | `[bundle]` |
| Curved text | "Curve" with Strength. Not allowed together with a background or underline. | `[bundle]` |
| 3D text | Exists, but "3D text can't be displayed on desktop or laptop yet" | `[bundle]` |
| Preset styles | Style presets; save your own text presets | `[bundle]` |
| Text effects | Downloadable styled looks, often with gradients or textures | `[bundle]` |
| Bubbles | Callout frames behind the text | `[bundle]` |
| Per-character styling | Rich text: styling a selected range | `[unsure]` |
| Animations | In, Out, Loop, each with duration (Loop also has speed) | `[bundle]` |
| Keyframes | Transform and opacity | `[known]` |

### 6.2 Text templates and captions

- **Text templates** `[bundle]`. Multi-element compositions of text, stickers and animation from the catalogue. They can be broken up ("Separate") into editable parts.
- **Captions (non-AI)** `[bundle]`
  - import SRT, LRC or ASS
  - enter captions manually
  - split or merge captions; Enter splits a caption, Cmd+Enter adds a line break
  - find and replace
  - main and sub captions (bilingual), with style applied to all main or all sub captions
  - caption export (SRT, TXT `[known]`)
- **Engine implication**
  - Full text shaping: BiDi, complex scripts and font fallback chains (e.g. cosmic-text plus HarfBuzz-equivalent shaping).
  - Text renders to an SDF or MSDF atlas, or a high-resolution raster per layout, so it stays sharp at any scale.
  - Stroke, glow and shadow are extra passes on the glyph coverage.
  - Curved text lays glyphs along an arc.
  - The caption data model is a list of timed cues on a text track, with one shared style.
  - ASS styling (override tags) needs a decision: map a subset or flatten.

---

## 7. Stickers, shapes and overlays

| Item | Detail | Tag |
|---|---|---|
| Sticker library | Cloud catalogue, searchable | `[bundle]` |
| GIPHY stickers / GIFs | Third-party cloud catalogue | `[bundle]` |
| Emoji | Emoji tab | `[bundle]` |
| Frame-sequence stickers | User import (limits in [§1.1](#11-import)); loop type Once or Repeat; GIFs not accepted as frame sequences | `[bundle]` |
| Animated sticker formats | Packaged effects (`InfoSticker` with Lua) and sprite-sheet animations (a sequence map image plus JSON animation info, the same pattern as the watermark resources) `[bundle]`; GIF/WebP/APNG `[unsure]`; Lottie through `QtBodymovin` `[bundle]` (UI use confirmed, engine use `[unsure]`) | mixed |
| Sticker properties | Same transform, opacity, keyframes and in/out/loop animations as clips; tracking is ML | `[known]` |
| **Shapes** | Vector shapes with Transform (size W/H, opacity), Fill (solid, gradient with angle, texture with scale, angle, flip and opacity), Stroke (colour, weight, opacity), Shadow (colour, opacity, distance, angle), corner radius (per corner for rectangles), custom pen drawing (≥ 2 endpoints, double-click to finish). Fill colour, scale and position can be keyframed. | `[bundle]` |
| **Charts** | Animated data charts (bar, grouped/stacked bar, line, pie, donut, gauge, radar, rose, progress) from XLSX/CSV, processed locally; style, colour theme, legend, labels, animation (all at once / one by one) | `[bundle]` |

**Engine implication.** Shapes need vector tessellation (lyon) or SDF rendering with gradient and texture fills, plus a path editor model (points with in/out handles). Animated stickers need a frame-indexed image-sequence source (sprite atlas or decoded frames) with loop modes, mapped to project time. A Lottie renderer (rlottie-equivalent) is a P2 nice-to-have.

---

## 8. Audio

| Item | Detail | Tag |
|---|---|---|
| Volume | Per clip, keyframable; range about −∞ to +20 dB | per clip `[known]`, range `[unsure]` |
| Fade in / out | Duration sliders | `[bundle]` |
| Normalize loudness | Per clip; also "Make volume consistent" | `[bundle]` (target LUFS `[unsure]`) |
| Speed and pitch | Follows the video speed; pitch preserved by default | `[bundle]` |
| Voice effects (DSP presets) | Preset voice filters with parameters Pitch, Timbre, Room size, Strength, Depth, Frequency, Noise, Quantity, Center, Amplitude, Surround rate | `[bundle]` (params); preset names (e.g. echo, megaphone, lo-fi, robot, chipmunk, deep) `[known]` |
| Voice characters / custom voices | ML / cloud | Appendix A |
| Noise reduction | "Reduce noise" uses `rnnoise_v2.0.model`, a small on-device RNN, so it counts as ML. A classical DSP replacement (spectral gating or Wiener filtering) is the OpenRip option. | `[bundle]` |
| Echo reduction | Uses the `models/aec` model. Treat as ML (`[unsure]`). | `[bundle]` |
| Channels | "Fill left with right" or "Fill right with left"; channel configuration (not for mono sources) | `[bundle]` |
| Multi-stream audio | Pick the audio stream for multi-stream clips; separate audio from the track | `[bundle]` |
| Extract audio | From a timeline clip (detach) or from a video file as an asset | `[bundle]` |
| Beats | Manual add or clear, auto beat (two densities), timeline beat markers, align clips to beats | `[bundle]` (auto-beat method `[unsure]`) |
| Voiceover recording | Mic input with "avoid echo from speaker" (mutes playback while recording). Camera recording can go to a separate track. Screen recorder tool. | `[bundle]` |
| Mute | Per track and whole project | `[bundle]` |
| Audio level meter / mixer | Master level meter next to the timeline `[known]`; per-track mixer `[unsure]`, probably absent | mixed |
| Ducking | No string evidence; probably absent as an automatic feature | `[unsure]` |
| Sound effects / music library | Cloud catalogue | `[bundle]` |
| Waveforms | Shown on clips ("Unrecognized track waveform") | `[bundle]` |
| Dolby (AC-3 / E-AC-3 / AC-4 / Atmos binaural) | Strings exist but have empty values in English, so the feature is feature-flagged or hidden | `[bundle]` |

**Engine implication.** Build a sample-accurate audio graph: sources → time-stretch → per-clip gain automation and fades → DSP inserts (EQ, reverb, pitch, chorus, distortion, bit-crush for the voice presets) → per-track bus (mute) → master bus → meter. Add an offline loudness analyser (EBU R128) and a waveform-peaks cache per asset. Beat detection can be classical (spectral-flux onsets plus tempo tracking).

---

## 9. Export

### 9.1 Video

| Setting | Options | Tag |
|---|---|---|
| Resolution | 480p, 720p, 1080p, 2K, 4K `[known]`; 8K `[bundle]`; "Original" (project resolution) `[bundle]` | mixed |
| Frame rate | 24, 25, 29.97, 30, 50, 59.94, 60 | `[bundle]` |
| Codec | H.264, HEVC `[known]`; AV1 `[unsure]`; Apple ProRes 4444 (alpha), HEVC (alpha), RLE (alpha) `[bundle]`; other ProRes flavours `[unsure]` | mixed |
| Format | MP4, MOV `[known]`; GIF (separate option) `[bundle]` | mixed |
| Bit rate | Lower, Recommended, Higher presets `[bundle]`, plus custom with CBR, VBR or ABR `[bundle]` | `[bundle]` |
| Colour space | Rec. 709 SDR, Rec. 2020 SDR, Rec. 2100 HLG, Rec. 2100 PQ | `[bundle]` |
| Colour depth | 8-bit, 10-bit | `[bundle]` |
| Hardware encoding | Settings toggle. Offers to disable hardware acceleration if the export stalls. | `[bundle]` |
| Estimated size | Shown live (duration, size, format) | `[bundle]` |
| Cover | Export with or without a cover; cover templates | `[bundle]` |
| Watermark | Keep or remove (branding; ignore) | `[bundle]` |
| Super resolution | ML upscaling, out of scope | `[bundle]` |

### 9.2 Other outputs

| Output | Detail | Tag |
|---|---|---|
| Audio only | MP3, WAV `[bundle]`; AAC, PCM, 192/256/320 kbps `[bundle]`; FLAC `[unsure]` | mixed |
| Captions | Export the caption track (SRT/TXT) | `[bundle]` / formats `[known]` |
| GIF | 320p or 640p; refuses videos that are too long | `[bundle]` |
| Still frame | "Export still frame" (current frame) and "Export still frames" | `[bundle]` |
| Selected clips | Batch export of selected clips, with a title and sequential numbering. "Include all changes" on: effects and filters included; off: only position, size and speed. | `[bundle]` |
| Export timeline | Format probably XML/FCPXML | `[bundle]` (format `[unsure]`) |
| Background export | Export continues while you edit other projects; queue ("Waiting to export"); completion sound or notification | `[bundle]` |
| Failure handling | Missing media → black frames or relink; disk full; FAT32 4 GB limit; external-drive errors; out of memory | `[bundle]` |

**Engine implication.**

- The offline render uses the *same* graph as preview, at full resolution with no proxies, and is deterministic.
- Encoder backends: VideoToolbox (H.264/HEVC/ProRes, including alpha), FFmpeg software encoders (x264/x265/SVT-AV1 per licensing), RLE, and a GIF encoder with a palette pass.
- Rate control maps to CBR/VBR/ABR.
- The output carries colour metadata: primaries, transfer and matrix, plus HDR mastering metadata for PQ.
- A job queue supports export in the background.

---

## 10. Performance features

| Feature | Detail | Tag |
|---|---|---|
| Playback resolution | Full, 1/2, 1/4 (newer UI: Full / High / Medium / Low quality, "Recommended"). Prompted automatically when playback lags. | `[bundle]` |
| Preview quality mode | "Performance priority" vs "Best quality" | `[bundle]` |
| Proxy | Turn on per project or per media (right-click). Settings: proxy resolution, location and size. "Only convert material above the proxy resolution." Remove proxy files. Export always uses originals. | `[bundle]` |
| Auto remux | Rewrites specific files to MOV for smooth playback, with its own location and size management | `[bundle]` |
| Auto optimization | Turns on proxy or remux automatically for lagging clips | `[bundle]` |
| Render cache | "Auto render"; render the selected area; the rendered region is marked on the timeline; "Delete rendering cache". Compound clip pre-processing. | `[bundle]` |
| Cache management | Media cache path (applies after restart), cache size, "Auto delete cache from N days ago", clear cache (project must be closed) | `[bundle]` |
| Hardware acceleration | "Speed up hardware decoding", "Speed up hardware encoding", "Render interface with GPU" | `[bundle]` |
| Diagnostics | Graphics-driver checks, discrete-GPU detection, plugged-in power tip, external-drive warnings, "Performance tips" | `[bundle]` |
| Device tiering | ByteBench score and GPU driver bug list | `[bundle]` |

**Engine implication.**

- **Multi-resolution decode.** Use hardware-decoder downscaled output, or decode then scale on the GPU, and choose the render scale from the playback-resolution setting.
- **Proxy mapping.** A per-asset map from original to proxy, with a fidelity check: same duration, same PTS mapping.
- **Render cache.** Keyed by a hash of (segment subgraph, time, scale). Store it on disk as intermediate-codec chunks (ProRes or DNxHR-like) so it survives restarts, and invalidate on any edit.
- **Background jobs.** Proxy, remux, stabilize analysis, reverse and waveform jobs run on a priority scheduler.

---

## 11. Project/workspace

| Item | Detail | Tag |
|---|---|---|
| Home | Project list or grid with search, sort, duplicate, rename, delete to a recycle bin ("kept here for up to N days"), backup and restore of deleted projects | `[bundle]` |
| Project settings ("Details") | Name, save location, aspect ratio, resolution, frame rate, colour space, proxy, "Arrange layers" (free layer order), "Copy media to project", draft schema version | `[bundle]` |
| Aspect-ratio presets | 16:9, 9:16, 1:1, 4:3, 3:4, 2:1, 2.35:1, 1.85:1, 5.8" (≈ 0.4618), plus Custom and Original | `[bundle]` (`video_template_ratio.json`) |
| Autosave | Continuous ("Current project will be automatically saved") | `[bundle]` |
| Draft storage | A folder per project with JSON and caches; path set in Settings | `[bundle]` / `[known]` |
| Templates (local) | Compound clip presets, text presets, adjustment presets ("My presets"). Template marketplace and brand kit are cloud. | `[bundle]` |
| Interchange | AAF, XML and FCPXML timeline import; export timeline | `[bundle]` |
| Shortcuts | Fully customizable, with conflict detection and modifier limits | `[bundle]` |

**Main default shortcuts (macOS)** `[known]` (cross-checked against bundle strings)

| Action | Key |
|---|---|
| Play / pause | Space |
| Split | Cmd+B |
| Split all tracks | Cmd+Shift+B |
| Select mode / split mode | A / B |
| Delete left / right of playhead | Q / W |
| Delete | Delete |
| Select left / right of playhead | `[` / `]` |
| Enable / disable clip | V |
| Group / ungroup | Cmd+G / Cmd+Shift+G |
| Compound clip / undo compound clip | Option+G / Option+Shift+G |
| Extract or restore audio | Cmd+Shift+S |
| Speed panel / curve speed | Cmd+R / Shift+B |
| Volume up / down | Cmd+. / Cmd+, |
| Main track magnet | P |
| Auto snapping | N |
| Linkage | `~` |
| Preview axis | S |
| Keyframe panel | Option+K |
| Mark in / out | I / O |
| Match cut | Cmd+J |
| Frame step | ← / → |
| Step many frames | Shift+← / → |
| Previous / next edit | ↑ / ↓ |
| Start / end | Home / End |
| Shuttle | J / K / L |
| Timeline zoom in / out | Cmd+= / Cmd+− |
| Zoom timeline to fit | Shift+Z |
| Zoom player to fit | Option+Shift+Z |
| Full screen / exit | Cmd+Ctrl+F / Esc |
| Import | Cmd+I |
| New project | Cmd+N |
| Undo / redo | Cmd+Z / Cmd+Shift+Z |
| Copy / cut / paste | Cmd+C / X / V |
| Cycle material panel | Tab |
| Show/hide guides, rulers | `[bundle]` (key `[unsure]`) |

---

## 12. UI layout summary (for the Phase 4 redesign)

- **Top bar** `[known]`. Menu, project name, layout switcher, shortcuts, export button.
- **Left asset panel** `[known]`/`[bundle]`
  - Tabs: Media (Local / Imported / Library / Stock), Audio (Music, Sound effects, Extracted, Recordings), Text (Add text, Text templates, Text effects, Fonts), Stickers (incl. Emojis and GIPHY), Effects (Video effects, Body effects), Transitions, Captions, Filters, Adjustment (incl. LUTs and My presets), Templates, Shapes, Charts, plus AI tabs.
  - Can be detached into its own window.
- **Centre player** `[bundle]`
  - Canvas with on-canvas transform handles, ratio selector, playback-resolution and quality menu
  - Full screen, zoom (in, out, fit)
  - Guides and rulers, video scope
  - Multi-camera view
  - Detachable
- **Right inspector** `[known]`/`[bundle]`. Tabs depend on the selection:
  - **Video**: Basic (transform, blend, stabilize, canvas), Remove BG, Mask, Retouch
  - **Animation**: In / Out / Combo
  - **Speed**: Normal / Curve
  - **Adjustment**: Basic / HSL / Curves / Color wheel
  - **Audio**: Basic / Voice effects / Channels
  - **Tracking**
  - Text, Sticker and Effect items get their own tab sets.
- **Bottom timeline** `[known]`/`[bundle]`
  - Left toolbar: select/split mode, undo/redo, split, delete left/right, delete, freeze, reverse, mirror, rotate, crop, marker, etc.
  - Right-side toggles: main track magnet, auto snapping, linkage, preview axis, zoom slider.
  - Track headers with lock, hide and mute; track height setting; keyframe diamonds and keyframe graphs; master level meter.
- **Layouts** `[bundle]`. Default, Media (expanded media panel), Attributes (expanded inspector), Vertical (for 9:16 work) and Custom layouts 1–3. Player, timeline, media panel and editing panel can each be detached.

---

## 13. Parity matrix

Engine crates follow [ROADMAP.md §2.2](../../ROADMAP.md): `model`, `media`, `render`, `audio`, `playback` and `export`.

### P0: needed for a credible CapCut-like editor

| # | Feature | Engine implication |
|---|---|---|
| 1 | Import MP4/MOV/MKV with H.264, HEVC 8/10-bit, ProRes and AV1; images PNG/JPG/HEIC/WebP/GIF; audio MP3/WAV/AAC/M4A/FLAC | `media`: FFmpeg demux with VideoToolbox decode first, dav1d for AV1, PTS-based frame-accurate seek, VFR conformed by timestamp lookup, colour metadata on probe |
| 2 | Magnetic main track, overlay video tracks, audio/text/sticker/effect/filter/adjustment tracks | `model`: typed tracks, segments with source and target ranges in a rational time base, render order rules, and a free layer-order option |
| 3 | Split, trim, delete left/right, ripple, snapping, linkage, group, copy/paste, undo/redo | `model`: every edit is a pure command on the document; ripple, magnet and linkage are model rules, not UI rules; snapping index (edges, playhead, markers) |
| 4 | Transform (position, scale, rotation, flip), crop, opacity, fit/fill, canvas (colour, blur, image) | `render`: per-layer affine and crop in one textured-quad pass; background pass with downsampled Gaussian blur of the main clip |
| 5 | Keyframes on all transform, opacity, volume and colour parameters, with linear/ease presets | `model`/`render`: a generic `Animated<T>` with a cubic-bezier easing evaluator, shared by every parameter type |
| 6 | Constant speed 0.1–100× with pitch preservation, reverse, freeze frame | `model` time-remap function per segment; `audio` time-stretch (WSOLA or phase vocoder); `media` reverse playback through GOP-chunk backward decode cache |
| 7 | Basic adjust: exposure, brightness, contrast, saturation, temperature, tint, highlights, shadows, whites, blacks, sharpen, vignette, fade, grain; LUT import (.cube/.3dl); filters as LUTs with intensity | `render`: fused per-layer colour uber-shader in linear float space; 3D-texture LUT sampling with trilinear or tetrahedral interpolation; spatial passes afterwards |
| 8 | Text: font (system + imported), size, colour, bold/italic/underline, spacing, alignment, stroke, background, shadow; In/Out animations; SRT import | `render`: cosmic-text shaping (BiDi, fallback, colour emoji), glyph atlas or SDF, extra passes for stroke and shadow; `model` caption cue list |
| 9 | Core transitions (dissolve, fade through colour, slide, push, wipe, zoom, blur) with adjustable duration | `render` two-input transition node; `model` tracks handles and the overlap or no-overlap rule, with freeze padding when handles are short |
| 10 | Audio: per-clip volume plus keyframes, fades, multi-track mix, waveforms, extract/detach audio, voiceover recording | `audio`: sample-accurate mixer with gain automation, waveform-peak cache, cpal input for recording, A/V master clock in `playback` |
| 11 | Export MP4/MOV, H.264/HEVC, 480p–4K, 24–60 fps (incl. 29.97/59.94), bitrate presets with CBR/VBR, AAC; audio-only export; still-frame export; hardware encoding | `export`: offline run of the preview graph at full resolution; VideoToolbox and FFmpeg encoder backends; correct colour tags; background job |
| 12 | Smooth preview: playback resolution (Full, 1/2, 1/4), proxies, background pre-render | `playback`/`media`: multi-resolution decode, proxy substitution map, decode-ahead pools, LRU frame cache, disk render cache keyed by subgraph hash |
| 13 | Projects: autosave, settings (ratio presets, resolution, fps), relink missing media, consolidate | `model`: versioned serialization with migrations, crash-safe atomic writes, media references by path plus fingerprint |
| 14 | Effect framework (a handful of built-in effects plus video animations In/Out/Combo) | `render`: declarative multi-pass effect graph with a typed parameter schema, pure in (time, params), seek-deterministic |

### P1: expected by CapCut users soon after P0

| # | Feature | Engine implication |
|---|---|---|
| 1 | Blend modes (11) | `render`: blend against the running composite of lower layers in an accumulation buffer, which forces an explicit layer order |
| 2 | Masks: line, mirror, circle, rectangle (rounded), heart, star; feather; invert; keyframes; masks on adjustments and effects | `render`: analytic SDF mask generator, with feather as smoothstep; masks are a node input reusable by adjust and effect passes |
| 3 | Chroma key (colour, intensity, shadow, edge smoothing, spill) | `render`: chroma-distance key, separable alpha blur, despill pass |
| 4 | HSL (8 ranges), Curves (Y/R/G/B), Primary and Log colour wheels | `render`: hue-sector weights; 1D LUT textures built from splines; CDL-style lift/gamma/gain/offset, all fused into the colour pass |
| 5 | Adjustment layers and filter tracks over a time range | `render`: a layer that processes the composite below it; `model` coverage rules (global or main only) |
| 6 | Curve speed (6 presets plus custom points) and keyframed speed ramps | `model`: spline time-remap with an integral for duration; `audio` variable-rate stretch; frame selection by remapped PTS |
| 7 | Compound clips (nested timelines, editable, pre-render cache) | `model` nested `Timeline` with a depth limit; `render` caches the nested output by graph hash |
| 8 | Text extras: curved text, glow, bubbles, text effects (gradient or texture fills), case transforms, In/Out/Loop animations, local text templates | `render` glyph-on-path layout, glow blur pass; `model` template = a group of linked items that can be separated |
| 9 | Stickers: images, GIF/APNG/WebP animations, frame sequences, emoji | `media` animated-image decoders and a sprite-sequence source with loop modes mapped to project time |
| 10 | Classical stabilization (Recommended, Most stable, Minimum cut) | `media` background analysis job (KLT/ORB, path smoothing) and cached per-frame transforms; `render` applies the warp and crop |
| 11 | Markers (coloured, editable, navigation) and manual beat markers with snap | `model` marker lists on the timeline and on clips; snapping index includes markers and beats |
| 12 | Audio DSP: voice effect presets (pitch, reverb room, chorus, distortion, bit-crush), loudness normalization (R128), channel fill, multi-stream selection | `audio` insert-effect chain per clip, offline loudness analysis, stream selection in the source |
| 13 | 10-bit, HDR (HLG/PQ) pipeline and export; per-clip colour-space conversion; HDR monitor fallback | `media` 10-bit hardware-decode surfaces; `render` float pipeline with transfer/OOTF conversions; `export` HDR metadata, Main10 HEVC |
| 14 | Alpha: import ProRes 4444 / HEVC alpha; export ProRes 4444 and HEVC alpha | `media` keeps alpha planes; `render` premultiplied-alpha discipline; `export` alpha-capable encoders |
| 15 | GIF export, selected-clips batch export, caption export (SRT), background export queue | `export` palette quantization pass, job queue, caption serializer |
| 16 | Keyframe value-graph editor and movable keyframes on the track | `model` bezier handles per keyframe, so it must be part of P0's `Animated<T>` design |
| 17 | Auto remux and cache management (size, location, auto-delete) | `media` stream-copy remux job; cache directory with size budgets and LRU eviction |

### P2: differentiators and long tail

| # | Feature | Engine implication |
|---|---|---|
| 1 | Multi-camera clips (4/9 angles, sync by audio, timecode or marker, angle switching, flatten) | `model` multicam container with angle cuts; `audio` cross-correlation sync; `render` multi-angle preview grid |
| 2 | AAF / XML / FCPXML import; timeline export | `model` interchange importers and exporters with a lossy-mapping report |
| 3 | Vector shapes with pen tool, gradient and texture fills, per-corner radius, shadows | `render` lyon tessellation or SDF paths; `model` path-editing data |
| 4 | Animated data charts from CSV/XLSX | Generated layer type driven by data plus an animation schedule (could be a plugin) |
| 5 | Motion blur and smooth slow-mo (frame blending first, classical optical flow later) | `render` temporal multi-sample accumulation; optional DIS optical-flow warp; needs neighbouring frames from `media` |
| 6 | Automatic beat detection | `audio` offline spectral-flux onset and tempo analysis, cached per asset |
| 7 | DSP noise reduction and echo reduction (non-ML) | `audio` spectral gating or Wiener-filter insert with a noise-profile capture |
| 8 | Video scopes (waveform, vectorscope, histogram, parade) | `render` compute-shader reductions over the preview frame at low resolution |
| 9 | 8K export and floating-point "max quality" mode | `render` tiled or float32 paths and memory budgeting; `export` level and profile selection |
| 10 | Lottie stickers and animations | rlottie-equivalent renderer to texture, as a time-mapped source |
| 11 | Guides, rulers, safe areas; layout presets; detachable panels | Mostly `app`; `render` overlay layer outside the export graph |
| 12 | RLE export, Dolby audio formats, FLAC audio export | `export` additional muxers and encoders |
| 13 | Screen and camera recorder | `media` capture sources (AVFoundation / ScreenCaptureKit) written to project assets |

---

## Appendix A: Out of scope (AI/cloud)

These are listed for completeness. OpenRip excludes them.

- **Speech and captions**: auto captions, caption translation, bilingual auto-subtitles, filler-word and pause removal, keyword auto-highlight, "AI packaging", auto chapters
- **Voice**: text-to-speech, voice characters, custom voices and voice cloning, speech-to-song, lip sync, AI dubbing and translation, enhance voice, vocal isolation and instrument separation, AI sound effects, AI music, ML noise reduction (RNNoise model), echo reduction (AEC model), sync video to audio (time-align models — `[unsure]`)
- **Vision**: remove background (auto, custom, interactive cutout), cutout strokes on ML mattes, mask tracking, object, camera and body tracking, auto reframe, AI movement, relight, smart lights, retouch, beauty, makeup, face and body reshape, eye contact, body effects, face stickers and face mosaic (face detection), auto adjust, AI colour match and "clone target image colour", skin-tone protection, remove flickers (deflicker model), ML image denoise, super resolution and "enhance quality", ML optical-flow interpolation (`umvfi` / `interpolation` models), depth-based 3D photo `[unsure]`, split by scene or shot (shot-detection models), "Convert to HDR" `[unsure]`
- **Generative**: AI effects and image/video generation (Seedream/Seedance-family models), AI transitions, AI backgrounds and outpainting, AI avatars and digital humans, script-to-video, long video to shorts, "Director mode", EditPilot/Edit agent, AI text templates, Dreamina
- **Cloud and services**: Cloud Space and draft sync, team spaces, Brand kit, template and material marketplaces, the downloadable effect/filter/transition/sticker/music catalogues (OpenRip ships its own openly licensed assets), GIPHY, TikTok/YouTube linking and posting, copyright check, Pippit sync, subscriptions and credits, C2PA/AIGC watermarking, CapCut watermark

---

## Appendix B: Evidence index (read-only)

| Path under `/Applications/CapCut.app/Contents/` | Used for |
|---|---|
| `Info.plist` | Version 9.5.0, bundle ID, camera and microphone usage (recording), no document types declared |
| `Frameworks/` (names only) | FFmpeg libraries, dav1d, ByteVC1 decoder, LAME, ANGLE (EGL/GLESv2), Qt 6 modules, CEF, Lynx, VE SDK, effect runtime, ByteBench, C2PA SDK |
| `PlugIns/imageformats/` | Qt image codecs (GIF, HEIC, JP2, SVG, TGA, TIFF, WBMP, WebP) |
| `Resources/po/en.po` | UI strings for nearly every feature named above |
| `Resources/MixMode/MixMode.json` | Blend-mode list |
| `Resources/Chroma2`, `Curves`, `PrimaryWheel`, `LogWheel` (shader *parameter names* only) | Chroma key, curves and wheel parameter sets |
| `Resources/DefaultAdjustBundle/` (folder names) | Adjust sliders and fused adjust packages |
| `Resources/lut/*.json`, `lumi_js_resources/*/config.json` | LUT filter with skin segmentation; mask, blend and blit feature packages; effect package format |
| `Resources/VEMetalBinary_Mac.bundle/` (file names) | YCbCr→RGBA and SDR/PQ/HLG conversion kernels |
| `Resources/video_template_ratio.json` | Aspect-ratio presets |
| `Resources/importer/monitor/allowtypes.json` | Import MIME allow-list |
| `Resources/models/`, `rnnoise/`, `audiosami/`, `matting_config/` (names only) | Which features are ML-based (Appendix A) |
| `Resources/Font/` (names only) | Bundled fallback-font coverage and the emoji font |
| `Resources/bench/`, `gpu_driver_bug_list.json` | Device tiering and GPU workarounds |

**Public sources consulted** (for `[known]` items): [CapCut help: splitting subtitles / Cmd+B](https://www.capcut.com/help/split-the-subtiltes), [fastshortcuts CapCut cheat sheet](https://fastshortcuts.com/shortcuts/capcut/), [CapCut speed-curve tool page](https://www.capcut.com/tools/speed-ramp), [CapCut video-compression guide](https://www.capcut.com/resource/video-compression), [CapCut import troubleshooting](https://www.capcut.com/help/can-not-local-assets-be-recognized-during-import), and public community documentation of the draft JSON format (e.g. the pyJianYingDraft project).
