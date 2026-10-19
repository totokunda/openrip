import React, { useEffect, useRef, useState } from "react";
import { Image as KImage, Rect } from "react-konva";
import type Konva from "konva";
import { previewSrc, useStockLibrary } from "@/lib/stock/library";

/**
 * The Library tile clicked in the Media tab, shown in the player over the timeline's picture
 * (as CapCut's Library does) until it's let go: a photo still, a video playing (muted) on a loop,
 * fitted into the canvas. Not a clip. Not interactive. In world units, inside the preview's
 * canvas group.
 */
const StockLibraryPreview: React.FC<{ rectWidth: number; rectHeight: number }> = ({ rectWidth, rectHeight }) => {
  const item = useStockLibrary((s) => s.preview);
  const cached = useStockLibrary((s) => s.cached);
  const src = item ? previewSrc(item, cached) : null;
  const video = item?.kind === "video";
  const [media, setMedia] = useState<HTMLImageElement | HTMLVideoElement | null>(null);
  const node = useRef<Konva.Image>(null);

  useEffect(() => {
    setMedia(null);
    if (!src) return;
    if (video) {
      const el = document.createElement("video");
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.onloadeddata = () => {
        setMedia(el);
        void el.play().catch(() => undefined);
      };
      el.src = src;
      return () => {
        el.onloadeddata = null;
        el.pause();
        el.removeAttribute("src");
        el.load();
      };
    }
    const el = new window.Image();
    el.onload = () => setMedia(el);
    el.src = src;
    return () => {
      el.onload = null;
    };
  }, [src, video]);

  // A video is drawn again as it plays (the canvas holds one frame of it).
  useEffect(() => {
    if (!video || !media) return;
    const timer = window.setInterval(() => node.current?.getLayer()?.batchDraw(), 33);
    return () => window.clearInterval(timer);
  }, [video, media]);

  if (!item || !media) return null;
  const [w, h] = media instanceof HTMLVideoElement ? [media.videoWidth || 16, media.videoHeight || 9] : [media.naturalWidth || 16, media.naturalHeight || 9];
  const k = Math.min(rectWidth / w, rectHeight / h);
  return (
    <>
      <Rect name="stock-library-preview-bg" listening={false} x={0} y={0} width={rectWidth} height={rectHeight} fill="#000000" />
      <KImage ref={node} name="stock-library-preview" listening={false} image={media} x={rectWidth / 2 - (w * k) / 2} y={rectHeight / 2 - (h * k) / 2} width={w * k} height={h * k} />
    </>
  );
};

export default StockLibraryPreview;
