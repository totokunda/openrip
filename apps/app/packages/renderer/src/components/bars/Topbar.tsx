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
import { useViewportStore } from "@/lib/viewport";
import { LayoutIcon } from "./LayoutIcon";
import ExportModal, { ExportSettings } from "@/components/dialogs/ExportModal";
import { ProgressBar } from "@/components/common/ProgressBar";
import {
  ExportClip,
  exportSequenceCancellable,
  ExportCancelledError,
} from "@app/export-renderer";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import type { AnyClipProps, GroupClipProps } from "@/lib/types";
import { prepareExportClipsForValue } from "@/lib/prepareExportClips";
import { sortClipsForStacking } from "@/lib/clipOrdering";
import { cancelEngineExport, engineExportProject, engineExports, parseBitrate } from "@/lib/engine-preview";
import { toast } from "sonner";
import { revealPathInFolder, writeFileBuffer } from "@app/preload";
import { cn } from "@/lib/utils";
import { exportFinished } from "@/lib/export-finished";
import { onCommand } from "@/lib/commands";
import { CapCutImportDialog } from "../dialogs/CapCutImportDialog";
import { createAndOpenProject, goHome, openProject } from "@/lib/project-actions";
import { useShellStore } from "@/lib/shell";

interface TopBarProps {

}

