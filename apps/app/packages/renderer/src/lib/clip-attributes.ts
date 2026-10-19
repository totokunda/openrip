// A clip's attributes in groups, as CapCut's Copy attributes and Save preset take them: the
// groups a clip has (Transform, Blend, Adjust, Remove BG, Effects, Animation, Speed, Audio, Mask,
// Text style), copied out as plain data, and pasted onto another clip of a type that has the
// group. Everything here is pure: `copyAttributes` reads a clip, `pasteAttributes` makes the patch
// for `updateClip`; lib/clip-presets.ts keeps the clipboard and the saved presets and applies them
// (`node --test tests/*.test.ts` in packages/renderer checks this file).
//
// What a group holds is the clip's fields and the keyframes of the same properties, with the
// clip's own content left out (its media, words, trims, start and length). Sizes travel as a
// fraction of the clip's fitted size, so a scale of 100 % on one clip is 100 % on the next
// whatever its picture's size; position travels as the centre on the canvas.
import { centreOf, placeCentre } from "./transform-presets.ts";
import type { AnyClipProps, ClipKeyframes, ClipType, Keyframe } from "./types";

export type AttributeGroup = "transform" | "blend" | "adjust" | "chroma" | "effects" | "animations" | "speed" | "audio" | "mask" | "text";

/** The groups, in the order the menu lists them. */
export const ATTRIBUTE_GROUPS: { id: AttributeGroup; label: string }[] = [
  { id: "transform", label: "Transform" },
  { id: "blend", label: "Blend" },
  { id: "adjust", label: "Adjust" },
  { id: "chroma", label: "Remove BG" },
  { id: "effects", label: "Effects" },
  { id: "animations", label: "Animation" },
  { id: "speed", label: "Speed" },
  { id: "audio", label: "Volume and audio" },
  { id: "mask", label: "Mask" },
  { id: "text", label: "Text style" },
];

export const groupLabel = (g: AttributeGroup) => ATTRIBUTE_GROUPS.find((x) => x.id === g)?.label ?? g;

type Fields = Record<string, unknown>;
type Keys = Record<string, Keyframe[]>;

/** One group's copy: the fields (plain data) and the keyframes of its properties. */
export type GroupData = { fields: Fields; keys: Keys };

/** What Copy attributes keeps: the groups of the clip it was taken from, and its type. */
export type ClipAttributes = { source: ClipType; groups: Partial<Record<AttributeGroup, GroupData>> };

const MEDIA: ClipType[] = ["video", "image"];

const isAdjustment = (c: AnyClipProps) => c.type === "filter" && !!(c as any).adjustment;

/** Whether the clip has the group at all (a text has no Adjust, a photo no Speed). */
export const hasGroup = (clip: AnyClipProps, g: AttributeGroup): boolean => {
  const t = clip.type;
  switch (g) {
    case "transform":
      return t === "video" || t === "image" || t === "text" || t === "sticker" || t === "shape";
    case "blend":
      return t === "video" || t === "image" || t === "text";
    case "adjust":
      return MEDIA.includes(t) || isAdjustment(clip);
    case "chroma":
    case "effects":
      return MEDIA.includes(t);
    case "animations":
      return MEDIA.includes(t) || t === "text" || t === "sticker";
    case "speed":
      return (t === "video" || t === "audio") && !(clip as any).freeze;
    case "audio":
      return t === "video" || t === "audio";
    case "mask":
      return MEDIA.includes(t) || isAdjustment(clip);
    case "text":
      return t === "text";
  }
};

/** The groups a clip has, in the menu's order. */
export const groupsOf = (clip: AnyClipProps): AttributeGroup[] => ATTRIBUTE_GROUPS.map((g) => g.id).filter((g) => hasGroup(clip, g));

const ANIMATIONS: Record<string, string[]> = {
  video: ["animationIn", "animationOut", "animationCombo"],
  image: ["animationIn", "animationOut", "animationCombo"],
  text: ["animationIn", "animationOut", "animationLoop"],
  sticker: ["animationIn", "animationOut", "animationLoop"],
};

const AUDIO_FIELDS = ["volume", "fadeIn", "fadeOut", "audioEffects", "loudness", "channel"];

const TEXT_FIELDS = [
  "fontSize", "fontWeight", "fontStyle", "fontFamily", "color", "colorOpacity", "textAlign", "verticalAlign", "textTransform", "textDecoration",
  "strokeEnabled", "stroke", "strokeWidth", "strokeOpacity",
  "shadowEnabled", "shadowColor", "shadowOpacity", "shadowBlur", "shadowOffsetX", "shadowOffsetY", "shadowOffsetLocked",
  "backgroundEnabled", "backgroundColor", "backgroundOpacity", "backgroundCornerRadius",
  "letterSpacing", "lineSpacing", "fillGradient", "moreStrokes",
  "glowEnabled", "glowColor", "glowIntensity", "glowRange", "glowOffsetX", "glowOffsetY", "textEffect",
  "backgroundWidth", "backgroundHeight", "backgroundOffsetX", "backgroundOffsetY", "textCurve",
];

