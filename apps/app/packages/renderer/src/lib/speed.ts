// Speed tools: pure helpers over a clip's speed fields (`speed`, `reverse`, `speedCurve`; lib/
// types.ts `SpeedProps`) and freeze frames (`freeze`), for CapCut's Speed tab (Normal and Curve,
// the curve presets and editor) and the timeline toolbar's Freeze and Reverse. Nothing here
// writes to a store or to an object it's given: every edit returns new objects, so the undo
// history (which shares clips between states) stays intact.
//
// The curve maths is CapCut's, as the engine has it (engine/crates/model/src/speed.rs,
// docs/parity/speed.md): a curve's points are (x, y), x the progress through the clip's media in
// the order it plays and y the speed there. Each point sits on the clip at the output progress
// its media takes at the spans' mean speeds; between points the speed follows CapCut's S-shaped
// ramp of three straight pieces; the media shown is the ramp's integral; the clip's length is its
// media length over the curve's mean speed, which is the clip's `speed`.
//
// Units are the app's: frames at the project's rate on the timeline, and `trimStart` /
// `trimEnd` in timeline frames at the clip's speed (counted as it plays, so a reversed clip's
// `trimStart` is from its media's end).
import type { AnyClipProps, ClipKeyframes, Keyframe, KeyframeProperty, SpeedCurve, SpeedPoint, VideoClipProps } from "./types";

/** CapCut's speed range on a curve. */
export const MIN_CURVE_SPEED = 0.1;
export const MAX_CURVE_SPEED = 10;

/** How long CapCut makes a freeze frame (s). */
export const FREEZE_SECONDS = 3;

/** How close to a frame's start CapCut's frame lookup snaps to it (s): a freeze holds the frame
 * starting at the playhead even where the playhead's time falls a hair before it. */
const FRAME_SNAP = 0.0008;

/** A preset of CapCut's Curve tab: its name and points. */
export type CurvePreset = { name: string; points: SpeedPoint[] };

const pts = (list: [number, number][]): SpeedPoint[] => list.map(([x, y]) => ({ x, y }));

/**
 * CapCut's curve presets in the tab's order, from the presets it downloads ("Custom" is the
 * curve a custom one starts from: five points at 1×).
 */
export const CURVE_PRESETS: CurvePreset[] = [
  { name: "Custom", points: pts([[0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1, 1]]) },
  { name: "Montage", points: pts([[0, 0.9], [0.1, 0.9], [0.5, 6.8], [0.65, 0.3], [0.8, 1], [1, 1]]) },
  { name: "Hero", points: pts([[0, 1], [0.05, 1], [0.35, 5.5], [0.45, 0.5], [0.55, 0.5], [0.65, 5.5], [0.95, 1], [1, 1]]) },
  { name: "Bullet", points: pts([[0, 5.2], [0.4, 5.2], [0.46, 0.5], [0.54, 0.5], [0.6, 5.2], [1, 5.2]]) },
  { name: "Jump Cut", points: pts([[0, 0.6], [0.43, 0.6], [0.5, 6], [0.57, 0.6], [1, 0.6]]) },
  { name: "Flash In", points: pts([[0, 5.2], [0.4, 5.2], [0.6, 1], [1, 1]]) },
  { name: "Flash Out", points: pts([[0, 1], [0.4, 1], [0.6, 5.2], [1, 5.2]]) },
];

/** A preset's curve, by name. */
export const presetCurve = (name: string): SpeedCurve | null => {
  const p = CURVE_PRESETS.find((c) => c.name === name);
  return p ? { preset: p.name, points: p.points.map((q) => ({ ...q })) } : null;
};

// ---- the remap ----------------------------------------------------------------------------

/** The share of a span's change in speed made in its middle piece, and half that piece's length
 * as a share of the span (CapCut's 0.8f and 0.2951f). */
const K1 = Math.fround(0.8);
const K2 = Math.fround(0.2951);

/** A curve ready to map time: speeds at the points, their output progress, and the speed's
 * integral up to each (source, in output-progress units: the last is the mean speed). */
type Remap = { y: number[]; s: number[]; areas: number[]; average: number };

type Span = { a: number; b: number; y0: number; y1: number; b1: number; b2: number; g: number; h: number; first: number; middle: number };

