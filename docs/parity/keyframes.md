# Keyframes

CapCut keyframes almost every property it shows: the transform, opacity and volume, the Adjust sliders, filter and effect strength, the colour wheels and HSL, a text's colours and sizes, and a mask's place, size, rotation, feather and corners. Each keyframed property has its own list of keys, and the span between two keys is a straight line or a curve the keyframe graph can shape.

OpenRip imports these keys, draws every property the engine draws with CapCut's own curve, and lets the app keep and edit keys of its own. Draft names stay out of this file: drafts are referred to by what they contain.

## In the draft

Keys are in `common_keyframes[]` on each segment, one entry per property:

- `property_type` names the property (`KFTypePositionX`, `KFTypeBrightness`, `KFTypeCommonMaskFeather`, …). CapCut 9.5.0 knows about 180 types; its binaries list them.
- `material_id` names the material a material's property belongs to (an Adjust slider's effect, a mask). It can be empty, and the material is then found among the segment's attachments by kind.
- `keyframe_list[]` holds the keys, each with:
  - `time_offset`;
  - `values` (one number, or three for a colour);
  - `curveType`;
  - `left_control` and `right_control`, each `{x, y}`;
  - `graphID` (a keyframe graph preset; empty in every local draft) and `string_value`.

### Time

`time_offset` is in **source time** for segments that play media, counted from the material's start, and in the segment's own time otherwise. Two kinds of evidence:

- A local draft keys a video's position at 8.375 s and 8.625 s, on a clip 5.375 s long that reads its media from 7.125 s. The keys are past the clip's length but inside its source range.
- CapCut's evaluator maps a key's offset through the segment's speed and source range (`lvve::KeyframeTimeHelper::getTimelineByKeyframeTimeOffset`).

The importer converts keys to the segment's local time: `(offset − source start) / speed`. Text and other segments without media keep their offsets. In that draft, the keys now land 1.25 s into the clip, and the inset moves off the captions as its keys say. Before, they fell past the clip's end, and the inset covered the captions for the rest of the clip.

### Curve types and handles

CapCut's `LVVEKeyframeCurveType` (`lvve::DraftEnumTransfer`) has these values:

| Value | `curveType` |
|---|---|
| 0 | `Line` |
| 1 | `CurveOut` |
| 2 | `CurveIn` |
| 3 | `CurveInOut` |
| 4 | `FreeCurveIn` |
| 5 | `FreeCurveOut` |
| 6 | `FreeCurveInOut` |

The `Free…` types come from splitting a clip inside a curve. Every key in the local drafts is `Line`.

A handle is an offset from its own key in absolute units: microseconds of the key's time and the property's own units. CapCut's default handle sits 0.4 of the span along and is flat (`lvve::KeyframeUtils::updateDefaultControlPoint`: `x = 0.4·(t_next − t)`, `y = 0`, clamped to the span).

CapCut's evaluator (`lvve::KeyframePropertyHelper`) picks the handles for the span from key A to key B this way:

- A brings its `right_control` only if A isn't `Line`, and B brings its `left_control` only if B isn't `Line`. A missing handle has zero length.
- Between two `Line` keys, the span is a straight line.

Because the handles are absolute, a handle with a value offset bends the curve even between two equal values. Normalised CSS-style easing can't express that.

## How CapCut evaluates a curve

This is read from CapCut's arm64 code: lvve's evaluator, then `vesdk::VEUtilsImpl::interpolationCubicBezier` in `libcccreator.dylib`, which the evaluator calls through its `IVEUtils`.

1. **The points.** For each component, the bezier runs from P0 = (t_A, v_A) through P1 = (t_A + right.x, v_A + right.y) and P2 = (t_B + left.x, v_B + left.y) to P3 = (t_B, v_B). Times are the segment's local µs. Each coordinate is summed in double precision, then converted to f32. The progress is u = (t − t_A) / (t_B − t_A).
2. **The coefficients.** The control points' times are normalised by the span: a = (P1.t − P0.t)/span and b = (P2.t − P0.t)/span. Then x(s) = c3·s³ + c2·s² + c1·s, with c3 = 3a + (1 − 3b), c2 = 3b − 6a and c1 = 3a.
3. **The solver.**
   - Outside (0, 1), and within 10⁻⁶ of an end, it doesn't iterate.
   - Newton's method starts at s = u for up to 8 steps, each kept in [0, 1]. It stops when |x(s) − u| < 0.001, and breaks off if the derivative falls below 10⁻⁶.
   - Failing that, it bisects [0, 1]. Bisection stops within 0.001, or when the interval closes; the last Newton estimate stands then.
