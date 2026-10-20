// Exporting part of the timeline: the selected clips (the clip menu's Export selected clips) or
// the range between In and Out (Range ▸ Export range). Each opens the Export dialog on a scope,
// which says what to write; lib/engine-preview.ts cuts the project down to it.
import { create } from "zustand";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { allClips } from "./compound";
import { toast } from "sonner";
import type { AnyClipProps } from "./types";

/** A media card to export as a file of its own (the card menu's Export selected clips): the media, and the part of it the In/Out handles chose. */
export type CardExport = {
  name: string;
  /** The media as the app's assets name it (the card's `assetUrl`). */
  path: string;
  type: "video" | "image" | "audio";
  /** The whole media's length in seconds (0 for a photo). */
  duration: number;
  inSec: number;
  outSec: number;
  width?: number;
  height?: number;
  /** Whether the media has sound. */
  audible: boolean;
};

/** What to export instead of the project: clips (by id), or a range of the timeline (in frames), what it is, and the name to propose. */
export type ExportScope = {
  clipIds: string[];
  /** Media cards, each written as its own file, named after the card (clipIds is then empty). */
  cards?: CardExport[];
  /** The span of the timeline to write, trimmed from every clip (clipIds is then empty). */
  range?: { start: number; end: number };
  kind: "video" | "audio" | "image";
  name: string;
};

export const useExportScope = create<{ scope: ExportScope | null; open: (scope: ExportScope) => void; close: () => void }>((set) => ({
  scope: null,
  open: (scope) => set({ scope }),
  close: () => set({ scope: null }),
}));

/** A file's name without its folder and extension, for the proposed export name. */
const stem = (path: string) => (path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");

/** The kind of file the clips make: sound alone is audio, one photo an image, else video. */
export function scopeKind(clips: AnyClipProps[]): ExportScope["kind"] | null {
  const real = clips.filter((c) => c.type === "video" || c.type === "image" || c.type === "audio");
  if (real.length === 0) return null;
  if (real.every((c) => c.type === "audio")) return "audio";
  if (real.length === 1 && real[0].type === "image") return "image";
  return "video";
}

/** Export selected clips: the selection's video, photo and audio clips. */
export function openClipsExport(ids: string[]) {
  const { getClipById, getAssetById } = useClipStore.getState();
  const picked = ids.map((id) => getClipById(id)).filter((c): c is AnyClipProps => !!c && !c.hidden && (c.type === "video" || c.type === "image" || c.type === "audio"));
  const kind = scopeKind(picked);
  if (!kind) return;
  const asset = picked[0] ? getAssetById((picked[0] as AnyClipProps & { assetId?: string }).assetId ?? "") : undefined;
  useExportScope.getState().open({ clipIds: picked.map((c) => c.clipId), kind, name: picked.length === 1 && asset ? stem(asset.path) || "export" : "export" });
}

/** The media card menu's Export selected clips: each card (with its In/Out range) as a file. */
export function openCardsExport(cards: CardExport[]) {
  if (cards.length === 0) return;
  const kind: ExportScope["kind"] = cards.every((c) => c.type === "audio") ? "audio" : cards.length === 1 && cards[0].type === "image" ? "image" : "video";
  useExportScope.getState().open({ clipIds: [], cards, kind, name: cards.length === 1 ? stem(cards[0].name) || "export" : "export" });
}

/** The seconds a card's file runs: its range, or a photo's duration. */
export const cardSeconds = (c: CardExport, imageSeconds: number) => (c.type === "image" ? imageSeconds : Math.max(0, c.outSec - c.inSec));

/** Range ▸ Export range: what's between In and Out. */
export function openRangeExport() {
  const range = useControlsStore.getState().range;
  if (!range) return;
  const { clips } = useClipStore.getState();
  const inside = allClips(clips.filter((c) => !c.hidden && (c.endFrame ?? 0) > range.start && (c.startFrame ?? 0) < range.end));
  if (inside.length === 0) {
    toast("There is nothing in the range to export");
    return;
  }
  useExportScope.getState().open({ clipIds: [], range, kind: scopeKind(inside) === "audio" ? "audio" : "video", name: "range" });
}
