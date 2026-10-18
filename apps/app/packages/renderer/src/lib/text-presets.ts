// OpenRip's text presets for the Text tab's "Add text" (CapCut's default text and its preset
// styles): each a text clip's look (font, size, colours, outline, shadow, background, glow, an
// Effects style from lib/text-styles.ts) and optionally an In animation (lib/animations.ts),
// made by us. The first eight are the app styles the shell's Text tab started with.
//
// `presetTextClip` makes the clip, purely; `addPresetText` adds it at the playhead on a new
// track (one undo step) and opens its Text tab, loading the stores only when called. See
// docs/plan/app-engine-integration.md ("Text styles and captions").
import { animationOf } from "./animations.ts";
import { textEffectOf } from "./text-styles.ts";
import type { TextClipProps } from "./types";

export interface TextPreset {
  id: string;
  name: string;
  /** A group for the grid. */
  category?: "Basic" | "Title" | "Caption" | "Style";
  props: Partial<TextClipProps>;
  /** An In animation (a built-in's type) and its duration (s), made for the clip as it's added. */
  animationIn?: { type: string; duration?: number };
}

/** The text the canvas's Text tool starts with; the presets change some of it. */
export const BASE_TEXT: Partial<TextClipProps> = {
  text: "Default Text",
  fontSize: 32,
  fontWeight: 400,
  fontStyle: "normal",
  fontFamily: "Arial",
  color: "#ffffff",
  colorOpacity: 100,
  textAlign: "center",
  verticalAlign: "middle",
  textTransform: "none",
  textDecoration: "none",
  strokeEnabled: false,
  stroke: "#000000",
  strokeWidth: 2,
  strokeOpacity: 100,
  shadowEnabled: false,
  shadowColor: "#000000",
  shadowOpacity: 75,
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  shadowOffsetLocked: true,
};

export const TEXT_PRESETS: TextPreset[] = [
  // The shell's eight.
  { id: "plain", name: "Plain", category: "Basic", props: {} },
  { id: "title", name: "Title", category: "Title", props: { text: "Title", fontSize: 56, fontWeight: 700, fontFamily: "Helvetica" } },
  { id: "outline", name: "Outline", category: "Basic", props: { text: "Outline", fontSize: 44, fontWeight: 700, strokeEnabled: true, strokeWidth: 4 } },
  { id: "shadow", name: "Shadow", category: "Basic", props: { text: "Shadow", fontSize: 40, fontWeight: 700, shadowEnabled: true, shadowBlur: 8, shadowOffsetX: 3, shadowOffsetY: 3 } },
  {
    id: "label",
    name: "Label",
    category: "Basic",
    props: { text: "Label", fontSize: 30, fontWeight: 700, color: "#111111", backgroundEnabled: true, backgroundColor: "#ffffff", backgroundOpacity: 100, backgroundCornerRadius: 8 },
  },
  { id: "serif", name: "Serif", category: "Title", props: { text: "Serif", fontSize: 44, fontStyle: "italic", fontFamily: "Georgia" } },
  { id: "caps", name: "Caps", category: "Title", props: { text: "Caps", fontSize: 40, fontWeight: 700, textTransform: "uppercase", fontFamily: "Impact" } },
  { id: "yellow", name: "Yellow", category: "Caption", props: { text: "Yellow", fontSize: 44, fontWeight: 700, color: "#ffd84d", strokeEnabled: true, stroke: "#000000", strokeWidth: 3 } },
  // OpenRip's own looks.
  {
    id: "caption",
    name: "Caption",
    category: "Caption",
    props: { text: "Caption", fontSize: 36, fontWeight: 700, strokeEnabled: true, stroke: "#000000", strokeWidth: 3, shadowEnabled: true, shadowOpacity: 50, shadowBlur: 6, shadowOffsetX: 0, shadowOffsetY: 2 },
  },
  {
    id: "caption_box",
    name: "Boxed Caption",
    category: "Caption",
    props: { text: "Caption", fontSize: 34, fontWeight: 700, backgroundEnabled: true, backgroundColor: "#000000", backgroundOpacity: 70, backgroundCornerRadius: 6 },
  },
  { id: "spaced", name: "Spaced", category: "Title", props: { text: "SPACED", fontSize: 40, fontWeight: 700, letterSpacing: 8, fontFamily: "Helvetica" } },
  { id: "glow", name: "Glow", category: "Style", props: { text: "Glow", fontSize: 52, fontWeight: 700, glowEnabled: true, glowIntensity: 30, glowRange: 20 } },
  { id: "neon", name: "Neon", category: "Style", props: { text: "Neon", fontSize: 56, fontWeight: 700, color: "#38e8ff", textEffect: textEffectOf("neon") } },
  { id: "sunset", name: "Sunset", category: "Style", props: { text: "Sunset", fontSize: 56, fontWeight: 700, fontFamily: "Impact", textEffect: textEffectOf("sunset") } },
  { id: "metal", name: "Metal", category: "Style", props: { text: "Metal", fontSize: 56, fontWeight: 700, fontFamily: "Impact", textEffect: textEffectOf("metal") } },
  { id: "pop", name: "Pop", category: "Style", props: { text: "POP!", fontSize: 60, fontWeight: 700, fontFamily: "Impact", textEffect: textEffectOf("pop") }, animationIn: { type: "zoom_in", duration: 0.4 } },
  { id: "sticker", name: "Sticker", category: "Style", props: { text: "Sticker", fontSize: 52, fontWeight: 700, color: "#ff5c39", textEffect: textEffectOf("sticker") } },
  { id: "retro", name: "Retro", category: "Style", props: { text: "Retro", fontSize: 56, fontWeight: 700, fontFamily: "Georgia", textEffect: textEffectOf("retro") } },
  { id: "typewriter", name: "Typewriter", category: "Basic", props: { text: "Typewriter", fontSize: 36, fontFamily: "Courier New" }, animationIn: { type: "typewriter", duration: 1 } },
];

