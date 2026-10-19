import React from "react";
import { useClipStore } from "@/lib/clip";
import { AnyClipProps, FilterClipProps } from "@/lib/types";
import { useControlsStore } from "@/lib/control";
import { clearKeyframes, editProperty, hasKeyframes, valueAt } from "@/lib/keyframes";
import PropertiesSlider from "./PropertiesSlider";
import KeyframeNav from "./KeyframeNav";
import { AudioSection } from "./AudioProperties";

interface FilterPropertiesProps {
  clipId: string;
}

/** What a CapCut draft's bar is, by its track (`draftKind`). */
const DRAFT_KINDS: Record<string, string> = {
  filter: "Filter",
  effect: "Effect",
  sticker: "Sticker",
  adjustment: "Adjustment layer",
};

/**
 * The filter clip's inspector, as CapCut's: "Filter parameters" (with its reset), the filter's
 * Name, and Intensity with its slider, field and keyframe navigator.
 */
const FilterProperties: React.FC<FilterPropertiesProps> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as FilterClipProps | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const fps = useControlsStore((s) => s.fps) || 30;
  const isPlaying = useControlsStore((s) => s.isPlaying);
  const pause = useControlsStore((s) => s.pause);
  // Only a clip whose intensity has keys follows the playhead.
  const keyed = !!clip && hasKeyframes(clip.keyframes, "intensity");
  const frame = useControlsStore((s) => (keyed ? s.focusFrame : (clip?.startFrame ?? 0)));
  if (!clip) return null;

  const raw = Number(valueAt(clip as AnyClipProps, "intensity", frame, fps) ?? 100);
  const intensity = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 100;

  const setIntensity = (value: number) => {
    if (isPlaying) pause();
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const now = useClipStore.getState().getClipById(clipId);
    if (now) updateClip(clipId, editProperty(now, "intensity", useControlsStore.getState().focusFrame, Math.max(0, Math.min(100, n))));
  };
  const reset = () => {
    const now = useClipStore.getState().getClipById(clipId);
    if (!now) return;
    updateClip(clipId, { intensity: 100, ...(hasKeyframes(now.keyframes, "intensity") ? { keyframes: clearKeyframes(now.keyframes, "intensity") } : {}) } as Partial<AnyClipProps>);
  };

  // A CapCut draft's bar: the engine draws its filters at this strength and its stickers at
  // this opacity; its effects and adjustment layers are kept for CapCut's export, without
  // settings.
  const fromDraft = clip.draftKind !== undefined;
  const sticker = clip.draftKind === "sticker";
  const title = fromDraft ? (DRAFT_KINDS[clip.draftKind ?? ""] ?? "CapCut") : "Filter parameters";

  return (
    <AudioSection title={title} onReset={fromDraft && !clip.drawn ? undefined : reset} testId="filter-parameters">
      <div className="flex flex-col gap-y-[9px]">
        {clip.name && (
          <div className="flex flex-row items-center min-h-[22px] gap-3 text-left" data-property="name">
            <span className="w-[74px] shrink-0 text-brand-light text-[12px]">Name</span>
            <span className="text-brand-light text-[12px] truncate" data-testid="filter-name">
              {clip.name}
              {fromDraft ? " (CapCut)" : ""}
            </span>
          </div>
        )}
        {fromDraft && !clip.drawn ? (
          <p className="text-[#6c6c6c] text-[11px] text-start">The engine doesn&apos;t draw this yet; CapCut&apos;s export has it.</p>
        ) : (
          <div className="flex flex-row items-end gap-[5px] min-w-0" data-property="intensity">
            <div className="flex-1 min-w-0">
              <PropertiesSlider label={sticker ? "Opacity" : "Intensity"} value={Math.round(intensity)} onChange={setIntensity} min={0} max={100} step={1} toFixed={0} />
            </div>
            {!fromDraft && <KeyframeNav clip={clip as AnyClipProps} property="intensity" />}
          </div>
        )}
      </div>
    </AudioSection>
  );
};

export default FilterProperties;
