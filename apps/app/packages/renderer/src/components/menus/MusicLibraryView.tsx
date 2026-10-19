import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDndMonitor } from "@dnd-kit/core";
import { LuAudioLines, LuDownload, LuLoaderCircle, LuMusic, LuPause, LuPlus, LuSearch, LuStar, LuTriangleAlert, LuWifiOff, LuX } from "react-icons/lu";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import Draggable from "@/components/dnd/Draggable";
import { cn } from "@/lib/utils";
import { getMediaInfo } from "@/lib/media/utils";
import type { MediaInfo } from "@/lib/types";
import { addTrackAtPlayhead, fetchPage, fileUrl, trackItem, useMusicLibrary, type LibraryPage, type MusicCategory, type MusicKind, type MusicTrack } from "@/lib/music-library";
import { licenseLabel, needsCredit } from "@/lib/music-credits";

/** The media info of downloaded tracks, kept so a row mounted again can be dragged at once. */
const infoCache = new Map<string, MediaInfo>();

const timeOf = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** Text for a licence on hover: what it is and what it asks. */
const licenceTitle = (t: MusicTrack) =>
  `${licenseLabel(t)}${needsCredit(t) ? ": free to use in your videos, including commercial ones, with a credit (Export lists it)" : ": free to use in your videos with no credit required"}`;

/**
 * CapCut's library row: 48 px on a 60 px pitch, the raised fill, a 32 px cover (the track's own
 * when it has one, else a note), the title over "artist · duration", the star, and at the right
 * the download arrow (a spinner while it loads), which is "+" once the track is on this machine.
 * A click previews it; a downloaded track drags onto the timeline like a media card.
 */
