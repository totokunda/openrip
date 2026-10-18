import React, { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useViewportStore } from "@/lib/viewport";
import { ZOOM_MAX, ZOOM_MIN, centreOn, fitScale, setRelativeZoom, zoomIn, zoomOut } from "@/lib/player-zoom";
import { useEnginePreviewStore } from "@/lib/engine-preview";
import { ZoomGlyph, ZoomStepGlyph, useOwnerDocument } from "./player-ui";

const SLIDER_W = 104;

/** The zoom relative to fit, from the viewport store. */
const useRelativeZoom = () =>
  useViewportStore((s) => {
    const fit = fitScale(s.viewportSize, s.contentBounds);
    return fit > 0 ? Math.round((s.scale / fit) * 1000) / 1000 : 1;
  });

/**
 * The zoom slider, as CapCut's: a thin track, white up to the knob (a small upright pill), a
 * tick where the frame fits. Linear from 50% to 400% of fit.
 */
const ZoomSlider: React.FC = () => {
  const zoom = useRelativeZoom();
  const track = useRef<HTMLDivElement>(null);
  const frac = (z: number) => (Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
  const fromX = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    let z = ZOOM_MIN + f * (ZOOM_MAX - ZOOM_MIN);
    // It catches at fit.
    if (Math.abs(z - 1) < 0.06) z = 1;
    setRelativeZoom(z);
  };
  return (
    <div
      ref={track}
      role="slider"
      aria-label="Zoom"
      aria-valuemin={ZOOM_MIN * 100}
      aria-valuemax={ZOOM_MAX * 100}
      aria-valuenow={Math.round(zoom * 100)}
      data-testid="zoom-slider"
      data-zoom={zoom}
      tabIndex={0}
      className="relative h-5 flex items-center cursor-pointer outline-none"
      style={{ width: SLIDER_W }}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        fromX(e.clientX);
      }}
      onPointerMove={(e) => {
        if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) fromX(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") zoomIn();
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") zoomOut();
        else return;
        e.preventDefault();
      }}
    >
      <div className="absolute inset-x-0 h-[2px] rounded-full bg-[#4a4a4a]" />
      <div className="absolute left-0 h-[2px] rounded-full bg-[#e8e8e8]" style={{ width: `${frac(zoom) * 100}%` }} />
      <div className="absolute w-px h-[9px] bg-[#e8e8e8]" style={{ left: `${frac(1) * 100}%` }} />
      <div className="absolute w-[7px] h-[11px] -ml-[3.5px] rounded-[2px] bg-white shadow-[0_0_2px_rgba(0,0,0,0.5)]" style={{ left: `${frac(zoom) * 100}%` }} />
    </div>
  );
};

/**
 * The bottom bar's zoom button and its popover, as CapCut's: a 180×37 strip over the bar with
 * zoom out, the slider and zoom in.
 */
const ZoomPopover: React.FC = () => {
  const [ref, doc] = useOwnerDocument<HTMLButtonElement>();
  const [open, setOpen] = useState(false);
  const zoom = useRelativeZoom();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        ref={ref}
        title={`Zoom (${Math.round(zoom * 100)}%)`}
        aria-label="Zoom"
        data-testid="zoom-button"
        className={`h-6 w-6 flex items-center justify-center rounded-[4px] hover:bg-brand-light/[0.08] transition-colors cursor-pointer ${open ? "text-brand-lighter" : "text-[#cecece]"}`}
      >
        <ZoomGlyph className="w-[15px] h-[15px]" />
      </Popover.Trigger>
      <Popover.Portal container={doc?.body}>
        <Popover.Content
          data-testid="zoom-popover"
          side="top"
          align="center"
          sideOffset={-30}
          avoidCollisions={false}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="dark z-[120] w-[180px] h-[37px] px-2.5 flex items-center justify-between rounded-[8px] bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] text-[#e0e0e0] outline-none"
        >
          <button type="button" aria-label="Zoom out" data-testid="zoom-out" onClick={zoomOut} className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-brand-light/[0.08] cursor-pointer">
            <ZoomStepGlyph className="w-4 h-4" />
          </button>
          <ZoomSlider />
          <button type="button" aria-label="Zoom in" data-testid="zoom-in" onClick={zoomIn} className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-brand-light/[0.08] cursor-pointer">
            <ZoomStepGlyph plus className="w-4 h-4" />
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

/**
 * While the frame is bigger than the canvas area: a small map of it at the area's bottom
 * right, the part in view in the accent. Click or drag on it to look elsewhere (CapCut's
 * navigator).
 */
export const ZoomNavigator: React.FC = () => {
  const scale = useViewportStore((s) => s.scale);
  const position = useViewportStore((s) => s.position);
  const vs = useViewportStore((s) => s.viewportSize);
  const b = useViewportStore((s) => s.contentBounds);
  const frame = useRef<HTMLDivElement>(null);
  useEnginePreviewStore((s) => s.version);
  if (!b || !b.width || !b.height || !vs.width || !vs.height) return null;
  const [cw, ch] = [b.width * scale, b.height * scale];
  if (cw <= vs.width + 1 && ch <= vs.height + 1) return null;
  // At most 64 px on its long side.
  const k = 64 / Math.max(b.width, b.height);
  const [w, h] = [b.width * k, b.height * k];
  // The part in view, as fractions of the frame.
  const fx0 = Math.max(0, (-position.x / scale - b.x) / b.width);
  const fy0 = Math.max(0, (-position.y / scale - b.y) / b.height);
  const fx1 = Math.min(1, ((vs.width - position.x) / scale - b.x) / b.width);
  const fy1 = Math.min(1, ((vs.height - position.y) / scale - b.y) / b.height);
  const look = (e: React.PointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    centreOn(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  return (
    <div
      ref={frame}
      data-testid="zoom-navigator"
      className="absolute z-[16] right-2 bottom-2 bg-white/[0.16] border border-white/25 cursor-pointer"
      style={{ width: w, height: h }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        look(e);
      }}
      onPointerMove={(e) => {
        if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) look(e);
      }}
    >
      <div
        className="absolute bg-brand-accent/55"
        style={{ left: `${fx0 * 100}%`, top: `${fy0 * 100}%`, width: `${Math.max(0, fx1 - fx0) * 100}%`, height: `${Math.max(0, fy1 - fy0) * 100}%` }}
      />
    </div>
  );
};

export default ZoomPopover;
