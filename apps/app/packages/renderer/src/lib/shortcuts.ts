// The keyboard shortcuts as the Shortcuts menu lists them. Keep it in step with the handlers:
// Controls.tsx (editing, tools and the preview's zoom) and lib/timeline-shortcuts.ts (the
// timeline's, CapCut's keys).

export type ShortcutRow = { action: string; keys: string[] };
export type ShortcutSection = { title?: string; rows: ShortcutRow[] };

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    rows: [
      { action: "Undo", keys: ["⌘", "Z"] },
      { action: "Redo", keys: ["⌘", "⇧", "Z"] },
      { action: "Play / Pause", keys: ["Space"] },
      { action: "Select All", keys: ["⌘", "A"] },
      { action: "Copy", keys: ["⌘", "C"] },
      { action: "Cut", keys: ["⌘", "X"] },
      { action: "Paste", keys: ["⌘", "V"] },
      { action: "Delete", keys: ["⌫"] },
      { action: "Group", keys: ["⌘", "G"] },
      { action: "Ungroup", keys: ["⌘", "⇧", "G"] },
    ],
  },
  {
    title: "Timeline",
    rows: [
      { action: "Split", keys: ["⌘", "B"] },
      { action: "Split All Tracks", keys: ["⌘", "⇧", "B"] },
      { action: "Delete Left", keys: ["Q"] },
      { action: "Delete Right", keys: ["W"] },
      { action: "Extract Audio", keys: ["⌘", "⇧", "S"] },
      { action: "Add Marker", keys: ["M"] },
      { action: "Previous Marker", keys: ["⌥", "←"] },
      { action: "Next Marker", keys: ["⌥", "→"] },
      { action: "Main Track Magnet", keys: ["P"] },
      { action: "Auto Snapping", keys: ["N"] },
      { action: "Linkage", keys: ["`"] },
      { action: "Previous Frame", keys: ["←"] },
      { action: "Next Frame", keys: ["→"] },
      { action: "Back 10 Frames", keys: ["⇧", "←"] },
      { action: "Forward 10 Frames", keys: ["⇧", "→"] },
      { action: "Previous Edit", keys: ["↑"] },
      { action: "Next Edit", keys: ["↓"] },
      { action: "Go to Start", keys: ["Home"] },
      { action: "Go to End", keys: ["End"] },
      { action: "Select Left of Playhead", keys: ["["] },
      { action: "Select Right of Playhead", keys: ["]"] },
      { action: "Zoom In Timeline", keys: ["⌘", "="] },
      { action: "Zoom Out Timeline", keys: ["⌘", "−"] },
      { action: "Zoom Timeline to Fit", keys: ["⇧", "Z"] },
    ],
  },
  {
    title: "Preview",
    rows: [
      { action: "Zoom to Fit", keys: ["⌘", "0"] },
      { action: "Zoom to 50%", keys: ["⌘", "5"] },
      { action: "Zoom to 100%", keys: ["⌘", "1"] },
      { action: "Zoom to 200%", keys: ["⌘", "2"] },
    ],
  },
  {
    title: "Tools",
    rows: [
      { action: "Pointer", keys: ["V"] },
      { action: "Hand", keys: ["H"] },
      { action: "Draw", keys: ["D"] },
      { action: "Text", keys: ["T"] },
      { action: "Shape", keys: ["S"] },
    ],
  },
  {
    title: "Shape Mode",
    rows: [
      { action: "Rectangle", keys: ["1"] },
      { action: "Ellipse", keys: ["2"] },
      { action: "Polygon", keys: ["3"] },
      { action: "Line", keys: ["4"] },
      { action: "Star", keys: ["5"] },
    ],
  },
  {
    title: "Mask Mode",
    rows: [
      { action: "Lasso", keys: ["1"] },
      { action: "Shape", keys: ["2"] },
      { action: "Draw", keys: ["3"] },
    ],
  },
  {
    title: "Draw Mode",
    rows: [
      { action: "Brush", keys: ["1"] },
      { action: "Highlighter", keys: ["2"] },
      { action: "Eraser", keys: ["3"] },
    ],
  },
];
