// The analysis tools at work: Split scenes, Auto adjust, Color match and Make colors consistent
// ask the engine (preload `engineDetectScenes`, `engineAutoAdjust`, `engineColorStats`), then
// apply lib/color-tools.ts's patches to the stores, each result one undo step. One runs at a
// time; `useAnalysisStore` has it (its progress for the timeline's processing pill, which can
// cancel it).
import { create } from "zustand";
import { toast } from "sonner";
import {
  engineAnalyseMotion,
  engineAnalysisProgress,
  engineMotionReady,
  engineAutoAdjust,
  engineCancelAnalysis,
  engineColorStats,
  engineDetectScenes,
  type EngineAnalysis,
} from "@app/preload";
import { useClipStore } from "./clip";
import { mediaAssetOf } from "./compound-media";
import { useControlsStore } from "./control";
import { beginStep } from "./history";
import {
  analysisRange,
  applyAutoAdjust,
  applyColorMatch,
  autoAdjustOf,
  consistentOffPatches,
  consistentPatches,
  hasColorTools,
  lookOf,
  mainTrackClips,
  matchForEngine,
  momentsOf,
  removeAutoAdjust,
  sceneCutFrames,
  type AutoValues,
} from "./color-tools";
import type { AnyClipProps, ColorMoments, VideoClipProps } from "./types";
import type { ContextMenuItem } from "./context-menu";
import { useInspectorStore } from "./inspector";

export type AnalysisKind = "scenes" | "auto" | "match" | "consistent" | "motion";

/** The analysis running: what, on which clip, and how far (0–1). */
export type RunningAnalysis = { kind: AnalysisKind; clipId: string | null; progress: number };

export const useAnalysisStore = create<{ running: RunningAnalysis | null }>(() => ({ running: null }));

let nextJob = 1;
let currentJob: number | null = null;
let cancelled = false;

/** Stop the running analysis (nothing is changed). */
export const cancelAnalysis = () => {
  cancelled = true;
  if (currentJob != null) void engineCancelAnalysis(currentJob);
};

/**
 * One engine call as part of the running analysis: its progress shown as step `step` of
 * `steps`. Null when it failed or was cancelled.
 */
async function call<T>(step: number, steps: number, ask: (job: number) => Promise<EngineAnalysis<T>>): Promise<T | null> {
  if (cancelled) return null;
  const job = nextJob++;
  currentJob = job;
  const timer = setInterval(() => {
    void engineAnalysisProgress(job).then((p) => {
      const running = useAnalysisStore.getState().running;
      if (!p || !running || currentJob !== job || p.total <= 0) return;
      useAnalysisStore.setState({ running: { ...running, progress: (step + Math.min(1, p.done / p.total)) / steps } });
    });
  }, 120);
  try {
    const r = await ask(job);
    if (r.ok) return r.value;
    if (!r.cancelled) toast.error(`Couldn't read the clip: ${r.error ?? "unknown error"}`);
    return null;
  } finally {
    clearInterval(timer);
    if (currentJob === job) currentJob = null;
  }
}

/** A compound clip is rendered to its file before a tool reads it (lib/compound-render.ts); any other clip is ready. */
const prepared = async (clipId: string | null): Promise<boolean> => (clipId ? (await import("./compound-render")).prepareMedia(clipId) : true);

/** Run `work` as the analysis (none if one is running already). */
async function exclusive<T>(kind: AnalysisKind, clipId: string | null, work: () => Promise<T>): Promise<T | null> {
  if (useAnalysisStore.getState().running) return null;
  cancelled = false;
  useAnalysisStore.setState({ running: { kind, clipId, progress: 0 } });
  try {
    if (!(await prepared(clipId))) return null;
    return await work();
  } finally {
    useAnalysisStore.setState({ running: null });
  }
}

/** A clip's media and the range of it it plays. */
const sourceOf = (clip: AnyClipProps | undefined) => {
  if (!clip || !hasColorTools(clip)) return null;
  const asset = mediaAssetOf(clip);
  if (!asset?.path) return null;
  const fps = useControlsStore.getState().fps || 30;
  const [start, duration] = analysisRange(clip, fps, asset.duration);
  return { path: asset.path, start, duration: duration > 0 ? duration : null, mediaSeconds: asset.duration, fps };
};

const clipNamed = (clip: AnyClipProps | undefined) => {
  if (!clip || !hasColorTools(clip)) return undefined;
  const path = mediaAssetOf(clip)?.path ?? "";
  return decodeURIComponent(path.split(/[\\/]/).pop()?.split("#")[0] ?? "") || undefined;
};

// Statistics already read, by media range.
const statsCache = new Map<string, ColorMoments>();

