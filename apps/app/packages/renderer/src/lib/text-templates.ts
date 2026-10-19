// OpenRip's text templates for the Text tab's "Text templates" (CapCut's designed, animated
// titles: lower thirds, subscribe buttons, quotes, countdowns): each a small group of the pieces
// the app already has, made by us. A template is data: layers of text clips (with the text
// styles, glow, strokes, gradients and In/Out/Loop animations of lib/text-styles.ts and
// lib/animations.ts) and shapes (the Shapes library's, and pen paths for the icons), with
// keyframes for what moves. Only the bundled OFL fonts are used.
//
// `templateLayout` turns a template into clips, purely; `addTemplate` (lib/text-template-actions.ts)
// puts them on new tracks at the playhead, grouped, in one undo step. Everything draws through
// the engine's own text, shape, animation and keyframe paths. See docs/plan/app-engine-integration.md
// ("Text templates").
//
// Geometry is in the world units of a 16:9 canvas (1066.7 × 600), inside the template's block
// (`size`); a block is scaled to fit other canvases and placed by `place` (the middle of the
// canvas unless it says otherwise). Times are seconds from the start of the template.
import { animationOf } from "./animations.ts";
import { BASE_TEXT } from "./text-presets.ts";
import { textEffectOf } from "./text-styles.ts";
import type { AnyClipProps, Keyframe, KeyframePreset, PathPoint, ShapeClipProps, ShapeTool, TextClipProps } from "./types";

export const TEMPLATE_CATEGORIES = ["Titles", "Lower thirds", "Social", "Quotes", "Countdowns", "Labels", "Retro", "Minimal"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** A key: its time (s), its value and how it travels to the next key. */
export type TemplateKey = [t: number, value: number | number[] | string, ease?: KeyframePreset];

export type TemplateKeys = {
  /** Offsets of the box's middle from where it rests, in block units. */
  position?: TemplateKey[];
  /** A number scales both ways. */
  scale?: TemplateKey[];
  rotation?: TemplateKey[];
  opacity?: TemplateKey[];
  fontSize?: TemplateKey[];
  color?: TemplateKey[];
};

type AnimationSpec = { type: string; duration?: number; direction?: "left" | "right" | "up" | "down" };

type LayerBase = {
  /** The layer's box in the block: left, top, width, height. */
  box: [number, number, number, number];
  /** When it shows, in seconds from the template's start (the whole template when left out). */
  from?: number;
  to?: number;
  keys?: TemplateKeys;
  /** The box turned (degrees clockwise) and its opacity (0–100). */
  rotation?: number;
  opacity?: number;
};

export type TextLayer = LayerBase & {
  kind: "text";
  /** The name of the words in the Text template tab (the text's own name when left out). */
  field?: string;
  text: string;
  props?: Partial<TextClipProps>;
  /** One of OpenRip's text styles (lib/text-styles.ts). */
  style?: string;
  in?: AnimationSpec;
  out?: AnimationSpec;
  loop?: AnimationSpec;
};

export type ShapeLayer = LayerBase & {
  kind: "shape";
  shape: ShapeTool;
  props?: Partial<ShapeClipProps>;
  /** A pen path in the box (fractions of it), for the icons. */
  path?: PathPoint[];
  closed?: boolean;
  /** A rectangle's corner radius, in block units. */
  radius?: number;
};

export type TemplateLayer = TextLayer | ShapeLayer;

export interface TextTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** More words the search finds it by. */
  keywords?: string[];
  seconds: number;
  /** The block's width and height. */
  size: [number, number];
  /** Where the block sits on the canvas (the middle when left out). */
  place?: { x?: "left" | "center" | "right"; y?: "top" | "center" | "bottom" };
  /** The colour behind it in a tile's preview (a dark one when left out). */
  backdrop?: string;
  /** The layers, the first at the back. */
  layers: TemplateLayer[];
}

// ---- building blocks --------------------------------------------------------------------------

const ACCENT = "#ae81ce";
const INK = "#16141a";
const WHITE = "#ffffff";
const LIGHT = "#ece7f2";
const RED = "#ef4452";
const SANS = "Montserrat";
const DISPLAY = "Oswald";
const SERIF = "Playfair Display";

type Box = [number, number, number, number];

/** A text layer. */
const text = (words: string, box: Box, props: Partial<TextClipProps> = {}, more: Partial<Omit<TextLayer, "kind" | "text" | "box" | "props">> = {}): TextLayer => ({
  kind: "text",
  text: words,
  box,
  props: { fontFamily: SANS, fontWeight: 700, ...props },
  ...more,
});

/** A shape layer with a fill. */
const shape = (kind: ShapeTool, box: Box, fill: string, more: Partial<Omit<ShapeLayer, "kind" | "shape" | "box">> = {}): ShapeLayer => ({
  kind: "shape",
  shape: kind,
  box,
  ...more,
  props: { fill, fillOpacity: 100, fillEnabled: true, strokeEnabled: false, ...more.props },
});

const rect = (box: Box, fill: string, more: Partial<Omit<ShapeLayer, "kind" | "shape" | "box">> = {}) => shape("rectangle", box, fill, more);
const pill = (box: Box, fill: string, more: Partial<Omit<ShapeLayer, "kind" | "shape" | "box">> = {}) => shape("rectangle", box, fill, { radius: Math.min(box[2], box[3]) / 2, ...more });
const disc = (box: Box, fill: string, more: Partial<Omit<ShapeLayer, "kind" | "shape" | "box">> = {}) => shape("ellipse", box, fill, more);
/** An outline only (a ring, a frame). */
const ring = (kind: ShapeTool, box: Box, color: string, width: number, more: Partial<Omit<ShapeLayer, "kind" | "shape" | "box">> = {}): ShapeLayer => ({
  kind: "shape",
  shape: kind,
  box,
  ...more,
  props: { fillEnabled: false, strokeEnabled: true, stroke: color, strokeOpacity: 100, strokeWidth: width, ...more.props },
});
const icon = (path: PathPoint[], box: Box, fill: string, more: Partial<Omit<ShapeLayer, "kind" | "shape" | "box">> = {}): ShapeLayer => shape("path", box, fill, { path, closed: true, ...more });

const P = (x: number, y: number, inX = 0, inY = 0, outX = 0, outY = 0): PathPoint => ({ x, y, ...(inX || inY ? { inX, inY } : {}), ...(outX || outY ? { outX, outY } : {}) });

/** Our own drawn icons, in a unit box. */
const HEART: PathPoint[] = [
  P(0.5, 0.95, 0.28, -0.22, -0.28, -0.22),
  P(0.04, 0.32, 0, 0.2, 0, -0.17),
  P(0.27, 0.06, -0.12, 0, 0.12, 0),
  P(0.5, 0.28, -0.1, -0.12, 0.1, -0.12),
  P(0.73, 0.06, -0.12, 0, 0.12, 0),
  P(0.96, 0.32, 0, -0.17, 0, 0.2),
];
const BELL: PathPoint[] = [
  P(0.5, 0.04, -0.08, 0, 0.08, 0),
  P(0.82, 0.55, 0, -0.3, 0, 0.1),
  P(0.94, 0.78, 0, 0, 0, 0),
  P(0.06, 0.78, 0, 0, 0, 0),
  P(0.18, 0.55, 0, 0.1, 0, -0.3),
];
const BOOKMARK: PathPoint[] = [P(0.18, 0.04), P(0.82, 0.04), P(0.82, 0.96), P(0.5, 0.72), P(0.18, 0.96)];
const PIN: PathPoint[] = [P(0.5, 0.98, 0.18, 0.18, -0.18, -0.18), P(0.06, 0.38, 0, 0.22, 0, -0.3), P(0.5, 0.02, -0.28, 0, 0.28, 0), P(0.94, 0.38, 0, -0.3, 0, 0.22)];
const BUBBLE: PathPoint[] = [P(0.04, 0.04), P(0.96, 0.04), P(0.96, 0.72), P(0.5, 0.72), P(0.2, 0.98), P(0.24, 0.72), P(0.04, 0.72)];

