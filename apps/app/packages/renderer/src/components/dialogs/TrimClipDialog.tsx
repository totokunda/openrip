// The Trim clip dialog (the clip menu's More clip actions › Trim clip, as CapCut's): the clip's
// whole source on a bar with an In and an Out handle and a scrub cursor, a picture of the
// source at the cursor (the engine's decode, so ProRes and the like show too), the In, Out and
// resulting length, Reset and Confirm. Confirm sets the clip's in and out on its source (lib/trim-clip.ts)
// as one undo step; the clip's start on the timeline and its speed stay.
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { engineSourcePaths, engineThumbnails } from "@app/preload";
import { toast } from "sonner";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { formatTimecode } from "@/lib/timecode";
import { canTrimClip, sourceSecondsAt, trimExtent, trimPatch, useTrimClip } from "@/lib/trim-clip";
import type { AnyClipProps, VideoClipProps } from "@/lib/types";

const BAR_W = 640;
const HANDLE_W = 12;

type Drag = "in" | "out" | "cursor";

export const TrimClipDialog: React.FC = () => {
  const clipId = useTrimClip((s) => s.clipId);
  const close = useTrimClip((s) => s.close);
  const fps = useControlsStore((s) => s.fps) || 30;
  const clip = useClipStore((s) => (clipId ? (s.getClipById(clipId) as AnyClipProps | undefined) : undefined));
  const asset = useClipStore((s) => (clip ? s.getAssetById((clip as VideoClipProps).assetId) : undefined));
  const open = !!clipId && !!clip && canTrimClip(clip);
  const isVideo = clip?.type === "video";

  const extent = useMemo(() => (clip ? trimExtent(clip) : { total: 1, start: 0, end: 1 }), [clip?.clipId, clip?.startFrame, clip?.endFrame, clip?.trimStart, clip?.trimEnd]);
  const [range, setRange] = useState({ a: 0, b: 1 });
  const [cursor, setCursor] = useState(0);
  const [bitmap, setBitmap] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<Drag | null>(null);

  // Each opening starts from the clip's own in and out.
  useEffect(() => {
    if (!open) return;
    setRange({ a: extent.start, b: extent.end });
    setCursor(extent.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clipId]);

  // The source at the cursor.
  useEffect(() => {
    if (!open || !clip || !asset || !isVideo) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const [path] = await engineSourcePaths([asset.path.replace(/#(video|audio)$/, "")]);
        const at = sourceSecondsAt(clip, cursor, fps, asset.duration);
        const thumbs = await engineThumbnails(path, [Math.round(at * 1e6)], 360, true).catch(() => []);
        const t = thumbs[0];
        if (!alive || !t) return;
        const canvas = document.createElement("canvas");
        canvas.width = t.width;
        canvas.height = t.height;
        canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(t.rgba.buffer as ArrayBuffer, t.rgba.byteOffset, t.rgba.byteLength), t.width, t.height), 0, 0);
        setBitmap(canvas);
      } catch {
        // no picture: the cursor still moves
      }
    }, 40);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, clip?.clipId, asset?.path, cursor, fps]);

  useEffect(() => {
    if (bitmap && canvasRef.current) {
      const c = canvasRef.current;
      c.width = bitmap.width;
      c.height = bitmap.height;
      c.getContext("2d")?.drawImage(bitmap, 0, 0);
    }
  }, [bitmap]);

  if (!clip) return null;
  const total = extent.total;
  const x = (v: number) => (v / total) * BAR_W;
  const frameAt = (clientX: number, el: HTMLElement) => Math.round(Math.min(1, Math.max(0, (clientX - el.getBoundingClientRect().left) / BAR_W)) * total);

  const move = (which: Drag, v: number) => {
    if (which === "in") {
      const a = Math.min(Math.max(0, v), range.b - 1);
      setRange((r) => ({ ...r, a }));
      setCursor(a);
    } else if (which === "out") {
      const b = Math.max(Math.min(total, v), range.a + 1);
      setRange((r) => ({ ...r, b }));
      setCursor(Math.max(range.a, b - 1));
    } else {
      setCursor(Math.min(Math.max(v, 0), total - 1));
    }
  };
  const onDown = (e: React.PointerEvent<HTMLElement>, which: Drag) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = which;
    if (which === "cursor") move("cursor", frameAt(e.clientX, e.currentTarget));
  };
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const bar = (e.currentTarget as HTMLElement).closest("[data-testid=trim-bar]") as HTMLElement | null;
    if (bar) move(drag.current, frameAt(e.clientX, bar));
  };
  const onUp = () => {
    drag.current = null;
  };

  const reset = () => {
    setRange({ a: extent.start, b: extent.end });
    setCursor(extent.start);
  };
  const confirm = () => {
    const live = useClipStore.getState().getClipById(clip.clipId) as AnyClipProps | undefined;
    if (live && (range.a !== extent.start || range.b !== extent.end)) {
      useClipStore.getState().updateClip(live.clipId, trimPatch(live, range.a, range.b));
      toast(`Trimmed to ${formatTimecode(range.b - range.a, fps)}`, { position: "bottom-right", duration: 2500 });
    }
    close();
  };

  const btn = "h-[25px] w-[72px] rounded-[4px] text-[12px] font-semibold cursor-pointer";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <DialogPrimitive.Content
          data-testid="trim-dialog"
          aria-describedby={undefined}
          style={{ width: 704 }}
          className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-[12px] border border-[#3c3c3c] bg-[#0b0b0b] shadow-[0_16px_48px_rgba(0,0,0,0.55)] font-poppins outline-none select-none overflow-hidden"
        >
          <div className="relative h-[35px] shrink-0 bg-[#1b1b1c] flex items-center justify-center">
            <button type="button" aria-label="Close" data-testid="trim-close" onClick={close} className="absolute left-[14px] h-3 w-3 rounded-full bg-[#ff5f57] hover:brightness-90 cursor-pointer" />
            <DialogPrimitive.Title className="text-[13px] font-semibold text-brand-lighter">Trim clip</DialogPrimitive.Title>
          </div>

          <div data-testid="trim-stage" className="flex items-center justify-center h-[360px] bg-[#0b0b0b]">
            {isVideo ? (
              bitmap && <canvas ref={canvasRef} data-testid="trim-picture" className="max-w-full max-h-full block" style={{ aspectRatio: `${bitmap.width} / ${bitmap.height}` }} />
            ) : (
              <span className="text-[12px] text-brand-light">Sound clip</span>
            )}
          </div>

          <div className="shrink-0 bg-[#1b1b1c] px-8 pt-5 pb-3">
            <div
              data-testid="trim-bar"
              data-in={range.a}
              data-out={range.b}
              data-cursor={cursor}
              data-total={total}
              onPointerDown={(e) => onDown(e, "cursor")}
              onPointerMove={onMove}
              onPointerUp={onUp}
              className="relative h-[44px] rounded-[4px] bg-[#2a2a2d] cursor-pointer"
              style={{ width: BAR_W }}
            >
              {/* What's cut off, dimmed; what's kept, lit. */}
              <div className="absolute inset-y-0 rounded-[4px] bg-[#ae81ce]/30 border-y-2 border-[#ae81ce]" style={{ left: x(range.a), width: Math.max(2, x(range.b) - x(range.a)) }} />
              <div
                data-testid="trim-in-handle"
                onPointerDown={(e) => onDown(e, "in")}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className="absolute -top-1 -bottom-1 rounded-l-[4px] bg-[#ae81ce] cursor-ew-resize"
                style={{ left: x(range.a) - HANDLE_W, width: HANDLE_W }}
              />
              <div
                data-testid="trim-out-handle"
                onPointerDown={(e) => onDown(e, "out")}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className="absolute -top-1 -bottom-1 rounded-r-[4px] bg-[#ae81ce] cursor-ew-resize"
                style={{ left: x(range.b), width: HANDLE_W }}
              />
              <div data-testid="trim-cursor" className="absolute -top-2 -bottom-2 w-[2px] bg-white pointer-events-none" style={{ left: x(cursor) - 1 }} />
            </div>
            <div className="mt-3 flex items-center gap-4 text-[12px] text-brand-lighter tabular-nums">
              <span>
                In <b data-testid="trim-in" className="text-brand-accent font-semibold">{formatTimecode(range.a, fps)}</b>
              </span>
              <span>
                Out <b data-testid="trim-out" className="text-brand-accent font-semibold">{formatTimecode(range.b, fps)}</b>
              </span>
              <span>
                Length <b data-testid="trim-length" className="font-semibold">{formatTimecode(range.b - range.a, fps)}</b>
              </span>
              <span className="text-brand-light">of {formatTimecode(total, fps)}</span>
              <div className="ml-auto flex gap-2">
                <button type="button" data-testid="trim-reset" onClick={reset} className={`${btn} bg-brand-button text-brand-lighter hover:bg-[#5a5a5a]`}>
                  Reset
                </button>
                <button type="button" data-testid="trim-confirm" onClick={confirm} className={`${btn} bg-brand-accent text-white hover:bg-brand-accent-shade`}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default TrimClipDialog;
