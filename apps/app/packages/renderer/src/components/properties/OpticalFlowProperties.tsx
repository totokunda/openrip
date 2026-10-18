import React, { useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import type { AnyClipProps, VideoClipProps } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectRow } from "./TrackingProperties";

/**
 * Video › Basic › Optical flow, as CapCut lays it out: a checkbox section with its options
 * under the arrow (the frame rate the clip's frames are made up to; CapCut offers 60 fps) and
 * Apply to all, which gives every video clip the same setting. The engine then makes the
 * clip's frames between its own by optical flow wherever the project shows it between two of
 * them (engine/crates/playback/src/preview.rs, `tween_mode`).
 */
const FRAME_RATES = [{ value: "60", label: "60 fps" }];

const OpticalFlowProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as VideoClipProps | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const [open, setOpen] = useState(false);
  if (!clip || clip.type !== "video") return null;
  const flow = clip.opticalFlow ?? null;
  const set = (value: VideoClipProps["opticalFlow"]) => updateClip(clipId, { opticalFlow: value } as Partial<AnyClipProps>);
  const applyToAll = () => {
    const { clips } = useClipStore.getState();
    for (const c of clips) if (c.type === "video" && c.clipId !== clipId) updateClip(c.clipId, { opticalFlow: flow ? { ...flow } : null } as Partial<AnyClipProps>);
  };
  return (
    <div className="px-4 py-3" data-testid="optical-flow">
      <div className="flex items-center justify-between h-[22px]">
        <label className="flex items-center gap-x-2 cursor-pointer">
          <Checkbox data-testid="optical-flow-toggle" checked={!!flow} onCheckedChange={(v) => set(v === true ? { fps: flow?.fps ?? 60 } : null)} className="h-[14px] w-[14px] rounded-[3px]" />
          <span className="text-[12.5px] font-semibold text-brand-lighter">Optical flow</span>
        </label>
        <button type="button" aria-label={open ? "Hide options" : "Show options"} onClick={() => setOpen(!open)} className="ml-1 text-brand-light hover:text-brand-lighter">
          {open ? <LuChevronUp className="w-3 h-3" /> : <LuChevronDown className="w-3 h-3" />}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="optical-flow-apply-all"
          onClick={applyToAll}
          className="h-[22px] px-2.5 rounded-[4px] bg-brand-background-light text-[12px] text-brand-light hover:text-brand-lighter"
        >
          Apply to all
        </button>
      </div>
      {open && (
        <div className="pt-2">
          <SelectRow label="Frame rate" value={String(flow?.fps ?? 60)} options={FRAME_RATES} disabled={!flow} onChange={(v) => set({ fps: Number(v) })} />
          <p className="text-[11px] text-[#949494] leading-[15px]">Frames between the clip's own are made from the motion in them, for smooth movement at the project's frame rate.</p>
        </div>
      )}
    </div>
  );
};

export default OpticalFlowProperties;
