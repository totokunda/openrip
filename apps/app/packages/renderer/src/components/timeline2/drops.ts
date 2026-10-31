// Drops onto the new timeline from the panels (docs/plan/timeline-rewrite.md): media cards land
// the way a moved clip does (lib/timeline/gesture.ts `previewMove`: onto the track under the
// pointer, a new track on a line between tracks, in before or after a clip on the magnetic main
// track, snapped), shown while dragged as the slot where they'd land; the other tiles (effects,
// transitions, presets, shapes, stickers, adjustment layers, stock, subprojects) do what they did
// on the timeline before this one, at the frame or clip under the pointer.
import { useRef } from "react";
import { useDndMonitor, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { v4 as uuidv4 } from "uuid";
import type { AnyClipProps, Asset, FilterClipProps, ImageClipProps, VideoClipProps } from "@/lib/types";
import type { MediaItem } from "../media/Item";
import type { Filter } from "@/lib/types";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useViewportStore } from "@/lib/viewport";
import { imageDurationFrames } from "@/lib/preferences";
import { ensureFullMediaStats } from "@/lib/media/utils";
import { convertFrameRange } from "@/lib/media/fps";
import { addEffectBar, applyEffectToClip, takesEffects, useEffectDropStore } from "@/lib/effects/library";
import { applyPreset, useClipPresets } from "@/lib/clip-presets";
import { applyTransition, cutNear, useTransitionDropStore } from "@/lib/transitions";
import { addLibraryShape, type ShapeDrag } from "../menus/ShapesMenu";
import type { StickerDrag } from "../menus/StickersMenu";
import type { TransitionDrag } from "../menus/TransitionMenu";
import type { EffectDrag } from "../menus/EffectsMenu";
import type { PresetDrag } from "../menus/PresetsMenu";
import type { SubprojectDrag } from "@/components/menus/SubprojectsMenu";
import type { StockDrag } from "@/components/menus/StockLibraryMenu";
import { addSticker, useStickerLibrary } from "@/lib/stickers/library";
import { dropAdjustment, type AdjustmentDrag } from "@/lib/adjustment";
import { addCompoundInstance } from "@/lib/compound-edit";
import { addStock } from "@/lib/stock/library";
import { getTimelineTypeForClip } from "@/lib/timeline/core/tracks";
import { hitTest, type Layout } from "@/lib/timeline/layout";
import { framesFor } from "@/lib/timeline/view";
import { previewMove, type MovePreview } from "@/lib/timeline/gesture";

/** The id the card being dragged has on the timeline until it's let go. */
export const DROP_ID = "__timeline-drop__";

/** A media card over the timeline: where it would land, and where the pointer is. */
export interface DropState {
  preview: MovePreview | null;
  /** Canvas px. */
  x: number;
  y: number;
  label: string;
  length: number;
}

/** How far (px) a tile goes before its drag counts (less is the tile's own click). */
const MOVED = 3;
const isMedia = (t: unknown) => t === "video" || t === "image" || t === "audio" || t === "filter";

/** A card's length on the timeline in project frames: a video's or sound's (or its In/Out part), a photo's Image duration, a filter's default length. */
export const cardFrames = (data: MediaItem, fps: number, defaultSeconds: number): number => {
  const info = data.mediaInfo;
  const range = data.range;
  const ranged = (duration: number) => {
    if (!range || !(duration > 0)) return null;
    const a = Math.max(0, Math.min(range.inSec, duration));
    const b = Math.max(a, Math.min(range.outSec, duration));
    return Math.round((b - a) * fps);
  };
  if (data.type === "image") return imageDurationFrames(fps);
  if (data.type === "video") {
    const r = ranged(info?.duration ?? 0);
    if (r != null) return Math.max(1, r);
    const realFps = info?.stats?.video?.averagePacketRate ?? fps;
    return Math.max(1, convertFrameRange(0, (info?.duration ?? 0) * realFps, realFps, fps).end);
  }
  if (data.type === "audio") return Math.max(1, ranged(info?.duration ?? 0) ?? Math.round((info?.duration ?? 0) * fps));
  if (data.type === "filter") return Math.max(1, Math.round(fps * defaultSeconds));
  return 1;
};

