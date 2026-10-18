// A clip's compositing fields (lib/types.ts): its blend mode (videos, photos, texts), chroma
// key and canvas fill (videos, photos), as CapCut's Basic and Remove BG panels have them. The
// lists the panels show and pure helpers returning patches for `updateClip`; the engine draws
// them with CapCut's maths (engine/crates/v1/src/compositing.rs, docs/parity/compositing.md).
import type { AnyClipProps, BlendModeId, ChromaSlider, ClipCanvas, ClipChromaKey, TimelineProps } from "./types";
import { mainTrackOf } from "./timeline-edit.ts";

/** CapCut's Blend › Mode menu, in its order, with its names ("Default" is normal "over"). */
export const BLEND_MODES: { id: BlendModeId; name: string }[] = [
  { id: "normal", name: "Default" },
  { id: "color_dodge", name: "Color dodge" },
  { id: "linear_burn", name: "Linear burn" },
  { id: "hard_light", name: "Hard light" },
  { id: "multiply", name: "Multiply" },
  { id: "color_burn", name: "Color burn" },
  { id: "overlay", name: "Overlay" },
  { id: "lighten", name: "Brighten" },
  { id: "darken", name: "Darken" },
  { id: "soft_light", name: "Soft light" },
  { id: "screen", name: "Screen" },
];

/** Clips that can take a blend mode. */
export const canBlend = (clip: AnyClipProps) => clip.type === "video" || clip.type === "image" || clip.type === "text";

/** A patch setting the clip's blend mode. */
export const setBlendMode = (clip: AnyClipProps, mode: BlendModeId): Partial<AnyClipProps> =>
  canBlend(clip) ? ({ blendMode: mode } as Partial<AnyClipProps>) : {};

/** The chroma key's sliders with CapCut's names, 0–100. */
export const CHROMA_SLIDERS: { key: ChromaSlider; name: string }[] = [
  { key: "intensity", name: "Intensity" },
  { key: "shadow", name: "Shadow" },
  { key: "edgeSmooth", name: "Edge smoothing" },
  { key: "spill", name: "Spill" },
];

/** A new chroma key on a picked colour, its sliders at 0 (CapCut starts it so: nothing is
 * keyed until the intensity is raised). */
export const chromaKeyOf = (color: string): ClipChromaKey => ({ color, intensity: 0, shadow: 0, edgeSmooth: 0, spill: 0 });

/** A patch setting one of the key's sliders (or its colour), making the key if there's none
 * (green until a colour is picked). */
export const setChroma = (clip: AnyClipProps, key: ChromaSlider | "color", value: number | string): Partial<AnyClipProps> => {
  if (clip.type !== "video" && clip.type !== "image") return {};
  const now: ClipChromaKey = (clip as any).chroma ?? chromaKeyOf("#00ff00");
  const next = key === "color" ? { ...now, color: String(value) } : { ...now, [key]: Math.min(100, Math.max(0, Number(value))) };
  return { chroma: next } as Partial<AnyClipProps>;
};

/** A patch taking the chroma key off. */
export const clearChroma = (): Partial<AnyClipProps> => ({ chroma: null }) as Partial<AnyClipProps>;

/** The chroma key's keyframe properties. */
export const CHROMA_PROPERTIES = CHROMA_SLIDERS.map((s) => `chroma:${s.key}` as const);

/** CapCut's four canvas blur levels, from its panel. */
export const CANVAS_BLURS = [0.0625, 0.375, 0.75, 1] as const;

/** Canvas fills: none, a colour, the clip blurred, an image (CapCut's "Pattern" is an image). */
export const canvasColor = (color: string): ClipCanvas => ({ type: "color", color });
export const canvasBlur = (blur: number = CANVAS_BLURS[1]): ClipCanvas => ({ type: "blur", blur });
export const canvasImage = (image: string): ClipCanvas => ({ type: "image", image });

/** Whether the clip's canvas fill shows: only clips on the main track fill the canvas. */
export const fillsCanvas = (clip: AnyClipProps, timelines: TimelineProps[]) =>
  (clip.type === "video" || clip.type === "image") && !!clip.timelineId && mainTrackOf(timelines)?.timelineId === clip.timelineId;

/** A patch setting the clip's canvas fill (null for none). */
export const setCanvas = (clip: AnyClipProps, canvas: ClipCanvas | null): Partial<AnyClipProps> =>
  clip.type === "video" || clip.type === "image" ? ({ canvas } as Partial<AnyClipProps>) : {};

/**
 * CapCut's "Apply to all": the same canvas fill for every clip on the main track. Returns
 * `[clipId, patch]` for each clip to update.
 */
export const applyCanvasToAll = (clips: AnyClipProps[], timelines: TimelineProps[], canvas: ClipCanvas | null): [string, Partial<AnyClipProps>][] => {
  const main = mainTrackOf(timelines)?.timelineId;
  return clips.filter((c) => (c.type === "video" || c.type === "image") && c.timelineId === main).map((c) => [c.clipId, { canvas } as Partial<AnyClipProps>]);
};
