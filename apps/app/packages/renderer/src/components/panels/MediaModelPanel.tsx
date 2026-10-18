import React, { useState } from "react";
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
  LuChevronRight,
} from "react-icons/lu";
import { MdPhotoFilter } from "react-icons/md";
import { ResizablePanel } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/lib/sidebar";
import type { SidebarSection } from "@/lib/types";
import MediaMenu from "@/components/menus/MediaMenu";
import FilterMenu from "../menus/FilterMenu";
import TextMenu from "../menus/TextMenu";
import TransitionMenu from "../menus/TransitionMenu";
import PendingMenu, { type Pending } from "../menus/PendingMenu";

interface MediaModelPanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
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
 * Each tab's own column of sections, as CapCut has beside its libraries. Filters has its
 * categories in its own column (FilterMenu). A section under a heading (Media under Import)
 * folds with it.
 */
const SECTIONS: Partial<Record<SidebarSection, { id: string; label: string; under?: string }[]>> = {
  media: [
    { id: "local", label: "Media", under: "Import" },
    { id: "library", label: "Library" },
  ],
  audio: [
    { id: "music", label: "Music" },
    { id: "sounds", label: "Sound effects" },
  ],
  text: [
    { id: "styles", label: "Add text" },
    { id: "animations", label: "Animations" },
  ],
  stickers: [{ id: "stickers", label: "Stickers" }],
  effects: [{ id: "effects", label: "Video effects" }],
  transitions: [{ id: "transitions", label: "Transitions" }],
  captions: [{ id: "captions", label: "Captions" }],
  adjustment: [{ id: "adjustment", label: "Adjustment" }],
  templates: [{ id: "templates", label: "Templates" }],
};

/** A tab's column of sections. */
const SectionNav: React.FC<{
  items: { id: string; label: string; under?: string }[];
  value: string;
  onChange: (id: string) => void;
}> = ({ items, value, onChange }) => {
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const item = (it: { id: string; label: string }, indent = false) => (
    <button
      key={it.id}
      type="button"
      data-testid={`assets-section-${it.id}`}
      aria-pressed={value === it.id}
      onClick={() => onChange(it.id)}
      className={cn(
        "w-full h-7 flex items-center rounded-[6px] text-[12px] text-left truncate transition-colors cursor-pointer",
        indent ? "pl-6 pr-2" : "px-2",
        value === it.id ? "bg-brand-light/[0.08] text-brand-light" : "text-brand-light/60 hover:text-brand-light hover:bg-brand-light/[0.04]",
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
      <div key={`group-${heading}`} className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => setFolded((f) => ({ ...f, [heading]: open }))}
          className="w-full h-7 flex items-center gap-1 px-1.5 rounded-[6px] text-[12px] text-brand-light/80 hover:text-brand-light cursor-pointer"
        >
          {open ? <LuChevronDown className="w-3.5 h-3.5" /> : <LuChevronRight className="w-3.5 h-3.5" />}
          {heading}
        </button>
        {open && items.filter((g) => g.under === heading).map((g) => item(g, true))}
      </div>,
    );
  }
  return <nav aria-label="Sections" className="w-[110px] shrink-0 flex flex-col gap-0.5 p-1.5 border-r border-brand-light/[0.06]">{out}</nav>;
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
}) => {
  const section = useSidebarStore((s) => s.section) ?? "media";
  const openSection = useSidebarStore((s) => s.openSection);
  const [picked, setPicked] = useState<Partial<Record<SidebarSection, string>>>({});
  const sections = SECTIONS[section];
  const sub = picked[section] ?? sections?.[0]?.id ?? "";

  const content = () => {
    switch (section) {
      case "media":
        return sub === "library" ? <PendingMenu section="library" /> : <MediaMenu />;
      case "filters":
        return <FilterMenu />;
      case "text":
        return <TextMenu part={sub === "animations" ? "animations" : "styles"} />;
      case "transitions":
        return <TransitionMenu />;
      default:
        return <PendingMenu section={section as Pending} />;
    }
  };

  return (
    <ResizablePanel
      id={id}
      minSize={minSize}
      maxSize={maxSize}
      defaultSize={defaultSize}
      order={order}
      data-testid="assets"
      className="bg-brand-background rounded-md overflow-hidden flex flex-col"
    >
      {/* Scrolls sideways when the panel is narrower than the tabs; the edge fades to say so. */}
      <nav
        aria-label="Libraries"
        style={{ scrollbarWidth: "none", maskImage: "linear-gradient(90deg, #000 calc(100% - 16px), transparent)" }}
        className="shrink-0 flex items-stretch px-1 pt-1 pb-0.5 border-b border-brand-light/[0.06] overflow-x-auto [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map(({ section: s, title, icon: Icon }) => (
          <button
            key={s}
            type="button"
            data-testid={`assets-tab-${s}`}
            aria-pressed={section === s}
            onClick={() => openSection(s)}
            className={cn(
              "shrink-0 flex-1 flex flex-col items-center justify-center gap-1 h-[52px] px-[3px] rounded-[6px] transition-colors cursor-pointer",
              section === s ? "text-brand-accent" : "text-brand-light/60 hover:text-brand-light",
            )}
          >
            <Icon className="w-[18px] h-[18px]" />
            <span className="text-[11px] leading-none whitespace-nowrap">{title}</span>
          </button>
        ))}
      </nav>
      <div className="flex-1 min-h-0 flex">
        {sections && <SectionNav items={sections} value={sub} onChange={(v) => setPicked((p) => ({ ...p, [section]: v }))} />}
        <div data-testid="assets-content" className="flex-1 min-w-0 min-h-0">
          {content()}
        </div>
      </div>
    </ResizablePanel>
  );
};

export default MediaModelPanel;
