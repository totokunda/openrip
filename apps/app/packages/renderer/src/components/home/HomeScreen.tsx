import React, { useEffect, useMemo, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuEllipsis,
  LuFolderInput,
  LuFolderOpen,
  LuHouse,
  LuChevronDown,
  LuChevronRight,
  LuClapperboard,
  LuCheck,
  LuLayoutGrid,
  LuLayoutTemplate,
  LuList,
  LuLibrary,
  LuLoader,
  LuPencil,
  LuPlay,
  LuPlus,
  LuSearch,
  LuSettings,
  LuTrash2,
  LuUpload,
  LuCopy,
} from "react-icons/lu";
import { toast } from "sonner";
import { useProjectsStore, type ProjectSettings } from "@/lib/projects";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useShellStore } from "@/lib/shell";
import { useSidebarStore } from "@/lib/sidebar";
import { ASPECT_PRESETS, ratioBox } from "@/lib/aspect-presets";
import { createAndOpenProject, deleteProjectAnywhere, duplicateProjectCopy, openProject, refreshProjects, renameProject, restoreProjects, saveAsTemplate } from "@/lib/project-actions";
import { TrashDialog } from "./TrashDialog";
import { LibraryPage } from "./LibraryPage";
import { TemplatesPage } from "./TemplatesPage";
import { getAppInfo, revealPathInFolder } from "@app/preload";
import { CapCutImportDialog } from "@/components/dialogs/CapCutImportDialog";
import { useT } from "@/lib/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

// CapCut's home colour roles (docs/plan/capcut-ui-spec.md §4.15), on OpenRip's lavender
// instead of CapCut's cyan: a page barely off black with the accent's hue, cards a step
// lighter, a bright banner with near-black type, and a dark saturated tint of the accent for
// the wide first card.
const PAGE_BG = "linear-gradient(180deg, #110d15 0%, #0b0a0d 40%, #090909 100%)";
const BANNER_BG =
  "radial-gradient(120% 170% at 50% -30%, rgba(255,255,255,0.30), rgba(255,255,255,0) 55%), linear-gradient(100deg, #c9a8e4 0%, #ba93dd 52%, #a77ecc 100%)";
const BANNER_TEXT = "#0d0b10";
const CARD_BG = "bg-[#16141a] hover:bg-[#1c1a21]";
const FEATURE_BG = "linear-gradient(135deg, #3a2a50 0%, #2c2140 100%)";

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

