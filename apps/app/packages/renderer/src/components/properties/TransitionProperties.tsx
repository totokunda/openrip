import React from "react";
import { LuArrowDown, LuArrowLeft, LuArrowRight, LuArrowUp, LuRotateCcw } from "react-icons/lu";
import { TRANSITIONS } from "@/lib/animations";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import {
  MIN_TRANSITION,
  applyTransitionToAll,
  cutsOn,
  resetTransition,
  setTransitionDirection,
  setTransitionDuration,
  takesTransition,
  transitionMax,
} from "@/lib/transitions";
import type { AnimationDirection } from "@/lib/types";
import { cn } from "@/lib/utils";
import PropertiesSlider from "./PropertiesSlider";
import PropertyRow from "./PropertyRow";

const DIRECTIONS: { value: AnimationDirection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "left", label: "Left", icon: LuArrowLeft },
  { value: "right", label: "Right", icon: LuArrowRight },
  { value: "up", label: "Up", icon: LuArrowUp },
  { value: "down", label: "Down", icon: LuArrowDown },
];

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
