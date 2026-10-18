import React, { useEffect, useMemo, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuEllipsis,
  LuFolderInput,
  LuFolderOpen,
  LuHouse,
  LuChevronDown,
  LuLayoutGrid,
  LuLayoutTemplate,
  LuList,
  LuLibrary,
  LuLoader,
  LuPencil,
  LuPlay,
  LuPlus,
  LuSearch,
  LuTrash2,
  LuUpload,
} from "react-icons/lu";
import { toast } from "sonner";
import { useProjectsStore, type ProjectSettings } from "@/lib/projects";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useShellStore } from "@/lib/shell";
import { useSidebarStore } from "@/lib/sidebar";
import { ASPECT_PRESETS, ratioBox } from "@/lib/aspect-presets";
import { createAndOpenProject, deleteProjectAnywhere, openProject, refreshProjects, renameProject } from "@/lib/project-actions";
import { revealPathInFolder } from "@app/preload";
import { CapCutImportDialog } from "@/components/dialogs/CapCutImportDialog";
import { SettingsModal } from "@/components/dialogs/SettingsModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The home screen, laid out as CapCut's: a sidebar (Home, Templates, Library), a banner to
 * create a project (at a size, or sized by its first clip), quick starts (a CapCut draft, an
 * import, the last project), and every project as a card or a row with its cover, length and
 * size. Opening one goes to the editor; the editor's top bar comes back here.
 */

type SortKey = "edited" | "name" | "created";
type ViewKind = "grid" | "list";

const menu = "dark p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light";
const menuRow = "dark h-8 px-2.5 gap-2.5 rounded-[4px] text-[13px] cursor-pointer focus:bg-brand-hover";

const VIEW_KEY = "openrip:home-view";

/** "Edited 5 min ago", "Edited yesterday", "Edited 12 Oct". */
const editedLabel = (ms?: number) => {
  if (!ms) return "Never edited";
  const s = (Date.now() - ms) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
  if (s < 60) return "Edited just now";
  if (s < 3600) return `Edited ${rtf.format(-Math.round(s / 60), "minute")}`;
  if (s < 86400) return `Edited ${rtf.format(-Math.round(s / 3600), "hour")}`;
  if (s < 7 * 86400) return `Edited ${rtf.format(-Math.round(s / 86400), "day")}`;
  return `Edited ${new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
};

const ratioLabel = (a?: ProjectSettings["aspectRatio"]) => {
  if (!a) return "16:9";
  return /^\d+:\d+$/.test(a.id) ? a.id : `${a.width}:${a.height}`;
};

/** "13.2K", "1.4M": a file's size as CapCut's cards show it. */
const sizeLabel = (bytes?: number) => {
  if (bytes == null) return "–";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
};

/** "00:20", or "1:02:05" past an hour. */
const lengthLabel = (us?: number) => {
  const s = Math.round((us ?? 0) / 1e6);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** A long name cut in the middle, so its start and end both show ("openrip-c…landscape"). */
const middle = (name: string, max: number) => {
  if (name.length <= max) return name;
  const head = Math.ceil((max - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (max - 1 - head))}`;
};

/** The canvas's shape as an outlined frame, the home screen's way of showing a size. */
const RatioFrame: React.FC<{ width: number; height: number; size: number; className?: string }> = ({ width, height, size, className }) => {
  const box = ratioBox(width, height, size);
  return <div className={cn("rounded-[2px] border-[1.5px] border-current", className)} style={{ width: box.width, height: box.height }} />;
};

/** The open project's length comes from the editor, which may not have saved it yet. */
const useLength = (project: ProjectSettings, active: boolean) => {
  const frames = useClipStore((s) => s.clipDuration);
  const fps = useControlsStore((s) => s.fps);
  return active && fps > 0 ? (frames / fps) * 1e6 : project.durationUs;
};

/** A project's cover, cropped to its box, or its canvas's shape when it has none. */
const Cover: React.FC<{ project: ProjectSettings; frame: number; fit?: "cover" | "contain" }> = ({ project, frame, fit = "cover" }) => {
  const aspect = project.aspectRatio ?? { width: 16, height: 9, id: "16:9" };
  // Covers are rewritten in place: their time keeps the browser from showing an old one.
  const src = project.coverPath ? `app://user-data${encodeURI(project.coverPath)}?v=${project.lastModified ?? 0}` : null;
  return src ? (
    <img src={src} alt="" className={cn("w-full h-full", fit === "cover" ? "object-cover" : "object-contain")} loading="lazy" draggable={false} />
  ) : (
    <RatioFrame width={aspect.width} height={aspect.height} size={frame} />
  );
};

