import React, { useCallback, useEffect, useRef } from "react";
import { Group, Rect as KonvaRect, Ellipse as KonvaEllipse, Star as KonvaStar, Transformer, RegularPolygon, Line as KonvaLine, Shape as KonvaShape } from "react-konva";
import Konva from "konva";
import { KonvaEventObject } from "konva/lib/Node";
import { useClipStore } from "@/lib/clip";
import { useViewportStore } from "@/lib/viewport";
import { useControlsStore } from "@/lib/control";
import { useMaskStore } from "@/lib/mask";
import { upsertMaskKeyframe } from "@/lib/mask/keyframeUtils";
import { boundsCentre, heartPoints, placeBounds } from "@/lib/mask-shapes";
import { MaskClipProps, MaskShapeTool } from "@/lib/types";

interface ShapeMaskPreviewProps {
  mask: MaskClipProps;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  animationOffset: number;
  rectWidth: number;
  rectHeight: number;
  shapeType: MaskShapeTool;
  scaleX?: number;
  scaleY?: number;
  cornerRadius?: number;
  /** Whether its handles take the pointer (the mask tool, or the inspector's Mask tab). */
  interactive?: boolean;
  /** Tinted inside, as the mask tool shows it over the unmasked clip; else an outline over the engine's masked picture. */
  tint?: boolean;
}

/**
 * A shape mask's outline and handles on the canvas, in the mask's own units (MaskPreview puts
 * it over its clip): drag it to move it, the handles to size and turn it. Every shape is drawn
 * about its centre; a rectangle's bounds keep their top-left corner (lib/mask-shapes.ts).
 * Split is a line across the picture (turn it), Filmstrip a band (its height), the heart its
 * outline. An edit goes to the mask's pose at the playhead (upsertMaskKeyframe).
 */
