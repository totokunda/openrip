import { useControlsStore } from "@/lib/control";
import { AnyClipProps, MaskClipProps, MaskData } from "@/lib/types";
import { editMaskPose, maskFrame, posesOf } from "@/lib/mask-shapes";

type MaskKeyframes = Map<number, MaskData> | Record<number, MaskData>;

interface UpsertMaskKeyframeArgs {
  mask: MaskClipProps;
  clip?: AnyClipProps;
  focusFrame: number;
  updater: (previous: MaskData) => MaskData;
}

interface UpsertMaskKeyframeResult {
  keyframes: MaskKeyframes;
  frame: number;
  created: boolean;
  previousFrame: number | undefined;
}

/**
 * An edit of a mask's pose at the playhead, from its handles on the canvas or its panel, by
 * CapCut's rule (lib/mask-shapes.ts): a keyed mask gets a pose at the playhead (from the pose
 * it has there), a static one has its one pose changed. Returns the mask's new keyframes.
 */
export const upsertMaskKeyframe = ({
  mask,
  clip,
  focusFrame,
  updater,
}: UpsertMaskKeyframeArgs): UpsertMaskKeyframeResult | null => {
  if (!mask.keyframes) return null;
  const fps = useControlsStore.getState().fps || 24;
  const frame = clip ? maskFrame(clip, focusFrame) : Math.max(0, Math.round(focusFrame));
  const before = posesOf(mask).map(([f]) => f);
  const next = editMaskPose(mask, frame, fps, (pose) => {
    const out = updater(pose);
    // The feather stays where editMaskPose keeps it: a handle doesn't change it.
    if ((pose as any).featherAmount !== undefined && (out as any).featherAmount === undefined) (out as any).featherAmount = (pose as any).featherAmount;
    return out;
  });
  const after = posesOf(next).map(([f]) => f);
  const created = after.length > before.length;
  return {
    keyframes: next.keyframes,
    frame: created ? frame : (after.find((f) => !before.includes(f)) ?? after[0] ?? frame),
    created,
    previousFrame: before.filter((f) => f <= frame).pop(),
  };
};
