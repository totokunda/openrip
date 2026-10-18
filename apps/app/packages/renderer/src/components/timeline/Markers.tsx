// Timeline markers, as CapCut has them: M adds one at the playhead; it shows as a small tag in
// its colour, hanging below the ruler at its time. A click goes to it (and selects it: Delete
// removes it), a drag moves it (snapping like a clip), and a double-click or Edit marker in its
// menu opens a box above the ruler for its name, time and colour. The tags draw inside the
// ruler's Konva layer; the box is plain DOM over the timeline, so both drop into any layout.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Group, Rect, Shape } from "react-konva";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useContextMenuStore } from "@/lib/context-menu";
import { MARKER_COLORS, SNAP_PX, snapPoints, snapToPoints } from "@/lib/timeline-edit";
import { cn } from "@/lib/utils";
import { formatTimecode, parseTimecode } from "@/lib/timecode";

/** The marker whose box is open, if any. */
export const useMarkerEditorStore = create<{ markerId: string | null; open: (id: string) => void; close: () => void }>((set) => ({
  markerId: null,
  open: (id) => set({ markerId: id }),
  close: () => set({ markerId: null }),
}));

// The tag (CapCut's: 10 px wide, square-shouldered with rounded top corners, pointed below),
// hanging from the ruler's foot down to the first track.
const FLAG_HALF = 5;
const FLAG_TOP = 19;
const FLAG_SHOULDER = 27;
const FLAG_BOTTOM = 31;

// A time in frames as CapCut writes it, HH:MM:SS:FF, and back, in Settings › Edit › Time
// code's style (lib/timecode.ts).
export { formatTimecode, parseTimecode };

/** The markers' tags, for the ruler's layer. The selected one has a white edge. */
export const MarkerFlags: React.FC<{ stageWidth: number; startPadding: number }> = ({ stageWidth, startPadding }) => {
  const markers = useClipStore((s) => s.markers);
  const [start, end] = useControlsStore((s) => s.timelineDuration);
  const selectedId = useControlsStore((s) => s.selectedMarkerId);
  const span = Math.max(1, end - start);
  const xOf = (f: number) => startPadding + ((f - start) / span) * stageWidth;
  const frameOf = (x: number) => Math.max(0, Math.round(start + ((x - startPadding) / stageWidth) * span));

  // Dragged along the ruler, a marker snaps to the playhead and clip edges as a clip does.
  const snapX = (x: number) => {
    const controls = useControlsStore.getState();
    const f = frameOf(x);
    if (!controls.snapping) return xOf(f);
    const { clips } = useClipStore.getState();
    const hit = snapToPoints([f], snapPoints(clips, { playhead: controls.focusFrame, markers: [], exclude: new Set() }), (SNAP_PX * span) / stageWidth);
    return xOf(hit ? hit.point : f);
  };

  return (
    <>
      {markers.map((m) => {
        const x = xOf(m.frame);
        if (x < startPadding - FLAG_HALF || x > startPadding + stageWidth + FLAG_HALF) return null;
        const selected = m.id === selectedId;
        return (
          <Group
            key={m.id}
            name="timeline-marker"
            x={x}
            y={0}
            draggable
            dragBoundFunc={(pos) => ({ x: snapX(pos.x), y: 0 })}
            onMouseDown={(e) => {
              // Not the ruler's pan.
              e.cancelBubble = true;
            }}
            onClick={(e) => {
              e.cancelBubble = true;
              const controls = useControlsStore.getState();
              if (controls.isPlaying) controls.pause();
              controls.setFocusFrame(m.frame, false);
              controls.setIsAccurateSeekNeeded(true);
              controls.clearSelection();
              controls.setSelectedMarkerId(m.id);
            }}
            onDblClick={(e) => {
              e.cancelBubble = true;
              useMarkerEditorStore.getState().open(m.id);
            }}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              useControlsStore.getState().setSelectedMarkerId(m.id);
              useContextMenuStore.getState().openMenu({
                position: { x: e.evt.clientX, y: e.evt.clientY },
                target: { type: "marker", markerId: m.id },
                groups: [
                  {
                    id: "marker",
                    items: [
                      { id: "edit", label: "Edit marker", action: "editMarker" },
                      { id: "delete", label: "Delete marker", action: "deleteMarker", shortcut: "Del" },
                      { id: "deleteAll", label: "Delete all markers in timeline", action: "deleteAllMarkers" },
                    ],
                  },
                ],
              });
            }}
            onDragEnd={(e) => {
              useClipStore.getState().updateMarker(m.id, { frame: frameOf(e.target.x()) });
            }}
            onMouseEnter={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = "pointer";
            }}
            onMouseLeave={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = "default";
            }}
          >
            {/* A wider target than the tag itself. */}
            <Rect x={-FLAG_HALF - 2} y={FLAG_TOP - 6} width={FLAG_HALF * 2 + 4} height={FLAG_BOTTOM - FLAG_TOP + 8} fill="rgba(0,0,0,0)" />
            <Shape
              sceneFunc={(ctx, shape) => {
                const r = 1.5;
                ctx.beginPath();
                ctx.moveTo(-FLAG_HALF, FLAG_TOP + r);
                ctx.quadraticCurveTo(-FLAG_HALF, FLAG_TOP, -FLAG_HALF + r, FLAG_TOP);
                ctx.lineTo(FLAG_HALF - r, FLAG_TOP);
                ctx.quadraticCurveTo(FLAG_HALF, FLAG_TOP, FLAG_HALF, FLAG_TOP + r);
                ctx.lineTo(FLAG_HALF, FLAG_SHOULDER);
                ctx.lineTo(0, FLAG_BOTTOM);
                ctx.lineTo(-FLAG_HALF, FLAG_SHOULDER);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
              }}
              fill={m.color}
              stroke={selected ? "#FFFFFF" : undefined}
              strokeWidth={selected ? 1.5 : 0}
            />
          </Group>
        );
      })}
    </>
  );
};

