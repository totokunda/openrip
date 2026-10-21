import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage } from "react-konva";
import Konva from "konva";
import { engineRender, ENGINE_FRAME_CANVAS_ID, ENGINE_FRAME_EVENT } from "@app/preload";
import { setEnginePreviewSize, useEnginePreviewStore, useEngineDraws } from "@/lib/engine-preview";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { shownFrame } from "@/lib/playback-end";
import { usePlayerStore, QUALITY_SCALE } from "@/lib/player";

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
  // The preview axis shows the frame under the timeline's mouse in place of the playhead's.
  const hoverFrame = useControlsStore((s) => s.hoverFrame);
  const playhead = useControlsStore((s) => s.focusFrame);
  const focusFrame = hoverFrame ?? playhead;
  const end = useClipStore((s) => s.clipDuration);
  const fps = useControlsStore((s) => s.fps);
  const isPlaying = useControlsStore((s) => s.isPlaying);
  // False while the playhead is dragged: quick frames then, the exact one on release.
  const accurate = useControlsStore((s) => s.isAccurateSeekNeeded);
  const nodeRef = useRef<Konva.Image>(null);
  const canvas = useMemo(frameCanvas, []);
  // The player's quality, CapCut's: playback renders at a fraction of the screen's size
  // (High, Medium, Low); paused frames always render in full.
  const playScale = usePlayerStore((s) => QUALITY_SCALE[s.quality] ?? 1);

  // Each frame the preload draws: redraw the layer.
  useEffect(() => {
    const onFrame = () => nodeRef.current?.getLayer()?.batchDraw();
    canvas.addEventListener(ENGINE_FRAME_EVENT, onFrame);
    return () => canvas.removeEventListener(ENGINE_FRAME_EVENT, onFrame);
  }, [canvas]);

  // The pixel density of the screen it's on: the player can be in a window of its own, on
  // another display (lib/panel-windows.ts).
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const view = nodeRef.current?.getStage()?.container().ownerDocument.defaultView;
    if (!view) return;
    const update = () => setDpr(view.devicePixelRatio || 1);
    update();
    view.addEventListener("resize", update);
    return () => view.removeEventListener("resize", update);
  }, [draws]);

  // The size it's shown at on screen: paused frames render at it, playback at the quality's
  // fraction of it.
  const sized = (k: number) => {
    const [w, h] = [rectWidth * scale * dpr * k, rectHeight * scale * dpr * k];
    const fit = Math.min(1, MAX_SIDE / Math.max(w, h));
    return { width: Math.max(2, Math.round(w * fit)), height: Math.max(2, Math.round(h * fit)) };
  };
  const size = useMemo(() => sized(1), [rectWidth, rectHeight, scale, dpr]);
  const playSize = useMemo(() => sized(playScale), [rectWidth, rectHeight, scale, playScale, dpr]);
  useEffect(() => setEnginePreviewSize(playSize.width, playSize.height), [playSize]);

  // Paused: ask for the frame at the playhead (the last one on the project's end, where
  // playback stops). Playing, the engine sends frames by itself.
  useEffect(() => {
    if (!draws || !fps || isPlaying || size.width < 2 || size.height < 2) return;
    void engineRender((shownFrame(focusFrame, end) / fps) * 1e6, size.width, size.height, !accurate || hoverFrame != null).then((r) => {
      if (!r.ok && !r.superseded) console.warn("[engine] render failed:", r.error);
    });
  }, [draws, version, focusFrame, end, fps, size, isPlaying, accurate, hoverFrame]);

  if (!draws) return null;
  return <KonvaImage ref={nodeRef} image={canvas} x={0} y={0} width={rectWidth} height={rectHeight} listening={false} />;
};

export default EngineFrame;