/** A bar growing from its left edge (or right, or middle) between two times: its scale and offset. */
const grow = (width: number, t0: number, t1: number, from: "left" | "right" | "middle" = "left"): TemplateKeys => {
  const d = from === "left" ? -width / 2 : from === "right" ? width / 2 : 0;
  return { scale: [[t0, [0.001, 1], "easeOut"], [t1, [1, 1]]], position: [[t0, [d, 0], "easeOut"], [t1, [0, 0]]] };
};
/** A fade in, and out when `out` is given. */
const fade = (t0: number, t1: number, out?: [number, number]): TemplateKey[] => [[t0, 0, "easeOut"], [t1, 100], ...(out ? ([[out[0], 100, "easeIn"], [out[1], 0]] as TemplateKey[]) : [])];

// ---- the templates ---------------------------------------------------------------------------

const TITLES: TextTemplate[] = [
  {
    id: "bold-opener",
    name: "Bold Opener",
    category: "Titles",
    keywords: ["title", "intro", "heading"],
    seconds: 4,
    size: [760, 220],
    layers: [
      text("BIG TITLE", [0, 20, 760, 130], { fontFamily: DISPLAY, fontSize: 112, letterSpacing: 2, shadowEnabled: true, shadowColor: "#000000", shadowOpacity: 60, shadowBlur: 0, shadowOffsetX: 6, shadowOffsetY: 6 }, { in: { type: "zoom_in", duration: 0.5 }, out: { type: "fade_out", duration: 0.4 } }),
      rect([230, 168, 300, 8], ACCENT, { keys: grow(300, 0.3, 0.9, "middle") }),
      text("a subtitle goes here", [0, 180, 760, 40], { fontWeight: 500, fontSize: 24, letterSpacing: 6, textTransform: "uppercase", color: LIGHT }, { from: 0.6, in: { type: "fade_in", duration: 0.5 } }),
    ],
  },
  {
    id: "split-reveal",
    name: "Split Reveal",
    category: "Titles",
    keywords: ["two lines", "bar", "heading"],
    seconds: 4,
    size: [700, 240],
    layers: [
      text("FIRST WORD", [0, 0, 700, 100], { fontFamily: DISPLAY, fontSize: 88, textAlign: "left" }, { in: { type: "slide", duration: 0.5, direction: "left" } }),
      rect([0, 108, 700, 6], ACCENT, { keys: grow(700, 0.2, 0.8) }),
      text("SECOND WORD", [0, 122, 700, 100], { fontFamily: DISPLAY, fontSize: 88, textAlign: "right", color: ACCENT }, { from: 0.3, in: { type: "slide", duration: 0.5, direction: "right" } }),
    ],
  },
  {
    id: "spotlight",
    name: "Spotlight",
    category: "Titles",
    keywords: ["glow", "light", "heading"],
    seconds: 4,
    size: [760, 150],
    layers: [
      rect([0, 70, 90, 3], WHITE, { opacity: 80, keys: { opacity: fade(0.2, 0.7) } }),
      rect([670, 70, 90, 3], WHITE, { opacity: 80, keys: { opacity: fade(0.2, 0.7) } }),
      text("SPOTLIGHT", [100, 10, 560, 130], { fontSize: 56, letterSpacing: 3, glowEnabled: true, glowIntensity: 20, glowRange: 8, glowColor: "#ffffff" }, { in: { type: "fade_in", duration: 0.8 }, out: { type: "fade_out", duration: 0.4 } }),
    ],
  },
  {
    id: "chapter-card",
    name: "Chapter Card",
    category: "Titles",
    keywords: ["chapter", "part", "episode", "serif"],
    seconds: 4,
    size: [640, 220],
    layers: [
      text("CHAPTER 01", [0, 0, 640, 40], { fontSize: 24, letterSpacing: 6, color: ACCENT, fontWeight: 600 }, { in: { type: "fade_in", duration: 0.5 } }),
      rect([270, 58, 100, 3], WHITE, { keys: grow(100, 0.2, 0.7, "middle") }),
      text("The Beginning", [0, 76, 640, 120], { fontFamily: SERIF, fontStyle: "italic", fontWeight: 500, fontSize: 84 }, { from: 0.3, in: { type: "fade_in", duration: 0.8 } }),
    ],
  },
  {
    id: "stacked-words",
    name: "Stacked Words",
    category: "Titles",
    keywords: ["poster", "three words", "statement"],
    seconds: 4,
    size: [520, 330],
    layers: [
      text("MAKE", [0, 0, 520, 110], { fontFamily: DISPLAY, fontSize: 100, textAlign: "left" }, { in: { type: "slide", duration: 0.4, direction: "left" } }),
      text("IT", [0, 100, 520, 110], { fontFamily: DISPLAY, fontSize: 100, textAlign: "left", color: ACCENT }, { from: 0.2, in: { type: "slide", duration: 0.4, direction: "left" } }),
      text("COUNT", [0, 200, 520, 110], { fontFamily: DISPLAY, fontSize: 100, textAlign: "left" }, { from: 0.4, in: { type: "slide", duration: 0.4, direction: "left" } }),
    ],
  },
  {
    id: "outline-poster",
    name: "Outline Poster",
    category: "Titles",
    keywords: ["outline", "stroke", "hollow"],
    seconds: 4,
    size: [760, 220],
    layers: [
      text("OUTLINE", [0, 0, 760, 150], { fontFamily: DISPLAY, fontSize: 130, letterSpacing: 2, colorOpacity: 0, strokeEnabled: true, stroke: WHITE, strokeWidth: 3, strokeOpacity: 100 }, { in: { type: "zoom_in", duration: 0.6 } }),
      text("hollow letters, solid message", [0, 160, 760, 44], { fontWeight: 500, fontSize: 26, color: ACCENT }, { from: 0.5, in: { type: "fade_in", duration: 0.5 } }),
    ],
  },
  {
    id: "gradient-wave",
    name: "Gradient Wave",
    category: "Titles",
    keywords: ["sunset", "colour", "float"],
    seconds: 4,
    size: [760, 170],
    layers: [
      text("Good Vibes", [0, 0, 760, 150], { fontSize: 120, fontWeight: 700 }, { style: "sunset", in: { type: "fade_in", duration: 0.6 }, loop: { type: "float", duration: 2 } }),
    ],
  },
  {
    id: "neon-sign",
    name: "Neon Sign",
    category: "Titles",
    keywords: ["neon", "glow", "night", "bar"],
    seconds: 4,
    size: [700, 150],
    layers: [
      text("OPEN LATE", [0, 0, 700, 140], { fontFamily: DISPLAY, fontSize: 100, letterSpacing: 2, color: "#7df3ff", glowEnabled: true, glowColor: "#18c8ff", glowIntensity: 45, glowRange: 12 }, { in: { type: "fade_in", duration: 0.4 }, loop: { type: "blink", duration: 1.2 } }),
    ],
  },
];

