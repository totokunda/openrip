import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuChevronDown, LuClapperboard, LuLayoutGrid, LuList, LuMusic, LuRefreshCw, LuSearch, LuStar, LuX } from "react-icons/lu";
import { engineThumbnails, listLibraryMedia, revealPathInFolder, type LibraryItem } from "@app/preload";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useShellStore } from "@/lib/shell";
import { useSidebarStore } from "@/lib/sidebar";
import { createAndOpenProject } from "@/lib/project-actions";
import { cn } from "@/lib/utils";
import { clockText, fileUrl, sizeText, useContextMenu } from "./shared";

/**
 * The Library, as CapCut's (01-home/052-library-page.png to 067): a title, a tab, the chips
 * All / Videos / Images / Audio, and on the right search, Favorites, the view (Grid / List),
 * Sort (Time edited or created, newest or oldest first) and refresh. CapCut's cards are its
 * generated assets and cloud elements; here they are the media files the projects import,
 * wherever the originals are. Favourites are kept on this computer.
 */

type Kind = "all" | "video" | "image" | "audio";
const FAV_KEY = "openrip:library-favorites";
const VIEW_KEY = "openrip:library-view";
const menu = "dark z-[200] p-1 bg-[#2b2b2d] border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light";
const menuRow = "dark h-8 px-2.5 gap-2.5 rounded-[4px] text-[13px] cursor-pointer focus:bg-brand-hover";

const readFavs = (): Set<string> => {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(FAV_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
};

// A video's first picture, one at a time (the engine decodes them), kept for the visit.
const thumbs = new Map<string, string | null>();
const waiting: Array<() => Promise<void>> = [];
let running = 0;
const pump = () => {
  while (running < 2 && waiting.length) {
    const job = waiting.shift()!;
    running += 1;
    void job().finally(() => {
      running -= 1;
      pump();
    });
  }
};
const thumbnail = (path: string): Promise<string | null> =>
  new Promise((resolve) => {
    if (thumbs.has(path)) return resolve(thumbs.get(path) ?? null);
    waiting.push(async () => {
      try {
        const [t] = await engineThumbnails(path, [500_000], 240, false);
        if (!t) throw new Error("no frame");
        const canvas = document.createElement("canvas");
        canvas.width = t.width;
        canvas.height = t.height;
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(t.rgba.buffer, t.rgba.byteOffset, t.width * t.height * 4), t.width, t.height), 0, 0);
        const url = canvas.toDataURL("image/jpeg", 0.8);
        thumbs.set(path, url);
        resolve(url);
      } catch {
        thumbs.set(path, null);
        resolve(null);
      }
    });
    pump();
  });

const Picture: React.FC<{ item: LibraryItem; className?: string }> = ({ item, className }) => {
  const [src, setSrc] = useState<string | null>(item.type === "image" ? fileUrl(item.path, item.modifiedMs) : (thumbs.get(item.path) ?? null));
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (item.type !== "video" || src) return;
    // Only what scrolls into view is decoded.
    const el = ref.current;
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void thumbnail(item.path).then((u) => live && setSrc(u));
    });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [item, src]);
  return (
    <div ref={ref} className={cn("relative bg-[#161618] flex items-center justify-center text-[#4a4a4e] overflow-hidden", className)}>
      {src ? (
        <img src={src} alt="" draggable={false} className="w-full h-full object-cover" />
      ) : item.type === "audio" ? (
        <LuMusic className="w-6 h-6" />
      ) : (
        <LuClapperboard className="w-6 h-6" />
      )}
    </div>
  );
};

const metaText = (i: LibraryItem) =>
  [sizeText(i.sizeBytes), i.type === "image" ? (i.width && i.height ? `${i.width}×${i.height}` : "") : i.durationSec != null ? clockText(i.durationSec) : ""].filter(Boolean).join(" | ");

