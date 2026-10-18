// Times as the editor writes them, in Edit › Time code's two styles:
// - "frame", HH:MM:SS+frame (the default): the clock time to the second, then the frame within
//   that second at the project's real rate. At 29.97 fps the seconds stay on the clock.
// - "ff", HH:MM:SS:FF: SMPTE timecode counted at the nominal rate (30 for 29.97, 60 for
//   59.94; non-drop), so at those rates it runs behind the clock, by about a frame every 33 s.
// At whole-number rates the two are the same.
import { preferences, type Preferences } from "./preferences";

export type TimeCodeStyle = Preferences["timeCode"];

const two = (n: number) => String(n).padStart(2, "0");
const hms = (s: number) => `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;

/** `frames` at `fps` as HH:MM:SS:FF in `style` (the user's choice when not given). */
export const formatTimecode = (frames: number, fps: number, style: TimeCodeStyle = preferences().timeCode): string => {
  const rate = Math.max(1, Number.isFinite(fps) && fps > 0 ? fps : 1);
  const f = Number.isFinite(frames) && frames > 0 ? Math.round(frames) : 0;
  if (style === "ff" || Number.isInteger(rate)) {
    const nominal = Math.max(1, Math.round(rate));
    const s = Math.floor(f / nominal);
    return `${hms(s)}:${two(f - s * nominal)}`;
  }
  const s = Math.floor(f / rate + 1e-9);
  const ff = Math.min(Math.ceil(rate) - 1, Math.max(0, Math.floor(f - s * rate + 1e-6)));
  return `${hms(s)}:${two(ff)}`;
};

/** HH:MM:SS:FF (or fewer fields, from the right) in `style` back to frames; null when it isn't one. */
export const parseTimecode = (text: string, fps: number, style: TimeCodeStyle = preferences().timeCode): number | null => {
  const parts = text.trim().split(":").map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (parts.length === 0 || parts.length > 4 || parts.some((p) => !Number.isFinite(p))) return null;
  const [ff = 0, ss = 0, mm = 0, hh = 0] = parts.reverse();
  const s = (hh * 60 + mm) * 60 + ss;
  const rate = Math.max(1, Number.isFinite(fps) && fps > 0 ? fps : 1);
  if (style === "ff" || Number.isInteger(rate)) return s * Math.max(1, Math.round(rate)) + ff;
  return Math.ceil(s * rate - 1e-6) + ff;
};
