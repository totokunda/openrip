// OpenRip's own text styles for the Text tab's Effects (CapCut's "Effects" presets on text):
// layered looks the engine draws with its own code (engine/crates/render/src/text.rs, the
// layered styles it also draws CapCut's library styles with), defined here as data. Nothing
// comes from CapCut: the looks follow its common kinds (outlines, neon, shadows, gradients),
// with our own colours and sizes.
//
// A style goes on a text clip as its `textEffect` (lib/types.ts `TextEffectStyle`): layers in
// place of the clip's colour and stroke, shadows at the back, then the outlines (the first on
// top), then the fill. Sizes are fractions of the font size; a paint is a colour, a gradient or
// the clip's own colour (`textColor`), so a style can follow the colour picked in Basic. A glow
// in a style goes under it (the clip's own glow, from Basic, wins).
//
// Nothing here writes to a store: set `textEffectOf(id)` with `updateClip`. A converted CapCut
// clip shows its library style as `{ id: "", name }`; replacing it with one of these (or with
// none) takes CapCut's off the clip. See docs/plan/app-engine-integration.md ("Text styles and
// captions") and docs/parity/text-styles.md.
import type { TextEffectStyle, TextStylePaint } from "./types";

/** A built-in style as the Effects grid lists it. */
export type BuiltinTextStyle = {
  id: string;
  name: string;
  /** A group for the grid, like CapCut's tabs. */
  category: "Outline" | "Glow" | "Shadow" | "Gradient";
  style: TextEffectStyle;
};

const text: TextStylePaint = { textColor: true };
const solid = (color: string, opacity?: number): TextStylePaint => (opacity == null ? { color } : { color, opacity });

