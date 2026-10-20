import React, { useEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import { LuChevronDown, LuChevronLeft, LuChevronRight, LuChevronUp } from "react-icons/lu";
import { MdOutlineSubtitles, MdSubtitles } from "react-icons/md";
import { PiSlidersHorizontal, PiSlidersHorizontalFill } from "react-icons/pi";
import { RiDiscFill, RiDiscLine, RiMagicFill, RiMagicLine, RiVideoFill, RiVideoLine } from "react-icons/ri";
import { TbFilters, TbFiltersFilled, TbHourglassEmpty, TbHourglassFilled, TbSticker, TbTemplate, TbTextSize } from "react-icons/tb";
import { PanelShell, panelHeaderHandlers } from "./PanelShell";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/lib/sidebar";
import { useClipStore } from "@/lib/clip";
import { projectBlink, transitionCategories } from "@/lib/transitions";
import type { SidebarSection } from "@/lib/types";
import MediaMenu from "@/components/menus/MediaMenu";
import SubprojectsMenu from "../menus/SubprojectsMenu";
import FilterMenu, { filterSections, useFilters } from "../menus/FilterMenu";
import EffectsMenu, { effectSections } from "../menus/EffectsMenu";
import AdjustmentMenu, { adjustmentSections } from "../menus/AdjustmentMenu";
import { useEffectCatalog } from "@/lib/effects/catalog";
import TextMenu from "../menus/TextMenu";
import TransitionMenu from "../menus/TransitionMenu";
import ShapesMenu from "../menus/ShapesMenu";
import StickersMenu, { stickerSections } from "../menus/StickersMenu";
import AudioMenu, { audioSections } from "../menus/AudioMenu";
import PendingMenu, { type Pending } from "../menus/PendingMenu";
import StockLibraryMenu, { stockSections } from "../menus/StockLibraryMenu";
import CreditsView from "../menus/CreditsView";
import PresetsMenu from "../menus/PresetsMenu";
import TemplatesMenu, { templateSections } from "../menus/TemplatesMenu";
import CaptionsMenu, { captionTemplateSections } from "../menus/CaptionsMenu";
import { useAutoCaptionsFocus } from "@/lib/autocaptions";
import { useTranscript } from "@/lib/transcript";
import { PRESET_CATEGORIES } from "../menus/TextMenu";
import { TEMPLATE_SECTIONS } from "../menus/TextTemplatesMenu";

interface MediaModelPanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  /** In a window of its own (lib/panel-windows.ts). */
  detached?: boolean;
}

// Outline glyphs from open icon sets (Remix, Tabler, Phosphor, Material) chosen for their
// likeness to CapCut's tab row, each with a filled form for the selected tab, as CapCut does.
// Glyphs with no filled form fill their own outline.
const filled =
  (Icon: IconType): IconType =>
  (props) => <Icon {...props} fill="currentColor" />;
const turned =
  (Icon: IconType): IconType =>
  ({ className, ...props }) => <Icon {...props} className={cn(className, "rotate-90")} />;

/** The left panel's tabs, in CapCut's order. */
const TABS: { section: SidebarSection; title: string; icon: IconType; selectedIcon: IconType }[] = [
  { section: "media", title: "Media", icon: RiVideoLine, selectedIcon: RiVideoFill },
  { section: "audio", title: "Audio", icon: RiDiscLine, selectedIcon: RiDiscFill },
  { section: "text", title: "Text", icon: TbTextSize, selectedIcon: TbTextSize },
  { section: "stickers", title: "Stickers", icon: TbSticker, selectedIcon: filled(TbSticker) },
  { section: "effects", title: "Effects", icon: RiMagicLine, selectedIcon: RiMagicFill },
  { section: "transitions", title: "Transitions", icon: turned(TbHourglassEmpty), selectedIcon: turned(TbHourglassFilled) },
  { section: "captions", title: "Captions", icon: MdOutlineSubtitles, selectedIcon: MdSubtitles },
  { section: "filters", title: "Filters", icon: TbFilters, selectedIcon: TbFiltersFilled },
  { section: "adjustment", title: "Adjustment", icon: PiSlidersHorizontal, selectedIcon: PiSlidersHorizontalFill },
  { section: "templates", title: "Templates", icon: TbTemplate, selectedIcon: filled(TbTemplate) },
];

/**
 * Each tab's own column of sections, as CapCut has beside its libraries. Filters has Favorites and
 * its categories (FilterMenu's filterSections). A section under a heading (Media under Import)
 * folds with it.
 */
