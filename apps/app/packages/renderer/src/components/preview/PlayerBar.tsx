import React from "react";
import { LuMaximize, LuSquareDashed, LuX } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useViewportStore } from "@/lib/viewport";
import { cn } from "@/lib/utils";
import { BackButton, PlayPauseButton, RewindBackward, RewindForward } from "@/components/controls/Buttons";
import RatioMenu from "./RatioMenu";

/** "MM:SS.ss", or "HH:MM:SS.ss" past an hour. */
const formatTime = (frames: number, fps: number) => {
  if (!frames || !Number.isFinite(frames) || !fps) return "00:00.00";
  const totalSeconds = frames / fps;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${minutes.toString().padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}`;
  return hours > 0 ? `${hours.toString().padStart(2, "0")}:${mmss}` : mmss;
};

/** The playhead's time over the project's length. */
const TimeControl: React.FC = () => {
  const clipDuration = useClipStore((s) => s.clipDuration);
  const focusFrame = useControlsStore((s) => s.focusFrame);
  const fps = useControlsStore((s) => s.fps);
  return (
    <span data-testid="player-time" className="text-[11px] tabular-nums whitespace-nowrap">
      <span className="text-brand-accent">{formatTime(focusFrame, fps)}</span>
      <span className="text-brand-light/35 px-1">/</span>
      <span className="text-brand-light/55">{formatTime(clipDuration, fps)}</span>
    </span>
  );
};

const IconButton: React.FC<{ title: string; active?: boolean; onClick: () => void; children: React.ReactNode; testId?: string }> = ({
  title,
  active,
  onClick,
  children,
  testId,
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    data-testid={testId}
    onClick={onClick}
    className={cn(
      "h-7 w-7 flex items-center justify-center rounded-[5px] transition-colors cursor-pointer",
      active ? "text-brand-accent bg-brand-light/[0.06]" : "text-brand-light/70 hover:text-brand-light hover:bg-brand-light/10",
    )}
  >
    {children}
  </button>
);

/**
 * Under the player, as in CapCut: the time on the left, the transport in the middle, and the
 * canvas's ratio, safe-area guides and full screen on the right.
 */
const PlayerBar: React.FC<{ guides: boolean; onToggleGuides: () => void }> = ({ guides, onToggleGuides }) => {
  const setIsFullscreen = useControlsStore((s) => s.setIsFullscreen);
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
      <div className="flex items-center justify-end gap-x-1 min-w-0">
        {isAspectEditing && (
          <button
            type="button"
            onClick={() => setAspectEditing(false)}
            className="h-7 px-2 flex items-center gap-1.5 rounded-[5px] text-[11px] text-brand-light/90 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-colors"
          >
            Done editing size <LuX className="w-3 h-3" />
          </button>
        )}
        <RatioMenu />
        <IconButton title="Safe areas" active={guides} onClick={onToggleGuides} testId="safe-areas">
          <LuSquareDashed className="w-4 h-4" />
        </IconButton>
        <IconButton title="Full screen" onClick={() => setIsFullscreen(true)} testId="fullscreen">
          <LuMaximize className="w-4 h-4" />
        </IconButton>
      </div>
    </div>
  );
};

export default PlayerBar;
