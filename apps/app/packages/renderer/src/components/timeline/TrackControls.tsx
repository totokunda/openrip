// A track header's controls, as CapCut's: lock, hide, mute, delete and a "…" menu (also on
// right-click), each a component taking the track; the drag that moves a track up or down the
// list (useTrackReorder); and the button that adds a track. Self-contained, so any track
// header layout can use them.
import React from "react";
import { IoEye, IoEyeOff, IoVolumeHigh, IoVolumeMute } from "react-icons/io5";
import { LuEllipsis, LuLock, LuLockOpen, LuPlus, LuTrash2 } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useContextMenuStore, type ContextMenuItem } from "@/lib/context-menu";
import { mainTrackOf } from "@/lib/timeline-edit";
import type { TimelineProps, TimelineType } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Whether the track can be deleted: not when locked, nor the main track while another video track exists. */
export const canDeleteTrack = (timelines: TimelineProps[], track: TimelineProps) => {
  if (track.locked) return false;
  const main = mainTrackOf(timelines);
  return !(track.timelineId === main?.timelineId && timelines.some((t) => t.type === "media" && t !== main));
};

const iconButton = "cursor-pointer text-brand-light/85 hover:text-brand-lighter disabled:opacity-30 disabled:cursor-not-allowed";

type TrackProp = { track: TimelineProps };

/** Mute or unmute the track's sound (video and audio tracks). */
export const TrackMuteButton: React.FC<TrackProp> = ({ track }) => {
  const { muteTimeline, unmuteTimeline } = useClipStore();
  if (track.type !== "media" && track.type !== "audio") return null;
  return (
    <button
      title={track.muted ? "Unmute track" : "Mute track"}
      className={iconButton}
      onClick={() => (track.muted ? unmuteTimeline(track.timelineId) : muteTimeline(track.timelineId))}
    >
      {track.muted ? <IoVolumeMute className="w-3 h-3" /> : <IoVolumeHigh className="w-3 h-3" />}
    </button>
  );
};

/** Hide or show the track's picture (every track but audio). */
export const TrackHideButton: React.FC<TrackProp> = ({ track }) => {
  const { hideTimeline, unhideTimeline } = useClipStore();
  if (track.type === "audio") return null;
  return (
    <button
      title={track.hidden ? "Show track" : "Hide track"}
      className={iconButton}
      onClick={() => (track.hidden ? unhideTimeline(track.timelineId) : hideTimeline(track.timelineId))}
    >
      {track.hidden ? <IoEyeOff className="w-3 h-3" /> : <IoEye className="w-3 h-3" />}
    </button>
  );
};

/** Lock or unlock the track: a locked track's clips can't be selected or edited. */
export const TrackLockButton: React.FC<TrackProp> = ({ track }) => {
  const setTrackLocked = useClipStore((s) => s.setTrackLocked);
  return (
    <button title={track.locked ? "Unlock track" : "Lock track"} className={iconButton} onClick={() => setTrackLocked(track.timelineId, !track.locked)}>
      {track.locked ? <LuLock className="w-3 h-3" /> : <LuLockOpen className="w-3 h-3" />}
    </button>
  );
};

/** Delete the track and its clips (not a locked track, nor the main track beside another video track). */
export const TrackDeleteButton: React.FC<TrackProp> = ({ track }) => {
  const deleteTrack = useClipStore((s) => s.deleteTrack);
  const deletable = useClipStore((s) => canDeleteTrack(s.timelines, track));
  return (
    <button title="Delete track" className={iconButton} disabled={!deletable} onClick={() => deleteTrack(track.timelineId)}>
      <LuTrash2 className="w-3 h-3" />
    </button>
  );
};

/** The track's "…" menu (the one its right-click opens). */
export const TrackMenuButton: React.FC<TrackProp> = ({ track }) => (
  <button
    title="Track menu"
    className={iconButton}
    onClick={(e) => {
      const r = e.currentTarget.getBoundingClientRect();
      openTrackMenu({ clientX: r.left, clientY: r.bottom + 4 }, track);
    }}
  >
    <LuEllipsis className="w-3 h-3" />
  </button>
);

/** A 24 px column of the header, so the same control lines up on every track. */
const Slot: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div className="w-6 h-full shrink-0 flex items-center justify-center">{children}</div>
);

/**
 * A track header's buttons in CapCut's columns: lock, hide, mute and the "…" menu, each in
 * its own 24 px column (a track without one leaves its column empty). Video tracks have all
 * four; audio tracks no hide; text, filter, shape and drawing tracks lock and hide only.
 * Delete is in the menu (and on right-click), as in CapCut.
 */
