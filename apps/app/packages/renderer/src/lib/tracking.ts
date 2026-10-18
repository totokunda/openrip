// Motion tracking (the Tracking tab and the Mask tab's Track mask), the parts that don't
// touch a store: where a video's picture sits on the canvas, a region drawn on the canvas as
// fractions of the video's own picture (what the engine tracks, engine/crates/core/src/track.rs),
// and the engine's result turned into keyframes on a text, sticker or photo, or a mask's poses.
//
// The engine follows the region through the video's real frames; every timeline frame where
// the tracked clip and the video overlap then gets the region's place, size and turn at the
// source time that frame shows (through the video's speed, curve or reverse, and its own
// keyframed transform), and the clip follows it as CapCut's options say: Scale and Distance
// "follow tracking object", plus Rotation. Keys between which the motion is close enough to a
// straight line are left out, so the timeline shows a few keys rather than one a frame.
import type { AnyClipProps, ClipKeyframes, ClipTransform, Keyframe, MaskClipProps, MaskData, TrackDirection, TrackingSettings, VideoClipProps, WorldRegion } from "./types";
import { listKeyframes, setKeyframe, valueAt } from "./keyframes.ts";
import { sourceTimeAt } from "./speed.ts";

export type { TrackDirection, TrackingSettings, WorldRegion } from "./types";

export const DEFAULT_TRACKING: TrackingSettings = { enabled: true, mode: "none", direction: "both", scale: true, distance: true, rotation: false };

/** One frame of the engine's result: the region on the video's upright picture (fractions). */
export interface TrackSample {
  timeUs: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  confidence: number;
}

/** Where a video's picture is on the canvas at a frame: its box's centre, size and turn, the
 * part of the picture it shows, and its mirrors. */
export interface Placement {
  centre: [number, number];
  size: [number, number];
  rotation: number;
  crop: { x: number; y: number; width: number; height: number };
  flipH: boolean;
  flipV: boolean;
}

const pair = (v: unknown, fallback: [number, number]): [number, number] =>
  Array.isArray(v) ? [Number(v[0]), Number(v[1] ?? v[0])] : typeof v === "number" ? [v, v] : fallback;

const turn = ([x, y]: [number, number], degrees: number): [number, number] => {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c * x - s * y, s * x + c * y];
};

/** The clip's box (its transform, keyframed position, scale and turn) at a timeline frame. */
export const placementAt = (clip: AnyClipProps, frame: number, fps: number): Placement | null => {
  const t: ClipTransform | undefined = clip.transform;
  if (!t || !(t.width > 0) || !(t.height > 0)) return null;
  const [sx, sy] = pair(valueAt(clip, "scale", frame, fps), [t.scaleX ?? 1, t.scaleY ?? 1]);
  const centre = pair(valueAt(clip, "position", frame, fps), [t.x, t.y]);
  const rotation = Number(valueAt(clip, "rotation", frame, fps) ?? t.rotation ?? 0);
  const flip = (clip as VideoClipProps).flip;
  return {
    centre,
    size: [t.width * Math.abs(sx), t.height * Math.abs(sy)],
    rotation,
    crop: t.crop ?? { x: 0, y: 0, width: 1, height: 1 },
    flipH: !!flip?.horizontal !== sx < 0,
    flipV: !!flip?.vertical !== sy < 0,
  };
};

/** A point of the video's upright picture (fractions) on the canvas. */
export const sourceToWorld = (p: Placement, u: number, v: number): [number, number] => {
  let a = (u - p.crop.x) / (p.crop.width || 1);
  let b = (v - p.crop.y) / (p.crop.height || 1);
  if (p.flipH) a = 1 - a;
  if (p.flipV) b = 1 - b;
  const [x, y] = turn([(a - 0.5) * p.size[0], (b - 0.5) * p.size[1]], p.rotation);
  return [p.centre[0] + x, p.centre[1] + y];
};

/** A canvas point as fractions of the video's upright picture. */
export const worldToSource = (p: Placement, x: number, y: number): [number, number] => {
  const [lx, ly] = turn([x - p.centre[0], y - p.centre[1]], -p.rotation);
  let a = lx / p.size[0] + 0.5;
  let b = ly / p.size[1] + 0.5;
  if (p.flipH) a = 1 - a;
  if (p.flipV) b = 1 - b;
  return [p.crop.x + a * (p.crop.width || 1), p.crop.y + b * (p.crop.height || 1)];
};

