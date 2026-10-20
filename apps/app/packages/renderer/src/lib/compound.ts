// Compound clips (CapCut's subprojects): a video clip whose picture and sound are a timeline of
// its own, with tracks and clips in frames from 0 at its start (`compound` on the clip, see
// CompoundContent in types.ts). Pure functions of clips and tracks: creating one from clips,
// breaking one apart, copying one with fresh ids, and the stack of timelines the editor has
// open while one is being edited. The clip store (lib/clip.ts) applies them to its edits.
// Not to be confused with Group (clipOrdering, ⌘G): a group keeps its clips on the one
// timeline, hidden under a bar, for text templates; a compound moves them into a timeline of
// its own. See docs/plan/app-engine-integration.md.
import type { AnyClipProps, CompoundContent, TimelineProps, TimelineType, VideoClipProps } from "./types";
import { splitKeyframes } from "./keyframes.ts";
import { isTrackLocked, linkedClips } from "./timeline-edit.ts";

const startOf = (c: AnyClipProps) => c.startFrame ?? 0;
const endOf = (c: AnyClipProps) => c.endFrame ?? 0;

/** A compound clip: a video clip with a timeline of its own. */
export type CompoundClip = VideoClipProps & { compound: CompoundContent };

export const isCompound = (clip: AnyClipProps | undefined | null): clip is CompoundClip => clip?.type === "video" && !!(clip as VideoClipProps).compound;

/** The length of a timeline's clips, in frames: where the last one ends. */
export const contentLength = (content: CompoundContent | { clips: AnyClipProps[] }) => content.clips.reduce((m, c) => Math.max(m, endOf(c)), 0);

/** Every clip of a timeline and of the compounds in it, deep. */
export const allClips = (clips: AnyClipProps[]): AnyClipProps[] => clips.flatMap((c) => (isCompound(c) ? [c, ...allClips(c.compound.clips)] : [c]));

/** `clips` with `fn` applied to each clip, the compounds' content too (deep); a clip `fn` leaves as it is stays the same object. */
export const mapClips = (clips: AnyClipProps[], fn: (clip: AnyClipProps) => AnyClipProps): AnyClipProps[] => {
  let changed = false;
  const out = clips.map((c) => {
    let next = fn(c);
    if (isCompound(next)) {
      const inner = mapClips(next.compound.clips, fn);
      if (inner !== next.compound.clips) next = { ...next, compound: { ...next.compound, clips: inner } };
    }
    if (next !== c) changed = true;
    return next;
  });
  return changed ? out : clips;
};

/** The compound clips of a timeline (top level only). */
export const compoundsIn = (clips: AnyClipProps[]): CompoundClip[] => clips.filter(isCompound);

/** The next free "Compound clip1", "Compound clip2", … among the names in `clips` (and the compounds in them). */
export const nextCompoundName = (clips: AnyClipProps[]) => {
  const used = new Set(allClips(clips).filter(isCompound).map((c) => c.name));
  let n = 1;
  while (used.has(`Compound clip${n}`)) n++;
  return `Compound clip${n}`;
};

type NewId = () => string;

/**
 * A copy of a compound's content with every id fresh (clips, tracks, and the links, groups and
 * references between them), the compounds inside it too: what pasting, adding another instance
 * and splitting make, so the copies never share a clip with the original.
 */
export const cloneContent = (content: CompoundContent, newId: NewId): CompoundContent => {
  const trackIds = new Map(content.timelines.map((t) => [t.timelineId, newId()] as const));
  const clipIds = new Map(content.clips.map((c) => [c.clipId, newId()] as const));
  const links = new Map<string, string>();
  const link = (id: string) => {
    if (!links.has(id)) links.set(id, newId());
    return links.get(id)!;
  };
  const clips = content.clips.map((c) => {
    const copy: any = { ...c, clipId: clipIds.get(c.clipId)!, timelineId: trackIds.get(c.timelineId ?? "") ?? c.timelineId };
    if (c.linkId) copy.linkId = link(c.linkId);
    if (c.bundleId) copy.bundleId = link(`bundle:${c.bundleId}`);
    if (c.groupId) copy.groupId = clipIds.get(c.groupId) ?? c.groupId;
    if (c.type === "group") copy.children = c.children.map((row) => row.map((id) => clipIds.get(id) ?? id));
    if ((c as any).tracking?.video) copy.tracking = { ...(c as any).tracking, video: clipIds.get((c as any).tracking.video) ?? (c as any).tracking.video };
    const ref = (c as any).color?.match?.ref;
    if (ref?.clipId && clipIds.has(ref.clipId)) copy.color = { ...(c as any).color, match: { ...(c as any).color.match, ref: { ...ref, clipId: clipIds.get(ref.clipId) } } };
    if (isCompound(c)) copy.compound = cloneContent(c.compound, newId);
    return copy as AnyClipProps;
  });
  return { clips, timelines: content.timelines.map((t) => ({ ...t, timelineId: trackIds.get(t.timelineId)! })) };
};

