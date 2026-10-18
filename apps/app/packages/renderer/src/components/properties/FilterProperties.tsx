import React, { useMemo } from "react";
import { useClipStore } from "@/lib/clip";
import { FilterClipProps } from "@/lib/types";
import { useControlsStore } from "@/lib/control";
import PropertiesSlider from "./PropertiesSlider";

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

const FilterProperties: React.FC<FilterPropertiesProps> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as
    | FilterClipProps
    | undefined;
  const { updateClip } = useClipStore();
  const { isPlaying, pause } = useControlsStore();

  const intensity = useMemo(() => {
    const raw = clip?.intensity ?? 100;
    if (!Number.isFinite(raw)) return 100;
    return Math.max(0, Math.min(100, Number(raw)));
  }, [clip?.intensity]);

  const setIntensity = (value: number) => {
    if (isPlaying) pause();
    const numValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numValue)) return;
    const clamped = Math.max(0, Math.min(100, numValue));
    updateClip(clipId, { intensity: clamped });
  };

  // A CapCut draft's bar: the engine draws its filters at this strength and its stickers at
  // this opacity; its effects and adjustment layers are kept for CapCut's export, without
  // settings.
  const fromDraft = clip?.draftKind !== undefined;
  const sticker = clip?.draftKind === "sticker";
  const title = fromDraft ? (DRAFT_KINDS[clip?.draftKind ?? ""] ?? "CapCut") : "Filter";

  return (
    <div className="flex flex-col gap-y-2 min-w-0 p-4 px-5 border-b border-brand-light/5">
      <h4 className="text-brand-light text-[12px] font-medium text-start mb-4">
        {title}
      </h4>
      {fromDraft && clip?.name && (
        <p className="text-brand-light text-[10.5px] text-start -mt-2 mb-2">{clip.name} (CapCut)</p>
      )}
      {fromDraft && !clip?.drawn ? (
        <p className="text-brand-light/50 text-[10px] text-start">
          The engine doesn&apos;t draw this yet; CapCut&apos;s export has it.
        </p>
      ) : (
        <PropertiesSlider
          label={sticker ? "Opacity" : "Intensity"}
          value={Math.round(intensity)}
          onChange={setIntensity}
          min={0}
          max={100}
          step={1}
          suffix="%"
          toFixed={0}
        />
      )}
    </div>
  );
};

export default FilterProperties;
