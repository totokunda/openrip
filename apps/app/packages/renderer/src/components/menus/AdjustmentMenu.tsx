import React, { useEffect, useRef, useState } from "react";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { LuImport, LuPlus, LuSlidersHorizontal, LuTrash2, LuBox } from "react-icons/lu";
import { pickMediaPaths } from "@app/preload";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useClipStore } from "@/lib/clip";
import {
  addAdjustmentLayer,
  addLutLayer,
  lutName,
  useAdjustmentLibrary,
  type AdjustmentDrag,
  type AdjustmentPreset,
  type ImportedLut,
} from "@/lib/adjustment";
import type { ClipColor } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The tab's column, as CapCut's: Add adjustment, Yours (the saved presets), LUT. */
export const adjustmentSections = [
  { id: "add", label: "Add adjustment" },
  { id: "yours", label: "Yours" },
  { id: "lut", label: "LUT" },
];

/**
 * One tile, as the other libraries': an 86 px rounded square, its name under it (the Custom
 * adjustment tile carries its name inside, as CapCut's). Clicked, what it makes is previewed in
 * the player (the project doesn't change); hovered, a round "+" (add a layer at the playhead)
 * sits at the bottom-right. Dragged onto the timeline, it lands as an adjustment layer.
 */
const Tile: React.FC<{
  drag: AdjustmentDrag;
  label: string;
  inside?: boolean;
  active: boolean;
  testId: string;
  onAdd: () => void;
  extra?: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ drag, label, inside, active, testId, onAdd, extra, icon }) => {
  const [hover, setHover] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `adjustment:${drag.kind}:${drag.id}`, data: drag });
  // The buttons keep their own presses (a press on the tile starts its drag).
  const own = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className="flex flex-col gap-1.5 w-[86px]" data-testid={`${testId}-card`}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        title={label}
        data-testid={testId}
        data-adjustment={drag.id}
        aria-pressed={active}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn(
          "relative w-[86px] h-[86px] rounded-[6px] bg-brand-background-light overflow-hidden cursor-pointer outline-none flex items-center justify-center",
          active && "ring-[1.5px] ring-brand-accent",
          isDragging && "opacity-50",
        )}
      >
        {inside ? (
          <span className="px-2 text-center text-[12px] leading-[17px] text-brand-light pointer-events-none">{label}</span>
        ) : (
          <span className="text-brand-light/70 pointer-events-none">{icon}</span>
        )}
        {hover && !isDragging && (
          <div className="absolute right-1 bottom-1 flex items-center gap-1">
            {extra}
            <button
              type="button"
              title={`Add ${label}`}
              aria-label={`Add ${label}`}
              data-testid="adjustment-add"
              onPointerDown={own}
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
              className="w-[18px] h-[18px] rounded-full bg-brand-accent text-white flex items-center justify-center hover:bg-brand-accent-shade"
            >
              <LuPlus className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      {!inside && <span className={cn("text-[12px] leading-none truncate text-left", active ? "text-brand-light" : "text-[#949494]")}>{label}</span>}
    </div>
  );
};

const Grid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid gap-x-4 gap-y-[18px]" style={{ gridTemplateColumns: "repeat(auto-fill, 86px)" }}>
    {children}
  </div>
);

/** The LUTs on offer: the ones imported here, then the ones the project's clips use. */
const useLuts = (): ImportedLut[] => {
  const imported = useAdjustmentLibrary((s) => s.luts);
  const clips = useClipStore((s) => s.clips);
  const out = [...imported];
  for (const c of clips) {
    const l = (c as { color?: ClipColor }).color?.lut;
    if (l?.path && !out.some((x) => x.path === l.path)) out.push({ path: l.path, name: l.name ?? lutName(l.path) });
  }
  return out;
};

/** Import .cube files (or Hald CLUT pictures) into the tab's list. */
export const importLuts = async () => {
  const paths = await pickMediaPaths({ title: "Import a LUT", filters: [{ name: "LUTs", extensions: ["cube", "png", "jpg"] }] });
  for (const path of paths ?? []) useAdjustmentLibrary.getState().addLut({ path, name: lutName(path) });
};

/**
 * The Adjustment tab, in CapCut's layout: "Add adjustment" has the Custom adjustment tile (an
 * adjustment layer with nothing set); "Yours" lists the Adjust settings the user saved as
 * presets (the layer's Save as preset); "LUT" lists the imported LUTs, each adding a layer
 * with that LUT. A click on a tile (a press let go where it began; the app's drags start on a
 * press and swallow the click) previews it; "+" adds it.
 */
