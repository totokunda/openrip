// The timeline toolbar's editing buttons CapCut has beside Split (Delete left, Delete right,
// Add marker, the transform tools after Crop) and its toggles at the right (Main track magnet,
// Auto snapping, Linkage, then Zoom to fit after a divider). Each is its own small component without props, styled like
// the toolbar's other buttons, its tooltip naming its shortcut, so any toolbar can place them.
import React from "react";
import { TbArrowBarToLeft, TbArrowBarToRight, TbArrowsHorizontal, TbSeparatorVertical, TbSnowflake, TbTransform } from "react-icons/tb";
import { LuCheck, LuChevronLeft, LuChevronRight, LuFlipHorizontal2, LuHistory, LuLink, LuMagnet, LuPlus, LuMousePointer2, LuRotateCw, LuScissors, LuScan, LuShield } from "react-icons/lu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { freezeAtPlayhead, freezeTarget, reverseTarget, toggleReverse } from "@/lib/timeline-motion";
import { rotate90, toggleFlip } from "@/lib/transform-presets";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { addMarkerAtPlayhead, deleteToPlayhead, selectBeside, toggleZoomToFit } from "@/lib/timeline-shortcuts";
import { mainTrackOf } from "@/lib/timeline-edit";
import { trail } from "@/lib/compound";
import { closeCompound } from "@/lib/compound-edit";
import { keyLabels, useKeymapStore, useShortcutTitle } from "@/lib/keymap";
import { cn } from "@/lib/utils";
import { TRACK_TYPES } from "./TrackControls";
import { useShellStore } from "@/lib/shell";

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
    <div title={useShortcutTitle("Delete left", "deleteLeft")} className={buttonClass(disabled)} onClick={() => !disabled && deleteToPlayhead("left")}>
      <TbArrowBarToLeft className="text-brand-light h-4 w-4" />
    </div>
  );
};

export const DeleteRightButton = () => {
  const disabled = !useCanTrim();
  return (
    <div title={useShortcutTitle("Delete right", "deleteRight")} className={buttonClass(disabled)} onClick={() => !disabled && deleteToPlayhead("right")}>
      <TbArrowBarToRight className="text-brand-light h-4 w-4" />
    </div>
  );
};

export const AddMarkerButton = () => {
  const disabled = useClipStore((s) => s.clips.length === 0);
  return (
    <div title={useShortcutTitle("Add marker", "addMarker")} className={buttonClass(disabled)} onClick={() => !disabled && addMarkerAtPlayhead()}>
      <LuShield className="text-brand-light h-4 w-4" />
    </div>
  );
};

/**
 * CapCut's Add (+) at the toolbar's left end: a menu of the tracks that can be added empty
 * (the track headers' + offers the same), each going where its kind belongs.
 */
