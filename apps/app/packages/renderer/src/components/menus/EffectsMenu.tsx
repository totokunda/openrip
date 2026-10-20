import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import type { EngineTileSpec } from "@app/preload";
import { LuPlus, LuSearch, LuX } from "react-icons/lu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { addEffectBar, useEffectLibrary } from "@/lib/effects/library";
import { defaultEffectParams, useEffectCatalog, type EffectCatalog, type EffectDef } from "@/lib/effects/catalog";
import { TilePicture } from "./TilePicture";
import { cn } from "@/lib/utils";
import { RecentSearches, useRecentSearches } from "./RecentSearches";

/** What an effect tile drags as (the timeline and the player's clips take it). */
export type EffectDrag = { type: "effect-preset"; effectId: string; name: string };

/** The tab's column: Favorites, then Video effects with its categories (what the panel lists). */
export const effectSections = (catalog: EffectCatalog) => [
  { id: "favorites", label: "Favorites" },
  { id: "all", label: "All", under: "Video effects" },
  ...catalog.categories.map((c) => ({ id: `cat:${c}`, label: c, under: "Video effects" })),
];

/** A star: outlined, or filled when the effect is a favourite. */
const Star: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
    <path d="M6 1.2 7.5 4.4l3.5.5-2.5 2.4.6 3.5L6 9.1 2.9 10.8l.6-3.5L1 4.9l3.5-.5z" />
  </svg>
);

/**
 * One tile, as CapCut's library tiles: an 86 px rounded square showing the effect, its name
 * under it. Clicked, the effect is previewed in the player (the project doesn't change);
 * hovered, it plays, and a star (favourite) and a round "+" (add a bar at the playhead) sit at
 * the bottom-right. Dragged onto the timeline it lands as an effect bar, onto a clip as an
 * effect on that clip.
 */
const EffectTile: React.FC<{ def: EffectDef; active: boolean; favourite: boolean }> = ({ def, active, favourite }) => {
  const [hover, setHover] = useState(false);
  const toggleFavourite = useEffectLibrary((s) => s.toggleFavourite);
  // The tile shows the effect at its defaults on footage, drawn by the engine.
  const spec = useMemo<EngineTileSpec>(() => ({ kind: "effect", id: def.id, name: def.name, intensity: def.intensity, params: defaultEffectParams(def) }), [def]);
  const drag: EffectDrag = { type: "effect-preset", effectId: def.id, name: def.name };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `effect:${def.id}`, data: drag });
  // The buttons keep their own presses (a press on the tile starts its drag).
  const own = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className="flex flex-col gap-1.5 w-[86px]" data-testid={`effect-card-${def.id}`}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        title={def.name}
        data-testid="effect-tile"
        data-effect={def.id}
        data-category={def.category}
        aria-pressed={active}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn("relative w-[86px] h-[86px] rounded-[6px] bg-brand-background-light overflow-hidden cursor-pointer outline-none", active && "ring-[1.5px] ring-brand-accent", isDragging && "opacity-50")}
      >
        <TilePicture spec={spec} hover={hover && !isDragging} testId="effect-picture" />
        {hover && (
          <div className="absolute right-1 bottom-1 flex items-center gap-1">
            <button
              type="button"
              title={favourite ? "Remove from Favorites" : "Add to Favorites"}
              aria-label={favourite ? "Remove from Favorites" : "Add to Favorites"}
              aria-pressed={favourite}
              data-testid="effect-favourite"
              onPointerDown={own}
              onClick={(e) => {
                e.stopPropagation();
                toggleFavourite(def.id);
              }}
              className={cn("w-[18px] h-[18px] rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80", favourite ? "text-brand-accent" : "text-white")}
            >
              <Star on={favourite} />
            </button>
            <button
              type="button"
              title={`Add ${def.name}`}
              aria-label={`Add ${def.name}`}
              data-testid="effect-add"
              onPointerDown={own}
              onClick={(e) => {
                e.stopPropagation();
                void addEffectBar(def.id);
              }}
              className="w-[18px] h-[18px] rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
            >
              <LuPlus className="w-3 h-3" />
            </button>
          </div>
        )}
        {!hover && favourite && (
          <span className="absolute right-1 bottom-1 w-[18px] h-[18px] rounded-full bg-black/60 text-brand-accent flex items-center justify-center pointer-events-none" data-testid="effect-favourite-mark">
            <Star on />
          </span>
        )}
      </div>
      <span className={cn("text-[12px] leading-none truncate text-left", active ? "text-brand-light" : "text-[#949494]")}>{def.name}</span>
    </div>
  );
};

