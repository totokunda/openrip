import React, { useMemo, useRef, useState } from "react";
import { LuEllipsis, LuFolderInput, LuLoader, LuPencil, LuPlus, LuSearch, LuTrash2 } from "react-icons/lu";
import { toast } from "sonner";
import { useProjectsStore, type ProjectSettings } from "@/lib/projects";
import { ASPECT_PRESETS, ratioBox } from "@/lib/aspect-presets";
import { createAndOpenProject, deleteProjectAnywhere, openProject, renameProject } from "@/lib/project-actions";
import { CapCutImportDialog } from "@/components/dialogs/CapCutImportDialog";
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
 * The home screen: new projects at a canvas size, a CapCut draft opened as a project, and
 * every project with its cover, the most recently edited first. Opening one goes to the
 * editor; the editor's top bar comes back here.
 */

type SortKey = "edited" | "name" | "created";

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

/** The canvas's shape as an outlined frame, the home screen's way of showing a size. */
const RatioFrame: React.FC<{ width: number; height: number; size: number; className?: string }> = ({ width, height, size, className }) => {
  const box = ratioBox(width, height, size);
  return <div className={cn("rounded-[3px] border-[1.5px] border-current", className)} style={{ width: box.width, height: box.height }} />;
};

const ProjectCard: React.FC<{
  project: ProjectSettings;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}> = ({ project, active, onOpen, onDelete }) => {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const aspect = project.aspectRatio ?? { width: 16, height: 9, id: "16:9" };
  // Covers are rewritten in place: their time keeps the browser from showing an old one.
  const cover = project.coverPath ? `app://user-data${encodeURI(project.coverPath)}?v=${project.lastModified ?? 0}` : null;

  const commit = async () => {
    setRenaming(false);
    try {
      await renameProject(project, draft);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't rename the project");
      setDraft(project.name);
    }
  };

  return (
    <div data-testid="project-card" data-project-id={project.id} data-active={active ? "true" : "false"} className="group flex flex-col gap-2 min-w-0">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          title={`Open ${project.name}`}
          className="w-full aspect-[16/10] rounded-md overflow-hidden bg-brand-background-dark border border-brand-light/[0.06] flex items-center justify-center text-brand-light/25 transition-colors group-hover:border-brand-light/25 focus-visible:border-brand-accent focus-visible:outline-none cursor-pointer"
        >
          {cover ? (
            <img src={cover} alt="" className="w-full h-full object-contain" loading="lazy" draggable={false} />
          ) : (
            <RatioFrame width={aspect.width} height={aspect.height} size={44} />
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`More for ${project.name}`}
            className="absolute top-1.5 right-1.5 h-6 w-6 rounded-[5px] flex items-center justify-center bg-black/60 text-brand-light/80 hover:text-brand-light opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity cursor-pointer"
          >
            <LuEllipsis className="w-3.5 h-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="dark w-36 font-poppins bg-brand-background border border-brand-light/10 rounded-[6px]">
            <DropdownMenuItem className="dark text-[11px]" onClick={onOpen}>
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              className="dark text-[11px] gap-2"
              onClick={() => {
                setDraft(project.name);
                setRenaming(true);
                setTimeout(() => inputRef.current?.select(), 0);
              }}
            >
              <LuPencil className="w-3 h-3" /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="dark text-[11px] gap-2 text-red-400 focus:text-red-300" onClick={onDelete}>
              <LuTrash2 className="w-3 h-3" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-start justify-between gap-2 min-w-0 px-0.5">
        <div className="flex flex-col min-w-0 text-left">
          {renaming ? (
            <input
              ref={inputRef}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setDraft(project.name);
                  setRenaming(false);
                }
              }}
              className="h-5 text-[12px] font-medium text-brand-light bg-brand border border-brand-light/20 rounded-[4px] px-1 -mx-1"
            />
          ) : (
            <span className="text-[12px] font-medium text-brand-light truncate" data-testid="project-name">
              {project.name}
            </span>
          )}
          <span className="text-[10.5px] text-brand-light/45">{editedLabel(project.lastModified)}</span>
        </div>
        <span className="shrink-0 text-[10px] text-brand-light/45 mt-0.5 tabular-nums">{ratioLabel(project.aspectRatio)}</span>
      </div>
    </div>
  );
};

