import React, { useRef, useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TbDots } from "react-icons/tb";
import { LuLoaderCircle, LuPlus, LuUnlink } from "react-icons/lu";
import type { MediaRange } from "@/lib/media/add";

interface DeleteAlertDialogProps {
  onDelete: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { AssetCredit, ClipType, MediaInfo } from "@/lib/types";
import {
  generateAudioWaveformCanvas,
  generatePosterCanvas,
} from "@/lib/media/timeline";
import Draggable from "@/components/dnd/Draggable";
import { revealMediaFile } from "@app/preload";
import { openTranscriptForPath } from "@/lib/transcript";

/** A long name cut in the middle, so its start and its extension both show ("abc…xyz.mp4"). */
const middle = (name: string, max: number) => {
  if (name.length <= max) return name;
  const head = Math.ceil((max - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (max - 1 - head))}`;
};

// Module-level thumbnail caches so we don't have to regenerate waveforms/posters
// every time a sidebar remounts or the user navigates back to a menu.
const audioWaveformCache = new Map<string, CanvasImageSource | null>();
const posterCanvasCache = new Map<string, CanvasImageSource | null>();

const DeleteAlertDialog: React.FC<
  React.PropsWithChildren<DeleteAlertDialogProps>
> = ({ onDelete, open, onOpenChange }) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="dark bg-brand font-poppins">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-brand-light text-base">
            Delete Media
          </AlertDialogTitle>
          <AlertDialogDescription className="text-brand-light/70 py-0 text-sm">
            Are you sure you want to delete this media? This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => onOpenChange(false)}
            className="bg-brand text-brand-light cursor-pointer text-[12.5px]"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onDelete();
              onOpenChange(false);
            }}
            className="cursor-pointer bg-brand-lighter text-[12.5px]"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

/** A row of the card's menu: CapCut's 32 px rows and 13 px labels, with the hover every app menu has. */
const menuRow = "dark h-8 px-3 rounded-[4px] text-[13px] text-brand-light cursor-pointer focus:bg-brand-hover data-[disabled]:text-[#525252] data-[disabled]:opacity-100";

export type MediaItem = {
  name: string;
  type: ClipType;
  absPath: string;
  assetUrl: string;
  originalAssetUrl?: string;
  dateAddedMs?: number;
  /** When the file itself was made (dateAddedMs is when it was imported). */
  createdMs?: number;
  mediaInfo?: MediaInfo;
  /** Set while a card is dragged: only this part of the media goes on the timeline. */
  range?: MediaRange;
  fillCanvas?: boolean;
  hasProxy?: boolean;
  /** The proxy is a playable copy of a format this app can't decode (ProRes): keep it. */
  isPlayableCopy?: boolean;
  /** A library track's credit (Audio tab), kept on the asset the drop makes. */
  credit?: AssetCredit;
  /** The file behind the card is gone (moved or deleted): Link to media points it at the file again. */
  missing?: boolean;
  /** Where the card's link pointed (a missing card's old place). */
  target?: string;
};

interface ItemProps {
  item: MediaItem;
  renamingItem: string | null;
  setRenamingItem: (item: string | null) => void;
  renameContainerRef: React.RefObject<HTMLDivElement | null>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  commitRename: (item: string) => void;
  setDeleteItem: (item: string | null) => void;
  setDeleteAlertOpen: (open: boolean) => void;
  deleteAlertOpen: boolean;
  deleteItem: string | null;
  handleDelete: (item: string) => void;
  startRename: (item: MediaItem) => void;
  isDragging?: boolean;
  onCreateProxy?: (item: MediaItem) => void;
  onRemoveProxy?: (item: MediaItem) => void;
  isCreatingProxy?: boolean;
  showName?: boolean;
  /** On the timeline already: shown with an "Added" badge, as in CapCut. */
  added?: boolean;
  /** A card (thumbnail over name) or a row (a small thumbnail beside it). */
  layout?: "card" | "row";
  /** Link to media: pick the file a missing card should show. */
  onRelink?: (item: MediaItem) => void;
  /** The card is selected (outlined; a video's In/Out handles show). */
  selected?: boolean;
  /** The part of a video the In/Out handles chose (null: all of it). */
  range?: MediaRange | null;
  onRange?: (item: MediaItem, range: MediaRange | null) => void;
  /** The hover "+": add the card (the chosen range of it) at the playhead. */
  onAdd?: (item: MediaItem) => void;
  /** Menu: New folder with selected item. */
  onNewFolder?: (item: MediaItem) => void;
  /** Menu: New timeline with selected item. */
  onNewTimeline?: (item: MediaItem) => void;
  /** Menu: Export selected clips (the picked cards, each with its In/Out range, as files). */
  onExport?: (item: MediaItem) => void;
  /** Menu: Split scenes (a video added and cut at its shot changes). */
  onSplitScenes?: (item: MediaItem) => void;
}

const minutesSeconds = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * The In/Out handles on a selected video card: two bars at the thumbnail's edges that drag to
 * choose a part of the video; what is outside them is dimmed. "+" or a drag then takes only
 * that part. Pressing a handle doesn't start the card's own drag.
 */
const RangeHandles: React.FC<{ duration: number; range: MediaRange | null; onChange: (r: MediaRange | null) => void }> = ({ duration, range, onChange }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const inF = range ? range.inSec / duration : 0;
  const outF = range ? range.outSec / duration : 1;
  // A part is at least a tenth of a second (or the whole of a shorter video).
  const gap = Math.min(0.1, duration / 2);
  const begin = (which: "in" | "out") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let cur = { inSec: range?.inSec ?? 0, outSec: range?.outSec ?? duration };
    const move = (ev: PointerEvent) => {
      const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width))) * duration;
      cur = which === "in" ? { inSec: Math.min(t, cur.outSec - gap), outSec: cur.outSec } : { inSec: cur.inSec, outSec: Math.max(t, cur.inSec + gap) };
      onChange(cur.inSec <= 0.0005 && cur.outSec >= duration - 0.0005 ? null : cur);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const bar = "absolute top-0 bottom-0 w-[7px] bg-brand-accent cursor-ew-resize flex items-center justify-center";
  return (
    <div ref={ref} data-testid="media-range" data-in={range?.inSec ?? 0} data-out={range?.outSec ?? duration} className="absolute inset-0 z-20 pointer-events-none">
      <div className="absolute top-0 bottom-0 left-0 bg-black/60" style={{ width: `${inF * 100}%` }} />
      <div className="absolute top-0 bottom-0 right-0 bg-black/60" style={{ width: `${(1 - outF) * 100}%` }} />
      <div className="absolute inset-y-0 border-y-2 border-brand-accent" style={{ left: `${inF * 100}%`, right: `${(1 - outF) * 100}%` }} />
      <div data-testid="media-range-in" onPointerDown={begin("in")} className={cn(bar, "rounded-l-[4px] pointer-events-auto")} style={{ left: `${inF * 100}%` }}>
        <span className="w-px h-3 bg-white/80" />
      </div>
      <div data-testid="media-range-out" onPointerDown={begin("out")} className={cn(bar, "rounded-r-[4px] pointer-events-auto")} style={{ left: `calc(${outF * 100}% - 7px)` }}>
        <span className="w-px h-3 bg-white/80" />
      </div>
      {range && (
        <span data-testid="media-range-length" className="absolute left-2 bottom-1 text-[10px] leading-none text-brand-light tabular-nums [text-shadow:0_0_3px_rgba(0,0,0,0.9)]">
          {minutesSeconds(range.outSec - range.inSec)}
        </span>
      )}
    </div>
  );
};

function fileURLToPathInWorker(raw: string): string {
  try {
    const u = new URL(raw);

    // For file:// or app:// URLs, use the pathname and strip leading slashes.
    if (u.protocol === "file:" || u.protocol === "app:") {
      return decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    }

    // For other URL schemes, just normalize the pathname.
    return decodeURIComponent((u.pathname || "").replace(/^\/+/, ""));
  } catch {
    // Not a URL – assume it's already a path; just normalize leading slashes.
    return raw.replace(/^\/+/, "");
  }
}

// Stable, memoized thumbnail component to prevent re-renders on parent resize
export const MediaThumb: React.FC<{
  item: MediaItem;
  isDragging?: boolean;
  className?: string;
}> = React.memo(({ item,  isDragging, className }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const formatDuration = (duration: number) => {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = Math.floor(duration % 60);
    return hours > 0
      ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
      : `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  // Draw audio waveform once per URL
  useEffect(() => {
    if (item.type !== "audio") return;
    let cancelled = false;
    (async () => {
      try {
        const el = canvasRef.current;
        if (!el) return;
        const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
        const cssWidth = el.clientWidth || 240;
        const cssHeight = Math.round((cssWidth * 9) / 16);
        el.width = cssWidth * dpr;
        el.height = cssHeight * dpr;
        let waveform = audioWaveformCache.get(item.assetUrl) ?? null;
        if (!waveform) {
          waveform = await generateAudioWaveformCanvas(
            item.assetUrl,
            el.width,
            el.height,
            { color: "#7791C4", mediaInfo: item.mediaInfo },
          );
          audioWaveformCache.set(item.assetUrl, waveform ?? null);
        }
        if (item.mediaInfo) {
          setMediaInfo(item.mediaInfo);
        }
        if (!waveform || cancelled) return;
        const ctx = el.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, el.width, el.height);
        // Scale cached waveform into the current canvas size so we can reuse
        // the same underlying bitmap across remounts.
        ctx.drawImage(waveform as CanvasImageSource, 0, 0, el.width, el.height);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.assetUrl, item.type]);

  // Draw poster frame once per URL for video/image without stretching to canvas width
  useEffect(() => {
    if (item.type === "audio") return;
    let cancelled = false;
    (async () => {
      try {
        let poster = posterCanvasCache.get(item.assetUrl) ?? null;
        if (!poster) {
          poster = await generatePosterCanvas(
            item.assetUrl,
            undefined,
            undefined,
            { mediaInfo: item.mediaInfo },
          );
          posterCanvasCache.set(item.assetUrl, poster ?? null);
        }
        if (item.mediaInfo) {
          setMediaInfo(item.mediaInfo);
        }
        const canvasEl = canvasRef.current;
        if (!poster || !canvasEl) return;
        if (cancelled) return;

        const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
        const cssWidth = canvasEl.clientWidth || 240;
        const cssHeight = Math.round((cssWidth * 9) / 16);
        canvasEl.width = cssWidth * dpr;
        canvasEl.height = cssHeight * dpr;
        const ctx = canvasEl.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = true;
        // @ts-ignore
        ctx.imageSmoothingQuality = "high";
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

        // Use the source image width, scaled only by ideal height, and center horizontally.
        const srcCanvas = poster as any;
        const srcW: number = srcCanvas.width;
        const srcH: number = srcCanvas.height;
        if (srcW > 0 && srcH > 0) {
          if (item.fillCanvas) {
            // Fill the entire canvas
            ctx.drawImage(
              poster as CanvasImageSource,
              0,
              0,
              canvasEl.width,
              canvasEl.height,
            );
          } else {
            const scale = canvasEl.height / srcH; // scale to match ideal height only (device pixels)
            const drawW = Math.max(1, Math.floor(srcW * scale));
            const drawH = Math.max(1, Math.floor(srcH * scale));
            const drawX = Math.floor((canvasEl.width - drawW) / 2);
            const drawY = 0;
            ctx.drawImage(
              poster as CanvasImageSource,
              drawX,
              drawY,
              drawW,
              drawH,
            );
          }
        }
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.assetUrl, item.type]);

  useEffect(() => {
    if (item.type !== "video") return;
    if (isDragging) return;
    if (!isHovered) return;
    const v = videoRef.current;
    if (!v) return;
    const p = v.play();
    if (p) p.catch(() => {});
  }, [isHovered, isDragging, item.assetUrl, item.type]);

  const stopHoverPreview = () => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      try {
        v.currentTime = 0;
      } catch {
        // ignore
      }
    }
    setIsHovered(false);
  };

  const videoSrc = useMemo(() => {
    return isHovered && !isDragging ? `app://user-data/${fileURLToPathInWorker(item.assetUrl)}` : undefined;
  }, [isHovered, isDragging, item.assetUrl]); 
  return (
    <span
      className={cn(
        "flex flex-row gap-x-2.5 items-center justify-center relative overflow-hidden rounded-md",
        className,
      )}
      onMouseEnter={() => {
        if (item.type !== "video") return;
        if (isDragging) return;
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        if (item.type !== "video") return;
        stopHoverPreview();
      }}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
      {item.type === "video" && (
        <video
          ref={videoRef}
          src={videoSrc}
          className={cn(
            "absolute inset-0 w-full h-full object-cover transition-opacity duration-150 pointer-events-none",
            isHovered && !isDragging ? "opacity-100" : "opacity-0",
          )}
          preload="none"
          muted
          loop
          playsInline
        />
      )}
      {mediaInfo?.duration && (
        <span className="text-[10.5px] text-brand-light absolute top-1 right-1.5 z-10 tabular-nums [text-shadow:0_0_3px_rgba(0,0,0,0.9)]">
          {formatDuration(mediaInfo.duration)}
        </span>
      )}
      {isDragging && mediaInfo && !mediaInfo?.duration && (
        <span className="text-[10.5px] text-brand-light absolute top-1 right-1.5 z-10 tabular-nums [text-shadow:0_0_3px_rgba(0,0,0,0.9)]">
          {formatDuration(5)}
        </span>
      )}
    </span>
  );
});

const Item: React.FC<ItemProps> = ({
  item,
  renamingItem,
  setRenamingItem,
  renameContainerRef,
  renameInputRef,
  renameValue,
  setRenameValue,
  commitRename,
  setDeleteItem,
  setDeleteAlertOpen,
  deleteAlertOpen,
  deleteItem,
  handleDelete,
  startRename,
  onCreateProxy,
  onRemoveProxy,
  isCreatingProxy,
  showName = true,
  added = false,
  layout = "card",
  onRelink,
  selected = false,
  range = null,
  onRange,
  onAdd,
  onNewFolder,
  onNewTimeline,
  onSplitScenes,
  onExport,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const row = layout === "row";
  return (
    <Draggable
      id={item.name}
      data={range ? { ...item, range } : item}
      disabled={
        isOpen ||
        renamingItem === item.name ||
        deleteAlertOpen ||
        isCreatingProxy ||
        !!item.missing
      }
    >
      <div
        key={item.name}
        data-testid="media-card"
        data-name={item.name}
        data-selected={selected ? "true" : undefined}
        data-missing={item.missing ? "true" : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          setIsOpen(true);
        }}
        className={cn(
          "group rounded-[4px] transition-colors",
          row ? "flex items-center gap-2.5 p-1 hover:bg-brand-light/5" : "w-[120px]",
          {
            "bg-brand-light/5": renamingItem === item.name,
          },
        )}
      >
        <div className={cn("relative", row && "w-[46px] shrink-0")}>
          <div
            className={cn(
              // CapCut's card: a fixed 120×80 thumbnail, the media letterboxed on a raised fill.
              "overflow-hidden rounded-[4px] bg-brand-background-light relative group-hover:ring-1 group-hover:ring-brand-light/20",
              selected && "ring-[1.5px] ring-brand-accent group-hover:ring-brand-accent",
              row ? "w-[46px] h-[30px]" : "w-[120px] h-[80px]",
              {
                "opacity-50": isCreatingProxy,
                "cursor-pointer": !isCreatingProxy,
              },
            )}
          >
            {item.missing ? null : <MediaThumb item={item} />}
            {item.missing && (
              <button
                type="button"
                data-testid="media-missing"
                title={`${item.target ?? item.name} isn't there. Link to media to find it.`}
                onClick={() => onRelink?.(item)}
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#3a1d1f] text-[#e5898c] cursor-pointer hover:bg-[#46222a]"
              >
                <LuUnlink className={row ? "w-3.5 h-3.5" : "w-6 h-6"} />
                {!row && <span className="text-[11px] font-medium">Media missing</span>}
              </button>
            )}
            {selected && !row && !item.missing && item.type === "video" && (item.mediaInfo?.duration ?? 0) > 0.2 && (
              <RangeHandles duration={item.mediaInfo!.duration!} range={range} onChange={(r) => onRange?.(item, r)} />
            )}
            {!item.missing && !isCreatingProxy && (
              <button
                type="button"
                data-testid="media-add"
                title="Add to the timeline"
                aria-label={`Add ${item.name} to the timeline`}
                // The card's drag starts on a press: the button keeps its own.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd?.(item);
                }}
                className={cn(
                  "absolute z-30 w-[18px] h-[18px] rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer",
                  row ? "right-1 bottom-1 w-[14px] h-[14px]" : "right-1 bottom-1",
                )}
              >
                <LuPlus className="w-3 h-3" />
              </button>
            )}
            {added && !row && (
              <span className="absolute top-1 left-1 z-10 text-[10px] leading-none px-1.5 py-[2px] rounded-[2px] bg-brand-background-dark/85 text-brand-light">
                Added
              </span>
            )}
            {item.hasProxy && !isCreatingProxy && (
              <span
                className="absolute bottom-1 right-1 text-[8.5px] bg-brand-background/90 text-brand-light/90 px-1.5 py-1 rounded border border-brand-light/10 shadow"
                title={item.isPlayableCopy ? "Shown from an H.264 copy: this preview can't decode the original's format (e.g. ProRes)" : undefined}
              >
                {item.isPlayableCopy ? "Converted" : "Proxy"}
              </span>
            )}
            {isCreatingProxy && (
              <div className="absolute inset-0 flex items-center justify-center bg-brand-background/60 backdrop-blur-sm rounded-md">
                <LuLoaderCircle className="w-8 h-8 text-brand-light/90 animate-spin" />
              </div>
            )}
          </div>
          <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <div
              className={cn(
                "absolute top-2 right-2 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity",
                {
                  "pointer-events-none": isCreatingProxy,
                },
              )}
              title="Actions"
            >
              <DropdownMenuTrigger
                // A press on the menu button isn't a click on the card: the selection stays (the menu acts on all of it).
                onPointerDown={(e) => e.stopPropagation()}
                disabled={isCreatingProxy}
                className="bg-black/50 cursor-pointer hover:bg-black/70 duration-300 text-white p-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <TbDots className="w-4 h-4" />
              </DropdownMenuTrigger>
              {/* CapCut's media card menu (05-left-media/006): plain rows, no icons or separators, in
                  its order; 32 px rows with the hover every app menu has. */}
              <DropdownMenuContent
                align="start"
                className="dark w-[238px] p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light"
              >
                <DropdownMenuItem className={menuRow} onClick={() => startRename(item)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={menuRow}
                  onClick={() => {
                    setDeleteItem(item.name);
                    setDeleteAlertOpen(true);
                  }}
                >
                  Delete
                </DropdownMenuItem>
                <DropdownMenuItem className={menuRow} onClick={() => void revealMediaFile(item.absPath)}>
                  Open file location
                </DropdownMenuItem>
                <DropdownMenuItem className={menuRow} data-testid="media-new-folder" onClick={() => onNewFolder?.(item)}>
                  New folder with selected item
                </DropdownMenuItem>
                <DropdownMenuItem className={menuRow} data-testid="media-new-timeline" disabled={item.missing || !item.mediaInfo} onClick={() => onNewTimeline?.(item)}>
                  New timeline with selected item
                </DropdownMenuItem>
                <DropdownMenuItem className={menuRow} data-testid="media-link" disabled={!item.missing} onClick={() => onRelink?.(item)}>
                  Link to media
                </DropdownMenuItem>
                {item.type === "video" && !item.isPlayableCopy && !item.missing && (
                  <DropdownMenuItem className={menuRow} onClick={() => (item.hasProxy ? onRemoveProxy?.(item) : onCreateProxy?.(item))}>
                    {item.hasProxy ? "Cancel file proxy" : "Create file proxy"}
                  </DropdownMenuItem>
                )}
                {item.type === "video" && !item.missing && (
                  <DropdownMenuItem className={menuRow} data-testid="media-split-scenes" onClick={() => onSplitScenes?.(item)}>
                    Split scenes
                  </DropdownMenuItem>
                )}
                {item.type !== "image" && !item.missing && (
                  <DropdownMenuItem className={menuRow} data-testid="media-transcript" onClick={() => openTranscriptForPath(item.assetUrl)}>
                    Transcript
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className={menuRow} data-testid="media-export" disabled={item.missing || !item.mediaInfo} onClick={() => onExport?.(item)}>
                  Export selected clips
                </DropdownMenuItem>
              </DropdownMenuContent>
            </div>
          </DropdownMenu>
        </div>
        {renamingItem === item.name ? (
          <div ref={renameContainerRef} className={cn("px-0", row ? "flex-1 min-w-0" : "pt-1.5")}>
            <Input
              ref={renameInputRef}
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename(item.name);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenamingItem(null);
                }
              }}
              className="h-6 text-[10.5px]! text-brand-light/90 px-2 py-0.5 rounded"
            />
          </div>
        ) : (
          <div title={item.name} className={cn("px-0 text-[11.5px] cursor-pointer text-start whitespace-nowrap overflow-hidden", item.missing ? "text-[#e5898c]" : "text-[#949494]", row ? "flex-1 min-w-0 truncate" : "pt-1")}>
            {showName ? (row ? item.name : middle(item.name, 20)) : ""}
            {row && added && <span className="ml-2 text-[10px] px-1.5 py-px rounded-[2px] bg-brand-background-dark/85 text-brand-light">Added</span>}
          </div>
        )}
      </div>
      <DeleteAlertDialog
        open={deleteAlertOpen}
        onOpenChange={setDeleteAlertOpen}
        onDelete={() => deleteItem && handleDelete(deleteItem)}
      />
    </Draggable>
  );
};

export default Item;
