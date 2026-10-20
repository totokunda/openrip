import React, { useEffect, useRef, useState } from "react";
import type { EngineTileSpec } from "@app/preload";
import { decodeSheet, drawFrame, wantTile, type TileArt } from "@/lib/tile-previews";
import { cn } from "@/lib/utils";

/**
 * What a Transitions or Effects tile shows: bundled footage with the transition or effect drawn on
 * it by the engine (lib/tile-previews.ts). It rests on one frame and plays the loop while `hover`.
 * The picture is asked for when the tile scrolls into view, with a soft shimmer until it comes.
 */
export const TilePicture: React.FC<{ spec: EngineTileSpec; hover: boolean; testId: string }> = ({ spec, hover, testId }) => {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [art, setArt] = useState<TileArt | null>(null);
  // Null once the engine has said it can't draw one: nothing is coming, so nothing shimmers.
  const [missing, setMissing] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: "120px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || art) return;
    return wantTile(spec, (a) => {
      if (a) setArt(a);
      else setMissing(true);
    });
    // The spec is the tile's own and never changes under it.
  }, [visible, art]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (art && ctx) ctx.drawImage(art.still, 0, 0, ctx.canvas.width, ctx.canvas.height);
  }, [art]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!art || !ctx) return;
    if (!hover) {
      ctx.drawImage(art.still, 0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let sheet: ImageBitmap | undefined;
    void decodeSheet(art.sheet).then((bitmap) => {
      if (!live) return bitmap.close();
      sheet = bitmap;
      let i = art.sheet.still;
      timer = setInterval(() => {
        i = (i + 1) % art.sheet.frames;
        drawFrame(ctx, art.sheet, bitmap, i);
        if (canvas.current) canvas.current.dataset.frame = String(i);
      }, 1000 / art.sheet.fps);
    });
    return () => {
      live = false;
      if (timer) clearInterval(timer);
      sheet?.close();
    };
  }, [art, hover]);

  return (
    <div ref={box} className="absolute inset-0">
      {!art && !missing && <div data-testid="tile-loading" className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-white/[0.06]" />}
      <canvas
        ref={canvas}
        width={art?.sheet.size ?? 172}
        height={art?.sheet.size ?? 172}
        data-testid={testId}
        data-ready={art ? "1" : "0"}
        className={cn("w-full h-full object-cover pointer-events-none transition-opacity duration-200", art ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
};
