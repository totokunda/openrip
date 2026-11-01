// What part of the timeline is on screen, and the one mapping between its frames and the
// canvas's pixels (docs/plan/timeline-rewrite.md). Everything the new timeline draws or hit-tests
// goes through these, where the timeline before it worked the mapping out again in a dozen places.
// Pure: no stores.
import { TIME_ZERO_X } from "../timeline-geometry.ts";

export interface TimelineView {
  /** The first frame shown at `x0`, and the frame shown at the canvas's right edge. */
  start: number;
  end: number;
  /** Where time starts on the canvas: CapCut's 50 px Cover column is left of it. */
  x0: number;
  /** The width the window's frames are spread over, from `x0` to the canvas's right edge. */
  width: number;
}

/** The view a window of frames gives on a canvas `canvasWidth` px wide. */
export const viewOf = (window: readonly [number, number], canvasWidth: number): TimelineView => ({
  start: window[0],
  end: Math.max(window[0] + 1e-6, window[1]),
  x0: TIME_ZERO_X,
  width: Math.max(1, canvasWidth - TIME_ZERO_X),
});

/** Pixels a frame takes at this zoom. */
export const pxPerFrame = (v: TimelineView) => v.width / (v.end - v.start);

/** Where frame `f` is drawn (fractional frames are fine). */
export const xOf = (v: TimelineView, f: number) => v.x0 + ((f - v.start) * v.width) / (v.end - v.start);

/** The frame at canvas x, fractional. */
export const frameAt = (v: TimelineView, x: number) => v.start + ((x - v.x0) * (v.end - v.start)) / v.width;

/** The whole frame nearest canvas x, at 0 or later. */
export const frameNear = (v: TimelineView, x: number) => Math.max(0, Math.round(frameAt(v, x)));

/** How many frames `px` pixels span at this zoom. */
export const framesFor = (v: TimelineView, px: number) => (px * (v.end - v.start)) / v.width;
