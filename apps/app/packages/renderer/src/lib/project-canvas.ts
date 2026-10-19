// The canvas choices of Project settings (the inspector's Modify), as CapCut lists them:
// Aspect ratio (Original and nine sizes), Resolution (Adapted, or Custom pixels) and the frame
// rates. A ratio is {width, height, id} as the player's Ratio menu keeps it; a custom pixel size
// is `canvasSize` in the viewport store (the engine draws at it while it has the ratio's shape).
import { useClipStore } from "./clip";
import { useViewportStore } from "./viewport";

export const ASPECT_ID_ORIGINAL = "original";

export type Ratio = { width: number; height: number; id: string };

/** CapCut's Aspect ratio list, in its order; Original follows the first picture on the timeline. */
export const PROJECT_ASPECTS: (Ratio & { label: string; landscape: boolean })[] = [
  { id: "original", label: "Original", width: 16, height: 9, landscape: true },
  { id: "16:9", label: "16:9", width: 16, height: 9, landscape: true },
  { id: "4:3", label: "4:3", width: 4, height: 3, landscape: true },
  { id: "2.35:1", label: "2.35:1", width: 2.35, height: 1, landscape: true },
  { id: "2:1", label: "2:1", width: 2, height: 1, landscape: true },
  { id: "1.85:1", label: "1.85:1", width: 1.85, height: 1, landscape: true },
  { id: "9:16", label: "9:16", width: 9, height: 16, landscape: false },
  { id: "3:4", label: "3:4", width: 3, height: 4, landscape: false },
  { id: "5.8-inch", label: "5.8-inch", width: 9, height: 19.5, landscape: false },
  { id: "1:1", label: "1:1", width: 1, height: 1, landscape: false },
];

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** `w`×`h` pixels as the smallest whole ratio, named for a preset it matches. */
export const ratioOfSize = (w: number, h: number): Ratio => {
  const g = gcd(Math.round(w), Math.round(h)) || 1;
  const [rw, rh] = [Math.round(w) / g, Math.round(h) / g];
  const preset = PROJECT_ASPECTS.find((p) => p.id !== "original" && Math.abs(p.width / p.height / (w / h) - 1) < 0.005);
  return preset ? { width: preset.width, height: preset.height, id: preset.id } : { width: rw, height: rh, id: "custom" };
};

/** The ratio of the first video or photo on the timeline (CapCut's Original), or null without one. */
export const originalRatio = (): Ratio | null => {
  const { clips, assets } = useClipStore.getState();
  const first = [...clips].filter((c) => c.type === "video" || c.type === "image").sort((a, b) => (a.startFrame ?? 0) - (b.startFrame ?? 0))[0] as any;
  if (!first) return null;
  const asset = assets[first.assetId];
  const w = first.mediaWidth ?? asset?.width;
  const h = first.mediaHeight ?? asset?.height;
  if (!w || !h) return null;
  const r = ratioOfSize(w, h);
  return { width: r.width, height: r.height, id: "original" };
};

/** The ratio an Aspect ratio choice stands for. */
export const ratioForChoice = (id: string, current: Ratio): Ratio => {
  if (id === "custom") return { ...current, id: "custom" };
  if (id === "original") return originalRatio() ?? current;
  const p = PROJECT_ASPECTS.find((a) => a.id === id);
  return p ? { width: p.width, height: p.height, id: p.id } : current;
};

/** The words for a ratio, as the inspector's Details lists it. */
export const ratioLabel = (r: Ratio) => {
  if (r.id === "custom") return `${r.width}:${r.height}`;
  return PROJECT_ASPECTS.find((a) => a.id === r.id)?.label ?? r.id;
};

/** Pixels the engine draws at for `ratio` when the resolution is Adapted: long side 1920, even sides. */
export const adaptedSize = (ratio: Ratio): { width: number; height: number } => {
  const even = (v: number) => Math.max(1, Math.round(v / 2)) * 2;
  const { width: aw, height: ah } = ratio;
  const pixels = Number.isInteger(aw) && Number.isInteger(ah) && aw >= 64 && ah >= 64 && aw <= 8192 && ah <= 8192;
  if (pixels) return { width: aw, height: ah };
  return aw >= ah ? { width: 1920, height: even((1920 * ah) / aw) } : { width: even((1920 * aw) / ah), height: 1920 };
};

/** The canvas now: the custom size when there is one, else what Adapted gives for the ratio. */
export const currentCanvasSize = () => {
  const s = useViewportStore.getState();
  return s.canvasSize ?? adaptedSize(s.aspectRatio);
};

/** Whether a size has the shape of a ratio (the engine ignores a custom size that hasn't). */
export const sizeFitsRatio = (size: { width: number; height: number }, r: Ratio) => Math.abs(size.width / size.height / (r.width / r.height) - 1) < 0.01;

/** Smallest and largest canvas side the engine takes. */
export const MIN_SIDE = 64;
export const MAX_SIDE = 8192;
