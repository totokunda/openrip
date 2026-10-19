// The Crop dialog, as CapCut's (docs/plan/capcut-ui-spec.md §6, the Crop row; 31-dialogs/039 and
// 040): a 959×639 window over a dimmed screen, its title centred with a red close dot at the left,
// the clip's picture on a near-black stage with a crop frame (round corner handles, pill side
// handles, a dashed centre cross) and a small transport under it (time, length, a scrub line);
// below, Rotation (a slider and a degrees field), the Crop ratio menu, Reset and Confirm.
// Confirm puts the crop on the clip (lib/crop.ts: the clip's box becomes the crop's rectangle and
// the picture stays where it is); the engine draws it. Rotation turns the picture inside the
// frame (a straighten), and the frame stays upright.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { engineThumbnails, engineSourcePaths } from "@app/preload";
import { cn } from "@/lib/utils";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { formatTimecode } from "@/lib/timecode";
import { convertUserDataPath } from "@/lib/media/utils";
import type { AnyClipProps, ClipTransform, ImageClipProps, VideoClipProps } from "@/lib/types";
import { CROP_RATIOS, clampWin, cropOfWin, dragWin, fitWin, isFullCrop, ratioIdOf, recrop, winForRatio, winOfCrop, type CropRect, type Handle, type Win } from "@/lib/crop";
import { Choice } from "./settings/controls";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";

const DIALOG = { w: 959, h: 639 };
/** The picture's area on the stage (the crop frame's reach), and where its middle is. */
const AREA = { w: 840, h: 456, cx: DIALOG.w / 2, cy: 41 + 228 };
const MIN_SIDE_PX = 8;
const MAX_TURN = 45;

type Drag = { handle: Handle | "move"; x: number; y: number; start: Win };

