import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuChevronDown,
  LuArrowUpDown,
  LuLoader,
  LuUpload,
  LuPlus,
  LuVideo,
  LuSearch,
  LuLayoutGrid,
  LuList,
} from "react-icons/lu";
import { toast } from "sonner";
import { TbFileUpload, TbFolderUp } from "react-icons/tb";
import { ScrollArea } from "@/components/ui/scroll-area";
import Item, { MediaItem } from "@/components/media/Item";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BsFilter } from "react-icons/bs";
import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listConvertedMedia,
  importMediaPaths,
  ensureUniqueConvertedName,
  renameMediaPair,
  deleteMediaPair,
  getLowercaseExtension,
  pickMediaPaths,
  getPathForFile,
  createProxy,
  makePlayable,
  removeProxy,
} from "@app/preload";
import type { ConvertedMediaItem } from "@app/preload";
import { useProjectsStore } from "@/lib/projects";
import { getMediaInfo } from "@/lib/media/utils";
import { useEnginePreviewStore } from "@/lib/engine-preview";
import { VIDEO_EXTS, IMAGE_EXTS, AUDIO_EXTS } from "@/lib/settings";
import {
  useMediaLibraryVersion,
  bumpMediaLibraryVersion,
} from "@/lib/media/library";
import { HiFilm } from "react-icons/hi";
import { useClipStore } from "@/lib/clip";
import { useShellStore } from "@/lib/shell";
import { preferences } from "@/lib/preferences";
import { linkMissingInFolder, linkToMedia } from "@/lib/relink";
import { useRecordPanel } from "@/components/record/RecordPanel";

/** The library's grid or list, kept between sessions. */
const LAYOUT_KEY = "openrip:media-layout";

// The toolbar's icon buttons and its menus, as CapCut draws them.
const toolIcon =
  "h-6 w-6 shrink-0 rounded-[4px] text-[#d4d4d4] flex items-center justify-center transition-colors hover:bg-[#3f3f3f] cursor-pointer";
const menuSurface = "dark p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light";
const menuRow = "dark h-8 px-2.5 gap-2.5 rounded-[4px] text-[13px] cursor-pointer focus:bg-brand-hover";
const menuCheck = "dark h-8 rounded-[4px] text-[13px] focus:bg-brand-hover";

function isSupported(p: string) {
  try {
    const e = getLowercaseExtension(p);
    return (
      new Set(VIDEO_EXTS).has(e) ||
      new Set(IMAGE_EXTS).has(e) ||
      new Set(AUDIO_EXTS).has(e)
    );
  } catch (e) {
    return false;
  }
}

async function pickFilesViaInput(
  directory: boolean,
): Promise<string[] | undefined> {
  const filters = [
    {
      name: "All Supported Files",
      extensions: VIDEO_EXTS.concat(IMAGE_EXTS).concat(AUDIO_EXTS),
    },
    { name: "Video Files", extensions: VIDEO_EXTS },
    { name: "Image Files", extensions: IMAGE_EXTS },
    { name: "Audio Files", extensions: AUDIO_EXTS },
  ];

  const title = directory
    ? "Choose a folder to import"
    : "Choose file(s) to import";
  const res = await pickMediaPaths({ directory, filters, title });
  return res?.filter((p) => isSupported(p)) ?? [];
}

interface MediaSidebarProps {}

// (unused with Electron file picker)

// Videos already given a playable copy (or tried) this session, so a file that can't be
// converted isn't retried on every refresh.
const playableAttempts = new Set<string>();

/**
 * Media info for each listed item. A video whose picture this app can't decode (e.g.
 * ProRes from an iPhone) is decoded by the Rust engine when it draws the preview; without
 * it, the video first gets a playable H.264 copy, made once, which the list then points to.
 */