/** A region drawn on the canvas, on the video's upright picture (what the engine takes). */
export const regionToSource = (p: Placement, r: WorldRegion) => {
  const [centerX, centerY] = worldToSource(p, r.cx, r.cy);
  const mirrored = p.flipH !== p.flipV;
  return {
    centerX,
    centerY,
    width: (r.width / p.size[0]) * (p.crop.width || 1),
    height: (r.height / p.size[1]) * (p.crop.height || 1),
    rotation: (mirrored ? -1 : 1) * (r.rotation - p.rotation),
  };
};

/** Whether a canvas point lies on the video's box. */
export const placementContains = (p: Placement, x: number, y: number): boolean => {
  const [lx, ly] = turn([x - p.centre[0], y - p.centre[1]], -p.rotation);
  return Math.abs(lx) <= p.size[0] / 2 && Math.abs(ly) <= p.size[1] / 2;
};

const within = (clip: AnyClipProps, frame: number) => frame >= (clip.startFrame ?? 0) && frame < (clip.endFrame ?? 0);

/**
 * The video a clip tracks: of the videos showing at `frame` under the clip (on tracks below
 * its own; the timeline lists tracks top first), the topmost whose picture is under `point`,
 * else the topmost. A video's own masks track the video itself.
 */
export const videoUnder = (
  clips: AnyClipProps[],
  trackOrder: string[],
  target: AnyClipProps,
  frame: number,
  fps: number,
  point?: [number, number],
): VideoClipProps | undefined => {
  if (target.type === "video") return target as VideoClipProps;
  const row = (c: AnyClipProps) => {
    const i = trackOrder.indexOf(c.timelineId ?? "");
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const own = row(target);
  const below = clips
    .filter((c): c is VideoClipProps => c.type === "video" && c.clipId !== target.clipId && within(c, frame) && !(c as VideoClipProps).freeze && row(c) > own)
    .sort((a, b) => row(a) - row(b));
  if (point) {
    const hit = below.find((v) => {
      const p = placementAt(v, frame, fps);
      return p ? placementContains(p, point[0], point[1]) : false;
    });
    if (hit) return hit;
  }
  return below[0];
};

/** The video's source time (µs) shown at timeline frame `frame`. */
export const sourceUsAt = (video: VideoClipProps, frame: number, fps: number, mediaSeconds?: number): number =>
  Math.round(sourceTimeAt(video, frame - (video.startFrame ?? 0), fps, mediaSeconds) * 1e6);

/** The timeline frames (whole) where both clips show. */
export const overlapFrames = (a: AnyClipProps, b: AnyClipProps): [number, number] | null => {
  const from = Math.max(a.startFrame ?? 0, b.startFrame ?? 0);
  const to = Math.min(a.endFrame ?? 0, b.endFrame ?? 0);
  return to > from ? [from, to] : null;
};

/** The engine's request for tracking `region` (canvas) on `video` from timeline frame `frame`,
 * over the frames `[from, to)`. Null when the video isn't on the canvas there. */
export const trackRequest = (video: VideoClipProps, region: WorldRegion, frame: number, range: [number, number], fps: number, path: string, mediaSeconds: number | undefined, direction: TrackDirection) => {
  const p = placementAt(video, frame, fps);
  if (!p) return null;
  const r = regionToSource(p, region);
  const times = [sourceUsAt(video, range[0], fps, mediaSeconds), sourceUsAt(video, Math.max(range[0], range[1] - 1), fps, mediaSeconds)];
  const at = sourceUsAt(video, frame, fps, mediaSeconds);
  // A frame's length past the last one, so it's tracked too.
  const pad = Math.round(1e6 / fps);
  return { path, atUs: at, fromUs: Math.max(0, Math.min(...times) - pad), toUs: Math.max(...times) + pad, ...r, direction };
};

/** The region (fractions of the picture) at source time `us`, between the samples around it;
 * null outside the tracked span. */
export const sampleAt = (samples: TrackSample[], us: number): TrackSample | null => {
  if (samples.length === 0) return null;
  const half = 1000;
  if (us < samples[0].timeUs - half || us > samples[samples.length - 1].timeUs + 40_000) return null;
  let i = samples.findIndex((s) => s.timeUs > us);
  if (i < 0) return samples[samples.length - 1];
  if (i === 0) return samples[0];
  const [a, b] = [samples[i - 1], samples[i]];
  const k = (us - a.timeUs) / Math.max(1, b.timeUs - a.timeUs);
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    timeUs: us,
    centerX: mix(a.centerX, b.centerX),
    centerY: mix(a.centerY, b.centerY),
    width: mix(a.width, b.width),
    height: mix(a.height, b.height),
    rotation: mix(a.rotation, b.rotation),
    scale: mix(a.scale, b.scale),
    confidence: Math.min(a.confidence, b.confidence),
  };
};

