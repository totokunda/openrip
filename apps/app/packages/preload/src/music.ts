import { ipcRenderer } from "electron";

/**
 * The Audio tab's Music and Sound effects (the main process's MusicLibraryModule): Openverse's
 * CC0, Public Domain and CC BY audio, searched through the main process (which paces and caches
 * the requests), downloaded into `<userData>/music-library/` and kept as favourites.
 */
export type MusicKind = "music" | "sfx";
export type MusicLicense = "cc0" | "pdm" | "by";

export type MusicTrack = {
  id: string;
  kind: MusicKind;
  title: string;
  author: string;
  authorUrl?: string;
  license: MusicLicense;
  licenseVersion?: string;
  licenseUrl: string;
  sourceUrl: string;
  source: string;
  durationSec: number;
  url: string;
  ext: string;
  thumbnail?: string;
};

export type MusicSearch = { kind: MusicKind; q?: string; page?: number; browse?: boolean };
export type MusicSearchResult =
  | { ok: true; tracks: MusicTrack[]; total: number; pageCount: number; stale: boolean }
  | { ok: false; error: string; offline: boolean; rateLimited: boolean };
export type MusicFile = { ok: true; path: string; url: string } | { ok: false; error: string; offline: boolean };

/** A page of results for a category (its search words) or a typed search. */
export function musicSearch(req: MusicSearch): Promise<MusicSearchResult> {
  return ipcRenderer.invoke("music:search", req);
}

/** The files already downloaded (track id to path) and the favourites, whole. */
export function musicState(): Promise<{ cached: Record<string, string>; favorites: MusicTrack[] }> {
  return ipcRenderer.invoke("music:state");
}

/** Download a track into the cache (once at a time per track); the file's path and URL. */
export function musicDownload(track: MusicTrack): Promise<MusicFile> {
  return ipcRenderer.invoke("music:download", track);
}

/** Add or remove a favourite; the new list. */
export function musicFavorite(track: MusicTrack, on: boolean): Promise<MusicTrack[]> {
  return ipcRenderer.invoke("music:favorite", { track, on });
}
