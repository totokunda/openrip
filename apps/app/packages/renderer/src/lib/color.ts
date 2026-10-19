// A video or photo's colour tools (`color`, ClipColor in lib/types.ts), as CapCut's Adjust
// tab has them: the lists and ranges the panels show, and pure helpers that return patches
// for `updateClip` (nothing here writes to what it's given; the undo history shares clips).
// The engine draws them through CapCut's own maths (engine/crates/v1/src/color.rs turns them
// into the materials a draft would have); docs/plan/app-engine-integration.md, "Colour and
// compositing", has the data model and how the old sliders carry over.
import type {
  AdjustSlider,
  AnyClipProps,
  ClipColor,
  ColorWheel,
  CurveChannel,
  CurvePointXY,
  HslPart,
  HslRange,
  KeyframeProperty,
  MediaAdjustments,
} from "./types";

/** One Basic slider: its CapCut name, range, and the section CapCut puts it in. */
export type AdjustSliderInfo = { key: AdjustSlider; name: string; min: number; max: number; section: "color" | "lightness" | "effects" };

/** The Basic sliders in CapCut's order (Color, Lightness, Effects), on CapCut's scale. */
export const ADJUST_SLIDERS: AdjustSliderInfo[] = [
  { key: "temperature", name: "Temperature", min: -50, max: 50, section: "color" },
  { key: "tint", name: "Tint", min: -50, max: 50, section: "color" },
  { key: "saturation", name: "Saturation", min: -50, max: 50, section: "color" },
  { key: "exposure", name: "Exposure", min: -50, max: 50, section: "lightness" },
  { key: "brightness", name: "Brightness", min: -50, max: 50, section: "lightness" },
  { key: "contrast", name: "Contrast", min: -50, max: 50, section: "lightness" },
  { key: "highlights", name: "Highlight", min: -50, max: 50, section: "lightness" },
  { key: "shadows", name: "Shadow", min: -50, max: 50, section: "lightness" },
  { key: "whites", name: "Whites", min: -50, max: 50, section: "lightness" },
  { key: "blacks", name: "Blacks", min: -50, max: 50, section: "lightness" },
  { key: "sharpen", name: "Sharpen", min: 0, max: 100, section: "effects" },
  { key: "clarity", name: "Clarity", min: 0, max: 100, section: "effects" },
  { key: "particles", name: "Particles", min: 0, max: 100, section: "effects" },
  { key: "vignette", name: "Vignette", min: -100, max: 100, section: "effects" },
  { key: "fade", name: "Fade", min: 0, max: 100, section: "effects" },
];

/** CapCut's HSL ranges in its order, with a swatch for each. */
export const HSL_RANGES: { key: HslRange; name: string; swatch: string }[] = [
  { key: "red", name: "Red", swatch: "#ff3b30" },
  { key: "orange", name: "Orange", swatch: "#ff9500" },
  { key: "yellow", name: "Yellow", swatch: "#ffcc00" },
  { key: "green", name: "Green", swatch: "#34c759" },
  { key: "cyan", name: "Cyan", swatch: "#32d2e6" },
  { key: "blue", name: "Blue", swatch: "#007aff" },
  { key: "purple", name: "Purple", swatch: "#8e44dd" },
  { key: "magenta", name: "Magenta", swatch: "#ff2d92" },
];

export const HSL_PARTS: HslPart[] = ["hue", "saturation", "lightness"];
export const CURVE_CHANNELS: CurveChannel[] = ["luma", "red", "green", "blue"];
export const WHEELS = ["lift", "gamma", "gain", "offset"] as const;
export type WheelName = (typeof WHEELS)[number];

/** A curve that changes nothing: the diagonal from black to white. */
export const IDENTITY_CURVE: CurvePointXY[] = [
  [0, 0],
  [1, 1],
];

/** The clip's colour tools, or none. */
export const colorOf = (clip: AnyClipProps): ClipColor => ((clip.type === "video" || clip.type === "image" || (clip.type === "filter" && (clip as any).adjustment)) && (clip as any).color) || {};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sliderInfo = (key: AdjustSlider) => ADJUST_SLIDERS.find((s) => s.key === key)!;

/** A patch setting one Basic slider (clamped to its range; 0 takes it off). */
export const setAdjust = (clip: AnyClipProps, key: AdjustSlider, value: number): Partial<AnyClipProps> => {
  const c = colorOf(clip);
  const { min, max } = sliderInfo(key);
  const adjust = { ...(c.adjust ?? {}) };
  const v = clamp(value, min, max);
  if (v === 0) delete adjust[key];
  else adjust[key] = v;
  return { color: { ...c, adjust } } as Partial<AnyClipProps>;
};

