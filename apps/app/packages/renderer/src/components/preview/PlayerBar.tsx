import React from "react";
import { LuCheck, LuMaximize, LuPause, LuPlay, LuShrink, LuSquareDashed, LuX } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useViewportStore } from "@/lib/viewport";
import { usePlayerStore, type PreviewQuality } from "@/lib/player";
import { cn } from "@/lib/utils";
import { formatTimecode, type TimeCodeStyle } from "@/lib/timecode";
import { usePreference } from "@/lib/preferences";
import { BackButton, RewindBackward, RewindForward } from "@/components/controls/Buttons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import RatioMenu from "./RatioMenu";
import Boxed from "./Boxed";

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
      active ? "text-brand-accent" : "text-brand-light/80 hover:text-brand-light",
    )}
  >
    {children}
  </button>
);

const QUALITIES: { value: PreviewQuality; label: string; title: string; note: string }[] = [
  { value: 1, label: "Full", title: "Full quality", note: "The canvas at its size on screen" },
  { value: 0.5, label: "Half", title: "Half", note: "Smoother playback; exports aren't affected" },
  { value: 0.25, label: "Quarter", title: "Quarter", note: "Smoothest playback; exports aren't affected" },
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
        className="h-6 px-1 flex items-center rounded-[4px] text-brand-light/80 hover:text-brand-light hover:bg-brand-light/[0.08] transition-colors cursor-pointer"
      >
        <Boxed>{QUALITIES.find((q) => q.value === quality)?.label}</Boxed>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="dark w-[300px] p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px]">
        {QUALITIES.map((q) => (
          <DropdownMenuItem key={q.value} onClick={() => setQuality(q.value)} className="dark h-[46px] rounded-[4px] items-start gap-3 py-1.5 focus:bg-brand-hover">
            <span className="w-4 pt-0.5 text-brand-accent">{quality === q.value && <LuCheck className="w-3.5 h-3.5" />}</span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-brand-lighter">{q.title}</span>
              <span className="text-[12px] text-[#6c6c6c]">{q.note}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Under the player, as in CapCut: the time on the left (HH:MM:SS:FF), play in the middle (go
 * to start and ±5 s beside it), and safe areas, the preview's quality, zoom to fit, the
 * canvas's ratio and full screen on the right.
 */
const PlayerBar: React.FC = () => {
  const setIsFullscreen = useControlsStore((s) => s.setIsFullscreen);
  const isPlaying = useControlsStore((s) => s.isPlaying);
  const play = useControlsStore((s) => s.play);
  const pause = useControlsStore((s) => s.pause);
  const hasClips = useClipStore((s) => s.clips.length > 0);
  const zoomToFit = useViewportStore((s) => s.zoomToFit);
  const isAspectEditing = useViewportStore((s) => s.isAspectEditing);
  const setAspectEditing = useViewportStore((s) => s.setAspectEditing);
  const guides = usePlayerStore((s) => s.guides);
  const setGuides = usePlayerStore((s) => s.setGuides);

  return (
    <div className="@container h-11 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2">
      <div className="flex items-center min-w-0 overflow-hidden">
        <TimeControl off={!hasClips} />
      </div>
      <div className="flex items-center gap-x-3 [&_svg]:!text-brand-light/60">
        {/* In a narrow player (the Vertical layout) only play stays. */}
        <div className="flex items-center gap-x-3 @max-[520px]:hidden">
          <BackButton />
          <RewindBackward />
        </div>
        <button
          type="button"
          data-testid="play"
          title={isPlaying ? "Pause" : "Play"}
          onClick={() => (isPlaying ? pause() : play())}
          className="h-7 w-7 flex items-center justify-center rounded-[4px] text-[#cecece] hover:text-white hover:bg-brand-light/[0.08] cursor-pointer [&_svg]:!text-[#cecece]"
        >
          {isPlaying ? <LuPause className="w-3.5 h-3.5 fill-current" /> : <LuPlay className="w-3.5 h-3.5 fill-current" />}
        </button>
        <div className="@max-[520px]:hidden">
          <RewindForward />
        </div>
      </div>
      <div className="flex items-center justify-end gap-x-1 min-w-0">
        {isAspectEditing && (
          <button
            type="button"
            onClick={() => setAspectEditing(false)}
            className="h-6 px-2 mr-1 flex items-center gap-1.5 rounded-[4px] text-[12px] text-brand-light border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-colors"
          >
            Done editing size <LuX className="w-3 h-3" />
          </button>
        )}
        <IconButton title="Safe areas" onClick={() => setGuides(!guides)} active={guides} testId="safe-areas-button">
          <LuSquareDashed className="w-3.5 h-3.5" />
        </IconButton>
        <QualityMenu />
        <IconButton title="Zoom to fit" onClick={() => zoomToFit()} testId="zoom-to-fit">
          <LuShrink className="w-3.5 h-3.5" />
        </IconButton>
        <RatioMenu />
        <IconButton title="Full screen" onClick={() => setIsFullscreen(true)} testId="fullscreen">
          <LuMaximize className="w-3.5 h-3.5" />
        </IconButton>
      </div>
    </div>
  );
};

export default PlayerBar;
