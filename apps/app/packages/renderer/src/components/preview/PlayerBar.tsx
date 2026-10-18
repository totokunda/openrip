import React from "react";
import { LuChevronDown, LuMaximize, LuShrink, LuX } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useViewportStore } from "@/lib/viewport";
import { usePlayerStore, type PreviewQuality } from "@/lib/player";
import { cn } from "@/lib/utils";
import { BackButton, PlayPauseButton, RewindBackward, RewindForward } from "@/components/controls/Buttons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import RatioMenu from "./RatioMenu";

/** "HH:MM:SS:FF", as CapCut shows time: hours, minutes, seconds and the frame within it. */
export const timecode = (frames: number, fps: number) => {
  const rate = Math.max(1, Math.round(fps || 1));
  const f = Number.isFinite(frames) && frames > 0 ? Math.round(frames) : 0;
  const seconds = Math.floor(f / fps);
  const ff = Math.min(rate - 1, Math.round(f - seconds * fps));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}:${pad(ff)}`;
};

/** The playhead's time over the project's length (their seconds ride along for the harness). */
const TimeControl: React.FC = () => {
  const clipDuration = useClipStore((s) => s.clipDuration);
  const focusFrame = useControlsStore((s) => s.focusFrame);
  const fps = useControlsStore((s) => s.fps);
  return (
    <span
      data-testid="player-time"
      data-time={fps ? (focusFrame || 0) / fps : 0}
      data-total={fps ? (clipDuration || 0) / fps : 0}
      className="text-[12px] tabular-nums whitespace-nowrap"
    >
      <span className="text-brand-accent">{timecode(focusFrame, fps)}</span>
      <span className="text-brand-light/35 px-1.5">|</span>
      <span className="text-brand-light/55">{timecode(clipDuration, fps)}</span>
    </span>
  );
};

const IconButton: React.FC<{ title: string; onClick: () => void; children: React.ReactNode; testId?: string }> = ({
  title,
  onClick,
  children,
  testId,
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    data-testid={testId}
    onClick={onClick}
    className="h-7 w-7 flex items-center justify-center rounded-[5px] text-brand-light/70 hover:text-brand-light hover:bg-brand-light/10 transition-colors cursor-pointer"
  >
    {children}
  </button>
);

const QUALITIES: { value: PreviewQuality; label: string }[] = [
  { value: 1, label: "Full" },
  { value: 0.5, label: "Half" },
  { value: 0.25, label: "Quarter" },
];

/** The preview's quality: the engine renders at this fraction of the canvas's size on screen. */
const QualityMenu: React.FC = () => {
  const quality = usePlayerStore((s) => s.quality);
  const setQuality = usePlayerStore((s) => s.setQuality);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Preview quality"
        data-testid="preview-quality"
        className="h-7 px-2 flex items-center gap-1 rounded-[5px] text-[12px] text-brand-light/75 hover:text-brand-light hover:bg-brand-light/10 transition-colors cursor-pointer"
      >
        {QUALITIES.find((q) => q.value === quality)?.label}
        <LuChevronDown className="w-3 h-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="dark w-40 bg-brand-background/95 backdrop-blur-md border border-brand-light/10 rounded-[8px]">
        {QUALITIES.map((q) => (
          <DropdownMenuItem
            key={q.value}
            onClick={() => setQuality(q.value)}
            className={cn("dark text-[12px] justify-between", quality === q.value && "text-brand-accent")}
          >
            {q.label}
            <span className="text-brand-light/40 tabular-nums">{q.value === 1 ? "100%" : `${q.value * 100}%`}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Under the player, as in CapCut: the time on the left (HH:MM:SS:FF), the transport in the
 * middle, and the preview's quality, zoom to fit, the canvas's ratio and full screen on the
 * right.
 */
const PlayerBar: React.FC = () => {
  const setIsFullscreen = useControlsStore((s) => s.setIsFullscreen);
  const zoomToFit = useViewportStore((s) => s.zoomToFit);
  const isAspectEditing = useViewportStore((s) => s.isAspectEditing);
  const setAspectEditing = useViewportStore((s) => s.setAspectEditing);

  return (
    <div className="h-10 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-3 border-t border-brand-light/[0.06]">
      <div className="flex items-center min-w-0">
        <TimeControl />
      </div>
      <div className="flex items-center gap-x-3.5">
        <BackButton />
        <RewindBackward />
        <div data-testid="play" title="Play or pause" className="[&_svg]:!h-6 [&_svg]:!w-6">
          <PlayPauseButton />
        </div>
        <RewindForward />
      </div>
      <div className="flex items-center justify-end gap-x-0.5 min-w-0">
        {isAspectEditing && (
          <button
            type="button"
            onClick={() => setAspectEditing(false)}
            className="h-7 px-2 mr-1 flex items-center gap-1.5 rounded-[5px] text-[12px] text-brand-light/90 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-colors"
          >
            Done editing size <LuX className="w-3 h-3" />
          </button>
        )}
        <QualityMenu />
        <IconButton title="Zoom to fit" onClick={() => zoomToFit()} testId="zoom-to-fit">
          <LuShrink className="w-4 h-4" />
        </IconButton>
        <RatioMenu />
        <IconButton title="Full screen" onClick={() => setIsFullscreen(true)} testId="fullscreen">
          <LuMaximize className="w-4 h-4" />
        </IconButton>
      </div>
    </div>
  );
};

export default PlayerBar;