/** A copy of a clip with a fresh id; a compound's content is copied deep (`cloneContent`). */
export const cloneClip = (clip: AnyClipProps, newId: NewId): AnyClipProps => {
  const copy: AnyClipProps = { ...clip, clipId: newId() };
  if (isCompound(clip)) (copy as CompoundClip).compound = cloneContent(clip.compound, newId);
  return copy;
};

// ---- the timelines being edited ----------------------------------------------------------

/**
 * A timeline the editor left to open a compound's: its clips and tracks as they were, the
 * compound being edited (`clipId`, one of those clips) and where the playhead was.
 */
export interface CompoundFrame {
  clipId: string;
  clips: AnyClipProps[];
  timelines: TimelineProps[];
  clipDuration: number;
  playhead: number;
  /** The compound's content length when it was opened (see `afterEdit`). */
  length: number;
  /** The timeline's zoom as it was, to come back to. */
  view: { total: number; window: [number, number]; zoom: number };
}

/**
 * The main timeline's clips and tracks (what's saved and exported) from those being edited
 * (`clips`, `timelines`) and the timelines left to get there, innermost last: each compound
 * being edited takes its edited content.
 */
export const foldStack = (stack: CompoundFrame[], clips: AnyClipProps[], timelines: TimelineProps[]): { clips: AnyClipProps[]; timelines: TimelineProps[] } => {
  let inner = { clips, timelines };
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i];
    const content: CompoundContent = { clips: inner.clips, timelines: inner.timelines };
    inner = { clips: f.clips.map((c) => (c.clipId === f.clipId && isCompound(c) ? { ...c, compound: content } : c)), timelines: f.timelines };
  }
  return inner;
};

/** The names of the compounds being edited, outermost first: the breadcrumb after "Main timeline". */
export const trail = (stack: CompoundFrame[]): { clipId: string; name: string }[] =>
  stack.map((f) => ({ clipId: f.clipId, name: (f.clips.find((c) => c.clipId === f.clipId) as CompoundClip | undefined)?.name ?? "Compound clip" }));

/**
 * The compound clip after its content was edited: it plays the content's new length when it
 * played all of it before (`wasLength`, the content's length when it was opened), else it keeps
 * the part it showed (a trimmed compound), cut to the new length.
 */
export const afterEdit = (clip: CompoundClip, content: CompoundContent, wasLength: number): CompoundClip => {
  const length = Math.max(1, contentLength(content));
  const trimStart = Math.max(0, clip.trimStart ?? 0);
  const shown = endOf(clip) - startOf(clip);
  const playedAll = trimStart === 0 && shown === wasLength;
  const end = playedAll ? startOf(clip) + length : Math.min(endOf(clip), startOf(clip) + Math.max(1, length - trimStart));
  return { ...clip, compound: content, endFrame: Math.max(startOf(clip) + 1, end), trimEnd: Math.min(0, (end - startOf(clip)) + trimStart - length) };
};

// ---- creating one -----------------------------------------------------------------------

const blankTrack = (type: TimelineType, newId: NewId): TimelineProps => ({ timelineId: newId(), type, timelineWidth: 0, timelineY: 0, timelineHeight: 0, timelinePadding: 0, muted: false, hidden: false });

export type Edited = { clips: AnyClipProps[]; timelines: TimelineProps[]; select: string[] };

