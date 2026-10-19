// The timeline's range (CapCut's Range), as plain functions over `useControlsStore().range`:
// In (I) and Out (O) set its ends at the playhead, Select by clip (⇧X) makes it the span of the
// selected clips, Deselect clears it. Export range writes what's inside it
// (lib/engine-preview.ts `trimmedToRange`).
import type { AnyClipProps } from "./types";

export type Range = { start: number; end: number };

/** The span the clips cover, or null when none count. */
export function spanOf(clips: AnyClipProps[]): Range | null {
  const real = clips.filter((c) => !c.hidden);
  if (real.length === 0) return null;
  const start = Math.min(...real.map((c) => c.startFrame ?? 0));
  const end = Math.max(...real.map((c) => c.endFrame ?? 0));
  return end > start ? { start, end } : null;
}

/**
 * The range after In (or Out) is set at `frame`. With no range yet, In runs to the end of the
 * timeline (`total`) and Out from its start; with one, only that end moves, and the ends never
 * cross.
 */
export function withEnd(range: Range | null, which: "in" | "out", frame: number, total: number): Range | null {
  const f = Math.max(0, Math.round(frame));
  if (which === "in") {
    const end = range ? range.end : Math.max(f + 1, total);
    return f < end ? { start: f, end } : null;
  }
  const start = range ? range.start : 0;
  return f > start ? { start, end: f } : null;
}