const SPEED_FIELDS = ["changePitch", "smoothSlowMo"];

/** Which keyframe properties belong to a group. */
const KEY_OF: Record<AttributeGroup, (p: string) => boolean> = {
  transform: (p) => p === "position" || p === "scale" || p === "rotation",
  blend: (p) => p === "opacity",
  adjust: (p) => p.startsWith("adjust:") || p.startsWith("hsl:") || p === "wheels:intensity" || p === "lut:intensity",
  chroma: (p) => p.startsWith("chroma:"),
  effects: (p) => p.startsWith("fx:"),
  animations: () => false,
  speed: () => false,
  audio: (p) => p === "volume",
  mask: () => false,
  text: (p) => ["color", "fontSize", "stroke", "strokeWidth", "strokeOpacity", "shadowColor", "shadowOpacity", "shadowBlur", "backgroundColor", "backgroundOpacity", "glowColor", "glowIntensity", "glowRange"].includes(p),
};

/** A deep copy that is plain data: a Map becomes an object, so a copy can go to disk. */
export const plain = <T>(v: T): T => {
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), plain(x)])) as T;
  if (Array.isArray(v)) return v.map(plain) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, plain(x)])) as T;
  return v;
};

const keysOf = (clip: AnyClipProps, g: AttributeGroup): Keys => {
  const out: Keys = {};
  for (const [p, list] of Object.entries(clip.keyframes ?? {})) if (list && list.length && KEY_OF[g](p)) out[p] = plain(list as Keyframe[]);
  return out;
};

/** The clip's keyframes with `g`'s properties replaced by `keys`. */
const withKeys = (clip: AnyClipProps, g: AttributeGroup, keys: Keys): ClipKeyframes | undefined => {
  const kept: Record<string, Keyframe[]> = {};
  for (const [p, list] of Object.entries(clip.keyframes ?? {})) if (list && !KEY_OF[g](p)) kept[p] = list as Keyframe[];
  const next = { ...kept, ...plain(keys) } as ClipKeyframes;
  return Object.keys(next).length ? next : undefined;
};

/** The box's size against the size it was fitted at (CapCut's 100 % is the fitted picture). */
const fitted = (clip: AnyClipProps) => {
  const t = clip.transform!;
  const base = clip.originalTransform ?? t;
  return { kx: base.width && t.width ? t.width / base.width : 1, ky: base.height && t.height ? t.height / base.height : 1 };
};

const pick = (clip: AnyClipProps, names: string[]): Fields => {
  const out: Fields = {};
  for (const n of names) if (n in clip) out[n] = plain((clip as any)[n]);
  return out;
};

const copyGroup = (clip: AnyClipProps, g: AttributeGroup): GroupData => {
  const keys = keysOf(clip, g);
  switch (g) {
    case "transform": {
      const t = clip.transform!;
      const { kx, ky } = fitted(clip);
      // Scale as a fraction of the fitted size; its keys the same.
      for (const k of keys.scale ?? []) {
        const v = k.value as number[];
        k.value = [v[0] * kx, (v[1] ?? v[0]) * ky];
      }
      const fields: Fields = { scale: [t.scaleX * kx, t.scaleY * ky], centre: centreOf(t), rotation: t.rotation, cornerRadius: t.cornerRadius };
      if (MEDIA.includes(clip.type)) fields.flip = plain((clip as any).flip ?? {});
      return { fields, keys };
    }
    case "blend":
      return { fields: { blendMode: (clip as any).blendMode ?? "normal", opacity: clip.transform?.opacity ?? 100 }, keys };
    case "adjust": {
      // Auto adjust's record and Color match's table belong to the clip they were made from.
      const color = plain((clip as any).color ?? null);
      if (color) {
        delete color.auto;
        delete color.match;
      }
      return { fields: { color }, keys };
    }
    case "chroma":
      return { fields: { chroma: plain((clip as any).chroma ?? null) }, keys };
    case "effects":
      return { fields: { effects: plain((clip as any).effects ?? []) }, keys };
    case "animations":
      return { fields: Object.fromEntries((ANIMATIONS[clip.type] ?? []).map((f) => [f, plain((clip as any)[f] ?? null)])), keys };
    case "speed": {
      const v = clip as any;
      return { fields: { speed: v.speed ?? 1, speedCurve: plain(v.speedCurve ?? null), reverse: !!v.reverse, ...pick(clip, SPEED_FIELDS) }, keys };
    }
    case "audio":
      return { fields: pick(clip, AUDIO_FIELDS), keys };
    case "mask":
      return { fields: { masks: plain((clip as any).masks ?? []), masksOff: !!(clip as any).masksOff }, keys };
    case "text":
      return { fields: pick(clip, TEXT_FIELDS), keys };
  }
};

/** The clip's attributes in the groups it has (or just `groups` of them). */
export const copyAttributes = (clip: AnyClipProps, groups?: AttributeGroup[]): ClipAttributes => {
  const out: ClipAttributes = { source: clip.type, groups: {} };
  for (const g of groupsOf(clip)) if (!groups || groups.includes(g)) out.groups[g] = copyGroup(clip, g);
  return out;
};