/**
 * The clips a Create compound clip takes: the ones asked for with their linked clips (with
 * linkage on) and, for a group, all its clips (and the group of a clip in one).
 */
export const compoundMembers = (clips: AnyClipProps[], ids: string[], linkage: boolean): AnyClipProps[] => {
  const byId = new Map(clips.map((c) => [c.clipId, c] as const));
  const picked = new Set<string>();
  const add = (c: AnyClipProps | undefined) => {
    if (!c || picked.has(c.clipId)) return;
    picked.add(c.clipId);
    if (linkage) linkedClips(clips, c).forEach(add);
    if (c.type === "group") c.children.flat().forEach((id) => add(byId.get(id)));
    if (c.groupId) add(byId.get(c.groupId));
  };
  ids.forEach((id) => add(byId.get(id)));
  return clips.filter((c) => picked.has(c.clipId));
};

/**
 * Create compound clip: the clips `ids` (and what goes with them, `compoundMembers`) leave
 * their tracks for a compound clip's own timeline, shifted to start at 0, and a compound clip
 * takes their place spanning their time range. It goes on the lowest video track they used when
 * that track is free there (the main track, for clips from it), else on a new video track just
 * above it. Null when there's nothing to take or a clip is on a locked track.
 */
export const createCompound = (
  clips: AnyClipProps[],
  timelines: TimelineProps[],
  ids: string[],
  opts: { world: { width: number; height: number }; linkage: boolean; newId: NewId; name?: string },
): Edited | null => {
  const members = compoundMembers(clips, ids, opts.linkage);
  if (members.length === 0 || members.some((c) => isTrackLocked(timelines, c.timelineId))) return null;
  const memberIds = new Set(members.map((c) => c.clipId));
  const start = Math.min(...members.map(startOf));
  const end = Math.max(...members.map(endOf));
  const rest = clips.filter((c) => !memberIds.has(c.clipId));

  // Its content: the members' tracks (the same order and settings, new ids), time from 0.
  const used = timelines.filter((t) => members.some((c) => c.timelineId === t.timelineId));
  const inner = new Map(used.map((t) => [t.timelineId, { ...t, timelineId: opts.newId(), locked: false }] as const));
  const content: CompoundContent = {
    timelines: used.map((t) => inner.get(t.timelineId)!),
    clips: members.map((c) => {
      const copy: any = { ...c, timelineId: inner.get(c.timelineId ?? "")?.timelineId ?? c.timelineId, startFrame: startOf(c) - start, endFrame: endOf(c) - start };
      // A link to a clip left behind (linkage was off) is dropped.
      if (c.linkId && !members.some((o) => o !== c && o.linkId === c.linkId)) delete copy.linkId;
      // A group with a clip left outside is left too.
      if (c.bundleId && clips.some((o) => o.bundleId === c.bundleId && !memberIds.has(o.clipId))) delete copy.bundleId;
      return copy as AnyClipProps;
    }),
  };

  // Where it goes: the lowest video track of the members with room, else a new one above it.
  const free = (t: TimelineProps) => !t.locked && !rest.some((c) => c.timelineId === t.timelineId && !c.hidden && startOf(c) < end && endOf(c) > start);
  const mine = timelines.filter((t) => t.type === "media" && inner.has(t.timelineId));
  let target = [...mine].reverse().find(free);
  const next = [...timelines];
  if (!target) {
    target = blankTrack("media", opts.newId);
    const above = mine.length ? next.indexOf(mine[0]) : 0;
    next.splice(Math.max(0, above), 0, target);
  }

  const { width, height } = opts.world;
  const transform = { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 };
  const clip: CompoundClip = {
    type: "video",
    clipId: opts.newId(),
    timelineId: target.timelineId,
    startFrame: start,
    endFrame: Math.max(start + 1, end),
    trimStart: 0,
    trimEnd: 0,
    assetId: "",
    assetIdHistory: [],
    name: opts.name ?? nextCompoundName(clips),
    mediaWidth: width,
    mediaHeight: height,
    mediaAspectRatio: width / height,
    speed: 1,
    masks: [],
    transform,
    originalTransform: { ...transform },
    compound: content,
  } as CompoundClip;
  return { clips: [...rest, clip], timelines: next, select: [clip.clipId] };
};

