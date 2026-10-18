import { create } from "zustand";

export type ContextMenuAction =
  | "copy"
  | "cut"
  | "paste"
  | "delete"
  | "split"
  | "separateAudio"
  | "export"
  | "group"
  | "ungroup"
  | "link"
  | "unlink"
  | "editMarker"
  | "deleteMarker"
  | "deleteAllMarkers"
  | "lockTrack"
  | "unlockTrack"
  | "deleteTrack"
  | "freeze"
  | "reverse"
  | "deleteTransition"
  | "deleteKeyframe"
  | "keyframeEase"
  | "keyframeGraph"
  /** Split scenes, Adjust color ▸ Auto adjust and Color match (lib/analysis.ts). */
  | "splitScenes"
  | "autoAdjust"
  | "colorMatch"
  /** A row that only opens its submenu. */
  | "none"
  /** The item's own `run` does it. */
  | "custom";

export type ContextTarget =
  | { type: "clip"; clipIds: string[]; primaryClipId: string; isVideo: boolean }
  | { type: "timeline"; timelineId: string }
  | { type: "track"; timelineId: string }
  | { type: "marker"; markerId: string }
  | { type: "textSelection" }
  /** The transition on the cut after this clip. */
  | { type: "transition"; clipId: string }
  /** The keys at a clip-local frame of a clip (its diamond on the timeline). */
  | { type: "keyframe"; clipId: string; frame: number };

export interface ContextMenuItem {
  id: string;
  label: string;
  action: ContextMenuAction;
  shortcut?: string;
  disabled?: boolean;
  /** The current choice: an accent tick before the label. */
  checked?: boolean;
  /** What the action is given (an ease preset's name). */
  value?: string;
  /** A submenu, opened beside the row as it's hovered (CapCut's ›). */
  children?: ContextMenuItem[];
  /** Done when picked, in place of the menu's handling of `action` (then "custom"). */
  run?: () => void;
}

export interface ContextMenuGroup {
  id: string;
  label?: string;
  items: ContextMenuItem[];
}

interface ContextMenuState {
  open: boolean;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  groups: ContextMenuGroup[] | null;
  target: ContextTarget | null;
  openMenu: (args: {
    position: { x: number; y: number };
    items?: ContextMenuItem[];
    groups?: ContextMenuGroup[];
    target: ContextTarget;
  }) => void;
  closeMenu: () => void;
  setPosition: (pos: { x: number; y: number }) => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  open: false,
  position: { x: 0, y: 0 },
  items: [],
  groups: null,
  target: null,
  openMenu: ({ position, items = [], groups, target }) =>
    set({ open: true, position, items, groups: groups ?? null, target }),
  closeMenu: () => set({ open: false, items: [], groups: null, target: null }),
  setPosition: (position) => set({ position }),
}));