export const CropDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void; clip: AnyClipProps | null }> = ({ open, onOpenChange, clip }) => {
  const fps = useControlsStore((s) => s.fps);
  const getClipTransform = useClipStore((s) => s.getClipTransform);
  const getAssetById = useClipStore((s) => s.getAssetById);
  const media = clip as (VideoClipProps | ImageClipProps) | null;
  const asset = media ? getAssetById(media.assetId) : undefined;
  const isVideo = media?.type === "video";
  const sw = media?.mediaWidth || asset?.width || 0;
  const sh = media?.mediaHeight || asset?.height || 0;
  const clipFrames = media ? Math.max(1, media.endFrame - media.startFrame) : 1;

  const [win, setWin] = useState<Win>({ l: 0, t: 0, r: 0, b: 0 });
  const [theta, setTheta] = useState(0);
  const [ratioId, setRatioId] = useState("free");
  const [frame, setFrame] = useState(0);
  const [bitmap, setBitmap] = useState<{ canvas: HTMLCanvasElement; url?: undefined } | { url: string; canvas?: undefined } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const initial = useRef<{ crop: CropRect | undefined; transform: ClipTransform | undefined }>({ crop: undefined, transform: undefined });

  const ratio = CROP_RATIOS.find((r) => r.id === ratioId)?.ratio ?? null;

  // Each opening starts from the clip's own crop, at the clip's first frame.
  useEffect(() => {
    if (!open || !media || !sw || !sh) return;
    const transform = getClipTransform(media.clipId);
    const crop = transform?.crop as CropRect | undefined;
    initial.current = { crop, transform };
    const w = winOfCrop(crop, sw, sh);
    setWin(w.win);
    setTheta(w.theta);
    setRatioId(ratioIdOf(crop, sw, sh));
    setFrame(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, media?.clipId, sw, sh]);

  // The picture at the scrubbed frame: the engine's decode (it reads what the app's can't),
  // or the photo itself.
  useEffect(() => {
    if (!open || !media || !asset) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const [path] = await engineSourcePaths([asset.path.replace(/#(video|audio)$/, "")]);
        const at = Math.max(0, ((media.trimStart ?? 0) + frame) / Math.max(1, fps));
        const thumbs = await engineThumbnails(path, [Math.round(at * 1e6)], Math.min(sh || 720, 720), true).catch(() => []);
        if (!alive) return;
        const t = thumbs[0];
        if (t) {
          const canvas = document.createElement("canvas");
          canvas.width = t.width;
          canvas.height = t.height;
          canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(t.rgba.buffer as ArrayBuffer, t.rgba.byteOffset, t.rgba.byteLength), t.width, t.height), 0, 0);
          setBitmap({ canvas });
        } else {
          setBitmap({ url: convertUserDataPath(path) });
        }
      } catch {
        if (alive) setBitmap({ url: convertUserDataPath(asset.path.replace(/#(video|audio)$/, "")) });
      }
    }, 60);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, media?.clipId, asset?.path, frame, fps, sh]);

  useEffect(() => {
    if (bitmap?.canvas && canvasRef.current) {
      const c = canvasRef.current;
      c.width = bitmap.canvas.width;
      c.height = bitmap.canvas.height;
      c.getContext("2d")?.drawImage(bitmap.canvas, 0, 0);
    }
  }, [bitmap]);

  // How big the picture is shown: the turned picture's bounding box fits the area.
  const scale = useMemo(() => {
    if (!sw || !sh) return 1;
    const a = (theta * Math.PI) / 180;
    const [c, s] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a))];
    return Math.min(AREA.w / (sw * c + sh * s), AREA.h / (sw * s + sh * c));
  }, [sw, sh, theta]);

  const toPx = (v: number) => v * scale;

  const onPointerDown = (e: React.PointerEvent, handle: Handle | "move") => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: win };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [dx, dy] = [(e.clientX - d.x) / scale, (e.clientY - d.y) / scale];
    const asked = dragWin(d.start, d.handle, dx, dy, ratio, MIN_SIDE_PX);
    setWin((prev) => clampWin(prev, asked, theta, sw, sh));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const turnTo = useCallback(
    (next: number) => {
      const t = Math.max(-MAX_TURN, Math.min(MAX_TURN, Number.isFinite(next) ? next : 0));
      setTheta(t);
      setWin((w) => fitWin(w, t, sw, sh));
    },
    [sw, sh],
  );

  const pickRatio = (id: string) => {
    setRatioId(id);
    const r = CROP_RATIOS.find((o) => o.id === id)?.ratio;
    if (r != null) setWin((w) => winForRatio(r, w, theta, sw, sh));
  };

  const reset = () => {
    setTheta(0);
    setRatioId("free");
    setWin({ l: -sw / 2, r: sw / 2, t: -sh / 2, b: sh / 2 });
  };

  const confirm = () => {
    if (!media) return;
    const crop = cropOfWin(win, theta, sw, sh);
    const next = isFullCrop(crop) ? undefined : crop;
    const before = initial.current.crop;
    const same = (!next && isFullCrop(before)) || (next && before && JSON.stringify({ ...before, rotation: before.rotation ?? 0 }) === JSON.stringify(next));
    if (!same) {
      const t = getClipTransform(media.clipId) as ClipTransform | undefined;
      if (t) {
        const box = recrop(t, before, next);
        useClipStore.getState().setClipTransform(media.clipId, { ...box, crop: next }, true);
      }
    }
    onOpenChange(false);
  };

  const frameBox = { w: toPx(win.r - win.l), h: toPx(win.b - win.t), x: AREA.cx + toPx(win.l), y: AREA.cy + toPx(win.t) };
  const midX = AREA.cx + toPx((win.l + win.r) / 2);
  const midY = AREA.cy + toPx((win.t + win.b) / 2);
  const dispW = toPx(sw);
  const dispH = toPx(sh);

  const handleStyle = "absolute bg-white shadow-[0_0_2px_rgba(0,0,0,0.5)]";
  const corner = (sx: -1 | 1, sy: -1 | 1) => (
    <div
      key={`c${sx}${sy}`}
      data-testid={`crop-handle-${sy < 0 ? "t" : "b"}${sx < 0 ? "l" : "r"}`}
      onPointerDown={(e) => onPointerDown(e, { sx, sy })}
      className={cn(handleStyle, "h-4 w-4 rounded-full cursor-nwse-resize")}
      style={{ left: (sx < 0 ? 0 : frameBox.w) - 8, top: (sy < 0 ? 0 : frameBox.h) - 8, cursor: sx * sy > 0 ? "nwse-resize" : "nesw-resize" }}
    />
  );
  const side = (sx: -1 | 0 | 1, sy: -1 | 0 | 1) => {
    const horizontal = sy !== 0;
    return (
      <div
        key={`s${sx}${sy}`}
        data-testid={`crop-handle-${sy < 0 ? "t" : sy > 0 ? "b" : sx < 0 ? "l" : "r"}`}
        onPointerDown={(e) => onPointerDown(e, { sx, sy })}
        className={cn(handleStyle, "rounded-full")}
        style={
          horizontal
            ? { width: 47, height: 15, left: frameBox.w / 2 - 23.5, top: (sy < 0 ? 0 : frameBox.h) - 7.5, cursor: "ns-resize" }
            : { width: 15, height: 47, top: frameBox.h / 2 - 23.5, left: (sx < 0 ? 0 : frameBox.w) - 7.5, cursor: "ew-resize" }
        }
      />
    );
  };

  const [fieldText, setFieldText] = useState("0°");
  useEffect(() => setFieldText(`${Math.round(theta)}°`), [theta]);
  const commitField = () => {
    const v = parseFloat(fieldText.replace("°", ""));
    if (Number.isFinite(v)) turnTo(Math.round(v));
    else setFieldText(`${Math.round(theta)}°`);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <DialogPrimitive.Content
          data-testid="crop-dialog"
          aria-describedby={undefined}
          style={{ width: DIALOG.w, height: DIALOG.h }}
          className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-[12px] border border-[#3c3c3c] bg-[#0b0b0b] shadow-[0_16px_48px_rgba(0,0,0,0.55)] font-poppins outline-none select-none overflow-hidden"
        >
          <div className="relative h-[35px] shrink-0 bg-[#1b1b1c] flex items-center justify-center">
            <button type="button" aria-label="Close" data-testid="crop-close" onClick={() => onOpenChange(false)} className="absolute left-[14px] h-3 w-3 rounded-full bg-[#ff5f57] hover:brightness-90 cursor-pointer" />
            <DialogPrimitive.Title className="text-[13px] font-semibold text-brand-lighter">Crop</DialogPrimitive.Title>
          </div>

          {/* The stage: the picture (turned by the rotation) and the crop frame over it. */}
          <div data-testid="crop-stage" className="relative flex-1 min-h-0 overflow-hidden bg-[#0b0b0b]" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
            {bitmap && sw > 0 && (
              <div className="absolute" style={{ left: AREA.cx - dispW / 2, top: AREA.cy - dispH / 2, width: dispW, height: dispH, transform: `rotate(${theta}deg)` }} data-testid="crop-picture" data-rotation={theta}>
                {bitmap.canvas ? (
                  <canvas ref={canvasRef} className="w-full h-full block" />
                ) : (
                  <img src={bitmap.url} alt="" draggable={false} className="w-full h-full block" />
                )}
              </div>
            )}
            {/* The frame: everything outside it is dimmed. */}
            <div
              data-testid="crop-frame"
              data-box={`${(win.r - win.l).toFixed(1)}x${(win.b - win.t).toFixed(1)}`}
              onPointerDown={(e) => onPointerDown(e, "move")}
              className="absolute border border-white/90 cursor-move"
              style={{ left: frameBox.x, top: frameBox.y, width: frameBox.w, height: frameBox.h, boxShadow: "0 0 0 2000px rgba(0,0,0,0.55)" }}
            >
              <div className="absolute inset-y-0 border-l border-dashed border-white/80 pointer-events-none" style={{ left: frameBox.w / 2 }} />
              <div className="absolute inset-x-0 border-t border-dashed border-white/80 pointer-events-none" style={{ top: frameBox.h / 2 }} />
              {side(0, -1)}
              {side(0, 1)}
              {side(-1, 0)}
              {side(1, 0)}
              {corner(-1, -1)}
              {corner(1, -1)}
              {corner(-1, 1)}
              {corner(1, 1)}
            </div>
            <span className="hidden" data-testid="crop-centre" data-x={midX} data-y={midY} />

            {/* The transport under the frame: the time, the length and a scrub line. */}
            {isVideo && (
              <div data-testid="crop-transport" className="absolute left-1/2 bottom-3 -translate-x-1/2 h-[34px] w-[378px] rounded-[6px] bg-[#1b1b1c] flex items-center gap-2 px-3 text-[11px] tabular-nums">
                <span className="text-brand-accent">{formatTimecode(frame, fps)}</span>
                <span className="w-px h-3 bg-[#444]" />
                <span className="text-brand-lighter">{formatTimecode(clipFrames, fps)}</span>
                <input
                  type="range"
                  data-testid="crop-scrub"
                  min={0}
                  max={Math.max(0, clipFrames - 1)}
                  value={frame}
                  onChange={(e) => setFrame(Number(e.target.value))}
                  className="flex-1 h-1 accent-[#ae81ce] cursor-pointer"
                />
              </div>
            )}
          </div>

          <div className="h-9 shrink-0 bg-[#29292d] flex items-center px-4 gap-3 text-[12px] text-brand-lighter">
            <span>Rotation</span>
            <input
              type="range"
              data-testid="crop-rotation"
              min={-MAX_TURN}
              max={MAX_TURN}
              step={1}
              value={Math.round(theta)}
              onChange={(e) => turnTo(Number(e.target.value))}
              onDoubleClick={() => turnTo(0)}
              className="w-[155px] h-1 accent-[#ae81ce] cursor-pointer"
            />
            <div className="flex items-center gap-0.5">
              <input
                data-testid="crop-rotation-field"
                value={fieldText}
                onChange={(e) => setFieldText(e.target.value)}
                onBlur={commitField}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitField();
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    turnTo(Math.round(theta) + (e.key === "ArrowUp" ? 1 : -1));
                  }
                }}
                className="h-[22px] w-[52px] rounded-[4px] bg-[#1b1b1c] px-2 text-center text-[12px] tabular-nums outline-none focus:ring-1 focus:ring-brand-accent/60"
              />
              <div className="h-[22px] w-[15px] rounded-[4px] bg-[#1b1b1c] flex flex-col items-center justify-center">
                <button type="button" aria-label="More" onClick={() => turnTo(Math.round(theta) + 1)} className="h-[11px] flex items-center text-brand-light hover:text-brand-lighter cursor-pointer">
                  <LuChevronUp className="w-3 h-3" />
                </button>
                <button type="button" aria-label="Less" onClick={() => turnTo(Math.round(theta) - 1)} className="h-[11px] flex items-center text-brand-light hover:text-brand-lighter cursor-pointer">
                  <LuChevronDown className="w-3 h-3" />
                </button>
              </div>
            </div>
            <span className="ml-3">Crop</span>
            <Choice testId="crop-ratio" side="top" width={110} value={ratioId} options={CROP_RATIOS.map((r) => ({ value: r.id, label: r.label }))} onChange={pickRatio} />
            <div className="ml-auto flex gap-2">
              <button type="button" data-testid="crop-reset" onClick={reset} className="h-[25px] w-[72px] rounded-[4px] bg-brand-button text-[12px] font-semibold text-brand-lighter hover:bg-[#5a5a5a] cursor-pointer">
                Reset
              </button>
              <button type="button" data-testid="crop-confirm" onClick={confirm} className="h-[25px] w-[72px] rounded-[4px] bg-brand-accent text-[12px] font-semibold text-white hover:bg-brand-accent-shade cursor-pointer">
                Confirm
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default CropDialog;
