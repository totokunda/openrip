// J / K / L shuttle, as editors know it: L plays forward (again: 2×, 4×, 8×), J plays backward
// (again: faster), K stops. A press the other way slows that run one step first (2× to 1×, then
// stop, then the other way), as most editors do.
//
// Forward at 1× is ordinary playback (the engine plays it, with sound). Faster forward and
// every reverse step the playhead from a timer, showing frames as scrubbing does, without
// sound: the engine plays forward at its own rate only. Space, K, another seek or reaching an end of
// the project stops the run.
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";

const RATES = [1, 2, 4, 8];

/** The run now: signed multiple of real time (0 when none). */
let rate = 0;
let raf: number | null = null;
let last = 0;
/** Fractional frames not yet applied, and the frame the run last set (a different one: the user moved). */
let carry = 0;
let expected = -1;

export const shuttleRate = () => rate;

const tick = (now: number) => {
  raf = null;
  if (rate === 0) return;
  const c = useControlsStore.getState();
  const end = useClipStore.getState().clipDuration;
  // The user moved the playhead (a click on the ruler, a key): the run is over.
  // (The engine sets its last frame a moment after a pause: a few frames off is still the run.)
  if (Math.abs(c.focusFrame - expected) > Math.max(3, c.fps / 4) || c.isPlaying) {
    rate = 0;
    return;
  }
  carry += ((now - last) / 1000) * Math.max(1, c.fps) * rate;
  last = now;
  const whole = Math.trunc(carry);
  carry -= whole;
  if (whole !== 0) {
    const next = Math.max(0, Math.min(end, c.focusFrame + whole));
    c.setFocusFrame(next, false);
    c.setIsAccurateSeekNeeded(true);
    expected = next;
    if (next <= 0 || next >= end) {
      rate = 0;
      return;
    }
  }
  raf = requestAnimationFrame(tick);
};

/** Stop whatever run there is (the timer's, or forward playback). */
export function stopShuttle() {
  const c = useControlsStore.getState();
  rate = 0;
  if (raf != null) cancelAnimationFrame(raf);
  raf = null;
  if (c.isPlaying) c.pause();
}

const start = (next: number) => {
  const c = useControlsStore.getState();
  if (c.isPlaying) c.pause();
  rate = next;
  if (rate === 1) {
    // Ordinary playback.
    if (raf != null) cancelAnimationFrame(raf);
    raf = null;
    carry = 0;
    // (The store's isPlaying is the run, so none is kept here.)
    rate = 0;
    c.play();
    return;
  }
  const end = useClipStore.getState().clipDuration;
  // Where the playhead is now, after a pause has settled.
  const at = useControlsStore.getState().focusFrame;
  if ((rate < 0 && at <= 0) || (rate > 0 && at >= end)) {
    rate = 0;
    return;
  }
  carry = 0;
  last = performance.now();
  expected = at;
  if (raf == null) raf = requestAnimationFrame(tick);
};

/** L (forward) or J (backward): start, speed up, or slow a run the other way. */
export function shuttle(forward: boolean) {
  const dir = forward ? 1 : -1;
  const c = useControlsStore.getState();
  // Playback of the ordinary kind counts as a 1× run forward.
  const now = c.isPlaying ? 1 : rate;
  if (now === 0 || Math.sign(now) === dir) {
    const step = now === 0 ? 0 : RATES.indexOf(Math.abs(now)) + 1;
    start(dir * RATES[Math.min(RATES.length - 1, step)]);
    return;
  }
  // The other way: one step slower, and a stop at 1×.
  const slower = Math.abs(now) === 1 ? 0 : RATES[Math.max(0, RATES.indexOf(Math.abs(now)) - 1)];
  if (slower === 0) stopShuttle();
  else start(-dir * slower);
}
