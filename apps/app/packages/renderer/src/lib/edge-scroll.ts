// The timeline scrolls while the playhead is dragged to its edge, as CapCut's does: near or past
// the left or right edge of the visible timeline it scrolls that way every animation frame,
// faster the further out the pointer is, until frame 0 or the timeline's end. The playhead's drag
// (components/timeline/Scrubber.tsx) runs it from a requestAnimationFrame loop, so it keeps going
// with the pointer held still.

/** How far inside the visible timeline's edges the scroll starts, in px (as the tracks' vertical one). */
export const EDGE_ZONE = 36;
/** The scroll with the pointer on the edge, in px per animation frame. */
export const EDGE_SPEED = 8;
/** The fastest it scrolls, in px per animation frame (reached 4 zones past the edge). */
export const MAX_EDGE_SPEED = 40;

/**
 * The px the timeline scrolls in one animation frame for a pointer at stage x `x`, the visible
 * timeline running from `left` to `right`: leftward (negative) within EDGE_ZONE of `left` or past
 * it, rightward near or past `right`, faster the further out; 0 in between.
 */
export function edgeScrollSpeed(x: number, left: number, right: number): number {
  const speed = (depth: number) => Math.min(MAX_EDGE_SPEED, Math.max(1, (depth / EDGE_ZONE) * EDGE_SPEED));
  if (x < left + EDGE_ZONE) return -speed(left + EDGE_ZONE - x);
  if (x > right - EDGE_ZONE) return speed(x - (right - EDGE_ZONE));
  return 0;
}

/**
 * `px` of scroll as whole frames to move the visible window `view` (`stageWidth` px wide) by,
 * never before frame 0 or past the timeline's `total` frames. `carry` is the part of a frame
 * left from the last animation frame; what's left now comes back with it.
 */
export function edgeScrollFrames(
  px: number,
  view: [number, number],
  stageWidth: number,
  total: number,
  carry = 0,
): { frames: number; carry: number } {
  const [start, end] = view;
  const wanted = (px * (end - start)) / Math.max(1, stageWidth) + carry;
  const whole = Math.trunc(wanted);
  const frames = Math.max(-start, Math.min(Math.max(0, total - end), whole));
  // Stopped at either end, nothing is carried: it doesn't lurch when it can go again.
  return { frames, carry: frames === whole ? wanted - whole : 0 };
}
