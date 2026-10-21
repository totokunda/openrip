// The project's end as playback and the player have it, CapCut's: `end` is the project's length
// in frames, the place just after its last frame. Playback stops there (the time then reads the
// project's length) and the player shows the last frame there; play from there, or from the
// last frame, starts again from the beginning.

/**
 * Whether play from `frame` starts again from the beginning: from the end (or past it), or from
 * the last frame, which would play a single frame and stop.
 */
export const playsFromStart = (frame: number, end: number): boolean => frame >= end - 1;

/** The frame the player shows for the playhead at `frame`: the last one on the end itself. */
export const shownFrame = (frame: number, end: number): number => (end > 0 && frame === end ? end - 1 : frame);
