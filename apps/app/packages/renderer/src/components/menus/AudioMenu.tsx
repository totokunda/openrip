import React, { useMemo, useState } from "react";
import type { IconType } from "react-icons";
import { LuFilm, LuMic, LuMusic, LuPlus } from "react-icons/lu";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { importMediaPaths, listConvertedMedia, pickMediaPaths, voiceoverList } from "@app/preload";
import { ScrollArea } from "@/components/ui/scroll-area";
import Draggable from "@/components/dnd/Draggable";
import type { MediaItem } from "@/components/media/Item";
import { useProjectsStore } from "@/lib/projects";
import { useClipStore } from "@/lib/clip";
import { bumpMediaLibraryVersion, useMediaLibraryVersion } from "@/lib/media/library";
import { getMediaInfo } from "@/lib/media/utils";
import { AUDIO_EXTS, VIDEO_EXTS } from "@/lib/settings";
import { addSoundAtPlayhead } from "@/lib/audio-tools";
import { MUSIC_CATEGORIES, SFX_CATEGORIES, librarySection, parseLibrarySection } from "@/lib/music-library";
import { MusicFavorites, MusicLibraryView } from "./MusicLibraryView";
import { useVoiceoverPanel } from "@/components/voiceover/VoiceoverPanel";

/**
 * The left panel's Audio tab (docs/plan/capcut-ui-spec.md §6.6, `06-left-audio/`):
 * - Extracted: the sound of each video in the project, with CapCut's "Extract audio" card to
 *   bring in another video for its sound;
 * - Voiceovers: the takes recorded for the project (the timeline's microphone);
 * - Yours: Favorites (library tracks starred, kept whole so they work offline) and the audio
 *   files imported from the computer;
 * - Music and Sound effects: libraries of openly licensed tracks (Openverse: CC0, Public Domain,
 *   CC BY), by category, with search (MusicLibraryView.tsx, lib/music-library.ts).
 * Each sound is a CapCut audio row: "+" puts it on a new audio track at the playhead, and it
 * drags onto the timeline like a media card.
 */

/** A section's id: "extracted", "voiceovers", "favorites", "files", `music:<category>` or `sfx:<category>`. */
export type AudioSection = string;

/** The column beside the Audio tab, as CapCut's: Extracted, Voiceovers, Yours, then the libraries' categories. */
export const audioSections = () => [
  { id: "extracted", label: "Extracted" },
  { id: "voiceovers", label: "Voiceovers" },
  { id: "favorites", label: "Favorites", under: "Yours" },
  { id: "files", label: "Imported", under: "Yours" },
  ...MUSIC_CATEGORIES.map((c) => ({ id: librarySection("music", c), label: c.label, under: "Music" })),
  ...SFX_CATEGORIES.map((c) => ({ id: librarySection("sfx", c), label: c.label, under: "Sound effects" })),
];

/** A sound listed here: what the timeline needs to add it, and what the row shows. */
type Sound = { key: string; name: string; detail: string; url: string; seconds: number; item: MediaItem };

const timeOf = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** A sound as a MediaItem of type audio, which the timeline's drop takes like a media card's. */
const soundOf = async (key: string, name: string, detail: string, url: string): Promise<Sound | null> => {
  try {
    const info = await getMediaInfo(url);
    if (!info?.audio) return null;
    const seconds = info.duration ?? 0;
    return { key, name, detail, url, seconds, item: { name: key, type: "audio", absPath: url, assetUrl: url, mediaInfo: info } };
  } catch {
    return null;
  }
};

/**
 * The project's sounds, read again whenever its media library changes (an import, a take): its
 * videos' sound (`url#audio`, the video's file played for its sound alone, as a detach does),
 * its takes, and its audio files.
 */
const useProjectSounds = () => {
  const folder = useProjectsStore((s) => s.getActiveProject()?.folderUuid);
  const version = useMediaLibraryVersion();
  return useQuery({
    queryKey: ["audio-panel", folder ?? null, version],
    queryFn: async () => {
      const [media, takes] = await Promise.all([listConvertedMedia(folder), voiceoverList(folder)]);
      const takeNames = new Set(takes.map((t) => t.path.split("/").pop()));
      const videos = await Promise.all(
        media.filter((m) => m.type === "video").map((m) => soundOf(`extracted:${m.name}`, m.name, "From video", `${m.originalAssetUrl ?? m.assetUrl}#audio`)),
      );
      const recorded = await Promise.all(takes.map((t) => soundOf(`take:${t.name}`, t.name, "Voiceover", t.url)));
      const files = await Promise.all(
        media.filter((m) => m.type === "audio" && !takeNames.has(m.name)).map((m) => soundOf(`file:${m.name}`, m.name, "Audio file", m.assetUrl)),
      );
      const kept = (list: (Sound | null)[]) => list.filter((s): s is Sound => !!s);
      return { videos: kept(videos), takes: kept(recorded), files: kept(files) };
    },
    placeholderData: (prev) => prev,
    retry: false,
    refetchOnWindowFocus: false,
  });
};