const SECTIONS: Partial<Record<SidebarSection, { id: string; label: string; under?: string }[]>> = {
  media: [
    { id: "local", label: "Media", under: "Import" },
    // CapCut's compound clips (subprojects) of the project.
    { id: "subprojects", label: "Subprojects", under: "Import" },
    // CapCut's Yours: the starred stock media and the clip presets saved from the timeline.
    { id: "yours:favorites", label: "Favorites", under: "Yours" },
    { id: "yours:presets", label: "My presets", under: "Yours" },
    // CapCut's stock library, from openly licensed sources (StockLibraryMenu).
    ...stockSections(),
  ],
  // Extracted, Voiceovers, Yours (Favorites, Imported), then the Music and Sound effects categories.
  audio: audioSections(),
  // CapCut's Text column: Add text, its presets by category, Local captions (the file import).
  text: [
    { id: "add", label: "Add text" },
    // The text styles saved from a text's Save as preset (kept in the user data folder).
    { id: "yours:presets", label: "Presets", under: "Yours" },
    ...PRESET_CATEGORIES.map((c) => ({ id: `presets:${c}`, label: c, under: "Presets" })),
    ...TEMPLATE_SECTIONS,
    { id: "captions", label: "Local captions" },
    { id: "animations", label: "Animations" },
  ],
  // CapCut's column without GIPHY (an online service): Favorites and the categories under
  // Stickers, then Shapes.
  stickers: [...stickerSections(), { id: "shapes", label: "Shapes" }],
  effects: [{ id: "effects", label: "Video effects" }],
  // CapCut's column without AI packaging and AI emojis: Auto captions (a local speech model),
  // Templates (the caption styles by kind), Auto lyrics, Transcript (the clip's words, to edit by),
  // Add captions (the file import).
  captions: [
    { id: "auto", label: "Auto captions" },
    ...captionTemplateSections,
    { id: "lyrics", label: "Auto lyrics" },
    { id: "transcript", label: "Transcript" },
    { id: "add", label: "Add captions" },
  ],
  adjustment: adjustmentSections,
  templates: templateSections(),
};

type SectionItem = { id: string; label: string; under?: string };

/**
 * A tab's column of sections, as CapCut's: 24 px items on a 32 px pitch. Top-level items and
 * group headings are filled; the selected item's label (and an open group's) is the accent.
 *
 * One group is open at a time: the one holding the selection, or the one last opened (opening a
 * folded group selects its Trending section, or its first; its heading folds it again). Everything down to the
 * open group's heading stays at the top and whatever follows the group stays at the bottom;
 * only the group's sections scroll between them, fading out at the edge where there's more.
 *
 * CapCut's column is 120 px, but its UI font is narrower than SF Pro: at 132 px every label we
 * have fits on one line ("Add adjustment", "Video effects" beside its chevron); a longer one ends
 * in an ellipsis rather than wrapping.
 */
