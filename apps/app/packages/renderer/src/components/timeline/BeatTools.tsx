// The timeline toolbar's beat tools for the selected clip with sound, as CapCut has had them
// beside its editing buttons: Mark beat (a beat at the playhead, or off if one marked by hand
// is there) and its menu, Auto beat (off, Beat 1: bar starts, Beat 2: every beat; the engine's
// beats or a CapCut draft's own) and Clear beats. The clip's context menu has the same
// (lib/audio-tools.ts `soundMenuItems`). The markers are drawn on the clip
// (clips/BeatMarkers.tsx) and snapped to.
import React from "react";
import { LuChevronDown, LuFlag } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { manualBeatAt } from "@/lib/beats";
import { autoBeatOf, clearBeatsInStore, mediaSecondsOf, selectedSoundClip, setAutoBeat, toggleBeatInStore, type AutoBeat } from "@/lib/audio-tools";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const menuSurface = "dark p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light";
const menuRow = "dark h-8 rounded-[4px] text-[13px] cursor-pointer focus:bg-brand-hover";

export const AUTO_BEATS: { id: AutoBeat; name: string }[] = [
  { id: "off", name: "Off" },
  { id: "beat1", name: "Beat 1" },
  { id: "beat2", name: "Beat 2" },
];

/**
 * Which state the button is in: "none" without a clip with sound selected (or the playhead off
 * it), "add", or "remove" when a beat marked by hand is at the playhead. A string, so the
 * toolbar re-renders when it changes, not at each frame of playback.
 */
const useBeatState = () => {
  useClipStore((s) => s.clips);
  return useControlsStore((c) => {
    void c.selectedClipIds;
    const clip = selectedSoundClip();
    if (!clip) return "none";
    const f = c.focusFrame;
    if (f < (clip.startFrame ?? 0) || f > (clip.endFrame ?? 0)) return "none";
    return manualBeatAt(clip, f, c.fps || 30, mediaSecondsOf(clip)) === undefined ? "add" : "remove";
  });
};

export const BeatButton: React.FC = () => {
  const state = useBeatState();
  const selectedId = useControlsStore((c) => c.selectedClipIds[c.selectedClipIds.length - 1]);
  const auto = useClipStore((s) => autoBeatOf(s.getClipById(selectedId)));
  const hasClip = useClipStore(() => !!selectedSoundClip());
  const clipId = selectedSoundClip()?.clipId;
  return (
    <span className="flex flex-row items-center h-7" data-testid="tool-beat-group">
      <button
        type="button"
        data-testid="tool-beat"
        data-state={state}
        disabled={state === "none"}
        title={state === "remove" ? "Remove the beat at the playhead" : "Mark a beat at the playhead"}
        onClick={() => clipId && toggleBeatInStore(clipId)}
        className={cn(
          "h-7 w-6 flex items-center justify-center transition-opacity disabled:opacity-30 disabled:cursor-not-allowed",
          state === "remove" ? "text-brand-accent" : "text-brand-light opacity-60 hover:opacity-100",
        )}
      >
        <LuFlag className="h-4 w-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!hasClip}>
          <button
            type="button"
            data-testid="tool-beat-menu"
            title="Auto beat"
            className="h-7 w-3 flex items-center justify-center text-brand-light opacity-60 hover:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed outline-none"
          >
            <LuChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} className={cn(menuSurface, "w-[178px]")}>
          <div className="px-2.5 py-1 text-[12px] text-[#6c6c6c]">Auto beat</div>
          {AUTO_BEATS.map((b) => (
            <DropdownMenuCheckboxItem
              key={b.id}
              data-testid={`auto-beat-${b.id}`}
              className={menuRow}
              checked={auto === b.id}
              onCheckedChange={() => clipId && setAutoBeat(clipId, b.id)}
            >
              {b.name}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator className="bg-brand-hover mx-1" />
          <DropdownMenuItem data-testid="clear-beats" className={cn(menuRow, "px-2.5")} onClick={() => clipId && clearBeatsInStore(clipId)}>
            Clear beats
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
};
