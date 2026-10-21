// The timeline scrolls while something on it is dragged to its edge, as CapCut's does: near or
// past the left or right edge of the visible timeline it scrolls that way every animation frame,
// faster the further out the pointer is, until frame 0 or the timeline's end. A drag runs it with
// startEdgeScroll, a requestAnimationFrame loop, so it keeps going with the pointer held still.

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

/** The pointer as a drag last saw it. */
export type EdgePointer = Pick<MouseEvent, "clientX" | "clientY" | "metaKey">;

/** What the edge scroll reads and moves: the controls store's state (lib/control.ts). */
export type EdgeScrollView = {
  timelineDuration: [number, number];
  totalTimelineFrames: number;
  shiftTimelineDuration: (frames: number, shiftFocusFrame?: boolean) => void;
};

/**
 * Scrolls the timeline for a drag until the pointer is let go or the returned function is
 * called: each animation frame the pointer is near or past an edge of the visible timeline, it
 * moves the window (`view`) and calls `follow` with the pointer where it last was, so what's
 * dragged keeps up with the scroll even while the pointer is held still. The playhead keeps its
 * place on screen, as in the timeline's other scrolls (the wheel, the ruler, the scrollbar): the
 * ruler keeps it in view (TimelineEditor.tsx). Stage x 0 is `area`'s left edge; the visible
 * timeline runs from stage x `left` to `stageWidth`, its window spread over `stageWidth` px from
 * `left`. The pointer and the animation frames are those of `area`'s window: the timeline can be
 * in one of its own (lib/panel-windows.ts).
 */
export function startEdgeScroll(
  area: HTMLElement,
  left: number,
  stageWidth: number,
  view: () => EdgeScrollView,
  follow: (pointer: EdgePointer) => void,
): () => void {
  const doc = area.ownerDocument;
  const win = doc.defaultView ?? window;
  let pointer: EdgePointer | null = null;
  let carry = 0;
  let raf = 0;
  const move = (e: MouseEvent) => {
    pointer = { clientX: e.clientX, clientY: e.clientY, metaKey: e.metaKey };
  };
  const tick = () => {
    raf = win.requestAnimationFrame(tick);
    if (!pointer) return;
    const x = pointer.clientX - area.getBoundingClientRect().left;
    const now = view();
    const step = edgeScrollFrames(edgeScrollSpeed(x, left, stageWidth), now.timelineDuration, stageWidth, now.totalTimelineFrames, carry);
    carry = step.carry;
    if (step.frames === 0) return;
    now.shiftTimelineDuration(step.frames, true);
    follow(pointer);
  };
  // Let go, it stops before the drag's own release handlers (a document listener, or Konva's
  // dragend) run.
  const stop = () => {
    win.cancelAnimationFrame(raf);
    doc.removeEventListener("mousemove", move, true);
    doc.removeEventListener("mouseup", stop, true);
  };
  doc.addEventListener("mousemove", move, true);
  doc.addEventListener("mouseup", stop, true);
  raf = win.requestAnimationFrame(tick);
  return stop;
}
