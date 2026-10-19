import React from "react";
import { LuPlus } from "react-icons/lu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TEXT_PRESETS, addPresetText, type TextPreset } from "@/lib/text-presets";
import { applyAnimation } from "@/components/properties/AnimationProperties";
import { AnimationPreview } from "@/components/motion/Previews";
import { animationsFor } from "@/lib/animations";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { useInspectorStore } from "@/lib/inspector";
import { AssetSection, AssetTile } from "./AssetSection";
import { LuSearch } from "react-icons/lu";
import { textPreset } from "@/lib/text-presets";
import { cn } from "@/lib/utils";
import TextLook from "./TextLook";
import CaptionsMenu from "./CaptionsMenu";
import TextTemplatesMenu from "./TextTemplatesMenu";

/** The column's preset categories ("presets:<category>"), as CapCut lists its text effects'. */
export const PRESET_CATEGORIES = ["All", "Basic", "Title", "Caption", "Style"] as const;

/** What a preset tile carries when dragged (native drag and drop, so the tile is its own ghost). */
const DRAG_TYPE = "application/x-openrip-text-preset";

/** Where a dragged preset can be let go: the timeline or the player. */
const dropZone = (target: EventTarget | null) => (target as Element | null)?.closest?.("[data-testid=timeline], [data-testid=player]") ?? null;

/**
 * A preset let go over the timeline or the player is added at the playhead, as a click adds
 * it. Listens while the Text tab shows.
 */
const usePresetDrop = () =>
  React.useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(DRAG_TYPE) && dropZone(e.target)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const drop = (e: DragEvent) => {
      const preset = e.dataTransfer?.types.includes(DRAG_TYPE) ? textPreset(e.dataTransfer.getData(DRAG_TYPE)) : undefined;
      if (!preset || !dropZone(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      void addPresetText(preset);
    };
    document.addEventListener("dragover", over, true);
    document.addEventListener("drop", drop, true);
    return () => {
      document.removeEventListener("dragover", over, true);
      document.removeEventListener("drop", drop, true);
    };
  }, []);

/**
 * A library tile as CapCut's (docs/plan/capcut-ui-spec.md §4.5): 86×86 on `bg.raised`, its
 * name under it; hovered, a "+" at the bottom-right. Clicked, or dragged onto the timeline or
 * the player, its preset is added at the playhead.
 */
const PresetTile: React.FC<{ preset: TextPreset; label?: string; testId?: string; children: React.ReactNode }> = ({ preset, label, testId, children }) => (
  <div className="flex flex-col gap-1.5 min-w-0 w-[86px]">
    <button
      type="button"
      draggable
      data-testid={testId ?? `text-preset-${preset.id}`}
      title={`${label ?? preset.name}: click or drag onto the timeline to add`}
      aria-label={`Add ${label ?? preset.name}`}
      onClick={() => addPresetText(preset)}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, preset.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="group relative w-[86px] h-[86px] rounded-[6px] bg-brand-background-light hover:bg-brand-button flex items-center justify-center overflow-hidden px-1.5 transition-colors cursor-pointer"
    >
      {children}
      <span className="absolute right-1 bottom-1 w-[18px] h-[18px] rounded-full bg-black/55 text-white items-center justify-center hidden group-hover:flex">
        <LuPlus className="w-3 h-3" />
      </span>
    </button>
    {label !== "" && <span className="text-[12px] leading-none text-[#949494] truncate text-left">{label ?? preset.name}</span>}
  </div>
);

/**
 * The Text tab, in CapCut's layout (its column: Add text, Presets ▸ categories, Local
 * captions): "add" is the default text, "presets:<category>" the presets grid
 * (lib/text-presets.ts, drawn by the app), "captions" the caption file import; "animations"
 * gives the selected text one of the In animations the Animation tab offers.
 */
const TextMenu: React.FC<{ part?: string }> = ({ part = "add" }) => {
  const lastSelected = useControlsStore((s) => s.selectedClipIds[s.selectedClipIds.length - 1]);
  const clip = useClipStore((s) => s.getClipById(lastSelected));
  const selectedText = clip?.type === "text" ? clip : null;
  const current = selectedText?.animationIn?.type ?? null;
  const [query, setQuery] = React.useState("");
  usePresetDrop();

  // CapCut's single "Default text" tile: where texts are added (the player has no tool row),
  // so it says how.
  const add = (
    <div className="flex flex-col gap-3" data-testid="add-text-view">
      <PresetTile preset={TEXT_PRESETS[0]} label="" testId="add-text">
        <span className="text-[13px] text-brand-light">Default text</span>
      </PresetTile>
      <p className="text-[12px] leading-snug text-[#949494] text-left">Click it, or drag it onto the timeline, to add a text at the playhead; Presets has styled ones. T lets you click the canvas to place one.</p>
    </div>
  );

  const category = part.startsWith("presets:") ? part.slice("presets:".length) : "All";
  const q = query.trim().toLowerCase();
  const presets = TEXT_PRESETS.filter((p) => (category === "All" || p.category === category) && (!q || p.name.toLowerCase().includes(q)));
  const styles = (
    <div className="flex flex-col gap-3" data-testid="text-presets">
      <label className="h-[26px] flex flex-row items-center gap-1.5 px-2.5 rounded-[4px] bg-brand border border-transparent focus-within:border-[#515151]">
        <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
        <input
          data-testid="text-presets-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search text presets"
          className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-lighter placeholder:text-[#6c6c6c] outline-none"
        />
      </label>
      <h3 className="text-[12px] text-brand-light text-left">{category}</h3>
      <div className={cn("grid gap-x-4 gap-y-[24px]")} style={{ gridTemplateColumns: "repeat(auto-fill, 86px)" }}>
        {presets.map((p) => (
          <PresetTile key={p.id} preset={p}>
            <TextLook look={p.props} text={p.props.text === "Default Text" || !p.props.text ? "Text" : p.props.text} size={20} />
          </PresetTile>
        ))}
      </div>
      {!presets.length && <p className="text-[12px] text-[#6c6c6c] py-6">No presets match “{query}”</p>}
    </div>
  );

  const animations = (
    <AssetSection
      title="Animations"
      note={selectedText ? "An In animation for the selected text. Its duration is in the Animation tab." : "Select a text on the timeline to animate it."}
    >
      {animationsFor("text", "in").map((a) => (
        <AssetTile
          key={a.type}
          label={a.name}
          testId={`text-animation-${a.type}`}
          active={current === a.type}
          disabled={!selectedText}
          onClick={() => {
            if (!selectedText) return;
            applyAnimation(selectedText.clipId, "in", a.type);
            useInspectorStore.getState().setTab("animation", "in");
          }}
        >
          <div className="relative w-full h-full">
            <AnimationPreview subject="text" kind="in" type={a.type} direction={a.params?.[0]?.default} playing={current === a.type} />
          </div>
        </AssetTile>
      ))}
    </AssetSection>
  );

  // Local captions: the caption file import, as Captions ▸ Add captions has it.
  if (part === "captions") return <CaptionsMenu part="add" />;
  if (part.startsWith("templates:")) return <TextTemplatesMenu part={part} />;
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-3 pb-8">{part === "animations" ? animations : part === "add" ? add : styles}</div>
    </ScrollArea>
  );
};

export default TextMenu;
