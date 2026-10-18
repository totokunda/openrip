import React, { useEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuSearch, LuStar } from "react-icons/lu";
import { IoCaretDown } from "react-icons/io5";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { allFonts, useFontsStore, type FontOption } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { Stepper } from "./controls";

/**
 * Text ▸ Basic's font dropdown, as CapCut's (docs/plan/capcut-ui-spec.md §4.8a): a 22 px
 * dropdown showing the font in itself, a stepper that moves to the font before or after it,
 * and a ≈258 px popover with a search field, filter chips, the recently used and favourite
 * fonts, then the app's bundled fonts and the installed ones, each row drawn in its font with
 * a tick on the current one. The engine draws the same fonts (lib/fonts.ts).
 */

const FAVORITES_KEY = "openrip:favorite-fonts";

const readFavorites = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

type Filter = "all" | "bundled" | "system";

const css = (family: string) => `"${family.replace(/"/g, "")}"`;

const FontPicker: React.FC<{ value: string; onChange: (family: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [favorites, setFavorites] = useState<string[]>(readFavorites);
  const bundled = useFontsStore((s) => s.bundled);
  const system = useFontsStore((s) => s.system);
  const recent = useFontsStore((s) => s.recent);
  const use = useFontsStore((s) => s.use);
  const load = useFontsStore((s) => s.load);
  const fonts = useMemo(() => allFonts({ bundled, system }), [bundled, system]);
  const search = useRef<HTMLInputElement>(null);

  // Without the engine nothing fills the lists: read the page's own fonts at least.
  useEffect(() => {
    if (!bundled.length) void load();
  }, []);

  const pick = (family: string) => {
    use(family);
    onChange(family);
  };
  const close = () => {
    setOpen(false);
    setQuery("");
    setFilter("all");
  };
  const step = (by: number) => {
    const i = fonts.findIndex((f) => f.family === value);
    const next = fonts[(Math.max(0, i) + by + fonts.length) % fonts.length];
    if (next) pick(next.family);
  };
  const toggleFavorite = (family: string) => {
    const next = favorites.includes(family) ? favorites.filter((f) => f !== family) : [...favorites, family];
    setFavorites(next);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {}
  };

  const q = query.trim().toLowerCase();
  const shown = (list: FontOption[]) => list.filter((f) => (filter === "all" || f.kind === filter) && (!q || f.family.toLowerCase().includes(q)));
  const byName = (names: string[]) => names.map((n) => fonts.find((f) => f.family === n)).filter((f): f is FontOption => !!f);
  const groups: { title: string; fonts: FontOption[] }[] = [
    ...(q ? [] : [{ title: "Recently used", fonts: shown(byName(recent)) }, { title: "Favorites", fonts: shown(byName(favorites)) }]),
    { title: "Bundled", fonts: shown(fonts.filter((f) => f.kind === "bundled")) },
    { title: "System", fonts: shown(fonts.filter((f) => f.kind === "system")) },
  ].filter((g) => g.fonts.length);

  const row = (f: FontOption, group: string) => (
    <div
      key={`${group}:${f.family}`}
      role="option"
      aria-selected={f.family === value}
      data-font={f.family}
      onClick={() => {
        pick(f.family);
        close();
      }}
      className="group h-7 shrink-0 flex flex-row items-center gap-2 pl-2 pr-1.5 rounded-[4px] cursor-pointer hover:bg-brand-hover"
      // Rows out of view aren't laid out: there can be hundreds of installed fonts.
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 28px" }}
    >
      <span className="w-3.5 shrink-0 text-brand-accent">{f.family === value && <LuCheck className="w-3.5 h-3.5" />}</span>
      <span className="flex-1 min-w-0 truncate text-[13px] text-brand-light" style={{ fontFamily: css(f.family) }}>
        {f.family}
      </span>
      <button
        type="button"
        title={favorites.includes(f.family) ? "Remove from favorites" : "Add to favorites"}
        aria-label={favorites.includes(f.family) ? `Remove ${f.family} from favorites` : `Add ${f.family} to favorites`}
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(f.family);
        }}
        className={cn("w-5 h-5 shrink-0 flex items-center justify-center rounded-[3px]", favorites.includes(f.family) ? "text-brand-light" : "text-brand-light/0 group-hover:text-brand-light/60")}
      >
        <LuStar className="w-3.5 h-3.5" fill={favorites.includes(f.family) ? "currentColor" : "none"} />
      </button>
    </div>
  );

  return (
    <div className="flex-1 min-w-0 flex flex-row items-center gap-0.5">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // Each time it opens on every font.
          if (!o) {
            setQuery("");
            setFilter("all");
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="text-font"
            data-font={value}
            aria-label="Font"
            className="flex-1 min-w-0 h-[22px] rounded-[4px] bg-brand-background-light hover:bg-brand-button flex flex-row items-center justify-between pl-2.5 pr-2 transition-colors"
          >
            <span className="truncate text-[12px] text-brand-lighter" style={{ fontFamily: css(value) }}>
              {value}
            </span>
            <IoCaretDown className="w-2.5 h-2.5 text-brand-light shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            search.current?.focus();
          }}
          className="w-[258px] p-0 rounded-[8px] bg-brand-header border-[0.5px] border-[#494949] shadow-[0_0_0_0.5px_#000,0_8px_24px_rgba(0,0,0,0.5)] text-brand-light"
        >
          <div className="p-2 pb-1 flex flex-col gap-2">
            <label className="h-[25px] flex flex-row items-center gap-1.5 px-2 rounded-[4px] bg-brand border border-transparent focus-within:border-[#515151]">
              <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
              <input
                ref={search}
                data-testid="font-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const first = groups[0]?.fonts[0];
                    if (first) {
                      pick(first.family);
                      close();
                    }
                  }
                }}
                placeholder="Search fonts"
                className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-lighter placeholder:text-[#6c6c6c] outline-none"
              />
            </label>
            <div className="flex flex-row gap-1.5" role="tablist">
              {(["all", "bundled", "system"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn("h-5 px-2.5 rounded-full text-[12px]", filter === f ? "bg-brand-button text-brand-light" : "bg-brand-background-light text-[#949494] hover:text-brand-light")}
                >
                  {f === "all" ? "All" : f === "bundled" ? "Bundled" : "System"}
                </button>
              ))}
            </div>
          </div>
          <div role="listbox" aria-label="Fonts" className="max-h-[320px] overflow-y-auto px-1.5 pb-2 flex flex-col">
            {groups.map((g) => (
              <React.Fragment key={g.title}>
                <div className="h-7 shrink-0 flex items-end pb-1 mx-2 mb-0.5 text-[12px] text-[#6c6c6c] border-b border-brand-divider">{g.title}</div>
                {g.fonts.map((f) => row(f, g.title))}
              </React.Fragment>
            ))}
            {!groups.length && <div className="px-3 py-6 text-center text-[12px] text-[#6c6c6c]">No fonts match “{query}”</div>}
          </div>
        </PopoverContent>
      </Popover>
      <Stepper label="Font" onUp={() => step(-1)} onDown={() => step(1)} />
    </div>
  );
};

export default FontPicker;
