import React, { useEffect, useRef, useState } from "react";
import { Image as KImage } from "react-konva";
import type Konva from "konva";
import { LOOP_FPS, templatePlayerLoop, useTemplateLibrary } from "@/lib/text-template-actions";
import { useViewportStore } from "@/lib/viewport";

/**
 * The Text tab's template clicked in the library, played over the canvas where it would be
 * added, drawn by the engine, without being a clip. Not interactive. In world units, inside the
 * preview's canvas group.
 */
const TemplateLibraryPreview: React.FC<{ rectWidth: number; rectHeight: number }> = ({ rectWidth, rectHeight }) => {
  const template = useTemplateLibrary((s) => s.preview);
  const aspect = useViewportStore((s) => s.aspectRatio);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const node = useRef<Konva.Image>(null);

  useEffect(() => {
    setCanvas(null);
    if (!template) return;
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    void templatePlayerLoop(template, { width: aspect.width, height: aspect.height }).then((frames) => {
      if (!live || frames.length === 0) return;
      const el = document.createElement("canvas");
      el.width = frames[0].width;
      el.height = frames[0].height;
      const ctx = el.getContext("2d")!;
      let i = 0;
      const show = () => {
        const f = frames[i];
        ctx.putImageData(new ImageData(new Uint8ClampedArray(f.rgba.buffer, f.rgba.byteOffset, f.width * f.height * 4), f.width, f.height), 0, 0);
        node.current?.getLayer()?.batchDraw();
      };
      show();
      setCanvas(el);
      timer = setInterval(() => {
        i = (i + 1) % frames.length;
        show();
      }, 1000 / LOOP_FPS);
    });
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [template, aspect.width, aspect.height]);

  if (!template || !canvas) return null;
  return <KImage ref={node} name="text-template-preview" listening={false} image={canvas} x={0} y={0} width={rectWidth} height={rectHeight} />;
};

export default TemplateLibraryPreview;
