import React, { useEffect, useState } from "react";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SHAPES, addShape, type LibraryShape } from "@/lib/shape-presets";
import { startPen } from "@/lib/pen";
import { useShapePreviewStore } from "@/lib/shape-library-preview";
import { useViewportStore } from "@/lib/viewport";
import { cn } from "@/lib/utils";

/** A Shapes tile, the Pen's included, as a drag carries it. */
export type ShapeDrag = { type: "shape-preset"; shape: LibraryShape | "pen" };

/**
 * A shape from the library at the playhead (or `startFrame`), or the Pen's shape to draw.
 * `center` (world units) places a preset where it was dropped on the player.
 */
export const addLibraryShape = (shape: LibraryShape | "pen", opts: { startFrame?: number; center?: { x: number; y: number } } = {}) => {
  // What was being previewed is now a clip (or being drawn).
  useShapePreviewStore.getState().set(null);
  return shape === "pen" ? startPen({ startFrame: opts.startFrame }) : addShape(shape, opts);
};

/**
 * The tiles' glyphs, OpenRip's own: each shape as a light outline over a dark fill, sized as
 * CapCut's tiles show theirs (in the 86-unit tile).
 */
const Glyph: React.FC<{ shape: LibraryShape | "pen" }> = ({ shape }) => {
  const line = { stroke: "#e0e0e0", strokeWidth: 2, strokeLinejoin: "miter" as const, fill: "#303030" };
  return (
    <svg viewBox="0 0 86 86" className="absolute inset-0 w-full h-full" aria-hidden>
      {shape === "rectangle" && <rect x="23" y="24" width="39" height="39" {...line} />}
      {shape === "ellipse" && <circle cx="42.5" cy="43.5" r="21.5" {...line} />}
      {shape === "triangle" && <polygon points="43.25,24.5 65.5,62.5 21,62.5" {...line} />}
      {shape === "parallelogram" && <polygon points="34.67,25.5 67,25.5 50.33,61.5 18,61.5" {...line} />}
      {shape === "trapezoid" && <polygon points="32.5,26.5 54.5,26.5 66,60.5 21,60.5" {...line} />}
      {shape === "line" && <line x1="23" y1="43.5" x2="64" y2="43.5" stroke="#e0e0e0" strokeWidth="2" />}
      {shape === "arrow" && (
        <g stroke="#e0e0e0" strokeWidth="2" fill="none">
          <line x1="23" y1="43" x2="62" y2="43" />
          <polyline points="57,38 62.5,43 57,48" />
        </g>
      )}
      {shape === "pen" && (
        <g>
          {/* A curve between two points, a handle on the first, and a nib drawing it. */}
          <path d="M22 60 C 26 34, 48 26, 62 30" stroke="#e0e0e0" strokeWidth="2" fill="none" />
          <line x1="22" y1="60" x2="30" y2="38" stroke="#e0e0e0" strokeWidth="1" />
          <rect x="19.5" y="57.5" width="5" height="5" fill="#303030" stroke="#e0e0e0" strokeWidth="1.5" />
          <rect x="59.5" y="27.5" width="5" height="5" fill="#303030" stroke="#e0e0e0" strokeWidth="1.5" />
          <circle cx="30" cy="38" r="2" fill="#e0e0e0" />
          <path d="M50 66 L56 48 L66 58 Z" fill="#303030" stroke="#e0e0e0" strokeWidth="2" strokeLinejoin="round" />
          <line x1="56" y1="48" x2="54.5" y2="58.5" stroke="#e0e0e0" strokeWidth="1.2" />
        </g>
      )}
    </svg>
  );
};

/**
 * One 86 px tile, as CapCut's: #3b3b3b with a hairline edge, the glyph centred, no name. A
 * click previews the shape in the player (the menu's drag monitor); on hover a dark "+" at its
 * bottom-right adds it at the playhead; dragged, it goes where it's let go (the timeline: at
 * that time; the player: at the playhead, there). The Pen's click starts drawing.
 */
const Tile: React.FC<{ shape: LibraryShape | "pen"; label: string; title?: string }> = ({ shape, label, title }) => {
  const previewed = useShapePreviewStore((s) => s.shape === shape);
  const id = `shape-tile-${shape}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { type: "shape-preset", shape } satisfies ShapeDrag });
  const [hover, setHover] = useState(false);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      aria-label={label}
      title={title}
      data-testid={`shape-${shape}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        "relative w-[86px] h-[86px] shrink-0 rounded-[4px] bg-brand-background-light border-[0.5px] border-[#4a4a4a] cursor-pointer select-none",
        previewed && "ring-[1.5px] ring-brand-accent",
        isDragging && "opacity-50",
      )}
    >
      <Glyph shape={shape} />
      {hover && !isDragging && (
        <button
          type="button"
          title={shape === "pen" ? "Draw a shape" : `Add ${label}`}
          data-testid={`shape-add-${shape}`}
          // The tile's drag starts on a press: the button keeps its own.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void addLibraryShape(shape);
          }}
          className="absolute right-1 bottom-1 w-[18px] h-[18px] rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white text-[13px] leading-none"
        >
          +
        </button>
      )}
    </div>
  );
};

/**
 * Stickers ▸ Shapes, as CapCut's library: seven shapes and the Pen, 86 px tiles in rows 16 px
 * apart across and 30 px down, 12 px in from the column.
 */
const ShapesMenu: React.FC = () => {
  // The preview belongs to the tab: leaving it clears it.
  useEffect(() => () => useShapePreviewStore.getState().set(null), []);
  useDndMonitor({
    onDragEnd: (event) => {
      const data = event.active?.data?.current as ShapeDrag | undefined;
      if (data?.type !== "shape-preset") return;
      const moved = Math.hypot(event.delta.x, event.delta.y) > 3;
      // A press without a move is the tile's click (the context has no activation distance):
      // it previews the shape in the player, the Pen's starts drawing.
      if (!moved) {
        if (data.shape === "pen") void addLibraryShape("pen");
        else useShapePreviewStore.getState().set(data.shape);
        return;
      }
      // Let go on the player: at the playhead, where it was let go (the timeline adds its own).
      const start = event.activatorEvent as PointerEvent | null;
      const stage = document.querySelector("[data-testid=player] .konvajs-content") as HTMLElement | null;
      if (!start || !stage || typeof start.clientX !== "number") return;
      const r = stage.getBoundingClientRect();
      const cx = start.clientX + event.delta.x;
      const cy = start.clientY + event.delta.y;
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return;
      const { position, scale } = useViewportStore.getState();
      const center = { x: (cx - r.left - position.x) / scale, y: (cy - r.top - position.y) / scale };
      void addLibraryShape(data.shape, data.shape === "pen" ? {} : { center });
    },
  });

  return (
    <ScrollArea className="h-full">
      <div data-testid="shapes-library" className="grid grid-cols-[repeat(auto-fill,86px)] gap-x-4 gap-y-[30px] pl-3 pr-3 pt-4 pb-8">
        {SHAPES.map((s) => (
          <Tile key={s.id} shape={s.id} label={s.label} />
        ))}
        <Tile shape="pen" label="Pen" title="Custom" />
      </div>
    </ScrollArea>
  );
};

export default ShapesMenu;
