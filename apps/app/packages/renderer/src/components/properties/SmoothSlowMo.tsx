import React, { useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { hasCurve } from "@/lib/speed";
import type { AnyClipProps, VideoClipProps } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { SelectRow } from "./TrackingProperties";

/**
 * Speed › Standard › Smooth slow-mo, as CapCut lays it out: a checkbox row, greyed with "Only
 * slow-speed videos are supported." until the clip plays slower than its source, and under its
 * arrow how the frames in between are made: Optical flow (moved along their motion) or Frame
 * blending (cross-faded). The engine makes them in the preview and the export
 * (engine/crates/playback/src/preview.rs).
 */
const MODES = [
  { value: "optical_flow", label: "Optical flow" },
  { value: "frame_blending", label: "Frame blending" },
];

/** Whether the clip plays slower than its source anywhere. */
export const isSlow = (clip: VideoClipProps): boolean =>
  hasCurve(clip) ? clip.speedCurve!.points.some((p) => p.y < 1) : Math.max(0.1, Number(clip.speed || 1)) < 1;

export const SmoothSlowMoRow: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as VideoClipProps | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const [open, setOpen] = useState(false);
  if (!clip || clip.type !== "video") return null;
  const slow = isSlow(clip);
  const smooth = clip.smoothSlowMo ?? null;
  const set = (value: VideoClipProps["smoothSlowMo"]) => updateClip(clipId, { smoothSlowMo: value } as Partial<AnyClipProps>);
  return (
    <div data-testid="smooth-slowmo" data-enabled={slow}>
      <div className="flex items-center h-[38px] gap-x-2 min-w-0">
        <Checkbox
          data-testid="smooth-slowmo-toggle"
          checked={slow && !!smooth}
          disabled={!slow}
          onCheckedChange={(v) => set(v === true ? { mode: smooth?.mode ?? "optical_flow" } : null)}
          className="h-[14px] w-[14px] rounded-[3px]"
        />
        <span className={cn("text-[12px] shrink-0", slow ? "text-brand-light" : "text-[#525252]")}>Smooth slow-mo</span>
        {!slow && <span className="text-[12px] text-[#525252] truncate min-w-0">Only slow-speed videos are supported.</span>}
        <button type="button" aria-label={open ? "Hide options" : "Show options"} disabled={!slow} onClick={() => setOpen(!open)} className="shrink-0 text-brand-light hover:text-brand-lighter disabled:text-[#525252]">
          {open && slow ? <LuChevronUp className="w-3 h-3" /> : <LuChevronDown className="w-3 h-3" />}
        </button>
      </div>
      {open && slow && (
        <SelectRow label="Mode" testId="smooth-slowmo-mode" value={smooth?.mode ?? "optical_flow"} options={MODES} disabled={!smooth} onChange={(v) => set({ mode: v as "optical_flow" | "frame_blending" })} />
      )}
    </div>
  );
};

export default SmoothSlowMoRow;