export const TrackButtons: React.FC<TrackProp> = ({ track }) => {
  const sound = track.type === "media" || track.type === "audio";
  return (
    <>
      <Slot>
        <TrackLockButton track={track} />
      </Slot>
      <Slot>
        <TrackHideButton track={track} />
      </Slot>
      {sound && (
        <>
          <Slot>
            <TrackMuteButton track={track} />
          </Slot>
          <Slot>
            <TrackMenuButton track={track} />
          </Slot>
        </>
      )}
    </>
  );
};

/**
 * A video or audio track's display items, as CapCut's "…" menu has them: Track height › Short,
 * Default, Tall (its row) and Audio waveform size › 30%, 60%, 100% (how tall its waveforms
 * are), the current ones ticked. Saved with the track.
 */
const trackDisplayItems = (track: TimelineProps): ContextMenuItem[] => {
  if (track.type !== "media" && track.type !== "audio") return [];
  const set = (patch: Partial<TimelineProps>) => () => useClipStore.getState().updateTimeline(track.timelineId, patch);
  const size = track.size ?? "default";
  const waveform = track.waveform ?? 30;
  return [
    {
      id: "track-height",
      label: "Track height",
      action: "none",
      children: (["short", "default", "tall"] as const).map((s) => ({
        id: `track-height-${s}`,
        label: s[0].toUpperCase() + s.slice(1),
        action: "custom" as const,
        checked: size === s,
        run: set({ size: s === "default" ? undefined : s }),
      })),
    },
    {
      id: "waveform-size",
      label: "Audio waveform size",
      action: "none",
      children: ([30, 60, 100] as const).map((w) => ({
        id: `waveform-size-${w}`,
        label: `${w}%`,
        action: "custom" as const,
        checked: waveform === w,
        run: set({ waveform: w === 30 ? undefined : w }),
      })),
    },
  ];
};

/** The track menu (right-click on its header or its row, or its "…"): height and waveform size, lock or unlock, delete. */
export const openTrackMenu = (e: { clientX: number; clientY: number }, track: TimelineProps) => {
  const { timelines } = useClipStore.getState();
  const display = trackDisplayItems(track);
  useContextMenuStore.getState().openMenu({
    position: { x: e.clientX, y: e.clientY },
    target: { type: "track", timelineId: track.timelineId },
    groups: [
      ...(display.length ? [{ id: "display", items: display }] : []),
      {
        id: "track",
        items: [
          track.locked
            ? { id: "unlock", label: "Unlock track", action: "unlockTrack" }
            : { id: "lock", label: "Lock track", action: "lockTrack" },
          { id: "delete", label: "Delete track", action: "deleteTrack", disabled: !canDeleteTrack(timelines, track) },
        ],
      },
    ],
  });
};

/**
 * Dragging track headers up and down to reorder the tracks. `rows` gives the headers' current
 * layout (top and height on screen); the hook gives the handler for a header's mouse down and
 * the line to draw where the track would go.
 */
export const useTrackReorder = (rows: () => { id: string; top: number; height: number }[]) => {
  const [indicator, setIndicator] = React.useState<number | null>(null);
  const onMouseDown = (e: React.MouseEvent, timelineId: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const startY = e.clientY;
    let moved = false;
    let target: number | null = null;
    const layout = rows();
    const from = layout.findIndex((r) => r.id === timelineId);
    // The gap the pointer is nearest: 0 is above the first track, n below the last.
    const gapAt = (y: number) => {
      let i = 0;
      while (i < layout.length && y > layout[i].top + layout[i].height / 2) i++;
      return i;
    };
    const onMove = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientY - startY) < 4) return;
      moved = true;
      document.body.style.cursor = "grabbing";
      target = gapAt(ev.clientY);
      setIndicator(target === from || target === from + 1 ? null : target);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setIndicator(null);
      if (!moved || target == null || target === from || target === from + 1) return;
      // The index among the other tracks.
      useClipStore.getState().moveTrack(timelineId, target > from ? target - 1 : target);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return { onMouseDown, indicator };
};

export const TRACK_TYPES: { type: TimelineType; label: string }[] = [
  { type: "media", label: "Video track" },
  { type: "audio", label: "Audio track" },
  { type: "text", label: "Text track" },
  { type: "filter", label: "Filter track" },
];

/** Adds an empty track of the chosen kind. */
export const AddTrackButton: React.FC<{ className?: string }> = ({ className }) => {
  const addTrack = useClipStore((s) => s.addTrack);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Add track"
        className={cn("flex items-center justify-center w-full h-6 text-brand-light/50 hover:text-brand-light cursor-pointer outline-none", className)}
      >
        <LuPlus className="w-3.5 h-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="dark bg-brand-background/90 backdrop-blur-md border border-brand-light/10 rounded-[8px] z-[100]">
        {TRACK_TYPES.map((t) => (
          <DropdownMenuItem key={t.type} className="text-[11px] cursor-pointer" onSelect={() => addTrack(t.type)}>
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
