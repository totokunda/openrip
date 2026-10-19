// Transform presets for a video or photo, as CapCut's Basic › Transform and its timeline menu
// offer them: scale to fit, fill or stretch over the canvas, turn by 90°, and mirror. Pure
// helpers returning patches for `updateClip` (nothing here writes to what it's given).
//
// The app's transform: a box `width`×`height` world units (the canvas is BASE_LONG_SIDE = 600
// units tall), scaled by `scaleX`/`scaleY`, its top-left at (x, y), turned clockwise about
// that corner. The presets keep the box and change its scale, so the clip's keyframes and
// crop stay meaningful; the picture stays centred where it is unless a preset re-centres it.
import type { AnyClipProps, ClipFlip, ClipTransform } from "./types";
import { BASE_LONG_SIDE } from "./settings.ts";

export type ScalePreset = "fit" | "fill" | "stretch";

/** The world's size for a canvas of `aspect` (width / height). */
export const worldOf = (aspect: number) => ({ width: BASE_LONG_SIDE * aspect, height: BASE_LONG_SIDE });

const boxOf = (t: ClipTransform) => {
  const w = (t.width ?? 0) * (t.scaleX ?? 1);
  const h = (t.height ?? 0) * (t.scaleY ?? 1);
  const r = ((t.rotation ?? 0) * Math.PI) / 180;
  return { w, h, cos: Math.cos(r), sin: Math.sin(r) };
};

/** The centre of a transform's box (it turns about its top-left corner). */
export const centreOf = (t: ClipTransform): [number, number] => {
  const { w, h, cos, sin } = boxOf(t);
  return [t.x + (cos * w) / 2 - (sin * h) / 2, t.y + (sin * w) / 2 + (cos * h) / 2];
};

/** A transform with its box's centre at `centre` (its size and turn as they are). */
export const placeCentre = (t: ClipTransform, centre: [number, number]): ClipTransform => {
  const { w, h, cos, sin } = boxOf(t);
  return { ...t, x: centre[0] - ((cos * w) / 2 - (sin * h) / 2), y: centre[1] - ((sin * w) / 2 + (cos * h) / 2) };
};

/** Whether the turn is a quarter or three quarters, so the picture lies on its side. */
const sideways = (rotation: number) => Math.abs(((((rotation ?? 0) % 180) + 180) % 180) - 90) < 1e-6;

/**
 * The transform that scales the clip's picture to the canvas, centred, keeping its turn:
 * `fit` inside it (CapCut's default size), `fill` covering it, `stretch` to it exactly (the
 * picture's own proportions lost). A picture turned a quarter fits by its turned size.
 */
export const scalePreset = (t: ClipTransform, world: { width: number; height: number }, preset: ScalePreset): ClipTransform => {
  const turned = sideways(t.rotation);
  // The picture's shown size at scale 1, on screen.
  const bw = t.width || 1;
  const bh = t.height || 1;
  const [sw, sh] = turned ? [bh, bw] : [bw, bh];
  const kx = world.width / sw;
  const ky = world.height / sh;
  const k = preset === "fit" ? Math.min(kx, ky) : Math.max(kx, ky);
  // Scales along the box's own axes (swapped back when it's on its side).
  const [scaleX, scaleY] = preset === "stretch" ? (turned ? [ky, kx] : [kx, ky]) : [k, k];
  return placeCentre({ ...t, scaleX, scaleY }, [world.width / 2, world.height / 2]);
};

/** A patch applying a scale preset to a video or photo. */
export const applyScalePreset = (clip: AnyClipProps, world: { width: number; height: number }, preset: ScalePreset): Partial<AnyClipProps> =>
  (clip.type === "video" || clip.type === "image") && clip.transform ? { transform: scalePreset(clip.transform, world, preset) } : {};

/** A patch turning the clip a quarter clockwise (−90 the other way) about its centre. */
export const rotate90 = (clip: AnyClipProps, direction: 1 | -1 = 1): Partial<AnyClipProps> => {
  const t = clip.transform;
  if (!t) return {};
  const rotation = ((((t.rotation ?? 0) + 90 * direction) % 360) + 360) % 360;
  return { transform: placeCentre({ ...t, rotation: rotation > 180 ? rotation - 360 : rotation }, centreOf(t)) };
};

/** The clip's flips. */
export const flipOf = (clip: AnyClipProps): Required<ClipFlip> => {
  const f = (clip as any).flip as ClipFlip | undefined;
  return { horizontal: !!f?.horizontal, vertical: !!f?.vertical };
};

/** A patch mirroring a video, photo or sticker left to right (CapCut's Mirror) or top to bottom. */
export const toggleFlip = (clip: AnyClipProps, axis: "horizontal" | "vertical"): Partial<AnyClipProps> => {
  if (clip.type !== "video" && clip.type !== "image" && clip.type !== "sticker") return {};
  const f = flipOf(clip);
  return { flip: { ...f, [axis]: !f[axis] } } as Partial<AnyClipProps>;
};