/** A clip's colour statistics: as its media is, or (`asSeen`, a reference) through its look ("consistent": without a match Make colors consistent made). */
async function statsOf(clip: AnyClipProps, step: number, steps: number, asSeen: false | "seen" | "consistent" = false): Promise<ColorMoments | null> {
  const src = sourceOf(clip);
  if (!src) return null;
  const look = asSeen ? lookOf(clip, asSeen === "consistent") : null;
  const key = `${src.path}|${src.start.toFixed(3)}|${src.duration?.toFixed(3) ?? "-"}|${JSON.stringify(look)}`;
  const hit = statsCache.get(key);
  if (hit) return hit;
  const stats = await call(step, steps, (job) => engineColorStats(job, src.path, src.start, src.duration, look));
  if (!stats) return null;
  const m = momentsOf(stats);
  statsCache.set(key, m);
  return m;
}

/** Whether Split scenes can run on the clip (a video that isn't a freeze frame). */
export const canSplitScenes = (clip: AnyClipProps | undefined) => clip?.type === "video" && !(clip as VideoClipProps).freeze;

/**
 * Split scenes: cut the clip at each shot change the engine finds in the media it plays, as
 * one step, the parts selected. Resolves to the number of parts (1 when there was no change;
 * null when cancelled or impossible).
 */
export const splitScenes = (clipId: string) =>
  exclusive("scenes", clipId, async () => {
    const clip = useClipStore.getState().getClipById(clipId);
    const src = sourceOf(clip);
    if (!clip || !canSplitScenes(clip) || !src) return null;
    const cuts = await call(0, 1, (job) => engineDetectScenes(job, src.path, src.start, src.duration));
    if (!cuts) return null;
    // The clip as it is now (it may have moved meanwhile).
    const now = useClipStore.getState().getClipById(clipId);
    if (!now) return null;
    const frames = sceneCutFrames(now, cuts.map((c) => c.timeUs), src.fps, src.mediaSeconds);
    if (frames.length === 0) {
      toast("No scene changes found in this clip");
      return 1;
    }
    beginStep();
    const store = useClipStore.getState();
    const parts: string[] = [];
    let current = clipId;
    for (const frame of frames) {
      store.splitClip(frame, current);
      const [left, right] = useControlsStore.getState().selectedClipIds;
      if (!right || left === current) break;
      parts.push(left);
      current = right;
    }
    parts.push(current);
    useControlsStore.getState().setSelectedClipIds(parts);
    return parts.length;
  });

/**
 * Stabilize and Remove flickers need the engine to track the clip's media first (camera motion
 * and the brightness of each frame): once per file and range, kept by the engine and saved in
 * its cache, so this returns at once when it has the range. True when it has it now.
 */
export const trackMotion = async (clipId: string): Promise<boolean | null> => {
  if (!(await prepared(clipId))) return false;
  const src = sourceOf(useClipStore.getState().getClipById(clipId));
  if (!src) return false;
  if (await engineMotionReady(src.path, src.start, src.duration)) return true;
  return exclusive("motion", clipId, async () => {
    const done = await call(0, 1, (job) => engineAnalyseMotion(job, src.path, src.start, src.duration));
    // The preview asks for fresh frames now the engine can use it.
    if (done !== null) useMotionStore.setState((s) => ({ version: s.version + 1 }));
    return done !== null;
  });
};

/** What a clip's tracking is about: its media and the range of it played (a key to notice it change). */
export const motionRangeKey = (clip: AnyClipProps | undefined) => {
  const src = sourceOf(clip);
  return src ? `${src.path}|${src.start.toFixed(3)}|${src.duration?.toFixed(3) ?? "-"}` : "";
};

/** Bumped whenever the engine finishes tracking a clip, so the preview redraws with it. */
export const useMotionStore = create<{ version: number }>(() => ({ version: 0 }));

/** Auto adjust on: the engine's slider values for the clip at `intensity`, one step. */
export const autoAdjust = (clipId: string, intensity?: number) =>
  exclusive("auto", clipId, async () => {
    const clip = useClipStore.getState().getClipById(clipId);
    const src = sourceOf(clip);
    if (!clip || !src) return null;
    const found = await call(0, 1, (job) => engineAutoAdjust(job, src.path, src.start, src.duration, matchForEngine(clip)));
    if (!found) return null;
    const now = useClipStore.getState().getClipById(clipId);
    if (!now) return null;
    const values: AutoValues = { brightness: found.brightness, contrast: found.contrast, saturation: found.saturation, temperature: found.temperature, tint: found.tint, whites: found.whites, blacks: found.blacks };
    beginStep();
    useClipStore.getState().updateClip(clipId, applyAutoAdjust(now, values, intensity ?? autoAdjustOf(now)?.intensity ?? 100, [src.start, src.duration ?? 0]));
    return values;
  });