/** A preset by id. */
export const textPreset = (id: string): TextPreset | undefined => TEXT_PRESETS.find((p) => p.id === id);

/**
 * A text clip in `preset`'s look, `seconds` long from `startFrame` (ending before
 * `totalFrames` when given), its box centred on a canvas of `canvas` world units (the preview's
 * world: BASE_LONG_SIDE tall). Ids and the track are the caller's.
 */
export const presetTextClip = (
  preset: TextPreset,
  opts: { clipId: string; timelineId: string; startFrame: number; fps: number; canvas: { width: number; height: number }; seconds?: number; totalFrames?: number },
): TextClipProps => {
  const props = { ...BASE_TEXT, ...JSON.parse(JSON.stringify(preset.props)) } as Partial<TextClipProps>;
  const fontSize = props.fontSize ?? 32;
  const width = Math.min(opts.canvas.width * 0.8, Math.max(160, fontSize * 7));
  const height = fontSize * 1.6;
  const fps = opts.fps || 24;
  const end = opts.startFrame + Math.max(1, Math.round((opts.seconds ?? 3) * fps));
  const clip: TextClipProps = {
    ...(props as TextClipProps),
    clipId: opts.clipId,
    type: "text",
    timelineId: opts.timelineId,
    startFrame: opts.startFrame,
    endFrame: opts.totalFrames != null ? Math.min(end, Math.max(opts.startFrame + 1, opts.totalFrames - 1)) : end,
    trimEnd: -Infinity,
    trimStart: Infinity,
    transform: {
      x: (opts.canvas.width - width) / 2,
      y: (opts.canvas.height - height) / 2,
      width,
      height,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      cornerRadius: 0,
      opacity: 100,
    },
  };
  if (preset.animationIn) clip.animationIn = animationOf(clip, "in", preset.animationIn.type, { duration: preset.animationIn.duration, fps });
  return clip;
};

/**
 * Add a text in `preset`'s look at the playhead (3 s, centred, on a new track at the top),
 * select it and show its Text tab: the Text tab's Add text. The stores are loaded when it's
 * called, so the rest of this file stays pure (its tests run without them).
 */
export const addPresetText = async (preset: TextPreset) => {
  const [{ v4: uuidv4 }, { useClipStore }, { useControlsStore }, { useViewportStore }, { useInspectorStore }, { BASE_LONG_SIDE }] = await Promise.all([
    import("uuid"),
    import("./clip"),
    import("./control"),
    import("./viewport"),
    import("./inspector"),
    import("./settings"),
  ]);
  const { addTimeline, addClip } = useClipStore.getState();
  const controls = useControlsStore.getState();
  const { aspectRatio } = useViewportStore.getState();
  // The canvas in world units, as the preview lays it out (BASE_LONG_SIDE tall).
  const ratio = aspectRatio.width / aspectRatio.height;
  const canvas = { width: BASE_LONG_SIDE * (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9), height: BASE_LONG_SIDE };
  const timelineId = uuidv4();
  addTimeline({ timelineId, type: "text", timelineY: 0, timelineHeight: 40, timelineWidth: 0, muted: false, hidden: false }, -1);
  const clip = presetTextClip(preset, { clipId: uuidv4(), timelineId, startFrame: controls.focusFrame, fps: controls.fps || 24, canvas, totalFrames: controls.totalTimelineFrames });
  addClip(clip);
  controls.setSelectedClipIds([clip.clipId]);
  useInspectorStore.getState().setTab("text", "basic");
};
