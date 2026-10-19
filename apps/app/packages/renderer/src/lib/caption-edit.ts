// What the Captions inspector does to a captions track, as plain functions on clips: which clips
// are captions, the list the editor shows, Find and replace, and the style fields "Apply to all
// main captions" copies from one caption to the rest. Nothing here touches a store
// (`node --test tests/*.test.ts` in packages/renderer checks it); lib/caption-actions.ts makes the
// edits. See docs/plan/capcut-ui-spec.md §6.24.
import type { AnyClipProps, TextClipProps, TimelineProps } from "./types";

/** Whether a clip is a caption: a text on a captions track (Add captions, Auto captions), or one made from speech. */
export const isCaption = (clip: AnyClipProps | undefined, timelines: TimelineProps[]): clip is TextClipProps =>
  !!clip && clip.type === "text" && ((clip as TextClipProps).autoCaption === true || !!timelines.find((t) => t.timelineId === clip.timelineId)?.captions);

/** The captions of a clip's track in time order. */
export const captionsOnTrack = (clips: AnyClipProps[], timelineId: string | undefined): TextClipProps[] =>
  clips
    .filter((c): c is TextClipProps => c.type === "text" && c.timelineId === timelineId)
    .sort((a, b) => a.startFrame - b.startFrame || a.clipId.localeCompare(b.clipId));

/** The fields "Apply to all main captions" carries from the caption being edited to the others: the look, not the words or timing. */
export const CAPTION_STYLE_FIELDS: (keyof TextClipProps)[] = [
  "fontSize", "fontWeight", "fontStyle", "fontFamily", "color", "colorOpacity", "textAlign", "verticalAlign", "textTransform", "textDecoration",
  "strokeEnabled", "stroke", "strokeWidth", "strokeOpacity", "moreStrokes",
  "shadowEnabled", "shadowColor", "shadowOpacity", "shadowBlur", "shadowOffsetX", "shadowOffsetY", "shadowOffsetLocked",
  "backgroundEnabled", "backgroundColor", "backgroundOpacity", "backgroundCornerRadius", "backgroundWidth", "backgroundHeight", "backgroundOffsetX", "backgroundOffsetY",
  "letterSpacing", "lineSpacing", "fillGradient", "glowEnabled", "glowColor", "glowIntensity", "glowRange", "glowOffsetX", "glowOffsetY", "textEffect", "textCurve",
  "blendMode",
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The style fields whose values differ between two states of a caption, as a patch to `next`'s values. */
export const styleChange = (prev: TextClipProps, next: TextClipProps): Partial<TextClipProps> => {
  const patch: Record<string, unknown> = {};
  for (const k of CAPTION_STYLE_FIELDS) if (!same(prev[k], next[k])) patch[k] = next[k];
  return patch as Partial<TextClipProps>;
};

/** All the style fields a caption has, for putting the whole look on the others. */
export const styleOf = (clip: TextClipProps): Partial<TextClipProps> => {
  const out: Record<string, unknown> = {};
  for (const k of CAPTION_STYLE_FIELDS) if (k in clip) out[k] = clip[k];
  return out as Partial<TextClipProps>;
};

/**
 * The patch that moves other captions with the edited one when its box changes: the box's
 * centre, scale, rotation and opacity (each only if it changed), keeping each caption's own size
 * of box. `null` when nothing of the box changed.
 */
export const boxChange = (prev: TextClipProps, next: TextClipProps, other: TextClipProps): Partial<TextClipProps> | null => {
  const a = prev.transform;
  const b = next.transform;
  const o = other.transform;
  if (!a || !b || !o) return null;
  const centre = (t: typeof a) => [t.x + (t.width * t.scaleX) / 2, t.y + (t.height * t.scaleY) / 2];
  const [ax, ay] = centre(a);
  const [bx, by] = centre(b);
  const scaled = a.scaleX !== b.scaleX || a.scaleY !== b.scaleY;
  const moved = ax !== bx || ay !== by || scaled;
  if (!moved && a.rotation === b.rotation && a.opacity === b.opacity) return null;
  const scaleX = scaled ? b.scaleX : o.scaleX;
  const scaleY = scaled ? b.scaleY : o.scaleY;
  const [ox, oy] = [(moved ? bx : o.x + (o.width * o.scaleX) / 2), (moved ? by : o.y + (o.height * o.scaleY) / 2)];
  return {
    transform: {
      ...o,
      scaleX,
      scaleY,
      x: ox - (o.width * scaleX) / 2,
      y: oy - (o.height * scaleY) / 2,
      rotation: a.rotation !== b.rotation ? b.rotation : o.rotation,
      opacity: a.opacity !== b.opacity ? b.opacity : o.opacity,
    },
  };
};

/** One row of the list editor. */
export type CaptionRow = { clipId: string; number: number; startFrame: number; endFrame: number; text: string };

/** The list editor's rows for a track: numbered from 1 in time order, those whose words contain `query` (any case) when one is typed. The numbers are the caption's place on the track, not in the filtered list. */
export const captionRows = (captions: TextClipProps[], query = ""): CaptionRow[] => {
  const q = query.trim().toLowerCase();
  return captions
    .map((c, i) => ({ clipId: c.clipId, number: i + 1, startFrame: c.startFrame, endFrame: c.endFrame, text: c.text ?? "" }))
    .filter((r) => !q || r.text.toLowerCase().includes(q));
};

/** How many times `find` is in `text` (any letter case; overlaps not counted). 0 for an empty `find`. */
export const countMatches = (text: string, find: string): number => {
  if (!find) return 0;
  const hay = text.toLowerCase();
  const needle = find.toLowerCase();
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
};

/** `text` with every `find` (any letter case) replaced literally by `replace`. */
export const replaceMatches = (text: string, find: string, replace: string): string => {
  if (!find) return text;
  const hay = text.toLowerCase();
  const needle = find.toLowerCase();
  let out = "";
  let from = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, from)) {
    out += text.slice(from, i) + replace;
    from = i + needle.length;
  }
  return out + text.slice(from);
};

/** The patches Replace all makes: the captions that contain `find` with their new words. */
export const replaceAllPatches = (captions: TextClipProps[], find: string, replace: string): { clipId: string; text: string }[] =>
  captions.flatMap((c) => {
    const text = c.text ?? "";
    return countMatches(text, find) > 0 ? [{ clipId: c.clipId, text: replaceMatches(text, find, replace) }] : [];
  });

/** A time in frames as the list shows it: `m:ss.f`-ish seconds with one decimal ("0:03.5"). */
export const rowTime = (frame: number, fps: number): string => {
  const s = Math.max(0, frame) / (fps || 24);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};
