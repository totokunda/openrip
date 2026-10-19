// CapCut's Linkage settings: with linkage on, the clips of the chosen kinds that sit over a main
// track clip move and get deleted with it (the main track closing up behind a deleted clip, a
// gap closed), besides the clips linked to it by `linkId` (a video and its extracted audio).
// The kinds are the dialog's boxes; the ones switched off are saved in the preferences
// (`linkageOff`). Plain functions of the clips and tracks, used by timeline-edit and the store.
import type { Asset, AnyClipProps, TimelineProps } from "./types";

export type LinkKind = "text" | "effects" | "stickers" | "filters" | "adjust" | "overlay" | "audio" | "soundEffects";

/** The dialog's boxes, in CapCut's order (it also lists Text to speech, which OpenRip has no clips of). */
export const LINK_KINDS: { id: LinkKind; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "effects", label: "Effects" },
  { id: "stickers", label: "Stickers" },
  { id: "filters", label: "Filters" },
  { id: "adjust", label: "Adjust" },
  { id: "overlay", label: "Overlay" },
  { id: "audio", label: "Audio" },
  { id: "soundEffects", label: "Sound effects" },
];

/** The kind of clip a dialog box covers, by what the clip is. */
export function linkKindOf(clip: AnyClipProps, assets: Record<string, Asset> = {}): LinkKind {
  switch (clip.type) {
    case "text":
      return "text";
    case "sticker":
    case "shape":
    case "draw":
      return "stickers";
    case "filter": {
      const f = clip as AnyClipProps & { adjustment?: boolean; effectId?: string; draftKind?: string };
      if (f.adjustment || f.draftKind === "adjustment") return "adjust";
      if (f.effectId || f.draftKind === "effect") return "effects";
      return "filters";
    }
    case "audio": {
      const a = assets[(clip as AnyClipProps & { assetId?: string }).assetId ?? ""];
      return a?.credit?.kind === "sound" ? "soundEffects" : "audio";
    }
    default:
      return "overlay";
  }
}

/**
 * The clips that move or go with `anchors` (main track clips): those of a kind that's on
 * (not in `off`) starting within an anchor's span, on any other track that isn't locked.
 */
export function carriedClips(
  clips: AnyClipProps[],
  timelines: TimelineProps[],
  mainId: string | undefined,
  anchors: AnyClipProps[],
  off: string[],
  assets: Record<string, Asset> = {},
): AnyClipProps[] {
  if (!mainId || anchors.length === 0) return [];
  const locked = new Set(timelines.filter((t) => t.locked).map((t) => t.timelineId));
  const anchorIds = new Set(anchors.map((a) => a.clipId));
  return clips.filter((c) => {
    if (c.hidden || c.timelineId === mainId || anchorIds.has(c.clipId) || locked.has(c.timelineId ?? "")) return false;
    if (off.includes(linkKindOf(c, assets))) return false;
    const start = c.startFrame ?? 0;
    return anchors.some((a) => start >= (a.startFrame ?? 0) && start < (a.endFrame ?? 0));
  });
}
