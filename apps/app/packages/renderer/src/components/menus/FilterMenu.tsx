import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { LuPlus, LuSearch, LuX } from "react-icons/lu";
import { useQuery } from "@tanstack/react-query";
import { fetchFilters } from "@app/preload";
import { ScrollArea } from "@/components/ui/scroll-area";
import { addFilterAtPlayhead, filterKey, useFilterLibrary } from "@/lib/filters/library";
import type { Filter } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The library's filters (read once; they're files on disk). */
export const useFilters = (): Filter[] => {
  const { data = [] } = useQuery({
    queryKey: ["filters"],
    queryFn: async () => (await fetchFilters()) ?? [],
    placeholderData: (prev) => prev ?? [],
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  return data;
};

/** The tab's column: Favorites, then the categories under Filters (what the panel lists). */
export const filterSections = (filters: Filter[]) => [
  { id: "favorites", label: "Favorites" },
  { id: "all", label: "All", under: "Filters" },
  ...[...new Set(filters.map((f) => f.category))].map((c) => ({ id: `cat:${c}`, label: c, under: "Filters" })),
];

/** A star: outlined, or filled when the filter is a favourite. */
const Star: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
    <path d="M6 1.2 7.5 4.4l3.5.5-2.5 2.4.6 3.5L6 9.1 2.9 10.8l.6-3.5L1 4.9l3.5-.5z" />
  </svg>
);

/**
 * One tile, as CapCut's library tiles: an 86 px rounded square showing the filter on a sample
 * picture, its name under it. Clicked, the filter is previewed in the player (the project
 * doesn't change); hovered, a star (favourite) and a round "+" (add at the playhead) sit at
 * the bottom-right. Dragged onto the timeline, it lands as a filter clip.
 */
const FilterTile: React.FC<{ filter: Filter; active: boolean; favourite: boolean }> = ({ filter, active, favourite }) => {
  const [hover, setHover] = useState(false);
  const toggleFavourite = useFilterLibrary((s) => s.toggleFavourite);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `filter:${filterKey(filter)}`,
    data: { ...filter, type: "filter", absPath: filter.examplePath, assetUrl: filter.exampleAssetUrl, fillCanvas: true },
  });
  // The buttons keep their own presses (a press on the tile starts its drag).
  const own = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className="flex flex-col gap-1.5 w-[86px]" data-testid={`filter-card-${filterKey(filter)}`}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        title={filter.name}
        data-testid="filter-tile"
        data-filter={filter.id}
        data-category={filter.category}
        aria-pressed={active}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn(
          "relative w-[86px] h-[86px] rounded-[6px] bg-brand-background-light overflow-hidden cursor-pointer outline-none",
          active && "ring-[1.5px] ring-brand-accent",
          isDragging && "opacity-50",
        )}
      >
        <img src={filter.examplePath} alt={filter.name} draggable={false} loading="lazy" className="w-full h-full object-cover pointer-events-none" />
        {(hover || favourite) && (
          <div className="absolute right-1 bottom-1 flex items-center gap-1">
            <button
              type="button"
              title={favourite ? "Remove from Favorites" : "Add to Favorites"}
              aria-label={favourite ? "Remove from Favorites" : "Add to Favorites"}
              aria-pressed={favourite}
              data-testid="filter-favourite"
              onPointerDown={own}
              onClick={(e) => {
                e.stopPropagation();
                toggleFavourite(filter);
              }}
              className={cn(
                "w-[18px] h-[18px] rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80",
                favourite ? "text-brand-accent" : "text-white",
                !hover && "hidden",
              )}
            >
              <Star on={favourite} />
            </button>
            {hover && (
              <button
                type="button"
                title={`Add ${filter.name}`}
                aria-label={`Add ${filter.name}`}
                data-testid="filter-add"
                onPointerDown={own}
                onClick={(e) => {
                  e.stopPropagation();
                  void addFilterAtPlayhead(filter);
                }}
                className="w-[18px] h-[18px] rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
              >
                <LuPlus className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
        {!hover && favourite && (
          <span className="absolute right-1 bottom-1 w-[18px] h-[18px] rounded-full bg-black/60 text-brand-accent flex items-center justify-center pointer-events-none" data-testid="filter-favourite-mark">
            <Star on />
          </span>
        )}
      </div>
      <span className={cn("text-[12px] leading-none truncate text-left", active ? "text-brand-light" : "text-[#949494]")}>{filter.name}</span>
    </div>
  );
};

/**
 * The Filters tab, in CapCut's layout: a search field, then the picked part of the column
 * (Favorites, All, or a category) as a grid of tiles under its name. A search looks through
 * every filter. The click on a tile (a press let go where it began; the app's drags start on a
 * press and swallow the click) previews it; "+" adds it.
 */
const FilterMenu: React.FC<{ part?: string }> = ({ part = "all" }) => {
  const filters = useFilters();
  const favourites = useFilterLibrary((s) => s.favourites);
  const preview = useFilterLibrary((s) => s.preview);
  const setPreview = useFilterLibrary((s) => s.setPreview);
  const [query, setQuery] = useState("");

  // A preview lasts while the tab shows.
  useEffect(() => () => useFilterLibrary.getState().setPreview(null), []);

  const previewRef = useRef(preview);
  previewRef.current = preview;
  useDndMonitor({
    onDragEnd: (e) => {
      const d = e.active?.data?.current as (Filter & { type?: string }) | undefined;
      if (d?.type !== "filter" || Math.hypot(e.delta.x, e.delta.y) > 3) return;
      const f = filters.find((x) => filterKey(x) === filterKey(d));
      if (!f) return;
      setPreview(previewRef.current && filterKey(previewRef.current) === filterKey(f) ? null : f);
    },
  });

  const q = query.trim().toLowerCase();
  const category = part.startsWith("cat:") ? part.slice(4) : null;
  const heading = q ? "" : part === "favorites" ? "Favorites" : (category ?? "All");
  const shown = useMemo(() => {
    if (q) return filters.filter((f) => f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q));
    if (part === "favorites") return filters.filter((f) => favourites.includes(filterKey(f)));
    return category ? filters.filter((f) => f.category === category) : filters;
  }, [filters, favourites, q, part, category]);

  const empty =
    shown.length > 0
      ? ""
      : q
        ? `No filters match “${query.trim()}”`
        : part === "favorites"
          ? "No favorites yet. Hover a filter and click its star to keep it here."
          : "No filters found.";

  return (
    <div className="h-full flex flex-col" data-testid="filters-view">
      <div className="px-3.5 pt-3 pb-3 shrink-0">
        <label className="h-[26px] flex flex-row items-center gap-1.5 px-2.5 rounded-[4px] bg-brand border border-transparent focus-within:border-[#515151]">
          <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
          <input
            data-testid="filters-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search filters"
            className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-lighter placeholder:text-[#6c6c6c] outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              data-testid="filters-search-clear"
              onClick={() => setQuery("")}
              className="w-3.5 h-3.5 rounded-full bg-[#6c6c6c] text-brand flex items-center justify-center hover:bg-[#8a8a8a]"
            >
              <LuX className="w-2.5 h-2.5" />
            </button>
          )}
        </label>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col pl-3.5 pr-3 pb-8 text-left">
          {heading && (
            <h3 className="text-[12.5px] text-brand-light leading-none mb-3" data-testid="filters-heading">
              {heading}
            </h3>
          )}
          {empty ? (
            <p className="text-[12px] text-[#6c6c6c] leading-snug py-6" data-testid="filters-empty">
              {empty}
            </p>
          ) : (
            <div className="grid gap-x-4 gap-y-[18px]" style={{ gridTemplateColumns: "repeat(auto-fill, 86px)" }}>
              {shown.map((f) => (
                <FilterTile key={filterKey(f)} filter={f} active={!!preview && filterKey(preview) === filterKey(f)} favourite={favourites.includes(filterKey(f))} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default FilterMenu;