const LOWER_THIRDS: TextTemplate[] = [
  {
    id: "clean-bar",
    name: "Clean Bar",
    category: "Lower thirds",
    keywords: ["name", "title", "speaker", "caption"],
    seconds: 5,
    size: [420, 96],
    place: { x: "left", y: "bottom" },
    layers: [
      rect([0, 0, 6, 96], ACCENT, { keys: grow(6, 0, 0.4) }),
      text("Name Surname", [22, 4, 398, 52], { fontSize: 40, textAlign: "left" }, { in: { type: "slide", duration: 0.5, direction: "left" }, out: { type: "fade_out", duration: 0.4 } }),
      text("Job title or place", [22, 56, 398, 34], { fontSize: 24, fontWeight: 500, textAlign: "left", color: LIGHT }, { from: 0.2, in: { type: "slide", duration: 0.5, direction: "left" }, out: { type: "fade_out", duration: 0.4 } }),
    ],
  },
  {
    id: "boxed-name",
    name: "Boxed Name",
    category: "Lower thirds",
    keywords: ["name", "box", "speaker"],
    seconds: 5,
    size: [440, 100],
    place: { x: "left", y: "bottom" },
    layers: [
      rect([0, 0, 440, 62], INK, { opacity: 90, keys: grow(440, 0, 0.5) }),
      rect([0, 62, 300, 38], ACCENT, { keys: grow(300, 0.2, 0.7) }),
      text("Full Name", [18, 4, 410, 54], { fontSize: 38, textAlign: "left" }, { from: 0.3, in: { type: "fade_in", duration: 0.4 } }),
      text("ROLE", [18, 64, 270, 34], { fontSize: 20, letterSpacing: 6, textAlign: "left", color: INK }, { from: 0.5, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "slide-tag",
    name: "Slide Tag",
    category: "Lower thirds",
    keywords: ["pill", "name", "tag"],
    seconds: 5,
    size: [420, 100],
    place: { x: "left", y: "bottom" },
    backdrop: "#2b2833",
    layers: [
      pill([0, 0, 360, 54], WHITE, { keys: grow(360, 0, 0.5) }),
      text("Your Name", [24, 4, 320, 46], { fontSize: 30, color: INK, textAlign: "left" }, { from: 0.3, in: { type: "fade_in", duration: 0.3 } }),
      text("what you do", [10, 62, 400, 34], { fontSize: 22, fontWeight: 500, textAlign: "left", color: LIGHT }, { from: 0.5, in: { type: "slide", duration: 0.4, direction: "left" } }),
    ],
  },
  {
    id: "underline-name",
    name: "Underline Name",
    category: "Lower thirds",
    keywords: ["line", "name", "speaker"],
    seconds: 5,
    size: [420, 90],
    place: { x: "left", y: "bottom" },
    layers: [
      text("Name Surname", [0, 0, 420, 54], { fontFamily: DISPLAY, fontSize: 50, textAlign: "left", letterSpacing: 1 }, { in: { type: "fade_in", duration: 0.4 }, out: { type: "fade_out", duration: 0.4 } }),
      rect([0, 58, 400, 4], ACCENT, { keys: grow(400, 0.1, 0.7) }),
      text("subtitle here", [0, 62, 420, 28], { fontSize: 20, fontWeight: 500, textAlign: "left", color: LIGHT, letterSpacing: 3 }, { from: 0.5, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "corner-card",
    name: "Corner Card",
    category: "Lower thirds",
    keywords: ["card", "place", "location"],
    seconds: 5,
    size: [360, 110],
    place: { x: "left", y: "bottom" },
    layers: [
      rect([0, 0, 360, 110], INK, { radius: 14, opacity: 92, keys: { opacity: fade(0, 0.4), scale: [[0, [0.9, 0.9], "easeOut"], [0.4, [1, 1]]] } }),
      disc([20, 22, 14, 14], ACCENT, { keys: { opacity: fade(0.3, 0.6) } }),
      text("Place or topic", [44, 12, 300, 34], { fontSize: 26, textAlign: "left" }, { from: 0.3, in: { type: "fade_in", duration: 0.4 } }),
      text("One line of detail goes here", [20, 52, 330, 48], { fontSize: 20, fontWeight: 400, textAlign: "left", color: LIGHT, verticalAlign: "top" }, { from: 0.5, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "news-strip",
    name: "News Strip",
    category: "Lower thirds",
    keywords: ["headline", "breaking", "news", "ticker"],
    seconds: 6,
    size: [960, 74],
    place: { x: "center", y: "bottom" },
    layers: [
      rect([0, 0, 960, 74], INK, { opacity: 92, keys: grow(960, 0, 0.5) }),
      rect([0, 0, 170, 74], ACCENT, { keys: grow(170, 0.2, 0.6) }),
      text("LIVE", [0, 6, 170, 62], { fontFamily: DISPLAY, fontSize: 38, letterSpacing: 4, color: INK }, { from: 0.4, in: { type: "fade_in", duration: 0.3 } }),
      text("Headline of the story goes here", [190, 6, 750, 62], { fontSize: 32, textAlign: "left", fontWeight: 600 }, { from: 0.5, in: { type: "slide", duration: 0.5, direction: "right" } }),
    ],
  },
  {
    id: "soft-glass",
    name: "Soft Glass",
    category: "Lower thirds",
    keywords: ["glass", "card", "rounded", "name"],
    seconds: 5,
    size: [420, 104],
    place: { x: "left", y: "bottom" },
    layers: [
      rect([0, 0, 420, 104], WHITE, { radius: 22, opacity: 22, keys: { opacity: [[0, 0, "easeOut"], [0.5, 22]], position: [[0, [0, 24], "easeOut"], [0.5, [0, 0]]] } }),
      text("Soft Name", [26, 8, 370, 52], { fontSize: 36, textAlign: "left" }, { from: 0.2, in: { type: "fade_in", duration: 0.5 } }),
      text("quiet little subtitle", [26, 58, 370, 36], { fontSize: 22, fontWeight: 400, textAlign: "left", color: LIGHT }, { from: 0.4, in: { type: "fade_in", duration: 0.5 } }),
    ],
  },
];

const SOCIAL: TextTemplate[] = [
  {
    id: "subscribe-button",
    name: "Subscribe Button",
    category: "Social",
    keywords: ["subscribe", "youtube", "channel", "bell", "follow"],
    seconds: 4,
    size: [380, 100],
    place: { x: "right", y: "bottom" },
    layers: [
      pill([0, 10, 300, 80], RED, { keys: { scale: [[0, [0.6, 0.6], "easeOut"], [0.35, [1.06, 1.06], "easeInOut"], [0.55, [1, 1]]], opacity: fade(0, 0.25) } }),
      shape("triangle", [28, 30, 36, 40], WHITE, { rotation: 90, keys: { opacity: fade(0.3, 0.5) } }),
      text("SUBSCRIBE", [70, 18, 226, 64], { fontSize: 28, letterSpacing: 1 }, { from: 0.3, in: { type: "fade_in", duration: 0.3 } }),
      icon(BELL, [310, 18, 62, 66], "#ffc233", { keys: { opacity: fade(0.7, 0.9), rotation: [[0.9, 0], [1.1, 18], [1.3, -18], [1.5, 14], [1.7, -14], [1.9, 0]] } }),
    ],
  },
  {
    id: "like-heart",
    name: "Like Heart",
    category: "Social",
    keywords: ["like", "love", "heart", "react"],
    seconds: 3,
    size: [260, 110],
    place: { x: "right", y: "center" },
    layers: [
      icon(HEART, [0, 0, 100, 92], RED, { keys: { scale: [[0, [0.2, 0.2], "easeOut"], [0.35, [1.25, 1.25], "easeInOut"], [0.55, [1, 1], "easeInOut"], [1.2, [1.12, 1.12], "easeInOut"], [1.6, [1, 1]]] } }),
      text("Like", [116, 12, 144, 70], { fontSize: 56, textAlign: "left" }, { from: 0.3, in: { type: "slide", duration: 0.4, direction: "left" } }),
    ],
  },
  {
    id: "follow-me",
    name: "Follow Me",
    category: "Social",
    keywords: ["follow", "username", "handle", "profile"],
    seconds: 4,
    size: [430, 92],
    place: { x: "center", y: "bottom" },
    layers: [
      disc([0, 6, 80, 80], ACCENT, { keys: { scale: [[0, [0.2, 0.2], "easeOut"], [0.35, [1, 1]]] } }),
      text("@", [0, 6, 80, 80], { fontSize: 48, color: INK }, { from: 0.2, in: { type: "fade_in", duration: 0.3 } }),
      text("username", [96, 6, 220, 46], { fontSize: 34, textAlign: "left" }, { from: 0.3, in: { type: "slide", duration: 0.4, direction: "left" } }),
      text("Follow for more", [96, 50, 220, 34], { fontSize: 20, fontWeight: 400, textAlign: "left", color: LIGHT }, { from: 0.5, in: { type: "fade_in", duration: 0.4 } }),
      pill([322, 22, 108, 48], WHITE, { keys: { opacity: fade(0.6, 0.8) } }),
      text("FOLLOW", [322, 24, 108, 44], { fontSize: 18, letterSpacing: 2, color: INK }, { from: 0.6, in: { type: "fade_in", duration: 0.2 } }),
    ],
  },
  {
    id: "share-it",
    name: "Share It",
    category: "Social",
    keywords: ["share", "send", "arrow"],
    seconds: 3,
    size: [300, 100],
    place: { x: "right", y: "center" },
    layers: [
      pill([0, 8, 300, 84], ACCENT, { keys: { opacity: fade(0, 0.3), scale: [[0, [0.8, 0.8], "easeOut"], [0.3, [1, 1]]] } }),
      shape("arrow", [24, 30, 70, 40], INK, { props: { stroke: INK, strokeWidth: 8, strokeEnabled: true, fillEnabled: false }, keys: { position: [[0.2, [-14, 0], "easeOut"], [0.6, [0, 0]]], opacity: fade(0.2, 0.4) } }),
      text("SHARE", [104, 16, 180, 68], { fontSize: 38, letterSpacing: 3, color: INK }, { from: 0.3, in: { type: "fade_in", duration: 0.3 } }),
    ],
  },
  {
    id: "comment-bubble",
    name: "Comment Bubble",
    category: "Social",
    keywords: ["comment", "reply", "speech", "chat"],
    seconds: 4,
    size: [420, 130],
    place: { x: "left", y: "center" },
    layers: [
      icon(BUBBLE, [0, 0, 420, 130], WHITE, { keys: { scale: [[0, [0.5, 0.5], "easeOut"], [0.4, [1, 1]]], opacity: fade(0, 0.2) } }),
      text("Tell me what you think", [20, 6, 380, 74], { fontSize: 30, color: INK }, { from: 0.3, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "support-row",
    name: "Support Row",
    category: "Social",
    keywords: ["like", "save", "share", "icons", "call to action"],
    seconds: 4,
    size: [460, 96],
    place: { x: "center", y: "bottom" },
    layers: [
      icon(HEART, [0, 12, 70, 64], RED, { keys: { scale: [[0, [0.2, 0.2], "easeOut"], [0.3, [1, 1]]] } }),
      text("Like", [0, 74, 70, 22], { fontSize: 16, fontWeight: 600 }, { from: 0.2, in: { type: "fade_in", duration: 0.3 } }),
      icon(BOOKMARK, [195, 12, 52, 64], WHITE, { keys: { scale: [[0.2, [0.2, 0.2], "easeOut"], [0.5, [1, 1]]], opacity: fade(0.2, 0.3) } }),
      text("Save", [186, 74, 70, 22], { fontSize: 16, fontWeight: 600 }, { from: 0.4, in: { type: "fade_in", duration: 0.3 } }),
      shape("arrow", [372, 28, 80, 32], ACCENT, { props: { stroke: ACCENT, strokeWidth: 8, strokeEnabled: true, fillEnabled: false }, keys: { scale: [[0.4, [0.2, 0.2], "easeOut"], [0.7, [1, 1]]], opacity: fade(0.4, 0.5) } }),
      text("Share", [376, 74, 76, 22], { fontSize: 16, fontWeight: 600 }, { from: 0.6, in: { type: "fade_in", duration: 0.3 } }),
    ],
  },
  {
    id: "notify-bell",
    name: "Notify Bell",
    category: "Social",
    keywords: ["notification", "bell", "alert", "turn on"],
    seconds: 4,
    size: [440, 100],
    place: { x: "center", y: "top" },
    layers: [
      pill([0, 0, 440, 100], INK, { opacity: 92, keys: { position: [[0, [0, -40], "easeOut"], [0.4, [0, 0]]], opacity: fade(0, 0.3) } }),
      icon(BELL, [24, 20, 58, 60], "#ffc233", { keys: { rotation: [[0.5, 0], [0.7, 16], [0.9, -16], [1.1, 12], [1.3, -12], [1.5, 0]], opacity: fade(0.3, 0.5) } }),
      text("Turn on notifications", [98, 14, 330, 72], { fontSize: 28, textAlign: "left" }, { from: 0.4, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "link-in-bio",
    name: "Link in Bio",
    category: "Social",
    keywords: ["link", "bio", "arrow", "up", "website"],
    seconds: 4,
    size: [320, 150],
    place: { x: "center", y: "bottom" },
    layers: [
      text("LINK IN BIO", [0, 0, 320, 60], { fontSize: 34, letterSpacing: 3 }, { in: { type: "zoom_in", duration: 0.4 } }),
      shape("arrow", [110, 70, 100, 70], ACCENT, { rotation: 90, props: { stroke: ACCENT, strokeWidth: 10, strokeEnabled: true, fillEnabled: false }, keys: { position: [[0.3, [0, -6]], [0.7, [0, 8], "easeInOut"], [1.1, [0, -6], "easeInOut"], [1.5, [0, 8], "easeInOut"], [1.9, [0, -6], "easeInOut"], [2.3, [0, 8], "easeInOut"]], opacity: fade(0.3, 0.5) } }),
    ],
  },
];

const QUOTES: TextTemplate[] = [
  {
    id: "big-quote-marks",
    name: "Big Quote Marks",
    category: "Quotes",
    keywords: ["quote", "testimonial", "saying"],
    seconds: 5,
    size: [700, 300],
    layers: [
      text("“", [0, 0, 140, 160], { fontFamily: SERIF, fontSize: 240, color: ACCENT, textAlign: "left", verticalAlign: "top" }, { in: { type: "zoom_in", duration: 0.5 } }),
      text("A quote worth\nremembering goes here", [30, 80, 640, 150], { fontFamily: SERIF, fontStyle: "italic", fontWeight: 500, fontSize: 52, textAlign: "left", lineSpacing: 0 }, { from: 0.3, in: { type: "fade_in", duration: 0.7 } }),
      text("— AUTHOR NAME", [30, 245, 640, 36], { fontSize: 22, letterSpacing: 6, textAlign: "left", color: ACCENT }, { from: 1, in: { type: "fade_in", duration: 0.5 } }),
    ],
  },
  {
    id: "serif-pull",
    name: "Serif Pull Quote",
    category: "Quotes",
    keywords: ["quote", "elegant", "italic"],
    seconds: 5,
    size: [760, 220],
    layers: [
      rect([330, 0, 100, 3], ACCENT, { keys: grow(100, 0, 0.5, "middle") }),
      text("The best way out is always through.", [0, 24, 760, 130], { fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: 54 }, { from: 0.2, in: { type: "fade_in", duration: 0.8 } }),
      text("Author Name", [0, 166, 760, 40], { fontSize: 24, fontWeight: 500, letterSpacing: 4, color: LIGHT }, { from: 0.9, in: { type: "fade_in", duration: 0.5 } }),
    ],
  },
  {
    id: "boxed-quote",
    name: "Boxed Quote",
    category: "Quotes",
    keywords: ["quote", "card", "bar"],
    seconds: 5,
    size: [620, 190],
    layers: [
      rect([0, 0, 620, 190], INK, { opacity: 88, keys: { opacity: [[0, 0, "easeOut"], [0.4, 88]] } }),
      rect([0, 0, 8, 190], ACCENT, { keys: grow(8, 0, 0.5) }),
      text("Say it once, say it clearly, and let it land.", [36, 14, 560, 110], { fontSize: 36, fontWeight: 600, textAlign: "left", verticalAlign: "top" }, { from: 0.3, in: { type: "fade_in", duration: 0.6 } }),
      text("— Someone Wise", [36, 140, 560, 34], { fontSize: 22, fontWeight: 400, textAlign: "left", color: ACCENT }, { from: 0.8, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "quiet-quote",
    name: "Quiet Quote",
    category: "Quotes",
    keywords: ["quote", "minimal", "small caps"],
    seconds: 5,
    size: [700, 160],
    layers: [
      text("less noise, more signal", [0, 0, 700, 90], { fontFamily: "Raleway", fontWeight: 500, fontSize: 58, letterSpacing: 2 }, { in: { type: "fade_in", duration: 1 }, out: { type: "fade_out", duration: 0.6 } }),
      text("AUTHOR NAME", [0, 104, 700, 30], { fontFamily: "Raleway", fontWeight: 600, fontSize: 20, letterSpacing: 8, color: ACCENT }, { from: 0.8, in: { type: "fade_in", duration: 0.6 } }),
    ],
  },
  {
    id: "speech-pill",
    name: "Speech Pill",
    category: "Quotes",
    keywords: ["quote", "bubble", "speech", "chat"],
    seconds: 4,
    size: [560, 130],
    layers: [
      icon(BUBBLE, [0, 0, 560, 130], ACCENT, { keys: { scale: [[0, [0.4, 0.4], "easeOut"], [0.4, [1.04, 1.04], "easeInOut"], [0.6, [1, 1]]], opacity: fade(0, 0.2) } }),
      text("Words in a bubble", [20, 4, 520, 82], { fontSize: 38, color: INK }, { from: 0.3, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "typed-quote",
    name: "Typed Quote",
    category: "Quotes",
    keywords: ["quote", "typewriter", "typing", "type"],
    seconds: 5,
    size: [700, 140],
    layers: [
      text("Typed one letter at a time.", [0, 0, 700, 70], { fontFamily: "Roboto", fontWeight: 500, fontSize: 46 }, { in: { type: "typewriter", duration: 1.6 } }),
      rect([270, 80, 160, 3], ACCENT, { keys: grow(160, 1.2, 1.8, "middle") }),
      text("a typing effect quote", [0, 96, 700, 36], { fontFamily: "Roboto", fontWeight: 400, fontSize: 22, color: ACCENT, letterSpacing: 4 }, { from: 1.6, in: { type: "fade_in", duration: 0.5 } }),
    ],
  },
];

const COUNTDOWNS: TextTemplate[] = [
  {
    id: "countdown-321",
    name: "Countdown 3 2 1",
    category: "Countdowns",
    keywords: ["countdown", "321", "timer", "numbers", "start"],
    seconds: 3,
    size: [300, 300],
    layers: [
      ring("ellipse", [0, 0, 300, 300], ACCENT, 6, { opacity: 90 }),
      text("3", [0, 20, 300, 260], { fontFamily: DISPLAY, fontSize: 220 }, { from: 0, to: 1, in: { type: "zoom_in", duration: 0.3 } }),
      text("2", [0, 20, 300, 260], { fontFamily: DISPLAY, fontSize: 220 }, { from: 1, to: 2, in: { type: "zoom_in", duration: 0.3 } }),
      text("1", [0, 20, 300, 260], { fontFamily: DISPLAY, fontSize: 220, color: ACCENT }, { from: 2, to: 3, in: { type: "zoom_in", duration: 0.3 } }),
    ],
  },
  {
    id: "big-stat",
    name: "Big Stat",
    category: "Countdowns",
    keywords: ["number", "statistic", "percent", "stat", "data"],
    seconds: 5,
    size: [500, 250],
    layers: [
      text("98%", [0, 0, 500, 170], { fontFamily: DISPLAY, fontSize: 170 }, { style: "sunset", in: { type: "zoom_in", duration: 0.6 } }),
      rect([190, 176, 120, 4], ACCENT, { keys: grow(120, 0.3, 0.8, "middle") }),
      text("of people agree", [0, 192, 500, 44], { fontSize: 28, fontWeight: 500, color: LIGHT }, { from: 0.6, in: { type: "fade_in", duration: 0.5 } }),
    ],
  },
  {
    id: "step-number",
    name: "Step Number",
    category: "Countdowns",
    keywords: ["step", "number", "list", "01", "tip"],
    seconds: 4,
    size: [520, 130],
    place: { x: "left", y: "center" },
    layers: [
      text("01", [0, 0, 150, 130], { fontFamily: DISPLAY, fontSize: 120, color: ACCENT, textAlign: "left" }, { in: { type: "slide", duration: 0.4, direction: "left" } }),
      rect([160, 20, 4, 90], WHITE, { opacity: 70, keys: grow(4, 0.2, 0.6) }),
      text("First step title", [184, 20, 336, 50], { fontSize: 34, textAlign: "left" }, { from: 0.3, in: { type: "fade_in", duration: 0.4 } }),
      text("what happens in this step", [184, 70, 336, 40], { fontSize: 22, fontWeight: 400, textAlign: "left", color: LIGHT }, { from: 0.5, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "timer-ring",
    name: "Timer Ring",
    category: "Countdowns",
    keywords: ["timer", "ring", "circle", "clock", "seconds"],
    seconds: 4,
    size: [260, 260],
    layers: [
      disc([0, 0, 260, 260], INK, { opacity: 80 }),
      ring("ellipse", [10, 10, 240, 240], ACCENT, 10, { keys: { rotation: [[0, 0], [4, 360]] } }),
      text("10", [0, 50, 260, 120], { fontFamily: DISPLAY, fontSize: 110 }, { in: { type: "zoom_in", duration: 0.4 } }),
      text("SECONDS", [0, 168, 260, 36], { fontSize: 18, letterSpacing: 6, color: ACCENT }, { from: 0.3, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "day-counter",
    name: "Day Counter",
    category: "Countdowns",
    keywords: ["day", "counter", "journey", "diary", "number"],
    seconds: 4,
    size: [320, 150],
    place: { x: "left", y: "top" },
    layers: [
      text("DAY", [0, 0, 220, 60], { fontFamily: DISPLAY, fontSize: 40, letterSpacing: 10, textAlign: "left", color: ACCENT }, { in: { type: "fade_in", duration: 0.4 } }),
      text("12", [0, 40, 320, 100], { fontFamily: DISPLAY, fontSize: 100, textAlign: "left" }, { from: 0.2, in: { type: "slide", duration: 0.4, direction: "up" } }),
      rect([0, 144, 300, 4], WHITE, { opacity: 80, keys: grow(300, 0.4, 1) }),
    ],
  },
  {
    id: "score-card",
    name: "Score Card",
    category: "Countdowns",
    keywords: ["score", "match", "game", "vs", "sport"],
    seconds: 5,
    size: [560, 110],
    place: { x: "center", y: "top" },
    layers: [
      rect([0, 0, 560, 110], INK, { radius: 16, opacity: 92, keys: { scale: [[0, [0.7, 0.7], "easeOut"], [0.4, [1, 1]]], opacity: fade(0, 0.3) } }),
      text("HOME", [16, 14, 160, 80], { fontSize: 30, letterSpacing: 3 }, { from: 0.3, in: { type: "fade_in", duration: 0.3 } }),
      text("2 : 1", [180, 6, 200, 98], { fontFamily: DISPLAY, fontSize: 80, color: ACCENT }, { from: 0.4, in: { type: "zoom_in", duration: 0.3 } }),
      text("AWAY", [384, 14, 160, 80], { fontSize: 30, letterSpacing: 3 }, { from: 0.3, in: { type: "fade_in", duration: 0.3 } }),
    ],
  },
  {
    id: "rank-badge",
    name: "Rank Badge",
    category: "Countdowns",
    keywords: ["top", "rank", "number one", "best", "list", "star"],
    seconds: 4,
    size: [400, 150],
    place: { x: "left", y: "top" },
    layers: [
      shape("star", [0, 0, 140, 140], "#ffc233", { keys: { rotation: [[0, -40, "easeOut"], [0.6, 0]], scale: [[0, [0.1, 0.1], "easeOut"], [0.5, [1, 1]]] } }),
      text("#1", [0, 38, 140, 70], { fontFamily: DISPLAY, fontSize: 60, color: INK }, { from: 0.4, in: { type: "zoom_in", duration: 0.3 } }),
      text("Best pick", [156, 40, 244, 70], { fontSize: 38, textAlign: "left" }, { from: 0.5, in: { type: "slide", duration: 0.4, direction: "left" } }),
    ],
  },
];

const LABELS: TextTemplate[] = [
  {
    id: "price-tag",
    name: "Price Tag",
    category: "Labels",
    keywords: ["price", "cost", "sale", "dollar", "tag"],
    seconds: 4,
    size: [280, 110],
    place: { x: "right", y: "center" },
    layers: [
      shape("parallelogram", [0, 0, 280, 110], ACCENT, { keys: { position: [[0, [60, 0], "easeOut"], [0.4, [0, 0]]], opacity: fade(0, 0.3) } }),
      text("$19", [30, 6, 220, 98], { fontFamily: DISPLAY, fontSize: 84, color: INK }, { from: 0.3, in: { type: "zoom_in", duration: 0.3 } }),
    ],
  },
  {
    id: "new-burst",
    name: "New Burst",
    category: "Labels",
    keywords: ["new", "badge", "star", "burst", "launch"],
    seconds: 4,
    size: [210, 210],
    place: { x: "right", y: "top" },
    layers: [
      shape("star", [0, 0, 210, 210], "#ffc233", { props: { points: 12 } as Partial<ShapeClipProps>, keys: { rotation: [[0, 0], [4, 90]], scale: [[0, [0.1, 0.1], "easeOut"], [0.5, [1, 1]]] } }),
      text("NEW", [0, 66, 210, 80], { fontFamily: DISPLAY, fontSize: 64, color: INK, letterSpacing: 2 }, { from: 0.3, in: { type: "zoom_in", duration: 0.3 } }),
    ],
  },
  {
    id: "sale-sticker",
    name: "Sale Sticker",
    category: "Labels",
    keywords: ["sale", "discount", "off", "offer", "percent"],
    seconds: 4,
    size: [230, 230],
    place: { x: "right", y: "center" },
    layers: [
      disc([0, 0, 230, 230], RED, { keys: { scale: [[0, [0.1, 0.1], "easeOut"], [0.35, [1.1, 1.1], "easeInOut"], [0.55, [1, 1]]], rotation: [[0, -20, "easeOut"], [0.5, -8]] } }),
      text("SALE", [0, 36, 230, 64], { fontFamily: DISPLAY, fontSize: 56, letterSpacing: 4 }, { rotation: -8, from: 0.3, in: { type: "fade_in", duration: 0.3 } }),
      text("50% OFF", [0, 100, 230, 70], { fontFamily: DISPLAY, fontSize: 52, color: "#ffe08a" }, { rotation: -8, from: 0.4, in: { type: "fade_in", duration: 0.3 } }),
    ],
  },
  {
    id: "location-pin",
    name: "Location Pin",
    category: "Labels",
    keywords: ["location", "place", "map", "city", "travel"],
    seconds: 4,
    size: [400, 90],
    place: { x: "left", y: "top" },
    layers: [
      icon(PIN, [0, 6, 50, 76], ACCENT, { keys: { position: [[0, [0, -30], "easeOut"], [0.3, [0, 0], "easeIn"], [0.45, [0, -8], "easeOut"], [0.6, [0, 0]]], opacity: fade(0, 0.2) } }),
      disc([16, 24, 18, 18], INK, { keys: { opacity: fade(0.3, 0.4) } }),
      text("City, Country", [66, 8, 330, 52], { fontSize: 38, textAlign: "left" }, { from: 0.3, in: { type: "slide", duration: 0.4, direction: "left" } }),
      text("what a place", [66, 56, 330, 28], { fontSize: 20, fontWeight: 400, textAlign: "left", color: LIGHT, letterSpacing: 2 }, { from: 0.5, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "hashtag-pill",
    name: "Hashtag Pill",
    category: "Labels",
    keywords: ["hashtag", "tag", "trending", "topic"],
    seconds: 4,
    size: [330, 76],
    layers: [
      pill([0, 0, 330, 76], ACCENT, { keys: grow(330, 0, 0.5, "middle") }),
      text("#trending", [10, 4, 310, 66], { fontSize: 36, color: INK }, { from: 0.3, in: { type: "fade_in", duration: 0.3 } }),
    ],
  },
  {
    id: "arrow-callout",
    name: "Arrow Callout",
    category: "Labels",
    keywords: ["arrow", "callout", "point", "look here", "highlight"],
    seconds: 4,
    size: [420, 120],
    layers: [
      shape("arrow", [0, 40, 130, 50], "#ffc233", { props: { stroke: "#ffc233", strokeWidth: 10, strokeEnabled: true, fillEnabled: false }, keys: { position: [[0.1, [-20, 0], "easeOut"], [0.5, [0, 0]], [0.9, [14, 0], "easeInOut"], [1.3, [0, 0], "easeInOut"], [1.7, [14, 0], "easeInOut"], [2.1, [0, 0], "easeInOut"]], opacity: fade(0.1, 0.3) } }),
      text("Look here", [150, 20, 270, 90], { fontSize: 50, textAlign: "left" }, { from: 0.3, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "breaking-tag",
    name: "Breaking Tag",
    category: "Labels",
    keywords: ["breaking", "alert", "news", "urgent", "live"],
    seconds: 4,
    size: [420, 78],
    place: { x: "left", y: "top" },
    layers: [
      rect([0, 0, 420, 78], RED, { keys: grow(420, 0, 0.35) }),
      disc([22, 28, 22, 22], WHITE, { keys: { opacity: [[0.3, 0], [0.5, 100], [0.9, 100], [1.0, 20], [1.4, 100], [1.5, 20], [1.9, 100]] } }),
      text("BREAKING", [56, 6, 354, 66], { fontFamily: DISPLAY, fontSize: 46, letterSpacing: 3, textAlign: "left" }, { from: 0.3, in: { type: "fade_in", duration: 0.3 } }),
    ],
  },
];

const RETRO: TextTemplate[] = [
  {
    id: "retro-wave",
    name: "Retro Wave",
    category: "Retro",
    keywords: ["80s", "synthwave", "sunset", "vaporwave", "retro"],
    seconds: 4,
    size: [700, 220],
    backdrop: "#241046",
    layers: [
      text("RETRO WAVE", [0, 0, 700, 150], { fontFamily: DISPLAY, fontSize: 110, letterSpacing: 2 }, { style: "retro", in: { type: "zoom_in", duration: 0.5 } }),
      rect([60, 160, 580, 4], "#ff4e9a", { keys: grow(580, 0.3, 0.9, "middle") }),
      rect([140, 176, 420, 4], "#38e8ff", { keys: grow(420, 0.4, 1, "middle") }),
    ],
  },
  {
    id: "arcade-start",
    name: "Arcade Start",
    category: "Retro",
    keywords: ["arcade", "game", "pixel", "insert coin", "player"],
    seconds: 4,
    size: [600, 200],
    backdrop: "#0f1b2d",
    layers: [
      text("PLAYER 1", [0, 0, 600, 80], { fontFamily: DISPLAY, fontSize: 70, letterSpacing: 8, color: "#ffe14d" }, { in: { type: "slide", duration: 0.4, direction: "left" } }),
      text("INSERT COIN", [0, 100, 600, 60], { fontFamily: DISPLAY, fontSize: 44, letterSpacing: 10, color: "#38e8ff" }, { from: 0.4, loop: { type: "blink", duration: 1 } }),
    ],
  },
  {
    id: "tape-play",
    name: "Tape Play",
    category: "Retro",
    keywords: ["vhs", "camcorder", "rec", "play", "tape", "timestamp"],
    seconds: 5,
    size: [420, 100],
    place: { x: "left", y: "top" },
    layers: [
      shape("triangle", [4, 10, 30, 34], WHITE, { rotation: 90 }),
      text("PLAY", [44, 4, 160, 48], { fontFamily: DISPLAY, fontSize: 40, letterSpacing: 4, textAlign: "left" }, { in: { type: "fade_in", duration: 0.2 } }),
      disc([300, 16, 20, 20], RED, { keys: { opacity: [[0, 100], [0.5, 100], [0.6, 0], [1.1, 0], [1.2, 100], [1.7, 100], [1.8, 0], [2.3, 0], [2.4, 100]] } }),
      text("REC", [330, 4, 90, 44], { fontFamily: DISPLAY, fontSize: 36, letterSpacing: 3, textAlign: "left", color: RED }),
      text("JAN 01 1999", [0, 56, 420, 40], { fontFamily: "Roboto", fontWeight: 500, fontSize: 28, letterSpacing: 4, textAlign: "left", color: "#ffd84d" }),
    ],
  },
  {
    id: "diner-sign",
    name: "Diner Sign",
    category: "Retro",
    keywords: ["diner", "sign", "vintage", "pop", "serif"],
    seconds: 4,
    size: [640, 180],
    backdrop: "#2a1418",
    layers: [
      text("Diner Open", [0, 0, 640, 140], { fontFamily: SERIF, fontStyle: "italic", fontSize: 112, color: "#ff5c39" }, { style: "pop", in: { type: "zoom_in", duration: 0.5 }, loop: { type: "pulse", duration: 1.6 } }),
    ],
  },
  {
    id: "groovy-stripes",
    name: "Groovy Stripes",
    category: "Retro",
    keywords: ["70s", "stripes", "groovy", "rainbow", "retro"],
    seconds: 4,
    size: [640, 220],
    backdrop: "#2f2118",
    layers: [
      rect([0, 150, 640, 14], "#e8573c", { keys: grow(640, 0.1, 0.7) }),
      rect([0, 168, 640, 14], "#f5a623", { keys: grow(640, 0.2, 0.8) }),
      rect([0, 186, 640, 14], "#f7d154", { keys: grow(640, 0.3, 0.9) }),
      text("GROOVY", [0, 0, 640, 140], { fontFamily: SERIF, fontWeight: 700, fontSize: 118, color: "#f7d154" }, { in: { type: "slide", duration: 0.5, direction: "right" } }),
    ],
  },
  {
    id: "film-slate",
    name: "Film Slate",
    category: "Retro",
    keywords: ["clapper", "slate", "scene", "take", "movie", "film"],
    seconds: 4,
    size: [480, 200],
    layers: [
      rect([0, 0, 480, 44], WHITE, { keys: { rotation: [[0, -12, "easeOut"], [0.3, 0, "easeIn"], [0.4, -3, "easeOut"], [0.5, 0]] } }),
      rect([0, 52, 480, 148], INK, { props: { stroke: WHITE, strokeWidth: 4, strokeEnabled: true } }),
      text("SCENE 1", [20, 62, 220, 60], { fontFamily: DISPLAY, fontSize: 44, textAlign: "left", letterSpacing: 3 }, { from: 0.4, in: { type: "fade_in", duration: 0.2 } }),
      text("TAKE 1", [250, 62, 220, 60], { fontFamily: DISPLAY, fontSize: 44, textAlign: "right", letterSpacing: 3 }, { from: 0.5, in: { type: "fade_in", duration: 0.2 } }),
      text("DIRECTOR NAME", [20, 130, 440, 50], { fontFamily: DISPLAY, fontSize: 30, textAlign: "left", letterSpacing: 6, color: ACCENT }, { from: 0.6, in: { type: "fade_in", duration: 0.2 } }),
    ],
  },
];

const MINIMAL: TextTemplate[] = [
  {
    id: "thin-line-title",
    name: "Thin Line Title",
    category: "Minimal",
    keywords: ["thin", "spaced", "elegant", "title", "clean"],
    seconds: 4,
    size: [760, 80],
    layers: [
      rect([0, 39, 150, 1], WHITE, { keys: grow(150, 0, 0.6, "right") }),
      rect([610, 39, 150, 1], WHITE, { keys: grow(150, 0, 0.6, "left") }),
      text("QUIET TITLE", [160, 10, 440, 60], { fontFamily: "Raleway", fontWeight: 500, fontSize: 36, letterSpacing: 6 }, { from: 0.2, in: { type: "fade_in", duration: 0.7 } }),
    ],
  },
  {
    id: "small-caption",
    name: "Small Caption",
    category: "Minimal",
    keywords: ["caption", "note", "dot", "label", "tiny"],
    seconds: 4,
    size: [360, 40],
    place: { x: "left", y: "bottom" },
    layers: [
      disc([0, 13, 14, 14], ACCENT, { keys: { scale: [[0, [0.1, 0.1], "easeOut"], [0.3, [1, 1]]] } }),
      text("A small note about this shot", [26, 4, 334, 32], { fontSize: 22, fontWeight: 500, textAlign: "left" }, { from: 0.2, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "counter-mark",
    name: "Counter Mark",
    category: "Minimal",
    keywords: ["number", "index", "01", "page", "corner"],
    seconds: 4,
    size: [200, 60],
    place: { x: "right", y: "top" },
    layers: [
      text("01", [0, 0, 80, 60], { fontFamily: "Raleway", fontWeight: 700, fontSize: 40, textAlign: "right" }, { in: { type: "fade_in", duration: 0.4 } }),
      rect([92, 12, 2, 36], WHITE, { opacity: 70, rotation: 20 }),
      text("10", [108, 8, 92, 50], { fontFamily: "Raleway", fontWeight: 400, fontSize: 28, textAlign: "left", color: LIGHT }, { from: 0.2, in: { type: "fade_in", duration: 0.4 } }),
    ],
  },
  {
    id: "single-word",
    name: "Single Word",
    category: "Minimal",
    keywords: ["word", "one word", "fade", "lowercase"],
    seconds: 3,
    size: [600, 140],
    layers: [
      text("breathe", [0, 0, 600, 130], { fontFamily: "Raleway", fontWeight: 400, fontSize: 112, letterSpacing: 4 }, { in: { type: "fade_in", duration: 1 }, out: { type: "fade_out", duration: 0.7 }, loop: { type: "pulse", duration: 2 } }),
    ],
  },
  {
    id: "cursor-line",
    name: "Cursor Line",
    category: "Minimal",
    keywords: ["cursor", "underscore", "terminal", "typing", "blink"],
    seconds: 4,
    size: [520, 90],
    layers: [
      text("hello_", [0, 0, 520, 80], { fontFamily: "Roboto", fontWeight: 500, fontSize: 70, textAlign: "left" }, { in: { type: "typewriter", duration: 1 } }),
    ],
  },
  {
    id: "bracket-frame",
    name: "Bracket Frame",
    category: "Minimal",
    keywords: ["frame", "brackets", "corners", "viewfinder"],
    seconds: 4,
    size: [520, 200],
    layers: [
      rect([0, 0, 50, 4], WHITE, { keys: grow(50, 0, 0.4) }),
      rect([0, 0, 4, 50], WHITE, { keys: { scale: [[0, [1, 0.001], "easeOut"], [0.4, [1, 1]]], position: [[0, [0, -25], "easeOut"], [0.4, [0, 0]]] } }),
      rect([470, 196, 50, 4], WHITE, { keys: grow(50, 0, 0.4, "right") }),
      rect([516, 150, 4, 50], WHITE, { keys: { scale: [[0, [1, 0.001], "easeOut"], [0.4, [1, 1]]], position: [[0, [0, 25], "easeOut"], [0.4, [0, 0]]] } }),
      text("FRAME THE MOMENT", [30, 60, 460, 80], { fontFamily: "Raleway", fontWeight: 600, fontSize: 40, letterSpacing: 8 }, { from: 0.3, in: { type: "fade_in", duration: 0.6 } }),
    ],
  },
];

export const TEXT_TEMPLATES: TextTemplate[] = [...TITLES, ...LOWER_THIRDS, ...SOCIAL, ...QUOTES, ...COUNTDOWNS, ...LABELS, ...RETRO, ...MINIMAL];

/** A template by id. */
export const textTemplate = (id: string): TextTemplate | undefined => TEXT_TEMPLATES.find((t) => t.id === id);

/** The templates in a category, or all of them. */
export const templatesIn = (category: TemplateCategory | "All"): TextTemplate[] => (category === "All" ? TEXT_TEMPLATES : TEXT_TEMPLATES.filter((t) => t.category === category));

/** Whether a template matches a search: every word is in its name, category or keywords. */
export const templateMatches = (t: TextTemplate, query: string): boolean => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [t.name, t.category, ...(t.keywords ?? []), ...t.layers.filter((l): l is TextLayer => l.kind === "text").map((l) => l.text)].join(" ").toLowerCase();
  return terms.every((w) => hay.includes(w));
};

// ---- clips ------------------------------------------------------------------------------------

/** The canvas a template is laid out for. */
export const DESIGN_CANVAS = { width: 1066.6666666666667, height: 600 };
/** Where a template sits from the edge of the canvas it's placed against. */
const MARGIN = 56;

type Canvas = { width: number; height: number };

/** How a template's block is scaled and where it sits on `canvas` (world units). */
export const templatePlacement = (t: TextTemplate, canvas: Canvas) => {
  const k = Math.min(canvas.width / DESIGN_CANVAS.width, canvas.height / DESIGN_CANVAS.height);
  const [w, h] = [t.size[0] * k, t.size[1] * k];
  const m = MARGIN * k;
  const x = t.place?.x === "left" ? m : t.place?.x === "right" ? canvas.width - m - w : (canvas.width - w) / 2;
  const y = t.place?.y === "top" ? m : t.place?.y === "bottom" ? canvas.height - m - h : (canvas.height - h) / 2;
  return { k, x, y, width: w, height: h };
};

/** One layer as a clip, before it has a track. */
export type TemplateClip = { clip: AnyClipProps; layer: TemplateLayer };

export type LayoutOptions = {
  fps: number;
  canvas: Canvas;
  startFrame: number;
  /** A new id for each clip, with the track it goes on. */
  ids: () => { clipId: string; timelineId: string };
};

const frames = (seconds: number, fps: number) => Math.round(seconds * fps);

/** A layer's keys as the clip's keyframes, in the clip's own frames and the world's units. */
const keyframesOf = (layer: TemplateLayer, rest: { cx: number; cy: number }, k: number, fps: number, from: number): AnyClipProps["keyframes"] => {
  const out: NonNullable<AnyClipProps["keyframes"]> = {};
  const at = (t: number) => Math.max(0, frames(t - from, fps));
  const make = (list: TemplateKey[], value: (v: TemplateKey[1]) => Keyframe["value"]): Keyframe[] =>
    list
      .map(([t, v, ease]) => ({ frame: at(t), value: value(v), ...(ease ? { ease } : {}) }) as Keyframe)
      .sort((a, b) => a.frame - b.frame)
      // Two keys at a frame would be one; keep the later.
      .filter((key, i, all) => i === all.length - 1 || all[i + 1].frame !== key.frame);
  const keyed = layer.keys ?? {};
  if (keyed.position) out.position = make(keyed.position, (v) => [rest.cx + (v as number[])[0] * k, rest.cy + (v as number[])[1] * k]);
  if (keyed.scale) out.scale = make(keyed.scale, (v) => (Array.isArray(v) ? [v[0], v[1]] : [v as number, v as number]));
  if (keyed.rotation) out.rotation = make(keyed.rotation, (v) => (layer.rotation ?? 0) + (v as number));
  if (keyed.opacity) out.opacity = make(keyed.opacity, (v) => ((layer.opacity ?? 100) * (v as number)) / 100);
  if (keyed.fontSize) out.fontSize = make(keyed.fontSize, (v) => (v as number) * k);
  if (keyed.color) out.color = make(keyed.color, (v) => v as string);
  return out;
};

/** The sizes in a text's look that follow the canvas. */
const scaledText = (props: Partial<TextClipProps>, k: number): Partial<TextClipProps> => {
  const out: Partial<TextClipProps> = { ...props };
  if (out.fontSize != null) out.fontSize *= k;
  if (out.strokeWidth != null) out.strokeWidth *= k;
  if (out.shadowBlur != null) out.shadowBlur *= k;
  if (out.shadowOffsetX != null) out.shadowOffsetX *= k;
  if (out.shadowOffsetY != null) out.shadowOffsetY *= k;
  if (out.backgroundCornerRadius != null) out.backgroundCornerRadius *= k;
  if (out.moreStrokes) out.moreStrokes = out.moreStrokes.map((s) => ({ ...s, width: s.width * k }));
  return out;
};

/**
 * A template's clips for a canvas (world units), at `startFrame`: the layers in order, the first
 * at the back, each with a new id and track from `ids`. Pure: the caller puts them in the stores.
 */
export const templateLayout = (t: TextTemplate, opts: LayoutOptions): TemplateClip[] => {
  const { k, x, y } = templatePlacement(t, opts.canvas);
  const fps = opts.fps || 24;
  return t.layers.map((layer) => {
    const { clipId, timelineId } = opts.ids();
    const [bx, by, bw, bh] = layer.box;
    const from = layer.from ?? 0;
    const to = Math.min(layer.to ?? t.seconds, t.seconds);
    const startFrame = opts.startFrame + frames(from, fps);
    const endFrame = Math.max(startFrame + 1, opts.startFrame + frames(to, fps));
    const transform = { x: x + bx * k, y: y + by * k, width: bw * k, height: bh * k, scaleX: 1, scaleY: 1, rotation: layer.rotation ?? 0, cornerRadius: 0, opacity: layer.opacity ?? 100 };
    const rest = { cx: transform.x + transform.width / 2, cy: transform.y + transform.height / 2 };
    const common = { clipId, timelineId, startFrame, endFrame, trimEnd: -Infinity, trimStart: Infinity, transform };
    const keyframes = layer.keys ? keyframesOf(layer, rest, k, fps, from) : undefined;
    if (layer.kind === "text") {
      const props = { ...BASE_TEXT, ...JSON.parse(JSON.stringify(layer.props ?? {})) } as Partial<TextClipProps>;
      const clip = { ...scaledText(props, k), ...common, type: "text", text: layer.text } as TextClipProps;
      if (layer.field) clip.templateField = layer.field;
      if (layer.style) clip.textEffect = textEffectOf(layer.style);
      const seconds = (endFrame - startFrame) / fps;
      for (const [kind, spec, field] of [["in", layer.in, "animationIn"], ["out", layer.out, "animationOut"], ["loop", layer.loop, "animationLoop"]] as const) {
        if (!spec) continue;
        const made = animationOf(clip, kind, spec.type, { duration: Math.min(spec.duration ?? 0.5, seconds), fps, params: spec.direction ? { direction: spec.direction } : undefined });
        if (made) (clip as any)[field] = made;
      }
      if (keyframes) clip.keyframes = keyframes;
      return { clip, layer };
    }
    const line = layer.shape === "line" || layer.shape === "arrow";
    const p = layer.props ?? {};
    const clip = {
      ...common,
      type: "shape",
      shapeType: layer.shape,
      fill: "#ffffff",
      fillOpacity: 100,
      strokeOpacity: 100,
      strokeStyle: "solid",
      shadowEnabled: false,
      ...p,
      ...(p.strokeWidth != null ? { strokeWidth: p.strokeWidth * k } : {}),
      transform: { ...transform, cornerRadius: (layer.radius ?? 0) * k },
    } as ShapeClipProps;
    if (line) {
      clip.path = [P(0, 0.5), P(1, 0.5)];
      clip.capStart = "none";
      clip.capEnd = layer.shape === "arrow" ? "arrow" : "none";
    }
    if (layer.path) {
      clip.path = layer.path.map((q) => ({ ...q }));
      clip.pathClosed = layer.closed ?? false;
      clip.capStart = "none";
      clip.capEnd = "none";
    }
    if (layer.shape === "star") (clip as any).points = (p as any).points ?? 5;
    if (keyframes) clip.keyframes = keyframes;
    return { clip, layer };
  });
};

/** The words of a template that can be edited: its text layers with their names, in order. */
export const templateFields = (t: TextTemplate): { index: number; label: string; text: string }[] =>
  t.layers.flatMap((l, index) => (l.kind === "text" ? [{ index, label: l.field ?? "", text: l.text }] : [])).map((f, n, all) => ({ ...f, label: f.label || (all.length > 1 ? `Text ${n + 1}` : "Text") }));