/** A project's menu: open, rename, show its file, delete. */
const ProjectMenu: React.FC<{
  project: ProjectSettings;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  className?: string;
}> = ({ project, onOpen, onRename, onDelete, className }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      aria-label={`More for ${project.name}`}
      className={cn("h-6 w-6 rounded-[5px] flex items-center justify-center text-brand-light/80 hover:text-brand-light cursor-pointer", className)}
    >
      <LuEllipsis className="w-3.5 h-3.5" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className={cn(menu, "w-44")}>
      <DropdownMenuItem className={menuRow} onClick={onOpen}>
        <LuPlay className="w-4 h-4" /> Open
      </DropdownMenuItem>
      <DropdownMenuItem className={menuRow} onClick={onRename}>
        <LuPencil className="w-4 h-4" /> Rename
      </DropdownMenuItem>
      {project.filePath && (
        <DropdownMenuItem className={menuRow} onClick={() => void revealPathInFolder(project.filePath!)}>
          <LuFolderOpen className="w-4 h-4" /> Show the file
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator className="bg-brand-hover mx-1" />
      <DropdownMenuItem className={cn(menuRow, "text-red-400 focus:text-red-300")} onClick={onDelete}>
        <LuTrash2 className="w-4 h-4" /> Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

/** The name, or a field to rename it in place. */
const useRename = (project: ProjectSettings) => {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const start = () => {
    setDraft(project.name);
    setRenaming(true);
  };
  const commit = async () => {
    setRenaming(false);
    try {
      await renameProject(project, draft);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't rename the project");
      setDraft(project.name);
    }
  };
  const field = (
    <input
      value={draft}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(project.name);
          setRenaming(false);
        }
      }}
      className="h-5 w-full text-[12px] text-brand-light bg-brand border border-brand-light/20 rounded-[4px] px-1"
    />
  );
  return { renaming, start, field };
};

interface CardProps {
  project: ProjectSettings;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

/** A project in the grid: its cover in a square-ish box, its name and "size | length". */
const ProjectCard: React.FC<CardProps> = ({ project, active, onOpen, onDelete }) => {
  const { renaming, start, field } = useRename(project);
  const length = useLength(project, active);
  return (
    <div data-testid="project-card" data-project-id={project.id} data-active={active ? "true" : "false"} className="group w-[124px] flex flex-col gap-1.5 min-w-0">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          title={`Open ${project.name}`}
          className="w-[124px] h-[123px] rounded-[6px] overflow-hidden bg-brand-background flex items-center justify-center text-brand-light/25 transition-[filter] group-hover:brightness-125 focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-none cursor-pointer"
        >
          <Cover project={project} frame={48} />
        </button>
        <ProjectMenu
          project={project}
          onOpen={onOpen}
          onRename={start}
          onDelete={onDelete}
          className="absolute top-1.5 right-1.5 bg-black/60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity"
        />
      </div>
      <div className="flex flex-col min-w-0 text-left gap-0.5">
        {renaming ? (
          field
        ) : (
          <span className="text-[13px] text-[#cccccc] whitespace-nowrap" title={project.name} data-testid="project-name">
            {middle(project.name, 19)}
          </span>
        )}
        <span className="text-[11.5px] text-[#7a7a7a] tabular-nums">
          {sizeLabel(project.sizeBytes)} | {lengthLabel(length)}
        </span>
      </div>
    </div>
  );
};

/** A project as a row: cover, name, ratio, length, size, when it was edited, and its file. */
const ProjectRow: React.FC<CardProps & { showPath?: boolean }> = ({ project, active, onOpen, onDelete, showPath }) => {
  const { renaming, start, field } = useRename(project);
  const length = useLength(project, active);
  return (
    <div
      data-testid="project-card"
      data-project-id={project.id}
      data-active={active ? "true" : "false"}
      className="group grid grid-cols-[36px_minmax(0,2fr)_60px_70px_70px_minmax(0,1.2fr)_28px] items-center gap-3 px-2 h-[46px] rounded-[6px] hover:bg-brand text-[12px] text-[#cccccc]"
    >
      <button
        type="button"
        onClick={onOpen}
        title={`Open ${project.name}`}
        className="w-9 h-9 rounded-[4px] overflow-hidden bg-brand-background flex items-center justify-center text-brand-light/25 cursor-pointer"
      >
        <Cover project={project} frame={20} />
      </button>
      <div className="min-w-0 text-left">
        {renaming ? (
          field
        ) : (
          <button type="button" onClick={onOpen} className="block truncate text-brand-light/90 text-left max-w-full cursor-pointer" title={project.name}>
            {project.name}
          </button>
        )}
        {showPath && project.filePath && <div className="truncate text-[10.5px] text-brand-light/35">{project.filePath}</div>}
      </div>
      <span className="tabular-nums text-brand-light/50">{ratioLabel(project.aspectRatio)}</span>
      <span className="tabular-nums text-brand-light/50">{lengthLabel(length)}</span>
      <span className="tabular-nums text-brand-light/50">{sizeLabel(project.sizeBytes)}</span>
      <span className="truncate text-brand-light/50 text-left">{editedLabel(project.lastModified)}</span>
      <ProjectMenu project={project} onOpen={onOpen} onRename={start} onDelete={onDelete} className="hover:bg-brand-light/10" />
    </div>
  );
};

const NavItem: React.FC<{ icon: IconType; label: string; active: boolean; onClick: () => void; testId: string }> = ({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
}) => (
  <button
    type="button"
    data-testid={testId}
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      "w-full h-8 flex items-center gap-3 px-2.5 rounded-[6px] text-[13px] transition-colors cursor-pointer",
      active ? "bg-[#221b29] text-brand-light" : "text-[#cccccc] hover:text-brand-light hover:bg-white/[0.04]",
    )}
  >
    <Icon className="w-3.5 h-3.5" />
    {label}
  </button>
);