const span = (a: number, b: number, y0: number, y1: number): Span => {
  const l = Math.max(b - a, 1e-12);
  const m = (a + b) / 2;
  const dy = y1 - y0;
  const [b1, b2] = [m - K2 * l, m + K2 * l];
  const g = ((1 - K1) * dy) / ((1 - 2 * K2) * l);
  const h = (K1 * dy) / (2 * K2 * l);
  const first = y0 * (b1 - a) + (g * (b1 - a) ** 2) / 2;
  const middle = 2 * K2 * l * ((y0 + y1) / 2);
  return { a, b, y0, y1, b1, b2, g, h, first, middle };
};

const v1 = (sp: Span) => sp.y0 + sp.g * (sp.b1 - sp.a);
const v2 = (sp: Span) => v1(sp) + sp.h * (sp.b2 - sp.b1);

const spanSpeed = (sp: Span, t: number) =>
  t <= sp.b1 ? sp.y0 + sp.g * (t - sp.a) : t <= sp.b2 ? v1(sp) + sp.h * (t - sp.b1) : sp.y1 - sp.g * (sp.b - t);

/** The speed's integral from the span's start to `t`. */
const spanArea = (sp: Span, t: number) => {
  const piece = (v0: number, k: number, w: number) => v0 * w + (k * w * w) / 2;
  if (t <= sp.b1) return piece(sp.y0, sp.g, t - sp.a);
  if (t <= sp.b2) return sp.first + piece(v1(sp), sp.h, t - sp.b1);
  return sp.first + sp.middle + piece(v2(sp), sp.g, t - sp.b2);
};

/** Where in the span the integral reaches `r`. */
const spanTimeOf = (sp: Span, r: number) => {
  // The positive root of v0·w + k·w²/2 = r, in a form that holds for k = 0.
  const solve = (v0: number, k: number, r: number) => (2 * r) / Math.max(v0 + Math.sqrt(Math.max(v0 * v0 + 2 * k * r, 0)), 1e-12);
  if (r <= sp.first) return sp.a + solve(sp.y0, sp.g, r);
  if (r <= sp.first + sp.middle) return sp.b1 + solve(v1(sp), sp.h, r - sp.first);
  return sp.b2 + solve(v2(sp), sp.g, r - sp.first - sp.middle);
};

const clampSpeed = (y: number) => Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, y));

/** A curve's remap; null without at least two points. */
const remapOf = (points: SpeedPoint[] | undefined): Remap | null => {
  if (!points || points.length < 2) return null;
  const p = [...points].map((q) => ({ x: q.x, y: clampSpeed(q.y) })).sort((a, b) => a.x - b.x);
  // Each point's place in output time, in single precision as CapCut works it out.
  const f = Math.fround;
  let acc = 0;
  const sums = [0];
  for (let i = 1; i < p.length; i++) {
    const mean = f(f(f(p[i - 1].y) + f(p[i].y)) / 2);
    acc = f(acc + f(f(f(p[i].x) - f(p[i - 1].x)) / mean));
    sums.push(acc);
  }
  if (!(acc > 0)) return null;
  const s32 = sums.map((v) => f(v / acc));
  let average = 0;
  for (let i = 1; i < p.length; i++) average += f(f(p[i - 1].y) + f(p[i].y)) * 0.5 * f(s32[i] - s32[i - 1]);
  const y = p.map((q) => q.y);
  const areas = [0];
  for (let i = 1; i < p.length; i++) areas.push(areas[i - 1] + spanArea(span(s32[i - 1], s32[i], y[i - 1], y[i]), s32[i]));
  return { y, s: s32, areas, average };
};

const spanOf = (r: Remap, i: number) => span(r.s[i - 1], r.s[i], r.y[i - 1], r.y[i]);

/** The span holding output progress `q` (its end's index). */
const spanAt = (r: Remap, q: number) => {
  let i = 1;
  while (i < r.s.length - 1 && r.s[i] < q) i++;
  return i;
};

const total = (r: Remap) => Math.max(r.areas[r.areas.length - 1], 1e-12);

/** A curve's mean speed: media length over timeline length (1 without a curve). */
export const curveAverage = (points: SpeedPoint[] | undefined): number => remapOf(points)?.average ?? 1;

/** The speed at timeline progress `q` (0..1) through a curve. */
export const curveSpeedAt = (points: SpeedPoint[], q: number): number => {
  const r = remapOf(points);
  if (!r) return 1;
  const t = Math.min(Math.max(q, 0), 1);
  return spanSpeed(spanOf(r, spanAt(r, t)), t);
};

/** Progress through the media (0..1, as it plays) shown at timeline progress `q` (0..1). */
export const sourceProgressAt = (points: SpeedPoint[], q: number): number => {
  const r = remapOf(points);
  const t = Math.min(Math.max(q, 0), 1);
  if (!r) return t;
  const i = spanAt(r, t);
  return Math.min(Math.max((r.areas[i - 1] + spanArea(spanOf(r, i), t)) / total(r), 0), 1);
};

