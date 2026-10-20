import React, { useEffect, useMemo, useState } from "react";
import { LuCheck, LuChevronDown, LuChevronLeft, LuClapperboard, LuFolderOpen, LuLayoutGrid, LuList, LuLoader, LuSearch } from "react-icons/lu";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { capcutImport, capcutListDrafts, capcutPickDraft, type CapCutDraft } from "@app/preload";
import type { ProjectSettings } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { editedLabel, fileUrl, homeMenu, homeMenuRow, homeTool, lengthLabel, middle } from "./shared";

const VIEW_KEY = "openrip:capcut-view";

/** "18 Oct", or "18 Oct 2025" from another year. */
const dayLabel = (ms: number) => {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
};

/** A folder with the home folder as "~". */
const homePath = (folder: string) => folder.replace(/^\/Users\/[^/]+/, "~");

/** A draft's cover, or the clapperboard when CapCut kept none. */
const DraftCover: React.FC<{ draft: CapCutDraft; icon: string }> = ({ draft, icon }) =>
  draft.cover ? <img src={fileUrl(draft.cover)} alt="" className="w-full h-full object-cover" loading="lazy" draggable={false} /> : <LuClapperboard className={icon} />;

/**
 * The home screen's page for CapCut drafts (Home ▸ CapCut project, or the editor's menu): the
 * drafts on this Mac laid out as the home screen lays out projects — the same cards, toolbar,
 * grid and list — and a folder picked by hand. Opening a draft makes a new OpenRip project from
 * it; the draft itself is only read.
 */
