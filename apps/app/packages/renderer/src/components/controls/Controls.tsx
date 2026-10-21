import { TbZoomIn, TbZoomOut } from "react-icons/tb";
import React, { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  SplitButton,
  TrashButton,
  SeparateButton,
  CropButton,
  UndoButton,
  RedoButton,
} from "./Buttons";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { startCompoundRenderWatcher } from "@/lib/compound-render";
import { useDrawingStore } from "@/lib/drawing";
import { useMaskStore } from "@/lib/mask";
import { useViewportStore } from "@/lib/viewport";
import { SHAPES } from "@/lib/shape-presets";
import { undo, redo } from "@/lib/history";
import { handleTimelineKey, zoomTimelineTo } from "@/lib/timeline-shortcuts";
import { actionFor } from "@/lib/keymap";
import { appWindowOpen } from "@/lib/shell";
import { removeTransition } from "@/lib/transitions";
import {
  AddMarkerButton,
  DeleteLeftButton,
  DeleteRightButton,
  LinkageToggle,
  AddMenuButton,
  MagnetToggle,
  CompoundBar,
  SnappingToggle,
  ToolbarDivider,
  TransformToolsMenu,
  ZoomToFitButton,
  SelectionToolMenu,
  PreviewAxisToggle,
} from "@/components/timeline/TimelineTools";
import { VoiceoverButton, VoiceoverPanel } from "@/components/voiceover/VoiceoverPanel";
import { BeatButton } from "@/components/timeline/BeatTools";

const TimelineZoom = () => {
  // Not the whole store: subscribed to it, the slider re-rendered on every frame of playback.
  const zoomLevel = useControlsStore((s) => s.zoomLevel);
  const setZoomLevel = useControlsStore((s) => s.setZoomLevel);
  const setFocusFrame = useControlsStore((s) => s.setFocusFrame);
  const minZoomLevel = useControlsStore((s) => s.minZoomLevel);
  const maxZoomLevel = useControlsStore((s) => s.maxZoomLevel);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const clips = useClipStore((state) => state.clips);
  const hasClips = useMemo(() => clips.length > 0, [clips]);

  useEffect(() => {
    if (!hasClips) {
      setZoomLevel(1);
      setFocusFrame(0);
    }
  }, [hasClips]);

  // The slider and the ⌘= / ⌘− shortcuts zoom the same way (lib/timeline-shortcuts.ts).
  const setZoom = (level: number) => zoomTimelineTo(level);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    updateZoomFromMouse(e);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    updateZoomFromMouse(e);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const updateZoomFromMouse = (e: React.MouseEvent | MouseEvent) => {
    if (!barRef.current) return;

    const rect = barRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newZoom =
      minZoomLevel + Math.round(percentage * (maxZoomLevel - minZoomLevel));
    setZoom(newZoom);
  };

  // Calculate circle position based on zoom level
  const getCirclePosition = () => {
    const progress = (zoomLevel - minZoomLevel) / (maxZoomLevel - minZoomLevel);
    return progress * 100; // percentage
  };

  // Add global event listeners for mouse move and up
  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging]);

  return (
    <div className="flex items-center  gap-x-2 justify-center transition-opacity duration-300">
      <TbZoomOut
        onClick={() => {
          if (zoomLevel === 1 || !hasClips) return;
          setZoom(zoomLevel - 1);
        }}
        className={cn("text-brand-light/80 h-[18px] w-[18px] duration-300", {
          "opacity-60": zoomLevel === 1 || !hasClips,
          "opacity-100": zoomLevel > 1 && hasClips,
          "cursor-not-allowed": zoomLevel === 1 || !hasClips,
          "cursor-pointer": zoomLevel > 1 && hasClips,
        })}
      />
      <div
        ref={barRef}
        data-no-popout
        onMouseDown={(e) => hasClips && handleMouseDown(e)}
        onMouseEnter={() => hasClips && setIsHovering(true)}
        onMouseLeave={() => hasClips && setIsHovering(false)}
        className={cn(
          "h-1 w-24 rounded-full bg-brand-light/10 transform-gpu cursor-pointer relative",
          {
            "cursor-grabbing": isDragging,
          },
        )}
      >
        <div
          className={cn(
            "h-1 rounded-full bg-brand-light/70 transition-all duration-300 transform-gpu pointer-events-none",
            {
              "w-0": zoomLevel === 1 || !hasClips,
              "w-1/9": zoomLevel === 2,
              "w-2/9": zoomLevel === 3,
              "w-3/9": zoomLevel === 4,
              "w-4/9": zoomLevel === 5,
              "w-5/9": zoomLevel === 6,
              "w-6/9": zoomLevel === 7,
              "w-7/9": zoomLevel === 8,
              "w-8/9": zoomLevel === 9,
              "w-9/9": zoomLevel === 10,
              "transition-none": isDragging,
            },
          )}
        ></div>

        {/* Draggable Circle */}
        <div
          className={cn(
            "absolute top-1/2 w-3 h-3 bg-brand-light/90 rounded-full transform -translate-y-1/2 -translate-x-1/2 transition-all duration-200 pointer-events-none",
            {
              "opacity-100 scale-100": isHovering || isDragging,
              "opacity-0 scale-75": !isHovering && !isDragging,
              "bg-brand-light": isDragging,
              "transition-none": isDragging,
            },
          )}
          style={{
            left: `${getCirclePosition()}%`,
          }}
        />
      </div>
      <TbZoomIn
        onClick={() => {
          if (zoomLevel >= 10 || !hasClips) return;
          setZoom(zoomLevel + 1);
        }}
        className={cn("text-brand-light/80 h-[18px] w-[18px] duration-300", {
          "opacity-100": zoomLevel < 10 && hasClips,
          "opacity-60": zoomLevel >= 10 || !hasClips,
          "cursor-not-allowed": zoomLevel >= 10 || !hasClips,
          "cursor-pointer": zoomLevel < 10 && hasClips,
        })}
      />
    </div>
  );
};