/** A patch setting one HSL range's hue, saturation or lightness (−100…100). */
export const setHsl = (clip: AnyClipProps, range: HslRange, part: HslPart, value: number): Partial<AnyClipProps> => {
  const c = colorOf(clip);
  const hsl = { ...(c.hsl ?? {}) };
  hsl[range] = { ...(hsl[range] ?? {}), [part]: clamp(value, -100, 100) };
  return { color: { ...c, hsl } } as Partial<AnyClipProps>;
};

/** A patch setting one channel's curve points (sorted by input level). */
export const setCurve = (clip: AnyClipProps, channel: CurveChannel, points: CurvePointXY[]): Partial<AnyClipProps> => {
  const c = colorOf(clip);
  const sorted = points.map(([x, y]) => [clamp(x, 0, 1), clamp(y, 0, 1)] as CurvePointXY).sort((a, b) => a[0] - b[0]);
  return { color: { ...c, curves: { ...(c.curves ?? {}), [channel]: sorted } } } as Partial<AnyClipProps>;
};

/** The colour wheels' mode: Primary (the default) or Log. */
export type WheelMode = "primary" | "log";
export const wheelMode = (c: ClipColor): WheelMode => (c.wheels?.mode === "log" ? "log" : "primary");

/** A wheel's values in the mode the panel is in (Log keeps its own set beside the primary one). */
export const wheelOf = (c: ClipColor, wheel: WheelName): ColorWheel => (wheelMode(c) === "log" ? c.wheels?.log?.[wheel] : c.wheels?.[wheel]) ?? {};

/** A patch setting one wheel's values (CapCut's −1…1) in the mode the panel is in. */
export const setWheel = (clip: AnyClipProps, wheel: WheelName, value: ColorWheel): Partial<AnyClipProps> => {
  const c = colorOf(clip);
  const wheels = c.wheels ?? {};
  if (wheelMode(c) === "log") return { color: { ...c, wheels: { ...wheels, log: { ...(wheels.log ?? {}), [wheel]: value } } } } as Partial<AnyClipProps>;
  return { color: { ...c, wheels: { ...wheels, [wheel]: value } } } as Partial<AnyClipProps>;
};

/** A patch switching the wheels between Primary and Log (both keep their values). */
export const setWheelMode = (clip: AnyClipProps, mode: WheelMode): Partial<AnyClipProps> => {
  const c = colorOf(clip);
  return { color: { ...c, wheels: { ...(c.wheels ?? {}), mode } } } as Partial<AnyClipProps>;
};

export const setWheelsIntensity = (clip: AnyClipProps, intensity: number): Partial<AnyClipProps> => {
  const c = colorOf(clip);
  return { color: { ...c, wheels: { ...(c.wheels ?? {}), intensity: clamp(intensity, 0, 100) } } } as Partial<AnyClipProps>;
};

/** A patch setting the clip's LUT (a `.cube` file or a Hald CLUT image), or taking it off. */
export const setLut = (clip: AnyClipProps, lut: { path: string; name?: string; intensity?: number } | null): Partial<AnyClipProps> => {
  const c = colorOf(clip);
  return { color: { ...c, lut: lut ? { ...lut, intensity: clamp(lut.intensity ?? 100, 0, 100) } : null } } as Partial<AnyClipProps>;
};

/** Whether a curve changes nothing (every point on the diagonal, within a level). */
export const isIdentityCurve = (points: CurvePointXY[] | undefined) => !points || points.length < 2 || points.every(([x, y]) => Math.abs(x - y) < 1 / 255);

/** Whether the colour tools change nothing. */
export const isNeutralColor = (c: ClipColor | null | undefined): boolean => {
  if (!c) return true;
  const zero = (o: object | undefined) => !o || Object.values(o).every((v) => !v);
  const wheelZero = WHEELS.every((w) => zero(wheelOf(c, w)));
  return (
    zero(c.adjust) &&
    HSL_RANGES.every((r) => zero(c.hsl?.[r.key])) &&
    CURVE_CHANNELS.every((ch) => isIdentityCurve(c.curves?.[ch])) &&
    (wheelZero || c.wheels?.intensity === 0) &&
    !c.lut?.path
  );
};

/** The keyframe properties of the colour tools (lib/keyframes.ts reads and writes them). */
export const COLOR_PROPERTIES: KeyframeProperty[] = [
  ...ADJUST_SLIDERS.map((s) => `adjust:${s.key}` as KeyframeProperty),
  ...HSL_RANGES.flatMap((r) => HSL_PARTS.map((p) => `hsl:${r.key}:${p}` as KeyframeProperty)),
  "wheels:intensity",
  "lut:intensity",
];