/** The clip a card makes, at `startFrame` on `timelineId` (as the timeline before this one made it). */
function clipFromCard(data: MediaItem, timelineId: string, startFrame: number, length: number, fps: number): { clip: AnyClipProps; asset: Asset | null; size: [number, number] | null } {
  const info = data.mediaInfo;
  let trimStart = 0;
  let trimEnd = 0;
  let size: [number, number] | null = null;
  if (data.type === "video" || data.type === "audio") {
    const duration = info?.duration ?? 0;
    if (data.range && duration > 0) {
      const a = Math.max(0, Math.min(data.range.inSec, duration));
      const b = Math.max(a, Math.min(data.range.outSec, duration));
      trimStart = Math.round(a * fps);
      trimEnd = Math.max(0, Math.round((duration - b) * fps));
    }
    if (data.type === "video") size = [Number(info?.video?.displayWidth), Number(info?.video?.displayHeight)];
  } else {
    trimStart = Infinity;
    trimEnd = -Infinity;
    if (data.type === "image") size = [Number(info?.image?.width), Number(info?.image?.height)];
  }
  const asset = data.type === "audio" || data.type === "video" || data.type === "image" ? useClipStore.getState().addAsset({ path: data.assetUrl, credit: data.credit }) : null;
  const clip = { timelineId, clipId: uuidv4(), startFrame, endFrame: startFrame + length, type: data.type, trimStart, trimEnd, speed: 1.0 } as AnyClipProps;
  if (asset) (clip as VideoClipProps).assetId = asset.id;
  if (size && size[0] > 0 && size[1] > 0) {
    const media = clip as VideoClipProps | ImageClipProps;
    media.mediaWidth = size[0];
    media.mediaHeight = size[1];
    media.mediaAspectRatio = size[0] / size[1];
  }
  if (data.type === "image" || data.type === "video") (clip as VideoClipProps).masks = [];
  if (data.type === "filter") {
    const f = data as unknown as Filter;
    Object.assign(clip as FilterClipProps, { name: f.name, smallPath: f.smallPath, fullPath: f.fullPath, category: f.category, examplePath: f.examplePath, exampleAssetUrl: f.exampleAssetUrl });
  }
  return { clip, asset, size: size && size[0] > 0 && size[1] > 0 ? size : null };
}

/** The first video or photo on the timeline sets the project's shape to its own. */
const shapeFromFirst = (size: [number, number] | null) => {
  if (!size || useClipStore.getState().clips.some((c) => c.type === "video" || c.type === "image")) return;
  const [w, h] = size.map(Math.round);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h) || 1;
  useViewportStore.getState().setAspectRatio({ width: w, height: h, id: `${w / g}:${h / g}` });
};

export interface DropsApi {
  /** The canvas's element, for the pointer's place on it. */
  canvas: () => HTMLCanvasElement | null;
  layout: () => Layout | null;
  /** A media card's landing changed (null: it left the timeline or was let go). */
  setDrop: (drop: DropState | null) => void;
  /** Something marked on the timeline changed (an effect's target clip, a transition's cut). */
  redraw: () => void;
}

