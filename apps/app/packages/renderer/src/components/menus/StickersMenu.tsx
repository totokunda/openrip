import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { LuDownload, LuListFilter, LuPlus, LuSearch, LuTriangleAlert, LuX } from "react-icons/lu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { STICKER_CATEGORIES, STYLE_FILTERS, addSticker, ensureSticker, fullSrc, inStyle, isReady, thumbSrc, useStickerLibrary, type Sticker, type StyleFilter } from "@/lib/stickers/library";
import { useViewportStore } from "@/lib/viewport";
import { cn } from "@/lib/utils";

/** A Stickers tile as a drag carries it (the timeline and the player take it from here). */
export type StickerDrag = { type: "sticker-tile"; id: string };

/** The Stickers tab's column: Favorites, then the categories under Stickers (and Shapes, which MediaModelPanel adds). */
export const stickerSections = () => [
  { id: "favorites", label: "Favorites" },
  ...STICKER_CATEGORIES.map((c) => ({ id: `cat:${c}`, label: c, under: "Stickers" })),
];

const Star: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
    <path d="M6 1.2 7.5 4.4l3.5.5-2.5 2.4.6 3.5L6 9.1 2.9 10.8l.6-3.5L1 4.9l3.5-.5z" />
  </svg>
);

/** The spinner on a tile while its file downloads. */
const Spinner: React.FC = () => <span data-testid="sticker-spinner" className="block w-[10px] h-[10px] rounded-full border-[1.5px] border-white/30 border-t-white animate-spin" />;

/**
 * One 86 px tile, as CapCut's library tiles: the sticker on the raised grey, no name. A click
 * previews it in the player; an animated one plays while hovered. A sticker not on this machine
 * shows CapCut's download mark at the bottom-right, which turns to a spinner while it loads and
 * to "+" once it's here; hovered, a star (favourite) and "+" (add at the playhead) sit there.
 * Dragged, it goes where it's let go: the timeline (at that time) or the player (there).
 */