const TopBar: React.FC<TopBarProps> = () => {
  const layout = useLayoutConfigStore((s) => s.layout);
  const setLayout = useLayoutConfigStore((s) => s.setLayout);
  const resetLayout = useLayoutConfigStore((s) => s.resetLayout);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const aspectRatio = useViewportStore((s) => s.aspectRatio);
  const [exportOpen, setExportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const addProject = useProjectsStore((s) => s.addProject);
  const getAssetById = useClipStore((s) => s.getAssetById);
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const updateProject = useProjectsStore((s) => s.updateProject);

  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);

  const [cancelExportFn, setCancelExportFn] = useState<(() => void) | null>(
    null,
  );
  const clips = useClipStore((s) => s.clips);
  const timelines = useClipStore((s) => s.timelines);
  const getClipsForGroup = useClipStore((s) => s.getClipsForGroup);
  const getClipsByType = useClipStore((s) => s.getClipsByType);
  const getClipPositionScore = useClipStore((s) => s.getClipPositionScore);
  const fps = useControlsStore((s) => s.fps);

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

  const handleExport = async (settings: ExportSettings) => {
    const ext =
      settings.kind === "image"
        ? settings.imageFormat
        : settings.format;
    const outpath = `${settings.path}/${settings.name}.${ext}`;

    // Derive pixel dimensions from the chosen resolution and the editor rect ratio.
    // In the editor we compute rectWidth/rectHeight as:
    //   rectWidth  = BASE_LONG_SIDE * (aspectRatio.width / aspectRatio.height)
    //   rectHeight = BASE_LONG_SIDE
    // so the effective ratio is rectWidth / rectHeight = aspectRatio.width / aspectRatio.height.
    const base = Math.max(1, settings.resolution || 0);
    const rawRatio = aspectRatio.width / aspectRatio.height;
    const ratio = Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : 1;

    // The resolution sets the short side, as in CapCut (1080P portrait is 1080×1920); the
    // long side follows the project's ratio. Encoders want even sizes.
    const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
    const heightPx = ratio >= 1 ? even(base) : even(base / ratio);
    const widthPx = ratio >= 1 ? even(base * ratio) : even(base);

    const preserveAlpha = !!settings.preserveAlpha;

    setIsExporting(true);
    setExportProgress(0);

    // H.264/HEVC video goes through the Rust engine when its preview is on: CapCut's
    // compositing, VideoToolbox encoding and the engine's mix.
    if (engineExports(settings) && settings.kind === "video") {
      setCancelExportFn(() => () => void cancelEngineExport());
      try {
        const r = await engineExportProject(
          { path: outpath, width: widthPx, height: heightPx, fps, codec: settings.codec, bitrate: parseBitrate(settings.bitrate), audio: settings.includeAudio },
          (ratio) => setExportProgress(ratio),
        );
        if (r.ok) {
          toast("Export completed", { description: outpath });
          exportFinished(outpath);
          try {
            await revealPathInFolder(outpath);
          } catch (e) {
            console.error("Failed to reveal export path", e);
          }
        } else if (!r.cancelled) {
          toast("Export failed", { description: r.error });
          console.error("[engine] export failed:", r.error);
        }
      } finally {
        setIsExporting(false);
        setExportProgress(null);
        setCancelExportFn(null);
      }
      return;
    }

    try {
      // Prepare export-ready clips (attach filters, normalize paths, etc.).
      const preparedClips: ExportClip[] = [];
      let contentClips = sortClipsForStacking(
        clips as AnyClipProps[],
        timelines,
      );
      // filter clips with non visible timelines
      contentClips = contentClips.filter((clip) => {
        const timeline = timelines.find(
          (t) => t.timelineId === clip.timelineId,
        );
        return !timeline?.hidden;
      });

      for (const clip of contentClips) {
        if (clip.type === "filter") continue; // filters become applicators, not standalone content
        const prepared = prepareExportClipsForValue(
          clip as AnyClipProps,
          {
            aspectRatio,
            getAssetById,
            getClipsForGroup,
            getClipsByType,
            getClipPositionScore,
            timelines,
          },
          {
            clearMasks: false,
            applyCentering: false,
            dimensionsFrom: "aspect",
          },
        );
        preparedClips.push(...prepared.exportClips);
      }


      const { promise, cancel } = exportSequenceCancellable({
        mode: settings.kind === "image" ? "image" : "video",
        filename: outpath,
        includeAudio: settings.kind === "video" ? settings.includeAudio : false,
        clips: preparedClips,
        fps: fps,
        width: widthPx,
        height: heightPx,
        ...(settings.kind === "video"
          ? {
              encoderOptions: {
                format: settings.format,
                codec: settings.codec,
                bitrate: settings.bitrate,
                alpha: preserveAlpha,
              },
              audioOptions: {
                format: settings.audioFormat ?? "mp3",
              },
            }
          : {
              imageFrame: settings.frame,
              imageMimeType:
                settings.imageFormat === "jpeg"
                  ? "image/jpeg"
                  : settings.imageFormat === "webp"
                    ? "image/webp"
                    : "image/png",
            }),
        backgroundColor: preserveAlpha ? undefined : "#000000",
        onProgress: ({ ratio }) => {
          setIsExporting(true);
          setExportProgress(typeof ratio === "number" ? ratio : 0);
        },
        ...(settings.kind === "video"
          ? {
              onDone: async () => {
                toast("Export completed", {
                  description: outpath,
                });
                exportFinished(outpath);
                // Best-effort: open the exported file location for the user.
                try {
                  await revealPathInFolder(outpath);
                } catch (e) {
                  // eslint-disable-next-line no-console
                  console.error("Failed to reveal export path", e);
                }
              },
            }
          : {}),
      });

      setCancelExportFn(() => cancel);

      const result = await promise;

      if (settings.kind === "image") {
        const blob = result instanceof Blob ? result : new Blob();
        const buffer = new Uint8Array(await blob.arrayBuffer());
        await writeFileBuffer(outpath, buffer);
        toast("Export completed", { description: outpath });
        exportFinished(outpath);
        try {
          await revealPathInFolder(outpath);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("Failed to reveal export path", e);
        }
      }
    } catch (err) {
      if (
        err instanceof ExportCancelledError ||
        (err as any)?.name === "ExportCancelledError"
      ) {
        // Export was cancelled by the user; do not treat as an error or show a completion toast.
      } else {
        // Swallow other errors; the user can retry.
        // Optionally log for debugging.
        console.error(err);
      }
    } finally {
      setIsExporting(false);
      setExportProgress(null);
      setCancelExportFn(null);
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

      // Basic media clips must have an assetId
      if (clip.type === "image" || clip.type === "audio" || clip.type === "video") {
        return Boolean((clip as AnyClipProps & { assetId?: string }).assetId);
      }

      if (clip.type === "draw" || clip.type === "text" || clip.type === "shape") {
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

      <ExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        onExport={handleExport}
        isExporting={isExporting}
        exportProgress={exportProgress}
        onCancelExport={() => {
          if (cancelExportFn) {
            cancelExportFn();
          }
        }}
      />
    </div>
  );
};

export default TopBar;
