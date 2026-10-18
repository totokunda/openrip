// The timeline toolbar's editing buttons CapCut has beside Split (Delete left, Delete right,
// Add marker, the transform tools after Crop) and its toggles at the right (Main track magnet,
// Auto snapping, Linkage, then Zoom to fit after a divider). Each is its own small component without props, styled like
// the toolbar's other buttons, its tooltip naming its shortcut, so any toolbar can place them.
import React from "react";
import { TbArrowBarToLeft, TbArrowBarToRight, TbArrowsHorizontal, TbSeparatorVertical, TbSnowflake, TbTransform } from "react-icons/tb";
import { LuCheck, LuFlipHorizontal2, LuHistory, LuLink, LuMagnet, LuRotateCw, LuShield } from "react-icons/lu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { freezeAtPlayhead, freezeTarget, reverseTarget, toggleReverse } from "@/lib/timeline-motion";
import { rotate90, toggleFlip } from "@/lib/transform-presets";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { addMarkerAtPlayhead, deleteToPlayhead, zoomTimelineTo } from "@/lib/timeline-shortcuts";
import { mainTrackOf } from "@/lib/timeline-edit";
import { cn } from "@/lib/utils";

const buttonClass = (disabled: boolean) =>
  cn(
    "flex shrink-0 transform-gpu items-center cursor-pointer gap-x-2 py-4 justify-center opacity-60 hover:opacity-100 transition-opacity duration-300",
    disabled && "opacity-30 cursor-not-allowed hover:opacity-30",
  );

/** Whether Delete left / right has a clip to work on: one under the playhead, selected or on the main track. */
const canTrim = (focusFrame: number, selectedClipIds: string[]) => {
  const { clips, timelines } = useClipStore.getState();
  const main = mainTrackOf(timelines);
  const under = clips.filter((c) => !c.hidden && focusFrame > (c.startFrame ?? 0) && focusFrame < (c.endFrame ?? 0));
  return under.some((c) => selectedClipIds.includes(c.clipId)) || under.some((c) => c.timelineId === main?.timelineId);
};
const useCanTrim = () => {
  // Checked again after an edit, and when the playhead or selection moves (re-rendering only
  // when the answer changes, not at each frame of playback).
  useClipStore((s) => s.clips);
  useClipStore((s) => s.timelines);
  return useControlsStore((c) => canTrim(c.focusFrame, c.selectedClipIds));
};

export const DeleteLeftButton = () => {
  const disabled = !useCanTrim();
  return (
    <div title="Delete left (Q)" className={buttonClass(disabled)} onClick={() => !disabled && deleteToPlayhead("left")}>
      <TbArrowBarToLeft className="text-brand-light h-4 w-4" />
    </div>
  );
};

export const DeleteRightButton = () => {
  const disabled = !useCanTrim();
  return (
    <div title="Delete right (W)" className={buttonClass(disabled)} onClick={() => !disabled && deleteToPlayhead("right")}>
      <TbArrowBarToRight className="text-brand-light h-4 w-4" />
    </div>
  );
};

export const AddMarkerButton = () => {
  const disabled = useClipStore((s) => s.clips.length === 0);
  return (
    <div title="Add marker (M)" className={buttonClass(disabled)} onClick={() => !disabled && addMarkerAtPlayhead()}>
      <LuShield className="text-brand-light h-4 w-4" />
    </div>
  );
};

/** A toggle: on, its glyph in the accent on a dark chip (CapCut's 24×23); off, a grey glyph. */
const Toggle: React.FC<{ title: string; on: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }> = ({
  title,
  on,
  disabled = false,
  onClick,
  children,
}) => (
  <div
    title={title}
    role="switch"
    aria-checked={on}
    onClick={() => !disabled && onClick()}
    className={cn(
      "flex shrink-0 items-center justify-center h-[23px] w-6 rounded-[4px] cursor-pointer transition-colors duration-200",
      on ? "bg-black/40 text-brand-accent" : "text-brand-light/70 hover:text-brand-light",
      disabled && "opacity-30 cursor-not-allowed",
    )}
  >
    {children}
  </div>
);

export const MagnetToggle = () => {
  const magnet = useClipStore((s) => s.magnet);
  const setMagnet = useClipStore((s) => s.setMagnet);
  // CapCut won't change it while the main track is locked.
  const mainLocked = useClipStore((s) => !!mainTrackOf(s.timelines)?.locked);
  return (
    <Toggle title="Main track magnet (P)" on={magnet} disabled={mainLocked} onClick={() => setMagnet(!magnet)}>
      <LuMagnet className="h-3.5 w-3.5" />
    </Toggle>
  );
};

