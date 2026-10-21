import React from "react";
import Color from "color";
import { LuArrowDown, LuArrowDownLeft, LuArrowDownRight, LuArrowLeft, LuArrowRight, LuArrowUp, LuArrowUpLeft, LuArrowUpRight, LuRotateCcw } from "react-icons/lu";
import { TRANSITIONS } from "@/lib/animations";
import type { GlParamDef } from "@/lib/glTransitions";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import {
  MIN_TRANSITION,
  applyTransitionToAll,
  cutsOn,
  resetTransition,
  sameShotAt,
  setTransitionDirection,
  setTransitionParam,
  setTransitionDuration,
  takesTransition,
  transitionMax,
} from "@/lib/transitions";
import type { AnimationDirection, ClipTransition, TransitionParamValue } from "@/lib/types";
import { cn } from "@/lib/utils";
import ColorInput from "./ColorInput";
import { Toggle } from "./controls";
import PropertiesSlider from "./PropertiesSlider";
import PropertyRow from "./PropertyRow";

const DIRECTIONS: { value: AnimationDirection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "left", label: "Left", icon: LuArrowLeft },
  { value: "right", label: "Right", icon: LuArrowRight },
  { value: "up", label: "Up", icon: LuArrowUp },
  { value: "down", label: "Down", icon: LuArrowDown },
];

/** The eight ways a shader transition's direction can point, [x, y] (+y up in the collection). */
const COMPASS: { v: [number, number]; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { v: [-1, 1], label: "Up left", icon: LuArrowUpLeft },
  { v: [0, 1], label: "Up", icon: LuArrowUp },
  { v: [1, 1], label: "Up right", icon: LuArrowUpRight },
  { v: [-1, 0], label: "Left", icon: LuArrowLeft },
  { v: [1, 0], label: "Right", icon: LuArrowRight },
  { v: [-1, -1], label: "Down left", icon: LuArrowDownLeft },
  { v: [0, -1], label: "Down", icon: LuArrowDown },
  { v: [1, -1], label: "Down right", icon: LuArrowDownRight },
];

