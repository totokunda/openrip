// The menus of the marks on the new timeline: a marker's, a transition's and a keyframe's, the
// same items the timeline before this one had (GlobalContextMenu runs their actions).
import { useControlsStore } from "@/lib/control";
import { useContextMenuStore } from "@/lib/context-menu";
import { useClipStore } from "@/lib/clip";
import { EASE_PRESETS, easeAt, useKeyframeGraphStore } from "@/lib/timeline-keyframes";

export function openMarkerMenu(markerId: string, x: number, y: number) {
  useControlsStore.getState().setSelectedMarkerId(markerId);
  useContextMenuStore.getState().openMenu({
    position: { x, y },
    target: { type: "marker", markerId },
    groups: [
      {
        id: "marker",
        items: [
          { id: "edit", label: "Edit marker", action: "editMarker" },
          { id: "delete", label: "Delete marker", action: "deleteMarker", shortcut: "Del" },
          { id: "deleteAll", label: "Delete all markers in timeline", action: "deleteAllMarkers" },
        ],
      },
    ],
  });
}

export function openTransitionMenu(clipId: string, x: number, y: number) {
  useControlsStore.getState().setSelectedTransitionId(clipId);
  useContextMenuStore.getState().openMenu({
    position: { x, y },
    target: { type: "transition", clipId },
    groups: [{ id: "edit", items: [{ id: "delete", label: "Delete", action: "deleteTransition", shortcut: "⌫" }] }],
  });
}

export function openKeyframeMenu(clipId: string, frame: number, x: number, y: number) {
  const clip = useClipStore.getState().getClipById(clipId);
  const ease = easeAt(clip?.keyframes, frame);
  useContextMenuStore.getState().openMenu({
    position: { x, y },
    target: { type: "keyframe", clipId, frame },
    groups: [
      { id: "ease", items: EASE_PRESETS.map((p) => ({ id: `ease-${p.value}`, label: p.label, action: "keyframeEase" as const, value: p.value, checked: ease === p.value })) },
      {
        id: "edit",
        items: [
          { id: "keyframe-graph", label: useKeyframeGraphStore.getState().open ? "Hide keyframe graph" : "Keyframe graph", action: "keyframeGraph", shortcut: "⌥K" },
          { id: "delete-keyframe", label: "Delete keyframe", action: "deleteKeyframe" },
        ],
      },
    ],
  });
}
