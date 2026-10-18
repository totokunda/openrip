import React, { useRef } from "react";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useInspectorStore } from "@/lib/inspector";
import { useViewportStore } from "@/lib/viewport";
import { regionOf, trackingOf, useTrackingStore } from "@/lib/tracking-run";
import type { WorldRegion } from "@/lib/tracking";

/**
 * The motion-tracking region on the player: while the Tracking tab of a text, sticker or photo
 * is on Motion tracking, a box in the accent with a cross at its centre, dragged over what the
 * clip should follow in the video under it, sized from its corners and turned from the handle
 * above it (lib/tracking-run.ts keeps it; Start tracks it). It sits over the player's canvas
 * as plain elements, outside the canvas's own hit testing, so dragging it never moves or
 * deselects the clip.
 */

/** The smallest the box gets, in world units. */
const MIN_SIDE = 8;

type Drag = { kind: "move" | "size" | "turn"; startX: number; startY: number; region: WorldRegion };

const TrackingRegion: React.FC = () => {
  const clipId = useControlsStore((s) => s.selectedClipIds[s.selectedClipIds.length - 1]);
  const focusFrame = useControlsStore((s) => s.focusFrame);
  const clip = useClipStore((s) => (clipId ? s.getClipById(clipId) : undefined));
  const tab = useInspectorStore((s) => s.tab);
  const drawn = useTrackingStore((s) => (clipId ? s.regions[clipId] : undefined));
  const running = useTrackingStore((s) => s.running);
  const scale = useViewportStore((s) => s.scale);
  const position = useViewportStore((s) => s.position);
  const drag = useRef<Drag | null>(null);
  const settings = trackingOf(clip);
  const trackable = clip && (clip.type === "text" || clip.type === "image" || (clip.type === "filter" && (clip as any).draftKind === "sticker"));
  const showing = trackable && tab === "tracking" && settings.enabled && settings.mode === "motion" && focusFrame >= (clip!.startFrame ?? 0) && focusFrame < (clip!.endFrame ?? 0);
  if (!showing || !clip) return null;
  const r = drawn ?? regionOf(clip);
  const set = (next: WorldRegion) => useTrackingStore.getState().setRegion(clip.clipId, next);
  // The pointer in world units (the canvas group is at `position`, scaled by `scale`).
  const world = (e: React.PointerEvent) => {
    const box = (e.currentTarget as HTMLElement).closest("[data-tracking-layer]")!.getBoundingClientRect();
    return [(e.clientX - box.left - position.x) / scale, (e.clientY - box.top - position.y) / scale] as [number, number];
  };
  const begin = (kind: Drag["kind"]) => (e: React.PointerEvent) => {
    if (running) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, startX: e.clientX, startY: e.clientY, region: r };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const [px, py] = world(e);
    if (d.kind === "move") {
      set({ ...d.region, cx: d.region.cx + (e.clientX - d.startX) / scale, cy: d.region.cy + (e.clientY - d.startY) / scale });
    } else if (d.kind === "size") {
      // Sized about its centre: the corner follows the pointer in the box's own axes.
      const a = (-d.region.rotation * Math.PI) / 180;
      const [dx, dy] = [px - d.region.cx, py - d.region.cy];
      const [lx, ly] = [Math.cos(a) * dx - Math.sin(a) * dy, Math.sin(a) * dx + Math.cos(a) * dy];
      set({ ...d.region, width: Math.max(MIN_SIDE, 2 * Math.abs(lx)), height: Math.max(MIN_SIDE, 2 * Math.abs(ly)) });
    } else {
      // The handle above the box points at the pointer.
      const deg = (Math.atan2(py - d.region.cy, px - d.region.cx) * 180) / Math.PI + 90;
      set({ ...d.region, rotation: Math.round(((deg + 540) % 360) - 180) });
    }
  };
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    e.stopPropagation();
    drag.current = null;
  };
  const left = position.x + r.cx * scale;
  const top = position.y + r.cy * scale;
  const handle = "absolute w-2 h-2 bg-white border border-brand-accent rounded-[1px] pointer-events-auto";
  return (
    <div data-tracking-layer className="absolute inset-0 overflow-hidden pointer-events-none z-[5]">
      <div
        data-testid="tracking-region"
        data-region={JSON.stringify(r)}
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className={running ? "absolute border-[1.5px] border-dashed border-brand-accent pointer-events-none" : "absolute border-[1.5px] border-brand-accent pointer-events-auto cursor-move"}
        style={{ left, top, width: r.width * scale, height: r.height * scale, transform: `translate(-50%, -50%) rotate(${r.rotation}deg)`, boxShadow: "0 0 0 1px rgba(0,0,0,0.35)" }}
      >
        {/* The centre's cross. */}
        <div className="absolute left-1/2 top-1/2 w-3 h-px bg-brand-accent -translate-x-1/2" />
        <div className="absolute left-1/2 top-1/2 h-3 w-px bg-brand-accent -translate-y-1/2" />
        {!running && (
          <>
            {(["-left-1 -top-1 cursor-nwse-resize", "-right-1 -top-1 cursor-nesw-resize", "-left-1 -bottom-1 cursor-nesw-resize", "-right-1 -bottom-1 cursor-nwse-resize"] as const).map((at) => (
              <div key={at} data-testid="tracking-region-corner" className={`${handle} ${at}`} onPointerDown={begin("size")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
            ))}
            <div className="absolute left-1/2 -top-4 h-3 w-px bg-brand-accent" />
            <div data-testid="tracking-region-turn" className={`${handle} left-1/2 -top-[18px] -translate-x-1/2 rounded-full cursor-grab`} onPointerDown={begin("turn")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
          </>
        )}
      </div>
    </div>
  );
};

export default TrackingRegion;
