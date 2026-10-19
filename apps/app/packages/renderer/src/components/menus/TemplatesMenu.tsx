import React, { useEffect, useMemo, useState } from "react";
import { LuLayoutTemplate, LuListFilter, LuLoader, LuPlus, LuSearch, LuSquarePlus, LuX } from "react-icons/lu";
import { toast } from "sonner";
import type { TemplateEntry } from "@app/preload";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { startFromTemplate } from "@/lib/project-actions";
import { clock, coverUrl, insertTemplate, useTemplatesTab } from "@/lib/templates-tab";
import { cn } from "@/lib/utils";

type Orientation = "all" | "landscape" | "portrait" | "square";

/** The Templates tab's column: your templates, then by the shape of their canvas. */
export const templateSections = () => [
  { id: "all", label: "Your templates", under: "Templates" },
  { id: "landscape", label: "Landscape", under: "Templates" },
  { id: "portrait", label: "Portrait", under: "Templates" },
  { id: "square", label: "Square", under: "Templates" },
];

export const orientationOf = (t: TemplateEntry): Exclude<Orientation, "all"> => {
  const a = t.aspectRatio;
  if (!a) return "landscape";
  return a.width === a.height ? "square" : a.width > a.height ? "landscape" : "portrait";
};

/**
 * One tall card, as CapCut's template cards: the cover, with its clip count and length over the
 * bottom edge and its name under. A click previews it in the player; hovered, "+" lays its clips
 * into this project at the playhead and the other button starts a new project from it.
 */