const Tile: React.FC<{ sticker: Sticker; active: boolean }> = ({ sticker, active }) => {
  const cached = useStickerLibrary((s) => s.cached);
  const loading = useStickerLibrary((s) => s.loading.includes(sticker.id));
  const failed = useStickerLibrary((s) => s.failed[sticker.id]);
  const favourite = useStickerLibrary((s) => s.favourites.includes(sticker.id));
  const toggleFavourite = useStickerLibrary((s) => s.toggleFavourite);
  const [hover, setHover] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `sticker-tile-${sticker.id}`, data: { type: "sticker-tile", id: sticker.id } satisfies StickerDrag });
  const ready = isReady(sticker, cached);
  const src = hover && sticker.set.animated ? fullSrc(sticker, cached) : thumbSrc(sticker, cached);
  const own = (e: React.PointerEvent) => e.stopPropagation();
  const circle = "w-[18px] h-[18px] rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center";
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      title={sticker.name}
      aria-label={sticker.name}
      aria-pressed={active}
      data-testid="sticker-tile"
      data-sticker={sticker.id}
      data-set={sticker.set.id}
      data-ready={ready ? "1" : "0"}
      data-animated={sticker.set.animated ? "1" : "0"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn("relative w-[86px] h-[86px] shrink-0 rounded-[6px] bg-brand-background-light overflow-hidden cursor-pointer select-none outline-none", active && "ring-[1.5px] ring-brand-accent", isDragging && "opacity-50")}
    >
      <img src={src} alt="" draggable={false} loading="lazy" className="absolute inset-0 w-full h-full object-contain p-2.5 pointer-events-none" />
      <div className="absolute right-1 bottom-1 flex items-center gap-1">
        {(hover || favourite) && !loading && (
          <button
            type="button"
            title={favourite ? "Remove from Favorites" : "Add to Favorites"}
            aria-label={favourite ? "Remove from Favorites" : "Add to Favorites"}
            aria-pressed={favourite}
            data-testid="sticker-favourite"
            onPointerDown={own}
            onClick={(e) => {
              e.stopPropagation();
              toggleFavourite(sticker.id);
            }}
            className={cn(circle, favourite ? "text-brand-accent" : "text-white", !hover && "hidden")}
          >
            <Star on={favourite} />
          </button>
        )}
        {loading ? (
          <span className={circle} title="Downloading">
            <Spinner />
          </span>
        ) : failed ? (
          <button type="button" title={`Couldn't download: ${failed}. Click to try again`} aria-label="Download failed" data-testid="sticker-failed" onPointerDown={own} onClick={(e) => { e.stopPropagation(); void ensureSticker(sticker); }} className={cn(circle, "text-[#ff8a8a]")}>
            <LuTriangleAlert className="w-3 h-3" />
          </button>
        ) : ready ? (
          hover && (
            <button
              type="button"
              title={`Add ${sticker.name}`}
              aria-label={`Add ${sticker.name}`}
              data-testid="sticker-add"
              onPointerDown={own}
              onClick={(e) => {
                e.stopPropagation();
                void addSticker(sticker);
              }}
              className={circle}
            >
              <LuPlus className="w-3 h-3" />
            </button>
          )
        ) : (
          <button type="button" title="Download" aria-label={`Download ${sticker.name}`} data-testid="sticker-download" onPointerDown={own} onClick={(e) => { e.stopPropagation(); void ensureSticker(sticker); }} className={circle}>
            <LuDownload className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};

/** How many tiles show at first, and how many more each time the end of the list scrolls into view. */
const PAGE = 120;

/**
 * The Stickers tab's library, in CapCut's layout: a search field with a filter beside it, then
 * the picked part of the column (Favorites or a category) as 86 px tiles under its name. The
 * search looks through every sticker, by name, keyword and category. A click on a tile (a press
 * let go where it began; the app's drags start on a press) previews it in the player; "+" adds
 * it at the playhead; a drag onto the timeline or the player places it there.
 */
const StickersMenu: React.FC<{ part?: string }> = ({ part = "cat:Trending" }) => {
  const stickers = useStickerLibrary((s) => s.stickers);
  const loaded = useStickerLibrary((s) => s.stickers.length > 0);
  const favourites = useStickerLibrary((s) => s.favourites);
  const preview = useStickerLibrary((s) => s.preview);
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<StyleFilter>("Recommended");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    void useStickerLibrary.getState().load();
    // A preview lasts while the tab shows.
    return () => useStickerLibrary.getState().setPreview(null);
  }, []);

  const previewRef = useRef(preview);
  previewRef.current = preview;
  useDndMonitor({
    onDragEnd: (event) => {
      const data = event.active?.data?.current as StickerDrag | undefined;
      if (data?.type !== "sticker-tile") return;
      const sticker = useStickerLibrary.getState().stickers.find((s) => s.id === data.id);
      if (!sticker) return;
      const moved = Math.hypot(event.delta.x, event.delta.y) > 3;
      // A press without a move is the tile's click: it previews the sticker in the player.
      if (!moved) {
        useStickerLibrary.getState().setPreview(previewRef.current?.id === sticker.id ? null : sticker);
        return;
      }
      // Let go on the player: at the playhead, where it was let go (the timeline adds its own).
      const start = event.activatorEvent as PointerEvent | null;
      const stage = document.querySelector("[data-testid=player] .konvajs-content") as HTMLElement | null;
      if (!start || !stage || typeof start.clientX !== "number") return;
      const r = stage.getBoundingClientRect();
      const cx = start.clientX + event.delta.x;
      const cy = start.clientY + event.delta.y;
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return;
      const { position, scale } = useViewportStore.getState();
      void addSticker(sticker, { center: { x: (cx - r.left - position.x) / scale, y: (cy - r.top - position.y) / scale } });
    },
  });

  const q = query.trim().toLowerCase();
  const category = part.startsWith("cat:") ? part.slice(4) : null;
  const heading = q ? "" : part === "favorites" ? "Favorites" : (category ?? "");
  const shown = useMemo(() => {
    let list: Sticker[];
    if (q) {
      const terms = q.split(/\s+/);
      list = stickers.filter((s) => inStyle(s, style) && terms.every((t) => s.name.toLowerCase().includes(t) || s.words.some((w) => w.includes(t)) || s.categories.some((c) => c.toLowerCase().includes(t))));
      // The whole-word and name matches first.
      list.sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)));
    } else if (part === "favorites") {
      list = stickers.filter((s) => favourites.includes(s.id));
    } else {
      list = stickers.filter((s) => (category ? s.categories.includes(category) : true) && inStyle(s, style));
      if (category === "Trending" || category === "Animated") list.sort((a, b) => Number(b.starter) - Number(a.starter) || b.rank - a.rank);
    }
    return list;
  }, [stickers, favourites, q, part, category, style]);
  useEffect(() => setLimit(PAGE), [q, part, style]);

  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || limit >= shown.length) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setLimit((l) => l + PAGE), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, shown.length]);

  const empty = shown.length > 0 ? "" : !loaded ? "Loading stickers…" : q ? `No stickers match “${query.trim()}”` : part === "favorites" ? "No favorites yet. Hover a sticker and click its star to keep it here." : "No stickers found.";

  return (
    <div className="h-full flex flex-col" data-testid="stickers-view">
      <div className="px-3.5 pt-3 pb-3 shrink-0 flex flex-row items-center gap-1.5">
        <label className="flex-1 min-w-0 h-[26px] flex flex-row items-center gap-1.5 px-2.5 rounded-[4px] bg-brand border border-transparent focus-within:border-[#515151]">
          <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
          <input
            data-testid="stickers-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stickers"
            className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-lighter placeholder:text-[#6c6c6c] outline-none"
          />
          {query && (
            <button type="button" aria-label="Clear search" data-testid="stickers-search-clear" onClick={() => setQuery("")} className="w-3.5 h-3.5 rounded-full bg-[#6c6c6c] text-brand flex items-center justify-center hover:bg-[#8a8a8a]">
              <LuX className="w-2.5 h-2.5" />
            </button>
          )}
        </label>
        <Select value={style} onValueChange={(v) => setStyle(v as StyleFilter)}>
          <SelectTrigger size="sm" aria-label="Style" data-testid="stickers-style" className="!h-[26px] w-[52px] shrink-0 px-1.5 gap-0.5 text-[12px] bg-transparent border-0 text-[#949494] hover:text-brand-light [&>svg:last-child]:w-3">
            <LuListFilter className="w-3.5 h-3.5" />
          </SelectTrigger>
          <SelectContent className="bg-brand-background text-brand-light font-poppins z-[101] dark">
            {STYLE_FILTERS.map((f) => (
              <SelectItem key={f} value={f} className="text-[12px]" data-testid={`stickers-style-${f}`}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col pl-3.5 pr-3 pb-8 text-left">
          {heading && (
            <h3 className="text-[12.5px] text-brand-light leading-none mb-3" data-testid="stickers-heading">
              {heading}
            </h3>
          )}
          {empty ? (
            <p className="text-[12px] text-[#6c6c6c] leading-snug py-6" data-testid="stickers-empty">
              {empty}
            </p>
          ) : (
            <>
              <div data-testid="stickers-grid" className="grid gap-x-4 gap-y-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, 86px)" }}>
                {shown.slice(0, limit).map((s) => (
                  <Tile key={s.id} sticker={s} active={preview?.id === s.id} />
                ))}
              </div>
              {limit < shown.length && <div ref={more} className="h-4" />}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default StickersMenu;