/** Import files from the computer into the project's media (and so this tab's lists). */
const importFiles = async (kind: "video" | "audio") => {
  const extensions = kind === "video" ? VIDEO_EXTS : AUDIO_EXTS;
  const paths = await pickMediaPaths({ filters: [{ name: kind === "video" ? "Video Files" : "Audio Files", extensions }], title: kind === "video" ? "Choose videos to take the sound from" : "Choose audio files to import" });
  const ok = paths.filter((p) => extensions.includes(p.split(".").pop()?.toLowerCase() ?? ""));
  if (ok.length === 0) return;
  try {
    await importMediaPaths(ok, undefined, useProjectsStore.getState().getActiveProject()?.folderUuid);
    bumpMediaLibraryVersion();
  } catch (e) {
    console.error(e);
    toast.error("Couldn't import the files", { position: "bottom-right" });
  }
};

/**
 * CapCut's audio row: 48 px on a 60 px pitch, the raised fill, a 32 px cover, the title over
 * "kind · duration", and the 16 px round "+" at the right. "Added" when it's on the timeline.
 */
const SoundRow: React.FC<{ sound: Sound; icon: IconType; added: boolean }> = ({ sound, icon: Icon, added }) => (
  <Draggable id={sound.key} data={sound.item}>
    <div data-testid="audio-row" data-name={sound.name} className="group h-12 w-full rounded-[6px] bg-brand-background-light flex flex-row items-center gap-2.5 px-2 cursor-grab">
      <div className="h-8 w-8 shrink-0 rounded-[4px] bg-[#1d1d1d] flex items-center justify-center text-[#949494]">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-brand-light truncate">{sound.name}</div>
        <div className="text-[11px] text-[#949494] tabular-nums truncate">
          {sound.detail} · {timeOf(sound.seconds)}
          {added && <span className="ml-2 px-1.5 py-px rounded-[2px] bg-brand-background-dark/85 text-[10px] text-brand-light">Added</span>}
        </div>
      </div>
      <button
        type="button"
        data-testid="audio-row-add"
        title="Add to the timeline at the playhead"
        aria-label={`Add ${sound.name} at the playhead`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => addSoundAtPlayhead(sound.url, sound.seconds)}
        className="h-4 w-4 shrink-0 rounded-full bg-[#1d1d1d] text-brand-light flex items-center justify-center hover:bg-brand-accent hover:text-white transition-colors"
      >
        <LuPlus className="h-3 w-3" />
      </button>
    </div>
  </Draggable>
);

/** An empty list, as CapCut's: a muted glyph, a line of text, and what to do about it. */
const Empty: React.FC<{ icon: IconType; title: string; body: string; action?: { label: string; onClick: () => void; testId: string } }> = ({ icon: Icon, title, body, action }) => (
  <div className="flex flex-col items-center text-center gap-2 px-6 pt-10 pb-6">
    <Icon className="w-7 h-7 text-[#6c6c6c]" />
    <h3 className="mt-2 text-[12px] font-medium text-brand-light/85">{title}</h3>
    <p className="text-[12px] leading-relaxed text-[#6c6c6c] max-w-[280px]">{body}</p>
    {action && (
      <button type="button" data-testid={action.testId} onClick={action.onClick} className="mt-1 h-6 px-3 rounded-[4px] bg-brand-button text-[12px] text-brand-light hover:brightness-110">
        {action.label}
      </button>
    )}
  </div>
);

const Heading: React.FC<{ children: React.ReactNode; end?: React.ReactNode }> = ({ children, end }) => (
  <div className="flex flex-row items-center justify-between h-6 mt-4 mb-2">
    <span className="text-[12px] text-brand-light">{children}</span>
    {end}
  </div>
);

