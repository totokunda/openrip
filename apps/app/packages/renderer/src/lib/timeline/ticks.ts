// The ruler's ticks and labels for a view, as CapCut's ruler steps them (docs/plan/capcut-ui-spec.md
// §4.12): labelled majors at the closest spacing of a short list that leaves room for a label
// (every 5 s at its default zoom, every 30 s zoomed out, every few frames zoomed in), minor
// ticks between them. Pure.
import { pxPerFrame, xOf, type TimelineView } from "./view.ts";

export interface Tick {
  frame: number;
  x: number;
  major: boolean;
  /** "MM:SS" on whole seconds (H:MM:SS past an hour), "6f" on the frames between them. */
  label?: string;
}

/** The least room between two labelled ticks. */
export const LABEL_SPACING = 90;
/** The least room between two minor ticks. */
const MINOR_SPACING = 8;
const SECOND_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const FRAME_STEPS = [1, 2, 5, 10];

/** The step between labelled ticks, in frames. */
export const majorStep = (v: TimelineView, fps: number): number => {
  const ppf = pxPerFrame(v);
  const rate = Math.max(1, Math.round(fps));
  for (const f of FRAME_STEPS) if (f < rate && f * ppf >= LABEL_SPACING) return f;
  for (const s of SECOND_STEPS) if (s * rate * ppf >= LABEL_SPACING) return s * rate;
  return SECOND_STEPS[SECOND_STEPS.length - 1] * rate;
};

/** How many parts a major step splits into: whole frames each, and room for each tick. */
const minorParts = (step: number, ppf: number): number => {
  for (const n of [10, 6, 5, 4, 2]) if (step % n === 0 && (step / n) * ppf >= MINOR_SPACING) return n;
  return 1;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** A tick's label. */
export const tickLabel = (frame: number, fps: number): string => {
  const rate = Math.max(1, Math.round(fps));
  if (frame % rate !== 0) return `${frame % rate}f`;
  const s = Math.round(frame / rate);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

/** The ticks across the view, from frame 0 (none before it). */
export const ticksFor = (v: TimelineView, fps: number): Tick[] => {
  const step = majorStep(v, fps);
  const ppf = pxPerFrame(v);
  const minor = step / minorParts(step, ppf);
  const out: Tick[] = [];
  const first = Math.max(0, Math.floor(v.start / minor) * minor);
  for (let f = first; f <= v.end + minor; f += minor) {
    const major = Math.abs(f / step - Math.round(f / step)) < 1e-9;
    out.push({ frame: f, x: xOf(v, f), major, label: major ? tickLabel(f, fps) : undefined });
  }
  return out;
};
