import React, { useEffect, useRef } from "react";
import { useClipStore } from "@/lib/clip";
import { patchCaptions, useApplyToAllCaptions } from "@/lib/caption-actions";
import { boxChange, styleChange, styleOf } from "@/lib/caption-edit";
import type { TextClipProps } from "@/lib/types";
import { SmallCheckbox } from "./controls";

/**
 * "Apply to all main captions", at the top of a caption's Text tab (CapCut's checkbox). While
 * it's on, every change to this caption's look (font, colour, stroke, background, shadow, glow,
 * curve, case, spacing, its box's place, scale and opacity) goes to every other caption on its
 * track too, in the same undo step as the edit; switching it on gives them the whole look now.
 * The words and timing are never copied.
 */
const CaptionApplyAll: React.FC<{ clipId: string }> = ({ clipId }) => {
  const on = useApplyToAllCaptions((s) => s.on);
  const setOn = useApplyToAllCaptions((s) => s.set);
  const clip = useClipStore((s) => s.getClipById(clipId)) as TextClipProps | undefined;
  const last = useRef<{ id: string; clip: TextClipProps | undefined }>({ id: clipId, clip });

  useEffect(() => {
    const before = last.current;
    last.current = { id: clipId, clip };
    if (!on || !clip || !before.clip || before.id !== clipId || before.clip === clip) return;
    const style = styleChange(before.clip, clip);
    patchCaptions(clip.timelineId ?? "", clipId, (other) => {
      const box = boxChange(before.clip!, clip, other);
      const patch = { ...style, ...(box ?? {}) };
      return Object.keys(patch).length ? patch : null;
    });
  }, [on, clip, clipId]);

  if (!clip) return null;
  return (
    <div className="px-3 pt-3 pb-1 flex flex-row items-center gap-2 text-[12px] text-brand-light" data-testid="caption-apply-all">
      <SmallCheckbox
        testId="caption-apply-all-check"
        label="Apply to all main captions"
        checked={on}
        onChange={(next) => {
          setOn(next);
          if (next) patchCaptions(clip.timelineId ?? "", clipId, () => styleOf(clip));
        }}
      />
      <span className="ml-1">Apply to all main captions</span>
    </div>
  );
};

export default CaptionApplyAll;
