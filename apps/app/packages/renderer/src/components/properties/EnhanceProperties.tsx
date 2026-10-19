import React, { useEffect } from "react";
import { useClipStore } from "@/lib/clip";
import { motionRangeKey, useAnalysisStore } from "@/lib/analysis";
import { DEFAULT_DENOISE, DEFAULT_MOTION_BLUR, STABILIZE_LEVELS, enhanceOf, ensureTracked, hasEnhance, needsMotion, setEnhance } from "@/lib/enhance";
import type { StabilizeLevel, VideoClipProps } from "@/lib/types";
import Section from "./Section";
import PropertiesSlider from "./PropertiesSlider";
import { SelectRow } from "./TrackingProperties";
import { Analysing } from "./adjust/AutoAdjust";

/**
 * The clean-up sections of Video › Basic, each a checkbox section as CapCut lays them out:
 * Stabilize (with its Level), Reduce image noise (a strength), Remove flickers, and Motion
 * blur (an amount; CapCut keeps it under Enhance motion in the clip menu, which this mirrors).
 * The engine draws them in the preview and the export (lib/enhance.ts). Stabilize and Remove
 * flickers wait for the engine to track the clip once, shown here as it runs.
 */
const useClip = (clipId: string) => useClipStore((s) => s.getClipById(clipId)) as VideoClipProps | undefined;

/**
 * While Stabilize or Remove flickers is on, make sure the engine has tracked the clip's media
 * (a project opened later, or a clip trimmed beyond what was tracked, needs it again). Waits
 * for another analysis to end first.
 */
const useTracking = (clipId: string, clip: VideoClipProps | undefined) => {
  const busy = useAnalysisStore((s) => !!s.running);
  const needs = needsMotion(clip?.enhance);
  const key = motionRangeKey(clip);
  const parts = [clip?.enhance?.stabilize ? ("stabilize" as const) : null, clip?.enhance?.deflicker ? ("deflicker" as const) : null].filter((p): p is "stabilize" | "deflicker" => !!p);
  useEffect(() => {
    if (needs && !busy) void ensureTracked(clipId, parts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, needs, busy, key]);
  const running = useAnalysisStore((s) => s.running);
  return running?.kind === "motion" && running.clipId === clipId ? running : null;
};

export const StabilizeProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClip(clipId);
  const tracking = useTracking(clipId, clip);
  if (!hasEnhance(clip)) return null;
  const level = enhanceOf(clip).stabilize?.level ?? "recommended";
  const on = !!clip.enhance?.stabilize;
  return (
    <Section title="Stabilize" checked={on} onCheckedChange={(v) => setEnhance(clipId, { stabilize: v ? { level } : null })} testId="section-stabilize">
      <SelectRow label="Level" testId="stabilize-level" value={level} options={STABILIZE_LEVELS} disabled={!on} onChange={(v) => setEnhance(clipId, { stabilize: { level: v as StabilizeLevel } })} />
      {on && tracking && <Analysing label="Analysing motion" progress={tracking.progress} />}
    </Section>
  );
};

export const DenoiseProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClip(clipId);
  if (!hasEnhance(clip)) return null;
  const denoise = enhanceOf(clip).denoise;
  return (
    <Section title="Reduce image noise" checked={!!denoise} onCheckedChange={(v) => setEnhance(clipId, { denoise: v ? { strength: DEFAULT_DENOISE } : null })} onReset={denoise ? () => setEnhance(clipId, { denoise: { strength: DEFAULT_DENOISE } }) : undefined} testId="section-denoise">
      <PropertiesSlider label="Strength" value={denoise?.strength ?? DEFAULT_DENOISE} onChange={(v) => setEnhance(clipId, { denoise: { strength: Math.round(v) } })} min={0} max={100} step={1} toFixed={0} />
    </Section>
  );
};

export const DeflickerProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClip(clipId);
  const tracking = useTracking(clipId, clip);
  if (!hasEnhance(clip)) return null;
  const on = enhanceOf(clip).deflicker;
  return (
    <Section title="Remove flickers" checked={on} onCheckedChange={(v) => setEnhance(clipId, { deflicker: v })} testId="section-deflicker">
      {on && tracking ? <Analysing label="Analysing motion" progress={tracking.progress} /> : undefined}
    </Section>
  );
};

export const MotionBlurProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClip(clipId);
  if (!hasEnhance(clip)) return null;
  const blur = enhanceOf(clip).motionBlur;
  return (
    <Section title="Motion blur" checked={!!blur} onCheckedChange={(v) => setEnhance(clipId, { motionBlur: v ? { amount: DEFAULT_MOTION_BLUR } : null })} onReset={blur ? () => setEnhance(clipId, { motionBlur: { amount: DEFAULT_MOTION_BLUR } }) : undefined} testId="section-motion-blur">
      <PropertiesSlider label="Amount" value={blur?.amount ?? DEFAULT_MOTION_BLUR} onChange={(v) => setEnhance(clipId, { motionBlur: { amount: Math.round(v) } })} min={0} max={100} step={1} toFixed={0} />
    </Section>
  );
};