/** The groups a copy holds, in the menu's order. */
export const groupsIn = (attrs: ClipAttributes | null | undefined): AttributeGroup[] => ATTRIBUTE_GROUPS.map((g) => g.id).filter((g) => !!attrs?.groups[g]);

/** The groups of `attrs` the clip can take (the ones both have). */
export const pastableGroups = (attrs: ClipAttributes | null | undefined, clip: AnyClipProps): AttributeGroup[] => groupsIn(attrs).filter((g) => hasGroup(clip, g));

/** The next id for an effect pasted onto a clip. */
let effectSerial = 0;
const newEffectId = () => `fx-${Date.now().toString(36)}-${(effectSerial++).toString(36)}`;

export type PasteResult = { patch: Partial<AnyClipProps>; /** The Speed group's Reverse, for the caller to apply after the speed (it moves the trims). */ reverse?: boolean };

/**
 * The patch that puts `groups` of `attrs` onto a clip (all it has when left out), or null when
 * none of them fit it. A pasted group replaces the clip's own, keyframes included.
 */
export const pasteAttributes = (attrs: ClipAttributes, target: AnyClipProps, groups?: AttributeGroup[]): PasteResult | null => {
  const wanted = pastableGroups(attrs, target).filter((g) => !groups || groups.includes(g));
  if (!wanted.length) return null;
  let patch: Record<string, unknown> = {};
  let clip = target;
  let reverse: boolean | undefined;
  const set = (p: Record<string, unknown>) => {
    patch = { ...patch, ...p };
    clip = { ...clip, ...p } as AnyClipProps;
  };
  for (const g of wanted) {
    const { fields, keys } = attrs.groups[g]!;
    switch (g) {
      case "transform": {
        const t = clip.transform;
        if (!t) break;
        const { kx, ky } = fitted(clip);
        const [sx, sy] = fields.scale as number[];
        const [cx, cy] = fields.centre as [number, number];
        const next = placeCentre({ ...t, scaleX: sx / kx, scaleY: sy / ky, rotation: fields.rotation as number, cornerRadius: (fields.cornerRadius as number) ?? t.cornerRadius }, [cx, cy]);
        const mine = plain(keys);
        for (const k of mine.scale ?? []) {
          const v = k.value as number[];
          k.value = [v[0] / kx, (v[1] ?? v[0]) / ky];
        }
        set({ transform: next, keyframes: withKeys(clip, g, mine), ...(fields.flip ? { flip: plain(fields.flip) } : {}) });
        break;
      }
      case "blend":
        set({ blendMode: fields.blendMode, transform: clip.transform ? { ...clip.transform, opacity: fields.opacity as number } : clip.transform, keyframes: withKeys(clip, g, keys) });
        break;
      case "adjust":
        set({ color: plain(fields.color) ?? (isAdjustment(clip) ? {} : null), keyframes: withKeys(clip, g, keys) });
        break;
      case "chroma":
        set({ chroma: plain(fields.chroma), keyframes: withKeys(clip, g, keys) });
        break;
      case "effects": {
        // Each pasted effect is its own on this clip: a new id, its keys following it.
        const mine: Keys = {};
        const effects = (fields.effects as any[]).map((e) => {
          const id = newEffectId();
          for (const [p, list] of Object.entries(keys)) if (p.startsWith(`fx:${e.id}:`)) mine[`fx:${id}:${p.slice(`fx:${e.id}:`.length)}`] = list;
          return { ...plain(e), id };
        });
        set({ effects, keyframes: withKeys(clip, g, mine) });
        break;
      }
      case "animations": {
        const mine = ANIMATIONS[clip.type] ?? [];
        const p: Record<string, unknown> = {};
        for (const f of Object.keys(fields)) if (mine.includes(f)) p[f] = plain(fields[f]);
        set(p);
        break;
      }
      case "speed":
        set({
          ...(fields.speedCurve ? { speedCurve: plain(fields.speedCurve) } : { speed: fields.speed }),
          ...Object.fromEntries(SPEED_FIELDS.filter((f) => f in fields).map((f) => [f, plain(fields[f])])),
        });
        reverse = !!fields.reverse;
        break;
      case "audio":
        set({ ...plain(fields), keyframes: withKeys(clip, g, keys) });
        break;
      case "mask": {
        // New ids: two clips don't share a mask (the selection and the keys go by id).
        const masks = (fields.masks as any[]).map((m, i) => ({ ...plain(m), id: `mask-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}` }));
        set({ masks, masksOff: fields.masksOff });
        break;
      }
      case "text":
        set({ ...plain(fields), keyframes: withKeys(clip, g, keys) });
        break;
    }
  }
  return { patch: patch as Partial<AnyClipProps>, reverse };
};

/** The clips of `ids` that can take any group of `attrs`. */
export const pasteTargets = (attrs: ClipAttributes | null | undefined, clips: AnyClipProps[], ids: string[]): AnyClipProps[] =>
  clips.filter((c) => ids.includes(c.clipId) && pastableGroups(attrs, c).length > 0);
