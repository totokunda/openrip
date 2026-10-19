// The Audio tab's Music and Sound effects libraries on the renderer's side: the categories
// (each one a search for Openverse), what's downloaded, the favourites, the track being
// previewed, and adding a track to the timeline. Openverse is asked through the main process
// (MusicLibraryModule), which paces the requests and keeps their results.
import { create } from "zustand";
import { musicDownload, musicFavorite, musicSearch, musicState, type MusicKind, type MusicSearchResult, type MusicTrack } from "@app/preload";
import { addSoundAtPlayhead } from "./audio-tools";
import { convertUserDataPath } from "./media/utils";
import { creditOf } from "./music-credits";
import type { MediaItem } from "@/components/media/Item";
import type { MediaInfo } from "./types";

export type { MusicKind, MusicTrack };

/** A category: its name in the column and the words Openverse is asked for ("" for Trending). */
export type MusicCategory = { id: string; label: string; q: string };

const cat = (label: string, q = label.toLowerCase()): MusicCategory => ({ id: label, label, q });

/** Music: Trending first, then moods, then genres (CapCut lists them as one column). */
export const MUSIC_CATEGORIES: MusicCategory[] = [
  cat("Trending", ""),
  cat("Happy"),
  cat("Chill"),
  cat("Epic"),
  cat("Romantic"),
  cat("Sad"),
  cat("Dark"),
  cat("Dreamy"),
  cat("Energetic"),
  cat("Hip-Hop", "hip hop"),
  cat("Electronic"),
  cat("Rock"),
  cat("Pop"),
  cat("Jazz"),
  cat("Classical"),
  cat("Funk"),
  cat("Ambient"),
  cat("Cinematic"),
  cat("Acoustic"),
  cat("Lo-fi", "lofi"),
];

/** Sound effects, by kind of sound. */
export const SFX_CATEGORIES: MusicCategory[] = [
  cat("Trending", "sound effect"),
  cat("Whoosh"),
  cat("Click"),
  cat("Applause"),
  cat("Nature"),
  cat("Impact"),
  cat("Explosion"),
  cat("Laugh"),
  cat("Footsteps"),
  cat("Water"),
  cat("Animals"),
  cat("Notification"),
  cat("Ambience"),
  cat("Comedy"),
];

/** The Audio tab's section ids for the libraries: `music:Epic`, `sfx:Whoosh`. */
export const librarySection = (kind: MusicKind, c: MusicCategory) => `${kind}:${c.id}`;
export const parseLibrarySection = (section: string): { kind: MusicKind; category: MusicCategory } | null => {
  const m = /^(music|sfx):(.+)$/.exec(section);
  if (!m) return null;
  const kind = m[1] as MusicKind;
  const category = (kind === "music" ? MUSIC_CATEGORIES : SFX_CATEGORIES).find((c) => c.id === m[2]);
  return category ? { kind, category } : null;
};

type Library = {
  loaded: boolean;
  /** Track id to its downloaded file's path. */
  cached: Record<string, string>;
  favorites: MusicTrack[];
  /** Ids being downloaded. */
  loading: string[];
  failed: Record<string, string>;
  /** The track being previewed and whether it's sounding. */
  previewId: string | null;
  playing: boolean;
  load: () => Promise<void>;
  download: (t: MusicTrack) => Promise<string | null>;
  toggleFavorite: (t: MusicTrack) => Promise<void>;
  preview: (t: MusicTrack) => void;
  stopPreview: () => void;
};

let audio: HTMLAudioElement | null = null;
const player = () => {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
};

export const useMusicLibrary = create<Library>((set, get) => ({
  loaded: false,
  cached: {},
  favorites: [],
  loading: [],
  failed: {},
  previewId: null,
  playing: false,
  load: async () => {
    try {
      const s = await musicState();
      set({ cached: s.cached, favorites: s.favorites, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  download: async (t) => {
    const have = get().cached[t.id];
    if (have) return have;
    if (get().loading.includes(t.id)) return null;
    set((s) => ({ loading: [...s.loading, t.id], failed: { ...s.failed, [t.id]: "" } }));
    const r = await musicDownload(t).catch((e) => ({ ok: false as const, error: String(e), offline: false }));
    set((s) => ({
      loading: s.loading.filter((id) => id !== t.id),
      cached: r.ok ? { ...s.cached, [t.id]: r.path } : s.cached,
      failed: { ...s.failed, [t.id]: r.ok ? "" : r.offline ? "No connection" : r.error },
    }));
    return r.ok ? r.path : null;
  },
  toggleFavorite: async (t) => {
    const on = !get().favorites.some((f) => f.id === t.id);
    // Shown at once; the main process keeps the list.
    set((s) => ({ favorites: on ? [t, ...s.favorites.filter((f) => f.id !== t.id)] : s.favorites.filter((f) => f.id !== t.id) }));
    const list = await musicFavorite(t, on).catch(() => null);
    if (list) set({ favorites: list });
    // A favourite is kept on this machine too, so it plays without a network.
    if (on) void get().download(t);
  },
  preview: (t) => {
    const a = player();
    if (get().previewId === t.id && get().playing) {
      get().stopPreview();
      return;
    }
    const file = get().cached[t.id];
    a.pause();
    a.onended = () => set({ playing: false });
    a.onpause = () => set({ playing: false });
    a.onplaying = () => set({ playing: true });
    a.onerror = () => {
      console.warn("[music-library] can't play", a.src, a.error?.message);
      set({ playing: false, previewId: null, failed: { ...get().failed, [t.id]: "Couldn't play it" } });
    };
    // A downloaded track plays from the user data (the app:// protocol serves local files).
    a.src = file ? convertUserDataPath(fileUrl(file)) : t.url;
    set({ previewId: t.id, playing: false });
    void a.play().catch(() => undefined);
  },
  stopPreview: () => {
    audio?.pause();
    set({ playing: false, previewId: null });
  },
}));

/** A track as an audio MediaItem, which the timeline's drop takes like a media card; needs the file downloaded. */
export const trackItem = (t: MusicTrack, path: string, mediaInfo: MediaInfo): MediaItem => {
  const url = fileUrl(path);
  return { name: t.title, type: "audio", absPath: url, assetUrl: url, mediaInfo, credit: creditOf(t) };
};

export const fileUrl = (path: string): string => new URL(`file://${path.split("/").map(encodeURIComponent).join("/")}`).href;

/** Download the track if it isn't here, then put it on a new audio track at the playhead. */
export const addTrackAtPlayhead = async (t: MusicTrack): Promise<boolean> => {
  const path = await useMusicLibrary.getState().download(t);
  if (!path) return false;
  addSoundAtPlayhead(fileUrl(path), t.durationSec, creditOf(t));
  return true;
};

/** One category's (or one search's) tracks, a page at a time. */
export type LibraryPage = { tracks: MusicTrack[]; page: number; pageCount: number; total: number; stale: boolean };
export type LibraryResult = { kind: "ok"; data: LibraryPage } | { kind: "error"; message: string; offline: boolean; rateLimited: boolean };

export const fetchPage = async (kind: MusicKind, q: string, page: number, browse: boolean): Promise<LibraryResult> => {
  const r: MusicSearchResult = await musicSearch({ kind, q: q || undefined, page, browse }).catch(
    (e): MusicSearchResult => ({ ok: false, error: String(e), offline: false, rateLimited: false }),
  );
  if (!r.ok) return { kind: "error", message: r.error, offline: r.offline, rateLimited: r.rateLimited };
  return { kind: "ok", data: { tracks: r.tracks, page, pageCount: r.pageCount, total: r.total, stale: r.stale } };
};

