// Beat markers on a video or audio clip (lib/types.ts `ClipBeats`), as CapCut has them on music:
// beats marked by hand (Mark beats / Add beat at the playhead) and automatic ones (Auto beat,
// every beat or only bar starts: Beat 2 and Beat 1). Times are seconds of the clip's media, so a
// marker stays on its beat through a trim, a move or a speed change; helpers here place them on
// the timeline (in frames, through the clip's trim, speed, curve and direction) and give them to
// snapping (lib/timeline-edit.ts `snapPoints`). Automatic beats come from the engine's detector
// (engine/crates/audio/src/beats.rs, cached per file on disk), or from a CapCut draft's own beats
// (`detected`). Nothing here writes to a store: edits return patches for `updateClip`.
import type { AnyClipProps, ClipBeats, DetectedBeat, VideoClipProps } from "./types";
import { hasCurve, sourceTimeAt, timelineProgressAt } from "./speed.ts";

/** A file's beats as the engine finds them: its tempo, and each beat with whether it starts a bar. */
export type BeatGrid = { bpm: number; beats: DetectedBeat[] };

/** The engine's beat finder for a file (the preload's `engineBeats`), given to the helpers that need it. */
export type FindBeats = (path: string) => Promise<BeatGrid | null>;

/** Two markers closer than this (s) are one. */
const SAME = 0.001;

const found = new Map<string, Promise<BeatGrid | null>>();

/**
 * The engine's beats for the file at `path`, asked once per file and session (the engine keeps
 * them on disk across sessions). A failed ask is forgotten, so it's tried again next time.
 */
export const beatsOfFile = (path: string, find: FindBeats): Promise<BeatGrid | null> => {
  let p = found.get(path);
  if (!p) {
    p = find(path).catch(() => {
      found.delete(path);
      return null;
    });
    found.set(path, p);
  }
  return p;
};

/** Forget the files' beats asked so far (tests). */
export const forgetBeats = () => found.clear();

/** Clips that can carry beat markers: those with sound. */
export const canHaveBeats = (clip: AnyClipProps) => clip.type === "audio" || clip.type === "video";

const beatsOf = (clip: AnyClipProps): ClipBeats => ((clip as any).beats as ClipBeats | null | undefined) ?? {};

const patch = (clip: AnyClipProps, beats: ClipBeats): Partial<AnyClipProps> => (canHaveBeats(clip) ? ({ beats } as Partial<AnyClipProps>) : {});

/** A patch marking a beat at media time `time` (s), keeping the hand-marked beats sorted and single. */
export const addBeat = (clip: AnyClipProps, time: number): Partial<AnyClipProps> => {
  const b = beatsOf(clip);
  const manual = [...(b.manual ?? [])];
  if (!Number.isFinite(time) || time < 0 || manual.some((t) => Math.abs(t - time) < SAME)) return {};
  manual.push(time);
  manual.sort((x, y) => x - y);
  return patch(clip, { ...b, manual });
};

/** A patch taking off the hand-marked beat nearest media time `time` within `tolerance` s. */
export const removeBeat = (clip: AnyClipProps, time: number, tolerance = 0.05): Partial<AnyClipProps> => {
  const b = beatsOf(clip);
  const manual = b.manual ?? [];
  let best = -1;
  manual.forEach((t, i) => {
    if (Math.abs(t - time) <= tolerance && (best < 0 || Math.abs(t - time) < Math.abs(manual[best] - time))) best = i;
  });
  return best < 0 ? {} : patch(clip, { ...b, manual: manual.filter((_, i) => i !== best) });
};

/** A patch turning the automatic beats on (every beat, or only bar starts) or off. */
export const setAutoBeats = (clip: AnyClipProps, auto: boolean, everyBeat = beatsOf(clip).everyBeat ?? false): Partial<AnyClipProps> =>
  patch(clip, { ...beatsOf(clip), auto, everyBeat });

/** CapCut's Clear beats: no hand-marked beats, the automatic ones off. */
export const clearBeats = (clip: AnyClipProps): Partial<AnyClipProps> => patch(clip, { ...beatsOf(clip), manual: [], auto: false });

