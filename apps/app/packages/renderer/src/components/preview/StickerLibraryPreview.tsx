import React, { useEffect, useRef, useState } from "react";
import { Image as KImage } from "react-konva";
import type Konva from "konva";
import { STICKER_FRACTION, fullSrc, useStickerLibrary } from "@/lib/stickers/library";

/**
 * The Stickers tile clicked in the library, shown over the middle of the canvas at the size it
 * would be added at, without being a clip. An animated sticker plays. Not interactive. In world
 * units, inside the preview's canvas group.
 */
const StickerLibraryPreview: React.FC<{ rectWidth: number; rectHeight: number }> = ({ rectWidth, rectHeight }) => {
  const sticker = useStickerLibrary((s) => s.preview);
  const cached = useStickerLibrary((s) => s.cached);
  const src = sticker ? fullSrc(sticker, cached) : null;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const node = useRef<Konva.Image>(null);

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

  // An animated picture is drawn again as it changes (the canvas holds one frame of it).
  const animated = !!sticker?.set.animated;
  useEffect(() => {
    if (!animated || !img) return;
    const timer = window.setInterval(() => node.current?.getLayer()?.batchDraw(), 33);
    return () => window.clearInterval(timer);
  }, [animated, img]);

  if (!sticker || !img) return null;
  const [w, h] = [img.naturalWidth || 256, img.naturalHeight || 256];
  const k = (Math.min(rectWidth, rectHeight) * STICKER_FRACTION) / Math.max(w, h);
  return <KImage ref={node} name="sticker-library-preview" listening={false} image={img} x={rectWidth / 2 - (w * k) / 2} y={rectHeight / 2 - (h * k) / 2} width={w * k} height={h * k} />;
};

export default StickerLibraryPreview;