const SectionNav: React.FC<{
  items: SectionItem[];
  value: string;
  onChange: (id: string) => void;
}> = ({ items, value, onChange }) => {
  const groupOf = (id: string) => items.find((it) => it.id === id)?.under ?? null;
  const [open, setOpen] = useState<string | null>(() => groupOf(value));
  // A selection made elsewhere (a default, the Audio tab's own links) opens its group.
  const selectedGroup = groupOf(value);
  useEffect(() => {
    if (selectedGroup) setOpen(selectedGroup);
  }, [selectedGroup]);

  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setFade({ top: el.scrollTop > 1, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [open]);
  // Keep the selected section in view when its group opens.
  useEffect(() => {
    listRef.current?.querySelector("[aria-pressed=true]")?.scrollIntoView({ block: "nearest" });
  }, [open, value]);

  const item = (it: SectionItem, child = false) => (
    <button
      key={it.id}
      type="button"
      data-testid={`assets-section-${it.id}`}
      aria-pressed={value === it.id}
      onClick={() => onChange(it.id)}
      title={it.label}
      className={cn(
        "w-full h-6 shrink-0 flex items-center px-2 rounded-[4px] text-[12px] font-semibold text-left whitespace-nowrap transition-colors cursor-pointer",
        value === it.id ? "bg-brand-background-light text-brand-accent" : child ? "text-brand-light hover:bg-brand-light/[0.04]" : "bg-brand-background-light text-brand-light hover:bg-brand-button",
      )}
    >
      <span className="min-w-0 truncate">{it.label}</span>
    </button>
  );
  const heading = (name: string, children: SectionItem[]) => {
    const isOpen = open === name;
    return (
      <button
        key={`group-${name}`}
        type="button"
        data-testid={`assets-group-${name}`}
        data-group-ids={JSON.stringify(children.map((c) => c.id))}
        aria-expanded={isOpen}
        onClick={() => {
          if (isOpen) return setOpen(null);
          setOpen(name);
          // As CapCut's libraries do, a group opens on its Trending section when it has one.
          const first = children.find((c) => c.label === "Trending") ?? children[0];
          if (!children.some((c) => c.id === value) && first) onChange(first.id);
        }}
        title={name}
        className={cn(
          "w-full h-6 shrink-0 flex items-center justify-between gap-1 pl-2 pr-1.5 rounded-[4px] text-[12px] font-semibold whitespace-nowrap bg-brand-background-light hover:bg-brand-button cursor-pointer",
          isOpen || children.some((c) => c.id === value) ? "text-brand-accent" : "text-brand-light",
        )}
      >
        <span className="min-w-0 truncate">{name}</span>
        {isOpen ? <LuChevronUp className="w-3 h-3 shrink-0" /> : <LuChevronDown className="w-3 h-3 shrink-0" />}
      </button>
    );
  };

  // Above the open group's sections (its heading included), the sections themselves, and below.
  const top: React.ReactNode[] = [];
  const middle: React.ReactNode[] = [];
  const bottom: React.ReactNode[] = [];
  const seen = new Set<string>();
  let past = false;
  for (const it of items) {
    const into = past ? bottom : top;
    if (!it.under) {
      into.push(item(it));
      continue;
    }
    if (seen.has(it.under)) continue;
    seen.add(it.under);
    const children = items.filter((g) => g.under === it.under);
    into.push(heading(it.under, children));
    if (open === it.under) {
      children.forEach((g) => middle.push(item(g, true)));
      past = true;
    }
  }
  const fadeMask =
    fade.top || fade.bottom
      ? `linear-gradient(to bottom, ${fade.top ? "transparent, black 24px" : "black"}, ${fade.bottom ? "black calc(100% - 32px), transparent" : "black"})`
      : undefined;
  return (
    <nav aria-label="Sections" className="w-[132px] shrink-0 flex flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-r-[0.5px] border-brand-hairline">
      <div className={cn("shrink-0 flex flex-col gap-2 px-2 pt-4", middle.length === 0 && bottom.length === 0 && "pb-4")}>{top}</div>
      {middle.length > 0 && (
        <div
          ref={listRef}
          style={fadeMask ? { maskImage: fadeMask, WebkitMaskImage: fadeMask } : undefined}
          className={cn("min-h-[56px] shrink flex flex-col gap-2 px-2 pt-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", bottom.length === 0 && "pb-4")}
        >
          {middle}
        </div>
      )}
      {bottom.length > 0 && <div className="shrink-0 flex flex-col gap-2 px-2 pt-2 pb-4">{bottom}</div>}
    </nav>
  );
};

/** The tab row's sideways scroll buttons, shown when the tabs don't fit (as CapCut's). */
const useOverflow = (ref: React.RefObject<HTMLElement | null>) => {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [ref]);
  return edges;
};

/**
 * The left panel: a row of tabs for what can go on the timeline (media, text, filters,
 * transitions, …), each with its column of sections beside the section's library.
 */