const AudioMenu: React.FC<{ section: AudioSection; onOpen?: (section: AudioSection) => void }> = ({ section, onOpen }) => {
  const { data, isLoading } = useProjectSounds();
  const assets = useClipStore((s) => s.assets);
  const onTimeline = useMemo(() => new Set(Object.values(assets).map((a) => a?.path)), [assets]);
  const credited = useMemo(() => new Set(Object.values(assets).flatMap((a) => (a?.credit?.id ? [a.credit.id] : []))), [assets]);
  const openVoiceover = useVoiceoverPanel((s) => s.setOpen);
  const [importing, setImporting] = useState(false);
  const run = (kind: "video" | "audio") => async () => {
    setImporting(true);
    try {
      await importFiles(kind);
    } finally {
      setImporting(false);
    }
  };
  const rows = (list: Sound[] | undefined, icon: IconType) => (
    <div className="flex flex-col gap-3">
      {(list ?? []).map((s) => (
        <SoundRow key={s.key} sound={s} icon={icon} added={onTimeline.has(s.url)} />
      ))}
    </div>
  );
  const files = data?.files ?? [];
  const lib = parseLibrarySection(section);

  if (lib) return <div data-testid={`audio-section-${section}`} className="h-full"><MusicLibraryView kind={lib.kind} category={lib.category} onTimeline={credited} /></div>;
  if (section === "favorites") return <div data-testid="audio-section-favorites" className="h-full"><MusicFavorites onTimeline={credited} onGoTo={(kind) => onOpen?.(librarySection(kind, (kind === "music" ? MUSIC_CATEGORIES : SFX_CATEGORIES)[0]))} /></div>;

  return (
    <ScrollArea className="h-full">
      <div data-testid={`audio-section-${section}`} className="px-3 pb-6 min-w-0 text-left">
        {section === "extracted" && (
          <>
            {/* CapCut's Extract audio card. */}
            <div className="mt-3 rounded-[8px] bg-[#333333] px-3 py-3 flex flex-row items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-brand-light">Extract audio</div>
                <div className="mt-0.5 text-[12px] text-[#949494]">Take the sound from a video file</div>
              </div>
              <button type="button" data-testid="audio-extract" disabled={importing} onClick={run("video")} className="h-6 px-4 rounded-[4px] bg-brand-button text-[12px] font-semibold text-brand-light hover:brightness-110 disabled:opacity-50">
                Import
              </button>
            </div>
            {data?.videos.length ? (
              <>
                <Heading>From your videos</Heading>
                {rows(data.videos, LuFilm)}
              </>
            ) : (
              !isLoading && <Empty icon={LuFilm} title="No video sound yet" body="The sound of each video in this project shows here. Import a video above, or in Media." />
            )}
          </>
        )}
        {section === "voiceovers" &&
          (data?.takes.length ? (
            <>
              <Heading
                end={
                  <button type="button" data-testid="audio-record" onClick={() => openVoiceover(true)} className="h-6 px-2.5 flex items-center gap-1.5 rounded-[4px] bg-brand-background-light text-[12px] text-brand-light hover:bg-brand-button">
                    <LuMic className="h-3.5 w-3.5" /> Record
                  </button>
                }
              >
                Recorded
              </Heading>
              {rows(data.takes, LuMic)}
            </>
          ) : (
            !isLoading && (
              <Empty
                icon={LuMic}
                title="No voiceovers yet"
                body="Takes you record with the microphone on the timeline's toolbar are kept here."
                action={{ label: "Record a voiceover", onClick: () => openVoiceover(true), testId: "audio-record" }}
              />
            )
          ))}
        {section === "files" &&
          (files.length === 0 ? (
            <Empty
              icon={LuMusic}
              title="No imported audio yet"
              body="Audio files you import from the computer are kept in this project and listed here."
              action={{ label: importing ? "Importing…" : "Import audio", onClick: run("audio"), testId: "audio-import" }}
            />
          ) : (
            <>
              <Heading
                end={
                  <button type="button" data-testid="audio-import" onClick={run("audio")} className="h-6 px-2.5 rounded-[4px] bg-brand-background-light text-[12px] text-brand-light hover:bg-brand-button">
                    {importing ? "Importing…" : "Import audio"}
                  </button>
                }
              >
                Your audio files
              </Heading>
              {rows(files, LuMusic)}
            </>
          ))}
      </div>
    </ScrollArea>
  );
};

export default AudioMenu;