/** The tracked object on the canvas at a timeline frame: its centre, turn (degrees) and scale. */
interface ObjectPose {
  frame: number;
  centre: [number, number];
  rotation: number;
  scale: number;
}

/** The tracked object's pose at each timeline frame of `[from, to)` it was tracked for. */
export const objectPoses = (video: VideoClipProps, samples: TrackSample[], range: [number, number], fps: number, mediaSeconds?: number): ObjectPose[] => {
  const out: ObjectPose[] = [];
  for (let f = range[0]; f < range[1]; f++) {
    const s = sampleAt(samples, sourceUsAt(video, f, fps, mediaSeconds));
    const p = placementAt(video, f, fps);
    if (!s || !p) continue;
    const mirrored = p.flipH !== p.flipV;
    out.push({ frame: f, centre: sourceToWorld(p, s.centerX, s.centerY), rotation: p.rotation + (mirrored ? -1 : 1) * s.rotation, scale: s.scale });
  }
  return out;
};

/** A point of keyed values for thinning. */
interface Point {
  frame: number;
  values: number[];
}

/**
 * The points worth keeping as keys (Ramer–Douglas–Peucker): the ends, and every point the
 * straight line between its neighbours kept misses by more than `tolerance` (per value).
 */
export const thin = (points: Point[], tolerance: number[]): Point[] => {
  if (points.length <= 2) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const k = (points[i].frame - points[a].frame) / Math.max(1e-9, points[b].frame - points[a].frame);
      const miss = Math.max(...points[i].values.map((v, c) => Math.abs(v - (points[a].values[c] + (points[b].values[c] - points[a].values[c]) * k)) / tolerance[c]));
      if (miss > worst) {
        worst = miss;
        at = i;
      }
    }
    if (worst > 1 && at > 0) {
      keep[at] = true;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
};

/** World units of a key's position error left out, scale and degrees. */
const POSITION_TOLERANCE = 0.25;
const SCALE_TOLERANCE = 0.002;
const ROTATION_TOLERANCE = 0.2;

/** A sticker drawn from a CapCut draft: where its segment places it (the app has no transform
 * for it), in the app's units: centre in world units, scale 1, turn in degrees. */
const draftPlacement = (clip: AnyClipProps, world: { width: number; height: number }): { centre: [number, number]; rotation: number } | null => {
  const tr = (clip as any)?.engine?.segment?.transform;
  if (!tr) return null;
  const p = tr.position?.value ?? { x: 0, y: 0 };
  return { centre: [((Number(p.x) + 1) / 2) * world.width, ((1 - Number(p.y)) / 2) * world.height], rotation: Number(tr.rotation?.value ?? 0) };
};

/** The clip's own position, scale and turn at a timeline frame (its keys', else its fields'). */
export const clipPoseAt = (clip: AnyClipProps, frame: number, fps: number, world: { width: number; height: number }) => {
  const keyed = (prop: "position" | "scale" | "rotation") => listKeyframes(clip.keyframes, prop).length > 0;
  const draft = clip.transform ? null : draftPlacement(clip, world);
  const at = (prop: "position" | "scale" | "rotation") => valueAt(clip, prop, frame, fps);
  return {
    centre: keyed("position") || !draft ? pair(at("position"), [world.width / 2, world.height / 2]) : draft.centre,
    scale: keyed("scale") || !draft ? pair(at("scale"), [1, 1]) : ([1, 1] as [number, number]),
    rotation: keyed("rotation") || !draft ? Number(at("rotation") ?? 0) : draft.rotation,
  };
};

/**
 * The keys a clip gets from a track: position (and scale and rotation as `settings` follow
 * them) at each timeline frame of `poses`, the clip keeping its place relative to the object
 * where the region was drawn (`frame`). Replaces those properties' keys; the others stay.
 */
