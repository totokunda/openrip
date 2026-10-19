// OpenRip's own caption styles for Auto captions and the Captions tab's Templates: forty looks
// in four kinds of word-by-word treatment, made by us, on the fonts the app bundles (all SIL
// Open Font License, see Third-party copyright).
//
// - highlight: the whole line shows and the word being said changes colour;
// - karaoke: the line fills with a colour as it's said, letter by letter;
// - pop: each word appears as it's said, the new one in colour;
// - boxed: the word being said sits on a box of the colour.
//
// A style is a text clip's look plus `captionStyle` (the engine's caption style, drawn by
// engine/crates/playback/src/caption.rs) and `captionColor` (its colour). Pure data: no stores.
import type { TextClipProps } from "./types";

export type CaptionKind = "highlight" | "karaoke" | "pop" | "boxed";

export type CaptionPreset = { id: string; name: string; kind: CaptionKind; props: Partial<TextClipProps> };

/** OpenRip's accent, the lavender. */
export const ACCENT = "#ae81ce";

type Look = {
  id: string;
  name: string;
  font: string;
  weight: number;
  upper?: boolean;
  /** Text colour. */
  color: string;
  /** The word's colour: the highlight, fill or box. */
  accent: string;
  outline?: string;
  shadow?: boolean;
  /** A box behind the whole line. */
  plate?: string;
  size?: number;
};

const make = (kind: CaptionKind, l: Look): CaptionPreset => {
  const style = { highlight: "orip_highlight", karaoke: "orip_karaoke", pop: "orip_pop", boxed: "orip_boxed" }[kind];
  const props: Partial<TextClipProps> = {
    fontFamily: l.font,
    fontWeight: l.weight,
    fontSize: l.size ?? 32,
    color: l.color,
    textTransform: l.upper ? "uppercase" : "none",
    strokeEnabled: !!l.outline,
    stroke: l.outline ?? "#000000",
    strokeWidth: 3,
    shadowEnabled: !!l.shadow,
    shadowColor: "#000000",
    shadowOpacity: 70,
    shadowBlur: 6,
    shadowOffsetX: 0,
    shadowOffsetY: 3,
    backgroundEnabled: !!l.plate,
    backgroundColor: l.plate ?? "#000000",
    backgroundOpacity: 60,
    backgroundCornerRadius: 6,
    captionStyle: style,
    captionColor: l.accent,
  };
  return { id: `${kind}-${l.id}`, name: l.name, kind, props };
};

const HIGHLIGHT: Look[] = [
  { id: "yellow", name: "Yellow word", font: "Montserrat", weight: 700, color: "#ffffff", accent: "#ffe600", outline: "#000000" },
  { id: "lavender", name: "Lavender word", font: "Poppins", weight: 700, color: "#ffffff", accent: ACCENT, shadow: true },
  { id: "green", name: "Green word", font: "Montserrat", weight: 700, color: "#ffffff", accent: "#3ddc84", outline: "#000000" },
  { id: "cyan", name: "Cyan word", font: "Roboto", weight: 700, color: "#ffffff", accent: "#27d3f5", shadow: true },
  { id: "pink", name: "Pink word", font: "Poppins", weight: 600, color: "#ffffff", accent: "#ff5fa2", outline: "#2a0a1a" },
  { id: "orange", name: "Orange word", font: "Oswald", weight: 700, upper: true, color: "#ffffff", accent: "#ff8a1f", outline: "#000000" },
  { id: "red", name: "Red word", font: "Open Sans", weight: 700, color: "#ffffff", accent: "#ff3b3b", shadow: true },
  { id: "bold-caps", name: "Bold caps", font: "Oswald", weight: 700, upper: true, color: "#ffffff", accent: "#ffe600", shadow: true, size: 36 },
  { id: "soft", name: "Soft shadow", font: "Lato", weight: 700, color: "#f4f4f4", accent: "#ffd166", shadow: true },
  { id: "plate", name: "On a plate", font: "Montserrat", weight: 600, color: "#ffffff", accent: ACCENT, plate: "#000000" },
];