/**
 * A toolbar button's slot, named on hover (Undo and Redo name themselves): the button inside
 * fills it, so a click anywhere on it counts. The transport moved under the player (PlayerBar).
 */
const Tool: React.FC<{ title?: string; id: string; children: React.ReactNode }> = ({ title, id, children }) => (
  <div title={title} data-testid={`tool-${id}`} className="h-7 w-7 flex items-center justify-center [&>div]:h-full [&>div]:w-full [&>div]:py-0">
    {children}
  </div>
);

const Controls = () => {
  const { setIsOverMask, setIsMaskDragging } = useMaskStore();
  const tool = useViewportStore((s) => s.tool);
  const selectedMaskId = useControlsStore((s) => s.selectedMaskId);
  const selectedLineId = useDrawingStore((s) => s.selectedLineId);
  const selectedIds = useControlsStore((s) => s.selectedClipIds);
  // Inside a compound clip the toolbar has no Crop, Transform or Detach audio, as CapCut's.
  const inCompound = useClipStore((s) => s.compoundStack.length > 0);
  // A compound clip that needs its rendered file (a clean-up or audio tool is on) gets one made.
  useEffect(() => startCompoundRenderWatcher(), []);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target as HTMLElement).isContentEditable)
      ) {
        return;
      }

      // If the user has selected normal (non-input) text in the UI, prefer native
      // browser copy/cut behavior over timeline shortcut handling.
      const hasTextSelection = (() => {
        try {
          const sel = window.getSelection?.();
          if (!sel) return false;
          if (sel.isCollapsed) return false;
          // Ignore empty/whitespace-only selections.
          return sel.toString().trim().length > 0;
        } catch {
          return false;
        }
      })();

      // A window over the app (Settings, Shortcuts, …) has the keys.
      if (appWindowOpen()) return;

      const isMod = e.metaKey || e.ctrlKey;
      const controls = useControlsStore.getState();
      const clipsStore = useClipStore.getState();
      const drawingStore = useDrawingStore.getState();
      const selectedIds = controls.selectedClipIds || [];
      const selectedLineId = drawingStore.selectedLineId;
      const selectedMaskId = controls.selectedMaskId;
      // Which action the keys are (lib/keymap.ts; the Shortcuts window moves them).
      const action = actionFor(e);

      // Undo (⌘Z) and redo (⇧⌘Z, ⌘Y). A text field keeps these for its own typing (returned
      // above).
      if (action === "undo" || action === "redo") {
        e.preventDefault();
        if (action === "redo") redo();
        else undo();
        return;
      }

      // CapCut's timeline and player keys: Space, ⌘B, Q / W, M, N, P, arrows, Home / End, [ / ], …
      if (handleTimelineKey(e)) return;

      // Delete selected clips, lines, or masks
      if (action === "delete") {
        // Delete selected mask if it exists
        if (selectedMaskId && tool === "mask") {
          e.preventDefault();
          // Find the clip that has this mask
          const clipWithMask = clipsStore.clips.find((clip) => {
            if (clip.type !== "video" && clip.type !== "image") return false;
            const masks = (clip as any).masks || [];
            return masks.some((m: any) => m.id === selectedMaskId);
          });

          if (clipWithMask) {
            const currentMasks = (clipWithMask as any).masks || [];
            const updatedMasks = currentMasks.filter(
              (m: any) => m.id !== selectedMaskId,
            );
            clipsStore.updateClip(clipWithMask.clipId, { masks: updatedMasks });
          }

          controls.setSelectedMaskId(null);
          setIsOverMask(false);
          setIsMaskDragging(false);
          return;
        }

        // delete the selected line if it exists
        if (selectedLineId && selectedIds.length > 0) {
          e.preventDefault();
          // get the clip with the drawing type
          selectedIds.forEach((id) => {
            const clip = clipsStore.getClipById(id);
            if (clip?.type === "draw") {
              clipsStore.updateClip(id, {
                lines: clip.lines.filter(
                  (line) => line.lineId !== selectedLineId,
                ),
              });
            }
          });
          // update the clip to remove the line
          drawingStore.setSelectedLineId(null);
          return;
        }
        // A transition selected on the timeline (selecting it drops the clips' selection).
        if (controls.selectedTransitionId && selectedIds.length === 0) {
          e.preventDefault();
          removeTransition(controls.selectedTransitionId);
          return;
        }
        // A marker selected on the ruler (with no clips selected).
        if (controls.selectedMarkerId && selectedIds.length === 0) {
          e.preventDefault();
          clipsStore.removeMarker(controls.selectedMarkerId);
          controls.setSelectedMarkerId(null);
          return;
        }
        // With the magnet on, the main track closes up behind clips deleted from it.
        if (selectedIds.length > 0) {
          e.preventDefault();
          selectedIds.forEach((id) => clipsStore.removeClip(id));
          controls.clearSelection();
        }
        return;
      }

      // Copy
      if (action === "copy") {
        if (hasTextSelection) return;
        if (selectedIds.length > 0) {
          e.preventDefault();
          clipsStore.copyClips(selectedIds);
        }
        return;
      }

      // Cut
      if (action === "cut") {
        if (hasTextSelection) return;
        if (selectedIds.length > 0) {
          e.preventDefault();
          clipsStore.cutClips(selectedIds);
          controls.clearSelection();
        }
        return;
      }

      // Paste at current focus frame
      if (action === "paste") {
        e.preventDefault();
        const { focusFrame } = controls;
        clipsStore.pasteClips(focusFrame);
        return;
      }

      // Group (⌘G) and Ungroup (⇧⌘G)
      if (action === "group" || action === "ungroup") {
        e.preventDefault();
        // Ungroup takes the selection's groups apart; Group sticks two or more clips together.
        if (action === "ungroup") clipsStore.ungroupClips(controls.selectedClipIds || []);
        else clipsStore.groupClips(controls.selectedClipIds || []);
        return;
      }

      // Create compound clip (⌥G) from the selection; Undo compound clip (⌥⇧G) on a compound.
      if (action === "createCompound") {
        e.preventDefault();
        if ((controls.selectedClipIds || []).length > 0) clipsStore.createCompound(controls.selectedClipIds);
        return;
      }
      if (action === "breakApartCompound") {
        e.preventDefault();
        const selected = controls.selectedClipIds || [];
        if (selected.length === 1) clipsStore.breakApartCompound(selected[0]);
        return;
      }

      // The player's zoom keys (⌘0, ⌘5, ⌘1, ⌘2, ⌥⇧+ …) are the keymap's player actions,
      // handled with the timeline's above.
      const viewport = useViewportStore.getState();
      const key = e.key.toLowerCase();

      // In-mode selections using number keys (no modifiers)
      // Shape mode: the Shapes library's order, 1 rectangle … 7 arrow.
      if (!isMod && viewport.tool === "shape") {
        const pick = SHAPES[Number(key) - 1];
        if (/^[1-9]$/.test(key) && pick) {
          e.preventDefault();
          viewport.setShape(pick.id);
          return;
        }
      }

      // Mask mode: 1=Lasso, 2=Shape, 3=Draw
      if (!isMod && viewport.tool === "mask") {
        const maskStore = useMaskStore.getState();
        if (key === "1") {
          e.preventDefault();
          maskStore.setTool("lasso");
          return;
        }
        if (key === "2") {
          e.preventDefault();
          maskStore.setTool("shape");
          return;
        }
        if (key === "3") {
          e.preventDefault();
          maskStore.setTool("draw");
          return;
        }
      }

      // Tool switching (letters, no modifiers). CapCut draws no freehand lines, so there's no
      // draw tool (D); a project's drawings still show and can be selected, moved and deleted.
      if (!isMod) {
        if (key === "v") {
          e.preventDefault();
          viewport.setTool("pointer");
          return;
        }
        if (key === "h") {
          e.preventDefault();
          viewport.setTool("hand");
          return;
        }
        if (key === "t") {
          e.preventDefault();
          viewport.setTool("text");
          return;
        }
        // M is CapCut's Add marker (lib/timeline-shortcuts.ts); the mask tool is in the
        // preview's toolbar.
        if (key === "s") {
          e.preventDefault();
          viewport.setTool("shape");
          return;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [tool, selectedMaskId, selectedLineId, selectedIds]);
  return (
    <div data-testid="timeline-toolbar" className="relative flex items-center h-8 shrink-0 border-b-[0.5px] border-brand-hairline">
      <CompoundBar />
      <div className="flex items-center w-full justify-between px-2">
        {/* CapCut's order, left to right; Undo and Redo name themselves. Split stays
            right after Redo. */}
        <div className="flex items-center gap-x-2 [&>div]:h-7 [&>div]:w-7 [&>div]:py-0">
          <AddMenuButton />
          <SelectionToolMenu />
          <UndoButton />
          <RedoButton />
          <Tool title="Split" id="split"><SplitButton /></Tool>
          <Tool id="delete-left"><DeleteLeftButton /></Tool>
          <Tool id="delete-right"><DeleteRightButton /></Tool>
          <Tool title="Delete" id="delete"><TrashButton /></Tool>
          <Tool id="marker"><AddMarkerButton /></Tool>
          {!inCompound && (
            <>
              <Tool title="Crop" id="crop"><CropButton /></Tool>
              <TransformToolsMenu />
              <Tool title="Detach audio" id="detach"><SeparateButton /></Tool>
            </>
          )}
          <BeatButton />
        </div>
        <div className="flex items-center gap-x-2">
          <VoiceoverButton />
          <VoiceoverPanel />
          <MagnetToggle />
          <SnappingToggle />
          <LinkageToggle />
          <PreviewAxisToggle />
          <ToolbarDivider />
          <ZoomToFitButton />
          <TimelineZoom />
        </div>
      </div>
    </div>
  );
};

export default Controls;
