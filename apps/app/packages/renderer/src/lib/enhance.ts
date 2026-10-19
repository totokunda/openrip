// Classic video clean-up on a clip, as CapCut lays it out: Stabilize (with a Level), Reduce
// image noise, Remove flickers under Video › Basic, and Motion blur under Enhance motion in the
// clip menu. The settings are the clip's `enhance` field (saved with the project, one undo step
// each); the engine draws them in the preview and the export (engine/crates/playback
// preview.rs `enhance_layer`). Stabilize and Remove flickers first need the engine to track the
// clip's media once (lib/analysis.ts `trackMotion`).
import { useClipStore } from "./clip";
import { motionRangeKey, trackMotion } from "./analysis";
import type { ContextMenuItem } from "./context-menu";
import type { AnyClipProps, EnhanceSettings, StabilizeLevel, VideoClipProps } from "./types";

/** The Level choices, in the order CapCut lists them (Recommended is the default). */
export const STABILIZE_LEVELS: { value: StabilizeLevel; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "minimal_cut", label: "Minimal cut" },
  { value: "most_stable", label: "Most stable" },
];

/** What a part starts at when it's switched on. */
export const DEFAULT_DENOISE = 50;
export const DEFAULT_MOTION_BLUR = 50;

/** Whether the clean-up applies to the clip (a video that isn't a freeze frame). */
export const hasEnhance = (clip: AnyClipProps | undefined): clip is VideoClipProps => clip?.type === "video" && !(clip as VideoClipProps).freeze;

/** The clip's settings with everything filled in. */
export const enhanceOf = (clip: AnyClipProps | undefined): Required<EnhanceSettings> => {
  const e = (clip as VideoClipProps | undefined)?.enhance ?? {};
  return { stabilize: e.stabilize ?? null, denoise: e.denoise ?? null, deflicker: !!e.deflicker, motionBlur: e.motionBlur ?? null };
};

/** Whether the settings need the engine's tracking (Stabilize, Remove flickers). */
export const needsMotion = (e: EnhanceSettings | null | undefined) => !!e?.stabilize || !!e?.deflicker;

/** The settings with `patch` on top, or null when everything is off. */
export const merged = (clip: AnyClipProps | undefined, patch: Partial<EnhanceSettings>): EnhanceSettings | null => {
  const next = { ...enhanceOf(clip), ...patch };
  return next.stabilize || next.denoise || next.deflicker || next.motionBlur ? next : null;
};

/**
 * Change a clip's settings, as one undo step. A part that needs tracking starts it (the engine
 * keeps what it finds, so turning it on again costs nothing); if that is cancelled or fails the
 * part goes back off.
 */
export const setEnhance = (clipId: string, patch: Partial<EnhanceSettings>) => {
  const store = useClipStore.getState();
  const clip = store.getClipById(clipId);
  if (!hasEnhance(clip)) return;
  store.updateClip(clipId, { enhance: merged(clip, patch) } as Partial<AnyClipProps>);
  const asked = (["stabilize", "deflicker"] as const).filter((k) => patch[k]);
  if (asked.length > 0) {
    // Asked for afresh: tracking this clip is wanted again.
    declined.delete(clipId);
    void ensureTracked(clipId, asked);
  }
};

/** Clips whose tracking was cancelled or failed, by the range they asked for: not tried again until asked afresh. */
const declined = new Map<string, string>();

/** Track the clip for the parts that need it; those parts go off again if that is cancelled or fails. */
export const ensureTracked = async (clipId: string, parts: ("stabilize" | "deflicker")[]) => {
  const clip = useClipStore.getState().getClipById(clipId);
  const key = motionRangeKey(clip);
  if (declined.get(clipId) === key) return;
  const ok = await trackMotion(clipId);
  // (Null: another analysis is running; the inspector asks again when it ends.)
  if (ok !== false || !useClipStore.getState().getClipById(clipId)) return;
  declined.set(clipId, key);
  const off: Partial<EnhanceSettings> = {};
  if (parts.includes("stabilize")) off.stabilize = null;
  if (parts.includes("deflicker")) off.deflicker = false;
  setEnhance(clipId, off);
};

/** Turn a part off in every clip of `ids` (or on, in those that can). */
export const toggleEnhance = (ids: string[], part: "stabilize" | "denoise" | "deflicker" | "motionBlur", on: boolean) => {
  for (const id of ids) {
    const clip = useClipStore.getState().getClipById(id);
    if (!hasEnhance(clip)) continue;
    const value = {
      stabilize: on ? { level: enhanceOf(clip).stabilize?.level ?? "recommended" } : null,
      denoise: on ? { strength: enhanceOf(clip).denoise?.strength ?? DEFAULT_DENOISE } : null,
      deflicker: on,
      motionBlur: on ? { amount: enhanceOf(clip).motionBlur?.amount ?? DEFAULT_MOTION_BLUR } : null,
    }[part];
    setEnhance(id, { [part]: value } as Partial<EnhanceSettings>);
  }
};

/**
 * The clip menu's Enhance visuals (Stabilize, Reduce image noise, Remove flickers) and Enhance
 * motion (Motion blur), each ticked while on for every selected video; picking one flips it.
 */
export const enhanceMenuItems = (ids: string[]): { visuals: ContextMenuItem[]; motion: ContextMenuItem[] } => {
  const clips = ids.map((id) => useClipStore.getState().getClipById(id)).filter(hasEnhance);
  if (clips.length === 0) return { visuals: [], motion: [] };
  const item = (id: string, label: string, part: "stabilize" | "denoise" | "deflicker" | "motionBlur"): ContextMenuItem => {
    const on = clips.every((c) => (part === "deflicker" ? enhanceOf(c).deflicker : !!enhanceOf(c)[part]));
    return { id, label, action: "custom", checked: on, run: () => toggleEnhance(clips.map((c) => c.clipId), part, !on) };
  };
  return {
    visuals: [
      {
        id: "enhance-visuals",
        label: "Enhance visuals",
        action: "none",
        children: [item("enhance-stabilize", "Stabilize", "stabilize"), item("enhance-denoise", "Reduce image noise", "denoise"), item("enhance-deflicker", "Remove flickers", "deflicker")],
      },
    ],
    motion: [{ id: "enhance-motion", label: "Enhance motion", action: "none", children: [item("enhance-motion-blur", "Motion blur", "motionBlur")] }],
  };
};

/** The analysis rows (Split scenes, Adjust color) with Enhance visuals before Adjust color and Enhance motion after it. */
export const withEnhance = (rows: ContextMenuItem[], enhance: { visuals: ContextMenuItem[]; motion: ContextMenuItem[] }): ContextMenuItem[] => {
  const at = rows.findIndex((r) => r.id === "adjust-color");
  if (at < 0) return [...rows, ...enhance.visuals, ...enhance.motion];
  return [...rows.slice(0, at), ...enhance.visuals, rows[at], ...enhance.motion, ...rows.slice(at + 1)];
};