const ShapeMaskPreview: React.FC<ShapeMaskPreviewProps> = ({
  mask,
  x,
  y,
  width,
  height,
  rotation,
  shapeType,
  scaleX = 1,
  scaleY = 1,
  cornerRadius = 0,
  rectWidth,
  rectHeight,
  interactive,
  tint,
}) => {
  const tool = useViewportStore((s) => s.tool);
  const isFullscreen = useControlsStore((s) => s.isFullscreen);
  const selectedMaskId = useControlsStore((s) => s.selectedMaskId);
  const setSelectedMaskId = useControlsStore((s) => s.setSelectedMaskId);
  const focusFrame = useControlsStore((s) => s.focusFrame);
  const setIsOverMask = useMaskStore((s) => s.setIsOverMask);
  const shapeRef = useRef<any>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const suppressUntilRef = useRef(0);
  const isSelected = selectedMaskId === mask.id;
  const canInteract = interactive ?? tool === "mask";
  const tinted = tint ?? tool === "mask";

  const bounds = { x, y, width, height, rotation, shapeType, scaleX, scaleY, cornerRadius };
  const [w, h] = [width * scaleX, height * scaleY];
  const [cx, cy] = boundsCentre(bounds);
  // Split and Filmstrip run across the picture: half its longest reach either way.
  const reach = Math.max(rectWidth, rectHeight) * 1.5;

  const select = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!canInteract) return;
      e.cancelBubble = true;
      setSelectedMaskId(mask.id);
      const { selectedClipIds, setSelectedClipIds } = useControlsStore.getState();
      if (mask.clipId && !selectedClipIds.includes(mask.clipId)) setSelectedClipIds([mask.clipId]);
    },
    [canInteract, mask.id, mask.clipId, setSelectedMaskId],
  );

  // The node's place, turn and scale as the mask's bounds at the playhead.
  const persist = useCallback(() => {
    const node = shapeRef.current as Konva.Node | null;
    if (!node) return;
    let [nw, nh] = [w * Math.abs(node.scaleX()), h * Math.abs(node.scaleY())];
    // The triangle and the star keep their proportions; Split keeps its size.
    if (shapeType === "star" || shapeType === "polygon") {
      const k = Math.max(Math.abs(node.scaleX()), Math.abs(node.scaleY()));
      [nw, nh] = [w * k, h * k];
    }
    if (shapeType === "linear") [nw, nh] = [w, h];
    if (shapeType === "mirror") nw = w;
    const next = placeBounds({ ...bounds, width: nw, height: nh, scaleX: 1, scaleY: 1, rotation: node.rotation() }, [node.x(), node.y()]);
    node.scaleX(1);
    node.scaleY(1);
    const state = useClipStore.getState();
    const clip = state.clips.find((c) => c.clipId === mask.clipId);
    if (!clip || !mask.clipId) return;
    const result = upsertMaskKeyframe({ mask, clip, focusFrame, updater: (previous) => ({ ...previous, shapeBounds: { ...(previous.shapeBounds ?? bounds), ...next } }) });
    if (!result) return;
    const masks = ((clip as any).masks || []).map((m: MaskClipProps) => (m.id === mask.id ? { ...m, keyframes: result.keyframes } : m));
    state.updateClip(mask.clipId, { masks });
    suppressUntilRef.current = performance.now() + 250;
  }, [w, h, shapeType, mask, focusFrame, x, y, width, height, rotation, cornerRadius]);

  useEffect(() => {
    const tr = transformerRef.current;
    if (!isSelected || !canInteract || !tr || !shapeRef.current) return;
    tr.nodes([shapeRef.current]);
    tr.getLayer()?.batchDraw();
  }, [isSelected, canInteract, shapeType]);

  // With the mask tool, a click outside the selected mask drops it (the inspector keeps it).
  useEffect(() => {
    if (!isSelected || tool !== "mask") return;
    const onClick = (e: MouseEvent) => {
      if (performance.now() < suppressUntilRef.current) return;
      const node = shapeRef.current as Konva.Node | null;
      const stage = node?.getStage();
      if (!node || !stage || !stage.container().contains(e.target as Node)) return;
      const p = stage.getPointerPosition();
      const r = node.getClientRect();
      if (p && (p.x < r.x || p.x > r.x + r.width || p.y < r.y || p.y > r.y + r.height)) setSelectedMaskId(null);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [isSelected, tool, setSelectedMaskId]);

  const props = {
    ref: shapeRef,
    x: cx,
    y: cy,
    rotation,
    stroke: "#ffffff",
    strokeWidth: isSelected || tinted ? 1.5 : 1,
    strokeScaleEnabled: false,
    opacity: isSelected || tinted ? 1 : 0.6,
    shadowColor: "#000000",
    shadowBlur: 2,
    shadowOpacity: 0.8,
    shadowForStrokeEnabled: true,
    fill: tinted ? "rgba(0, 127, 245, 0.4)" : "rgba(0, 0, 0, 0.001)",
    draggable: canInteract && isSelected,
    listening: canInteract,
    onClick: select,
    onTap: select,
    onMouseDown: (e: KonvaEventObject<MouseEvent>) => {
      if (!canInteract) return;
      // Not selected yet: the press selects it rather than starting a new mask.
      if (!isSelected) e.cancelBubble = true;
    },
    onMouseEnter: (e: KonvaEventObject<MouseEvent>) => {
      if (!canInteract) return;
      const c = e.target.getStage()?.container();
      if (c) c.style.cursor = isSelected ? "move" : "pointer";
    },
    onMouseLeave: (e: KonvaEventObject<MouseEvent>) => {
      const c = e.target.getStage()?.container();
      if (c) c.style.cursor = tool === "mask" ? "crosshair" : "default";
    },
    onDragEnd: persist,
    onTransformEnd: persist,
  };

  const shape = (() => {
    switch (shapeType) {
      case "ellipse":
        return <KonvaEllipse {...props} radiusX={w / 2} radiusY={h / 2} />;
      case "polygon":
        return <RegularPolygon {...props} sides={3} radius={Math.min(w / Math.sqrt(3), h / 1.5)} />;
      case "star":
        return <KonvaStar {...props} numPoints={5} innerRadius={Math.min(w, h) / 4} outerRadius={Math.min(w, h) / 2} />;
      case "heart":
        return <KonvaLine {...props} points={heartPoints(0, 0, w, h, 0)} closed tension={0} />;
      case "linear":
        // A line through the centre with an arrow to the side that's kept; its box (what
        // the handles go round) is the box's width and 16 units tall, about the centre.
        return (
          <KonvaShape
            {...props}
            width={w}
            height={16}
            offsetX={w / 2}
            offsetY={8}
            sceneFunc={(ctx, s) => {
              ctx.beginPath();
              ctx.moveTo(w / 2 - reach, 8);
              ctx.lineTo(w / 2 + reach, 8);
              ctx.moveTo(w / 2, 8);
              ctx.lineTo(w / 2, -6);
              ctx.moveTo(w / 2 - 4, -2);
              ctx.lineTo(w / 2, -6);
              ctx.lineTo(w / 2 + 4, -2);
              ctx.strokeShape(s);
            }}
            hitFunc={(ctx, s) => {
              ctx.beginPath();
              ctx.rect(w / 2 - reach, 0, reach * 2, 16);
              ctx.fillStrokeShape(s);
            }}
          />
        );
      case "mirror":
        // A band as tall as the box, across the picture.
        return (
          <KonvaShape
            {...props}
            width={w}
            height={h}
            offsetX={w / 2}
            offsetY={h / 2}
            sceneFunc={(ctx, s) => {
              ctx.beginPath();
              ctx.moveTo(w / 2 - reach, 0);
              ctx.lineTo(w / 2 + reach, 0);
              ctx.moveTo(w / 2 - reach, h);
              ctx.lineTo(w / 2 + reach, h);
              ctx.strokeShape(s);
            }}
            hitFunc={(ctx, s) => {
              ctx.beginPath();
              ctx.rect(w / 2 - reach, 0, reach * 2, h);
              ctx.fillStrokeShape(s);
            }}
          />
        );
      default:
        return <KonvaRect {...props} width={w} height={h} offsetX={w / 2} offsetY={h / 2} cornerRadius={((cornerRadius ?? 0) / 100) * (Math.min(w, h) / 2)} />;
    }
  })();

  const anchors =
    shapeType === "linear"
      ? []
      : shapeType === "mirror"
        ? ["top-center", "bottom-center"]
        : shapeType === "star" || shapeType === "polygon"
          ? ["top-left", "top-right", "bottom-left", "bottom-right"]
          : ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"];

  return (
    <Group onMouseOver={() => canInteract && setIsOverMask(true)} onMouseOut={() => setIsOverMask(false)}>
      {shape}
      <Transformer
        visible={canInteract && isSelected && !isFullscreen}
        ref={transformerRef}
        borderStroke="#AE81CE"
        anchorCornerRadius={8}
        anchorStroke="#E3E3E3"
        anchorStrokeWidth={1}
        borderStrokeWidth={1.5}
        ignoreStroke
        rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
        enabledAnchors={anchors}
      />
    </Group>
  );
};

export default ShapeMaskPreview;