4. **The value.** The value is the bezier's y at s, computed as fused multiply-adds in CapCut's order.

Everything after step 1 is in f32. The tolerance is in normalised time, so a curve lands within 0.1 % of its span in time, as CapCut's does.

OpenRip's version is `openrip_model::capcut_curve` / `capcut_solve` (Rust) and `capcutCurve` / `capcutSolve` (TypeScript, `lib/keyframes.ts`).

**Checked against CapCut itself.** A scratch harness, kept outside the repo, loads CapCut's `libcccreator.dylib` on this machine and calls its `interpolationCubicBezier` directly. It compared 36,000 cases with OpenRip's:

- random keys, spans from 1 µs to 100 s, and CapCut's default handles, one-sided handles and dragged handles with value offsets;
- handles past the span, which make Newton fail and the solver bisect;
- zero-length handles;
- progress at, near and outside the ends.

Every case is **bit for bit the same**. Ten of the cases are golden values in the Rust and TypeScript tests. No CapCut code is in the repo.

## In the model

- **Keys.** `Keyframe<T>` holds a time (segment-local µs), a value and an `Easing` for the span to the next key:
  - `Linear` or `Hold`;
  - `Bezier` (CSS, normalised);
  - `Curve { out, into, straight }`: CapCut's curve. The handles carry a time and a value offset for each component (x and y of a position or scale, the channels of a colour). Components flagged in `straight` go in a line; they appear when a position's x is keyed on a line and its y on a curve.
- **Sampling.** `sample_keys` is a function of the time alone, so a seek gives the same bits as playing up to it. Before the first key the first value holds, and after the last the last.
- **Where the keys live.**
  - The transform, opacity and volume keep their keys on the segment (`Animated<T>`).
  - Material values are keyframed per segment in `Segment::keyframes`: a list of `ParamKeys` (material, `Param`, keys). `keyed.rs` gives a material with its keyed values at a time (`effect_at`, `wheels_at`, `hsl_at`, `text_at`, `mask_at`).
  - The preview draws every material through these helpers: the Adjust sliders (CapCut's and the app's), colour-wheel strength, HSL ranges, a filter bar's strength, the text's fill, outline, shadow, background, curve and size, and the masks.
- **Edits.**
  - A trim shifts the keys, and a speed change scales their times and their handles' times.
  - A split adds a key at the cut to every keyframed property (`split_keys`). A curve is cut in two by de Casteljau's construction, at the bezier parameter where its time reaches the cut, as CapCut makes its `Free…` curves.
  - The halves are evaluated by CapCut's solver like any curve, so they match the original to within its 0.1 % tolerance.
  - The same split merges a position's x and y channels when CapCut keys them at different times.

## Import mapping

