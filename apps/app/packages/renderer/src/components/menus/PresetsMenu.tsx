import React, { useEffect, useRef, useState } from "react";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { LuEllipsis, LuPlus, LuWandSparkles } from "react-icons/lu";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { applyPreset, useClipPresets } from "@/lib/clip-presets";
import { groupsIn, groupLabel } from "@/lib/clip-attributes";
import type { ClipPreset } from "@/lib/clip-preset-data";
import { cn } from "@/lib/utils";

/** What a preset tile carries when dragged (the timeline applies it to the clip it's let go on). */
export type PresetDrag = { type: "clip-preset"; id: string };

const menuSurface = "dark p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light";
const menuRow = "dark h-8 px-2.5 gap-2.5 rounded-[4px] text-[13px] cursor-pointer focus:bg-brand-hover";

/**
 * One saved preset, as the other libraries' tiles: an 86 px square with the frame it was saved
 * from (or a generic icon), its name under it. Clicked, or its "+" pressed, it goes onto the
 * selected clips; dragged onto a clip on the timeline, onto that one. A "⋯" menu renames or
 * deletes it.
 */
const PresetTile: React.FC<{ preset: ClipPreset }> = ({ preset }) => {
  const [hover, setHover] = useState(false);
  // The tile's buttons stay while its menu is open (the pointer is over the menu, not the tile).
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(preset.name);
  const input = useRef<HTMLInputElement>(null);
  const rename = useClipPresets((s) => s.rename);
  const remove = useClipPresets((s) => s.remove);
  const drag: PresetDrag = { type: "clip-preset", id: preset.id };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `clip-preset:${preset.id}`, data: drag });
  const own = (e: React.PointerEvent) => e.stopPropagation();
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== preset.name) rename(preset.id, draft);
    else setDraft(preset.name);
  };
  const groups = groupsIn(preset.attrs).map(groupLabel).join(", ");
  return (
    <div className="flex flex-col gap-1.5 w-[86px]" data-testid="preset-card">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        title={`${preset.name}: ${groups}`}
        data-testid="preset-tile"
        data-preset-id={preset.id}
        data-preset-name={preset.name}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn("relative w-[86px] h-[86px] rounded-[6px] bg-brand-background-light overflow-hidden cursor-pointer outline-none flex items-center justify-center", isDragging && "opacity-50")}
      >
        {preset.thumb ? <img src={preset.thumb} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" /> : <LuWandSparkles className="w-7 h-7 text-brand-light/70 pointer-events-none" />}
        {(hover || menuOpen) && !isDragging && (
          <>
            <div className="absolute right-1 top-1" onPointerDown={own}>
              <DropdownMenu onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={`${preset.name} menu`} data-testid="preset-menu" className="w-[18px] h-[18px] rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80">
                    <LuEllipsis className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className={menuSurface}>
                  <DropdownMenuItem
                    className={menuRow}
                    data-testid="preset-rename"
                    onSelect={() => {
                      setDraft(preset.name);
                      setEditing(true);
                    }}
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem className={menuRow} data-testid="preset-delete" onSelect={() => remove(preset.id)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <button
              type="button"
              title={`Apply ${preset.name} to the selected clips`}
              aria-label={`Apply ${preset.name}`}
              data-testid="preset-apply"
              onPointerDown={own}
              onClick={(e) => {
                e.stopPropagation();
                applyToSelection(preset);
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
          aria-label="Preset name"
          data-testid="preset-name-input"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(preset.name);
              setEditing(false);
            }
          }}
          className="h-[18px] w-full rounded-[3px] bg-brand px-1 text-[12px] text-brand-lighter outline-none"
        />
      ) : (
        <span className="text-[12px] leading-none truncate text-left text-[#949494]" data-testid="preset-name">
          {preset.name}
        </span>
      )}
    </div>
  );
};

/** A preset onto the selected clips; says so when there's nothing for it to go on. */
const applyToSelection = (preset: ClipPreset) => {
  const n = applyPreset(preset);
  if (n === 0) toast("Select a clip to apply the preset to");
};

/**
 * Media › Yours › My presets, as CapCut's: the clip presets saved from a clip's menu (Save
 * preset), kept in the user data folder, listed as tiles with the frame they were saved from.
 */
const PresetsMenu: React.FC = () => {
  const presets = useClipPresets((s) => s.presets);
  const load = useClipPresets((s) => s.load);
  useEffect(() => void load(), [load]);
  // A press let go where it began is a click (the app's drags start on a press and swallow it).
  useDndMonitor({
    onDragEnd: (e) => {
      const d = e.active?.data?.current as Partial<PresetDrag> | undefined;
      if (d?.type !== "clip-preset" || Math.hypot(e.delta.x, e.delta.y) > 3) return;
      const p = useClipPresets.getState().presets.find((x) => x.id === d.id);
      if (p) applyToSelection(p);
    },
  });
  return (
    <div className="h-full flex flex-col" data-testid="presets-view">
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col pl-3.5 pr-3 pt-4 pb-8 text-left">
          {presets.length === 0 ? (
            <p className="text-[12px] text-[#6c6c6c] leading-snug py-6 text-center" data-testid="presets-empty">
              Your presets will appear here. Right-click a clip and choose Save preset.
            </p>
          ) : (
            <div className="grid gap-x-4 gap-y-[18px]" style={{ gridTemplateColumns: "repeat(auto-fill, 86px)" }}>
              {presets.map((p) => (
                <PresetTile key={p.id} preset={p} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default PresetsMenu;