/** Timeline progress (0..1) at which media progress `p` (0..1, as it plays) is shown. */
export const timelineProgressAt = (points: SpeedPoint[], p: number): number => {
  const r = remapOf(points);
  const x = Math.min(Math.max(p, 0), 1);
  if (!r) return x;
  const want = x * total(r);
  let i = 1;
  while (i < r.areas.length - 1 && r.areas[i] < want) i++;
  return Math.min(Math.max(spanTimeOf(spanOf(r, i), want - r.areas[i - 1]), 0), 1);
};

/** A clip's length on the timeline (frames) for a media length (frames) through a curve, at
 * least a frame. */
export const curvedLength = (mediaFrames: number, points: SpeedPoint[]): number => Math.max(1, Math.round(mediaFrames / curveAverage(points)));

/** Whether a clip plays by a speed curve. */
export const hasCurve = (clip: AnyClipProps): boolean => {
  const c = (clip as VideoClipProps).speedCurve;
  return !!c && Array.isArray(c.points) && c.points.length >= 2;
};

const speedOf = (clip: AnyClipProps) => Math.max(0.1, Number((clip as VideoClipProps).speed || 1));
const lengthOf = (clip: AnyClipProps) => Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));
const finite = (v: number | undefined) => (isFinite(v ?? 0) ? Number(v ?? 0) : 0);

/**
 * The time (s) in a clip's asset shown at clip-local frame `local`: its in-point (`trimStart`)
 * plus what it has played by then at its speed or through its curve, or for a reversed clip that
 * far back from the asset's end (`mediaSeconds`, its length), or a freeze frame's frame. The
 * engine draws the frame shown at that time.
 */
export const sourceTimeAt = (clip: AnyClipProps, local: number, fps: number, mediaSeconds?: number): number => {
  const v = clip as VideoClipProps;
  if (v.freeze) return v.freeze.at;
  const speed = speedOf(clip);
  const len = lengthOf(clip);
  const u = Math.min(Math.max(local, 0), len);
  const playedFrom = (finite(clip.trimStart) * speed) / fps;
  const span = (len * speed) / fps;
  const played = playedFrom + (hasCurve(clip) ? sourceProgressAt(v.speedCurve!.points, u / len) * span : (u * speed) / fps);
  return v.reverse ? Math.max(0, (mediaSeconds ?? playedFrom + span) - played) : played;
};

// ---- keyframes ----------------------------------------------------------------------------

/** A curve handle's frames times `factor`. */
const scaleEase = (ease: Keyframe["ease"], factor: number): Keyframe["ease"] => {
  if (!ease || typeof ease === "string" || factor === 1) return ease;
  const frames = (v: number | number[]) => (Array.isArray(v) ? v.map((x) => x * factor) : v * factor);
  return { ...ease, out: { ...ease.out, frames: frames(ease.out.frames) }, in: { ...ease.in, frames: frames(ease.in.frames) } };
};

/**
 * Keys moved so they stay on the media through a change of timing: `from(frame)` gives the
 * media a key's frame showed (as it plays, in any unit), `to(media)` the new frame showing it.
 * A curve handle's frames scale with the local change in timing.
 */
export const retimeKeyframes = (keyframes: ClipKeyframes | undefined, from: (frame: number) => number, to: (media: number) => number): ClipKeyframes | undefined => {
  if (!keyframes) return keyframes;
  const next: ClipKeyframes = {};
  for (const [p, keys] of Object.entries(keyframes) as [KeyframeProperty, Keyframe[]][]) {
    if (!keys?.length) continue;
    next[p] = keys.map((k) => {
      const frame = to(from(k.frame));
      if (!k.ease || typeof k.ease === "string") return { ...k, frame };
      // The handles scale by how fast the timing changes around the key.
      const d = 0.5;
      const rate = (to(from(k.frame + d)) - to(from(k.frame - d))) / (2 * d);
      const scaled = scaleEase(k.ease, isFinite(rate) && rate > 0 ? rate : 1);
      return { ...k, frame, ease: scaled };
    });
  }
  return next;
};

// ---- edits ----------------------------------------------------------------------------------

/**
 * The patch for `updateClip` that sets a clip's speed: a constant `speed` (CapCut's Normal tab,
 * which drops a curve), or a `curve` (its Curve tab; null takes it off, back to the speed it
 * averaged). The clip keeps its in-point and the media it plays, so its length changes; its
 * trims scale with the speed, and its keys stay on the media (through the curve).
 */
