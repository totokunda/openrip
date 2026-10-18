import React, { useState } from "react";
import { useClipStore } from "@/lib/clip";
import { trackMask, useTrackingStore } from "@/lib/tracking-run";
import type { TrackDirection } from "@/lib/tracking";
import type { MaskClipProps } from "@/lib/types";
import { DIRECTIONS, SelectRow, TrackProgress } from "../TrackingProperties";

/**
 * The Mask tab's Track mask, as CapCut lays it out under the mask's settings: a collapsible
 * section with the Direction (Both, Forward, Backward), then Hide (folds the section) and
 * Track. Track follows the mask's shape through its video's frames with the engine and keys
 * the mask's poses to it (lib/tracking-run.ts `trackMask`): it moves, scales and turns with
 * what it covers. Shape masks on a video only.
 */
const TrackMaskSection: React.FC<{ clipId: string; mask: MaskClipProps }> = ({ clipId, mask }) => {
  const clip = useClipStore((s) => s.getClipById(clipId));
  const running = useTrackingStore((s) => s.running);
  const note = useTrackingStore((s) => s.notes[clipId]);
  const [open, setOpen] = useState(true);
  const [direction, setDirection] = useState<TrackDirection>("both");
  if (!clip || clip.type !== "video" || mask.tool !== "shape") return null;
  const mine = running?.clipId === clipId && running.maskId === mask.id;
  return (
    <div className="px-4 py-3" data-testid="track-mask">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-x-1.5 h-5">
        <h4 className="text-brand-lighter text-[12.5px] font-semibold">Track mask</h4>
        <span className="text-[8px] text-brand-light">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="pt-2">
          <SelectRow label="Direction" testId="track-mask-direction" value={direction} options={DIRECTIONS} onChange={(v) => setDirection(v as TrackDirection)} disabled={!!running} />
          <div className="flex items-center justify-between h-[34px] gap-x-2">
            {mine ? (
              <TrackProgress done={running!.done} total={running!.total} />
            ) : (
              <>
                <button type="button" data-testid="track-mask-hide" onClick={() => setOpen(false)} className="h-[22px] px-3 rounded-[4px] text-[12px] text-brand-light hover:text-brand-lighter">
                  Hide
                </button>
                <button
                  type="button"
                  data-testid="track-mask-track"
                  disabled={!!running}
                  onClick={() => void trackMask(clipId, mask.id, direction)}
                  className="h-[22px] w-[72px] rounded-[4px] bg-brand-accent text-[12px] font-semibold text-white hover:bg-brand-accent-two-shade disabled:bg-brand-button disabled:text-brand-light/60"
                >
                  Track
                </button>
              </>
            )}
          </div>
          {note && (
            <p className="text-[11px] text-brand-accent leading-[15px]" data-testid="track-mask-note">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default TrackMaskSection;
