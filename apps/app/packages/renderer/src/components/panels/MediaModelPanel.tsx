import React from "react";
import type { IconType } from "react-icons";
import {
  LuFilm,
  LuMusic,
  LuType,
  LuSticker,
  LuSparkles,
  LuArrowLeftRight,
  LuSlidersHorizontal,
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
import PendingMenu from "../menus/PendingMenu";

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
  { section: "filters", title: "Filters", icon: MdPhotoFilter },
  { section: "adjustment", title: "Adjustment", icon: LuSlidersHorizontal },
];

/**
 * The left panel: a row of tabs for what can go on the timeline (media, text, filters,
 * transitions, …) over the chosen tab's library.
 */
const MediaModelPanel: React.FC<MediaModelPanelProps> = ({
  id = "assets",
  order,
  defaultSize = 27,
  minSize = 16,
  maxSize,
}) => {
  const section = useSidebarStore((s) => s.section) ?? "media";
  const openSection = useSidebarStore((s) => s.openSection);

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
              "shrink-0 flex-1 flex flex-col items-center justify-center gap-1 h-12 px-[7px] rounded-[6px] transition-colors cursor-pointer",
              section === s ? "text-brand-accent bg-brand-light/[0.04]" : "text-brand-light/55 hover:text-brand-light hover:bg-brand-light/[0.04]",
            )}
          >
            <Icon className="w-[18px] h-[18px]" />
            <span className="text-[10px] leading-none whitespace-nowrap">{title}</span>
          </button>
        ))}
      </nav>
      <div className="flex-1 min-h-0">
        {section === "media" && <MediaMenu />}
        {section === "filters" && <FilterMenu />}
        {section === "text" && <TextMenu />}
        {section === "transitions" && <TransitionMenu />}
        {(section === "audio" || section === "stickers" || section === "effects" || section === "adjustment") && <PendingMenu section={section} />}
      </div>
    </ResizablePanel>
  );
};

export default MediaModelPanel;
