import { useEffect } from "react";
import { create } from "zustand";
import { mediaMissing } from "@app/preload";
import { useClipStore } from "@/lib/clip";
import { useQueryClient } from "@tanstack/react-query";
import { useProjectsStore } from "@/lib/projects";
import { bumpMediaLibraryVersion, useMediaLibraryVersion } from "./library";

/**
 * Which of the project's media files are gone (moved, deleted, a drive unplugged): the
 * asset paths whose file can't be read. The Media tab's cards, the timeline's clips and the
 * preview's "Media missing" read it; Link to media (lib/relink.ts) empties it again.
 */
export const useMissingMedia = create<{ paths: ReadonlySet<string> }>(() => ({ paths: new Set() }));

/** Whether this asset path (a file URL as the project keeps it) is a file that's gone. */
export const useIsMissing = (path: string | undefined): boolean => useMissingMedia((s) => !!path && s.paths.has(path));

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((p) => b.has(p));

/** Look at the files again: the project's assets and any extra paths (library cards). */
export async function refreshMissingMedia(extra: string[] = []): Promise<void> {
  const paths = [...new Set([...Object.values(useClipStore.getState().assets).map((a) => a?.path), ...extra].filter((p): p is string => !!p))];
  let gone: string[] = [];
  try {
    gone = await mediaMissing(paths);
  } catch {
    return;
  }
  const next = new Set(gone);
  if (!sameSet(useMissingMedia.getState().paths, next)) useMissingMedia.setState({ paths: next });
}

/**
 * Keeps `useMissingMedia` current: when the project's assets change, the library does and the
 * window gets the focus back (a file moved in the Finder meanwhile). Mount it once in the editor.
 */
export function useMissingMediaWatcher(): void {
  const assets = useClipStore((s) => s.assets);
  const version = useMediaLibraryVersion();
  const queryClient = useQueryClient();
  const folder = useProjectsStore((s) => s.getActiveProject()?.folderUuid);
  useEffect(() => {
    void refreshMissingMedia();
  }, [assets, version]);
  useEffect(() => {
    const onFocus = async () => {
      await refreshMissingMedia();
      // The Media tab's cards too: when a card's file came or went, the list is read again.
      const items = queryClient.getQueryData<{ assetUrl: string; missing?: boolean }[]>(["media", "converted", folder ?? null]);
      if (!items?.length) return;
      const gone = new Set(await mediaMissing(items.map((i) => i.assetUrl)));
      if (items.some((i) => !!i.missing !== gone.has(i.assetUrl))) bumpMediaLibraryVersion();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [queryClient, folder]);
}