export const trackedKeys = (clip: AnyClipProps, poses: ObjectPose[], frame: number, settings: Pick<TrackingSettings, "scale" | "distance" | "rotation">, fps: number, world: { width: number; height: number }): ClipKeyframes => {
  let keyframes: ClipKeyframes = { ...(clip.keyframes ?? {}) };
  if (poses.length === 0) return keyframes;
  const start = poses.reduce((best, p) => (Math.abs(p.frame - frame) < Math.abs(best.frame - frame) ? p : best), poses[0]);
  const own = clipPoseAt(clip, start.frame, fps, world);
  const offset: [number, number] = [own.centre[0] - start.centre[0], own.centre[1] - start.centre[1]];
  const local = (f: number) => f - (clip.startFrame ?? 0);
  const length = (clip.endFrame ?? 0) - (clip.startFrame ?? 0);
  const inside = poses.filter((p) => local(p.frame) >= 0 && local(p.frame) <= length);
  const position: Point[] = [];
  const scale: Point[] = [];
  const rotation: Point[] = [];
  for (const p of inside) {
    const k = p.scale / (start.scale || 1);
    const spin = p.rotation - start.rotation;
    let o: [number, number] = settings.distance ? [offset[0] * k, offset[1] * k] : offset;
    if (settings.rotation) o = turn(o, spin);
    position.push({ frame: local(p.frame), values: [p.centre[0] + o[0], p.centre[1] + o[1]] });
    scale.push({ frame: local(p.frame), values: [own.scale[0] * k, own.scale[1] * k] });
    rotation.push({ frame: local(p.frame), values: [own.rotation + spin] });
  }
  const write = (prop: "position" | "scale" | "rotation", points: Point[], tolerance: number[]) => {
    const kept = thin(points, tolerance);
    const next: ClipKeyframes = { ...keyframes };
    delete next[prop];
    keyframes = kept.reduce((kf, pt) => setKeyframe(kf, prop, pt.frame, pt.values.length === 1 ? pt.values[0] : pt.values, "linear"), next);
  };
  write("position", position, [POSITION_TOLERANCE, POSITION_TOLERANCE]);
  if (settings.scale) write("scale", scale, [SCALE_TOLERANCE, SCALE_TOLERANCE]);
  if (settings.rotation) write("rotation", rotation, [ROTATION_TOLERANCE]);
  return keyframes;
};

/** Without the keys a track wrote (position, and scale and rotation if it followed them). */
export const withoutTrackedKeys = (clip: AnyClipProps, settings?: Pick<TrackingSettings, "scale" | "rotation">): ClipKeyframes => {
  const next: ClipKeyframes = { ...(clip.keyframes ?? {}) };
  delete next.position;
  if (settings?.scale) delete next.scale;
  if (settings?.rotation) delete next.rotation;
  return next;
};

// ---- masks ------------------------------------------------------------------------------------

type MaskKeyframes = Map<number, MaskData> | Record<number, MaskData>;

const maskEntries = (keyframes: MaskKeyframes): [number, MaskData][] =>
  (keyframes instanceof Map ? Array.from(keyframes.entries()) : Object.entries(keyframes).map(([k, v]) => [Number(k), v] as [number, MaskData])).sort((a, b) => a[0] - b[0]);

/** A mask's keyframe frame for a timeline frame (as the app keeps them: from the clip's
 * in-point, lib/clip.ts `getLocalFrame`). */
const maskFrame = (clip: AnyClipProps, frame: number) => frame - ((clip.startFrame ?? 0) + (isFinite(clip.trimStart ?? 0) ? (clip.trimStart ?? 0) : 0));

/** The mask's pose at a mask frame: its keyframe there, else the one before (or the first). */
export const maskPoseAt = (mask: MaskClipProps, at: number): MaskData | undefined => {
  const entries = maskEntries(mask.keyframes);
  if (entries.length === 0) return undefined;
  return (entries.filter(([f]) => f <= at).pop() ?? entries[0])[1];
};

/** The mask's box size (the clip's box at the scale the mask was drawn at). */
const maskBox = (clip: AnyClipProps, mask: MaskClipProps): [number, number] => {
  const t = mask.transform ?? clip.transform;
  const or1 = (v: number | undefined) => (v && isFinite(v) ? v : 1);
  return [or1(t?.width) * Math.abs(or1(t?.scaleX)), or1(t?.height) * Math.abs(or1(t?.scaleY))];
};

const centred = (shape: string | undefined) => shape === "ellipse" || shape === "polygon" || shape === "star";

/** A shape mask's region on its clip's upright picture (fractions), from its pose at `at`
 * (masks are drawn on the clip's own box, so no canvas placement is involved). */