// ---- breaking one apart -----------------------------------------------------------------

/**
 * A content clip as it plays inside a compound clip showing content frames from `from` to
 * `to`, moved to `origin` + its frames; null when it's outside them. A clip the window cuts
 * is trimmed like a resize would, its keys cut with it.
 */
const windowed = (c: AnyClipProps, from: number, to: number, origin: number, fps: number): AnyClipProps | null => {
  const s = Math.max(startOf(c), from);
  const e = Math.min(endOf(c), to);
  if (e <= s) return null;
  const out: any = { ...c, startFrame: s + origin, endFrame: e + origin };
  const [head, tail] = [s - startOf(c), endOf(c) - e];
  if (head > 0 && Number.isFinite(c.trimStart)) out.trimStart = (c.trimStart ?? 0) + head;
  if (tail > 0 && Number.isFinite(c.trimEnd)) out.trimEnd = (c.trimEnd ?? 0) - tail;
  if (c.keyframes) {
    let keys = c.keyframes;
    if (head > 0) keys = splitKeyframes(keys, head, fps)[1] ?? {};
    if (tail > 0) keys = splitKeyframes(keys, e - s, fps)[0] ?? {};
    out.keyframes = keys;
  }
  return out;
};

/**
 * Break apart (Undo compound clip): the compound clip's content goes back onto the timeline
 * at its place, each of its tracks onto a track of its kind from the compound's up that has
 * room, or a new one just above the last (audio onto a new one at the bottom). A compound
 * trimmed to part of its content brings that part. Null when it isn't a compound or is
 * on a locked track.
 */
export const breakApart = (clips: AnyClipProps[], timelines: TimelineProps[], compoundId: string, opts: { newId: NewId; fps: number }): Edited | null => {
  const compound = clips.find((c) => c.clipId === compoundId);
  if (!isCompound(compound) || isTrackLocked(timelines, compound.timelineId)) return null;
  const trimStart = Math.max(0, compound.trimStart ?? 0);
  const [from, to] = [trimStart, trimStart + (endOf(compound) - startOf(compound))];
  const origin = startOf(compound) - trimStart;
  const rest = clips.filter((c) => c.clipId !== compoundId);
  const placed: AnyClipProps[] = [];
  const next = [...timelines];
  const room = (t: TimelineProps, lo: number, hi: number) =>
    !t.locked &&
    ![...rest, ...placed].some((c) => c.timelineId === t.timelineId && !c.hidden && startOf(c) < hi && endOf(c) > lo);
  const select: string[] = [];
  // From the bottom track of its content up, so the order on screen stays.
  let ceiling = next.findIndex((t) => t.timelineId === compound.timelineId);
  for (const track of [...compound.compound.timelines].reverse()) {
    const moved = compound.compound.clips
      .filter((c) => c.timelineId === track.timelineId)
      .map((c) => windowed(c, from, to, origin, opts.fps))
      .filter((c): c is AnyClipProps => !!c);
    if (moved.length === 0) continue;
    const lo = Math.min(...moved.map(startOf));
    const hi = Math.max(...moved.map(endOf));
    // A muted or hidden track keeps being one, on a track of its own.
    const plain = !track.muted && !track.hidden;
    let target: TimelineProps | undefined;
    if (plain) {
      if (track.type === "audio") target = next.find((t) => t.type === "audio" && room(t, lo, hi));
      else for (let i = Math.max(0, ceiling); i >= 0 && !target; i--) if (next[i].type === track.type && room(next[i], lo, hi)) target = next[i];
    }
    if (!target) {
      target = { ...blankTrack(track.type, opts.newId), muted: track.muted, hidden: track.hidden, size: track.size, waveform: track.waveform };
      if (track.type === "audio") next.push(target);
      else next.splice(Math.max(0, ceiling), 0, target);
    }
    if (track.type !== "audio") ceiling = Math.max(0, next.findIndex((t) => t.timelineId === target!.timelineId) - 1);
    for (const c of moved) {
      placed.push({ ...c, timelineId: target.timelineId });
      select.push(c.clipId);
    }
  }
  return { clips: [...rest, ...placed], timelines: next, select };
};