export const CapCutDraftsPage: React.FC<{ onBack: () => void; onImported: (project: ProjectSettings) => void }> = ({ onBack, onImported }) => {
  const [drafts, setDrafts] = useState<CapCutDraft[] | null>(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<"edited" | "name">("edited");
  const [view, setViewState] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const setView = (v: "grid" | "list") => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* the view just isn't remembered */
    }
  };
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void capcutListDrafts().then(setDrafts, () => setDrafts([]));
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (drafts ?? []).filter((d) => !q || d.name.toLowerCase().includes(q));
    return sort === "name" ? [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : [...list].sort((a, b) => b.modifiedMs - a.modifiedMs);
  }, [drafts, search, sort]);

  const importFrom = async (folder: string) => {
    if (busy) return;
    setBusy(folder);
    try {
      const r = await capcutImport(folder);
      if (!r.success) {
        toast.error(`Couldn't open the draft: ${r.error}`, { position: "bottom-right" });
        return;
      }
      onImported({ ...r.data, createdAt: Date.now(), lastModified: Date.now() } as ProjectSettings);
      if (r.missingMedia.length > 0) {
        toast.warning(`${r.missingMedia.length} media file${r.missingMedia.length > 1 ? "s" : ""} the draft uses ${r.missingMedia.length > 1 ? "aren't" : "isn't"} on this Mac`, { position: "bottom-right", duration: 6000 });
      } else {
        toast.success(`Opened “${r.data.name}” from CapCut`, { position: "bottom-right" });
      }
    } finally {
      setBusy(null);
    }
  };

  const pick = async () => {
    const folder = await capcutPickDraft();
    if (folder) await importFrom(folder);
  };

  const toolbar = (
    <div className="flex items-center gap-2">
      {searching ? (
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onBlur={() => !search && setSearching(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
              setSearching(false);
            }
          }}
          placeholder="Search drafts"
          data-testid="capcut-search"
          className="w-[252px] h-[26px] rounded-[4px] px-2 text-[12px] bg-brand-background-dark border-[0.5px] border-[#3a3a3a] text-brand-light placeholder:text-brand-light/35"
        />
      ) : (
        <button type="button" title="Search" data-testid="capcut-search-open" onClick={() => setSearching(true)} className={cn(homeTool, "w-[23px] px-0")}>
          <LuSearch className="w-3.5 h-3.5" />
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger title="View and sort" data-testid="capcut-view" className={homeTool}>
          {view === "grid" ? <LuLayoutGrid className="w-3.5 h-3.5" /> : <LuList className="w-3.5 h-3.5" />}
          <LuChevronDown className="w-3 h-3 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={cn(homeMenu, "w-40")}>
          {([
            ["grid", LuLayoutGrid, "Grid"],
            ["list", LuList, "List"],
          ] as const).map(([v, Icon, label]) => (
            <DropdownMenuItem key={v} data-testid={`capcut-view-${v}`} className={cn(homeMenuRow, view === v && "text-brand-accent")} onClick={() => setView(v)}>
              <Icon className="w-4 h-4" /> {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator className="bg-brand-hover mx-1" />
          <DropdownMenuLabel className="px-2.5 py-1 text-[11px] font-normal text-[#7a7a7a]">Sort by</DropdownMenuLabel>
          {([
            ["edited", "Last edited"],
            ["name", "Name"],
          ] as const).map(([key, label]) => (
            <DropdownMenuItem key={key} data-testid={`capcut-sort-${key}`} className={cn(homeMenuRow, sort === key && "text-brand-accent")} onClick={() => setSort(key)}>
              <span className="w-4 flex items-center">{sort === key && <LuCheck className="w-3.5 h-3.5" />}</span>
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" disabled={!!busy} onClick={() => void pick()} data-testid="capcut-pick" className={cn(homeTool, "px-2 disabled:opacity-50")}>
        <LuFolderOpen className="w-3.5 h-3.5" /> Choose a folder…
      </button>
    </div>
  );

  const spinner = (folder: string) =>
    busy === folder && (
      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
        <LuLoader className="w-5 h-5 text-brand-light animate-spin" />
      </div>
    );

  const grid = (
    <div className="grid gap-x-[22px] gap-y-4" style={{ gridTemplateColumns: "repeat(auto-fill, 124px)" }}>
      {shown.map((d) => (
        <button
          key={d.folder}
          type="button"
          data-testid="capcut-draft"
          data-name={d.name}
          disabled={!!busy}
          onClick={() => void importFrom(d.folder)}
          title={`Open “${d.name}” as a new project`}
          className={cn("group w-[124px] flex flex-col gap-1.5 text-left min-w-0 focus-visible:outline-none", busy ? "cursor-wait" : "cursor-pointer", busy && busy !== d.folder && "opacity-50")}
        >
          <div className="relative w-[124px] h-[123px] rounded-[6px] overflow-hidden bg-brand-background flex items-center justify-center text-brand-light/25 transition-[filter] group-hover:brightness-125 group-focus-visible:ring-2 group-focus-visible:ring-brand-accent">
            <DraftCover draft={d} icon="w-6 h-6" />
            {spinner(d.folder)}
          </div>
          <div className="flex flex-col min-w-0 gap-0.5">
            <span className="text-[13px] text-[#cccccc] whitespace-nowrap">{middle(d.name, 19)}</span>
            <span className="text-[11.5px] text-[#7a7a7a] tabular-nums whitespace-nowrap">
              {lengthLabel(d.durationUs)}
              {d.modifiedMs ? ` | ${dayLabel(d.modifiedMs)}` : ""}
            </span>
          </div>
        </button>
      ))}
    </div>
  );

  const list = (
    <div className="flex flex-col">
      <div className="grid grid-cols-[36px_minmax(0,2fr)_70px_minmax(0,1fr)_minmax(0,1.6fr)] gap-3 px-2 pb-1.5 text-[11.5px] text-[#7a7a7a] text-left border-b border-brand mb-1">
        <span />
        <span>Name</span>
        <span>Length</span>
        <span>Edited</span>
        <span>Folder</span>
      </div>
      {shown.map((d) => (
        <button
          key={d.folder}
          type="button"
          data-testid="capcut-draft"
          data-name={d.name}
          disabled={!!busy}
          onClick={() => void importFrom(d.folder)}
          title={`Open “${d.name}” as a new project`}
          className={cn(
            "grid grid-cols-[36px_minmax(0,2fr)_70px_minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-3 px-2 h-[46px] rounded-[6px] hover:bg-brand text-[12px] text-left",
            busy ? "cursor-wait" : "cursor-pointer",
            busy && busy !== d.folder && "opacity-50",
          )}
        >
          <span className="relative w-9 h-9 rounded-[4px] overflow-hidden bg-brand-background flex items-center justify-center text-brand-light/25">
            <DraftCover draft={d} icon="w-4 h-4" />
            {spinner(d.folder)}
          </span>
          <span className="truncate text-brand-light/90">{d.name}</span>
          <span className="tabular-nums text-brand-light/50">{lengthLabel(d.durationUs)}</span>
          <span className="truncate text-brand-light/50">{editedLabel(d.modifiedMs)}</span>
          {/* Cut from the left, so the draft's own folder at the end stays in view. */}
          <span className="truncate text-[11px] text-brand-light/35 [direction:rtl] text-left" title={d.folder}>
            <bdi>{homePath(d.folder)}</bdi>
          </span>
        </button>
      ))}
    </div>
  );

  const note = (text: React.ReactNode) => <p className="text-[12px] text-brand-light/50 text-left py-6">{text}</p>;

  return (
    <section data-testid="capcut-page" className="flex flex-col text-left pt-5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="Back to Home"
          data-testid="capcut-back"
          onClick={onBack}
          className="h-8 w-8 -ml-2 rounded-[6px] flex items-center justify-center text-brand-light/80 hover:bg-white/[0.07] cursor-pointer"
        >
          <LuChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-[24px] font-bold text-brand-lighter leading-8">CapCut drafts</h1>
      </div>
      <p className="mt-1 text-[13px] leading-5 text-brand-light/50 max-w-[640px]">
        Open a draft as a new OpenRip project: its clips can be moved, trimmed and retyped, and its captions, effects and animations look as they do in CapCut. The draft itself is only read, never changed.
      </p>

      <div className="mt-7 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[16px] font-bold text-brand-light">
            Drafts
            {drafts && drafts.length > 0 && <span className="ml-2 text-[13px] font-normal text-[#7a7a7a] tabular-nums">{drafts.length}</span>}
          </h2>
          {toolbar}
        </div>
        {drafts === null ? (
          <p className="text-[12px] text-brand-light/50 py-6 flex items-center gap-2">
            <LuLoader className="w-3.5 h-3.5 animate-spin" /> Looking for CapCut drafts…
          </p>
        ) : drafts.length === 0 ? (
          note("No CapCut drafts were found on this Mac. Choose a draft's folder to open it.")
        ) : shown.length === 0 ? (
          note(`No draft is named like “${search.trim()}”.`)
        ) : view === "grid" ? (
          grid
        ) : (
          list
        )}
      </div>
    </section>
  );
};

export default CapCutDraftsPage;