const sameVec = (a: unknown, b: [number, number]) => Array.isArray(a) && Math.sign(a[0]) === b[0] && Math.sign(a[1]) === b[1];
const decimals = (step: number) => (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

/** One of a shader transition's own parameters, as its kind asks: a slider, a switch, a colour, a direction. */
const ShaderParam: React.FC<{ def: GlParamDef; t: ClipTransition; set: (v: TransitionParamValue) => void }> = ({ def, t, set }) => {
  const raw = t.params?.[def.key];
  const id = `transition-param-${def.key}`;
  switch (def.kind) {
    case "float":
    case "int": {
      const value = typeof raw === "number" ? raw : def.default;
      return (
        <div className="py-1" data-testid={id}>
          <PropertiesSlider label={def.label} value={value} onChange={(v) => set(def.kind === "int" ? Math.round(v) : v)} min={def.min} max={def.max} step={def.step} toFixed={decimals(def.step)} />
        </div>
      );
    }
    case "bool":
      return (
        <PropertyRow label={def.label}>
          <span data-testid={id}>
            <Toggle on={typeof raw === "boolean" ? raw : def.default} onChange={set} label={def.label} />
          </span>
        </PropertyRow>
      );
    case "color": {
      const value = typeof raw === "string" ? raw : def.default;
      return (
        <PropertyRow label={def.label}>
          <span data-testid={id}>
            <ColorInput
              value={value}
              onChange={(c) => {
                try {
                  set(Color(c).hex().toLowerCase());
                } catch {
                  /* not a colour yet */
                }
              }}
            />
          </span>
        </PropertyRow>
      );
    }
    case "direction": {
      const value = Array.isArray(raw) ? raw : def.default;
      return (
        <PropertyRow label={def.label}>
          <div role="radiogroup" aria-label={def.label} data-testid={id} className="grid grid-cols-4 gap-px rounded-[4px] bg-brand-background-light overflow-hidden w-[104px]">
            {COMPASS.map(({ v, label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                role="radio"
                title={label}
                aria-checked={sameVec(value, v)}
                data-testid={`${id}-${label.toLowerCase().replace(" ", "-")}`}
                onClick={() => set(v)}
                className={cn("h-[22px] flex items-center justify-center", sameVec(value, v) ? "bg-brand-button text-brand-lighter" : "text-brand-light/70 hover:text-brand-lighter")}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </PropertyRow>
      );
    }
    case "point":
    case "int2": {
      const value = Array.isArray(raw) ? raw : def.default;
      const [lo, hi, step, names] = def.kind === "int2" ? [def.min, def.max, 1, ["Columns", "Rows"]] : [0, 1, 0.01, ["X", "Y"]];
      return (
        <div data-testid={id} className="py-1">
          {[0, 1].map((i) => (
            <PropertiesSlider
              key={i}
              label={`${def.label} ${names[i]}`}
              value={value[i]}
              onChange={(x) => set(i === 0 ? [def.kind === "int2" ? Math.round(x) : x, value[1]] : [value[0], def.kind === "int2" ? Math.round(x) : x])}
              min={lo as number}
              max={hi as number}
              step={step as number}
              toFixed={decimals(step as number)}
            />
          ))}
        </div>
      );
    }
  }
};

/**
 * The inspector for the transition selected on the timeline, as CapCut's Transition tab: its
 * parameters (name, duration within the shorter clip at its cut, the direction for a slide,
 * push or wipe) with a reset, and Apply to all in the footer, which gives every cut of its track
 * the same transition. A CapCut transition the engine doesn't draw is named and kept.
 */
const TransitionProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId));
  const fps = useControlsStore((s) => s.fps) || 30;
  const max = useClipStore((s) => (clip ? transitionMax(s.clips, clip, fps) : MIN_TRANSITION));
  const others = useClipStore((s) => (clip?.timelineId ? cutsOn(s.clips, clip.timelineId).length - 1 : 0));
  const sameShot = useClipStore((s) => (clip ? sameShotAt(s.clips, clip, fps) : false));
  const t = takesTransition(clip) ? clip.transitionOut : null;
  if (!t) return null;
  const builtin = TRANSITIONS.find((b) => b.type === t.type);
  const kept = !builtin;
  const direction = t.params?.direction ?? "left";

  return (
    <div data-testid="inspector-transition" className="flex flex-col h-full min-w-0">
      <div role="tablist" className="h-[42px] shrink-0 flex items-center px-[11px] bg-brand-header border-b-[0.5px] border-brand-hairline">
        <span role="tab" aria-selected data-state="active" className="text-[13px] font-semibold text-brand-accent">
          Transition
        </span>
      </div>
      <div role="tabpanel" className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3">
        <div className="flex items-center justify-between h-[55px]">
          <h4 className="text-[12px] font-semibold text-brand-light">Transition parameters</h4>
          {!kept && (
            <button type="button" title="Reset" data-testid="transition-reset" onClick={() => resetTransition(clipId)} className="text-brand-light/80 hover:text-brand-lighter">
              <LuRotateCcw className="w-[13px] h-[13px]" />
            </button>
          )}
        </div>
        <PropertyRow label="Name">
          <span data-testid="transition-name" className="text-[13px] text-brand-lighter truncate">
            {kept ? `${t.name || "CapCut's"} (CapCut)` : builtin.name}
          </span>
        </PropertyRow>
        {sameShot && (
          <p data-testid="transition-same-shot" className="text-[12px] text-[#949494] text-left py-2">
            Both sides of this cut are the same shot, so a transition that blends one picture into the other won't show here. Ones that move or flash the picture do, such as Slide, Push, White Flash and Blur.
          </p>
        )}
        {!kept && (
          <div className="pt-2 pb-1">
            <PropertiesSlider
              label="Duration"
              value={Math.min(t.duration, max)}
              onChange={(d) => setTransitionDuration(clipId, d)}
              min={MIN_TRANSITION}
              max={max}
              step={0.1}
              suffix="s"
              toFixed={1}
            />
          </div>
        )}
        {builtin?.params?.some((p) => p.key === "direction") && (
          <PropertyRow label="Direction">
            <div role="radiogroup" aria-label="Direction" className="flex h-[22px] rounded-[4px] bg-brand-background-light overflow-hidden">
              {DIRECTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  title={label}
                  aria-checked={direction === value}
                  data-testid={`transition-direction-${value}`}
                  onClick={() => setTransitionDirection(clipId, value)}
                  className={cn("w-[26px] h-full flex items-center justify-center", direction === value ? "bg-brand-button text-brand-lighter" : "text-brand-light/70 hover:text-brand-lighter")}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          </PropertyRow>
        )}
        {builtin?.shader?.params.map((def) => (
          <ShaderParam key={def.key} def={def} t={t} set={(v) => setTransitionParam(clipId, def.key, v)} />
        ))}
        {builtin?.shader && (
          <p data-testid="transition-credit" className="text-[11px] text-[#6c6c6c] text-left py-2">
            From the gl-transitions collection by {builtin.shader.author} ({builtin.shader.license}).
          </p>
        )}
        {kept && <p className="text-[12px] text-[#949494] text-left py-2">The engine doesn't draw this CapCut transition yet; CapCut's export has it.</p>}
      </div>
      <div className="h-9 shrink-0 flex items-center justify-end px-3 bg-brand-header">
        <button
          type="button"
          data-testid="transition-apply-all"
          disabled={others < 1}
          onClick={() => applyTransitionToAll(clipId)}
          className="h-[22px] px-3 rounded-[4px] bg-brand-button text-[12px] font-semibold text-brand-lighter hover:bg-[#5a5a5a] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Apply to all
        </button>
      </div>
    </div>
  );
};

export default TransitionProperties;
