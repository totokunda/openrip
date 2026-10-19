import React, { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { LuEllipsis, LuLayers, LuPlus } from "react-icons/lu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { allClips, contentLength, isCompound, type CompoundClip } from "@/lib/compound";
import { addCompoundInstance, openCompound, renameCompound } from "@/lib/compound-edit";
import { paintCompoundStrip } from "@/lib/compound-thumb";
import { TIMELINE_COLORS } from "@/lib/timeline-colors";
import { cn } from "@/lib/utils";

/** What a subproject tile carries when dragged: the timeline adds another instance of the compound where it's let go. */
export type SubprojectDrag = { type: "subproject"; clipId: string };

const menuSurface = "dark p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light";
const menuRow = "dark h-8 px-2.5 gap-2.5 rounded-[4px] text-[13px] cursor-pointer focus:bg-brand-hover";

/** "0:05" / "1:02:03": a length in frames, as the Media tab's cards show durations. */
const lengthOf = (frames: number, fps: number) => {
  const s = Math.max(0, Math.round(frames / Math.max(1, fps)));
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
};

/** A compound's picture: its content's first poster (the strip painter at one tile), or a plain tile while there is none. */
const Poster: React.FC<{ clip: CompoundClip }> = ({ clip }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = 172;
    c.height = 172;
    const paint = () => paintCompoundStrip(c, clip.compound, 0, contentLength(clip.compound), 172, TIMELINE_COLORS.video, paint);
    paint();
  }, [clip.compound]);
  return <canvas ref={canvas} className="w-full h-full pointer-events-none" />;
};

/**
 * One subproject (a compound clip of the project): an 86 px tile with a picture from its content
 * and its length, its name under it. Its "+" adds another instance at the playhead, dragging it
 * onto the timeline adds one there, and its menu renames it or opens its timeline.
 */
const SubprojectTile: React.FC<{ clip: CompoundClip; fps: number }> = ({ clip, fps }) => {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const name = clip.name ?? "Compound clip";
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const drag: SubprojectDrag = { type: "subproject", clipId: clip.clipId };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `subproject:${clip.clipId}`, data: drag });
  const own = (e: React.PointerEvent) => e.stopPropagation();
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) renameCompound(clip.clipId, draft);
    else setDraft(name);
  };
  return (
    <div className="flex flex-col gap-1.5 w-[86px]" data-testid="subproject-card">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        title={name}
        data-testid="subproject-tile"
        data-clip-id={clip.clipId}
        data-subproject-name={name}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn("relative w-[86px] h-[86px] rounded-[6px] bg-brand-background-light overflow-hidden cursor-pointer outline-none flex items-center justify-center", isDragging && "opacity-50")}
      >
        <Poster clip={clip} />
        <LuLayers className="absolute left-1 top-1 w-3.5 h-3.5 text-white/80 drop-shadow pointer-events-none" />
        <span className="absolute left-1 bottom-1 px-1 rounded-[3px] bg-black/60 text-[10px] leading-[14px] text-white pointer-events-none" data-testid="subproject-length">
          {lengthOf(contentLength(clip.compound), fps)}
        </span>
        {(hover || menuOpen) && !isDragging && (
          <>
            <div className="absolute right-1 top-1" onPointerDown={own}>
              <DropdownMenu onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={`${name} menu`} data-testid="subproject-menu" className="w-[18px] h-[18px] rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80">
                    <LuEllipsis className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className={menuSurface}>
                  <DropdownMenuItem
                    className={menuRow}
                    data-testid="subproject-rename"
                    onSelect={() => {
                      setDraft(name);
                      setEditing(true);
                    }}
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem className={menuRow} data-testid="subproject-open" onSelect={() => void openCompound(clip.clipId)}>
                    Open
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <button
              type="button"
              title={`Add ${name} at the playhead`}
              aria-label={`Add ${name}`}
              data-testid="subproject-add"
              onPointerDown={own}
              onClick={(e) => {
                e.stopPropagation();
                addCompoundInstance(clip.clipId);
              }}
              className="absolute right-1 bottom-1 w-[18px] h-[18px] rounded-full bg-brand-accent text-white flex items-center justify-center hover:bg-brand-accent-shade"
            >
              <LuPlus className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
      {editing ? (
        <input
          ref={input}
          value={draft}
          aria-label="Subproject name"
          data-testid="subproject-name-input"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
          className="h-[18px] w-full rounded-[3px] bg-brand px-1 text-[12px] text-brand-lighter outline-none"
        />
      ) : (
        <span className="text-[12px] leading-none truncate text-left text-[#949494]" data-testid="subproject-name">
          {name}
        </span>
      )}
    </div>
  );
};

/**
 * Media › Import › Subprojects, as CapCut's: the project's compound clips (including those
 * inside others) as tiles. A subproject isn't a file: it lives in the project, so what's listed
 * is what the timeline being edited holds.
 */
const SubprojectsMenu: React.FC = () => {
  const clips = useClipStore((s) => s.clips);
  const fps = useControlsStore((s) => s.fps) || 30;
  const compounds = allClips(clips).filter(isCompound);
  return (
    <div className="h-full flex flex-col" data-testid="subprojects-view">
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col pl-3.5 pr-3 pt-4 pb-8 text-left">
          {compounds.length === 0 ? (
            <p className="text-[12px] text-[#6c6c6c] leading-snug py-6 text-center" data-testid="subprojects-empty">
              Your subprojects will appear here. Select clips on the timeline and choose Create compound clip.
            </p>
          ) : (
            <div className="grid gap-x-4 gap-y-[18px]" style={{ gridTemplateColumns: "repeat(auto-fill, 86px)" }}>
              {compounds.map((c) => (
                <SubprojectTile key={c.clipId} clip={c} fps={fps} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default SubprojectsMenu;