/** Every built-in style, in grid order. */
export const TEXT_STYLES: BuiltinTextStyle[] = [
  {
    id: "outline",
    name: "Outline",
    category: "Outline",
    style: { id: "outline", name: "Outline", fill: text, strokes: [{ width: 0.08, paint: solid("#000000") }] },
  },
  {
    id: "outline_white",
    name: "White Outline",
    category: "Outline",
    style: { id: "outline_white", name: "White Outline", fill: text, strokes: [{ width: 0.08, paint: solid("#ffffff") }] },
  },
  {
    id: "double_outline",
    name: "Double Outline",
    category: "Outline",
    style: {
      id: "double_outline",
      name: "Double Outline",
      fill: text,
      strokes: [
        { width: 0.06, paint: solid("#ffffff") },
        { width: 0.14, paint: solid("#111111") },
      ],
    },
  },
  {
    id: "sticker",
    name: "Sticker",
    category: "Outline",
    style: {
      id: "sticker",
      name: "Sticker",
      fill: text,
      strokes: [{ width: 0.16, paint: solid("#ffffff") }],
      shadows: [{ paint: solid("#000000", 45), distance: 0.06, angle: -60, blur: 0.06 }],
    },
  },
  {
    id: "candy",
    name: "Candy",
    category: "Outline",
    style: {
      id: "candy",
      name: "Candy",
      fill: solid("#ff5fa2"),
      strokes: [
        { width: 0.07, paint: solid("#ffffff") },
        { width: 0.15, paint: solid("#ff5fa2") },
      ],
    },
  },
  {
    id: "neon",
    name: "Neon",
    category: "Glow",
    style: {
      id: "neon",
      name: "Neon",
      fill: solid("#ffffff"),
      strokes: [{ width: 0.035, paint: text }],
      glow: { color: null, intensity: 45, range: 15 },
    },
  },
  {
    id: "neon_pink",
    name: "Neon Pink",
    category: "Glow",
    style: {
      id: "neon_pink",
      name: "Neon Pink",
      fill: solid("#fff0f8"),
      strokes: [{ width: 0.035, paint: solid("#ff2fa8") }],
      glow: { color: "#ff2fa8", intensity: 50, range: 18 },
    },
  },
  {
    id: "soft_glow",
    name: "Soft Glow",
    category: "Glow",
    style: { id: "soft_glow", name: "Soft Glow", fill: text, glow: { color: null, intensity: 30, range: 10 } },
  },
  {
    id: "shadowed",
    name: "Shadowed",
    category: "Shadow",
    style: { id: "shadowed", name: "Shadowed", fill: text, shadows: [{ paint: solid("#000000", 70), distance: 0.06, angle: -45, blur: 0.05 }] },
  },
  {
    id: "hard_shadow",
    name: "Hard Shadow",
    category: "Shadow",
    style: { id: "hard_shadow", name: "Hard Shadow", fill: text, strokes: [{ width: 0.04, paint: solid("#000000") }], shadows: [{ paint: solid("#000000"), distance: 0.09, angle: -45, blur: 0 }] },
  },
  {
    id: "retro",
    name: "Retro",
    category: "Shadow",
    style: {
      id: "retro",
      name: "Retro",
      fill: solid("#ffd23f"),
      strokes: [{ width: 0.05, paint: solid("#2b1a0e") }],
      shadows: [{ paint: solid("#e4572e"), distance: 0.1, angle: -45, blur: 0 }],
    },
  },
  {
    id: "pop",
    name: "Pop",
    category: "Shadow",
    style: {
      id: "pop",
      name: "Pop",
      fill: solid("#fff200"),
      strokes: [{ width: 0.09, paint: solid("#000000") }],
      shadows: [{ paint: solid("#000000"), distance: 0.12, angle: -60, blur: 0 }],
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    category: "Gradient",
    style: { id: "sunset", name: "Sunset", fill: { gradient: { colors: ["#ffb347", "#ff4e7a"], angle: -90, span: "text" } } },
  },
  {
    id: "ocean",
    name: "Ocean",
    category: "Gradient",
    style: { id: "ocean", name: "Ocean", fill: { gradient: { colors: ["#43e8d8", "#2a6df4"], angle: 0, span: "text" } }, strokes: [{ width: 0.05, paint: solid("#0b1d3a") }] },
  },
  {
    id: "metal",
    name: "Metal",
    category: "Gradient",
    style: {
      id: "metal",
      name: "Metal",
      fill: { gradient: { colors: ["#ffffff", "#c9ced6", "#7d8590"], stops: [0, 0.55, 1], angle: 90, span: "character" } },
      strokes: [{ width: 0.05, paint: solid("#2d3138") }],
    },
  },
  {
    id: "rainbow",
    name: "Rainbow",
    category: "Gradient",
    style: { id: "rainbow", name: "Rainbow", fill: { gradient: { colors: ["#ff4d4d", "#ffb14d", "#fff34d", "#4dff88", "#4db8ff", "#b84dff"], angle: 0, span: "text" } } },
  },
];

/** A built-in style by id. */
export const textStyle = (id: string): BuiltinTextStyle | undefined => TEXT_STYLES.find((s) => s.id === id);

/** The `textEffect` field for a built-in style (a fresh copy), or null for "None". */
export const textEffectOf = (id: string | null): TextEffectStyle | null => {
  const s = id ? textStyle(id) : undefined;
  return s ? (JSON.parse(JSON.stringify(s.style)) as TextEffectStyle) : null;
};

/** Whether a clip's style is a CapCut library style (drawn from CapCut's bundle; shown by name). */
export const isCapCutStyle = (style: TextEffectStyle | null | undefined): boolean => !!style && style.id === "";

/** A paint's CSS colour for a preview tile: a colour, the gradient as CSS, or the text's colour. */
const paintCss = (p: TextStylePaint | undefined, textColor: string): string | undefined => {
  if (!p) return undefined;
  const alpha = (p.opacity ?? 100) / 100;
  const withAlpha = (hex: string) => {
    const h = hex.replace("#", "");
    const v = (i: number) => parseInt(h.slice(i, i + 2), 16);
    if (h.length < 6) return hex;
    const a = (h.length >= 8 ? v(6) / 255 : 1) * alpha;
    return `rgba(${v(0)}, ${v(2)}, ${v(4)}, ${+a.toFixed(3)})`;
  };
  if ("textColor" in p) return withAlpha(textColor);
  if ("color" in p) return withAlpha(p.color);
  return undefined;
};

/**
 * CSS that approximates a style for a grid tile or a preset's preview (React's style object
 * shape), on text of `fontSizePx` in `textColor`. The engine's drawing is the real one.
 */
export const textStyleCss = (style: TextEffectStyle, textColor = "#ffffff", fontSizePx = 16): Record<string, string | number> => {
  const css: Record<string, string | number> = {};
  const fill = style.fill;
  if (fill && "gradient" in fill) {
    const g = fill.gradient;
    // CSS angles run clockwise from up; ours counter-clockwise from +x.
    const stops = g.colors.map((c, i) => `${c} ${Math.round((g.stops?.[i] ?? (g.colors.length > 1 ? i / (g.colors.length - 1) : 0)) * 100)}%`);
    css.backgroundImage = `linear-gradient(${90 - g.angle}deg, ${stops.join(", ")})`;
    css.WebkitBackgroundClip = "text";
    css.backgroundClip = "text";
    css.color = "transparent";
  } else {
    css.color = paintCss(fill, textColor) ?? textColor;
  }
  const strokes = style.strokes ?? [];
  if (strokes.length) {
    // One CSS outline: the first (it's on top); further ones as hard shadows around it.
    css.WebkitTextStroke = `${Math.max(1, strokes[0].width * fontSizePx * 2).toFixed(1)}px ${paintCss(strokes[0].paint, textColor) ?? "#000"}`;
    css.paintOrder = "stroke fill";
  }
  const shadows: string[] = [];
  for (const o of strokes.slice(1)) {
    const r = (o.width * fontSizePx).toFixed(1);
    const c = paintCss(o.paint, textColor) ?? "#000";
    shadows.push(`${r}px 0 0 ${c}`, `-${r}px 0 0 ${c}`, `0 ${r}px 0 ${c}`, `0 -${r}px 0 ${c}`);
  }
  for (const s of style.shadows ?? []) {
    const a = (s.angle * Math.PI) / 180;
    const d = s.distance * fontSizePx;
    shadows.push(`${(d * Math.cos(a)).toFixed(1)}px ${(-d * Math.sin(a)).toFixed(1)}px ${(s.blur * fontSizePx).toFixed(1)}px ${paintCss(s.paint, textColor) ?? "#000"}`);
  }
  if (style.glow) {
    const c = style.glow.color || textColor;
    shadows.push(`0 0 ${((style.glow.range / 100) * fontSizePx * 1.5 + 2).toFixed(1)}px ${c}`);
  }
  if (shadows.length) css.textShadow = shadows.join(", ");
  return css;
};
