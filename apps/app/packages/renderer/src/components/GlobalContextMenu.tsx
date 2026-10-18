import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useContextMenuStore, type ContextMenuItem } from "@/lib/context-menu";
import { LuCheck, LuChevronRight } from "react-icons/lu";
import { removeTransition } from "@/lib/transitions";
import { freezeAtPlayhead, toggleReverse } from "@/lib/timeline-motion";
import { runAnalysisAction } from "@/lib/analysis";
import { easeKeysAt, removeKeysAt, useKeyframeGraphStore } from "@/lib/timeline-keyframes";
import type { KeyframePreset } from "@/lib/types";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { cn } from "@/lib/utils";
import { useViewportStore } from "@/lib/viewport";
import type { AnyClipProps, ImageClipProps, VideoClipProps } from "@/lib/types";
import { prepareExportClipsForValue } from "@/lib/prepareExportClips";
import { getMediaInfoCached } from "@/lib/media/utils";
import { exportSequence, exportClip } from "@app/export-renderer";
import { saveImageToPath } from "@app/preload";
import { useMarkerEditorStore } from "@/components/timeline/Markers";
import ClipExportModal, {
  ClipExportSettings,
} from "@/components/dialogs/ClipExportModal";

const Key: React.FC<{ text: string }> = ({ text }) => (
  <span className="text-[12px] text-[#949494] tracking-wide">{text}</span>
);

/**
 * A menu row: its label (after an accent tick column when the menu has choices), its shortcut,
 * or a › with a submenu that opens beside it while it's hovered, its first row level with it
 * (CapCut's).
 */
const MenuRow: React.FC<{
  item: ContextMenuItem;
  ticked: boolean;
  onSelect: (action: string, value?: string) => void;
  open: boolean;
  setOpen: (id: string | null) => void;
}> = ({ item, ticked, onSelect, open, setOpen }) => {
  const sub = item.children?.length ? item.children : null;
  const subTicked = !!sub?.some((c) => c.checked !== undefined);
  return (
    <div className="relative" onMouseEnter={() => setOpen(sub && !item.disabled ? item.id : null)}>
      <button
        disabled={item.disabled}
        data-testid={`menu-${item.id}`}
        onClick={() => {
          if (sub) return setOpen(item.id);
          // An item with its own action (the audio tools') does it, and the menu closes.
          if (item.run) {
            item.run();
            useContextMenuStore.getState().closeMenu();
            return;
          }
          onSelect(item.action, item.value);
        }}
        className={cn(
          "w-full h-8 px-2.5 text-left text-[13px] flex items-center rounded-[4px] justify-between hover:bg-brand-hover text-brand-light",
          open && "bg-brand-hover",
          item.disabled && "text-[#525252] cursor-default! hover:bg-transparent",
        )}
      >
        <span className="flex items-center gap-2">
          {ticked && <LuCheck className={cn("w-3.5 h-3.5 text-brand-accent", !item.checked && "invisible")} />}
          {item.label}
        </span>
        {sub ? <LuChevronRight className="w-3.5 h-3.5 text-[#cacaca]" /> : item.shortcut && <Key text={item.shortcut} />}
      </button>
      {sub && open && (
        <div className="absolute left-full -top-1 ml-1 min-w-[160px] p-1 rounded-[8px] border-[0.5px] border-black bg-brand-header shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)]">
          {sub.map((c) => (
            <MenuRow key={c.id} item={c} ticked={subTicked} onSelect={onSelect} open={false} setOpen={() => {}} />
          ))}
        </div>
      )}
    </div>
  );
};

