import type { ZoomLevel } from "./types.ts";

/** Zoomed all the way out, the window is this long (CapCut's: about two minutes fill the view) when the timeline is shorter. */
export const OVERVIEW_SECONDS = 120;
/** Zoomed all the way in, the window is this many frames. */
export const CLOSEST_FRAMES = 5;

/**
 * The window (frames) zoom `level` shows, from the widest (level `min`: the whole timeline of
 * `total` frames, or two minutes when that is longer) down to `CLOSEST_FRAMES` (level `max`).
 */
export const zoomDuration = (level: number, min: number, max: number, total: number, fps: number): number => {
  const widest = Math.max(1, total, Math.round(OVERVIEW_SECONDS * Math.max(1, fps)));
  const closest = Math.min(CLOSEST_FRAMES, widest);
  const t = (Math.min(max, Math.max(min, level)) - min) / Math.max(1, max - min);
  return Math.max(closest, Math.min(widest, Math.round(widest * Math.pow(closest / widest, t))));
};

/** The zoom level whose window is nearest `width` frames. */
export const zoomLevelFor = (width: number, min: number, max: number, total: number, fps: number): number => {
  let best = min;
  let diff = Infinity;
  for (let l = min; l <= max; l++) {
    const d = Math.abs(zoomDuration(l, min, max, total, fps) - width);
    if (d < diff) {
      diff = d;
      best = l;
    }
  }
  return best;
};

interface ZoomLevelConfig {
  minorTickInterval: number;
  majorTickInterval: number;
  minorTickFormat: "frame" | "second";
  majorTickFormat: "frame" | "second";
}

/** The least step from a short list (1, 2, 5, 10, 20, 50 …) that's at least `n` frames. */
export const niceFrameStep = (n: number): number => {
  for (let scale = 1; ; scale *= 10) {
    for (const k of [1, 2, 5]) if (k * scale >= n) return k * scale;
  }
};

// Calculate dynamic tick intervals based on duration and zoom level
export const getZoomLevelConfig = (
  zoomLevel: ZoomLevel,
  timelineDuration: [number, number],
  fps: number = 24,
  maxZoomLevel: ZoomLevel = 10,
  minZoomLevel: ZoomLevel = 1,
): ZoomLevelConfig => {
  // Target tick counts: 50 ticks at zoom 1, 10 ticks at zoom 10
  const targetTicks = 50 - (zoomLevel - 1) * 4.4; // Linear progression from 50 to ~10
  const [startFrame, endFrame] = timelineDuration;
  // Convert duration from frames to seconds for calculation
  const durationInSeconds = (endFrame - startFrame) / fps;

  // Calculate minor tick interval to achieve target tick count
  let minorTickInterval = durationInSeconds / targetTicks;
  let format: "frame" | "second" = "second";
  let frameMajor = 0;

  // For higher zoom levels (7-10), switch to frame-based ticks
  const seventyPercentThresh =
    minZoomLevel + (maxZoomLevel - minZoomLevel) * 0.7;
  if (zoomLevel >= seventyPercentThresh) {
    format = "frame";
    // Down to single frames, as CapCut's ruler: a label (2f, 4f, 6f) about every third of the
    // window, a tick on every frame (or half the label's step) between them.
    frameMajor = niceFrameStep((endFrame - startFrame) / 3);
    minorTickInterval = frameMajor >= 2 && frameMajor % 2 === 0 ? frameMajor / 2 : 1;
  } else {
    // For second-based ticks, ensure intervals convert to whole frames
    // Calculate what the interval would be in frames
    const intervalInFrames = minorTickInterval * fps;

    // Round to nice frame intervals that divide evenly
    if (intervalInFrames >= fps) {
      // 1+ seconds - round to whole seconds
      minorTickInterval = Math.round(minorTickInterval);
    } else if (intervalInFrames >= fps / 2) {
      // 0.5 seconds = 12 frames at 24fps
      minorTickInterval = 0.5;
    } else if (intervalInFrames >= fps / 4) {
      // 0.25 seconds = 6 frames at 24fps
      minorTickInterval = 0.25;
    } else if (intervalInFrames >= fps / 8) {
      // 0.125 seconds = 3 frames at 24fps - problematic, skip to larger interval
      minorTickInterval = 0.25; // Use fewer ticks with better spacing
    } else {
      // Very small intervals - use 0.25 seconds for cleaner spacing
      minorTickInterval = 0.25;
    }
  }

  // Major tick interval is typically 5-10x the minor interval
  const majorTickInterval =
    format === "frame"
      ? frameMajor
      : minorTickInterval * 10;

  return {
    minorTickInterval,
    majorTickInterval,
    minorTickFormat: format,
    majorTickFormat: format,
  };
};

/**
 * Converts an x position on the timeline to a frame number
 */
export function calculateFrameFromX(
  xPosition: number,
  timelinePadding: number,
  timelineWidth: number,
  timelineDuration: [number, number],
): number {
  const timelineX = xPosition - timelinePadding;
  const [startFrame, endFrame] = timelineDuration;
  const framePosition =
    (timelineX / timelineWidth) * (endFrame - startFrame) + startFrame;
  return Math.round(framePosition);
}