const MediaModelPanel: React.FC<MediaModelPanelProps> = ({
  id = "assets",
  order,
  defaultSize = 33,
  minSize = 20,
  maxSize,
  detached = false,
}) => {
  const section = useSidebarStore((s) => s.section) ?? "media";
  const openSection = useSidebarStore((s) => s.openSection);
  const [picked, setPicked] = useState<Partial<Record<SidebarSection, string>>>({});
  // The clip menu's Generate captions opens Auto captions (lib/autocaptions.ts).
  const autoFocus = useAutoCaptionsFocus((f) => f.tick);
  useEffect(() => {
    if (autoFocus > 0) setPicked((p) => ({ ...p, captions: useAutoCaptionsFocus.getState().kind === "lyrics" ? "lyrics" : "auto" }));
  }, [autoFocus]);
  // The clip menu's and the media card's Transcript opens its panel.
  const transcriptFocus = useTranscript((f) => f.tick);
  useEffect(() => {
    if (transcriptFocus > 0) setPicked((p) => ({ ...p, captions: "transcript" }));
  }, [transcriptFocus]);
  const tabsRef = useRef<HTMLElement | null>(null);
  const overflow = useOverflow(tabsRef);
  const scrollTabs = (dx: number) => tabsRef.current?.scrollBy({ left: dx, behavior: "smooth" });
  // Transitions' column is its categories under one heading, as CapCut's (Basic only when the
  // project has Blink's images).
  const blink = useClipStore((s) => projectBlink(s.clips));
  const filters = useFilters();
  const effectCatalog = useEffectCatalog();
  const sections =
    section === "transitions"
      ? [{ id: "favorites", label: "Favorites" }, ...transitionCategories(blink).map((c) => ({ id: c, label: c, under: "Transitions" }))]
      : section === "filters"
        ? filterSections(filters)
        : section === "effects"
          ? effectSections(effectCatalog)
          : SECTIONS[section];
  // Filters opens on Featured (Favorites is the first item, as CapCut's, but starts empty).
  // Effects opens on All, Stickers on Trending.
  const sub = picked[section] ?? (section === "filters" ? "cat:Featured" : section === "effects" ? "all" : section === "stickers" ? "cat:Trending" : section === "transitions" ? sections?.[1]?.id : sections?.[0]?.id) ?? "";

  const content = () => {
    switch (section) {
      case "media":
        if (sub === "subprojects") return <SubprojectsMenu />;
        if (sub === "yours:presets") return <PresetsMenu />;
        if (sub === "yours:favorites") return <StockLibraryMenu category="favorites" />;
        return sub === "library:credits" ? <CreditsView /> : sub.startsWith("library:") ? <StockLibraryMenu category={sub.slice(8)} /> : <MediaMenu />;
      case "filters":
        return <FilterMenu part={sub} />;
      case "effects":
        return <EffectsMenu part={sub} />;
      case "adjustment":
        return <AdjustmentMenu part={sub} />;
      case "text":
        return <TextMenu part={sub} />;
      case "captions":
        return <CaptionsMenu part={sub} />;
      case "transitions":
        return <TransitionMenu category={sub || undefined} />;
      case "stickers":
        return sub === "shapes" ? <ShapesMenu /> : <StickersMenu part={sub} />;
      case "audio":
        return <AudioMenu section={sub} onOpen={(v) => setPicked((p) => ({ ...p, audio: v }))} />;
      case "templates":
        return <TemplatesMenu part={sub} />;
      default:
        return <PendingMenu section={section as Pending} />;
    }
  };

  return (
    <PanelShell
      id={id}
      detached={detached}
      minSize={minSize}
      maxSize={maxSize}
      defaultSize={defaultSize}
      order={order}
      data-testid="assets"
      className="bg-brand-background rounded-lg overflow-hidden flex flex-col"
    >
      {/* The tab row on the panel's header strip; it scrolls sideways when the panel is
          narrower than the tabs, with buttons at the ends. Dragged out of the window, the
          panel goes into a window of its own (lib/panel-windows.ts). */}
      <div {...panelHeaderHandlers("assets", detached)} className="relative h-[42px] shrink-0 bg-brand-header border-b-[0.5px] border-brand-hairline">
        <nav
          ref={tabsRef}
          aria-label="Libraries"
          style={{ scrollbarWidth: "none" }}
          className="h-full flex items-stretch px-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map(({ section: s, title, icon, selectedIcon }) => {
            const Icon = section === s ? selectedIcon : icon;
            return (
            <button
              key={s}
              type="button"
              data-testid={`assets-tab-${s}`}
              aria-pressed={section === s}
              onClick={() => openSection(s)}
              className={cn(
                // CapCut's tabs are at least 49 px with ~10 px between the longest labels; SF Pro
                // is wider than its UI font, so a little more room each side keeps them apart.
                "shrink-0 min-w-[50px] flex flex-col items-center justify-center gap-[5px] px-[6px] transition-colors cursor-pointer",
                section === s ? "text-brand-accent" : "text-brand-light hover:text-brand-lighter",
              )}
            >
              <Icon className="w-[18px] h-[18px]" />
              <span className="text-[11px] font-semibold leading-none whitespace-nowrap">{title}</span>
            </button>
            );
          })}
        </nav>
        {overflow.left && (
          <button type="button" aria-label="Earlier tabs" onClick={() => scrollTabs(-160)} className="absolute left-1 top-1/2 -translate-y-1/2 w-3 h-[19px] rounded-[3px] bg-brand-button text-[#cccccc] flex items-center justify-center">
            <LuChevronLeft className="w-3 h-3" />
          </button>
        )}
        {overflow.right && (
          <button type="button" aria-label="More tabs" onClick={() => scrollTabs(160)} className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-[19px] rounded-[3px] bg-brand-button text-[#cccccc] flex items-center justify-center">
            <LuChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 flex">
        {sections && <SectionNav key={section} items={sections} value={sub} onChange={(v) => setPicked((p) => ({ ...p, [section]: v }))} />}
        <div data-testid="assets-content" className="flex-1 min-w-0 min-h-0">
          {content()}
        </div>
      </div>
    </PanelShell>
  );
};

export default MediaModelPanel;