const GlobalContextMenu: React.FC = () => {
  const { open, position, items, groups, closeMenu, setPosition, target } =
    useContextMenuStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clipsStore = useClipStore();
  const timelines = useClipStore((s) => s.timelines);
  const getClipsForGroup = useClipStore((s) => s.getClipsForGroup);
  const getClipsByType = useClipStore((s) => s.getClipsByType);
  const getClipPositionScore = useClipStore((s) => s.getClipPositionScore);
  const fps = useControlsStore((s) => s.fps);
  const aspectRatio = useViewportStore((s) => s.aspectRatio);
  const getAssetById = useClipStore((s) => s.getAssetById);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportKind, setExportKind] = useState<
    "audio" | "image" | "video" | null
  >(null);
  const [exportClipId, setExportClipId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  const getDefaultNameForClip = (
    clip: AnyClipProps | null | undefined,
  ): string => {
    if (!clip) return "export";
    try {
      const asset = getAssetById((clip as any)?.assetId);
      if (!asset) return "export";
      const parts = asset.path.split(/[\\/]/);
      const last = parts[parts.length - 1] || "";
      const stem = last.replace(/\.[^.]+$/, "");
      return stem || "export";
    } catch {
      return "export";
    }
  };

  const shouldShowMenu = open && !exportModalOpen;
  // The row whose submenu is open.
  const [openSub, setOpenSub] = useState<string | null>(null);
  useEffect(() => setOpenSub(null), [open, groups]);

  useEffect(() => {
    if (!shouldShowMenu) return;
    const onAny = (e: Event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", onAny, true);
    document.addEventListener("mousedown", onAny, true);
    document.addEventListener("click", onAny, true);
    document.addEventListener("contextmenu", onAny, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onAny, true);
      document.removeEventListener("mousedown", onAny, true);
      document.removeEventListener("click", onAny, true);
      document.removeEventListener("contextmenu", onAny, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [shouldShowMenu, closeMenu]);

  // Clamp to viewport bounds after mount
  useEffect(() => {
    if (!shouldShowMenu) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let nx = position.x,
      ny = position.y;
    const BOTTOM_MARGIN = 10; // ensure some space from bottom edge
    if (rect.right > window.innerWidth) nx -= rect.right - window.innerWidth;
    if (rect.bottom > window.innerHeight - BOTTOM_MARGIN)
      ny -= rect.bottom - (window.innerHeight - BOTTOM_MARGIN);
    if (rect.left < 0) nx += -rect.left;
    if (rect.top < 0) ny += -rect.top;
    if (nx !== position.x || ny !== position.y) setPosition({ x: nx, y: ny });
  }, [shouldShowMenu, position.x, position.y, setPosition]);

  const handleExport = useCallback(
    async (settings: ClipExportSettings) => {
      if (!exportClipId || !exportKind) return;
      let clip = {...(clipsStore.getClipById(exportClipId) as
        | AnyClipProps
        | undefined)} as AnyClipProps;
      if (!clip) return;

      const likeImage = clip.type === "image"
      const likeVideo = clip.type === "video"


      const basePath = settings.path.trim();
      const baseName = settings.name.trim();
      if (!basePath || !baseName) return;

      let extension = "";
      if (settings.kind === "audio" && settings.audioFormat) {
        extension = settings.audioFormat;
      } else if (settings.kind === "image" && settings.imageFormat) {
        extension =
          settings.imageFormat === "jpeg" ? "jpg" : settings.imageFormat;
      } else if (settings.kind === "video" && settings.videoFormat) {
        extension = settings.videoFormat;
      }
      const outpath = `${basePath}/${baseName}${extension ? `.${extension}` : ""}`;

      try {
        setExporting(true);
        setExportProgress(0);

        if (settings.kind === "audio") {
          const audioClip = { ...(clip as any) };
          await exportSequence({
            mode: "audio",
            clips: [audioClip as any],
            fps,
            filename: outpath,
            audioOptions: {
              format: settings.audioFormat ?? "mp3",
            },
            onProgress: ({ ratio }) => {
              setExportProgress(typeof ratio === "number" ? ratio : 0);
            },
          });
        } else if (settings.kind === "video") {
          const baseH = settings.resolution ?? 1080;
          // Derive aspect ratio from the clip's native media dimensions when possible.
          let nativeW = 0;
          let nativeH = 0;
          if (likeImage) {
            const info = getMediaInfoCached(
              (clip as ImageClipProps).assetId,
            );
            nativeW = info?.image?.width ?? 0;
            nativeH = info?.image?.height ?? 0;
          } else if (likeVideo) {
            const info = getMediaInfoCached(
              (clip as VideoClipProps).assetId,
            );
            nativeW = info?.video?.displayWidth ?? 0;
            nativeH = info?.video?.displayHeight ?? 0;
          }

          const fallbackAspect =
            aspectRatio && aspectRatio.height > 0
              ? aspectRatio.width / aspectRatio.height
              : 16 / 9;
          const aspect =
            nativeW > 0 && nativeH > 0 ? nativeW / nativeH : fallbackAspect;

          const targetH = baseH;
          const targetW = Math.max(1, Math.round(targetH * aspect));

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
              applyCentering: true,
              useOriginalTransform: true,
              dimensionsFrom: "clip",
              target: { width: targetW, height: targetH },
            },
          );

          const { exportClips } = prepared;


          const videoEncoderOptions: any = {
            format: settings.videoFormat ?? "mp4",
            codec: (settings.videoFormat === "webm" ? "vp9" : "h264") as any,
            bitrate: "8000k",
            resolution: { width: targetW, height: targetH },
          };

          if (exportClips.length === 1) {
            await exportClip({
              mode: "video",
              clip: exportClips[0],
              fps,
              width: targetW,
              height: targetH,
              encoderOptions: videoEncoderOptions,
              backgroundColor: "#000000",
              filename: outpath,
              onProgress: ({ ratio }) => {
                setExportProgress(typeof ratio === "number" ? ratio : 0);
              },
            });
          } else {
            await exportSequence({
              mode: "video",
              clips: exportClips,
              fps,
              width: targetW,
              height: targetH,
              encoderOptions: videoEncoderOptions,
              backgroundColor: "#000000",
              filename: outpath,
              onProgress: ({ ratio }) => {
                setExportProgress(typeof ratio === "number" ? ratio : 0);
              },
            });
          }
        } else if (settings.kind === "image") {
          const baseH = settings.resolution ?? 1080;
          // Derive aspect ratio from the clip's native media dimensions when possible.
          let nativeW = 0;
          let nativeH = 0;
          if (likeImage) {
            const info = getMediaInfoCached(
              (clip as ImageClipProps).assetId,
            );
            nativeW = info?.image?.width ?? 0;
            nativeH = info?.image?.height ?? 0;
          } else if (likeVideo) {
            const info = getMediaInfoCached(
              (clip as VideoClipProps).assetId,
            );
            nativeW = info?.video?.displayWidth ?? 0;
            nativeH = info?.video?.displayHeight ?? 0;
          }

          const fallbackAspect =
            aspectRatio && aspectRatio.height > 0
              ? aspectRatio.width / aspectRatio.height
              : 16 / 9;
          const aspect =
            nativeW > 0 && nativeH > 0 ? nativeW / nativeH : fallbackAspect;

          const targetH = baseH;
          const targetW = Math.max(1, Math.round(targetH * aspect));

 
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
              useOriginalTransform: true,
              dimensionsFrom: "clip",
              target: { width: targetW, height: targetH },
            },
          );

          const { exportClips } = prepared;
          const frame =
            likeVideo || clip.type === "group"
              ? ((clip as any).selectedFrame ?? 0)
              : 0;

       
          if (exportClips.length === 1) {
            const result = await exportClip({
              mode: "image",
              width: targetW,
              height: targetH,
              imageFrame: frame,
              clip: exportClips[0],
              backgroundColor: "#000000",
              encoderOptions: {
                resolution: { width: targetW, height: targetH },
              },
              fps,
              onProgress: ({ ratio }) => {
                setExportProgress(typeof ratio === "number" ? ratio : 0);
              },
            });


            if (result instanceof Blob) {
              const buf = new Uint8Array(await result.arrayBuffer());
              await saveImageToPath(buf, outpath);
            }
          } else {
            const result = await exportSequence({
              mode: "image",
              width: targetW,
              height: targetH,
              imageFrame: frame,
              clips: exportClips,
              fps,
              onProgress: ({ ratio }) => {
                setExportProgress(typeof ratio === "number" ? ratio : 0);
              },
            });

            if (result instanceof Blob) {
              const buf = new Uint8Array(await result.arrayBuffer());
              await saveImageToPath(buf, outpath);
            }
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
      } finally {
        setExporting(false);
        setExportProgress(null);
        setExportModalOpen(false);
      }
    },
    [
      exportClipId,
      exportKind,
      clipsStore,
      fps,
      aspectRatio,
      getClipsForGroup,
      getClipsByType,
      getClipPositionScore,
      timelines,
      setExportProgress,
    ],
  );

  const onSelect = (action: string, value?: string) => {
    if (action === "none") return;
    if (target?.type === "transition") {
      if (action === "deleteTransition") removeTransition(target.clipId);
      closeMenu();
      return;
    }
    if (target?.type === "keyframe") {
      const clip = clipsStore.getClipById(target.clipId);
      if (clip && action === "deleteKeyframe") clipsStore.updateClip(target.clipId, { keyframes: removeKeysAt(clip.keyframes, target.frame) });
      else if (clip && action === "keyframeEase" && value) clipsStore.updateClip(target.clipId, { keyframes: easeKeysAt(clip.keyframes, target.frame, value as KeyframePreset) });
      else if (action === "keyframeGraph") useKeyframeGraphStore.getState().toggle();
      closeMenu();
      return;
    }
    if (target?.type === "textSelection") {
      if (action === "copy") {
        try {
          // Prefer the browser's native selection copy.
          const ok = document.execCommand?.("copy");
          if (ok) {
            closeMenu();
            return;
          }
        } catch {
          // fall through
        }
        try {
          const sel = window.getSelection?.();
          const text = sel?.toString?.() ?? "";
          if (text.trim()) navigator.clipboard?.writeText?.(text);
        } catch {
          // swallow
        }
      }
      closeMenu();
      return;
    }

    if (target?.type === "clip") {
      const ids = target.clipIds;
      if (action === "copy") clipsStore.copyClips(ids);
      else if (action === "cut") {
        clipsStore.cutClips(ids);
        useControlsStore.getState().clearSelection();
      } else if (action === "paste")
        clipsStore.pasteClips(useControlsStore.getState().focusFrame);
      else if (action === "delete") {
        ids.forEach((id) => clipsStore.removeClip(id));
        useControlsStore.getState().clearSelection();
      } else if (action === "split")
        clipsStore.splitClip(
          useControlsStore.getState().focusFrame,
          target.primaryClipId,
        );
      else if (action === "separateAudio" && target.isVideo)
        clipsStore.separateClip(target.primaryClipId);
      else if (action === "export") {
        try {
          const primaryId = target.primaryClipId;
          const clip = clipsStore.getClipById(primaryId) as
            | AnyClipProps
            | undefined;
          if (!clip) return;
          let kind: "audio" | "image" | "video" | null = null;
          if (clip.type === "audio") kind = "audio";
          else if (clip.type === "image") kind = "image";
          else if (clip.type === "video") kind = "video";
          if (!kind) return;
          setExportClipId(primaryId);
          setExportKind(kind);
          setExportModalOpen(true);
        } catch {
          // swallow
        }
      } else if (action === "group") {
        clipsStore.groupClips(ids);
      } else if (action === "ungroup") {
        clipsStore.ungroupClips(target.primaryClipId);
      } else if (action === "link") {
        clipsStore.linkClips(ids);
      } else if (action === "unlink") {
        clipsStore.unlinkClips(ids);
      } else if (action === "freeze") {
        freezeAtPlayhead(target.primaryClipId);
      } else if (action === "reverse") {
        toggleReverse(target.primaryClipId);
      } else if (action === "splitScenes" || action === "autoAdjust" || action === "colorMatch") {
        runAnalysisAction(action, target.primaryClipId);
      }
    } else if (target?.type === "marker") {
      if (action === "editMarker") useMarkerEditorStore.getState().open(target.markerId);
      else if (action === "deleteMarker") clipsStore.removeMarker(target.markerId);
      else if (action === "deleteAllMarkers") clipsStore.removeAllMarkers();
    } else if (target?.type === "track" || target?.type === "timeline") {
      if (action === "lockTrack") clipsStore.setTrackLocked(target.timelineId, true);
      else if (action === "unlockTrack") clipsStore.setTrackLocked(target.timelineId, false);
      else if (action === "deleteTrack") clipsStore.deleteTrack(target.timelineId);
      else if (action === "paste" && target.type === "timeline") {
        const frame = useControlsStore.getState().focusFrame;
        clipsStore.pasteClips(frame, target.timelineId);
        // Attempt to fix any overlaps by resolving again (pasteClips already resolves overlaps globally)
        // If needed, we could snap pasted clips to nearest valid gaps on target timeline here.
      }
    }
    closeMenu();
  };

  const ticked = groups?.some((g) => g.items.some((i) => i.checked !== undefined)) ?? false;
  const content =
    groups && groups.length > 0 ? (
      <div className="p-1">
        {groups.map(
          (group, gi) =>
            group.items.length > 0 && (
              <div key={group.id}>
                {group.label && (
                  <div className="px-2.5 py-1 text-[12px] text-[#6c6c6c]">
                    {group.label}
                  </div>
                )}
                {group.items.map((item) => (
                  <MenuRow key={item.id} item={item} ticked={ticked} onSelect={onSelect} open={openSub === item.id} setOpen={setOpenSub} />
                ))}
                {gi < groups.length - 1 && (
                  <div className="my-1 h-px bg-brand-hover mx-1" />
                )}
              </div>
            ),
        )}
      </div>
    ) : (
      <div className="p-1">
        {items.map((item) => (
          <button
            key={item.id}
            disabled={item.disabled}
            onClick={() => onSelect(item.action)}
            className="w-full h-8 px-2.5 text-left text-[13px] flex items-center justify-between rounded-[4px] hover:bg-brand-hover disabled:text-[#525252] text-brand-light"
          >
            <span>{item.label}</span>
            {item.shortcut && <Key text={item.shortcut} />}
          </button>
        ))}
      </div>
    );

  return (
    <>
      {shouldShowMenu &&
        createPortal(
          <div
            ref={containerRef}
            style={{
              position: "fixed",
              left: position.x,
              top: position.y,
              zIndex: 100,
            }}
            className="w-[238px] font-poppins select-none rounded-[8px] border-[0.5px] border-black bg-brand-header shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)]"
          >
            {content}
          </div>,
          document.body,
        )}
      {exportKind && (
        <ClipExportModal
          open={exportModalOpen}
          kind={exportKind}
          defaultName={getDefaultNameForClip(
            exportClipId
              ? (clipsStore.getClipById(exportClipId) as
                  | AnyClipProps
                  | undefined)
              : undefined,
          )}
          onOpenChange={setExportModalOpen}
          onExport={handleExport}
          isExporting={exporting}
          exportProgress={exportProgress}
        />
      )}
    </>
  );
};

export default GlobalContextMenu;