/** Wires the panels' drags to the new timeline. */
export function useTimelineDrops(api: DropsApi) {
  const card = useRef<{ data: MediaItem; length: number; preview: MovePreview | null } | null>(null);

  /** The pointer on the canvas for a drag event (null off it). */
  const pointerOf = (event: { activatorEvent: Event | null; delta: { x: number; y: number } }) => {
    const start = event.activatorEvent as PointerEvent | null;
    const canvas = api.canvas();
    if (!start || !canvas || typeof start.clientX !== "number") return null;
    const r = canvas.getBoundingClientRect();
    const x = start.clientX + event.delta.x - r.left;
    const y = start.clientY + event.delta.y - r.top;
    return x < 0 || y < 0 || x > r.width || y > r.height ? null : { x, y };
  };
  const moved = (event: { delta: { x: number; y: number } }) => Math.hypot(event.delta.x, event.delta.y) > MOVED;
  /** The frame and what's under the pointer (null off the timeline). */
  const under = (event: { activatorEvent: Event | null; delta: { x: number; y: number } }) => {
    const p = pointerOf(event);
    const l = api.layout();
    if (!p || !l) return null;
    const hit = hitTest(l, p.x, p.y, () => false);
    return { p, l, hit, frame: Math.max(0, Math.round(hit.frame)) };
  };
  /** The clip under the pointer, if any. */
  const clipUnder = (u: NonNullable<ReturnType<typeof under>>) => (u.hit.kind === "clip" ? u.hit.box.clip : null);

  /** A media card's landing for the pointer at (x, y). */
  const landing = (c: { data: MediaItem; length: number } | null, x: number, y: number) => {
    const l = api.layout();
    if (!c || !l) return null;
    const state = useClipStore.getState();
    const controls = useControlsStore.getState();
    // The card goes in as a clip of its kind that's nowhere yet, then moves where it's let go.
    const ghost = { clipId: DROP_ID, type: c.data.type, timelineId: "", startFrame: 0, endFrame: c.length, trimStart: Infinity, trimEnd: -Infinity } as unknown as AnyClipProps;
    const start = { clips: [...state.clips, ghost], tracks: state.timelines };
    const preview = previewMove(
      { start, lead: DROP_ID, followers: [], pressFrame: 0, leadStart: 0, length: c.length, leadTrack: "", newTrackId: uuidv4() },
      l,
      { magnet: state.magnet, linkage: controls.linkage, fps: controls.fps || 24 },
      { on: controls.snapping, playhead: controls.focusFrame, markers: state.markers, beats: [] },
      // The card's left edge is at the pointer.
      x,
      y,
    );
    return preview.spec.track ? preview : null;
  };

  useDndMonitor({
    onDragStart: (event: DragStartEvent) => {
      const data = event.active?.data?.current as unknown as MediaItem | undefined;
      if (!data || !isMedia(data.type)) return;
      const controls = useControlsStore.getState();
      card.current = { data, length: cardFrames(data, controls.fps || 24, controls.defaultClipLength), preview: null };
    },
    onDragMove: (event: DragMoveEvent) => {
      const data = event.active?.data?.current as { type?: string } | undefined;
      if (!data) return;
      if (data.type === "transition") {
        const u = under(event);
        const cut = u && (u.hit.kind === "clip" || u.hit.kind === "row") ? cutNear(useClipStore.getState().clips, u.hit.kind === "clip" ? u.hit.box.row.id : u.hit.row.id, u.hit.frame, framesFor(u.l.view, 24)) : null;
        useTransitionDropStore.getState().setTarget(cut);
        api.redraw();
        return;
      }
      if (data.type === "effect-preset") {
        const u = under(event);
        const clip = u ? clipUnder(u) : null;
        useEffectDropStore.getState().setTarget(clip && takesEffects(clip.type) ? clip.clipId : null);
        api.redraw();
        return;
      }
      const c = card.current;
      if (!c) return;
      const p = pointerOf(event);
      if (!p) {
        c.preview = null;
        api.setDrop(null);
        return;
      }
      c.preview = landing(c, p.x, p.y);
      api.setDrop({ preview: c.preview, x: p.x, y: p.y, label: c.data.name, length: c.length });
    },
    onDragEnd: (event: DragEndEvent) => {
      const data = event.active?.data?.current as { type?: string; [k: string]: unknown } | undefined;
      const c = card.current;
      card.current = null;
      api.setDrop(null);
      if (!data) return;
      const u = moved(event) ? under(event) : null;
      switch (data.type) {
        case "transition": {
          const target = useTransitionDropStore.getState().target;
          useTransitionDropStore.getState().setTarget(null);
          if (u && target) applyTransition(target, (data as unknown as TransitionDrag).transition);
          return;
        }
        case "effect-preset": {
          useEffectDropStore.getState().setTarget(null);
          if (!u) return;
          const clip = clipUnder(u);
          const effectId = (data as unknown as EffectDrag).effectId;
          if (clip && takesEffects(clip.type)) void applyEffectToClip(clip.clipId, effectId);
          else void addEffectBar(effectId, u.frame);
          return;
        }
        case "clip-preset": {
          const clip = u ? clipUnder(u) : null;
          const preset = useClipPresets.getState().presets.find((p) => p.id === (data as unknown as PresetDrag).id);
          if (!clip || !preset) return;
          const selected = useControlsStore.getState().selectedClipIds;
          applyPreset(preset, selected.includes(clip.clipId) ? selected : [clip.clipId]);
          return;
        }
        case "subproject":
          if (u) addCompoundInstance((data as unknown as SubprojectDrag).clipId, u.frame);
          return;
        case "sticker-tile": {
          const sticker = useStickerLibrary.getState().stickers.find((x) => x.id === (data as unknown as StickerDrag).id);
          if (u && sticker) void addSticker(sticker, { startFrame: u.frame });
          return;
        }
        case "adjustment-tile":
          if (u) dropAdjustment(data as unknown as AdjustmentDrag, u.frame);
          return;
        case "stock-tile":
          if (u) void addStock((data as unknown as StockDrag).item, { startFrame: u.frame });
          return;
        case "shape-preset":
          if (u) void addLibraryShape((data as unknown as ShapeDrag).shape, { startFrame: u.frame });
          return;
      }
      // A card let go on a folder of the Media tab goes into it (MediaMenu moves it), not onto the timeline.
      if (!c || String(event.over?.id ?? "").startsWith("folder:")) return;
      const p = pointerOf(event);
      if (!p) return;
      dropCard(c.data, c.length, landing(c, p.x, p.y));
    },
    onDragCancel: () => {
      card.current = null;
      api.setDrop(null);
      useTransitionDropStore.getState().setTarget(null);
      useEffectDropStore.getState().setTarget(null);
      api.redraw();
    },
  });
}

