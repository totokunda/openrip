/**
 * The timeline's clip colours, one place for all of them. CapCut's system: every kind of clip
 * has its own hue, all at about the same darkness so thumbnails, waveforms and labels read the
 * same on each (docs/plan/capcut-ui-spec.md §2). The hues are OpenRip's own, a family around
 * the lavender accent (styles/index.css) instead of CapCut's teal and navy: video a deep
 * violet slate, sound taken from a video the same with a violet waveform, music a neighbouring
 * blue, text plum, filters and effects indigo and orchid, stickers and adjustments warm.
 */
export const TIMELINE_COLORS = {
  /** A video or photo, under its thumbnails. */
  video: "#322c4c",
  /** Sound taken from a video (detached or extracted). */
  fromVideoBg: "#2c2846",
  fromVideoWave: "#7a6cc0",
  /** Music and other imported sound. */
  music: "#22305a",
  musicWave: "#5a78c4",
  /** A recorded voiceover. */
  voiceover: "#22305a",
  voiceoverWave: "#5a78c4",
  /** Text, captions and templates. */
  text: "#8a4560",
  /** A draft's bar kinds; the app's filters use `filter`. */
  filter: "#483f8e",
  effect: "#7a4886",
  sticker: "#c08a3e",
  adjustment: "#9c8848",
  /** The app's shapes (CapCut's shapes are stickers) and older drawings. */
  shape: "#c08a3e",
  drawing: "#6a4f8a",
  /** Label chips: each body with 9% white over it, as CapCut's (#2f5b62 on its #1d4950). */
  videoChip: "#453f5c",
  fromVideoChip: "#3f3b57",
  musicChip: "#364369",
  voiceoverChip: "#364369",
  /**
   * The volume line across a waveform: white at 27%, a lighter tint of whichever body it's on
   * (CapCut's #597f84 on its teal; #67647a on `fromVideoBg`, #606a88 on `music`), lighter still
   * where it crosses a bar.
   */
  waveLine: "rgba(255,255,255,0.27)",
  /** Beat markers on a clip (CapCut's yellow dots). */
  beat: "#f2c94c",
} as const;

export type TimelineColorRole = keyof typeof TIMELINE_COLORS;
