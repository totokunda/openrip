import React from "react";
import type { IconType } from "react-icons";
import { LuEraser, LuHighlighter, LuPenTool } from "react-icons/lu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import ColorInput from "@/components/properties/ColorInput";
import { useViewportStore } from "@/lib/viewport";
import { useDrawingStore, type DrawingTool } from "@/lib/drawing";
import { SHAPES, addShape } from "@/lib/shape-presets";
import type { ShapeTool } from "@/lib/types";
import { AssetSection, AssetTile } from "./AssetSection";

const PENS: { id: DrawingTool; label: string; icon: IconType; max: number }[] = [
  { id: "brush", label: "Pen", icon: LuPenTool, max: 30 },
  { id: "highlighter", label: "Highlighter", icon: LuHighlighter, max: 50 },
  { id: "eraser", label: "Eraser", icon: LuEraser, max: 100 },
];

/** A shape as its tile shows it: an outline in the tile's light grey. */
const ShapeGlyph: React.FC<{ shape: ShapeTool }> = ({ shape }) => {
  const common = { fill: "currentColor", fillOpacity: 0.85 };
  return (
    <svg viewBox="0 0 48 48" className="w-9 h-9 text-brand-light/80">
      {shape === "rectangle" && <rect x="6" y="11" width="36" height="26" rx="1.5" {...common} />}
      {shape === "ellipse" && <ellipse cx="24" cy="24" rx="18" ry="14" {...common} />}
      {shape === "polygon" && <polygon points="24,8 42,39 6,39" {...common} />}
      {shape === "line" && <line x1="6" y1="24" x2="42" y2="24" stroke="currentColor" strokeOpacity={0.85} strokeWidth="4" strokeLinecap="round" />}
      {shape === "star" && <polygon points="24,5 29.4,18.6 44,19.4 32.7,28.6 36.4,42.8 24,34.8 11.6,42.8 15.3,28.6 4,19.4 18.6,18.6" {...common} />}
    </svg>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-3">
    <span className="w-[72px] shrink-0 text-[11px] text-brand-light/70">{label}</span>
    <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
  </div>
);

/**
 * The Stickers tab's canvas sections, OpenRip's own (CapCut has neither): "draw", pens that
 * draw on the canvas until V or Esc (the D key picks the pen too), and "shapes", a shape
 * added at the playhead (or, after S, dragged out on the canvas).
 */
const CanvasToolsMenu: React.FC<{ part: "draw" | "shapes" }> = ({ part }) => {
  const tool = useViewportStore((s) => s.tool);
  const setTool = useViewportStore((s) => s.setTool);
  const drawing = useDrawingStore();
  const pen = PENS.find((p) => p.id === drawing.tool) ?? PENS[0];
  const size = drawing.tool === "highlighter" ? drawing.highlighterSize : drawing.tool === "eraser" ? drawing.eraserSize : drawing.brushSize;
  const setSize = (v: number) =>
    drawing.tool === "highlighter" ? drawing.setHighlighterSize(v) : drawing.tool === "eraser" ? drawing.setEraserSize(v) : drawing.setBrushSize(v);

  const draw = (
    <>
      <AssetSection title="Draw" note="Pick a pen, then draw on the canvas; the drawing is a clip of its own. V or Esc stops.">
        {PENS.map((p) => (
          <AssetTile
            key={p.id}
            label={p.label}
            testId={`draw-${p.id}`}
            active={tool === "draw" && drawing.tool === p.id}
            onClick={() => {
              drawing.setTool(p.id);
              setTool("draw");
            }}
          >
            <p.icon className="w-6 h-6 text-brand-light/80" />
          </AssetTile>
        ))}
      </AssetSection>
      <section className="flex flex-col gap-3 rounded-[6px] bg-brand-background-dark p-3">
        <Row label="Size">
          <Slider className="flex-1 dark" value={[size]} min={1} max={pen.max} step={1} onValueChange={(v) => setSize(v[0])} />
          <span className="w-7 text-right text-[11px] tabular-nums text-brand-light/80">{size}</span>
        </Row>
        {drawing.tool === "brush" && (
          <>
            <Row label="Smoothing">
              <Slider className="flex-1 dark" value={[drawing.smoothing * 100]} min={0} max={100} step={1} onValueChange={(v) => drawing.setSmoothing(v[0] / 100)} />
              <span className="w-7 text-right text-[11px] tabular-nums text-brand-light/80">{Math.round(drawing.smoothing * 100)}</span>
            </Row>
            <ColorInput
              size="medium"
              label="Colour"
              labelClass="text-brand-light/70 text-[11px]"
              value={drawing.color}
              onChange={drawing.setColor}
              percentValue={drawing.opacity}
              setPercentValue={drawing.setOpacity}
            />
          </>
        )}
        {tool === "draw" && (
          <button
            type="button"
            data-testid="draw-done"
            onClick={() => setTool("pointer")}
            className="h-8 rounded-[6px] text-[12px] font-medium text-brand-lighter bg-brand-accent-shade hover:bg-brand-accent-two-shade transition-colors"
          >
            Done drawing
          </button>
        )}
      </section>
    </>
  );

  const shapes = (
    <AssetSection title="Shapes" note="Added at the playhead in the middle of the canvas. Or press S and drag one out on the canvas.">
      {SHAPES.map((s) => (
        <AssetTile key={s.id} label={s.label} testId={`shape-${s.id}`} onClick={() => void addShape(s.id)}>
          <ShapeGlyph shape={s.id} />
        </AssetTile>
      ))}
    </AssetSection>
  );

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-3 pb-8">{part === "draw" ? draw : shapes}</div>
    </ScrollArea>
  );
};

export default CanvasToolsMenu;
