// The menu on a marker, shared by the Konva timeline and the canvas one.
import { useContextMenuStore } from "@/lib/context-menu";

/** Opens the marker menu at the pointer. */
export function openMarkerMenu(markerId: string, clientX: number, clientY: number) {
  useContextMenuStore.getState().openMenu({
    position: { x: clientX, y: clientY },
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