const dateText = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export const LibraryPage: React.FC = () => {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [sortBy, setSortBy] = useState<"edited" | "created">("edited");
  const [newest, setNewest] = useState(true);
  const [favs, setFavs] = useState<Set<string>>(readFavs);
  const [view, setViewState] = useState<"grid" | "list">(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const [spin, setSpin] = useState(false);

  const load = useCallback(async () => {
    setSpin(true);
    const res = await listLibraryMedia();
    setItems(res?.success ? (res.data ?? []) : []);
    setSpin(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setView = (v: "grid" | "list") => {
    setViewState(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  const toggleFav = (path: string) =>
    setFavs((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      try {
        window.localStorage.setItem(FAV_KEY, JSON.stringify([...n]));
      } catch {}
      return n;
    });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (items ?? []).filter((i) => (kind === "all" || i.type === kind) && (!onlyFavs || favs.has(i.path)) && (!q || i.name.toLowerCase().includes(q)));
    const key = sortBy === "edited" ? "modifiedMs" : "createdMs";
    return list.sort((a, b) => (newest ? b[key] - a[key] : a[key] - b[key]));
  }, [items, kind, search, onlyFavs, favs, sortBy, newest]);

  const startCreating = async () => {
    useSidebarStore.getState().openSection("media");
    useShellStore.getState().setImportOnOpen(true);
    try {
      await createAndOpenProject();
    } catch {
      useShellStore.getState().setImportOnOpen(false);
    }
  };

  const { open: openMenu, menu: contextMenu } = useContextMenu((path) => [
    { label: favs.has(path) ? "Remove from Favorites" : "Add to Favorites", testId: "library-menu-favorite", onSelect: () => toggleFav(path) },
    { label: "Show in Finder", testId: "library-menu-reveal", onSelect: () => void revealPathInFolder(path) },
  ]);

  const tool = "h-7 px-2 flex items-center gap-1.5 rounded-[4px] text-[13px] font-medium text-brand-light/90 hover:bg-white/[0.06] cursor-pointer outline-none";
  const chips: [Kind, string][] = [
    ["all", "All"],
    ["video", "Videos"],
    ["image", "Images"],
    ["audio", "Audio"],
  ];
  const star = (i: LibraryItem, cls: string) => (
    <button
      type="button"
      aria-label={favs.has(i.path) ? "Remove from Favorites" : "Add to Favorites"}
      data-testid="library-star"
      aria-pressed={favs.has(i.path)}
      onClick={(e) => {
        e.stopPropagation();
        toggleFav(i.path);
      }}
      className={cn("h-6 w-6 rounded-[5px] flex items-center justify-center cursor-pointer", favs.has(i.path) ? "text-brand-accent opacity-100" : "text-white/90 opacity-0 group-hover:opacity-100", cls)}
    >
      <LuStar className={cn("w-3.5 h-3.5", favs.has(i.path) && "fill-current")} />
    </button>
  );

  return (
    <section data-testid="home-library" className="flex flex-col text-left pt-5">
      <h1 className="text-[24px] font-bold text-brand-lighter leading-8">Library</h1>
      <div className="mt-5 flex gap-6 border-b border-white/[0.07]">
        <span className="pb-2.5 text-[15px] font-bold text-brand-lighter border-b-2 border-brand-accent -mb-px" data-testid="library-tab">
          Media
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2" data-testid="library-chips">
          {chips.map(([k, label]) => (
            <button
              key={k}
              type="button"
              data-testid={`library-chip-${k}`}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={cn("h-8 px-3 rounded-[4px] text-[13px] font-medium cursor-pointer transition-colors", kind === k ? "bg-[#2a2230] text-brand-accent" : "bg-white/[0.07] text-brand-light/90 hover:bg-white/[0.11]")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {searching ? (
            <div className="relative">
              <input
                autoFocus
                data-testid="library-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => !search && setSearching(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearch("");
                    setSearching(false);
                  }
                }}
                placeholder="Search media"
                className="w-[240px] h-7 rounded-[4px] pl-2 pr-7 text-[12px] bg-brand-background-dark border-[0.5px] border-[#3a3a3a] text-brand-light placeholder:text-brand-light/35"
              />
              {search && (
                <button type="button" aria-label="Clear" onClick={() => setSearch("")} className="absolute right-1.5 top-1.5 text-brand-light/60 cursor-pointer">
                  <LuX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button type="button" title="Search" data-testid="library-search-open" onClick={() => setSearching(true)} className={cn(tool, "px-2")}>
              <LuSearch className="w-4 h-4" />
            </button>
          )}
          <button type="button" data-testid="library-favorites" aria-pressed={onlyFavs} onClick={() => setOnlyFavs((v) => !v)} className={cn(tool, onlyFavs && "text-brand-accent")}>
            <LuStar className={cn("w-4 h-4", onlyFavs && "fill-current")} /> Favorites
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger data-testid="library-view" className={tool}>
              {view === "grid" ? <LuLayoutGrid className="w-4 h-4" /> : <LuList className="w-4 h-4" />}
              {view === "grid" ? "Grid" : "List"}
              <LuChevronDown className="w-3.5 h-3.5 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={cn(menu, "w-36")}>
              {(["grid", "list"] as const).map((v) => (
                <DropdownMenuItem key={v} data-testid={`library-view-${v}`} className={menuRow} onClick={() => setView(v)}>
                  <span className="w-4 flex items-center text-brand-accent">{view === v && <LuCheck className="w-3.5 h-3.5" />}</span>
                  {v === "grid" ? "Grid" : "List"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger data-testid="library-sort" className={tool}>
              Sort <LuChevronDown className="w-3.5 h-3.5 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={cn(menu, "w-44")}>
              {([["edited", "Time edited"], ["created", "Time created"]] as const).map(([k, label]) => (
                <DropdownMenuItem key={k} data-testid={`library-sort-${k}`} className={menuRow} onClick={() => setSortBy(k)}>
                  <span className="w-4 flex items-center text-brand-accent">{sortBy === k && <LuCheck className="w-3.5 h-3.5" />}</span>
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-brand-hover mx-1" />
              {([[true, "Newest first"], [false, "Oldest first"]] as const).map(([v, label]) => (
                <DropdownMenuItem key={label} data-testid={`library-order-${v ? "newest" : "oldest"}`} className={menuRow} onClick={() => setNewest(v)}>
                  <span className="w-4 flex items-center text-brand-accent">{newest === v && <LuCheck className="w-3.5 h-3.5" />}</span>
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" title="Refresh" aria-label="Refresh" data-testid="library-refresh" onClick={() => void load()} className={cn(tool, "px-2")}>
            <LuRefreshCw className={cn("w-4 h-4", spin && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="mt-4 px-4 py-3.5 rounded-[6px] bg-white/[0.04] text-[13px] text-brand-light/85" data-testid="library-note">
        The media your projects import, from every project. Files stay where they are on this computer.
      </div>

      {items == null ? null : shown.length === 0 ? (
        <div data-testid="library-empty" className="flex flex-col items-center justify-center gap-3 py-24">
          <LuClapperboard className="w-14 h-14 text-[#3a3a3e]" />
          <p className="text-[14px] text-brand-light/90">
            {(items?.length ?? 0) === 0 ? "No media yet" : onlyFavs && favs.size === 0 ? "No favorites yet" : "Nothing matches"}
          </p>
          {(items?.length ?? 0) === 0 && (
            <button type="button" data-testid="library-start" onClick={() => void startCreating()} className="h-9 px-4 rounded-[4px] text-[13px] font-medium bg-brand-accent text-black hover:brightness-110 cursor-pointer">
              Start creating
            </button>
          )}
        </div>
      ) : view === "grid" ? (
        <div className="mt-5 grid gap-x-5 gap-y-5" style={{ gridTemplateColumns: "repeat(auto-fill, 170px)" }}>
          {shown.map((i) => (
            <div key={i.path} data-testid="library-item" data-type={i.type} data-name={i.name} onContextMenu={openMenu(i.path)} className="group w-[170px] cursor-default">
              <div className="relative">
                <Picture item={i} className="w-[170px] h-[170px] rounded-[6px]" />
                {star(i, "absolute top-1.5 right-1.5 bg-black/55")}
                {i.type !== "image" && i.durationSec != null && (
                  <span className="absolute left-1.5 bottom-1.5 px-1 rounded-[3px] bg-black/60 text-[11px] text-white tabular-nums">{clockText(i.durationSec)}</span>
                )}
              </div>
              <div className="mt-2 text-[13px] text-[#dddddd] truncate" title={i.name}>
                {i.name}
              </div>
              <div className="text-[12px] text-[#7a7a7a] truncate" title={i.projects.join(", ")}>
                {sizeText(i.sizeBytes)} · {i.projects.length === 1 ? i.projects[0] : `${i.projects.length} projects`}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex flex-col text-[12px]">
          <div className="grid grid-cols-[44px_minmax(0,2fr)_70px_90px_110px_minmax(0,1.2fr)_28px] gap-3 px-2 pb-1.5 text-[#7a7a7a] border-b border-white/[0.07]">
            <span />
            <span>Name</span>
            <span>Type</span>
            <span>Size</span>
            <span>Edited</span>
            <span>Used in</span>
            <span />
          </div>
          {shown.map((i) => (
            <div
              key={i.path}
              data-testid="library-item"
              data-type={i.type}
              data-name={i.name}
              onContextMenu={openMenu(i.path)}
              className="group grid grid-cols-[44px_minmax(0,2fr)_70px_90px_110px_minmax(0,1.2fr)_28px] items-center gap-3 px-2 h-[52px] rounded-[6px] hover:bg-white/[0.04] text-[#cccccc]"
            >
              <Picture item={i} className="w-10 h-10 rounded-[4px]" />
              <span className="truncate text-brand-light/90" title={i.path}>{i.name}</span>
              <span className="text-brand-light/50 capitalize">{i.type}</span>
              <span className="tabular-nums text-brand-light/50">{metaText(i)}</span>
              <span className="text-brand-light/50">{dateText(i.modifiedMs)}</span>
              <span className="truncate text-brand-light/50">{i.projects.join(", ")}</span>
              {star(i, "")}
            </div>
          ))}
        </div>
      )}
      {contextMenu}
    </section>
  );
};
