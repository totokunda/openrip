import React, { useEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuFilm,
  LuMusic,
  LuType,
  LuSticker,
  LuSparkles,
  LuArrowLeftRight,
  LuCaptions,
  LuSlidersHorizontal,
  LuLayoutTemplate,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuChevronUp,
} from "react-icons/lu";
import { MdPhotoFilter } from "react-icons/md";
import { PanelShell, panelHeaderHandlers } from "./PanelShell";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/lib/sidebar";
import { useClipStore } from "@/lib/clip";
import { projectBlink, transitionCategories } from "@/lib/transitions";
import type { SidebarSection } from "@/lib/types";
import MediaMenu from "@/components/menus/MediaMenu";
import FilterMenu, { filterSections, useFilters } from "../menus/FilterMenu";
import EffectsMenu, { effectSections } from "../menus/EffectsMenu";
import { useEffectCatalog } from "@/lib/effects/catalog";
import TextMenu from "../menus/TextMenu";
import TransitionMenu from "../menus/TransitionMenu";
import ShapesMenu from "../menus/ShapesMenu";
import StickersMenu, { stickerSections } from "../menus/StickersMenu";
import AudioMenu, { type AudioSection } from "../menus/AudioMenu";
import PendingMenu, { type Pending } from "../menus/PendingMenu";
import CaptionsMenu from "../menus/CaptionsMenu";
import { useAutoCaptionsFocus } from "@/lib/autocaptions";
import { PRESET_CATEGORIES } from "../menus/TextMenu";

interface MediaModelPanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  /** In a window of its own (lib/panel-windows.ts). */
  detached?: boolean;
}

/** The left panel's tabs, in CapCut's order. */
const TABS: { section: SidebarSection; title: string; icon: IconType }[] = [
  { section: "media", title: "Media", icon: LuFilm },
  { section: "audio", title: "Audio", icon: LuMusic },
  { section: "text", title: "Text", icon: LuType },
  { section: "stickers", title: "Stickers", icon: LuSticker },
  { section: "effects", title: "Effects", icon: LuSparkles },
  { section: "transitions", title: "Transitions", icon: LuArrowLeftRight },
  { section: "captions", title: "Captions", icon: LuCaptions },
  { section: "filters", title: "Filters", icon: MdPhotoFilter },
  { section: "adjustment", title: "Adjustment", icon: LuSlidersHorizontal },
  { section: "templates", title: "Templates", icon: LuLayoutTemplate },
];

/**
 * Each tab's own column of sections, as CapCut has beside its libraries. Filters has Favorites and
 * its categories (FilterMenu's filterSections). A section under a heading (Media under Import)
 * folds with it.
 */
const SECTIONS: Partial<Record<SidebarSection, { id: string; label: string; under?: string }[]>> = {
  media: [
    { id: "local", label: "Media", under: "Import" },
    { id: "library", label: "Library" },
  ],
  audio: [
    { id: "extracted", label: "Extracted" },
    { id: "voiceovers", label: "Voiceovers" },
    { id: "music", label: "Music" },
    { id: "sounds", label: "Sound effects" },
  ],
  // CapCut's Text column: Add text, its presets by category, Local captions (the file import).
  text: [
    { id: "add", label: "Add text" },
    ...PRESET_CATEGORIES.map((c) => ({ id: `presets:${c}`, label: c, under: "Presets" })),
    { id: "captions", label: "Local captions" },
    { id: "animations", label: "Animations" },
  ],
  // CapCut's column without GIPHY (an online service): Favorites and the categories under
  // Stickers, then Shapes.
  stickers: [...stickerSections(), { id: "shapes", label: "Shapes" }],
  effects: [{ id: "effects", label: "Video effects" }],
  // CapCut's column without AI packaging and AI emojis: Auto captions (a local speech model),
  // Templates, Auto lyrics, Add captions (the file import).
  captions: [
    { id: "auto", label: "Auto captions" },
    { id: "templates", label: "Templates" },
    { id: "lyrics", label: "Auto lyrics" },
    { id: "add", label: "Add captions" },
  ],
  adjustment: [{ id: "adjustment", label: "Adjustment" }],
  templates: [{ id: "templates", label: "Templates" }],
};