const Card: React.FC<{ t: TemplateEntry; active: boolean; busy: string | null; onUse: (t: TemplateEntry) => void; onNew: (t: TemplateEntry) => void }> = ({ t, active, busy, onUse, onNew }) => {
  const preview = useTemplatesTab((s) => s.preview);
  const setPreview = useTemplatesTab((s) => s.setPreview);
  const [hover, setHover] = useState(false);
  const cover = coverUrl(t);
  const working = busy === t.id;
  const circle = "h-[22px] px-1.5 rounded-full bg-black/65 hover:bg-black/85 text-white flex items-center justify-center gap-1 text-[10.5px] disabled:opacity-50";
  return (
    <div className="flex flex-col min-w-0" data-testid="templates-card" data-template-id={t.id} data-name={t.name}>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={active}
        aria-label={t.name}
        data-testid="templates-tile"
        onClick={() => setPreview(preview?.id === t.id ? null : t)}
        onKeyDown={(e) => e.key === "Enter" && setPreview(preview?.id === t.id ? null : t)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn("relative w-full aspect-[9/14] rounded-[4px] bg-[#0d0d0f] overflow-hidden cursor-pointer select-none outline-none", active && "ring-[1.5px] ring-brand-accent")}
      >
        {cover ? <img src={cover} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain" /> : <LuLayoutTemplate className="absolute inset-0 m-auto w-7 h-7 text-[#3a3a3e]" />}
        <span className="absolute left-1.5 right-1.5 bottom-1.5 text-[11px] leading-none text-white tabular-nums drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]" data-testid="templates-meta">
          {t.clipCount} clip{t.clipCount === 1 ? "" : "s"} | {clock(t.durationUs / 1e6)}
        </span>
        {(hover || working) && (
          <div className="absolute right-1 top-1 flex flex-col items-end gap-1">
            <button
              type="button"
              title="Add to this project at the playhead"
              data-testid="templates-use"
              disabled={!!busy}
              onClick={(e) => {
                e.stopPropagation();
                onUse(t);
              }}
              className={circle}
            >
              {working ? <LuLoader className="w-3 h-3 animate-spin" /> : <LuPlus className="w-3 h-3" />} Use
            </button>
            <button
              type="button"
              title="Start a new project from it"
              data-testid="templates-new"
              disabled={!!busy}
              onClick={(e) => {
                e.stopPropagation();
                onNew(t);
              }}
              className={circle}
            >
              <LuSquarePlus className="w-3 h-3" /> New
            </button>
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[11.5px] leading-tight text-brand-light/60 truncate" title={t.name} data-testid="templates-name">
        {t.name}
      </div>
    </div>
  );
};

/**
 * The editor's Templates tab, in CapCut's layout: a search field with a filter beside it, then
 * the templates saved from Home (a project's menu ▸ Save as template) as two columns of tall
 * cards. OpenRip has no template store, so these are your own.
 */
const TemplatesMenu: React.FC<{ part?: string }> = ({ part = "all" }) => {
  const items = useTemplatesTab((s) => s.items);
  const preview = useTemplatesTab((s) => s.preview);
  const [query, setQuery] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("all");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void useTemplatesTab.getState().load();
    // A preview lasts while the tab shows.
    return () => useTemplatesTab.getState().setPreview(null);
  }, []);

  const shape = part !== "all" ? (part as Orientation) : orientation;
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (items ?? []).filter((t) => (!q || t.name.toLowerCase().includes(q)) && (shape === "all" || orientationOf(t) === shape)), [items, q, shape]);

  const use = async (t: TemplateEntry) => {
    if (busy) return;
    setBusy(t.id);
    try {
      const n = await insertTemplate(t);
      toast.success(`Added ${n} clip${n === 1 ? "" : "s"} from “${t.name}”`, { position: "bottom-right", duration: 2500 });
    } catch (e) {
      toast.error((e as Error).message || "The template couldn't be added", { position: "bottom-right", duration: 4000 });
    } finally {
      setBusy(null);
    }
  };
  const fresh = async (t: TemplateEntry) => {
    if (busy) return;
    setBusy(t.id);
    try {
      await startFromTemplate(t.id, "");
    } catch (e) {
      toast.error((e as Error).message || "The project couldn't be created", { position: "bottom-right", duration: 4000 });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full flex flex-col" data-testid="templates-view">
      <div className="px-3.5 pt-3 pb-3 shrink-0 flex flex-row items-center gap-1.5">
        <label className="flex-1 min-w-0 h-[26px] flex flex-row items-center gap-1.5 px-2.5 rounded-[4px] bg-brand border border-transparent focus-within:border-[#515151]">
          <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
          <input data-testid="templates-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for templates" className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-lighter placeholder:text-[#6c6c6c] outline-none" />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="w-3.5 h-3.5 rounded-full bg-[#6c6c6c] text-brand flex items-center justify-center hover:bg-[#8a8a8a]">
              <LuX className="w-2.5 h-2.5" />
            </button>
          )}
        </label>
        <Select value={shape} onValueChange={(v) => setOrientation(v as Orientation)} disabled={part !== "all"}>
          <SelectTrigger size="sm" aria-label="Shape" data-testid="templates-shape" className="!h-[26px] w-[52px] shrink-0 px-1.5 gap-0.5 text-[12px] bg-transparent border-0 text-[#949494] hover:text-brand-light [&>svg:last-child]:w-3">
            <LuListFilter className="w-3.5 h-3.5" />
          </SelectTrigger>
          <SelectContent className="bg-brand-background text-brand-light font-poppins z-[101] dark">
            {(["all", "landscape", "portrait", "square"] as Orientation[]).map((o) => (
              <SelectItem key={o} value={o} className="text-[12px]">
                {o === "all" ? "All shapes" : o[0].toUpperCase() + o.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col pl-3.5 pr-3 pb-8 text-left">
          {items == null ? null : items.length === 0 ? (
            <div data-testid="templates-empty" className="flex flex-col items-center gap-3 px-3 py-14 text-center">
              <LuLayoutTemplate className="w-6 h-6 text-brand-light/35" />
              <h3 className="text-[12px] font-medium text-brand-light/85">No templates yet</h3>
              <p className="text-[11px] leading-relaxed text-brand-light/50 max-w-[260px]">
                To make one, go Home, open a project's menu (the three dots on its card) and choose Save as template. It comes back here with its clips, text, effects and media, ready to add to any project.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p data-testid="templates-none" className="text-[12px] text-[#6c6c6c] leading-snug py-6">
              No template matches.
            </p>
          ) : (
            <>
              <h3 className="text-[12.5px] text-brand-light leading-none mb-3">{part === "all" ? "Your templates" : part[0].toUpperCase() + part.slice(1)}</h3>
              <div data-testid="templates-grid" className="grid grid-cols-2 gap-x-2.5 gap-y-3">
                {shown.map((t) => (
                  <Card key={t.id} t={t} active={preview?.id === t.id} busy={busy} onUse={use} onNew={fresh} />
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default TemplatesMenu;
