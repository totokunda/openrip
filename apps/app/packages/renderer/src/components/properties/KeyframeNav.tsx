import React from "react";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { hasKeyframes, keyframeAt, localFrame, nextKeyframe, previousKeyframe, toggleKeyframe } from "@/lib/keyframes";
import type { AnyClipProps, KeyframeProperty } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * CapCut's keyframe navigator (‹ ◇ ›, 30 px) for one of the clip's properties: ‹ and › go to the
 * key before and after the playhead, the diamond adds a key there with the value it has
 * (filled in the accent when there's one) or takes it off.
 */
const KeyframeNav: React.FC<{ clip: AnyClipProps; property: KeyframeProperty }> = ({ clip, property }) => {
  const updateClip = useClipStore((s) => s.updateClip);
  const fps = useControlsStore((s) => s.fps) || 30;
  // Without keys nothing here depends on the playhead, so it doesn't re-render as it moves.
  const keyed = hasKeyframes(clip.keyframes, property);
  const frame = useControlsStore((s) => (keyed ? s.focusFrame : -1));
  const local = localFrame(clip, frame);
  const at = !!keyframeAt(clip.keyframes, property, local);
  const prev = previousKeyframe(clip.keyframes, property, local);
  const next = nextKeyframe(clip.keyframes, property, local);
  const seek = (f: number) => useControlsStore.getState().setFocusFrame((clip.startFrame ?? 0) + f);
  const arrow = (to: number | undefined, label: string, d: string) => (
    <button
      type="button"
      aria-label={label}
      disabled={to === undefined}
      onClick={() => to !== undefined && seek(to)}
      className="h-[22px] w-[7px] flex items-center justify-center text-[#949494] hover:text-brand-lighter disabled:text-[#565656] disabled:cursor-default"
    >
      <svg width="5" height="9" viewBox="0 0 5 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
  return (
    <div className="w-[30px] h-[22px] shrink-0 flex items-center justify-between" data-keyframe={property} data-at={at}>
      {arrow(prev?.frame, "Previous keyframe", "M4 1 L1 4.5 L4 8")}
      <button
        type="button"
        title={at ? "Remove keyframe" : "Add keyframe"}
        aria-pressed={at}
        onClick={() => updateClip(clip.clipId, toggleKeyframe(clip, property, useControlsStore.getState().focusFrame, fps))}
        className={cn("h-[22px] w-[12px] flex items-center justify-center", at ? "text-brand-accent" : "text-[#8a8a8a] hover:text-brand-lighter")}
      >
        <svg width="11" height="11" viewBox="0 0 11 11">
          <rect x="2.2" y="2.2" width="6.6" height="6.6" rx="0.8" transform="rotate(45 5.5 5.5)" fill={at ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      {arrow(next?.frame, "Next keyframe", "M1 1 L4 4.5 L1 8")}
    </div>
  );
};

export default KeyframeNav;