| CapCut type | Model | Units |
|---|---|---|
| `KFTypePositionX`, `…Y` | `transform.position` (one key list, per-axis handles) | the clip's `transform` |
| `KFTypeScaleX`, `…Y`, `KFTypeScale` | `transform.scale` (X alone or `Scale` scales both) | the clip's `scale` |
| `KFTypeRotation` | `transform.rotation` | degrees |
| `KFTypeGlobalAlpha` (else `KFTypeAlpha`) | `opacity` | 0–1 |
| `KFTypeVolume` | `volume` | linear gain |
| `KFTypeBrightness`, `Contrast`, `Saturation`, `Sharpen`, `HightLight`, `Shadow`, `Temperature`, `Hue` (CapCut's Tint, `tone`), `Vignetting`, `Black`, `White`, `LightSensatione` (exposure), `Fade`, `Clear` (clarity) | `Param::Intensity` on that Adjust slider's effect; one is made if the clip has none yet | the slider's `value` (−1…1) |
| `KFTypeFilter` | `Param::Intensity` of a filter bar | 0–1 |
| `KFTypePrimaryColorWheelIntensity` | `Param::WheelIntensity` | 0–1 |
| `KFTypeHslHueIntensity`, `…Saturation…`, `…Lightness…` | the HSL range's hue, saturation, lightness | −100…100 |
| `KFTypeTextColor`, `TextAlpha`, `BorderColor`, `BorderAlpha`, `BorderWidth`, `ShadowColor`, `ShadowAlpha`, `ShadowAngle`, `ShadowDistance`, `ShadowSmoothing`, `BackgroundColor`, `BackgroundAlpha`, `BackgroundRoundRadius`, `BackgroundWidth`, `BackgroundHeight`, `TextCurveAngle` | the text's parameters | the text material's units (shadow distance in hundredths of the font size) |
| `KFTypeCommonMaskPositionX`, `…Y`, `SizeWidth`, `SizeHeight`, `Rotation`, `Feather`, `RoundCorner` | the mask's parameters | the mask's `config` |

The local drafts use `KFTypeGlobalAlpha` (20 keys, on texts) and `KFTypePositionX`/`Y` (2 + 2, on a video), all `Line`. The other rows follow CapCut's names and its materials' units, without a local draft to check them against. The text rows and the Adjust and HSL value units are the least certain.

**Still unmapped.** The report's `unmapped_keyframes` lists keys for what the engine doesn't draw:

- chroma key;
- LUT and skin LUT;
- beauty, body and smart colour;
- the video's shadow and rounded corners;
- corner pin;
- a mask's expansion, scale, stroke and shadow;
- shapes;
- effect parameters (`KFTypeEffectAdjustParam1–3`) and effects;
- audio panning;
- light sources, bloom, particles;
- keyframe graphs (`graphID`: a key's span is drawn with its own curve type and handles instead);
- a filter on a clip rather than on a filter track.

Keys on segments of tracks the engine doesn't draw (adjustment layers, effects) are imported but listed too.

## In the app

Clips keep keys of their own in `keyframes` (`lib/types.ts`). Values are in the clip fields' units, and easings are CapCut's presets or explicit handles. A converted CapCut clip shows its own keys there, and edits apply on top. `lib/keyframes.ts` holds pure helpers to read, edit, sample, shift, scale and split keys, and CapCut's rule that an edit at the playhead sets a key there while a property has keys. See [app-engine-integration.md](../plan/app-engine-integration.md) ("Keyframes").

## Checks

- **The curve.** Bit for bit CapCut's own, as above.
- **The app's sampler against the engine's.** Random keys of every easing on rotation, opacity, volume and position were sampled at 401 frames. Rotation, whose units are the same in both, gives the same value at every frame. The others agree to float precision (at most 1.5·10⁻⁷ for opacity, 3·10⁻⁷ for position in canvas half-widths), because the engine works in other units and stores some values as f32.
- **Drafts with keys.**
  - The draft whose texts fade in has a CapCut export. Its export parity is the same before and after: p50 38.0 dB and worst 26.1 dB over 225 samples, and p50 32.7 dB at every frame of the fades. Its keys are `Line` on texts, which imported the same way before.
  - The draft with position keys has no export, and its cover is frame 0, before the keys. Its keys now fall inside the clip (above).
- **In the app.** The harness steps `keyframes` and `keyframescheck` (apps/app/scripts/smoke) check:
  - keys set through the store make the engine's frame darken as the opacity falls and change at every sample;
  - an edit at the playhead sets a key;
  - a split keeps the frames (to 0.0001 of lightness);
  - the keys survive a save and reopen.
  A draft opened in the app shows its texts' opacity keys in `keyframes`.
- **Drafts without keys render as before.** The app round trip gives 138.1 dB on all 35 compared drafts, and cover-parity and preview-scan are unchanged.

## Not done

- **Keyframe graphs** (`keyframe_graph_list`, `graphID`): presets of normalised graph points, each with its own handles, applied to a span. CapCut evaluates them through the same bezier, point to point. No local draft uses one.
- **Exact handle times.** CapCut rounds a handle's time to whole µs inside its evaluator; OpenRip keeps the fraction. The difference is under 1 µs.
- **Reversed clips and speed curves.** Keys are mapped through the clip's constant speed and its forward media time.