/**
 * The markers that show, in media seconds, sorted: the hand-marked ones and, with Auto beat on,
 * the automatic ones at its density (a draft's own, else the engine's `grid`).
 */
export const shownBeats = (clip: AnyClipProps, grid?: BeatGrid | null): number[] => {
  const b = beatsOf(clip);
  const out = [...(b.manual ?? [])];
  if (b.auto) {
    const auto = b.detected?.length ? b.detected : (grid?.beats ?? []);
    for (const d of auto) if (b.everyBeat || d.downbeat) out.push(d.time);
  }
  out.sort((x, y) => x - y);
  return out.filter((t, i) => i === 0 || t - out[i - 1] >= SAME);
};

// As lib/speed.ts counts them.
const lengthOf = (clip: AnyClipProps) => Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));
const speedOf = (clip: AnyClipProps) => Math.max(0.1, Number((clip as VideoClipProps).speed || 1));

/** The media time (s) the clip plays at timeline frame `frame` (`mediaSeconds`: its media's length, for a reversed clip). */
export const mediaTimeAt = (clip: AnyClipProps, frame: number, fps: number, mediaSeconds?: number): number =>
  sourceTimeAt(clip, frame - (clip.startFrame ?? 0), fps, mediaSeconds);

/**
 * The timeline frame (fractional) at which the clip plays media time `time` (s): the inverse of
 * `mediaTimeAt`; null where the clip doesn't play it (trimmed off).
 */
export const frameOfMediaTime = (clip: AnyClipProps, time: number, fps: number, mediaSeconds?: number): number | null => {
  const v = clip as VideoClipProps;
  if (v.freeze) return null;
  const speed = speedOf(clip);
  const len = lengthOf(clip);
  const playedFrom = (Number(clip.trimStart ?? 0) * speed) / fps;
  const span = (len * speed) / fps;
  // As it plays: from the in-point, or back from the media's end when reversed.
  const played = v.reverse ? (mediaSeconds ?? playedFrom + span) - time : time;
  const offset = played - playedFrom;
  if (offset < -1e-9 || offset > span + 1e-9 || span <= 0) return null;
  const local = hasCurve(clip) ? timelineProgressAt(v.speedCurve!.points, offset / span) * len : (offset * fps) / speed;
  return (clip.startFrame ?? 0) + local;
};

/** The clip's markers on the timeline, in frames, sorted (those trimmed off left out). */
export const beatFrames = (clip: AnyClipProps, fps: number, grid?: BeatGrid | null, mediaSeconds?: number): number[] => {
  const out: number[] = [];
  for (const t of shownBeats(clip, grid)) {
    const f = frameOfMediaTime(clip, t, fps, mediaSeconds);
    if (f != null) out.push(f);
  }
  return out.sort((a, b) => a - b);
};

/** A patch marking a beat where the playhead (timeline frame `frame`) is on the clip; none off it. */
export const addBeatAtPlayhead = (clip: AnyClipProps, frame: number, fps: number, mediaSeconds?: number): Partial<AnyClipProps> => {
  const start = clip.startFrame ?? 0;
  if (frame < start || frame > start + lengthOf(clip)) return {};
  return addBeat(clip, mediaTimeAt(clip, frame, fps, mediaSeconds));
};

/**
 * Every visible clip's markers as snap points (frames), for `snapPoints`' `beats`, but those of
 * the clips being moved (`exclude`): `grid(clip)` gives the engine's beats for a clip's file once
 * they're known, and `mediaSeconds(clip)` its media's length.
 */
export const beatSnapPoints = (
  clips: AnyClipProps[],
  fps: number,
  grid: (clip: AnyClipProps) => BeatGrid | null | undefined = () => null,
  mediaSeconds: (clip: AnyClipProps) => number | undefined = () => undefined,
  exclude: Set<string> = new Set(),
): number[] => clips.filter((c) => canHaveBeats(c) && !c.hidden && !exclude.has(c.clipId)).flatMap((c) => beatFrames(c, fps, grid(c), mediaSeconds(c)));