const fetchMediaInfos = async (list: ConvertedMediaItem[], folderUuid?: string) => {
  const infos = await Promise.allSettled(list.map((it) => getMediaInfo(it.assetUrl)));
  const engine = useEnginePreviewStore.getState();
  if (engine.enabled && engine.info?.available) return { list, infos };
  // Settings › Performance › Auto optimization: None leaves such videos as they are.
  if (preferences().autoOptimization === "none") return { list, infos };
  const key = (it: ConvertedMediaItem) => `${folderUuid ?? ""}/${it.name}`;
  const undecodable = list.filter((it, i) => {
    const r = infos[i];
    return it.type === "video" && !it.hasProxy && r.status === "fulfilled" && r.value.videoDecodable === false && !playableAttempts.has(key(it));
  });
  if (undecodable.length === 0) return { list, infos };
  for (const it of undecodable) {
    playableAttempts.add(key(it));
    const id = toast.loading(`Converting ${it.name} so it can play…`, { position: "bottom-right" });
    try {
      await makePlayable(it.name, folderUuid);
    } catch (e) {
      // A file with no video stream has nothing to convert.
      if (!String(e).includes("matches no streams")) {
        console.warn(`Could not convert ${it.name} for playback:`, e);
        toast.error(`${it.name} couldn't be converted for playback`, { position: "bottom-right", duration: 5000 });
      }
    } finally {
      toast.dismiss(id);
    }
  }
  const names = new Set(list.map((it) => it.name));
  const fresh = (await listConvertedMedia(folderUuid)).filter((it) => names.has(it.name));
  return { list: fresh, infos: await Promise.allSettled(fresh.map((it) => getMediaInfo(it.assetUrl))) };
};

// ===== Filtering & Sorting helpers (outside component) =====
type MediaType = "video" | "image" | "audio";
type SortKey = "name" | "duration" | "date";
type SortOrder = "asc" | "desc";

const filterMediaItems = (
  items: MediaItem[],
  selectedTypes: Set<MediaType>,
): MediaItem[] => {
  if (!selectedTypes || selectedTypes.size === 0) return items;
  return items.filter((it) => selectedTypes.has(it.type as MediaType));
};

const nameComparator = (a: MediaItem, b: MediaItem) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());
const dateComparator = (a: MediaItem, b: MediaItem) =>
  (a.dateAddedMs ?? 0) - (b.dateAddedMs ?? 0);
const durationComparator = (
  a: MediaItem,
  b: MediaItem,
  durations: Record<string, number | undefined>,
) => {
  const da = durations[a.assetUrl];
  const db = durations[b.assetUrl];
  const na = Number.isFinite(da as number)
    ? (da as number)
    : Number.POSITIVE_INFINITY;
  const nb = Number.isFinite(db as number)
    ? (db as number)
    : Number.POSITIVE_INFINITY;
  return na - nb;
};

const sortMediaItems = (
  items: MediaItem[],
  sortKey: SortKey,
  sortOrder: SortOrder,
  durations: Record<string, number | undefined>,
): MediaItem[] => {
  const sorted = [...items];
  let cmp: (a: MediaItem, b: MediaItem) => number;
  switch (sortKey) {
    case "duration":
      cmp = (a, b) => durationComparator(a, b, durations);
      break;
    case "date":
      cmp = dateComparator;
      break;
    case "name":
    default:
      cmp = nameComparator;
      break;
  }
  sorted.sort(cmp);
  if (sortOrder === "desc") sorted.reverse();
  return sorted;
};

// interface DeleteAlertDialogProps {
//   onDelete: () => void;
//   open: boolean;
//   onOpenChange: (open: boolean) => void;
// }

