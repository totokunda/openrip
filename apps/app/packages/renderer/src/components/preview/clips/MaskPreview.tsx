import React, { useEffect, useMemo, useRef } from "react";
import { Group } from "react-konva";
import Konva from "konva";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { AnyClipProps, ClipTransform, MaskClipProps, MaskShapeTool } from "@/lib/types";
import { useViewportStore } from "@/lib/viewport";
import { useMaskStore } from "@/lib/mask";
import { useInspectorStore } from "@/lib/inspector";
import { transformAt } from "@/lib/inspector-edits";
import { maskFrame, poseAt } from "@/lib/mask-shapes";
import { getCropOffset } from "@/components/preview/mask/crop";

import LassoMaskPreview from "./LassoMaskPreview";
import ShapeMaskPreview from "./ShapeMaskPreview";

interface MaskPreviewProps {
  clips: AnyClipProps[];
  sortClips: (clips: AnyClipProps[]) => AnyClipProps[];
  filterClips: (clips: AnyClipProps[], audio?: boolean) => AnyClipProps[];
  rectWidth: number;
  rectHeight: number;
}

/**
 * Where a clip's masks go on the canvas: the clip's place and turn at the playhead (its keys'
 * when it's keyed), then its crop offset (the saved geometry stays uncropped; the image shifts
 * its media by the crop) and the clip's scale over the scale the mask was drawn at (the engine
 * reads a mask as fractions of the picture, so it scales with the clip).
 */
const groupTransforms = (shown: ClipTransform | undefined, mask: MaskClipProps) => {
  if (!shown) return { outer: {}, inner: {} };
  const { offsetX, offsetY } = getCropOffset(shown);
  const mt = mask.transform ?? shown;
  return {
    outer: { x: shown.x || 0, y: shown.y || 0, rotation: shown.rotation || 0 },
    inner: { x: -offsetX, y: -offsetY, scaleX: (shown.scaleX || 1) / (mt.scaleX || 1), scaleY: (shown.scaleY || 1) / (mt.scaleY || 1) },
  };
};

/**
 * The masks' outlines and handles over the picture: with the mask tool (every mask of the
 * clips at the playhead, tinted over the unmasked clip), or while the inspector's Mask tab is
 * open (the selected clip's masks as outlines over the engine's masked picture, the selected
 * one with handles). Each mask shows its pose at the playhead (lib/mask-shapes.ts).
 */
const MaskPreview: React.FC<MaskPreviewProps> = ({ clips, sortClips, filterClips, rectWidth, rectHeight }) => {
  const { clipWithinFrame } = useClipStore();
  const focusFrame = useControlsStore((s) => s.focusFrame);
  const fps = useControlsStore((s) => s.fps);
  const selectedClipIds = useControlsStore((s) => s.selectedClipIds);
  const tool = useViewportStore((s) => s.tool);
  const inspectorMask = useInspectorStore((s) => s.tab === "video" && s.sub.video === "mask");
  const setIsOverMask = useMaskStore((s) => s.setIsOverMask);
  const isOverMask = useMaskStore((s) => s.isOverMask);
  const ref = useRef<Konva.Group>(null);

  const editing = tool === "mask" || inspectorMask;
  const selectedClip = selectedClipIds[selectedClipIds.length - 1];

  const items = useMemo(() => {
    if (!editing) return [];
    const out: { clip: AnyClipProps; mask: MaskClipProps; shown?: ClipTransform }[] = [];
    for (const clip of sortClips(filterClips(clips))) {
      if (clip.type !== "video" && clip.type !== "image") continue;
      if (!clipWithinFrame(clip, focusFrame)) continue;
      // From the inspector: the selected clip's masks only.
      if (tool !== "mask" && clip.clipId !== selectedClip) continue;
      const shown = transformAt(clip, focusFrame, fps);
      for (const mask of (clip as any).masks ?? []) out.push({ clip, mask, shown });
    }
    return out;
  }, [editing, clips, focusFrame, fps, sortClips, filterClips, clipWithinFrame, tool, selectedClip]);

  // Leaving masks behind (deleted, or the clip gone) shouldn't leave the pointer "over" one.
  useEffect(() => {
    if (isOverMask && items.length === 0) setIsOverMask(false);
  }, [items.length, isOverMask, setIsOverMask]);

  if (!editing) return null;

  return (
    <Group ref={ref}>
      {items.map(({ clip, mask, shown }) => {
        const pose = poseAt(mask, maskFrame(clip, focusFrame), fps);
        if (!pose) return null;
        const { outer, inner } = groupTransforms(shown, mask);
        if (mask.tool === "lasso" && pose.lassoPoints && pose.lassoPoints.length >= 6) {
          const closed = [...pose.lassoPoints, pose.lassoPoints[0], pose.lassoPoints[1]];
          return (
            <Group key={`mask-${mask.id}`} {...outer}>
              <Group {...inner}>
                <LassoMaskPreview mask={mask} points={closed} animationOffset={0} rectWidth={rectWidth} rectHeight={rectHeight} />
              </Group>
            </Group>
          );
        }
        const b = pose.shapeBounds;
        if ((mask.tool === "shape" || (mask.tool as any) === "rectangle") && b) {
          return (
            <Group key={`mask-${mask.id}`} {...outer}>
              <Group {...inner}>
                <ShapeMaskPreview
                  mask={mask}
                  x={b.x}
                  y={b.y}
                  width={b.width}
                  height={b.height}
                  rotation={b.rotation ?? 0}
                  shapeType={(b.shapeType || "rectangle") as MaskShapeTool}
                  scaleX={b.scaleX ?? 1}
                  scaleY={b.scaleY ?? 1}
                  cornerRadius={b.cornerRadius ?? 0}
                  animationOffset={0}
                  rectWidth={rectWidth}
                  rectHeight={rectHeight}
                  interactive={editing}
                  tint={tool === "mask"}
                />
              </Group>
            </Group>
          );
        }
        return null;
      })}
    </Group>
  );
};

export default MaskPreview;