export const speedPatch = (clip: AnyClipProps, change: { speed?: number; curve?: SpeedCurve | null }): Partial<AnyClipProps> => {
  const v = clip as VideoClipProps;
  const oldSpeed = speedOf(clip);
  const oldLen = lengthOf(clip);
  const media = oldLen * oldSpeed; // in frames of media, as it plays
  const curve = change.curve !== undefined ? (change.curve && change.curve.points.length >= 2 ? change.curve : null) : change.speed !== undefined ? null : (v.speedCurve ?? null);
  const speed = curve ? curveAverage(curve.points) : Math.min(100, Math.max(0.1, change.speed ?? oldSpeed));
  const len = Math.max(1, Math.round(media / speed));
  // Where each key's media is, as played, then where it shows now.
  const oldCurve = hasCurve(clip) ? v.speedCurve!.points : null;
  const from = (frame: number) => (oldCurve ? sourceProgressAt(oldCurve, frame / oldLen) * media : frame * oldSpeed);
  const to = (m: number) => (curve ? timelineProgressAt(curve.points, m / media) * len : m / speed);
  return {
    speed,
    speedCurve: curve,
    endFrame: (clip.startFrame ?? 0) + len,
    trimStart: isFinite(clip.trimStart ?? 0) ? finite(clip.trimStart) * (oldSpeed / speed) : clip.trimStart,
    trimEnd: isFinite(clip.trimEnd ?? 0) ? finite(clip.trimEnd) * (oldSpeed / speed) : clip.trimEnd,
    keyframes: retimeKeyframes(clip.keyframes, from, to),
  } as Partial<AnyClipProps>;
};

/**
 * The patch that reverses a clip (CapCut's Reverse) or puts it back: the same stretch of media
 * plays the other way, so its trims swap ends (they count as it plays). Its length, speed, curve
 * (which runs as it plays) and keys (which stay where they are on the timeline) don't change.
 */
export const reversePatch = (clip: AnyClipProps, reverse: boolean): Partial<AnyClipProps> => {
  const v = clip as VideoClipProps;
  if (!!v.reverse === reverse) return {};
  // trimStart is what's cut off before the start, -trimEnd what's left after the end.
  return { reverse, trimStart: -finite(clip.trimEnd), trimEnd: -finite(clip.trimStart) } as Partial<AnyClipProps>;
};

/**
 * A curve cut at media progress `p` (0..1, as it plays) as CapCut cuts a curved clip: the speed
 * at the cut from the smooth step between the points beside it, and each half's points over its
 * own media.
 */
export const splitSpeedCurve = (curve: SpeedCurve, p: number): [SpeedCurve, SpeedCurve] => {
  const points = [...curve.points].sort((a, b) => a.x - b.x);
  const i = Math.max(1, points.findIndex((q) => q.x > p));
  const [a, b] = [points[i - 1], points[Math.min(i, points.length - 1)]];
  const u = b.x > a.x ? Math.min(Math.max((p - a.x) / (b.x - a.x), 0), 1) : 0;
  const y = a.y + (b.y - a.y) * (3 * u * u - 2 * u * u * u);
  const cut = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  const left = [...points.filter((q) => q.x < cut), { x: cut, y }].map((q) => ({ x: q.x / cut, y: q.y }));
  const right = [{ x: cut, y }, ...points.filter((q) => q.x > cut)].map((q) => ({ x: (q.x - cut) / (1 - cut), y: q.y }));
  const preset = curve.preset;
  return [preset ? { preset, points: left } : { points: left }, preset ? { preset, points: right } : { points: right }];
};

/**
 * What changes besides the timing when a curved clip is cut at clip-local frame `cut` (lib/
 * clip.ts `splitClipAt`): each half gets its part of the curve and plays the media it showed, so
 * its speed (the mean of its part) and trims follow. `null` for a clip without a curve, whose
 * halves keep its speed.
 */