const MediaSidebar: React.FC<MediaSidebarProps> = () => {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const uploadBarRef = useRef<HTMLDivElement | null>(null);
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameContainerRef = useRef<HTMLDivElement | null>(null);
  const [deleteItem, setDeleteItem] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<MediaType>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [layout, setLayoutState] = useState<"grid" | "list">(() => {
    try {
      return window.localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const setLayout = (l: "grid" | "list") => {
    setLayoutState(l);
    try {
      window.localStorage.setItem(LAYOUT_KEY, l);
    } catch {}
  };
  // What's on the timeline: an asset is kept while a clip uses it (clip.ts prunes the rest).
  const assets = useClipStore((s) => s.assets);
  const onTimeline = useMemo(() => new Set(Object.values(assets).map((a) => a?.path)), [assets]);
  const [durationCache, setDurationCache] = useState<
    Record<string, number | undefined>
  >(() => ({}));
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const [creatingProxies, setCreatingProxies] = useState<Set<string>>(
    new Set(),
  );

  const mediaLibraryVersion = useMediaLibraryVersion();
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const folderUuid = activeProject?.folderUuid;

  const mediaQueryKey = useMemo(
    () => ["media", "converted", folderUuid ?? null] as const,
    [folderUuid],
  );

  const {
    data: items = [],
    isLoading: isMediaListLoading,
  } = useQuery({
    queryKey: mediaQueryKey,
    queryFn: async () => {
      const { list, infos: infoResults } = await fetchMediaInfos(await listConvertedMedia(folderUuid), folderUuid);
      
      const results: MediaItem[] = [];
      for (let idx = 0; idx < list.length; idx++) {
        const it = list[idx];
        const result = infoResults[idx];
        if (it.missing) {
          // A file that's gone has no info to read: the card says so (Link to media).
          results.push({ name: it.name, type: it.type, absPath: it.absPath, assetUrl: it.assetUrl, dateAddedMs: it.dateAddedMs, missing: true, target: it.target });
        } else if (result.status === "fulfilled") {
          results.push({
            name: it.name,
            type: it.type,
            absPath: it.absPath,
            assetUrl: it.assetUrl,
            dateAddedMs: it.dateAddedMs,
            mediaInfo: result.value,
            hasProxy: it.hasProxy,
            isPlayableCopy: it.isPlayableCopy,
          });
        } else {
          console.warn(`Failed to load media info for ${it.name} (skipping):`, result.reason);
        }
      }
      
      results.sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      );
      return results;
    },
    // Keep previous data visible during background refetches (prevents "flashing")
    placeholderData: (prev) => {
      if (prev) return prev;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });


  // When media library version bumps (upload/rename/delete/proxy), refetch the list.
  const lastMediaLibraryVersionRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastMediaLibraryVersionRef.current == null) {
      lastMediaLibraryVersionRef.current = mediaLibraryVersion;
      return;
    }
    if (lastMediaLibraryVersionRef.current !== mediaLibraryVersion) {
      lastMediaLibraryVersionRef.current = mediaLibraryVersion;
      void queryClient.invalidateQueries({ queryKey: mediaQueryKey });
    }
  }, [mediaLibraryVersion, queryClient, mediaQueryKey]);

  const handleUpload = async (directory: boolean = false) => {
    // Dismissed when everything is done: dismissing a toast right after showing it (the
    // import itself takes milliseconds) sometimes leaves it on screen.
    let loadingId: string | number | undefined;
    try {
      setIsUploading(true);
      const paths = await pickFilesViaInput(directory);

      if (!paths || paths.length === 0) return;
      const existingNames = new Set(items.map((it) => it.name));
      loadingId = toast.loading(`Importing ${paths.length} item(s)…`, {
        position: "bottom-right",
      });
      const folderUuid = activeProject?.folderUuid;

      await importMediaPaths(paths, undefined, folderUuid);
      const list = await listConvertedMedia(folderUuid);

      // Get the base names of files that were just uploaded
      const uploadedFileNames = new Set(
        paths.map((p) => p.split(/[/\\]/).pop()?.toLowerCase() || "")
      );
      
      // Only process files that: 1) aren't already in UI, AND 2) were just uploaded
      const { list: newItemsToFetch, infos: infoResults } = await fetchMediaInfos(
        list.filter((it) => !existingNames.has(it.name) && uploadedFileNames.has(it.name.toLowerCase())),
        folderUuid,
      );
      
      const newItems: MediaItem[] = [];
      const failedFiles: string[] = [];
      
      for (let idx = 0; idx < newItemsToFetch.length; idx++) {
        const it = newItemsToFetch[idx];
        const result = infoResults[idx];
        if (result.status === "fulfilled") {
          newItems.push({
            name: it.name,
            type: it.type,
            absPath: it.absPath,
            assetUrl: it.assetUrl,
            dateAddedMs: it.dateAddedMs,
            mediaInfo: result.value,
            hasProxy: it.hasProxy,
            isPlayableCopy: it.isPlayableCopy,
          });
        } else {
          console.warn(`Failed to get media info for ${it.name}:`, result.reason);
          failedFiles.push(it.name);
        }
      }
      
      if (failedFiles.length > 0) {
        toast.error(`${failedFiles.length} file(s) could not be imported: unsupported format`, {
          position: "bottom-right",
          duration: 5000,
        });
      }
      
      queryClient.setQueryData<MediaItem[]>(mediaQueryKey, (prev) => {
        const base = prev ?? [];
        const next = [...base, ...newItems].sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );
        return next;
      });
      bumpMediaLibraryVersion();
    } catch (error) {
      console.error(error);
      toast.error("Failed to upload file", {
        position: "bottom-right",
        duration: 3000,
        style: {
          width: "fit-content",
        },
      });
    } finally {
      if (loadingId !== undefined) toast.dismiss(loadingId);
      setIsUploading(false);
    }
  };

  const handleDraggedFiles = async (files: File[]) => {
    let loadingId: string | number | undefined;
    try {
      setIsUploading(true);
      const paths: string[] = [];
      for (const file of files) {
        try {
          const path = getPathForFile(file);
          if (path && isSupported(path)) {
            paths.push(path);
          }
        } catch (e) {
          console.warn("Could not get path for file:", e);
        }
      }
      if (paths.length === 0) {
        toast.error("No supported media files found", {
          position: "bottom-right",
          duration: 3000,
          style: { width: "fit-content" },
        });
        return;
      }
      const existingNames = new Set(items.map((it) => it.name));
      loadingId = toast.loading(`Importing ${paths.length} item(s)…`, {
        position: "bottom-right",
      });
      const folderUuid = activeProject?.folderUuid;
      await importMediaPaths(paths, undefined, folderUuid);
      const list = await listConvertedMedia(folderUuid);
      
      // Get the base names of files that were just uploaded
      const uploadedFileNames = new Set(
        paths.map((p) => p.split(/[/\\]/).pop()?.toLowerCase() || "")
      );
      
      // Only process files that: 1) aren't already in UI, AND 2) were just uploaded
      const { list: newItemsToFetch, infos: infoResults } = await fetchMediaInfos(
        list.filter((it) => !existingNames.has(it.name) && uploadedFileNames.has(it.name.toLowerCase())),
        folderUuid,
      );
      
      const newItems: MediaItem[] = [];
      const failedFiles: string[] = [];
      
      for (let idx = 0; idx < newItemsToFetch.length; idx++) {
        const it = newItemsToFetch[idx];
        const result = infoResults[idx];
        if (result.status === "fulfilled") {
          newItems.push({
            name: it.name,
            type: it.type,
            absPath: it.absPath,
            assetUrl: it.assetUrl,
            dateAddedMs: it.dateAddedMs,
            mediaInfo: result.value,
            hasProxy: it.hasProxy,
            isPlayableCopy: it.isPlayableCopy,
          });
        } else {
          console.warn(`Failed to get media info for ${it.name}:`, result.reason);
          failedFiles.push(it.name);
        }
      }
      
      if (failedFiles.length > 0) {
        toast.error(`${failedFiles.length} file(s) could not be imported: unsupported format`, {
          position: "bottom-right",
          duration: 5000,
        });
      }
      
      queryClient.setQueryData<MediaItem[]>(mediaQueryKey, (prev) => {
        const base = prev ?? [];
        const next = [...base, ...newItems].sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );
        return next;
      });
      bumpMediaLibraryVersion();
    } catch (error) {
      console.error(error);
      toast.error("Failed to import files", {
        position: "bottom-right",
        duration: 3000,
        style: { width: "fit-content" },
      });
    } finally {
      if (loadingId !== undefined) toast.dismiss(loadingId);
      setIsUploading(false);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await handleDraggedFiles(files);
    }
  };

  // ensures "a (1).mp4", "a (2).mp4", etc., on converted side
  const ensureUniqueName = async (desired: string) => {
    return ensureUniqueConvertedName(desired);
  };

  const sanitizeBaseName = (name: string) => {
    const trimmed = name.trim();
    // Replace invalid characters for cross-platform compatibility
    const replaced = trimmed.replace(/[\\/:*?"<>|]/g, "-");
    // Collapse whitespace
    const collapsed = replaced.replace(/\s+/g, " ");
    // Remove trailing dots/spaces which are invalid on Windows
    const noTrail = collapsed.replace(/[ .]+$/g, "");
    // Limit length
    const limited = noTrail.slice(0, 128);
    return limited || "Untitled";
  };

  const startRename = (item: MediaItem) => {
    const dot = item.name.lastIndexOf(".");
    const base = dot >= 0 ? item.name.slice(0, dot) : item.name;
    setRenamingItem(item.name);
    setRenameValue(base);
    // focus happens on render via autoFocus; small delay to ensure selection
    setTimeout(() => {
      renameInputRef.current?.select();
    }, 0);
  };

  const commitRename = async (originalName: string) => {
    const dot = originalName.lastIndexOf(".");
    const ext = dot >= 0 ? originalName.slice(dot) : "";
    // const oldRel = await join(BASE_MEDIA_DIR, '24', originalName);
    const sanitizedBase = sanitizeBaseName(
      renameValue.replace(new RegExp(`${ext.replace(".", "\\.")}$`), ""),
    );
    const oldBase = dot >= 0 ? originalName.slice(0, dot) : originalName;
    if (sanitizedBase === oldBase) {
      setRenamingItem(null);
      return;
    }
    const unique = await ensureUniqueName(`${sanitizedBase}${ext}`);
    // const newRel = await join(BASE_MEDIA_DIR, '24', unique);
    try {
      const folderUuid = activeProject?.folderUuid;
      await renameMediaPair(originalName, unique, folderUuid);
      toast.success(`Renamed to ${unique}`, {
        position: "bottom-right",
        duration: 3000,
        style: { width: "fit-content" },
      });
      setRenamingItem(null);
      setRenameValue("");
      queryClient.setQueryData<MediaItem[]>(mediaQueryKey, (prev) => {
        const base = prev ?? [];
        const next = base
          .map((item) => {
            if (item.name === originalName) {
              const newAbsPath = item.absPath.replace(originalName, unique);
              const newAssetUrl = item.assetUrl.replace(
                encodeURIComponent(originalName),
                encodeURIComponent(unique),
              );
              return {
                ...item,
                name: unique,
                assetUrl: newAssetUrl,
                absPath: newAbsPath,
              };
            }
            return item;
          })
          .sort((a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
          );
        return next;
      });
      bumpMediaLibraryVersion();
    } catch (e) {
      console.error(e);
      toast.error("Failed to rename", {
        position: "bottom-right",
        duration: 3000,
        style: { width: "fit-content" },
      });
      setRenamingItem(null);
    }
  };

  useEffect(() => {
    if (!renamingItem) return;
    const onDocPointerDown = (ev: PointerEvent) => {
      const container = renameContainerRef.current;
      if (!container) return;
      if (!container.contains(ev.target as Node)) {
        commitRename(renamingItem);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  }, [renamingItem, commitRename]);

  const handleDelete = useCallback(
    async (name: string) => {
      try {
        const folderUuid = activeProject?.folderUuid;
        await deleteMediaPair(name, folderUuid);
        toast.success(`Deleted ${name}`, {
          position: "bottom-right",
          duration: 3000,
          style: {
            width: "fit-content",
          },
        });
        const removed = items.find((it) => it.name === name);
        queryClient.setQueryData<MediaItem[]>(mediaQueryKey, (prev) =>
          (prev ?? []).filter((item) => item.name !== name),
        );
        setDurationCache((prev) => {
          const next = { ...prev };
          if (removed?.assetUrl) delete next[removed.assetUrl];
          return next;
        });
        bumpMediaLibraryVersion();
      } catch (e) {
        console.error(e);
        toast.error("Failed to delete", {
          position: "bottom-right",
          duration: 3000,
          style: {
            width: "fit-content",
          },
        });
      }
    },
    [items, activeProject?.folderUuid, queryClient, mediaQueryKey],
  );

  const handleCreateProxy = useCallback(
    async (item: MediaItem) => {
      try {
        setCreatingProxies((prev) => new Set(prev).add(item.name));
        const loadingId = toast.loading("Creating proxy...", {
          position: "bottom-right",
        });
        await createProxy(item.name, "480p", folderUuid ?? undefined);
        toast.dismiss(loadingId);
        toast.success("Proxy created", {
          position: "bottom-right",
          duration: 3000,
          style: { width: "fit-content" },
        });
        queryClient.setQueryData<MediaItem[]>(mediaQueryKey, (prev) =>
          (prev ?? []).map((it) =>
            it.name === item.name ? { ...it, hasProxy: true } : it,
          ),
        );
        await queryClient.invalidateQueries({ queryKey: mediaQueryKey });
        bumpMediaLibraryVersion();
      } catch (e) {
        console.error(e);
        toast.error("Failed to create proxy", {
          position: "bottom-right",
          duration: 3000,
          style: { width: "fit-content" },
        });
      } finally {
        setCreatingProxies((prev) => {
          const next = new Set(prev);
          next.delete(item.name);
          return next;
        });
      }
    },
    [folderUuid, mediaQueryKey, queryClient],
  );

  const handleRemoveProxy = useCallback(
    async (item: MediaItem) => {
      try {
        await removeProxy(item.name, folderUuid ?? undefined);
        toast.success("Proxy removed", {
          position: "bottom-right",
          duration: 3000,
          style: { width: "fit-content" },
        });
        queryClient.setQueryData<MediaItem[]>(mediaQueryKey, (prev) =>
          (prev ?? []).map((it) =>
            it.name === item.name ? { ...it, hasProxy: false } : it,
          ),
        );
        await queryClient.invalidateQueries({ queryKey: mediaQueryKey });
        bumpMediaLibraryVersion();
      } catch (e) {
        console.error(e);
        toast.error("Failed to remove proxy", {
          position: "bottom-right",
          duration: 3000,
          style: { width: "fit-content" },
        });
      }
    },
    [folderUuid, mediaQueryKey, queryClient],
  );

  // removed old inline thumbnail implementations in favor of memoized MediaThumb above
  // Prefetch durations lazily when sorting by duration
  useEffect(() => {
    if (sortKey !== "duration") return;
    let cancelled = false;
    (async () => {
      const targets = items.filter(
        (it) =>
          (it.type === "video" || it.type === "audio") &&
          durationCache[it.assetUrl] == null,
      );
      for (const it of targets) {
        try {
          const info = await getMediaInfo(it.assetUrl);
          if (cancelled) return;
          setDurationCache((prev) => ({
            ...prev,
            [it.assetUrl]: info?.duration ?? undefined,
          }));
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sortKey, items]);

  const displayItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = filterMediaItems(items, selectedTypes).filter((it) => !q || it.name.toLowerCase().includes(q));
    return sortMediaItems(f, sortKey, sortOrder, durationCache);
  }, [items, selectedTypes, sortKey, sortOrder, durationCache, search]);

  // The home screen's Import media: the picker opens as soon as the new project's library shows.
  const importOnOpen = useShellStore((s) => s.importOnOpen);
  useEffect(() => {
    if (!importOnOpen) return;
    useShellStore.getState().setImportOnOpen(false);
    void handleUpload(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importOnOpen]);

  const missingItems = useMemo(() => items.filter((it) => it.missing), [items]);
  const empty = !isMediaListLoading && items.length === 0;
  const [searching, setSearching] = useState(false);
  const heading =
    selectedTypes.size === 0
      ? "All"
      : [...selectedTypes].map((t) => ({ video: "Videos", image: "Images", audio: "Audio" })[t] ?? t).join(", ");

  return (
    <div ref={panelRef} className="h-full w-full flex flex-col">
      {!empty && (
      <div className="shrink-0 flex flex-row items-center gap-1.5 px-3 pt-3 pb-1">
        {searching ? (
          <div className="relative flex-1 min-w-0">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearch("");
                  setSearching(false);
                }
              }}
              onBlur={() => !search && setSearching(false)}
              placeholder="Search media"
              data-testid="media-search"
              className="w-full h-6 rounded-[4px] px-2 text-[12px] bg-[#121212] text-brand-light placeholder:text-brand-light/35 border border-[#515151]"
            />
          </div>
        ) : (
          <>
        <DropdownMenu>
          <div
            ref={uploadBarRef}
            className="h-6 shrink-0 bg-brand-background-light border border-dashed border-brand-button flex flex-row items-center text-brand-lighter text-[12px] font-medium rounded-[4px] transition-colors cursor-pointer"
          >
            <span
              data-testid="media-import"
              onClick={() => handleUpload(false)}
              className="h-full pl-1.5 pr-1.5 flex flex-row gap-x-1.5 rounded-l-[4px] items-center justify-center hover:bg-brand-button"
            >
              {isUploading ? (
                <LuLoader className="w-3.5 h-3.5 animate-spin text-brand-accent" />
              ) : (
                <span className="w-3.5 h-3.5 rounded-full bg-brand-accent text-white flex items-center justify-center">
                  <LuPlus className="w-2.5 h-2.5 stroke-[3]" />
                </span>
              )}
              <span>{isUploading ? "Importing…" : "Import"}</span>
            </span>
            <DropdownMenuTrigger aria-label="More ways to import" className="h-full px-0.5 flex items-center justify-center w-5 hover:bg-brand-button rounded-r-[4px]">
              <LuChevronDown className="w-3 h-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4} className={cn(menuSurface, "w-[186px]")}>
              <DropdownMenuItem onClick={() => handleUpload(false)} className={menuRow}>
                <TbFileUpload className="w-4 h-4" />
                <span>Import files</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleUpload(true)} className={menuRow}>
                <TbFolderUp className="w-4 h-4" />
                <span>Import a folder</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </div>
        </DropdownMenu>
        <button
          type="button"
          title="Record the screen or the camera"
          data-testid="media-record"
          onClick={() => useRecordPanel.getState().setOpen(true)}
          className="h-6 shrink-0 px-2 flex items-center gap-1.5 rounded-[4px] bg-brand-background-light text-[12px] font-medium text-brand-lighter hover:bg-brand-button cursor-pointer"
        >
          <LuVideo className="w-3.5 h-3.5" />
          Record
        </button>
        <div className="flex-1" />
        <button
          type="button"
          title="Search"
          data-testid="media-search-open"
          onClick={() => setSearching(true)}
          className={toolIcon}
        >
          <LuSearch className="w-3.5 h-3.5" />
        </button>
          </>
        )}
        <span className="w-px h-3 bg-brand-hover shrink-0" />
        <button
          type="button"
          title={layout === "grid" ? "Show as a list" : "Show as a grid"}
          data-testid="media-layout"
          onClick={() => setLayout(layout === "grid" ? "list" : "grid")}
          className={toolIcon}
        >
          {layout === "grid" ? <LuList className="w-3.5 h-3.5" /> : <LuLayoutGrid className="w-3.5 h-3.5" />}
        </button>
        <span className="w-px h-3 bg-brand-hover shrink-0" />
        <DropdownMenu open={sortOpen} onOpenChange={setSortOpen}>
          <DropdownMenuTrigger asChild>
            <button className={cn(toolIcon, sortOpen && "bg-[#3f3f3f]")} title="Sort" aria-label="Sort">
              <LuArrowUpDown className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(menuSurface, "w-[155px]")}>
            {/* Sort key (mutually exclusive via checkboxes) */}
            <DropdownMenuCheckboxItem
              className={menuCheck}
              checked={sortKey === "name"}
              onCheckedChange={(checked) => {
                if (checked) setSortKey("name");
              }}
            >
              Name
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              className={menuCheck}
              checked={sortKey === "duration"}
              onCheckedChange={(checked) => {
                if (checked) setSortKey("duration");
              }}
            >
              Duration
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              className={menuCheck}
              checked={sortKey === "date"}
              onCheckedChange={(checked) => {
                if (checked) setSortKey("date");
              }}
            >
              Date Added
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {/* Sort order (mutually exclusive via checkboxes) */}
            <DropdownMenuCheckboxItem
              className={menuCheck}
              checked={sortOrder === "asc"}
              onCheckedChange={(checked) => {
                if (checked) setSortOrder("asc");
              }}
            >
              Ascending
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              className={menuCheck}
              checked={sortOrder === "desc"}
              onCheckedChange={(checked) => {
                if (checked) setSortOrder("desc");
              }}
            >
              Descending
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="w-px h-3 bg-brand-hover shrink-0" />
        <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
          <DropdownMenuTrigger asChild>
            <button className={cn(toolIcon, (filterOpen || selectedTypes.size > 0) && "bg-[#3f3f3f]")} title="Filter" aria-label="Filter">
              <BsFilter className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(menuSurface, "w-[140px]")}>
            <DropdownMenuCheckboxItem
              className={menuCheck}
              checked={selectedTypes.size === 0}
              onCheckedChange={(checked) => {
                if (checked) setSelectedTypes(new Set());
              }}
            >
              All
            </DropdownMenuCheckboxItem>
            {([
              ["video", "Videos"],
              ["image", "Images"],
              ["audio", "Audio"],
            ] as const).map(([type, label]) => (
              <DropdownMenuCheckboxItem
                key={type}
                className={menuCheck}
                checked={selectedTypes.has(type)}
                onCheckedChange={(checked) => {
                  setSelectedTypes((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(type);
                    else next.delete(type);
                    return next;
                  });
                }}
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      )}
      <div
        ref={listContainerRef}
        className="flex-1 min-h-0 relative"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Only show the loading state when we have no items yet.
            This prevents the entire panel from "flashing" to the loading/empty state
            when updating a single item's state (rename, delete, proxy changes). */}
        {isMediaListLoading && items.length === 0 && (
          <div className="text-brand-lighter/70 text-[13px] px-5 py-8 justify-center flex flex-row items-center gap-x-2">
              <div className="rounded-md border bg-brand border-brand-lighter/30 animate-ripple font-medium px-3.5 py-1 flex flex-row items-center gap-x-2">
                <HiFilm className="w-4 h-4 animate-pulse" />
                <div className="relative z-10 flex flex-row items-center gap-x-2">Loading media...</div>
            </div>  
          </div>
        )}
        {empty && (
          <div className="h-full p-3">
            <button
              type="button"
              data-testid="media-import"
              onClick={() => handleUpload(false)}
              className="w-full h-full rounded-[6px] border border-dashed border-[#525252] bg-brand-background-light hover:bg-[#424242] flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2 text-[15px] font-semibold text-brand-lighter">
                <span className="w-[18px] h-[18px] rounded-full bg-brand-accent text-white flex items-center justify-center">
                  {isUploading ? <LuLoader className="w-3 h-3 animate-spin" /> : <LuPlus className="w-3 h-3 stroke-[3]" />}
                </span>
                {isUploading ? "Importing…" : "Import"}
              </span>
              <span className="text-[12px] text-[#949494]">Drag and drop videos, photos and audio files here</span>
            </button>
          </div>
        )}
        {/* Keep showing the grid even while background reloads happen. */}
        {items.length > 0 && (
          <ScrollArea className="h-full px-3 pb-3 pt-1 dark">
            {missingItems.length > 0 && (
              <div data-testid="media-missing-bar" className="mt-2 mb-1 rounded-[4px] bg-[#3a1d1f] px-2.5 py-2 text-left text-[12px] text-[#e5898c] flex flex-row items-center gap-2">
                <span className="flex-1 min-w-0">
                  {missingItems.length} media file{missingItems.length > 1 ? "s are" : " is"} missing
                </span>
                <button
                  type="button"
                  data-testid="media-link-folder"
                  onClick={() => void linkMissingInFolder(missingItems.map((m) => ({ name: m.name, target: m.target ?? m.name })))}
                  className="shrink-0 h-[22px] px-2 rounded-[4px] bg-brand-button text-brand-light hover:brightness-110 cursor-pointer"
                >
                  Link to a folder
                </button>
              </div>
            )}
            <div className="text-[12px] text-brand-light text-left pt-2 pb-2">{heading}</div>
            <div
              className={cn("grid w-full", layout === "grid" ? "gap-x-4 gap-y-3" : "gap-0.5")}
              style={{
                gridTemplateColumns: layout === "grid" ? "repeat(auto-fill, 120px)" : "1fr",
              }}
            >
              {displayItems.map((item) => (
                <Item
                  key={item.name}
                  item={item}
                  renamingItem={renamingItem}
                  setRenamingItem={setRenamingItem}
                  renameContainerRef={renameContainerRef}
                  renameInputRef={renameInputRef}
                  renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  commitRename={commitRename}
                  setDeleteItem={setDeleteItem}
                  setDeleteAlertOpen={setDeleteAlertOpen}
                  deleteAlertOpen={deleteAlertOpen}
                  deleteItem={deleteItem}
                  handleDelete={handleDelete}
                  startRename={startRename}
                  onCreateProxy={handleCreateProxy}
                  onRemoveProxy={handleRemoveProxy}
                  isCreatingProxy={creatingProxies.has(item.name)}
                  added={onTimeline.has(item.assetUrl)}
                  layout={layout === "list" ? "row" : "card"}
                  onRelink={(it) => void linkToMedia({ name: it.name, target: it.target ?? it.name })}
                />
              ))}
            </div>
          </ScrollArea>
        )}
        {isDragging && (
          <div className="absolute inset-0 bg-brand/80 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none z-50 m-2 border-2 border-dashed border-brand-light/80 rounded-lg">
            <LuUpload className="w-7 h-7 text-brand-light mb-2.5" />
            <div className="flex flex-col items-center gap-y-1">
              <span className="text-brand-lighter text-base font-medium">
                Drop files here
              </span>
              <span className="text-brand-lighter/60 text-xs">
                Supports video, image, and audio files
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MediaSidebar;