export const maskRegion = (clip: AnyClipProps, mask: MaskClipProps, at: number) => {
  const b = maskPoseAt(mask, at)?.shapeBounds;
  if (!b) return null;
  const [bw, bh] = maskBox(clip, mask);
  const w = b.width * (b.scaleX ?? 1);
  const h = b.height * (b.scaleY ?? 1);
  const rot = b.rotation ?? 0;
  const [cx, cy] = centred(b.shapeType) ? [b.x + w / 2, b.y + h / 2] : ((): [number, number] => {
    const [dx, dy] = turn([w / 2, h / 2], rot);
    return [b.x + dx, b.y + dy];
  })();
  return { centerX: cx / bw, centerY: cy / bh, width: w / bw, height: h / bh, rotation: rot };
};

/** The engine's request for tracking a shape mask through its own video clip. */
export const maskTrackRequest = (clip: VideoClipProps, mask: MaskClipProps, frame: number, fps: number, path: string, mediaSeconds: number | undefined, direction: TrackDirection) => {
  const r = maskRegion(clip, mask, maskFrame(clip, frame));
  if (!r) return null;
  const range: [number, number] = [clip.startFrame ?? 0, clip.endFrame ?? 0];
  const times = [sourceUsAt(clip, range[0], fps, mediaSeconds), sourceUsAt(clip, range[1] - 1, fps, mediaSeconds)];
  const pad = Math.round(1e6 / fps);
  return { path, atUs: sourceUsAt(clip, frame, fps, mediaSeconds), fromUs: Math.max(0, Math.min(...times) - pad), toUs: Math.max(...times) + pad, ...r, direction };
};

/**
 * The mask's poses from a track: at each timeline frame of the clip tracked, its shape moved,
 * scaled and turned with the region (from where it was at `frame`). The track's span replaces
 * the mask's keys there; keys outside it stay.
 */
export const trackedMaskKeys = (clip: VideoClipProps, mask: MaskClipProps, samples: TrackSample[], frame: number, fps: number, mediaSeconds?: number): MaskKeyframes => {
  const base = maskPoseAt(mask, maskFrame(clip, frame));
  const b = base?.shapeBounds;
  const start = sampleAt(samples, sourceUsAt(clip, frame, fps, mediaSeconds));
  if (!b || !start) return mask.keyframes;
  const [bw, bh] = maskBox(clip, mask);
  const w0 = b.width;
  const h0 = b.height;
  const rot0 = b.rotation ?? 0;
  const points: Point[] = [];
  for (let f = clip.startFrame ?? 0; f < (clip.endFrame ?? 0); f++) {
    const s = sampleAt(samples, sourceUsAt(clip, f, fps, mediaSeconds));
    if (!s) continue;
    const k = s.scale / (start.scale || 1);
    const rot = rot0 + (s.rotation - start.rotation);
    const [cx, cy] = [s.centerX * bw, s.centerY * bh];
    const [w, h] = [w0 * k, h0 * k];
    const ew = w * (b.scaleX ?? 1);
    const eh = h * (b.scaleY ?? 1);
    const [x, y] = centred(b.shapeType) ? [cx - ew / 2, cy - eh / 2] : ((): [number, number] => {
      const [dx, dy] = turn([ew / 2, eh / 2], rot);
      return [cx - dx, cy - dy];
    })();
    points.push({ frame: Math.round(maskFrame(clip, f)), values: [x, y, w, h, rot] });
  }
  if (points.length === 0) return mask.keyframes;
  const kept = thin(points, [POSITION_TOLERANCE, POSITION_TOLERANCE, POSITION_TOLERANCE, POSITION_TOLERANCE, ROTATION_TOLERANCE]);
  const [first, last] = [points[0].frame, points[points.length - 1].frame];
  const out: Record<number, MaskData> = {};
  for (const [f, data] of maskEntries(mask.keyframes)) if (f < first || f > last) out[f] = data;
  for (const p of kept) {
    const [x, y, width, height, rotation] = p.values;
    out[p.frame] = { ...base, shapeBounds: { ...b, x, y, width, height, rotation }, ease: "linear" };
  }
  return mask.keyframes instanceof Map ? new Map(Object.entries(out).map(([k, v]) => [Number(k), v])) : out;
};

/** The keys of a property a test or the harness can read (lib/keyframes.ts lists them). */
export const keysOf = (clip: AnyClipProps, prop: "position" | "scale" | "rotation"): Keyframe[] => listKeyframes(clip.keyframes, prop);