export const AddMenuButton = () => {
  const addTrack = useClipStore((s) => s.addTrack);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger title="Add" data-testid="tool-add" className="h-7 w-7 flex items-center justify-center text-brand-light opacity-80 hover:opacity-100 outline-none">
        <LuPlus className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn(menuContent, "w-[190px]")}>
        {TRACK_TYPES.map((t) => (
          <DropdownMenuItem key={t.type} data-testid={`add-${t.type}`} className={menuRow} onClick={() => addTrack(t.type)}>
            Add {t.label.toLowerCase()}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

const menuContent = "dark bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] p-1";
const menuRow = "dark h-9 text-[13px] text-brand-light gap-x-2.5 px-3 rounded-[4px] cursor-pointer focus:bg-brand-hover";
const menuKey = "ml-auto text-[12px] text-[#8a8a8a]";

export const MagnetToggle = () => {
  const magnet = useClipStore((s) => s.magnet);
  const setMagnet = useClipStore((s) => s.setMagnet);
  // CapCut won't change it while the main track is locked.
  const mainLocked = useClipStore((s) => !!mainTrackOf(s.timelines)?.locked);
  return (
    <Toggle title={useShortcutTitle("Main track magnet", "magnet")} on={magnet} disabled={mainLocked} onClick={() => setMagnet(!magnet)}>
      <LuMagnet className="h-3.5 w-3.5" />
    </Toggle>
  );
};

export const SnappingToggle = () => {
  const snapping = useControlsStore((s) => s.snapping);
  const setSnapping = useControlsStore((s) => s.setSnapping);
  return (
    <Toggle title={useShortcutTitle("Auto snapping", "snapping")} on={snapping} onClick={() => setSnapping(!snapping)}>
      <TbSeparatorVertical className="h-4 w-4" />
    </Toggle>
  );
};

export const LinkageToggle = () => {
  const linkage = useControlsStore((c) => c.linkage);
  const setLinkage = useControlsStore((c) => c.setLinkage);
  const setOpen = useShellStore((s) => s.setLinkageOpen);
  return (
    <div className="flex items-center">
      <Toggle title={useShortcutTitle("Linkage", "linkage")} on={linkage} onClick={() => setLinkage(!linkage)}>
        <LuLink data-testid="tool-linkage" className="h-3.5 w-3.5" />
      </Toggle>
      <DropdownMenu>
        <DropdownMenuTrigger data-testid="tool-linkage-menu" title="Linkage options" className="h-[23px] w-3 flex items-center justify-center text-brand-light/70 hover:text-brand-light outline-none">
          <span className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-current" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={cn(menuContent, "w-[200px]")}>
          <DropdownMenuItem data-testid="linkage-settings" className={menuRow} onClick={() => setOpen(true)}>
            Linkage settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export const ZoomToFitButton = () => {
  const disabled = useClipStore((s) => s.clips.length === 0);
  // On while the whole timeline is in view.
  const fitted = useControlsStore((c) => c.zoomLevel === c.minZoomLevel);
  return (
    <Toggle title={useShortcutTitle("Zoom timeline to fit", "zoomToFit")} on={fitted && !disabled} disabled={disabled} onClick={toggleZoomToFit}>
      <TbArrowsHorizontal data-testid="tool-zoomfit" className="h-4 w-4" />
    </Toggle>
  );
};

/**
 * CapCut's selection tool (▾): Select (A) and the Split blade (B) are the timeline's tools, the
 * button showing the one in use; Select leftward ([) and Select rightward (]) select every clip
 * before or after the playhead.
 */
export const SelectionToolMenu = () => {
  const tool = useControlsStore((c) => c.timelineTool);
  const setTool = useControlsStore((c) => c.setTimelineTool);
  const key = (id: string) => useKeymapStore.getState().bindings[id]?.[0];
  const hint = (id: string) => {
    const c = key(id);
    return c ? keyLabels(c).join("") : "";
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Selection tool"
        data-testid="tool-selection"
        data-tool={tool}
        className="relative h-7 w-7 flex items-center justify-center text-brand-light opacity-80 hover:opacity-100 outline-none"
      >
        {tool === "split" ? <LuScissors className="h-4 w-4 text-brand-accent" /> : <LuMousePointer2 className="h-4 w-4" />}
        <span className="absolute right-[3px] bottom-[3px] w-0 h-0 border-l-[4px] border-l-transparent border-b-[4px] border-b-brand-light" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn(menuContent, "w-[190px]")}>
        <DropdownMenuItem data-testid="sel-select" className={cn(menuRow, tool === "select" && "bg-brand-hover")} onClick={() => setTool("select")}>
          <LuMousePointer2 className="w-4 h-4 text-[#cbcbcb]" /> Select <span className={menuKey}>{hint("selectMode")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="sel-split" className={cn(menuRow, tool === "split" && "bg-brand-hover")} onClick={() => setTool("split")}>
          <LuScissors className="w-4 h-4 text-[#cbcbcb]" /> Split <span className={menuKey}>{hint("splitMode")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="sel-left" className={menuRow} onClick={() => selectBeside("left")}>
          <TbArrowBarToLeft className="w-4 h-4 text-[#cbcbcb]" /> Select leftward <span className={menuKey}>{hint("selectLeft")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="sel-right" className={menuRow} onClick={() => selectBeside("right")}>
          <TbArrowBarToRight className="w-4 h-4 text-[#cbcbcb]" /> Select rightward <span className={menuKey}>{hint("selectRight")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * CapCut's preview axis: a toggle with a menu. On, the player shows the frame under the mouse
 * while it's over the timeline and goes back to the playhead's frame when it leaves. The menu's
 * video-only choice is what it does; the sound isn't scrubbed.
 */
export const PreviewAxisToggle = () => {
  const on = useControlsStore((c) => c.previewAxis);
  const setOn = useControlsStore((c) => c.setPreviewAxis);
  return (
    <div className="flex items-center">
      <Toggle title={useShortcutTitle("Preview axis", "previewAxis")} on={on} onClick={() => setOn(!on)}>
        <LuScan data-testid="tool-previewaxis" className="h-3.5 w-3.5" />
      </Toggle>
      <DropdownMenu>
        <DropdownMenuTrigger data-testid="tool-previewaxis-menu" title="Preview axis options" className="h-[23px] w-3 flex items-center justify-center text-brand-light/70 hover:text-brand-light outline-none">
          <span className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-current" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={cn(menuContent, "w-[200px]")}>
          <DropdownMenuItem data-testid="axis-audio" disabled className={menuRow}>
            <span className="w-3.5" /> Preview video and audio
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="axis-video" className={menuRow} onClick={() => setOn(true)}>
            <LuCheck className="w-3.5 h-3.5 text-brand-accent" /> Preview video only
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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

/**
 * While a compound clip's timeline is open: the way back, centred in the toolbar as CapCut's
 * "‹ Compound clip1" bar, here a breadcrumb: Main timeline › (each compound opened) ›
 * the one being edited. Its parts close back to that level, the arrow one level.
 */
export const CompoundBar = () => {
  const stack = useClipStore((s) => s.compoundStack);
  if (stack.length === 0) return null;
  const crumbs = trail(stack);
  const part = "px-1 rounded-[3px] text-brand-light/70 hover:text-brand-light hover:bg-brand-hover cursor-pointer";
  return (
    <div data-testid="compound-bar" className="absolute left-1/2 top-0 h-full -translate-x-1/2 flex items-center gap-x-1 text-[13px] text-brand-light select-none">
      <button type="button" title="Back" data-testid="compound-back" aria-label="Back" onClick={() => closeCompound()} className="h-6 w-5 flex items-center justify-center text-brand-light/80 hover:text-brand-light">
        <LuChevronLeft className="h-4 w-4" />
      </button>
      <span data-testid="compound-crumb" data-depth={0} className={part} onClick={() => closeCompound(stack.length)}>
        Main timeline
      </span>
      {crumbs.map((c, i) => (
        <React.Fragment key={c.clipId}>
          <LuChevronRight className="h-3 w-3 text-brand-light/40" />
          <span
            data-testid="compound-crumb"
            data-depth={i + 1}
            className={i === crumbs.length - 1 ? "px-1 font-medium" : part}
            onClick={() => i < crumbs.length - 1 && closeCompound(crumbs.length - 1 - i)}
          >
            {c.name}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
};
