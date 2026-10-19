import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { LuDownload, LuListFilter, LuPlus, LuSearch, LuTriangleAlert, LuWifiOff, LuX } from "react-icons/lu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { STOCK_CATEGORIES, addStock, durationText, ensureStock, previewSrc, searchFor, useStockLibrary } from "@/lib/stock/library";
import type { StockItem, StockKind } from "@/lib/stock/sources";
import { cn } from "@/lib/utils";

/** A stock tile as a drag carries it (the timeline takes it from here and adds it where it's let go). */
export type StockDrag = { type: "stock-tile"; id: string; item: StockItem };

/** The Library's part of the Media tab's column: Favorites, the categories and the credits, under "Library". */
export const stockSections = () => [
  { id: "library:favorites", label: "Favorites", under: "Library" },
  ...STOCK_CATEGORIES.map((c) => ({ id: `library:${c.id}`, label: c.label, under: "Library" })),
  { id: "library:credits", label: "Credits", under: "Library" },
];

const Star: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
    <path d="M6 1.2 7.5 4.4l3.5.5-2.5 2.4.6 3.5L6 9.1 2.9 10.8l.6-3.5L1 4.9l3.5-.5z" />
  </svg>
);

/** "CC BY" for the chip: the licence without its version. */
const chip = (licence: string) => (/^CC BY/i.test(licence) ? "CC BY" : /^Public domain/i.test(licence) ? "PD" : /^NASA/i.test(licence) ? "NASA" : licence);

/**
 * One tile, as CapCut's Library cards: the picture with its length at the top right and, at the
 * bottom right, its download mark (a spinner while it loads, "+" once it's here). A click
 * previews it in the player; hovered, a video plays (muted) and a star (favourite) and "+" (add at
 * the playhead) show. Dragged, it goes where it's let go on the timeline.
 */
