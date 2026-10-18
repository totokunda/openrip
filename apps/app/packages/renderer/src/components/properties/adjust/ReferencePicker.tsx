import React, { useMemo } from "react";
import { LuChevronDown } from "react-icons/lu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { hasColorTools } from "@/lib/color-tools";
import { timecode } from "@/components/preview/PlayerBar";
import { cn } from "@/lib/utils";
import type { AnyClipProps } from "@/lib/types";

const menu = "dark bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] p-1";

/** A clip's name as the timeline shows it: its media's file name. */
export const useClipName = () => {
  const assets = useClipStore((s) => s.assets);
  return (clip: AnyClipProps | undefined) => {
    if (!clip || !hasColorTools(clip)) return "";
    const path = assets[clip.assetId]?.path ?? "";
    return decodeURIComponent(path.split(/[\\/]/).pop()?.split("#")[0] ?? "") || "Clip";
  };
};

/**
 * The reference clip for Color match and Make colors consistent: a 22 px field showing the
 * chosen clip (or "Select a reference clip"), opening a list of the timeline's videos and
 * photos, each with its media's name and where it starts.
 */
const ReferencePicker: React.FC<{
  value: string | null;
  onChange: (clipId: string) => void;
  /** Left out of the list (the clip being matched). */
  exclude?: string;
  disabled?: boolean;
  testId?: string;
}> = ({ value, onChange, exclude, disabled, testId }) => {
  const clips = useClipStore((s) => s.clips);
  const fps = useControlsStore((s) => s.fps);
  const nameOf = useClipName();
  const options = useMemo(
    () => clips.filter((c) => hasColorTools(c) && c.clipId !== exclude && !c.hidden).sort((a, b) => (a.startFrame ?? 0) - (b.startFrame ?? 0)),
    [clips, exclude],
  );
  const chosen = clips.find((c) => c.clipId === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || options.length === 0}
        data-testid={testId}
        className="flex-1 min-w-0 h-[22px] px-2 rounded-[4px] bg-brand flex flex-row items-center gap-1.5 text-left text-[12px] text-brand-lighter disabled:opacity-50 outline-none focus-visible:ring-1 focus-visible:ring-[#515151]"
      >
        <span className={cn("flex-1 truncate", !chosen && "text-[#8a8a8a]")}>{chosen ? nameOf(chosen) : options.length ? "Select a reference clip" : "No other clip on the timeline"}</span>
        <LuChevronDown className="w-3 h-3 shrink-0 text-brand-light" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn(menu, "w-[240px] max-h-[280px] overflow-y-auto")}>
        {options.map((c) => (
          <DropdownMenuItem
            key={c.clipId}
            data-testid="reference-option"
            data-clip-id={c.clipId}
            onClick={() => onChange(c.clipId)}
            className={cn("h-8 px-2.5 rounded-[4px] text-[13px] text-brand-light flex flex-row items-center gap-2 cursor-pointer focus:bg-brand-hover", c.clipId === value && "text-brand-accent")}
          >
            <span className="flex-1 truncate">{nameOf(c)}</span>
            <span className="text-[11px] tabular-nums text-[#8a8a8a]">{timecode(c.startFrame ?? 0, fps)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ReferencePicker;
