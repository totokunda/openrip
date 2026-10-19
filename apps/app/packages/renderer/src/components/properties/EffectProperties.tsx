import React from "react";
import { LuX } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { defaultEffectParams, effectDef, useEffectCatalog, type EffectDef } from "@/lib/effects/catalog";
import { clearKeyframes } from "@/lib/keyframes";
import type { AnyClipProps, ClipEffect, ClipKeyframes, FilterClipProps, KeyframeProperty } from "@/lib/types";
import { AudioSection } from "./AudioProperties";
import KeyframedSlider from "./KeyframedSlider";

/** Keys of an effect's properties off a clip's keyframes. */
const withoutKeys = (keyframes: ClipKeyframes | undefined, properties: KeyframeProperty[]): ClipKeyframes | undefined => properties.reduce((k, p) => clearKeyframes(k, p), keyframes);

/** The sliders of one effect: its strength and its own parameters, each with a keyframe navigator (0–100). */
const EffectSliders: React.FC<{ clipId: string; def: EffectDef; intensity: KeyframeProperty; param: (id: string) => KeyframeProperty }> = ({ clipId, def, intensity, param }) => (
  <div className="flex flex-col gap-y-[9px]">
    <KeyframedSlider clipId={clipId} property={intensity} label="Intensity" min={0} max={100} />
    {def.params.map((p) => (
      <KeyframedSlider key={p.id} clipId={clipId} property={param(p.id)} label={p.name} min={0} max={100} />
    ))}
  </div>
);

const NameRow: React.FC<{ name: string }> = ({ name }) => (
  <div className="flex flex-row items-center min-h-[22px] gap-3 text-left" data-property="name">
    <span className="w-[74px] shrink-0 text-brand-light text-[12px]">Name</span>
    <span className="text-brand-light text-[12px] truncate" data-testid="effect-name">
      {name}
    </span>
  </div>
);

/**
 * An effect bar's inspector, as CapCut's: "Details" (with its reset), the effect's Name, and its
 * parameters with a slider, field and keyframe navigator each (OpenRip's effects add their
 * Intensity to CapCut's lone Speed).
 */
const EffectProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  useEffectCatalog();
  const clip = useClipStore((s) => s.getClipById(clipId)) as FilterClipProps | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const def = effectDef(clip?.effectId);
  if (!clip) return null;
  const reset = () => {
    const now = useClipStore.getState().getClipById(clipId) as FilterClipProps | undefined;
    if (!now || !def) return;
    const props: KeyframeProperty[] = ["intensity", ...def.params.map((p) => `fx:${p.id}` as KeyframeProperty)];
    updateClip(clipId, { intensity: def.intensity, effectParams: defaultEffectParams(def), keyframes: withoutKeys(now.keyframes, props) } as Partial<AnyClipProps>);
  };
  return (
    <AudioSection title="Details" onReset={def ? reset : undefined} testId="effect-parameters">
      <div className="flex flex-col gap-y-[9px]">
        <NameRow name={clip.name || def?.name || "Effect"} />
        {def ? (
          <EffectSliders clipId={clipId} def={def} intensity="intensity" param={(id) => `fx:${id}`} />
        ) : (
          <p className="text-[#6c6c6c] text-[11px] text-start">This effect isn&apos;t in the engine&apos;s catalog.</p>
        )}
      </div>
    </AudioSection>
  );
};

export default EffectProperties;

/**
 * The effects on a video or photo (the Adjust tab's Effects): one section each, with its name,
 * parameters and keyframes, and a button to take it off. Effects are added by dragging them
 * from the Effects tab onto the clip.
 */
export const ClipEffectsProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  useEffectCatalog();
  const clip = useClipStore((s) => s.getClipById(clipId)) as (AnyClipProps & { effects?: ClipEffect[] }) | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  if (!clip) return null;
  const effects = clip.effects ?? [];
  const patchEffect = (id: string, def: EffectDef | undefined, reset: boolean) => {
    const now = useClipStore.getState().getClipById(clipId) as (AnyClipProps & { effects?: ClipEffect[] }) | undefined;
    if (!now) return;
    const props = (def ? ["intensity", ...def.params.map((p) => p.id)] : []).map((p) => `fx:${id}:${p}` as KeyframeProperty);
    const keyframes = withoutKeys(now.keyframes, props);
    if (!reset) {
      updateClip(clipId, { effects: (now.effects ?? []).filter((e) => e.id !== id), keyframes } as Partial<AnyClipProps>);
      return;
    }
    if (!def) return;
    updateClip(clipId, { effects: (now.effects ?? []).map((e) => (e.id === id ? { ...e, intensity: def.intensity, params: defaultEffectParams(def) } : e)), keyframes } as Partial<AnyClipProps>);
  };
  if (effects.length === 0) {
    return (
      <section className="px-3 py-5 text-left" data-testid="clip-effects-empty">
        <p className="text-[#6c6c6c] text-[12px] leading-snug">No effects on this clip. Drag one from the Effects tab onto it.</p>
      </section>
    );
  }
  return (
    <div className="min-w-0 divide-y divide-brand-divider" data-testid="clip-effects">
      {effects.map((e) => {
        const def = effectDef(e.effectId);
        return (
          <div key={e.id} data-testid="clip-effect" data-effect={e.effectId} data-instance={e.id} className="relative">
            <AudioSection title={e.name || def?.name || "Effect"} onReset={def ? () => patchEffect(e.id, def, true) : undefined}>
              <div className="flex flex-col gap-y-[9px]">
                {def ? (
                  <EffectSliders clipId={clipId} def={def} intensity={`fx:${e.id}:intensity`} param={(id) => `fx:${e.id}:${id}`} />
                ) : (
                  <p className="text-[#6c6c6c] text-[11px] text-start">This effect isn&apos;t in the engine&apos;s catalog.</p>
                )}
              </div>
            </AudioSection>
            <button
              type="button"
              title={`Remove ${e.name}`}
              aria-label={`Remove ${e.name}`}
              data-testid="clip-effect-remove"
              onClick={() => patchEffect(e.id, def, false)}
              className="absolute top-[19px] right-9 text-brand-light hover:text-brand-lighter"
            >
              <LuX className="w-[14px] h-[14px]" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
