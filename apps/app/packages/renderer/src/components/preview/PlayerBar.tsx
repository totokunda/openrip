import React from "react";
import { LuX } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useViewportStore } from "@/lib/viewport";
import { usePlayerStore } from "@/lib/player";
import { cn } from "@/lib/utils";
import { formatTimecode, type TimeCodeStyle } from "@/lib/timecode";
import { usePreference } from "@/lib/preferences";
import RatioMenu from "./RatioMenu";
import QualityMenu from "./QualityMenu";
import ZoomPopover from "./ZoomPopover";
import AudioMeter from "./AudioMeter";
import { FullscreenGlyph, PauseGlyph, PlayGlyph, SafeAreaGlyph } from "./player-ui";

/** "HH:MM:SS:FF", as CapCut shows time, in Settings › Edit › Time code's style (lib/timecode.ts). */
export const timecode = (frames: number, fps: number, style?: TimeCodeStyle) => formatTimecode(frames, fps, style);

/** The playhead's time over the project's length (their seconds ride along for scripts). */
const TimeControl: React.FC<{ off: boolean }> = ({ off }) => {
  const clipDuration = useClipStore((s) => s.clipDuration);
  const focusFrame = useControlsStore((s) => s.focusFrame);
  const fps = useControlsStore((s) => s.fps);
  const style = usePreference("timeCode");
  return (
    <span
      data-testid="player-time"
      data-time={fps ? (focusFrame || 0) / fps : 0}
      data-total={fps ? (clipDuration || 0) / fps : 0}
      className={cn("text-[12px] tabular-nums whitespace-nowrap", off && "opacity-40")}
    >
      <span className="text-brand-accent">{timecode(focusFrame, fps, style)}</span>
      <span className="text-brand-hover px-1">/</span>
      <span className="text-brand-light">{timecode(clipDuration, fps, style)}</span>
    </span>
  );
};

const IconButton: React.FC<{ title: string; onClick: () => void; children: React.ReactNode; testId?: string; active?: boolean }> = ({
  title,
  onClick,
  children,
  testId,
  active,
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    data-testid={testId}
    onClick={onClick}
    className={cn(
      "h-6 w-6 flex items-center justify-center rounded-[4px] hover:bg-brand-light/[0.08] transition-colors cursor-pointer",
      active ? "text-brand-accent" : "text-[#cecece] hover:text-brand-lighter",
    )}
  >
    {children}
  </button>
);

/**
 * Under the player, as CapCut's bottom bar: the time (HH:MM:SS:FF) and the stereo level meter
 * on the left, play in the middle, and on the right the safe-area overlay (where CapCut toggles
 * its platform overlay), the preview's quality ("Full"), the zoom popover, the canvas's ratio
 * and full screen (⌘⇧F).
 */
const PlayerBar: React.FC = () => {
  const setIsFullscreen = useControlsStore((s) => s.setIsFullscreen);
  const isPlaying = useControlsStore((s) => s.isPlaying);
  const play = useControlsStore((s) => s.play);
  const pause = useControlsStore((s) => s.pause);
  const hasClips = useClipStore((s) => s.clips.length > 0);
  const isAspectEditing = useViewportStore((s) => s.isAspectEditing);
  const setAspectEditing = useViewportStore((s) => s.setAspectEditing);
  const safeAreas = usePlayerStore((s) => s.safeAreas);
  const setSafeAreas = usePlayerStore((s) => s.setSafeAreas);

  return (
    <div data-testid="player-bar" className="@container h-11 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 pl-2 pr-2">
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        <TimeControl off={!hasClips} />
        <AudioMeter off={!hasClips} />
      </div>
      <button
        type="button"
        data-testid="play"
        title={isPlaying ? "Pause" : "Play"}
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={() => (isPlaying ? pause() : play())}
        className={cn("h-7 w-7 flex items-center justify-center rounded-[4px] text-[#cecece] hover:text-white hover:bg-brand-light/[0.08] cursor-pointer", !hasClips && "opacity-40")}
      >
        {isPlaying ? <PauseGlyph className="w-[10px] h-[12px]" /> : <PlayGlyph className="w-[10px] h-[12px]" />}
      </button>
      <div className="flex items-center justify-end gap-x-[7px] min-w-0">
        {isAspectEditing && (
          <button
            type="button"
            onClick={() => setAspectEditing(false)}
            className="h-6 px-2 mr-1 flex items-center gap-1.5 rounded-[4px] text-[12px] text-brand-light border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-colors"
          >
            Done editing size <LuX className="w-3 h-3" />
          </button>
        )}
        <IconButton title="Safe areas" onClick={() => setSafeAreas(!safeAreas)} active={safeAreas} testId="safe-areas-button">
          <SafeAreaGlyph className="w-[13px] h-[15px]" />
        </IconButton>
        <QualityMenu />
        <ZoomPopover />
        <RatioMenu />
        <IconButton title="Full screen (⌘⇧F)" onClick={() => setIsFullscreen(true)} testId="fullscreen">
          <FullscreenGlyph className="w-[13px] h-[13px]" />
        </IconButton>
      </div>
    </div>
  );
};

export default PlayerBar;