/**
 * A tab's column of sections, as CapCut's: 24 px items on a 32 px pitch. Top-level items and
 * group headings are filled; the selected item's label (and an open group's) is the accent.
 */
const SectionNav: React.FC<{
  items: { id: string; label: string; under?: string }[];
  value: string;
  onChange: (id: string) => void;
}> = ({ items, value, onChange }) => {
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const item = (it: { id: string; label: string }, child = false) => (
    <button
      key={it.id}
      type="button"
      data-testid={`assets-section-${it.id}`}
      aria-pressed={value === it.id}
      onClick={() => onChange(it.id)}
      className={cn(
        "w-full h-6 shrink-0 flex items-center px-2.5 rounded-[4px] text-[12px] font-semibold text-left truncate transition-colors cursor-pointer",
        value === it.id ? "bg-brand-background-light text-brand-accent" : child ? "text-brand-light hover:bg-brand-light/[0.04]" : "bg-brand-background-light text-brand-light hover:bg-brand-button",
      )}
    >
      {it.label}
    </button>
  );
  const out: React.ReactNode[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.under) {
      out.push(item(it));
      continue;
    }
    if (seen.has(it.under)) continue;
    seen.add(it.under);
    const heading = it.under;
    const open = !folded[heading];
    out.push(
      <button
        key={`group-${heading}`}
        type="button"
        onClick={() => setFolded((f) => ({ ...f, [heading]: open }))}
        className={cn(
          "w-full h-6 shrink-0 flex items-center justify-between px-2.5 rounded-[4px] text-[12px] font-semibold bg-brand-background-light hover:bg-brand-button cursor-pointer",
          open ? "text-brand-accent" : "text-brand-light",
        )}
      >
        {heading}
        {open ? <LuChevronUp className="w-3 h-3" /> : <LuChevronDown className="w-3 h-3" />}
      </button>,
    );
    if (open) items.filter((g) => g.under === heading).forEach((g) => out.push(item(g, true)));
  }
  return (
    <nav aria-label="Sections" className="w-[120px] shrink-0 flex flex-col gap-2 px-2 pt-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-r-[0.5px] border-brand-hairline">
      {out}
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
      ? transitionCategories(blink).map((c) => ({ id: c, label: c, under: "Transitions" }))
      : section === "filters"
        ? filterSections(filters)
        : section === "effects"
          ? effectSections(effectCatalog)
          : SECTIONS[section];
  // Filters opens on All (Favorites is the first item, as CapCut's, but starts empty).
  // Filters and Effects open on All, Stickers on Trending.
  const sub = picked[section] ?? (section === "filters" || section === "effects" ? "all" : section === "stickers" ? "cat:Trending" : sections?.[0]?.id) ?? "";

  const content = () => {
    switch (section) {
      case "media":
        return sub === "library" ? <PendingMenu section="library" /> : <MediaMenu />;
      case "filters":
        return <FilterMenu part={sub} />;
      case "effects":
        return <EffectsMenu part={sub} />;
      case "text":
        return <TextMenu part={sub} />;
      case "captions":
        return <CaptionsMenu part={sub} />;
      case "transitions":
        return <TransitionMenu category={sub || undefined} />;
      case "stickers":
        return sub === "shapes" ? <ShapesMenu /> : <StickersMenu part={sub} />;
      case "audio":
        return <AudioMenu section={sub as AudioSection} />;
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
          {TABS.map(({ section: s, title, icon: Icon }) => (
            <button
              key={s}
              type="button"
              data-testid={`assets-tab-${s}`}
              aria-pressed={section === s}
              onClick={() => openSection(s)}
              className={cn(
                "shrink-0 min-w-[49px] flex flex-col items-center justify-center gap-1 px-1 transition-colors cursor-pointer",
                section === s ? "text-brand-accent" : "text-brand-light hover:text-brand-lighter",
              )}
            >
              <Icon className="w-[17px] h-[17px]" />
              <span className="text-[12px] font-medium leading-none whitespace-nowrap">{title}</span>
            </button>
          ))}
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
        {sections && <SectionNav items={sections} value={sub} onChange={(v) => setPicked((p) => ({ ...p, [section]: v }))} />}
        <div data-testid="assets-content" className="flex-1 min-w-0 min-h-0">
          {content()}
        </div>
      </div>
    </PanelShell>
  );
};

export default MediaModelPanel;