const Tile: React.FC<{ item: StockItem; active: boolean }> = ({ item, active }) => {
  const cached = useStockLibrary((s) => s.cached);
  const loading = useStockLibrary((s) => s.downloading.includes(item.id));
  const failed = useStockLibrary((s) => s.failed[item.id]);
  const favourite = useStockLibrary((s) => s.favourites.some((f) => f.id === item.id));
  const toggleFavourite = useStockLibrary((s) => s.toggleFavourite);
  const [hover, setHover] = useState(false);
  const [playing, setPlaying] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `stock-tile-${item.id}`, data: { type: "stock-tile", id: item.id, item } satisfies StockDrag });
  const ready = !!cached[item.id];
  const hoverSrc = item.kind === "video" && hover ? previewSrc(item, cached) : null;
  // A video starts after the pointer rests on the tile (sweeping across a list doesn't start a dozen).
  useEffect(() => {
    if (!hover) return setPlaying(false);
    const t = window.setTimeout(() => setPlaying(true), 250);
    return () => window.clearTimeout(t);
  }, [hover]);
  const own = (e: React.PointerEvent) => e.stopPropagation();
  const circle = "w-[18px] h-[18px] rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center";
  return (
    <div className="flex flex-col min-w-0">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        title={`${item.title} · ${item.license} · ${item.author}`}
        aria-label={item.title}
        aria-pressed={active}
        data-testid="stock-tile"
        data-stock={item.id}
        data-kind={item.kind}
        data-source={item.source}
        data-license={item.license}
        data-ready={ready ? "1" : "0"}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn("relative w-full aspect-[16/10] rounded-[4px] bg-[#0d0d0f] overflow-hidden cursor-pointer select-none outline-none", active && "ring-[1.5px] ring-brand-accent", isDragging && "opacity-50")}
      >
        <img src={item.thumb} alt="" draggable={false} loading="lazy" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
        {playing && hoverSrc && <video src={hoverSrc} muted loop autoPlay playsInline data-testid="stock-hover-video" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />}
        {item.duration != null && <span className="absolute right-1.5 top-1 text-[11px] leading-none text-white tabular-nums drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">{durationText(item.duration)}</span>}
        <span data-testid="stock-licence" className="absolute left-1.5 bottom-1.5 px-1 h-[14px] rounded-[3px] bg-black/60 text-white text-[9.5px] leading-[14px]">
          {chip(item.license)}
        </span>
        <div className="absolute right-1 bottom-1 flex items-center gap-1">
          {(hover || favourite) && !loading && (
            <button
              type="button"
              title={favourite ? "Remove from Favorites" : "Add to Favorites"}
              aria-label={favourite ? "Remove from Favorites" : "Add to Favorites"}
              aria-pressed={favourite}
              data-testid="stock-favourite"
              onPointerDown={own}
              onClick={(e) => {
                e.stopPropagation();
                toggleFavourite(item);
              }}
              className={cn(circle, favourite ? "text-brand-accent" : "text-white", !hover && "hidden")}
            >
              <Star on={favourite} />
            </button>
          )}
          {loading ? (
            <span className={circle} title="Downloading">
              <span data-testid="stock-spinner" className="block w-[10px] h-[10px] rounded-full border-[1.5px] border-white/30 border-t-white animate-spin" />
            </span>
          ) : failed ? (
            <button type="button" title={`Couldn't download: ${failed}. Click to try again`} aria-label="Download failed" data-testid="stock-failed" onPointerDown={own} onClick={(e) => { e.stopPropagation(); void ensureStock(item); }} className={cn(circle, "text-[#ff8a8a]")}>
              <LuTriangleAlert className="w-3 h-3" />
            </button>
          ) : ready ? (
            hover && (
              <button type="button" title="Add to timeline" aria-label={`Add ${item.title}`} data-testid="stock-add" onPointerDown={own} onClick={(e) => { e.stopPropagation(); void addStock(item); }} className={circle}>
                <LuPlus className="w-3 h-3" />
              </button>
            )
          ) : (
            <>
              {hover && (
                <button type="button" title="Add to timeline" aria-label={`Add ${item.title}`} data-testid="stock-add" onPointerDown={own} onClick={(e) => { e.stopPropagation(); void addStock(item); }} className={circle}>
                  <LuPlus className="w-3 h-3" />
                </button>
              )}
              <button type="button" title="Download" aria-label={`Download ${item.title}`} data-testid="stock-download" onPointerDown={own} onClick={(e) => { e.stopPropagation(); void ensureStock(item); }} className={circle}>
                <LuDownload className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const KIND_LABEL: Record<StockKind, string> = { video: "Videos", photo: "Photos" };

/**
 * The Media tab's stock Library, in CapCut's layout: a search field with a filter beside it
 * (here Videos or Photos), then the picked category as two columns of tiles under its name.
 * Search looks through every source; a category is a search of its own.
 */
const StockLibraryMenu: React.FC<{ category: string }> = ({ category }) => {
  const kind = useStockLibrary((s) => s.kind);
  const setKind = useStockLibrary((s) => s.setKind);
  const items = useStockLibrary((s) => s.items);
  const more = useStockLibrary((s) => s.more);
  const page = useStockLibrary((s) => s.page);
  const loading = useStockLibrary((s) => s.loading);
  const error = useStockLibrary((s) => s.error);
  const missing = useStockLibrary((s) => s.missing);
  const favourites = useStockLibrary((s) => s.favourites);
  const preview = useStockLibrary((s) => s.preview);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const showFavourites = category === "favorites";

  useEffect(() => {
    void useStockLibrary.getState().loadCached();
    // A preview lasts while the tab shows.
    return () => useStockLibrary.getState().setPreview(null);
  }, []);

  // The typed query waits for a pause in typing.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(typed), 350);
    return () => window.clearTimeout(t);
  }, [typed]);

  const q = searchFor(category, kind, query);
  useEffect(() => {
    if (showFavourites) return;
    void useStockLibrary.getState().search(q, 1);
  }, [q, kind, showFavourites, retry]);

  const previewRef = useRef(preview);
  previewRef.current = preview;
  useDndMonitor({
    onDragEnd: (event) => {
      const data = event.active?.data?.current as StockDrag | undefined;
      if (data?.type !== "stock-tile") return;
      // A press without a move is the tile's click: it previews the item in the player.
      if (Math.hypot(event.delta.x, event.delta.y) > 3) return;
      useStockLibrary.getState().setPreview(previewRef.current?.id === data.id ? null : data.item);
    },
  });

  const shown = useMemo(() => (showFavourites ? favourites.filter((f) => f.kind === kind) : items), [showFavourites, favourites, items, kind]);
  const heading = typed.trim() && !showFavourites ? "" : showFavourites ? "Favorites" : (STOCK_CATEGORIES.find((c) => c.id === category)?.label ?? "");

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el || !more || loading || showFavourites) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && void useStockLibrary.getState().search(q, page + 1), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, loading, page, q, showFavourites, shown.length]);

  return (
    <div className="h-full flex flex-col" data-testid="stock-view" data-kind={kind}>
      <div className="px-3.5 pt-3 pb-3 shrink-0 flex flex-row items-center gap-1.5">
        <label className="flex-1 min-w-0 h-[26px] flex flex-row items-center gap-1.5 px-2.5 rounded-[4px] bg-brand border border-transparent focus-within:border-[#515151]">
          <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
          <input
            data-testid="stock-search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={kind === "video" ? "Search videos" : "Search photos"}
            className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-lighter placeholder:text-[#6c6c6c] outline-none"
          />
          {typed && (
            <button type="button" aria-label="Clear search" data-testid="stock-search-clear" onClick={() => setTyped("")} className="w-3.5 h-3.5 rounded-full bg-[#6c6c6c] text-brand flex items-center justify-center hover:bg-[#8a8a8a]">
              <LuX className="w-2.5 h-2.5" />
            </button>
          )}
        </label>
        <Select value={kind} onValueChange={(v) => setKind(v as StockKind)}>
          <SelectTrigger size="sm" aria-label="Type" data-testid="stock-kind" className="!h-[26px] w-[64px] shrink-0 px-1.5 gap-0.5 text-[12px] bg-transparent border-0 text-[#949494] hover:text-brand-light [&>svg:last-child]:w-3">
            <LuListFilter className="w-3.5 h-3.5" />
            <span data-testid="stock-kind-label">{kind === "video" ? "Videos" : "Photos"}</span>
          </SelectTrigger>
          <SelectContent className="bg-brand-background text-brand-light font-poppins z-[101] dark">
            {(["video", "photo"] as StockKind[]).map((k) => (
              <SelectItem key={k} value={k} className="text-[12px]" data-testid={`stock-kind-${k}`}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col pl-3.5 pr-3 pb-8 text-left">
          {heading && (
            <h3 className="text-[12.5px] text-brand-light leading-none mb-3" data-testid="stock-heading">
              {heading}
            </h3>
          )}
          {!showFavourites && error ? (
            <div data-testid="stock-error" className="flex flex-col items-center gap-3 py-12 text-center">
              <LuWifiOff className="w-6 h-6 text-brand-light/35" />
              <p className="text-[12px] leading-snug text-brand-light/60 max-w-[240px]">{error}</p>
              <button type="button" data-testid="stock-retry" onClick={() => setRetry((n) => n + 1)} className="h-7 px-3 rounded-[6px] text-[11px] text-brand-light/85 bg-brand hover:bg-brand-background-light cursor-pointer">
                Try again
              </button>
            </div>
          ) : shown.length === 0 ? (
            <p className="text-[12px] text-[#6c6c6c] leading-snug py-6" data-testid="stock-empty">
              {loading
                ? "Loading…"
                : showFavourites
                  ? `No favorite ${kind === "video" ? "videos" : "photos"} yet. Hover one and click its star to keep it here.`
                  : `No ${kind === "video" ? "videos" : "photos"} found for “${q}”.`}
            </p>
          ) : (
            <div data-testid="stock-grid" className="grid grid-cols-2 gap-x-2.5 gap-y-2.5">
              {shown.map((it) => (
                <Tile key={it.id} item={it} active={preview?.id === it.id} />
              ))}
            </div>
          )}
          {!showFavourites && !error && loading && shown.length > 0 && <p className="text-[11px] text-[#6c6c6c] py-3" data-testid="stock-loading">Loading…</p>}
          {!showFavourites && !error && missing.length > 0 && shown.length > 0 && (
            <p data-testid="stock-partial" className="text-[10.5px] text-[#6c6c6c] pt-3 leading-snug">
              Some sources didn't answer, so there may be more here later.
            </p>
          )}
          {!showFavourites && more && <div ref={end} className="h-4" />}
        </div>
      </ScrollArea>
    </div>
  );
};

export default StockLibraryMenu;