export const TrackRow: React.FC<{ track: MusicTrack; added: boolean }> = ({ track, added }) => {
  const cached = useMusicLibrary((s) => !!s.cached[track.id]);
  const path = useMusicLibrary((s) => s.cached[track.id]);
  const loading = useMusicLibrary((s) => s.loading.includes(track.id));
  const failed = useMusicLibrary((s) => s.failed[track.id]);
  const favourite = useMusicLibrary((s) => s.favorites.some((f) => f.id === track.id));
  const previewing = useMusicLibrary((s) => s.previewId === track.id);
  const playing = useMusicLibrary((s) => s.previewId === track.id && s.playing);
  const { preview, download, toggleFavorite } = useMusicLibrary.getState();
  const [coverFailed, setCoverFailed] = useState(false);
  // What the timeline needs to take a drop (the file's length), read once it's on this machine.
  const [info, setInfo] = useState<MediaInfo | null>(() => (path ? (infoCache.get(path) ?? null) : null));
  useEffect(() => {
    if (!path || infoCache.has(path)) return;
    let live = true;
    void getMediaInfo(fileUrl(path))
      .then((i) => {
        if (!i) return;
        infoCache.set(path, i);
        if (live) setInfo(i);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path]);
  const own = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();
  // A draggable row starts its drag as the pointer goes down, which swallows the click: a press
  // that ends without a move is the click (as the Stickers tiles do it). A row that isn't
  // draggable yet takes the plain click. Either way, one preview per press.
  const lastPreview = useRef(0);
  const press = () => {
    if (Date.now() - lastPreview.current < 400) return;
    lastPreview.current = Date.now();
    preview(track);
  };
  useDndMonitor({
    onDragEnd: (e) => {
      if (e.active.id === `music-${track.id}` && Math.hypot(e.delta.x, e.delta.y) <= 3) press();
    },
  });
  const add = async () => {
    const ok = await addTrackAtPlayhead(track);
    if (!ok) toast.error("Couldn't download that track", { position: "bottom-right", description: useMusicLibrary.getState().failed[track.id] || undefined });
  };
  const round = "h-4 w-4 shrink-0 rounded-full flex items-center justify-center transition-colors";
  const body = (
      <div
        data-testid="music-row"
        data-id={track.id}
        data-title={track.title}
        data-license={track.license}
        data-cached={cached ? "1" : "0"}
        data-draggable={path && info ? "1" : "0"}
        data-playing={playing ? "1" : "0"}
        title={`${track.title} by ${track.author}. ${licenceTitle(track)}`}
        role="button"
        tabIndex={0}
        onClick={press}
        className={cn("group h-12 w-full rounded-[6px] bg-brand-background-light flex flex-row items-center gap-2.5 px-2 cursor-pointer hover:bg-[#404040]", previewing && "ring-[0.5px] ring-brand-accent/70")}
      >
        <div className="relative h-8 w-8 shrink-0 rounded-[4px] bg-[#1d1d1d] flex items-center justify-center text-[#949494] overflow-hidden">
          {track.thumbnail && !coverFailed ? (
            <img src={track.thumbnail} alt="" loading="lazy" draggable={false} onError={() => setCoverFailed(true)} className="h-full w-full object-cover" />
          ) : track.kind === "music" ? (
            <LuMusic className="h-4 w-4" />
          ) : (
            <LuAudioLines className="h-4 w-4" />
          )}
          {previewing && (
            <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-brand-light">
              {playing ? <LuPause className="h-3.5 w-3.5" /> : <LuLoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-brand-light truncate">{track.title}</div>
          <div className="text-[11px] text-[#949494] tabular-nums truncate">
            {track.author} · {timeOf(track.durationSec)}
            <span data-testid="music-license" className="ml-2 px-1 py-px rounded-[2px] bg-brand-background-dark/70 text-[10px] text-[#b8b8b8]">
              {track.license === "by" ? "CC BY" : track.license === "cc0" ? "CC0" : "PD"}
            </span>
            {added && <span className="ml-1.5 px-1.5 py-px rounded-[2px] bg-brand-background-dark/85 text-[10px] text-brand-light">Added</span>}
          </div>
        </div>
        <button
          type="button"
          data-testid="music-favorite"
          aria-pressed={favourite}
          title={favourite ? "Remove from Favorites" : "Add to Favorites"}
          aria-label={favourite ? `Remove ${track.title} from Favorites` : `Add ${track.title} to Favorites`}
          onPointerDown={own}
          onClick={(e) => {
            e.stopPropagation();
            void toggleFavorite(track);
          }}
          className={cn(round, "h-5 w-5", favourite ? "text-brand-accent" : "text-brand-light hover:text-brand-accent")}
        >
          <LuStar className="h-3.5 w-3.5" fill={favourite ? "currentColor" : "none"} />
        </button>
        {cached ? (
          <button
            type="button"
            data-testid="music-add"
            title="Add to the timeline at the playhead"
            aria-label={`Add ${track.title} at the playhead`}
            onPointerDown={own}
            onClick={(e) => {
              e.stopPropagation();
              void add();
            }}
            className={cn(round, "bg-[#1d1d1d] text-brand-light hover:bg-brand-accent hover:text-white")}
          >
            <LuPlus className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            data-testid="music-download"
            title={failed ? `${failed}. Try again` : loading ? "Downloading" : "Download"}
            aria-label={`Download ${track.title}`}
            onPointerDown={own}
            onClick={(e) => {
              e.stopPropagation();
              void download(track);
            }}
            className={cn(round, "h-5 w-5 text-brand-light hover:text-brand-accent", failed && "text-[#e0735f]")}
          >
            {loading ? <LuLoaderCircle data-testid="music-spinner" className="h-3.5 w-3.5 animate-spin" /> : failed ? <LuTriangleAlert className="h-3.5 w-3.5" /> : <LuDownload className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
  );
  // Only a downloaded track drags (the others have no file to drop yet).
  return path && info ? (
    <Draggable id={`music-${track.id}`} data={trackItem(track, path, info)}>
      {body}
    </Draggable>
  ) : (
    body
  );
};

/** The search field above a library: CapCut's, with the magnifier and a clear button. */
const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; kind: MusicKind }> = ({ value, onChange, kind }) => (
  <div className="relative px-3 pt-3">
    <LuSearch className="absolute left-5 top-[22px] h-3.5 w-3.5 text-[#6c6c6c] pointer-events-none" />
    <input
      data-testid="music-search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={kind === "music" ? "Search music" : "Search sound effects"}
      className="w-full h-8 rounded-[6px] bg-[#1c1c1c] pl-8 pr-7 text-[12px] text-brand-light placeholder:text-[#6c6c6c] outline-none focus:ring-[0.5px] focus:ring-brand-accent/70"
    />
    {value && (
      <button type="button" aria-label="Clear the search" onClick={() => onChange("")} className="absolute right-5 top-[21px] h-4 w-4 rounded-full flex items-center justify-center text-[#949494] hover:text-brand-light">
        <LuX className="h-3 w-3" />
      </button>
    )}
  </div>
);

const Message: React.FC<{ icon: React.ComponentType<{ className?: string }>; title: string; body: string; testId: string; action?: { label: string; onClick: () => void } }> = ({ icon: Icon, title, body, testId, action }) => (
  <div data-testid={testId} className="flex flex-col items-center text-center gap-2 px-6 pt-10 pb-6">
    <Icon className="w-7 h-7 text-[#6c6c6c]" />
    <h3 className="mt-2 text-[12px] font-medium text-brand-light/85">{title}</h3>
    <p className="text-[12px] leading-relaxed text-[#6c6c6c] max-w-[280px]">{body}</p>
    {action && (
      <button type="button" data-testid={`${testId}-action`} onClick={action.onClick} className="mt-1 h-6 px-3 rounded-[4px] bg-brand-button text-[12px] text-brand-light hover:brightness-110">
        {action.label}
      </button>
    )}
  </div>
);

/** Where the tracks come from, with the licences, at the foot of a list. */
const Footer: React.FC = () => (
  <p data-testid="music-footer" className="mt-4 mb-1 text-[11px] leading-snug text-[#6c6c6c]">
    Free audio from Openverse (Freesound, Jamendo, Wikimedia): CC0, Public Domain and CC BY only. Added tracks keep their credit in the project; Export lists them.
  </p>
);

const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="h-6 mt-3 mb-2 text-[12px] text-brand-light flex items-center">{children}</div>
);

/** One category of a library (or a search in it): the rows, with Show more and the offline message. */
export const MusicLibraryView: React.FC<{ kind: MusicKind; category: MusicCategory; onTimeline: Set<string> }> = ({ kind, category, onTimeline }) => {
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [pages, setPages] = useState<LibraryPage[]>([]);
  const [error, setError] = useState<{ message: string; offline: boolean; rateLimited: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const loaded = useMusicLibrary((s) => s.loaded);
  const seq = useRef(0);

  useEffect(() => {
    if (!loaded) void useMusicLibrary.getState().load();
  }, [loaded]);
  // The search follows the typing a moment later (every search is a request to Openverse).
  useEffect(() => {
    const id = setTimeout(() => setQuery(typed.trim()), 400);
    return () => clearTimeout(id);
  }, [typed]);
  // Another section starts the search over.
  useEffect(() => {
    setTyped("");
    setQuery("");
  }, [kind, category.id]);

  const q = query || category.q;
  const browse = !query;
  useEffect(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    setPages([]);
    void fetchPage(kind, q, 1, browse).then((r) => {
      if (mine !== seq.current) return;
      setBusy(false);
      if (r.kind === "ok") setPages([r.data]);
      else setError(r);
    });
  }, [kind, q, browse, retry]);

  const more = async () => {
    const last = pages[pages.length - 1];
    if (!last || busy) return;
    const mine = seq.current;
    setBusy(true);
    const r = await fetchPage(kind, q, last.page + 1, browse);
    if (mine !== seq.current) return;
    setBusy(false);
    if (r.kind === "ok") setPages((p) => [...p, r.data]);
    else setError(r);
  };

  const tracks = useMemo(() => {
    const seen = new Set<string>();
    return pages.flatMap((p) => p.tracks).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  }, [pages]);
  const last = pages[pages.length - 1];
  const canMore = !!last && last.page < last.pageCount;

  return (
    <div className="h-full flex flex-col" data-testid={`music-library-${kind}`} data-category={category.id}>
      <SearchBox value={typed} onChange={setTyped} kind={kind} />
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 pb-6 min-w-0 text-left">
          <Heading>{query ? `Results for “${query}”` : category.label}</Heading>
          {last?.stale && (
            <p data-testid="music-stale" className="mb-2 text-[11px] text-[#949494]">
              Showing saved results; Openverse isn't answering right now.
            </p>
          )}
          {tracks.length > 0 && (
            <div className="flex flex-col gap-3" data-testid="music-rows">
              {tracks.map((t) => (
                <TrackRow key={t.id} track={t} added={onTimeline.has(t.id)} />
              ))}
            </div>
          )}
          {busy && pages.length === 0 && !error && <p data-testid="music-loading" className="text-[12px] text-[#6c6c6c] px-1 py-6 text-center">Loading…</p>}
          {!busy && !error && pages.length > 0 && tracks.length === 0 && (
            <Message icon={LuSearch} testId="music-none" title={query ? "Nothing found" : "Nothing here yet"} body={query ? `No openly licensed ${kind === "music" ? "music" : "sound effects"} match “${query}”.` : "Try another category."} />
          )}
          {error && tracks.length === 0 && (
            <Message
              icon={error.offline ? LuWifiOff : LuTriangleAlert}
              testId={error.offline ? "music-offline" : "music-error"}
              title={error.offline ? "You're offline" : error.rateLimited ? "Openverse needs a rest" : "Couldn't load the library"}
              body={
                error.offline
                  ? "Browsing needs a connection. Tracks you've downloaded and your Favorites still play and add as usual."
                  : error.rateLimited
                    ? "Openverse limits how often anonymous apps may ask. Try again in a few minutes; your Favorites and downloaded tracks work meanwhile."
                    : error.message
              }
              action={{ label: "Try again", onClick: () => setRetry((n) => n + 1) }}
            />
          )}
          {canMore && !error && (
            <button type="button" data-testid="music-more" disabled={busy} onClick={() => void more()} className="mt-3 w-full h-7 rounded-[4px] bg-brand-background-light text-[12px] text-brand-light hover:bg-brand-button disabled:opacity-50">
              {busy ? "Loading…" : "Show more"}
            </button>
          )}
          {tracks.length > 0 && <Footer />}
        </div>
      </ScrollArea>
    </div>
  );
};

/** Yours › Favorites: CapCut's Music / Sound effects chips over the favourites of each, saved whole so they work offline. */
export const MusicFavorites: React.FC<{ onTimeline: Set<string>; onGoTo: (kind: MusicKind) => void }> = ({ onTimeline, onGoTo }) => {
  const [kind, setKind] = useState<MusicKind>("music");
  const favorites = useMusicLibrary((s) => s.favorites);
  const loaded = useMusicLibrary((s) => s.loaded);
  useEffect(() => {
    if (!loaded) void useMusicLibrary.getState().load();
  }, [loaded]);
  const list = favorites.filter((f) => f.kind === kind);
  const chip = (k: MusicKind, label: string) => (
    <button
      key={k}
      type="button"
      data-testid={`music-fav-${k}`}
      aria-pressed={kind === k}
      onClick={() => setKind(k)}
      className={cn("h-6 px-3 rounded-full text-[12px] font-semibold", kind === k ? "bg-brand-button text-brand-light" : "bg-brand-background-light text-[#949494] hover:text-brand-light")}
    >
      {label}
    </button>
  );
  return (
    <ScrollArea className="h-full">
      <div data-testid="music-favorites" className="px-3 pb-6 min-w-0 text-left">
        <div className="flex flex-row gap-2 pt-3">
          {chip("music", "Music")}
          {chip("sfx", "Sound effects")}
        </div>
        {list.length === 0 ? (
          <Message
            icon={LuStar}
            testId="music-fav-empty"
            title="No favorites yet"
            body="Your favorite items will appear here. Star a track in the library to keep it, ready to play without a connection."
            action={{ label: kind === "music" ? "Go to Music" : "Go to Sound effects", onClick: () => onGoTo(kind) }}
          />
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {list.map((t) => (
              <TrackRow key={t.id} track={t} added={onTimeline.has(t.id)} />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
};