const KARAOKE: Look[] = [
  { id: "green", name: "Green fill", font: "Montserrat", weight: 700, color: "#ffffff", accent: "#3ddc84", outline: "#000000" },
  { id: "lavender", name: "Lavender fill", font: "Poppins", weight: 700, color: "#ffffff", accent: ACCENT, outline: "#1a1024" },
  { id: "gold", name: "Gold fill", font: "Playfair Display", weight: 700, color: "#ffffff", accent: "#ffc83d", shadow: true },
  { id: "blue", name: "Blue fill", font: "Roboto", weight: 700, color: "#ffffff", accent: "#4da3ff", outline: "#000000" },
  { id: "pink", name: "Pink fill", font: "Nunito", weight: 700, color: "#ffffff", accent: "#ff6fb5", outline: "#2a0a1a" },
  { id: "red", name: "Red fill", font: "Oswald", weight: 700, upper: true, color: "#ffffff", accent: "#ff4040", outline: "#000000" },
  { id: "teal", name: "Teal fill", font: "Raleway", weight: 700, color: "#ffffff", accent: "#2fd6c0", shadow: true },
  { id: "orange", name: "Orange fill", font: "Montserrat", weight: 700, upper: true, color: "#ffffff", accent: "#ff9d2e", outline: "#000000" },
  { id: "dim", name: "Dim to bright", font: "Lato", weight: 700, color: "#9a9a9a", accent: "#ffffff", shadow: true },
  { id: "clean", name: "Clean", font: "PT Sans", weight: 700, color: "#ffffff", accent: "#ffe600", plate: "#000000" },
];

const POP: Look[] = [
  { id: "white", name: "Pop white", font: "Poppins", weight: 700, upper: true, color: "#ffffff", accent: "#ffffff", shadow: true },
  { id: "yellow", name: "Pop yellow", font: "Montserrat", weight: 700, color: "#ffffff", accent: "#ffe600", outline: "#000000" },
  { id: "lavender", name: "Pop lavender", font: "Poppins", weight: 600, color: "#ffffff", accent: ACCENT, shadow: true },
  { id: "mint", name: "Pop mint", font: "Nunito", weight: 700, color: "#ffffff", accent: "#6ee7b7", outline: "#06261c" },
  { id: "coral", name: "Pop coral", font: "Raleway", weight: 700, color: "#ffffff", accent: "#ff7a6b", shadow: true },
  { id: "bold", name: "Pop bold", font: "Oswald", weight: 700, upper: true, color: "#ffffff", accent: "#ffe600", outline: "#000000", size: 36 },
  { id: "neon", name: "Pop neon", font: "Montserrat", weight: 700, color: "#e9faff", accent: "#27d3f5", shadow: true },
  { id: "outline", name: "Pop outline", font: "Roboto", weight: 700, upper: true, color: "#ffffff", accent: "#ff3b7a", outline: "#000000" },
  { id: "soft", name: "Pop soft", font: "Open Sans", weight: 600, color: "#f6f6f6", accent: "#ffd166", shadow: true },
  { id: "serif", name: "Pop serif", font: "Merriweather", weight: 700, color: "#ffffff", accent: "#ffc83d", shadow: true },
];

const BOXED: Look[] = [
  { id: "yellow", name: "Yellow box", font: "Montserrat", weight: 700, color: "#ffffff", accent: "#ffe600", outline: "#000000" },
  { id: "lavender", name: "Lavender box", font: "Poppins", weight: 700, color: "#ffffff", accent: ACCENT, shadow: true },
  { id: "white", name: "White box", font: "Roboto", weight: 700, color: "#ffffff", accent: "#ffffff", shadow: true },
  { id: "red", name: "Red box", font: "Oswald", weight: 700, upper: true, color: "#ffffff", accent: "#e53935", shadow: true },
  { id: "green", name: "Green box", font: "Nunito", weight: 700, color: "#ffffff", accent: "#43c463", outline: "#000000" },
  { id: "blue", name: "Blue box", font: "Open Sans", weight: 700, color: "#ffffff", accent: "#2f7bff", shadow: true },
  { id: "pink", name: "Pink box", font: "Poppins", weight: 600, color: "#ffffff", accent: "#ff5fa2", shadow: true },
  { id: "plate", name: "Plate and box", font: "Montserrat", weight: 600, color: "#ffffff", accent: ACCENT, plate: "#000000" },
  { id: "orange", name: "Orange box", font: "Lato", weight: 700, color: "#ffffff", accent: "#ff8a1f", outline: "#000000" },
  { id: "teal", name: "Teal box", font: "Raleway", weight: 700, upper: true, color: "#ffffff", accent: "#14b8a6", shadow: true },
];

/** The forty, in the order the grid shows them. */
export const CAPTION_PRESETS: CaptionPreset[] = [
  ...HIGHLIGHT.map((l) => make("highlight", l)),
  ...KARAOKE.map((l) => make("karaoke", l)),
  ...POP.map((l) => make("pop", l)),
  ...BOXED.map((l) => make("boxed", l)),
];

export const CAPTION_KINDS: { kind: CaptionKind; label: string }[] = [
  { kind: "highlight", label: "Word highlight" },
  { kind: "karaoke", label: "Karaoke fill" },
  { kind: "pop", label: "Word pop" },
  { kind: "boxed", label: "Boxed word" },
];