/**
 * A media card let go on the timeline: its clip goes where the drag showed. On an empty timeline
 * it starts the main track (or an audio track) at 0.
 */
export function dropCard(data: MediaItem, length: number, preview: MovePreview | null) {
  const state = useClipStore.getState();
  const fps = useControlsStore.getState().fps || 24;
  if (!data.mediaInfo && data.type !== "filter") return;
  let trackId: string;
  let startFrame: number;
  if (state.timelines.length === 0) {
    trackId = uuidv4();
    startFrame = 0;
    state.addTimeline({ timelineId: trackId, type: getTimelineTypeForClip(data) });
  } else {
    if (!preview) return;
    const spec = preview.spec;
    trackId = spec.track;
    // Onto the magnetic main track the clip goes in at a clip's start, the store making room.
    startFrame = spec.insertAt ?? Math.max(0, spec.delta);
    // addTimeline puts a track after the one at the index it's given.
    if (spec.newTrack) state.addTimeline({ timelineId: trackId, type: spec.newTrack.type }, spec.newTrack.index - 1);
  }
  const { clip, size } = clipFromCard(data, trackId, startFrame, length, fps);
  shapeFromFirst(size);
  state.addClip(clip);
  // Full stats once the clip is on the timeline (media only).
  if (data.assetUrl && (data.type === "video" || data.type === "audio")) void ensureFullMediaStats(data.assetUrl);
}
