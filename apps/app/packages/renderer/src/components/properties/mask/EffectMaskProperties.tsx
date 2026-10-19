import React, { useEffect } from "react";
import { useClipStore } from "@/lib/clip";
import { useViewportStore } from "@/lib/viewport";
import { BASE_LONG_SIDE } from "@/lib/settings";
import { worldCanvas } from "@/lib/shape-presets";
import type { AnyClipProps } from "@/lib/types";
import MaskPropertiesPanel from "./MaskPropertiesPanel";

/**
 * An effect clip's Mask tab (CapCut's `23-inspector-effect/002-fade-in-mask`): the video's Mask
 * panel, for the bar. Its masks limit where the effect is drawn (the engine draws the effect
 * only inside them, preview and export alike). The masks sit on the canvas's whole box, which
 * a bar made before this tab gets when the tab is first opened.
 */
const EffectMaskProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const has = useClipStore((s) => !!s.getClipById(clipId)?.transform);
  const aspect = useViewportStore((s) => s.aspectRatio);
  useEffect(() => {
    if (has) return;
    const canvas = worldCanvas(aspect, BASE_LONG_SIDE);
    const transform = { x: 0, y: 0, width: canvas.width, height: canvas.height, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 };
    useClipStore.getState().updateClip(clipId, { transform, originalTransform: { ...transform }, masks: [] } as unknown as Partial<AnyClipProps>);
  }, [has, aspect, clipId]);
  if (!has) return null;
  return <MaskPropertiesPanel clipId={clipId} />;
};

export default EffectMaskProperties;
