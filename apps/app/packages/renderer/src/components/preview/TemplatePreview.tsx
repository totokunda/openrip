import React, { useEffect, useState } from "react";
import { Image as KImage, Rect } from "react-konva";
import { coverUrl, useTemplatesTab } from "@/lib/templates-tab";

/**
 * The Templates tab's card clicked, shown in the player over the timeline's picture until it's
 * let go: the template's cover, fitted into the canvas. Not a clip, not interactive. In world
 * units, inside the preview's canvas group.
 */
const TemplatePreview: React.FC<{ rectWidth: number; rectHeight: number }> = ({ rectWidth, rectHeight }) => {
  const t = useTemplatesTab((s) => s.preview);
  const src = t ? coverUrl(t) : null;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImg(null);
    if (!src) return;
    const el = new window.Image();
    el.onload = () => setImg(el);
    el.src = src;
    return () => {
      el.onload = null;
    };
  }, [src]);
  if (!t || !img) return null;
  const [w, h] = [img.naturalWidth || 16, img.naturalHeight || 9];
  const k = Math.min(rectWidth / w, rectHeight / h);
  return (
    <>
      <Rect name="template-preview-bg" listening={false} x={0} y={0} width={rectWidth} height={rectHeight} fill="#000000" />
      <KImage name="template-preview" listening={false} image={img} x={rectWidth / 2 - (w * k) / 2} y={rectHeight / 2 - (h * k) / 2} width={w * k} height={h * k} />
    </>
  );
};

export default TemplatePreview;