/** A colour property's value on the clip's fields (its neutral value when unset). */
export const colorPropertyValue = (clip: AnyClipProps, property: string): number | undefined => {
  const c = colorOf(clip);
  if (property.startsWith("adjust:")) return c.adjust?.[property.slice(7) as AdjustSlider] ?? 0;
  if (property.startsWith("hsl:")) {
    const [, range, part] = property.split(":");
    return c.hsl?.[range as HslRange]?.[part as HslPart] ?? 0;
  }
  if (property === "wheels:intensity") return c.wheels?.intensity ?? 100;
  if (property === "lut:intensity") return c.lut?.path ? (c.lut.intensity ?? 100) : undefined;
  return undefined;
};

/** A patch setting a colour property's field. */
export const colorPropertyPatch = (clip: AnyClipProps, property: string, value: number): Partial<AnyClipProps> => {
  if (property.startsWith("adjust:")) return setAdjust(clip, property.slice(7) as AdjustSlider, value);
  if (property.startsWith("hsl:")) {
    const [, range, part] = property.split(":");
    return setHsl(clip, range as HslRange, part as HslPart, value);
  }
  if (property === "wheels:intensity") return setWheelsIntensity(clip, value);
  if (property === "lut:intensity") {
    const lut = colorOf(clip).lut;
    return lut ? setLut(clip, { ...lut, intensity: value }) : {};
  }
  return {};
};

// ---- the old sliders -----------------------------------------------------------------------

/**
 * The old sliders that have a CapCut counterpart, with the CapCut value (the draft's −1…1)
 * whose picture comes closest to the old one at a few of its values, measured on the engine
 * (a ramp of greys and hues, least squares; docs/plan/app-engine-integration.md). Between
 * them it's interpolated. Brightness (an offset CapCut's curve can't reach), hue, blur and
 * noise have none and stay as they are.
 */
const LEGACY_TO_CAPCUT: Partial<Record<keyof MediaAdjustments, { to: AdjustSlider; points: [number, number][] }>> = {
  contrast: { to: "contrast", points: [[-100, -1], [-50, -1], [-25, -0.72], [0, 0], [25, 0.49], [50, 0.76], [100, 0.97]] },
  saturation: { to: "saturation", points: [[-100, -0.76], [-50, -0.38], [-25, -0.19], [0, 0], [25, 0.19], [50, 0.39], [100, 0.55]] },
  vignette: { to: "vignette", points: [[0, 0], [25, 0.15], [50, 0.37], [100, 0.67]] },
  sharpness: { to: "sharpen", points: [[0, 0], [25, 0.25], [50, 0.56], [100, 1]] },
};

const interpolate = (points: [number, number][], x: number) => {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
};

/** CapCut's scale for a slider's draft value (times 50, or 100 for the one-sided ones). */
const capcutScale = (key: AdjustSlider) => (["sharpen", "clarity", "particles", "vignette", "fade"].includes(key) ? 100 : 50);

/**
 * Move a clip's old sliders onto the CapCut-scale set: each one with a counterpart (contrast,
 * saturation, vignette, sharpness) becomes that slider at the closest value and goes to 0;
 * the others (brightness, hue, blur, noise) and any that are keyframed stay as they are. A
 * slider already set in `color` keeps its own value. Returns the patch for `updateClip`, or
 * `{}` when there's nothing to move.
 */
export const migrateLegacyAdjustments = (clip: AnyClipProps): Partial<AnyClipProps> => {
  if (clip.type !== "video" && clip.type !== "image") return {};
  const c = clip as any;
  const patch: Record<string, unknown> = {};
  const adjust = { ...(colorOf(clip).adjust ?? {}) };
  for (const [legacy, map] of Object.entries(LEGACY_TO_CAPCUT)) {
    const v = c[legacy] ?? 0;
    if (!v || clip.keyframes?.[legacy as KeyframeProperty]?.length || adjust[map!.to] !== undefined) continue;
    const value = Math.round(interpolate(map!.points, v) * capcutScale(map!.to));
    if (value !== 0) adjust[map!.to] = value;
    patch[legacy] = 0;
  }
  if (!Object.keys(patch).length) return {};
  return { ...patch, color: { ...colorOf(clip), adjust } } as Partial<AnyClipProps>;
};

/** Whether a clip still has old sliders that `migrateLegacyAdjustments` would move. */
export const hasLegacyAdjustments = (clip: AnyClipProps) => Object.keys(migrateLegacyAdjustments(clip)).length > 0;
