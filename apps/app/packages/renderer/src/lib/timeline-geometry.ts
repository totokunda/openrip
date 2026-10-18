// The timeline's geometry that its parts share (CapCut's, docs/plan/capcut-ui-spec.md §4.10
// to §4.12): where time 0 is and how tall the ruler is.

/**
 * Time 0's x in the timeline's stage: CapCut's 50 px Cover column between the track headers
 * and the clips. Every track uses it (a track's saved padding is ignored).
 */
export const TIME_ZERO_X = 50;

/** The ruler band along the top of the timeline (ticks, labels and clicks to seek). */
export const RULER_HEIGHT = 18;