/**
 * The Effects tab, in CapCut's layout: a search field, then the picked part of the column
 * (Favorites, All, or a category) as a grid of tiles under its name. A search looks through
 * every effect. The click on a tile (a press let go where it began; the app's drags start on a
 * press and swallow the click) previews it; "+" adds it.
 */
const EffectsMenu: React.FC<{ part?: string }> = ({ part = "all" }) => {
  const catalog = useEffectCatalog();
  const favourites = useEffectLibrary((s) => s.favourites);
  const preview = useEffectLibrary((s) => s.preview);
  const setPreview = useEffectLibrary((s) => s.setPreview);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const recent = useRecentSearches("effects");

  // A preview lasts while the tab shows.
  useEffect(() => () => useEffectLibrary.getState().setPreview(null), []);

  const previewRef = useRef(preview);
  previewRef.current = preview;
  useDndMonitor({
    onDragEnd: (e) => {
      const d = e.active?.data?.current as Partial<EffectDrag> | undefined;
      if (d?.type !== "effect-preset" || !d.effectId || Math.hypot(e.delta.x, e.delta.y) > 3) return;
      setPreview(previewRef.current === d.effectId ? null : d.effectId);
    },
  });

  const q = query.trim().toLowerCase();
  const category = part.startsWith("cat:") ? part.slice(4) : null;
  const heading = q ? "" : part === "favorites" ? "Favorites" : (category ?? "All");
  const shown = useMemo(() => {
    const all = catalog.effects;
    if (q) return all.filter((e) => e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q));
    if (part === "favorites") return all.filter((e) => favourites.includes(e.id));
    return category ? all.filter((e) => e.category === category) : all;
  }, [catalog, favourites, q, part, category]);

  const empty =
    catalog.effects.length === 0
      ? "Effects need the engine, which isn't available here."
      : shown.length > 0
        ? ""
        : q
          ? `No effects match “${query.trim()}”`
          : part === "favorites"
            ? "No favorites yet. Hover an effect and click its star to keep it here."
            : "No effects found.";

  return (
    <div className="h-full flex flex-col" data-testid="effects-view">
      <div className="px-3.5 pt-3 pb-3 shrink-0">
        <label className="h-[26px] flex flex-row items-center gap-1.5 px-2.5 rounded-[4px] bg-brand border border-transparent focus-within:border-[#515151]">
          <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
          <input
            data-testid="effects-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              recent.add(query);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") recent.add(query);
            }}
            placeholder="Search effects"
            className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-lighter placeholder:text-[#6c6c6c] outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              data-testid="effects-search-clear"
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
          {focused && !q && recent.list.length > 0 ? (
            <RecentSearches list={recent.list} onPick={setQuery} onRemove={recent.remove} onClear={recent.clear} />
          ) : (
            <>
          {heading && (
            <h3 className="text-[12.5px] text-brand-light leading-none mb-3" data-testid="effects-heading">
              {heading}
            </h3>
          )}
          {empty ? (
            <p className="text-[12px] text-[#6c6c6c] leading-snug py-6" data-testid="effects-empty">
              {empty}
            </p>
          ) : (
            <div className="grid gap-x-4 gap-y-[18px]" style={{ gridTemplateColumns: "repeat(auto-fill, 86px)" }}>
              {shown.map((e) => (
                <EffectTile key={e.id} def={e} active={preview === e.id} favourite={favourites.includes(e.id)} />
              ))}
            </div>
          )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default EffectsMenu;