const HomeScreen: React.FC = () => {
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const addProject = useProjectsStore((s) => s.addProject);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("edited");
  const [creating, setCreating] = useState<string | null>(null);
  const [capcutOpen, setCapcutOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ProjectSettings | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const create = async (key: string, aspect?: { width: number; height: number; id: string }) => {
    if (creating) return;
    setCreating(key);
    try {
      await createAndOpenProject(aspect);
    } catch (e) {
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

  const tile =
    "relative flex flex-col items-center justify-center rounded-md border border-brand-light/[0.07] bg-brand-background text-brand-light/80 hover:text-brand-light hover:border-brand-light/25 hover:bg-brand transition-colors cursor-pointer disabled:cursor-wait focus-visible:outline-none focus-visible:border-brand-accent";

  return (
    <div data-testid="home" className="w-full h-screen flex flex-col bg-brand-background-dark font-poppins text-brand-light select-none">
      <header className="h-11 shrink-0 flex items-center px-6 border-b border-brand-light/[0.06]">
        <span className="text-[13px] font-semibold tracking-tight">OpenRip</span>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="max-w-[1400px] mx-auto px-10 pt-9 pb-16 flex flex-col gap-10">
          <section className="flex flex-col gap-3">
            <h2 className="text-[13px] font-medium text-brand-light/90 text-left">New project</h2>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                data-testid="new-project"
                disabled={!!creating}
                onClick={() => void create("default")}
                className={cn(tile, "w-56 h-32 gap-2.5 bg-brand-accent/90 border-brand-accent text-brand-lighter hover:bg-brand-accent hover:border-brand-accent")}
              >
                {creating === "default" ? <LuLoader className="w-6 h-6 animate-spin" /> : <LuPlus className="w-6 h-6" />}
                <span className="text-[12px] font-medium">New project</span>
                <span className="text-[10px] text-brand-lighter/70 -mt-1.5">Sized by the first clip you add</span>
              </button>
              {ASPECT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`new-project-${p.id}`}
                  title={`New ${p.name.toLowerCase()} project, ${p.id}`}
                  disabled={!!creating}
                  onClick={() => void create(p.id, { width: p.width, height: p.height, id: p.id })}
                  className={cn(tile, "w-[88px] h-32")}
                >
                  <div className="h-14 flex items-center justify-center">
                    {creating === p.id ? <LuLoader className="w-5 h-5 animate-spin" /> : <RatioFrame width={p.width} height={p.height} size={40} />}
                  </div>
                  <span className="text-[12px] font-medium tabular-nums">{p.id}</span>
                  <span className="text-[10px] text-brand-light/45">{p.name}</span>
                </button>
              ))}
              <button
                type="button"
                data-testid="home-open-capcut"
                disabled={!!creating}
                onClick={() => setCapcutOpen(true)}
                className={cn(tile, "w-56 h-32 gap-2.5 border-dashed")}
              >
                <LuFolderInput className="w-6 h-6" />
                <span className="text-[12px] font-medium">Open a CapCut project</span>
                <span className="text-[10px] text-brand-light/45 -mt-1.5">Its draft is read, never changed</span>
              </button>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[13px] font-medium text-brand-light/90">
                Projects <span className="text-brand-light/40 font-normal tabular-nums ml-1">{projects.length}</span>
              </h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <LuSearch className="w-3.5 h-3.5 text-brand-light/45 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects"
                    className="w-56 h-8 rounded-[6px] pl-8 pr-2 text-[11px] bg-brand-background border border-brand-light/[0.08] text-brand-light/90 placeholder:text-brand-light/35 focus:border-brand-light/25"
                  />
                </div>
                <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                  <SelectTrigger size="sm" className="w-36 !h-8 text-[11px] bg-brand-background border-brand-light/[0.08] rounded-[6px] text-brand-light/90">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="dark bg-brand-background text-brand-light font-poppins">
                    <SelectItem value="edited" className="text-[11px]">Last edited</SelectItem>
                    <SelectItem value="created" className="text-[11px]">Newest first</SelectItem>
                    <SelectItem value="name" className="text-[11px]">Name</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {shown.length === 0 ? (
              <p className="text-[11px] text-brand-light/50 text-left py-6">
                {projects.length === 0 ? "No projects yet. Start one above." : `No project is named like “${search.trim()}”.`}
              </p>
            ) : (
              <div className="grid gap-x-4 gap-y-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                {shown.map((p) => (
                  <ProjectCard key={p.id} project={p} active={p.id === activeProjectId} onOpen={() => openProject(p.id)} onDelete={() => setToDelete(p)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      <CapCutImportDialog
        open={capcutOpen}
        onOpenChange={setCapcutOpen}
        onImported={(created) => {
          if (!useProjectsStore.getState().projects.some((p) => p.id === created.id)) addProject(created);
          openProject(created.id);
        }}
      />
      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && !deleting && setToDelete(null)}>
        <AlertDialogContent className="dark bg-brand-background/95 font-poppins backdrop-blur-md border border-brand-light/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-brand-light text-[14px]">Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-brand-light/70 text-[12px]">
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
