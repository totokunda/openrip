// The player's guides, as CapCut's: lines across the canvas, dragged out of the rulers or added
// from the header menu (Guides and rulers ▸ Add horizontal / vertical guide), moved by
// dragging, edited or deleted from their right-click menu. They belong to the project: the
// clip store holds them beside the markers, so they're saved and undone with it. Clip drags and
// transforms snap to them (unless ⌘ is held, CapCut's "Cancel player alignment").
//
// A guide's place is a fraction of the canvas (lib/types.ts `Guide`); the rulers and the Edit
// guide dialog show it in the project's pixels with 0 at the canvas's middle and y upwards,
// as CapCut's do.
import { v4 as uuidv4 } from "uuid";
import { useClipStore } from "./clip";
import { usePlayerStore } from "./player";
import { useViewportStore } from "./viewport";
import { useEnginePreviewStore } from "./engine-preview";
import type { Guide } from "./types";

const setGuides = (fn: (guides: Guide[]) => Guide[]) => useClipStore.setState((s) => ({ guides: fn(s.guides ?? []) }));

/** A new guide (in the middle unless `at` says where); its id. Guides show if they were hidden. */
export function addGuide(axis: Guide["axis"], at = 0.5): string {
  const id = uuidv4();
  setGuides((g) => [...g, { id, axis, at }]);
  usePlayerStore.getState().setShowGuides(true);
  return id;
}

export function moveGuide(id: string, at: number) {
  if (!Number.isFinite(at)) return;
  setGuides((g) => g.map((x) => (x.id === id ? { ...x, at } : x)));
}

export function removeGuide(id: string) {
  setGuides((g) => g.filter((x) => x.id !== id));
}

export function clearGuides() {
  if ((useClipStore.getState().guides ?? []).length) setGuides(() => []);
}

/**
 * The project's canvas in pixels: the engine's, once it holds the project, else what it would
 * make of the canvas's ratio (1920 on the long side, as engine/crates/v1 `canvas_for_aspect`).
 */
export function canvasPixels(): { width: number; height: number } {
  const p = useEnginePreviewStore.getState().project;
  if (p && p.width > 0 && p.height > 0) return { width: p.width, height: p.height };
  const { width: aw, height: ah } = useViewportStore.getState().aspectRatio;
  if (aw >= 64 && ah >= 64 && Number.isInteger(aw) && Number.isInteger(ah) && aw <= 8192 && ah <= 8192) return { width: aw, height: ah };
  const even = (v: number) => Math.max(1, Math.round(v / 2)) * 2;
  return aw >= ah ? { width: 1920, height: even((1920 * ah) / aw) } : { width: even((1920 * aw) / ah), height: 1920 };
}

/** A guide's place in pixels from the canvas's middle (x rightwards, y upwards), as CapCut shows it. */
export function guidePixels(g: Pick<Guide, "axis" | "at">): number {
  const c = canvasPixels();
  return g.axis === "x" ? (g.at - 0.5) * c.width : (0.5 - g.at) * c.height;
}

/** The fraction for a place in pixels from the middle (the inverse of `guidePixels`). */
export function guideAtFromPixels(axis: Guide["axis"], px: number): number {
  const c = canvasPixels();
  return axis === "x" ? 0.5 + px / c.width : 0.5 - px / c.height;
}

/** In percent: −50 … 50 across the canvas, 0 in the middle, y upwards. */
export const guidePercent = (g: Pick<Guide, "axis" | "at">) => (g.axis === "x" ? g.at - 0.5 : 0.5 - g.at) * 100;
export const guideAtFromPercent = (axis: Guide["axis"], pct: number) => (axis === "x" ? 0.5 + pct / 100 : 0.5 - pct / 100);

// ⌘ held: no snapping to guides (CapCut's "Cancel player alignment", a long press of ⌘).
let metaHeld = false;
if (typeof window !== "undefined") {
  const track = (e: KeyboardEvent) => {
    metaHeld = e.metaKey;
  };
  window.addEventListener("keydown", track, true);
  window.addEventListener("keyup", track, true);
  window.addEventListener("blur", () => (metaHeld = false));
}

/** The guides clips snap to now: shown, and not with ⌘ held. */
function activeGuides(): Guide[] {
  if (metaHeld || !usePlayerStore.getState().showGuides) return [];
  return useClipStore.getState().guides ?? [];
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * For a clip being dragged (its box in canvas units, the canvas `rectWidth`×`rectHeight`):
 * the shift that brings its left or right edge or its middle onto a vertical guide, and its
 * top, bottom or middle onto a horizontal one, within `threshold`. An axis the canvas's own
 * lines already moved (`dx`/`dy` not 0) keeps that.
 */
export function snapToGuides(box: Box, rectWidth: number, rectHeight: number, threshold: number, dx = 0, dy = 0): { deltaX: number; deltaY: number } {
  const guides = activeGuides();
  if (!guides.length) return { deltaX: dx, deltaY: dy };
  const nearest = (axis: Guide["axis"], points: number[], size: number) => {
    let best: number | null = null;
    for (const g of guides) {
      if (g.axis !== axis) continue;
      const line = g.at * size;
      for (const p of points) {
        const d = line - p;
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
    }
    return best;
  };
  const sx = dx === 0 ? nearest("x", [box.x, box.x + box.width / 2, box.x + box.width], rectWidth) : null;
  const sy = dy === 0 ? nearest("y", [box.y, box.y + box.height / 2, box.y + box.height], rectHeight) : null;
  return { deltaX: sx ?? dx, deltaY: sy ?? dy };
}

/**
 * For a clip being resized by its handles: the edges that moved (against `oldBox`, both in
 * screen space, mapped to canvas units by the viewport's `position` and `scale`) go onto a
 * guide within `threshold`. `local` (canvas units) is changed in place.
 */
export function snapResizeToGuides(local: Box, oldBox: Box | undefined, position: { x: number; y: number }, scale: number, rectWidth: number, rectHeight: number, threshold: number) {
  const guides = activeGuides();
  if (!guides.length) return;
  const k = 1 / Math.max(0.0001, scale);
  const old = oldBox ? { x: (oldBox.x - position.x) * k, y: (oldBox.y - position.y) * k, width: oldBox.width * k, height: oldBox.height * k } : null;
  const moved = (a: number, b: number | undefined) => b === undefined || Math.abs(a - b) > 1e-6;
  const snap = (axis: Guide["axis"], value: number, size: number) => {
    let best: number | null = null;
    for (const g of guides) {
      if (g.axis !== axis) continue;
      const line = g.at * size;
      if (Math.abs(line - value) <= threshold && (best === null || Math.abs(line - value) < Math.abs(best - value))) best = line;
    }
    return best;
  };
  const [left, right, top, bottom] = [local.x, local.x + local.width, local.y, local.y + local.height];
  if (moved(left, old?.x)) {
    const s = snap("x", left, rectWidth);
    if (s !== null) {
      local.x = s;
      local.width = right - s;
    }
  }
  if (moved(right, old ? old.x + old.width : undefined)) {
    const s = snap("x", right, rectWidth);
    if (s !== null) local.width = s - local.x;
  }
  if (moved(top, old?.y)) {
    const s = snap("y", top, rectHeight);
    if (s !== null) {
      local.y = s;
      local.height = bottom - s;
    }
  }
  if (moved(bottom, old ? old.y + old.height : undefined)) {
    const s = snap("y", bottom, rectHeight);
    if (s !== null) local.height = s - local.y;
  }
}