export const splitCurveFields = (clip: AnyClipProps, cut: number): [Partial<AnyClipProps>, Partial<AnyClipProps>] | null => {
  if (!hasCurve(clip)) return null;
  const v = clip as VideoClipProps;
  const speed = speedOf(clip);
  const len = lengthOf(clip);
  const media = len * speed;
  const p = sourceProgressAt(v.speedCurve!.points, cut / len);
  const [lc, rc] = splitSpeedCurve(v.speedCurve!, p);
  const [ls, rs] = [(p * media) / Math.max(cut, 1e-9), ((1 - p) * media) / Math.max(len - cut, 1e-9)];
  const played = finite(clip.trimStart) * speed;
  const after = -finite(clip.trimEnd) * speed;
  return [
    { speedCurve: lc, speed: ls, trimStart: played / ls, trimEnd: -(after + (1 - p) * media) / ls } as Partial<AnyClipProps>,
    { speedCurve: rc, speed: rs, trimStart: (played + p * media) / rs, trimEnd: -after / rs } as Partial<AnyClipProps>,
  ];
};

/**
 * CapCut's Freeze at timeline frame `frame` on a video clip: the clip is cut there and a still
 * of the frame at the playhead goes between the halves, `FREEZE_SECONDS` long; everything after
 * the cut on its track moves later by that much, and so do the clips linked to it (cut there
 * too, by `split`), on theirs. The still keeps the clip's look (its box, adjustments, masks and
 * the keyed values at the cut) and has no sound, speed or link.
 *
 * `split(clip, frame)` cuts a clip in two with new ids (the store's), `newId()` makes the
 * still's id, and `mediaSeconds` is the asset's length (for a reversed clip). Returns the new
 * clips and the still's id, or null where there's nothing to freeze (not a video, a freeze
 * already, or the frame isn't inside it).
 */
export const freezeFrame = (
  clips: AnyClipProps[],
  clipId: string,
  frame: number,
  fps: number,
  split: (clip: AnyClipProps, frame: number) => [AnyClipProps, AnyClipProps],
  newId: () => string,
  linked: AnyClipProps[] = [],
  mediaSeconds?: number,
): { clips: AnyClipProps[]; freezeId: string } | null => {
  const clip = clips.find((c) => c.clipId === clipId);
  if (!clip || clip.type !== "video" || (clip as VideoClipProps).freeze) return null;
  const f = Math.round(frame);
  const inside = (c: AnyClipProps) => f > (c.startFrame ?? 0) && f < (c.endFrame ?? 0);
  if (!inside(clip)) return null;
  const length = Math.max(1, Math.round(FREEZE_SECONDS * fps));
  const at = sourceTimeAt(clip, f - (clip.startFrame ?? 0), fps, mediaSeconds) + FRAME_SNAP;
  const [left, right] = split(clip, f);
  // The keyed values at the cut, held (each property's first key on the right half).
  const held: ClipKeyframes = {};
  for (const [p, keys] of Object.entries(right.keyframes ?? {}) as [KeyframeProperty, Keyframe[]][]) {
    if (keys?.length) held[p] = [{ frame: 0, value: keys[0].value }];
  }
  const still = {
    ...left,
    clipId: newId(),
    startFrame: f,
    endFrame: f + length,
    trimStart: 0,
    trimEnd: 0,
    freeze: { at },
    speed: 1,
    reverse: false,
    speedCurve: null,
    linkId: undefined,
    transitionOut: null,
    keyframes: Object.keys(held).length ? held : undefined,
  } as VideoClipProps;
  // The rest of each track the cut reaches moves later. Linked clips are cut too: the left halves
  // stay linked to each other, and the right halves, as a split leaves them.
  const tracks = new Set<string | undefined>([clip.timelineId]);
  const partners = linked.filter((p) => p.clipId !== clip.clipId && p.type !== "group");
  const [leftLink, rightLink] = partners.some(inside) ? [newId(), newId()] : [left.linkId, right.linkId];
  const cut = new Map<string, [AnyClipProps, AnyClipProps]>([[clip.clipId, [{ ...left, linkId: leftLink }, { ...right, linkId: rightLink }]]]);
  for (const p of partners) {
    tracks.add(p.timelineId);
    if (inside(p)) {
      const [l, r] = split(p, f);
      cut.set(p.clipId, [{ ...l, linkId: leftLink }, { ...r, linkId: rightLink }]);
    }
  }
  const later = (c: AnyClipProps) => ({ ...c, startFrame: (c.startFrame ?? 0) + length, endFrame: (c.endFrame ?? 0) + length });
  const out: AnyClipProps[] = [];
  for (const c of clips) {
    const halves = cut.get(c.clipId);
    if (halves) {
      out.push(halves[0], later(halves[1]));
    } else if (tracks.has(c.timelineId) && c.type !== "group" && (c.startFrame ?? 0) >= f) {
      out.push(later(c));
    } else {
      out.push(c);
    }
  }
  out.push(still);
  return { clips: out, freezeId: still.clipId };
};