/** A colour as a small tag, as the box's swatches show them. */
const Swatch: React.FC<{ color: string; selected: boolean; onClick: () => void }> = ({ color, selected, onClick }) => (
  <button title={color} aria-label={`Colour ${color}`} onClick={onClick} className="cursor-pointer p-1">
    <svg width={selected ? 12 : 9} height={selected ? 14 : 11} viewBox="0 0 10 12" className="block">
      <path d="M1.5 0.5h7a1 1 0 0 1 1 1V8L5 11.5 0.5 8V1.5a1 1 0 0 1 1-1z" fill={color} stroke={selected ? "#FFFFFF" : "none"} strokeWidth={selected ? 1.2 : 0} />
    </svg>
  </button>
);

/**
 * The open marker's box, as CapCut's: its name and time (HH:MM:SS:FF) in fields, its colour,
 * Delete and Done. It sits above the ruler, over the marker; `anchor` is the timeline's canvas
 * area.
 */
export const MarkerEditor: React.FC<{ anchor: React.RefObject<HTMLDivElement | null>; stageWidth: number; startPadding: number }> = ({
  anchor,
  stageWidth,
  startPadding,
}) => {
  const markerId = useMarkerEditorStore((s) => s.markerId);
  const close = useMarkerEditorStore((s) => s.close);
  const marker = useClipStore((s) => s.markers.find((m) => m.id === markerId));
  const [start, end] = useControlsStore((s) => s.timelineDuration);
  const fps = useControlsStore((s) => s.fps);
  const [note, setNote] = useState("");
  const [time, setTime] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fields = useRef({ note, time });
  fields.current = { note, time };

  useEffect(() => {
    if (!marker) return;
    setNote(marker.note);
    setTime(formatTimecode(marker.frame, useControlsStore.getState().fps));
    // Only when another marker opens: typing keeps its own text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerId]);

  // The name and time are saved when the box closes (one undo step), not at each key.
  const done = () => {
    const m = useClipStore.getState().markers.find((x) => x.id === useMarkerEditorStore.getState().markerId);
    if (m) {
      const frame = parseTimecode(fields.current.time, useControlsStore.getState().fps);
      const patch: { note?: string; frame?: number } = {};
      if (fields.current.note !== m.note) patch.note = fields.current.note;
      if (frame != null && frame !== m.frame) patch.frame = frame;
      if (Object.keys(patch).length > 0) useClipStore.getState().updateMarker(m.id, patch);
    }
    close();
  };

  useEffect(() => {
    if (!markerId) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) done();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerId]);

  // A marker deleted while its box is open (an undo, say) closes it.
  useEffect(() => {
    if (markerId && !marker) close();
  }, [markerId, marker, close]);

  if (!markerId || !marker || !anchor.current) return null;
  const rect = anchor.current.getBoundingClientRect();
  // The timeline's own window (it can be pulled out into one of its own).
  const doc = anchor.current.ownerDocument;
  const view = doc.defaultView ?? window;
  const x = rect.left + startPadding + ((marker.frame - start) / Math.max(1, end - start)) * stageWidth;
  const width = 340;
  const left = Math.max(8, Math.min(view.innerWidth - width - 8, x - width / 2));
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") done();
    else if (e.key === "Escape") close();
  };
  const field =
    "w-full h-8 rounded-[4px] bg-brand-background border border-transparent px-2 text-[13px] text-brand-light outline-none focus:border-brand-light/20";

  return createPortal(
    <div
      ref={boxRef}
      data-marker-editor
      style={{ position: "fixed", left, bottom: view.innerHeight - rect.top + 6, width, zIndex: 100 }}
      className="rounded-lg border border-black/60 bg-brand-background-light shadow-xl px-4 pt-4 pb-3 text-brand-light"
    >
      <input autoFocus aria-label="Marker name" value={note} placeholder="Name" onChange={(e) => setNote(e.target.value)} onKeyDown={keys} className={field} />
      <input aria-label="Marker time" value={time} onChange={(e) => setTime(e.target.value)} onKeyDown={keys} className={cn(field, "mt-2 tabular-nums")} title={`HH:MM:SS:FF at ${Math.round(fps)} fps`} />
      <div className="flex items-center justify-center gap-x-3 mt-3 h-5">
        {MARKER_COLORS.map((c) => (
          <Swatch
            key={c}
            color={c}
            selected={c.toLowerCase() === marker.color.toLowerCase()}
            onClick={() => useClipStore.getState().updateMarker(marker.id, { color: c })}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-x-2 mt-3">
        <button
          onClick={() => {
            useClipStore.getState().removeMarker(marker.id);
            close();
          }}
          className="h-7 min-w-[72px] px-3 rounded-[4px] bg-brand-light/20 hover:bg-brand-light/25 text-[13px] font-medium cursor-pointer"
        >
          Delete
        </button>
        <button onClick={done} className="h-7 min-w-[72px] px-3 rounded-[4px] bg-brand-accent hover:bg-brand-accent-shade text-white text-[13px] font-medium cursor-pointer">
          Done
        </button>
      </div>
    </div>,
    doc.body,
  );
};