/** A project's menu: open, rename, duplicate, show its file, delete. */
const ProjectMenu: React.FC<{
  project: ProjectSettings;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTemplate?: () => void;
  className?: string;
}> = ({ project, onOpen, onRename, onDuplicate, onDelete, onTemplate, className }) => (
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
      <DropdownMenuItem className={menuRow} data-testid="project-duplicate" onClick={onDuplicate}>
        <LuCopy className="w-4 h-4" /> Duplicate
      </DropdownMenuItem>
      {project.filePath && (
        <DropdownMenuItem className={menuRow} onClick={() => void revealPathInFolder(project.filePath!)}>
          <LuFolderOpen className="w-4 h-4" /> Show the file
        </DropdownMenuItem>
      )}
      {onTemplate && (
        <DropdownMenuItem className={menuRow} data-testid="project-save-template" onClick={onTemplate}>
          <LuLayoutTemplate className="w-4 h-4" /> Save as template
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator className="bg-brand-hover mx-1" />
      <DropdownMenuItem className={cn(menuRow, "text-red-400 focus:text-red-300")} data-testid="project-delete" onClick={onDelete}>
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
  onDuplicate: () => void;
  onTemplate: () => void;
}

/** A project in the grid: its cover in a square-ish box, its name and "size | length". */
const ProjectCard: React.FC<CardProps> = ({ project, active, onOpen, onDelete, onDuplicate, onTemplate }) => {
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
          onDuplicate={onDuplicate}
          onTemplate={onTemplate}
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
const ProjectRow: React.FC<CardProps & { showPath?: boolean }> = ({ project, active, onOpen, onDelete, onDuplicate, onTemplate, showPath }) => {
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
      <ProjectMenu project={project} onOpen={onOpen} onRename={start} onDuplicate={onDuplicate} onDelete={onDelete} onTemplate={onTemplate} className="hover:bg-brand-light/10" />
    </div>
  );
};

/**
 * The gear at the top right, as CapCut's (01-home/079-settings-menu.png): Settings, then the
 * open-source notices and the version, which opens About. CapCut's account, billing, spaces,
 * policies and network-test items need its servers and are left out.
 */
const GearMenu: React.FC = () => {
  const t = useT();
  const shell = useShellStore();
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getAppInfo().then((i) => setVersion(i.version)).catch(() => {});
  }, []);
  const row = "dark h-8 text-[13px] text-brand-light px-3 rounded-[4px] cursor-pointer focus:bg-brand-hover";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger title={t("home.menu.title")} data-testid="home-settings" className="h-6 w-6 flex items-center justify-center rounded-[4px] text-brand-light/90 hover:bg-white/[0.06] outline-none cursor-pointer">
        <LuSettings className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="dark w-[248px] bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] p-1">
        <DropdownMenuItem data-testid="home-menu-settings" className={row} onSelect={() => shell.setSettingsOpen(true)}>
          {t("home.menu.settings")}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-brand-hover mx-1" />
        <DropdownMenuItem data-testid="home-menu-notices" className={row} onSelect={() => shell.setNoticesOpen(true)}>
          {t("home.menu.notices")}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="home-menu-version" className={row} onSelect={() => shell.setAboutOpen(true)}>
          {t("home.menu.version", { version: version || "…" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
      "w-full h-8 flex items-center gap-3 px-2.5 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer",
      active ? "bg-[#1f1925] text-[#e0e0e0]" : "text-[#cccccc] hover:text-brand-light hover:bg-white/[0.04]",
    )}
  >
    <Icon className="w-4 h-4" />
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
    className={cn(
      "w-full min-w-0 h-[134px] flex flex-col justify-between p-4 rounded-[8px] transition-colors text-left cursor-pointer disabled:cursor-wait",
      CARD_BG,
    )}
  >
    <span className="h-10 w-10 rounded-[8px] bg-white/[0.07] flex items-center justify-center text-brand-light">
      {busy ? <LuLoader className="w-[18px] h-[18px] animate-spin" /> : <Icon className="w-[18px] h-[18px]" />}
    </span>
    <span className="flex flex-col min-w-0 gap-0.5">
      <span className="text-[15px] font-semibold text-brand-lighter truncate">{title}</span>
      <span className="text-[13px] leading-[18px] text-[#9a9a9a] line-clamp-2">{note}</span>
    </span>
  </button>
);

/**
 * The wide first card, where CapCut has its assistant: carry on with the last project, or,
 * with none yet, start one from your files. Its field-like row is the card's action.
 */
const FeatureCard: React.FC<{ last: ProjectSettings | null; busy: boolean; onContinue: () => void; onStart: () => void }> = ({
  last,
  busy,
  onContinue,
  onStart,
}) => (
  <button
    type="button"
    data-testid={last ? "home-continue" : "home-start"}
    onClick={last ? onContinue : onStart}
    disabled={busy}
    className="w-full min-w-0 h-[134px] flex flex-col justify-between p-4 rounded-[8px] text-left cursor-pointer disabled:cursor-wait transition-[filter] hover:brightness-110"
    style={{ background: FEATURE_BG }}
  >
    <span className="flex items-center gap-2 text-[15px] font-semibold text-[#d9c4ee]">
      <LuClapperboard className="w-[18px] h-[18px]" />
      {last ? "Continue editing" : "Start editing"}
    </span>
    <span className="text-[21px] font-bold italic text-brand-lighter truncate" title={last?.name}>
      {last ? middle(last.name, 34) : "What will you make today?"}
    </span>
    <span className="h-10 flex items-center gap-2 pl-3 pr-1.5 rounded-[8px] bg-white/[0.08] text-[13px] text-brand-light/60">
      <span className="flex-1 truncate">
        {last ? `${editedLabel(last.lastModified)} · ${sizeLabel(last.sizeBytes)} | ${lengthLabel(last.durationUs)}` : "Import media to start a new project"}
      </span>
      <span className="h-7 w-7 rounded-full bg-white/15 flex items-center justify-center text-brand-lighter">
        {busy ? <LuLoader className="w-3.5 h-3.5 animate-spin" /> : last ? <LuChevronRight className="w-4 h-4" /> : <LuPlus className="w-4 h-4" />}
      </span>
    </span>
  </button>
);

/** "Custom size": the canvas presets, each a new project at that size. */
const SizeCard: React.FC<{ creating: string | null; onCreate: (p: (typeof ASPECT_PRESETS)[number]) => void }> = ({ creating, onCreate }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      data-testid="home-sizes"
      disabled={!!creating}
      className={cn("w-full min-w-0 h-[134px] flex flex-col justify-between p-4 rounded-[8px] transition-colors text-left cursor-pointer disabled:cursor-wait", CARD_BG)}
    >
      <span className="h-10 w-10 rounded-[8px] bg-white/[0.07] flex items-center justify-center text-brand-light">
        <RatioFrame width={16} height={9} size={18} />
      </span>
      <span className="flex flex-col min-w-0 gap-0.5">
        <span className="flex items-center gap-1 text-[15px] font-semibold text-brand-lighter">
          Custom size <LuChevronDown className="w-3.5 h-3.5 opacity-60" />
        </span>
        <span className="text-[13px] leading-[18px] text-[#9a9a9a] line-clamp-2">16:9, 9:16, 1:1 and more</span>
      </span>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className={cn(menu, "w-52")}>
      {ASPECT_PRESETS.map((p) => (
        <DropdownMenuItem
          key={p.id}
          data-testid={`new-project-${p.id}`}
          className={menuRow}
          disabled={!!creating}
          onClick={() => onCreate(p)}
        >
          <span className="w-5 flex items-center justify-center text-brand-light/80">
            {creating === p.id ? <LuLoader className="w-3.5 h-3.5 animate-spin" /> : <RatioFrame width={p.width} height={p.height} size={15} />}
          </span>
          <span className="flex-1">{p.name}</span>
          <span className="text-brand-light/45 tabular-nums">{p.id}</span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

/** The banner's "+": a near-black tile, as CapCut's. */
const PlusTile: React.FC<{ size: number; busy: boolean }> = ({ size, busy }) => (
  <span className="rounded-[6px] flex items-center justify-center text-white shrink-0" style={{ width: size, height: size, background: BANNER_TEXT }}>
    {busy ? <LuLoader className="w-4 h-4 animate-spin" /> : <LuPlus className="w-[18px] h-[18px] stroke-[3]" />}
  </span>
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
  const [trashOpen, setTrashOpen] = useState(false);
  // Scrolled past the banner: CapCut keeps a slimmer one pinned at the top.
  const [compact, setCompact] = useState(false);
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

  // Deleting moves a project to the Trash (30 days, restorable); the toast can put it straight back.
  const moveToTrash = async (project: ProjectSettings) => {
    try {
      await deleteProjectAnywhere(project);
      toast(`Moved “${project.name}” to Trash`, {
        action: { label: "Undo", onClick: () => void restoreProjects([project.id]).catch((e) => toast.error((e as Error).message)) },
      });
    } catch (e) {
      toast.error((e as Error).message || "Couldn't delete the project");
    }
  };

  const copyProject = async (project: ProjectSettings) => {
    try {
      const c = await duplicateProjectCopy(project);
      toast(`Duplicated as “${c.name}”`);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't duplicate the project");
    }
  };

  const makeTemplate = async (project: ProjectSettings) => {
    try {
      const t = await saveAsTemplate(project);
      toast(`Saved “${t.name}” as a template`, { action: { label: "View", onClick: () => setSection("templates") } });
    } catch (e) {
      toast.error((e as Error).message || "Couldn't save the template");
    }
  };

  const list = (items: ProjectSettings[], showPath = false) =>
    view === "grid" && !showPath ? (
      <div className="grid gap-x-[22px] gap-y-4" style={{ gridTemplateColumns: "repeat(auto-fill, 124px)" }}>
        {items.map((p) => (
          <ProjectCard key={p.id} project={p} active={p.id === activeProjectId} onOpen={() => openProject(p.id)} onDelete={() => void moveToTrash(p)} onDuplicate={() => void copyProject(p)} onTemplate={() => void makeTemplate(p)} />
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
          <ProjectRow key={p.id} project={p} active={p.id === activeProjectId} showPath={showPath} onOpen={() => openProject(p.id)} onDelete={() => void moveToTrash(p)} onDuplicate={() => void copyProject(p)} onTemplate={() => void makeTemplate(p)} />
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
      <DropdownMenu>
        <DropdownMenuTrigger title="View and sort" data-testid="home-view" className={tool}>
          {view === "grid" || section !== "home" ? <LuLayoutGrid className="w-3.5 h-3.5" /> : <LuList className="w-3.5 h-3.5" />}
          <LuChevronDown className="w-3 h-3 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={cn(menu, "w-40")}>
          {section === "home" &&
            ([
              ["grid", LuLayoutGrid, "Grid"],
              ["list", LuList, "List"],
            ] as const).map(([v, Icon, label]) => (
              <DropdownMenuItem key={v} data-testid={`home-view-${v}`} className={cn(menuRow, view === v && "text-brand-accent")} onClick={() => setView(v)}>
                <Icon className="w-4 h-4" /> {label}
              </DropdownMenuItem>
            ))}
          {section === "home" && <DropdownMenuSeparator className="bg-brand-hover mx-1" />}
          <DropdownMenuLabel className="px-2.5 py-1 text-[11px] font-normal text-[#7a7a7a]">Sort by</DropdownMenuLabel>
          {([
            ["edited", "Last edited"],
            ["created", "Newest first"],
            ["name", "Name"],
          ] as const).map(([key, label]) => (
            <DropdownMenuItem key={key} data-testid={`home-sort-${key}`} className={cn(menuRow, sort === key && "text-brand-accent")} onClick={() => setSort(key)}>
              <span className="w-4 flex items-center">{sort === key && <LuCheck className="w-3.5 h-3.5" />}</span>
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {section === "home" && (
        <button type="button" data-testid="home-trash" onClick={() => setTrashOpen(true)} className={cn(tool, "px-2")}>
          <LuTrash2 className="w-3.5 h-3.5" /> Trash
        </button>
      )}
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
      style={{ background: PAGE_BG }}
    >
      <aside className="w-[216px] shrink-0 flex flex-col gap-3 px-5 pt-5">
        {/* Where CapCut has its account card: OpenRip has no accounts, so it says what it is. */}
        <div className="flex items-center gap-2.5 p-3 rounded-[8px] bg-[#121115] mb-3 text-left">
          <span
            className="h-9 w-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #c9a8e4 0%, #a77ecc 100%)", color: BANNER_TEXT }}
          >
            <LuClapperboard className="w-[18px] h-[18px]" />
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-[14px] font-semibold text-brand-lighter">OpenRip</span>
            <span className="text-[12px] text-[#8a8a8a] truncate">Video editor</span>
          </span>
        </div>
        <NavItem icon={LuHouse} label="Home" active={section === "home"} onClick={() => setSection("home")} testId="home-nav-home" />
        <NavItem icon={LuLayoutTemplate} label="Templates" active={section === "templates"} onClick={() => setSection("templates")} testId="home-nav-templates" />
        <div className="h-px bg-white/[0.06] my-1" />
        <div className="px-2.5 text-[12px] text-[#949494] text-left">Management</div>
        <NavItem icon={LuLibrary} label="Library" active={section === "library"} onClick={() => setSection("library")} testId="home-nav-library" />
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-11 shrink-0 flex items-center justify-end px-4">
          <GearMenu />
        </header>
        <main
          className="flex-1 min-h-0 overflow-y-auto custom-scrollbar"
          onScroll={(e) => {
            // Hysteresis, so the pinned banner doesn't flicker at the edge.
            const top = e.currentTarget.scrollTop;
            setCompact((was) => (was ? top > 96 : top > 128));
          }}
        >
          <div className="pl-6 pr-[60px] pb-16">
            {section === "home" && (
              // The banner pinned at the top once the full one has scrolled away (CapCut's
              // 87 px bar). It takes no room: the page scrolls under it.
              <div
                className={cn(
                  "sticky top-0 z-20 h-[87px] -mb-[87px] transition-opacity duration-150",
                  compact ? "opacity-100" : "opacity-0 pointer-events-none",
                )}
                aria-hidden={!compact}
              >
                <button
                  type="button"
                  tabIndex={compact ? 0 : -1}
                  disabled={!!creating}
                  onClick={() => void create("default")}
                  className="w-full h-full rounded-[8px] flex items-center justify-center gap-3 cursor-pointer disabled:cursor-wait shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
                  style={{ background: BANNER_BG }}
                >
                  <PlusTile size={26} busy={creating === "default"} />
                  <span className="text-[23px] font-bold tracking-[-0.01em]" style={{ color: BANNER_TEXT }}>
                    Create project
                  </span>
                </button>
              </div>
            )}
            <div className="flex flex-col gap-7">
            {section === "home" && (
              <>
                <section className="flex flex-col gap-5">
                  <button
                    type="button"
                    data-testid="new-project"
                    disabled={!!creating}
                    onClick={() => void create("default")}
                    title="A new project, sized by the first clip you add"
                    className="w-full h-[143px] rounded-[8px] overflow-hidden flex items-center justify-center gap-3.5 cursor-pointer disabled:cursor-wait transition-[filter] hover:brightness-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    style={{ background: BANNER_BG }}
                  >
                    <PlusTile size={36} busy={creating === "default"} />
                    <span className="text-[28px] font-bold tracking-[-0.01em]" style={{ color: BANNER_TEXT }}>
                      Create project
                    </span>
                  </button>
                  <div className="grid gap-5" style={{ gridTemplateColumns: "minmax(0,2fr) repeat(4, minmax(0,1fr))" }}>
                    <FeatureCard
                      last={last}
                      busy={creating === "import"}
                      onContinue={() => last && openProject(last.id)}
                      onStart={() => void create("import", undefined, true)}
                    />
                    <QuickStart icon={LuFolderInput} title="CapCut project" note="Open a draft; it's only read, never changed" onClick={() => setCapcutOpen(true)} testId="home-open-capcut" />
                    <QuickStart icon={LuUpload} title="Import media" note="Start a new project from your files" onClick={() => void create("import", undefined, true)} testId="home-import" busy={creating === "import"} />
                    <SizeCard creating={creating} onCreate={(p) => void create(p.id, { width: p.width, height: p.height, id: p.id })} />
                    <QuickStart icon={LuLibrary} title="Library" note="Your media from every project" onClick={() => setSection("library")} testId="home-library-card" />
                  </div>
                </section>

                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-[16px] font-bold text-brand-light">Projects</h2>
                    {toolbar}
                  </div>
                  {shown.length === 0 ? empty : list(shown)}
                </section>
              </>
            )}

            {section === "templates" && <TemplatesPage />}

            {section === "library" && <LibraryPage />}
            </div>
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
      <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} />
    </div>
  );
};

export default HomeScreen;