export const SnappingToggle = () => {
  const snapping = useControlsStore((s) => s.snapping);
  const setSnapping = useControlsStore((s) => s.setSnapping);
  return (
    <Toggle title="Auto snapping (N)" on={snapping} onClick={() => setSnapping(!snapping)}>
      <TbSeparatorVertical className="h-4 w-4" />
    </Toggle>
  );
};

export const LinkageToggle = () => {
  const linkage = useControlsStore((s) => s.linkage);
  const setLinkage = useControlsStore((s) => s.setLinkage);
  return (
    <Toggle title="Linkage (`)" on={linkage} onClick={() => setLinkage(!linkage)}>
      <LuLink className="h-3.5 w-3.5" />
    </Toggle>
  );
};

export const ZoomToFitButton = () => {
  const disabled = useClipStore((s) => s.clips.length === 0);
  return (
    <div
      title="Zoom timeline to fit (⇧Z)"
      className={cn("flex shrink-0 items-center justify-center h-6 w-6 rounded-[5px] text-brand-light/60 hover:text-brand-light hover:bg-brand-light/10 cursor-pointer", disabled && "opacity-30 cursor-not-allowed")}
      onClick={() => !disabled && zoomTimelineTo(useControlsStore.getState().minZoomLevel)}
    >
      <TbArrowsHorizontal className="h-4 w-4" />
    </div>
  );
};

/** The 16 px rule between the toolbar's groups. */
export const ToolbarDivider = () => <div className="h-4 w-px shrink-0 bg-brand-background-light" />;

/**
 * CapCut's transform tools (▾ in the button's corner): a 238 px menu of Freeze (a 3 s still of
 * the frame at the playhead, on the selected video under it or the main track's), Reverse (the
 * selected video plays backward; again puts it back), Mirror and Rotate (a quarter turn) for the
 * selected video or photo. Enabled when one of them has something to act on.
 */
export const TransformToolsMenu = () => {
  const selected = useControlsStore((c) => c.selectedClipIds);
  // Checked again after an edit, and when the playhead or selection moves.
  const canFreeze = useControlsStore((c) => {
    const { clips, timelines } = useClipStore.getState();
    return !!freezeTarget(clips, timelines, c.focusFrame, c.selectedClipIds);
  });
  useClipStore((s) => s.clips);
  const { clips, updateClip } = useClipStore.getState();
  const reversible = reverseTarget(clips, selected);
  const visual = clips.find((c) => c.clipId === selected[selected.length - 1] && (c.type === "video" || c.type === "image"));
  const disabled = !canFreeze && !reversible && !visual;
  const row = "dark h-9 text-[13px] text-brand-light gap-x-2.5 px-3 rounded-[4px] cursor-pointer focus:bg-brand-hover";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        title="Transform tools"
        data-testid="tool-transform"
        className={cn("relative h-7 w-7 flex items-center justify-center text-brand-light opacity-60 hover:opacity-100 outline-none", disabled && "opacity-30 cursor-not-allowed hover:opacity-30")}
      >
        <TbTransform className="h-4 w-4" />
        {/* The corner triangle that says it opens a menu. */}
        <span className="absolute right-[3px] bottom-[3px] w-0 h-0 border-l-[4px] border-l-transparent border-b-[4px] border-b-brand-light" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="dark w-[238px] bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] p-1">
        <DropdownMenuItem data-testid="tool-freeze" className={row} disabled={!canFreeze} onClick={() => freezeAtPlayhead()}>
          <TbSnowflake className="w-4 h-4 text-[#cbcbcb]" /> Freeze
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="tool-reverse" className={row} disabled={!reversible} onClick={() => toggleReverse()}>
          <LuHistory className="w-4 h-4 text-[#cbcbcb]" /> Reverse
          {reversible?.reverse && <LuCheck className="ml-auto w-3.5 h-3.5 text-brand-accent" />}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="tool-mirror" className={row} disabled={!visual} onClick={() => visual && updateClip(visual.clipId, toggleFlip(visual, "horizontal"))}>
          <LuFlipHorizontal2 className="w-4 h-4 text-[#cbcbcb]" /> Mirror
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="tool-rotate" className={row} disabled={!visual} onClick={() => visual && updateClip(visual.clipId, rotate90(visual, 1))}>
          <LuRotateCw className="w-4 h-4 text-[#cbcbcb]" /> Rotate
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
