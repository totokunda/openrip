// The menu on a track's empty space, shared by the Konva timeline and the canvas one: the gap
// under the pointer, every gap on the track, Select, Paste, and the track's lock and delete.
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useContextMenuStore } from "@/lib/context-menu";
import { gapAt, trackGaps } from "@/lib/timeline-edit";
import { canDeleteTrack } from "../TrackControls";

/** Opens the track menu at the pointer; the playhead is already at `frame`. */
export function openTrackSpaceMenu(timelineId: string, frame: number, clientX: number, clientY: number) {
  const store = useClipStore.getState();
  const track = store.getTimelineById(timelineId);
  useContextMenuStore.getState().openMenu({
    position: { x: clientX, y: clientY },
    target: { type: "timeline", timelineId },
    groups: [
      // CapCut's empty-space menu: the gap under the mouse, every gap on the track, and
      // the track's clips.
      {
        id: "gaps",
        items: [
          {
            id: "close-gap",
            label: "Close gap",
            action: "custom",
            disabled: !!track?.locked || !gapAt(store.clips, timelineId, frame),
            run: () => void useClipStore.getState().closeGap(timelineId, frame),
          },
          {
            id: "close-all-gaps",
            label: "Close all gaps",
            action: "custom",
            disabled: !!track?.locked || trackGaps(store.clips, timelineId).length === 0,
            run: () => void useClipStore.getState().closeGap(timelineId, null),
          },
        ],
      },
      {
        id: "select",
        items: [
          {
            id: "select-track",
            label: "Select",
            action: "custom",
            disabled: !!track?.locked || !store.clips.some((c) => c.timelineId === timelineId && !c.hidden),
            // Every clip on the track.
            run: () =>
              useControlsStore.getState().setSelectedClipIds(
                useClipStore.getState().clips.filter((c) => c.timelineId === timelineId && !c.hidden).map((c) => c.clipId),
              ),
          },
        ],
      },
      {
        id: "edit",
        items: [
          {
            id: "paste",
            label: "Paste at Playhead",
            action: "paste",
            shortcut: "⌘V",
            disabled: !!track?.locked,
          },
        ],
      },
      {
        id: "track",
        items: [
          track?.locked
            ? { id: "unlock", label: "Unlock track", action: "unlockTrack" }
            : { id: "lock", label: "Lock track", action: "lockTrack" },
          {
            id: "delete",
            label: "Delete track",
            action: "deleteTrack",
            disabled: !track || !canDeleteTrack(store.timelines, track),
          },
        ],
      },
    ],
  });
}
