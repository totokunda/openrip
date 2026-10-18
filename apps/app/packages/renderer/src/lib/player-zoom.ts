// The player's zoom as CapCut's: relative to the frame fitted in the canvas area (100% is
// "fit", the tick on the popover's slider), from 50% to 400%; − and + (and ⌥⇧− / ⌥⇧+) step
// it by 10%, ⌥⇧Z fits it again. The viewport store (lib/viewport.ts) holds the absolute scale
// the Konva stage draws at; this module turns one into the other and keeps the frame fitted
// (or at the same relative zoom) when the canvas area changes size: the rulers, the scopes or
// the panel itself.
import { useEffect } from "react";
import { useViewportStore } from "./viewport";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.1;
/** The margin "fit" leaves around the frame (viewport.ts `zoomToFit`'s default). */
const FIT_PADDING = 0.9;

type Size = { width: number; height: number };
type Bounds = { x: number; y: number; width: number; height: number } | null;

/** The absolute scale at which the canvas fits the area. */
export function fitScale(viewport: Size = useViewportStore.getState().viewportSize, bounds: Bounds = useViewportStore.getState().contentBounds): number {
  if (!bounds || !bounds.width || !bounds.height || !viewport.width || !viewport.height) return 0;
  return Math.min(viewport.width / bounds.width, viewport.height / bounds.height) * FIT_PADDING;
}

/** The zoom relative to fit (1 = fitted). */
export function relativeZoom(): number {
  const fit = fitScale();
  return fit > 0 ? useViewportStore.getState().scale / fit : 1;
}

/**
 * Zoom to `r` times the fitted size, about the middle of what's shown (fitted again, and
 * centred, at 1).
 */
export function setRelativeZoom(r: number) {
  const v = useViewportStore.getState();
  const fit = fitScale();
  if (!(fit > 0)) return;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, r));
  if (Math.abs(next - 1) < 0.005) {
    v.zoomToFit({ padding: FIT_PADDING });
    return;
  }
  const scale = next * fit;
  const centre = { x: v.viewportSize.width / 2, y: v.viewportSize.height / 2 };
  const world = { x: (centre.x - v.position.x) / v.scale, y: (centre.y - v.position.y) / v.scale };
  useViewportStore.setState({
    scale,
    maxScale: Math.max(v.maxScale, scale),
    position: clampPosition({ x: centre.x - world.x * scale, y: centre.y - world.y * scale }, scale),
  });
}

export const zoomIn = () => setRelativeZoom(Math.round((relativeZoom() + ZOOM_STEP) * 10) / 10);
export const zoomOut = () => setRelativeZoom(Math.round((relativeZoom() - ZOOM_STEP) * 10) / 10);
export const zoomFit = () => setRelativeZoom(1);

/**
 * The stage position, kept so the frame can't be panned away: zoomed in, the frame covers the
 * area's middle; smaller than the area, it stays centred on that axis.
 */
export function clampPosition(p: { x: number; y: number }, scale = useViewportStore.getState().scale) {
  const { viewportSize: vs, contentBounds: b } = useViewportStore.getState();
  if (!b) return p;
  const axis = (pos: number, view: number, start: number, size: number) => {
    const s = size * scale;
    if (s <= view) return (view - s) / 2 - start * scale;
    return Math.min(-start * scale, Math.max(view - s - start * scale, pos));
  };
  return { x: axis(p.x, vs.width, b.x, b.width), y: axis(p.y, vs.height, b.y, b.height) };
}

/** Pan so the canvas point (`fx`, `fy`, fractions of the frame) is in the middle of the area. */
export function centreOn(fx: number, fy: number) {
  const { viewportSize: vs, contentBounds: b, scale } = useViewportStore.getState();
  if (!b) return;
  const world = { x: b.x + fx * b.width, y: b.y + fy * b.height };
  useViewportStore.setState({ position: clampPosition({ x: vs.width / 2 - world.x * scale, y: vs.height / 2 - world.y * scale }, scale) });
}

/**
 * Keep the frame fitted (or at the same zoom relative to fit) when the canvas area or the
 * canvas changes: the area is `area`'s element, the preview's stage fills it. The project's
 * saved view comes back with the size of the window it was saved in, which is put right too.
 */
export function useKeepFit(area: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    let lastFit = 0;
    const measured = (): Size | null => {
      const el = area.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : null;
    };
    let applying = false;
    const apply = (forceFit: boolean) => {
      const v = useViewportStore.getState();
      const size = measured();
      if (!size || !v.contentBounds) return;
      applying = true;
      try {
        if (Math.abs(size.width - v.viewportSize.width) > 1 || Math.abs(size.height - v.viewportSize.height) > 1) {
          useViewportStore.setState({ viewportSize: size });
        }
        const fit = fitScale(size, v.contentBounds);
        if (!(fit > 0)) return;
        const rel = lastFit > 0 ? v.scale / lastFit : 1;
        lastFit = fit;
        if (forceFit || Math.abs(rel - 1) < 0.02) {
          useViewportStore.getState().zoomToFit({ padding: FIT_PADDING });
        } else {
          const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rel)) * fit;
          const s = useViewportStore.getState();
          const centre = { x: s.viewportSize.width / 2, y: s.viewportSize.height / 2 };
          const old = { x: (v.viewportSize.width / 2 - v.position.x) / v.scale, y: (v.viewportSize.height / 2 - v.position.y) / v.scale };
          useViewportStore.setState({ scale, maxScale: Math.max(s.maxScale, scale), position: clampPosition({ x: centre.x - old.x * scale, y: centre.y - old.y * scale }, scale) });
        }
      } finally {
        applying = false;
      }
    };
    // Opened fitted, as CapCut opens a project.
    const first = requestAnimationFrame(() => apply(true));
    const off = useViewportStore.subscribe((s, p) => {
      if (applying) return;
      const resized = s.viewportSize.width !== p.viewportSize.width || s.viewportSize.height !== p.viewportSize.height;
      const canvas = s.contentBounds !== p.contentBounds && (s.contentBounds?.width !== p.contentBounds?.width || s.contentBounds?.height !== p.contentBounds?.height);
      // A project's saved view put back (its scale, position and size from another session,
      // in one change; nothing else changes all three at once): fit.
      const restored = resized && s.scale !== p.scale && s.position !== p.position;
      if (resized || canvas || restored) queueMicrotask(() => apply(canvas || restored));
    });
    return () => {
      cancelAnimationFrame(first);
      off();
    };
  }, [area]);
}