/** A start that isn't a blank project: a CapCut draft, an import, the last project. */
const QuickStart: React.FC<{ icon: IconType; title: string; note: string; onClick: () => void; testId: string; busy?: boolean }> = ({
  icon: Icon,
  title,
  note,
  onClick,
  testId,
  busy,
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    disabled={busy}
    className="w-[188px] h-[136px] shrink-0 flex flex-col justify-between p-3 rounded-[8px] bg-white/[0.035] hover:bg-white/[0.06] transition-colors text-left cursor-pointer disabled:cursor-wait"
  >
    <span className="h-9 w-9 rounded-[6px] bg-white/[0.06] flex items-center justify-center text-brand-light">
      {busy ? <LuLoader className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
    </span>
    <span className="flex flex-col min-w-0 gap-0.5">
      <span className="text-[14px] font-semibold text-brand-lighter truncate">{title}</span>
      <span className="text-[12px] text-[#949494] line-clamp-2">{note}</span>
    </span>
  </button>
);

const HomeScreen: React.FC = () => {
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const addProject = useProjectsStore((s) => s.addProject);
  const section = useShellStore((s) => s.homeSection);
  const setSection = useShellStore((s) => s.setHomeSection);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("edited");
  const [view, setViewState] = useState<ViewKind>(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const [creating, setCreating] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [capcutOpen, setCapcutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ProjectSettings | null>(null);
  const [deleting, setDeleting] = useState(false);
  const refreshed = useRef(false);

  // Lengths and sizes from the projects' files, once per visit.
  useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    void refreshProjects();
  }, []);

  const setView = (v: ViewKind) => {
    setViewState(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = projects.filter((p) => !q || (p.name ?? "").toLowerCase().includes(q));
    const by: Record<SortKey, (a: ProjectSettings, b: ProjectSettings) => number> = {
      edited: (a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0),
      created: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      name: (a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true }),
    };
    return [...list].sort(by[sort]);
  }, [projects, search, sort]);
  const last = useMemo(() => projects.find((p) => p.id === activeProjectId) ?? null, [projects, activeProjectId]);

  const create = async (key: string, aspect?: { width: number; height: number; id: string }, thenImport = false) => {
    if (creating) return;
    setCreating(key);
    try {
      if (thenImport) {
        useSidebarStore.getState().openSection("media");
        useShellStore.getState().setImportOnOpen(true);
      }
      await createAndOpenProject(aspect);
    } catch (e) {
      useShellStore.getState().setImportOnOpen(false);
      toast.error((e as Error).message || "Couldn't create the project");
    } finally {
      setCreating(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteProjectAnywhere(toDelete);
      toast(`Deleted “${toDelete.name}”`);
      setToDelete(null);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't delete the project");
    } finally {
      setDeleting(false);
    }
  };

  const list = (items: ProjectSettings[], showPath = false) =>
    view === "grid" && !showPath ? (
      <div className="grid gap-x-[22px] gap-y-4" style={{ gridTemplateColumns: "repeat(auto-fill, 124px)" }}>
        {items.map((p) => (
          <ProjectCard key={p.id} project={p} active={p.id === activeProjectId} onOpen={() => openProject(p.id)} onDelete={() => setToDelete(p)} />
        ))}
      </div>
    ) : (
      <div className="flex flex-col">
        <div className="grid grid-cols-[36px_minmax(0,2fr)_60px_70px_70px_minmax(0,1.2fr)_28px] gap-3 px-2 pb-1.5 text-[11.5px] text-[#7a7a7a] text-left border-b border-brand mb-1">
          <span />
          <span>Name</span>
          <span>Ratio</span>
          <span>Length</span>
          <span>Size</span>
          <span>Edited</span>
          <span />
        </div>
        {items.map((p) => (
          <ProjectRow key={p.id} project={p} active={p.id === activeProjectId} showPath={showPath} onOpen={() => openProject(p.id)} onDelete={() => setToDelete(p)} />
        ))}
      </div>
    );

  const tool = "h-6 px-1.5 flex items-center justify-center gap-1 rounded-[4px] bg-[#29292d] hover:bg-[#333338] text-brand-light/85 text-[12px] transition-colors cursor-pointer";
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
          placeholder="Search project name"
          data-testid="home-search"
          className="w-[252px] h-[26px] rounded-[4px] px-2 text-[12px] bg-brand-background-dark border-[0.5px] border-[#3a3a3a] text-brand-light placeholder:text-brand-light/35"
        />
      ) : (
        <button type="button" title="Search" data-testid="home-search-open" onClick={() => setSearching(true)} className={cn(tool, "w-[23px] px-0")}>
          <LuSearch className="w-3.5 h-3.5" />
        </button>
      )}
      {section === "home" && (
        <DropdownMenu>
          <DropdownMenuTrigger title="View" data-testid="home-view" className={tool}>
            {view === "grid" ? <LuLayoutGrid className="w-3.5 h-3.5" /> : <LuList className="w-3.5 h-3.5" />}
            <LuChevronDown className="w-3 h-3 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(menu, "w-32")}>
            {([
              ["grid", LuLayoutGrid, "Grid"],
              ["list", LuList, "List"],
            ] as const).map(([v, Icon, label]) => (
              <DropdownMenuItem key={v} data-testid={`home-view-${v}`} className={cn(menuRow, view === v && "text-brand-accent")} onClick={() => setView(v)}>
                <Icon className="w-4 h-4" /> {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
        <SelectTrigger size="sm" className="w-[118px] !h-6 px-2 text-[12px] bg-[#29292d] border-transparent rounded-[4px] text-brand-light/85">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="dark bg-brand-header text-brand-light">
          <SelectItem value="edited" className="text-[12px]">Last edited</SelectItem>
          <SelectItem value="created" className="text-[12px]">Newest first</SelectItem>
          <SelectItem value="name" className="text-[12px]">Name</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  const empty = (
    <p className="text-[12px] text-brand-light/50 text-left py-6">
      {projects.length === 0 ? "No projects yet. Create one above." : `No project is named like “${search.trim()}”.`}
    </p>
  );

  return (
    <div
      data-testid="home"
      className="w-full h-screen flex text-brand-light select-none"
      style={{ background: "linear-gradient(180deg, #16101b 0%, #0c0b0d 45%, #090909 100%)" }}
    >
      <aside className="w-[216px] shrink-0 flex flex-col gap-3 px-5 pt-5">
        <div className="h-8 px-2.5 flex items-center text-[15px] font-semibold tracking-tight mb-2">OpenRip</div>
        <NavItem icon={LuHouse} label="Home" active={section === "home"} onClick={() => setSection("home")} testId="home-nav-home" />
        <NavItem icon={LuLayoutTemplate} label="Templates" active={section === "templates"} onClick={() => setSection("templates")} testId="home-nav-templates" />
        <div className="h-px bg-white/[0.06] my-1" />
        <div className="px-2.5 text-[12px] text-[#949494] text-left">Management</div>
        <NavItem icon={LuLibrary} label="Library" active={section === "library"} onClick={() => setSection("library")} testId="home-nav-library" />
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-11 shrink-0 flex items-center justify-end px-4 [&_button]:!w-6 [&_button]:!h-6 [&_button]:!border-0 [&_button]:!bg-transparent [&_button:hover]:!bg-white/[0.06]">
          <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <div className="pl-6 pr-[60px] pb-16 flex flex-col gap-7">
            {section === "home" && (
              <>
                <section className="flex flex-col gap-3">
                  <div
                    className="relative h-[143px] rounded-[8px] overflow-hidden flex flex-col items-center justify-center gap-3"
                    style={{ background: "linear-gradient(110deg, #6e4d8d 0%, #9a73bd 50%, #c3a3dc 100%)" }}
                  >
                    <button
                      type="button"
                      data-testid="new-project"
                      disabled={!!creating}
                      onClick={() => void create("default")}
                      className="flex items-center gap-3 text-[26px] font-bold text-white cursor-pointer disabled:cursor-wait"
                    >
                      <span className="h-7 w-7 rounded-[5px] bg-[#1b1320] text-white flex items-center justify-center">
                        {creating === "default" ? <LuLoader className="w-4 h-4 animate-spin" /> : <LuPlus className="w-4 h-4 stroke-[3]" />}
                      </span>
                      Create project
                    </button>
                    {/* Or at a size: one click each. */}
                    <div className="flex items-center gap-1.5">
                      {ASPECT_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          data-testid={`new-project-${p.id}`}
                          title={`New ${p.name.toLowerCase()} project (${p.id})`}
                          disabled={!!creating}
                          onClick={() => void create(p.id, { width: p.width, height: p.height, id: p.id })}
                          className="h-6 pl-1.5 pr-2 flex items-center gap-1.5 rounded-full bg-black/20 hover:bg-black/35 text-white/90 hover:text-white text-[12px] tabular-nums transition-colors cursor-pointer disabled:cursor-wait"
                        >
                          <span className="w-4 flex items-center justify-center">
                            {creating === p.id ? <LuLoader className="w-3 h-3 animate-spin" /> : <RatioFrame width={p.width} height={p.height} size={13} />}
                          </span>
                          {p.id}
                        </button>
                      ))}
                    </div>
                    <span className="absolute bottom-2 text-[11px] text-white/65">
                      Sized by the first clip you add, or pick a size.
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <QuickStart icon={LuFolderInput} title="Open a CapCut project" note="Its draft is read, never changed" onClick={() => setCapcutOpen(true)} testId="home-open-capcut" />
                    <QuickStart icon={LuUpload} title="Import media" note="A new project, starting with your files" onClick={() => void create("import", undefined, true)} testId="home-import" busy={creating === "import"} />
                    {last && (
                      <QuickStart icon={LuPlay} title={`Continue ${last.name}`} note={editedLabel(last.lastModified)} onClick={() => openProject(last.id)} testId="home-continue" />
                    )}
                  </div>
                </section>

                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-[16px] font-bold text-brand-light">
                      Projects <span className="text-[#7a7a7a] font-normal tabular-nums ml-1 text-[13px]">{projects.length}</span>
                    </h2>
                    {toolbar}
                  </div>
                  {shown.length === 0 ? empty : list(shown)}
                </section>
              </>
            )}

            {section === "templates" && (
              <section data-testid="home-templates" className="flex flex-col items-center justify-center gap-3 py-28 text-center">
                <LuLayoutTemplate className="w-7 h-7 text-brand-light/30" />
                <h2 className="text-[15px] font-semibold text-brand-light/90">Templates are coming</h2>
                <p className="text-[12px] text-brand-light/50 max-w-sm leading-relaxed">
                  Openly licensed starting points will live here. For now, start from a blank project or open one of your CapCut drafts.
                </p>
                <button
                  type="button"
                  onClick={() => setSection("home")}
                  className="mt-1 h-8 px-4 rounded-lg text-[12px] bg-brand-background hover:bg-brand text-brand-light/85 transition-colors"
                >
                  Back to Home
                </button>
              </section>
            )}

            {section === "library" && (
              <section data-testid="home-library" className="flex flex-col gap-4 pt-2">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col text-left">
                    <h2 className="text-[15px] font-semibold text-brand-light">Library</h2>
                    <p className="text-[12px] text-brand-light/45">Every project, with where its file is.</p>
                  </div>
                  {toolbar}
                </div>
                {shown.length === 0 ? empty : list(shown, true)}
              </section>
            )}
          </div>
        </main>
      </div>

      <CapCutImportDialog
        open={capcutOpen}
        onOpenChange={setCapcutOpen}
        onImported={(created) => {
          if (!useProjectsStore.getState().projects.some((p) => p.id === created.id)) addProject(created);
          openProject(created.id);
        }}
      />
      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && !deleting && setToDelete(null)}>
        <AlertDialogContent className="dark bg-brand-background/95 backdrop-blur-md border border-brand-light/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-brand-light text-[15px]">Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-brand-light/70 text-[13px]">
              The project and its edits are deleted. Your media files stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="dark border-brand-light/15 text-brand-light hover:bg-brand-light/10 text-[12px] font-medium px-5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                // Radix would close it before the delete finishes.
                e.preventDefault();
                void confirmDelete();
              }}
              className="bg-red-500/80 hover:bg-red-500/70 text-brand-light text-[12px] font-medium px-5"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default HomeScreen;
