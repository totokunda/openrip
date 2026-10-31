// How a clip looks on the new timeline (docs/plan/capcut-ui-spec.md §2.3, §4.11): its body and
// chip colours, its label chips, and for a video or photo the bands its label, thumbnails and
// own sound take. The colours are OpenRip's family (lib/timeline-colors.ts). Pure.
import type { AnyClipProps, Asset, FilterClipProps, GroupClipProps, ShapeClipProps, TextClipProps, VideoClipProps } from "../types.ts";
import { TIMELINE_COLORS } from "../timeline-colors.ts";
import { SOUND_COLORS, mediaBands, soundKindOf } from "../waveform.ts";

export interface ClipLook {
  body: string;
  chip: string;
  /** The label chips, left to right: a media clip's name and length, a text's words. */
  chips: string[];
  /** A glyph before the first chip. */
  glyph?: "compound" | "effect";
  /** A video's or photo's effects chip ("Blur", "3 effects"). */
  effects?: string;
  /** A video's or photo's bands, top to bottom (null for the one-band kinds). */
  bands: { label: number; thumbs: number; sound: number } | null;
  /** Whether the chips sit in a top band (media and sound) or centred in a one-line bar. */
  chipsOnTop: boolean;
}

/** "HH:MM:SS:FF", as CapCut's length chip. */
export const timecode = (frames: number, fps: number) => {
  const f = Math.max(0, Math.round(frames));
  const r = Math.max(1, Math.round(fps));
  const s = Math.floor(f / r);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f % r)}`;
};

/** A media path's file name, without a detach's `#audio` or `#video`. */
export const fileName = (path: string | undefined) => {
  const name = (path ?? "").replace(/#(audio|video)$/, "").split("/").pop() ?? "";
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};

const FILTER_KINDS: Record<string, string> = {
  filter: TIMELINE_COLORS.filter,
  effect: TIMELINE_COLORS.effect,
  sticker: TIMELINE_COLORS.sticker,
  adjustment: TIMELINE_COLORS.adjustment,
};
/** A one-band bar's chip: 9% white over the body. */
const BAR_CHIP = "rgba(255,255,255,0.09)";

/** The effects chip's words: the effect's name, or how many there are. */
const effectsLabel = (effects: { name: string }[] | undefined) =>
  !effects?.length ? undefined : effects.length === 1 ? effects[0].name || "Effect" : `${effects.length} effects`;

/**
 * How `clip` looks: `asset` is its media's (if it has any), `height` its row's band, `main`
 * whether it's on the main track.
 */
export const clipLook = (clip: AnyClipProps, asset: Pick<Asset, "path" | "type" | "credit"> | undefined, fps: number, height: number, main: boolean): ClipLook => {
  const len = Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));
  switch (clip.type) {
    case "video":
    case "image": {
      const v = clip as VideoClipProps;
      return {
        body: TIMELINE_COLORS.video,
        chip: TIMELINE_COLORS.videoChip,
        chips: [v.compound ? v.name ?? "Compound clip" : fileName(asset?.path), timecode(len, fps)],
        glyph: v.compound ? "compound" : undefined,
        effects: effectsLabel(v.effects),
        bands: mediaBands(height, main),
        chipsOnTop: true,
      };
    }
    case "audio": {
      const colors = SOUND_COLORS[soundKindOf(asset)];
      return { body: colors.body, chip: colors.chip, chips: [asset?.credit?.title ?? fileName(asset?.path).replace(/\.[^.]+$/, "")], bands: null, chipsOnTop: true };
    }
    case "text":
      return { body: TIMELINE_COLORS.text, chip: BAR_CHIP, chips: [((clip as TextClipProps).text ?? "").replace(/\n/g, " ")], bands: null, chipsOnTop: false };
    case "shape": {
      const s = clip as ShapeClipProps;
      // CapCut's tags: "Shape to draw" while the Pen draws it, then "Custom shape"; its library's shapes are "Shapes".
      const label = s.penDrawing ? "Shape to draw" : s.shapeType === "path" ? "Custom shape" : "Shapes";
      return { body: TIMELINE_COLORS.shape, chip: BAR_CHIP, chips: [label], bands: null, chipsOnTop: false };
    }
    case "sticker":
      return { body: TIMELINE_COLORS.sticker, chip: BAR_CHIP, chips: [(clip as { name?: string }).name ?? "Sticker"], bands: null, chipsOnTop: false };
    case "filter": {
      const f = clip as FilterClipProps;
      const kind = f.effectId ? "effect" : f.draftKind ?? "filter";
      return { body: FILTER_KINDS[kind] ?? TIMELINE_COLORS.filter, chip: BAR_CHIP, chips: [f.name ?? "Filter"], glyph: f.effectId ? "effect" : undefined, bands: null, chipsOnTop: false };
    }
    case "draw":
      return { body: TIMELINE_COLORS.drawing, chip: BAR_CHIP, chips: ["Drawing"], bands: null, chipsOnTop: false };
    case "group":
      // A text template's container (its parts hidden under it): a text bar with the template's name.
      return { body: TIMELINE_COLORS.text, chip: BAR_CHIP, chips: [(clip as GroupClipProps).template?.name ?? "Text template"], bands: null, chipsOnTop: true };
    default:
      return { body: TIMELINE_COLORS.video, chip: TIMELINE_COLORS.videoChip, chips: [], bands: null, chipsOnTop: false };
  }
};