const AdjustmentMenu: React.FC<{ part?: string }> = ({ part = "add" }) => {
  const presets = useAdjustmentLibrary((s) => s.presets);
  const preview = useAdjustmentLibrary((s) => s.preview);
  const setPreview = useAdjustmentLibrary((s) => s.setPreview);
  const deletePreset = useAdjustmentLibrary((s) => s.deletePreset);
  const luts = useLuts();

  // A preview lasts while the tab shows.
  useEffect(() => () => useAdjustmentLibrary.getState().setPreview(null), []);

  const previewRef = useRef(preview);
  previewRef.current = preview;
  const colorOfDrag = (d: AdjustmentDrag): { name: string; color: ClipColor } | null => {
    if (d.kind === "preset") {
      const p = useAdjustmentLibrary.getState().presets.find((x) => x.id === d.id);
      return p ? { name: p.name, color: p.color } : null;
    }
    if (d.kind === "lut") return { name: lutName(d.id), color: { lut: { path: d.id, name: lutName(d.id), intensity: 100 } } };
    return null;
  };
  useDndMonitor({
    onDragEnd: (e) => {
      const d = e.active?.data?.current as Partial<AdjustmentDrag> | undefined;
      if (d?.type !== "adjustment-tile" || !d.kind || !d.id || Math.hypot(e.delta.x, e.delta.y) > 3) return;
      const next = colorOfDrag(d as AdjustmentDrag);
      if (!next) return;
      const now = previewRef.current;
      setPreview(now && JSON.stringify(now.color) === JSON.stringify(next.color) ? null : next);
    },
  });
  const active = (c: ClipColor) => !!preview && JSON.stringify(preview.color) === JSON.stringify(c);

  const addPreset = (p: AdjustmentPreset) => void addAdjustmentLayer({ color: p.color, name: p.name });

  return (
    <div className="h-full flex flex-col" data-testid="adjustment-view">
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col pl-3.5 pr-3 pt-4 pb-8 text-left">
          {part === "add" && (
            <Grid>
              <Tile
                drag={{ type: "adjustment-tile", kind: "custom", id: "custom" }}
                label="Custom adjustment"
                inside
                active={false}
                testId="adjustment-custom"
                onAdd={() => void addAdjustmentLayer()}
              />
            </Grid>
          )}
          {part === "yours" &&
            (presets.length === 0 ? (
              <p className="text-[12px] text-[#6c6c6c] leading-snug py-6 text-center" data-testid="adjustment-yours-empty">
                Your presets will appear here. Set up an adjustment layer and choose Save as preset.
              </p>
            ) : (
              <Grid>
                {presets.map((p) => (
                  <Tile
                    key={p.id}
                    drag={{ type: "adjustment-tile", kind: "preset", id: p.id }}
                    label={p.name}
                    active={active(p.color)}
                    testId="adjustment-preset"
                    icon={<LuSlidersHorizontal className="w-7 h-7" />}
                    onAdd={() => addPreset(p)}
                    extra={
                      <button
                        type="button"
                        title={`Delete ${p.name}`}
                        aria-label={`Delete ${p.name}`}
                        data-testid="adjustment-preset-delete"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          deletePreset(p.id);
                        }}
                        className="w-[18px] h-[18px] rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                      >
                        <LuTrash2 className="w-2.5 h-2.5" />
                      </button>
                    }
                  />
                ))}
              </Grid>
            ))}
          {part === "lut" && (
            <>
              <button
                type="button"
                data-testid="adjustment-lut-import"
                onClick={() => void importLuts()}
                className="self-start h-[26px] px-3 mb-4 rounded-[4px] bg-brand-background-light hover:bg-brand-button flex items-center gap-1.5 text-[12px] text-brand-light"
              >
                <LuImport className="w-3.5 h-3.5" />
                Import
              </button>
              {luts.length === 0 ? (
                <p className="text-[12px] text-[#6c6c6c] leading-snug py-2" data-testid="adjustment-lut-empty">
                  No LUTs yet. Import a .cube file to use it on an adjustment layer.
                </p>
              ) : (
                <Grid>
                  {luts.map((l) => (
                    <Tile
                      key={l.path}
                      drag={{ type: "adjustment-tile", kind: "lut", id: l.path }}
                      label={l.name}
                      active={active({ lut: { path: l.path, name: l.name, intensity: 100 } })}
                      testId="adjustment-lut"
                      icon={<LuBox className="w-7 h-7" />}
                      onAdd={() => void addLutLayer(l)}
                    />
                  ))}
                </Grid>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default AdjustmentMenu;
