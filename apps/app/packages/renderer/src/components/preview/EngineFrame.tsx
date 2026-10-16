import React, { useEffect, useMemo, useRef } from "react";
import { Image as KonvaImage } from "react-konva";
import Konva from "konva";
import { engineRender, ENGINE_FRAME_CANVAS_ID, ENGINE_FRAME_EVENT } from "@app/preload";
import { setEnginePreviewSize, useEnginePreviewStore, useEngineDraws } from "@/lib/engine-preview";
import { useControlsStore } from "@/lib/control";

/** Longest side the engine renders the preview at. */
const MAX_SIDE = 3840;

/**
 * The canvas the preload draws the engine's frames into. It lives in the DOM (the preload's
 * isolated world can reach it there) but isn't shown; Konva draws it.
 */
function frameCanvas(): HTMLCanvasElement {
  let c = document.getElementById(ENGINE_FRAME_CANVAS_ID) as HTMLCanvasElement | null;
  if (!c) {
    c = document.createElement("canvas");
    c.id = ENGINE_FRAME_CANVAS_ID;
    c.width = 2;
    c.height = 2;
    c.style.display = "none";
    document.body.appendChild(c);
  }
  return c;
}

/**
 * The Rust engine's picture of the frame at the playhead, under every clip's handles. Shown
 * only while the engine draws the preview (see lib/engine-preview.ts).
 */
const EngineFrame: React.FC<{ rectWidth: number; rectHeight: number; scale: number }> = ({ rectWidth, rectHeight, scale }) => {
  const draws = useEngineDraws();
  const version = useEnginePreviewStore((s) => s.version);
  const focusFrame = useControlsStore((s) => s.focusFrame);
  const fps = useControlsStore((s) => s.fps);
  const isPlaying = useControlsStore((s) => s.isPlaying);
  const nodeRef = useRef<Konva.Image>(null);
  const canvas = useMemo(frameCanvas, []);

  // Each frame the preload draws: redraw the layer.
  useEffect(() => {
    const onFrame = () => nodeRef.current?.getLayer()?.batchDraw();
    canvas.addEventListener(ENGINE_FRAME_EVENT, onFrame);
    return () => canvas.removeEventListener(ENGINE_FRAME_EVENT, onFrame);
  }, [canvas]);

  // The size it's shown at on screen: paused frames and playback render at it.
  const size = useMemo(() => {
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = [rectWidth * scale * dpr, rectHeight * scale * dpr];
    const fit = Math.min(1, MAX_SIDE / Math.max(w, h));
    return { width: Math.round(w * fit), height: Math.round(h * fit) };
  }, [rectWidth, rectHeight, scale]);
  useEffect(() => setEnginePreviewSize(size.width, size.height), [size]);

  // Paused: ask for the frame at the playhead. Playing, the engine sends frames by itself.
  useEffect(() => {
    if (!draws || !fps || isPlaying || size.width < 2 || size.height < 2) return;
    void engineRender((focusFrame / fps) * 1e6, size.width, size.height).then((r) => {
      if (!r.ok && !r.superseded) console.warn("[engine] render failed:", r.error);
    });
  }, [draws, version, focusFrame, fps, size, isPlaying]);

  if (!draws) return null;
  return <KonvaImage ref={nodeRef} image={canvas} x={0} y={0} width={rectWidth} height={rectHeight} listening={false} />;
};

export default EngineFrame;
