import { isCompound } from "@/lib/compound";
import React, { useEffect, useMemo, useState } from "react";
import {
  LuChevronDown,
  LuCheck,
  LuKeyboard,
  LuChevronLeft,
  LuFolderPlus,
  LuFolderInput,
  LuHouse,
  LuMenu,
  LuSettings,
  LuUpload,
} from "react-icons/lu";
import { useProjectsStore } from "@/lib/projects";
import { clearProjectCover } from "@app/preload";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLayoutConfigStore, type AppLayoutId } from "@/lib/layout-config";
import { LayoutIcon } from "./LayoutIcon";
import ExportModal from "@/components/dialogs/ExportModal";
import { useExportRun } from "@/lib/export-run";
import { toast } from "sonner";
import { ProgressBar } from "@/components/common/ProgressBar";
import { useClipStore } from "@/lib/clip";
import type { AnyClipProps, GroupClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";
import { onCommand } from "@/lib/commands";
import { CapCutImportDialog } from "../dialogs/CapCutImportDialog";
import { createAndOpenProject, goHome, openProject } from "@/lib/project-actions";
import { useShellStore } from "@/lib/shell";
import { clockLabel, useAutosaveStore } from "@/lib/autosave";

interface TopBarProps {

}

const TopBar: React.FC<TopBarProps> = () => {
  const layout = useLayoutConfigStore((s) => s.layout);
  const setLayout = useLayoutConfigStore((s) => s.setLayout);
  const resetLayout = useLayoutConfigStore((s) => s.resetLayout);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportPhase = useExportRun((s) => s.phase);
  const exportProgress = useExportRun((s) => s.ratio);
  const isExporting = exportPhase === "running";
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const addProject = useProjectsStore((s) => s.addProject);
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const updateProject = useProjectsStore((s) => s.updateProject);

  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);

  // "Auto saved: hh:mm:ss", from the last save of the project's file.
  const saved = useAutosaveStore();

  const clips = useClipStore((s) => s.clips);
  const timelines = useClipStore((s) => s.timelines);
  const getClipsForGroup = useClipStore((s) => s.getClipsForGroup);

  const handleCommitProjectName = async () => {
    if (!activeProject) return;
    const trimmed = projectNameDraft.trim();
    if (!trimmed || trimmed === activeProject.name) {
      return;
    }
    try {
      await updateProject(activeProject.id, { name: trimmed });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Failed to update project name", e);
    }
  };

  const setSettingsOpen = useShellStore((s) => s.setSettingsOpen);
  const setShortcutsOpen = useShellStore((s) => s.setShortcutsOpen);
  const [capcutOpen, setCapcutOpen] = useState(false);

  useEffect(() => {
    const updateCover = async () => {
      if (clips.length === 0 && activeProjectId && activeProject?.coverPath) {
        try {
          await clearProjectCover(activeProjectId);
        } catch {
          // ignore; best-effort
        }
        await updateProject(activeProjectId, {
          coverPath: undefined,
          lastModified: Date.now(),
        });
      }
    };
    
    void updateCover();
  }, [clips, activeProjectId, activeProject?.coverPath]);

  const canExport = useMemo(() => {
    if (!clips || clips.length === 0) return false;

    // Only consider clips that are on a visible (non-hidden) timeline
    const visibleTimelineIds = new Set(
      timelines.filter((t) => !t.hidden).map((t) => t.timelineId),
    );

    const hasExportableMedia = (clip: AnyClipProps): boolean => {
      // Group clips may contain exportable children; for groups we ignore the
      // group's own timeline/hidden status and instead inspect their children.
      if (clip.type === "group") {
        const group = clip as GroupClipProps;
        const children = getClipsForGroup(group.children) || [];
        for (const child of children) {
          if (hasExportableMedia(child as AnyClipProps)) {
            return true;
          }
        }
        return false;
      }

      if (clip.hidden && !clip.groupId) return false;
      if (!clip.timelineId || !visibleTimelineIds.has(clip.timelineId)) {
        return false;
      }

      // A compound clip is exportable when it has anything in it.
      if (isCompound(clip)) return clip.compound.clips.length > 0;

      // Basic media clips must have an assetId
      if (clip.type === "image" || clip.type === "audio" || clip.type === "video") {
        return Boolean((clip as AnyClipProps & { assetId?: string }).assetId);
      }

      if (clip.type === "draw" || clip.type === "text" || clip.type === "shape" || clip.type === "sticker") {
        return true;
      }

      return false;
    };

    return clips.some((clip) => hasExportableMedia(clip));
  }, [clips, timelines, getClipsForGroup]);

  // The Export shortcut (⌘E, lib/keymap.ts) opens the export dialog, as the button does.
  useEffect(
    () =>
      onCommand("export", () => {
        if (canExport && !isExporting) setExportOpen(true);
      }),
    [canExport, isExporting],
  );

  const button =
    "h-6 flex items-center gap-x-1.5 px-1.5 rounded-[4px] text-[12px] text-brand-light/75 hover:text-brand-light hover:bg-brand-light/[0.08] transition-colors cursor-pointer";
  // Menus as CapCut draws them: the header surface, 32 px rows, a hairline outline.
  const menu = "dark bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] p-1";
  const row = "dark h-8 text-[13px] text-brand-light gap-x-2.5 px-2.5 rounded-[4px] cursor-pointer focus:bg-brand-hover";
  const LAYOUTS: { id: AppLayoutId; label: string }[] = [
    { id: "default", label: "Default" },
    { id: "media", label: "Media" },
    { id: "properties", label: "Inspector" },
    { id: "vertical", label: "Vertical" },
  ];

  return (
    <div data-testid="topbar" className="w-full relative h-[35px] shrink-0 px-2 flex items-center justify-between font-poppins">
      <div className="flex flex-row items-center gap-1 min-w-0 z-10">
        <CapCutImportDialog
          open={capcutOpen}
          onOpenChange={setCapcutOpen}
          onImported={(created) => {
            if (!projects.some((p) => p.id === created.id)) addProject(created);
            openProject(created.id);
          }}
        />
        <button
          type="button"
          data-testid="go-home"
          title={isExporting ? "Wait for the export to finish" : "Back to your projects"}
          disabled={isExporting}
          onClick={() => void goHome()}
          className={cn(button, "pr-2.5 disabled:opacity-40 disabled:cursor-not-allowed")}
        >
          <LuChevronLeft className="w-4 h-4 -mr-1" />
          <LuHouse className="w-3.5 h-3.5" />
          <span>Home</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger data-testid="app-menu" className={button}>
            <LuMenu className="w-3.5 h-3.5" />
            <span>Menu</span>
            <LuChevronDown className="w-3 h-3 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={cn(menu, "w-56")}>
            <DropdownMenuItem
              className={row}
              disabled={isExporting}
              onClick={() => {
                void createAndOpenProject().catch((e) => toast.error((e as Error).message));
              }}
            >
              <LuFolderPlus className="w-4 h-4 text-brand-light/80" />
              <span>New project</span>
            </DropdownMenuItem>
            <DropdownMenuItem className={row} disabled={isExporting} onClick={() => setCapcutOpen(true)}>
              <LuFolderInput className="w-4 h-4 text-brand-light/80" />
              <span>Open a CapCut project…</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-brand-hover mx-1" />
            <DropdownMenuItem className={row} onClick={() => setSettingsOpen(true)}>
              <LuSettings className="w-4 h-4 text-brand-light/80" />
              <span>Settings…</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {saved.at != null && saved.projectId === Number(activeProjectId) && (
          <span data-testid="autosave" className="ml-2 text-[11px] text-brand-light/45 whitespace-nowrap tabular-nums">
            Auto saved: {clockLabel(saved.at)}
          </span>
        )}
      </div>

      {/* The project's name, in the middle; click to rename. */}
      {activeProject && (
        <div className="absolute inset-x-0 flex justify-center pointer-events-none">
          <input
            type="text"
            data-testid="project-name"
            value={isEditingProjectName ? projectNameDraft : activeProject.name}
            onFocus={() => {
              setIsEditingProjectName(true);
              setProjectNameDraft(activeProject.name ?? "");
            }}
            onChange={(e) => setProjectNameDraft(e.target.value)}
            onBlur={async () => {
              await handleCommitProjectName();
              setIsEditingProjectName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="Project 1"
            title="Rename the project"
            className="pointer-events-auto w-[260px] h-6 text-center rounded-[4px] px-3 text-[13px] font-semibold text-brand-lighter placeholder:text-brand-light/40 border border-transparent hover:bg-brand-light/[0.05] focus:bg-brand focus:border-brand-light/10 transition-colors"
          />
        </div>
      )}

      <div className="flex items-center justify-end gap-1 z-10">
        {/* The layouts, from an icon as in CapCut: each keeps its own panel sizes. */}
        <DropdownMenu open={layoutOpen} onOpenChange={setLayoutOpen}>
          <DropdownMenuTrigger title="Layout" data-testid="layout-menu" className={cn(button, "gap-x-1 text-brand-light/60")}>
            <LayoutIcon type={layout} className="scale-[0.8]" />
            <LuChevronDown className="w-3 h-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(menu, "w-[178px]")}>
            {LAYOUTS.map((l) => (
              <DropdownMenuItem key={l.id} data-testid={`layout-${l.id}`} className={row} onClick={() => setLayout(l.id)}>
                <span className="w-3.5 flex justify-center text-brand-accent">{layout === l.id && <LuCheck className="w-3.5 h-3.5" />}</span>
                <span>{l.label}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="bg-brand-hover mx-1" />
            <DropdownMenuItem data-testid="layout-reset" className={row} onClick={() => resetLayout()}>
              <span className="w-3.5" />
              <span>Reset current layout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          title="Shortcuts"
          data-testid="shortcuts"
          onClick={() => setShortcutsOpen(true)}
          className={cn(button, "w-7 justify-center px-0 text-brand-light/60")}
        >
          <LuKeyboard className="w-[18px] h-[18px]" />
        </button>
        <button
          type="button"
          title="Settings"
          data-testid="open-settings"
          onClick={() => setSettingsOpen(true)}
          className={cn(button, "w-7 justify-center px-0 text-brand-light/60")}
        >
          <LuSettings className="w-4 h-4" />
        </button>

        <div className="flex items-center ml-1.5 mr-[3px]">
          {!isExporting ? (
            <button
              disabled={!canExport}
              type="button"
              data-testid="export"
              className="h-[22px] px-2.5 flex items-center justify-center gap-x-1.5 rounded-[4px] text-[12px] font-semibold text-white bg-brand-accent hover:bg-brand-accent-two-shade disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brand-accent transition-colors cursor-pointer"
              onClick={() => setExportOpen(true)}
            >
              <LuUpload className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          ) : (
            <button
              type="button"
              className="flex items-center gap-2 min-w-[180px] h-[22px] px-2.5 rounded-[4px] bg-brand-background-light hover:bg-brand-button cursor-pointer transition-colors"
              onClick={() => setExportOpen(true)}
            >
              <LuUpload className="w-3.5 h-3.5 text-brand-light/80" />
              <span className="text-[10px] text-brand-light/70 whitespace-nowrap">
                Exporting
              </span>
              <div className="flex-1 w-24">
                <ProgressBar
                  percent={Math.round(
                    Math.max(0, Math.min(1, exportProgress ?? 0)) * 100,
                  )}
                  className="h-1.5 border-brand-light/20 bg-brand-background-dark/80"
                  barClassName="bg-brand-accent"
                />
              </div>
              <span className="text-[10px] text-brand-light/60 w-6 text-right tabular-nums">
                {Math.round(Math.max(0, Math.min(1, exportProgress ?? 0)) * 100)}%
              </span>
            </button>
          )}
        </div>
      </div>

      <ExportModal open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
};

export default TopBar;