/** Auto adjust off (what it added taken off the sliders). */
export const autoAdjustOff = (clipId: string) => {
  const clip = useClipStore.getState().getClipById(clipId);
  if (clip) useClipStore.getState().updateClip(clipId, removeAutoAdjust(clip));
};

/** Color match: the clip graded towards the reference clip's colours, one step. */
export const colorMatch = (clipId: string, referenceId: string, intensity = 100) =>
  exclusive("match", clipId, async () => {
    const store = useClipStore.getState();
    const clip = store.getClipById(clipId);
    const reference = store.getClipById(referenceId);
    if (!clip || !reference || clipId === referenceId) return null;
    const target = await statsOf(reference, 0, 2, "seen");
    const own = target && (await statsOf(clip, 1, 2));
    if (!target || !own) return null;
    const now = useClipStore.getState().getClipById(clipId);
    if (!now) return null;
    beginStep();
    useClipStore.getState().updateClip(clipId, applyColorMatch(now, own, target, { clipId: referenceId, name: clipNamed(reference) }, intensity));
    return true;
  });

/** Make colors consistent: every main-track clip matched to the reference, one step. */
export const makeColorsConsistent = (referenceId: string) =>
  exclusive("consistent", referenceId, async () => {
    const { clips, timelines } = useClipStore.getState();
    const reference = clips.find((c) => c.clipId === referenceId);
    if (!reference) return null;
    const targets = mainTrackClips(clips, timelines);
    const stats: Record<string, ColorMoments> = {};
    const order = [reference, ...targets.filter((c) => c.clipId !== referenceId)];
    for (let i = 0; i < order.length; i++) {
      // The reference as it looks; the others as their media are (the match goes on first).
      const m = await statsOf(order[i], i, order.length, i === 0 && "consistent");
      if (!m) {
        if (cancelled) return null;
        continue;
      }
      stats[order[i].clipId] = m;
    }
    const now = useClipStore.getState();
    const patches = consistentPatches(now.clips, now.timelines, referenceId, stats, clipNamed(reference));
    if (patches.length === 0) return 0;
    beginStep();
    // Off first, so a clip left out (or the new reference) doesn't keep an old match.
    for (const [id, patch] of consistentOffPatches(now.clips, now.timelines)) now.updateClip(id, patch);
    for (const [id, patch] of patches) useClipStore.getState().updateClip(id, patch);
    return patches.length;
  });

/** Make colors consistent off: the matches it made taken off, one step. */
export const colorsConsistentOff = () => {
  const { clips, timelines, updateClip } = useClipStore.getState();
  for (const [id, patch] of consistentOffPatches(clips, timelines)) updateClip(id, patch);
};

/** A request from the clip menu for a clip's Color match to ask for its reference. */
export const useColorMatchRequest = create<{ clipId: string | null }>(() => ({ clipId: null }));

/**
 * The clip menu's analysis rows for `clip`, as CapCut has them: Split scenes (a video), and
 * Adjust color ▸ Auto adjust and Color match (a video or a photo).
 */
export const analysisMenuItems = (clip: AnyClipProps | undefined, selected: number): ContextMenuItem[] => {
  if (!hasColorTools(clip) || selected > 1) return [];
  const busy = !!useAnalysisStore.getState().running;
  const out: ContextMenuItem[] = [];
  if (clip.type === "video") out.push({ id: "split-scenes", label: "Split scenes", action: "splitScenes", disabled: busy || !canSplitScenes(clip) });
  out.push({
    id: "adjust-color",
    label: "Adjust color",
    action: "none",
    children: [
      { id: "auto-adjust", label: "Auto adjust", action: "autoAdjust", disabled: busy },
      { id: "color-match", label: "Color match", action: "colorMatch", disabled: busy },
    ],
  });
  return out;
};

/** The clip menu's analysis actions on `clipId`. */
export const runAnalysisAction = (action: "splitScenes" | "autoAdjust" | "colorMatch", clipId: string) => {
  if (action === "splitScenes") {
    void splitScenes(clipId);
    return;
  }
  // The Adjust tab shows the result (and asks for Color match's reference).
  useControlsStore.getState().setSelectedClipIds([clipId]);
  useInspectorStore.getState().setTab("adjust");
  if (action === "autoAdjust") {
    const clip = useClipStore.getState().getClipById(clipId);
    if (clip && !autoAdjustOf(clip)) void autoAdjust(clipId);
  } else {
    useColorMatchRequest.setState({ clipId });
  }
};
